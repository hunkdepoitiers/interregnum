import type { MapData, ProvinceKind, Terrain } from '../content/map';
import type { Content } from '../sim/content';
import type { WorldView } from '../worker/protocol';

/**
 * The lookup texture is LOOKUP_WIDTH wide; province id i sits at column i % LOOKUP_WIDTH and row
 * floor(i / LOOKUP_WIDTH). Rows 0..LOOKUP_ROWS-1 hold base colours, the next LOOKUP_ROWS rows the controller
 * colours. 4096 x 16 covers every 16-bit province id.
 */
export const LOOKUP_WIDTH = 4096;
export const LOOKUP_ROWS = 16;
export const LOOKUP_HEIGHT = LOOKUP_ROWS * 2;

export type MapMode = 'political' | 'terrain' | 'culture' | 'religion' | 'dejure' | 'goods';

/** Static per-province data the culture and religion map modes colour by. */
export interface Peoples {
  culture: number[];
  religion: number[];
  /** De jure county of each province (Content.titles). */
  county: number[];
  /** Trade good of each province (Content.goods). */
  good: number[];
  content: Content;
}

/** The de jure kingdom of a province (0 = none). */
export function kingdomOf(peoples: Peoples, provinceId: number): number {
  const t = peoples.content.titles;
  const c = peoples.county[provinceId] ?? 0;
  const d = c ? t.counties[c - 1]!.parent : 0;
  return d ? t.duchies[d - 1]!.parent : 0;
}

/** A stable, distinct colour per title key for the de jure map mode. */
function keyColor(key: string): Rgb {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const hue = ((h >>> 0) % 360) / 60;
  const x = 1 - Math.abs((hue % 2) - 1);
  const [r, g, b] = hue < 1 ? [1, x, 0] : hue < 2 ? [x, 1, 0] : hue < 3 ? [0, 1, x] : hue < 4 ? [0, x, 1] : hue < 5 ? [x, 0, 1] : [1, 0, x];
  const light = 0.45 + (((h >>> 9) % 25) / 100);
  return [r, g, b].map((v) => Math.round(70 + v * 150 * light + 40)) as Rgb;
}

type Rgb = [number, number, number];
/** Terrain map mode colours, before the shader washes them onto the paper. */
export const TERRAIN_COLOR: Record<Terrain, Rgb> = {
  farmlands: [214, 190, 92], plains: [150, 182, 96], hills: [168, 128, 82], highlands: [128, 98, 74],
  forest: [56, 112, 58], jungle: [24, 88, 52], marsh: [82, 128, 118], steppe: [200, 176, 112],
  desert: [226, 200, 140], tundra: [176, 186, 196],
};
const UNCLAIMED: Rgb = [176, 166, 140];
const KIND_COLOR: Record<Exclude<ProvinceKind, 'land'>, Rgb> = {
  sea: [44, 74, 104],
  lake: [58, 98, 130],
  wasteland: [128, 118, 100],
  mountain: [92, 84, 78],
};

/** Lookup alpha tells the shader the province kind: 255 land (240 unowned), 224 wasteland, 176 mountain, below 153 water. */
const KIND_ALPHA: Record<Exclude<ProvinceKind, 'land'>, number> = { wasteland: 224, mountain: 176, sea: 128, lake: 112 };

export function hexToRgb(hex: string): Rgb {
  const c = parseInt(hex.slice(1), 16);
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/**
 * Builds the lookup texture the map shader reads, indexed by province id (layout: see LOOKUP_WIDTH).
 * Layer 0: base colour (the owner's colour in political mode). Layer 1: the controller's colour, drawn as
 * stripes where it differs from layer 0. Alpha encodes the province kind (KIND_ALPHA).
 */
/** Repaints these provinces in the lookup (both layers): the peace table's land on the map. */
export function tintLookup(lut: Uint8Array, ids: number[], rgb: Rgb): void {
  for (const id of ids) for (let row = 0; row < 2; row++) {
    const o = ((row * LOOKUP_ROWS + Math.floor(id / LOOKUP_WIDTH)) * LOOKUP_WIDTH + (id % LOOKUP_WIDTH)) * 4;
    lut[o] = rgb[0]; lut[o + 1] = rgb[1]; lut[o + 2] = rgb[2];
  }
}

export function buildLookup(map: MapData, mode: MapMode, world: WorldView | null, peoples: Peoples | null = null): Uint8Array {
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
      const alpha = KIND_ALPHA[p.kind];
      put(0, p.id, KIND_COLOR[p.kind], alpha);
      put(1, p.id, KIND_COLOR[p.kind], alpha);
      continue;
    }
    let base: Rgb;
    let held: Rgb;
    if (mode === 'political') {
      base = realmColor(world?.owner[p.id] ?? 0) ?? UNCLAIMED;
      held = realmColor(world?.controller[p.id] ?? 0) ?? base;
    } else if (mode === 'dejure') {
      const k = peoples ? kingdomOf(peoples, p.id) : 0;
      base = k ? keyColor(peoples!.content.titles.kingdoms[k - 1]!.key) : UNCLAIMED;
      held = base;
    } else if (mode === 'goods') {
      const g = peoples?.good[p.id] ?? 0;
      base = g ? hexToRgb(peoples!.content.goods[g - 1]!.color) : UNCLAIMED;
      held = base;
    } else if (mode === 'culture' || mode === 'religion') {
      const id = (mode === 'culture' ? peoples?.culture : peoples?.religion)?.[p.id] ?? 0;
      const def = id ? (mode === 'culture' ? peoples!.content.cultures : peoples!.content.religions)[id - 1] : undefined;
      base = def ? hexToRgb(def.color) : UNCLAIMED;
      held = base;
    } else {
      base = TERRAIN_COLOR[p.terrain ?? 'plains'];
      held = base;
    }
    // Unowned land is drawn as bare paper.
    const alpha = mode === 'political' && !world?.owner[p.id] ? 240 : 255;
    put(0, p.id, base, alpha);
    put(1, p.id, held, alpha);
  }
  return lut;
}
