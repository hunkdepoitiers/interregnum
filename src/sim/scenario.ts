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

/** owner/controller are indexed by province id (index 0 unused); 0 = unowned. */
export interface Scenario {
  realms: ScenarioRealm[];
  owner: number[];
  controller: number[];
}
