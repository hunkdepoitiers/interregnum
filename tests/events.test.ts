import { describe, expect, it } from 'vitest';
import { emptyCharacters, emptyDiplomacy, emptyEvents, emptyFaith, emptyMilitary, emptyWar, type Content, type EventDef, type StatDef } from '../src/sim/content';
import type { EconomyContext } from '../src/sim/economy';
import { answerEvent, dailyEvents, fireOn, oddsFor } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { deserialize, migrate, serialize } from '../src/sim/save';
import type { Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';

const stat = (key: string, scope: 'province' | 'realm', base: number): StatDef =>
  ({ key, scope, label: key, description: '', base, min: 0, max: 100000, format: 'number' });

const base = { title: 'T', text: 'x', day: null, realm: null, all: false, pulse: null, on: null, chance: 10000, cooldown: 0, when: null };
const opt = (key: string, actions: EventDef['options'][number]['actions'], ai = 1) => ({ key, label: key, ai, when: null, actions, odds: null });
const list: EventDef[] = [
  { ...base, key: 'dated', day: 10, realm: 'a', options: [opt('gold', [{ add_gold: 100 }]), opt('none', [], 0)] },
  { ...base, key: 'gated', day: 11, realm: 'a', when: { ruler_is: 'Nobody' }, options: [opt('x', [{ add_gold: 999 }])] },
  { ...base, key: 'everyone', day: 12, all: true, when: { in_region: 'r' }, options: [opt('x', [{ region: { key: 'r', actions: [{ add_modifier: 'blight' }] } }])] },
  { ...base, key: 'roll', day: 13, realm: 'b', options: [{ ...opt('try', []), odds: { chance: 4000, skill: 2, perPoint: 500, success: { text: 'won', actions: [{ add_prestige: 50 }] }, failure: { text: 'lost', actions: [{ add_prestige: -50 }] } } }] },
  { ...base, key: 'grim', day: 14, realm: 'b', when: { ruler_is: 'Bob' }, options: [opt('die', [{ kill_ruler: true }, { take_place: 'town' }])] },
  { ...base, key: 'pulsed', pulse: 10000, cooldown: 400, options: [opt('p', [{ add_piety: 1 }])] },
  { ...base, key: 'onwar', on: 'war_declared', options: [opt('w', [{ add_piety: 7 }])] },
];

const content: Content = {
  stats: Object.fromEntries([stat('unrest', 'province', 0)].map((s) => [s.key, s])),
  modifiers: { blight: { key: 'blight', label: 'Blight', description: '', stacking: 'replace', days: 100, effects: [{ stat: 'unrest', op: 'add', value: 100 }] } },
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
  characters: emptyCharacters(), faith: emptyFaith(), military: emptyMilitary(), war: emptyWar(), diplomacy: emptyDiplomacy(),
  events: { ...emptyEvents(), places: { town: 3 }, regions: { r: [1] }, list },
};

const person = (id: number, name: string) => ({ id, name, dynasty: 0, female: false, born: -40 * 365, died: null, father: 0, mother: 0, spouse: 0, culture: 0, religion: 0, skills: [10, 10, 14], education: null, traits: [], health: 90 });
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'b', name: 'B', rank: 'kingdom', government: 'feudal_monarchy', color: '#00ff00', capital: 2, overlord: 0, scripted: false },
  ],
  owner: [0, 1, 2, 1], controller: [0, 1, 2, 1], pops: new Array(20).fill(0), development: [0, 5, 5, 5],
  characters: [person(1, 'Ann'), person(2, 'Bob')],
  dynasties: [],
  courts: [{ ruler: 1, regent: 0, law: 'cognatic', council: [], claimant: 0, since: 0 }, { ruler: 2, regent: 0, law: 'cognatic', council: [], claimant: 0, since: 0 }],
};
const ctx: EconomyContext = { content, goods: [] };
const game = () => newGame(4, scenario);
const until = (s: ReturnType<typeof game>, day: number) => { s.day = day; return dailyEvents(s, ctx); };

describe('dated events', () => {
  it('stops the clock for the player and waits for an answer', () => {
    const s = game();
    s.player = 1;
    s.paused = false;
    until(s, 10);
    expect(s.paused).toBe(true);
    expect(s.pendingEvents).toEqual([expect.objectContaining({ key: 'dated', realm: 1 })]);
    expect(answerEvent(s, ctx, s.pendingEvents[0]!.id, 'gold', [])).toBe(true);
    expect(s.economy[1]!.treasury).toBe(10000);
    expect(s.pendingEvents).toEqual([]);
  });

  it('fires once, and a computer realm answers by weight', () => {
    const s = game();
    until(s, 10);
    expect(s.economy[1]!.treasury).toBe(10000); // weight 0 is never chosen
    until(s, 10);
    expect(s.economy[1]!.treasury).toBe(10000);
  });

  it('holds back when its condition fails', () => {
    const s = game();
    s.eventsDone.push('dated');
    until(s, 11);
    expect(s.economy[1]!.treasury).toBe(0);
    expect(s.eventsDone).toContain('gated');
  });

  it('reaches every realm in a region, on the provinces it holds there', () => {
    const s = game();
    until(s, 12);
    expect(s.modifiers.filter((m) => m.def === 'blight').map((m) => m.target.id)).toEqual([1]);
  });

  it('can kill a named ruler and hand over a place', () => {
    const s = game();
    until(s, 14);
    expect(s.characters[2]!.died).toBe(14);
    expect(s.provinces[3]!.owner).toBe(2);
  });
});

describe('odds', () => {
  it('are shown from the ruler’s skill, and the roll follows them', () => {
    const s = game();
    const option = list[3]!.options[0]!;
    expect(oddsFor(s, option, 2)).toBe(6000);
    until(s, 13);
    expect(Math.abs(s.standing[2]!.prestige)).toBe(50);
  });
});

describe('pulses and on-actions', () => {
  it('pulses each realm monthly, within its cooldown', () => {
    const s = game();
    s.eventsDone.push(...list.filter((e) => e.day !== null).map((e) => e.key));
    for (let i = 0; i < 300; i++) tick(s, ctx);
    expect(s.standing[1]!.piety).toBe(1);
    expect(s.standing[2]!.piety).toBe(1);
  });

  it('fires when something happens', () => {
    const s = game();
    fireOn(s, ctx, 'war_declared', 2, []);
    expect(s.standing[2]!.piety).toBe(7);
  });
});

describe('saves', () => {
  it('keeps pending events, runs the same twice, and does not replay old history', () => {
    const s = game();
    s.player = 1;
    until(s, 10);
    const back = deserialize(serialize(s), { scenario, economy: ctx });
    expect(back.pendingEvents).toHaveLength(1);
    const go = () => { const g = game(); for (let i = 0; i < 500; i++) tick(g, ctx); return g; };
    expect(hashState(go())).toBe(hashState(go()));
    const old = JSON.parse(serialize(s)).state;
    delete old.pendingEvents; delete old.eventsDone;
    old.day = 12;
    expect((migrate(old, 9, { scenario, economy: ctx }) as { eventsDone: string[] }).eventsDone).toEqual(['dated', 'gated', 'everyone']);
  });
});
