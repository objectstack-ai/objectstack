// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  WORK_CALENDAR_INVALID_CODE,
  WORK_CALENDAR_NOT_MAINTAINED_CODE,
  addWorkingDays,
  addWorkingHours,
  buildWorkCalendar,
  isWorkingDay,
  isWorkingTime,
  parseWorkPeriods,
  workingDaysBetween,
  type WorkCalendar,
} from './work-calendar';

// ADR-0157: the arithmetic over one resolved calendar. 2026-10-01 is a Thursday.
const WEEKDAY = '09:00-12:00, 13:00-18:00';
const cnRow = {
  code: 'cn_standard',
  timezone: 'Asia/Shanghai',
  maintained_from: '2026-01-01',
  maintained_through: '2026-12-31',
  monday_periods: WEEKDAY,
  tuesday_periods: WEEKDAY,
  wednesday_periods: WEEKDAY,
  thursday_periods: WEEKDAY,
  friday_periods: WEEKDAY,
  saturday_periods: '',
  sunday_periods: null,
};
// A National Day week (seven `off` rows) and a 调休 make-up Saturday (an `on` row).
const nationalDay = ['01', '02', '03', '04', '05', '06', '07'].map((d) => ({ date: `2026-10-${d}`, kind: 'off' }));
const makeUpSaturday = { date: '2026-10-10', kind: 'on', periods: WEEKDAY };
const cn = buildWorkCalendar(cnRow, [...nationalDay, makeUpSaturday]);
// CONTROL: the same calendar with no exceptions entered.
const bare = buildWorkCalendar(cnRow, []);

/** Shanghai wall clock → instant (UTC+8, no DST). */
const sh = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+08:00`);

describe('working calendar — exceptions override the weekly pattern (ADR-0157 D1, D10)', () => {
  it('a 调休 make-up Saturday works its own periods; a plain Saturday does not (CONTROL)', () => {
    expect(isWorkingDay(cn, '2026-10-10')).toBe(true);
    expect(isWorkingDay(cn, '2026-10-17')).toBe(false);
    expect(isWorkingDay(bare, '2026-10-10')).toBe(false);
    expect(isWorkingTime(cn, sh('2026-10-10', '10:00'))).toBe(true);
    expect(isWorkingTime(cn, sh('2026-10-10', '12:30'))).toBe(false);
    expect(isWorkingTime(cn, new Date(sh('2026-10-17', '10:00')))).toBe(false);
  });

  it('a National Day week is off on every weekday it covers; the weekday pattern answers without it (CONTROL)', () => {
    expect(isWorkingDay(cn, '2026-10-01')).toBe(false);
    expect(isWorkingTime(cn, sh('2026-10-05', '10:00'))).toBe(false);
    expect(isWorkingDay(bare, '2026-10-01')).toBe(true);
  });

  it('addWorkingDays steps over the holiday week and onto the make-up Saturday', () => {
    expect(addWorkingDays(cn, '2026-09-30', 1)).toBe('2026-10-08');
    expect(addWorkingDays(cn, '2026-09-30', 3)).toBe('2026-10-10');
    expect(addWorkingDays(bare, '2026-09-30', 1)).toBe('2026-10-01');
    expect(addWorkingDays(cn, '2026-10-10', -3)).toBe('2026-09-30');
    expect(addWorkingDays(cn, '2026-10-03', 0)).toBe('2026-10-03');
  });

  it('workingDaysBetween excludes the start, includes the end, and inverts addWorkingDays', () => {
    expect(workingDaysBetween(cn, '2026-09-30', '2026-10-10')).toBe(3);
    expect(workingDaysBetween(cn, '2026-10-10', '2026-09-30')).toBe(-3);
    expect(workingDaysBetween(bare, '2026-09-30', '2026-10-10')).toBe(7);
    for (const n of [-4, -1, 0, 1, 2, 5]) {
      expect(workingDaysBetween(cn, '2026-10-09', addWorkingDays(cn, '2026-10-09', n))).toBe(n);
    }
  });

  it('addWorkingHours runs across both, forward and backward', () => {
    expect(addWorkingHours(cn, sh('2026-09-30', '17:00'), 2)).toBe(sh('2026-10-08', '10:00'));
    expect(addWorkingHours(cn, sh('2026-10-09', '17:00'), 2)).toBe(sh('2026-10-10', '10:00'));
    expect(addWorkingHours(cn, sh('2026-10-16', '17:00'), 2)).toBe(sh('2026-10-19', '10:00'));
    expect(addWorkingHours(cn, sh('2026-10-08', '10:00'), -2)).toBe(sh('2026-09-30', '17:00'));
    // A start outside working time begins at the next period; an answer on a period end is that end.
    expect(addWorkingHours(cn, sh('2026-10-03', '08:00'), 1)).toBe(sh('2026-10-08', '10:00'));
    expect(addWorkingHours(cn, sh('2026-10-08', '09:00'), 3)).toBe(sh('2026-10-08', '12:00'));
  });
});

describe('working calendar — the maintained span refuses (ADR-0157 D8)', () => {
  it('a span past maintained_through is refused, never read from the weekly pattern', () => {
    const run = () => addWorkingDays(cn, '2026-12-30', 3);
    expect(run).toThrow(expect.objectContaining({ code: WORK_CALENDAR_NOT_MAINTAINED_CODE, status: 400, date: '2027-01-01' }));
    expect(addWorkingDays(cn, '2026-12-29', 2)).toBe('2026-12-31'); // CONTROL: inside the span
    expect(() => addWorkingHours(cn, sh('2026-12-31', '17:00'), 2))
      .toThrow(expect.objectContaining({ code: WORK_CALENDAR_NOT_MAINTAINED_CODE }));
  });

  it('a span reaching before maintained_from is refused the same way', () => {
    expect(() => workingDaysBetween(cn, '2025-12-31', '2026-01-05'))
      .toThrow(expect.objectContaining({ code: WORK_CALENDAR_NOT_MAINTAINED_CODE, date: '2025-12-31' }));
    expect(() => isWorkingTime(cn, sh('2025-12-31', '10:00')))
      .toThrow(expect.objectContaining({ code: WORK_CALENDAR_NOT_MAINTAINED_CODE }));
    expect(workingDaysBetween(cn, '2026-01-01', '2026-01-05')).toBe(2); // CONTROL
  });
});

describe('working calendar — periods (ADR-0157 D7, D10)', () => {
  it('refuses a period that crosses midnight, at parse and when a stored row carries one', () => {
    expect(parseWorkPeriods('22:00-06:00')).toMatchObject({ ok: false, reason: 'crosses_midnight' });
    expect(() => buildWorkCalendar({ ...cnRow, monday_periods: '22:00-06:00' }, []))
      .toThrow(expect.objectContaining({ code: WORK_CALENDAR_INVALID_CODE, status: 400, field: 'monday_periods' }));
  });

  it('accepts 24:00 as an end, and only as an end', () => {
    expect(parseWorkPeriods('18:00-24:00')).toEqual({ ok: true, periods: [{ start: 1080, end: 1440 }] });
    expect(parseWorkPeriods('24:00-24:00')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseWorkPeriods('18:00-24:30')).toMatchObject({ ok: false, reason: 'malformed' });
    const late = buildWorkCalendar({ ...cnRow, monday_periods: '18:00-24:00' }, []);
    expect(isWorkingTime(late, sh('2026-10-12', '23:59'))).toBe(true);
    expect(isWorkingTime(late, sh('2026-10-13', '00:00'))).toBe(false);
  });

  it('refuses overlapping, empty and malformed periods; blank is a day off', () => {
    expect(parseWorkPeriods('09:00-12:00, 11:00-13:00')).toMatchObject({ ok: false, reason: 'overlap' });
    expect(parseWorkPeriods('09:00-09:00')).toMatchObject({ ok: false, reason: 'empty_period' });
    expect(parseWorkPeriods('9:00-12:00')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(parseWorkPeriods('09:00-12:00,12:00-13:00')).toMatchObject({ ok: true });
    expect(parseWorkPeriods('  ')).toEqual({ ok: true, periods: [] });
  });

  it('refuses an off row with periods, an on row without them, a duplicate date and a zone that is not IANA', () => {
    const bad = (rows: Record<string, unknown>[], row: Record<string, unknown> = cnRow) => () => buildWorkCalendar(row, rows);
    const invalid = expect.objectContaining({ code: WORK_CALENDAR_INVALID_CODE });
    expect(bad([{ date: '2026-10-01', kind: 'off', periods: '09:00-12:00' }])).toThrow(invalid);
    expect(bad([{ date: '2026-10-10', kind: 'on', periods: '' }])).toThrow(invalid);
    expect(bad([{ date: '2026-10-01', kind: 'off' }, { date: '2026-10-01', kind: 'off' }])).toThrow(invalid);
    expect(bad([], { ...cnRow, timezone: 'Mars/Olympus' })).toThrow(expect.objectContaining({ field: 'timezone' }));
    expect(bad([], { ...cnRow, maintained_through: '' })).toThrow(expect.objectContaining({ field: 'maintained_through' }));
  });
});

describe('working calendar — a transition day counts elapsed time (ADR-0157 D11)', () => {
  // Every day 01:00-04:00 New York time: a three-hour clock face.
  const ny: WorkCalendar = buildWorkCalendar({
    code: 'us_night', timezone: 'America/New_York', maintained_from: '2026-01-01', maintained_through: '2026-12-31',
    monday_periods: '01:00-04:00', tuesday_periods: '01:00-04:00', wednesday_periods: '01:00-04:00',
    thursday_periods: '01:00-04:00', friday_periods: '01:00-04:00', saturday_periods: '01:00-04:00',
    sunday_periods: '01:00-04:00',
  }, []);

  it('spring forward (2026-03-08): the period holds two hours, so half an hour spills into the next day', () => {
    expect(addWorkingHours(ny, Date.parse('2026-03-08T06:00:00Z'), 2.5)).toBe(Date.parse('2026-03-09T05:30:00Z'));
    // CONTROL: a week earlier the same period holds three hours.
    expect(addWorkingHours(ny, Date.parse('2026-03-01T06:00:00Z'), 2.5)).toBe(Date.parse('2026-03-01T08:30:00Z'));
  });

  it('fall back (2026-11-01): the period holds four hours', () => {
    expect(addWorkingHours(ny, Date.parse('2026-11-01T05:00:00Z'), 3.5)).toBe(Date.parse('2026-11-01T08:30:00Z'));
    // CONTROL: a week later the same period holds three hours.
    expect(addWorkingHours(ny, Date.parse('2026-11-08T06:00:00Z'), 3.5)).toBe(Date.parse('2026-11-09T06:30:00Z'));
    expect(isWorkingTime(ny, Date.parse('2026-11-01T08:30:00Z'))).toBe(true);
  });
});
