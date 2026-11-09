import type { Modifier } from './modifiers';
import { createRng, type RngState } from './rng';
import type { Character, Court, Dynasty, Scenario, ScenarioRealm } from './scenario';

export type { Character, Court, Dynasty };

export const SAVE_VERSION = 8;

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

/** One month's money, by ledger category (src/sim/economy.ts); income positive, spending negative, hundredths. */
export type Ledger = Record<string, number>;

/** A realm's money. Indexed like realms. */
export interface RealmEconomy {
  /** Hundredths of a ducat; may go below zero. */
  treasury: number;
  /** Key into Content.economy.taxLaws. */
  taxLaw: string;
  /** Day the tax law last changed (−Infinity is not JSON, so a far past day). */
  lawChanged: number;
  /** Days on which the realm defaulted. */
  defaults: number[];
  /** Last month's settled ledger. */
  ledger: Ledger;
  /** One-off money moved this month so far (buildings, loans), shown with the next settled ledger. */
  oneOff: Ledger;
}

export interface BankState {
  /** Hundredths of a ducat it can still lend. */
  capital: number;
  /** What it has lost to defaults. */
  losses: number;
  collapsed: boolean;
  /** Realms that defaulted on it and get no more loans. */
  refused: number[];
}

export interface Loan {
  id: number;
  /** Index into Content.economy.banks. */
  bank: number;
  realm: number;
  principal: number;
  /** Yearly interest, hundredths of a percent. */
  rate: number;
  start: number;
  due: number;
  /** Province whose revenues stand surety; 0 = none. */
  pledge: number;
}

export interface Construction {
  province: number;
  /** Key into Content.economy.buildings. */
  building: string;
  realm: number;
  done: number;
}

/** A realm's prestige and piety: the standing of its ruling house (data/content/faith.yaml). Whole points. */
export interface RealmStanding {
  prestige: number;
  piety: number;
  /** Recent deeds and what they brought, oldest first. */
  log: { day: number; label: string; prestige: number; piety: number }[];
  /** Deed key → day it may be done again. */
  cooldowns: Record<string, number>;
  /** The ruler away on pilgrimage, and the day they come home. */
  pilgrimage: { ruler: number; until: number } | null;
}

/** An army in the field (src/sim/military.ts). */
export interface Army {
  id: number;
  realm: number;
  /** Province it stands in, or marches from. */
  location: number;
  /** Provinces still to march through, the next first. */
  path: number[];
  /** Tenths of a day marched toward path[0]. */
  progress: number;
  levies: number;
  menAtArms: number;
  /** 0..10000. */
  morale: number;
  /** Day its levies were called up (their unpaid service runs from here). */
  raised: number;
  /** Day it has mustered and may march. */
  ready: number;
  /** Character leading it; 0 = none. */
  commander: number;
  /** Days it has held the province toward occupying it. */
  siege: number;
  /** Fleeing a lost battle: it cannot be caught or give battle until it stops. */
  retreating: boolean;
  /** Mercenary company it is (index in Content.war.companies + 1); 0 = the realm's own. */
  company: number;
}

export interface War {
  id: number;
  name: string;
  attackers: number[];
  defenders: number[];
  start: number;
  /** Key into Content.war.casusBelli. */
  cb: string;
  /** Province whose holding ticks the score. */
  goal: number;
  /** War score from battles and from the goal, from the attackers' side. */
  battles: number;
  ticking: number;
}

export interface Fort {
  level: number;
  garrison: number;
  /** Days of stores left. */
  supply: number;
}

export interface Siege {
  province: number;
  /** Realm conducting it. */
  realm: number;
  start: number;
  /** 0..10000. */
  progress: number;
  engineers: number;
  breach: boolean;
  /** Days before another assault or bribe may be tried. */
  nextAssault: number;
  nextBribe: number;
  log: { day: number; text: string }[];
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
  /** Realm the human plays; 0 = watching. */
  player: number;
  /** People by stratum: STRATA.length numbers per province id (sim/content.ts). */
  pops: number[];
  /** Per-stat, per-province base values that replace the stat's own base (development). Hundredths. */
  provinceBase: Record<string, number[]>;
  /** Indexed like realms; null for index 0. */
  economy: (RealmEconomy | null)[];
  /** Indexed like Content.economy.banks. */
  banks: BankState[];
  loans: Loan[];
  nextLoanId: number;
  /** Finished buildings by province id. */
  buildings: Record<string, string[]>;
  construction: Construction[];
  /** Indexed by character id; index 0 is unused. The dead stay, for family trees. */
  characters: (Character | null)[];
  /** Indexed by dynasty id; index 0 (no dynasty, lowborn) is unused. */
  dynasties: (Dynasty | null)[];
  /** Indexed like realms. */
  courts: (Court | null)[];
  /** Indexed like realms. */
  standing: (RealmStanding | null)[];
  armies: Army[];
  nextArmyId: number;
  wars: War[];
  nextWarId: number;
  /** By province id; provinces without a fort are absent. */
  forts: Record<string, Fort>;
  sieges: Siege[];
  /** By realm id: levies killed and not yet replaced. */
  levyLost: Record<string, number>;
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

/** The economy at the start: people and development from the scenario, empty treasuries (newGame fills them). */
export function economyFromScenario(scenario: Scenario, realmCount: number, bankCapitals: number[]) {
  return {
    player: 0,
    pops: scenario.pops ? [...scenario.pops] : new Array<number>(scenario.owner.length * 5).fill(0),
    provinceBase: { development: (scenario.development ?? []).map((d) => d * 100) },
    economy: Array.from({ length: realmCount }, (_, i): RealmEconomy | null =>
      i === 0 ? null : { treasury: 0, taxLaw: 'normal', lawChanged: -100000, defaults: [], ledger: {}, oneOff: {} }),
    banks: bankCapitals.map((capital): BankState => ({ capital, losses: 0, collapsed: false, refused: [] })),
    loans: [] as Loan[],
    nextLoanId: 1,
    buildings: {} as Record<string, string[]>,
    construction: [] as Construction[],
  };
}

/** The scenario's people, houses and courts, copied so the game never edits the scenario. */
export function charactersFromScenario(scenario: Scenario) {
  return {
    characters: [null, ...(scenario.characters ?? []).map((c) => ({ ...c, skills: [...c.skills], traits: [...c.traits], education: c.education ? { ...c.education } : null }))],
    dynasties: [null, ...(scenario.dynasties ?? []).map((d) => ({ ...d }))],
    courts: [null, ...scenario.realms.map((r) => {
      const c = scenario.courts?.[r.id - 1];
      return c ? { ...c, council: [...c.council] } : null;
    })],
  };
}

export function newGame(seed: number, scenario: Scenario, bankCapitals: number[] = []): GameState {
  const modifiers = modifiersFromScenario(scenario);
  const realms = realmsFromScenario(scenario);
  return {
    saveVersion: SAVE_VERSION,
    seed: seed >>> 0,
    rng: createRng(seed),
    day: 0,
    speed: 2,
    paused: true,
    realms,
    provinces: provincesFromScenario(scenario),
    modifiers,
    nextModifierId: modifiers.length + 1,
    ...economyFromScenario(scenario, realms.length, bankCapitals),
    ...charactersFromScenario(scenario),
    standing: realms.map((r) => (r ? { prestige: 0, piety: 0, log: [], cooldowns: {}, pilgrimage: null } : null)),
    armies: [],
    nextArmyId: 1,
    wars: [],
    nextWarId: 1,
    forts: {},
    sieges: [],
    levyLost: {},
  };
}
