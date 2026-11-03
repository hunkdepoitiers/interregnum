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
 * kingdom holding the most of its provinces; one outside every outline (and outside `fill`) goes to the kingdom made
 * from its generated area, keyed k_<area key>. A kingdom belongs to the empire listing it, else to the empire whose
 * outline holds the most of its provinces (land outside every empire outline takes the nearest, inside `empire_fill`).
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
  const provincesOf = new Map<number, number[]>();
  county.forEach((c, pid) => { if (c) provincesOf.set(c, [...(provincesOf.get(c) ?? []), pid]); });
  if (stale) errors.push(`data/map/titles.yaml names ${stale} provinces the map does not have; run tools/build_titles.py`);

  // Hand-drawn duchies take the provinces their outlines hold (inside `fill`, gaps take the nearest); the rest stay
  // in their generated duchy, whose generated area becomes its kingdom.
  const handDuchies = upper.kingdoms.flatMap((k, ki) => k.duchies.map(([key, name, ...area]) => ({ key, name: `Duchy of ${name}`, area, kingdom: ki + 1 })));
  const painted = paintRegions(handDuchies.map((d) => ({ area: d.area, add: [] })), upper.fill, provinces, ctx, errors, (i) => `Duchy ${handDuchies[i]!.key}`);
  const kingdoms: TitleDef[] = upper.kingdoms.map((k) => ({ key: k.key, name: `Kingdom of ${k.name}`, parent: 0 }));
  const kingdomId = new Map(kingdoms.map((k, i) => [k.key, i + 1]));
  const duchies: TitleDef[] = handDuchies.map((d) => ({ key: d.key, name: d.name, parent: d.kingdom }));
  const provincesOfKingdom = new Map<number, number[]>();
  const claim = (duchy: number, county: number) => {
    counties[county - 1]!.parent = duchy;
    const k = duchies[duchy - 1]!.parent;
    const list = provincesOfKingdom.get(k) ?? [];
    list.push(...(provincesOf.get(county) ?? []));
    provincesOfKingdom.set(k, list);
  };
  for (const [, , capital] of gen.counties) {
    const p = byKey.get(capital);
    const c = p ? county[p.id]! : 0;
    if (c && painted[p!.id]) claim(painted[p!.id]!, c);
  }
  for (const [key, name, area, members] of gen.duchies) {
    const rest = members.map((ck) => {
      const c = countyId.get(ck);
      if (!c) errors.push(`Duchy ${key}: unknown county ${ck}`);
      return c ?? 0;
    }).filter((c) => c && !counties[c - 1]!.parent);
    if (!rest.length) continue;
    const autoKey = `k_${area.replace(/^a_/, '')}`;
    let k = kingdomId.get(autoKey) ?? 0;
    if (!k) {
      if (!gen.areas[area]) errors.push(`Duchy ${key}: unknown area ${area}`);
      kingdoms.push({ key: autoKey, name: `Kingdom of ${gen.areas[area] ?? area}`, parent: 0 });
      k = kingdoms.length;
      kingdomId.set(autoKey, k);
    }
    duchies.push({ key, name, parent: k });
    for (const c of rest) claim(duchies.length, c);
  }

  const empires: TitleDef[] = upper.empires.map((e) => ({ key: e.key, name: e.name, parent: 0 }));
  const empireId = new Map(empires.map((e, i) => [e.key, i + 1]));
  upper.empires.forEach((e, i) => {
    for (const k of e.kingdoms) {
      const kid = kingdomId.get(k);
      if (!kid) { errors.push(`Empire ${e.key}: unknown kingdom ${k}`); continue; }
      if (kingdoms[kid - 1]!.parent) errors.push(`Kingdom ${k} is in two empires`);
      kingdoms[kid - 1]!.parent = i + 1;
    }
  });
  const regionOf = paintRegions(upper.empires.map((e) => ({ area: e.area, add: [] })), upper.empire_fill, provinces, ctx, errors, (i) => `Empire ${upper.empires[i]!.key}`);
  kingdoms.forEach((k, i) => {
    if (k.parent) return;
    const votes = new Map<number, number>();
    for (const pid of provincesOfKingdom.get(i + 1) ?? []) {
      const e = regionOf[pid]!;
      if (e) votes.set(e, (votes.get(e) ?? 0) + 1);
    }
    let best = 0, bestVotes = 0;
    for (const [e, v] of votes) if (v > bestVotes) { best = e; bestVotes = v; }
    k.parent = best;
  });
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
  const usedDuchies = new Set(counties.map((c) => c.parent));
  const usedKingdoms = new Set(duchies.filter((_, i) => usedDuchies.has(i + 1)).map((d) => d.parent));
  const titular = handDuchies.filter((_, i) => !usedDuchies.has(i + 1)).map((d) => d.key);
  if (titular.length) warnings.push(`${titular.length} drawn duchies hold no land province and stay titular: ${titular.join(', ')}`);
  const usedEmpires = new Set(kingdoms.filter((k) => usedKingdoms.has(kingdomId.get(k.key)!)).map((k) => k.parent));
  empires.forEach((e, i) => { if (!usedEmpires.has(i + 1)) warnings.push(`Empire ${e.key} holds no kingdom`); });
  return { titles: { counties, duchies, kingdoms, empires, hegemonies }, county, errors, warnings };
}
