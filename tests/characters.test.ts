import { describe, expect, it } from 'vitest';
import { heirOf, monthlyCharacters, skillsOf, startCharacters } from '../src/sim/characters';
import { emptyCharacters, emptyFaith, emptyEconomy, type Content, type ModifierDef, type StatDef } from '../src/sim/content';
import type { EconomyContext } from '../src/sim/economy';
import { hashState } from '../src/sim/hash';
import { explain, hasModifier } from '../src/sim/modifiers';
import { deserialize, serialize } from '../src/sim/save';
import type { Character, Scenario } from '../src/sim/scenario';
import { newGame } from '../src/sim/state';
import { tick } from '../src/sim/tick';

const stat = (key: string, base: number): StatDef => ({ key, scope: 'realm', label: key, description: '', base, min: 0, max: 10000, format: 'number' });
const mod = (key: string, effects: ModifierDef['effects'], days: number | null = null): ModifierDef =>
  ({ key, label: key, description: '', stacking: 'replace', days, effects });

const content: Content = {
  stats: { legitimacy: stat('legitimacy', 6000), levy_size: stat('levy_size', 1000) },
  modifiers: Object.fromEntries([
    mod('regency', [{ stat: 'legitimacy', op: 'add', value: -1500 }]),
    mod('new_reign', [{ stat: 'legitimacy', op: 'add', value: -1000 }], 730),
    mod('dynasty_change', [{ stat: 'legitimacy', op: 'add', value: -2000 }], 3650),
    mod('pretender', [{ stat: 'legitimacy', op: 'add', value: -1000 }], 3650),
    mod('ruler_eminence', [{ stat: 'legitimacy', op: 'add', value: 100 }]),
    mod('council_chancellor', [{ stat: 'legitimacy', op: 'add', value: 50 }]),
  ].map((m) => [m.key, m])),
  cultures: [], religions: [],
  titles: { counties: [], duchies: [], kingdoms: [], empires: [], hegemonies: [] },
  goods: [],
  economy: emptyEconomy(),
  characters: {
    ...emptyCharacters(),
    council: [{ role: 'chancellor', skill: 0, modifier: 'council_chancellor' }],
    laws: ['agnatic', 'cognatic', 'open', 'elective', 'republic', 'theocracy'].map((key) => ({ key, name: key, description: '' })),
  },
  faith: emptyFaith(),
};

const Y = 365.25;
const born = (age: number) => -Math.round(age * Y);
let nextId = 1;
const person = (o: Partial<Character> & { name: string; age: number }): Character => ({
  id: nextId++, dynasty: 1, female: false, born: born(o.age), died: null, father: 0, mother: 0, spouse: 0, culture: 0, religion: 0,
  skills: [10, 10, 10], education: null, traits: [], health: 70, ...o,
});

/**
 * Realm 1: King Old (dead father of Old and Brother) with a daughter Ann (20), a son Baby (4) by Queen Q, and a brother
 * whose son Nephew (25) is grown. Realm 2 is a republic with an empty council.
 */
function scenario(law: string): Scenario {
  nextId = 1;
  const grandfather = person({ name: 'Grandfather', age: 80, died: -1000 });
  const king = person({ name: 'Old', age: 50, father: grandfather.id, skills: [14, 10, 10] });
  const queen = person({ name: 'Q', age: 40, female: true, dynasty: 2, spouse: king.id });
  king.spouse = queen.id;
  const ann = person({ name: 'Ann', age: 20, female: true, father: king.id, mother: queen.id });
  const baby = person({ name: 'Baby', age: 4, father: king.id, mother: queen.id });
  const brother = person({ name: 'Brother', age: 45, father: grandfather.id, died: -10 });
  const nephew = person({ name: 'Nephew', age: 25, father: brother.id, skills: [12, 12, 15] });
  const doge = person({ name: 'Doge', age: 70, dynasty: 3 });
  return {
    realms: [
      { id: 1, key: 'k', name: 'Kingdom', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false },
      { id: 2, key: 'r', name: 'Republic', rank: 'county', government: 'merchant_republic', color: '#0000ff', capital: 2, overlord: 0, scripted: false },
    ],
    owner: [0, 1, 2], controller: [0, 1, 2],
    characters: [grandfather, king, queen, ann, baby, brother, nephew, doge],
    dynasties: [{ id: 1, name: 'Royal' }, { id: 2, name: 'Queenly' }, { id: 3, name: 'Merchant' }],
    courts: [
      { ruler: king.id, regent: 0, law, council: [], claimant: 0, since: 0 },
      { ruler: doge.id, regent: 0, law: 'republic', council: [], claimant: 0, since: 0 },
    ],
    seats: ['Capital', 'Port'],
  };
}

const ctx: EconomyContext = { content, goods: [], seats: ['Capital', 'Port'] };
const game = (law: string) => {
  const s = newGame(7, scenario(law));
  startCharacters(s, ctx);
  return s;
};
const id = (s: ReturnType<typeof game>, name: string) => s.characters.findIndex((c) => c?.name === name);

describe('heirs', () => {
  it('passes over daughters under agnatic law but takes the eldest son', () => {
    const s = game('agnatic');
    expect(heirOf(s, content, 1)).toBe(id(s, 'Baby'));
    s.characters[id(s, 'Baby')]!.died = 0;
    expect(heirOf(s, content, 1)).toBe(id(s, 'Nephew')); // the brother's line, since Ann cannot inherit
  });

  it('lets a daughter inherit before cousins under cognatic law, sons first', () => {
    const s = game('cognatic');
    expect(heirOf(s, content, 1)).toBe(id(s, 'Baby'));
    s.characters[id(s, 'Baby')]!.died = 0;
    expect(heirOf(s, content, 1)).toBe(id(s, 'Ann'));
  });

  it('gives an open succession to the ablest grown man of the line when no son is grown', () => {
    const s = game('open');
    expect(heirOf(s, content, 1)).toBe(id(s, 'Baby')); // the only son, grown or not
  });
});

describe('succession', () => {
  it('crowns a child under the regency of his mother', () => {
    const s = game('agnatic');
    s.characters[id(s, 'Old')]!.died = s.day;
    const notices = monthlyCharacters(s, ctx);
    const court = s.courts[1]!;
    expect(court.ruler).toBe(id(s, 'Baby'));
    expect(court.regent).toBe(id(s, 'Q'));
    expect(hasModifier(s, 'regency', { kind: 'realm', id: 1 })).toBe(true);
    expect(hasModifier(s, 'new_reign', { kind: 'realm', id: 1 })).toBe(true);
    expect(notices[0]!.text).toMatch(/Baby, a child under the regency of Q/);
    // At sixteen the regency ends.
    s.day += Math.round(12 * Y);
    monthlyCharacters(s, ctx);
    expect(s.courts[1]!.regent).toBe(0);
    expect(hasModifier(s, 'regency', { kind: 'realm', id: 1 })).toBe(false);
  });

  it('brings in a new house when the blood runs out', () => {
    const s = game('agnatic');
    for (const n of ['Old', 'Baby', 'Nephew']) s.characters[id(s, n)]!.died = s.day;
    monthlyCharacters(s, ctx);
    const ruler = s.characters[s.courts[1]!.ruler]!;
    expect(ruler.dynasty).not.toBe(1);
    expect(s.dynasties[ruler.dynasty]!.name).toBe('of Capital');
    expect(hasModifier(s, 'dynasty_change', { kind: 'realm', id: 1 })).toBe(true);
  });

  it('elects a republic’s ruler from its council', () => {
    const s = game('agnatic');
    const councillor = s.courts[2]!.council[0]!;
    expect(councillor).toBeGreaterThan(0);
    s.characters[id(s, 'Doge')]!.died = s.day;
    monthlyCharacters(s, ctx);
    expect(s.courts[2]!.ruler).toBe(councillor);
  });
});

describe('the ruler’s mark', () => {
  it('scales the ruler’s modifiers by skill above the pivot', () => {
    const s = game('agnatic');
    const old = s.characters[id(s, 'Old')]!;
    expect(skillsOf(content, old, s.day)[0]).toBe(14);
    const line = explain(s, content, 'legitimacy', { kind: 'realm', id: 1 }).lines.find((l) => l.label === 'ruler_eminence');
    expect(line?.value).toBe(400);
  });
});

describe('the years', () => {
  it('runs decades the same way twice, always with a living ruler, and saves it all', () => {
    const deadly: EconomyContext = { ...ctx, content: { ...content, characters: { ...content.characters, mortality: [[0, 100]], fertility: { chance: 400, lateChance: 100, from: 16, late: 35, until: 43 }, marriage: { chance: 2000, age: 16 } } } };
    const run = () => {
      const s = newGame(7, scenario('cognatic'));
      startCharacters(s, deadly);
      for (let i = 0; i < 365 * 40; i++) tick(s, deadly);
      return s;
    };
    const a = run();
    expect(hashState(a)).toBe(hashState(run()));
    for (const court of a.courts.slice(1)) expect(a.characters[court!.ruler]!.died).toBeNull();
    expect(a.courts[1]!.ruler).not.toBe(2); // the old king is long gone
    const back = deserialize(serialize(a), { scenario: scenario('cognatic'), economy: deadly });
    expect(hashState(back)).toBe(hashState(a));
  });
});
