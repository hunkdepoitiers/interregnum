import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { hashState } from '../src/sim/hash';
import { nextU32 } from '../src/sim/rng';
import { deserialize, migrate, SaveError, serialize } from '../src/sim/save';
import type { Scenario } from '../src/sim/scenario';
import { newGame, SAVE_VERSION } from '../src/sim/state';
import { tick } from '../src/sim/tick';

/** Provinces 1-3 belong to realm 1, province 4 to realm 2 but is held by realm 1; province 5 is sea. */
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'b', name: 'B', rank: 'duchy', government: 'theocracy', color: '#0000ff', capital: 4, overlord: 1, scripted: false },
  ],
  owner: [0, 1, 1, 1, 2, 0],
  controller: [0, 1, 1, 1, 1, 0],
};
const ctx = { scenario };

function run(seed: number, days: number) {
  const s = newGame(seed, scenario);
  for (let i = 0; i < days; i++) {
    tick(s);
    nextU32(s.rng); // stand-in for systems that will consume randomness each day
  }
  return s;
}

describe('newGame', () => {
  it('copies realms and ownership from the scenario', () => {
    const s = newGame(1, scenario);
    expect(s.realms[0]).toBeNull();
    expect(s.realms[2]).toMatchObject({ key: 'b', overlord: 1 });
    expect(s.provinces[4]).toEqual({ id: 4, owner: 2, controller: 1 });
    expect(s.provinces[5]).toEqual({ id: 5, owner: 0, controller: 0 });
  });

  it('does not share realm objects with the scenario', () => {
    const s = newGame(1, scenario);
    s.realms[1]!.name = 'changed';
    expect(scenario.realms[0]!.name).toBe('A');
  });
});

describe('tick', () => {
  it('reports month and year starts', () => {
    const s = newGame(1, scenario);
    const results = Array.from({ length: 160 }, () => tick(s));
    expect(results.filter((r) => r.monthStart).map((r) => r.day)).toEqual([30, 61, 92, 120, 151]);
    expect(results.filter((r) => r.yearStart).map((r) => r.day)).toEqual([61]);
  });

  it('is deterministic over ten years', () => {
    expect(hashState(run(1302, 3650))).toBe(hashState(run(1302, 3650)));
    expect(hashState(run(1302, 3650))).not.toBe(hashState(run(1303, 3650)));
  });
});

describe('commands', () => {
  it('set speed and pause without touching the map', () => {
    const s = newGame(1, scenario);
    expect(applyCommand(s, { type: 'setSpeed', speed: 5 })).toBe(false);
    applyCommand(s, { type: 'togglePause' });
    expect(s.speed).toBe(5);
    expect(s.paused).toBe(false);
  });

  it('setController occupies; setOwner transfers and ends the occupation', () => {
    const s = newGame(1, scenario);
    expect(applyCommand(s, { type: 'setController', province: 2, realm: 2 })).toBe(true);
    expect(s.provinces[2]).toEqual({ id: 2, owner: 1, controller: 2 });
    expect(applyCommand(s, { type: 'setOwner', province: 4, realm: 1 })).toBe(true);
    expect(s.provinces[4]).toEqual({ id: 4, owner: 1, controller: 1 });
  });

  it('setOwner to realm 0 leaves a province unowned; addRealm appends a realm', () => {
    const s = newGame(1, scenario);
    expect(applyCommand(s, { type: 'setOwner', province: 1, realm: 0 })).toBe(true);
    expect(s.provinces[1]).toEqual({ id: 1, owner: 0, controller: 0 });
    const realm = { ...scenario.realms[0]!, key: 'new', name: 'New' };
    expect(applyCommand(s, { type: 'addRealm', realm })).toBe(true);
    expect(s.realms[3]).toMatchObject({ id: 3, key: 'new' });
    expect(applyCommand(s, { type: 'setOwner', province: 1, realm: 3 })).toBe(true);
  });

  it('ignores invalid ownership commands', () => {
    const s = newGame(1, scenario);
    const before = hashState(s);
    expect(applyCommand(s, { type: 'setController', province: 5, realm: 1 })).toBe(false); // unowned sea
    expect(applyCommand(s, { type: 'setController', province: 1, realm: 9 })).toBe(false); // no such realm
    expect(applyCommand(s, { type: 'setOwner', province: 99, realm: 1 })).toBe(false);
    expect(applyCommand(s, { type: 'setOwner', province: 0, realm: 1 })).toBe(false);
    expect(hashState(s)).toBe(before);
  });
});

describe('save', () => {
  it('round-trips and the game continues identically', () => {
    const a = run(77, 400);
    applyCommand(a, { type: 'setController', province: 1, realm: 2 });
    const b = deserialize(serialize(a), ctx);
    expect(b).toEqual(a);
    tick(a); nextU32(a.rng);
    tick(b); nextU32(b.rng);
    expect(hashState(b)).toBe(hashState(a));
  });

  it('rejects garbage, foreign files, newer versions and corrupt state', () => {
    expect(() => deserialize('not json', ctx)).toThrow(SaveError);
    expect(() => deserialize('{"hello":1}', ctx)).toThrow(SaveError);
    const newer = JSON.stringify({ format: 'interregnum-save', saveVersion: SAVE_VERSION + 1, state: {} });
    expect(() => deserialize(newer, ctx)).toThrow(/newer/);
    const corrupt = JSON.parse(serialize(newGame(1, scenario)));
    corrupt.state.provinces[2].owner = 7; // realm that does not exist
    expect(() => deserialize(JSON.stringify(corrupt), ctx)).toThrow(/corrupt/);
  });

  it('rejects a save made with a different map', () => {
    const other: Scenario = { ...scenario, owner: [...scenario.owner, 1], controller: [...scenario.controller, 1] };
    const text = serialize(newGame(1, other));
    expect(() => deserialize(text, ctx)).toThrow(/different version of the map/);
  });

  it('upgrades a version 1 save by adding the start map', () => {
    const v1 = { format: 'interregnum-save', saveVersion: 1, state: { saveVersion: 1, seed: 5, rng: [1, 2, 3, 4], day: 3650, speed: 3, paused: false } };
    const s = deserialize(JSON.stringify(v1), ctx);
    expect(s.saveVersion).toBe(SAVE_VERSION);
    expect(s.day).toBe(3650);
    expect(s.provinces[4]).toEqual({ id: 4, owner: 2, controller: 1 });
    expect(s.realms[1]!.key).toBe('a');
  });

  it('migrate applies each step in order', () => {
    const table = {
      0: (s: Record<string, unknown>) => ({ ...s, a: true }),
      1: (s: Record<string, unknown>) => ({ ...s, b: true }),
    };
    expect(migrate({ saveVersion: 0 }, 0, ctx, table)).toEqual({ saveVersion: SAVE_VERSION, a: true, b: true });
    expect(() => migrate({}, -1, ctx, table)).toThrow(/No migration from save version -1/);
  });
});
