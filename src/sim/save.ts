import { startCharacters } from './characters';
import { startFaith } from './faith';
import { startForts } from './sieges';
import { startEconomy, type EconomyContext } from './economy';
import type { Scenario } from './scenario';
import { charactersFromScenario, economyFromScenario, modifiersFromScenario, provincesFromScenario, realmsFromScenario, SAVE_VERSION, type GameState } from './state';

/** Plain-text save envelope. Compression and storage live in src/platform. */
export interface SaveFile {
  format: 'interregnum-save';
  saveVersion: number;
  state: GameState;
}

/** What a migration may need besides the old state, e.g. start-date data for fields older saves lack. */
export interface MigrationContext {
  scenario: Scenario;
  /** Content and trade goods, for steps that must compute money (v4 fills the treasuries). */
  economy?: EconomyContext;
}

type Migration = (state: Record<string, unknown>, ctx: MigrationContext) => Record<string, unknown>;

/** migrations[n] upgrades a version-n state to version n+1. Add one whenever SAVE_VERSION increases. */
export const migrations: Record<number, Migration> = {
  // v2 added realms and province ownership; v1 saves only had the date, so take the start map.
  1: (s, { scenario }) => ({ ...s, realms: realmsFromScenario(scenario), provinces: provincesFromScenario(scenario) }),
  // v3 added modifiers; older saves start with the scenario's.
  2: (s, { scenario }) => {
    const modifiers = modifiersFromScenario(scenario);
    return { ...s, modifiers, nextModifierId: modifiers.length + 1 };
  },
  // v4 added the economy: the start's people and development, and treasuries filled as for a new game.
  3: (s, { scenario, economy }) => {
    const realms = s.realms as unknown[];
    const next = { ...s, ...economyFromScenario(scenario, realms.length, economy?.content.economy.banks.map((b) => b.capital) ?? []) };
    if (economy) startEconomy(next as unknown as GameState, economy);
    return next;
  },
  // v5 added characters: the start's rulers and families, aged from 1314 to the save's date.
  4: (s, { scenario, economy }) => {
    const next = { ...s, ...charactersFromScenario(scenario) };
    if (economy) startCharacters(next as unknown as GameState, economy);
    return next;
  },
  // v6 added prestige and piety: every realm starts as a new game would, by rank, government and ruler.
  5: (s, { economy }) => {
    const realms = s.realms as unknown[];
    const next = { ...s, standing: realms.map((r) => (r ? { prestige: 0, piety: 0, log: [], cooldowns: {}, pilgrimage: null } : null)) };
    if (economy) startFaith(next as unknown as GameState, economy);
    return next;
  },
  // v7 added armies and wars: none yet.
  6: (s) => ({ ...s, armies: [], nextArmyId: 1, wars: [], nextWarId: 1 }),
  // v8 added forts, sieges, companies and war aims; old armies are the realm's own, and old wars conquests.
  7: (s, { economy }) => {
    const armies = (s.armies as Record<string, unknown>[]).map((a) => ({ ...a, company: 0 }));
    const wars = (s.wars as Record<string, unknown>[]).map((w) => ({ ...w, cb: 'conquest', goal: 0, battles: 0, ticking: 0 }));
    const next = { ...s, armies, wars, forts: {}, sieges: [], levyLost: {} };
    if (economy) startForts(next as unknown as GameState, economy);
    return next;
  },
};

export class SaveError extends Error {}

export function serialize(state: GameState): string {
  const file: SaveFile = { format: 'interregnum-save', saveVersion: SAVE_VERSION, state };
  return JSON.stringify(file);
}

export function migrate(
  state: Record<string, unknown>, fromVersion: number, ctx: MigrationContext, table = migrations,
): Record<string, unknown> {
  let s = state;
  for (let v = fromVersion; v < SAVE_VERSION; v++) {
    const step = table[v];
    if (!step) throw new SaveError(`No migration from save version ${v}`);
    s = step(s, ctx);
    s.saveVersion = v + 1;
  }
  return s;
}

export function deserialize(text: string, ctx: MigrationContext): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError('Save file is not valid JSON');
  }
  const file = parsed as Partial<SaveFile>;
  if (file?.format !== 'interregnum-save' || typeof file.saveVersion !== 'number' || typeof file.state !== 'object') {
    throw new SaveError('Not an Interregnum save file');
  }
  if (file.saveVersion > SAVE_VERSION) {
    throw new SaveError(`Save version ${file.saveVersion} is newer than this build (${SAVE_VERSION})`);
  }
  const state = migrate(file.state as unknown as Record<string, unknown>, file.saveVersion, ctx) as unknown as GameState;
  validate(state);
  // Province ids index into the map; a save from a different map would scramble ownership.
  if (state.provinces.length !== ctx.scenario.owner.length) {
    throw new SaveError('This save was made with a different version of the map and cannot be loaded');
  }
  return state;
}

function validate(s: GameState): void {
  const realmCount = Array.isArray(s.realms) ? s.realms.length : 0;
  const realmRef = (id: unknown) => Number.isInteger(id) && (id === 0 || (id as number) < realmCount && s.realms[id as number] != null);
  const ok =
    Number.isInteger(s.day) && s.day >= 0 &&
    Number.isInteger(s.seed) &&
    Array.isArray(s.rng) && s.rng.length === 4 && s.rng.every(Number.isInteger) &&
    [1, 2, 3, 4, 5].includes(s.speed) &&
    typeof s.paused === 'boolean' &&
    Array.isArray(s.realms) && s.realms[0] === null &&
    Array.isArray(s.provinces) &&
    s.provinces.every((p, i) => p?.id === i && realmRef(p.owner) && realmRef(p.controller)) &&
    Array.isArray(s.modifiers) && Number.isInteger(s.nextModifierId) &&
    realmRef(s.player) && Array.isArray(s.pops) && Array.isArray(s.economy) && s.economy[0] === null &&
    s.economy.slice(1).every((e) => Number.isInteger(e?.treasury)) && Array.isArray(s.banks) && Array.isArray(s.loans) &&
    s.loans.every((l) => Number.isInteger(l?.principal) && realmRef(l.realm) && s.banks[l.bank] !== undefined) &&
    Array.isArray(s.construction) && typeof s.buildings === 'object' && s.buildings !== null &&
    Array.isArray(s.characters) && s.characters[0] === null && Array.isArray(s.dynasties) && Array.isArray(s.courts) && Array.isArray(s.standing) && Array.isArray(s.armies) && Array.isArray(s.wars) && Array.isArray(s.sieges) && typeof s.forts === 'object' && s.forts !== null && s.armies.every((a) => realmRef(a?.realm) && a.realm > 0 && s.provinces[a.location] !== undefined && Number.isInteger(a.levies) && Number.isInteger(a.menAtArms)) && s.standing.every((x) => x === null || (Number.isInteger(x.prestige) && Number.isInteger(x.piety))) &&
    s.courts.every((c) => c === null || (Number.isInteger(c.ruler) && Array.isArray(c.council))) &&
    s.modifiers.every((m) =>
      Number.isInteger(m?.id) && m.id < s.nextModifierId && typeof m.def === 'string' && Number.isInteger(m.start) &&
      (m.end === null || Number.isInteger(m.end)) &&
      (m.target?.kind === 'realm' ? realmRef(m.target.id) && m.target.id > 0 : m.target?.kind === 'province' && s.provinces[m.target.id] !== undefined));
  if (!ok) throw new SaveError('Save file is corrupt');
}
