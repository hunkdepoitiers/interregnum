/**
 * Generator for the STARTER provinces.png of the whole world. It rasterises Natural Earth land, lakes, deserts and
 * mountain ranges, then grows one province per seed point (data/map/seeds.yaml for the hand-made region,
 * data/map/seeds-world.yaml elsewhere, plus automatic ocean zones) with noise-weighted multi-source growth, so
 * provinces are contiguous, never cross water and get irregular borders. Seeds may carry a radius (km) to keep
 * desert-edge provinces small. Province borders are then snapped to real district borders.
 *
 * Usage: npm run seed-map [-- --force]   (refuses to overwrite an existing provinces.png without --force)
 * Needs ~6 GB of free memory at world scale.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { parse } from 'yaml';
import { lonLatToPixel, projectionSchema, projectionSize, seedsSchema, type ProvinceKind } from '../src/content/map';
import { createRng, nextInt } from '../src/sim/rng';
import { HAND_MADE_REGION, inRegion } from './regions';

const OUT_PNG = 'data/map/provinces.png';
const OUT_DEFS = 'data/map/definitions.yaml';
const VENDOR = 'tools/vendor';
const LAND_SOURCE = `${VENDOR}/ne_10m_land.geojson`;
const LAKE_SOURCE = `${VENDOR}/ne_10m_lakes.geojson`;
const GEOGRAPHY_SOURCE = `${VENDOR}/ne_10m_geography_regions_polys.geojson`;
const ADMIN1_SOURCE = `${VENDOR}/ne_10m_admin_1_states_provinces.geojson`;
const SNAP_RADIUS = 40;
const MIN_LAKE_PIXELS = 300;
/** Natural Earth lakes up to this scalerank become lake provinces (smaller ones stay land). */
const MAX_LAKE_RANK = 5;
/** Unreached land at least this large becomes a wasteland ("wilds") instead of joining the nearest province. */
const MIN_WILDS_PIXELS = 4000;
/** Spacing of automatic ocean zones, in pixels. */
const OCEAN_GRID_PX = 320;
/** Natural Earth deserts that are not true deserts for gameplay purposes. */
const NOT_DESERTS = new Set(['PUNJAB', 'CAATINGAS', 'Big Bend', 'White Sands']);
/** Natural Earth mountain ranges that become impassable outside the hand-made region. */
const IMPASSABLE_RANGES = new Set([
  'HIMALAYAS', 'KARAKORAM RA.', 'HINDU KUSH', 'PAMIRS', 'KUNLUN MOUNTAINS', 'ALTUN MTS.', 'QUILIAN MOUNTAINS',
  'TIAN SHAN', 'ALTAY MOUNTAINS', 'SOUTHERN ALPS', 'ALASKA RANGE', 'BROOKS RANGE', 'CHUGACH MTS.', 'COAST MOUNTAINS',
]);
/** Settled growth into a desert pixel costs this many times more. */
const DESERT_SLOWDOWN = 4;

if (existsSync(OUT_PNG) && !process.argv.includes('--force')) {
  console.error(`${OUT_PNG} exists (possibly hand-painted). Re-run with --force to overwrite.`);
  process.exit(1);
}

const projection = projectionSchema.parse(parse(readFileSync('data/map/projection.yaml', 'utf8')));
const { width: W, height: H } = projectionSize(projection);
const N = W * H;
const handMade = seedsSchema.parse(parse(readFileSync('data/map/seeds.yaml', 'utf8')));
const worldSeeds = existsSync('data/map/seeds-world.yaml')
  ? seedsSchema.parse(parse(readFileSync('data/map/seeds-world.yaml', 'utf8')))
  : { land: [], wasteland: [], sea: [] };
const seeds = {
  land: [...handMade.land, ...worldSeeds.land],
  wasteland: [...handMade.wasteland, ...worldSeeds.wasteland],
  sea: [...handMade.sea, ...worldSeeds.sea],
};
const log = (msg: string) => console.log(`[${(process.uptime()).toFixed(0)}s] ${msg}`);
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s'-])\S/g, (c) => c.toUpperCase()).replace(/\bMts\.?$/, 'Mountains');
const pixelLatLon = (p: number): [number, number] => {
  const x = p % W;
  const y = (p - x) / W;
  const { scale } = projectionSize(projection);
  const k = Math.cos((projection.standardParallel * Math.PI) / 180);
  return [projection.north - y / scale, projection.west + x / (k * scale)];
};

// --- 1. Land, lakes, deserts --------------------------------------------------------------------
type Ring = [number, number][];
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
type Feature<P> = { properties: P; geometry: Geometry | null };
const readFeatures = <P>(file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { features: Feature<P>[] }).features;
const polygonsOf = (g: Geometry) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

/** Scanline-fills a polygon (outer ring + holes, even-odd) into `target` with `value`. */
function fillPolygon(rings: Ring[], target: Uint8Array | Uint16Array | Int32Array, value: number, keep?: (p: number) => boolean) {
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
      for (let x = from; x <= to; x++) {
        const p = r * W + x;
        if (!keep || keep(p)) target[p] = value;
      }
    }
  }
}
const outsideHandMade = (p: number) => {
  const [lat, lon] = pixelLatLon(p);
  return !inRegion(HAND_MADE_REGION, lat, lon);
};

const land = new Uint8Array(N);
for (const { geometry } of readFeatures<unknown>(LAND_SOURCE)) {
  if (geometry) for (const poly of polygonsOf(geometry)) fillPolygon(poly, land, 1);
}
log('land rasterised');

// Named water: Natural Earth lakes (not modern reservoirs), then data/map/water.yaml (historical water such as
// the Zuiderzee, and hand-placed lakes) which overrides it. waterName remembers which body each pixel belongs to.
const waterNames: string[] = [''];
const waterName = new Uint16Array(N);
for (const f of readFeatures<{ name: string | null; scalerank: number; featurecla: string; dam_name: string | null }>(LAKE_SOURCE)) {
  const pr = f.properties;
  if (!f.geometry || pr.scalerank > MAX_LAKE_RANK || pr.featurecla === 'Reservoir' || pr.dam_name) continue;
  const index = waterNames.push(pr.name ?? 'Lake') - 1;
  for (const poly of polygonsOf(f.geometry)) {
    fillPolygon(poly, land, 0);
    fillPolygon(poly, waterName, index);
  }
}
const water = (parse(readFileSync('data/map/water.yaml', 'utf8')) ?? []) as { name: string; polygon: [number, number][] }[];
for (const { name, polygon } of water) {
  const ring: Ring = polygon.map(([lat, lon]) => [lon, lat]);
  ring.push(ring[0]!);
  const index = waterNames.push(name) - 1;
  fillPolygon([ring], land, 0);
  fillPolygon([ring], waterName, index);
}
log('lakes carved');

// Deserts outside the hand-made region: growth there is slow for settled provinces, and each desert gets a
// wasteland seed so the open desert becomes impassable wasteland.
const geography = readFeatures<{ FEATURECLA: string; NAME: string }>(GEOGRAPHY_SOURCE);
const deserts = geography.filter((f) => f.properties.FEATURECLA === 'Desert' && !NOT_DESERTS.has(f.properties.NAME));
const desert = new Uint8Array(N);
deserts.forEach((f, i) => {
  if (f.geometry) for (const poly of polygonsOf(f.geometry)) fillPolygon(poly, desert, i + 1, (p) => land[p] === 1 && outsideHandMade(p));
});
log(`${deserts.length} deserts rasterised`);

// --- 2. Seeds ---------------------------------------------------------------------------------
interface Def { id: number; key: string; name: string; kind: ProvinceKind }
const defs: Def[] = [];
const keys = new Set<string>();
const medium: number[] = [0]; // 1 = grows over land, 0 = over water; index = province id
const maxCost: number[] = [0]; // growth budget per province (Infinity = unlimited)
const slow: boolean[] = [false]; // wasteland and mountains: grow slower than settled land (or not at all)
const seedPixel = new Map<number, [number, number]>();
const owner = new Int32Array(N);
let dist: Int32Array | null = new Int32Array(N).fill(0x7fffffff);

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
function addSeed(kind: ProvinceKind, key: string, name: string, p: number, radiusKm?: number): number {
  const id = defs.length + 1;
  let k = key;
  for (let i = 2; keys.has(k); i++) k = `${key}_${i}`;
  keys.add(k);
  defs.push({ id, key: k, name, kind });
  medium[id] = kind === 'sea' ? 0 : 1;
  maxCost[id] = kind === 'wasteland' ? Infinity : radiusToCost(radiusKm ?? (kind === 'land' ? DEFAULT_MAX_RADIUS_KM : Infinity));
  slow[id] = kind === 'wasteland';
  seedPixel.set(id, [p % W, Math.floor(p / W)]);
  owner[p] = id;
  dist![p] = 0;
  seedQueue.push(p);
  return id;
}
const groups: [ProvinceKind, typeof seeds.land][] = [['land', seeds.land], ['wasteland', seeds.wasteland], ['sea', seeds.sea]];
for (const [kind, rows] of groups) {
  for (const [key, name, lat, lon, radiusKm] of rows) {
    const [px, py] = lonLatToPixel(projection, lon, lat);
    const wantLand = kind === 'sea' ? 0 : 1;
    const p = snap(px, py, wantLand);
    if (p === null) {
      console.warn(`seed ${key}: no ${wantLand ? 'land' : 'water'} pixel within ${SNAP_RADIUS}px, skipped`);
      continue;
    }
    addSeed(kind, key, name, p, radiusKm);
  }
}

// One wasteland seed per desert, at the desert pixel nearest its centre.
{
  const sx = new Float64Array(deserts.length + 1);
  const sy = new Float64Array(deserts.length + 1);
  const n = new Float64Array(deserts.length + 1);
  for (let p = 0; p < N; p++) {
    const d = desert[p]!;
    if (!d) continue;
    sx[d]! += p % W;
    sy[d]! += Math.floor(p / W);
    n[d]!++;
  }
  for (let d = 1; d <= deserts.length; d++) {
    if (!n[d]) continue;
    const [px, py] = [sx[d]! / n[d]!, sy[d]! / n[d]!];
    let best = -1;
    let bestD = Infinity;
    // Coarse search: every 4th pixel of a box around the centre is plenty to find a pixel of this desert.
    const R = 1500;
    for (let y = Math.max(0, Math.floor(py - R)); y < Math.min(H, py + R); y += 4) {
      for (let x = Math.max(0, Math.floor(px - R)); x < Math.min(W, px + R); x += 4) {
        const p = y * W + x;
        if (desert[p] !== d || owner[p] !== 0) continue;
        const dd = (x - px) ** 2 + (y - py) ** 2;
        if (dd < bestD) { bestD = dd; best = p; }
      }
    }
    if (best >= 0) addSeed('wasteland', 'desert_' + slugify(deserts[d - 1]!.properties.NAME), titleCase(deserts[d - 1]!.properties.NAME), best);
  }
}

// Automatic ocean zones on a grid wherever no sea seed is near, named by ocean.
function oceanName(lat: number, lon: number): string {
  if (lat > 66) return 'Arctic Ocean';
  if (lat < -45) return 'Southern Ocean';
  if (lon >= 20 && lon < 120 && lat < 25) return 'Indian Ocean';
  if (lon >= 120 && lon < 147 && lat < 0 && lat > -40) return 'Indian Ocean';
  if (lon >= 100 || lon < -70) return lon < -70 && lon > -100 && lat > 8 && lat < 31 ? 'Caribbean Sea' : 'Pacific Ocean';
  return 'Atlantic Ocean';
}
{
  const seas: [number, number][] = [];
  for (const d of defs) if (d.kind === 'sea') seas.push(seedPixel.get(d.id)!);
  const counts = new Map<string, number>();
  for (let y = OCEAN_GRID_PX / 2; y < H; y += OCEAN_GRID_PX) {
    for (let x = OCEAN_GRID_PX / 2; x < W; x += OCEAN_GRID_PX) {
      const p = snap(x, y, 0);
      if (p === null || waterName[p]) continue;
      const px = p % W;
      const py = (p - px) / W;
      if (seas.some(([sx, sy]) => (sx - px) ** 2 + (sy - py) ** 2 < (OCEAN_GRID_PX * 0.8) ** 2)) continue;
      const [lat, lon] = pixelLatLon(p);
      const name = oceanName(lat, lon);
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      addSeed('sea', slugify(name) + '_' + n, `${name} ${n}`, p);
      seas.push([px, py]);
    }
  }
}
log(`${defs.length} seeds placed`);

// --- 2b. Impassable mountain ranges -------------------------------------------------------------
// data/map/mountains.yaml: polylines with a width in km, traced by hand. Outside the hand-made region the big
// Natural Earth ranges in IMPASSABLE_RANGES are used as polygons. Mountain pixels become fixed 'mountain'
// provinces: they do not grow, nothing grows into them, and district snapping leaves them alone.
const mountainMask = new Uint8Array(N);
{
  const seedPixels = new Set<number>();
  for (const [, [x, y]] of seedPixel) seedPixels.add(y * W + x);
  const addMountain = (name: string): number => {
    const id = defs.length + 1;
    let key = 'mtn_' + slugify(name);
    for (let i = 2; keys.has(key); i++) key = `mtn_${slugify(name)}_${i}`;
    keys.add(key);
    defs.push({ id, key, name, kind: 'mountain' });
    medium[id] = 1;
    maxCost[id] = 0;
    slow[id] = true;
    return id;
  };
  const claim = (p: number, id: number) => {
    if (!land[p] || seedPixels.has(p) || owner[p]! > 0) return false;
    owner[p] = id;
    dist![p] = 0;
    mountainMask[p] = 1;
    return true;
  };
  type Range = { name: string; width_km: number; lines: [number, number][][] };
  for (const range of (parse(readFileSync('data/map/mountains.yaml', 'utf8')) ?? []) as Range[]) {
    const id = addMountain(range.name);
    const r = Math.max(1, range.width_km / kmPerPx / 2);
    let first = -1;
    for (const line of range.lines) {
      const pts = line.map(([lat, lon]) => lonLatToPixel(projection, lon, lat));
      for (let s = 0; s + 1 < pts.length; s++) {
        const [x0, y0] = pts[s]!;
        const [x1, y1] = pts[s + 1]!;
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let i = 0; i <= steps; i++) {
          const cx = x0 + ((x1 - x0) * i) / steps;
          const cy = y0 + ((y1 - y0) * i) / steps;
          for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
              if (x < 0 || y < 0 || x >= W || y >= H || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
              if (claim(y * W + x, id) && first < 0) first = y * W + x;
            }
          }
        }
      }
    }
    if (first >= 0) seedPixel.set(id, [first % W, Math.floor(first / W)]);
  }
  const tmp = new Uint8Array(N);
  for (const f of geography) {
    if (f.properties.FEATURECLA !== 'Range/mtn' || !IMPASSABLE_RANGES.has(f.properties.NAME) || !f.geometry) continue;
    const id = addMountain(titleCase(f.properties.NAME));
    for (const poly of polygonsOf(f.geometry)) fillPolygon(poly, tmp, 1, outsideHandMade);
    let first = -1;
    for (let p = 0; p < N; p++) {
      if (!tmp[p]) continue;
      tmp[p] = 0;
      if (claim(p, id) && first < 0) first = p;
    }
    if (first >= 0) seedPixel.set(id, [first % W, Math.floor(first / W)]);
  }
}
log('mountains placed');

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
let terrainCost: Uint8Array | null = new Uint8Array(N);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const n = 0.65 * valueNoise(x, y, 48) + 0.35 * valueNoise(x, y, 13);
    terrainCost[y * W + x] = Math.round(6 + n * 10); // 6..16, averaging ~10
  }
}
log('noise ready');

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
const corridor = new Uint8Array(N);
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

// Larger than the biggest single step cost (16 * 1.4 * max(WASTELAND_SLOWDOWN, DESERT_SLOWDOWN) + 1).
const BUCKETS = 128;
{
  const d0 = dist!;
  const tc = terrainCost;
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  for (const p of seedQueue) buckets[0]!.push(p);
  let pending = seedQueue.length;
  for (let d = 0; pending > 0; d++) {
    const bucket = buckets[d % BUCKETS]!;
    while (bucket.length) {
      const p = bucket.pop()!;
      pending--;
      if (d0[p] !== d) continue; // stale entry
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
        const base = diagonal ? Math.round(tc[q]! * 1.4) : tc[q]!;
        const step = slow[id] ? base * WASTELAND_SLOWDOWN : desert[q] && !corridor[q] ? base * DESERT_SLOWDOWN : base;
        const nd = d + step;
        if (corridor[q] && slow[id]) continue;
        if (nd >= d0[q]! || (nd > maxCost[id]! && !corridor[q])) continue;
        d0[q] = nd;
        owner[q] = id;
        buckets[nd % BUCKETS]!.push(q);
        pending++;
      }
    }
  }
}
// eslint-disable-next-line no-useless-assignment -- frees ~200 MB before the next stages
terrainCost = null;
log('growth done');

function neighbours(p: number): number[] {
  const x = p % W;
  const out: number[] = [];
  if (x > 0) out.push(p - 1);
  if (x < W - 1) out.push(p + 1);
  if (p >= W) out.push(p - W);
  if (p < N - W) out.push(p + W);
  return out;
}

// --- 4a. District borders (geoBoundaries for its countries, Natural Earth admin-1 elsewhere) ------
const BOUNDARY_DIR = `${VENDOR}/geoboundaries`;
let district: Uint16Array | null = new Uint16Array(N);
const districtName: string[] = [''];
{
  const covered = new Set<string>();
  if (existsSync(BOUNDARY_DIR)) {
    for (const file of readdirSync(BOUNDARY_DIR).filter((f) => f.endsWith('.geojson')).sort()) {
      covered.add(file.replace('.geojson', ''));
      for (const f of readFeatures<{ shapeName?: string }>(`${BOUNDARY_DIR}/${file}`)) {
        if (!f.geometry) continue;
        const index = districtName.push(f.properties.shapeName ?? '') - 1;
        for (const poly of polygonsOf(f.geometry)) fillPolygon(poly, district, index);
      }
    }
  }
  if (existsSync(ADMIN1_SOURCE)) {
    for (const f of readFeatures<{ adm0_a3: string; name: string | null }>(ADMIN1_SOURCE)) {
      if (!f.geometry || covered.has(f.properties.adm0_a3)) continue;
      const index = districtName.push(f.properties.name ?? '') - 1;
      for (const poly of polygonsOf(f.geometry)) fillPolygon(poly, district, index, (p) => district![p] === 0);
    }
  }
  if (districtName.length > 65535) throw new Error('too many districts for a 16-bit district map');
}
log(`${districtName.length - 1} districts rasterised`);

// --- 4b. Unreached components (seedless islands, empty wilds, inland water) ------------------------
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
let wildsCount = 0;
for (let start = 0; start < N; start++) {
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
  if (m === 1 && comp.length >= MIN_WILDS_PIXELS) {
    // Empty interior beyond every settlement's reach: an impassable wilderness named after its district.
    const dn = districtName[district![comp[comp.length >> 1]!]!] || 'the Interior';
    wildsCount++;
    id = defs.length + 1;
    let key = 'wilds_' + (slugify(dn) || String(wildsCount));
    for (let i = 2; keys.has(key); i++) key = `wilds_${slugify(dn)}_${i}`;
    keys.add(key);
    defs.push({ id, key, name: `${dn} Wilds`, kind: 'wasteland' });
    medium[id] = 1;
    slow[id] = true;
    seedPixel.set(id, [start % W, Math.floor(start / W)]);
  } else if (m === 1) {
    id = nearestLandProvince(start % W, Math.floor(start / W));
  } else if (comp.length >= MIN_LAKE_PIXELS || comp.some((p) => waterName[p]! > 0)) {
    // Named lakes are kept whatever their size; pieces of one named lake share a province.
    const named = waterNames[comp.map((p) => waterName[p]!).find((n) => n > 0) ?? 0] || undefined;
    const slug = named ? slugify(named.replace(/^lake\s+/i, '')) : undefined;
    const existing = slug ? defs.find((d) => d.key === 'lake_' + slug) : undefined;
    if (existing) {
      id = existing.id;
    } else {
      lakeCount++;
      id = defs.length + 1;
      const key = slug ? 'lake_' + slug : `lake_${lakeCount}`;
      keys.add(key);
      defs.push({ id, key, name: named ?? `Lake ${lakeCount}`, kind: 'lake' });
    }
  } else {
    id = touching || nearestLandProvince(start % W, Math.floor(start / W));
    for (const p of comp) land[p] = 1;
  }
  for (const p of comp) owner[p] = id;
}
log(`unreached areas resolved (${lakeCount} lakes, ${wildsCount} wilds)`);

// --- 4c. Snap provinces to real district borders (see data/map/ATTRIBUTION.md) -----------------------
// A district holding one seed joins that seed's province; a district without seeds joins whichever
// province already covers most of it. Districts with several seeds keep the grown borders inside them,
// mostly-desert districts are left alone so desert-edge provinces keep their radius-limited shape, and so are
// districts much larger than the province they would join (coarse units such as German Regierungsbezirke).
const MAX_WASTE_SHARE = 0.4;
/** A district may be at most this many times the grown size of the province it would join. */
const MAX_DISTRICT_RATIO = 1.5;
{
  const dmap = district!;
  const districtCount = districtName.length - 1;
  const seedsIn = new Map<number, Set<number>>();
  for (const [id, [x, y]] of seedPixel) {
    const d = dmap[y * W + x]!;
    if (!d || medium[id] !== 1) continue;
    let set = seedsIn.get(d);
    if (!set) seedsIn.set(d, (set = new Set()));
    set.add(id);
  }
  const counts: Map<number, number>[] = Array.from({ length: districtCount + 1 }, () => new Map());
  const grown = new Uint32Array(defs.length + 1);
  for (let p = 0; p < N; p++) {
    const o = owner[p]!;
    if (o > 0) grown[o]!++;
    const d = dmap[p]!;
    if (!d || !land[p] || o <= 0) continue;
    const c = counts[d]!;
    c.set(o, (c.get(o) ?? 0) + 1);
  }
  const target = new Int32Array(districtCount + 1);
  let snapped = 0;
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
    snapped++;
  }
  for (let p = 0; p < N; p++) {
    const t = target[dmap[p]!]!;
    // Corridors keep the province that grew along them; mountains are never snapped away.
    if (t && land[p] && !corridor[p] && !mountainMask[p]) owner[p] = t;
  }
  log(`snapped ${snapped} of ${districtCount} districts`);
}
district = null;

// --- 4d. Keep each province in one piece ----------------------------------------------------------
// Snapping can strand small pieces of a province; hand each piece without the seed to the land
// province it borders most. Seedless islands (no land neighbours) stay where they are.
{
  const seen = new Uint8Array(N);
  let merged = 0;
  for (let start = 0; start < N; start++) {
    const o = owner[start]!;
    if (seen[start] || o <= 0 || medium[o] !== 1) continue;
    const [sx, sy] = seedPixel.get(o) ?? [-1, -1];
    const seedP = sy * W + sx;
    const comp: number[] = [];
    const border = new Map<number, number>();
    let hasSeed = false;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      if (p === seedP) hasSeed = true;
      for (const q of neighbours(p)) {
        const oq = owner[q]!;
        if (oq === o) {
          if (!seen[q]) { seen[q] = 1; stack.push(q); }
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
  log(`merged ${merged} stranded fragments`);
}

// --- 4e. Every settled province reachable by land ------------------------------------------------
// Mountains and deserts can wall in a valley that was reachable in reality. On each landmass, the largest
// group of mutually reachable settled provinces is the main one; every other group on that landmass gets the
// shortest pass (fewest mountain or wasteland pixels) cut to other settled land. Lone islands stay islands.
{
  const PASS_HALF_WIDTH_PX = 2;
  const MAX_PASS_PX = 400;
  const settled = (o: number) => o > 0 && medium[o] === 1 && !slow[o];

  // Landmass labels (all land, settled or not), reusing the growth distance array. Span-based flood fill.
  const mass = dist!;
  mass.fill(0);
  let masses = 0;
  for (let start = 0; start < N; start++) {
    if (!land[start] || mass[start]) continue;
    masses++;
    const stack = [start];
    while (stack.length) {
      const s = stack.pop()!;
      if (mass[s]) continue;
      const y = Math.floor(s / W);
      let x0 = s % W;
      while (x0 > 0 && land[y * W + x0 - 1] && !mass[y * W + x0 - 1]) x0--;
      let x1 = s % W;
      while (x1 < W - 1 && land[y * W + x1 + 1] && !mass[y * W + x1 + 1]) x1++;
      for (let x = x0; x <= x1; x++) {
        mass[y * W + x] = masses;
        for (const ny of [y - 1, y + 1]) {
          if (ny < 0 || ny >= H) continue;
          const q = ny * W + x;
          if (land[q] && !mass[q] && (x === x0 || !land[q - 1] || mass[q - 1])) stack.push(q);
        }
      }
    }
  }

  const parent = Array.from({ length: defs.length + 1 }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (let p = 0; p < N; p++) {
    const o = owner[p]!;
    if (!settled(o)) continue;
    const x = p % W;
    if (x + 1 < W && settled(owner[p + 1]!) && owner[p + 1] !== o) union(o, owner[p + 1]!);
    if (p + W < N && settled(owner[p + W]!) && owner[p + W] !== o) union(o, owner[p + W]!);
  }
  // Size of each settled group and the landmass it sits on; the largest group per landmass is its main group.
  const groupSize = new Map<number, number>();
  const groupMass = new Map<number, number>();
  for (const d of defs) {
    if (!settled(d.id)) continue;
    const s = seedPixel.get(d.id);
    if (!s) continue;
    const r = find(d.id);
    groupSize.set(r, (groupSize.get(r) ?? 0) + 1);
    groupMass.set(r, mass[s[1] * W + s[0]]!);
  }
  const mainOf = new Map<number, number>();
  for (const [r, size] of groupSize) {
    const m = groupMass.get(r)!;
    const cur = mainOf.get(m);
    if (cur === undefined || size > groupSize.get(cur)!) mainOf.set(m, r);
  }
  const walled = [...groupSize.keys()].filter((r) => mainOf.get(groupMass.get(r)!) !== r);

  // Boundary pixels of each walled group: its settled pixels next to non-settled land.
  const walledSet = new Set(walled);
  const boundary = new Map<number, number[]>();
  for (let p = 0; p < N; p++) {
    const o = owner[p]!;
    if (!settled(o)) continue;
    const r = find(o);
    if (!walledSet.has(r)) continue;
    if (neighbours(p).some((q) => land[q] && !settled(owner[q]!))) {
      let list = boundary.get(r);
      if (!list) boundary.set(r, (list = []));
      list.push(p);
    }
  }

  let passes = 0;
  for (const r0 of walled) {
    const root = find(r0);
    if (mainOf.get(groupMass.get(r0)!) !== undefined && find(mainOf.get(groupMass.get(r0)!)!) === root) continue;
    // Breadth-first search outwards through non-settled land until another settled group is reached.
    const prev = new Map<number, number>();
    let frontier = boundary.get(r0) ?? [];
    for (const p of frontier) prev.set(p, -1);
    let target = -1;
    for (let c = 0; c <= MAX_PASS_PX && frontier.length && target < 0; c++) {
      const next: number[] = [];
      for (const p of frontier) {
        for (const q of neighbours(p)) {
          if (!land[q] || prev.has(q)) continue;
          const oq = owner[q]!;
          if (settled(oq)) {
            if (find(oq) !== root) { prev.set(q, p); target = q; break; }
            continue;
          }
          prev.set(q, p);
          next.push(q);
        }
        if (target >= 0) break;
      }
      frontier = next;
    }
    if (target < 0) continue;
    let from = target;
    while (prev.get(from)! !== -1) from = prev.get(from)!;
    const passOwner = owner[from]!;
    for (let p = prev.get(target)!; p !== -1 && p !== undefined; p = prev.get(p)!) {
      if (settled(owner[p]!)) continue;
      const cx = p % W, cy = (p - cx) / W;
      for (let dy = -PASS_HALF_WIDTH_PX; dy <= PASS_HALF_WIDTH_PX; dy++) {
        for (let dx = -PASS_HALF_WIDTH_PX; dx <= PASS_HALF_WIDTH_PX; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const q = y * W + x;
          if (land[q] && !settled(owner[q]!)) owner[q] = passOwner;
        }
      }
    }
    union(root, owner[target]!);
    passes++;
  }
  log(`${masses} landmasses, cut ${passes} passes to walled-in provinces`);
}
dist = null;

// --- 5. Colours and output --------------------------------------------------------------------
const rng = createRng(1302);
const used = new Set<number>([0]);
function pick(kind: ProvinceKind): number {
  for (;;) {
    let r: number, g: number, b: number;
    if (kind === 'mountain') {
      const base = 70 + nextInt(rng, 40);
      r = base + 10 + nextInt(rng, 10); g = base + nextInt(rng, 10); b = base - 5 + nextInt(rng, 10);
    } else if (kind === 'sea' || kind === 'lake') {
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
// Provinces that ended up with no pixels (e.g. a seed swallowed by snapping) are dropped and ids compacted.
{
  const present = new Uint8Array(defs.length + 1);
  for (let p = 0; p < N; p++) if (owner[p]! > 0) present[owner[p]!] = 1;
  const remap = new Int32Array(defs.length + 1);
  const kept: Def[] = [];
  for (const d of defs) {
    if (!present[d.id]) continue;
    remap[d.id] = kept.length + 1;
    kept.push({ ...d, id: kept.length + 1 });
  }
  for (let p = 0; p < N; p++) owner[p] = remap[owner[p]!]!;
  if (kept.length !== defs.length) log(`dropped ${defs.length - kept.length} empty provinces`);
  defs.length = 0;
  defs.push(...kept);
}
if (defs.length > 65535) throw new Error(`${defs.length} provinces do not fit 16-bit province ids`);
const colors = [0, ...defs.map((d) => pick(d.kind))];

const png = new PNG({ width: W, height: H });
for (let p = 0; p < N; p++) {
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
  '# Generated by tools/seed-map.ts, then edited by hand. kind: land | sea | wasteland | mountain | lake.',
  ...defs.map((d) => `- { id: ${d.id}, key: ${d.key}, name: ${JSON.stringify(d.name)}, kind: ${d.kind}, color: "${hex(colors[d.id]!)}" }`),
];
writeFileSync(OUT_DEFS, lines.join('\n') + '\n');
log(`wrote ${OUT_PNG} (${W}x${H}) and ${defs.length} definitions (${lakeCount} lakes, ${wildsCount} wilds)`);
