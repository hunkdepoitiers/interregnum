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
}
