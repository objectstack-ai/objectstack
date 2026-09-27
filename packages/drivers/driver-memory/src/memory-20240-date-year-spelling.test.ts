// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20240] A `Date` or an epoch-millisecond number whose UTC year is 0..999 is
 * put in a `date` column's form with a four-digit year — `0999-06-15` — by
 * `@objectstack/core`'s `temporalStorageForm`, the rule `coerceTemporalValue`
 * calls on `where` and on write. That is the spelling the ISO string and the
 * bare day of the same instant already took.
 *
 * Measured on the base through this driver's `find()`, and through the engine
 * and `POST /api/v1/data/:object/query` over it (which reach the same
 * coercion), on six 2026 days plus 0999-06-15: the number and the `Date` for
 * 0999-06-15 spelled `999-06-15`, which sorts above every padded day as text,
 * so `$gt` / `$lt` / `$eq` counted 0 / 7 / 0 where the ISO string counted
 * 6 / 0 / 1. A direct `create` / `update` of either stored `999-06-15`, which no
 * `0999-06-15` comparand then matched.
 *
 * A year below 0 or above 9999 is refused as a comparand one layer up, at the
 * engine's temporal-comparand door (`@objectstack/objectql`); this driver's
 * `where` is not that door, so it is not pinned here.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';

const OBJECT = 'ledger_year';
const WRITES = 'ledger_year_writes';
const FIELDS = { placed_on: { type: 'date' }, opened_at: { type: 'datetime' } };

const ROWS = [
  { id: 'o1', placed_on: '2026-01-10', opened_at: '2026-01-01T10:00:00.000Z' },
  { id: 'o2', placed_on: '2026-01-02', opened_at: '2026-01-02T10:00:00.000Z' },
  { id: 'o3', placed_on: '2026-03-01', opened_at: '2026-02-01T10:00:00.000Z' },
  { id: 'o4', placed_on: '2026-02-01', opened_at: '2026-02-05T10:00:00.000Z' },
  { id: 'o5', placed_on: '2026-01-15', opened_at: '2026-02-06T10:00:00.000Z' },
  { id: 'o6', placed_on: '2026-02-01', opened_at: '2026-03-01T10:00:00.000Z' },
  { id: 'o7', placed_on: '0999-06-15', opened_at: '2026-04-01T10:00:00.000Z' },
];

const Y0999 = -30627504000000; // 0999-06-15T00:00:00.000Z
const Y0099 = Date.parse('0099-03-04T00:00:00.000Z');
const Y0009 = Date.parse('0009-03-04T00:00:00.000Z');
const N = 1769940000000; //       2026-02-01T10:00:00.000Z — the control

const ALL = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];

/** day · operator · ids — one answer for the number, its `Date` and its ISO string */
const CELLS: ReadonlyArray<readonly [string, number, string, string[]]> = [
  ['0999-06-15', Y0999, '$gt', ['o1', 'o2', 'o3', 'o4', 'o5', 'o6']],
  ['0999-06-15', Y0999, '$lt', []],
  ['0999-06-15', Y0999, '$eq', ['o7']],
  ['0999-06-15', Y0999, '$gte', ALL],
  ['0999-06-15', Y0999, '$ne', ['o1', 'o2', 'o3', 'o4', 'o5', 'o6']],
  ['0099-03-04', Y0099, '$lt', []],
  ['0009-03-04', Y0009, '$gt', ALL],
  ['2026-02-01 (control)', N, '$gt', ['o3']],
  ['2026-02-01 (control)', N, '$lt', ['o1', 'o2', 'o5', 'o7']],
  ['2026-02-01 (control)', N, '$eq', ['o4', 'o6']],
];

describe('[#20240] a date field\'s year is four digits — the number, the Date and the ISO string agree', () => {
  let driver: InMemoryDriver;
  const ids = async (object: string, where: FilterCondition) =>
    (await driver.find(object, { where })).map((r) => r.id).sort();

  beforeAll(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    for (const name of [OBJECT, WRITES]) await driver.syncSchema(name, { name, fields: FIELDS });
    for (const row of ROWS) await driver.create(OBJECT, { ...row });
  });

  for (const [day, ms, op, expected] of CELLS) {
    it(`${day} ${op}: ${expected.join(', ') || 'no row'}, for the number, its Date and its ISO string`, async () => {
      expect(await ids(OBJECT, { placed_on: { [op]: ms } }), 'number').toEqual(expected);
      expect(await ids(OBJECT, { placed_on: { [op]: new Date(ms) } }), 'Date').toEqual(expected);
      expect(await ids(OBJECT, { placed_on: { [op]: new Date(ms).toISOString() } }), 'ISO string').toEqual(expected);
    });
  }

  it('$in and $between read each member the same way', async () => {
    expect(await ids(OBJECT, { placed_on: { $in: [Y0999, N] } })).toEqual(['o4', 'o6', 'o7']);
    expect(await ids(OBJECT, { placed_on: { $between: [new Date(Y0999), N] } }))
      .toEqual(['o1', 'o2', 'o4', 'o5', 'o6', 'o7']);
  });

  it('the write path stores the four-digit year — create and update, a number and a Date', async () => {
    const read = async (id: string) => (await driver.findOne(WRITES, { where: { id } }))?.placed_on;
    await driver.create(WRITES, { id: 'w1', placed_on: Y0999 });
    await driver.create(WRITES, { id: 'w2', placed_on: new Date(Y0999) });
    expect(await read('w1')).toBe('0999-06-15');
    expect(await read('w2')).toBe('0999-06-15');
    await driver.update(WRITES, 'w1', { placed_on: Date.parse('0009-03-04T00:00:00.000Z') });
    expect(await read('w1')).toBe('0009-03-04');
    // …so the stored day and a comparand for it are one text.
    expect(await ids(WRITES, { placed_on: { $eq: '0999-06-15' } })).toEqual(['w2']);
  });
});
