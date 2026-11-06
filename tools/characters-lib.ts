import type { CharactersSource, NamesSource, RulersSource } from '../src/content/characters';
import { dateToDay } from '../src/sim/calendar';
import { SCALE, type CharactersDef, type Content, type ModifierDef } from '../src/sim/content';
import type { Character, Court, Dynasty, ScenarioRealm } from '../src/sim/scenario';

const SKILLS = ['eminence', 'statecraft', 'warcraft'] as const;
const ROLE_LABEL: Record<string, string> = { chancellor: 'Chancellor', treasurer: 'Treasurer', marshal: 'Marshal', chaplain: 'Court Chaplain' };

/**
 * Checks characters.yaml and names.yaml against the stats and adds the modifiers rulers carry: ruler_<skill>,
 * council_<role> (both scaled by skill above the pivot) and trait_<key>.
 */
export function compileCharacters(src: CharactersSource, names: NamesSource, content: Content): { characters: CharactersDef; errors: string[] } {
  const errors: string[] = [];
  const effects = (list: { stat: string; add: number }[], where: string) => list.map((e) => {
    if (!content.stats[e.stat]) errors.push(`${where}: unknown stat ${e.stat}`);
    return { stat: e.stat, op: 'add' as const, value: Math.round(e.add * SCALE) };
  });
  const put = (def: ModifierDef) => { content.modifiers[def.key] = def; };
  for (const s of SKILLS) {
    const name = s[0]!.toUpperCase() + s.slice(1);
    put({ key: `ruler_${s}`, label: `Ruler's ${name}`, description: `Each point of the ruler's ${name} above ${src.skills.pivot}.`, stacking: 'replace', days: null, effects: effects(src.skills.ruler[s], `ruler ${s}`) });
  }
  const council = Object.entries(src.skills.council).map(([role, seat]) => {
    const key = `council_${role}`;
    put({ key, label: `${ROLE_LABEL[role] ?? role}'s ${seat.skill[0]!.toUpperCase()}${seat.skill.slice(1)}`, description: `Each point of the ${ROLE_LABEL[role] ?? role} above ${src.skills.pivot}.`, stacking: 'replace', days: null, effects: effects(seat.effects, `council ${role}`) });
    return { role, skill: SKILLS.indexOf(seat.skill), modifier: key };
  });
  const traits = src.traits.map((t) => {
    let rulerModifier: string | null = null;
    if (t.ruler.length) {
      rulerModifier = `trait_${t.key}`;
      put({ key: rulerModifier, label: `${t.name} Ruler`, description: t.description, stacking: 'replace', days: null, effects: effects(t.ruler, `trait ${t.key}`) });
    }
    return { key: t.key, name: t.name, description: t.description, skills: [...t.skills], health: t.health, congenital: t.congenital, chance: t.chance, rulerModifier };
  });
  const lawKeys = new Set(src.laws.map((l) => l.key));
  for (const [gov, law] of Object.entries(src.government_laws)) if (!lawKeys.has(law)) errors.push(`government_laws ${gov}: unknown law ${law}`);
  for (const [group, t] of Object.entries(names.groups)) if (!names.traditions[t]) errors.push(`names: group ${group} uses unknown tradition ${t}`);
  if (!names.traditions.generic) errors.push('names: a "generic" tradition is required');
  for (const m of ['regency', 'new_reign', 'dynasty_change', 'pretender']) if (!content.modifiers[m]) errors.push(`modifiers.yaml: ${m} is required by succession`);
  return {
    characters: {
      pivot: src.skills.pivot, council, salary: Math.round(src.skills.salary * SCALE),
      education: { start: src.education.start, end: src.education.end, perTier: src.education.per_tier, bonus: src.education.bonus },
      variance: src.inheritance_variance, majority: src.majority, mortality: src.mortality,
      fertility: { chance: src.fertility.chance, lateChance: src.fertility.late_chance, from: src.fertility.from, late: src.fertility.late, until: src.fertility.until },
      marriage: src.marriage, healthBase: src.health.base, laws: src.laws, governmentLaws: src.government_laws, traits,
      names: names.traditions, nameGroups: names.groups, nameOverrides: names.religion_overrides,
    },
    errors,
  };
}

/** Day 0 is 1 November 1314; a birth year becomes 1 July of that year. */
const bornDay = (year: number) => dateToDay({ year, month: 7, day: 1 });

/**
 * The hand-written rulers of 1314 and their families as characters, houses and courts (index realm id - 1).
 * Realms without an entry get a null court, which the game fills with a generated ruler at the start.
 */
export function compileRulers(src: RulersSource, realms: ScenarioRealm[], content: Content, culture: number[], religion: number[]) {
  const errors: string[] = [];
  const characters: Character[] = [];
  const dynasties: Dynasty[] = [];
  const dynastyId = new Map<string, number>();
  for (const [k, name] of Object.entries(src.dynasties)) {
    dynasties.push({ id: dynasties.length + 1, name });
    dynastyId.set(k, dynasties.length);
  }
  const courts: (Court | null)[] = realms.map(() => null);
  const realmIndex = new Map(realms.map((r, i) => [r.key, i]));
  const lawOf = (r: ScenarioRealm, law?: string) => {
    const k = law ?? content.characters.governmentLaws[r.government] ?? content.characters.laws[0]!.key;
    if (!content.characters.laws.some((l) => l.key === k)) errors.push(`Realm ${r.key}: unknown succession law ${k}`);
    return k;
  };
  const person = (o: Omit<Character, 'id' | 'died' | 'spouse' | 'education' | 'health'> & { died?: number | null }) => {
    const c: Character = { ...o, id: characters.length + 1, died: o.died ?? null, spouse: 0, education: null, health: content.characters.healthBase };
    // Those of sixteen or more at the start have finished their education.
    if (c.born <= dateToDay({ year: 1298, month: 11, day: 1 })) {
      const focus = c.skills.indexOf(Math.max(...c.skills));
      c.education = { focus, tier: 2 };
    }
    characters.push(c);
    return c;
  };
  const rulerOf = new Map<string, number>();
  for (const [realmKey, entry] of Object.entries(src.rulers)) {
    const i = realmIndex.get(realmKey);
    if (i === undefined) { errors.push(`1314-rulers: unknown realm ${realmKey}`); continue; }
    if ('same_as' in entry) continue;
    const r = realms[i]!;
    const dynasty = dynastyId.get(entry.dynasty);
    if (!dynasty) errors.push(`1314-rulers ${realmKey}: unknown dynasty ${entry.dynasty}`);
    for (const t of entry.traits) if (!content.characters.traits.some((x) => x.key === t)) errors.push(`1314-rulers ${realmKey}: unknown trait ${t}`);
    const cu = culture[r.capital] ?? 0;
    const re = religion[r.capital] ?? 0;
    const skills = entry.skills ? [...entry.skills] : [10, 10, 10];
    const base = { culture: cu, religion: re, traits: [] as string[] };
    // A dead father ties the ruler to his brothers and sisters, so the realm can pass to them.
    const father = entry.siblings.length
      ? person({ ...base, name: 'the late lord', dynasty: dynasty ?? 0, female: false, born: bornDay(entry.born - 28), died: -1, father: 0, mother: 0, skills: [10, 10, 10] })
      : null;
    const ruler = person({ ...base, name: entry.name, dynasty: dynasty ?? 0, female: entry.female, born: bornDay(entry.born), father: father?.id ?? 0, mother: 0, skills, traits: [...entry.traits] });
    rulerOf.set(realmKey, ruler.id);
    let spouse: Character | null = null;
    if (entry.spouse) {
      spouse = person({ ...base, name: entry.spouse[0], dynasty: 0, female: !entry.female, born: bornDay(entry.spouse[1]), father: 0, mother: 0, skills: [9, 9, 7] });
      ruler.spouse = spouse.id;
      spouse.spouse = ruler.id;
    }
    for (const [name, sex, born] of entry.children) {
      const female = sex === 'f';
      person({ ...base, name, dynasty: dynasty ?? 0, female, born: bornDay(born), father: entry.female ? spouse?.id ?? 0 : ruler.id, mother: entry.female ? ruler.id : spouse?.id ?? 0, skills: [...skills.map((s) => Math.max(4, s - 1))] });
    }
    for (const [name, sex, born] of entry.siblings) {
      person({ ...base, name, dynasty: dynasty ?? 0, female: sex === 'f', born: bornDay(born), father: father!.id, mother: 0, skills: [9, 9, 9] });
    }
    let regent = 0;
    if (entry.regent) {
      const [name, sex, born] = entry.regent;
      regent = person({ ...base, name, dynasty: dynasty ?? 0, female: sex === 'f', born: bornDay(born), father: 0, mother: 0, skills: [13, 13, 9] }).id;
    }
    courts[i] = { ruler: ruler.id, regent, law: lawOf(r, entry.law), council: [], claimant: 0, since: 0 };
  }
  for (const [realmKey, entry] of Object.entries(src.rulers)) {
    if (!('same_as' in entry)) continue;
    const i = realmIndex.get(realmKey);
    const ruler = rulerOf.get(entry.same_as);
    if (i === undefined || !ruler) { errors.push(`1314-rulers ${realmKey}: same_as ${entry.same_as} has no ruler`); continue; }
    courts[i] = { ruler, regent: 0, law: lawOf(realms[i]!, entry.law), council: [], claimant: 0, since: 0 };
  }
  return { characters, dynasties, courts, errors };
}
