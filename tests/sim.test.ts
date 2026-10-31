import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/sim/commands';
import { hashState } from '../src/sim/hash';
import { nextU32 } from '../src/sim/rng';
import { deserialize, migrate, SaveError, serialize } from '../src/sim/save';
import { newGame, SAVE_VERSION } from '../src/sim/state';
import { tick } from '../src/sim/tick';

function run(seed: number, days: number) {
  const s = newGame(seed);
  for (let i = 0; i < days; i++) {
    tick(s);
    nextU32(s.rng); // stand-in for systems that will consume randomness each day
  }
  return s;
}

describe('tick', () => {
  it('reports month and year starts', () => {
    const s = newGame(1);
    const results = Array.from({ length: 160 }, () => tick(s));
    expect(results.filter((r) => r.monthStart).map((r) => r.day)).toEqual([5, 36, 66, 97, 127, 158]);
    expect(results.filter((r) => r.yearStart).map((r) => r.day)).toEqual([158]);
  });

  it('is deterministic over ten years', () => {
    expect(hashState(run(1302, 3650))).toBe(hashState(run(1302, 3650)));
    expect(hashState(run(1302, 3650))).not.toBe(hashState(run(1303, 3650)));
  });
});

describe('commands', () => {
  it('set speed and pause', () => {
    const s = newGame(1);
    applyCommand(s, { type: 'setSpeed', speed: 5 });
    applyCommand(s, { type: 'togglePause' });
    expect(s.speed).toBe(5);
    expect(s.paused).toBe(false);
  });
});

describe('save', () => {
  it('round-trips and the game continues identically', () => {
    const a = run(77, 400);
    const b = deserialize(serialize(a));
    expect(b).toEqual(a);
    tick(a); nextU32(a.rng);
    tick(b); nextU32(b.rng);
    expect(hashState(b)).toBe(hashState(a));
  });

  it('rejects garbage, foreign files, newer versions and corrupt state', () => {
    expect(() => deserialize('not json')).toThrow(SaveError);
    expect(() => deserialize('{"hello":1}')).toThrow(SaveError);
    const newer = JSON.stringify({ format: 'interregnum-save', saveVersion: SAVE_VERSION + 1, state: {} });
    expect(() => deserialize(newer)).toThrow(/newer/);
    const corrupt = JSON.stringify({ format: 'interregnum-save', saveVersion: SAVE_VERSION, state: { day: -1 } });
    expect(() => deserialize(corrupt)).toThrow(/corrupt/);
  });

  it('migrate applies each step in order', () => {
    const table = { 0: (s: Record<string, unknown>) => ({ ...s, added: true }) };
    const out = migrate({ saveVersion: 0 }, 0, table);
    expect(out).toEqual({ saveVersion: 1, added: true });
    expect(() => migrate({}, -1, table)).toThrow(/No migration from save version -1/);
  });
});
