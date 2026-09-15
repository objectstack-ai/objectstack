// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#17639 — `distinct()` joins the enveloped read exits.
 *
 * ## The measurement this suite is built from
 *
 * `driver-sql` stores every MULTI-VALUED column as `json`, and PostgreSQL's
 * `json` type defines no equality operator, so `SELECT DISTINCT` over one is
 * refused by the backend. Until this card, `SqlDriver.distinct` awaited the
 * builder BARE — no `try`/`catch`, no envelope — so the refusal left the driver
 * as pg's own `DatabaseError`. Measured on live PostgreSQL 16.13, `origin/main`
 * at `2cc4884d1f`:
 *
 * ```
 * distinct(t, 'toggles') => THREW ctor=DatabaseError code=42883 status=undefined
 *                           msg=select distinct "toggles" from "…" -
 *                               could not identify an equality operator for type json
 * ```
 *
 * Class-wide across every JSON column, with a scalar `boolean` column in the
 * same table answering `[false, true]` as the lit control.
 *
 * ⚠️ [#17469] The original measurement named `toggle`, `boolean` and `number`
 * carrying `multiple: true` as three of those columns. The maintainer ruling of
 * 2026-09-13 gives "multi-valued" ONE definition (`isMultiValueField`) and
 * derives this driver's storage from it, so those three declarations are
 * ordinary SCALAR columns now and are not this card's population any more. The
 * fixture below carries the same class — what its members share is the `json`
 * STORAGE, never the declared type — re-spelled onto `select` / `lookup` /
 * `user` with `multiple: true`, plus `tags`. The retired shape stays in the
 * table as the ruling's own control: it ANSWERS, because it is a real
 * `boolean` column. Nothing about the ENVELOPE this card is fenced to has
 * moved. A raw `42883` is on no
 * list `@objectstack/rest` reads, so `status` was `undefined` and an ordinary
 * caller shape (list the distinct values of this column) was logged as an
 * UNHANDLED server fault rather than served as a declared `DATABASE_ERROR` 500.
 *
 * ## ⛔ THE FENCE — this suite is the ENVELOPE half and nothing else
 *
 * ⛔ It is NOT a request to make `distinct()` ANSWER over a JSON column. The
 * call fails either way; what changes is whether the failure is CLASSIFIED.
 * Whether a `json` column should support a distinct read at all belongs with
 * #17590, which owns the sibling `LIKE`-over-`json` divergence on the filter
 * side of the same columns. This is the same split #11455 made on the
 * `aggregate()` door while #11152 / #11249 still owned the answer question: the
 * envelope is the half that holds whichever way that card rules.
 *
 * ⚠️ RETIREMENT CLAUSE for the Postgres-only block at the bottom: if #17590
 * rules that a `json` column should ANSWER a distinct read, those cases stop
 * failing and that block is RETIRED by that card — exactly as #11635 retired
 * #11455's boolean-aggregand block. What the all-dialect sweep pins is
 * unchanged by any such ruling: it runs on a table that was never provisioned,
 * a route with no JSON column in it at all.
 *
 * ## Why `DATABASE_ERROR` / 500, from the code rather than from taste
 *
 * No code is minted. `DATABASE_ERROR` / 500 is the envelope `find()` and
 * `count()` have answered with since #8931 (maintainer ruling 2026-08-17
 * 「同意 C」) and `aggregate()` since #11455, for any dialect error their
 * classification does not claim. It asserts exactly one thing — *the backend
 * would not run this statement* — which is the only claim the signal supports.
 * ⛔ Never `INVALID_QUERY` / 400: that would say *"asking for the distinct
 * values of this column is your mistake"*, a verdict about the request that
 * #17590 has not made.
 *
 * | card   | door            | before                         | after                |
 * |--------|-----------------|--------------------------------|----------------------|
 * | #8790  | `count()` WHERE | raw dialect error              | `INVALID_FILTER`/400 |
 * | #8931  | read exits      | raw dialect error, no `status` | `DATABASE_ERROR`/500 |
 * | #11455 | `aggregate()`   | raw dialect error, no `status` | `DATABASE_ERROR`/500 |
 * | #17639 | `distinct()`    | raw dialect error, no `status` | `DATABASE_ERROR`/500 |
 *
 * ⭐ The envelope comes from the EXIT, not from recognising `42883` or the
 * words *equality operator* — the #8926 lesson (a predicate arm matched by
 * WORDING is an arm that silently fails to fire on the dialect nobody
 * measured). The all-dialect sweep below asserts that structurally, on a route
 * that has nothing to do with JSON.
 *
 * ## What is deliberately NOT here
 *
 * ⛔ No BLANKET `isUnresolvableColumnError` arm, unlike `count()` — the same
 * gap #11455 left FILED rather than guessed at. That refusal's words are
 * *"Filter on 'x' names a column that object 'o' has no column for"*, and this
 * door names columns in TWO clauses: the `field` being listed and the WHERE
 * compiled from `filters`. A blanket arm would tell the author of
 * `distinct(o, 'nosuchcol')` — who passed no filter at all — that their FILTER
 * was wrong. #11541 closed that gap for `aggregate()` with a clause-attributing
 * classifier; #17857 has since closed the `distinct()` half the same way
 * (`SqlDriver.distinctBackendFault`, pinned by
 * `sql-driver-17857-distinct-unresolvable-column-refusal.test.ts`). What this
 * suite pins was unchanged by that, exactly as this note anticipated: an error
 * the classifier does NOT claim — a table that was never provisioned, a `json`
 * column with no equality operator — still leaves as this terminal envelope.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'distinct_fault_task';
const MISSING_TABLE = 'distinct_fault_never_created';

/**
 * The caller's value, distinctive on purpose, asserted absent from every
 * caller-visible surface.
 */
const SECRET_LITERAL = 'zz-distinct-fault-must-not-leak';

/** A well-formed aggregation — the statement is fine, the TABLE is not. */
const COUNT_ALL: DriverQuery = { aggregations: [{ function: 'count', alias: 'n' }] };

async function caught(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  return expect.fail('expected the query to fail, but it resolved');
}

/** Capture the driver's server-log line for one call. */
async function withLog(
  driver: SqlDriver,
  run: () => Promise<unknown>,
): Promise<{ err: any; logged: string[] }> {
  const logged: string[] = [];
  const sink = { warn: (m: string) => logged.push(String(m)), info: () => {}, error: () => {} };
  const original = (driver as unknown as { logger: unknown }).logger;
  (driver as unknown as { logger: unknown }).logger = sink;
  try {
    return { err: await caught(run), logged };
  } finally {
    (driver as unknown as { logger: unknown }).logger = original;
  }
}

/**
 * The disclosure clause, applied to one caller-visible message — the same
 * NEGATIVE-set-plus-positive-anchor shape the #8931 and #11455 suites use, so
 * an emptied message cannot satisfy it trivially.
 */
function expectNoStatementShape(message: string, object: string, half: string): void {
  expect(message, `${half}: no compiled statement`).not.toMatch(/\bselect\s/i);
  expect(message, `${half}: no positional placeholder`).not.toMatch(/\$\d/);
  expect(message, `${half}: no quoted physical reference`).not.toMatch(/["`]/);
  expect(message, `${half}: no bound literal`).not.toContain(SECRET_LITERAL);
  expect(message, `${half}: the caller is still told which object failed`).toContain(object);
}

function declareSweep(cell: DialectCell): void {
describe(`[#17639] driver-sql — distinct() takes the backend-fault envelope (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.execute(`drop table if exists ${MISSING_TABLE}`).catch(() => {});
    await driver.initObjects([
      { name: TABLE, fields: { title: { type: 'string' }, rank: { type: 'integer' } } },
    ]);
    await driver.create(TABLE, { id: 't1', title: 'Design', rank: 1 }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 't2', title: 'Build', rank: 3 }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 't3', title: 'Design', rank: 5 }, { bypassTenantAudit: true });
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────
  // THE CARD, in its dialect-independent form
  // ───────────────────────────────────────────────────────────────

  // A table that was never provisioned raises a dialect error on all three
  // backends (`42P01` / `SQLITE_ERROR` / `ER_NO_SUCH_TABLE`), so this is the
  // envelope invariant measured on EVERY cell — and it involves no JSON column,
  // so #17590's ruling cannot move it in either direction.
  it('an unclassified dialect fault on the distinct door carries a code AND a status', async () => {
    const err = await caught(() => driver.distinct(MISSING_TABLE, 'title'));
    expect(err.code, 'code').toBe('DATABASE_ERROR');
    expect(err.status, 'status').toBe(500);
    expectNoStatementShape(String(err.message), MISSING_TABLE, 'distinct');
  });

  // The #8931 invariant — one condition, one answer, whichever read door asked
  // — extended to the third one. A picklist-populating call uses `distinct()`
  // where a list view uses `find()`/`count()` and a dashboard tile uses
  // `aggregate()`; a split here is what produced a declared 500 on three doors
  // and an unhandled fault on the fourth call shape.
  it('find(), count(), aggregate() and distinct() answer one unclassified fault the SAME way', async () => {
    const onFind = await caught(() => driver.find(MISSING_TABLE, {}));
    const onCount = await caught(() => driver.count(MISSING_TABLE, {}));
    const onAggregate = await caught(() => driver.aggregate(MISSING_TABLE, COUNT_ALL));
    const onDistinct = await caught(() => driver.distinct(MISSING_TABLE, 'title'));
    const shape = (e: any) => ({ code: e.code, status: e.status, message: e.message });
    expect(shape(onDistinct), 'distinct vs find').toEqual(shape(onFind));
    expect(shape(onDistinct), 'distinct vs count').toEqual(shape(onCount));
    expect(shape(onDistinct), 'distinct vs aggregate').toEqual(shape(onAggregate));
  });

  // ⛔ THE FENCE: the envelope claims nothing about the request. Listing the
  // distinct values of a column is not a malformed query, and #17590 — not this
  // exit — owns whether the column supports the read.
  it('the envelope makes NO claim about the query or the filter', async () => {
    const err = await caught(() => driver.distinct(MISSING_TABLE, 'title'));
    expect(err.code).not.toBe('INVALID_QUERY');
    expect(err.code).not.toBe('INVALID_FILTER');
    expect(err.code).not.toBe('INVALID_FIELD');
    expect(err.status).not.toBe(400);
    expect(String(err.message)).not.toMatch(/filter/i);
  });

  // The caller's own bound literal travels through `filters`, which is the half
  // of this door `count()` does not have — so the disclosure clause is measured
  // on a statement that really carries one.
  it('a bound literal in the caller filter reaches neither the message nor a serialised envelope', async () => {
    const err = await caught(() => driver.distinct(MISSING_TABLE, 'title', { title: SECRET_LITERAL }));
    expect(err.code, 'code').toBe('DATABASE_ERROR');
    expectNoStatementShape(String(err.message), MISSING_TABLE, 'distinct with a filter');
    expect(JSON.stringify(err), 'a serialised envelope carries no bound literal')
      .not.toContain(SECRET_LITERAL);
  });

  // ───────────────────────────────────────────────────────────────
  // THE CAUSE — what keeps `isMissingTableError` truthful
  // ───────────────────────────────────────────────────────────────

  it('keeps the original dialect error as a NON-ENUMERABLE `cause`', async () => {
    const err = await caught(() => driver.distinct(MISSING_TABLE, 'title'));
    const cause = (err as { cause?: any }).cause;
    expect(cause, 'the original dialect error must survive as `cause`').toBeDefined();
    expect(String(cause.message)).toContain(MISSING_TABLE);
    // ⛔ Not enumerable: an enumerable `cause` rides out through
    // `JSON.stringify(err)` and `{ ...err }`, putting the compiled statement
    // back on any wire that serialises the error.
    expect(Object.keys(err), 'own enumerable keys').toEqual(['code', 'status']);
    expect(JSON.stringify(err), 'a serialised envelope carries no dialect text')
      .not.toContain('select');
  });

  // ───────────────────────────────────────────────────────────────
  // THE LOG — a withholding, not a deletion
  // ───────────────────────────────────────────────────────────────

  it('writes the full dialect text to the SERVER LOG, statement included', async () => {
    const { err, logged } = await withLog(driver, () => driver.distinct(MISSING_TABLE, 'title'));
    expect(err.code).toBe('DATABASE_ERROR');
    const line = logged.find((l) => l.includes(MISSING_TABLE));
    expect(line, 'an operator must still be able to read what the backend said').toBeDefined();
    expect(String(line)).toMatch(/\bselect\b/i);
    expect(String(line)).toContain('DATABASE_ERROR');
  });

  // ───────────────────────────────────────────────────────────────
  // CONTROLS — the catch-all is TERMINAL, not blanket
  // ───────────────────────────────────────────────────────────────

  it('CONTROL a working distinct is untouched, filtered and unfiltered', async () => {
    const titles = await driver.distinct(TABLE, 'title');
    expect([...titles].sort(), 'the unfiltered distinct set').toEqual(['Build', 'Design']);
    const filtered = await driver.distinct(TABLE, 'title', { rank: 5 });
    expect(filtered, 'the filtered distinct set').toEqual(['Design']);
  });

  // ⛔ The precise refusal must WIN over the generic one. `applyFilters` raises
  // `INVALID_FILTER` / 400 while the statement is BUILT — upstream of the
  // execution the catch-all guards — and burying it under a 500 that names
  // nothing is the regression this control exists to catch. The probe is the
  // one `sql-driver-distinct-filter-narrowing.test.ts` measures (#6320): a
  // query ENVELOPE handed where a bare filter belongs, whose `where` value is
  // an object and no comparand may be.
  it('CONTROL the upstream INVALID_FILTER refusal still wins over the catch-all', async () => {
    const envelopeAsFilter = await caught(() =>
      driver.distinct(TABLE, 'title', { object: TABLE, where: { rank: 1 } } as never),
    );
    expect(envelopeAsFilter.code, 'a query envelope handed as a filter').toBe('INVALID_FILTER');
    expect(envelopeAsFilter.status, 'a query envelope handed as a filter').toBe(400);
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#17639] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'distinct backend-fault envelope', declareSweep);
}

// ─────────────────────────────────────────────────────────────────
// THE CARD'S OWN ROUTE — Postgres only, and why
// ─────────────────────────────────────────────────────────────────
//
// ⚠️ RETIREMENT CLAUSE: this block pins that the JSON-column refusal the card
// measured is ENVELOPED, never that it refuses. If #17590 rules that a `json`
// column should ANSWER a distinct read, these cases stop failing and this block
// is RETIRED by that card — the same clause #11455's boolean-aggregand block
// carried and #11635 fired.
//
// ⛔ Postgres only, and not for convenience: the divergence IS the dialect.
// SQLite stores a multi-valued column as TEXT and MySQL's `json` compares,
// so `SELECT DISTINCT` answers on both; PostgreSQL's `json` defines no equality
// operator and refuses. Asserting the refusal on the other two cells would pin
// a fiction. The envelope invariant itself is measured on every cell by the
// sweep above, on a route no dialect answers.
const PG_CELL = DIALECT_CELLS.find((c) => c.id === 'pg');

if (PG_CELL) {
  declareDialectCell(PG_CELL, 'distinct over a json column (the card route)', (cell) => {
    describe(`[#17639] the JSON-column refusal the card measured (${cell.label})`, () => {
      const JSON_TABLE = 'distinct_fault_json';
      let driver: SqlDriver;

      beforeAll(async () => {
        driver = new SqlDriver(cell.config());
        await driver.execute(`drop table if exists ${JSON_TABLE}`).catch(() => {});
        await driver.initObjects([
          {
            name: JSON_TABLE,
            fields: {
              // [#17469] The three columns here were `toggle` / `boolean` /
              // `number` carrying `multiple: true`, and THAT SHAPE NO LONGER
              // EXISTS. The maintainer ruling of 2026-09-13 gives
              // "multi-valued" one definition (`isMultiValueField`), refuses
              // the flag at the authoring entrance on every type outside it,
              // and derives this driver's storage from the same predicate — so
              // those declarations are ORDINARY SCALAR COLUMNS now, and writing
              // `[false]` into one is a `boolean` column rejecting an array.
              // What the card measures is the `json` STORAGE, which this
              // fixture's own comment below already says, so the three columns
              // are re-spelled onto multi-capable types that still reach it.
              picks: { type: 'select', multiple: true },
              refs: { type: 'lookup', multiple: true },
              people: { type: 'user', multiple: true },
              tags_: { type: 'tags' },
              scalar_flag: { type: 'boolean' },
              // [#17469] The retired shape, kept as the ruling's own control:
              // a scalar `boolean` column, which ANSWERS `distinct` instead of
              // refusing it.
              retired_flags: { type: 'boolean', multiple: true },
            },
          },
        ]);
        await driver.create(
          JSON_TABLE,
          { id: 'j1', picks: ['alpha'], refs: ['r1'], people: ['u1'], tags_: ['a'], scalar_flag: true, retired_flags: true },
          { bypassTenantAudit: true },
        );
        await driver.create(
          JSON_TABLE,
          { id: 'j2', picks: ['beta'], refs: ['r2'], people: ['u2'], tags_: ['b'], scalar_flag: false, retired_flags: false },
          { bypassTenantAudit: true },
        );
      });

      afterAll(async () => {
        await driver.execute(`drop table if exists ${JSON_TABLE}`).catch(() => {});
        await driver.disconnect();
      });

      // Every declared shape the card measured, class-wide rather than
      // per-field-type: what they share is the `json` STORAGE, not the type.
      for (const column of ['picks', 'refs', 'people', 'tags_']) {
        it(`distinct over '${column}' leaves as the envelope, not as pg's DatabaseError`, async () => {
          const err = await caught(() => driver.distinct(JSON_TABLE, column));
          expect(err.code, 'code').toBe('DATABASE_ERROR');
          expect(err.status, 'status').toBe(500);
          // The raw SQLSTATE the caller used to receive is the CAUSE now, and
          // the envelope is what leaves — the whole of this card.
          expect((err as { cause?: any }).cause?.code, 'the SQLSTATE survives as cause').toBe('42883');
          expectNoStatementShape(String(err.message), JSON_TABLE, `distinct over ${column}`);
        });
      }

      // The lit control from the card's own table, in the same table as the
      // failures: a scalar column answers, so the sweep above is measuring a
      // refusal the backend really raises and not a broken fixture.
      it('CONTROL a scalar column in the SAME table answers normally', async () => {
        const values = await driver.distinct(JSON_TABLE, 'scalar_flag');
        expect([...values].sort(), 'scalar_flag').toEqual([false, true]);
      });

      /**
       * ⭐ [#17469] The ruling's own control, on the one cell that can see it.
       * A `boolean` carrying `multiple: true` is NOT multi-valued, so it is a
       * real `boolean` column here — not a `json` one — and `SELECT DISTINCT`
       * therefore ANSWERS over it rather than raising 42883. This row is what
       * turns red if the storage half of the ruling is reverted, and it is the
       * second half of the fixture control: the refusals above are a property
       * of `json` storage, not of the suite.
       */
      it('[#17469] CONTROL a RETIRED `multiple` boolean is a scalar column now — it ANSWERS', async () => {
        const values = await driver.distinct(JSON_TABLE, 'retired_flags');
        expect([...values].sort(), 'retired_flags').toEqual([false, true]);
      });
    });
  });
}
