import type { Content } from './content';
import { addModifier, hasModifier, removeModifiers, statValue, type ModifierTarget } from './modifiers';
import type { GameState } from './state';

/**
 * The small, typed language decisions, laws, buildings and events are written in (in YAML, validated by
 * src/content/script.ts). Kept deliberately small: conditions read the state, actions change it, `owner` moves
 * from a province to the realm that owns it. Numbers are compiled to fixed-point hundredths like stats.
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { has_modifier: string }
  | { stat_at_least: { stat: string; value: number } }
  | { stat_below: { stat: string; value: number } }
  | { owner: Condition };

export type Action =
  | { add_modifier: string }
  | { remove_modifier: string }
  | { owner: Action[] };

/** The realm that owns a province scope (null if unowned); a realm scope is its own owner. */
function ownerScope(state: GameState, scope: ModifierTarget): ModifierTarget | null {
  if (scope.kind === 'realm') return scope;
  const owner = state.provinces[scope.id]?.owner ?? 0;
  return owner ? { kind: 'realm', id: owner } : null;
}

export function check(state: GameState, content: Content, cond: Condition, scope: ModifierTarget): boolean {
  if ('all' in cond) return cond.all.every((c) => check(state, content, c, scope));
  if ('any' in cond) return cond.any.some((c) => check(state, content, c, scope));
  if ('not' in cond) return !check(state, content, cond.not, scope);
  if ('has_modifier' in cond) return hasModifier(state, cond.has_modifier, scope);
  if ('stat_at_least' in cond) return statValue(state, content, cond.stat_at_least.stat, scope) >= cond.stat_at_least.value;
  if ('stat_below' in cond) return statValue(state, content, cond.stat_below.stat, scope) < cond.stat_below.value;
  const owner = ownerScope(state, scope);
  return owner !== null && check(state, content, cond.owner, owner);
}

export function run(state: GameState, content: Content, actions: Action[], scope: ModifierTarget): void {
  for (const a of actions) {
    if ('add_modifier' in a) addModifier(state, content, a.add_modifier, scope);
    else if ('remove_modifier' in a) removeModifiers(state, a.remove_modifier, scope);
    else {
      const owner = ownerScope(state, scope);
      if (owner) run(state, content, a.owner, owner);
    }
  }
}
