// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6409] Aggregate-vocabulary conformance for the LOCAL SQL face — the shared
 * `@objectstack/spec/data` cases, on rows, through a real database.
 *
 * The twin runs the SAME table through `driver-turso`'s `RemoteTransport`
 * (`turso-remote-aggregation-conformance.test.ts`). That pairing is the point of
 * putting the cases in the spec package rather than writing a standalone test
 * here: `TursoDriver` picks between the two compilers from `url`, so an
 * aggregate that answers differently on one of them is one driver giving one
 * query two numbers, and only a shared table run on both can see it.
 *
 * ## Why a real database and not a SQL-string assertion
 *
 * `count_distinct` is the first entry in the vocabulary whose lowering is not a
 * function name — `COUNT(DISTINCT x)` puts a keyword inside the argument list.
 * Every way of getting that wrong still produces valid SQL: `count("stage")`
 * loses the dedup, `count(*)` loses the NULL exclusion too, and both run
 * happily and return a number. A string assertion pins the text this driver
 * emits TODAY; only executing it says whether the number is right. Same
 * instrument choice `turso-remote-filter-logic-conformance.test.ts` makes, and
 * for the same reason.
 *
 * ## [#11456] The DRIVER axis — this suite runs on every dialect, not one
 *
 * It used to construct `client: 'better-sqlite3'` as a literal, so the shared
 * aggregate-vocabulary standard — which exists precisely so two faces of one
 * platform cannot answer one aggregation two ways — was measured on exactly one
 * dialect of a driver that speaks three. ADR-0053 D-A3 makes the matrix
 * `driver {SQLite, Postgres at minimum}`; its pagination sibling already went
 * through `live-dialect-matrix.testkit.ts`. It now does too, so `pg` and
 * `mysql` cells execute whenever `OS_TEST_POSTGRES_URL` / `OS_TEST_MYSQL_URL`
 * are provisioned, and are a NAMED skip (a red under
 * `OS_EXPECT_LIVE_DIALECT_MATRIX=1`) when they are not.
 *
 * ⛔ **No case is dialect-gated.** All eighteen tests run on every available
 * cell; the conversion narrows nothing. Two of them needed a per-dialect FACE
 * rather than a per-dialect exemption, and the difference matters — a `skipIf`
 * would have been the silent narrowing this card was filed about.
 *
 * ### The readings the faces are built from, measured 2026-08-25
 *
 * Live PostgreSQL 16.13 (`timezone=Asia/Shanghai`, process `TZ=America/New_York`
 * — CI parity) against the SQLite cell as control. Measured, not ported:
 *
 * | reading                              | sqlite            | pg                   |
 * | ------------------------------------ | ----------------- | -------------------- |
 * | `count` / `count_distinct` result    | `6` (number)      | `"6"` (**string**)   |
 * | `sum`/`avg`/`min`/`max` over `score`  | `210` (number)    | `210` (number)       |
 * | identifier quoting in emitted SQL    | `` `stage` ``     | `"stage"`            |
 * | field-less `count_distinct` refusal  | `INVALID_QUERY`/400 | identical          |
 *
 * ⚠️ Note the SECOND row, because "pg returns aggregates as strings" is the
 * tempting summary and it is WRONG: node-pg hands `count` back as a string
 * because `COUNT` is `bigint`, while `sum`/`avg`/`min`/`max` over this fixture's
 * `score` arrive as JS numbers because `type: 'number'` lowers to a float
 * column. The wire type is a property of the RESULT type per aggregate, not of
 * the dialect — so the coercion below is deliberate everywhere rather than
 * switched on `cell.id`.
 *
 * {@link actualFor}'s `Number(r.n)` was already the right shape and needed no
 * change; it is now load-bearing rather than incidental, and that is why it is
 * spelled out here. The two tests that did NOT go through it are the two that
 * needed work — see their own notes.
 *
 * ## Reverse verification — direction predicted BEFORE it was run
 *
 * Measured on the SQLite cell (the only one that existed when they were taken).
 * Two reverts, because the two mistakes this file guards against fail in
 * different ways and only one of them needs a database to see.
 *
 * **(A) `SQL_AGGREGATE_FUNCTIONS`'s `count_distinct` entry deleted** — the
 * pre-#6409 state. Predicted: the `count_distinct` cases fail by THROWING
 * `NOT_IMPLEMENTED`/501 out of `refuseAggregateFunction`, never by returning a
 * wrong number, and nothing else moves.
 *
 * **(B) the entry present but `distinct` flipped to `false`** — the "lowering
 * copied from its neighbour" mistake, and the one a review that only checked
 * the two faces' tables have the same KEYS would pass. Predicted: failures on
 * VALUES — 4 instead of 2 ungrouped, `west` 3 instead of 2 grouped — while
 * `count_distinct(score)` stays GREEN at 6, because that column has nothing to
 * dedup. (B) is the direction this file exists for; (A) is reachable by any
 * test that merely calls the function.
 *
 * Measured after writing the above, of 16:
 *
 * - **(A) 5 failed / 11 passed.** The three `count_distinct` value cases and
 *   the emitted-SQL case all died on the thrown 501 — not one on a wrong
 *   number, as predicted. The fifth is the field-less refusal case, red on
 *   `expected 'NOT_IMPLEMENTED' to be 'INVALID_QUERY'`: with no entry in the
 *   table the name never reaches the distinct-without-field check, so it is
 *   answered as a capability gap. That case was NOT named in the prediction and
 *   is recorded rather than tidied — it is the one that proves the two refusals
 *   are distinguishable rather than interchangeable.
 * - **(B) 4 failed / 12 passed**, on
 *   `expected [{ group: null, value: 4 }] to deeply equal [{ group: null, value: 2 }]`,
 *   on the grouped case (`west` 3 vs 2), on the emitted SQL
 *   (`select count(\`stage\`) …` missing the keyword), and on the field-less
 *   case now RESOLVING instead of refusing — `count(*)` is valid, so a
 *   non-distinct lowering has nothing to refuse. `count_distinct(score)` stayed
 *   green throughout, exactly as predicted, which is why the table carries both
 *   columns.
 *
 * ## [#11456] Ablation — that the NEW cells execute, and can fail
 *
 * PENDING — prediction recorded before running. A converted matrix that finds
 * zero live cells reports OK, so the conversion's own claim needs its own
 * measurement. Predicted: mutating the `count_distinct` lowering to drop its
 * `distinct` — revert (B) above, whose SQLite direction is already recorded —
 * reddens the `live postgres` cell on the SAME four cases, proving the live
 * cell runs the assertions rather than merely connecting.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AGGREGATION_CASES, AGGREGATION_ROWS } from '@objectstack/spec/data';
import type { AggregationCase, QueryAST } from '@objectstack/spec/data';
import { SqlDriver } from './index.js';
import {
  DIALECT_CELLS,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const CONFORMANCE_OBJECT = {
  name: 'conformance_agg',
  fields: {
    id: { type: 'text', name: 'id' },
    region: { type: 'text', name: 'region' },
    // Nullable, and it must stay that way — see `AggregationRow.stage`.
    stage: { type: 'text', name: 'stage' },
    score: { type: 'number', name: 'score' },
  },
};

/** The case as a `QueryAST`. The alias is the harness's, not the table's. */
const astFor = (c: AggregationCase): QueryAST => ({
  object: CONFORMANCE_OBJECT.name,
  aggregations: [{ function: c.function, ...(c.field ? { field: c.field } : {}), alias: 'n' }],
  // [#6401] A case carrying `groupByAlias` is sent as the STRUCTURED node, so
  // what the face receives is the union member that declares `alias`. Without
  // this the alias cases would send a bare string and pin nothing.
  ...(c.groupBy
    ? { groupBy: [c.groupByAlias ? { field: c.groupBy, alias: c.groupByAlias } : c.groupBy] }
    : {}),
});

/**
 * The rows a case must produce, in the table's own order: `group` ascending for
 * a grouped case, one `null`-grouped row otherwise. Numbers are compared as
 * numbers — SQLite hands `avg` back as a float and `count` as an integer, and
 * [#11456] node-pg hands `count` back as the STRING `"6"` because `COUNT` is
 * `bigint`. None of those is the property under test; the value is.
 */
const actualFor = (c: AggregationCase, rows: Array<Record<string, unknown>>) => {
  // [#6401] The group value is read from the column the case SAYS it lands in —
  // `groupByAlias ?? groupBy`. Reading `c.groupBy` unconditionally is the bug
  // this axis exists to catch: it is green on a face that ignores the alias.
  const groupKey = c.groupByAlias ?? c.groupBy;
  return rows
    .map((r) => ({ group: groupKey ? String(r[groupKey]) : null, value: Number(r.n) }))
    .sort((x, y) => String(x.group).localeCompare(String(y.group)));
};

function declareAggregateVocabularyConformance(cell: DialectCell): void {
describe(`[#6409] SqlDriver — aggregate vocabulary conformance (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    // The live cells own a per-FILE schema that a killed run can leave behind
    // (`live-dialect-matrix.globalsetup.ts`'s teardown is best-effort by
    // design), and a surviving table would seed twelve rows into a fixture
    // whose every case counts six.
    await driver.execute(`drop table if exists ${CONFORMANCE_OBJECT.name}`).catch(() => {});
    await driver.initObjects([CONFORMANCE_OBJECT as any]);
    for (const row of AGGREGATION_ROWS) await driver.create(CONFORMANCE_OBJECT.name, { ...row });
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${CONFORMANCE_OBJECT.name}`).catch(() => {});
    await driver.disconnect();
  });

  /**
   * The fixture first, and read back through `find()` rather than trusted —
   * a case that answers 2 because only two rows landed is not a case that
   * deduplicated correctly, and the null-bearing column is exactly the one a
   * seed is most likely to mangle.
   */
  it('the fixture is all six rows, with the nulls stored AS nulls', async () => {
    const rows = await driver.find(CONFORMANCE_OBJECT.name, { orderBy: [{ field: 'id', order: 'asc' }] });
    expect(rows.map((r: any) => String(r.id))).toEqual(['1', '2', '3', '4', '5', '6']);
    for (const r of rows as any[]) {
      const seeded = AGGREGATION_ROWS.find((s) => s.id === String(r.id))!;
      expect([r.region, r.stage ?? null, Number(r.score)], r.id)
        .toEqual([seeded.region, seeded.stage, seeded.score]);
    }
    // The property the null cases hang off, asserted directly: an empty string
    // in place of a null would keep every `count_distinct` case green at the
    // wrong number.
    expect((rows as any[]).filter((r) => r.stage === null)).toHaveLength(2);
  });

  for (const c of AGGREGATION_CASES) {
    it(c.name, async () => {
      const rows = await driver.aggregate(CONFORMANCE_OBJECT.name, astFor(c));
      expect(actualFor(c, rows as any[]), c.note).toEqual([...c.expected]);
    });
  }

  /**
   * The statement this driver ACTUALLY emits, captured off knex's `query`
   * event. Not the standard — the values above are that — but the shape a
   * reviewer of a future change to the lowering table needs to see, and the one
   * property values cannot show: that the column arrives as a bound IDENTIFIER
   * (`??`) rather than interpolated into the statement text, which is what
   * keeps a caller's field name out of the SQL when `distinct` is in play.
   *
   * [#11456] The quoting is DERIVED from the cell's own dialect rather than
   * spelled per cell. Measured: better-sqlite3 emits `` `stage` `` and pg emits
   * `"stage"`, so the old literal backticks were a SQLite fact this suite was
   * asserting about every dialect. A per-cell table of quote characters would
   * work too and was rejected: the quote character is not the property under
   * test, and a hand-kept table would need an entry the day a fourth dialect
   * arrives — this cannot go stale. What IS asserted stays exactly what it was:
   * the keyword `distinct` unquoted and INSIDE the parentheses, and the column
   * bound as an identifier rather than interpolated as a string literal.
   */
  it('count_distinct compiles to count(distinct "column"), the column bound as an identifier', async () => {
    const knex = (driver as any).knex;
    const statements: string[] = [];
    const capture = (q: { sql: string }) => statements.push(q.sql);
    knex.on('query', capture);
    try {
      await driver.aggregate(CONFORMANCE_OBJECT.name, astFor({
        name: 'probe', function: 'count_distinct', field: 'stage', expected: [],
      }));
    } finally {
      knex.removeListener('query', capture);
    }
    expect(statements).toHaveLength(1);
    const quoted = knex.client.wrapIdentifier('stage', (x: string) => x);
    expect(statements[0]).toContain(`count(distinct ${quoted})`);
    // ⛔ The field must not have been interpolated as a string literal.
    expect(statements[0]).not.toContain("'stage'");
  });

  /**
   * `COUNT(DISTINCT *)` is not valid SQL, so the driver refuses instead of
   * emitting it. ADR-0112: the assertion is `code` AND `status`, never a bare
   * `toThrow` — the un-fixed driver threw here too (a 501 from the aggregate
   * door), so "it threw" cannot tell the two behaviours apart.
   *
   * [#11456] Measured identical on live pg: this refusal is raised by the
   * driver before any dialect is consulted, which is the answer this cell is
   * here to confirm rather than assume.
   */
  it('refuses count_distinct with no field — INVALID_QUERY / 400', async () => {
    const ast = {
      object: CONFORMANCE_OBJECT.name,
      aggregations: [{ function: 'count_distinct', alias: 'n' }],
    } as QueryAST;
    let err: (Error & { code?: string; status?: number }) | undefined;
    try {
      await driver.aggregate(CONFORMANCE_OBJECT.name, ast);
    } catch (e) {
      err = e as Error & { code?: string; status?: number };
    }
    expect(err, 'expected a refusal, but the aggregation resolved').toBeDefined();
    expect(err!.code).toBe('INVALID_QUERY');
    expect(err!.status).toBe(400);
    expect(err!.message).toContain('nothing to deduplicate');
    // ⛔ Not the capability-gap answer: this face DOES compile the function.
    expect(err!.message).not.toContain('capability gap');
    // #3867 — no driver-internal prefix on the wire.
    expect(err!.message).not.toContain('[sql-driver]');
  });

  /**
   * The control that keeps the refusal above from being satisfiable by refusing
   * the field-less spelling in general: `count` still means `COUNT(*)`.
   *
   * [#11456] It used to read `toEqual([{ n: 6 }])`, which carried three facts —
   * one row, the alias `n` as its ONLY key, and the value 6 — and could not
   * survive the live cell, because pg answers `{ n: "6" }`: `COUNT` is `bigint`
   * and node-pg hands bigints back as strings rather than lose precision. All
   * three facts are kept and spelled out separately instead. ⛔ Not relaxed to
   * a bare `toHaveProperty`: the key set is the DRIVER's own projection (it
   * emits an explicit `as "n"`, never `*`), so it is dialect-independent and
   * dropping it would be the silent narrowing this conversion exists to avoid.
   */
  it('count with no field still means COUNT(*)', async () => {
    const ast = {
      object: CONFORMANCE_OBJECT.name,
      aggregations: [{ function: 'count', alias: 'n' }],
    } as QueryAST;
    const rows = (await driver.aggregate(CONFORMANCE_OBJECT.name, ast)) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]), 'the alias is the only projected column').toEqual(['n']);
    expect(Number(rows[0].n), 'count(*) over the six-row fixture').toBe(6);
  });
});
}

/**
 * [#11456] A matrix that silently finds zero cells reports OK — so the axis is
 * asserted to be real before it is iterated, the same guard the #11635 suite
 * carries. Without it, "converted to the live matrix" is a claim this file
 * could satisfy while running nothing at all.
 */
describe('[#11456] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'aggregate vocabulary conformance', declareAggregateVocabularyConformance);
}
