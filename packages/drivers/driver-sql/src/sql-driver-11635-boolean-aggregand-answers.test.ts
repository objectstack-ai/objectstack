// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11635] Boolean aggregands answer the RULED values on every dialect this
 * driver speaks — the #11249 contract, executed at the driver boundary.
 *
 * ## The ruling this suite pins
 *
 * #11152 (maintainer 2026-08-28, applied in its comment 5448627494, ruling
 * verbatim and untranslated: 「12745 A回，其他同意。」 — option A on that
 * card) adopted, superseding #11249's `false`/`true` for the order
 * statistics:
 *
 * - **Booleans aggregate as NUMBERS on every face, with no per-aggregate
 *   exception**: `min` / `max` over a boolean aggregand answer **`0` / `1`**
 *   — the same numeric domain `sum` / `avg` answer in, so one column's five
 *   aggregates answer in one domain rather than three-numbers-two-booleans.
 * - **`sum` / `avg` answer arithmetic** (`3` / `0.5` on the 3-true/3-false
 *   fixture) — the settled #11065 family shape, unchanged.
 *
 * ## The two measured gaps this suite exists to keep closed
 *
 * Measured 2026-08-24 through `SqlDriver.aggregate()` on `origin/main` @
 * `2a6122bd9d`, before the fix:
 *
 * - **Postgres 16.13 refused all four** — the lowering emitted a bare
 *   `avg("flag")` over a real `boolean` column, PG has no arithmetic/order
 *   aggregates over `boolean`, and every call left as the #11455 envelope
 *   wrapping SQLSTATE `42883`. A face that refuses cannot satisfy the ruled
 *   contract; the lowering now casts (`avg(cast("flag" as int))`) on PG only.
 * - **MySQL 8.0.46 answered `min` = `0`, `max` = `1`** over `tinyint(1)` —
 *   which under #11249 was the defect this suite went red on, and under the
 *   #11152 ruling is the CORRECT answer on every dialect: the boolean
 *   read-presentation `#11635` added for `min`/`max` results is removed
 *   again, so the numeric answer the backend computes is the answer.
 *
 * ## Assertion conventions, and why they differ per function
 *
 * `min` / `max` are asserted STRICTLY (`toBe(0)` / `toBe(1)` via
 * `Object.is`-style `toBe` on the number): the JSON NUMBER is the ruled
 * contract, and `false`/`true` — the #11249-era value this suite previously
 * pinned — satisfies a loose equality reading. `sum` / `avg` / `count` /
 * `count_distinct` are asserted through `Number(...)`: node-pg and mysql2 both
 * hand EXACT-numeric results (`sum` → bigint/DECIMAL, `avg` → numeric) back as
 * strings — `"3"`, `"0.5000"` — for boolean and integer aggregands alike, so a
 * literal comparison would pin the dialect client's wire type, not this card's
 * values (the same reading the #11455 suite's control records). ⚠️ `min`/`max`
 * over an INTEGER-family result are handed back as numbers by both clients
 * (int4 / tinyint parse to JS numbers), so the strict spelling is assertable
 * on every dialect.
 *
 * ## The fixture
 *
 * `AGGREGATION_ROWS` — the shared aggregate-vocabulary fixture, whose `flag`
 * boolean column (added by #11152) IS the distribution this suite previously
 * carried as a private `FLAG_BY_ID` map: 3 true / 3 false, declared
 * `type: 'boolean'`. The private map is deleted in favour of the fixture
 * column so the two can never silently disagree on grouped values. The
 * per-group split is deliberately asymmetric: `west` holds `[T,F,F,F]` and
 * `east` `[T,T]`, so `east`'s grouped `min` is `1` — a face that computed
 * over the whole table, or answered a sticky per-column constant, goes red on
 * that cell rather than passing by symmetry.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AGGREGATION_ROWS } from '@objectstack/spec/data';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import { DIALECT_CELLS, declareDialectCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'bool_aggregand_answers';

const aggOn = (func: string, field = 'flag'): DriverQuery =>
  ({ aggregations: [{ function: func, field, alias: 'n' }] }) as DriverQuery;

function declareAnswers(cell: DialectCell): void {
describe(`[#11635] driver-sql — boolean aggregands answer the ruled values (${cell.label})`, () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver(cell.config());
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.initObjects([
      {
        name: TABLE,
        fields: {
          region: { type: 'string' },
          stage: { type: 'string' },
          score: { type: 'number' },
          flag: { type: 'boolean' },
        },
      },
    ]);
    // The fixture rows carry `flag` themselves since #11152 — seeded verbatim,
    // so this suite and the conformance suites measure one distribution.
    for (const row of AGGREGATION_ROWS) {
      await driver.create(TABLE, { ...row }, { bypassTenantAudit: true });
    }
  });

  afterAll(async () => {
    await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
    await driver.disconnect();
  });

  // The fixture read back rather than trusted: 3 true / 3 false, and a seed
  // that dropped a row or folded the flags would turn every value below into
  // a test of the wrong table.
  it('the fixture is six rows, 3 true / 3 false', async () => {
    const rows = (await driver.find(TABLE, {})) as Array<{ flag: unknown }>;
    expect(rows).toHaveLength(6);
    const truthy = rows.filter((r) => Boolean(r.flag)).length;
    expect(truthy, 'true count').toBe(3);
  });

  // ─── The ruled arithmetic half ───────────────────────────────────────────

  it('sum(flag) answers 3', async () => {
    const rows = await driver.aggregate(TABLE, aggOn('sum'));
    expect(Number(rows[0].n)).toBe(3);
  });

  it('avg(flag) answers 0.5', async () => {
    const rows = await driver.aggregate(TABLE, aggOn('avg'));
    expect(Number(rows[0].n)).toBe(0.5);
  });

  // ─── The ruled order-statistic half — JSON NUMBERS, STRICTLY ─────────────
  // [#11152 ruling, 2026-08-28] `0`/`1`, not `false`/`true` (#11249,
  // superseded): booleans aggregate as numbers with no per-aggregate
  // exception.

  it('min(flag) answers 0 — the JSON number, not false', async () => {
    const rows = await driver.aggregate(TABLE, aggOn('min'));
    expect(rows[0].n).toBe(0);
  });

  it('max(flag) answers 1 — the JSON number, not true', async () => {
    const rows = await driver.aggregate(TABLE, aggOn('max'));
    expect(rows[0].n).toBe(1);
  });

  it('grouped min/max answer per-group numbers: west [T,F,F,F], east [T,T]', async () => {
    const rows = await driver.aggregate(TABLE, {
      groupBy: ['region'],
      aggregations: [
        { function: 'min', field: 'flag', alias: 'lo' },
        { function: 'max', field: 'flag', alias: 'hi' },
      ],
    } as DriverQuery);
    const byRegion = Object.fromEntries(
      (rows as Array<{ region: string; lo: unknown; hi: unknown }>).map((r) => [
        String(r.region),
        { lo: r.lo, hi: r.hi },
      ]),
    );
    // `east` is the load-bearing cell: all-true, so its `min` is `1` — a
    // whole-table computation or a sticky `0` fails here and only here.
    expect(byRegion.east, 'east').toEqual({ lo: 1, hi: 1 });
    expect(byRegion.west, 'west').toEqual({ lo: 0, hi: 1 });
  });

  // ─── The empty window: null stays null, never a manufactured false ───────

  // `min`/`max` over no rows is undefined — the same judgement
  // `emptyGroupValueFor` (@objectstack/spec/data) records — and the numeric
  // answer must pass the backend's NULL through, never fold it to `0`.
  it('min(flag) over an empty window answers null, not 0', async () => {
    const rows = await driver.aggregate(TABLE, {
      where: { region: 'north' },
      aggregations: [{ function: 'min', field: 'flag', alias: 'n' }],
    } as DriverQuery);
    expect(rows[0].n).toBeNull();
  });

  // ─── Controls — what the cast and the presentation must NOT move ─────────

  it('CONTROL count(flag) / count_distinct(flag) are unchanged', async () => {
    const counted = await driver.aggregate(TABLE, aggOn('count'));
    expect(Number(counted[0].n), 'count over the boolean column').toBe(6);
    const distinct = await driver.aggregate(TABLE, aggOn('count_distinct'));
    expect(Number(distinct[0].n), 'count_distinct over the boolean column').toBe(2);
  });

  it('CONTROL sum/avg over the numeric column are untouched by the boolean path', async () => {
    const summed = await driver.aggregate(TABLE, aggOn('sum', 'score'));
    expect(Number(summed[0].n), 'sum(score)').toBe(210);
    const averaged = await driver.aggregate(TABLE, aggOn('avg', 'score'));
    expect(Number(averaged[0].n), 'avg(score)').toBe(35);
  });
});
}

// A matrix that silently finds zero cells reports OK — assert the axis is real
// before iterating it (the #11455 suite's own guard, kept in force here).
describe('[#11635] the dialect axis this suite runs', () => {
  it('runs every dialect this driver speaks', () => {
    expect(DIALECT_CELLS.map((c) => c.id)).toEqual(['sqlite', 'pg', 'mysql']);
  });
});

for (const cell of DIALECT_CELLS) {
  declareDialectCell(cell, 'boolean aggregand ruled answers', declareAnswers);
}
