// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#8931 — the driver stops answering an unenveloped dialect error.
 *
 * Maintainer ruling 2026-08-17 (「同意 C」, recorded on the card): the read
 * exits of `driver-sql` gain a TERMINAL CATCH-ALL. Any dialect error the
 * existing classification does not claim leaves as a GENERIC backend-fault
 * envelope — `DATABASE_ERROR` / 500 — asserting only *"the backend rejected
 * this statement"*, with no dialect text in the caller-visible message.
 *
 * ## The three fences, each of which is a way to get this wrong
 *
 * 1. **No filter verdict.** ⛔ Not `INVALID_FILTER`. Measured live on
 *    PostgreSQL 16.13, the two conditions below raise the SAME SQLSTATE and
 *    differ only in Postgres' own prose:
 *
 *    ```
 *    dotted WHERE key   42P01  missing FROM-clause entry for table "title"
 *    table not created  42P01  relation "no_such_object" does not exist
 *    ```
 *
 *    A driver that answered `INVALID_FILTER` here would tell an operator whose
 *    schema sync had not run that their FILTER was wrong. The signal cannot
 *    support the claim, so the envelope does not make it.
 *
 * 2. **No new per-error-class predicate.** The envelope comes from the exit,
 *    not from recognising `42P01`. A second recognizer beside
 *    `isUnresolvableColumnError` is the split-predicate shape the #8926 ruling
 *    refused — two spellings of "the driver recognises this dialect error" with
 *    different consequences in one file. `isUnresolvableColumnError` and
 *    `isMissingTableError` are both untouched by this card, and the caller's
 *    key is still never inspected for a `.` (#8371 owns that verdict and it
 *    landed there, PR #8936).
 *
 * 3. **No statement shape in the caller-visible message** — no physical table
 *    names, no quoted references, no `$n`. The dialect's full text goes to the
 *    server log instead.
 *
 * ## What now takes the envelope — the enumeration, measured not predicted
 *
 * Every read failure that is not an unresolvable WHERE column (which
 * `unresolvableFilterColumnRefusal` already answered since #8790) and is not
 * already ADR-0112-enveloped. On `origin/main` every one of these left the
 * driver as the dialect's own error object — backend `code`, NO `status`, and a
 * message opening with the compiled statement:
 *
 * | condition                    | pg      | sqlite         |
 * |------------------------------|---------|----------------|
 * | table never provisioned      | `42P01` | `SQLITE_ERROR` |
 * | a dotted WHERE key           | `42P01` | *(refused since #8790)* |
 * | comparand-shape syntax fault | `42601` | `SQLITE_ERROR` |
 * | value rejected by the type   | `22P02` | *(coerced, no error)* |
 * | connection / timeout / ACL   | the dialect's own, no `status` |
 *
 * ⭐ The `22P02` row is worth naming: Postgres puts the caller's REJECTED VALUE
 * in its own diagnostic (`invalid input syntax for type integer:
 * "zz-not-a-number"`), downstream of everything knex parameterised. No
 * statement cut removes it — a redaction that keeps the diagnostic tail keeps
 * the value with it — which is why this envelope COMPOSES its message instead
 * of deriving one, and why closing this row is a genuine disclosure fix rather
 * than a shape change. #8931's own headline premise (a bound literal inlined on
 * the DOTTED route) was measured false and pinned by PR #9108; this is the
 * neighbouring row where a value really does travel.
 *
 * ## What must NOT change, and is pinned here because it is the fork risk
 *
 * `isMissingTableError` (`@objectstack/metadata`) is how thirteen read paths
 * tell "the table was never provisioned" — a benign emptiness — from a failure
 * that must stay loud: `seedAutonumber` returns 0 rather than restarting a
 * counter against a full table, `resolveFileReferences` fails open silently,
 * the delete-dependents probe skips a relation. Wrapping WITHOUT the original
 * attached would flip all three to their loud branch, which is a change to what
 * the platform ACCEPTS and is expressly outside this ruling.
 *
 * The predicate already follows `error.cause` four levels deep, with its own
 * pins (`schema-sync-errors.test.ts`, "follows an error wrapped as `cause`"),
 * because "drivers commonly re-throw with the original attached as `cause`" is
 * a case it was built for. So the wrap keeps the original there — and this
 * suite pins the driver's half of that contract: the cause is present, it is
 * the untouched dialect error, and it is NON-ENUMERABLE so it cannot ride back
 * onto a wire through `JSON.stringify` or a spread.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'backend_fault_task';
const MISSING_TABLE = 'backend_fault_never_created';

/**
 * The caller's value, distinctive on purpose. It is asserted absent from every
 * caller-visible surface — and on the `22P02` cell it is the value Postgres
 * itself prints in its diagnostic, which is what makes that assertion a
 * measurement rather than a formality.
 */
const SECRET_LITERAL = 'zz-backend-fault-must-not-leak';

/**
 * The two predicates the pg-only rows are about, typed rather than cast.
 *
 * `DriverQuery` rather than `as any`: a direct caller holding only a `where`
 * used to reach for a blanket cast and lose `where`'s type with it, which is
 * the erasure `check:query-options-erasure` ratchets — and the same reason the
 * sibling refusal suite spells its cases this way.
 */
const DOTTED_KEY: NonNullable<DriverQuery['where']> = { 'title.x': SECRET_LITERAL };
const TYPE_REJECTED: NonNullable<DriverQuery['where']> = { rank: SECRET_LITERAL };
const UNRESOLVABLE_COLUMN: NonNullable<DriverQuery['where']> = { nosuchcol: SECRET_LITERAL };

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
 * The disclosure clause, applied to one caller-visible message.
 *
 * ⛔ Asserted as a NEGATIVE set plus a positive anchor: the negatives are the
 * ruling ("no statement shape"), the anchor is what stops an emptied message
 * from satisfying them trivially — the same non-triviality guard #9108 added to
 * the dotted disclosure pins, for the same reason.
 */
function expectNoStatementShape(message: string, object: string, half: string): void {
  expect(message, `${half}: no compiled statement`).not.toMatch(/\bselect\s/i);
  expect(message, `${half}: no positional placeholder`).not.toMatch(/\$\d/);
  expect(message, `${half}: no quoted physical reference`).not.toMatch(/["`]/);
  expect(message, `${half}: no bound literal`).not.toContain(SECRET_LITERAL);
  expect(message, `${half}: the caller is still told which object failed`).toContain(object);
}

function declareSweep(cell: DialectCell): void {
describe(`[#8931] driver-sql — the terminal backend-fault envelope (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.execute(`drop table if exists ${MISSING_TABLE}`).catch(() => {});
    await driver.initObjects([
      { name: TABLE, fields: { title: { type: 'string' }, rank: { type: 'integer' } } },
    ]);
    await driver.create(TABLE, { id: 't1', title: 'Design', rank: 1 }, { bypassTenantAudit: true });
    await driver.create(TABLE, { id: 't2', title: 'Build', rank: 2 }, { bypassTenantAudit: true });
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // ───────────────────────────────────────────────────────────────
  // THE RULING — one envelope, both halves, no dialect text
  // ───────────────────────────────────────────────────────────────

  it('a read against a table that was never provisioned takes the envelope on BOTH halves', async () => {
    for (const [half, run] of [
      ['find', () => driver.find(MISSING_TABLE, {})],
      ['count', () => driver.count(MISSING_TABLE, {})],
    ] as const) {
      const err = await caught(run);
      expect(err.code, `${half}: code`).toBe('DATABASE_ERROR');
      expect(err.status, `${half}: status`).toBe(500);
      expectNoStatementShape(String(err.message), MISSING_TABLE, half);
    }
  });

  // The invariant #8790 established on this path — one condition, one answer,
  // whichever half asked — extended by this ruling to every condition the
  // ladder cannot recover. A list view calls both halves, so a split here is
  // what produces an empty page next to a 500-shaped total.
  it('find() and count() answer an unclassified fault the SAME way', async () => {
    const onFind = await caught(() => driver.find(MISSING_TABLE, {}));
    const onCount = await caught(() => driver.count(MISSING_TABLE, {}));
    expect({ code: onCount.code, status: onCount.status, message: onCount.message })
      .toEqual({ code: onFind.code, status: onFind.status, message: onFind.message });
  });

  // ⛔ THE FENCE: the envelope must claim nothing about the filter. A table that
  // was never created is not a filter fault, and on Postgres it raises the very
  // SQLSTATE the dotted key does — so an `INVALID_FILTER` here would be the
  // wrong verdict reached through the right code path.
  it('the envelope makes NO claim about the filter (#8931 fence 1)', async () => {
    const err = await caught(() => driver.find(MISSING_TABLE, {}));
    expect(err.code).not.toBe('INVALID_FILTER');
    expect(err.status).not.toBe(400);
    expect(String(err.message)).not.toMatch(/filter/i);
  });

  // ───────────────────────────────────────────────────────────────
  // THE CAUSE — what keeps `isMissingTableError` truthful
  // ───────────────────────────────────────────────────────────────

  it('keeps the original dialect error as a NON-ENUMERABLE `cause`', async () => {
    const err = await caught(() => driver.find(MISSING_TABLE, {}));
    const cause = (err as { cause?: any }).cause;
    expect(cause, 'the original dialect error must survive as `cause`').toBeDefined();
    // Untouched: the backend's own code and its own words, which is what every
    // cause-following predicate downstream reads.
    expect(typeof cause.code, 'the dialect code is preserved').toBe('string');
    expect(String(cause.message)).toContain(MISSING_TABLE);
    // ⛔ Not enumerable: an enumerable `cause` rides out through
    // `JSON.stringify(err)` and `{ ...err }`, putting the compiled statement —
    // and on the dialects that inline them, the caller's bound literals — back
    // on any wire that serialises the error.
    expect(Object.keys(err), 'own enumerable keys').toEqual(['code', 'status']);
    expect(JSON.stringify(err), 'a serialised envelope carries no dialect text')
      .not.toContain('select');
  });

  // The cross-package consequence, asserted structurally because the predicate
  // itself lives in `@objectstack/metadata` (not a dependency of this package,
  // and deliberately not made one for a test). `isMissingTableError` reads
  // `code` then `message` then one step down `cause` — so these three facts
  // ARE its inputs, and its own suite pins that it follows them.
  it('the `cause` carries everything `isMissingTableError` reads', async () => {
    const err = await caught(() => driver.find(MISSING_TABLE, {}));
    const cause = (err as { cause?: any }).cause;
    const codeOrMessageIdentifiesAMissingTable =
      cause.code === '42P01'
      || cause.code === 'ER_NO_SUCH_TABLE'
      || /no such table|relation ["'`][^"'`]+["'`] does not exist|table ["'`][^"'`]+["'`] doesn'?t exist/i
        .test(String(cause.message));
    expect(
      codeOrMessageIdentifiesAMissingTable,
      'the wrapper must not hide the missing-table signal — three read paths turn a benign '
        + 'emptiness into a loud failure if it does',
    ).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────
  // THE LOG — a withholding, not a deletion
  // ───────────────────────────────────────────────────────────────

  it('writes the full dialect text to the SERVER LOG, statement included', async () => {
    const { err, logged } = await withLog(driver, () => driver.find(MISSING_TABLE, {}));
    expect(err.code).toBe('DATABASE_ERROR');
    const line = logged.find((l) => l.includes(MISSING_TABLE));
    expect(line, 'an operator must still be able to read what the backend said').toBeDefined();
    // The half that makes it a redaction rather than a deletion: the statement
    // the caller may not see is in the log, where an operator can.
    expect(String(line)).toMatch(/\bselect\b/i);
    expect(String(line)).toContain('DATABASE_ERROR');
  });

  // ───────────────────────────────────────────────────────────────
  // CONTROLS — the catch-all is TERMINAL, not blanket
  // ───────────────────────────────────────────────────────────────

  it('CONTROL a working query is untouched on both halves', async () => {
    expect((await driver.find(TABLE, { where: { title: 'Design' } })).map((r: any) => r.id))
      .toEqual(['t1']);
    expect(await driver.count(TABLE, { where: { title: 'Design' } })).toBe(1);
  });

  it('CONTROL a predicate that genuinely matches nothing is still an honest empty list', async () => {
    expect(await driver.find(TABLE, { where: { title: 'no-such-title' } })).toEqual([]);
    expect(await driver.count(TABLE, { where: { title: 'no-such-title' } })).toBe(0);
  });

  // ⛔ The precise refusal must WIN over the generic one. If the catch-all ever
  // ran first, #8790's `INVALID_FILTER` — the answer that names the column a
  // caller can fix — would be buried under a 500 that names nothing.
  it('CONTROL the #8790 filter refusal still wins over the catch-all', async () => {
    for (const [half, run] of [
      ['find', () => driver.find(TABLE, { where: UNRESOLVABLE_COLUMN })],
      ['count', () => driver.count(TABLE, { where: UNRESOLVABLE_COLUMN })],
    ] as const) {
      const err = await caught(run);
      expect(err.code, `${half}`).toBe('INVALID_FILTER');
      expect(err.status, `${half}`).toBe(400);
      expect(String(err.message), `${half}`).toContain('nosuchcol');
    }
  });

  // The #3821 ladder is upstream of the catch-all and must stay so: a
  // recoverable projection or sort still returns rows rather than a 500.
  it('CONTROL the #3821 recoveries still return rows, not the envelope', async () => {
    const rows = await driver.find(TABLE, {
      fields: ['title', 'nosuchfield'],
      orderBy: [{ field: 'alsomissing', order: 'asc' }],
      where: { rank: { $gte: 1 } },
    });
    expect(rows).toHaveLength(2);
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it.
describe('[#8931] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'terminal backend-fault envelope', declareSweep);
}

// ─────────────────────────────────────────────────────────────────
// POSTGRES-ONLY — the two rows the SQLite cell structurally cannot show
// ─────────────────────────────────────────────────────────────────

/**
 * The card's own route, and the row where a caller's VALUE really travels.
 *
 * Both need a live Postgres because both are facts about Postgres' parser:
 * SQLite refuses a dotted key as an unresolvable COLUMN (so #8790 already
 * answered it, and it never reaches the catch-all), and SQLite coerces
 * `'zz-…'` against an INTEGER column without complaining at all.
 */
const PG = DIALECT_CELLS.find((c) => c.id === 'pg')!;

declareDialectCell(PG, 'backend-fault envelope — the pg-only rows', (cell) => {
describe('[#8931] postgres — the dotted route and the value-bearing diagnostic', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}_pg`).catch(() => {});
    await driver.initObjects([
      { name: `${TABLE}_pg`, fields: { title: { type: 'string' }, rank: { type: 'integer' } } },
    ]);
    await driver.create(`${TABLE}_pg`, { id: 't1', title: 'Design', rank: 1 }, { bypassTenantAudit: true });
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}_pg`).catch(() => {});
    await driver.disconnect();
  });

  // ⭐ THE CARD. Before this ruling both halves answered a raw `42P01` with no
  // `status`, carrying `select … where "title"."x" = $1 - missing FROM-clause
  // entry for table "title"` — the statement's shape, to the caller.
  it('a dotted WHERE key is enveloped on both halves, with no statement shape', async () => {
    for (const [half, run] of [
      ['find', () => driver.find(`${TABLE}_pg`, { where: DOTTED_KEY })],
      ['count', () => driver.count(`${TABLE}_pg`, { where: DOTTED_KEY })],
    ] as const) {
      const err = await caught(run);
      expect(err.code, `${half}`).toBe('DATABASE_ERROR');
      expect(err.status, `${half}`).toBe(500);
      expectNoStatementShape(String(err.message), `${TABLE}_pg`, half);
      // ⛔ Specifically: none of the three shapes the card measured escaping.
      expect(String(err.message), `${half}`).not.toContain('missing FROM-clause entry');
      expect(String(err.message), `${half}`).not.toContain('title');
    }
  });

  // ⭐ The row where Postgres itself inlines the caller's value — in its OWN
  // diagnostic, after knex parameterised the statement. A statement-cut
  // redaction keeps the tail and therefore keeps the value; withholding the
  // dialect text whole is what closes it.
  it('a value the column type rejects never reaches the caller (22P02)', async () => {
    const { err, logged } = await withLog(driver, () =>
      driver.find(`${TABLE}_pg`, { where: TYPE_REJECTED }),
    );
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
    expect((err as { cause?: any }).cause?.code, 'the pg SQLSTATE for a bad input value').toBe('22P02');
    expectNoStatementShape(String(err.message), `${TABLE}_pg`, '22P02');
    for (const key of Object.keys(err ?? {})) {
      const value = (err as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        expect(value, `own property '${key}'`).not.toContain(SECRET_LITERAL);
      }
    }
    // POSITIVE CONTROL — the value really was in the dialect's text, so the
    // absence above is a withholding rather than a statement about a string
    // that never held it. This is the assertion that would go green for the
    // wrong reason if pg ever stopped naming the value.
    expect(
      logged.some((l) => l.includes(SECRET_LITERAL)),
      "postgres' own 22P02 diagnostic should have carried the caller's value into the log",
    ).toBe(true);
  });
});
});
