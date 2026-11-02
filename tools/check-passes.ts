/** For each pass in data/map/passes.yaml: is there a land-only path between the provinces at its ends, near the route? Run after build-map. */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { lonLatToPixel, type MapData } from '../src/content/map';

const root = '.';
const map = JSON.parse(readFileSync(`${root}/public/generated/map.json`, 'utf8')) as MapData;
const byId = new Map(map.provinces.map((p) => [p.id, p]));
const tiles = new Map<string, PNG>();
const idAt = (x: number, y: number) => {
  const [c, r] = [Math.floor(x / map.tileSize), Math.floor(y / map.tileSize)];
  const k = `${c}-${r}`;
  if (!tiles.has(k)) tiles.set(k, PNG.sync.read(readFileSync(`${root}/public/generated/province-ids-${k}.png`)));
  const t = tiles.get(k)!;
  const i = ((y - r * map.tileSize) * t.width + (x - c * map.tileSize)) * 4;
  return t.data[i]! | (t.data[i + 1]! << 8);
};
for (const line of readFileSync(`${root}/data/map/passes.yaml`, 'utf8').split('\n')) {
  const m = /^([^#:][^:]*):\s*\[(.*)\]\s*$/.exec(line);
  if (!m) continue;
  const pts = [...m[2]!.matchAll(/\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)].map((q) => lonLatToPixel(map.projection, Number(q[2]), Number(q[1])).map(Math.floor) as [number, number]);
  const start = idAt(...pts[0]!), end = idAt(...pts[pts.length - 1]!);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const box = [Math.min(...xs) - 120, Math.min(...ys) - 120, Math.max(...xs) + 120, Math.max(...ys) + 120];
  const inBox = (id: number) => { const c = byId.get(id)!.centroid; return c[0] >= box[0]! && c[0] <= box[2]! && c[1] >= box[1]! && c[1] <= box[3]!; };
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of byId.get(id)!.adjacency) {
      const q = byId.get(n.id)!;
      if (n.border > 0 && q.kind === 'land' && !seen.has(n.id) && inBox(n.id)) { seen.add(n.id); queue.push(n.id); }
    }
  }
  const ok = byId.get(start)?.kind === 'land' && byId.get(end)?.kind === 'land' && seen.has(end);
  if (!ok) process.exitCode = 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${m[1]!.trim()}: ${byId.get(start)?.name} (${byId.get(start)?.kind}) -> ${byId.get(end)?.name} (${byId.get(end)?.kind})`);
}
