import type { MapData, ProvinceKind } from '../content/map';
import type { WorldView } from '../worker/protocol';

/** Width of the lookup texture, i.e. the highest province id + 1 the renderer supports. */
export const LOOKUP_SIZE = 4096;

export type MapMode = 'political' | 'terrain';

type Rgb = [number, number, number];
const PARCHMENT: Rgb = [214, 196, 158];
const UNCLAIMED: Rgb = [176, 166, 140];
const KIND_COLOR: Record<Exclude<ProvinceKind, 'land'>, Rgb> = {
  sea: [44, 74, 104],
  lake: [58, 98, 130],
  wasteland: [128, 118, 100],
};

export function hexToRgb(hex: string): Rgb {
  const c = parseInt(hex.slice(1), 16);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/**
 * Builds the 2-row lookup texture the map shader reads, indexed by province id.
 * Row 0: base colour (the owner's colour in political mode). Row 1: the controller's colour, drawn as
 * stripes where it differs from row 0. Alpha 255 = land/wasteland, 128 = water (fainter borders).
 */
export function buildLookup(map: MapData, mode: MapMode, world: WorldView | null): Uint8Array {
  const lut = new Uint8Array(LOOKUP_SIZE * 2 * 4);
  const put = (row: number, id: number, rgb: Rgb, alpha: number) => {
    const o = (row * LOOKUP_SIZE + id) * 4;
    lut[o] = rgb[0];
    lut[o + 1] = rgb[1];
    lut[o + 2] = rgb[2];
    lut[o + 3] = alpha;
  };
  const realmColor = (realmId: number): Rgb | null => {
    const r = world?.realms[realmId];
    return r ? hexToRgb(r.color) : null;
  };

  for (const p of map.provinces) {
    if (p.kind !== 'land') {
      const alpha = p.kind === 'wasteland' ? 255 : 128;
      put(0, p.id, KIND_COLOR[p.kind], alpha);
      put(1, p.id, KIND_COLOR[p.kind], alpha);
      continue;
    }
    let base: Rgb;
    let held: Rgb;
    if (mode === 'political') {
      base = realmColor(world?.owner[p.id] ?? 0) ?? UNCLAIMED;
      held = realmColor(world?.controller[p.id] ?? 0) ?? base;
    } else {
      // Terrain placeholder until real terrain exists: parchment tinted by the bitmap colour.
      const tint = hexToRgb(p.color);
      base = [0, 1, 2].map((k) => Math.round(PARCHMENT[k]! * 0.8 + tint[k]! * 0.2)) as Rgb;
      held = base;
    }
    put(0, p.id, base, 255);
    put(1, p.id, held, 255);
  }
  return lut;
}
