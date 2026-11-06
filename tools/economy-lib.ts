import type { MapProvince } from '../src/content/map';
import { pixelToLonLat, projectionSize } from '../src/content/map';
import type { EconomySource, PopulationSource } from '../src/content/economy';
import { SCALE, STRATA, type Content, type EconomyDef } from '../src/sim/content';
import { placeFinder, type MapContext } from './data-lib';

const ducats = (n: number) => Math.round(n * SCALE);
const percent = (n: number) => Math.round(n * SCALE);

/** Converts data/content/economy.yaml to the sim's units and checks its modifiers and bank seats. */
export function compileEconomy(src: EconomySource, content: Content, provinces: MapProvince[], ctx: MapContext): { economy: EconomyDef; tradeCentre: number[]; errors: string[] } {
  const errors: string[] = [];
  const known = (m: string, where: string) => { if (!content.modifiers[m]) errors.push(`${where}: unknown modifier ${m}`); };
  for (const l of src.laws.tax) if (l.modifier) known(l.modifier, `Tax law ${l.key}`);
  for (const b of src.buildings) known(b.modifier, `Building ${b.key}`);
  const land = provinces.filter((p) => p.kind === 'land');
  const find = placeFinder(land, new Map(provinces.map((p) => [p.id, p])), ctx, errors);
  const economy: EconomyDef = {
    wealthPerHead: STRATA.map((s) => Math.round(src.wealth_per_head[s] * 10000)),
    devBase: Math.round(src.development_factor.base * 100),
    devPerPoint: Math.round(src.development_factor.per_point * 100),
    tithe: percent(src.tithe),
    tradePerThousand: Math.round(src.trade_per_thousand * 100),
    vassalDues: percent(src.vassal_dues),
    court: { empire: ducats(src.court.empire), kingdom: ducats(src.court.kingdom), duchy: ducats(src.court.duchy), county: ducats(src.court.county) },
    adminPerProvince: ducats(src.administration_per_province),
    retinuePerThousand: ducats(src.retinue_per_thousand),
    growth: percent(src.growth),
    startTreasuryMonths: src.start_treasury_months,
    largesse: percent(src.largesse),
    taxLaws: src.laws.tax.map((l) => ({ key: l.key, name: l.name, description: l.description, modifier: l.modifier ?? null })),
    lawCooldownDays: src.law_cooldown_days,
    buildings: src.buildings.map((b) => ({ ...b, cost: ducats(b.cost), upkeep: ducats(b.upkeep) })),
    banks: src.banks.map((b) => ({
      key: b.key, name: b.name, seat: b.seat ? find(b.seat, `Bank ${b.key}`)?.id ?? 0 : 0,
      capital: ducats(b.capital), rate: percent(b.rate), risk: b.risk, local: b.local,
    })),
    credit: {
      base: src.credit.base, incomePerPoint: ducats(src.credit.income_per_point), incomeCap: src.credit.income_cap,
      debtRatioPenalty: src.credit.debt_ratio_penalty, defaultPenalty: src.credit.default_penalty,
      defaultMemoryDays: src.credit.default_memory_days, rateSpread: src.credit.rate_spread, terms: src.credit.terms,
    },
  };
  if (!economy.taxLaws.some((l) => l.key === 'normal')) errors.push('Tax laws: there must be a "normal" law, which realms start with');
  const tradeCentre = new Array<number>(provinces.reduce((m, p) => Math.max(m, p.id), 0) + 1).fill(0);
  for (const [place, value] of src.trade_centres) {
    const p = find(place, `Trade centre ${JSON.stringify(place)}`);
    if (p) tradeCentre[p.id] = tradeCentre[p.id]! + ducats(value);
  }
  return { economy, tradeCentre, errors };
}

/** Square kilometres a province covers (equirectangular pixels shrink in ground area away from the standard parallel). */
export function provinceAreaKm2(p: MapProvince, ctx: MapContext): number {
  const { scale } = projectionSize(ctx.projection);
  const kmPerPx = 111.32 / scale;
  const [, lat] = pixelToLonLat(ctx.projection, p.centroid[0], p.centroid[1]);
  const rad = (d: number) => (d * Math.PI) / 180;
  return p.pixels * kmPerPx * kmPerPx * (Math.cos(rad(lat)) / Math.cos(rad(ctx.projection.standardParallel)));
}

/**
 * Starting people of every land province by stratum (STRATA order, flat: 5 numbers per province id) and its
 * development, from area × terrain density × regional multiplier, plus burghers in historical towns and capitals.
 */
export function compilePopulation(src: PopulationSource, provinces: MapProvince[], ctx: MapContext, capitals: Set<number>): { pops: number[]; development: number[] } {
  const size = provinces.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const pops = new Array<number>(size * STRATA.length).fill(0);
  const development = new Array<number>(size).fill(0);
  const share = (n: number, pct: number) => Math.round((n * pct) / 100);
  for (const p of provinces) {
    if (p.kind !== 'land' || !p.terrain) continue;
    const [lon, lat] = pixelToLonLat(ctx.projection, p.centroid[0], p.centroid[1]);
    let mult = 1;
    for (const [s, w, n, e, m] of src.regions) if (lat >= s && lat <= n && lon >= w && lon <= e) mult = m;
    const density = (src.density[p.terrain] ?? 0) * mult;
    const people = Math.round(provinceAreaKm2(p, ctx) * density);
    const nobles = share(people, src.strata.nobles);
    const clergy = share(people, src.strata.clergy);
    const town = ctx.towns.has(p.key);
    const burghers = share(people, src.strata.burghers) + (town ? src.town : 0) + (capitals.has(p.id) ? src.capital_town : 0);
    const commons = Math.max(0, people - nobles - clergy - share(people, src.strata.burghers));
    const nomads = src.nomads.terrains.includes(p.terrain) ? share(commons, src.nomads.share) : 0;
    const row = { peasants: commons - nomads, burghers, nobles, clergy, nomads };
    STRATA.forEach((s, i) => { pops[p.id * STRATA.length + i] = row[s]; });
    const dev = Math.round(src.development.base + density * src.development.per_density) + (town ? src.development.town : 0);
    development[p.id] = Math.min(src.development.max, Math.max(1, dev));
  }
  return { pops, development };
}
