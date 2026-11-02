/**
 * Compiled game content (public/generated/content.json), built from data/content/*.yaml by tools/build-data.ts.
 * Lives in sim so the core can use it without importing content code. All numbers are fixed-point hundredths
 * (SCALE): a value of 5000 is 50, and a `pct` effect of 1000 is +10%.
 */
export const SCALE = 100;

export type StatScope = 'province' | 'realm';
export type StatFormat = 'number' | 'integer' | 'percent' | 'gold';

export interface StatDef {
  key: string;
  scope: StatScope;
  label: string;
  description: string;
  base: number;
  min: number;
  max: number;
  format: StatFormat;
}

/** add: plus `value` (hundredths of the stat's unit); pct: times (1 + value / 10000). */
export interface Effect {
  stat: string;
  op: 'add' | 'pct';
  value: number;
}

export interface ModifierDef {
  key: string;
  label: string;
  description: string;
  effects: Effect[];
  /** replace: adding it again to the same target refreshes it; stack: every copy counts. */
  stacking: 'stack' | 'replace';
  /** Lasts this many days from when it is added; null = until removed. */
  days: number | null;
}

export interface ReligionDef {
  key: string;
  name: string;
  family: string;
  color: string;
}

export interface CultureDef {
  key: string;
  name: string;
  group: string;
  groupName: string;
  /** Default religion: 1-based index into Content.religions. */
  religion: number;
  color: string;
}

export interface GoodDef {
  key: string;
  name: string;
  color: string;
}

export type TitleTier = 'county' | 'duchy' | 'kingdom' | 'empire' | 'hegemony';

/** A de jure title. Ids are 1-based per tier (Content.titles[tier][id - 1]); 0 means none. */
export interface TitleDef {
  key: string;
  name: string;
  /** Id of the title one tier up; 0 = none (an empire outside any de jure hegemony, say). */
  parent: number;
  /** Counties: their capital province id. */
  capital?: number;
}

/** A hegemony: a de jure top title (de_jure) or one formed later by decision; lists the empires it unites. */
export interface HegemonyDef {
  key: string;
  name: string;
  hinduName?: string;
  description: string;
  deJure: boolean;
  empires: number[];
}

export interface Titles {
  counties: TitleDef[];
  duchies: TitleDef[];
  kingdoms: TitleDef[];
  empires: TitleDef[];
  hegemonies: HegemonyDef[];
}

export interface Content {
  stats: Record<string, StatDef>;
  modifiers: Record<string, ModifierDef>;
  /** Culture id i is cultures[i - 1]; 0 means none. Same for religions. */
  cultures: CultureDef[];
  religions: ReligionDef[];
  titles: Titles;
  /** Trade good id i is goods[i - 1]; 0 = none. */
  goods: GoodDef[];
}
