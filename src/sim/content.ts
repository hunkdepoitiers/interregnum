import type { Action, Condition } from './script';

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

/** Armies (data/content/military.yaml). Money in hundredths of a ducat; percentages as whole percent. */
export interface MilitaryDef {
  levy: { name: string; description: string; strength: number; wage: number; lateWage: number; serviceDays: number };
  menAtArms: { name: string; description: string; strength: number; wage: number; cost: number };
  /** Hundredths of a percent of the people, at a levy size of 100%: men = people × levy_size × levyShare / 10^8. */
  levyShare: number;
  menAtArmsPerThousandLevies: number;
  musterDays: number;
  terrainDefence: Record<string, number>;
  attrition: number;
  attritionMax: number;
  hostileSupply: number;
  homeSupply: number;
  casualties: number;
  moraleLoss: number;
  moraleRegain: number;
  warcraftStrength: number;
  occupyDays: number;
  occupyMin: number;
}

/** No armies to speak of: for content built without data/content/military.yaml. */
export function emptyMilitary(): MilitaryDef {
  return {
    levy: { name: 'Levies', description: '', strength: 100, wage: 0, lateWage: 0, serviceDays: 120 },
    menAtArms: { name: 'Men-at-arms', description: '', strength: 300, wage: 0, cost: 0 },
    levyShare: 0, menAtArmsPerThousandLevies: 0, musterDays: 0, terrainDefence: {}, attrition: 0, attritionMax: 0, hostileSupply: 100, homeSupply: 100,
    casualties: 15, moraleLoss: 400, moraleRegain: 25, warcraftStrength: 0, occupyDays: 30, occupyMin: 5,
  };
}

export interface CompanyDef { key: string; name: string; description: string; men: number; cost: number; wage: number; strength: number }
export interface CasusBelliDef { key: string; name: string; description: string; prestige: number; piety: number; winPrestige: number; winPiety: number; minPiety: number; governments: string[] }

/** Forts, sieges, companies, casus belli, war score and peace (data/content/war.yaml). Chances in basis points. */
export interface WarDef {
  forts: {
    capital: Record<'empire' | 'kingdom' | 'duchy' | 'county', number>; development: number[][]; tradeCentre: number; maxLevel: number;
    garrisonPerLevel: number; supplyBase: number; supplyPerLevel: number; capturedGarrison: number; refill: number; castleBuilding: string;
  };
  siege: {
    progress: number; menMin: number; menMax: number; warcraft: number; engineerBonus: number; maxEngineers: number; engineerCost: number;
    starvingProgress: number; starvingLoss: number; prestige: number; eventChance: number;
    events: Record<'disease' | 'sally' | 'breach' | 'stores_lost' | 'traitor', { weight: number; text: string }>;
    diseaseLoss: number; sallyLoss: number; sallyGarrisonLoss: number; breachProgress: number; storesLostDays: number; traitorStores: number;
  };
  assault: { base: number; perProgress: number; breach: number; perRatio: number; ratioCap: number; perLevel: number; min: number; max: number; lossesWon: number; lossesLost: number; garrisonLost: number; moraleLost: number; cooldown: number };
  bribe: { cost: number; chances: number[]; unpaidBonus: number; perEminence: number; perLevel: number; cooldown: number };
  desertion: { share: number; morale: number };
  /** Share (%) of the full levy pool that returns each month after losses. */
  levyRecovery: number;
  battlePrestigeMen: number;
  companies: CompanyDef[];
  casusBelli: CasusBelliDef[];
  raidLoot: number;
  score: { battleCap: number; battleMen: number; battleMax: number; tickingCap: number; ticking: number };
  peace: { land: number; indemnityPerMonth: number; indemnityMonths: number[]; winPrestige: number; losePrestige: number; aiScore: number; aiDays: number; aiWhite: number; concede: number };
}

/** No forts, companies or reasons for war beyond conquest: for content built without data/content/war.yaml. */
export function emptyWar(): WarDef {
  const ev = { weight: 0, text: '' };
  return {
    forts: { capital: { empire: 0, kingdom: 0, duchy: 0, county: 0 }, development: [], tradeCentre: 0, maxLevel: 5, garrisonPerLevel: 500, supplyBase: 90, supplyPerLevel: 30, capturedGarrison: 25, refill: 20, castleBuilding: 'castle' },
    siege: { progress: 166, menMin: 50, menMax: 150, warcraft: 0, engineerBonus: 25, maxEngineers: 3, engineerCost: 15000, starvingProgress: 200, starvingLoss: 2, prestige: 0, eventChance: 0, events: { disease: ev, sally: ev, breach: ev, stores_lost: ev, traitor: ev }, diseaseLoss: 2, sallyLoss: 1, sallyGarrisonLoss: 3, breachProgress: 1500, storesLostDays: 15, traitorStores: 30 },
    assault: { base: 1000, perProgress: 50, breach: 2000, perRatio: 300, ratioCap: 2000, perLevel: 500, min: 500, max: 9500, lossesWon: 2, lossesLost: 4, garrisonLost: 30, moraleLost: 25, cooldown: 30 },
    bribe: { cost: 20000, chances: [1500, 3000, 4500], unpaidBonus: 1500, perEminence: 150, perLevel: 200, cooldown: 60 },
    desertion: { share: 0, morale: 0 }, levyRecovery: 3, battlePrestigeMen: 1000, companies: [],
    casusBelli: [{ key: 'conquest', name: 'Conquest', description: '', prestige: 0, piety: 0, winPrestige: 0, winPiety: 0, minPiety: -1000000, governments: [] }], raidLoot: 0,
    score: { battleCap: 40, battleMen: 2000, battleMax: 8, tickingCap: 25, ticking: 1 },
    peace: { land: 150, indemnityPerMonth: 3, indemnityMonths: [3, 6, 12], winPrestige: 0, losePrestige: 0, aiScore: 50, aiDays: 1095, aiWhite: 10, concede: 80 },
  };
}

export interface TimelineEntry { day: number; type: 'tribute' | 'invasion'; from: number; to: number; share: number; days: number; men: number; spawn: number }
export interface ContractDef { key: string; name: string; description: string; dues: number; opinion: number; joinsWars: boolean }

/** Opinion, pacts, vassals and the scripted powers (data/content/diplomacy.yaml). Opinion in whole points. */
export interface DiplomacyDef {
  opinion: { sameFaith: number; sameFamily: number; otherFamily: number; sameCultureGroup: number; alliance: number; marriage: number; truce: number; atWar: number; paysTribute: number };
  alliance: { minOpinion: number; breakPrestige: number; callOpinion: number };
  marriage: { minOpinion: number; age: number; warPrestige: number; callOpinion: number };
  truceDays: number;
  gift: { cost: number; costMonths: number; opinion: number; days: number; perEminence: number; cooldown: number };
  tributeDemand: { share: number; days: number; power: number; opinion: number };
  peaceTribute: { share: number; days: number; cost: number };
  startAlliances: number[][];
  vassals: { base: number; legitimacy: number; prestigeTier: number; unpaid: number; contractChange: number; contracts: ContractDef[] };
  factions: { joinBelow: number; revoltPower: number; revoltDays: number };
  replyDays: number;
  timeline: TimelineEntry[];
}

/** Customary contracts and nothing else: for content built without data/content/diplomacy.yaml. */
export function emptyDiplomacy(): DiplomacyDef {
  return {
    opinion: { sameFaith: 0, sameFamily: 0, otherFamily: 0, sameCultureGroup: 0, alliance: 30, marriage: 20, truce: -10, atWar: -50, paysTribute: -20 },
    alliance: { minOpinion: 25, breakPrestige: -20, callOpinion: 20 }, marriage: { minOpinion: 0, age: 16, warPrestige: -25, callOpinion: 25 }, truceDays: 1826,
    gift: { cost: 20000, costMonths: 0, opinion: 25, days: 1825, perEminence: 0, cooldown: 365 }, tributeDemand: { share: 10, days: 1826, power: 300, opinion: -30 },
    peaceTribute: { share: 15, days: 1826, cost: 20 }, startAlliances: [],
    vassals: { base: 10, legitimacy: 0, prestigeTier: 0, unpaid: -40, contractChange: -10, contracts: [{ key: 'normal', name: 'Customary', description: '', dues: 100, opinion: 0, joinsWars: true }] },
    factions: { joinBelow: -10, revoltPower: 30, revoltDays: 180 }, replyDays: 60, timeline: [],
  };
}

export interface EventOutcome { text: string; actions: Action[] }
export interface EventOption {
  key: string; label: string; ai: number; when: Condition | null; actions: Action[];
  /** Rolled when chosen. skill: 0 eminence, 1 statecraft, 2 warcraft, or null. */
  odds: { chance: number; skill: number | null; perPoint: number; success: EventOutcome; failure: EventOutcome } | null;
}
export interface EventDef {
  key: string; title: string; text: string;
  /** Dated: the day, and realm key or all realms. */
  day: number | null; realm: string | null; all: boolean;
  /** Monthly chance in basis points. */
  pulse: number | null;
  on: 'ruler_death' | 'siege_won' | 'battle_won' | 'war_declared' | null;
  chance: number; cooldown: number; when: Condition | null; options: EventOption[];
}
/** data/content/events.yaml. */
export interface EventsDef { places: Record<string, number>; regions: Record<string, number[]>; list: EventDef[] }
export function emptyEvents(): EventsDef { return { places: {}, regions: {}, list: [] }; }

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
  military: MilitaryDef;
  war: WarDef;
  diplomacy: DiplomacyDef;
  events: EventsDef;
}
