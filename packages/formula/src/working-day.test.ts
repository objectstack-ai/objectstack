// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { WORK_CALENDAR_NOT_MAINTAINED_CODE, WORK_CALENDAR_UNRESOLVED_CODE } from '@objectstack/spec/data';
import type { Expression } from '@objectstack/spec';

import { celEngine } from './cel-engine';
import { compileCelToFilter, isPushdownableCel } from './cel-to-filter';
import type { EvalContext, EvalWorkCalendars } from './types';
import { WorkCalendarUnresolvedError, buildWorkCalendar } from './work-calendar';
import { callsWorkingDayFunction, computedCalendarCodeMessage, workingDayCalendarNeeds } from './working-day-needs';

// ADR-0157 D4: the three working-day formula functions, evaluated by the CEL
// engine over the calendars an evaluation is handed. 2026-10-01 is a Thursday.
const WEEKDAY = '09:00-12:00, 13:00-18:00';
const cnRow = {
  code: 'cn_mainland',
  timezone: 'Asia/Shanghai',
  maintained_from: '2026-01-01',
  maintained_through: '2026-12-31',
  monday_periods: WEEKDAY,
  tuesday_periods: WEEKDAY,
  wednesday_periods: WEEKDAY,
  thursday_periods: WEEKDAY,
  friday_periods: WEEKDAY,
};
// A National Day week (seven `off` rows) and a 调休 make-up Saturday (an `on` row).
const nationalDay = ['01', '02', '03', '04', '05', '06', '07'].map((d) => ({ date: `2026-10-${d}`, kind: 'off' }));
const makeUpSaturday = { date: '2026-10-10', kind: 'on', periods: WEEKDAY };
const cn = buildWorkCalendar(cnRow, [...nationalDay, makeUpSaturday]);
// CONTROL: the same weekly pattern with no exceptions entered, under another code.
const bare = buildWorkCalendar({ ...cnRow, code: 'weekly_only' }, []);

const calendars: EvalWorkCalendars = { default: cn, byCode: { cn_mainland: cn, weekly_only: bare } };
const cel = (source: string): Expression => ({ dialect: 'cel', source });
const run = (source: string, ctx: EvalContext = {}) => celEngine.evaluate(cel(source), { workCalendars: calendars, ...ctx });
const value = (source: string, ctx: EvalContext = {}) => {
  const r = run(source, ctx);
  if (!r.ok) throw new Error(`${source}: ${r.error.message}`);
  return r.value;
};
const iso = (v: unknown) => (v as Date).toISOString();
/** Shanghai wall clock → ISO instant (UTC+8, no DST). */
const sh = (day: string, hm: string) => new Date(`${day}T${hm}:00+08:00`).toISOString();

describe('addWorkingDays() — a weekend, a National Day week and a 调休 make-up Saturday', () => {
  it('steps over a weekend', () => {
    // Friday 2026-09-18 + 1 working day = Monday 2026-09-21.
    expect(iso(value("addWorkingDays('2026-09-18', 1)"))).toBe('2026-09-21T00:00:00.000Z');
  });

  it('steps over the holiday week and onto the make-up Saturday; the weekly pattern alone does not (CONTROL)', () => {
    expect(iso(value("addWorkingDays('2026-09-30', 1)"))).toBe('2026-10-08T00:00:00.000Z');
    expect(iso(value("addWorkingDays('2026-09-30', 3)"))).toBe('2026-10-10T00:00:00.000Z');
    expect(iso(value("addWorkingDays('2026-09-30', 1, 'weekly_only')"))).toBe('2026-10-01T00:00:00.000Z');
  });

  it('counts back for a negative count, never counts the start, and answers the start for 0', () => {
    expect(iso(value("addWorkingDays('2026-10-10', -3)"))).toBe('2026-09-30T00:00:00.000Z');
    expect(iso(value("addWorkingDays('2026-10-03', 0)"))).toBe('2026-10-03T00:00:00.000Z');
  });

  it('reads a date field, today() and a timestamp on the UTC calendar, and a number field as the count', () => {
    expect(iso(value('addWorkingDays(record.start, record.n)', { record: { start: '2026-09-30', n: 3 } })))
      .toBe('2026-10-10T00:00:00.000Z');
    expect(iso(value('addWorkingDays(today(), 1)', { now: new Date('2026-09-30T20:00:00Z'), timezone: 'Asia/Shanghai' })))
      .toBe('2026-10-08T00:00:00.000Z'); // today() in Shanghai is 2026-10-01, a holiday; the next working day is 10-08
    expect(iso(value('addWorkingDays(record.start, 1)', { record: { start: new Date('2026-09-30T00:00:00Z') } })))
      .toBe('2026-10-08T00:00:00.000Z');
    expect(value('isoDate(addWorkingDays(record.start, 3))', { record: { start: '2026-09-30' } })).toBe('2026-10-10');
  });

  it('answers blank for a blank start, as addDays() does, and refuses a count that is not a whole number', () => {
    const blank = value('addWorkingDays(record.start, 1)', { record: { start: null } });
    expect(blank instanceof Date && Number.isNaN(blank.getTime())).toBe(true);
    const half = run("addWorkingDays('2026-09-30', 1.5)");
    expect(half.ok).toBe(false);
    expect(!half.ok && half.error.kind).toBe('runtime');
    expect(!half.ok && half.error.message).toContain('whole number');
  });
});

describe('workingDaysBetween()', () => {
  it('excludes the start, includes the end, is negative backward, and inverts addWorkingDays()', () => {
    expect(value("workingDaysBetween('2026-09-30', '2026-10-10')")).toBe(3);
    expect(value("workingDaysBetween('2026-10-10', '2026-09-30')")).toBe(-3);
    expect(value("workingDaysBetween('2026-09-30', '2026-10-10', 'weekly_only')")).toBe(7);
    for (const n of [-4, -1, 0, 1, 2, 5]) {
      expect(value(`workingDaysBetween('2026-10-09', addWorkingDays('2026-10-09', ${n}))`)).toBe(n);
    }
  });

  it('compares as an int in a predicate', () => {
    expect(value("workingDaysBetween(record.opened, record.closed) > 2", { record: { opened: '2026-09-30', closed: '2026-10-10' } }))
      .toBe(true);
  });

  it('refuses a blank day: a count of nothing is not zero', () => {
    const r = run('workingDaysBetween(record.opened, record.closed)', { record: { opened: '2026-09-30', closed: null } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toContain('end day has no value');
  });
});

describe('addWorkingHours()', () => {
  it('runs across the holiday week and the make-up Saturday, forward and backward', () => {
    expect(iso(value(`addWorkingHours('${sh('2026-09-30', '17:00')}', 2)`))).toBe(sh('2026-10-08', '10:00'));
    expect(iso(value(`addWorkingHours('${sh('2026-10-09', '17:00')}', 2)`))).toBe(sh('2026-10-10', '10:00'));
    expect(iso(value(`addWorkingHours('${sh('2026-10-08', '10:00')}', -2)`))).toBe(sh('2026-09-30', '17:00'));
    // A weekend: Friday 17:00 + 2h = Monday 10:00.
    expect(iso(value(`addWorkingHours('${sh('2026-10-16', '17:00')}', 2)`))).toBe(sh('2026-10-19', '10:00'));
  });

  it('reads a datetime field and now()', () => {
    expect(iso(value('addWorkingHours(record.opened_at, 4)', { record: { opened_at: new Date(sh('2026-09-30', '16:00')) } })))
      .toBe(sh('2026-10-08', '11:00'));
    expect(iso(value('addWorkingHours(now(), 1)', { now: new Date(sh('2026-10-10', '11:30')) }))).toBe(sh('2026-10-10', '13:30'));
  });

  it('counts elapsed time on daylight-saving transition days (ADR-0157 D11)', () => {
    const night = '01:00-04:00';
    const ny = buildWorkCalendar({
      code: 'us_night', timezone: 'America/New_York', maintained_from: '2026-01-01', maintained_through: '2026-12-31',
      monday_periods: night, tuesday_periods: night, wednesday_periods: night, thursday_periods: night,
      friday_periods: night, saturday_periods: night, sunday_periods: night,
    }, []);
    const ctx = { workCalendars: { default: ny } };
    // Spring forward: the 2026-03-08 period holds two hours, so half an hour spills into 03-09.
    expect(iso(value("addWorkingHours('2026-03-08T06:00:00Z', 2.5)", ctx))).toBe('2026-03-09T05:30:00.000Z');
    expect(iso(value("addWorkingHours('2026-03-01T06:00:00Z', 2.5)", ctx))).toBe('2026-03-01T08:30:00.000Z'); // CONTROL
    // Fall back: the 2026-11-01 period holds four hours.
    expect(iso(value("addWorkingHours('2026-11-01T05:00:00Z', 3.5)", ctx))).toBe('2026-11-01T08:30:00.000Z');
    expect(iso(value("addWorkingHours('2026-11-08T06:00:00Z', 3.5)", ctx))).toBe('2026-11-09T06:30:00.000Z'); // CONTROL
  });
});

describe('the calendar a call counts with (ADR-0157 D2, D8)', () => {
  it('a call with no code counts with the default; a code names its calendar', () => {
    expect(iso(value("addWorkingDays('2026-09-30', 1)", { workCalendars: { default: bare } }))).toBe('2026-10-01T00:00:00.000Z');
    expect(iso(value("addWorkingDays('2026-09-30', 1, 'cn_mainland')", { workCalendars: { default: bare, byCode: { cn_mainland: cn } } })))
      .toBe('2026-10-08T00:00:00.000Z');
  });

  it('throws the refusal the caller met resolving a calendar, never a count on the wall clock', () => {
    const r = run("addWorkingDays('2026-09-30', 1)", { workCalendars: { default: new WorkCalendarUnresolvedError('no_default') } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
    expect(!r.ok && r.error.message).toContain('No working calendar is marked as the default');
    // The refusal is the calendar error itself, carried as data.
    expect(new WorkCalendarUnresolvedError('no_default').code).toBe(WORK_CALENDAR_UNRESOLVED_CODE);
  });

  it('a count past the maintained span throws the not-maintained refusal (D8)', () => {
    const r = run("addWorkingDays('2026-12-30', 5)");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toContain("is maintained from 2026-01-01 through 2026-12-31");
    expect(WORK_CALENDAR_NOT_MAINTAINED_CODE).toBe('ERR_WORK_CALENDAR_NOT_MAINTAINED');
  });

  it('an evaluation handed no calendars throws, naming where calendars are loaded', () => {
    const r = celEngine.evaluate(cel("addWorkingDays('2026-09-30', 1)"), {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toContain("formula field's or a computed field's `expression`");
  });

  it('a code the evaluation was not given throws, naming the literal rule', () => {
    const r = run("addWorkingDays('2026-09-30', 1, 'us_east')");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.message).toContain("names the working calendar 'us_east'");
  });
});

describe('workingDayCalendarNeeds() — the calendars an expression names', () => {
  it('reads the default and each quoted code, once each; none for an expression without a call', () => {
    expect(workingDayCalendarNeeds("addWorkingDays(record.a, 1) == addWorkingDays(record.a, 1, 'cn') || workingDaysBetween(record.a, record.b, 'cn') > addWorkingHours(record.c, 2, 'us')"))
      .toEqual({ default: true, codes: ['cn', 'us'], computedCode: [] });
    expect(workingDayCalendarNeeds("addWorkingDays(record.a, 1, 'cn')")).toEqual({ default: false, codes: ['cn'], computedCode: [] });
    expect(workingDayCalendarNeeds('addDays(record.a, 1)')).toBeUndefined();
    expect(callsWorkingDayFunction('addDays(record.a, 1)')).toBe(false);
    expect(callsWorkingDayFunction('addWorkingHours (record.a, 1)')).toBe(true);
  });

  it('names a call whose calendar is computed, and the authoring message says to write a literal', () => {
    expect(workingDayCalendarNeeds('addWorkingDays(record.a, 1, record.calendar)'))
      .toEqual({ default: false, codes: [], computedCode: ['addWorkingDays'] });
    expect(computedCalendarCodeMessage('addWorkingDays(record.a, 1, record.calendar)')).toContain('quoted literal');
    expect(computedCalendarCodeMessage("addWorkingDays(record.a, 1, 'cn')")).toBeUndefined();
  });
});

describe('pushdown refuses the working-day functions (ADR-0157 D6)', () => {
  for (const source of [
    'record.due_at < addWorkingDays(today(), 3)',
    'addWorkingHours(record.opened_at, 4) < now()',
    'workingDaysBetween(record.opened, today()) > 3',
  ]) {
    it(`refuses \`${source}\` with the write-time column prescription`, () => {
      const compiled = compileCelToFilter(source);
      expect(compiled.ok).toBe(false);
      expect(!compiled.ok && compiled.reason).toBe('unsupported');
      expect(!compiled.ok && compiled.detail).toMatch(/evaluates in memory only, so it cannot run as a database filter/);
      expect(!compiled.ok && compiled.detail).toContain('{now}');
      const shape = isPushdownableCel(source);
      expect(shape.ok).toBe(false);
    });
  }

  it('CONTROL: another function call keeps its generic refusal', () => {
    const compiled = compileCelToFilter('record.due < addDays(today(), 3)');
    expect(compiled.ok).toBe(false);
    expect(!compiled.ok && compiled.detail).not.toMatch(/working calendar/);
  });
});
