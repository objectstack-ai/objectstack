// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LIKE-metacharacter escaping for the `$contains` family — the guard on
 * `SqlDriver.applyLike`, whose own TSDoc calls an unescaped `%` a filter bypass
 * and grades it P0.
 *
 * Two layers, and they are not the same assertion:
 *
 *  1. **The P0-3 regression** (below, hard-coded `better-sqlite3`) — the one
 *     that must run on every `pnpm test`, on any machine, with no server to
 *     provision. It is the default-path guard and is deliberately NOT replaced
 *     by the matrix.
 *  2. **The DRIVER axis** (#5589, ADR-0053 D-A3) — the same predicates re-run
 *     once per cell of `DIALECT_CELLS`, plus the literal-backslash case, on
 *     whatever live engines the runner provisioned.
 *
 * # Why the second layer exists (#5589)
 *
 * `applyLike` binds an explicit `ESCAPE ?` precisely BECAUSE the three shipped
 * dialects disagree about what a backslash means inside a LIKE pattern:
 * Postgres defaults to backslash, MySQL assumes `\` unless `NO_BACKSLASH_ESCAPES`
 * is set, and SQLite honours NO default escape character at all. Layer 1 covered
 * exactly one of those three — and it was the end of the range with the *least*
 * to say, since on SQLite nothing is an escape character until the clause says
 * so. A dialect-specific miscompile of a P0 filter bypass had nothing to fail.
 *
 * The infrastructure to fix that was already here and already wired into CI: the
 * `Temporal Conformance (live PG + MySQL)` job runs this whole package against
 * Postgres 16 and MySQL 8.0 with `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL`
 * set, and `live-dialect-matrix.testkit.ts` is the shared cell list every other
 * matrix consumer iterates. Layer 1 simply never joined — the LIKE family was
 * 0 of the 8 files reading those URLs. No new CI job is needed here either.
 *
 * A cell nobody provisioned is a named skip, and a red under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1` (`declareUnprovisionedCell`): a matrix that
 * silently found zero live cells must not report OK (#4646).
 *
 * # What the live cells prove that SQLite cannot
 *
 * Stated precisely, because the temptation is to overclaim — and #5589 assumed
 * the opposite, that the backslash case could not go before-red/after-green on
 * SQLite at all. Measured: it can. Deleting the `\\` limb of the escaped
 * character class turns the case red on the SQLite cell alone (the pattern
 * degenerates to `%\%`, whose trailing wildcard the backslash consumes, so the
 * answer is `[]` rather than `['bsl']`), while the other three stay green. The
 * bound `ESCAPE '\'` puts every dialect under one rule, which is the whole
 * design, so the ARITHMETIC is decidable in-process. What only a live cell can
 * decide is whether the *transport* preserves that rule:
 *
 *   - **MySQL, the `ESCAPE` argument.** The manual requires it to "evaluate as a
 *     constant at execution time". `applyLike` binds a placeholder. Through
 *     knex + mysql2's default `query()` path it is interpolated client-side into
 *     a literal and the constraint holds — but that was an INFERENCE from the
 *     driver's code path, never an execution. The mysql cell executes it.
 *   - **MySQL, the backslash's second life.** MySQL applies C escape syntax
 *     inside string literals, so the one backslash this code binds has to survive
 *     mysql2's own escaping and the server's lexer before LIKE ever sees it.
 *     Only a real server round-trip can show the count came out right.
 *   - **Postgres.** `standard_conforming_strings`, and the fact that a bound
 *     parameter is not a string literal at all, are likewise claims about a
 *     wire protocol rather than about this file's arithmetic.
 *
 * So the literal-backslash case is the interesting cell of the four, and its
 * value is concentrated on `live mysql` / `live postgres`. That is a statement
 * about which cells carry the new information, NOT a claim that the SQLite cell
 * is decorative — it pins the `\` limb of the escaped character class exactly as
 * hard as the others do.
 *
 * (Nothing here is temporal, so the D-B3 server-timezone axis does not apply —
 * requiring a non-UTC server would only manufacture reds that say nothing about
 * LIKE. Same call as `sql-driver-or-filter.test.ts` and the pagination matrix.)
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import {
  DIALECT_CELLS,
  declareUnprovisionedCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

/**
 * P0-3 regression: the `contains` / `$contains` operator must escape LIKE
 * metacharacters (`%` / `_`) in the user value so they match literally. An
 * unescaped `%` would expand to `%%%` and match every row — a filter bypass.
 */
describe('SqlDriver — contains escapes LIKE metacharacters (P0-3)', () => {
  let driver: SqlDriver;
  let knex: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knex = (driver as any).knex;
    await knex.schema.createTable('docs', (t: any) => {
      t.string('id').primary();
      t.string('title');
    });
    await knex('docs').insert([
      { id: '1', title: '50% off sale' }, // literal %
      { id: '2', title: 'plain title' }, // no metacharacter
      { id: '3', title: 'a_b underscore' }, // literal _
    ]);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  /**
   * [#5702] Swept over BOTH operators `applyLike` now serves.
   *
   * `$icontains` reaches the identical escaping through a new `fold` parameter
   * of that method, which wraps both operands in SQL `LOWER()`. Adding the fold
   * as a parameter rather than as a second emitter is what makes the character
   * class shared code — but "shared" is a claim, and this axis is what checks
   * it: a fold written as its own emitter would have re-derived the pattern
   * without the `%`/`_`/`\` class, and an unescaped `%` matches EVERY row (the
   * P0-3 bypass this describe block is named after) on the newer operator only.
   */
  for (const op of ['$contains', '$icontains'] as const) {
    it(`${op}: a "%" value matches only rows containing a literal %, not every row`, async () => {
      const r = await driver.find('docs', { where: { title: { [op]: '%' } } });
      expect(r.map((x: any) => x.id)).toEqual(['1']);
    });

    it(`${op}: a "_" value matches only rows containing a literal _, not any single char`, async () => {
      const r = await driver.find('docs', { where: { title: { [op]: '_' } } });
      expect(r.map((x: any) => x.id)).toEqual(['3']);
    });

    it(`${op}: an ordinary substring still matches normally`, async () => {
      const r = await driver.find('docs', { where: { title: { [op]: 'sale' } } });
      expect(r.map((x: any) => x.id)).toEqual(['1']);
    });
  }
});

// ── The driver axis (#5589, ADR-0053 D-A3) ──────────────────────────────────

/**
 * Issue-prefixed table name: the live cells share one database with every other
 * suite in this package (and with each other's runs), so the bare `docs` layer 1
 * can afford on an in-memory SQLite would be a collision waiting to be read as a
 * filter-bypass regression.
 */
const LIKE_TABLE = 'os5589_like_escape';

/**
 * The fixture rows, one per metacharacter under test plus one carrying none.
 *
 * Each row is the ONLY row that its case's expected answer names, so a widening
 * miscompile (which is the failure mode: every LIKE defect here matches MORE
 * rows, never fewer) cannot be mistaken for a pass.
 */
const LIKE_ROWS = [
  { id: 'pct', title: '50% off sale' }, // literal %
  { id: 'plain', title: 'plain title' }, // no metacharacter
  { id: 'us', title: 'a_b underscore' }, // literal _
  { id: 'bsl', title: 'C:\\logs' }, // literal backslash — one, not two
] as const;

interface LikeEscapeCase {
  readonly name: string;
  /** The comparand a user typed, as a LITERAL. */
  readonly value: string;
  readonly expected: readonly string[];
  readonly note: string;
}

const LIKE_ESCAPE_CASES: readonly LikeEscapeCase[] = [
  {
    name: 'a "%" value matches only rows containing a literal %, not every row',
    value: '%',
    expected: ['pct'],
    note: 'an unescaped % expands to %%% and matches every row — the P0 filter bypass',
  },
  {
    name: 'a "_" value matches only rows containing a literal _, not any single char',
    value: '_',
    expected: ['us'],
    note: 'an unescaped _ is LIKE\'s single-character wildcard, so %_% matches every non-empty row',
  },
  {
    name: 'an ordinary substring still matches normally',
    value: 'sale',
    expected: ['pct'],
    note: 'the escaping must not break the ordinary case it wraps',
  },
  {
    name: 'a "\\" value matches only rows containing a literal backslash',
    value: '\\',
    expected: ['bsl'],
    note:
      'the escape character itself, escaped: the pattern reaching the server must carry TWO ' +
      'backslashes and the bound ESCAPE argument exactly ONE. Drop the `\\\\` limb of the escaped ' +
      'character class and the pattern degenerates to `%\\%` — whose trailing wildcard is eaten ' +
      'by the backslash, leaving "anything, then a literal % at end of string", which answers ' +
      'NO row here (measured on the sqlite cell: []). On MySQL this is also the case that ' +
      'executes, rather than infers, that the bound ESCAPE placeholder satisfies "constant at ' +
      'execution time" and that one backslash survives client-side interpolation plus the ' +
      'server lexer',
  },
];

for (const cell of DIALECT_CELLS) {
  if (!cell.available) {
    declareUnprovisionedCell(cell, 'LIKE-metacharacter escape');
    continue;
  }
  declareLikeEscapeSweep(cell);
}

function declareLikeEscapeSweep(cell: DialectCell): void {
  describe(`SqlDriver LIKE-metacharacter escape (${cell.label})`, () => {
    let driver: SqlDriver;
    let knexInstance: any;

    beforeAll(async () => {
      driver = new SqlDriver(cell.config());
      knexInstance = (driver as any).knex;

      // Live cells reuse one database, so the sweep starts from a dropped table.
      await knexInstance.schema.dropTableIfExists(LIKE_TABLE);
      await knexInstance.schema.createTable(LIKE_TABLE, (t: any) => {
        t.string('id').primary();
        t.string('title');
      });
      await knexInstance(LIKE_TABLE).insert([...LIKE_ROWS]);
    });

    afterAll(async () => {
      await knexInstance?.schema.dropTableIfExists(LIKE_TABLE).catch(() => {});
      await driver?.disconnect?.();
    });

    /**
     * The fixture must have landed as typed before any verdict below means
     * anything. A backslash that mysql2 or the server lexer ate on the way IN
     * would make the `\` case fail for a reason that has nothing to do with
     * `applyLike` — and, worse, a doubled one would make it PASS for the wrong
     * reason on a build that had stopped escaping.
     */
    it('stored the fixture backslash as exactly one character', async () => {
      const rows = await knexInstance(LIKE_TABLE).where({ id: 'bsl' }).select('title');
      expect(String(rows[0]?.title)).toBe('C:\\logs');
    });

    // [#5702] The OPERATOR axis, crossed with the dialect axis this sweep
    // already had. `$icontains` compiles `LOWER(??) LIKE LOWER(?) ESCAPE ?`, so
    // every claim this file makes about the escape's survival across a wire
    // protocol — mysql2's client-side interpolation of the bound `ESCAPE`,
    // Postgres's `standard_conforming_strings`, the backslash surviving the
    // server lexer — has to be re-decided with the operands wrapped in a
    // function call. The expectations are identical because the escaping is:
    // the comparands here are symbols and lower-case ASCII, so the fold changes
    // which SQL is emitted, never which rows are right.
    for (const op of ['$contains', '$icontains'] as const) {
      for (const c of LIKE_ESCAPE_CASES) {
        it(`${op}: ${c.name}`, async () => {
          const rows = await driver.find(LIKE_TABLE, {
            where: { title: { [op]: c.value } },
          });
          const got = rows
            .map((r: any) => String(r.id))
            .sort((x: string, y: string) => x.localeCompare(y));
          expect(got, c.note).toEqual([...c.expected]);
        });
      }
    }
  });
}
