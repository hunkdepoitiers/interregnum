import type { MapProvince } from '../src/content/map';
import type { GeneratedTitles, UpperTitles } from '../src/content/titles';
import type { HegemonyDef, TitleDef, Titles } from '../src/sim/content';
import { paintRegions, type MapContext } from './data-lib';

export interface CompiledTitles {
  titles: Titles;
  /** Per province id: county id (1-based; 0 = none). */
  county: number[];
  errors: string[];
  warnings: string[];
}

/**
 * Links the generated counties and duchies to the hand-made kingdoms, empires and hegemonies. A duchy belongs to the
 * kingdom holding the most of its provinces; one outside every outline goes to an automatic kingdom for its
 * country, keyed k_auto_<country code>, which empires may list like any other kingdom.
 */
export function compileTitles(gen: GeneratedTitles, upper: UpperTitles, provinces: MapProvince[], ctx: MapContext): CompiledTitles {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byKey = new Map(provinces.map((p) => [p.key, p]));
  const county = new Array<number>(provinces.reduce((m, p) => Math.max(m, p.id), 0) + 1).fill(0);

  const counties: TitleDef[] = [];
  const countyId = new Map<string, number>();
  let stale = 0;
  for (const [key, name, capital, members] of gen.counties) {
    const id = counties.length + 1;
    countyId.set(key, id);
    counties.push({ key, name, parent: 0, capital: byKey.get(capital)?.id ?? 0 });
    for (const k of members) {
      const p = byKey.get(k);
      if (p) county[p.id] = id;
      else stale++;
    }
  }
  if (stale) errors.push(`data/map/titles.yaml names ${stale} provinces the map does not have; run tools/build_titles.py`);

  // Hand kingdoms painted onto provinces, then each duchy votes.
  const painted = paintRegions(upper.kingdoms.map((k) => ({ area: k.area, add: [] })), upper.fill, provinces, ctx, errors, (i) => `Kingdom ${upper.kingdoms[i]!.key}`);
  const kingdoms: TitleDef[] = upper.kingdoms.map((k) => ({ key: k.key, name: k.name, parent: 0 }));
  const kingdomId = new Map(kingdoms.map((k, i) => [k.key, i + 1]));
  const provincesOf = new Map<number, number[]>();
  county.forEach((c, pid) => { if (c) provincesOf.set(c, [...(provincesOf.get(c) ?? []), pid]); });
  const duchies: TitleDef[] = [];
  for (const [key, name, country, members] of gen.duchies) {
    const id = duchies.length + 1;
    const votes = new Map<number, number>();
    for (const ck of members) {
      const c = countyId.get(ck);
      if (!c) { errors.push(`Duchy ${key}: unknown county ${ck}`); continue; }
      counties[c - 1]!.parent = id;
      for (const pid of provincesOf.get(c) ?? []) {
        const k = painted[pid]!;
        if (k) votes.set(k, (votes.get(k) ?? 0) + 1);
      }
    }
    let best = 0, bestVotes = 0;
    for (const [k, v] of votes) if (v > bestVotes) { best = k; bestVotes = v; }
    if (!best) {
      const autoKey = `k_auto_${country}`;
      best = kingdomId.get(autoKey) ?? 0;
      if (!best) {
        kingdoms.push({ key: autoKey, name: `Kingdom of ${upper.country_kingdoms[country] ?? gen.countries[country] ?? country}`, parent: 0 });
        best = kingdoms.length;
        kingdomId.set(autoKey, best);
      }
    }
    duchies.push({ key, name, parent: best });
  }

  const empires: TitleDef[] = [];
  const empireId = new Map<string, number>();
  for (const e of upper.empires) {
    const id = empires.length + 1;
    empireId.set(e.key, id);
    empires.push({ key: e.key, name: e.name, parent: 0 });
    for (const k of e.kingdoms) {
      const kid = kingdomId.get(k);
      if (!kid) { errors.push(`Empire ${e.key}: unknown kingdom ${k}`); continue; }
      if (kingdoms[kid - 1]!.parent) errors.push(`Kingdom ${k} is in two empires`);
      kingdoms[kid - 1]!.parent = id;
    }
  }
  const hegemonies: HegemonyDef[] = upper.hegemonies.map((h, i) => {
    const ids = h.empires.map((e) => {
      const eid = empireId.get(e);
      if (!eid) errors.push(`Hegemony ${h.key}: unknown empire ${e}`);
      else if (h.de_jure) {
        if (empires[eid - 1]!.parent) errors.push(`Empire ${e} is in two de jure hegemonies`);
        empires[eid - 1]!.parent = i + 1;
      }
      return eid ?? 0;
    });
    return { key: h.key, name: h.name, ...(h.hindu_name ? { hinduName: h.hindu_name } : {}), description: h.description, deJure: h.de_jure, empires: ids.filter(Boolean) };
  });
  const usedKingdoms = new Set(duchies.map((d) => d.parent));
  for (const [k, id] of kingdomId) if (!usedKingdoms.has(id) && !k.startsWith('k_auto_')) warnings.push(`Kingdom ${k} holds no duchy`);
  return { titles: { counties, duchies, kingdoms, empires, hegemonies }, county, errors, warnings };
}
