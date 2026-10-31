/**
 * One-off generator for a STARTER provinces.png. It rasterises the Natural Earth 1:50m land polygons
 * and grows one province per seed point (data/map/seeds.yaml) with noise-weighted multi-source growth,
 * so provinces are contiguous, never cross water and get irregular borders. Seeds may carry a radius
 * (km) to keep desert-edge provinces small. After this, the bitmap is meant to be repainted by hand.
 *
 * Usage: npm run seed-map [-- --force]   (refuses to overwrite an existing provinces.png without --force)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
/** Scanline-fills a polygon (outer ring + holes, even-odd) into `target` with `value`. */
function fillPolygon(rings: Ring[], target: Uint8Array | Int32Array, value: number) {
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
      for (let x = from; x <= to; x++) target[r * W + x] = value;
    }
  }
}
for (const { geometry } of geo.features) {
  if (geometry.type === 'Polygon') fillPolygon(geometry.coordinates, land, 1);
  else for (const poly of geometry.coordinates) fillPolygon(poly, land, 1);
}
// Historical water (data/map/water.yaml), e.g. the Zuiderzee before its modern land reclamation.
const water = (parse(readFileSync('data/map/water.yaml', 'utf8')) ?? []) as { name: string; polygon: [number, number][] }[];
for (const { polygon } of water) {
  const ring: Ring = polygon.map(([lat, lon]) => [lon, lat]);
  ring.push(ring[0]!);
  fillPolygon([ring], land, 0);
}
// Remembers which named water body each carved pixel belongs to, so the lakes they form get proper names.
const waterName = new Int32Array(W * H);
water.forEach(({ polygon }, i) => {
  const ring: Ring = polygon.map(([lat, lon]) => [lon, lat]);
  ring.push(ring[0]!);
  fillPolygon([ring], waterName, i + 1);
});

// --- 2. Seeds ---------------------------------------------------------------------------------
interface Def { id: number; key: string; name: string; kind: ProvinceKind }
const defs: Def[] = [];
const medium: number[] = [0]; // 1 = grows over land, 0 = over water; index = province id
const maxCost: number[] = [0]; // growth budget per province (Infinity = unlimited)
const slow: boolean[] = [false]; // wasteland: grows slower than settled land
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

// Growth cost per pixel averages ~13 once noise and diagonal steps are counted (see section 3),
// so a seed radius in km converts to a cost budget with that factor.
const kmPerPx = ((projection.north - projection.south) * 111.32) / H;
const AVG_COST_PER_PX = 13;
const radiusToCost = (km: number) => Math.round((km / kmPerPx) * AVG_COST_PER_PX);
/** Wasteland grows this many times slower, so settled provinces win any ground within their radius. */
const WASTELAND_SLOWDOWN = 2;
/** Settled provinces never reach further than this unless their seed says otherwise; wasteland is unlimited. */
const DEFAULT_MAX_RADIUS_KM = 300;

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
    maxCost[id] = kind === 'wasteland' ? Infinity : radiusToCost(radiusKm ?? (kind === 'land' ? DEFAULT_MAX_RADIUS_KM : Infinity));
    slow[id] = kind === 'wasteland';
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

const DIRS: [number, number, boolean][] = [
  [1, 0, false], [-1, 0, false], [0, 1, false], [0, -1, false],
  [1, 1, true], [1, -1, true], [-1, 1, true], [-1, -1, true],
];
// Corridors (data/map/corridors.yaml): thin strips of settled land between two seeds, e.g. a caravan
// route between oases or a coastal road along a desert shore. Each strip follows the shortest path over
// land (so it hugs coasts instead of crossing bays), optionally through waypoints. Wasteland may not enter
// a strip and settled provinces may follow it past their radius, so the two ends grow towards each other.
const CORRIDOR_HALF_WIDTH_PX = 3;
const CORRIDOR_SEARCH_MARGIN_PX = 150;
const corridor = new Uint8Array(W * H);
{
  const seedAt = new Map<string, number>();
  for (const d of defs) {
    const s = seedPixel.get(d.id);
    if (s) seedAt.set(d.key, s[1] * W + s[0]);
  }
  const nearestLand = (lat: number, lon: number): number => {
    const [px, py] = lonLatToPixel(projection, lon, lat);
    const p = snap(px, py, 1);
    if (p === null) throw new Error(`corridor waypoint ${lat},${lon}: no land nearby`);
    return p;
  };
  /** Shortest 8-connected path over land from a to b, searched inside their bounding box plus a margin. */
  const landPath = (a: number, b: number): number[] => {
    const ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W;
    const x0 = Math.max(0, Math.min(ax, bx) - CORRIDOR_SEARCH_MARGIN_PX);
    const x1 = Math.min(W - 1, Math.max(ax, bx) + CORRIDOR_SEARCH_MARGIN_PX);
    const y0 = Math.max(0, Math.min(ay, by) - CORRIDOR_SEARCH_MARGIN_PX);
    const y1 = Math.min(H - 1, Math.max(ay, by) + CORRIDOR_SEARCH_MARGIN_PX);
    const prev = new Map<number, number>([[a, -1]]);
    const queue = [a];
    for (let i = 0; i < queue.length && !prev.has(b); i++) {
      const p = queue[i]!;
      const x = p % W, y = (p - x) / W;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const q = ny * W + nx;
        if (!land[q] || prev.has(q)) continue;
        prev.set(q, p);
        queue.push(q);
      }
    }
    if (!prev.has(b)) return [];
    const path: number[] = [];
    for (let p = b; p !== -1; p = prev.get(p)!) path.push(p);
    return path;
  };
  // Each entry is [keyA, keyB] or [keyA, keyB, [[lat, lon], ...]] with waypoints the path must pass.
  const pairs = (parse(readFileSync('data/map/corridors.yaml', 'utf8')) ?? []) as [string, string, [number, number][]?][];
  for (const [a, b, via = []] of pairs) {
    const pa = seedAt.get(a);
    const pb = seedAt.get(b);
    if (pa === undefined || pb === undefined) throw new Error(`corridor ${a} - ${b}: unknown seed key`);
    const stops = [pa, ...via.map(([lat, lon]) => nearestLand(lat, lon)), pb];
    for (let s = 0; s + 1 < stops.length; s++) {
      const path = landPath(stops[s]!, stops[s + 1]!);
      if (!path.length) throw new Error(`corridor ${a} - ${b}: no land path`);
      for (const p of path) {
        const cx = p % W, cy = (p - cx) / W;
        for (let dy = -CORRIDOR_HALF_WIDTH_PX; dy <= CORRIDOR_HALF_WIDTH_PX; dy++) {
          for (let dx = -CORRIDOR_HALF_WIDTH_PX; dx <= CORRIDOR_HALF_WIDTH_PX; dx++) {
            if (dx * dx + dy * dy > CORRIDOR_HALF_WIDTH_PX ** 2) continue;
            const x = cx + dx, y = cy + dy;
            if (x >= 0 && y >= 0 && x < W && y < H && land[y * W + x]) corridor[y * W + x] = 1;
          }
        }
      }
    }
  }
}

const BUCKETS = 64; // larger than the biggest single step cost (16 * 1.4 * WASTELAND_SLOWDOWN + 1)
const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
for (const p of seedQueue) buckets[0]!.push(p);
let pending = seedQueue.length;
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
      const base = diagonal ? Math.round(terrainCost[q]! * 1.4) : terrainCost[q]!;
      const step = slow[id] ? base * WASTELAND_SLOWDOWN : base;
      const nd = d + step;
      if (corridor[q] && slow[id]) continue;
      if (nd >= dist[q]! || (nd > maxCost[id]! && !corridor[q])) continue;
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
    const named = water[comp.map((p) => waterName[p]!).find((n) => n > 0)! - 1]?.name;
    const slug = named?.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const key = slug ? 'lake_' + slug : `lake_${lakeCount}`;
    defs.push({ id, key, name: named ?? `Lake ${lakeCount}`, kind: 'lake' });
  } else {
    id = touching || nearestLandProvince(start % W, Math.floor(start / W));
    for (const p of comp) land[p] = 1;
  }
  for (const p of comp) owner[p] = id;
}

// --- 4b. Snap provinces to real district borders (geoBoundaries, see data/map/ATTRIBUTION.md) -----
// A district holding one seed joins that seed's province; a district without seeds joins whichever
// province already covers most of it. Districts with several seeds keep the grown borders inside them,
// mostly-desert districts are left alone so desert-edge provinces keep their radius-limited shape, and so are
// districts much larger than the province they would join (coarse units such as German Regierungsbezirke).
const BOUNDARY_DIR = 'tools/vendor/geoboundaries';
const MAX_WASTE_SHARE = 0.4;
/** A district may be at most this many times the grown size of the province it would join. */
const MAX_DISTRICT_RATIO = 1.5;
let snappedDistricts = 0;
if (existsSync(BOUNDARY_DIR)) {
  const district = new Int32Array(W * H);
  let districtCount = 0;
  for (const file of readdirSync(BOUNDARY_DIR).filter((f) => f.endsWith('.geojson')).sort()) {
    const fc = JSON.parse(readFileSync(`${BOUNDARY_DIR}/${file}`, 'utf8')) as { features: { geometry: Geometry | null }[] };
    for (const { geometry } of fc.features) {
      if (!geometry) continue;
      districtCount++;
      const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      for (const poly of polys) fillPolygon(poly, district, districtCount);
    }
  }

  const seedsIn = new Map<number, Set<number>>();
  for (const [id, [x, y]] of seedPixel) {
    const d = district[y * W + x]!;
    if (!d || medium[id] !== 1) continue;
    let set = seedsIn.get(d);
    if (!set) seedsIn.set(d, (set = new Set()));
    set.add(id);
  }
  const counts: Map<number, number>[] = Array.from({ length: districtCount + 1 }, () => new Map());
  for (let p = 0; p < W * H; p++) {
    const d = district[p]!;
    if (!d || !land[p] || owner[p]! <= 0) continue;
    const c = counts[d]!;
    c.set(owner[p]!, (c.get(owner[p]!) ?? 0) + 1);
  }
  const grown = new Uint32Array(defs.length + 1);
  for (let p = 0; p < W * H; p++) if (owner[p]! > 0) grown[owner[p]!]!++;
  const target = new Int32Array(districtCount + 1);
  for (let d = 1; d <= districtCount; d++) {
    const here = seedsIn.get(d);
    if (here && here.size > 1) continue;
    let total = 0;
    let waste = 0;
    let best = 0;
    let bestN = 0;
    for (const [o, n] of counts[d]!) {
      total += n;
      if (slow[o]) waste += n;
      if (n > bestN) { best = o; bestN = n; }
    }
    const t = here ? [...here][0]! : best;
    if (!t || slow[t] || waste > total * MAX_WASTE_SHARE || total > grown[t]! * MAX_DISTRICT_RATIO) continue;
    target[d] = t;
    snappedDistricts++;
  }
  for (let p = 0; p < W * H; p++) {
    const t = target[district[p]!]!;
    if (t && land[p] && !corridor[p]) owner[p] = t; // corridors keep the province that grew along them
  }
  console.log(`Snapped ${snappedDistricts} of ${districtCount} districts to provinces.`);
}

// --- 4c. Keep each province in one piece ----------------------------------------------------------
// Snapping can strand small pieces of a province; hand each piece without the seed to the land
// province it borders most. Seedless islands (no land neighbours) stay where they are.
{
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let merged = 0;
  for (let start = 0; start < W * H; start++) {
    const o = owner[start]!;
    if (seen[start] || o <= 0 || medium[o] !== 1) continue;
    const [sx, sy] = seedPixel.get(o) ?? [-1, -1];
    const seedP = sy * W + sx;
    const comp: number[] = [];
    const border = new Map<number, number>();
    let hasSeed = false;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const p = stack[--top]!;
      comp.push(p);
      if (p === seedP) hasSeed = true;
      for (const q of neighbours(p)) {
        const oq = owner[q]!;
        if (oq === o) {
          if (!seen[q]) { seen[q] = 1; stack[top++] = q; }
        } else if (oq > 0 && medium[oq] === 1 && slow[oq] === slow[o]) {
          // Wasteland pieces only join wasteland, settled pieces only settled land: a stray desert
          // fragment must not turn a neighbouring province into a giant.
          border.set(oq, (border.get(oq) ?? 0) + 1);
        }
      }
    }
    if (hasSeed || border.size === 0) continue;
    let best = 0;
    let bestN = 0;
    for (const [n, c] of border) if (c > bestN) { best = n; bestN = c; }
    for (const p of comp) owner[p] = best;
    merged++;
  }
  console.log(`Merged ${merged} stranded fragments into neighbouring provinces.`);
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
