/**
 * One-off: extracts the major rivers inside the map area from Natural Earth (public domain) into the small,
 * committed data/map/rivers.json, so the game and the Vercel build don't need the large source file.
 *
 * Usage: npm run build-rivers   (needs tools/vendor/ne_10m_rivers_lake_centerlines.geojson)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { projectionSchema } from '../src/content/map';

const SOURCE = 'tools/vendor/ne_10m_rivers_lake_centerlines.geojson';
/** Natural Earth scalerank: 0 = largest rivers. Above this, rivers are too minor for the map. */
const MAX_RANK = 9;
/** Douglas-Peucker tolerance in degrees (~1 km). */
const TOLERANCE = 0.01;

type Line = [number, number][];
type Geometry = { type: 'LineString'; coordinates: Line } | { type: 'MultiLineString'; coordinates: Line[] };
interface Feature { properties: { featurecla: string; scalerank: number; name: string | null }; geometry: Geometry | null }

const p = projectionSchema.parse(parse(readFileSync('data/map/projection.yaml', 'utf8')));
const inside = ([lon, lat]: [number, number]) => lon >= p.west && lon <= p.east && lat >= p.south && lat <= p.north;

function simplify(pts: Line): Line {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let worst = -1;
    let worstD = TOLERANCE;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i]!;
      const d = Math.abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / len;
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Splits a line into runs that stay inside the map area. */
function clip(line: Line): Line[] {
  const runs: Line[] = [];
  let cur: Line = [];
  for (const pt of line) {
    if (inside(pt)) cur.push(pt);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}

const geo = JSON.parse(readFileSync(SOURCE, 'utf8')) as { features: Feature[] };
const rivers: { name: string | null; rank: number; lines: number[][][] }[] = [];
for (const f of geo.features) {
  // Lake centerlines carry the river through modern reservoirs (e.g. the Dnieper), which did not exist in 1302.
  const isRiver = f.properties.featurecla === 'River' || f.properties.featurecla === 'Lake Centerline';
  if (!f.geometry || !isRiver || f.properties.scalerank > MAX_RANK) continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const kept = lines.flatMap(clip).map(simplify).map((l) => l.map(([lon, lat]) => [+lat.toFixed(3), +lon.toFixed(3)]));
  if (kept.length) rivers.push({ name: f.properties.name, rank: f.properties.scalerank, lines: kept });
}
rivers.sort((a, b) => b.rank - a.rank); // draw minor rivers first so major ones sit on top
writeFileSync('data/map/rivers.json', JSON.stringify({
  source: 'Natural Earth 1:10m rivers and lake centerlines (public domain)',
  note: 'Points are [lat, lon]. rank = Natural Earth scalerank, 0 = largest.',
  rivers,
}));
console.log(`build-rivers: ${rivers.length} rivers, ${rivers.reduce((n, r) => n + r.lines.reduce((m, l) => m + l.length, 0), 0)} points`);
