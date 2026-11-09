import type { Command } from '../sim/commands';
import type { Content } from '../sim/content';
import type { DiploAction } from '../sim/diplomacy';
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

/** An army as the map and the army panel show it. */
export interface ArmyView {
  id: number;
  realm: number;
  location: number;
  /** Province it marches into next (0 = standing), how far along (0-100), and where it is bound. */
  next: number;
  progress: number;
  destination: number;
  /** Provinces still to march through. */
  path: number[];
  /** Days left to the destination. */
  eta: number;
  levies: number;
  menAtArms: number;
  /** 0-100. */
  morale: number;
  commander: CharacterRef | null;
  /** Name of its mercenary company; null = the realm's own. */
  company: string | null;
  /** Mustering until this day. */
  ready: number;
  fighting: boolean;
  retreating: boolean;
  /** Days spent taking the province, and days it needs (0 = not occupying). */
  siege: number;
  siegeNeed: number;
  wage: number;
}

export interface SiegeView {
  province: number;
  realm: number;
  /** 0-100. */
  progress: number;
  level: number;
  garrison: number;
  supply: number;
  engineers: number;
  maxEngineers: number;
  engineerCost: number;
  breach: boolean;
  /** Basis points; men lost if it succeeds or fails; days until it may be tried. */
  assaultChance: number;
  assaultWon: number;
  assaultLost: number;
  assaultWait: number;
  bribes: { cost: number; chance: number }[];
  bribeWait: number;
  /** Progress a day, hundredths of a percent. */
  daily: number;
  log: { day: number; text: string }[];
}

export interface PeaceOffer {
  /** Occupied land on the table, with each province's value. */
  land: { id: number; value: number }[];
  /** Land costs (sum of values × landRate / loserValue), at least 1. */
  landRate: number;
  loserValue: number;
  tributeYears: number;
  vassals: number[];
  releaseCost: number;
  vassalizeCost: number;
  vassalizeWhy: string | null;
  humiliateCost: number;
  humiliatePrestige: number;
  breakCost: number;
  allies: number;
  gold: { months: number; amount: number; cost: number }[];
  tributeCost: number;
  tributeShare: number;
}

export interface WarView {
  id: number;
  name: string;
  cbName: string;
  attackers: number[];
  defenders: number[];
  start: number;
  /** From the attackers' side, -100..100. */
  score: number;
  occupation: number;
  battles: number;
  ticking: number;
  /** For the player's wars: what the player could demand if ahead, or give if behind. */
  demand: PeaceOffer | null;
  concede: PeaceOffer | null;
  /** Share (%) of the score against it that a beaten side's offer must be worth. */
  concedeShare: number;
  /** How far ahead an enemy may be and still accept a white peace. */
  whiteLimit: number;
  cb: string;
}

export interface MilitaryReport {
  /** Levies the realm can call up in all. */
  total: number;
  raised: number;
  menAtArms: number;
  maxMenAtArms: number;
  /** Cost of hiring 1,000 men-at-arms, and why the realm cannot now (null = it can). */
  hireCost: number;
  cannotHire: string | null;
  companies: { index: number; name: string; description: string; men: number; cost: number; wage: number; why: string | null }[];
  /** For another realm: the player's reasons to attack it. */
  casusBelli: { key: string; name: string; description: string; prestige: number; piety: number; why: string | null }[];
}

export interface DiplomacyReport {
  /** What this realm thinks of the player; null on the player's own realm or with no player. */
  opinion: { value: number; lines: { label: string; value: number }[] } | null;
  truceDays: number;
  allies: number[];
  kin: number[];
  paysTo: { realm: number; share: number }[];
  receivesFrom: { realm: number; share: number }[];
  /** On the player's own realm. */
  faction: { members: number[]; power: number; needed: number; days: number; needDays: number } | null;
  demands: { id: number; from: number; share: number; years: number; men: number; days: number }[];
  actions: { key: DiploAction; label: string; detail: string; cost: number; why: string | null }[];
  /** For the player's vassal: its obligations and the choices. */
  contract: { current: string; options: { key: string; name: string; description: string }[] } | null;
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
  military: MilitaryReport;
  diplomacy: DiplomacyReport;
}

export interface ProvinceReport {
  economy: ProvinceEconomy;
  buildings: string[];
  construction: Construction[];
  /** For the player's realm: per building key, why it cannot be built now (null = it can). */
  canBuild: Record<string, string | null>;
  /** Holy sites here, by religion id. */
  holySites: { name: string; religion: number }[];
  fort: { level: number; garrison: number; maxGarrison: number; supply: number } | null;
}

/** A player's unanswered event; its text is in Content.events. */
export interface EventView { id: number; key: string; realm: number; ruler: string; options: { key: string; open: boolean; chance: number | null }[] }

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
  | { type: 'events'; events: EventView[] }
  | { type: 'armies'; armies: ArmyView[]; wars: WarView[]; sieges: SiegeView[] }
  | { type: 'queryResult'; requestId: number; result: RealmReport | ProvinceReport | CharacterReport | null }
  | ({ type: 'world' } & WorldView)
  | { type: 'saveData'; requestId: number; text: string }
  | { type: 'loaded'; requestId: number; error: string | null };
