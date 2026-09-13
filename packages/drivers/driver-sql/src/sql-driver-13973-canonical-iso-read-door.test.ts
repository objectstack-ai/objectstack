// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13973] The read door presents ONE instant shape on EVERY dialect —
 * ADR-0053 D-F1..D-F3, declared = enforced.
 *
 * ## The contract
 *
 * For the builtin audit columns (`created_at`, `updated_at`) and every declared
 * `Field.datetime` column, `@objectstack/driver-sql`'s record read doors —
 * `find()`, `findOne()`, and the rows `create()`, `update()`, `upsert()`,
 * `bulkCreate()` and `bulkUpdate()` return — hand out the canonical instant
 * text `YYYY-MM-DDTHH:MM:SS.sssZ`; `aggregate()` (`min` / `max`, and a raw
 * temporal group key) and `distinct()` present the same two column classes
 * the same way. None of those doors hands out a JS `Date` for those columns,
 * on SQLite, Postgres or MySQL — with the one exception ADR-0053 D-F3 names:
 * an Invalid `Date`, which has no canonical text and passes through as the
 * `Date` it is (pinned by `sql-driver-14078-invalid-date-materialisation.test.ts`;
 * never met here, because this fixture writes only valid instants).
 * `findWithWindowFunctions` used to be the one read door outside this list: it
 * applied no read presentation of any kind. Since #16609 it routes each row
 * through the SAME `formatOutput` pass `find()` runs (minus the window-alias
 * columns), so it presents these two column classes exactly as the doors above
 * do — pinned by `sql-driver-window-function-output.test.ts`, whose live cells
 * assert the canonical instant on Postgres and MySQL for this door too.
 * ⚠️ ADR-0053 D-F1 still RECORDS that door as not covered; the tree is ahead of
 * the declaration there, and docs-only governed card #16782 carries the
 * amendment. Do not read the ADR line as the current behaviour.
 *
 * §A1–§A3 measure the four row doors on the fixture table; §A5–§A7 the three
 * write doors whose return is a row, on a second table so their writes cannot
 * move what §B/§C compare against. §D, on the SQLite cell alone, pins that
 * `aggregate()` / `distinct()` present the audit columns through the SAME
 * presenter `find()` uses — its own note says why SQLite is the whole
 * coverage there and not a shortfall.
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

import { describe, it, expect, beforeAll, afterAll, assert } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
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

/**
 * The table the write-door cells (§A5–§A7) write to. Separate from `TABLE` so
 * an upsert, a bulk update and a bulk insert cannot move the `updated_at`
 * values and the row count §B1/§B3 compare `aggregate()` / `distinct()`
 * against — the cells stay order-independent.
 */
const TABLE_RETURNS = 'os13973_read_door_returns';

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
      await driver.execute(`drop table if exists ${TABLE_RETURNS}`).catch(() => {});
      // The DDL path, so the audit columns are the ones
      // `createAuditTimestampColumn` produces (`timestamptz` on Postgres,
      // `DATETIME(3)` on MySQL, TEXT on SQLite) and `closed_at` is a declared
      // `Field.datetime` (`timestamptz` / `DATETIME(3)` / TEXT).
      const fields = {
        id: { type: 'text' },
        title: { type: 'string' },
        closed_at: { type: 'datetime' },
        due_on: { type: 'date' },
        amount: { type: 'number' },
      };
      await driver.initObjects([
        { name: TABLE, fields },
        { name: TABLE_RETURNS, fields },
      ] as any);
      // Two rows for the write doors that operate on an EXISTING row (§A5's
      // merge, §A6); the doors that insert (§A5's insert, §A7) bring their own.
      for (const i of [0, 1]) {
        await driver.create(
          TABLE_RETURNS,
          { id: `w${i}`, title: `write row ${i}`, closed_at: CLOSED_AT[i], due_on: DUE_ON[i], amount: 100 + i },
          OPTS,
        );
      }
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
      await driver?.execute(`drop table if exists ${TABLE_RETURNS}`).catch(() => {});
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
      assert(one !== null, 'findOne answered the not-found arm for a seeded id');
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

    // §A5–§A7: the three remaining row doors D-F1 lists. Each is covered by
    // construction — the same `formatOutput` call — and is measured here anyway,
    // because "declared = enforced" is a statement about cells, not about call
    // graphs. `expectCanonicalInstant` carries §0's guard (defined, non-null)
    // inside it, so a door that returned a row WITHOUT its audit columns fails
    // here rather than passing over nothing.

    it('§A5 upsert(): the row it hands back presents the same shape — merged onto an existing row, and inserted', async () => {
      // `upsert()` reads the row back after its statement on every dialect
      // (`readback.first()` → `formatOutput`), so its return is a whole row and
      // the guard applies unqualified.
      const before = await driver.findOne(TABLE_RETURNS, { where: { id: 'w0' } }, OPTS);
      assert(before !== null, 'findOne answered the not-found arm for a seeded id');
      expect(before, 'the seed row is missing').toBeTruthy();
      const merged = await driver.upsert(TABLE_RETURNS, { id: 'w0', title: 'write row 0 (merged)' }, undefined, OPTS);
      const inserted = await driver.upsert(
        TABLE_RETURNS,
        { id: 'u0', title: 'upserted row', closed_at: CLOSED_AT[2], due_on: DUE_ON[2], amount: 200 },
        undefined,
        OPTS,
      );
      for (const [label, ret, closedAt] of [
        ['merged w0', merged, CLOSED_AT[0]],
        ['inserted u0', inserted, CLOSED_AT[2]],
      ] as const) {
        expect(ret, `upsert() ${label} returned nothing`).toBeTruthy();
        expect(ret.id, `upsert() ${label} returned a row that is not the one written`).toBe(label.split(' ')[1]);
        for (const col of INSTANT_COLUMNS) expectCanonicalInstant(ret[col], `upsert() ${label} ${col}`);
        expect(ret.closed_at, `upsert() ${label} closed_at`).toBe(closedAt);
      }
      // `created_at` is insert-only under a merge (ADR-0074 §2): the merged
      // return names the instant the row was created at, in the same spelling.
      expect(merged.created_at).toBe(before.created_at);
    });

    it('§A6 bulkUpdate(): every row it hands back presents the same shape', async () => {
      // Loops `update()`, which reads each row back after its statement — a
      // whole row per entry on every dialect, so the guard applies unqualified.
      const ret = await driver.bulkUpdate(
        TABLE_RETURNS,
        [
          { id: 'w0', data: { title: 'write row 0 (bulk)' } },
          { id: 'w1', data: { title: 'write row 1 (bulk)' } },
        ],
        OPTS,
      );
      expect(ret, 'bulkUpdate() did not return one row per update').toHaveLength(2);
      for (const [i, r] of ret.entries()) {
        expect(r.id, `bulkUpdate() return ${i}`).toBe(`w${i}`);
        for (const col of INSTANT_COLUMNS) expectCanonicalInstant(r[col], `bulkUpdate() return w${i} ${col}`);
        expect(r.closed_at, `bulkUpdate() return w${i} closed_at`).toBe(CLOSED_AT[i]);
        // A fresh stamp, in UTC — the same recency bound §A1 puts on `find()`.
        // [#17690] `bulkUpdate()` publishes the contract's
        // `Record<string, unknown>[]` now, so the stamp is typed before it is
        // parsed.
        const updatedAt = r.updated_at;
        assert(typeof updatedAt === 'string', `w${i}.updated_at is not a string`);
        expect(Math.abs(Date.now() - Date.parse(updatedAt)), `w${i}.updated_at is not the instant of the update`).toBeLessThan(10 * 60_000);
      }
    });

    it('§A7 bulkCreate(): whatever rows its return carries present the same shape, and the batch lands canonical', async () => {
      const batch = [
        { id: 'b0', title: 'batch row 0', closed_at: new Date(CLOSED_AT[0]), due_on: DUE_ON[0], amount: 300 },
        { id: 'b1', title: 'batch row 1', closed_at: CLOSED_AT[3], due_on: DUE_ON[3], amount: 301 },
      ];
      const expectedClosedAt: Record<string, string> = { b0: CLOSED_AT[0], b1: CLOSED_AT[3] };
      const ret = await driver.bulkCreate(TABLE_RETURNS, batch, OPTS);
      expect(Array.isArray(ret), `bulkCreate() answered ${JSON.stringify(ret)}`).toBe(true);
      // `insert(rows).returning('*')` hands back a whole row per element where
      // the dialect has RETURNING (Postgres, SQLite) and knex's insert-id
      // placeholder where it has not (MySQL) — the same fact §A3 records for
      // `create()`. Which of the two a dialect answers is its business and is
      // not pinned. What IS pinned: an element that is a row carries every
      // instant column, presents it canonically, and names a row of THIS
      // batch; and the return is all rows or none, so a door that dropped part
      // of a batch could not pass as "the dialect has no RETURNING".
      const rowReturns: any[] = ret.filter((r: unknown) => !!r && typeof r === 'object');
      expect(
        rowReturns.length === 0 || rowReturns.length === batch.length,
        `bulkCreate() returned ${rowReturns.length} row(s) for a batch of ${batch.length}`,
      ).toBe(true);
      for (const r of rowReturns) {
        expect(Object.keys(expectedClosedAt), `bulkCreate() returned a row outside the batch: ${r.id}`).toContain(r.id);
        for (const col of INSTANT_COLUMNS) expectCanonicalInstant(r[col], `bulkCreate() return ${r.id} ${col}`);
        expect(r.closed_at, `bulkCreate() return ${r.id} closed_at`).toBe(expectedClosedAt[r.id]);
      }
      // The leg that measures something on EVERY dialect, RETURNING or not:
      // the batch landed, its rows read back canonical through `find()`, and —
      // where the return carried a row — the return and the row agree value
      // for value, so the return door presents what the read door presents.
      // [#17690] `find()` publishes `Record<string, unknown>[]`, so every id
      // read off a returned row is narrowed before it is used as a key, and
      // `Array.prototype.find`'s absent arm is narrowed away rather than
      // asserted past.
      const landed = (await driver.find(TABLE_RETURNS, { orderBy: [{ field: 'id', order: 'asc' }] }, OPTS)).filter(
        (row) => String(row.id) in expectedClosedAt,
      );
      expect(landed, 'the batch did not land').toHaveLength(batch.length);
      for (const row of landed) {
        for (const col of INSTANT_COLUMNS) expectCanonicalInstant(row[col], `find() after bulkCreate ${row.id} ${col}`);
        expect(row.closed_at).toBe(expectedClosedAt[String(row.id)]);
      }
      for (const r of rowReturns) {
        const row = landed.find((l) => String(l.id) === String(r.id));
        assert(row !== undefined, `find() has no landed row for bulkCreate() return ${r.id}`);
        for (const col of INSTANT_COLUMNS) expect(r[col], `bulkCreate() return vs find() ${r.id}.${col}`).toBe(row[col]);
      }
    });

    it('§B1 aggregate(): min/max over a declared datetime AND over the audit columns are canonical ISO-Z text', async () => {
      const query: DriverQuery = {
        aggregations: [
          { function: 'min', field: 'closed_at', alias: 'earliest' },
          { function: 'max', field: 'closed_at', alias: 'latest' },
          { function: 'max', field: 'created_at', alias: 'newest_created' },
          { function: 'max', field: 'updated_at', alias: 'newest_updated' },
          { function: 'count', field: 'closed_at', alias: 'n' },
        ],
      };
      const res: any[] = await driver.aggregate(TABLE, query, OPTS);
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
      const query: DriverQuery = {
        groupBy: ['closed_at'],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      };
      const res: any[] = await driver.aggregate(TABLE, query, OPTS);
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

/**
 * §D — `find()`, `distinct()` and `aggregate()` share ONE presenter for the
 * audit columns.
 *
 * `readPresentationKind` routes `created_at` / `updated_at` to the same
 * `presentAuditTimestampOutput` that `formatOutput` applies to a `find()` row —
 * not to `normalizeSqliteDatetimeOutput`. The two presenters differ on exactly
 * one input class, a NUMBER: the audit presenter passes it through (ADR-0074
 * §3), the datetime fold turns it into ISO text. #13973's first cut routed the
 * audit columns to the datetime fold, and the contract review of PR #16619
 * reproduced the divergence that made: an author-declared `created_at: number`
 * read `1700000000000` off `find()` and `"2023-11-14T22:13:20.000Z"` off
 * `distinct()` and `max()`. Two reachable shapes carry a number there:
 *
 *   D1 an author-declared non-temporal `created_at` — `applySystemFields` lets
 *      the declaration win (objectql `registry.ts`, "Author-declared fields
 *      win") and `AUDIT_FIELD_GOVERNANCE` forces only `readonly` / `system`,
 *      never `type` — holding the number the author wrote;
 *   D2 an epoch-ms INTEGER raw-written into the builtin, undeclared audit
 *      column, the pre-ADR-0074 shape a raw insert leaves, which ADR-0074 §3
 *      declares `find()` hands through untouched.
 *
 * ## Why the SQLite cell is the whole coverage, not a shortfall
 *
 * The driver's DDL never types the audit column from the declaration: a
 * declared `created_at` is skipped (`builtinColumns`) and
 * `createAuditTimestampColumn` runs, so on Postgres the column is a
 * `timestamptz` and on MySQL a `DATETIME(3)` — neither can hold a number, and
 * the write that would put one there is refused by the server. SQLite's type
 * affinity is what lets a number sit in that column at all, so SQLite is the
 * only dialect on which the three doors CAN disagree, and the only one on
 * which this pin measures anything; a live cell would exercise the D-F1 shape
 * §B1/§B3 already cover and nothing of §D. Firing control: route the audit
 * columns back to the `datetime` kind in `readPresentationKind` and §D1/§D2 go
 * red on their `distinct()` and `aggregate()` legs — ISO text where `find()`
 * answers the number — while every §A/§B/§C cell stays green.
 */
describe('#13973 §D — find(), distinct() and aggregate() present the audit columns through one presenter (sqlite)', () => {
  const SQLITE = DIALECT_CELLS.find((c) => c.id === 'sqlite');
  const T_DECLARED = 'os13973_declared_audit';
  const T_RAW = 'os13973_raw_audit';
  /** 2023-11-14T22:13:20.000Z as epoch ms — the review's own value. */
  const EPOCH = 1_700_000_000_000;
  let driver: SqlDriver;

  beforeAll(async () => {
    expect(SQLITE, 'the matrix lost its SQLite cell').toBeDefined();
    driver = new SqlDriver(SQLITE!.config());
    for (const t of [T_DECLARED, T_RAW]) await driver.execute(`drop table if exists ${t}`).catch(() => {});
    await driver.initObjects([
      // D1: the author declares the audit column non-temporal.
      { name: T_DECLARED, fields: { id: { type: 'text' }, created_at: { type: 'number' }, n: { type: 'number' } } },
      // D2: the audit column is the builtin, undeclared one.
      { name: T_RAW, fields: { id: { type: 'text' }, n: { type: 'number' } } },
    ] as any);
    await driver.create(T_DECLARED, { id: 'd0', created_at: EPOCH, n: 1 }, OPTS);
    await driver.create(T_DECLARED, { id: 'd1', created_at: EPOCH + 1, n: 2 }, OPTS);
    await driver.create(T_RAW, { id: 'x0', n: 1 }, OPTS);
    // Past the driver's write door, as a raw insert would leave it: an epoch
    // INTEGER in both builtin audit columns.
    await (driver as any).knex(T_RAW).where('id', 'x0').update({ created_at: EPOCH, updated_at: EPOCH });
  });

  afterAll(async () => {
    for (const t of [T_DECLARED, T_RAW]) await driver?.execute(`drop table if exists ${t}`).catch(() => {});
    await driver?.disconnect();
  });

  /** The three doors' answers for one column, in the shape each door hands out. */
  async function threeDoors(table: string, col: 'created_at' | 'updated_at') {
    const query: DriverQuery = { aggregations: [{ function: 'max', field: col, alias: 'newest' }] };
    const [rows, distinct, agg] = await Promise.all([
      driver.find(table, { orderBy: [{ field: 'id', order: 'asc' }] }, OPTS),
      driver.distinct(table, col, undefined, OPTS),
      driver.aggregate(table, query, OPTS) as Promise<any[]>,
    ]);
    return { find: rows.map((r: any) => r[col]), distinct: [...distinct].sort(), max: agg[0]?.newest };
  }

  it('§D1 an author-declared non-temporal created_at: the number find() presents is what distinct() and max() present', async () => {
    const doors = await threeDoors(T_DECLARED, 'created_at');
    // The `find()` side, stated rather than assumed: the declared type wins
    // (the numeric repair is a no-op on a number, the audit presenter passes
    // it through), so the row carries the number the author wrote.
    expect(doors.find, 'find()').toEqual([EPOCH, EPOCH + 1]);
    // `toEqual` is type-strict: "2023-11-14T22:13:20.000Z" is not 1700000000000.
    expect(doors.distinct, 'distinct(created_at) disagrees with find()').toEqual([EPOCH, EPOCH + 1]);
    expect(doors.max, 'max(created_at) disagrees with find()').toBe(EPOCH + 1);
    expect(typeof doors.max).toBe('number');
  });

  it('§D2 an epoch INTEGER raw-written into the builtin audit columns: the three doors agree, on both columns', async () => {
    for (const col of ['created_at', 'updated_at'] as const) {
      const doors = await threeDoors(T_RAW, col);
      // ADR-0074 §3: a number passes the audit presenter untouched on `find()`.
      expect(doors.find, `find() ${col}`).toEqual([EPOCH]);
      expect(doors.distinct, `distinct(${col}) disagrees with find()`).toEqual([EPOCH]);
      expect(doors.max, `max(${col}) disagrees with find()`).toBe(EPOCH);
    }
  });

  it('§D3 the control: the same two doors still fold a Field.datetime number and a legacy naive audit string to ISO text, as find() does', async () => {
    // A raw zone-naive `CURRENT_TIMESTAMP` string in the undeclared audit
    // column is the shape ADR-0074 repairs on `find()`; §D must not have
    // bought the number agreement by losing that repair at these doors.
    await driver.create(T_RAW, { id: 'x1', n: 2 }, OPTS);
    await (driver as any).knex(T_RAW).where('id', 'x1').update({ updated_at: '2026-01-10 09:00:00' });
    const legacy = await driver.findOne(T_RAW, { where: { id: 'x1' } }, OPTS);
    assert(legacy !== null, 'findOne answered the not-found arm for a seeded id');
    expect(legacy.updated_at).toBe('2026-01-10T09:00:00.000Z');
    const distinct = await driver.distinct(T_RAW, 'updated_at', undefined, OPTS);
    expect(distinct).toContain('2026-01-10T09:00:00.000Z');
    expect(distinct).toContain(EPOCH);
    const query: DriverQuery = { aggregations: [{ function: 'max', field: 'updated_at', alias: 'newest' }] };
    const agg: any[] = await driver.aggregate(T_RAW, query, OPTS);
    // SQLite `max()` over mixed INTEGER/TEXT storage orders TEXT above INTEGER,
    // so the newest is the legacy string — presented through the same repair.
    expect(agg[0].newest).toBe('2026-01-10T09:00:00.000Z');
  });
});
