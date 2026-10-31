/** Validates data/map and writes public/generated/{province-ids.png, map.json}. Runs as part of `npm run build`. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { parse } from 'yaml';
import { definitionsSchema, projectionSchema, projectionSize, straitsSchema, type MapData } from '../src/content/map';
import { buildMap, encodeIdMap } from './map-lib';

const OUT_DIR = 'public/generated';

const projection = projectionSchema.parse(parse(readFileSync('data/map/projection.yaml', 'utf8')));
const defs = definitionsSchema.parse(parse(readFileSync('data/map/definitions.yaml', 'utf8')));
const straits = straitsSchema.parse(parse(readFileSync('data/map/straits.yaml', 'utf8')) ?? []);
const png = PNG.sync.read(readFileSync('data/map/provinces.png'));

const expected = projectionSize(projection);
if (png.width !== expected.width || png.height !== expected.height) {
  console.error(`provinces.png is ${png.width}x${png.height}, projection expects ${expected.width}x${expected.height}`);
  process.exit(1);
}

const built = buildMap({ width: png.width, height: png.height, data: png.data }, defs, straits);
for (const w of built.warnings) console.warn(`warning: ${w}`);
if (built.errors.length) {
  for (const e of built.errors) console.error(`error: ${e}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const ids = new PNG({ width: png.width, height: png.height });
ids.data = Buffer.from(encodeIdMap(built.idMap));
writeFileSync(`${OUT_DIR}/province-ids.png`, PNG.sync.write(ids, { colorType: 2 }));
const mapData: MapData = { width: png.width, height: png.height, projection, provinces: built.provinces };
writeFileSync(`${OUT_DIR}/map.json`, JSON.stringify(mapData));
console.log(`build-map: ${built.provinces.length} provinces, ${built.warnings.length} warnings`);
