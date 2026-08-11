// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6814] Aggregate-vocabulary conformance for `driver-memory` — the shared
 * `@objectstack/spec/data` cases, on rows, executed in process.
 *
 * The SQL twins (`sql-driver-aggregation-conformance.test.ts`,
 * `turso-remote-aggregation-conformance.test.ts`,
 * `sqlite-wasm-aggregation-conformance.test.ts`) run this same table against a
 * real database. This file is the reason the cases live in the spec package
 * rather than beside one driver: an aggregate that answers differently here
 * than under SQL pushdown is one query with two numbers, decided by a driver
 * capability bit the caller never sees.
 *
 * ## Why nothing here is a "modelled" evaluation
 *
 * This driver runs in process, so every case below is a REAL execution — no
 * server-free half in the shape `driver-mongodb` needs (#5517), and no emitted-
 * string assertion standing in for a number. That matters for the defect this
 * file was written against: `computeAggregate` had no `count_distinct` arm at
 * all, so the function fell to `default: return null` and `aggregate()` resolved
 * with `{ n: null }` — no error, no log, no refusal. Only executing the case
 * says so; a lowering-shape assertion has nothing to look at.
 *
 * ## Both doors of the data face, and the analytics face beside it
 *
 * `find()` and `aggregate(AST)` are two entries to the same
 * `performAggregation`, and objectql's engine uses the second one. Both are
 * driven, because "the aggregate works" measured through one door is what let
 * this package answer one declared function two ways for as long as it did
 * (#5374). The analytics face (`memory-analytics.ts`) is driven in the last
 * block for the same reason — it implements `count_distinct` independently, so
 * it is a third answer unless something demands they agree.
 *
 * ## Reverse verification — direction predicted BEFORE it was run
 *
 * **(A) the `count_distinct` arm removed** (the pre-#6814 state). Predicted:
 * the three `count_distinct` cases fail on `null` — the value, not a throw —
 * while every arithmetic case stays green, because the missing arm is a silent
 * fall-through rather than a broken computation.
 *
 * **(B) the arm present but written `new Set(values).size`** — null NOT
 * excluded, the mistake `driver-mongodb`'s `$addToSet` made (#6814's other
 * half). Predicted: `count_distinct(stage)` answers 3 instead of 2 and the
 * grouped case answers `west` 3 / `east` 2 instead of 2 / 1, while
 * `count_distinct(score)` stays GREEN at 6 — that column has no nulls, so it
 * cannot see the mistake. (B) is the direction this file exists for.
 *
 * Measured after writing the above, of 34:
 *
 * - **(A) 7 failed / 27 passed.** Every failure was on the VALUE `null`
 *   (`expected [{ group: null, value: null }] to deeply equal
 *   [{ group: null, value: 2 }]`), through BOTH doors, plus the
 *   never-answers-null row — not one on a throw, as predicted. Every
 *   arithmetic case stayed green. The analytics block stayed green too, which
 *   is the point of driving the faces separately: this revert is one face's
 *   defect and the file says which one.
 * - **(B) 6 failed / 28 passed**, on `expected 3 to be 2` ungrouped and
 *   `east` 2 / `west` 3 grouped, through both doors, plus the two analytics
 *   rows over the same column. `count_distinct(score)` stayed green at 6
 *   throughout, exactly as predicted — which is why the table carries both
 *   columns, and why (B) is unreachable by a suite that only tests one.
 *
 * Pre-fix, on unmodified `origin/main` @ `21888ab`: **11 failed / 23 passed** —
 * (A)'s seven plus four more the analytics face contributed on its own account
 * (see the last block).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AGGREGATION_CASES, AGGREGATION_ROWS } from '@objectstack/spec/data';
import type { AggregationCase, Cube } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

const TABLE = 'conformance_agg';

/** The case as the `DriverQuery` shape both doors consume. */
const queryFor = (c: AggregationCase) => ({
  aggregations: [{ function: c.function, ...(c.field ? { field: c.field } : {}), alias: 'n' }],
  // [#6401] A case carrying `groupByAlias` is sent as the STRUCTURED node, so
  // the face receives the union member that declares `alias`. Without this the
  // alias axis would send a bare string and pin nothing.
  ...(c.groupBy
    ? { groupBy: [c.groupByAlias ? { field: c.groupBy, alias: c.groupByAlias } : c.groupBy] }
    : {}),
});

/**
 * The rows a case must produce, in the table's own order: `group` ascending for
 * a grouped case, one `null`-grouped row otherwise.
 *
 * [#6401] The group value is read from the column the case SAYS it lands in —
 * `groupByAlias ?? groupBy`. Reading `c.groupBy` unconditionally is the mistake
 * this axis exists to catch: green on a face that ignores the alias.
 *
 * `value` is deliberately NOT coerced with `Number()`. The defect this file was
 * written against answers `null`, and `Number(null)` is `0` — a coercion here
 * would turn "no arm at all" into an ordinary off-by-one and hide the shape of
 * the failure.
 */
const actualFor = (c: AggregationCase, rows: Array<Record<string, unknown>>) => {
  const groupKey = c.groupByAlias ?? c.groupBy;
  return rows
    .map((r) => ({ group: groupKey ? String(r[groupKey]) : null, value: r.n }))
    .sort((x, y) => String(x.group).localeCompare(String(y.group)));
};

const expectedFor = (c: AggregationCase) =>
  [...c.expected]
    .map((e) => ({ group: e.group, value: e.value }))
    .sort((x, y) => String(x.group).localeCompare(String(y.group)));

async function seed(): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver();
  for (const row of AGGREGATION_ROWS) await driver.create(TABLE, { ...row });
  return driver;
}

describe('[#6814] InMemoryDriver — aggregate vocabulary conformance', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  /**
   * The fixture first, read back rather than trusted — a case that answers 2
   * because only two rows landed is not a case that deduplicated correctly, and
   * the null-bearing column is the one a seed is most likely to mangle.
   */
  it('the fixture is all six rows, with the nulls stored AS nulls', async () => {
    const rows = await driver.find(TABLE, { orderBy: [{ field: 'id', order: 'asc' }] });
    expect(rows.map((r: any) => String(r.id))).toEqual(['1', '2', '3', '4', '5', '6']);
    for (const r of rows as any[]) {
      const seeded = AGGREGATION_ROWS.find((s) => s.id === String(r.id))!;
      expect([r.region, r.stage, r.score], r.id).toEqual([seeded.region, seeded.stage, seeded.score]);
    }
    // The property every null case hangs off, asserted directly: an empty
    // string in place of a null keeps the count_distinct cases green at the
    // wrong number.
    expect((rows as any[]).filter((r) => r.stage === null)).toHaveLength(2);
  });

  for (const c of AGGREGATION_CASES) {
    it(`find(): ${c.name}`, async () => {
      const rows = await driver.find(TABLE, queryFor(c) as any);
      expect(actualFor(c, rows as any[]), c.note ?? c.name).toEqual(expectedFor(c));
    });

    /**
     * The SECOND door onto the same computation — objectql's engine calls
     * `aggregate(object, AST)`, not `find()`. Two doors that can disagree is
     * this package's recurring defect class (#5374), so neither is trusted to
     * stand for the other.
     */
    it(`aggregate(AST): ${c.name}`, async () => {
      const rows = await driver.aggregate(TABLE, queryFor(c) as any);
      expect(actualFor(c, rows as any[]), c.note ?? c.name).toEqual(expectedFor(c));
    });
  }

  /**
   * The #4157 shape, asserted as a property rather than per case: an aggregate
   * the Query Protocol declares must never resolve with `null`. That is what
   * `default: return null` produced here — a wrong ANSWER rather than a wrong
   * number, and the one failure mode a value comparison per case could be
   * "passed" by if a future case-set row ever expected zero.
   */
  it('never answers null for a declared aggregate function', async () => {
    for (const c of AGGREGATION_CASES) {
      const rows = await driver.find(TABLE, queryFor(c) as any);
      for (const row of rows as any[]) {
        expect(row.n, `${c.name} — a declared function resolving null is the #6814 defect`).not.toBeNull();
        expect(typeof row.n, c.name).toBe('number');
      }
    }
  });
});

/**
 * [#5374] The ANALYTICS face answers the same function the same way.
 *
 * This package's recurring defect is not "a face is wrong", it is "the faces
 * disagree" — and `count_distinct` was exactly that. #6814 read this face as
 * the one that "DOES implement `count_distinct`", which executing it corrects:
 * `buildAggregator` emitted `{ $addToSet }` under a comment reading "Will need
 * post-processing for count", and no post-processing existed. So the measure
 * answered the raw ARRAY — `['won','lost',null]` — under a field
 * `measureTypeToFieldType` describes as `number`.
 *
 * One declared function, three answers: `null` on the data face, an array here,
 * and the standard's number nowhere. Aligning the data face alone would have
 * left this one free to keep its own.
 */
describe('[#6814] the analytics face answers count_distinct the same number', () => {
  const cube: Cube = {
    name: 'agg',
    title: 'Agg',
    sql: TABLE,
    measures: {
      distinctStage: { name: 'distinct_stage', label: 'Distinct stage', type: 'count_distinct', sql: 'stage' },
      distinctScore: { name: 'distinct_score', label: 'Distinct score', type: 'count_distinct', sql: 'score' },
    },
    dimensions: {
      region: { name: 'region', label: 'Region', type: 'string', sql: 'region' },
    },
  } as unknown as Cube;

  let service: MemoryAnalyticsService;

  beforeEach(async () => {
    const driver = await seed();
    service = new MemoryAnalyticsService({ driver, cubes: [cube] });
  });

  /** The ungrouped pair, against the same numbers `AGGREGATION_CASES` states. */
  it('count_distinct(stage) is 2 — distinct NON-NULL values, not 3', async () => {
    const result = await service.query({ cube: 'agg', measures: ['agg.distinctStage'] } as any);
    expect(result.rows[0]['agg.distinctStage']).toBe(2);
  });

  it('count_distinct(score) is 6 — the all-distinct control', async () => {
    const result = await service.query({ cube: 'agg', measures: ['agg.distinctScore'] } as any);
    expect(result.rows[0]['agg.distinctScore']).toBe(6);
  });

  /**
   * Grouped, because a face computing the aggregate over the whole table and
   * repeating it per group answers 2/2 and the ungrouped case above cannot see
   * it — the same argument `AGGREGATION_CASES`' grouped row is built on.
   */
  it('count_distinct(stage) grouped by region is east 1 / west 2', async () => {
    const result = await service.query({
      cube: 'agg',
      measures: ['agg.distinctStage'],
      dimensions: ['agg.region'],
    } as any);
    const byRegion = Object.fromEntries(
      result.rows.map((r: any) => [r['agg.region'], r['agg.distinctStage']]),
    );
    expect(byRegion).toEqual({ east: 1, west: 2 });
  });

  /**
   * The declared TYPE is `number` (`measureTypeToFieldType`), so the value has
   * to be one. An `$addToSet` handed back unsized is an ARRAY under a field the
   * response describes as numeric — a shape divergence a value comparison alone
   * would report as an ordinary wrong number.
   */
  it('answers a NUMBER, matching the field type the response declares', async () => {
    const result = await service.query({ cube: 'agg', measures: ['agg.distinctStage'] } as any);
    expect(result.fields.find((f: any) => f.name === 'agg.distinctStage')?.type).toBe('number');
    expect(typeof result.rows[0]['agg.distinctStage']).toBe('number');
  });
});
