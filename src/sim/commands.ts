import type { Content } from './content';
import { doDeed } from './faith';
import { ensureStanding } from './standing';
import { ensureEconomy, repayLoan, repudiate, setTaxLaw, startBuilding, takeLoan, type EconomyContext, type Notice } from './economy';
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
  | { type: 'setController'; province: number; realm: number }
  /** The realm the human plays (0 = watch). */
  | { type: 'setPlayer'; realm: number }
  | { type: 'setTaxLaw'; realm: number; law: string }
  | { type: 'build'; realm: number; province: number; building: string }
  /** amount in hundredths of a ducat; pledge = province whose revenues stand surety (0 = none). */
  | { type: 'takeLoan'; realm: number; bank: number; amount: number; months: number; pledge: number }
  | { type: 'repayLoan'; realm: number; loan: number }
  /** Refuse every debt. */
  | { type: 'repudiate'; realm: number }
  /** A deed for prestige or piety (data/content/faith.yaml deeds). */
  | { type: 'deed'; realm: number; deed: string };

/**
 * Returns true if ownership, control or modifiers changed. Invalid commands are ignored. Economy commands need the
 * trade goods too (goods) and report what happened in `notices`.
 */
export function applyCommand(state: GameState, cmd: Command, content?: Content, goods: number[] = [], notices: Notice[] = []): boolean {
  const ctx: EconomyContext | null = content ? { content, goods } : null;
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
      ensureEconomy(state);
      ensureStanding(state);
      return true;
    case 'setController': {
      const p = state.provinces[cmd.province];
      if (!p || !p.owner || !state.realms[cmd.realm]) return false;
      p.controller = cmd.realm;
      return true;
    }
    case 'setPlayer':
      if (cmd.realm !== 0 && !state.realms[cmd.realm]) return false;
      state.player = cmd.realm;
      return false;
    case 'setTaxLaw':
      return !!ctx && setTaxLaw(state, ctx, cmd.realm, cmd.law);
    case 'build':
      if (ctx) startBuilding(state, ctx, cmd.realm, cmd.province, cmd.building);
      return false; // the building's modifier arrives when it is finished
    case 'takeLoan':
      return !!ctx && takeLoan(state, ctx, cmd.realm, cmd.bank, cmd.amount, cmd.months, cmd.pledge) && cmd.pledge > 0;
    case 'repayLoan':
      return !!ctx && repayLoan(state, ctx, cmd.realm, cmd.loan);
    case 'repudiate': {
      if (!ctx) return false;
      const n = repudiate(state, ctx, cmd.realm);
      notices.push(...n);
      return n.length > 0;
    }
    case 'deed': {
      if (!ctx) return false;
      const before = state.nextModifierId + state.modifiers.length;
      notices.push(...doDeed(state, ctx, cmd.realm, cmd.deed));
      return state.nextModifierId + state.modifiers.length !== before;
    }
  }
}

function validTarget(state: GameState, t: ModifierTarget): boolean {
  return t.kind === 'realm' ? t.id > 0 && !!state.realms[t.id] : t.id > 0 && !!state.provinces[t.id];
}
