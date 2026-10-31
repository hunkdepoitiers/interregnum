import type { GameState, Speed } from './state';

export type Command =
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'togglePause' };

export function applyCommand(state: GameState, cmd: Command): void {
  switch (cmd.type) {
    case 'setSpeed':
      state.speed = cmd.speed;
      return;
    case 'setPaused':
      state.paused = cmd.paused;
      return;
    case 'togglePause':
      state.paused = !state.paused;
      return;
  }
}
