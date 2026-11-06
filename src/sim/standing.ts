import type { Content, Standing } from './content';
import { addModifier, hasModifier, removeModifiers } from './modifiers';
import type { GameState, RealmStanding } from './state';

/** Deeds kept in a realm's record. */
const LOG_LENGTH = 16;
/** Repeats of the same deed within this many days merge into one line (a treasury empty month after month). */
const MERGE_DAYS = 62;

export function emptyStanding(): RealmStanding {
  return { prestige: 0, piety: 0, log: [], cooldowns: {}, pilgrimage: null };
}

/** Gives realms added since the game started (the map editor) a standing. */
export function ensureStanding(state: GameState): void {
  state.standing ??= [null];
  while (state.standing.length < state.realms.length) state.standing.push(state.realms[state.standing.length] ? emptyStanding() : null);
}

/** Index of the tier a value falls in: the last whose min it reaches. */
export function tierOf(tiers: { min: number }[], value: number): number {
  let t = 0;
  for (let i = 0; i < tiers.length; i++) if (value >= tiers[i]!.min) t = i;
  return t;
}

/** Puts the realm's current prestige and piety tier modifiers on it, and takes off the others. */
export function refreshTiers(state: GameState, content: Content, realm: number): void {
  const s = state.standing[realm];
  if (!s) return;
  const target = { kind: 'realm' as const, id: realm };
  const f = content.faith;
  for (const [tiers, value] of [[f.prestigeTiers, s.prestige], [f.pietyTiers, s.piety]] as const) {
    const want = tiers[tierOf(tiers, value)]!.modifier;
    for (const t of tiers) if (t.modifier && t.modifier !== want) removeModifiers(state, t.modifier, target);
    if (want && !hasModifier(state, want, target)) addModifier(state, content, want, target);
  }
}

/**
 * Adds prestige and piety (either may be negative) for a deed, records it under `label` and moves the realm's tiers.
 * The only way the two currencies change.
 */
export function changeStanding(state: GameState, content: Content, realm: number, delta: Partial<Standing>, label: string): void {
  ensureStanding(state);
  const s = state.standing[realm];
  const prestige = delta.prestige ?? 0;
  const piety = delta.piety ?? 0;
  if (!s || (!prestige && !piety)) return;
  s.prestige += prestige;
  s.piety += piety;
  const last = s.log[s.log.length - 1];
  if (last && last.label === label && state.day - last.day <= MERGE_DAYS) {
    last.prestige += prestige;
    last.piety += piety;
    last.day = state.day;
  } else {
    s.log.push({ day: state.day, label, prestige, piety });
    if (s.log.length > LOG_LENGTH) s.log.shift();
  }
  refreshTiers(state, content, realm);
}
