// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#11455 — `aggregate()` joins the enveloped read exits.
 *
 * ## The measurement this suite is built from
 *
 * On live PostgreSQL 16.13, `driver-sql` maps a `boolean` field to a real PG
 * `boolean` column and `SQL_AGGREGATE_FUNCTIONS` lowers the arithmetic
 * aggregates to a bare function name with no cast, so the statement reaches the
 * server as `avg("flag")`. Postgres has no `avg`/`sum`/`min`/`max` over
 * `boolean`, and on `origin/main` the failure escaped `SqlDriver.aggregate()`
 * un-enveloped:
 *
 * ```
 * sum(flag) => THREW code=42883 status=undefined
 *              msg=select sum("flag") as "n" from "…" - function sum(boolean) does not exist
 * ```
 *
 * A raw `42883` is on no list `@objectstack/rest` reads, so `status` was
 * `undefined` and an ordinary analytics mistake was logged as an unhandled
 * server fault.
 *
 * ## ⛔ THE FENCE — this suite is the ENVELOPE half and nothing else
 *
 * Whether the platform should ANSWER A NUMBER here (by casting boolean to int
 * in the lowering) or REFUSE is a contract question, and it belongs to #11152
 * (spec seat) and — for `min`/`max` — #11249. Nothing in this file decides it.
 * What is asserted is the half that holds either way: **when it fails, the
 * failure carries a catalogued code and a status.**
 *
 * Read the two pins below that exist to keep that fence honest:
 *
 * - the envelope must NOT be `INVALID_QUERY` / 400. That code is the platform
 *   saying *"asking for a mean over a flag column is your mistake"* — which is
 *   precisely one of the two answers #11152 has yet to choose between, and
 *   declaring it here would decide the card from the driver.
 * - the three dialects' ARITHMETIC answers are deliberately NOT pinned. Measured
 *   2026-08-24 while taking this card's readings: SQLite answers (`sum` 3,
 *   `avg` 0.5, `min` false, `max` true), MySQL answers too (`tinyint(1)`:
 *   `sum` 3, `avg` 0.5000, `min` 0, `max` 1), Postgres refuses. Freezing that
 *   divergence in a test is the same pre-emption by another route.
 *
 * ## Why `DATABASE_ERROR` / 500, from the code rather than from taste
 *
 * ADR-0112 D3/D4 closed the `StandardErrorCode` vocabulary and D2's 2026-08-18
 * amendment RETIRED three members on the reasoning that an
 * unreachable-but-declared code teaches a branch that can never fire — so no
 * code is minted here, an existing catalogued member is chosen.
 *
 * `DATABASE_ERROR` / 500 is not a new posture invented for this card: it is the
 * envelope `find()` and `count()` already answer with for any dialect error
 * their classification does not claim (`backendStatementFaultError`, #8931,
 * maintainer ruling 2026-08-17 「同意 C」). It asserts exactly one thing — *the
 * backend would not run this statement* — which is the only claim the signal
 * supports, and the only claim that survives #11152 ruling either way.
 *
 * ## Following the family, not inventing a fifth shape
 *
 * | card  | door             | before                          | after                |
 * |-------|------------------|---------------------------------|----------------------|
 * | #5907 | aggregate FUNC   | bare `Error`, no code/status    | 400 / 501 at the map |
 * | #8790 | `count()` WHERE  | raw dialect error               | `INVALID_FILTER`/400 |
 * | #8926 | MySQL wording    | matched by neither arm          | the #8790 envelope   |
 * | #8931 | read exits       | raw dialect error, no `status`  | `DATABASE_ERROR`/500 |
 * | #11455| `aggregate()`    | raw dialect error, no `status`  | `DATABASE_ERROR`/500 |
 *
 * ⭐ #8926 is the one worth naming: it is the case where a predicate arm's
 * WORDING MATCH failed to fire on a dialect nobody had measured. This fix
 * cannot fail that way — the envelope comes from the EXIT, not from recognising
 * `42883`, so there is no wording to match and no dialect that can be forgotten.
 * The all-dialect sweep below asserts that structurally, on a route (a table
 * that was never provisioned) that has nothing to do with booleans.
 *
 * ## What is deliberately NOT here
 *
 * ⛔ No `isUnresolvableColumnError` arm, unlike `count()`. That refusal's words
 * are *"Filter on 'x' names a column that object 'o' has no column for"*, and
 * this door names columns in THREE clauses — the WHERE, the `groupBy` fields
 * and the aggregation `field`. A blanket arm would tell the author of
 * `avg('nosuchcol')` that their FILTER was wrong. Filed as its own card rather
 * than guessed at here; see the note on `SqlDriver.aggregate`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'agg_fault_task';
const MISSING_TABLE = 'agg_fault_never_created';
const BOOL_TABLE = 'agg_fault_bool';

/**
 * The caller's value, distinctive on purpose, asserted absent from every
 * caller-visible surface.
 */
const SECRET_LITERAL = 'zz-agg-fault-must-not-leak';

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
 * NEGATIVE-set-plus-positive-anchor shape the #8931 suite uses, so an emptied
 * message cannot satisfy it trivially.
 */
function expectNoStatementShape(message: string, object: string, half: string): void {
  expect(message, `${half}: no compiled statement`).not.toMatch(/\bselect\s/i);
  expect(message, `${half}: no positional placeholder`).not.toMatch(/\$\d/);
  expect(message, `${half}: no quoted physical reference`).not.toMatch(/["`]/);
  expect(message, `${half}: no bound literal`).not.toContain(SECRET_LITERAL);
  expect(message, `${half}: the caller is still told which object failed`).toContain(object);
}

function declareSweep(cell: DialectCell): void {
describe(`[#11455] driver-sql — aggregate() takes the backend-fault envelope (${cell.label})`, () => {
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
  // envelope invariant measured on EVERY cell — and it involves no boolean, so
  // #11152's ruling cannot move it in either direction.
  it('an unclassified dialect fault on the aggregate door carries a code AND a status', async () => {
    const err = await caught(() => driver.aggregate(MISSING_TABLE, COUNT_ALL));
    expect(err.code, 'code').toBe('DATABASE_ERROR');
    expect(err.status, 'status').toBe(500);
    expectNoStatementShape(String(err.message), MISSING_TABLE, 'aggregate');
  });

  // The #8931 invariant — one condition, one answer, whichever read half asked
  // — extended to the third read door. A dashboard tile calls `aggregate()`
  // where a list view calls `find()`/`count()`; a split here is what produced a
  // declared 500 on two doors and an unhandled fault on the third.
  it('find(), count() and aggregate() answer one unclassified fault the SAME way', async () => {
    const onFind = await caught(() => driver.find(MISSING_TABLE, {}));
    const onCount = await caught(() => driver.count(MISSING_TABLE, {}));
    const onAggregate = await caught(() => driver.aggregate(MISSING_TABLE, COUNT_ALL));
    const shape = (e: any) => ({ code: e.code, status: e.status, message: e.message });
    expect(shape(onAggregate), 'aggregate vs find').toEqual(shape(onFind));
    expect(shape(onAggregate), 'aggregate vs count').toEqual(shape(onCount));
  });

  // ⛔ THE FENCE: the envelope claims nothing about the request. A table that
  // was never created is not a query fault, and answering `INVALID_QUERY`/400
  // here would be a verdict the signal cannot support.
  it('the envelope makes NO claim about the query or the filter', async () => {
    const err = await caught(() => driver.aggregate(MISSING_TABLE, COUNT_ALL));
    expect(err.code).not.toBe('INVALID_QUERY');
    expect(err.code).not.toBe('INVALID_FILTER');
    expect(err.status).not.toBe(400);
    expect(String(err.message)).not.toMatch(/filter/i);
  });

  // ───────────────────────────────────────────────────────────────
  // THE CAUSE — what keeps `isMissingTableError` truthful
  // ───────────────────────────────────────────────────────────────

  it('keeps the original dialect error as a NON-ENUMERABLE `cause`', async () => {
    const err = await caught(() => driver.aggregate(MISSING_TABLE, COUNT_ALL));
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

  // The cross-package consequence, asserted structurally: `isMissingTableError`
  // (`@objectstack/metadata`) reads `code` then `message` then follows `cause`,
  // and three read paths turn a benign emptiness into a loud failure if the
  // wrapper hides that signal.
  it('the `cause` carries everything `isMissingTableError` reads', async () => {
    const err = await caught(() => driver.aggregate(MISSING_TABLE, COUNT_ALL));
    const cause = (err as { cause?: any }).cause;
    const identifiesAMissingTable =
      cause.code === '42P01'
      || cause.code === 'ER_NO_SUCH_TABLE'
      || /no such table|relation ["'`][^"'`]+["'`] does not exist|table ["'`][^"'`]+["'`] doesn'?t exist/i
        .test(String(cause.message));
    expect(identifiesAMissingTable, 'the wrapper must not hide the missing-table signal').toBe(true);
  });

  // ───────────────────────────────────────────────────────────────
  // THE LOG — a withholding, not a deletion
  // ───────────────────────────────────────────────────────────────

  it('writes the full dialect text to the SERVER LOG, statement included', async () => {
    const { err, logged } = await withLog(driver, () => driver.aggregate(MISSING_TABLE, COUNT_ALL));
    expect(err.code).toBe('DATABASE_ERROR');
    const line = logged.find((l) => l.includes(MISSING_TABLE));
    expect(line, 'an operator must still be able to read what the backend said').toBeDefined();
    expect(String(line)).toMatch(/\bselect\b/i);
    expect(String(line)).toContain('DATABASE_ERROR');
  });

  // ───────────────────────────────────────────────────────────────
  // CONTROLS — the catch-all is TERMINAL, not blanket
  // ───────────────────────────────────────────────────────────────

  // `Number(...)` rather than a literal, on both halves: node-pg hands back a
  // `bigint`/`numeric` as a STRING (`'2'`), so a literal comparison here would
  // be a pg-only red about the pg client's type mapping, not about this card.
  it('CONTROL a working aggregate is untouched', async () => {
    const counted = await driver.aggregate(TABLE, { aggregations: [{ function: 'count', alias: 'n' }] });
    expect(Number(counted[0].n), 'count(*)').toBe(2);
    const summed = await driver.aggregate(TABLE, {
      aggregations: [{ function: 'sum', field: 'rank', alias: 'total' }],
    });
    expect(Number(summed[0].total), 'sum over an integer column').toBe(4);
  });

  // ⛔ The precise refusals must WIN over the generic one. All three are raised
  // while the statement is BUILT — upstream of the execution the catch-all
  // guards — and burying any of them under a 500 that names nothing is the
  // regression this control exists to catch.
  it('CONTROL the #5907 / #6409 / #10576 refusals still win over the catch-all', async () => {
    const undeclared = await caught(() =>
      driver.aggregate(TABLE, { aggregations: [{ function: 'median' as never, field: 'rank', alias: 'n' }] }),
    );
    expect(undeclared.code, 'an undeclared function').toBe('INVALID_QUERY');
    expect(undeclared.status, 'an undeclared function').toBe(400);

    const noField = await caught(() =>
      driver.aggregate(TABLE, { aggregations: [{ function: 'count_distinct', alias: 'n' }] }),
    );
    expect(noField.code, 'count_distinct with no field').toBe('INVALID_QUERY');
    expect(noField.status, 'count_distinct with no field').toBe(400);

    const filtered = await caught(() =>
      driver.aggregate(TABLE, {
        aggregations: [{ function: 'count', alias: 'n', filter: { rank: 1 } }],
      } as DriverQuery),
    );
    expect(filtered.code, 'a per-aggregation filter').toBe('NOT_IMPLEMENTED');
    expect(filtered.status, 'a per-aggregation filter').toBe(501);
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#11455] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'aggregate backend-fault envelope', declareSweep);
}

// ─────────────────────────────────────────────────────────────────
// POSTGRES-ONLY — the card's own route
// ─────────────────────────────────────────────────────────────────

/**
 * The boolean aggregate is a fact about POSTGRES' function catalog: it is the
 * only one of the three dialects that stores a `boolean` field as a real
 * `boolean` column with no arithmetic aggregates defined over it. SQLite and
 * MySQL both answer arithmetically (see the head note), so neither cell can
 * show this row at all.
 *
 * ⚠️ If #11152 / #11249 rule that the lowering should CAST, these cases stop
 * failing and this block is RETIRED by that card — it is not weakened here in
 * anticipation of a ruling that has not happened.
 */
const PG = DIALECT_CELLS.find((c) => c.id === 'pg')!;

declareDialectCell(PG, 'aggregate backend-fault envelope — the boolean row', (cell) => {
describe('[#11455] postgres — an arithmetic aggregate over a boolean column', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${BOOL_TABLE}`).catch(() => {});
    await driver.initObjects([
      { name: BOOL_TABLE, fields: { flag: { type: 'boolean' }, note: { type: 'string' } } },
    ]);
    for (const [id, flag] of [['b1', true], ['b2', false], ['b3', true]] as const) {
      await driver.create(BOOL_TABLE, { id, flag, note: SECRET_LITERAL }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${BOOL_TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // ⭐ THE CARD. On `origin/main` each of these four left the driver as
  // Postgres' own error object: `code: '42883'`, `status: undefined`, and
  // `select avg("flag") as "n" from "…" - function avg(boolean) does not exist`
  // as the message.
  it.each(['sum', 'avg', 'min', 'max'] as const)(
    '%s over a boolean column carries a catalogued code and a status',
    async (func) => {
      const err = await caught(() =>
        driver.aggregate(BOOL_TABLE, { aggregations: [{ function: func, field: 'flag', alias: 'n' }] }),
      );
      expect(err.code, `${func}: code`).toBe('DATABASE_ERROR');
      expect(err.status, `${func}: status`).toBe(500);
      expect(typeof err.status, `${func}: status is declared, not undefined`).toBe('number');
      expectNoStatementShape(String(err.message), BOOL_TABLE, func);
      // The SQLSTATE the card measured, kept where an operator and every
      // cause-following predicate can still read it.
      expect((err as { cause?: any }).cause?.code, `${func}: the pg SQLSTATE`).toBe('42883');
    },
  );

  // ⛔ THE FENCE, asserted rather than promised. `INVALID_QUERY` / 400 is the
  // platform saying "a mean over a flag column is YOUR mistake" — one of the
  // two answers #11152 (and #11249 for min/max) has yet to choose between. The
  // driver declares no verdict about the request here.
  it('claims NOTHING about whether a boolean aggregate should answer (#11152 / #11249)', async () => {
    const err = await caught(() =>
      driver.aggregate(BOOL_TABLE, { aggregations: [{ function: 'avg', field: 'flag', alias: 'n' }] }),
    );
    expect(err.code, 'not a request verdict').not.toBe('INVALID_QUERY');
    expect(err.status, 'not a request verdict').not.toBe(400);
    expect(String(err.message), 'no verdict prose about the function or the field')
      .not.toMatch(/boolean|avg|flag/i);
  });

  // POSITIVE CONTROL — the table, the column and the rows are real, and the
  // aggregate door still answers over the very same boolean column for the two
  // functions Postgres DOES define. Without this the block above could go green
  // against a table that never existed.
  it('CONTROL count / count_distinct over the same boolean column still answer', async () => {
    const counted = await driver.aggregate(BOOL_TABLE, {
      aggregations: [{ function: 'count', field: 'flag', alias: 'n' }],
    });
    expect(Number(counted[0].n), 'count over the boolean column').toBe(3);
    const distinct = await driver.aggregate(BOOL_TABLE, {
      aggregations: [{ function: 'count_distinct', field: 'flag', alias: 'n' }],
    });
    expect(Number(distinct[0].n), 'count_distinct over the boolean column').toBe(2);
  });

  // The disclosure half, on the route that carries a caller-authored value: the
  // dialect text goes to the log, never to the caller.
  it('the dialect text reaches the SERVER LOG and not the caller', async () => {
    const { err, logged } = await withLog(driver, () =>
      driver.aggregate(BOOL_TABLE, { aggregations: [{ function: 'avg', field: 'flag', alias: 'n' }] }),
    );
    expect(err.code).toBe('DATABASE_ERROR');
    expectNoStatementShape(String(err.message), BOOL_TABLE, 'avg');
    const line = logged.find((l) => l.includes('DATABASE_ERROR'));
    expect(line, 'the operator must still be able to read the backend diagnostic').toBeDefined();
    // POSITIVE CONTROL — the words really were in the dialect's text, so their
    // absence from the caller's message is a withholding, not a statement about
    // a string that never held them.
    expect(String(line)).toContain('function avg(boolean) does not exist');
    expect(String(line)).toContain('42883');
  });
});
});
