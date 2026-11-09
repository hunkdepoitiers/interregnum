import type { Content } from './content';
import { add } from './economy';
import { changeStanding } from './standing';
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
  | { owner: Condition }
  | { realm_is: string } | { ruler_is: string } | { religion_is: string } | { family_is: string }
  | { in_region: string } | { holds: string } | { realm_holds: { realm: string; place: string } } | { at_war: boolean }
  | { treasury_at_least: number } | { prestige_at_least: number } | { piety_at_least: number } | { ruler_trait: string };

export type Action =
  | { add_modifier: string }
  | { remove_modifier: string }
  | { owner: Action[] }
  /** Whole ducats, positive or negative. */
  | { add_gold: number }
  | { add_prestige: number }
  | { add_piety: number }
  | { kill_ruler: true }
  /** The scope realm takes this place (Content.events.places). */
  | { take_place: string }
  /** Runs the actions on every province of the region that the scope realm owns. */
  | { region: { key: string; actions: Action[] } }
  | { on_realm: { realm: string; actions: Action[] } };

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
  if (owner === null) return false;
  if ('owner' in cond) return check(state, content, cond.owner, owner);
  const realm = owner.id;
  const ruler = state.characters[state.courts[realm]?.ruler ?? 0];
  const faith = content.religions[(ruler?.religion ?? 0) - 1];
  const places = content.events?.places ?? {};
  if ('realm_is' in cond) return state.realms[realm]?.key === cond.realm_is;
  if ('ruler_is' in cond) return ruler?.name === cond.ruler_is;
  if ('religion_is' in cond) return faith?.key === cond.religion_is;
  if ('family_is' in cond) return faith?.family === cond.family_is;
  if ('in_region' in cond) return (content.events?.regions[cond.in_region] ?? []).some((p) => state.provinces[p]?.owner === realm);
  if ('holds' in cond) return state.provinces[places[cond.holds] ?? 0]?.owner === realm;
  if ('realm_holds' in cond) return state.realms[state.provinces[places[cond.realm_holds.place] ?? 0]?.owner ?? 0]?.key === cond.realm_holds.realm;
  if ('at_war' in cond) return state.wars.some((w) => w.attackers.includes(realm) || w.defenders.includes(realm)) === cond.at_war;
  if ('treasury_at_least' in cond) return (state.economy[realm]?.treasury ?? 0) >= cond.treasury_at_least * 100;
  if ('prestige_at_least' in cond) return (state.standing[realm]?.prestige ?? 0) >= cond.prestige_at_least;
  if ('piety_at_least' in cond) return (state.standing[realm]?.piety ?? 0) >= cond.piety_at_least;
  return !!ruler?.traits.includes(cond.ruler_trait);
}

export function run(state: GameState, content: Content, actions: Action[], scope: ModifierTarget, label = 'An event'): void {
  for (const a of actions) {
    if ('add_modifier' in a) addModifier(state, content, a.add_modifier, scope);
    else if ('remove_modifier' in a) removeModifiers(state, a.remove_modifier, scope);
    else if ('owner' in a) {
      const owner = ownerScope(state, scope);
      if (owner) run(state, content, a.owner, owner, label);
    } else runRealmAction(state, content, a, scope, label);
  }
}

function runRealmAction(state: GameState, content: Content, a: Exclude<Action, { add_modifier: string } | { remove_modifier: string } | { owner: Action[] }>, scope: ModifierTarget, label: string): void {
  const owner = ownerScope(state, scope);
  if (!owner) return;
  const realm = owner.id;
  if ('add_gold' in a) {
    const ec = state.economy[realm];
    if (ec) { ec.treasury += a.add_gold * 100; add(ec.oneOff, 'events', a.add_gold * 100); }
  } else if ('add_prestige' in a) changeStanding(state, content, realm, { prestige: a.add_prestige }, label);
  else if ('add_piety' in a) changeStanding(state, content, realm, { piety: a.add_piety }, label);
  else if ('kill_ruler' in a) {
    const ruler = state.characters[state.courts[realm]?.ruler ?? 0];
    if (ruler && ruler.died === null) ruler.died = state.day;
  } else if ('take_place' in a) {
    const p = state.provinces[content.events.places[a.take_place] ?? 0];
    if (p && p.owner !== realm && state.realms[p.owner]?.capital !== p.id) { p.owner = realm; p.controller = realm; }
  } else if ('region' in a) {
    for (const id of content.events.regions[a.region.key] ?? []) if (state.provinces[id]?.owner === realm) run(state, content, a.region.actions, { kind: 'province', id }, label);
  } else {
    const other = state.realms.find((r) => r?.key === a.on_realm.realm);
    if (other) run(state, content, a.on_realm.actions, { kind: 'realm', id: other.id }, label);
  }
}
