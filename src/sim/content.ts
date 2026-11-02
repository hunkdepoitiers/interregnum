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

export interface Content {
  stats: Record<string, StatDef>;
  modifiers: Record<string, ModifierDef>;
}
