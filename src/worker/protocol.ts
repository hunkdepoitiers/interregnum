import type { Command } from '../sim/commands';
import type { Content } from '../sim/content';
import type { Modifier } from '../sim/modifiers';
import type { Scenario } from '../sim/scenario';
import type { Realm, Speed } from '../sim/state';

export type ToWorker =
  | { type: 'init'; seed: number; scenario: Scenario; content: Content }
  | { type: 'command'; cmd: Command }
  | { type: 'requestSave'; requestId: number }
  | { type: 'load'; requestId: number; text: string };

/** Political state the map and panels need; sent whenever ownership, control or modifiers may have changed. */
export interface WorldView {
  realms: (Realm | null)[];
  /** Indexed by province id. */
  owner: Uint16Array;
  controller: Uint16Array;
  modifiers: Modifier[];
}

export type FromWorker =
  | { type: 'status'; day: number; speed: Speed; paused: boolean }
  | ({ type: 'world' } & WorldView)
  | { type: 'saveData'; requestId: number; text: string }
  | { type: 'loaded'; requestId: number; error: string | null };
