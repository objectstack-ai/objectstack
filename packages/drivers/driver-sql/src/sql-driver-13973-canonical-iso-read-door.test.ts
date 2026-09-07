// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13973] The read door presents ONE instant shape on EVERY dialect —
 * ADR-0053 D-F1..D-F3, declared = enforced.
 *
 * ## The contract
 *
 * For the builtin audit columns (`created_at`, `updated_at`) and every declared
 * `Field.datetime` column, `@objectstack/driver-sql`'s record read doors —
 * `find()`, `findOne()`, and the rows `create()` / `update()` return — hand out
 * the canonical instant text `YYYY-MM-DDTHH:MM:SS.sssZ`; `aggregate()` (`min` /
 * `max`, and a raw temporal group key) and `distinct()` present the same two
 * column classes the same way. A read door never hands out a JS `Date` for
 * those columns, on SQLite, Postgres or MySQL.
 *
 * ## Why this file exists next to #13567
 *
 * `sql-driver-13567-audit-stamp-materialisation.test.ts` pinned the OLD
 * asymmetry as a coverage fact: the live dialects handed `updated_at` out as a
 * `Date` and SQLite as text, and 43 of the 44 packages that call a read door
 * had only ever seen the text side — the state in which eight consumers were
 * wrong on the production default driver (#13382 in production, #13993–#13999
 * by reading). The maintainer ruled (#13973, B1 narrow, 2026-09-02) that the
 * SQLite presentation IS the contract, on every dialect. This file is that
 * contract's conformance cell on the ADR-0053 D-A3 driver axis; the #13567
 * file keeps its OCC-seam framing and now pins the same shape.
 *
 * ## Non-vacuity, per cell
 *
 * A live cell that answered text because the CLIENT already produced text
 * would prove nothing about the driver. §C reads the same row back through raw
 * knex — past every read-side presentation — and asserts the client still
 * materialises a `Date` there. That is the ruling's second clause, measured:
 * the pg / mysql2 parsers are untouched (D-F2), and the fold happened at the
 * driver's own read boundary. It is also this file's firing control: with the
 * two `formatOutput` gates back inside `if (this.isSqlite)` and the
 * `presentReadValue` arm back to `this.isSqlite ? … : value`, §A/§B go red on
 * both live cells while §C stays green — the PR that landed this records that
 * run against a real Postgres 16 and MySQL 8.0.
 *
 * The three-way zone skew (server, process, UTC pairwise different) is
 * asserted on the live cells exactly as every other matrix consumer does, so a
 * `Z` that survived only because every clock agreed cannot pass here. Every
 * declared instant carries sub-second digits, so a fold that dropped
 * milliseconds — what `String(Date)` does — would be visible too.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from './index.js';
import {
  DIALECT_CELLS,
  assertThreeWayZoneSkew,
  declareDialectCell,
  readServerZone,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/** Driver options every write here uses — this fixture is not tenant-scoped. */
const OPTS = { bypassTenantAudit: true } as any;

const TABLE = 'os13973_read_door';

/** The canonical instant text — the ONE shape every read door presents. */
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The declared `Field.datetime` instants, one per row. Each carries non-zero
 * milliseconds (a fold that truncated would be visible), and the second is a
 * duplicate of the first so `distinct()` has something to collapse.
 */
const CLOSED_AT = [
  '2026-01-10T09:00:00.123Z',
  '2026-01-10T09:00:00.123Z',
  '2026-02-14T21:30:45.678Z',
  '2026-03-01T00:00:00.001Z',
] as const;

/** `Field.date` control values — the calendar-day rule must not be disturbed. */
const DUE_ON = ['2026-01-10', '2026-01-10', '2026-02-14', '2026-03-01'] as const;

const INSTANT_COLUMNS = ['created_at', 'updated_at', 'closed_at'] as const;

/** Sorted, de-duplicated — what `distinct()` over `closed_at` must answer. */
const DISTINCT_CLOSED_AT = [...new Set<string>(CLOSED_AT)].sort();

/** The one assertion this file is about, spelled once. */
function expectCanonicalInstant(value: unknown, label: string): asserts value is string {
  expect(value, `${label}: the read door did not return the column`).toBeDefined();
  expect(value, `${label}: null`).not.toBeNull();
  expect(
    value instanceof Date,
    `${label}: the read door handed out a JS Date (${String(value)}) — ADR-0053 D-F1 rules the ` +
      `canonical text on every dialect`,
  ).toBe(false);
  expect(typeof value, `${label}: type`).toBe('string');
  expect(value, `${label}: shape`).toMatch(ISO_Z);
}

function measure(cell: DialectCell): void {
  describe(`#13973 — the read door presents one instant shape (${cell.label})`, () => {
    let driver: SqlDriver;
    let rows: any[] = [];
    const createdReturns: any[] = [];
    let updatedReturn: any;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // A live cell proves nothing unless server, process and UTC disagree —
      // the same guard every other matrix consumer runs.
      if (cell.live) assertThreeWayZoneSkew(cell, await readServerZone(cell, driver));
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      // The DDL path, so the audit columns are the ones
      // `createAuditTimestampColumn` produces (`timestamptz` on Postgres,
      // `DATETIME(3)` on MySQL, TEXT on SQLite) and `closed_at` is a declared
      // `Field.datetime` (`timestamptz` / `DATETIME(3)` / TEXT).
      await driver.initObjects([
        {
          name: TABLE,
          fields: {
            id: { type: 'text' },
            title: { type: 'string' },
            closed_at: { type: 'datetime' },
            due_on: { type: 'date' },
            amount: { type: 'number' },
          },
        },
      ] as any);
      for (const [i, iso] of CLOSED_AT.entries()) {
        // Alternate the WRITE shape — a JS `Date` and the canonical text — so
        // the read shape is shown to be independent of how the row was written.
        const closedAt = i % 2 === 0 ? new Date(iso) : iso;
        createdReturns.push(
          await driver.create(
            TABLE,
            { id: `r${i}`, title: `row ${i}`, closed_at: closedAt, due_on: DUE_ON[i], amount: i + 1 },
            OPTS,
          ),
        );
      }
      updatedReturn = await driver.update(TABLE, 'r0', { title: 'row 0 (updated)' }, OPTS);
      rows = await driver.find(TABLE, { orderBy: [{ field: 'id', order: 'asc' }] }, OPTS);
    }, 60_000);

    afterAll(async () => {
      await driver?.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver?.disconnect();
    });

    it('§0 the fixture is non-vacuous: every row came back carrying every column under test', () => {
      // Every assertion below reads these keys off these rows; a door that did
      // not select a column would let them all pass having checked nothing.
      expect(rows).toHaveLength(CLOSED_AT.length);
      for (const row of rows) {
        for (const col of [...INSTANT_COLUMNS, 'due_on'] as const) {
          expect(row[col], `${row.id}.${col} missing from the find() row`).toBeDefined();
          expect(row[col], `${row.id}.${col} is null`).not.toBeNull();
        }
      }
    });

    it('§A1 find(): the builtin audit columns are canonical ISO-Z text, never a Date', () => {
      for (const row of rows) {
        expectCanonicalInstant(row.created_at, `${row.id}.created_at`);
        expectCanonicalInstant(row.updated_at, `${row.id}.updated_at`);
        // A real, recent instant — the `Z` names UTC, not the server's or the
        // process's zone (which the skew guard made different from each other
        // and from UTC on a live cell). Ten minutes is generous for a stamp
        // written seconds ago and far below any zone offset.
        expect(
          Math.abs(Date.now() - Date.parse(row.created_at)),
          `${row.id}.created_at (${row.created_at}) is not the instant it was stamped at`,
        ).toBeLessThan(10 * 60_000);
      }
    });

    it('§A2 find(): a declared Field.datetime is canonical ISO-Z text naming the written instant, whichever shape wrote it', () => {
      for (const [i, row] of rows.entries()) {
        expectCanonicalInstant(row.closed_at, `${row.id}.closed_at`);
        expect(row.closed_at, `${row.id}.closed_at (written as ${i % 2 === 0 ? 'a Date' : 'text'})`).toBe(
          CLOSED_AT[i],
        );
      }
    });

    it('§A3 findOne(), and the rows update() and create() return, present the same shape', async () => {
      const one = await driver.findOne(TABLE, { where: { id: 'r1' } }, OPTS);
      expect(one, 'findOne returned nothing').toBeTruthy();
      for (const col of INSTANT_COLUMNS) expectCanonicalInstant(one[col], `findOne ${col}`);
      expect(one.closed_at).toBe(CLOSED_AT[1]);

      // `update()` reads the row back after the write, so its return is a
      // whole row on every dialect.
      expect(updatedReturn, 'update() returned nothing').toBeTruthy();
      for (const col of INSTANT_COLUMNS) expectCanonicalInstant(updatedReturn[col], `update() return ${col}`);
      expect(updatedReturn.closed_at).toBe(CLOSED_AT[0]);

      // `create()` returns `returning('*')` where the dialect has it (MySQL
      // has no RETURNING and hands back less than a row); whatever instant
      // columns a dialect's return does carry must be the canonical text —
      // the door is the same `formatOutput`. Which columns come back is the
      // dialect's business and is not pinned here.
      for (const [i, ret] of createdReturns.entries()) {
        if (!ret || typeof ret !== 'object') continue;
        for (const col of INSTANT_COLUMNS) {
          if (ret[col] === undefined) continue;
          expectCanonicalInstant(ret[col], `create() return ${i} ${col}`);
        }
        if (ret.closed_at !== undefined) expect(ret.closed_at).toBe(CLOSED_AT[i]);
      }
    });

    it('§A4 the Field.date control is untouched — a calendar day stays YYYY-MM-DD', () => {
      for (const [i, row] of rows.entries()) {
        expect(row.due_on, `${row.id}.due_on`).toBe(DUE_ON[i]);
      }
    });

    it('§B1 aggregate(): min/max over a declared datetime AND over the audit columns are canonical ISO-Z text', async () => {
      const res: any[] = await driver.aggregate(
        TABLE,
        {
          aggregations: [
            { function: 'min', field: 'closed_at', alias: 'earliest' },
            { function: 'max', field: 'closed_at', alias: 'latest' },
            { function: 'max', field: 'created_at', alias: 'newest_created' },
            { function: 'max', field: 'updated_at', alias: 'newest_updated' },
            { function: 'count', field: 'closed_at', alias: 'n' },
          ],
        } as any,
        OPTS,
      );
      expect(Array.isArray(res) && res.length === 1, `aggregate() answered ${JSON.stringify(res)}`).toBe(true);
      const row = res[0];
      expectCanonicalInstant(row.earliest, 'min(closed_at)');
      expectCanonicalInstant(row.latest, 'max(closed_at)');
      expect(row.earliest).toBe(DISTINCT_CLOSED_AT[0]);
      expect(row.latest).toBe(DISTINCT_CLOSED_AT[DISTINCT_CLOSED_AT.length - 1]);
      // The audit columns had NO aggregate arm before #13973, on any dialect.
      expectCanonicalInstant(row.newest_created, 'max(created_at)');
      expectCanonicalInstant(row.newest_updated, 'max(updated_at)');
      // Agrees with what find() presents for the same column, value for value.
      const last = (values: string[]): string => [...values].sort()[values.length - 1];
      expect(row.newest_created).toBe(last(rows.map((r) => r.created_at)));
      expect(row.newest_updated).toBe(last(rows.map((r) => r.updated_at)));
      // A numeric aggregate over a datetime stays a number.
      expect(Number(row.n)).toBe(CLOSED_AT.length);
    });

    it('§B2 aggregate(): a raw temporal group key is the canonical text', async () => {
      const res: any[] = await driver.aggregate(
        TABLE,
        { groupBy: ['closed_at'], aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }] } as any,
        OPTS,
      );
      const keys = res.map((r) => r.closed_at);
      expect(keys.length).toBe(DISTINCT_CLOSED_AT.length);
      for (const key of keys) expectCanonicalInstant(key, 'groupBy closed_at key');
      expect([...keys].sort()).toEqual(DISTINCT_CLOSED_AT);
    });

    it('§B3 distinct(): a declared datetime AND the audit columns are canonical ISO-Z text', async () => {
      const closed = await driver.distinct(TABLE, 'closed_at', undefined, OPTS);
      expect(closed.length).toBe(DISTINCT_CLOSED_AT.length);
      for (const v of closed) expectCanonicalInstant(v, 'distinct(closed_at)');
      expect([...closed].sort()).toEqual(DISTINCT_CLOSED_AT);

      for (const col of ['created_at', 'updated_at'] as const) {
        const values = await driver.distinct(TABLE, col, undefined, OPTS);
        expect(values.length, `distinct(${col}) is empty`).toBeGreaterThan(0);
        for (const v of values) expectCanonicalInstant(v, `distinct(${col})`);
        // Agrees with the find() presentation of the same column, value for value.
        expect([...values].sort()).toEqual([...new Set<string>(rows.map((r) => r[col]))].sort());
      }
    });

    it("§C the fold is the driver's, not the client's: raw knex still materialises the dialect's own shape", async () => {
      const raw: any = await (driver as any).knex(TABLE).where('id', 'r0').first();
      expect(raw, 'raw read returned nothing').toBeTruthy();
      if (cell.live) {
        // Postgres (`timestamptz`, node-pg's stock OID 1184 parser) and MySQL
        // (`DATETIME(3)`, mysql2 under the `timezone: 'Z'` pin) hand a `Date`
        // to the driver — D-F2: the client parser is untouched, the driver
        // folds at its own boundary. This is what makes §A/§B a measurement
        // rather than a restatement of the client's behaviour.
        for (const col of INSTANT_COLUMNS) {
          expect(
            raw[col] instanceof Date,
            `${cell.label} raw ${col} is ${typeof raw[col]} (${String(raw[col])}) — the client parser ` +
              `was changed, which the #13973 ruling forbids`,
          ).toBe(true);
          expect(Number.isNaN((raw[col] as Date).getTime()), `${col}: Invalid Date`).toBe(false);
        }
        // Same instant, two spellings: the fold changed the TYPE and nothing else.
        expect((raw.closed_at as Date).toISOString()).toBe(rows[0].closed_at);
        expect((raw.updated_at as Date).toISOString()).toBe(rows[0].updated_at);
        expect((raw.created_at as Date).toISOString()).toBe(rows[0].created_at);
      } else {
        // SQLite has no temporal type: the stored TEXT is already the presented
        // text, which is the side of the old asymmetry every consumer was
        // tested against.
        for (const col of INSTANT_COLUMNS) expect(typeof raw[col], `sqlite raw ${col}`).toBe('string');
        expect(raw.closed_at).toBe(rows[0].closed_at);
      }
    });
  });
}

// A matrix that silently finds zero cells reports OK — every cell is declared
// EITHER WAY, measured when it is provisioned and a named skip when it is not
// (a named RED under `OS_EXPECT_LIVE_DIALECT_MATRIX=1`).
for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'canonical ISO read door (#13973)', measure);
}
