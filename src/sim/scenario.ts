/**
 * Compiled scenario (public/generated/scenario.json), produced by tools/build-data.ts.
 * Lives in sim so the core can build a new game from it without importing content code.
 */
export const RANKS = ['empire', 'kingdom', 'duchy', 'county'] as const;
export const GOVERNMENTS = [
  'feudal_monarchy', 'merchant_republic', 'theocracy', 'holy_order', 'steppe_horde', 'iqta_sultanate', 'beylik',
] as const;
export type Rank = (typeof RANKS)[number];
export type Government = (typeof GOVERNMENTS)[number];

/** Realm ids start at 1; 0 means none. */
export interface ScenarioRealm {
  id: number;
  key: string;
  name: string;
  rank: Rank;
  government: Government;
  color: string;
  capital: number;
  overlord: number;
  scripted: boolean;
}

/** A person. Days are game days (0 = 1 November 1314; earlier births are negative). */
export interface Character {
  id: number;
  name: string;
  /** Dynasty id; 0 = lowborn. */
  dynasty: number;
  female: boolean;
  born: number;
  died: number | null;
  father: number;
  mother: number;
  spouse: number;
  /** Content.cultures / religions ids. */
  culture: number;
  religion: number;
  /** Talent in [eminence, statecraft, warcraft] before traits, education and age. */
  skills: number[];
  /** focus: the skill index; tier 0-3. Null until educated. */
  education: { focus: number; tier: number } | null;
  traits: string[];
  /** 0-100. */
  health: number;
}

export interface Dynasty {
  id: number;
  name: string;
}

/** Who rules a realm and how it passes on. Character ids; 0 = none. */
export interface Court {
  ruler: number;
  /** Governs while the ruler is a child. */
  regent: number;
  /** Key into Content.characters.laws. */
  law: string;
  /** One seat per Content.characters.council role. */
  council: number[];
  /** A rival with a claim on the throne; 0 = none. */
  claimant: number;
  /** Day the reign began. */
  since: number;
}

/** A modifier in force at the start: def key, what it sits on, and the day it ends (null = never). */
export interface ScenarioModifier {
  def: string;
  target: { kind: 'province' | 'realm'; id: number };
  end: number | null;
}

/** owner/controller are indexed by province id (index 0 unused); 0 = unowned. */
export interface Scenario {
  realms: ScenarioRealm[];
  owner: number[];
  controller: number[];
  modifiers?: ScenarioModifier[];
  /** Per province id: culture and religion ids (Content.cultures / religions, 1-based; 0 = none). */
  culture?: number[];
  religion?: number[];
  /** Per province id: its de jure county (Content.titles.counties, 1-based; 0 = none). */
  county?: number[];
  /** Per province id: its trade good (Content.goods, 1-based; 0 = none). */
  good?: number[];
  /** Starting people: 5 numbers per province id in STRATA order (sim/content.ts); missing = nobody. */
  pops?: number[];
  /** Per province id: starting development in whole points. */
  development?: number[];
  /** Per province id: entrepôt trade value, hundredths of a ducat a month (0 = none). */
  tradeCentre?: number[];
  /** Starting people (ids from 1, in order), their houses (ids from 1), and each realm's court (realm id - 1). */
  characters?: Character[];
  dynasties?: Dynasty[];
  courts?: (Court | null)[];
  /** Per realm id - 1: the name of its seat, for houses founded there ("of Paris"). */
  seats?: string[];
  /**
   * The march graph of land provinces: province p's neighbours are to[start[p] .. start[p + 1]), each reached in
   * days[i] tenths of a day (terrain, distance, straits). pos holds every province's centroid, x and y in map pixels.
   */
  graph?: { start: number[]; to: number[]; days: number[] };
  pos?: number[];
  /** Kilometres per map pixel at the standard parallel, for the march planner's estimate. */
  kmPerPx?: number;
  /** Per province id: terrain key ('' for none). */
  terrain?: string[];
}
