import type { Command } from '../sim/commands';
import type { Speed } from '../sim/state';

export type ToWorker =
  | { type: 'newGame'; seed: number }
  | { type: 'command'; cmd: Command }
  | { type: 'requestSave'; requestId: number }
  | { type: 'load'; requestId: number; text: string };

export type FromWorker =
  | { type: 'status'; day: number; speed: Speed; paused: boolean }
  | { type: 'saveData'; requestId: number; text: string }
  | { type: 'loaded'; requestId: number; error: string | null };
