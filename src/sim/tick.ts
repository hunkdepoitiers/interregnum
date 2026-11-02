import { dayToDate } from './calendar';
import { expireModifiers } from './modifiers';
import type { GameState } from './state';

export interface TickResult {
  day: number;
  monthStart: boolean;
  yearStart: boolean;
  /** Some modifier ran out today. */
  modifiersChanged: boolean;
}

/** Advances the simulation by one day. Systems hook in here in the order given in DESIGN.md §4.4. */
export function tick(state: GameState): TickResult {
  state.day += 1;
  const date = dayToDate(state.day);
  const monthStart = date.day === 1;
  const modifiersChanged = expireModifiers(state);
  return { day: state.day, monthStart, yearStart: monthStart && date.month === 1, modifiersChanged };
}
