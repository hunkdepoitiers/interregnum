import { describe, expect, it } from 'vitest';
import { monthlyAi } from '../src/sim/ai';
import { emptyCharacters, emptyDiplomacy, emptyEvents, emptyFaith, emptyMilitary, emptyWar, type Content, type StatDef } from '../src/sim/content';
import { computeLedgers, type EconomyContext } from '../src/sim/economy';
import { hashState } from '../src/sim/hash';
import type { Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';

const stat = (key: string, scope: 'province' | 'realm', base: number): StatDef =>
  ({ key, scope, label: key, description: '', base, min: 0, max: 100000, format: 'number' });

const content: Content = {
  stats: Object.fromEntries([stat('levy_size', 'realm', 1000), stat('tax_rate', 'realm', 2000), stat('development', 'province', 500), stat('tax_efficiency', 'province', 10000), stat('trade_efficiency', 'province', 0), stat('production', 'province', 10000), stat('unrest', 'province', 0), stat('tithe_share', 'realm', 0)].map((s) => [s.key, s])),
  modifiers: {}, cultures: [], religions: [],
  titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] },
  goods: [],
  economy: {
    wealthPerHead: [100, 0, 0, 0, 0], devBase: 100, devPerPoint: 0, tithe: 0, tradePerThousand: 0, vassalDues: 0,
    court: { empire: 0, kingdom: 0, duchy: 0, county: 0 }, adminPerProvince: 0, retinuePerThousand: 0, growth: 0,
    startTreasuryMonths: 0, largesse: 0,
    taxLaws: [{ key: 'normal', name: 'Normal', description: '', modifier: null }, { key: 'high', name: 'High', description: '', modifier: null }],
    lawCooldownDays: 365,
    buildings: [{ key: 'market', name: 'Market', description: '', cost: 25000, days: 10, upkeep: 0, modifier: 'x' }],
    banks: [{ key: 'local', name: 'Moneylenders', seat: 0, capital: 6000000, rate: 2500, risk: 100, local: true }],
    credit: { base: 55, incomePerPoint: 200000, incomeCap: 25, debtRatioPenalty: 30, defaultPenalty: 35, defaultMemoryDays: 7300, rateSpread: 5, terms: [12, 24] },
  },
  characters: emptyCharacters(), faith: emptyFaith(), military: { ...emptyMilitary(), levyShare: 500 }, war: emptyWar(), diplomacy: { ...emptyDiplomacy(), alliance: { minOpinion: 1000, breakPrestige: -20, callOpinion: 20 } }, events: emptyEvents(),
};

/** 1 is a big kingdom, 2 a small neighbour next to it, 3 a scripted horde beside them; a road of provinces 1-2-3. */
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'b', name: 'B', rank: 'duchy', government: 'feudal_monarchy', color: '#00ff00', capital: 2, overlord: 0, scripted: false },
    { id: 3, key: 'h', name: 'H', rank: 'kingdom', government: 'steppe_horde', color: '#0000ff', capital: 3, overlord: 0, scripted: true },
  ],
  owner: [0, 1, 2, 3], controller: [0, 1, 2, 3],
  pops: [0, 0, 0, 0, 0, 3000000, 0, 0, 0, 0, 200000, 0, 0, 0, 0, 5000000, 0, 0, 0, 0],
  development: [0, 5, 5, 5],
  graph: { start: [0, 0, 1, 3, 4], to: [2, 1, 3, 2], days: [10, 10, 10, 10] },
  pos: [0, 0, 0, 0, 100, 0, 200, 0], kmPerPx: 0.4, terrain: ['', 'plains', 'plains', 'plains'],
};
const ctx: EconomyContext = { content, goods: [], graph: scenario.graph, pos: scenario.pos, kmPerPx: scenario.kmPerPx, terrain: scenario.terrain };
function game() {
  const s = newGame(5, scenario, [6000000]);
  const ledgers = computeLedgers(s, ctx);
  for (const id of [1, 2, 3]) { s.economy[id]!.treasury = 10000000; s.economy[id]!.ledger = ledgers[id]!; }
  s.standing[1]!.prestige = 300;
  return s;
}

describe('the computer realms', () => {
  it('declare war on a weak neighbour they can beat, in time, and never on a scripted horde', () => {
    const s = game();
    for (let i = 0; i < 4000 && !s.wars.length; i++) monthlyAi(s, ctx);
    expect(s.wars).toHaveLength(1);
    expect(s.wars[0]!.attackers[0]).toBe(1);
    expect(s.wars[0]!.defenders[0]).toBe(2);
  });

  it('rest after a peace: a truce holds them back', () => {
    const s = game();
    s.truces.push({ a: 1, b: 2, until: 100000 });
    for (let i = 0; i < 2000; i++) monthlyAi(s, ctx);
    expect(s.wars).toHaveLength(0);
  });

  it('borrow when broke and squeeze taxes, and build with spare gold', () => {
    const s = game();
    s.economy[2]!.treasury = -5000;
    s.economy[1]!.treasury = 100000000;
    monthlyAi(s, ctx);
    expect(s.loans.some((l) => l.realm === 2)).toBe(true);
    expect(s.economy[2]!.taxLaw).toBe('high');
    expect(s.construction.some((c) => c.realm === 1)).toBe(true);
  });

  it('leave the realm the player rules to the player', () => {
    const s = game();
    s.player = 1;
    s.economy[1]!.treasury = 100000000;
    for (let i = 0; i < 60; i++) monthlyAi(s, ctx);
    expect(s.construction.some((c) => c.realm === 1)).toBe(false);
    expect(s.wars.some((w) => w.attackers.includes(1))).toBe(false);
  });

  it('play the same game twice', () => {
    const go = () => { const s = game(); for (let i = 0; i < 600; i++) monthlyAi(s, ctx); return s; };
    expect(hashState(go())).toBe(hashState(go()));
  });
});
