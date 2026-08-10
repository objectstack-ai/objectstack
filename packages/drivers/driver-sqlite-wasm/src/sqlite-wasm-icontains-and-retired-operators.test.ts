// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5702] `$icontains` and the `$regex` retirement, EXECUTED by sql.js.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the compiler is inherited and nothing
 * here re-implements it. What this pins is the other half — the half its
 * temporal, pagination and filter-logic suites exist for: the compiled predicate
 * has to survive a different ENGINE. This driver swaps knex's transport for a
 * custom sql.js dialect (`Client_WasmSqlite`) that compiles the statement, binds
 * its parameters and marshals the rows back through its own path.
 *
 * `$icontains` is the first operator this package has ever run whose predicate
 * is a FUNCTION CALL on the column (`lower(col) …`) rather than a bare column
 * reference. Every text predicate before it compiled to `col LIKE ?`. A dialect
 * that mis-binds the parameters of that form, or that renders `??` inside a
 * function call differently, produces precisely the failure a shared standard
 * exists to rule out — a filter that looks applied and selects the wrong rows —
 * and it would fail in no other suite in the repo. "It inherits the compiler,
 * therefore it is fine" is the assumption these suites exist to disprove.
 *
 * # [#6518] What changed under this file, and why the ENGINE axis got harder
 *
 * `textMatchPredicate` now emits `GLOB`, not `LIKE`, on the SQLite dialects,
 * because SQLite's `LIKE` folds ASCII case where #4706 Q2 = A rules the
 * `$contains` family case-SENSITIVE. For a separately compiled engine that is a
 * new question, not a smaller one: `GLOB` is a different SQL function, with a
 * different metacharacter set (`*`, `?`, `[`), no `ESCAPE` clause, and its own
 * implementation inside whichever SQLite build this package loaded. An sql.js
 * build whose `glob()` differed would answer wrong rows here and nowhere else.
 *
 * This cell therefore now runs the WHOLE `FILTER_TEXT_CASES` table rather than
 * a hand-picked subset. #5702 could not: five of its cases require the
 * case-sensitivity this driver did not yet have, and importing the case-set is
 * what `scripts/check-driver-conformance.mjs` reads as coverage — so the import
 * would have claimed a standard five of whose cases went unanswered.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { SqliteWasmDriver } from './index.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

describe('[#5702] driver-sqlite-wasm — $icontains and the retired $regex, on sql.js', () => {
  let driver: SqliteWasmDriver;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: 'txt', fields: { name: { type: 'string' } } }]);
    for (const row of FILTER_TEXT_ROWS) {
      await driver.create('txt', { ...row }, BYPASS);
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const ids = async (where: FilterCondition): Promise<string[]> => {
    const rows = await driver.find('txt', { where }, BYPASS);
    return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
  };

  it('the fixture really is all nine rows', async () => {
    expect(await ids({})).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('$icontains folds ASCII case in both directions, through the wasm engine', async () => {
    expect(await ids({ name: { $icontains: 'acme' } })).toEqual(['1', '2']);
    expect(await ids({ name: { $icontains: 'ACME' } })).toEqual(['1', '2']);
  });

  it('$icontains folds ASCII ONLY — sql.js `lower()` must not reach É', async () => {
    // The dialect boundary #4706 Q1 = A pinned, asserted against THIS engine's
    // `lower()` rather than against better-sqlite3's. Both are SQLite, but they
    // are separately compiled builds and an ICU-enabled one would fold É and
    // answer ['3','4'] to both lines.
    expect(await ids({ name: { $icontains: 'café' } })).toEqual(['4']);
    expect(await ids({ name: { $icontains: 'CAFÉ' } })).toEqual(['3']);
  });

  it('$icontains keeps the pattern metacharacters literal across the wasm bind path', async () => {
    // [#6518] Under `GLOB` these three characters are literal to the OPERATOR
    // rather than escaped by the emitter, which is a different claim about this
    // engine than the LIKE version made: it says sql.js's `glob()` agrees with
    // better-sqlite3's about what is NOT a metacharacter.
    expect(await ids({ name: { $icontains: '100%' } })).toEqual(['5']);
    expect(await ids({ name: { $icontains: 'a_b' } })).toEqual(['7']);
    expect(await ids({ name: { $icontains: 'a.b' } })).toEqual(['9']);
  });

  it('[#6518] the $contains family is case-SENSITIVE through the wasm engine', async () => {
    // `GLOB` is supplied by the SQLite build, not by the application, so this
    // is the assertion that THIS build's `glob()` is case-exact. On
    // `origin/main` (where the family compiled to `LIKE`) both lines answered
    // ['1','2'].
    expect(await ids({ name: { $contains: 'acme' } })).toEqual(['2']);
    expect(await ids({ name: { $contains: 'ACME' } })).toEqual(['1']);
    expect(await ids({ name: { $startsWith: 'ACME' } })).toEqual(['1']);
    expect(await ids({ name: { $endsWith: 'corp' } })).toEqual(['2']);
  });

  it('[#6518] the GLOB metacharacters are escaped, on this engine too', async () => {
    // A new escaped character class arrived with the new operator, and an
    // unescaped `*` is the filter bypass an unescaped `%` was: `*a*b*` matches
    // rows 7, 8 and 9 where the escaped pattern matches none of them.
    for (const comparand of ['a*b', 'a?b', 'a[b'] as const) {
      expect(await ids({ name: { $contains: comparand } }), comparand).toEqual([]);
      expect(await ids({ name: { $icontains: comparand } }), comparand).toEqual([]);
    }
  });

  it('REFUSES the retired $regex, in the ADR-0112 envelope, naming $icontains', async () => {
    const err = await driver
      .find('txt', { where: { name: { $regex: 'ac.*' } } }, BYPASS)
      .then(() => null, (e: unknown) => e as WireBearingError);
    expect(err).toBeInstanceOf(Error);
    expect(err!.code).toBe('INVALID_FILTER');
    expect(err!.status).toBe(400);
    expect(err!.message).toContain('$regex');
    expect(err!.message).toContain('$icontains');
  });

  it('REFUSES an $icontains comparand that constrains nothing', async () => {
    for (const comparand of ['', 42] as const) {
      const err = await driver
        .find('txt', { where: { name: { $icontains: comparand } } }, BYPASS)
        .then(() => null, (e: unknown) => e as WireBearingError);
      expect(err, `expected ${JSON.stringify(comparand)} to be refused`).toBeInstanceOf(Error);
      expect(err!.code).toBe('INVALID_FILTER');
      expect(err!.status).toBe(400);
    }
  });

  /**
   * [#6518] The shared standard, executed on sql.js.
   *
   * The invariant is the case-set's own: the same row set, or a refusal
   * carrying `INVALID_FILTER` — never a third, quieter answer. The blocks above
   * stay because they name what is specific to THIS engine (which function is
   * called, which characters that function treats as metacharacters); the table
   * knows only the contract.
   */
  describe('FILTER_TEXT_CASES — the shared standard', () => {
    for (const testCase of FILTER_TEXT_CASES) {
      it(testCase.name, async () => {
        if (testCase.expectRejection) {
          const err = await driver
            .find('txt', { where: testCase.filter }, BYPASS)
            .then(() => null, (e: unknown) => e as WireBearingError);
          expect(err, 'the case-set requires this filter REFUSED, not answered').toBeInstanceOf(Error);
          expect(err!.code).toBe(testCase.code);
          expect(err!.status).toBe(400);
          for (const mention of testCase.mustMention) expect(err!.message).toContain(mention);
          return;
        }
        expect(await ids(testCase.filter), testCase.note ?? testCase.name)
          .toEqual([...testCase.expected]);
      });
    }
  });
});
