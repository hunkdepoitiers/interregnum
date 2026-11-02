import { describe, expect, it } from 'vitest';
import type { MapProvince } from '../src/content/map';
import { scenarioSourceSchema } from '../src/content/scenario';
import { peoplesSourceSchema } from '../src/content/peoples';
import { compileScenario, paintRegions, type MapContext } from '../tools/data-lib';
import { compilePeoples } from '../tools/peoples-lib';
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
const box = (w: number, e: number) => [[85, w], [85, e], [75, e], [75, w]];
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
