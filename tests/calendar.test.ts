import { describe, expect, it } from 'vitest';
import { dateToDay, dayToDate, formatDate, isJulianLeapYear } from '../src/sim/calendar';

describe('julian calendar', () => {
  it('day 0 is 27 July 1302', () => {
    expect(formatDate(dayToDate(0))).toBe('27 July 1302');
  });

  it('rolls over months and years', () => {
    expect(dayToDate(5)).toEqual({ year: 1302, month: 8, day: 1 });
    expect(dayToDate(dateToDay({ year: 1302, month: 12, day: 31 }) + 1)).toEqual({ year: 1303, month: 1, day: 1 });
  });

  it('1304 has 29 February; 1300 is leap (Julian rule)', () => {
    const feb28 = dateToDay({ year: 1304, month: 2, day: 28 });
    expect(dayToDate(feb28 + 1)).toEqual({ year: 1304, month: 2, day: 29 });
    expect(dayToDate(feb28 + 2)).toEqual({ year: 1304, month: 3, day: 1 });
    expect(isJulianLeapYear(1300)).toBe(true);
    expect(isJulianLeapYear(1303)).toBe(false);
  });

  it('round-trips every day for 200 years', () => {
    for (let d = 0; d < 365 * 200; d++) expect(dateToDay(dayToDate(d))).toBe(d);
  });

  it('a Julian year averages 365.25 days', () => {
    expect(dateToDay({ year: 1702, month: 7, day: 27 })).toBe(400 * 365.25);
  });
});
