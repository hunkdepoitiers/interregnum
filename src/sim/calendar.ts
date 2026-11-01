/**
 * Julian calendar (in use across Europe in 1314). Day 0 of the game is 1 November 1314.
 * Conversions go through the Julian Day Number with integer arithmetic only.
 */
export interface GameDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const START_DATE: GameDate = { year: 1314, month: 11, day: 1 };

export function julianToJdn({ year, month, day }: GameDate): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
}

export function jdnToJulian(jdn: number): GameDate {
  const c = jdn + 32082;
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: d - 4800 + Math.floor(m / 10),
  };
}

const START_JDN = julianToJdn(START_DATE);

export function dayToDate(gameDay: number): GameDate {
  return jdnToJulian(START_JDN + gameDay);
}

export function dateToDay(date: GameDate): number {
  return julianToJdn(date) - START_JDN;
}

export function isJulianLeapYear(year: number): boolean {
  return year % 4 === 0;
}

export function formatDate(d: GameDate): string {
  return `${d.day} ${MONTH_NAMES[d.month - 1]} ${d.year}`;
}
