import { describe, expect, it } from 'vitest';
import { addModifier, explain, hasModifier, removeModifiers, statValue } from '../src/sim/modifiers';
import type { Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { content } from './fixtures/content';

// Realm 1 owns provinces 1 and 2, realm 2 owns province 3.
const scenario: Scenario = {
  realms: [
    { id: 1, key: 'a', name: 'A', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
    { id: 2, key: 'b', name: 'B', rank: 'duchy', government: 'feudal_monarchy', color: '#0000ff', capital: 3, overlord: 0, scripted: false },
  ],
  owner: [0, 1, 1, 2],
  controller: [0, 1, 1, 2],
};
const P1 = { kind: 'province', id: 1 } as const;
const P2 = { kind: 'province', id: 2 } as const;
const R1 = { kind: 'realm', id: 1 } as const;

describe('modifiers', () => {
  it('adds flat effects first, then percentages, and truncates', () => {
    const s = newGame(1, scenario);
    addModifier(s, content, 'capital', P1);
    addModifier(s, content, 'boom', P1);
    // (500 + 500) * (10000 + 1000) / 10000 = 1100
    expect(statValue(s, content, 'development', P1)).toBe(1100);
    expect(statValue(s, content, 'development', P2)).toBe(500);
  });

  it('explains every line and clamps to the stat range, keeping the raw value', () => {
    const s = newGame(1, scenario);
    addModifier(s, content, 'golden', P1);
    const e = explain(s, content, 'development', P1);
    expect(e).toMatchObject({ value: 2000, raw: 5500, base: 500, min: 0, max: 2000 });
    expect(e.lines).toEqual([{ label: 'Golden Age', op: 'add', value: 5000, inherited: false, modifierId: 1 }]);
  });

  it('lets a realm modifier reach the province stats of the provinces it owns', () => {
    const s = newGame(1, scenario);
    addModifier(s, content, 'crown', R1);
    expect(statValue(s, content, 'tax', P1)).toBe(5500);
    expect(explain(s, content, 'tax', P1).lines[0]).toMatchObject({ label: 'Strong Crown', inherited: true });
    expect(statValue(s, content, 'tax', { kind: 'province', id: 3 })).toBe(5000); // owned by realm 2
    expect(statValue(s, content, 'legitimacy', R1)).toBe(6500);
  });

  it('replaces or stacks as the definition says', () => {
    const s = newGame(1, scenario);
    addModifier(s, content, 'capital', P1);
    addModifier(s, content, 'capital', P1);
    expect(s.modifiers.filter((m) => m.def === 'capital')).toHaveLength(1);
    addModifier(s, content, 'boom', P1);
    addModifier(s, content, 'boom', P1);
    expect(statValue(s, content, 'development', P1)).toBe(1200); // 1000 * 1.2
    expect(removeModifiers(s, 'boom', P1)).toBe(2);
    expect(hasModifier(s, 'boom', P1)).toBe(false);
  });

  it('expires timed modifiers on the day they end', () => {
    const s = newGame(1, scenario);
    addModifier(s, content, 'famine', P1);
    expect(s.modifiers[0]).toMatchObject({ start: 0, end: 10 });
    for (let d = 1; d < 10; d++) expect(tick(s).modifiersChanged).toBe(false);
    expect(statValue(s, content, 'tax', P1)).toBe(3000);
    expect(tick(s).modifiersChanged).toBe(true);
    expect(statValue(s, content, 'tax', P1)).toBe(5000);
  });

  it('ignores unknown modifiers and rejects a stat on the wrong kind of target', () => {
    const s = newGame(1, scenario);
    expect(addModifier(s, content, 'nothing', P1)).toBeNull();
    expect(() => explain(s, content, 'legitimacy', P1)).toThrow(/belongs to a realm/);
  });
});
