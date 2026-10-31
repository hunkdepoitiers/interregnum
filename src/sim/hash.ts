import type { GameState } from './state';

/** FNV-1a over the canonical JSON form; used by determinism tests and bug reports. */
export function hashState(state: GameState): string {
  const text = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
