import type { MapProvince, ProvinceDefinition } from '../src/content/map';

export interface RgbImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel (alpha ignored). */
  data: Uint8Array;
}

export interface BuiltMap {
  idMap: Uint16Array;
  provinces: MapProvince[];
  warnings: string[];
  errors: string[];
}

const MAX_ERRORS = 20;
const TINY_PROVINCE_PIXELS = 30;

/** Turns a colour-keyed province bitmap into an id map plus per-province geometry and adjacency. */
export function buildMap(img: RgbImage, defs: ProvinceDefinition[], straits: [string, string][]): BuiltMap {
  const { width: W, height: H, data } = img;
  const errors: string[] = [];
  const warnings: string[] = [];

  const byColor = new Map<number, ProvinceDefinition>();
  for (const d of defs) byColor.set(parseInt(d.color.slice(1), 16), d);
  const maxId = defs.reduce((m, d) => Math.max(m, d.id), 0);

  const idMap = new Uint16Array(W * H);
  const unknown = new Map<number, [number, number]>();
  for (let p = 0; p < W * H; p++) {
    const c = (data[p * 4]! << 16) | (data[p * 4 + 1]! << 8) | data[p * 4 + 2]!;
    const d = byColor.get(c);
    if (d) idMap[p] = d.id;
    else if (!unknown.has(c)) unknown.set(c, [p % W, Math.floor(p / W)]);
  }
  for (const [c, [x, y]] of [...unknown].slice(0, MAX_ERRORS)) {
    errors.push(`Undefined colour #${c.toString(16).padStart(6, '0')} first seen at (${x}, ${y})`);
  }
  if (unknown.size > MAX_ERRORS) errors.push(`...and ${unknown.size - MAX_ERRORS} more undefined colours`);

  const count = new Uint32Array(maxId + 1);
  const sumX = new Float64Array(maxId + 1);
  const sumY = new Float64Array(maxId + 1);
  const bbox = Array.from({ length: maxId + 1 }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  const borders = new Map<number, number>(); // key = lo * 65536 + hi
  const addBorder = (a: number, b: number) => {
    const key = Math.min(a, b) * 65536 + Math.max(a, b);
    borders.set(key, (borders.get(key) ?? 0) + 1);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const id = idMap[p]!;
      if (!id) continue;
      count[id]!++;
      sumX[id]! += x;
      sumY[id]! += y;
      const b = bbox[id]!;
      if (x < b[0]!) b[0] = x;
      if (y < b[1]!) b[1] = y;
      if (x > b[2]!) b[2] = x;
      if (y > b[3]!) b[3] = y;
      if (x + 1 < W) { const r = idMap[p + 1]!; if (r && r !== id) addBorder(id, r); }
      if (y + 1 < H) { const d = idMap[p + W]!; if (d && d !== id) addBorder(id, d); }
    }
  }

  const adjacency = new Map<number, MapProvince['adjacency']>();
  for (const d of defs) adjacency.set(d.id, []);
  for (const [key, border] of borders) {
    const a = Math.floor(key / 65536);
    const b = key % 65536;
    adjacency.get(a)?.push({ id: b, border });
    adjacency.get(b)?.push({ id: a, border });
  }

  const byKey = new Map(defs.map((d) => [d.key, d]));
  for (const [ka, kb] of straits) {
    const a = byKey.get(ka);
    const b = byKey.get(kb);
    if (!a || !b) { errors.push(`Strait ${ka} - ${kb}: unknown province key`); continue; }
    for (const [from, to] of [[a, b], [b, a]] as const) {
      const list = adjacency.get(from.id)!;
      const existing = list.find((n) => n.id === to.id);
      if (existing) existing.strait = true;
      else list.push({ id: to.id, border: 0, strait: true });
    }
  }

  const kindOf = new Map(defs.map((d) => [d.id, d.kind]));
  const components = countComponents(idMap, W, H, maxId);
  const provinces: MapProvince[] = [];
  for (const d of defs) {
    const n = count[d.id]!;
    if (n === 0) { warnings.push(`${d.key}: defined but not on the map`); continue; }
    if (n < TINY_PROVINCE_PIXELS) warnings.push(`${d.key}: only ${n} pixels`);
    if (components[d.id]! > 1) warnings.push(`${d.key}: split into ${components[d.id]} separate areas`);
    const adj = adjacency.get(d.id)!.sort((x, y) => x.id - y.id);
    const b = bbox[d.id]!;
    provinces.push({
      id: d.id,
      key: d.key,
      name: d.name,
      kind: d.kind,
      color: d.color.toLowerCase(),
      pixels: n,
      bbox: [b[0]!, b[1]!, b[2]!, b[3]!],
      centroid: [Math.round(sumX[d.id]! / n), Math.round(sumY[d.id]! / n)],
      coastal: d.kind === 'land' && adj.some((a) => kindOf.get(a.id) === 'sea' && a.border > 0),
      adjacency: adj,
    });
  }
  return { idMap, provinces, warnings, errors };
}

function countComponents(idMap: Uint16Array, W: number, H: number, maxId: number): Uint32Array {
  const seen = new Uint8Array(W * H);
  const comps = new Uint32Array(maxId + 1);
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    const id = idMap[start]!;
    if (!id || seen[start]) continue;
    comps[id]!++;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const next = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
      for (const q of next) {
        if (q < 0 || q >= W * H || seen[q] || idMap[q] !== id) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  return comps;
}

/** Encodes the id map as RGBA: R = low byte, G = high byte. Read back in the renderer and picker. */
export function encodeIdMap(idMap: Uint16Array): Uint8Array {
  const out = new Uint8Array(idMap.length * 4);
  for (let p = 0; p < idMap.length; p++) {
    out[p * 4] = idMap[p]! & 255;
    out[p * 4 + 1] = idMap[p]! >> 8;
    out[p * 4 + 3] = 255;
  }
  return out;
}
