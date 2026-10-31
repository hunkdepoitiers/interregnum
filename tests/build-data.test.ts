import { describe, expect, it } from 'vitest';
import type { MapProvince } from '../src/content/map';
import { scenarioSourceSchema, type ScenarioSource } from '../src/content/scenario';
import { compileScenario } from '../tools/data-lib';

function prov(id: number, key: string, kind: MapProvince['kind'], adj: number[]): MapProvince {
  return {
    id, key, name: key, kind, color: '#000000', pixels: 1, bbox: [0, 0, 0, 0], centroid: [0, 0], coastal: false,
    adjacency: adj.map((a) => ({ id: a, border: 1 })),
  };
}
// a - b - c (land), s (sea) next to c, w (wasteland)
const provinces = [prov(1, 'a', 'land', [2]), prov(2, 'b', 'land', [1, 3]), prov(3, 'c', 'land', [2, 4]),
  prov(4, 's', 'sea', [3]), prov(5, 'w', 'wasteland', [])];

function realm(key: string, provs: string[], extra: Partial<ScenarioSource['realms'][number]> = {}) {
  return { key, name: key, rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: provs[0], provinces: provs, ...extra };
}
const compile = (raw: object) => compileScenario(scenarioSourceSchema.parse(raw), provinces);

describe('compileScenario', () => {
  it('resolves keys to ids and copies owner into controller', () => {
    const { scenario, errors } = compile({
      realms: [realm('x', ['a', 'b']), realm('y', ['c'], { overlord: 'x', color: '#0000ff' })],
      occupations: { b: 'y' },
    });
    expect(errors).toEqual([]);
    expect(scenario.owner).toEqual([0, 1, 1, 2, 0, 0]);
    expect(scenario.controller).toEqual([0, 1, 2, 2, 0, 0]);
    expect(scenario.realms[1]).toMatchObject({ id: 2, key: 'y', capital: 3, overlord: 1, scripted: false });
  });

  it('rejects double ownership, unknown keys, water and a capital outside the realm', () => {
    const { errors } = compile({
      realms: [realm('x', ['a', 'b', 's', 'nowhere']), realm('y', ['b', 'c'], { capital: 'a' })],
    });
    expect(errors).toEqual([
      'Realm x: s is sea, only land can be owned',
      'Realm x: unknown province nowhere',
      'Province b is owned by both x and y',
      'Realm y: capital a is not one of its provinces',
    ]);
  });

  it('requires every land province to be owned or explicitly unclaimed', () => {
    expect(compile({ realms: [realm('x', ['a', 'b'])] }).errors).toEqual([
      'Land province c has no owner (list it under unclaimed if intended)',
    ]);
    expect(compile({ realms: [realm('x', ['a', 'b'])], unclaimed: ['c'] }).errors).toEqual([]);
  });

  it('rejects unknown and looping overlords and bad occupations', () => {
    const { errors } = compile({
      realms: [realm('x', ['a'], { overlord: 'y' }), realm('y', ['b'], { overlord: 'x' }), realm('z', ['c'], { overlord: 'q' })],
      occupations: { c: 'nobody' },
    });
    expect(errors).toContain('Realm z: unknown overlord q');
    expect(errors).toContain('Realm x: overlord chain loops');
    expect(errors).toContain('occupations: unknown realm nobody');
  });

  it('warns when bordering realms share nearly the same colour', () => {
    const { warnings } = compile({
      realms: [realm('x', ['a']), realm('y', ['b'], { color: '#f80808' }), realm('z', ['c'], { color: '#00ff00' })],
    });
    expect(warnings).toEqual(['Neighbouring realms x and y have similar colours (distance 13)']);
  });
});
