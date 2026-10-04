// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20176] This driver's `where` reads a temporal comparand by the ONE storage
 * rule — `@objectstack/core`'s `temporalStorageForm` — that `driver-sql` and the
 * engine's per-aggregation `filter` / `having` read too.
 *
 * Two halves:
 *
 * 1. `coerceTemporalValue` IS that rule, shape for shape, with a list mapped
 *    member by member. This file used to carry its own copy
 *    (`storageDatetimeValue` / `storageDateValue` / `storageTimeValue`); the
 *    copy and `driver-sql`'s agreed on every shape measured when the rule was
 *    lifted, so the re-pointing moved no answer.
 * 2. The `where` answers the engine's per-aggregation `filter` is now held to —
 *    the #20176 card's rows on its fixture. `@objectstack/objectql`'s
 *    `engine-aggregate-temporal-storage-rule.test.ts` asserts the same numbers
 *    for the per-aggregation position; this is the control half, on this
 *    driver (`driver-sql`'s twin is the REST suite
 *    `aggregation-filter-temporal-storage-rule.test.ts`).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { temporalStorageForm } from '@objectstack/core';
import { lowerFilterCondition, type FilterCondition } from '@objectstack/spec/data';
import { coerceTemporalValue } from './memory-temporal.js';
import { InMemoryDriver } from './memory-driver.js';

const SHAPES: ReadonlyArray<readonly [string, () => unknown]> = [
  ['Date', () => new Date('2026-02-01T10:00:00.000Z')],
  ['Invalid Date', () => new Date('nope')],
  ['epoch ms', () => 1769940000000],
  ['epoch ms string', () => '1769940000000'],
  ['bare day', () => '2026-02-01'],
  ['zone-naive', () => '2026-02-01 09:00'],
  ['ISO instant', () => '2026-02-01T10:00:00Z'],
  ['offset instant', () => '2026-02-01T18:00:00+08:00'],
  ['wall clock', () => '09:00'],
  ['wall clock .5', () => '09:00:00.5'],
  ['out-of-range wall clock', () => '25:00'],
  ['junk', () => 'not-a-date'],
  ['empty', () => ''],
  ['null', () => null],
  ['boolean', () => true],
];

describe('[#20176] coerceTemporalValue is core\'s temporalStorageForm', () => {
  for (const kind of ['datetime', 'date', 'time'] as const) {
    for (const [name, make] of SHAPES) {
      it(`${kind}: ${name}`, () => {
        expect(coerceTemporalValue(make(), kind)).toStrictEqual(temporalStorageForm(make(), kind));
      });
    }
    it(`${kind}: a list comparand is mapped member by member`, () => {
      const list = SHAPES.map(([, make]) => make());
      expect(coerceTemporalValue(list, kind)).toStrictEqual(list.map((v) => temporalStorageForm(v, kind)));
    });
  }

  it('a non-temporal field passes through untouched', () => {
    const value = '2026-02-01T10:00:00Z';
    expect(coerceTemporalValue(value, undefined)).toBe(value);
  });
});

const OBJECT = 'ledger_order';
const ROWS = [
  { id: 'o1', placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z', slot: '09:00:00' },
  { id: 'o2', placed_on: '2026-01-02', opened_at: '2026-01-02T10:00:00.000Z', slot: '10:30:00' },
  { id: 'o3', placed_on: '2026-03-01', opened_at: '2026-02-01T10:00:00.000Z', slot: '11:00:00' },
  { id: 'o4', placed_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z', slot: '12:00:00' },
  { id: 'o5', placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z', slot: '13:00:00' },
  { id: 'o6', placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z', slot: '14:00:00' },
];

/** The #20176 card's rows, as a `where`, with the count this driver answers. */
const CARD_WHERE_TWINS: ReadonlyArray<readonly [string, () => FilterCondition, number]> = [
  ['row 1 — an ISO instant $gte on a date field', () => ({ placed_on: { $gte: '2026-02-01T00:00:00.000Z' } }), 3],
  ['row 2 — an ISO instant $eq on a date field', () => ({ placed_on: { $eq: '2026-02-01T00:00:00.000Z' } }), 2],
  ['row 3 — a bare day as the $lte of a datetime', () => ({ opened_at: { $lte: '2026-02-01' } }), 3],
  ['row 4 — a bare day as the $between max of a datetime', () => ({ opened_at: { $between: ['2026-01-01', '2026-02-01'] } }), 3],
  ['row 5 — an epoch-ms bound on a datetime', () => ({ opened_at: { $gt: 1769940000000 } }), 3],
  ['row 6 — a Date with a time of day, $gte on a date field', () => ({ placed_on: { $gte: new Date('2026-02-01T10:00:00.000Z') } }), 3],
  ['row 6 — the same Date, $lt', () => ({ placed_on: { $lt: new Date('2026-02-01T10:00:00.000Z') } }), 3],
  ['row 6 — the same Date, $eq', () => ({ placed_on: { $eq: new Date('2026-02-01T10:00:00.000Z') } }), 2],
  ['row 7 — a Date on a time field', () => ({ slot: { $gt: new Date('2026-02-01T11:00:00.000Z') } }), 3],
  ['control — a zone-naive datetime string', () => ({ opened_at: { $gt: '2026-02-01 09:00' } }), 4],
  // [#20480] The 2026 control beside the engine's refusal of an instant with
  // no four-digit UTC year on a time field (`+010000-01-01T11:00:00Z`, which
  // this driver compared as text: every row for `$gt`). The same wall clock in
  // 2026, in each spelling the door admits, keeps its UTC time of day here.
  ['[#20480] a 2026 instant $gt on a time field — the control', () => ({ slot: { $gt: '2026-02-01T11:00:00Z' } }), 3],
  ['[#20480] the same instant, $lt', () => ({ slot: { $lt: '2026-02-01T11:00:00Z' } }), 2],
  ['[#20480] the same instant with an offset', () => ({ slot: { $gt: '2026-02-01T19:00:00+08:00' } }), 3],
  ['[#20480] the same instant as epoch milliseconds', () => ({ slot: { $gt: Date.parse('2026-02-01T11:00:00Z') } }), 3],
];

/** The declared field map the twins run against — what a typed seam reads. */
const LEDGER_FIELDS: Record<string, { type: string }> = {
  placed_on: { type: 'date' },
  opened_at: { type: 'datetime' },
  slot: { type: 'time' },
};

/**
 * [#20822 · ADR-0053 D-D1 items 5, 7 and 9, as amended] What a TYPED seam hands
 * this driver: the twin through the shared lowering, reading
 * {@link LEDGER_FIELDS}' `datetime` columns. Rows 3 and 4 (a bare day as a
 * datetime's upper bound) are answered by the lowered filter, as on every
 * seam-fed path — the engine's per-aggregation `filter` included — since this
 * driver keeps no whole-day copy of its own; the counts are unchanged.
 */
const seamed = <T,>(where: T): T =>
  lowerFilterCondition(where, { isDatetimeColumn: (column) => LEDGER_FIELDS[column]?.type === 'datetime' });

describe('[#20176] the where twins of the card\'s rows, on this driver', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    await driver.syncSchema(OBJECT, {
      name: OBJECT,
      fields: LEDGER_FIELDS,
    });
    for (const row of ROWS) await driver.create(OBJECT, row);
  });

  for (const [name, where, expected] of CARD_WHERE_TWINS) {
    it(`${name}: ${expected} of 6`, async () => {
      const rows = await driver.find(OBJECT, { where: seamed(where()) });
      expect(rows).toHaveLength(expected);
    });
  }
});
