/**
 * Lists land cut off by impassable terrain: groups of land provinces that would join a bigger landmass if mountains
 * and wasteland were passable, but have no land route to it now (islands, cut off by sea, are not listed).
 * Run after build-map: `tsx tools/find-pockets.ts [--json]`. The JSON form feeds tools/carve_passes.py.
 */
import { readFileSync } from 'node:fs';
import { pixelToLonLat, type MapData, type MapProvince } from '../src/content/map';

const map = JSON.parse(readFileSync('public/generated/map.json', 'utf8')) as MapData;
const byId = new Map(map.provinces.map((p) => [p.id, p]));
const terrain = (p: MapProvince) => p.kind === 'land' || p.kind === 'mountain' || p.kind === 'wasteland';

function components(ok: (p: MapProvince) => boolean): Map<number, number> {
  const comp = new Map<number, number>();
  let next = 0;
  for (const p of map.provinces) {
    if (!ok(p) || comp.has(p.id)) continue;
    const stack = [p.id];
    comp.set(p.id, ++next);
    while (stack.length) {
      for (const n of byId.get(stack.pop()!)!.adjacency) {
        const q = byId.get(n.id)!;
        if (n.border > 0 && ok(q) && !comp.has(q.id)) { comp.set(q.id, next); stack.push(q.id); }
      }
    }
  }
  return comp;
}

const land = components((p) => p.kind === 'land');
const all = components(terrain);
// Land area per land component, and the biggest land component inside each terrain component.
const area = new Map<number, number>();
for (const p of map.provinces) if (p.kind === 'land') area.set(land.get(p.id)!, (area.get(land.get(p.id)!) ?? 0) + p.pixels);
const mainOf = new Map<number, number>();
for (const p of map.provinces) {
  if (p.kind !== 'land') continue;
  const t = all.get(p.id)!, l = land.get(p.id)!;
  const cur = mainOf.get(t);
  if (cur === undefined || area.get(l)! > area.get(cur)!) mainOf.set(t, l);
}
const pockets = new Map<number, MapProvince[]>();
for (const p of map.provinces) {
  if (p.kind !== 'land') continue;
  const l = land.get(p.id)!;
  if (mainOf.get(all.get(p.id)!) !== l) pockets.set(l, [...(pockets.get(l) ?? []), p]);
}
const list = [...pockets.values()].map((ps) => {
  const biggest = ps.reduce((a, b) => (b.pixels > a.pixels ? b : a));
  const [lon, lat] = pixelToLonLat(map.projection, biggest.centroid[0], biggest.centroid[1]);
  return { name: biggest.name, provinces: ps.length, pixels: ps.reduce((s, p) => s + p.pixels, 0), lat: +lat.toFixed(3), lon: +lon.toFixed(3), x: biggest.centroid[0], y: biggest.centroid[1] };
}).sort((a, b) => b.pixels - a.pixels);
if (process.argv.includes('--json')) console.log(JSON.stringify(list));
else {
  console.log(`${list.length} pockets, ${list.reduce((s, p) => s + p.provinces, 0)} provinces`);
  for (const p of list) console.log(`${String(p.provinces).padStart(4)} prov ${String(p.pixels).padStart(7)} px  ${p.name} (${p.lat}, ${p.lon})`);
}
