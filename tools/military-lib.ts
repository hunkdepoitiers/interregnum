import type { MapProvince } from '../src/content/map';
import { pixelToLonLat, projectionSize } from '../src/content/map';
import type { MilitarySource } from '../src/content/military';
import { SCALE, type MilitaryDef } from '../src/sim/content';
import type { Scenario } from '../src/sim/scenario';
import type { MapContext } from './data-lib';

/** Converts data/content/military.yaml to the sim's units. */
export function compileMilitary(src: MilitarySource): MilitaryDef {
  const u = src.units;
  return {
    levy: { name: u.levy.name, description: u.levy.description, strength: Math.round(u.levy.strength * SCALE), wage: Math.round(u.levy.wage * SCALE), lateWage: Math.round(u.levy.late_wage * SCALE), serviceDays: u.levy.service_days },
    menAtArms: { name: u.men_at_arms.name, description: u.men_at_arms.description, strength: Math.round(u.men_at_arms.strength * SCALE), wage: Math.round(u.men_at_arms.wage * SCALE), cost: Math.round(u.men_at_arms.cost * SCALE) },
    levyShare: Math.round(src.levy_share * SCALE),
    menAtArmsPerThousandLevies: src.men_at_arms_per_thousand_levies,
    musterDays: src.muster_days,
    terrainDefence: src.terrain_defence,
    attrition: src.attrition, attritionMax: src.attrition_max, hostileSupply: src.hostile_supply, homeSupply: src.home_supply,
    casualties: src.casualties, moraleLoss: src.morale_loss, moraleRegain: src.morale_regain,
    warcraftStrength: src.warcraft_strength, occupyDays: src.occupy_days, occupyMin: src.occupy_min,
  };
}

/** The march graph between land provinces (straits included) and every province's centroid. */
export function compileGraph(src: MilitarySource, provinces: MapProvince[], ctx: MapContext): Pick<Scenario, 'graph' | 'pos' | 'kmPerPx' | 'terrain'> {
  const byId = new Map(provinces.map((p) => [p.id, p]));
  const maxId = provinces.reduce((m, p) => Math.max(m, p.id), 0);
  const { width } = projectionSize(ctx.projection);
  const kmPerPx = (40075 * Math.cos((ctx.projection.standardParallel * Math.PI) / 180)) / width;
  const km = (a: MapProvince, b: MapProvince) => {
    const [, lat] = pixelToLonLat(ctx.projection, (a.centroid[0] + b.centroid[0]) / 2, (a.centroid[1] + b.centroid[1]) / 2);
    const scale = Math.cos((lat * Math.PI) / 180) / Math.cos((ctx.projection.standardParallel * Math.PI) / 180);
    return Math.hypot((a.centroid[0] - b.centroid[0]) * scale, a.centroid[1] - b.centroid[1]) * kmPerPx;
  };
  const start: number[] = [];
  const to: number[] = [];
  const days: number[] = [];
  const pos: number[] = [];
  const terrain: string[] = [];
  for (let id = 0; id <= maxId; id++) {
    start.push(to.length);
    const p = byId.get(id);
    pos.push(p ? Math.round(p.centroid[0]) : 0, p ? Math.round(p.centroid[1]) : 0);
    terrain.push(p?.terrain ?? '');
    if (!p || p.kind !== 'land') continue;
    for (const a of p.adjacency) {
      const q = byId.get(a.id);
      if (!q || q.kind !== 'land') continue;
      const speed = (src.march_km * (src.terrain_speed[q.terrain ?? 'plains'] ?? 100)) / 100;
      to.push(q.id);
      days.push(Math.max(1, Math.round(((km(p, q) / speed) + (a.strait ? src.strait_days : 0)) * 10)));
    }
  }
  start.push(to.length);
  return { graph: { start, to, days }, pos, terrain, kmPerPx: Math.round(kmPerPx * 1000) / 1000 };
}
