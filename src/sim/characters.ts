import type { Content } from './content';
import { add as addToLedger, type EconomyContext, type Notice } from './economy';
import { addModifier, removeModifiers } from './modifiers';
import { nextInt } from './rng';
import type { Character, Court, GameState } from './state';

/**
 * Characters (DESIGN.md §5.3). Every month people may die (by age and health), couples of the ruling line have
 * children, rulers and heirs of age marry, children of sixteen finish their education, councils fill their seats,
 * and a dead ruler's realm passes by its succession law: to a child under a regent, to a new house, or with a
 * claimant waiting. A ruler's (or regent's) skills, traits and council reach the realm as scaled modifiers.
 * All randomness comes from the game's seeded generator.
 */

const EMINENCE = 0;
const STATECRAFT = 1;
const WARCRAFT = 2;
export const SKILL_NAMES = ['Eminence', 'Statecraft', 'Warcraft'];

/** Traits that exclude each other. */
const OPPOSITES: [string, string][] = [
  ['brave', 'craven'], ['just', 'cruel'], ['greedy', 'generous'], ['diligent', 'lazy'], ['genius', 'slow'],
  ['strong', 'sickly'], ['wroth', 'patient'],
];

export function ageOf(c: Character, day: number): number {
  return Math.floor(((day - c.born) * 4) / 1461);
}

export const isAlive = (c: Character | null | undefined): c is Character => !!c && c.died === null;

/** Skills as they stand: talent, traits, education, and the toll of age. */
export function skillsOf(content: Content, c: Character, day: number): number[] {
  const out = [...c.skills];
  for (const t of c.traits) {
    const d = content.characters.traits.find((x) => x.key === t);
    if (d) d.skills.forEach((v, i) => { out[i] = out[i]! + v; });
  }
  if (c.education) out[c.education.focus] = out[c.education.focus]! + (content.characters.education.bonus[c.education.tier] ?? 0);
  const age = ageOf(c, day);
  if (age > 60) {
    out[WARCRAFT] = out[WARCRAFT]! - Math.trunc((age - 60) / 5);
    out[EMINENCE] = out[EMINENCE]! - Math.trunc((age - 60) / 10);
    out[STATECRAFT] = out[STATECRAFT]! - Math.trunc((age - 60) / 10);
  }
  return out.map((v) => Math.max(0, Math.min(30, v)));
}

/** What makes up each skill: talent, each trait, education, age. Lines with nothing to add are left out. */
export function skillBreakdown(content: Content, c: Character, day: number): { label: string; values: number[] }[] {
  const lines = [{ label: 'Talent', values: [...c.skills] }];
  for (const t of c.traits) {
    const d = content.characters.traits.find((x) => x.key === t);
    if (d && d.skills.some((v) => v)) lines.push({ label: d.name, values: [...d.skills] });
  }
  if (c.education) {
    const values = [0, 0, 0];
    values[c.education.focus] = content.characters.education.bonus[c.education.tier] ?? 0;
    if (values.some((v) => v)) lines.push({ label: 'Education', values });
  }
  const age = ageOf(c, day);
  if (age > 60) lines.push({ label: 'Age', values: [-Math.trunc((age - 60) / 10), -Math.trunc((age - 60) / 10), -Math.trunc((age - 60) / 5)] });
  return lines;
}

export function healthOf(content: Content, c: Character): number {
  let h = c.health;
  for (const t of c.traits) h += content.characters.traits.find((x) => x.key === t)?.health ?? 0;
  return Math.max(0, Math.min(100, h));
}

const char = (state: GameState, id: number) => (id ? state.characters[id] ?? null : null);
// Children by parent, rebuilt when someone is born (characters only grow, and parents never change).
let kidsIndex: { state: GameState; size: number; byParent: Map<number, Character[]> } | null = null;
export function childrenOf(state: GameState, id: number): Character[] {
  if (!kidsIndex || kidsIndex.state !== state || kidsIndex.size !== state.characters.length) {
    const byParent = new Map<number, Character[]>();
    for (const c of state.characters) {
      if (!c) continue;
      for (const p of [c.father, c.mother]) if (p) (byParent.get(p) ?? byParent.set(p, []).get(p)!).push(c);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.born - b.born);
    kidsIndex = { state, size: state.characters.length, byParent };
  }
  return [...(kidsIndex.byParent.get(id) ?? [])];
}

// ---------- Making people

function tradition(content: Content, culture: number, religion: number): { male: string[]; female: string[] } {
  const ch = content.characters;
  const group = content.cultures[culture - 1]?.group ?? '';
  const family = content.religions[religion - 1]?.family ?? '';
  const override = ch.nameOverrides.find((o) => o.group === group && o.family === family);
  return ch.names[override?.tradition ?? ch.nameGroups[group] ?? 'generic'] ?? ch.names.generic ?? { male: ['John'], female: ['Joan'] };
}

function rollTraits(state: GameState, content: Content, parents: Character[]): string[] {
  const out: string[] = [];
  const has = (k: string) => out.includes(k) || OPPOSITES.some(([a, b]) => (a === k && out.includes(b)) || (b === k && out.includes(a)));
  for (const t of content.characters.traits) {
    if (has(t.key)) continue;
    const inherited = t.congenital > 0 && parents.some((p) => p.traits.includes(t.key)) && nextInt(state.rng, 100) < t.congenital;
    if (inherited || nextInt(state.rng, 1000) < t.chance * 10) out.push(t.key);
    if (out.length >= 3) break;
  }
  return out;
}

interface NewCharacter {
  female: boolean;
  born: number;
  dynasty: number;
  culture: number;
  religion: number;
  father?: number;
  mother?: number;
  name?: string;
  /** Educated now (adults made on the spot). */
  adult?: boolean;
}

export function createCharacter(state: GameState, content: Content, o: NewCharacter): Character {
  const father = char(state, o.father ?? 0);
  const mother = char(state, o.mother ?? 0);
  const parents = [father, mother].filter((p): p is Character => !!p);
  const v = content.characters.variance;
  const skills = [0, 1, 2].map((i) => {
    const base = parents.length ? Math.trunc(parents.reduce((a, p) => a + p.skills[i]!, 0) / parents.length) : 3 + nextInt(state.rng, 10);
    return Math.max(0, Math.min(20, base + (v ? nextInt(state.rng, 2 * v + 1) - v : 0)));
  });
  const names = tradition(content, o.culture, o.religion);
  const pool = o.female ? names.female : names.male;
  const c: Character = {
    id: state.characters.length,
    name: o.name ?? pool[nextInt(state.rng, pool.length)] ?? 'Nameless',
    dynasty: o.dynasty,
    female: o.female,
    born: o.born,
    died: null,
    father: o.father ?? 0,
    mother: o.mother ?? 0,
    spouse: 0,
    culture: o.culture,
    religion: o.religion,
    skills,
    education: null,
    traits: rollTraits(state, content, parents),
    health: content.characters.healthBase + nextInt(state.rng, 21) - 10,
  };
  if (o.adult) {
    const focus = skills.indexOf(Math.max(...skills));
    c.education = { focus, tier: nextInt(state.rng, 4) };
  }
  state.characters.push(c);
  return c;
}

/** A realm of the same culture group as someone, for a spouse's house; any realm if none. */
function realmOfKind(state: GameState, ctx: EconomyContext, culture: number): number {
  const group = ctx.content.cultures[culture - 1]?.group;
  const kin = state.realms.filter((r) => r && group && ctx.content.cultures[(ctx.culture?.[r.capital] ?? 0) - 1]?.group === group).map((r) => r!.id);
  if (kin.length) return kin[nextInt(state.rng, kin.length)]!;
  return 1 + nextInt(state.rng, state.realms.length - 1);
}

/** A new noble house named after a realm's seat ("of Vierzon"). */
function newDynasty(state: GameState, ctx: EconomyContext, realm: number): number {
  const seat = ctx.seats?.[realm - 1] ?? state.realms[realm]?.name ?? 'Nowhere';
  state.dynasties.push({ id: state.dynasties.length, name: `of ${seat}` });
  return state.dynasties.length - 1;
}

/** Someone of a realm's own people, of the given age range (years). */
function stranger(state: GameState, ctx: EconomyContext, realm: number, like: Pick<Character, 'culture' | 'religion'> | null, minAge: number, maxAge: number, female: boolean, dynasty: number): Character {
  const culture = like?.culture ?? 0;
  const religion = like?.religion ?? 0;
  const age = minAge + nextInt(state.rng, maxAge - minAge + 1);
  return createCharacter(state, ctx.content, {
    female, born: state.day - Math.round(age * 365.25) - nextInt(state.rng, 365), dynasty, culture, religion, adult: true,
  });
}

// ---------- Succession

function lineOf(state: GameState, id: number, cognatic: boolean, skip: number): number {
  const kids = childrenOf(state, id).filter((k) => k.id !== skip && (cognatic || !k.female));
  kids.sort((a, b) => (a.female === b.female ? a.born - b.born : a.female ? 1 : -1));
  for (const k of kids) {
    if (k.died === null) return k.id;
    const r = lineOf(state, k.id, cognatic, skip);
    if (r) return r;
  }
  return 0;
}

/** The first living heir by primogeniture: the ruler's line, then the lines of father, grandfather and great-grandfather. */
function primogeniture(state: GameState, ruler: number, cognatic: boolean): number {
  let r = lineOf(state, ruler, cognatic, 0);
  let cur = char(state, ruler);
  for (let g = 0; !r && cur && g < 3; g++) {
    const parent = char(state, cur.father) ?? (cognatic ? char(state, cur.mother) : null);
    if (!parent) break;
    r = lineOf(state, parent.id, cognatic, cur.id);
    if (!r && isAlive(parent)) r = parent.id;
    cur = parent;
  }
  return r;
}

function ablest(state: GameState, content: Content, ids: number[], weights: number[]): number {
  let best = 0;
  let bestScore = -1;
  for (const id of ids) {
    const c = char(state, id);
    if (!isAlive(c)) continue;
    const s = skillsOf(content, c, state.day).reduce((a, v, i) => a + v * weights[i]!, 0);
    if (s > bestScore) { best = id; bestScore = s; }
  }
  return best;
}

/**
 * Who would inherit from `ruler` under the realm's law, now. 0 = nobody of the blood (republics and theocracies
 * elect from outside, so their heir is 0 until the election).
 */
export function heirOf(state: GameState, content: Content, realm: number, ruler = state.courts[realm]?.ruler ?? 0): number {
  const court = state.courts[realm];
  if (!court || !ruler) return 0;
  const adult = (id: number) => { const c = char(state, id); return isAlive(c) && ageOf(c, state.day) >= content.characters.majority; };
  const dead = char(state, ruler);
  switch (court.law) {
    case 'agnatic': return primogeniture(state, ruler, false);
    case 'cognatic': return primogeniture(state, ruler, true);
    case 'open': {
      const sons = childrenOf(state, ruler).filter((c) => !c.female && isAlive(c));
      const grown = sons.filter((c) => adult(c.id)).map((c) => c.id);
      if (grown.length) return ablest(state, content, grown, [1, 0, 1]);
      if (sons.length) return sons[0]!.id;
      const father = dead ? char(state, dead.father) : null;
      const brothers = father ? childrenOf(state, father.id).filter((c) => !c.female && c.id !== ruler && adult(c.id)).map((c) => c.id) : [];
      return brothers.length ? ablest(state, content, brothers, [1, 0, 1]) : primogeniture(state, ruler, false);
    }
    case 'elective': {
      const kin = dead ? state.characters.filter((c): c is Character => isAlive(c) && !c.female && c.id !== ruler && c.dynasty === dead.dynasty && dead.dynasty !== 0 && adult(c.id)).map((c) => c.id) : [];
      return kin.length ? ablest(state, content, kin, [1, 1, 1]) : primogeniture(state, ruler, false);
    }
    default:
      return 0;
  }
}

function setRegent(state: GameState, ctx: EconomyContext, realm: number, court: Court, previous: Character | null): void {
  const { content } = ctx;
  const ruler = char(state, court.ruler)!;
  const grown = (c: Character | null): c is Character => isAlive(c) && ageOf(c, state.day) >= content.characters.majority && c.id !== court.ruler;
  const mother = char(state, ruler.mother);
  const uncles = previous ? childrenOf(state, previous.father).filter((c) => grown(c) && c.id !== previous.id) : [];
  const seats = court.council.map((id) => char(state, id)).filter(grown);
  const regent = (grown(mother) ? mother : null) ?? uncles[0] ?? seats[0] ?? stranger(state, ctx, realm, ruler, 35, 55, false, 0);
  court.regent = regent.id;
  addModifier(state, content, 'regency', { kind: 'realm', id: realm });
}

/** A ruler is dead: the realm passes by its law, perhaps to a child under a regent, a new house, or with a claimant. */
function succeed(state: GameState, ctx: EconomyContext, realm: number, notices: Notice[]): void {
  const { content } = ctx;
  const court = state.courts[realm]!;
  const dead = char(state, court.ruler);
  let heir = heirOf(state, content, realm, court.ruler);
  let next = char(state, heir);
  if (!next) {
    const elder = court.law === 'theocracy' || court.law === 'republic';
    const fromCouncil = court.law === 'republic' ? ablest(state, content, court.council, [2, 1, 0]) : 0;
    next = char(state, fromCouncil) ?? stranger(state, ctx, realm, dead, elder ? 50 : 25, elder ? 68 : 45, false, elder ? 0 : newDynasty(state, ctx, realm));
    heir = next.id;
  }
  court.ruler = heir;
  court.since = state.day;
  court.regent = 0;
  court.council = court.council.map((id) => (id === heir ? 0 : id));
  removeModifiers(state, 'regency', { kind: 'realm', id: realm });
  addModifier(state, content, 'new_reign', { kind: 'realm', id: realm });
  const dynastic = court.law !== 'theocracy' && court.law !== 'republic';
  if (dynastic && dead && dead.dynasty !== next.dynasty) addModifier(state, content, 'dynasty_change', { kind: 'realm', id: realm });
  if (ageOf(next, state.day) < content.characters.majority) setRegent(state, ctx, realm, court, dead);
  // A grown man of the old house who was passed over may press his claim.
  if (dynastic && dead && (court.regent || court.law === 'open' || court.law === 'elective')) {
    const rivals = state.characters.filter((c): c is Character => isAlive(c) && !c.female && c.id !== heir && c.dynasty === dead.dynasty && dead.dynasty !== 0 && ageOf(c, state.day) >= 18).map((c) => c.id);
    const rival = ablest(state, content, rivals, [1, 0, 1]);
    if (rival && nextInt(state.rng, 2) === 0) {
      court.claimant = rival;
      addModifier(state, content, 'pretender', { kind: 'realm', id: realm });
    }
  }
  const name = state.realms[realm]?.name ?? 'the realm';
  notices.push({ realm, text: `${dead?.name ?? 'The ruler'} of ${name} has died. ${next.name}${court.regent ? `, a child under the regency of ${char(state, court.regent)?.name},` : ''} now rules.` });
}

// ---------- The month

function marry(state: GameState, ctx: EconomyContext, c: Character): void {
  const husbandOlder = c.female ? 1 : -1;
  const spouse = createCharacter(state, ctx.content, {
    female: !c.female,
    born: c.born + husbandOlder * Math.round((nextInt(state.rng, 9) * 365.25)),
    dynasty: newDynasty(state, ctx, realmOfKind(state, ctx, c.culture)),
    culture: c.culture, religion: c.religion, adult: true,
  });
  c.spouse = spouse.id;
  spouse.spouse = c.id;
}

function fertile(content: Content, c: Character, day: number): number {
  const f = content.characters.fertility;
  const age = ageOf(c, day);
  if (age < f.from || age >= f.until) return 0;
  return age >= f.late ? f.lateChance : f.chance;
}

/** Month start: deaths, births, marriages, education, majorities, councils, claimants, regents' hands in the till. */
export function monthlyCharacters(state: GameState, ctx: EconomyContext): Notice[] {
  const { content } = ctx;
  const ch = content.characters;
  const notices: Notice[] = [];
  // Deaths.
  for (const c of state.characters) {
    if (!isAlive(c)) continue;
    const age = ageOf(c, state.day);
    let bp = 0;
    for (const [from, chance] of ch.mortality) if (age >= from!) bp = chance!;
    bp = Math.trunc((bp * (150 - healthOf(content, c))) / 100);
    if (bp > 0 && nextInt(state.rng, 10000) < bp) c.died = state.day;
  }
  state.courts.forEach((court, realm) => {
    if (!court) return;
    if (!isAlive(char(state, court.ruler))) succeed(state, ctx, realm, notices);
    if (court.regent && !isAlive(char(state, court.regent))) setRegent(state, ctx, realm, court, null);
    if (court.claimant && (!isAlive(char(state, court.claimant)) || !state.modifiers.some((m) => m.def === 'pretender' && m.target.kind === 'realm' && m.target.id === realm))) {
      court.claimant = 0;
      removeModifiers(state, 'pretender', { kind: 'realm', id: realm });
    }
  });
  // Majority.
  state.courts.forEach((court, realm) => {
    if (!court?.regent) return;
    const ruler = char(state, court.ruler);
    if (ruler && ageOf(ruler, state.day) >= ch.majority) {
      court.regent = 0;
      removeModifiers(state, 'regency', { kind: 'realm', id: realm });
      notices.push({ realm, text: `${ruler.name} has come of age and rules in their own name.` });
    }
  });
  // Marriages and births in the ruling line: the ruler and the heir.
  const line = new Set<number>();
  state.courts.forEach((court, realm) => {
    if (!court) return;
    const celibate = court.law === 'theocracy' || court.law === 'republic';
    for (const id of celibate ? [] : [court.ruler, heirOf(state, content, realm)]) {
      const c = char(state, id);
      if (!isAlive(c) || line.has(c.id)) continue;
      line.add(c.id);
      const spouse = char(state, c.spouse);
      if (!isAlive(spouse)) {
        if (ageOf(c, state.day) >= ch.marriage.age + (c.female ? 0 : 2) && nextInt(state.rng, 10000) < ch.marriage.chance) marry(state, ctx, c);
        continue;
      }
      const wife = c.female ? c : spouse;
      const husband = c.female ? spouse : c;
      const bp = fertile(content, wife, state.day);
      if (bp && nextInt(state.rng, 10000) < bp) {
        // A ruling woman's children are of her house; otherwise the father's.
        const rulingWife = state.courts.some((x) => x?.ruler === wife.id);
        createCharacter(state, content, {
          female: nextInt(state.rng, 2) === 0, born: state.day,
          dynasty: rulingWife || !husband.dynasty ? wife.dynasty : husband.dynasty,
          culture: c.culture, religion: c.religion, father: husband.id, mother: wife.id,
        });
      }
    }
  });
  // Education at sixteen, guided by the father or the realm's ruler.
  for (const c of state.characters) {
    if (!isAlive(c) || c.education || ageOf(c, state.day) < ch.education.end) continue;
    const focus = c.skills.indexOf(Math.max(...c.skills));
    const guardian = char(state, c.father) ?? char(state, c.mother);
    const g = guardian ? skillsOf(content, guardian, state.day)[focus]! : 8;
    c.education = { focus, tier: Math.max(0, Math.min(3, Math.trunc((g + nextInt(state.rng, 10)) / ch.education.perTier))) };
  }
  fillCouncils(state, ctx);
  // A regent may help himself to the treasury.
  state.courts.forEach((court, realm) => {
    const regent = char(state, court?.regent ?? 0);
    const ec = state.economy[realm];
    if (!regent || !ec || ec.treasury <= 0) return;
    if (nextInt(state.rng, 100) < (regent.traits.includes('greedy') ? 20 : 2)) {
      const took = Math.trunc((ec.treasury * 3) / 100);
      ec.treasury -= took;
      addToLedger(ec.oneOff, 'embezzlement', -took);
      notices.push({ realm, text: `The regent ${regent.name} has helped himself to ${Math.trunc(took / 100)} ducats.` });
    }
  });
  refreshAllCourtModifiers(state, content);
  return notices;
}

/** Councils: empty or dead seats go to the ablest grown kin of the ruler, else to officials of no house. */
function fillCouncils(state: GameState, ctx: EconomyContext): void {
  const { content } = ctx;
  const ch = content.characters;
  state.courts.forEach((court, realm) => {
    if (!court || !ch.council.length) return;
    const ruler = char(state, court.ruler);
    if (court.council.length < ch.council.length) court.council = ch.council.map((_, i) => court.council[i] ?? 0);
    ch.council.forEach((seat, i) => {
      if (isAlive(char(state, court.council[i]!))) return;
      const taken = new Set([court.ruler, court.regent, ...court.council]);
      const kin = ruler ? [ruler.spouse, ...childrenOf(state, ruler.id).map((c) => c.id), ...(ruler.father ? childrenOf(state, ruler.father).map((c) => c.id) : [])]
        .filter((id) => !taken.has(id) && (() => { const c = char(state, id); return isAlive(c) && ageOf(c, state.day) >= 18; })()) : [];
      const w = [0, 0, 0];
      w[seat.skill] = 1;
      court.council[i] = ablest(state, content, kin, w) || stranger(state, ctx, realm, ruler, 28, 55, false, 0).id;
    });
  });
}

// ---------- The ruler's mark on the realm

/** The scaled modifiers a realm should carry for its ruler (or regent), the ruler's traits and its council. */
function wantedModifiers(state: GameState, content: Content, court: Court): { def: string; scale: number }[] {
  const ch = content.characters;
  const out: { def: string; scale: number }[] = [];
  const governor = char(state, court.regent) ?? char(state, court.ruler);
  if (governor) {
    const s = skillsOf(content, governor, state.day);
    ['ruler_eminence', 'ruler_statecraft', 'ruler_warcraft'].forEach((def, i) => {
      if (content.modifiers[def] && s[i] !== ch.pivot) out.push({ def, scale: s[i]! - ch.pivot });
    });
  }
  const ruler = char(state, court.ruler);
  for (const t of ruler?.traits ?? []) {
    const m = ch.traits.find((x) => x.key === t)?.rulerModifier;
    if (m && content.modifiers[m]) out.push({ def: m, scale: 1 });
  }
  ch.council.forEach((seat, i) => {
    const c = char(state, court.council[i] ?? 0);
    if (!c || !content.modifiers[seat.modifier]) return;
    const v = skillsOf(content, c, state.day)[seat.skill]! - ch.pivot;
    if (v) out.push({ def: seat.modifier, scale: v });
  });
  return out;
}

const COURT_PREFIXES = ['ruler_', 'council_', 'trait_'];

export function refreshAllCourtModifiers(state: GameState, content: Content): void {
  state.courts.forEach((court, realm) => {
    if (!court) return;
    const want = wantedModifiers(state, content, court);
    const have = state.modifiers.filter((m) => m.target.kind === 'realm' && m.target.id === realm && COURT_PREFIXES.some((p) => m.def.startsWith(p)));
    const same = want.length === have.length && want.every((w) => have.some((h) => h.def === w.def && (h.scale ?? 1) === w.scale));
    if (same) return;
    state.modifiers = state.modifiers.filter((m) => !have.includes(m));
    for (const w of want) addModifier(state, content, w.def, { kind: 'realm', id: realm }, w.scale);
  });
}

const years = (n: number) => Math.round(n * 365.25);

/** A ruler and family for a realm the scenario left without one, of its seat's people and its government's law. */
function generateCourt(state: GameState, ctx: EconomyContext, realm: number): Court {
  const { content } = ctx;
  const ch = content.characters;
  const r = state.realms[realm]!;
  const law = ch.governmentLaws[r.government] ?? ch.laws[0]!.key;
  const like = { culture: ctx.culture?.[r.capital] ?? 0, religion: ctx.religion?.[r.capital] ?? 0 };
  if (law === 'theocracy' || law === 'republic') {
    const ruler = stranger(state, ctx, realm, like, 48, 70, false, law === 'republic' ? newDynasty(state, ctx, realm) : 0);
    return { ruler: ruler.id, regent: 0, law, council: [], claimant: 0, since: 0 };
  }
  const dynasty = newDynasty(state, ctx, realm);
  const age = 18 + nextInt(state.rng, 42);
  const father = createCharacter(state, content, { ...like, female: false, born: -years(age + 25 + nextInt(state.rng, 10)), dynasty, adult: true });
  father.died = -1 - nextInt(state.rng, 2000);
  const born = -years(age) - nextInt(state.rng, 365);
  const ruler = createCharacter(state, content, { ...like, female: false, born, dynasty, father: father.id, adult: true });
  for (let i = nextInt(state.rng, 3); i > 0; i--) {
    createCharacter(state, content, { ...like, female: nextInt(state.rng, 2) === 0, born: born + years(nextInt(state.rng, 13) - 6), dynasty, father: father.id, adult: true });
  }
  if (age >= 20) {
    const wife = createCharacter(state, content, { ...like, female: true, born: born + years(2 + nextInt(state.rng, 8)), dynasty: newDynasty(state, ctx, realmOfKind(state, ctx, like.culture)), adult: true });
    ruler.spouse = wife.id;
    wife.spouse = ruler.id;
    const wifeAge = ageOf(wife, 0);
    for (let i = Math.min(5, nextInt(state.rng, 5)); i > 0 && wifeAge > 18; i--) {
      const childAge = nextInt(state.rng, Math.min(wifeAge - 17, 26));
      const child = createCharacter(state, content, { ...like, female: nextInt(state.rng, 2) === 0, born: -years(childAge) - nextInt(state.rng, 365), dynasty, father: ruler.id, mother: wife.id });
      if (childAge >= ch.education.end) child.education = { focus: child.skills.indexOf(Math.max(...child.skills)), tier: nextInt(state.rng, 4) };
    }
  }
  return { ruler: ruler.id, regent: 0, law, council: [], claimant: 0, since: 0 };
}

/** At the start: generated courts where the scenario has none, regencies for child rulers, councils and modifiers. */
export function startCharacters(state: GameState, ctx: EconomyContext): void {
  while (state.courts.length < state.realms.length) state.courts.push(null);
  state.realms.forEach((r, realm) => { if (r && !state.courts[realm]) state.courts[realm] = generateCourt(state, ctx, realm); });
  fillCouncils(state, ctx);
  state.courts.forEach((court, realm) => {
    if (!court) return;
    const ruler = char(state, court.ruler);
    if (ruler && ageOf(ruler, state.day) < ctx.content.characters.majority) {
      if (!court.regent) setRegent(state, ctx, realm, court, null);
      else addModifier(state, ctx.content, 'regency', { kind: 'realm', id: realm });
    }
  });
  refreshAllCourtModifiers(state, ctx.content);
}

