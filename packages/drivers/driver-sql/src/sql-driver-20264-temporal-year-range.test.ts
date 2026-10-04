// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20264] The supported years of a `date` are 0001..9999, and [#20280] of a
 * `datetime` 1000..9999, on every dialect this driver speaks. The refusal
 * outside them sits one layer up,
 * at the engine's two doors (the temporal-comparand door and the record
 * validator, both asking `@objectstack/core`'s `isOutsideTemporalYearRange`), so
 * this driver's `where` and write paths are not a door and are not pinned as
 * one. What each dialect owes the range is the other half: every year inside
 * it is STORED as the day or instant it names, and compared as it, the edges
 * included, beside a 2026 control.
 *
 * Measured on the base through the engine over this driver: a `datetime` bound
 * in year 10000 or −1 counted `$gt` / `$lt` / `$eq` 7 / 0 / 0 on SQLite and
 * answered 500 on PostgreSQL 16 (`22009` / `22007`) and MySQL 8.0; year 0
 * answered 500 on PostgreSQL on both kinds (`22008` — PostgreSQL's `DATE` and
 * `timestamptz` have no year 0); a REST create of a `date`
 * `"+010000-01-01T00:00:00.000Z"` was stored verbatim on SQLite and a 500 on
 * PostgreSQL and MySQL. The engine refuses each of those now.
 *
 * ## The one cell read-back does not assert: MySQL `DATETIME` in 0001..0099
 *
 * MySQL documents `DATETIME` from year 1000, and a `DATETIME` in years
 * 0001..0099 is stored right and read back a century late through mysql2's
 * instant parser (`0009-03-04 10:00` → `2004-09-03T10:00Z`), which ADR-0053
 * D-F2 keeps. [#20280] That is why a `datetime` begins at year 1000: the doors
 * refuse one below it now, as a written value and as a comparand. The
 * `datetime` rows below 1000 stay here on purpose — they are what a row stored
 * before that floor holds, written straight through the driver, which no door
 * fronts — and the MySQL cell asserts their STORED text. From year 0100 up
 * MySQL reads a `DATETIME` back as written, which the cell asserts; year 1000
 * is the floor's edge row.
 *
 * ## [#20549] A leap day, and the ISO spellings, beside the range
 *
 * The comparand door now refuses a day that does not exist and a `datetime`
 * string outside the ISO 8601 spellings, exactly as the write door does (one
 * rule, `@objectstack/core`'s `isUninterpretableTemporalComparand`). Measured
 * on the base, `date $eq "2026-02-30"` was a 500 on PostgreSQL 16. The refusal
 * is the engine's (`packages/objectql/src/engine-temporal-comparand-door.test.ts`,
 * and the REST door over SQLite and PostgreSQL in
 * `packages/rest/src/data-temporal-write-real-day-iso.test.ts`); what each
 * dialect owes it is the controls it stands beside: a real leap day is stored
 * and compared as that day, and each ISO spelling the door admits names the
 * same instant with the process and the server in two different zones.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os20264_ledger';

const shape = (name: string) => ({
  name,
  fields: { placed_on: { type: 'date' }, opened_at: { type: 'datetime' } },
}) as any;

/** In chronological order on both fields: the edges, four early years and a 2026 control. */
const ROWS = [
  { id: 'first', placed_on: '0001-01-01', opened_at: '0001-01-01T00:00:00.000Z' },
  { id: 'y0099', placed_on: '0099-03-04', opened_at: '0099-03-04T10:00:00.000Z' },
  { id: 'y0100', placed_on: '0100-03-04', opened_at: '0100-03-04T10:00:00.000Z' },
  { id: 'y0999', placed_on: '0999-06-15', opened_at: '0999-06-15T10:00:00.000Z' },
  // [#20280] The `datetime` floor's edge.
  { id: 'y1000', placed_on: '1000-01-01', opened_at: '1000-01-01T00:00:00.000Z' },
  { id: 'c2026', placed_on: '2026-02-01', opened_at: '2026-02-01T10:00:00.000Z' },
  // [#20549] The leap control: a February 29 that exists.
  { id: 'l2028', placed_on: '2028-02-29', opened_at: '2028-02-29T10:00:00.000Z' },
  { id: 'last', placed_on: '9999-12-31', opened_at: '9999-12-31T23:59:59.999Z' },
];
const ORDER = ROWS.map((r) => r.id);

const NO_AUDIT = { bypassTenantAudit: true };

/** knex's raw result shape differs per client; this is the only place that knows. */
function rowsOf(cell: DialectCell, res: any): any[] {
  if (cell.id === 'pg') return res?.rows ?? [];
  if (cell.id === 'mysql') return Array.isArray(res) ? (res[0] ?? []) : [];
  return Array.isArray(res) ? res : (res?.rows ?? []);
}

/** The text the server STORED for one row, by a raw cast — never the driver's read path. */
async function storedText(driver: SqlDriver, cell: DialectCell, id: string, column: string): Promise<string | null> {
  const sql =
    cell.id === 'pg'
      ? `select "${column}"::text as t from "${TABLE}" where "id" = ?`
      : cell.id === 'mysql'
        ? `select cast(\`${column}\` as char) as t from \`${TABLE}\` where \`id\` = ?`
        : `select cast("${column}" as text) as t from "${TABLE}" where "id" = ?`;
  const rows = rowsOf(cell, await driver.execute(sql, [id]));
  expect(rows, `no stored row for ${id}`).toHaveLength(1);
  return rows[0].t ?? null;
}

/** Does this cell read `opened_at` of `row` back as written? Every cell but MySQL below year 100. */
const readsBackAsWritten = (cell: DialectCell, row: (typeof ROWS)[number]) =>
  !(cell.id === 'mysql' && Number(row.opened_at.slice(0, 4)) < 100);

function measure(cell: DialectCell): void {
  describe(`[#20264] the supported years, a date 0001..9999 and a datetime 1000..9999 — ${cell.label}`, () => {
    let driver: SqlDriver;
    const ids = async (where: FilterCondition) =>
      (await driver.find(TABLE, { where }, NO_AUDIT)).map((r) => r.id as string)
        .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.initObjects([shape(TABLE)]);
      for (const row of ROWS) await driver.create(TABLE, { ...row }, NO_AUDIT);
    });

    afterAll(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver.disconnect();
    });

    it('a date in every year of the range is stored as that day and read back as written', async () => {
      for (const row of ROWS) {
        expect(await storedText(driver, cell, row.id, 'placed_on'), `stored ${row.id}`).toBe(row.placed_on);
        expect((await driver.findOne(TABLE, { where: { id: row.id } }, NO_AUDIT))?.placed_on, `read ${row.id}`).toBe(row.placed_on);
      }
    });

    it('a datetime in every year of the range, and one stored before its floor, is stored as that instant, and read back as written save the MySQL 0001..0099 cell', async () => {
      for (const row of ROWS) {
        const read = (await driver.findOne(TABLE, { where: { id: row.id } }, NO_AUDIT))?.opened_at;
        if (readsBackAsWritten(cell, row)) {
          expect(read, `read ${row.id}`).toBe(row.opened_at);
        } else {
          // Stored right: the misread is the client parser's (see the module note).
          expect(await storedText(driver, cell, row.id, 'opened_at'), `stored ${row.id}`)
            .toBe(`${row.opened_at.slice(0, 10)} ${row.opened_at.slice(11, 23)}`);
        }
      }
    });

    it('[#20549] each ISO spelling the comparand door admits names the leap row\'s instant, whatever the two zones', async () => {
      for (const spelling of [
        '2028-02-29T10:00:00Z',
        '2028-02-29T10:00:00.000Z',
        '2028-02-29T18:00:00+08:00',
        '2028-02-29T05:00:00-0500',
        '2028-02-29T10:00',
        '2028-02-29 10:00',
        '2028-02-29 10:00:00.000',
      ]) {
        expect(await ids({ opened_at: { $eq: spelling } }), spelling).toEqual(['l2028']);
      }
      expect(await ids({ placed_on: { $eq: '2028-02-29' } }), 'the leap day on a date').toEqual(['l2028']);
      expect(await ids({ placed_on: { $gt: '2028-02-28', $lt: '2028-03-01' } }), 'the day between its neighbours').toEqual(['l2028']);
    });

    for (const field of ['placed_on', 'opened_at'] as const) {
      it(`${field}: each value is found by $eq and the range orders chronologically — the edges and the 2026 control`, async () => {
        for (const [i, row] of ROWS.entries()) {
          const value = row[field];
          expect(await ids({ [field]: { $eq: value } }), `${row.id} $eq`).toEqual([row.id]);
          expect(await ids({ [field]: { $gt: value } }), `${row.id} $gt`).toEqual(ORDER.slice(i + 1));
          expect(await ids({ [field]: { $lt: value } }), `${row.id} $lt`).toEqual(ORDER.slice(0, i));
        }
      });
    }
  });
}

for (const cell of DIALECT_CELLS) declareDialectCell(cell, 'temporal year range', measure);
