import { describe, expect, it } from 'vitest';
import { dateToDay, dayToDate, formatDate, isJulianLeapYear } from '../src/sim/calendar';

describe('julian calendar', () => {
  it('day 0 is 1 November 1314', () => {
    expect(formatDate(dayToDate(0))).toBe('1 November 1314');
  });

  it('rolls over months and years', () => {
    expect(dayToDate(30)).toEqual({ year: 1314, month: 12, day: 1 });
    expect(dayToDate(dateToDay({ year: 1314, month: 12, day: 31 }) + 1)).toEqual({ year: 1315, month: 1, day: 1 });
  });

  it('1316 has 29 February; 1300 is leap (Julian rule)', () => {
    const feb28 = dateToDay({ year: 1316, month: 2, day: 28 });
    expect(dayToDate(feb28 + 1)).toEqual({ year: 1316, month: 2, day: 29 });
    expect(dayToDate(feb28 + 2)).toEqual({ year: 1316, month: 3, day: 1 });
    expect(isJulianLeapYear(1300)).toBe(true);
    expect(isJulianLeapYear(1315)).toBe(false);
  });

  it('round-trips every day for 200 years', () => {
    for (let d = 0; d < 365 * 200; d++) expect(dateToDay(dayToDate(d))).toBe(d);
  });

  it('a Julian year averages 365.25 days', () => {
    expect(dateToDay({ year: 1714, month: 11, day: 1 })).toBe(400 * 365.25);
  });
});
