// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25808] `{ $now, addDays }` — the current instant shifted by whole days,
 * compared against a temporal column — on the memory evaluator, over the
 * offset fixture the `addDays` suite uses (`matches-filter-field-reference-offset.test.ts`),
 * with `$now` PINNED to the fixture's own time of day so the table below is a
 * table. The SQL twin of every row-set claim here is the conformance corpus
 * (`@objectstack/driver-sql`'s `CROSS_FIELD_NOW_CASES`), driven against the
 * real engines; this package is a dependency of that one, so the fixture is
 * restated rather than imported.
 *
 * What this file pins that the corpus cannot: the FORM the anchor is shifted
 * in is read off the stored value (this evaluator has no column declaration),
 * the own-clock arm (`$now: true`), and the fail-closed arms.
 */

import { describe, expect, it } from 'vitest';
import { matchesFilterCondition as m } from './matches-filter';

const noon = (day: string | null) => (day === null ? null : `${day}T12:00:00.000Z`);

/** NOW is 03-03 at 12:00:00.000Z; `now + grace_days` per row is in the corpus's table. */
const NOW = '2026-03-03T12:00:00.000Z';

const DAYS: ReadonlyArray<{ id: string; completed_on: string | null; grace_days: number | null }> = [
  { id: '1', completed_on: '2026-03-05', grace_days: 2 },
  { id: '2', completed_on: '2026-03-03', grace_days: 2 },
  { id: '3', completed_on: '2026-03-01', grace_days: 0 },
  { id: '4', completed_on: '2026-03-05', grace_days: null },
  { id: '5', completed_on: null,         grace_days: 2 },
  { id: '6', completed_on: '2026-03-05', grace_days: 2 },
  { id: '7', completed_on: null,         grace_days: null },
  { id: '8', completed_on: '2026-03-10', grace_days: -3 },
  { id: '9', completed_on: '2026-02-27', grace_days: -3 },
];

const ROWS = DAYS.map((r) => ({
  ...r,
  completed_at: noon(r.completed_on),
  // The dotted spelling: an SLA held on the related record, which this
  // evaluator walks as it walks a dotted `$field` (SQL push-down refuses it).
  duty: { sla_days: r.grace_days },
}));

const ids = (filter: unknown): string[] =>
  ROWS.filter((r) => m(r, filter as never)).map((r) => r.id).sort();

const GRACE = { $field: 'grace_days' };
const anchored = (addDays: unknown, at: unknown = NOW) => ({ $now: at, addDays });

const PAIRS = [
  { label: 'date', target: 'completed_on' },
  { label: 'datetime', target: 'completed_at' },
] as const;

describe.each(PAIRS)('[#25808] a now-anchored comparand on the $label column', ({ target }) => {
  it('a COLUMN offset — completed <= now + grace_days', () => {
    expect(ids({ [target]: { $lte: anchored(GRACE) } })).toEqual(['1', '2', '3', '6', '9']);
  });

  it('the ruling\'s SLA shape — "more than N days ago" is a NEGATIVE offset; a column holds its sign', () => {
    expect(ids({ [target]: { $lt: anchored(-3) } })).toEqual(['9']);
    // The same test with the days read off the row: rows 8 and 9 hold -3.
    expect(ids({ [target]: { $lt: anchored(GRACE) } })).toEqual(['2', '3', '9']);
  });

  it('a dotted column offset walks the relation, as a dotted `$field` does', () => {
    expect(ids({ [target]: { $lte: anchored({ $field: 'duty.sla_days' }) } })).toEqual(['1', '2', '3', '6', '9']);
  });

  it('the other operators, with a literal offset of 0', () => {
    expect(ids({ [target]: { $gte: anchored(0) } })).toEqual(['1', '2', '4', '6', '8']);
    expect(ids({ [target]: { $gt: anchored(0) } })).toEqual(['1', '4', '6', '8']);
    expect(ids({ [target]: { $lt: anchored(0) } })).toEqual(['3', '9']);
    expect(ids({ [target]: { $eq: anchored(0) } })).toEqual(['2']);
    expect(ids({ [target]: { $ne: anchored(0) } })).toEqual(['1', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('a NULL offset column contributes ZERO days (row 4)', () => {
    expect(ids({ id: '4', [target]: { $gt: anchored(GRACE) } })).toEqual(['4']);
    expect(ids({ id: '4', [target]: { $gt: anchored(0) } })).toEqual(['4']);
  });

  it('a NULL target fails the orderings and $eq, satisfies $ne — the anchor is never NULL', () => {
    for (const op of ['$eq', '$gt', '$gte', '$lt', '$lte']) {
      expect(ids({ id: { $in: ['5', '7'] }, [target]: { [op]: anchored(GRACE) } }), op).toEqual([]);
    }
    expect(ids({ id: { $in: ['5', '7'] }, [target]: { $ne: anchored(GRACE) } })).toEqual(['5', '7']);
  });

  it('$not takes exactly the complement, NULL targets re-admitted', () => {
    expect(ids({ $not: { [target]: { $lte: anchored(GRACE) } } })).toEqual(['4', '5', '7', '8']);
  });

  it('composes under $or, AND and nested combinators', () => {
    expect(ids({ [target]: { $lte: anchored(GRACE) }, grace_days: { $gt: 0 } })).toEqual(['1', '2', '6']);
    expect(ids({
      $and: [{ $or: [{ [target]: { $gt: anchored(GRACE) } }, { [target]: null }] }, { $not: { grace_days: null } }],
    })).toEqual(['5', '8']);
  });
});

describe('[#25808] the form the anchor is shifted in is the STORED value\'s', () => {
  it('a calendar-day value meets the instant\'s UTC calendar day — the time of day is dropped, never rounded', () => {
    // 18:30Z is still 03-03 in UTC: row 2 (03-03) is on or after it.
    expect(ids({ completed_on: { $gte: anchored(0, '2026-03-03T18:30:00.000Z') } })).toEqual(['1', '2', '4', '6', '8']);
    // 23:59:59.999Z is still 03-03.
    expect(ids({ completed_on: { $eq: anchored(0, '2026-03-03T23:59:59.999Z') } })).toEqual(['2']);
    // …and 00:00:00.000Z of the next day is not.
    expect(ids({ completed_on: { $eq: anchored(0, '2026-03-04T00:00:00.000Z') } })).toEqual([]);
  });

  it('an instant value keeps the time of day', () => {
    // Row 2 is at 12:00Z on 03-03, before 18:30Z.
    expect(ids({ completed_at: { $gte: anchored(0, '2026-03-03T18:30:00.000Z') } })).toEqual(['1', '4', '6', '8']);
    expect(ids({ completed_at: { $lte: anchored(0, '2026-03-03T18:30:00.000Z') } })).toEqual(['2', '3', '9']);
  });

  it('a Date value and an epoch number meet the ISO instant, lifted to instants', () => {
    const asDate = { v: new Date('2026-03-05T12:00:00.000Z') };
    const asEpoch = { v: Date.parse('2026-03-05T12:00:00.000Z') };
    expect(m(asDate, { v: { $gt: anchored(1) } } as never)).toBe(true);
    expect(m(asDate, { v: { $gt: anchored(2) } } as never)).toBe(false);
    expect(m(asDate, { v: { $eq: anchored(2) } } as never)).toBe(true);
    // A number compares numerically against a string — not lifted; false either way.
    expect(m(asEpoch, { v: { $gt: anchored(1) } } as never)).toBe(false);
  });

  it('crosses a month boundary on the calendar', () => {
    expect(ids({ completed_on: { $gte: anchored(-3) } })).toEqual(['1', '2', '3', '4', '6', '8']);
    expect(ids({ completed_on: { $eq: anchored(-4) } })).toEqual(['9']);
  });

  it('a fractional offset VALUE truncates toward zero — the reading every SQL dialect arm applies', () => {
    expect(ids({ completed_on: { $eq: anchored(2.9) } })).toEqual(['1', '4', '6']);
    expect(ids({ completed_on: { $eq: anchored(-3.9) } })).toEqual([]);
    expect(ids({ completed_on: { $eq: anchored(-4.9) } })).toEqual(['9']);
  });
});

describe('[#25808] the own-clock arm and the fail-closed arms', () => {
  it('`$now: true` reads the evaluator\'s own clock', () => {
    const before = Date.now();
    const row = { at: new Date(before - 1000).toISOString() };
    expect(m(row, { at: { $lt: { $now: true, addDays: 0 } } } as never)).toBe(true);
    expect(m(row, { at: { $gt: { $now: true, addDays: -1 } } } as never)).toBe(true);
    expect(m(row, { at: { $gt: { $now: true, addDays: 1 } } } as never)).toBe(false);
  });

  it('an anchor without addDays fails CLOSED for every operator — `{now}` is the spelling for the bare instant', () => {
    for (const op of ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']) {
      expect(ids({ completed_on: { [op]: { $now: NOW } } }), op).toEqual([]);
    }
  });

  it('a $now that names no instant, and an offset that is not a number, fail CLOSED', () => {
    expect(ids({ completed_on: { $ne: anchored(0, 'soon') } })).toEqual([]);
    expect(ids({ completed_on: { $ne: anchored(0, false) } })).toEqual([]);
    expect(ids({ completed_on: { $ne: anchored('tomorrow') } })).toEqual([]);
    // A column holding text that is no number (a date) is NaN days — closed;
    // a numeric string (`id`) is read as its number, as `addDays` reads one.
    expect(ids({ id: '1', completed_on: { $ne: anchored({ $field: 'completed_on' }) } })).toEqual([]);
    expect(ids({ completed_on: { $lte: anchored({ $field: 'id' }) } })).toEqual(['2', '3', '4', '6', '8', '9']);
  });

  // [#26413] An extra key is refused at every filter door before a filter
  // reaches this evaluator (`normalizeFilterComparandTypes` in
  // `@objectstack/spec`: `INVALID_FILTER` / 400, the key named). The engine
  // calls this evaluator for `having` and the `aggregations[i].filter` rows
  // fallback, both behind that door; the CEL lowering for the RLS `check`
  // emits no anchor. So the evaluator does not judge the anchor's keys again.
  it('behind the door, the evaluator reads the anchor by SHAPE: it does not re-judge an extra key', () => {
    expect(ids({ completed_on: { $eq: { ...anchored(0), note: 'x' } } })).toEqual(['2']);
  });
});
