import type { Command } from '../sim/commands';
import type { Content } from '../sim/content';
import type { CreditRating, LoanOffer, Notice, ProvinceEconomy } from '../sim/economy';
import type { Modifier } from '../sim/modifiers';
import type { Scenario } from '../sim/scenario';
import type { Construction, Ledger, Loan, Realm, Speed } from '../sim/state';

/** Questions the UI asks the worker about money and people. */
export type EconomyQuery = { kind: 'realm'; id: number } | { kind: 'province'; id: number } | { kind: 'character'; id: number };

/** A character as other views mention them. */
export interface CharacterRef {
  id: number;
  name: string;
  house: string;
  age: number;
  female: boolean;
  alive: boolean;
}

export interface CourtReport {
  ruler: CharacterRef | null;
  regent: CharacterRef | null;
  heir: CharacterRef | null;
  claimant: CharacterRef | null;
  /** Key into Content.characters.laws. */
  law: string;
  since: number;
  /** Skills of the ruler as they stand. */
  rulerSkills: number[];
  rulerTraits: string[];
  council: { role: string; skill: number; who: CharacterRef | null; value: number }[];
}

export interface CharacterReport {
  ref: CharacterRef;
  born: number;
  died: number | null;
  /** [eminence, statecraft, warcraft] as they stand, and what makes each up. */
  skills: number[];
  breakdown: { label: string; values: number[] }[];
  traits: string[];
  education: { focus: number; tier: number } | null;
  health: number;
  religion: number;
  culture: number;
  /** What they are to which realms: ruler, regent, heir, claimant, councillor. */
  roles: { realm: number; role: string }[];
  father: CharacterRef | null;
  mother: CharacterRef | null;
  spouse: CharacterRef | null;
  children: CharacterRef[];
  siblings: CharacterRef[];
}

/** A realm's prestige, piety and faith, and the deeds it may do. */
export interface StandingReport {
  prestige: number;
  piety: number;
  prestigeTier: number;
  prestigeName: string;
  pietyTier: number;
  pietyName: string;
  /** Religion id (0 = none) and its head of faith's realm (0 = none). */
  religion: number;
  head: number;
  holySites: { name: string; province: number; held: boolean }[];
  log: { day: number; label: string; prestige: number; piety: number }[];
  /** Day the ruler comes home from pilgrimage; null = at home. */
  pilgrimage: number | null;
  excommunicated: boolean;
  /** Monthly chance (basis points) of excommunication now; 0 = none. */
  excommunicationChance: number;
  /** Every deed with its price now and why it cannot be done (null = it can). */
  deeds: { key: string; name: string; description: string; cost: number; income: number; prestige: number; piety: number; days: number; why: string | null }[];
}

export interface RealmReport {
  treasury: number;
  /** Last month's settled ledger, and this month's as it stands (one-offs so far included). */
  ledger: Ledger;
  projected: Ledger;
  credit: CreditRating;
  offers: LoanOffer[];
  loans: Loan[];
  taxLaw: string;
  /** Days until the tax law may change again (0 = now). */
  lawWait: number;
  construction: Construction[];
  people: number;
  court: CourtReport | null;
  standing: StandingReport | null;
}

export interface ProvinceReport {
  economy: ProvinceEconomy;
  buildings: string[];
  construction: Construction[];
  /** For the player's realm: per building key, why it cannot be built now (null = it can). */
  canBuild: Record<string, string | null>;
  /** Holy sites here, by religion id. */
  holySites: { name: string; religion: number }[];
}

export type ToWorker =
  | { type: 'init'; seed: number; scenario: Scenario; content: Content }
  | { type: 'command'; cmd: Command }
  | { type: 'requestSave'; requestId: number }
  | { type: 'load'; requestId: number; text: string }
  | { type: 'query'; requestId: number; query: EconomyQuery };

/** Political state the map and panels need; sent whenever ownership, control or modifiers may have changed. */
export interface WorldView {
  realms: (Realm | null)[];
  /** Indexed by province id. */
  owner: Uint16Array;
  controller: Uint16Array;
  modifiers: Modifier[];
  /** Per province id: development before modifiers, hundredths (the stat's base). */
  development: Uint16Array;
}

export type FromWorker =
  | { type: 'status'; day: number; speed: Speed; paused: boolean; player: number; treasury: number | null; net: number | null }
  | { type: 'notices'; notices: Notice[] }
  | { type: 'queryResult'; requestId: number; result: RealmReport | ProvinceReport | CharacterReport | null }
  | ({ type: 'world' } & WorldView)
  | { type: 'saveData'; requestId: number; text: string }
  | { type: 'loaded'; requestId: number; error: string | null };
