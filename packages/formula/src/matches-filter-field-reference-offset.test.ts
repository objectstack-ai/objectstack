// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14104] `{ $field, addDays }` — a whole-day offset on a field reference,
 * evaluated in memory.
 *
 * The ruling (2026-09-02, option A) put date arithmetic ON the reference so a
 * dataset measure can say `completed_at <= due_date + duty.grace_days`, and
 * stated the NULL semantics in words rather than inheriting them from SQL: a
 * NULL offset column contributes ZERO days; a NULL referenced column makes the
 * comparison FALSE — for every operator, `$ne` included — so `$not` re-admits
 * it. This face is the reference implementation the SQL compiler is held to,
 * so its pins are stated against DECLARED id sets, never against the driver.
 *
 * The rows are the offset fixture of `@objectstack/driver-sql`'s
 * `cross-field-conformance-cases.ts`, copied here by value: this package is a
 * dependency of that one, so it cannot import the corpus, and the two driver
 * suites hold this evaluator to the SAME rows on every case — a drift between
 * this copy and the corpus fails there, loudly, on the row that moved.
 */

import { describe, expect, it } from 'vitest';
import { matchesFilterCondition as m } from './matches-filter';

const noon = (day: string | null) => (day === null ? null : `${day}T12:00:00.000Z`);

/**
 * | id | completed | due   | grace | due + grace | reading                                 |
 * |----|-----------|-------|-------|-------------|-----------------------------------------|
 * | 1  | 03-05     | 03-01 | 2     | 03-03       | late by two days                        |
 * | 2  | 03-03     | 03-01 | 2     | 03-03       | on the last day of grace (equality)     |
 * | 3  | 03-01     | 03-05 | 0     | 03-05       | early; zero grace                       |
 * | 4  | 03-05     | 03-01 | NULL  | 03-01       | NULL grace = zero days: late            |
 * | 5  | NULL      | 03-01 | 2     | 03-03       | never completed, deadline exists        |
 * | 6  | 03-05     | NULL  | 2     | —           | NO DEADLINE: every comparison is false  |
 * | 7  | NULL      | NULL  | NULL  | —           | nothing at all                          |
 * | 8  | 03-10     | 03-01 | -3    | 02-26       | negative grace tightens the deadline    |
 * | 9  | 02-27     | 03-01 | -3    | 02-26       | inside the plain due date, outside -3   |
 */
const DAYS: ReadonlyArray<{ id: string; completed_on: string | null; due_on: string | null; grace_days: number | null }> = [
  { id: '1', completed_on: '2026-03-05', due_on: '2026-03-01', grace_days: 2 },
  { id: '2', completed_on: '2026-03-03', due_on: '2026-03-01', grace_days: 2 },
  { id: '3', completed_on: '2026-03-01', due_on: '2026-03-05', grace_days: 0 },
  { id: '4', completed_on: '2026-03-05', due_on: '2026-03-01', grace_days: null },
  { id: '5', completed_on: null,         due_on: '2026-03-01', grace_days: 2 },
  { id: '6', completed_on: '2026-03-05', due_on: null,         grace_days: 2 },
  { id: '7', completed_on: null,         due_on: null,         grace_days: null },
  { id: '8', completed_on: '2026-03-10', due_on: '2026-03-01', grace_days: -3 },
  { id: '9', completed_on: '2026-02-27', due_on: '2026-03-01', grace_days: -3 },
];

const ROWS = DAYS.map((r) => ({
  ...r,
  completed_at: noon(r.completed_on),
  due_at: noon(r.due_on),
  // The dotted spelling of the ruling's driving shape: the grace lives on the
  // related duty, which the memory evaluator walks (SQL push-down refuses it,
  // by the 2026-08-06 same-table ruling — a loud asymmetry, pinned there).
  duty: { grace_days: r.grace_days },
}));

const ids = (filter: unknown): string[] =>
  ROWS.filter((r) => m(r, filter as never)).map((r) => r.id).sort();

const GRACE = { $field: 'grace_days' };
const shifted = (base: string, addDays: unknown) => ({ $field: base, addDays });

/** Every expectation runs on the date pair AND the datetime pair — class-independent. */
const PAIRS = [
  { label: 'date', target: 'completed_on', base: 'due_on' },
  { label: 'datetime', target: 'completed_at', base: 'due_at' },
] as const;

describe.each(PAIRS)('[#14104] addDays on the $label pair', ({ target, base }) => {
  it('a COLUMN offset — completed <= due + grace_days (the duly shape)', () => {
    expect(ids({ [target]: { $lte: shifted(base, GRACE) } })).toEqual(['2', '3']);
  });

  it('a DOT-PATH column offset walks the relation exactly as `$field` does', () => {
    expect(ids({ [target]: { $lte: shifted(base, { $field: 'duty.grace_days' }) } })).toEqual(['2', '3']);
  });

  it('a positive literal offset', () => {
    expect(ids({ [target]: { $lte: shifted(base, 5) } })).toEqual(['1', '2', '3', '4', '9']);
  });

  it('a NEGATIVE literal offset subtracts — the only subtraction there is', () => {
    expect(ids({ [target]: { $lte: shifted(base, -1) } })).toEqual(['3', '9']);
  });

  it('a zero offset equals the bare reference (the offset-free control)', () => {
    expect(ids({ [target]: { $lte: shifted(base, 0) } })).toEqual(['3', '9']);
    expect(ids({ [target]: { $lte: { $field: base } } })).toEqual(['3', '9']);
  });

  it('the other operators, with the column offset', () => {
    expect(ids({ [target]: { $lt: shifted(base, GRACE) } })).toEqual(['3']);
    expect(ids({ [target]: { $gt: shifted(base, GRACE) } })).toEqual(['1', '4', '8', '9']);
    expect(ids({ [target]: { $gte: shifted(base, GRACE) } })).toEqual(['1', '2', '4', '8', '9']);
    expect(ids({ [target]: { $eq: shifted(base, GRACE) } })).toEqual(['2']);
    expect(ids({ [target]: { $ne: shifted(base, GRACE) } })).toEqual(['1', '3', '4', '5', '8', '9']);
  });

  it('a NULL offset column contributes ZERO days (row 4)', () => {
    // Row 4: completed 03-05, due 03-01, grace NULL → deadline 03-01 → late.
    expect(ids({ [target]: { $gt: shifted(base, GRACE) } })).toContain('4');
    expect(ids({ [target]: { $lte: shifted(base, GRACE) } })).not.toContain('4');
  });

  it('a NULL referenced column makes the comparison FALSE for every operator (rows 6, 7)', () => {
    for (const op of ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']) {
      const set = ids({ [target]: { [op]: shifted(base, GRACE) } });
      expect(set, op).not.toContain('6');
      expect(set, op).not.toContain('7');
    }
    // …and so `$not` re-admits exactly those rows: the predicate is total.
    expect(ids({ $not: { [target]: { $lte: shifted(base, GRACE) } } })).toEqual(['1', '4', '5', '6', '7', '8', '9']);
    expect(ids({ $not: { [target]: { $eq: shifted(base, GRACE) } } })).toEqual(['1', '3', '4', '5', '6', '7', '8', '9']);
    expect(ids({ $not: { [target]: { $ne: shifted(base, GRACE) } } })).toEqual(['2', '6', '7']);
  });

  it('a NULL TARGET keeps its ordinary reading: fails the orderings and $eq, satisfies $ne', () => {
    // Row 5: never completed, deadline 03-03.
    expect(ids({ [target]: { $lte: shifted(base, GRACE) } })).not.toContain('5');
    expect(ids({ [target]: { $eq: shifted(base, GRACE) } })).not.toContain('5');
    expect(ids({ [target]: { $ne: shifted(base, GRACE) } })).toContain('5');
  });

  it('the NULL-base rule with the roles swapped', () => {
    expect(ids({ [base]: { $lte: shifted(target, 10) } })).toEqual(['1', '2', '3', '4', '8', '9']);
    expect(ids({ [base]: { $ne: shifted(target, 10) } })).toEqual(['1', '2', '3', '4', '6', '8', '9']);
  });

  it('composes under $or, AND and nested combinators', () => {
    expect(ids({ $or: [{ [target]: { $lte: shifted(base, GRACE) } }, { [target]: null }] })).toEqual(['2', '3', '5', '7']);
    expect(ids({ [target]: { $lte: shifted(base, GRACE) }, grace_days: { $gt: 0 } })).toEqual(['2']);
    expect(ids({
      $and: [{ $or: [{ [target]: { $gt: shifted(base, GRACE) } }, { [target]: null }] }, { $not: { grace_days: null } }],
    })).toEqual(['1', '5', '8', '9']);
  });
});

describe('[#14104] the shape of the shifted value', () => {
  it('a calendar day stays a calendar day, so a `$lte` still covers the whole shifted day', () => {
    // A `date` deadline shifted by one day is 03-02 (the whole day), so a
    // datetime completion at 23:59 on 03-02 is still on time — the #3777
    // half-open rule the bare bound already has.
    const rec = { done: '2026-03-02T23:59:00.000Z', due: '2026-03-01' };
    expect(m(rec, { done: { $lte: { $field: 'due', addDays: 1 } } })).toBe(true);
    expect(m(rec, { done: { $lte: { $field: 'due', addDays: 0 } } })).toBe(false);
  });

  it('an instant keeps its time of day', () => {
    const rec = { done: '2026-03-03T12:00:00.000Z', due: '2026-03-01T12:00:00.000Z' };
    expect(m(rec, { done: { $eq: { $field: 'due', addDays: 2 } } })).toBe(true);
    expect(m(rec, { done: { $eq: { $field: 'due', addDays: 1 } } })).toBe(false);
  });

  it('a Date object and an epoch number shift the same way', () => {
    const due = new Date('2026-03-01T12:00:00.000Z');
    expect(m({ done: new Date('2026-03-03T12:00:00.000Z'), due }, { done: { $eq: { $field: 'due', addDays: 2 } } })).toBe(true);
    expect(m({ done: due.getTime() + 2 * 86_400_000, due: due.getTime() }, { done: { $eq: { $field: 'due', addDays: 2 } } })).toBe(true);
  });

  it('crosses a month boundary on the calendar, not by adding to the day number', () => {
    expect(m({ done: '2026-02-26', due: '2026-03-01' }, { done: { $eq: { $field: 'due', addDays: -3 } } })).toBe(true);
    expect(m({ done: '2026-04-01', due: '2026-03-31' }, { done: { $eq: { $field: 'due', addDays: 1 } } })).toBe(true);
  });

  it('a fractional offset VALUE truncates toward zero — the reading every SQL dialect arm applies', () => {
    const rec = { done: '2026-03-03', due: '2026-03-01', grace: 2.9, neg: -2.9 };
    expect(m(rec, { done: { $eq: { $field: 'due', addDays: { $field: 'grace' } } } })).toBe(true);
    expect(m({ ...rec, done: '2026-02-27' }, { done: { $eq: { $field: 'due', addDays: { $field: 'neg' } } } })).toBe(true);
  });

  it('fails CLOSED on an offset that is not a number, and on a base that is not a date', () => {
    expect(m({ done: '2026-03-03', due: '2026-03-01', grace: 'soon' }, { done: { $lte: { $field: 'due', addDays: { $field: 'grace' } } } })).toBe(false);
    expect(m({ done: '2026-03-03', due: 'whenever' }, { done: { $gte: { $field: 'due', addDays: 1 } } })).toBe(false);
    // …and `$ne` fails closed too: an unreadable deadline is no deadline.
    expect(m({ done: '2026-03-03', due: 'whenever' }, { done: { $ne: { $field: 'due', addDays: 1 } } })).toBe(false);
  });
});
