import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { emptyCharacters, emptyFaith, emptyDiplomacy, emptyMilitary, emptyWar, type Content, type StatDef } from '../src/sim/content';
import { computeLedgers, type EconomyContext } from '../src/sim/economy';
import { hashState } from '../src/sim/hash';
import { atWar, findPath, levyPool, raiseLevies } from '../src/sim/military';
import { deserialize, serialize } from '../src/sim/save';
import type { Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';

const stat = (key: string, scope: 'province' | 'realm', base: number): StatDef =>
  ({ key, scope, label: key, description: '', base, min: 0, max: 100000, format: 'number' });

const content: Content = {
  stats: Object.fromEntries([stat('levy_size', 'realm', 1000), stat('supply_limit', 'province', 1000)].map((s) => [s.key, s])),
  modifiers: {},
  cultures: [], religions: [],
  titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] },
  goods: [],
  economy: {
    wealthPerHead: [0, 0, 0, 0, 0], devBase: 100, devPerPoint: 0, tithe: 0, tradePerThousand: 0, vassalDues: 0,
    court: { empire: 0, kingdom: 0, duchy: 0, county: 0 }, adminPerProvince: 0, retinuePerThousand: 0, growth: 0,
    startTreasuryMonths: 0, largesse: 0, taxLaws: [{ key: 'normal', name: 'Normal', description: '', modifier: null }],
    lawCooldownDays: 365, buildings: [], banks: [],
    credit: { base: 50, incomePerPoint: 100000, incomeCap: 25, debtRatioPenalty: 30, defaultPenalty: 35, defaultMemoryDays: 7300, rateSpread: 5, terms: [12] },
  },
  characters: emptyCharacters(), faith: emptyFaith(), war: emptyWar(), diplomacy: emptyDiplomacy(),
  military: {
    ...emptyMilitary(),
    levy: { name: 'Levies', description: '', strength: 100, wage: 400, lateWage: 1200, serviceDays: 120 },
    menAtArms: { name: 'Men-at-arms', description: '', strength: 300, wage: 3000, cost: 15000 },
    levyShare: 300, menAtArmsPerThousandLevies: 250, musterDays: 0, attrition: 5, attritionMax: 15, hostileSupply: 60,
  },
};

/** A road of five provinces, each two days from the next: 1-2 belong to A, 3-5 to B (capital 5). */
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'b', name: 'B', rank: 'kingdom', government: 'feudal_monarchy', color: '#0000ff', capital: 5, overlord: 0, scripted: false },
  ],
  owner: [0, 1, 1, 2, 2, 2],
  controller: [0, 1, 1, 2, 2, 2],
  // 1,000,000 peasants in each of A's provinces, 300,000 in each of B's: A raises 6,000 levies, B 2,700.
  pops: [0, 0, 0, 0, 0, ...[1, 2].flatMap(() => [1000000, 0, 0, 0, 0]), ...[3, 4, 5].flatMap(() => [300000, 0, 0, 0, 0])],
  development: [0, 5, 5, 5, 5, 5],
  graph: { start: [0, 0, 1, 3, 5, 7, 8], to: [2, 1, 3, 2, 4, 3, 5, 4], days: [20, 20, 20, 20, 20, 20, 20, 20] },
  pos: [0, 0, 0, 0, 100, 0, 200, 0, 300, 0, 400, 0],
  kmPerPx: 0.4,
  terrain: ['', 'plains', 'plains', 'hills', 'plains', 'plains'],
};
const ctx: EconomyContext = { content, goods: [], graph: scenario.graph, pos: scenario.pos, kmPerPx: scenario.kmPerPx, terrain: scenario.terrain };
const game = () => {
  const s = newGame(5, scenario);
  s.economy[1]!.treasury = s.economy[2]!.treasury = 10000000;
  return s;
};
const run = (s: ReturnType<typeof game>, days: number) => { for (let i = 0; i < days; i++) tick(s, ctx); };

describe('marching', () => {
  it('finds the road and walks it day by day', () => {
    expect(findPath(ctx, 1, 5)).toEqual({ path: [2, 3, 4, 5], days: 80 });
    expect(findPath(ctx, 1, 0)).toBeNull();
    const s = game();
    const army = raiseLevies(s, ctx, 1)!;
    applyCommand(s, { type: 'moveArmy', realm: 1, army: army.id, to: 3 }, content, [], [], ctx);
    run(s, 3);
    expect(army.location).toBe(2);
    run(s, 2);
    expect(army.location).toBe(3);
    expect(army.path).toEqual([]);
  });
});

describe('levies and men-at-arms', () => {
  it('raises the realm’s levies once, hires men-at-arms within the cap, and pays them monthly', () => {
    const s = game();
    expect(levyPool(s, ctx, 1).total).toBe(6000);
    expect(raiseLevies(s, ctx, 1)!.levies).toBe(6000);
    expect(raiseLevies(s, ctx, 1)).toBeNull();
    applyCommand(s, { type: 'hireMenAtArms', realm: 1, men: 1000 }, content, [], [], ctx);
    expect(s.armies[0]!.menAtArms).toBe(1000);
    expect(s.economy[1]!.treasury).toBe(10000000 - 15000);
    applyCommand(s, { type: 'hireMenAtArms', realm: 1, men: 1000 }, content, [], [], ctx);
    expect(s.armies[0]!.menAtArms).toBe(1000); // 1,500 at most
    expect(computeLedgers(s, ctx)[1]!.armies).toBe(-(6 * 400 + 3000));
  });
});

describe('war', () => {
  it('fights, routs the weaker side, and occupies its land; peace gives it back', () => {
    const s = game();
    applyCommand(s, { type: 'declareWar', attacker: 1, defender: 2 }, content);
    expect(atWar(s, 1, 2)).toBe(true);
    s.player = 1; // B is left to its own general
    const a = raiseLevies(s, ctx, 1)!;
    applyCommand(s, { type: 'moveArmy', realm: 1, army: a.id, to: 4 }, content, [], [], ctx);
    run(s, 120);
    expect(s.armies.filter((x) => x.realm === 2).every((x) => x.retreating || x.location !== 4)).toBe(true);
    expect(s.provinces[4]!.controller).toBe(1);
    expect(s.provinces[4]!.owner).toBe(2);
    expect(s.standing[1]!.log.some((l) => l.label === 'Victory in battle')).toBe(true);
    applyCommand(s, { type: 'makePeace', war: s.wars[0]!.id }, content);
    expect(s.provinces[4]!.controller).toBe(2);
  });

  it('runs a war the same way twice and survives a save', () => {
    const go = () => {
      const s = game();
      applyCommand(s, { type: 'declareWar', attacker: 2, defender: 1 }, content);
      run(s, 200);
      return s;
    };
    const a = go();
    expect(a.day).toBe(200);
    expect(hashState(a)).toBe(hashState(go()));
    expect(hashState(deserialize(serialize(a), { scenario, economy: ctx }))).toBe(hashState(a));
  });
});
