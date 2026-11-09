import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { emptyCharacters, emptyFaith, emptyDiplomacy, emptyEvents, emptyMilitary, emptyWar, type Content, type StatDef } from '../src/sim/content';
import { type EconomyContext } from '../src/sim/economy';
import { hashState } from '../src/sim/hash';
import { hireCompany, raiseLevies } from '../src/sim/military';
import { deserialize, serialize } from '../src/sim/save';
import { assault, bribe, dailySieges, hireEngineers, startForts } from '../src/sim/sieges';
import type { Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { casusBelli, proposePeace, warScore } from '../src/sim/war';

const stat = (key: string, scope: 'province' | 'realm', base: number): StatDef =>
  ({ key, scope, label: key, description: '', base, min: 0, max: 100000, format: 'number' });

const war = emptyWar();
war.forts.capital = { empire: 3, kingdom: 2, duchy: 1, county: 1 };
war.companies = [{ key: 'c', name: 'Company', description: '', men: 2000, cost: 50000, wage: 3000, strength: 300 }];
war.desertion = { share: 5, morale: 10 };

const content: Content = {
  stats: Object.fromEntries([stat('levy_size', 'realm', 1000), stat('supply_limit', 'province', 100000)].map((s) => [s.key, s])),
  modifiers: {}, cultures: [], religions: [],
  titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] },
  goods: [],
  economy: {
    wealthPerHead: [0, 0, 0, 0, 0], devBase: 100, devPerPoint: 0, tithe: 0, tradePerThousand: 0, vassalDues: 0,
    court: { empire: 0, kingdom: 0, duchy: 0, county: 0 }, adminPerProvince: 0, retinuePerThousand: 0, growth: 0,
    startTreasuryMonths: 0, largesse: 0, taxLaws: [{ key: 'normal', name: 'Normal', description: '', modifier: null }],
    lawCooldownDays: 365, buildings: [], banks: [],
    credit: { base: 50, incomePerPoint: 100000, incomeCap: 25, debtRatioPenalty: 30, defaultPenalty: 35, defaultMemoryDays: 7300, rateSpread: 5, terms: [12] },
  },
  characters: emptyCharacters(), faith: emptyFaith(), war, diplomacy: emptyDiplomacy(), events: emptyEvents(),
  military: {
    ...emptyMilitary(),
    levy: { name: 'Levies', description: '', strength: 100, wage: 0, lateWage: 0, serviceDays: 120 },
    menAtArms: { name: 'Men-at-arms', description: '', strength: 300, wage: 0, cost: 0 },
    levyShare: 500, menAtArmsPerThousandLevies: 250, musterDays: 0,
  },
};

/** A road: A holds 1 (capital) and 2; B holds 3 (open) and 4 (its capital, a level 2 fort). */
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'b', name: 'B', rank: 'kingdom', government: 'feudal_monarchy', color: '#0000ff', capital: 4, overlord: 0, scripted: false },
  ],
  owner: [0, 1, 1, 2, 2],
  controller: [0, 1, 1, 2, 2],
  pops: [0, 0, 0, 0, 0, ...[1, 2].flatMap(() => [2000000, 0, 0, 0, 0]), ...[3, 4].flatMap(() => [10000, 0, 0, 0, 0])],
  development: [0, 5, 5, 5, 5],
  graph: { start: [0, 0, 1, 3, 5, 6], to: [2, 1, 3, 2, 4, 3], days: [10, 10, 10, 10, 10, 10] },
  pos: [0, 0, 0, 0, 100, 0, 200, 0, 300, 0],
  kmPerPx: 0.4,
  terrain: ['', 'plains', 'plains', 'plains', 'plains'],
};
const ctx: EconomyContext = { content, goods: [], graph: scenario.graph, pos: scenario.pos, kmPerPx: scenario.kmPerPx, terrain: scenario.terrain };

function game() {
  const s = newGame(11, scenario);
  startForts(s, ctx);
  s.economy[1]!.treasury = 100000000;
  s.economy[2]!.treasury = 100000000;
  s.economy[2]!.ledger = { land_tax: 100000 };
  s.player = 1;
  return s;
}
function atWalls(s: ReturnType<typeof game>) {
  applyCommand(s, { type: 'declareWar', attacker: 1, defender: 2 }, content, [], [], ctx);
  const a = raiseLevies(s, ctx, 1)!;
  s.armies = [a];
  a.location = 4;
  return a;
}
const run = (s: ReturnType<typeof game>, days: number) => { for (let i = 0; i < days; i++) tick(s, ctx); };

describe('forts', () => {
  it('fortifies capitals and leaves open land open', () => {
    const s = game();
    expect(s.forts[4]).toEqual({ level: 2, garrison: 1000, supply: 150 });
    expect(s.forts[3]).toBeUndefined();
  });

  it('holds an army out of a fort until the siege ends, then gives control and prestige', () => {
    const s = game();
    atWalls(s);
    run(s, 40);
    expect(s.provinces[4]!.controller).toBe(2); // standing there is not enough
    expect(s.sieges).toHaveLength(1);
    const day = s.day;
    while (s.provinces[4]!.controller === 2 && s.day < day + 400) tick(s, ctx);
    expect(s.provinces[4]!.controller).toBe(1);
    expect(s.sieges).toHaveLength(0);
    expect(s.standing[1]!.prestige).toBe(0); // emptyWar gives no prestige for it
  });

  it('starves a garrison once the stores are gone', () => {
    const s = game();
    atWalls(s);
    dailySieges(s, ctx, false);
    s.forts[4]!.supply = 0;
    s.forts[4]!.garrison = 10;
    run(s, 12);
    expect(s.provinces[4]!.controller).toBe(1);
  });
});

describe('the besieger’s options', () => {
  it('hires engineers, up to the limit, for gold', () => {
    const s = game();
    atWalls(s);
    dailySieges(s, ctx, false);
    const gold = s.economy[1]!.treasury;
    for (let i = 0; i < 5; i++) hireEngineers(s, ctx, 1, 4);
    expect(s.sieges[0]!.engineers).toBe(3);
    expect(s.economy[1]!.treasury).toBe(gold - 45000);
  });

  it('storms at a price, and waits before trying again', () => {
    const s = game();
    const a = atWalls(s);
    dailySieges(s, ctx, false);
    const men = a.levies;
    s.sieges[0]!.progress = 5000;
    expect(assault(s, ctx, 1, 4, [])).toBe(true);
    expect(a.levies).toBeLessThan(men);
    if (s.sieges.length) expect(assault(s, ctx, 1, 4, [])).toBe(false);
  });

  it('loses the bribe either way', () => {
    const s = game();
    atWalls(s);
    dailySieges(s, ctx, false);
    const gold = s.economy[1]!.treasury;
    expect(bribe(s, ctx, 1, 4, 2, [])).toBe(true);
    expect(s.economy[1]!.treasury).toBe(gold - 120000);
  });
});

describe('companies and pay', () => {
  it('hires a company once, and it walks out unpaid', () => {
    const s = game();
    expect(hireCompany(s, ctx, 1, 0)).toBe(true);
    expect(s.armies[0]!.menAtArms).toBe(2000);
    expect(hireCompany(s, ctx, 2, 0)).toBe(false);
    s.economy[1]!.treasury = -1000;
    applyCommand(s, { type: 'declareWar', attacker: 1, defender: 2 }, content, [], [], ctx); // armies only act in war or with armies
    run(s, 31);
    expect(s.armies.filter((a) => a.company)).toHaveLength(0);
  });
});

describe('war and peace', () => {
  it('needs a reason that fits', () => {
    const s = game();
    const ind = { ...war.casusBelli[0]!, key: 'independence' };
    const c: EconomyContext = { ...ctx, content: { ...content, war: { ...war, casusBelli: [...war.casusBelli, ind] } } };
    const cbs = casusBelli(s, c, 1, 2);
    expect(cbs.find((x) => x.key === 'conquest')?.why).toBeNull();
    expect(cbs.find((x) => x.key === 'independence')?.why).toMatch(/not your overlord/);
  });

  it('wins a war by sieges, takes land and an indemnity, and the score pays for it', () => {
    const s = game();
    atWalls(s);
    s.provinces[3]!.controller = 1;
    s.forts[4]!.garrison = 1;
    s.forts[4]!.supply = 0;
    run(s, 40);
    expect(s.provinces[4]!.controller).toBe(1);
    const w = s.wars[0]!;
    expect(warScore(s, ctx, w).occupation).toBe(60);
    s.economy[2]!.ledger = { land_tax: 100000 };
    const before = s.economy[1]!.treasury;
    expect(proposePeace(s, ctx, 1, w.id, { cede: [4], months: 100 }, true).accepted).toBe(false); // worth too much
    const r = proposePeace(s, ctx, 1, w.id, { cede: [3], months: 3 }, true);
    expect(r.accepted).toBe(true);
    expect(s.wars).toHaveLength(0);
    expect([s.provinces[3]!.owner, s.provinces[3]!.controller]).toEqual([1, 1]);
    expect(s.provinces[4]!.controller).toBe(2); // not ceded: goes back
    expect(s.economy[1]!.treasury - before).toBeGreaterThanOrEqual(300000);
  });

  it('moves the capital of a realm that cedes it, and refuses a white peace to a losing... winner', () => {
    const s = game();
    atWalls(s);
    s.provinces[4]!.controller = 1;
    delete s.forts[4];
    const w = s.wars[0]!;
    w.battles = 40;
    expect(proposePeace(s, ctx, 2, w.id, { cede: [], months: 0 }, false).accepted).toBe(false);
    expect(proposePeace(s, ctx, 1, w.id, { cede: [4], months: 0 }, true).accepted).toBe(true);
    expect(s.realms[2]!.capital).toBe(3);
  });

  it('prices and carries out every term of a treaty', () => {
    const s = game();
    atWalls(s);
    s.realms[2]!.overlord = 0;
    s.alliances.push({ a: 2, b: 1, start: 0 });
    s.provinces[3]!.controller = 1;
    const w = s.wars[0]!;
    w.battles = 40;
    s.provinces[4]!.controller = 1;
    expect(proposePeace(s, ctx, 1, w.id, { cede: [], months: 0, vassalize: true, humiliate: true, breakAlliances: true, release: [1] }, true).accepted).toBe(false); // 1 is no vassal of theirs
    expect(proposePeace(s, ctx, 1, w.id, { cede: [], months: 0, vassalize: true, humiliate: true, breakAlliances: true }, true).accepted).toBe(true);
    expect(s.realms[2]!.overlord).toBe(1);
    expect(s.alliances).toHaveLength(0);
  });

  it('runs the same twice and survives a save', () => {
    const go = () => { const s = game(); atWalls(s); run(s, 300); return s; };
    const a = go();
    expect(hashState(a)).toBe(hashState(go()));
    expect(hashState(deserialize(serialize(a), { scenario, economy: ctx }))).toBe(hashState(a));
  });
});
