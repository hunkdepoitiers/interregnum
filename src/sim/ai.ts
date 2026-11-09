import { allied, cannotDiplo, doDiplo, opinion, truceUntil } from './diplomacy';
import { cannotBuild, ledgerIncome, ledgerNet, loanOffers, repayLoan, setTaxLaw, startBuilding, takeLoan, type EconomyContext, type Notice } from './economy';
import { cannotDeed, doDeed } from './faith';
import { atWar, hireMenAtArms, levyPool, cannotHire, warsOf } from './military';
import { nextInt } from './rng';
import { bribe, bribeChance, bribeCost, hireEngineers } from './sieges';
import type { GameState, Ledger } from './state';
import { casusBelli, declareFor } from './war';

/**
 * The computer realms (DESIGN §5.10, M11): each month, every realm the player does not rule balances its books,
 * spends what it can spare, picks a war when it is strong and rich, courts its neighbours and presses its sieges.
 * Marching and peace are the war AI's (military.ts) and the leaders' (war.ts). Everything goes through the same
 * commands and odds a player has; nothing is free.
 */

/** Most of each kind of costly action the whole world takes in a month, to bound the work and the chaos. */
const MAX_LOANS = 4;
const MAX_DECLARATIONS = 3;
const MAX_TREATIES = 12;
/** Build in this order (the cheapest that pays first). */
const BUILD_ORDER = ['market', 'granary', 'church', 'workshop', 'mill', 'cathedral'];

interface World {
  owned: Map<number, number[]>;
  neighbours: Map<number, Set<number>>;
  pools: Map<number, number>;
  vassals: Map<number, number[]>;
  loans: number;
  declarations: number;
  treaties: number;
}

function survey(state: GameState, ctx: EconomyContext): World {
  const owned = new Map<number, number[]>();
  for (const p of state.provinces) if (p.owner) {
    const l = owned.get(p.owner);
    if (l) l.push(p.id); else owned.set(p.owner, [p.id]);
  }
  const neighbours = new Map<number, Set<number>>();
  const g = ctx.graph;
  if (g) for (const p of state.provinces) {
    if (!p.owner) continue;
    for (let i = g.start[p.id]!; i < g.start[p.id + 1]!; i++) {
      const o = state.provinces[g.to[i]!]?.owner ?? 0;
      if (o && o !== p.owner) {
        const s = neighbours.get(p.owner);
        if (s) s.add(o); else neighbours.set(p.owner, new Set([o]));
      }
    }
  }
  const vassals = new Map<number, number[]>();
  for (const r of state.realms) if (r?.overlord) vassals.set(r.overlord, [...(vassals.get(r.overlord) ?? []), r.id]);
  return { owned, neighbours, pools: new Map(), vassals, loans: 0, declarations: 0, treaties: 0 };
}

const fixed = (n: number) => n * 100;

function budget(state: GameState, ctx: EconomyContext, realm: number, w: World, ledgers: Ledger[], notices: Notice[]): void {
  const ec = state.economy[realm]!;
  const l = ledgers[realm] ?? {};
  const gross = ledgerIncome(l);
  const net = ledgerNet(l);
  const e = ctx.content.economy;
  const high = e.taxLaws.some((x) => x.key === 'high');
  // Taxes: squeeze when short, ease when comfortable.
  if (high && (ec.treasury < 0 || net < 0) && ec.taxLaw !== 'high') setTaxLaw(state, ctx, realm, 'high');
  else if (ec.taxLaw === 'high' && ec.treasury > gross * 8 && net > 0) setTaxLaw(state, ctx, realm, 'normal');
  // Debt: borrow the cheapest way out, within what the houses will lend.
  if (ec.treasury < 0 && w.loans < MAX_LOANS && !state.loans.some((x) => x.realm === realm)) {
    const offers = loanOffers(state, ctx, realm, ledgers).filter((o) => !o.refusal && o.max > 0).sort((a, b) => a.rate - b.rate);
    const offer = offers[0];
    if (offer) {
      const amount = Math.min(offer.max, -ec.treasury + gross * 2);
      const term = Math.max(...e.credit.terms);
      if (amount > 0 && takeLoan(state, ctx, realm, offer.bank, amount, term, 0)) w.loans++;
    }
  }
  // Repay when rich.
  for (const loan of state.loans.filter((x) => x.realm === realm)) {
    if (ec.treasury > loan.principal + gross * 6) repayLoan(state, ctx, realm, loan.id);
  }
  const reserve = gross * 3;
  const atWarNow = warsOf(state, realm).length > 0;
  const spare = ec.treasury - reserve;
  if (spare <= fixed(30)) return;
  // The faith: an excommunicated realm buys its way back; an impious one gives alms; a rich dull one holds a feast.
  const st = state.standing[realm];
  if (st) {
    const f = ctx.content.faith;
    if (f.deeds.absolution && !cannotDeed(state, ctx, realm, 'absolution')) doDeed(state, ctx, realm, 'absolution');
    else if (st.piety < 0 && !cannotDeed(state, ctx, realm, 'small_alms')) doDeed(state, ctx, realm, 'small_alms');
    else if (st.piety < 100 && spare > gross * 3 && !cannotDeed(state, ctx, realm, 'great_alms')) doDeed(state, ctx, realm, 'great_alms');
    else if (st.prestige < 150 && spare > gross * 4 && !atWarNow && !cannotDeed(state, ctx, realm, 'tournament')) doDeed(state, ctx, realm, 'tournament');
  }
  // War chest.
  if (atWarNow) {
    if (spare > gross * 2 && !cannotHire(state, ctx, realm, 1000)) hireMenAtArms(state, ctx, realm, 1000);
    return;
  }
  // Works: the best building in the most developed provinces.
  if (spare > gross * 2) {
    const mine = (w.owned.get(realm) ?? []).filter((p) => state.provinces[p]!.controller === realm);
    mine.sort((a, b) => (state.provinceBase.development?.[b] ?? 0) - (state.provinceBase.development?.[a] ?? 0) || a - b);
    for (const p of mine.slice(0, 8)) {
      const building = BUILD_ORDER.find((b) => !cannotBuild(state, ctx, realm, p, b) && (state.economy[realm]!.treasury - (e.buildings.find((d) => d.key === b)?.cost ?? 0)) > reserve);
      if (building) { startBuilding(state, ctx, realm, p, building); return; }
    }
  }
  void notices;
}

/** Pool of levies a side could raise: the realm, its vassals, and its overlord. */
function pool(state: GameState, ctx: EconomyContext, w: World, realm: number): number {
  let n = w.pools.get(realm);
  if (n === undefined) { n = levyPool(state, ctx, realm).total; w.pools.set(realm, n); }
  return n;
}

function weight(state: GameState, ctx: EconomyContext, w: World, realm: number): number {
  let n = pool(state, ctx, w, realm);
  for (const v of w.vassals.get(realm) ?? []) n += pool(state, ctx, w, v);
  const lord = state.realms[realm]?.overlord ?? 0;
  if (lord) n += pool(state, ctx, w, lord);
  return n;
}

function pickWar(state: GameState, ctx: EconomyContext, realm: number, w: World, notices: Notice[]): void {
  if (w.declarations >= MAX_DECLARATIONS || !ctx.graph) return;
  const r = state.realms[realm]!;
  const ec = state.economy[realm]!;
  const ruler = state.characters[state.courts[realm]?.ruler ?? 0];
  const peaceful = r.government === 'merchant_republic' || r.government === 'theocracy';
  const chance = Math.max(1, Math.min(8, (peaceful ? 1 : 2) + Math.trunc(((ruler?.skills[2] ?? 10) - 10) / 3) + (ruler?.traits.includes('brave') || ruler?.traits.includes('wroth') ? 2 : 0) + (ruler?.traits.includes('craven') ? -1 : 0)));
  // A realm that has just made peace rests: any truce it is bound by holds it back.
  if (state.truces.some((t) => (t.a === realm || t.b === realm) && t.until > state.day)) return;
  if (nextInt(state.rng, 1000) >= chance * 3) return;
  const mine = pool(state, ctx, w, realm);
  if (mine < 500 || ec.treasury < 20000) return;
  const myWeight = weight(state, ctx, w, realm);
  let best = 0;
  let bestScore = 0;
  for (const c of [...(w.neighbours.get(realm) ?? [])].sort((a, b) => a - b)) {
    const t = state.realms[c];
    if (!t || t.scripted || t.overlord === realm || r.overlord === c || allied(state, realm, c) || truceUntil(state, realm, c)) continue;
    const theirs = Math.max(1, weight(state, ctx, w, c));
    const ratio = (myWeight * 100) / theirs;
    if (ratio < 160) continue;
    const score = ratio + nextInt(state.rng, 60);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return;
  const options = casusBelli(state, ctx, realm, best).filter((c) => !c.why);
  const st = state.standing[realm];
  const choice = options.find((c) => c.key === 'claim') ?? options.find((c) => c.key === 'holy_war') ?? options.find((c) => c.key === 'raid')
    ?? options.find((c) => c.key === 'independence') ?? options.find((c) => c.key === 'conquest' && (st?.prestige ?? 0) > 150);
  if (!choice) return;
  const war = declareFor(state, ctx, realm, best, choice.key, notices);
  if (war) {
    w.declarations++;
    notices.push({ realm: best, text: `${r.name} has declared war on ${state.realms[best]!.name} (${choice.name.toLowerCase()}).` });
  }
}

function court(state: GameState, ctx: EconomyContext, realm: number, w: World, notices: Notice[]): void {
  if (w.treaties >= MAX_TREATIES) return;
  const near = [...(w.neighbours.get(realm) ?? [])].filter((c) => c !== state.player && !state.realms[c]?.scripted).sort((a, b) => a - b);
  if (!near.length) return;
  const pick = near[nextInt(state.rng, near.length)]!;
  const roll = nextInt(state.rng, 100);
  const act = (action: Parameters<typeof doDiplo>[4]) => { if (!cannotDiplo(state, ctx, realm, pick, action)) { notices.push(...doDiplo(state, ctx, realm, pick, action).filter((n) => n.realm === state.player)); w.treaties++; } };
  const lords = state.realms[realm]?.overlord ?? 0;
  if (lords) return;
  const pacts = (r: number) => state.alliances.filter((x) => x.a === r || x.b === r).length;
  if (roll < 8) { if (pacts(realm) < 2 && pacts(pick) < 3) act('alliance'); }
  else if (roll < 12) act('marriage');
  else if (roll < 18 && opinion(state, ctx, pick, realm).value < ctx.content.diplomacy.alliance.minOpinion && (state.economy[realm]?.treasury ?? 0) > 100000) act('gift');
  else if (roll < 20) act('tribute');
}

/** Besieging computer realms hire engineers and buy gates when the odds and the purse allow. */
function sieges(state: GameState, ctx: EconomyContext): void {
  const w = ctx.content.war;
  for (const s of state.sieges) {
    if (s.realm === state.player) continue;
    const ec = state.economy[s.realm];
    const fort = state.forts[s.province];
    if (!ec || !fort) continue;
    if (s.engineers < 2 && ec.treasury > w.siege.engineerCost * 8) hireEngineers(state, ctx, s.realm, s.province);
    const controller = state.provinces[s.province]!.controller;
    const tier = w.bribe.chances.length - 1;
    if (state.day >= s.nextBribe && bribeChance(state, w, s, fort, tier, controller) >= 3500 && bribeCost(w, fort, tier) * 6 < ec.treasury) bribe(state, ctx, s.realm, s.province, tier, []);
  }
}

/** Month start, after the accounts are settled. */
export function monthlyAi(state: GameState, ctx: EconomyContext): Notice[] {
  const notices: Notice[] = [];
  // The month was just settled: its ledgers are each realm's own record, no need to work them out again.
  const ledgers = state.economy.map((e) => e?.ledger ?? {});
  const w = survey(state, ctx);
  for (let realm = 1; realm < state.realms.length; realm++) {
    const r = state.realms[realm];
    if (!r || realm === state.player || r.scripted || !w.owned.has(realm) || !state.economy[realm]) continue;
    budget(state, ctx, realm, w, ledgers, notices);
    if (!atWar(state, realm, 0) && warsOf(state, realm).length === 0) {
      if (!r.overlord && (state.economy[realm]!.treasury > 0)) pickWar(state, ctx, realm, w, notices);
      court(state, ctx, realm, w, notices);
    }
  }
  sieges(state, ctx);
  return notices;
}
