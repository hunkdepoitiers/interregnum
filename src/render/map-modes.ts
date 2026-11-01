import type { MapData, ProvinceKind } from '../content/map';
import type { WorldView } from '../worker/protocol';

/**
 * The lookup texture is LOOKUP_WIDTH wide; province id i sits at column i % LOOKUP_WIDTH and row
 * floor(i / LOOKUP_WIDTH). Rows 0..LOOKUP_ROWS-1 hold base colours, the next LOOKUP_ROWS rows the controller
 * colours. 4096 x 16 covers every 16-bit province id.
 */
export const LOOKUP_WIDTH = 4096;
export const LOOKUP_ROWS = 16;
export const LOOKUP_HEIGHT = LOOKUP_ROWS * 2;

export type MapMode = 'political' | 'terrain';

type Rgb = [number, number, number];
const PARCHMENT: Rgb = [214, 196, 158];
const UNCLAIMED: Rgb = [176, 166, 140];
const KIND_COLOR: Record<Exclude<ProvinceKind, 'land'>, Rgb> = {
  sea: [44, 74, 104],
  lake: [58, 98, 130],
  wasteland: [128, 118, 100],
  mountain: [92, 84, 78],
};

export function hexToRgb(hex: string): Rgb {
  const c = parseInt(hex.slice(1), 16);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/**
 * Builds the lookup texture the map shader reads, indexed by province id (layout: see LOOKUP_WIDTH).
 * Layer 0: base colour (the owner's colour in political mode). Layer 1: the controller's colour, drawn as
 * stripes where it differs from layer 0. Alpha 255 = land/wasteland/mountain, 128 = water (fainter borders).
 */
export function buildLookup(map: MapData, mode: MapMode, world: WorldView | null): Uint8Array {
  const lut = new Uint8Array(LOOKUP_WIDTH * LOOKUP_HEIGHT * 4);
  const put = (row: number, id: number, rgb: Rgb, alpha: number) => {
    const o = ((row * LOOKUP_ROWS + Math.floor(id / LOOKUP_WIDTH)) * LOOKUP_WIDTH + (id % LOOKUP_WIDTH)) * 4;
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
      const alpha = p.kind === 'wasteland' || p.kind === 'mountain' ? 255 : 128;
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
