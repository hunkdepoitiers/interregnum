import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { emptyCharacters, emptyDiplomacy, emptyMilitary, emptyWar, type Content, type FaithDef, type ModifierDef, type StatDef } from '../src/sim/content';
import { creditRating, defaultLoan, finishBuildings, startBuilding, startEconomy, takeLoan, type EconomyContext } from '../src/sim/economy';
import { cannotDeed, doDeed, monthlyFaith, startFaith } from '../src/sim/faith';
import { hashState } from '../src/sim/hash';
import { explain, hasModifier } from '../src/sim/modifiers';
import { deserialize, serialize } from '../src/sim/save';
import type { Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';

const stat = (key: string, scope: 'province' | 'realm', base: number): StatDef =>
  ({ key, scope, label: key, description: '', base, min: 0, max: 10000, format: 'number' });
const mod = (key: string, effects: ModifierDef['effects'], days: number | null = null): ModifierDef =>
  ({ key, label: key, description: '', stacking: 'replace', days, effects });
const deed = (key: string, o: Partial<FaithDef['deeds'][string]>): FaithDef['deeds'][string] =>
  ({ key, name: key, description: '', cost: 0, costMonths: 0, minCost: 0, incomeMonths: 0, prestige: 0, piety: 0, cooldown: 0, days: 0, modifier: null, ...o });

const faith: FaithDef = {
  prestigeTiers: [
    { min: -100000, name: 'Disgraced', modifier: 'prestige_low' },
    { min: 0, name: 'Known', modifier: null },
    { min: 320, name: 'Renowned', modifier: 'prestige_high' },
  ],
  pietyTiers: [{ min: -100000, modifier: 'piety_low' }, { min: 0, modifier: null }, { min: 300, modifier: 'piety_high' }],
  pietyNames: { christian: ['Sinful', 'Faithful', 'Saintly'] },
  start: { prestige: { empire: 600, kingdom: 300, duchy: 100, county: 40 }, piety: 50, pietyGovernment: { theocracy: 400 }, piousTrait: 100 },
  holySitePiety: 2,
  faiths: [{ head: 2, holySites: [{ name: 'Shrine', province: 2 }, { name: 'Rome', province: 3 }] }],
  deeds: {
    small_alms: deed('small_alms', { cost: 10000, piety: 5, cooldown: 30 }),
    great_alms: deed('great_alms', { costMonths: 1, minCost: 30000, piety: 30, cooldown: 365 }),
    tournament: deed('tournament', { costMonths: 1, minCost: 40000, prestige: 40, cooldown: 1095, modifier: 'tournament' }),
    pilgrimage: deed('pilgrimage', { cost: 40000, piety: 60, prestige: 15, days: 90, modifier: 'on_pilgrimage' }),
    seize_church_lands: deed('seize_church_lands', { incomeMonths: 4, piety: -120, cooldown: 1825 }),
    absolution: deed('absolution', { costMonths: 3, minCost: 50000, piety: 10 }),
  },
  pilgrimageRisk: 0,
  events: { default: { prestige: -60, piety: 0 }, emptyTreasury: { prestige: -5, piety: 0 }, dynastyChangeKeep: 40 },
  excommunication: { religion: 1, below: 0, chance: 10000, prestige: -40, modifier: 'excommunicated', vacancy: 'papal_vacancy' },
  buildings: { church: { prestige: 0, piety: 15 } },
};

const content: Content = {
  stats: Object.fromEntries([
    stat('development', 'province', 500), stat('tax_efficiency', 'province', 5000), stat('trade_efficiency', 'province', 3000),
    stat('production', 'province', 10000), stat('unrest', 'province', 0), stat('tax_rate', 'realm', 2000),
    stat('tithe_share', 'realm', 1000), stat('levy_size', 'realm', 1000), stat('legitimacy', 'realm', 6000),
  ].map((s) => [s.key, s])),
  modifiers: Object.fromEntries([
    mod('prestige_low', [{ stat: 'legitimacy', op: 'add', value: -1500 }]),
    mod('prestige_high', [{ stat: 'legitimacy', op: 'add', value: 1000 }]),
    mod('piety_low', [{ stat: 'legitimacy', op: 'add', value: -1000 }]),
    mod('piety_high', [{ stat: 'legitimacy', op: 'add', value: 500 }]),
    mod('tournament', [{ stat: 'legitimacy', op: 'add', value: 500 }], 730),
    mod('on_pilgrimage', [{ stat: 'tax_efficiency', op: 'add', value: -500 }]),
    mod('excommunicated', [{ stat: 'tithe_share', op: 'pct', value: -10000 }, { stat: 'legitimacy', op: 'add', value: -2000 }]),
    mod('papal_vacancy', [{ stat: 'legitimacy', op: 'add', value: -2000 }], 60),
    mod('defaulted', [{ stat: 'legitimacy', op: 'add', value: -1500 }], 3650),
    mod('empty_treasury', [{ stat: 'legitimacy', op: 'add', value: -500 }], 31),
    mod('building_church', [{ stat: 'unrest', op: 'add', value: -200 }]),
  ].map((m) => [m.key, m])),
  cultures: [], religions: [{ key: 'catholic', name: 'Catholic', family: 'christian', color: '#fff' }],
  titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] },
  goods: [],
  economy: {
    wealthPerHead: [80, 400, 0, 0, 0], devBase: 60, devPerPoint: 4, tithe: 1000, tradePerThousand: 0, vassalDues: 0,
    court: { empire: 0, kingdom: 0, duchy: 0, county: 0 }, adminPerProvince: 0, retinuePerThousand: 0,
    growth: 0, startTreasuryMonths: 6, largesse: 0,
    taxLaws: [{ key: 'normal', name: 'Normal', description: '', modifier: null }],
    lawCooldownDays: 365,
    buildings: [{ key: 'church', name: 'Church', description: '', cost: 20000, days: 10, upkeep: 0, modifier: 'building_church' }],
    banks: [{ key: 'local', name: 'Moneylenders', seat: 0, capital: 6000000, rate: 2500, risk: 100, local: true }],
    credit: { base: 55, incomePerPoint: 200000, incomeCap: 25, debtRatioPenalty: 30, defaultPenalty: 35, defaultMemoryDays: 7300, rateSpread: 5, terms: [12] },
  },
  characters: emptyCharacters(), faith, military: emptyMilitary(), war: emptyWar(), diplomacy: emptyDiplomacy(),
};

/** Realm 1, a Catholic kingdom, holds provinces 1 and 2 (a shrine); realm 2, the Papacy, holds Rome (3). */
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'k', name: 'Kingdom', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'p', name: 'Papacy', rank: 'duchy', government: 'theocracy', color: '#ffffff', capital: 3, overlord: 0, scripted: false },
  ],
  owner: [0, 1, 1, 2],
  controller: [0, 1, 1, 2],
  pops: [0, 0, 0, 0, 0, 24000, 2000, 400, 500, 0, 10000, 0, 150, 200, 0, 8000, 1000, 100, 100, 0],
  development: [0, 8, 5, 6],
  good: [0, 0, 0, 0],
  characters: [{ id: 1, name: 'King', dynasty: 1, female: false, born: -40 * 365, died: null, father: 0, mother: 0, spouse: 0, culture: 0, religion: 1, skills: [10, 10, 10], education: null, traits: [], health: 100 }],
  dynasties: [{ id: 1, name: 'Royal' }],
  courts: [{ ruler: 1, regent: 0, law: 'cognatic', council: [], claimant: 0, since: 0 }, null],
};
const ctx: EconomyContext = { content, goods: scenario.good!, religion: [0, 1, 1, 1] };

function game() {
  const s = newGame(9, scenario, content.economy.banks.map((b) => b.capital));
  startEconomy(s, ctx);
  startFaith(s, ctx);
  s.economy[1]!.treasury = 1000000;
  s.economy[1]!.ledger = { land_tax: 50000 }; // a month's gross income of 500 ducats, for deed prices
  return s;
}
const realm = (id: number) => ({ kind: 'realm' as const, id });

describe('starting standing', () => {
  it('sets prestige by rank and piety by government, and puts the tier modifiers on', () => {
    const s = game();
    expect([s.standing[1]!.prestige, s.standing[1]!.piety]).toEqual([300, 50]);
    expect([s.standing[2]!.prestige, s.standing[2]!.piety]).toEqual([100, 450]);
    expect(hasModifier(s, 'piety_high', realm(2))).toBe(true);
    expect(s.standing[1]!.log).toEqual([]); // where a house starts is not a deed
  });
});

describe('deeds', () => {
  it('pays for a tournament from income, gains prestige, crosses a tier that shows in tooltips, and waits', () => {
    const s = game();
    const before = s.economy[1]!.treasury;
    const notices = [] as { realm: number; text: string }[];
    applyCommand(s, { type: 'deed', realm: 1, deed: 'tournament' }, content, [], notices);
    expect(s.economy[1]!.treasury).toBe(before - 50000);
    expect(s.economy[1]!.oneOff.deeds).toBe(-50000);
    expect(s.standing[1]!.prestige).toBe(340);
    expect(s.standing[1]!.log).toEqual([{ day: 0, label: 'tournament', prestige: 40, piety: 0 }]);
    const lines = explain(s, content, 'legitimacy', realm(1)).lines.map((l) => l.label);
    expect(lines).toContain('prestige_high');
    expect(cannotDeed(s, ctx, 1, 'tournament')).toMatch(/Not again so soon/);
  });

  it('refuses what the treasury cannot pay', () => {
    const s = game();
    s.economy[1]!.treasury = 100;
    expect(cannotDeed(s, ctx, 1, 'small_alms')).toBe('Not enough in the treasury.');
    expect(doDeed(s, ctx, 1, 'small_alms')).toEqual([]);
    expect(s.standing[1]!.piety).toBe(50);
  });

  it('sends the ruler on pilgrimage and pays out on the return', () => {
    const s = game();
    doDeed(s, ctx, 1, 'pilgrimage');
    expect(hasModifier(s, 'on_pilgrimage', realm(1))).toBe(true);
    expect(s.standing[1]!.piety).toBe(50); // not yet
    expect(cannotDeed(s, ctx, 1, 'pilgrimage')).toMatch(/already away/);
    s.day += 90;
    const notices = monthlyFaith(s, ctx);
    expect(notices.some((n) => /come home/.test(n.text))).toBe(true);
    expect(hasModifier(s, 'on_pilgrimage', realm(1))).toBe(false);
    expect(s.standing[1]!.piety).toBe(110 + 2); // the pilgrimage, and the shrine it holds
  });

  it('brings in church lands at a cost in piety', () => {
    const s = game();
    const before = s.economy[1]!.treasury;
    doDeed(s, ctx, 1, 'seize_church_lands');
    expect(s.economy[1]!.treasury).toBe(before + 200000);
    expect(s.standing[1]!.piety).toBe(-70);
    expect(hasModifier(s, 'piety_low', realm(1))).toBe(true);
  });
});

describe('sources and losses', () => {
  it('gives piety for each holy site held and controlled', () => {
    const s = game();
    monthlyFaith(s, ctx);
    expect(s.standing[1]!.piety).toBe(52);
    s.provinces[2]!.controller = 2;
    monthlyFaith(s, ctx);
    expect(s.standing[1]!.piety).toBe(52);
    expect(s.standing[1]!.log).toEqual([{ day: 0, label: 'Holy sites held', prestige: 0, piety: 2 }]);
  });

  it('costs prestige to default and to leave officials unpaid; prestige shows in the credit rating', () => {
    const s = game();
    takeLoan(s, ctx, 1, 0, 10000, 12, 0);
    defaultLoan(s, ctx, s.loans[0]!);
    expect(s.standing[1]!.prestige).toBe(240);
    expect(creditRating(s, ctx, 1).lines.find((l) => l.label === 'Renown of the house')?.value).toBe(2);
    s.economy[1]!.treasury = -100000000;
    for (let i = 0; i < 30; i++) tick(s, ctx);
    expect(s.standing[1]!.prestige).toBe(235);
  });

  it('raises piety when a church is finished', () => {
    const s = game();
    startBuilding(s, ctx, 1, 1, 'church');
    s.day += 10;
    finishBuildings(s, ctx);
    expect(s.standing[1]!.piety).toBe(65);
  });
});

describe('excommunication', () => {
  it('waits for a pope, then strikes the impious; absolution pays the Papacy and lifts it', () => {
    const s = game();
    applyCommand(s, { type: 'addModifier', def: 'papal_vacancy', target: realm(2) }, content);
    doDeed(s, ctx, 1, 'seize_church_lands');
    monthlyFaith(s, ctx);
    expect(hasModifier(s, 'excommunicated', realm(1))).toBe(false);
    s.day += 59;
    tick(s, ctx); // the vacancy ends
    const notices = monthlyFaith(s, ctx);
    expect(hasModifier(s, 'excommunicated', realm(1))).toBe(true);
    expect(notices.some((n) => /excommunicated/.test(n.text))).toBe(true);
    expect(s.standing[1]!.prestige).toBe(260);
    expect(explain(s, content, 'tithe_share', realm(1)).value).toBe(0);
    const pope = s.economy[2]!.treasury;
    doDeed(s, ctx, 1, 'absolution');
    expect(hasModifier(s, 'excommunicated', realm(1))).toBe(false);
    expect(s.economy[2]!.treasury).toBe(pope + 150000);
  });

  it('never strikes the Papacy itself or realms of other faiths', () => {
    const s = game();
    s.standing[2]!.piety = -500;
    monthlyFaith(s, ctx);
    expect(hasModifier(s, 'excommunicated', realm(2))).toBe(false);
  });
});

describe('saves', () => {
  it('runs the same twice and survives a save', () => {
    const run = () => {
      const s = game();
      doDeed(s, ctx, 1, 'pilgrimage');
      for (let i = 0; i < 400; i++) tick(s, ctx);
      return s;
    };
    const a = run();
    expect(hashState(a)).toBe(hashState(run()));
    expect(hashState(deserialize(serialize(a), { scenario, economy: ctx }))).toBe(hashState(a));
  });

  it('gives a version 5 save its standing', () => {
    const s = game();
    const old = JSON.parse(serialize(s));
    delete old.state.standing;
    old.saveVersion = 5;
    old.state.saveVersion = 5;
    const back = deserialize(JSON.stringify(old), { scenario, economy: ctx });
    expect(back.standing[1]!.prestige).toBe(300);
  });
});
