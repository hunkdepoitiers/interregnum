/** Debug: prints the province under each lat,lon argument and the nearest land provinces. Usage: tsx tools/where.ts 45.5,6.0 ... */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { lonLatToPixel, type MapData } from '../src/content/map';

const map = JSON.parse(readFileSync('public/generated/map.json', 'utf8')) as MapData;
const byId = new Map(map.provinces.map((p) => [p.id, p]));
for (const arg of process.argv.slice(2)) {
  const [lat, lon] = arg.split(',').map(Number) as [number, number];
  const [x, y] = lonLatToPixel(map.projection, lon, lat).map(Math.floor) as [number, number];
  const [col, row] = [Math.floor(x / map.tileSize), Math.floor(y / map.tileSize)];
  const png = PNG.sync.read(readFileSync(`public/generated/province-ids-${col}-${row}.png`));
  const i = (y - row * map.tileSize) * png.width + (x - col * map.tileSize);
  const p = byId.get(png.data[i * 4]! | (png.data[i * 4 + 1]! << 8));
  const near = map.provinces.filter((q) => q.kind === 'land')
    .map((q) => ({ q, d: Math.hypot(q.centroid[0] - x, q.centroid[1] - y) }))
    .sort((a, b) => a.d - b.d).slice(0, 3).map(({ q, d }) => `${q.key} ${Math.round(d * 1.4)}km`);
  console.log(`${arg}: ${p ? `${p.key} (${p.kind})` : 'none'}; nearest land: ${near.join(', ')}`);
}
