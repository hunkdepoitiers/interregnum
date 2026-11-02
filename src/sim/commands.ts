import type { Content } from './content';
import { addModifier, removeModifiers, type ModifierTarget } from './modifiers';
import type { GameState, Realm, Speed } from './state';

export type Command =
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'togglePause' }
  /** Debug and map editor: transfer a province (realm 0 = unowned); control follows ownership. */
  | { type: 'setOwner'; province: number; realm: number }
  /** Map editor: a new realm, given the next free id. */
  | { type: 'addRealm'; realm: Omit<Realm, 'id'> }
  /** Debug console: add a modifier by key, or remove every copy of it from the target. */
  | { type: 'addModifier'; def: string; target: ModifierTarget }
  | { type: 'removeModifier'; def: string; target: ModifierTarget }
  /** Debug: occupy a province (realm = its owner ends the occupation). */
  | { type: 'setController'; province: number; realm: number };

/** Returns true if ownership, control or modifiers changed. Invalid commands are ignored. */
export function applyCommand(state: GameState, cmd: Command, content?: Content): boolean {
  switch (cmd.type) {
    case 'setSpeed':
      state.speed = cmd.speed;
      return false;
    case 'setPaused':
      state.paused = cmd.paused;
      return false;
    case 'togglePause':
      state.paused = !state.paused;
      return false;
    case 'setOwner': {
      const p = state.provinces[cmd.province];
      if (!p || cmd.province === 0 || (cmd.realm !== 0 && !state.realms[cmd.realm])) return false;
      p.owner = cmd.realm;
      p.controller = cmd.realm;
      return true;
    }
    case 'addModifier': {
      if (!content || !validTarget(state, cmd.target)) return false;
      return addModifier(state, content, cmd.def, cmd.target) !== null;
    }
    case 'removeModifier':
      return removeModifiers(state, cmd.def, cmd.target) > 0;
    case 'addRealm':
      state.realms.push({ ...cmd.realm, id: state.realms.length });
      return true;
    case 'setController': {
      const p = state.provinces[cmd.province];
      if (!p || !p.owner || !state.realms[cmd.realm]) return false;
      p.controller = cmd.realm;
      return true;
    }
  }
}

function validTarget(state: GameState, t: ModifierTarget): boolean {
  return t.kind === 'realm' ? t.id > 0 && !!state.realms[t.id] : t.id > 0 && !!state.provinces[t.id];
}
