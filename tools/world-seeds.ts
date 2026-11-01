/**
 * One-off: writes data/map/seeds-world.yaml, the land seeds for everywhere outside the hand-made region of
 * data/map/seeds.yaml. Seeds are Natural Earth populated places (public domain), largest first, thinned so no
 * two are closer than MIN_SPACING_KM. The names are modern placeholders to be replaced with 1302 names.
 *
 * Usage: npm run world-seeds   (needs tools/vendor/ne_10m_populated_places_simple.geojson)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { projectionSchema, seedsSchema } from '../src/content/map';
import { HAND_MADE_REGION, inRegion } from './regions';

const SOURCE = 'tools/vendor/ne_10m_populated_places_simple.geojson';
const MIN_SPACING_KM = 60;

interface Place { name: string; nameascii: string; latitude: number; longitude: number; pop_max: number }

const projection = projectionSchema.parse(parse(readFileSync('data/map/projection.yaml', 'utf8')));
const handMade = seedsSchema.parse(parse(readFileSync('data/map/seeds.yaml', 'utf8')));
const places = (JSON.parse(readFileSync(SOURCE, 'utf8')) as { features: { properties: Place }[] }).features
  .map((f) => f.properties)
  .filter((p) => p.latitude >= projection.south && p.latitude <= projection.north)
  .filter((p) => !inRegion(HAND_MADE_REGION, p.latitude, p.longitude))
  .sort((a, b) => b.pop_max - a.pop_max);

const R = 6371;
const rad = Math.PI / 180;
function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const h = Math.sin(((bLat - aLat) * rad) / 2) ** 2
    + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(((bLon - aLon) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const keys = new Set([...handMade.land, ...handMade.wasteland, ...handMade.sea].map((r) => r[0]));
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'place';
const accepted: { key: string; name: string; lat: number; lon: number }[] = [];
for (const p of places) {
  if (accepted.some((a) => km(a.lat, a.lon, p.latitude, p.longitude) < MIN_SPACING_KM)) continue;
  let key = slug(p.nameascii || p.name);
  if (keys.has(key)) key = `${key}_w`;
  for (let i = 2; keys.has(key); i++) key = `${slug(p.nameascii || p.name)}_w${i}`;
  keys.add(key);
  accepted.push({ key, name: p.name, lat: p.latitude, lon: p.longitude });
}
accepted.sort((a, b) => b.lat - a.lat || a.lon - b.lon);

const quote = (s: string) => (/^[\w .'-]+$/.test(s) && !/^[-'. ]/.test(s) ? s : JSON.stringify(s));
const lines = [
  '# Land seeds outside the hand-made region of seeds.yaml (see tools/world-seeds.ts).',
  `# Natural Earth populated places (public domain), thinned to ${MIN_SPACING_KM} km. Names are modern placeholders.`,
  'land:',
  ...accepted.map((a) => `  - [${a.key}, ${quote(a.name)}, ${a.lat.toFixed(2)}, ${a.lon.toFixed(2)}]`),
  'wasteland: []',
  'sea: []',
];
writeFileSync('data/map/seeds-world.yaml', lines.join('\n') + '\n');
console.log(`world-seeds: ${accepted.length} land seeds`);
