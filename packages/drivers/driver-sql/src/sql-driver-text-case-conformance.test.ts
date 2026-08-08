// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6518] `FILTER_TEXT_CASES` across the DRIVER axis — the case-folding half of
 * the #4706 ruling, executed on every dialect this driver speaks.
 *
 * # Why this needs the live matrix and cannot be decided on SQLite
 *
 * Case folding is the one axis where the three dialects disagree by
 * construction, so an in-process SQLite run answers at most a third of the
 * question:
 *
 * | | `$contains` family (case-SENSITIVE, Q2=A) | `$icontains` (ASCII-only fold, Q1=A) |
 * |---|---|---|
 * | SQLite | `LIKE` folded ASCII — the defect | `lower()` is ASCII-only — already right |
 * | Postgres | `LIKE` is case-exact — already right | `LOWER()` folds all of Unicode — the defect |
 * | MySQL | follows the collation | `LOWER()` folds all of Unicode — the defect |
 *
 * Read across: **each dialect was already correct on the half the other one got
 * wrong.** A suite that ran only on SQLite would go green on the `$icontains`
 * rows for a reason that does not transfer (SQLite's `lower()` simply cannot
 * reach `É`), and a suite that ran only on Postgres would go green on the
 * `$contains` rows for a reason that does not transfer either. The ASCII-only
 * boundary — rows 3 and 4, `CAFÉ` / `café` — is decidable ONLY where `LOWER()`
 * would have folded it, i.e. on a live Postgres or MySQL. That is why the issue
 * put "the `$icontains` ASCII-only boundary holds on live PG / MySQL" in its
 * acceptance rather than leaving it to the embedded cell.
 *
 * # Which cells actually executed, and which did not
 *
 * Recorded here rather than implied, because a matrix that reports OK while
 * finding zero live cells is the failure `declareUnprovisionedCell` exists for
 * (#4646):
 *
 *   - **sqlite** — always runs, embedded.
 *   - **live postgres** — RUN, on PostgreSQL 16.13, against a database created
 *     with the ICU locale provider (the configuration in which `LOWER('CAFÉ')`
 *     really is `'café'`, so the over-fold this closes was reproduced before the
 *     fix and is absent after it).
 *   - **live mysql** — NOT run: no MySQL server was provisionable in the
 *     container this landed from, so it is a declared SKIP, and the MySQL arm of
 *     `textMatchPredicate` rests on documented behaviour plus the compiled-SQL
 *     pin below rather than on execution. Saying so is the point — the cell is
 *     skipped by name, and `OS_EXPECT_LIVE_DIALECT_MATRIX=1` turns that skip
 *     into a failure for a runner that believes it provisioned one.
 *
 * # Reverse verification, direction predicted BEFORE it was run
 *
 * Two experiments, each reverting ONE arm and each predicted to fail a DIFFERENT
 * pair of cells — which is the claim that the two halves of this issue are
 * genuinely independent rather than one defect seen twice:
 *
 *   - Revert the sqlite arm to `LIKE`. Predicted: the five case-sensitivity
 *     rows go red on the sqlite cell and nothing goes red on postgres.
 *     Measured: exactly that.
 *   - Revert the postgres fold from `translate()` to `LOWER()`. Predicted: the
 *     two ASCII-only rows go red on the LIVE POSTGRES cell and nothing goes red
 *     on sqlite. Measured: exactly that — `$icontains: 'café'` answered
 *     `['3','4']` where the case-set demands `['4']`, and its `'CAFÉ'` mirror
 *     answered `['3','4']` where it demands `['3']`. That is the over-fold, on
 *     a real server, before and after.
 *
 * # The compiled-SQL layer, and why it is not redundant with the rows
 *
 * The last block asserts the SHAPE each dialect compiles to. On the cells that
 * run, rows are the stronger witness and the shape is a bonus. On the cell that
 * does NOT run, the shape is the only thing this repo can check at all — so it
 * is checked for all three dialects from the in-process cell, where knex will
 * build a Postgres or MySQL statement without needing a server to send it to.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { SqlDriver, type SqlDriverConfig } from './sql-driver.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/**
 * Issue-prefixed object name: the live cells share one database with every other
 * suite in this package, so a bare `text_conformance` would be a collision
 * waiting to be read as a case-folding regression.
 */
const TEXT_OBJECT = 'os6518_text_case';

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, 'FILTER_TEXT_CASES case folding');
    continue;
  }
  declareTextCaseSweep(cell);
}

function declareTextCaseSweep(cell: DialectCell): void {
  describe(`SqlDriver FILTER_TEXT_CASES (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: Knex;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      // `getKnex()` is public API; the sibling matrices reach the `protected`
      // field through `(driver as any).knex`, which erases every member of the
      // driver to get one. Nothing here needs that.
      knexInstance = driver.getKnex();
      await knexInstance.schema.dropTableIfExists(TEXT_OBJECT);
      await driver.initObjects([{ name: TEXT_OBJECT, fields: { name: { type: 'string' } } }]);
      for (const row of FILTER_TEXT_ROWS) {
        await driver.create(TEXT_OBJECT, { ...row }, BYPASS);
      }
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(TEXT_OBJECT).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = async (where: FilterCondition): Promise<string[]> => {
      const rows = await driver.find(TEXT_OBJECT, { where }, BYPASS);
      return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    /**
     * The fixture control. Rows 1/2 and 3/4 differ ONLY in case, so a store or
     * a transport that normalised case on the way IN would turn most cases
     * below green for a reason that has nothing to do with the compiler — and
     * would turn the ASCII-only pair green while proving nothing.
     */
    it('stored all nine rows with their case intact', async () => {
      const rows = await driver.find(TEXT_OBJECT, {}, BYPASS);
      const byId = new Map(rows.map((r) => [String(r.id), String(r.name)]));
      expect([...byId.keys()].sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
      expect(byId.get('1')).toBe('ACME Corp');
      expect(byId.get('2')).toBe('acme corp');
      expect(byId.get('3')).toBe('CAFÉ');
      expect(byId.get('4')).toBe('café');
    });

    for (const testCase of FILTER_TEXT_CASES) {
      it(testCase.name, async () => {
        if (testCase.expectRejection) {
          const err = await driver
            .find(TEXT_OBJECT, { where: testCase.filter }, BYPASS)
            .then(() => null, (e: unknown) => e as WireBearingError);
          expect(err, 'the case-set requires this filter REFUSED, not answered').toBeInstanceOf(Error);
          // `code` AND `status`: a refusal outside the ADR-0112 envelope reaches
          // the client as a 500-shaped body for a 400-class mistake.
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
}

/**
 * The construct each dialect compiles to, decided WITHOUT a server.
 *
 * knex builds a statement for whichever client it was configured with, and
 * `.toString()` renders it — so the mysql shape is checkable here even though no
 * MySQL server ran. This is the layer that keeps the un-provisioned cell from
 * being entirely unverified, and it is deliberately about the SHAPE (which
 * operator, which fold, whether an `ESCAPE` clause exists) rather than about
 * exact whitespace.
 */
describe('[#6518] the per-dialect construct, compiled', () => {
  /** A driver that exposes the compiled WHERE without reaching into privates. */
  class CompilerProbeDriver extends SqlDriver {
    compileWhere(where: FilterCondition): string {
      const builder: Knex.QueryBuilder = this.getKnex()(TEXT_OBJECT);
      this.applyFilters(builder, where);
      return builder.toString();
    }
  }

  const probe = (config: SqlDriverConfig) => new CompilerProbeDriver(config);

  it('sqlite: GLOB, case-exact, with no ESCAPE clause', () => {
    const d = probe({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const contains = d.compileWhere({ name: { $contains: 'acme' } });
    expect(contains).toMatch(/GLOB/);
    expect(contains).not.toMatch(/LIKE|ESCAPE|lower\(/);
    const icontains = d.compileWhere({ name: { $icontains: 'acme' } });
    expect(icontains).toMatch(/lower\(.*\)\s+GLOB\s+lower\(/);
    expect(icontains).not.toMatch(/ESCAPE/);
  });

  it('postgres: LIKE unchanged, and the fold is translate() — never LOWER()', () => {
    const d = probe({ client: 'pg', connection: { host: '127.0.0.1' } });
    const contains = d.compileWhere({ name: { $contains: 'acme' } });
    expect(contains).toMatch(/LIKE/);
    expect(contains).toMatch(/ESCAPE/);
    expect(contains).not.toMatch(/translate|LOWER|GLOB/);

    const icontains = d.compileWhere({ name: { $icontains: 'acme' } });
    // BOTH operands folded — folding only the comparand compares a folded
    // needle against a raw column and silently matches only the already-lower
    // rows. And `LOWER()` must not reappear: on Postgres it folds `É`, which is
    // the exact over-fold #4706 Q1 = A rules out.
    expect(icontains.match(/translate\(/g) ?? []).toHaveLength(2);
    expect(icontains).not.toMatch(/LOWER\(/);
    expect(icontains).toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(icontains).toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('mysql: the comparison is BINARY, so no collation decides the case', () => {
    const d = probe({ client: 'mysql2', connection: { host: '127.0.0.1' } });
    const contains = d.compileWhere({ name: { $contains: 'acme' } });
    // Two casts, one per operand: MySQL would coerce the second anyway, but a
    // shape that relies on coercion is a shape a future edit can quietly break.
    expect(contains.match(/CAST\(/g) ?? []).toHaveLength(2);
    expect(contains).toMatch(/AS BINARY/);
    expect(contains).toMatch(/LIKE/);
    expect(contains).not.toMatch(/LOWER\(|REPLACE\(/);

    const icontains = d.compileWhere({ name: { $icontains: 'acme' } });
    // 26 REPLACEs per operand — the ASCII case map, applied byte-wise over the
    // binary rendering so that no collation participates and no multi-byte
    // character can be touched (UTF-8 is self-synchronising).
    expect(icontains.match(/REPLACE\(/g) ?? []).toHaveLength(52);
    expect(icontains).not.toMatch(/LOWER\(/);
  });

  it('an unmodelled dialect keeps the pre-#6518 shape rather than emitting invalid SQL', () => {
    // `dialectName` is `'unknown'` for a client this driver does not model, and
    // there `GLOB` is a syntax error and `CAST(… AS BINARY)` means something
    // else. Answering with the old `LIKE`/`LOWER()` shape is not an endorsement
    // of it — it is the only answer that still RUNS, and it is named as residue
    // in the driver-conformance ledger rather than left to be discovered.
    //
    // `mssql` is the stand-in because knex resolves its driver (`tedious`) from
    // this workspace without a server; it is not a supported dialect and this
    // case makes no claim that it is. Any client outside `isSqlite` /
    // `isPostgres` / `isMysql` takes the same arm.
    const d = probe({ client: 'mssql', connection: {} });
    expect(d.compileWhere({ name: { $contains: 'acme' } })).toMatch(/LIKE/);
    expect(d.compileWhere({ name: { $icontains: 'acme' } })).toMatch(/LOWER\(/);
  });
});
