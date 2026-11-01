import { describe, expect, it } from 'vitest';
import type { ProvinceDefinition } from '../src/content/map';
import { buildMap, encodeIdTile } from '../tools/map-lib';

const COLORS: Record<string, number> = { A: 0xff0000, B: 0x00ff00, S: 0x0000ff, X: 0x123456 };

/** Builds an RGBA image from rows of letters, one letter per pixel. */
function image(rows: string[]) {
  const width = rows[0]!.length;
  const height = rows.length;
  const data = new Uint8Array(width * height * 4);
  rows.join('').split('').forEach((ch, p) => {
    const c = COLORS[ch]!;
    data[p * 4] = c >> 16;
    data[p * 4 + 1] = (c >> 8) & 255;
    data[p * 4 + 2] = c & 255;
    data[p * 4 + 3] = 255;
  });
  return { width, height, data };
}

const defs: ProvinceDefinition[] = [
  { id: 1, key: 'a', name: 'A', kind: 'land', color: '#ff0000' },
  { id: 2, key: 'b', name: 'B', kind: 'land', color: '#00ff00' },
  { id: 3, key: 's', name: 'S', kind: 'sea', color: '#0000ff' },
];

describe('buildMap', () => {
  it('computes ids, size, centroid, adjacency and coastal flags', () => {
    const m = buildMap(image(['AAB', 'AAB', 'SSS']), defs, []);
    expect(m.errors).toEqual([]);
    expect([...m.idMap]).toEqual([1, 1, 2, 1, 1, 2, 3, 3, 3]);
    const a = m.provinces.find((p) => p.key === 'a')!;
    expect(a.pixels).toBe(4);
    expect(a.bbox).toEqual([0, 0, 1, 1]);
    expect(a.centroid).toEqual([1, 1]); // 0.5 rounds up
    expect(a.adjacency).toEqual([{ id: 2, border: 2 }, { id: 3, border: 2 }]);
    expect(a.coastal).toBe(true);
    expect(m.provinces.find((p) => p.key === 's')!.coastal).toBe(false);
  });

  it('reports undefined colours as errors', () => {
    const m = buildMap(image(['AX', 'AA']), defs, []);
    expect(m.errors).toEqual(['Undefined colour #123456 first seen at (1, 0)']);
  });

  it('warns about split and missing provinces', () => {
    const m = buildMap(image(['ASA', 'SSS']), defs, []);
    expect(m.warnings).toContain('a: split into 2 separate areas');
    expect(m.warnings).toContain('b: defined but not on the map');
  });

  it('adds strait adjacencies and rejects unknown keys', () => {
    const m = buildMap(image(['ASB']), defs, [['a', 'b'], ['a', 'nowhere']]);
    expect(m.provinces.find((p) => p.key === 'a')!.adjacency).toContainEqual({ id: 2, border: 0, strait: true });
    expect(m.provinces.find((p) => p.key === 'b')!.adjacency).toContainEqual({ id: 1, border: 0, strait: true });
    expect(m.errors).toEqual(['Strait a - nowhere: unknown province key']);
  });

  it('encodes ids above 255 across R and G', () => {
    expect([...encodeIdTile(Uint16Array.from([0x1234]), 1, 0, 0, 1, 1)]).toEqual([0x34, 0x12, 0, 255]);
  });

  it('encodes a tile from the middle of the map', () => {
    // 3x2 map; the tile is the 2x1 block starting at (1, 1).
    const ids = Uint16Array.from([1, 2, 3, 4, 5, 0x0106]);
    expect([...encodeIdTile(ids, 3, 1, 1, 2, 1)]).toEqual([5, 0, 0, 255, 6, 1, 0, 255]);
  });
});
