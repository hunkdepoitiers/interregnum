import { describe, expect, it } from 'vitest';
import type { MapProvince } from '../src/content/map';
import { scenarioSourceSchema } from '../src/content/scenario';
import { peoplesSourceSchema } from '../src/content/peoples';
import { compileScenario, paintRegions, type MapContext } from '../tools/data-lib';
import { compilePeoples } from '../tools/peoples-lib';
import { compileTitles } from '../tools/titles-lib';
import { compileGoods } from '../tools/goods-lib';
import { goodsSourceSchema } from '../src/content/goods';
import { generatedTitlesSchema, upperTitlesSchema } from '../src/content/titles';
import { content } from './fixtures/content';

// One pixel per degree: x = lon + 180, y = 90 - lat.
const ctx: MapContext = {
  projection: { width: 360, west: -180, east: 180, north: 90, south: -90, standardParallel: 0 },
  towns: new Map([['acity', [80, -170]], ['ccity', [80, -130]], ['atsea', [80, 0]]]),
};

function prov(id: number, key: string, kind: MapProvince['kind'], x: number, adj: number[]): MapProvince {
  return {
    id, key, name: key, kind, color: '#000000', pixels: 100, bbox: [x - 5, 5, x + 5, 15], centroid: [x, 10], coastal: false,
    adjacency: adj.map((a) => ({ id: a, border: 1 })),
  };
}
// a - b - c (land, centres at lon -170, -150, -130 on lat 80), s (sea, lon -110) next to c, w (wasteland)
const provinces = [prov(1, 'a', 'land', 10, [2]), prov(2, 'b', 'land', 30, [1, 3]), prov(3, 'c', 'land', 50, [2, 4]),
  prov(4, 's', 'sea', 70, [3]), prov(5, 'w', 'wasteland', 90, [])];

/** Box around the given longitudes on lat 75–85. */
const box = (w: number, e: number): [number, number][] => [[85, w], [85, e], [75, e], [75, w]];
function realm(key: string, extra: object = {}) {
  return { key, name: key, rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 'acity', ...extra };
}
const compile = (raw: object) => compileScenario(scenarioSourceSchema.parse(raw), provinces, ctx);

describe('compileScenario', () => {
  it('paints outlines in order, lets capitals and added places override them, and applies occupations', () => {
    const { scenario, errors, unowned } = compile({
      realms: [
        realm('x', { area: [box(-180, -120)] }),
        realm('y', { area: [box(-160, -140)], capital: 'ccity', overlord: 'x', color: '#0000ff' }),
        realm('z', { capital: [80, -150], add: [], color: '#00ff00' }),
      ],
      occupations: [['acity', 'y']],
    });
    expect(errors).toEqual([]);
    // b is in y's outline, then named as z's capital; c is in x's outline but is y's capital.
    expect(scenario.owner).toEqual([0, 1, 3, 2, 0, 0]);
    expect(scenario.controller).toEqual([0, 2, 3, 2, 0, 0]);
    expect(scenario.realms[1]).toMatchObject({ id: 2, key: 'y', capital: 3, overlord: 1, scripted: false });
    expect(unowned).toBe(0);
  });

  it('counts land nobody owns', () => {
    expect(compile({ realms: [realm('x')] }).unowned).toBe(2);
  });

  it('gives gaps inside a fill outline to the nearest realm over land', () => {
    const { scenario, unowned } = compile({ realms: [realm('x')], fill: [box(-160, -140)] });
    expect(scenario.owner).toEqual([0, 1, 1, 0, 0, 0]); // c lies outside the fill outline
    expect(unowned).toBe(1);
  });

  it('applies editor overrides last and leaves out realms they paint over completely', () => {
    const { scenario, errors, warnings } = compile({
      realms: [realm('x', { area: [box(-180, -120)] }), realm('y', { capital: [80, -150], color: '#0000ff' }),
        realm('z', { capital: 'ccity', overlord: 'y', color: '#00ff00' })],
      overrides: [[80, -150, 'x'], [80, -170, null]],
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual(['Realm y lost all its land to edits and is left out']);
    expect(scenario.owner).toEqual([0, 0, 1, 2, 0, 0]);
    expect(scenario.realms.map((r) => [r.id, r.key, r.overlord])).toEqual([[1, 'x', 0], [2, 'z', 0]]);
  });

  it('puts capital on every capital and the listed realm modifiers in force', () => {
    const { scenario, errors } = compileScenario(scenarioSourceSchema.parse({
      realms: [realm('x', { area: [box(-180, -120)] })],
      modifiers: [['x', 'crown'], ['x', 'famine'], ['nobody', 'crown'], ['x', 'missing']],
    }), provinces, { ...ctx, content });
    expect(scenario.modifiers).toEqual([
      { def: 'capital', target: { kind: 'province', id: 1 }, end: null },
      { def: 'crown', target: { kind: 'realm', id: 1 }, end: null },
      { def: 'famine', target: { kind: 'realm', id: 1 }, end: 10 },
    ]);
    expect(errors).toEqual(['modifiers: unknown realm nobody', 'modifiers: x: unknown modifier missing']);
  });

  it('rejects unknown towns, places off the land, double naming and empty realms', () => {
    const { errors } = compile({
      realms: [realm('x', { add: ['nowhere', 'atsea'] }), realm('y', { add: ['acity'], capital: 'ccity' }),
        realm('e', { capital: 'nowhere' })],
    });
    expect(errors).toEqual([
      'Realm x add "nowhere": unknown town nowhere',
      'Realm x add "atsea": "atsea" is not on land',
      'Province a is named by both x and y',
      'Realm e capital: unknown town nowhere',
      'Realm x owns no provinces',
      'Realm e owns no provinces',
    ]);
  });

  it('rejects unknown and looping overlords and bad occupations', () => {
    const { errors } = compile({
      realms: [realm('x', { overlord: 'y' }), realm('y', { capital: [80, -150], overlord: 'x' }),
        realm('z', { capital: 'ccity', overlord: 'q' })],
      occupations: [['acity', 'nobody']],
    });
    expect(errors).toContain('Realm z: unknown overlord q');
    expect(errors).toContain('Realm x: overlord chain loops');
    expect(errors).toContain('occupations: unknown realm nobody');
  });

  it('warns when bordering realms share nearly the same colour', () => {
    const { warnings } = compile({
      realms: [realm('x'), realm('y', { capital: [80, -150], color: '#f80808' }), realm('z', { capital: 'ccity', color: '#00ff00' })],
    });
    expect(warnings).toEqual(['Neighbouring realms x and y have similar colours (distance 13)']);
  });
});

describe('paintRegions and compilePeoples', () => {
  it('paints in order, adds on top, fills over land and reaches islands by distance', () => {
    const errors: string[] = [];
    const islands = [...provinces, prov(6, 'isle', 'land', 130, [])];
    const out = paintRegions([{ area: [box(-180, -140)], add: [] }, { area: [], add: ['acity'] }], [box(-180, 180)], islands, ctx, errors, (i) => `r${i}`);
    expect(errors).toEqual([]);
    expect(out).toEqual([0, 2, 1, 1, 0, 0, 1]); // c filled from b; the island takes its nearest painted province
  });

  it('gives each province its culture and the culture religion, unless a religion area paints over it', () => {
    const src = peoplesSourceSchema.parse({
      religions: [{ key: 'old', name: 'Old', family: 'pagan', color: '#111111' }, { key: 'new', name: 'New', family: 'x', color: '#222222' }],
      groups: { g: 'Group' },
      cultures: [{ key: 'one', name: 'One', group: 'g', religion: 'old', color: '#333333', area: [box(-180, -120)] },
        { key: 'bad', name: 'Bad', group: 'nope', religion: 'gone', color: '#444444', add: ['ccity'] }],
      religion_areas: [{ religion: 'new', add: ['acity'] }],
    });
    const r = compilePeoples(src, provinces, ctx);
    expect(r.culture).toEqual([0, 1, 1, 2, 0, 0]);
    expect(r.religion).toEqual([0, 2, 1, 0, 0, 0]);
    expect(r.cultures[0]).toMatchObject({ key: 'one', groupName: 'Group', religion: 1 });
    expect(r.errors).toEqual(['Culture bad: unknown group nope', 'Culture bad: unknown religion gone']);
  });
});

describe('compileTitles', () => {
  const gen = generatedTitlesSchema.parse({
    areas: { a_alpha: 'Alpha', a_beta: 'Beta' },
    counties: [['c_a', 'County of A', 'a', ['a', 'b']], ['c_c', 'County of C', 'c', ['c']]],
    duchies: [['d_ab', 'Duchy of AB', 'a_alpha', ['c_a']], ['d_c', 'Duchy of C', 'a_beta', ['c_c']]],
  });

  it('links counties to the drawn duchy or their generated one, up through kingdoms and empires to hegemonies', () => {
    const upper = upperTitlesSchema.parse({
      kingdoms: [{ key: 'k_west', name: 'the West', duchies: [['d_west', 'the West', box(-180, -140)]] }],
      empires: [
        { key: 'e_west', name: 'Empire of the West', kingdoms: ['k_west'] },
        { key: 'e_all', name: 'Empire of All', area: [box(-180, 180)] },
      ],
      hegemonies: [{ key: 'h_top', name: 'Top', de_jure: true, empires: ['e_all'] }, { key: 'h_dream', name: 'Dream', empires: ['e_all'] }],
    });
    const { titles, county, errors } = compileTitles(gen, upper, provinces, ctx);
    expect(errors).toEqual([]);
    expect(county).toEqual([0, 1, 1, 2, 0, 0]);
    expect(titles.counties.map((c) => [c.parent, c.capital])).toEqual([[1, 1], [2, 3]]);
    expect(titles.duchies.map((d) => [d.key, d.parent])).toEqual([['d_west', 1], ['d_c', 2]]);
    expect(titles.kingdoms.map((k) => [k.key, k.name, k.parent])).toEqual([['k_west', 'Kingdom of the West', 1], ['k_beta', 'Kingdom of Beta', 2]]);
    expect(titles.empires[1]!.parent).toBe(1); // the de jure hegemony, not the formable one
    expect(titles.hegemonies.map((h) => [h.key, h.deJure, h.empires])).toEqual([['h_top', true, [2]], ['h_dream', false, [2]]]);
  });

  it('reports stale province keys, unknown members and a kingdom in two empires', () => {
    const stale = generatedTitlesSchema.parse({ ...gen, counties: [...gen.counties, ['c_x', 'County of X', 'gone', ['gone']]] });
    const upper = upperTitlesSchema.parse({
      kingdoms: [{ key: 'k_west', name: 'W', duchies: [['d_w', 'W', box(-180, -140)]] }],
      empires: [{ key: 'e_1', name: 'E1', kingdoms: ['k_west'] }, { key: 'e_2', name: 'E2', kingdoms: ['k_west', 'k_nowhere'] }],
    });
    expect(compileTitles(stale, upper, provinces, ctx).errors).toEqual([
      'data/map/titles.yaml names 1 provinces the map does not have; run tools/build_titles.py',
      'Kingdom k_west is in two empires',
      'Empire e_2: unknown kingdom k_nowhere',
    ]);
  });
});

describe('compileGoods', () => {
  it('takes the first matching rule, then famous places on top', () => {
    const src = goodsSourceSchema.parse({
      goods: [{ key: 'grain', name: 'Grain', color: '#ffff00' }, { key: 'fur', name: 'Fur', color: '#000000' }, { key: 'wine', name: 'Wine', color: '#880000' }],
      rules: [{ good: 'fur', region: [[70, -175, 90, -165]] }, { good: 'grain' }],
      places: [['wine', 'ccity']],
    });
    const { good, errors } = compileGoods(src, provinces, ctx);
    expect(errors).toEqual([]);
    expect(good).toEqual([0, 2, 1, 3, 0, 0]); // a in the fur box, b grain, c the wine place; sea and wasteland none
  });
});
