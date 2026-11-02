import type { Modifier } from './modifiers';
import { createRng, type RngState } from './rng';
import type { Scenario, ScenarioRealm } from './scenario';

export const SAVE_VERSION = 3;

/** Speed 1 (slowest) .. 5 (fastest). */
export type Speed = 1 | 2 | 3 | 4 | 5;

export type Realm = ScenarioRealm;

/** Per-province mutable state. Static geometry (shape, adjacency) stays in map.json. */
export interface ProvinceState {
  id: number;
  /** Realm that owns the province (0 = unclaimed, sea, wasteland). */
  owner: number;
  /** Realm whose troops hold it; differs from owner while occupied. */
  controller: number;
}

export interface GameState {
  saveVersion: number;
  seed: number;
  rng: RngState;
  /** Days since 1 November 1314. */
  day: number;
  speed: Speed;
  paused: boolean;
  /** Indexed by realm id; index 0 is unused. */
  realms: (Realm | null)[];
  /** Indexed by province id; index 0 is unused. */
  provinces: ProvinceState[];
  /** Every modifier in force, on provinces and realms (see modifiers.ts). */
  modifiers: Modifier[];
  nextModifierId: number;
}

export function provincesFromScenario(scenario: Scenario): ProvinceState[] {
  return scenario.owner.map((owner, id) => ({ id, owner, controller: scenario.controller[id] ?? owner }));
}

export function realmsFromScenario(scenario: Scenario): (Realm | null)[] {
  return [null, ...scenario.realms.map((r) => ({ ...r }))];
}

/** The scenario's starting modifiers, numbered from 1. */
export function modifiersFromScenario(scenario: Scenario): Modifier[] {
  return (scenario.modifiers ?? []).map((m, i) => ({ id: i + 1, def: m.def, target: { ...m.target }, start: 0, end: m.end }));
}

export function newGame(seed: number, scenario: Scenario): GameState {
  const modifiers = modifiersFromScenario(scenario);
  return {
    saveVersion: SAVE_VERSION,
    seed: seed >>> 0,
    rng: createRng(seed),
    day: 0,
    speed: 2,
    paused: true,
    realms: realmsFromScenario(scenario),
    provinces: provincesFromScenario(scenario),
    modifiers,
    nextModifierId: modifiers.length + 1,
  };
}
