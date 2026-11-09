import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { emptyCharacters, emptyFaith, emptyMilitary, emptyWar, type Content, type ModifierDef, type StatDef } from '../src/sim/content';
import {
  computeLedgers, creditRating, ledgerNet, loanOffers, provinceEconomy, settleMonth, startEconomy, takeLoan,
  type EconomyContext,
} from '../src/sim/economy';
import { hashState } from '../src/sim/hash';
import { hasModifier } from '../src/sim/modifiers';
import { deserialize, serialize } from '../src/sim/save';
import type { Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';

const stat = (key: string, scope: 'province' | 'realm', base: number, max = 10000): StatDef =>
  ({ key, scope, label: key, description: '', base, min: 0, max, format: 'number' });
const mod = (key: string, effects: ModifierDef['effects'], days: number | null = null): ModifierDef =>
  ({ key, label: key, description: '', stacking: 'replace', days, effects });

// Fixed-point hundredths: tax_rate 2000 = 20%, a ducat is 100.
const content: Content = {
  stats: Object.fromEntries([
    stat('development', 'province', 500), stat('tax_efficiency', 'province', 5000), stat('trade_efficiency', 'province', 3000),
    stat('production', 'province', 10000, 30000), stat('unrest', 'province', 0), stat('tax_rate', 'realm', 2000),
    stat('tithe_share', 'realm', 1000), stat('levy_size', 'realm', 1000), stat('legitimacy', 'realm', 6000),
  ].map((s) => [s.key, s])),
  modifiers: Object.fromEntries([
    mod('tax_law_high', [{ stat: 'tax_rate', op: 'add', value: 1000 }]),
    mod('building_market', [{ stat: 'trade_efficiency', op: 'add', value: 1500 }]),
    mod('defaulted', [{ stat: 'legitimacy', op: 'add', value: -1500 }], 3650),
    mod('revenues_seized', [{ stat: 'tax_efficiency', op: 'add', value: -5000 }], 1825),
    mod('revenues_pledged', [{ stat: 'tax_efficiency', op: 'add', value: -500 }]),
    mod('empty_treasury', [{ stat: 'legitimacy', op: 'add', value: -500 }], 31),
  ].map((m) => [m.key, m])),
  cultures: [], religions: [],
  titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] },
  goods: [{ key: 'grain', name: 'Grain', price: 200, color: '#ffff00' }],
  economy: {
    wealthPerHead: [80, 400, 0, 0, 30], devBase: 60, devPerPoint: 4, tithe: 1000, tradePerThousand: 50, vassalDues: 1500,
    court: { empire: 40000, kingdom: 20000, duchy: 6000, county: 1500 }, adminPerProvince: 400, retinuePerThousand: 60,
    growth: 8, startTreasuryMonths: 6, largesse: 200,
    taxLaws: [
      { key: 'low', name: 'Low', description: '', modifier: null },
      { key: 'normal', name: 'Normal', description: '', modifier: null },
      { key: 'high', name: 'High', description: '', modifier: 'tax_law_high' },
    ],
    lawCooldownDays: 365,
    buildings: [{ key: 'market', name: 'Market', description: '', cost: 25000, days: 10, upkeep: 100, modifier: 'building_market' }],
    banks: [
      { key: 'bardi', name: 'Bardi', seat: 0, capital: 100000, rate: 700, risk: 55, local: false },
      { key: 'local', name: 'Moneylenders', seat: 0, capital: 6000000, rate: 2500, risk: 100, local: true },
    ],
    credit: { base: 55, incomePerPoint: 200000, incomeCap: 25, debtRatioPenalty: 30, defaultPenalty: 35, defaultMemoryDays: 7300, rateSpread: 5, terms: [12, 24] },
  },
  characters: emptyCharacters(), faith: emptyFaith(), military: emptyMilitary(), war: emptyWar(),
};

/** Realm 1 (a kingdom) holds provinces 1 and 2; realm 2, its vassal, holds province 3. All make grain. */
const pops = (peasants: number, burghers: number, nobles: number, clergy: number, nomads = 0) => [peasants, burghers, nobles, clergy, nomads];
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'b', name: 'B', rank: 'duchy', government: 'feudal_monarchy', color: '#0000ff', capital: 3, overlord: 1, scripted: false },
  ],
  owner: [0, 1, 1, 2],
  controller: [0, 1, 1, 2],
  pops: [...pops(0, 0, 0, 0), ...pops(24000, 2000, 400, 500), ...pops(10000, 0, 150, 200), ...pops(8000, 1000, 100, 100)],
  development: [0, 8, 5, 6],
  good: [0, 1, 1, 1],
};
const ctx: EconomyContext = { content, goods: scenario.good! };

function game() {
  const s = newGame(1314, scenario, content.economy.banks.map((b) => b.capital));
  startEconomy(s, ctx);
  return s;
}

describe('provinceEconomy', () => {
  it('turns people into wealth, taxes, the crown tithe and trade, all truncated', () => {
    const e = provinceEconomy(game(), ctx, 1);
    expect(e.people).toBe(26900);
    // factor 60 + 4 × 8 = 92; land 24000 × 0.008 = 192 ducats × 0.92; towns 2000 × 0.04 = 80 × 0.92.
    expect([e.wealthLand, e.wealthUrban]).toEqual([17664, 7360]);
    // 20% tax × 50% efficiency.
    expect([e.landTax, e.urbanTax]).toEqual([1766, 736]);
    // 10% tithe, 10% of it to the crown.
    expect(e.tithe).toBe(250);
    // 2 ducats × 26.9 thousand × 0.5, 30% collected.
    expect([e.tradeValue, e.trade]).toEqual([2690, 807]);
  });

  it('pays the owner nothing while occupied', () => {
    const s = game();
    s.provinces[2]!.controller = 2;
    expect(provinceEconomy(s, ctx, 2).paying).toBe(false);
    expect(computeLedgers(s, ctx)[1]!.land_tax).toBe(provinceEconomy(s, ctx, 1).landTax);
  });
});

describe('settlement', () => {
  it('fills the start treasury and settles the projected ledger on the 1st of the month', () => {
    const s = game();
    const before = s.economy[1]!.treasury;
    expect(before).toBeGreaterThan(10000);
    const projected = computeLedgers(s, ctx)[1]!;
    for (let i = 0; i < 30; i++) tick(s, ctx); // 1 November → 1 December
    expect(s.economy[1]!.treasury - before).toBe(ledgerNet(projected));
    expect(s.economy[1]!.ledger).toEqual(projected);
  });

  it('sends a vassal\'s dues to its overlord', () => {
    const l = computeLedgers(game(), ctx);
    expect(l[2]!.dues_to_overlord).toBeLessThan(0);
    expect(l[1]!.vassal_dues).toBe(-l[2]!.dues_to_overlord!);
  });

  it('is the same run after run', () => {
    const run = () => { const s = game(); for (let i = 0; i < 400; i++) tick(s, ctx); return hashState(s); };
    expect(run()).toBe(run());
  });

  it('grows the people', () => {
    const s = game();
    for (let i = 0; i < 400; i++) tick(s, ctx);
    expect(s.pops[5]).toBeGreaterThan(24000);
  });
});

describe('loans', () => {
  it('lends no more than the offer, charges interest and repays when due', () => {
    const s = game();
    const offer = loanOffers(s, ctx, 1)[0]!;
    expect(offer.refusal).toBeNull();
    expect(takeLoan(s, ctx, 1, 0, offer.max + 1, 12, 0)).toBe(false);
    expect(takeLoan(s, ctx, 1, 0, 50000, 12, 0)).toBe(true);
    expect(computeLedgers(s, ctx)[1]!.interest).toBe(-Math.trunc((50000 * s.loans[0]!.rate) / 120000));
    expect(creditRating(s, ctx, 1).debt).toBe(50000);
    s.loans[0]!.due = s.day;
    settleMonth(s, ctx);
    expect(s.loans).toEqual([]);
    expect(s.banks[0]!.capital).toBe(100000);
  });

  it('defaults when the treasury cannot pay: credit, legitimacy, the pledge and the bank all suffer', () => {
    const s = game();
    expect(takeLoan(s, ctx, 1, 0, 50000, 12, 2)).toBe(true);
    expect(hasModifier(s, 'revenues_pledged', { kind: 'province', id: 2 })).toBe(true);
    s.economy[1]!.treasury = 0;
    s.loans[0]!.due = s.day;
    const notices = settleMonth(s, ctx);
    expect(s.loans).toEqual([]);
    expect(hasModifier(s, 'defaulted', { kind: 'realm', id: 1 })).toBe(true);
    expect(hasModifier(s, 'revenues_seized', { kind: 'province', id: 2 })).toBe(true);
    expect(hasModifier(s, 'revenues_pledged', { kind: 'province', id: 2 })).toBe(false);
    expect(s.banks[0]!.refused).toContain(1);
    expect(loanOffers(s, ctx, 1)[1]!.refusal).toBeNull(); // the moneylenders still lend
    expect(creditRating(s, ctx, 1).lines.some((l) => l.label === 'Recent defaults')).toBe(true);
    // Half its capital lost: the house fails.
    expect(s.banks[0]!.collapsed).toBe(true);
    expect(notices.map((n) => n.text).join(' ')).toMatch(/failed/);
  });

  it('repudiating defaults on every loan', () => {
    const s = game();
    takeLoan(s, ctx, 1, 1, 30000, 24, 0);
    const notices: never[] = [];
    expect(applyCommand(s, { type: 'repudiate', realm: 1 }, content, ctx.goods, notices)).toBe(true);
    expect(s.loans).toEqual([]);
    expect(s.economy[1]!.defaults).toEqual([s.day]);
  });
});

describe('laws and buildings', () => {
  it('changes the tax law once a year, through a modifier', () => {
    const s = game();
    const base = computeLedgers(s, ctx)[1]!.land_tax!;
    expect(applyCommand(s, { type: 'setTaxLaw', realm: 1, law: 'high' }, content, ctx.goods)).toBe(true);
    expect(computeLedgers(s, ctx)[1]!.land_tax).toBeGreaterThan(base);
    expect(applyCommand(s, { type: 'setTaxLaw', realm: 1, law: 'normal' }, content, ctx.goods)).toBe(false);
    s.day += 365;
    expect(applyCommand(s, { type: 'setTaxLaw', realm: 1, law: 'normal' }, content, ctx.goods)).toBe(true);
    expect(hasModifier(s, 'tax_law_high', { kind: 'realm', id: 1 })).toBe(false);
  });

  it('builds: pays up front, finishes after its days, then raises trade and costs upkeep', () => {
    const s = game();
    const treasury = (s.economy[1]!.treasury = 100000);
    applyCommand(s, { type: 'build', realm: 1, province: 1, building: 'market' }, content, ctx.goods);
    expect(s.economy[1]!.treasury).toBe(treasury - 25000);
    expect(s.economy[1]!.oneOff.construction).toBe(-25000);
    applyCommand(s, { type: 'build', realm: 1, province: 3, building: 'market' }, content, ctx.goods); // not its province
    expect(s.construction).toHaveLength(1);
    const trade = provinceEconomy(s, ctx, 1).trade;
    for (let i = 0; i < 10; i++) tick(s, ctx);
    expect(s.buildings[1]).toEqual(['market']);
    expect(provinceEconomy(s, ctx, 1).trade).toBeGreaterThan(trade);
    expect(computeLedgers(s, ctx)[1]!.upkeep).toBe(-100);
  });
});

describe('saves', () => {
  it('round-trips the economy, and upgrades a version 3 save with fresh treasuries', () => {
    const s = game();
    takeLoan(s, ctx, 1, 0, 20000, 12, 0);
    const back = deserialize(serialize(s), { scenario, economy: ctx });
    expect(hashState(back)).toBe(hashState(s));
    const v3: Record<string, unknown> = { ...s, saveVersion: 3 };
    for (const k of ['player', 'pops', 'provinceBase', 'economy', 'banks', 'loans', 'nextLoanId', 'buildings', 'construction']) delete v3[k];
    const old = JSON.stringify({ format: 'interregnum-save', saveVersion: 3, state: v3 });
    const up = deserialize(old, { scenario, economy: ctx });
    expect(up.economy[1]!.treasury).toBe(game().economy[1]!.treasury);
    expect(up.pops).toEqual(scenario.pops);
  });
});
