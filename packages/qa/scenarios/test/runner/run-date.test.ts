// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A card's dates rebased onto the run date (`src/runner/run-date.ts`): the
 * prompt's "today", the seeded rows, the timestamps the app's real clock
 * stamps and the grader's expectations agree however long after the card's
 * `asOf` the run is. One whole-day delta moves every date; the arithmetic is
 * proved over a month end, Feb 28/29 in a non-leap and a leap year, and a year
 * boundary, and every truth is checked against an independent reading of the
 * unmoved seed.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { formatRefusal, loadScenarios, readCapabilityAreas, truthsOver, type LoadedScenario } from '../../src/loader.js';
import { operationPrompt, questionPrompt } from '../../src/runner/prompts.js';
import { daysBetween, rebaseScenario, shiftDate, shiftTextDates } from '../../src/runner/run-date.js';
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
    it(`run on ${runDate}: today is the run date, every date moves by one delta, and every truth matches the unmoved seed read the same way`, () => {
      for (const s of dated) {
        const days = daysBetween(s.card.asOf!, runDate);
        const r = rebaseScenario(s, runDate);
        expect(r.card.asOf, s.card.id).toBe(runDate);
        for (const q of r.card.run.questions) expect(questionPrompt(r, q.id)).toContain(`Today is ${runDate}.`);
        for (const op of r.card.run.operations) expect(operationPrompt(r.card, op.id)).toContain(`Today is ${runDate}.`);

        // Every ISO date leaf under run and iterate moved by exactly `days`; nothing else moved but ask text.
        for (const part of ['run', 'iterate'] as const) {
          const before = leaves(s.card[part]);
          const after = new Map(leaves(r.card[part]));
          expect(after.size).toBe(before.length);
          for (const [path, v] of before) {
            const now = after.get(path);
            if (typeof v === 'string' && ISO.test(v)) expect(now, `${s.card.id} ${path}`).toBe(shiftDate(v, days));
            else if (!/\/ask\/(en|zh)$/.test(path)) expect(now, `${s.card.id} ${path}`).toEqual(v);
          }
        }
        // The card file's own copy is untouched.
        expect(s.card.asOf).not.toBe(runDate);

        // The truths: each one again from the UNMOVED seed, with every date filter moved back by the
        // delta instead — a calendar window becomes the range around the moved today, read back.
        const back: typeof s.card = structuredClone(s.card);
        for (const q of back.run.questions) {
          if (q.truth.kind === 'unanswerable' || !q.truth.filter) continue;
          q.truth.filter = q.truth.filter.flatMap((f): Filter[] => {
            if (f.op === 'in_window') {
              const [from, to] = windowRange(f.value as Window, runDate);
              return [
                { field: f.field, op: 'gte', value: shiftDate(from, -days) },
                { field: f.field, op: 'lte', value: shiftDate(to, -days) },
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

    const l = rebaseScenario(leave, runDate);
    const file = l.card.run.operations.find((o) => o.id === 'file_and_submit_from_text')!;
    expect([file.values?.start_date, file.values?.end_date]).toEqual(['2026-12-13', '2026-12-14']);
    expect(file.ask.en).toContain('on Sunday 13 December and the morning of Monday 14 December');
    expect(file.ask.zh).toContain('12 月 13 日(周日)我请一天年假,14 日(周一)上午再请半天');
    const half = l.card.run.operations.find((o) => o.id === 'half_day_on_draft')!;
    expect(half.ask.en).toContain('(5 December)');
    expect(half.ask.zh).toContain('(12 月 5 日)');
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
