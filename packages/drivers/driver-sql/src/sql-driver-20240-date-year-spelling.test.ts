// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20240] A `Date` or an epoch-millisecond number whose UTC year is 0..999 is
 * put in a `date` column's form with a four-digit year — `0999-06-15` — by
 * `@objectstack/core`'s `temporalStorageForm`, the rule `toDateOnly` /
 * `temporalFilterValue` call on `where` and on write. That is the spelling the
 * ISO string and the bare day of the same instant already took.
 *
 * Measured on the base through `find()` (and through the engine and
 * `POST /api/v1/data/:object/query`, which reach the same coercion), on six
 * 2026 days plus 0999-06-15, for the number and the `Date` of 0999-06-15:
 *
 * | dialect | `$gt` / `$lt` / `$eq` | the ISO string | why |
 * |:--|:--|:--|:--|
 * | SQLite | 0 / 7 / 0 | 6 / 0 / 1 | `999-06-15` sorts above every padded day as TEXT (`'9' > '0'`) |
 * | PostgreSQL | 6 / 0 / 1 | 6 / 0 / 1 | the server's `DATE` parser reads `999-06-15` as year 999 |
 *
 * A direct `create` / `update` stored `999-06-15` on SQLite (PostgreSQL stored
 * the day). A shorter year is worse on PostgreSQL: under its default
 * `DateStyle` (`ISO, MDY`) the server reads `9-03-04` as 2004-09-03 — a
 * different day, stored or compared silently — and refuses `99-03-04`
 * (`22008`). The unpadded spelling was restored by ablation to measure those
 * two, since this file's 0999 fixture reads right there. Each row below asserts
 * one answer for the number, its `Date` and its ISO string, plus a 2026
 * control. A year below 0 or above 9999 is refused
 * as a comparand one layer up, at the engine's temporal-comparand door
 * (`@objectstack/objectql`); this driver's `where` is not that door.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os20240_ledger';
const WRITES = 'os20240_ledger_writes';

const shape = (name: string) => ({
  name,
  fields: { placed_on: { type: 'date' }, opened_at: { type: 'datetime' } },
}) as any;

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

const NO_AUDIT = { bypassTenantAudit: true };

function measure(cell: DialectCell): void {
  describe(`[#20240] a date field's year is four digits — ${cell.label}`, () => {
    let driver: SqlDriver;
    const ids = async (table: string, where: FilterCondition) =>
      (await driver.find(table, { where }, NO_AUDIT)).map((r) => r.id).sort();

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      for (const t of [TABLE, WRITES]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
      await driver.initObjects([shape(TABLE), shape(WRITES)]);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, NO_AUDIT);
    });

    afterAll(async () => {
      for (const t of [TABLE, WRITES]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
      await driver.disconnect();
    });

    for (const [day, ms, op, expected] of CELLS) {
      it(`${day} ${op}: ${expected.join(', ') || 'no row'}, for the number, its Date and its ISO string`, async () => {
        expect(await ids(TABLE, { placed_on: { [op]: ms } }), 'number').toEqual(expected);
        expect(await ids(TABLE, { placed_on: { [op]: new Date(ms) } }), 'Date').toEqual(expected);
        expect(await ids(TABLE, { placed_on: { [op]: new Date(ms).toISOString() } }), 'ISO string').toEqual(expected);
      });
    }

    it('$in and $between read each member the same way', async () => {
      expect(await ids(TABLE, { placed_on: { $in: [Y0999, N] } })).toEqual(['o4', 'o6', 'o7']);
      expect(await ids(TABLE, { placed_on: { $between: [new Date(Y0999), N] } }))
        .toEqual(['o1', 'o2', 'o4', 'o5', 'o6', 'o7']);
    });

    it('the write path stores the four-digit year — create and update, a number and a Date', async () => {
      const read = async (id: string) => (await driver.findOne(WRITES, { where: { id } }, NO_AUDIT))?.placed_on;
      await driver.create(WRITES, { id: 'w1', placed_on: Y0999 }, NO_AUDIT);
      await driver.create(WRITES, { id: 'w2', placed_on: new Date(Y0999) }, NO_AUDIT);
      expect(await read('w1')).toBe('0999-06-15');
      expect(await read('w2')).toBe('0999-06-15');
      await driver.update(WRITES, 'w1', { placed_on: Date.parse('0009-03-04T00:00:00.000Z') }, NO_AUDIT);
      expect(await read('w1')).toBe('0009-03-04');
      // …so the stored day and a comparand for it are one text.
      expect(await ids(WRITES, { placed_on: { $eq: '0999-06-15' } })).toEqual(['w2']);
    });
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'date year spelling', measure);
