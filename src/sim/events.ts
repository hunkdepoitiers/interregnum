import type { EventDef, EventOption } from './content';
import type { EconomyContext, Notice } from './economy';
import { nextInt } from './rng';
import { check, run, type Condition } from './script';
import type { GameState } from './state';

/**
 * Events (DESIGN §5.8, M10): dated history, monthly pulses and on-actions. A computer realm picks by weight at once; the
 * player's event stops the clock until it is answered. Every roll's odds are shown before the choice.
 */

const PULSE_DAYS = 30;
const scope = (realm: number) => ({ kind: 'realm' as const, id: realm });
const holds = (state: GameState, realm: number) => {
  const r = state.realms[realm];
  return !!r && state.provinces[r.capital]?.owner === realm;
};
const passes = (state: GameState, ctx: EconomyContext, c: Condition | null, realm: number) => !c || check(state, ctx.content, c, scope(realm));

/** The chance of an option's roll for this realm, basis points; null = no roll. */
export function oddsFor(state: GameState, option: EventOption, realm: number): number | null {
  if (!option.odds) return null;
  const { chance, skill, perPoint } = option.odds;
  const ruler = state.characters[state.courts[realm]?.ruler ?? 0];
  const bonus = skill === null ? 0 : ((ruler?.skills[skill] ?? 10) - 10) * perPoint;
  return Math.max(0, Math.min(10000, chance + bonus));
}

function apply(state: GameState, ctx: EconomyContext, def: EventDef, option: EventOption, realm: number, notices: Notice[]): void {
  run(state, ctx.content, option.actions, scope(realm), def.title);
  const chance = oddsFor(state, option, realm);
  if (chance !== null && option.odds) {
    const won = nextInt(state.rng, 10000) < chance;
    const o = won ? option.odds.success : option.odds.failure;
    run(state, ctx.content, o.actions, scope(realm), def.title);
    notices.push({ realm, text: `${def.title}: ${o.text}` });
  }
}

function fire(state: GameState, ctx: EconomyContext, def: EventDef, realm: number, notices: Notice[]): void {
  if (def.cooldown) state.eventCooldowns[`${def.key}:${realm}`] = state.day + def.cooldown;
  if (realm === state.player) {
    state.pendingEvents.push({ id: state.nextEventId++, key: def.key, realm });
    state.paused = true;
    return;
  }
  const open = def.options.filter((o) => passes(state, ctx, o.when, realm));
  const total = open.reduce((t, o) => t + o.ai, 0);
  if (!open.length) return;
  let roll = total > 0 ? nextInt(state.rng, total) : 0;
  const pick = total > 0 ? open.find((o) => (roll -= o.ai) < 0)! : open[0]!;
  apply(state, ctx, def, pick, realm, notices);
}

/** Every day: history on its date, and a thirtieth of the realms take their monthly pulse. Returns whether any fired. */
export function dailyEvents(state: GameState, ctx: EconomyContext): { notices: Notice[]; fired: boolean } {
  const notices: Notice[] = [];
  let fired = false;
  for (const def of ctx.content.events.list) {
    if (def.day !== null) {
      if (def.day > state.day || state.eventsDone.includes(def.key)) continue;
      state.eventsDone.push(def.key);
      const targets = def.all ? state.realms.filter(Boolean).map((r) => r!.id) : state.realms.filter((r) => r?.key === def.realm).map((r) => r!.id);
      for (const realm of targets) if (holds(state, realm) && passes(state, ctx, def.when, realm)) { fire(state, ctx, def, realm, notices); fired = true; }
    } else if (def.pulse !== null) {
      for (let realm = 1 + (state.day % PULSE_DAYS); realm < state.realms.length; realm += PULSE_DAYS) {
        if (!holds(state, realm) || (state.eventCooldowns[`${def.key}:${realm}`] ?? 0) > state.day) continue;
        if (!passes(state, ctx, def.when, realm) || nextInt(state.rng, 10000) >= def.pulse) continue;
        fire(state, ctx, def, realm, notices);
        fired = true;
      }
    }
  }
  return { notices, fired };
}

/** Something happened to a realm: the events waiting on it may fire. */
export function fireOn(state: GameState, ctx: EconomyContext, on: NonNullable<EventDef['on']>, realm: number, notices: Notice[]): void {
  for (const def of ctx.content.events?.list ?? []) {
    if (def.on !== on || (state.eventCooldowns[`${def.key}:${realm}`] ?? 0) > state.day || !holds(state, realm) || !passes(state, ctx, def.when, realm)) continue;
    if (def.chance < 10000 && nextInt(state.rng, 10000) >= def.chance) continue;
    fire(state, ctx, def, realm, notices);
  }
}

/** The player answers an event. */
export function answerEvent(state: GameState, ctx: EconomyContext, id: number, optionKey: string, notices: Notice[]): boolean {
  const pending = state.pendingEvents.find((p) => p.id === id);
  const def = pending && ctx.content.events.list.find((e) => e.key === pending.key);
  const option = def?.options.find((o) => o.key === optionKey);
  if (!pending || !def || !option || !passes(state, ctx, option.when, pending.realm)) return false;
  state.pendingEvents = state.pendingEvents.filter((p) => p !== pending);
  apply(state, ctx, def, option, pending.realm, notices);
  return true;
}
