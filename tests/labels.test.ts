import { describe, expect, it } from 'vitest';
import type { MapData, MapProvince } from '../src/content/map';
import { computeLabels, shortName } from '../src/render/labels';
import type { WorldView } from '../src/worker/protocol';

describe('shortName', () => {
  it('drops the title before "of"', () => {
    expect(shortName('Kingdom of Castile')).toBe('Castile');
    expect(shortName('Beylik of the Ottomans')).toBe('Ottomans');
    expect(shortName('Grand Principality of Tver')).toBe('Tver');
    expect(shortName('Golden Horde')).toBe('Golden Horde');
  });
});

describe('computeLabels', () => {
  // A row of five land provinces 100 px apart; realm 1 owns all but the last, which is cut off by water.
  const prov = (id: number, x: number, adj: number[]): MapProvince => ({
    id, key: `p${id}`, name: `p${id}`, kind: 'land', color: '#000000', pixels: 1000, bbox: [x - 50, 0, x + 50, 40],
    centroid: [x, 20], coastal: false, adjacency: adj.map((a) => ({ id: a, border: 10 })),
  });
  const map = { provinces: [prov(1, 0, [2]), prov(2, 100, [1, 3]), prov(3, 200, [2]), prov(4, 600, [])] } as MapData;
  const world: WorldView = {
    realms: [null, { id: 1, key: 'x', name: 'Kingdom of Testland', rank: 'kingdom', government: 'feudal_monarchy', color: '#ff0000', capital: 1, overlord: 0, scripted: false }],
    owner: new Uint16Array([0, 1, 1, 1, 1]),
    controller: new Uint16Array([0, 1, 1, 1, 1]),
    modifiers: [],
  };

  it('labels the largest connected piece along its long axis', () => {
    const [label] = computeLabels(map, world);
    expect(label).toMatchObject({ realm: 1, text: 'TESTLAND', x: 100, y: 20, angle: 0 });
    expect(label!.size).toBeGreaterThan(0);
  });
});
