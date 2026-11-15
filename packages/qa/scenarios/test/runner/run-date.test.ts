// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A card's dates rebased onto the run date (`src/runner/run-date.ts`): the
 * prompt's "today", the seeded rows, the timestamps the app's real clock
 * stamps and the grader's expectations agree however long after the card's
 * `asOf` the run is. One whole-day delta moves every date; the arithmetic is
 * proved over a month end, Feb 28/29 in a non-leap and a leap year, and a year
 * boundary, and every truth is checked against an independent reading of the
 * unmoved seed. A card that declares `workingDays` moves by whole working days
 * instead, so its Monday-to-Friday leave stays Monday to Friday on every run
 * date, its asks name working days, and its truths keep their meaning.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarioFile, loadScenarios, readCapabilityAreas, truthsOver, type LoadedScenario } from '../../src/loader.js';
import { operationPrompt, questionPrompt } from '../../src/runner/prompts.js';
import { daysBetween, onWorkingDay, rebaseScenario, shiftDate, shiftTextDates, shiftWorkingDays, workingDaysBetween } from '../../src/runner/run-date.js';
import type { Filter, Window } from '../../src/schema.js';
import { gradeCardOperation, type OperationObservation } from '../../src/score/index.js';
import { windowRange } from '../../src/truth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS = resolve(HERE, '../../../../../docs/qa/scenarios');
const AREAS_DIR = resolve(HERE, '../../../../../docs/qa/platform-checklist/areas');

const LIBRARY = loadScenarios(CARDS, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' });

function load(id: string): LoadedScenario {
  const card = LIBRARY.cards.find((c) => c.card.id === id);
  if (!card) throw new Error(`no card ${id}: ${LIBRARY.refusals.map(formatRefusal).join('\n')}`);
  return card;
}

const asset = load('asset_lifecycle');
const leave = load('leave_balances');

/** Run dates the rebase is proved over: weeks after, month ends, Feb 28/29 non-leap and leap, a year boundary. */
const RUN_DATES = ['2026-11-15', '2026-11-30', '2026-12-31', '2027-01-01', '2027-02-28', '2027-03-01', '2028-02-28', '2028-02-29', '2028-03-31'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ── an independent working-day reading: the calendar walked one day at a time, skipping Saturday and Sunday ──
const weekday = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).getUTCDay();
const isWorking = (d: string) => weekday(d) !== 0 && weekday(d) !== 6;

// The walk, step by step: the reading itself, kept to check the calendar table below against.
/** The working day on or before `d`, stepping back a day at a time. */
const stepOnOrBefore = (d: string): string => (isWorking(d) ? d : stepOnOrBefore(shiftDate(d, -1)));
/** The working day on or after `d`, stepping on a day at a time. */
const stepOnOrAfter = (d: string): string => (isWorking(d) ? d : stepOnOrAfter(shiftDate(d, 1)));
/** Working days from `from` to `to`, counted by stepping through the calendar. */
function stepCount(from: string, to: string): number {
  let n = 0;
  for (let d = from; d < to; d = shiftDate(d, 1)) if (isWorking(shiftDate(d, 1))) n++;
  for (let d = from; d > to; d = shiftDate(d, -1)) if (isWorking(d)) n--;
  return n;
}
/** `d` moved `n` working days, by stepping through the calendar. */
function stepShift(d: string, n: number): string {
  let t = d.slice(0, 10);
  for (let k = n; k !== 0; ) {
    t = shiftDate(t, Math.sign(k));
    if (isWorking(t)) k -= Math.sign(k);
  }
  return t + d.slice(10);
}

// The same walk taken once: every calendar day from CALENDAR[0] to CALENDAR[1], stepped a day at a
// time, numbering the working days in order. Every card date of every run date falls well inside it.
const CALENDAR = ['1960-01-01', '2040-12-31'] as const;
let table: { days: string[]; atOrBefore: Map<string, number> } | undefined;
function calendar() {
  if (table) return table;
  const days: string[] = [];
  const atOrBefore = new Map<string, number>();
  for (let d: string = CALENDAR[0]; d <= CALENDAR[1]; d = shiftDate(d, 1)) {
    if (isWorking(d)) days.push(d);
    atOrBefore.set(d, days.length - 1);
  }
  return (table = { days, atOrBefore });
}
/** The number of the working day on or before `d`. */
function numberOf(d: string): number {
  const i = calendar().atOrBefore.get(d.slice(0, 10));
  if (i === undefined || i < 0) throw new Error(`${d} is outside the walked calendar ${CALENDAR.join('..')}`);
  return i;
}
/** Working day number `i`. */
function dayOf(i: number): string {
  const d = calendar().days[i];
  if (d === undefined) throw new Error(`working day ${i} is outside the walked calendar ${CALENDAR.join('..')}`);
  return d;
}
/** The working day on or before `d`. */
const onOrBefore = (d: string): string => dayOf(numberOf(d)) + d.slice(10);
/** The working day on or after `d`. */
const onOrAfter = (d: string): string => (isWorking(d) ? d : dayOf(numberOf(d) + 1) + d.slice(10));
/** Working days from `from` to `to`, read off the walked calendar. */
const walkCount = (from: string, to: string): number => numberOf(to) - numberOf(from);
/** `d` moved `n` working days, read off the walked calendar: a weekend `d` counts from the next working day back, the last one on. */
function walkShift(d: string, n: number): string {
  if (n === 0) return d;
  const i = numberOf(d);
  return dayOf((isWorking(d) || n > 0 ? i : i + 1) + n) + d.slice(10);
}

/**
 * How the rebase must move `value`, a date of card `s` run on `runDate`, read independently of the
 * implementation: whole days, or on a `workingDays` card `asOf` onto `runDate` and every other date by
 * the working days from `asOf` to the run date (a weekend run date read as the Friday before it).
 */
function expectedMove(s: LoadedScenario, runDate: string): (value: string) => string {
  const asOf = s.card.asOf!;
  if (s.card.workingDays !== true) return (v) => shiftDate(v, daysBetween(asOf, runDate));
  const n = walkCount(onOrBefore(asOf), onOrBefore(runDate));
  return (v) => (v.slice(0, 10) === asOf ? runDate + v.slice(10) : walkShift(v, n));
}

/**
 * The unmoved-seed range a window `[from, to]` around the moved today reads: whole days back by the
 * delta, or on a `workingDays` card the working days that move into the window, walked back.
 */
function rangeBack(s: LoadedScenario, runDate: string, [from, to]: [string, string]): [string, string] {
  const asOf = s.card.asOf!;
  if (s.card.workingDays !== true) {
    const days = daysBetween(asOf, runDate);
    return [shiftDate(from, -days), shiftDate(to, -days)];
  }
  const n = walkCount(onOrBefore(asOf), onOrBefore(runDate));
  return [walkShift(onOrAfter(from), -n), walkShift(onOrBefore(to), -n)];
}

/** Every [path, value] leaf of `v`. */
function leaves(v: unknown, path = ''): Array<[string, unknown]> {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}/${i}`));
  if (v !== null && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => leaves(x, `${path}/${k}`));
  return [[path, v]];
}

describe('whole-day arithmetic across month ends, leap days and a year boundary', () => {
  it('moves a date by whole days and counts the days between two', () => {
    expect(shiftDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftDate('2027-02-28', 1)).toBe('2027-03-01');
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDate('2028-02-29', 1)).toBe('2028-03-01');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDate('2026-10-31T08:30:00Z', 46)).toBe('2026-12-16T08:30:00Z');
    expect(daysBetween('2026-10-31', '2026-11-15')).toBe(15);
    expect(daysBetween('2027-02-01', '2027-03-01')).toBe(28);
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29);
    expect(daysBetween('2026-10-31', '2028-02-29')).toBe(486);
    expect(daysBetween('2026-11-15', '2026-10-31')).toBe(-15);
    for (const d of RUN_DATES) expect(shiftDate('2026-10-31', daysBetween('2026-10-31', d))).toBe(d);
  });

  it('a calendar window around the moved today keeps its month ends and leap days', () => {
    const w = (period: 'this_month' | 'previous_month' | 'this_year' | 'previous_year'): Window => ({ kind: 'calendar', period });
    expect(windowRange(w('previous_month'), '2028-03-31')).toEqual(['2028-02-01', '2028-02-29']);
    expect(windowRange(w('previous_month'), '2027-03-01')).toEqual(['2027-02-01', '2027-02-28']);
    expect(windowRange(w('this_month'), '2028-02-29')).toEqual(['2028-02-01', '2028-02-29']);
    expect(windowRange(w('previous_month'), '2027-01-01')).toEqual(['2026-12-01', '2026-12-31']);
    expect(windowRange(w('previous_year'), '2027-01-01')).toEqual(['2026-01-01', '2026-12-31']);
    expect(windowRange({ kind: 'last_days', days: 30 }, '2028-03-01')).toEqual(['2028-02-01', '2028-03-01']);
  });
});

describe('whole working days', () => {
  it('moves a working day by working days over a weekend, a month end, a leap day and a year boundary', () => {
    expect(shiftWorkingDays('2026-10-28', 2)).toBe('2026-10-30');
    expect(shiftWorkingDays('2026-10-28', 3)).toBe('2026-11-02');
    expect(shiftWorkingDays('2026-11-02', -1)).toBe('2026-10-30');
    expect(shiftWorkingDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftWorkingDays('2027-01-01', 1)).toBe('2027-01-04');
    expect(shiftWorkingDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftWorkingDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(shiftWorkingDays('2026-09-30T08:30:00Z', 5)).toBe('2026-10-07T08:30:00Z');
    expect(() => shiftWorkingDays('2026-10-31', 1)).toThrow(/not a working day/);
    // Before and after the epoch week, the count agrees with a walk over the calendar.
    for (const [d, n] of [['1969-12-31', 7], ['1970-01-02', -3], ['2026-09-30', 32], ['2026-09-30', 380], ['2028-02-29', -260]] as const) {
      expect(shiftWorkingDays(d, n), `${d} + ${n}`).toBe(walkShift(d, n));
    }
  });

  it('counts the working days between two dates, a weekend read as the Friday before it', () => {
    expect(workingDaysBetween('2026-09-30', '2026-11-13')).toBe(32);
    expect(workingDaysBetween('2026-09-30', '2026-11-14')).toBe(32);
    expect(workingDaysBetween('2026-09-30', '2026-11-15')).toBe(32);
    expect(workingDaysBetween('2026-09-30', '2026-11-16')).toBe(33);
    expect(workingDaysBetween('2026-11-16', '2026-09-30')).toBe(-33);
    for (const d of RUN_DATES) expect(workingDaysBetween('2026-09-30', d), d).toBe(walkCount('2026-09-30', onOrBefore(d)));
    expect([onWorkingDay('2026-11-13'), onWorkingDay('2026-11-14'), onWorkingDay('2026-11-15T09:00:00Z')]).toEqual([true, false, false]);
  });

  it('the calendar walked once reads the same as stepping through it, across the epoch week, a year end and a leap day', () => {
    const around = (d: string) => Array.from({ length: 15 }, (_, k) => shiftDate(d, k - 7));
    const days = ['1970-01-01', '2026-12-31', '2028-02-29'].flatMap(around);
    days.push('2026-12-31T08:30:00Z', '2028-02-26T09:00:00Z');
    for (const d of days) {
      expect([onOrBefore(d), onOrAfter(d)], d).toEqual([stepOnOrBefore(d), stepOnOrAfter(d)]);
      for (const n of [-6, -1, 0, 1, 6]) expect(walkShift(d, n), `${d} + ${n}`).toBe(stepShift(d, n));
    }
    for (const [d, n] of [['1969-12-31', 7], ['2026-09-30', 380], ['2027-01-01', -380], ['2028-02-26', -260], ['2028-02-29', 260]] as const) {
      expect(walkShift(d, n), `${d} + ${n}`).toBe(stepShift(d, n));
    }
    for (const [from, to] of [['1969-12-27', '1970-01-05'], ['2026-09-30', '2028-03-31'], ['2028-03-04', '2026-12-26'], ['2028-02-26', '2028-03-04']] as const) {
      expect(walkCount(from, to), `${from} → ${to}`).toBe(stepCount(from, to));
      expect(walkCount(to, from), `${to} → ${from}`).toBe(stepCount(to, from));
    }
    expect(() => walkShift('1959-12-31', 1)).toThrow(/outside the walked calendar/);
    expect(() => walkShift('2040-12-31', 1)).toThrow(/outside the walked calendar/);
  });
});

describe('the dates an ask writes in its text move with the card', () => {
  it('ISO, English and Chinese dates, with their weekdays written again', () => {
    const toNov15 = daysBetween('2026-09-30', '2026-11-15');
    expect(shiftTextDates('I am taking annual leave on Wednesday 28 October and the morning of Thursday 29 October.', toNov15, '2026-09-30')).toBe(
      'I am taking annual leave on Sunday 13 December and the morning of Monday 14 December.',
    );
    expect(shiftTextDates('10 月 28 日(周三)我请一天年假,29 日(周四)上午再请半天。', toNov15, '2026-09-30')).toBe('12 月 13 日(周日)我请一天年假,14 日(周一)上午再请半天。');
    expect(shiftTextDates('make the last day (20 October) a morning half day', toNov15, '2026-09-30')).toBe('make the last day (5 December) a morning half day');
    // A day-only date that crosses into the next month is given its month.
    expect(shiftTextDates('10 月 30 日(周五)和 31 日(周六)', 1, '2026-10-31')).toBe('10 月 31 日(周六)和 11 月 1 日(周日)');
    expect(shiftTextDates('move its due date to 2026-11-14.', 15, '2026-10-31')).toBe('move its due date to 2026-11-29.');
    expect(shiftTextDates('Friday, October 30, 2026 and 31 December 2026', 1, '2026-10-31')).toBe('Saturday, October 31, 2026 and 1 January 2027');
    // A year-less date is read in the year nearest the card's today.
    expect(shiftTextDates('by 5 January', 1, '2026-12-20')).toBe('by 6 January');
    // Not dates: a lone "N 日" with no month before it and no weekday, an invalid ISO date, a number.
    expect(shiftTextDates('3 日内完成;2026-02-30;1,800 each', 5, '2026-10-31')).toBe('3 日内完成;2026-02-30;1,800 each');
  });
});

describe('every dated card, rebased onto each run date', () => {
  const dated = LIBRARY.cards.filter((s) => s.card.asOf !== undefined);

  it('loads the library clean and has dated cards to move', () => {
    expect(LIBRARY.refusals).toEqual([]);
    expect(dated.length).toBeGreaterThanOrEqual(7);
  });

  it('a card with no asOf, or one already on the run date, is returned as it is', () => {
    for (const s of LIBRARY.cards.filter((x) => x.card.asOf === undefined)) expect(rebaseScenario(s, '2026-11-15')).toBe(s);
    expect(rebaseScenario(asset, asset.card.asOf!)).toBe(asset);
  });

  for (const runDate of RUN_DATES) {
    it(`run on ${runDate}: today is the run date, every date moves as the card's rebase says, and every truth matches the unmoved seed read the same way`, () => {
      for (const s of dated) {
        const move = expectedMove(s, runDate);
        const r = rebaseScenario(s, runDate);
        expect(r.card.asOf, s.card.id).toBe(runDate);
        for (const q of r.card.run.questions) expect(questionPrompt(r, q.id)).toContain(`Today is ${runDate}.`);
        for (const op of r.card.run.operations) expect(operationPrompt(r.card, op.id)).toContain(`Today is ${runDate}.`);

        // Every ISO date leaf under run and iterate moved as the card's move says; nothing else moved but ask text.
        for (const part of ['run', 'iterate'] as const) {
          const before = leaves(s.card[part]);
          const after = new Map(leaves(r.card[part]));
          expect(after.size).toBe(before.length);
          for (const [path, v] of before) {
            const now = after.get(path);
            if (typeof v === 'string' && ISO.test(v)) expect(now, `${s.card.id} ${path}`).toBe(move(v));
            else if (!/\/ask\/(en|zh)$/.test(path)) expect(now, `${s.card.id} ${path}`).toEqual(v);
          }
        }
        // The card file's own copy is untouched.
        expect(s.card.asOf).not.toBe(runDate);

        // The truths: each one again from the UNMOVED seed, with every date filter moved back instead —
        // a calendar window becomes the range around the moved today, read back.
        const back: typeof s.card = structuredClone(s.card);
        for (const q of back.run.questions) {
          if (q.truth.kind === 'unanswerable' || !q.truth.filter) continue;
          q.truth.filter = q.truth.filter.flatMap((f): Filter[] => {
            if (f.op === 'in_window') {
              const [from, to] = rangeBack(s, runDate, windowRange(f.value as Window, runDate));
              return [
                { field: f.field, op: 'gte', value: from },
                { field: f.field, op: 'lte', value: to },
              ];
            }
            return [f];
          });
        }
        const expected = truthsOver(back, back.run.seed);
        expect(r.truths, `${s.card.id} truths`).toEqual(expected.truths);
        expect(r.personaTruths, `${s.card.id} persona truths`).toEqual(expected.personaTruths);
        expect(r.scopeFigures).toBe(s.scopeFigures);

        // A truth whose dates are all relative (no calendar window) is the card's own figure.
        for (const q of s.card.run.questions) {
          const calendar = q.truth.kind !== 'unanswerable' && (q.truth.filter ?? []).some((f) => f.op === 'in_window' && (f.value as Window).kind === 'calendar');
          if (!calendar) expect(r.truths[q.id], `${s.card.id} ${q.id}`).toEqual(s.truths[q.id]);
        }
      }
    });
  }

  it('the asks that write a date say the moved one, and it is the date the operation expects', () => {
    const runDate = '2026-11-15';
    const a = rebaseScenario(asset, runDate);
    const extend = a.card.run.operations.find((o) => o.id === 'extend_overdue_loaner')!;
    expect(extend.values?.due_on).toBe('2026-11-29');
    expect(extend.ask.en).toContain('move its due date to 2026-11-29.');
    expect(extend.ask.zh).toContain('把应还日期改到 2026-11-29。');

    // leave_balances keeps to working days: run on a Sunday, its dates move 32 working days, as for
    // Friday 13 November, and Wednesday 28 October becomes Friday 11 December, not Sunday 13 December.
    const l = rebaseScenario(leave, runDate);
    const file = l.card.run.operations.find((o) => o.id === 'file_and_submit_from_text')!;
    expect([file.values?.start_date, file.values?.end_date]).toEqual(['2026-12-11', '2026-12-14']);
    expect(file.ask.en).toContain('on Friday 11 December and the morning of Monday 14 December');
    expect(file.ask.zh).toContain('12 月 11 日(周五)我请一天年假,14 日(周一)上午再请半天');
    const half = l.card.run.operations.find((o) => o.id === 'half_day_on_draft')!;
    expect(half.ask.en).toContain('(3 December)');
    expect(half.ask.zh).toContain('(12 月 3 日)');
  });
});

describe('a run four weeks after the card\'s today: prompt, seed, record timestamps and grader agree', () => {
  const RUN_DAY = '2026-11-28';
  const a = rebaseScenario(asset, RUN_DAY);
  const state = (row: Record<string, unknown>): OperationObservation => ({ answer: { kind: 'applied' }, writes: 1, state: [[row]], runDates: [RUN_DAY] });

  it('extend_overdue_loaner: the loaner is still overdue on the run date, and the date the ask names is the one graded', () => {
    expect(operationPrompt(a.card, 'extend_overdue_loaner')).toMatch(/move its due date to 2026-12-12\. Today is 2026-11-28\./);
    const seeded = a.card.run.seed.checkout!.find((r) => r.id === 'co_085_1')!;
    expect(seeded.due_on).toBe('2026-11-24');
    expect(seeded.due_on! < RUN_DAY).toBe(true);
    const done = state({ id: 'co_085_1', due_on: '2026-12-12', status: 'open' });
    expect(gradeCardOperation(a, 'extend_overdue_loaner', done).pass).toBe(true);
    // ⛔ The unmoved card grades the same correct write as wrong: the drift this rebase removes.
    expect(gradeCardOperation(asset, 'extend_overdue_loaner', done).pass).toBe(false);
  });

  it('dispose_scrapped_asset and manager_approves_scrap: "today" values are the run date, met by the agent or by the platform clock', () => {
    const dispose = a.card.run.operations.find((o) => o.id === 'dispose_scrapped_asset')!;
    expect(dispose.values).toMatchObject({ disposed_on: RUN_DAY });
    const approve = a.card.run.operations.find((o) => o.id === 'manager_approves_scrap')!;
    expect(approve.values).toMatchObject({ decided_on: RUN_DAY });
    const row = { id: 'dr06', status: 'approved', decided_on: RUN_DAY };
    const obs: OperationObservation = { answer: { kind: 'applied' }, writes: 1, state: [[row], [{ id: 'a102', status: 'pending_disposal' }]], auditActor: 'dept_manager', runDates: [RUN_DAY] };
    expect(gradeCardOperation(a, approve.id, obs).pass).toBe(true);
  });

  it('the overdue question counts the same loaners on the run date as on the card\'s today', () => {
    expect(a.truths.overdue_loaners_by_department).toEqual(asset.truths.overdue_loaners_by_department);
    const q = a.card.run.questions.find((x) => x.id === 'overdue_loaners_by_department')!;
    expect(q.truth.kind !== 'unanswerable' && q.truth.filter).toEqual([{ field: 'status', op: 'eq', value: 'open' }, { field: 'due_on', op: 'lt', value: RUN_DAY }]);
  });
});

describe('leave_balances on seven consecutive run dates: its working days stay working days', () => {
  // 2026-11-15 is a Sunday: the seven cover every weekday, and the whole-day deltas 46 to 52, of which
  // only 49 is whole weeks. On a whole-day move six of the seven put up to 126 of the 307 leave days on
  // a weekend, and the six truths that sum request days then disagree with the app's Monday-to-Friday count.
  const SEVEN = Array.from({ length: 7 }, (_, i) => shiftDate('2026-11-15', i));
  const EN_DAY = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December)\b/g;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  it('declares workingDays, and the card file holds no weekend date but its today', () => {
    expect(leave.card.workingDays).toBe(true);
    for (const [path, v] of leaves(leave.card.run)) if (typeof v === 'string' && ISO.test(v)) expect(isWorking(v), `${path} ${v}`).toBe(true);
  });

  for (const runDate of SEVEN) {
    it(`run on ${runDate} (${NAMES[weekday(runDate)]}): today is the run date, every leave day is a working day, the asks name working days, the truths keep their meaning`, () => {
      const r = rebaseScenario(leave, runDate);
      const seed = r.card.run.seed;
      expect(r.card.asOf).toBe(runDate);

      // Every seeded date and every expected date is a working day, but a value that is the card's today.
      for (const part of ['run', 'iterate'] as const) {
        for (const [path, v] of leaves(r.card[part])) {
          if (typeof v !== 'string' || !ISO.test(v) || v === runDate) continue;
          expect(isWorking(v), `${path} ${v}`).toBe(true);
        }
      }
      // What was before the card's today is before the run date; what was after it, after.
      const before = new Map(leaves(leave.card.run));
      for (const [path, v] of leaves(r.card.run)) {
        const was = before.get(path);
        if (typeof v !== 'string' || !ISO.test(v) || typeof was !== 'string') continue;
        if (was < leave.card.asOf!) expect(v < runDate, `${path}: ${was} → ${v}`).toBe(true);
        if (was > leave.card.asOf!) expect(v > runDate, `${path}: ${was} → ${v}`).toBe(true);
      }

      // The app's rule: a request's days are its Monday-to-Friday lines, and a balance's used days are
      // its approved requests'. Read independently over the moved seed, both equal the seeded figures.
      const lines = new Map<string, number>();
      for (const d of seed.leave_day) {
        const on = d.leave_date as string;
        if (isWorking(on)) lines.set(d.request as string, (lines.get(d.request as string) ?? 0) + (d.day_value as number));
      }
      for (const q of seed.leave_request) {
        expect(lines.get(q.id as string), q.id as string).toBe(q.days);
        expect([isWorking(q.start_date as string), isWorking(q.end_date as string)], q.id as string).toEqual([true, true]);
      }
      for (const b of seed.leave_balance) {
        const used = seed.leave_request.filter((q) => q.balance === b.id && q.status === 'approved').reduce((a, q) => a + (lines.get(q.id as string) ?? 0), 0);
        expect(used, b.id as string).toBe(b.used_days);
      }
      // So every truth that does not read a calendar window is the card's own figure.
      for (const q of leave.card.run.questions) if (q.id !== 'approved_days_last_month') expect(r.truths[q.id], q.id).toEqual(leave.truths[q.id]);
      expect(r.personaTruths).toEqual(leave.personaTruths);

      // The asks name working days, and each named weekday is the date's own and the date the operation expects.
      const file = r.card.run.operations.find((o) => o.id === 'file_and_submit_from_text')!;
      const [en, zh] = [file.ask.en ?? '', file.ask.zh ?? ''];
      expect([en, zh].every((t) => t.length > 0)).toBe(true);
      const named = [...en.matchAll(EN_DAY)].map(([, w, d, m]) => ({ w, date: `${runDate.slice(0, 4)}-${String(MONTHS.indexOf(m) + 1).padStart(2, '0')}-${d.padStart(2, '0')}` }));
      expect(named.map((n) => n.date)).toEqual([file.values!.start_date, file.values!.end_date]);
      for (const n of named) {
        expect(NAMES[weekday(n.date)], n.date).toBe(n.w);
        expect(['Saturday', 'Sunday']).not.toContain(n.w);
      }
      expect(zh).not.toMatch(/周[六日]/);
      const zhDays = [...zh.matchAll(/周([一二三四五六日])/g)].map(([, w]) => '日一二三四五六'.indexOf(w));
      expect(zhDays).toEqual([weekday(file.values!.start_date as string), weekday(file.values!.end_date as string)]);
      const outcome = file.outcome.kind === 'applied' ? file.outcome.state : [];
      expect(outcome.filter((st) => st.object === 'leave_day').map((st) => st.where?.leave_date)).toEqual([file.values!.start_date, file.values!.end_date]);
      // The half day the draft's ask names is the date of the line it targets.
      const half = r.card.run.operations.find((o) => o.id === 'half_day_on_draft')!;
      const line = seed.leave_day.find((d) => d.id === half.target)!;
      const [, hd, hm] = /\((\d{1,2}) (\w+)\)/.exec(half.ask.en ?? '')!;
      expect(`${String(MONTHS.indexOf(hm) + 1).padStart(2, '0')}-${hd.padStart(2, '0')}`).toBe((line.leave_date as string).slice(5));
      expect(isWorking(line.leave_date as string)).toBe(true);
    });
  }
});

describe('a card that declares workingDays is refused when it cannot keep to them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scenario-working-days-'));
  const areas = readCapabilityAreas(AREAS_DIR);
  const refusalsOf = (edit: (card: Record<string, any>) => void): string[] => {
    const card = structuredClone(leave.card) as Record<string, any>;
    edit(card);
    const file = join(dir, 'leave_balances.json');
    writeFileSync(file, JSON.stringify(card, null, 2));
    return loadScenarioFile(file, { areas, library: 'open' }).refusals.map(formatRefusal);
  };

  it('a weekend date other than its today', () => {
    expect(refusalsOf(() => {})).toEqual([]);
    const refused = refusalsOf((c) => {
      c.run.seed.leave_day[0].leave_date = '2026-07-04';
    });
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain(': run.seed.leave_day[0].leave_date: ');
    expect(refused[0]).toMatch(/2026-07-04.*Saturday.*workingDays/);
    // The same date is the card's business without the declaration.
    expect(
      refusalsOf((c) => {
        c.run.seed.leave_day[0].leave_date = '2026-07-04';
        delete c.workingDays;
      }).filter((x) => /workingDays/.test(x)),
    ).toEqual([]);
  });

  it('a weekend asOf: it would count as the Friday before it, and land on the run date with that Friday', () => {
    const refused = refusalsOf((c) => {
      c.asOf = '2026-10-03';
    });
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain(': asOf: ');
    expect(refused[0]).toMatch(/2026-10-03.*Saturday.*workingDays/);
  });

  it('no asOf to count the working days from', () => {
    const refused = refusalsOf((c) => {
      delete c.asOf;
    });
    expect(refused.some((x) => /workingDays.*needs `asOf`/.test(x))).toBe(true);
  });

  it('cleans up', () => {
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('a weekend asOf on a workingDays card would put two dates on one day: refused before it can', () => {
  // A Saturday asOf (2026-11-14) beside a Friday (2026-11-13), run on Wednesday 2026-11-18: counted as
  // its Friday, the move is 3 working days, the Friday goes to 11-18 and asOf goes to 11-18 too, so
  // "yesterday" and "today" become one date and a count over dates moves.
  const friday = '2026-11-13';
  const card = structuredClone(leave.card);
  card.asOf = '2026-11-14';
  card.run.seed.leave_day[0].leave_date = friday;
  const weekendToday: LoadedScenario = { ...leave, card };

  it('the rebase refuses it rather than map the Friday and asOf onto the same run date', () => {
    expect(() => rebaseScenario(weekendToday, '2026-11-18')).toThrow(/asOf 2026-11-14 is a weekend/);
    // The collision it prevents: counted from the Friday, the Friday itself moves onto the run date.
    expect(shiftWorkingDays(friday, workingDaysBetween('2026-11-14', '2026-11-18'))).toBe('2026-11-18');
  });

  it('the loader refuses the same card first, at asOf', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-weekend-asof-'));
    try {
      const file = join(dir, 'leave_balances.json');
      writeFileSync(file, JSON.stringify(card, null, 2));
      const refused = loadScenarioFile(file, { areas: readCapabilityAreas(AREAS_DIR), library: 'open' }).refusals.map(formatRefusal);
      expect(refused.filter((r) => r.includes(': asOf: '))).toHaveLength(1);
      expect(refused.filter((r) => /workingDays/.test(r))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
