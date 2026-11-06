import type { FaithSource } from '../src/content/faith';
import type { MapProvince } from '../src/content/map';
import { SCALE, type Content, type FaithDef } from '../src/sim/content';
import type { ScenarioRealm } from '../src/sim/scenario';
import { placeFinder, type MapContext } from './data-lib';

/** Converts data/content/faith.yaml: faiths by religion id, heads by realm id, holy sites by province. */
export function compileFaith(src: FaithSource, content: Content, realms: ScenarioRealm[], provinces: MapProvince[], ctx: MapContext): { faith: FaithDef; errors: string[] } {
  const errors: string[] = [];
  const known = (m: string | undefined, where: string) => {
    if (m && !content.modifiers[m]) errors.push(`faith.yaml ${where}: unknown modifier ${m}`);
    return m ?? null;
  };
  const sorted = <T extends { min: number }>(list: T[], where: string) => {
    for (let i = 1; i < list.length; i++) if (list[i]!.min <= list[i - 1]!.min) errors.push(`faith.yaml ${where}: tiers must rise`);
    return list;
  };
  const realmId = new Map(realms.map((r) => [r.key, r.id]));
  const land = provinces.filter((p) => p.kind === 'land');
  const find = placeFinder(land, new Map(provinces.map((p) => [p.id, p])), ctx, errors);
  const religionId = new Map(content.religions.map((r, i) => [r.key, i + 1]));
  const faiths = content.religions.map(() => ({ head: 0, holySites: [] as { name: string; province: number }[] }));
  for (const [key, f] of Object.entries(src.faiths)) {
    const id = religionId.get(key);
    if (!id) { errors.push(`faith.yaml faiths: unknown religion ${key}`); continue; }
    const entry = faiths[id - 1]!;
    if (f.head) {
      entry.head = realmId.get(f.head) ?? 0;
      if (!entry.head) errors.push(`faith.yaml ${key}: unknown head realm ${f.head}`);
    }
    for (const [name, lat, lon] of f.holy_sites) {
      const p = find([lat, lon], `faith.yaml ${key} holy site ${name}`);
      if (p) entry.holySites.push({ name, province: p.id });
    }
  }
  const families = new Set(content.religions.map((r) => r.family));
  for (const fam of families) if (!src.piety_names[fam] && fam !== 'christian') errors.push(`faith.yaml piety_names: no names for the ${fam} family`);
  for (const [fam, names] of Object.entries(src.piety_names)) if (names.length !== src.piety_tiers.length) errors.push(`faith.yaml piety_names ${fam}: needs one name per piety tier`);
  if (!src.piety_names.christian) errors.push('faith.yaml piety_names: christian is required (the fallback)');
  const deeds: FaithDef['deeds'] = {};
  for (const [key, d] of Object.entries(src.deeds)) {
    deeds[key] = {
      key, name: d.name, description: d.description, cost: Math.round(d.cost * SCALE), costMonths: d.cost_months, minCost: Math.round(d.min_cost * SCALE), incomeMonths: d.income_months,
      prestige: d.prestige, piety: d.piety, cooldown: d.cooldown, days: d.days, modifier: known(d.modifier, `deed ${key}`),
    };
  }
  for (const k of ['small_alms', 'great_alms', 'tournament', 'pilgrimage', 'absolution']) if (!deeds[k]) errors.push(`faith.yaml deeds: ${k} is required`);
  const buildingKeys = new Set(content.economy.buildings.map((b) => b.key));
  for (const b of Object.keys(src.buildings)) if (!buildingKeys.has(b)) errors.push(`faith.yaml buildings: unknown building ${b}`);
  const ex = src.excommunication;
  const exReligion = religionId.get(ex.faith) ?? 0;
  if (!exReligion) errors.push(`faith.yaml excommunication: unknown faith ${ex.faith}`);
  return {
    faith: {
      prestigeTiers: sorted(src.prestige_tiers, 'prestige_tiers').map((t, i) => ({ min: t.min, name: t.name, modifier: known(t.modifier, `prestige tier ${i}`) })),
      pietyTiers: sorted(src.piety_tiers, 'piety_tiers').map((t, i) => ({ min: t.min, modifier: known(t.modifier, `piety tier ${i}`) })),
      pietyNames: src.piety_names,
      start: { prestige: src.start.prestige, piety: src.start.piety, pietyGovernment: src.start.piety_government, piousTrait: src.start.pious_trait },
      holySitePiety: src.holy_site_piety, faiths, deeds, pilgrimageRisk: src.pilgrimage_risk,
      events: { default: src.events.default, emptyTreasury: src.events.empty_treasury, dynastyChangeKeep: src.events.dynasty_change_keep },
      excommunication: { religion: exReligion, below: ex.below, chance: ex.chance, prestige: ex.prestige, modifier: known(ex.modifier, 'excommunication') ?? '', vacancy: known(ex.vacancy, 'excommunication vacancy') },
      buildings: src.buildings as FaithDef['buildings'],
    },
    errors,
  };
}
