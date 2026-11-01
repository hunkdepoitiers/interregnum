/** Validates data/scenario/1314.yaml against the built map and writes public/generated/scenario.json. Runs after build-map. */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { parse } from 'yaml';
import { seedsSchema, type MapData } from '../src/content/map';
import { scenarioSourceSchema } from '../src/content/scenario';
import { compileScenario } from './data-lib';

const SCENARIO = 'data/scenario/1314.yaml';
const map = JSON.parse(readFileSync('public/generated/map.json', 'utf8')) as MapData;
const parsed = scenarioSourceSchema.safeParse(parse(readFileSync(SCENARIO, 'utf8')));
if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(`error: ${SCENARIO} ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const towns = new Map<string, [number, number]>();
for (const file of ['data/map/seeds.yaml', 'data/map/seeds-world.yaml']) {
  for (const [key, , lat, lon] of seedsSchema.parse(parse(readFileSync(file, 'utf8'))).land) towns.set(key, [lat, lon]);
}

// Id-map tiles from build-map (id = R + 256 G), decoded on first use.
const tiles = new Map<string, Uint16Array>();
function idAt(x: number, y: number): number {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return 0;
  const [col, row] = [Math.floor(x / map.tileSize), Math.floor(y / map.tileSize)];
  const name = `${col}-${row}`;
  let ids = tiles.get(name);
  if (!ids) {
    const png = PNG.sync.read(readFileSync(`public/generated/province-ids-${name}.png`));
    ids = new Uint16Array(png.width * png.height);
    for (let i = 0; i < ids.length; i++) ids[i] = png.data[i * 4]! | (png.data[i * 4 + 1]! << 8);
    tiles.set(name, ids);
  }
  const w = Math.min(map.tileSize, map.width - col * map.tileSize);
  return ids[(y - row * map.tileSize) * w + (x - col * map.tileSize)]!;
}

const { scenario, errors, warnings, unowned } = compileScenario(parsed.data, map.provinces, { projection: map.projection, towns, idAt });
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
writeFileSync('public/generated/scenario.json', JSON.stringify(scenario));
const owned = scenario.owner.filter(Boolean).length;
console.log(`build-data: ${scenario.realms.length} realms, ${owned} owned and ${unowned} unowned land provinces, ${warnings.length} warnings`);
