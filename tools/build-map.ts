/**
 * Validates data/map and writes public/generated/{province-ids-<col>-<row>.png tiles, map.json, rivers.json}.
 * Runs as part of `npm run build`.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { parse } from 'yaml';
import {
  definitionsSchema, lonLatToPixel, projectionSchema, projectionSize, straitsSchema, terrains, type MapData, type RiverData,
  type Terrain,
} from '../src/content/map';
import { buildMap, encodeIdTile } from './map-lib';

const OUT_DIR = 'public/generated';
/** WebGL textures may not exceed 4096 px, so the id map is split into tiles of this size. */
const TILE_SIZE = 4096;

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
// Terrain from tools/classify_terrain.py, by key; a land province it does not know (renamed since) counts as plains.
const terrainOf = JSON.parse(readFileSync('data/map/terrain.json', 'utf8')) as Record<string, Terrain>;
let missingTerrain = 0;
for (const p of built.provinces) {
  if (p.kind !== 'land') continue;
  const t = terrainOf[p.key];
  if (!t || !terrains.includes(t)) missingTerrain++;
  p.terrain = t && terrains.includes(t) ? t : 'plains';
}
if (missingTerrain) console.warn(`warning: ${missingTerrain} land provinces have no terrain in data/map/terrain.json (run classify-terrain); using plains`);
for (const w of built.warnings) console.warn(`warning: ${w}`);
if (built.errors.length) {
  for (const e of built.errors) console.error(`error: ${e}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) if (f.startsWith('province-ids')) rmSync(`${OUT_DIR}/${f}`);
const tileCols = Math.ceil(png.width / TILE_SIZE);
const tileRows = Math.ceil(png.height / TILE_SIZE);
for (let row = 0; row < tileRows; row++) {
  for (let col = 0; col < tileCols; col++) {
    const x0 = col * TILE_SIZE;
    const y0 = row * TILE_SIZE;
    const w = Math.min(TILE_SIZE, png.width - x0);
    const h = Math.min(TILE_SIZE, png.height - y0);
    const tile = new PNG({ width: w, height: h });
    tile.data = Buffer.from(encodeIdTile(built.idMap, png.width, x0, y0, w, h));
    writeFileSync(`${OUT_DIR}/province-ids-${col}-${row}.png`, PNG.sync.write(tile, { colorType: 2 }));
  }
}
const mapData: MapData = {
  width: png.width, height: png.height, tileSize: TILE_SIZE, tileCols, tileRows, projection, provinces: built.provinces,
};
writeFileSync(`${OUT_DIR}/map.json`, JSON.stringify(mapData));

// Rivers (data/map/rivers.json, from tools/build-rivers.ts) converted to map pixels for the renderer.
const riverSource = JSON.parse(readFileSync('data/map/rivers.json', 'utf8')) as { rivers: { name: string | null; rank: number; lines: [number, number][][] }[] };
const rivers: RiverData = riverSource.rivers.map((r) => ({
  name: r.name,
  rank: r.rank,
  lines: r.lines.map((l) => l.flatMap(([lat, lon]) => lonLatToPixel(projection, lon, lat).map((v) => Math.round(v * 10) / 10))),
}));
writeFileSync(`${OUT_DIR}/rivers.json`, JSON.stringify(rivers));
console.log(`build-map: ${built.provinces.length} provinces, ${rivers.length} rivers, ${built.warnings.length} warnings`);
