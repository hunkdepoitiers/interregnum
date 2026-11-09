import { dayToDate } from './calendar';
import { monthlyCharacters } from './characters';
import { monthlyFaith } from './faith';
import { dailyMilitary } from './military';
import { dailySieges } from './sieges';
import { monthlyWars } from './war';
import { monthlyDiplomacy } from './diplomacy';
import { monthlyAi } from './ai';
import { dailyEvents } from './events';
import { finishBuildings, settleMonth, type EconomyContext, type Notice } from './economy';
import { expireModifiers } from './modifiers';
import type { GameState } from './state';

export interface TickResult {
  day: number;
  monthStart: boolean;
  yearStart: boolean;
  /** Some modifier came or went today. */
  modifiersChanged: boolean;
  /** What realms should hear about (deaths and successions, loans repaid or defaulted, buildings, banks failing). */
  notices: Notice[];
}

/**
 * Advances the simulation by one day. Systems hook in here in the order given in DESIGN.md §4.4. Without an economy
 * context (old tests, tools that only need the calendar) the economy stands still.
 */
export function tick(state: GameState, economy?: EconomyContext): TickResult {
  state.day += 1;
  const date = dayToDate(state.day);
  const monthStart = date.day === 1;
  const before = state.nextModifierId;
  let modifiersChanged = expireModifiers(state);
  let controlChanged = false;
  const notices: Notice[] = [];
  if (economy) {
    const built = finishBuildings(state, economy);
    notices.push(...built.notices);
    const controlBefore = state.armies.length ? state.provinces.map((p) => p.controller) : null;
    notices.push(...dailyMilitary(state, economy, monthStart));
    notices.push(...dailySieges(state, economy, monthStart));
    if (monthStart && state.wars.length) notices.push(...monthlyWars(state, economy));
    if (monthStart) notices.push(...monthlyDiplomacy(state, economy), ...monthlyAi(state, economy));
    const ev = dailyEvents(state, economy);
    notices.push(...ev.notices);
    if (ev.fired) controlChanged = true;
    if (controlBefore && state.provinces.some((p, i) => p.controller !== controlBefore[i])) controlChanged = true;
    if (monthStart) notices.push(...monthlyFaith(state, economy), ...monthlyCharacters(state, economy), ...settleMonth(state, economy));
    modifiersChanged ||= built.changed || state.nextModifierId !== before || controlChanged;
  }
  return { day: state.day, monthStart, yearStart: monthStart && date.month === 1, modifiersChanged, notices };
}
