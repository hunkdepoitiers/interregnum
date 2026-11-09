import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { emptyCharacters, emptyDiplomacy, emptyEvents, emptyFaith, emptyMilitary, emptyWar, type Content, type StatDef } from '../src/sim/content';
import { computeLedgers, type EconomyContext } from '../src/sim/economy';
import { allied, answerDemand, cannotDiplo, doDiplo, monthlyDiplomacy, opinion, setContract } from '../src/sim/diplomacy';
import { atWar } from '../src/sim/military';
import { deserialize, serialize } from '../src/sim/save';
import type { Character, Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { casusBelli, declareFor, settle } from '../src/sim/war';

const stat = (key: string, scope: 'province' | 'realm', base: number): StatDef =>
  ({ key, scope, label: key, description: '', base, min: 0, max: 100000, format: 'number' });

const diplomacy = emptyDiplomacy();
diplomacy.vassals.contracts = [
  { key: 'low', name: 'Low', description: '', dues: 50, opinion: 15, joinsWars: false },
  { key: 'normal', name: 'Normal', description: '', dues: 100, opinion: 0, joinsWars: true },
  { key: 'high', name: 'High', description: '', dues: 200, opinion: -25, joinsWars: true },
];
diplomacy.timeline = [{ day: 10, type: 'tribute', from: 2, to: 1, share: 10, days: 3650, men: 5000, spawn: 3 }];

const content: Content = {
  stats: Object.fromEntries([stat('levy_size', 'realm', 1000), stat('tax_rate', 'realm', 2000), stat('tax_efficiency', 'province', 10000), stat('tithe_share', 'realm', 0), stat('trade_efficiency', 'province', 0), stat('production', 'province', 10000), stat('development', 'province', 500)].map((s) => [s.key, s])),
  modifiers: {}, cultures: [], religions: [],
  titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] },
  goods: [],
  economy: {
    wealthPerHead: [100, 0, 0, 0, 0], devBase: 100, devPerPoint: 0, tithe: 0, tradePerThousand: 0, vassalDues: 2000,
    court: { empire: 0, kingdom: 0, duchy: 0, county: 0 }, adminPerProvince: 0, retinuePerThousand: 0, growth: 0,
    startTreasuryMonths: 0, largesse: 0, taxLaws: [{ key: 'normal', name: 'Normal', description: '', modifier: null }],
    lawCooldownDays: 365, buildings: [], banks: [],
    credit: { base: 50, incomePerPoint: 100000, incomeCap: 25, debtRatioPenalty: 30, defaultPenalty: 35, defaultMemoryDays: 7300, rateSpread: 5, terms: [12] },
  },
  characters: emptyCharacters(), faith: emptyFaith(), military: { ...emptyMilitary(), levyShare: 500 }, war: emptyWar(), diplomacy, events: emptyEvents(),
};

const person = (id: number, name: string, female: boolean, dynasty: number): Character =>
  ({ id, name, dynasty, female, born: -30 * 365, died: null, father: 0, mother: 0, spouse: 0, culture: 0, religion: 0, skills: [10, 10, 10], education: null, traits: [], health: 90 });

/** 1 Player kingdom; 2 a neighbour; 3 the player's vassal; 4 another realm the neighbour might call. */
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'b', name: 'B', rank: 'kingdom', government: 'feudal_monarchy', color: '#00ff00', capital: 2, overlord: 0, scripted: false },
    { id: 3, key: 'v', name: 'V', rank: 'duchy', government: 'feudal_monarchy', color: '#0000ff', capital: 3, overlord: 1, scripted: false },
    { id: 4, key: 'c', name: 'C', rank: 'duchy', government: 'feudal_monarchy', color: '#00ffff', capital: 4, overlord: 0, scripted: false },
  ],
  owner: [0, 1, 2, 3, 4],
  controller: [0, 1, 2, 3, 4],
  pops: [0, 0, 0, 0, 0, 3000000, 0, 0, 0, 0, 300000, 0, 0, 0, 0, 2000000, 0, 0, 0, 0, 300000, 0, 0, 0, 0],
  development: [0, 5, 5, 5, 5],
  characters: [person(1, 'King', false, 1), person(2, 'Queen', true, 2), person(3, 'Duke', false, 3), person(4, 'Count', false, 4)],
  dynasties: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'V' }, { id: 4, name: 'C' }],
  courts: [1, 2, 3, 4].map((ruler) => ({ ruler, regent: 0, law: 'cognatic', council: [], claimant: 0, since: 0 })),
};
const ctx: EconomyContext = { content, goods: [] };
function game() {
  const s = newGame(3, scenario);
  s.player = 1;
  for (const ec of s.economy) if (ec) ec.treasury = 10000000;
  return s;
}

describe('opinion and pacts', () => {
  it('buys goodwill with gifts, once a year, and then an alliance', () => {
    const s = game();
    expect(cannotDiplo(s, ctx, 1, 2, 'alliance')).toMatch(/think better/);
    doDiplo(s, ctx, 1, 2, 'gift');
    expect(opinion(s, ctx, 2, 1).value).toBe(25);
    expect(cannotDiplo(s, ctx, 1, 2, 'gift')).toMatch(/lately/);
    doDiplo(s, ctx, 1, 2, 'alliance');
    expect(allied(s, 1, 2)).toBe(true);
    expect(opinion(s, ctx, 2, 1).value).toBe(55);
  });

  it('marries a ruler to the other house, and the marriage ends with a death', () => {
    const s = game();
    doDiplo(s, ctx, 1, 2, 'marriage');
    expect(s.characters[1]!.spouse).toBe(2);
    expect(s.marriages).toHaveLength(1);
    s.characters[2]!.died = 0;
    monthlyDiplomacy(s, ctx);
    expect(s.marriages).toHaveLength(0);
  });

  it('demands tribute only of the weak, and tribute shows in the ledgers', () => {
    const s = game();
    expect(cannotDiplo(s, ctx, 2, 1, 'tribute')).toMatch(/times as strong/);
    doDiplo(s, ctx, 1, 2, 'tribute');
    const l = computeLedgers(s, ctx);
    expect(l[2]!.tribute_paid).toBeLessThan(0);
    expect(l[1]!.tribute_received).toBe(-l[2]!.tribute_paid!);
  });
});

describe('alliances and marriages in war', () => {
  it('brings willing allies in, and an unwilling one breaks away', () => {
    const s = game();
    s.alliances.push({ a: 2, b: 4, start: 0 });
    s.opinions.push({ from: 4, to: 2, label: 'x', value: -50, start: 0, end: 9999 });
    const war = declareFor(s, ctx, 1, 2, 'conquest')!;
    expect(war.defenders).not.toContain(4);
    expect(allied(s, 2, 4)).toBe(false);
  });

  it('calls in a friend who thinks well of the leader', () => {
    const s = game();
    s.alliances.push({ a: 2, b: 4, start: 0 });
    s.opinions.push({ from: 4, to: 2, label: 'x', value: 50, start: 0, end: 9999 });
    expect(declareFor(s, ctx, 1, 2, 'conquest')!.defenders).toContain(4);
    expect(atWar(s, 1, 4)).toBe(true);
  });

  it('forbids war on an ally or during a truce, and war on kin costs prestige', () => {
    const s = game();
    s.alliances.push({ a: 1, b: 4, start: 0 });
    expect(casusBelli(s, ctx, 1, 4)[0]!.why).toMatch(/allied/);
    doDiplo(s, ctx, 1, 2, 'marriage');
    expect(casusBelli(s, ctx, 1, 2)[0]!.prestige).toBe(-25);
    const war = declareFor(s, ctx, 1, 2, 'conquest')!;
    settle(s, ctx, war, null, { cede: [], months: 0 });
    expect(casusBelli(s, ctx, 1, 2)[0]!.why).toMatch(/truce/);
  });
});

describe('vassals', () => {
  it('takes more dues on heavier obligations, and light vassals stay out of wars', () => {
    const s = game();
    const normal = computeLedgers(s, ctx)[1]!.vassal_dues!;
    setContract(s, ctx, 1, 3, 'high');
    expect(computeLedgers(s, ctx)[1]!.vassal_dues).toBe(normal * 2);
    setContract(s, ctx, 1, 3, 'low');
    expect(computeLedgers(s, ctx)[1]!.vassal_dues).toBe(Math.trunc(normal / 2));
    expect(declareFor(s, ctx, 1, 2, 'conquest')!.attackers).toEqual([1]);
  });

  it('rises in revolt when the overlord cannot pay, and wins its freedom', () => {
    const s = game();
    s.economy[1]!.treasury = -100;
    monthlyDiplomacy(s, ctx);
    expect(s.factions).toHaveLength(1);
    expect(s.wars).toHaveLength(0);
    s.day += 200;
    monthlyDiplomacy(s, ctx);
    expect(s.wars).toHaveLength(1);
    expect(atWar(s, 3, 1)).toBe(true);
    settle(s, ctx, s.wars[0]!, true, { cede: [], months: 0 });
    expect(s.realms[3]!.overlord).toBe(0);
  });

  it('stays loyal when all is well', () => {
    const s = game();
    monthlyDiplomacy(s, ctx);
    expect(s.factions).toHaveLength(0);
  });
});

describe('the scripted powers', () => {
  it('demands tribute of the player, and refusal brings an invasion', () => {
    const s = game();
    s.day = 10;
    monthlyDiplomacy(s, ctx);
    expect(s.demands).toHaveLength(1);
    answerDemand(s, s.demands[0]!.id, false, []);
    expect(atWar(s, 2, 1)).toBe(true);
    expect(s.armies[0]).toMatchObject({ realm: 2, location: 3, levies: 5000 });
    monthlyDiplomacy(s, ctx);
    expect(s.wars).toHaveLength(1); // only once
  });

  it('collects when paid, and saves it all', () => {
    const s = game();
    s.day = 10;
    monthlyDiplomacy(s, ctx);
    applyCommand(s, { type: 'answerDemand', demand: s.demands[0]!.id, pay: true }, content, [], [], ctx);
    expect(s.tributes).toEqual([{ payer: 1, to: 2, share: 10, until: 3660 }]);
    expect(deserialize(serialize(s), { scenario, economy: ctx }).tributes).toHaveLength(1);
  });
});
