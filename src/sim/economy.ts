import { STRATA, type Content } from './content';
import { addModifier, indexModifiers, removeModifiers, statValue, type ModifierIndex } from './modifiers';
import type { GameState, Ledger, Loan } from './state';

/**
 * The economy (DESIGN.md §5.2). Money is in hundredths of a ducat and every step truncates, so a run is the same on
 * every machine. Each month every province's people make wealth; the owner taxes it (tax law × tax efficiency), the
 * crown keeps its share of the church's tithe, and the province's trade good brings trade income. Vassals pay dues
 * to their overlord. Courts, administration, household troops, building upkeep and loan interest are paid, loans
 * fall due, and people grow.
 */

/** What the economy needs besides the state: content, and each province's trade good (static scenario data). */
export interface EconomyContext {
  content: Content;
  /** Per province id: trade good id (1-based into content.goods; 0 = none). */
  goods: number[];
  /** Per province id: entrepôt trade value, hundredths a month (scenario.tradeCentre). */
  centres?: number[];
  /** Per realm id - 1: its seat's name, for new houses (scenario.seats). */
  seats?: string[];
  /** Per province id: culture and religion ids, for the people born and made there. */
  culture?: number[];
  religion?: number[];
}

/** Ledger categories in display order. Income is positive, spending negative. */
export const LEDGER: { key: string; label: string; kind: 'income' | 'expense' | 'oneOff' }[] = [
  { key: 'land_tax', label: 'Land tax', kind: 'income' },
  { key: 'urban_tax', label: 'Town dues', kind: 'income' },
  { key: 'tithes', label: 'Tithes', kind: 'income' },
  { key: 'trade', label: 'Trade', kind: 'income' },
  { key: 'vassal_dues', label: 'Dues from vassals', kind: 'income' },
  { key: 'court', label: 'Court', kind: 'expense' },
  { key: 'administration', label: 'Administration', kind: 'expense' },
  { key: 'retinue', label: 'Household troops and garrisons', kind: 'expense' },
  { key: 'upkeep', label: 'Building upkeep', kind: 'expense' },
  { key: 'interest', label: 'Loan interest', kind: 'expense' },
  { key: 'dues_to_overlord', label: 'Dues to the overlord', kind: 'expense' },
  { key: 'largesse', label: 'Largesse and display', kind: 'expense' },
  { key: 'council', label: 'Council salaries', kind: 'expense' },
  { key: 'construction', label: 'Building works', kind: 'oneOff' },
  { key: 'loans_taken', label: 'Loans taken', kind: 'oneOff' },
  { key: 'loans_repaid', label: 'Loans repaid', kind: 'oneOff' },
  { key: 'embezzlement', label: 'Embezzled by the regent', kind: 'oneOff' },
];

/** Something a realm or the player should hear about. realm 0 = everyone. */
export interface Notice {
  realm: number;
  text: string;
}

const S = STRATA.length;
/** Most of its raised income (%) a realm spends on its court, and on administration. */
const COURT_CAP = 10;
const ADMIN_CAP = 15;
export const add = (l: Ledger, k: string, v: number) => { if (v) l[k] = (l[k] ?? 0) + v; };
const sum = (l: Ledger) => Object.values(l).reduce((a, b) => a + b, 0);
export const ducats = (h: number) => `${(Math.trunc(h) / 100).toLocaleString('en', { maximumFractionDigits: 0 })}`;

export interface ProvinceEconomy {
  /** Per stratum, STRATA order. */
  strata: number[];
  people: number;
  development: number;
  /** Monthly wealth of the countryside and of the towns, hundredths. */
  wealthLand: number;
  wealthUrban: number;
  landTax: number;
  urbanTax: number;
  tithe: number;
  tradeValue: number;
  trade: number;
  /** Paid to the owner this month: false while another realm occupies it. */
  paying: boolean;
}

/** A province's monthly economy as its owner would collect it now. */
export function provinceEconomy(state: GameState, ctx: EconomyContext, id: number, index?: ModifierIndex, realmCache?: Map<number, number[]>): ProvinceEconomy {
  const { content } = ctx;
  const e = content.economy;
  const p = state.provinces[id];
  const strata = state.pops.slice(id * S, id * S + S);
  while (strata.length < S) strata.push(0);
  const people = strata.reduce((a, b) => a + b, 0);
  const stat = (k: string) => (content.stats[k] ? statValue(state, content, k, { kind: 'province', id }, index) : 0);
  const development = stat('development');
  const owner = p?.owner ?? 0;
  const [taxRate = 0, titheShare = 0] = owner ? realmRates(state, content, owner, index, realmCache) : [];
  const factor = e.devBase + Math.trunc((e.devPerPoint * development) / 100);
  let land = 0;
  STRATA.forEach((s, i) => { if (s !== 'burghers') land += strata[i]! * e.wealthPerHead[i]!; });
  const wealthLand = Math.trunc((Math.trunc(land / 100) * factor) / 100);
  const wealthUrban = Math.trunc((Math.trunc((strata[1]! * e.wealthPerHead[1]!) / 100) * factor) / 100);
  const eff = stat('tax_efficiency');
  const taxOf = (w: number) => Math.trunc((Math.trunc((w * taxRate) / 10000) * eff) / 10000);
  const good = content.goods[(ctx.goods[id] ?? 0) - 1];
  const production = content.stats.production ? stat('production') : 10000;
  const tradeValue = (good ? Math.trunc((Math.trunc((good.price * people * e.tradePerThousand) / 100000) * production) / 10000) : 0)
    + (ctx.centres?.[id] ?? 0);
  return {
    strata, people, development, wealthLand, wealthUrban,
    landTax: taxOf(wealthLand),
    urbanTax: taxOf(wealthUrban),
    tithe: Math.trunc((Math.trunc(((wealthLand + wealthUrban) * e.tithe) / 10000) * titheShare) / 10000),
    tradeValue,
    trade: Math.trunc((tradeValue * (content.stats.trade_efficiency ? stat('trade_efficiency') : 0)) / 10000),
    paying: !!owner && p!.controller === owner,
  };
}

/** A realm's tax rate and tithe share (hundredths of a percent), cached per settlement. */
function realmRates(state: GameState, content: Content, realm: number, index?: ModifierIndex, cache?: Map<number, number[]>): number[] {
  const hit = cache?.get(realm);
  if (hit) return hit;
  const stat = (k: string) => (content.stats[k] ? statValue(state, content, k, { kind: 'realm', id: realm }, index) : 0);
  const rates = [stat('tax_rate'), stat('tithe_share'), stat('levy_size')];
  cache?.set(realm, rates);
  return rates;
}

/** This month's ledger of every realm (indexed like realms) as it would settle now, without one-offs. */
export function computeLedgers(state: GameState, ctx: EconomyContext): Ledger[] {
  const { content } = ctx;
  const e = content.economy;
  const index = indexModifiers(state.modifiers);
  const cache = new Map<number, number[]>();
  const ledgers: Ledger[] = state.realms.map(() => ({}));
  const provinces = new Array<number>(state.realms.length).fill(0);
  const people = new Array<number>(state.realms.length).fill(0);
  for (const p of state.provinces) {
    if (!p.owner || !ledgers[p.owner]) continue;
    const pe = provinceEconomy(state, ctx, p.id, index, cache);
    provinces[p.owner]! += 1;
    people[p.owner]! += pe.people;
    if (pe.paying) {
      const l = ledgers[p.owner]!;
      add(l, 'land_tax', pe.landTax);
      add(l, 'urban_tax', pe.urbanTax);
      add(l, 'tithes', pe.tithe);
      add(l, 'trade', pe.trade);
    }
    for (const b of state.buildings[p.id] ?? []) add(ledgers[p.owner]!, 'upkeep', -(e.buildings.find((d) => d.key === b)?.upkeep ?? 0));
  }
  state.realms.forEach((r, id) => {
    if (!r || !provinces[id]) return;
    const l = ledgers[id]!;
    const levy = realmRates(state, content, id, index, cache)[2]!;
    // A poor realm keeps a smaller court and fewer officials: neither costs more than a share of what it raises.
    const gross = (l.land_tax ?? 0) + (l.urban_tax ?? 0) + (l.tithes ?? 0) + (l.trade ?? 0);
    add(l, 'court', -Math.min(e.court[r.rank], Math.trunc((gross * COURT_CAP) / 100)));
    add(l, 'administration', -Math.min(e.adminPerProvince * provinces[id]!, Math.trunc((gross * ADMIN_CAP) / 100)));
    add(l, 'retinue', -Math.trunc((Math.trunc((people[id]! * e.retinuePerThousand) / 1000) * levy) / 1000));
    const seats = state.courts?.[id]?.council.filter((c) => state.characters[c]?.died === null).length ?? 0;
    add(l, 'council', -seats * content.characters.salary);
  });
  for (const loan of state.loans) if (ledgers[loan.realm]) add(ledgers[loan.realm]!, 'interest', -Math.trunc((loan.principal * loan.rate) / 120000));
  state.economy.forEach((ec, id) => {
    if (ec && ec.treasury > 0 && ledgers[id]) add(ledgers[id]!, 'largesse', -Math.trunc((ec.treasury * e.largesse) / 10000));
  });
  // Dues on what the vassal raised, before its own spending.
  state.realms.forEach((r, id) => {
    if (!r?.overlord || !ledgers[r.overlord]) return;
    const l = ledgers[id]!;
    const gross = (l.land_tax ?? 0) + (l.urban_tax ?? 0) + (l.tithes ?? 0) + (l.trade ?? 0);
    const dues = Math.trunc((gross * e.vassalDues) / 10000);
    add(l, 'dues_to_overlord', -dues);
    add(ledgers[r.overlord]!, 'vassal_dues', dues);
  });
  return ledgers;
}

export const ledgerNet = sum;
export const ledgerIncome = (l: Ledger) => LEDGER.filter((c) => c.kind === 'income').reduce((a, c) => a + (l[c.key] ?? 0), 0);

/** Fills the treasuries at the start of a game: some months of net income each. */
export function startEconomy(state: GameState, ctx: EconomyContext): void {
  const ledgers = computeLedgers(state, ctx);
  state.economy.forEach((ec, id) => {
    if (ec) ec.treasury = Math.max(0, sum(ledgers[id] ?? {})) * ctx.content.economy.startTreasuryMonths + 10000;
  });
}

/** Gives realms added since the game started (the map editor) an empty treasury. */
export function ensureEconomy(state: GameState): void {
  while (state.economy.length < state.realms.length) {
    state.economy.push({ treasury: 0, taxLaw: 'normal', lawChanged: -100000, defaults: [], ledger: {}, oneOff: {} });
  }
}

/** Month start: settles every ledger, takes due loans, marks empty treasuries and grows the people. */
export function settleMonth(state: GameState, ctx: EconomyContext): Notice[] {
  ensureEconomy(state);
  const notices: Notice[] = [];
  const ledgers = computeLedgers(state, ctx);
  state.economy.forEach((ec, id) => {
    if (!ec) return;
    const l = ledgers[id] ?? {};
    ec.treasury += sum(l);
    ec.ledger = { ...l, ...ec.oneOff };
    ec.oneOff = {};
  });
  for (const loan of [...state.loans]) if (loan.due <= state.day) {
    const ec = state.economy[loan.realm];
    if (ec && ec.treasury >= loan.principal) {
      repay(state, ctx, loan);
      notices.push({ realm: loan.realm, text: `Repaid ${ducats(loan.principal)} ducats to ${ctx.content.economy.banks[loan.bank]?.name ?? 'a lender'}.` });
    } else {
      notices.push(...defaultLoan(state, ctx, loan));
    }
  }
  state.economy.forEach((ec, id) => {
    if (ec && ec.treasury < 0 && state.realms[id]) addModifier(state, ctx.content, 'empty_treasury', { kind: 'realm', id });
  });
  growPeople(state, ctx);
  return notices;
}

function growPeople(state: GameState, ctx: EconomyContext): void {
  const { content } = ctx;
  const g = content.economy.growth;
  if (!g || !content.stats.unrest) return;
  const index = indexModifiers(state.modifiers);
  for (const p of state.provinces) {
    if (!p.owner) continue;
    const unrest = Math.min(4000, statValue(state, content, 'unrest', { kind: 'province', id: p.id }, index));
    for (let i = 0; i < S; i++) {
      const k = p.id * S + i;
      const n = state.pops[k] ?? 0;
      if (n > 0) state.pops[k] = Math.max(0, n + Math.trunc((n * g * (2000 - unrest)) / 20000000));
    }
  }
}

// ---------- Credit and loans

export interface CreditRating {
  value: number;
  lines: { label: string; value: number }[];
  /** Yearly gross income and debt, hundredths. */
  grossYear: number;
  debt: number;
}

export function realmDebt(state: GameState, realm: number): number {
  return state.loans.filter((l) => l.realm === realm).reduce((a, l) => a + l.principal, 0);
}

export function creditRating(state: GameState, ctx: EconomyContext, realm: number, ledgers = computeLedgers(state, ctx)): CreditRating {
  const c = ctx.content.economy.credit;
  const l = ledgers[realm] ?? {};
  const grossYear = ledgerIncome(l) * 12;
  const netYear = sum(l) * 12;
  const debt = realmDebt(state, realm);
  const income = Math.max(-c.incomeCap, Math.min(c.incomeCap, Math.trunc(netYear / c.incomePerPoint)));
  const debtPenalty = Math.trunc((c.debtRatioPenalty * debt) / Math.max(1, grossYear));
  const recent = (state.economy[realm]?.defaults ?? []).filter((d) => state.day - d < c.defaultMemoryDays).length;
  const lines = [
    { label: 'Standing of any crown', value: c.base },
    { label: 'Yearly surplus', value: income },
    { label: 'Debts against income', value: -debtPenalty },
    { label: 'Recent defaults', value: -recent * c.defaultPenalty },
  ].filter((x, i) => i === 0 || x.value !== 0);
  const value = Math.max(0, Math.min(100, lines.reduce((a, x) => a + x.value, 0)));
  return { value, lines, grossYear, debt };
}

export interface LoanOffer {
  bank: number;
  /** Hundredths of a ducat; 0 when it will not lend. */
  max: number;
  /** Yearly interest, hundredths of a percent. */
  rate: number;
  /** Why it will not lend, if it will not. */
  refusal: string | null;
}

export function loanOffers(state: GameState, ctx: EconomyContext, realm: number, ledgers = computeLedgers(state, ctx)): LoanOffer[] {
  const e = ctx.content.economy;
  const credit = creditRating(state, ctx, realm, ledgers);
  const limit = Math.max(0, Math.trunc((credit.value * credit.grossYear) / 50) - credit.debt);
  return e.banks.map((b, i) => {
    const bs = state.banks[i]!;
    const rate = b.rate + Math.trunc(((100 - credit.value) * 100) / e.credit.rateSpread);
    const refusal = bs.collapsed ? 'The house has failed.'
      : bs.refused.includes(realm) ? 'You defaulted on this house.'
      : credit.value < 100 - b.risk ? 'Your credit is too poor for this house.'
      : null;
    return { bank: i, max: refusal ? 0 : Math.min(bs.capital, limit), rate, refusal };
  });
}

/** Borrows from a bank on its current offer. Returns false if it will not lend that much. */
export function takeLoan(state: GameState, ctx: EconomyContext, realm: number, bank: number, amount: number, months: number, pledge: number): boolean {
  const ec = state.economy[realm];
  const offer = loanOffers(state, ctx, realm)[bank];
  if (!ec || !offer || offer.refusal || amount <= 0 || amount > offer.max) return false;
  if (!ctx.content.economy.credit.terms.includes(months)) return false;
  if (pledge && state.provinces[pledge]?.owner !== realm) return false;
  const loan: Loan = { id: state.nextLoanId++, bank, realm, principal: amount, rate: offer.rate - (pledge ? 200 : 0), start: state.day, due: state.day + Math.round(months * 30.44), pledge };
  state.loans.push(loan);
  state.banks[bank]!.capital -= amount;
  ec.treasury += amount;
  add(ec.oneOff, 'loans_taken', amount);
  if (pledge) addModifier(state, ctx.content, 'revenues_pledged', { kind: 'province', id: pledge });
  return true;
}

function repay(state: GameState, ctx: EconomyContext, loan: Loan): void {
  const ec = state.economy[loan.realm]!;
  ec.treasury -= loan.principal;
  add(ec.oneOff, 'loans_repaid', -loan.principal);
  state.banks[loan.bank]!.capital += loan.principal;
  state.loans = state.loans.filter((l) => l.id !== loan.id);
  if (loan.pledge) removeModifiers(state, 'revenues_pledged', { kind: 'province', id: loan.pledge });
}

/** Pays a loan back early, if the treasury holds enough. */
export function repayLoan(state: GameState, ctx: EconomyContext, realm: number, loanId: number): boolean {
  const loan = state.loans.find((l) => l.id === loanId && l.realm === realm);
  if (!loan || (state.economy[realm]?.treasury ?? 0) < loan.principal) return false;
  repay(state, ctx, loan);
  return true;
}

/**
 * A loan goes unpaid: the realm's credit and legitimacy suffer, the house refuses it, a pledged province's revenues
 * are seized, and a house that loses too much fails.
 */
export function defaultLoan(state: GameState, ctx: EconomyContext, loan: Loan): Notice[] {
  const { content } = ctx;
  const notices: Notice[] = [];
  const bank = content.economy.banks[loan.bank];
  const bs = state.banks[loan.bank]!;
  state.loans = state.loans.filter((l) => l.id !== loan.id);
  state.economy[loan.realm]?.defaults.push(state.day);
  if (!bs.refused.includes(loan.realm)) bs.refused.push(loan.realm);
  bs.losses += loan.principal;
  addModifier(state, content, 'defaulted', { kind: 'realm', id: loan.realm });
  notices.push({ realm: loan.realm, text: `${state.realms[loan.realm]?.name ?? 'A realm'} defaulted on ${ducats(loan.principal)} ducats owed to ${bank?.name ?? 'a lender'}.` });
  if (loan.pledge) {
    removeModifiers(state, 'revenues_pledged', { kind: 'province', id: loan.pledge });
    if (state.provinces[loan.pledge]?.owner === loan.realm) addModifier(state, content, 'revenues_seized', { kind: 'province', id: loan.pledge });
  }
  if (bank && !bs.collapsed && !bank.local && bs.losses * 100 >= bank.capital * 40) {
    bs.collapsed = true;
    notices.push({ realm: 0, text: `${bank.name} has failed, ruined by unpaid loans.` });
  }
  return notices;
}

/** Refuses every debt at once. */
export function repudiate(state: GameState, ctx: EconomyContext, realm: number): Notice[] {
  return state.loans.filter((l) => l.realm === realm).flatMap((l) => defaultLoan(state, ctx, l));
}

// ---------- Laws and buildings

export function setTaxLaw(state: GameState, ctx: EconomyContext, realm: number, law: string): boolean {
  const e = ctx.content.economy;
  const ec = state.economy[realm];
  const next = e.taxLaws.find((l) => l.key === law);
  if (!ec || !next || ec.taxLaw === law || state.day - ec.lawChanged < e.lawCooldownDays) return false;
  const prev = e.taxLaws.find((l) => l.key === ec.taxLaw);
  if (prev?.modifier) removeModifiers(state, prev.modifier, { kind: 'realm', id: realm });
  if (next.modifier) addModifier(state, ctx.content, next.modifier, { kind: 'realm', id: realm });
  ec.taxLaw = law;
  ec.lawChanged = state.day;
  return true;
}

/** Why a realm cannot build this here now, or null if it can. */
export function cannotBuild(state: GameState, ctx: EconomyContext, realm: number, province: number, building: string): string | null {
  const def = ctx.content.economy.buildings.find((b) => b.key === building);
  if (!def) return 'Unknown building.';
  const p = state.provinces[province];
  if (!p || p.owner !== realm) return 'You do not hold this province.';
  if (p.controller !== realm) return 'The province is occupied.';
  if ((state.buildings[province] ?? []).includes(building)) return 'Already built.';
  if (state.construction.some((c) => c.province === province && c.building === building)) return 'Already being built.';
  if ((state.economy[realm]?.treasury ?? 0) < def.cost) return 'Not enough in the treasury.';
  return null;
}

export function startBuilding(state: GameState, ctx: EconomyContext, realm: number, province: number, building: string): boolean {
  if (cannotBuild(state, ctx, realm, province, building)) return false;
  const def = ctx.content.economy.buildings.find((b) => b.key === building)!;
  const ec = state.economy[realm]!;
  ec.treasury -= def.cost;
  add(ec.oneOff, 'construction', -def.cost);
  state.construction.push({ province, building, realm, done: state.day + def.days });
  return true;
}

/** Daily: finishes buildings whose time has come (if the builder still holds the province). */
export function finishBuildings(state: GameState, ctx: EconomyContext): { changed: boolean; notices: Notice[] } {
  const notices: Notice[] = [];
  let changed = false;
  for (const c of state.construction.filter((x) => x.done <= state.day)) {
    const def = ctx.content.economy.buildings.find((b) => b.key === c.building);
    if (def && state.provinces[c.province]?.owner === c.realm) {
      (state.buildings[c.province] ??= []).push(c.building);
      addModifier(state, ctx.content, def.modifier, { kind: 'province', id: c.province });
      changed = true;
      notices.push({ realm: c.realm, text: `${def.name} finished.` });
    }
  }
  if (state.construction.some((x) => x.done <= state.day)) state.construction = state.construction.filter((x) => x.done > state.day);
  return { changed, notices };
}

