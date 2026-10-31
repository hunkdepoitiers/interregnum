import { createRng, type RngState } from './rng';

export const SAVE_VERSION = 1;

/** Speed 1 (slowest) .. 5 (as fast as possible). */
export type Speed = 1 | 2 | 3 | 4 | 5;

export interface GameState {
  saveVersion: number;
  seed: number;
  rng: RngState;
  /** Days since 27 July 1302. */
  day: number;
  speed: Speed;
  paused: boolean;
}

export function newGame(seed: number): GameState {
  return { saveVersion: SAVE_VERSION, seed: seed >>> 0, rng: createRng(seed), day: 0, speed: 2, paused: true };
}
