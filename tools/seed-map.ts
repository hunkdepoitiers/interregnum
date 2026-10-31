/**
 * One-off generator for a STARTER provinces.png. It rasterises the Natural Earth 1:50m land polygons
 * and grows one province per seed point (data/map/seeds.yaml) with noise-weighted multi-source growth,
 * so provinces are contiguous, never cross water and get irregular borders. Seeds may carry a radius
 * (km) to keep desert-edge provinces small. After this, the bitmap is meant to be repainted by hand.
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
const maxCost: number[] = [0]; // growth budget per province (Infinity = unlimited)
const seedPixel = new Map<number, [number, number]>();
const owner = new Int32Array(W * H);
const dist = new Int32Array(W * H).fill(0x7fffffff);

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

// Growth cost is measured in tenths of a pixel; see STEP_COST below.
const kmPerPx = ((projection.north - projection.south) * 111.32) / H;
const radiusToCost = (km: number) => Math.round((km / kmPerPx) * 10);

const seedQueue: number[] = [];
const groups: [ProvinceKind, typeof seeds.land][] = [
  ['land', seeds.land], ['wasteland', seeds.wasteland], ['sea', seeds.sea],
];
for (const [kind, rows] of groups) {
  for (const [key, name, lat, lon, radiusKm] of rows) {
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
    maxCost[id] = radiusKm === undefined ? Infinity : radiusToCost(radiusKm);
    seedPixel.set(id, [p % W, Math.floor(p / W)]);
    owner[p] = id;
    dist[p] = 0;
    seedQueue.push(p);
  }
}

// --- 3. Noise-weighted multi-source growth (Dial's algorithm) ---------------------------------
// Each step costs 10 (straight) or 14 (diagonal) times a smooth noise factor, so borders wander
// like real ones instead of forming straight Voronoi lines. A seed with a radius stops growing at
// that distance; what it leaves (deserts) is taken by wasteland seeds, which grow without limit.
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, y: number, cell: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx;
  const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx;
  return top + (bottom - top) * sy;
}
const terrainCost = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const n = 0.65 * valueNoise(x, y, 48) + 0.35 * valueNoise(x, y, 13);
    terrainCost[y * W + x] = Math.round(6 + n * 10); // 6..16, averaging ~10
  }
}

const BUCKETS = 64; // larger than the biggest single step cost (16 * 1.4 + 1)
const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
for (const p of seedQueue) buckets[0]!.push(p);
let pending = seedQueue.length;
const DIRS: [number, number, boolean][] = [
  [1, 0, false], [-1, 0, false], [0, 1, false], [0, -1, false],
  [1, 1, true], [1, -1, true], [-1, 1, true], [-1, -1, true],
];
for (let d = 0; pending > 0; d++) {
  const bucket = buckets[d % BUCKETS]!;
  while (bucket.length) {
    const p = bucket.pop()!;
    pending--;
    if (dist[p] !== d) continue; // stale entry
    const id = owner[p]!;
    const m = medium[id]!;
    const x = p % W;
    const y = (p - x) / W;
    for (const [dx, dy, diagonal] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (land[q] !== m) continue;
      // Don't slip diagonally between two pixels of the other medium (keeps provinces 4-connected).
      if (diagonal && land[y * W + nx] !== m && land[ny * W + x] !== m) continue;
      const step = diagonal ? Math.round(terrainCost[q]! * 1.4) : terrainCost[q]!;
      const nd = d + step;
      if (nd >= dist[q]! || nd > maxCost[id]!) continue;
      dist[q] = nd;
      owner[q] = id;
      buckets[nd % BUCKETS]!.push(q);
      pending++;
    }
  }
}

function neighbours(p: number): number[] {
  const x = p % W;
  const out: number[] = [];
  if (x > 0) out.push(p - 1);
  if (x < W - 1) out.push(p + 1);
  if (p >= W) out.push(p - W);
  if (p < W * (H - 1)) out.push(p + W);
  return out;
}

// --- 4. Unreached components (seedless islands, inland water) ---------------------------------
function nearestLandProvince(x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const d of defs) {
    if (d.kind !== 'land') continue;
    const s = seedPixel.get(d.id);
    if (!s) continue;
    const d2 = (s[0] - x) ** 2 + (s[1] - y) ** 2;
    if (d2 < bestD) { bestD = d2; best = d.id; }
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
