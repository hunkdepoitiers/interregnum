import { SAVE_VERSION, type GameState } from './state';

/** Plain-text save envelope. Compression and storage live in src/platform. */
export interface SaveFile {
  format: 'interregnum-save';
  saveVersion: number;
  state: GameState;
}

type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a version-n state to version n+1. Add one whenever SAVE_VERSION increases. */
export const migrations: Record<number, Migration> = {};

export class SaveError extends Error {}

export function serialize(state: GameState): string {
  const file: SaveFile = { format: 'interregnum-save', saveVersion: SAVE_VERSION, state };
  return JSON.stringify(file);
}

export function migrate(state: Record<string, unknown>, fromVersion: number, table = migrations): Record<string, unknown> {
  let s = state;
  for (let v = fromVersion; v < SAVE_VERSION; v++) {
    const step = table[v];
    if (!step) throw new SaveError(`No migration from save version ${v}`);
    s = step(s);
    s.saveVersion = v + 1;
  }
  return s;
}

export function deserialize(text: string): GameState {
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
  const state = migrate(file.state as unknown as Record<string, unknown>, file.saveVersion) as unknown as GameState;
  validate(state);
  return state;
}

function validate(s: GameState): void {
  const ok =
    Number.isInteger(s.day) && s.day >= 0 &&
    Number.isInteger(s.seed) &&
    Array.isArray(s.rng) && s.rng.length === 4 && s.rng.every(Number.isInteger) &&
    [1, 2, 3, 4, 5].includes(s.speed) &&
    typeof s.paused === 'boolean';
  if (!ok) throw new SaveError('Save file is corrupt');
}
