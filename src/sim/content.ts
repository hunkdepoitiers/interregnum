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
  /** Hundredths of a ducat per unit of trade. */
  price: number;
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

/** Population strata; per-province pops are stored in this order. */
export const STRATA = ['peasants', 'burghers', 'nobles', 'clergy', 'nomads'] as const;
export type Stratum = (typeof STRATA)[number];

export interface LawOption {
  key: string;
  name: string;
  description: string;
  /** Modifier the law puts on the realm; null = none. */
  modifier: string | null;
}

export interface BuildingDef {
  key: string;
  name: string;
  description: string;
  /** Hundredths of a ducat, paid when building starts. */
  cost: number;
  days: number;
  /** Hundredths of a ducat a month. */
  upkeep: number;
  /** Modifier the finished building puts on its province. */
  modifier: string;
}

export interface BankDef {
  key: string;
  name: string;
  /** Province of its seat; 0 = none (local moneylenders). */
  seat: number;
  /** Hundredths of a ducat it can lend at the start. */
  capital: number;
  /** Yearly base interest in hundredths of a percent (7% = 700). */
  rate: number;
  /** 0-100: lends down to a credit rating of 100 - risk. */
  risk: number;
  /** Lends to anyone, little and dear. */
  local: boolean;
}

/**
 * The economy's constants (data/content/economy.yaml). Money in hundredths of a ducat, per-head wealth in
 * ten-thousandths, percentages in hundredths of a percent like the stats (10% = 1000).
 */
export interface EconomyDef {
  /** Per stratum (STRATA order), ten-thousandths of a ducat per person per month. */
  wealthPerHead: number[];
  /** Wealth × (devBase + devPerPoint × development) / 100, both in hundredths. */
  devBase: number;
  devPerPoint: number;
  tithe: number;
  /** Hundredths: trade value = price × people / 1000 × this / 100 × production. */
  tradePerThousand: number;
  vassalDues: number;
  court: Record<'empire' | 'kingdom' | 'duchy' | 'county', number>;
  adminPerProvince: number;
  retinuePerThousand: number;
  /** Monthly growth, hundredths of a percent. */
  growth: number;
  startTreasuryMonths: number;
  /** Share of a positive treasury spent each month, hundredths of a percent. */
  largesse: number;
  taxLaws: LawOption[];
  lawCooldownDays: number;
  buildings: BuildingDef[];
  banks: BankDef[];
  credit: {
    base: number;
    /** Hundredths of a ducat of yearly net income per rating point. */
    incomePerPoint: number;
    incomeCap: number;
    debtRatioPenalty: number;
    defaultPenalty: number;
    defaultMemoryDays: number;
    rateSpread: number;
    terms: number[];
  };
}

export interface TraitDef {
  key: string;
  name: string;
  description: string;
  /** Added to [eminence, statecraft, warcraft]. */
  skills: number[];
  health: number;
  /** Chance (%) a child of a bearer has it too; 0 = not inherited. */
  congenital: number;
  /** Share (%) of generated characters with it. */
  chance: number;
  /** Modifier on the realm while the bearer rules (trait_<key>); null = none. */
  rulerModifier: string | null;
}

export interface SuccessionLawDef {
  key: string;
  name: string;
  description: string;
}

/** Characters' constants (data/content/characters.yaml, names.yaml). */
export interface CharactersDef {
  /** Skill points above this raise a ruler's or councillor's modifiers; below, lower them. */
  pivot: number;
  /** Council seats in order: the skill (0 eminence, 1 statecraft, 2 warcraft) and the modifier it scales. */
  council: { role: string; skill: number; modifier: string }[];
  /** Monthly salary per councillor, hundredths of a ducat. */
  salary: number;
  education: { start: number; end: number; perTier: number; bonus: number[] };
  variance: number;
  majority: number;
  /** [age, monthly chance of death in basis points], by age from. */
  mortality: number[][];
  fertility: { chance: number; lateChance: number; from: number; late: number; until: number };
  marriage: { chance: number; age: number };
  healthBase: number;
  laws: SuccessionLawDef[];
  governmentLaws: Record<string, string>;
  traits: TraitDef[];
  /** Given names by tradition; culture group → tradition; Indo-Aryan Muslims and the like take an override. */
  names: Record<string, { male: string[]; female: string[] }>;
  nameGroups: Record<string, string>;
  nameOverrides: { group: string; family: string; tradition: string }[];
}

/** An economy where nothing costs or pays anything: for content built without data/content/economy.yaml. */
export function emptyEconomy(): EconomyDef {
  return {
    wealthPerHead: [0, 0, 0, 0, 0], devBase: 100, devPerPoint: 0, tithe: 0, tradePerThousand: 0, vassalDues: 0,
    court: { empire: 0, kingdom: 0, duchy: 0, county: 0 }, adminPerProvince: 0, retinuePerThousand: 0, growth: 0,
    startTreasuryMonths: 0, largesse: 0, taxLaws: [{ key: 'normal', name: 'Customary taxes', description: '', modifier: null }],
    lawCooldownDays: 365, buildings: [], banks: [],
    credit: { base: 50, incomePerPoint: 100000, incomeCap: 25, debtRatioPenalty: 30, defaultPenalty: 35, defaultMemoryDays: 7300, rateSpread: 5, terms: [12] },
  };
}

/** Characters that never die, marry or rule anything: for content built without data/content/characters.yaml. */
export function emptyCharacters(): CharactersDef {
  return {
    pivot: 10, council: [], salary: 0, education: { start: 6, end: 16, perTier: 7, bonus: [0, 1, 3, 5] }, variance: 0, majority: 16,
    mortality: [[0, 0]], fertility: { chance: 0, lateChance: 0, from: 16, late: 35, until: 43 }, marriage: { chance: 0, age: 16 },
    healthBase: 70, laws: [{ key: 'cognatic', name: 'Primogeniture', description: '' }], governmentLaws: {}, traits: [],
    names: { generic: { male: ['John'], female: ['Joan'] } }, nameGroups: {}, nameOverrides: [],
  };
}

/** A deed a ruler may do for prestige or piety. Costs in hundredths of a ducat. */
export interface DeedDef {
  key: string;
  name: string;
  description: string;
  /** Fixed cost, plus `costMonths` months of the realm's gross income; never under `minCost`. */
  cost: number;
  costMonths: number;
  minCost: number;
  /** Months of gross income the deed brings in (seizing church lands). */
  incomeMonths: number;
  prestige: number;
  piety: number;
  /** Days before it may be done again; 0 = any time. */
  cooldown: number;
  /** Days it takes (a pilgrimage); 0 = at once. */
  days: number;
  modifier: string | null;
}

export interface Standing {
  prestige: number;
  piety: number;
}

/**
 * Faiths, prestige and piety (data/content/faith.yaml). Prestige and piety are whole points. Tiers are sorted by
 * `min`; a realm is in the last tier whose min it reaches.
 */
export interface FaithDef {
  prestigeTiers: { min: number; name: string; modifier: string | null }[];
  pietyTiers: { min: number; modifier: string | null }[];
  /** Piety tier names by religion family; `christian` is the fallback. */
  pietyNames: Record<string, string[]>;
  start: { prestige: Record<'empire' | 'kingdom' | 'duchy' | 'county', number>; piety: number; pietyGovernment: Record<string, number>; piousTrait: number };
  /** Piety a month per holy site held, while below the top piety tier. */
  holySitePiety: number;
  /** By religion id - 1: the head of faith (realm id, 0 = none) and the holy sites. */
  faiths: { head: number; holySites: { name: string; province: number }[] }[];
  deeds: Record<string, DeedDef>;
  /** Extra monthly chance of death in basis points while on pilgrimage. */
  pilgrimageRisk: number;
  events: { default: Standing; emptyTreasury: Standing; dynastyChangeKeep: number };
  /** Religion id whose head may excommunicate; 0 = none. */
  excommunication: { religion: number; below: number; chance: number; prestige: number; modifier: string; vacancy: string | null };
  /** Standing gained on finishing a building, by building key. */
  buildings: Record<string, Standing>;
}

/** Faith with no tiers, sites or deeds: for content built without data/content/faith.yaml. */
export function emptyFaith(): FaithDef {
  return {
    prestigeTiers: [{ min: -1000000, name: 'Known', modifier: null }], pietyTiers: [{ min: -1000000, modifier: null }],
    pietyNames: { christian: ['Faithful'] }, start: { prestige: { empire: 0, kingdom: 0, duchy: 0, county: 0 }, piety: 0, pietyGovernment: {}, piousTrait: 0 },
    holySitePiety: 0, faiths: [], deeds: {}, pilgrimageRisk: 0,
    events: { default: { prestige: 0, piety: 0 }, emptyTreasury: { prestige: 0, piety: 0 }, dynastyChangeKeep: 100 },
    excommunication: { religion: 0, below: 0, chance: 0, prestige: 0, modifier: '', vacancy: null }, buildings: {},
  };
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
  economy: EconomyDef;
  characters: CharactersDef;
  faith: FaithDef;
}
