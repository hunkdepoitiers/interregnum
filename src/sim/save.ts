import type { Scenario } from './scenario';
import { provincesFromScenario, realmsFromScenario, SAVE_VERSION, type GameState } from './state';

/** Plain-text save envelope. Compression and storage live in src/platform. */
export interface SaveFile {
  format: 'interregnum-save';
  saveVersion: number;
  state: GameState;
}

/** What a migration may need besides the old state, e.g. start-date data for fields older saves lack. */
export interface MigrationContext {
  scenario: Scenario;
}

type Migration = (state: Record<string, unknown>, ctx: MigrationContext) => Record<string, unknown>;

/** migrations[n] upgrades a version-n state to version n+1. Add one whenever SAVE_VERSION increases. */
export const migrations: Record<number, Migration> = {
  // v2 added realms and province ownership; v1 saves only had the date, so take the start map.
  1: (s, { scenario }) => ({ ...s, realms: realmsFromScenario(scenario), provinces: provincesFromScenario(scenario) }),
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
    s.provinces.every((p, i) => p?.id === i && realmRef(p.owner) && realmRef(p.controller));
  if (!ok) throw new SaveError('Save file is corrupt');
}
