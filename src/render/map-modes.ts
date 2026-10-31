import type { MapData, ProvinceKind } from '../content/map';

/** Width of the lookup texture, i.e. the highest province id + 1 the renderer supports. */
export const LOOKUP_SIZE = 4096;

const PARCHMENT: [number, number, number] = [214, 196, 158];
const KIND_COLOR: Record<Exclude<ProvinceKind, 'land'>, [number, number, number]> = {
  sea: [44, 74, 104],
  lake: [58, 98, 130],
  wasteland: [128, 118, 100],
};

/**
 * Terrain-style base map mode for M1: land is parchment tinted by each province's bitmap colour,
 * water is blue. Alpha 255 = land, 128 = water (the shader draws fainter borders on water).
 */
export function buildLookup(map: MapData): Uint8Array {
  const lut = new Uint8Array(LOOKUP_SIZE * 4);
  for (const p of map.provinces) {
    const o = p.id * 4;
    if (p.kind === 'land') {
      const c = parseInt(p.color.slice(1), 16);
      const tint = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
      for (let k = 0; k < 3; k++) lut[o + k] = Math.round(PARCHMENT[k]! * 0.8 + tint[k]! * 0.2);
      lut[o + 3] = 255;
    } else {
      const base = KIND_COLOR[p.kind];
      for (let k = 0; k < 3; k++) lut[o + k] = base[k]!;
      lut[o + 3] = p.kind === 'wasteland' ? 255 : 128;
    }
  }
  return lut;
}
