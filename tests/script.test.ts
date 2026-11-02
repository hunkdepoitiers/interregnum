import { describe, expect, it } from 'vitest';
import { modifiersSourceSchema, statsSourceSchema, conditionSchema } from '../src/content/content';
import { addModifier, hasModifier } from '../src/sim/modifiers';
import type { Scenario } from '../src/sim/scenario';
import { check, run } from '../src/sim/script';
import { newGame } from '../src/sim/state';
import { checkActions, compileCondition, compileContent } from '../tools/content-lib';
import { content } from './fixtures/content';

const scenario: Scenario = {
  realms: [{ id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false }],
  owner: [0, 1, 0],
  controller: [0, 1, 0],
};
const P1 = { kind: 'province', id: 1 } as const;

describe('conditions and actions', () => {
  it('checks modifiers, stat thresholds and the owner scope', () => {
    const s = newGame(1, scenario);
    addModifier(s, content, 'crown', { kind: 'realm', id: 1 });
    expect(check(s, content, { stat_at_least: { stat: 'tax', value: 5500 } }, P1)).toBe(true);
    expect(check(s, content, { stat_below: { stat: 'tax', value: 5500 } }, P1)).toBe(false);
    expect(check(s, content, { owner: { has_modifier: 'crown' } }, P1)).toBe(true);
    expect(check(s, content, { owner: { has_modifier: 'crown' } }, { kind: 'province', id: 2 })).toBe(false); // unowned
    expect(check(s, content, { all: [{ has_modifier: 'crown' }, { not: { has_modifier: 'famine' } }] }, { kind: 'realm', id: 1 })).toBe(true);
    expect(check(s, content, { any: [{ has_modifier: 'famine' }, { has_modifier: 'boom' }] }, P1)).toBe(false);
  });

  it('adds and removes modifiers, also on the owner', () => {
    const s = newGame(1, scenario);
    run(s, content, [{ add_modifier: 'famine' }, { owner: [{ add_modifier: 'crown' }] }], P1);
    expect(hasModifier(s, 'famine', P1)).toBe(true);
    expect(hasModifier(s, 'crown', { kind: 'realm', id: 1 })).toBe(true);
    run(s, content, [{ remove_modifier: 'famine' }], P1);
    expect(hasModifier(s, 'famine', P1)).toBe(false);
  });
});

describe('content compiler', () => {
  it('converts stats and effects to hundredths and checks references', () => {
    const stats = statsSourceSchema.parse({ province: [{ key: 'dev', label: 'Dev', base: 5, min: 0, max: 100, format: 'number' }] });
    const mods = modifiersSourceSchema.parse([
      { key: 'up', label: 'Up', days: 30, effects: [{ stat: 'dev', add: 2.5 }, { stat: 'dev', pct: -10 }] },
      { key: 'bad', label: 'Bad', effects: [{ stat: 'nope', add: 1 }] },
    ]);
    const { content: c, errors } = compileContent(stats, mods);
    expect(c.stats.dev).toMatchObject({ base: 500, max: 10000, scope: 'province' });
    expect(c.modifiers.up).toMatchObject({ stacking: 'replace', days: 30, effects: [{ op: 'add', value: 250 }, { op: 'pct', value: -1000 }] });
    expect(errors).toEqual(['Modifier bad: unknown stat nope']);
  });

  it('rejects effects with both or neither of add and pct, and bad ranges', () => {
    expect(() => modifiersSourceSchema.parse([{ key: 'x', label: 'X', effects: [{ stat: 'dev', add: 1, pct: 1 }] }])).toThrow();
    const stats = statsSourceSchema.parse({ realm: [{ key: 'l', label: 'L', base: 200, min: 0, max: 100, format: 'number' }] });
    expect(compileContent(stats, []).errors).toEqual(['Stat l: base is outside min..max']);
  });

  it('compiles conditions to hundredths and reports unknown keys', () => {
    const errors: string[] = [];
    const cond = compileCondition(conditionSchema.parse({ all: [{ stat_at_least: { stat: 'tax', value: 55 } }, { has_modifier: 'nope' }] }), content, errors, 'test');
    expect(cond).toEqual({ all: [{ stat_at_least: { stat: 'tax', value: 5500 } }, { has_modifier: 'nope' }] });
    checkActions([{ owner: [{ add_modifier: 'gone' }] }], content, errors, 'test');
    expect(errors).toEqual(['test: unknown modifier nope', 'test: unknown modifier gone']);
  });
});
