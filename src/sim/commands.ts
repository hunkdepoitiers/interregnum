import type { GameState, Realm, Speed } from './state';

export type Command =
  | { type: 'setSpeed'; speed: Speed }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'togglePause' }
  /** Debug and map editor: transfer a province (realm 0 = unowned); control follows ownership. */
  | { type: 'setOwner'; province: number; realm: number }
  /** Map editor: a new realm, given the next free id. */
  | { type: 'addRealm'; realm: Omit<Realm, 'id'> }
  /** Debug: occupy a province (realm = its owner ends the occupation). */
  | { type: 'setController'; province: number; realm: number };

/** Returns true if the map's ownership or control changed. Invalid commands are ignored. */
export function applyCommand(state: GameState, cmd: Command): boolean {
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
