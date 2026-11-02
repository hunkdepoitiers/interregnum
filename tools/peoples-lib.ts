import type { MapProvince } from '../src/content/map';
import type { PeoplesSource } from '../src/content/peoples';
import type { CultureDef, ReligionDef } from '../src/sim/content';
import { paintRegions, type MapContext } from './data-lib';

export interface CompiledPeoples {
  cultures: CultureDef[];
  religions: ReligionDef[];
  /** Per province id, 1-based ids into cultures / religions; 0 = none (sea, wasteland). */
  culture: number[];
  religion: number[];
  errors: string[];
}

/** Paints cultures onto the land, then each culture's religion, then the religion areas over it. */
export function compilePeoples(src: PeoplesSource, provinces: MapProvince[], ctx: MapContext): CompiledPeoples {
  const errors: string[] = [];
  const religionId = new Map<string, number>();
  src.religions.forEach((r, i) => {
    if (religionId.has(r.key)) errors.push(`Religion ${r.key}: duplicate key`);
    religionId.set(r.key, i + 1);
  });
  const seen = new Set<string>();
  const cultures: CultureDef[] = src.cultures.map((c) => {
    if (seen.has(c.key)) errors.push(`Culture ${c.key}: duplicate key`);
    seen.add(c.key);
    if (!src.groups[c.group]) errors.push(`Culture ${c.key}: unknown group ${c.group}`);
    if (!religionId.has(c.religion)) errors.push(`Culture ${c.key}: unknown religion ${c.religion}`);
    return { key: c.key, name: c.name, group: c.group, groupName: src.groups[c.group] ?? c.group, religion: religionId.get(c.religion) ?? 0, color: c.color.toLowerCase() };
  });
  for (const a of src.religion_areas) if (!religionId.has(a.religion)) errors.push(`religion_areas: unknown religion ${a.religion}`);

  const culture = paintRegions(src.cultures, src.fill, provinces, ctx, errors, (i) => `Culture ${src.cultures[i]!.key}`);
  const religion = culture.map((c) => (c ? cultures[c - 1]!.religion : 0));
  const areas = paintRegions(src.religion_areas, [], provinces, ctx, errors, (i) => `religion_areas ${src.religion_areas[i]!.religion}`);
  areas.forEach((a, id) => { if (a) religion[id] = religionId.get(src.religion_areas[a - 1]!.religion) ?? religion[id]!; });
  const religions: ReligionDef[] = src.religions.map((r) => ({ key: r.key, name: r.name, family: r.family, color: r.color.toLowerCase() }));
  return { cultures, religions, culture, religion, errors };
}
