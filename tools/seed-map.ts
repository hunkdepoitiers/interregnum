/**
 * One-off generator for a STARTER provinces.png. It rasterises the Natural Earth 1:50m land polygons
 * and grows one province per seed point (data/map/seeds.yaml) by multi-source BFS, so provinces are
 * contiguous and never cross water. After this, the bitmap is meant to be repainted by hand.
 *
 * Usage: npm run seed-map [-- --force]   (refuses to overwrite an existing provinces.png without --force)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { parse } from 'yaml';
import { lonLatToPixel, projectionSchema, projectionSize, seedsSchema, type ProvinceKind } from '../src/content/map';
import { createRng, nextInt } from '../src/sim/rng';

const OUT_PNG = 'data/map/provinces.png';
const OUT_DEFS = 'data/map/definitions.yaml';
const LAND_SOURCE = 'tools/vendor/ne_50m_land.geojson';
const SNAP_RADIUS = 40;
const MIN_LAKE_PIXELS = 300;

if (existsSync(OUT_PNG) && !process.argv.includes('--force')) {
  console.error(`${OUT_PNG} exists (possibly hand-painted). Re-run with --force to overwrite.`);
  process.exit(1);
}

const projection = projectionSchema.parse(parse(readFileSync('data/map/projection.yaml', 'utf8')));
const { width: W, height: H } = projectionSize(projection);
const seeds = seedsSchema.parse(parse(readFileSync('data/map/seeds.yaml', 'utf8')));

// --- 1. Land mask -----------------------------------------------------------------------------
type Ring = [number, number][];
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
const geo = JSON.parse(readFileSync(LAND_SOURCE, 'utf8')) as { features: { geometry: Geometry }[] };

const land = new Uint8Array(W * H);
function fillPolygon(rings: Ring[]) {
  const rows = new Map<number, number[]>();
  for (const ring of rings) {
    const pts = ring.map(([lon, lat]) => lonLatToPixel(projection, lon, lat));
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]!;
      const [x1, y1] = pts[i + 1]!;
      if (y0 === y1) continue;
      const yMin = Math.min(y0, y1);
      const yMax = Math.max(y0, y1);
      const rStart = Math.max(0, Math.ceil(yMin - 0.5));
      const rEnd = Math.min(H - 1, Math.floor(yMax - 0.5));
      for (let r = rStart; r <= rEnd; r++) {
        const yc = r + 0.5;
        if (yc < yMin || yc >= yMax) continue;
        const x = x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0);
        let list = rows.get(r);
        if (!list) rows.set(r, (list = []));
        list.push(x);
      }
    }
  }
  for (const [r, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i]! - 0.5));
      const to = Math.min(W - 1, Math.floor(xs[i + 1]! - 0.5));
      for (let x = from; x <= to; x++) land[r * W + x] = 1;
    }
  }
}
for (const { geometry } of geo.features) {
  if (geometry.type === 'Polygon') fillPolygon(geometry.coordinates);
  else for (const poly of geometry.coordinates) fillPolygon(poly);
}

// --- 2. Seeds ---------------------------------------------------------------------------------
interface Def { id: number; key: string; name: string; kind: ProvinceKind }
const defs: Def[] = [];
const medium: number[] = [0]; // 1 = grows over land, 0 = over water; index = province id
const owner = new Int32Array(W * H);
const queue = new Int32Array(W * H);
let qHead = 0;
let qTail = 0;

function snap(px: number, py: number, wantLand: number): number | null {
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  for (let r = 0; r <= SNAP_RADIUS; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const p = y * W + x;
        if (land[p] === wantLand && owner[p] === 0) return p;
      }
    }
  }
  return null;
}

const groups: [ProvinceKind, [string, string, number, number][]][] = [
  ['land', seeds.land], ['wasteland', seeds.wasteland], ['sea', seeds.sea],
];
for (const [kind, rows] of groups) {
  for (const [key, name, lat, lon] of rows) {
    const [px, py] = lonLatToPixel(projection, lon, lat);
    const wantLand = kind === 'sea' ? 0 : 1;
    const p = snap(px, py, wantLand);
    if (p === null) {
      console.warn(`seed ${key}: no ${wantLand ? 'land' : 'water'} pixel within ${SNAP_RADIUS}px, skipped`);
      continue;
    }
    const id = defs.length + 1;
    defs.push({ id, key, name, kind });
    medium[id] = wantLand;
    owner[p] = id;
    queue[qTail++] = p;
  }
}

// --- 3. Multi-source BFS ----------------------------------------------------------------------
function neighbours(p: number): number[] {
  const x = p % W;
  const out: number[] = [];
  if (x > 0) out.push(p - 1);
  if (x < W - 1) out.push(p + 1);
  if (p >= W) out.push(p - W);
  if (p < W * (H - 1)) out.push(p + W);
  return out;
}
while (qHead < qTail) {
  const p = queue[qHead++]!;
  const id = owner[p]!;
  for (const q of neighbours(p)) {
    if (owner[q] === 0 && land[q] === medium[id]) {
      owner[q] = id;
      queue[qTail++] = q;
    }
  }
}

// --- 4. Unreached components (seedless islands, inland water) ---------------------------------
const seedPixel = new Map<number, [number, number]>();
for (let p = 0; p < W * H; p++) {
  const id = owner[p]!;
  if (id && !seedPixel.has(id)) seedPixel.set(id, [p % W, Math.floor(p / W)]);
}
function nearestLandProvince(x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const d of defs) {
    if (d.kind !== 'land') continue;
    const s = seedPixel.get(d.id);
    if (!s) continue;
    const dist = (s[0] - x) ** 2 + (s[1] - y) ** 2;
    if (dist < bestD) { bestD = dist; best = d.id; }
  }
  return best;
}
let lakeCount = 0;
for (let start = 0; start < W * H; start++) {
  if (owner[start] !== 0) continue;
  const m = land[start]!;
  const comp: number[] = [start];
  owner[start] = -1;
  let touching = 0;
  for (let i = 0; i < comp.length; i++) {
    for (const q of neighbours(comp[i]!)) {
      if (owner[q] === 0 && land[q] === m) { owner[q] = -1; comp.push(q); }
      else if (owner[q]! > 0 && medium[owner[q]!] === 1 && !touching) touching = owner[q]!;
    }
  }
  let id: number;
  if (m === 1) {
    id = nearestLandProvince(start % W, Math.floor(start / W));
  } else if (comp.length >= MIN_LAKE_PIXELS) {
    lakeCount++;
    id = defs.length + 1;
    defs.push({ id, key: `lake_${lakeCount}`, name: `Lake ${lakeCount}`, kind: 'lake' });
  } else {
    id = touching || nearestLandProvince(start % W, Math.floor(start / W));
    for (const p of comp) land[p] = 1;
  }
  for (const p of comp) owner[p] = id;
}

// --- 5. Colours and output --------------------------------------------------------------------
const rng = createRng(1302);
const used = new Set<number>([0]);
function pick(kind: ProvinceKind): number {
  for (;;) {
    let r: number, g: number, b: number;
    if (kind === 'sea' || kind === 'lake') {
      r = nextInt(rng, 50); g = 60 + nextInt(rng, 90); b = 160 + nextInt(rng, 96);
    } else if (kind === 'wasteland') {
      const base = 120 + nextInt(rng, 50);
      r = base + nextInt(rng, 10); g = base + nextInt(rng, 10); b = base + nextInt(rng, 10);
    } else {
      r = 40 + nextInt(rng, 196); g = 40 + nextInt(rng, 196); b = 40 + nextInt(rng, 196);
      if (b > r + 40 && b > g + 40) continue; // keep blue tones for water
    }
    const c = (r << 16) | (g << 8) | b;
    if (!used.has(c)) { used.add(c); return c; }
  }
}
const colors = [0, ...defs.map((d) => pick(d.kind))];

const png = new PNG({ width: W, height: H });
for (let p = 0; p < W * H; p++) {
  const c = colors[owner[p]!]!;
  png.data[p * 4] = (c >> 16) & 255;
  png.data[p * 4 + 1] = (c >> 8) & 255;
  png.data[p * 4 + 2] = c & 255;
  png.data[p * 4 + 3] = 255;
}
writeFileSync(OUT_PNG, PNG.sync.write(png, { colorType: 2 }));

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const lines = [
  '# Province definitions: one entry per colour in provinces.png.',
  '# Generated by tools/seed-map.ts, then edited by hand. kind: land | sea | wasteland | lake.',
  ...defs.map((d) => `- { id: ${d.id}, key: ${d.key}, name: ${JSON.stringify(d.name)}, kind: ${d.kind}, color: "${hex(colors[d.id]!)}" }`),
];
writeFileSync(OUT_DEFS, lines.join('\n') + '\n');
console.log(`Wrote ${OUT_PNG} (${W}x${H}) and ${defs.length} definitions (${lakeCount} lakes).`);
