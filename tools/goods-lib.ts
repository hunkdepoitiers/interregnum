import { pixelToLonLat, type MapProvince } from '../src/content/map';
import type { GoodsSource } from '../src/content/goods';
import type { GoodDef } from '../src/sim/content';
import { paintRegions, type MapContext } from './data-lib';

/** A stable number in [0, 1) per province and rule, so `share` picks the same provinces every build and rules with
 * a share draw independently of each other. */
function keyFraction(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  // Final avalanche (MurmurHash3 fmix32): without it keys differing only in their last character get nearly equal
  // values, and rules that follow each other would pick the same provinces.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Each land province's trade good: the first matching rule, then the famous places on top. */
export function compileGoods(src: GoodsSource, provinces: MapProvince[], ctx: MapContext): { goods: GoodDef[]; good: number[]; errors: string[] } {
  const errors: string[] = [];
  const goodId = new Map(src.goods.map((g, i) => [g.key, i + 1]));
  for (const r of src.rules) if (!goodId.has(r.good)) errors.push(`rules: unknown good ${r.good}`);
  for (const [g] of src.places) if (!goodId.has(g)) errors.push(`places: unknown good ${g}`);
  const good = new Array<number>(provinces.reduce((m, p) => Math.max(m, p.id), 0) + 1).fill(0);
  for (const p of provinces) {
    if (p.kind !== 'land') continue;
    const [lon, lat] = pixelToLonLat(ctx.projection, p.centroid[0], p.centroid[1]);
    for (const [ri, r] of src.rules.entries()) {
      if (r.terrain && !r.terrain.includes(p.terrain ?? 'plains')) continue;
      if (r.region && !r.region.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e)) continue;
      if (r.lat_above !== undefined && lat < r.lat_above) continue;
      if (r.lat_below !== undefined && lat > r.lat_below) continue;
      if (r.coastal !== undefined && p.coastal !== r.coastal) continue;
      if (r.share !== undefined && keyFraction(`${p.key}:${ri}`) >= r.share) continue;
      good[p.id] = goodId.get(r.good) ?? 0;
      break;
    }
  }
  const placed = paintRegions(src.places.map(([, place]) => ({ area: [], add: [place] })), [], provinces, ctx, errors, (i) => `places ${src.places[i]![0]}`);
  placed.forEach((i, pid) => { if (i) good[pid] = goodId.get(src.places[i - 1]![0]) ?? good[pid]!; });
  return { goods: src.goods.map((g) => ({ ...g, color: g.color.toLowerCase() })), good, errors };
}
