// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11065] `avg` and `sum` over a BOOLEAN column answer the SQL number here too.
 *
 * ## The measurement this file pins
 *
 * One `AnalyticsService.queryDataset` call, one dataset, one set of rows, run
 * twice — once on `InMemoryDriver`, once on `SqliteWasmDriver`:
 *
 * ```
 * [memory] unfiltered      {"avg_sla_violated":null,  "closed_count":4}
 * [memory] closed-filter   {"avg_sla_violated":null,  "closed_count":4}
 * [sqlite] unfiltered      {"avg_sla_violated":0.4,   "closed_count":4}
 * [sqlite] closed-filter   {"avg_sla_violated":0.25,  "closed_count":4}
 * ```
 *
 * SQLite's are the arithmetically correct numbers (2/5 unfiltered, 1/4 over the
 * closed cases). The rows below are that dataset, reduced to the columns the
 * divergence needs: five `crm_case`-shaped records, four closed (three with
 * `is_sla_violated: false`, one `true`), one open with `true`.
 *
 * ## Why `null` needed a test rather than a fix alone
 *
 * `null` and a number are not two spellings of one answer, and neither face
 * ERRORS. A dashboard tile bound to a rate measure renders a percentage under
 * SQL and a blank here, indistinguishable from "no matching rows". The
 * test-facing half is worse and is this file's reason for existing: a suite
 * that pins such a measure on the in-memory driver asserts against `null` and
 * **cannot fail in the direction that matters**. So every assertion below is
 * written against the SQL number, and the `count` control beside it exists so
 * that a driver which stopped aggregating altogether — the failure a
 * value-only pin would sail through by answering `null` again — is visible.
 *
 * ## Reverse verification — direction predicted BEFORE it was run
 *
 * With both coercions reverted to `origin/main`'s expressions
 * (`values.filter(v => typeof v === 'number')` on the data face, a bare
 * `{ $avg: '$path' }` on the analytics face), predicted: **10 of the 15 fail** (11 measured; see below),
 * every one of them on the VALUE `null` or `0` rather than on a throw, because
 * both faces drop the aggregands silently. The `count` controls do not survive
 * as separate rows — they are asserted beside the rate they control, so the
 * rows carrying them go red on the rate — which is the intended reading: the
 * control's job is to make a stopped aggregator visible, not to stay green.
 *
 * Measured: **11 failed / 4 passed.** The predicted DIRECTION held exactly —
 * every failure landed on a value (`expected null to be 0.4`, `expected [+0,
 * +0] to deeply equal [2, 1]`, and `expected 'object' to be 'number'` where the
 * declared-type row read the `null`), not one on a throw. The predicted COUNT
 * was off by one: 10 was written, 11 measured. The survivors are the four rows
 * the reverted expressions answer identically — the fixture row, one
 * non-numeric-text row per face, and the empty-column row — and naming them was
 * the half of the prediction worth having, since a survivor list is what
 * distinguishes "the pin works" from "the pin is red for some other reason".
 *
 * No build stands between this file and the mutation: it imports the driver by
 * relative path, so vitest runs `src`. That is measured rather than assumed —
 * the package's `dist/` was built from `origin/main` before the fix and still
 * contains neither coercion, yet the unmutated run is green, which it could not
 * be if these assertions were reading `dist`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import type { Cube } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

const TABLE = 'crm_case';

/**
 * The card's dataset. `note` is a non-numeric TEXT column carried alongside on
 * purpose: it is the control for the OTHER direction — averaging it must keep
 * excluding the values rather than folding them to `0`, which is what adopting
 * objectql's `toNumber` wholesale would have done.
 */
const ROWS = [
  { id: 'c1', is_closed: true, is_sla_violated: false, note: 'alpha' },
  { id: 'c2', is_closed: true, is_sla_violated: false, note: 'bravo' },
  { id: 'c3', is_closed: true, is_sla_violated: false, note: 'charlie' },
  { id: 'c4', is_closed: true, is_sla_violated: true, note: 'delta' },
  { id: 'c5', is_closed: false, is_sla_violated: true, note: 'echo' },
] as const;

const CLOSED = { is_closed: true };

async function seed(): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver();
  for (const row of ROWS) await driver.create(TABLE, { ...row });
  return driver;
}

/**
 * The measures the card reported, as the `DriverQuery` both data-face doors
 * consume: the rate under test, and the `count` that agreed across drivers.
 */
const query = (where?: Record<string, unknown>): DriverQuery => ({
  ...(where ? { where } : {}),
  aggregations: [
    { function: 'avg', field: 'is_sla_violated', alias: 'avg_sla_violated' },
    { function: 'sum', field: 'is_sla_violated', alias: 'sum_sla_violated' },
    { function: 'count', field: 'id', alias: 'row_count' },
  ],
});

describe('[#11065] InMemoryDriver data face — a boolean aggregand is worth 1 or 0', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  /**
   * The fixture first, read back rather than trusted: booleans stored as the
   * strings `'true'`/`'false'` would make every assertion below pass through a
   * path that has nothing to do with the defect.
   */
  it('the fixture is five rows whose flags are stored AS booleans', async () => {
    const rows = await driver.find(TABLE, { orderBy: [{ field: 'id', order: 'asc' }] }) as any[];
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    for (const r of rows) expect(typeof r.is_sla_violated, r.id).toBe('boolean');
    expect(rows.filter((r) => r.is_sla_violated)).toHaveLength(2);
    expect(rows.filter((r) => r.is_closed)).toHaveLength(4);
  });

  /**
   * `aggregate(object, AST)` is the door the card's own repro reaches: the
   * analytics strategy's `executeAggregate` bridge calls `engine.aggregate`,
   * which pushes the aggregate down to `driver.aggregate` whenever the driver
   * has the method and the query needs no in-memory bucketing — traced on this
   * dataset, not inferred.
   */
  it('aggregate(AST): avg over the boolean is 0.4, the number SQLite answers', async () => {
    const [row] = await driver.aggregate(TABLE, query()) as any[];
    expect(row.avg_sla_violated).toBe(0.4);
    // The control: a face that stopped aggregating cannot keep this green.
    expect(row.row_count).toBe(5);
  });

  it('aggregate(AST): avg under the closed filter is 0.25', async () => {
    const [row] = await driver.aggregate(TABLE, query(CLOSED)) as any[];
    expect(row.avg_sla_violated).toBe(0.25);
    expect(row.row_count).toBe(4);
  });

  /**
   * The SECOND door onto the same `performAggregation`. Two doors that can
   * disagree is this package's recurring defect class (#5374, #6814), so
   * neither stands for the other.
   */
  it('find(): the same two numbers through the other door', async () => {
    const [all] = await driver.find(TABLE, query()) as any[];
    const [closed] = await driver.find(TABLE, query(CLOSED)) as any[];
    expect([all.avg_sla_violated, closed.avg_sla_violated]).toEqual([0.4, 0.25]);
    expect([all.row_count, closed.row_count]).toEqual([5, 4]);
  });

  /**
   * `sum` shares the arm, and was left answering `0` — "how many true" is what
   * `SUM(col)` means on every SQL face and in objectql's in-memory fallback, so
   * aligning `avg` alone would have kept the same defect alive one function
   * over. Pinned in both directions of the filter for the same reason the `avg`
   * rows are.
   */
  it('sum over the boolean counts the true rows — 2 unfiltered, 1 closed', async () => {
    const [all] = await driver.aggregate(TABLE, query()) as any[];
    const [closed] = await driver.aggregate(TABLE, query(CLOSED)) as any[];
    expect([all.sum_sla_violated, closed.sum_sla_violated]).toEqual([2, 1]);
  });

  /** Grouped, because a face aggregating the whole table and repeating the
   * result per group answers 0.4/0.4 and the ungrouped rows cannot see it. */
  it('grouped by is_closed: 0.25 closed / 1 open, counts 4 and 1', async () => {
    const rows = await driver.aggregate(TABLE, {
      groupBy: ['is_closed'],
      aggregations: [
        { function: 'avg', field: 'is_sla_violated', alias: 'rate' },
        { function: 'count', field: 'id', alias: 'row_count' },
      ],
    }) as any[];
    const byClosed = Object.fromEntries(rows.map((r) => [String(r.is_closed), [r.rate, r.row_count]]));
    expect(byClosed).toEqual({ true: [0.25, 4], false: [1, 1] });
  });

  /** The declared answer is a NUMBER — `null` under a numeric measure is the
   * shape the card measured, and a value comparison alone reports it as an
   * ordinary wrong number rather than as the missing answer it is. */
  it('answers a number, never null, for a column that has rows', async () => {
    const [row] = await driver.aggregate(TABLE, query()) as any[];
    expect(row.avg_sla_violated).not.toBeNull();
    expect(typeof row.avg_sla_violated).toBe('number');
  });

  /**
   * The narrowness, asserted rather than assumed. Coercion is boolean-only:
   * a non-numeric TEXT column keeps being EXCLUDED, so `avg` over it stays
   * `null` and `sum` stays `0`. Averaging those strings as `0` — what
   * `toNumber` does — would be a different and much louder change, and this row
   * is what stops it arriving by accident.
   */
  it('a non-numeric text column is still excluded, not folded to zero', async () => {
    const [row] = await driver.aggregate(TABLE, {
      aggregations: [
        { function: 'avg', field: 'note', alias: 'avg_note' },
        { function: 'sum', field: 'note', alias: 'sum_note' },
      ],
    }) as any[];
    expect(row.avg_note).toBeNull();
    expect(row.sum_note).toBe(0);
  });

  /** An empty column still has no average — the coercion adds aggregands, it
   * does not invent one. */
  it('avg over a column with no rows at all is still null', async () => {
    const [row] = await driver.aggregate(TABLE, {
      where: { id: 'nobody' },
      aggregations: [{ function: 'avg', field: 'is_sla_violated', alias: 'rate' }],
    }) as any[];
    expect(row.rate).toBeNull();
  });
});

/**
 * The ANALYTICS face answers the same measure the same way.
 *
 * It reaches the numbers by a different route — a mingo `$group` expression
 * rather than JavaScript — and mingo's `$avg` ignores a non-numeric value
 * exactly as MongoDB's does, so before #11065 this face had the identical
 * divergence on its own account: `{avg: null, sum: 0}` over the same five rows.
 * Aligning the data face alone would have left it free to keep that answer,
 * which is the same mistake #6814 recorded on `count_distinct`.
 */
describe('[#11065] the analytics face answers the same rate', () => {
  const cube = {
    name: 'cases',
    title: 'Cases',
    sql: TABLE,
    measures: {
      slaViolationRate: { name: 'sla_violation_rate', label: 'SLA Violation Rate', type: 'avg', sql: 'is_sla_violated' },
      slaViolations: { name: 'sla_violations', label: 'SLA Violations', type: 'sum', sql: 'is_sla_violated' },
      count: { name: 'count', label: 'Cases', type: 'count', sql: 'id' },
      avgNote: { name: 'avg_note', label: 'Avg note', type: 'avg', sql: 'note' },
    },
    dimensions: {
      isClosed: { name: 'is_closed', label: 'Closed', type: 'boolean', sql: 'is_closed' },
    },
  } as unknown as Cube;

  let service: MemoryAnalyticsService;

  beforeEach(async () => {
    const driver = await seed();
    service = new MemoryAnalyticsService({ driver, cubes: [cube] });
  });

  const run = async (where?: Record<string, unknown>) => {
    const result = await service.query({
      cube: 'cases',
      measures: ['cases.slaViolationRate', 'cases.slaViolations', 'cases.count'],
      ...(where ? { where } : {}),
    } as any);
    return result.rows[0] as Record<string, unknown>;
  };

  it('avg over the boolean is 0.4 unfiltered, with the count control at 5', async () => {
    const row = await run();
    expect(row['cases.slaViolationRate']).toBe(0.4);
    expect(row['cases.count']).toBe(5);
  });

  it('avg over the boolean is 0.25 under the closed filter, count 4', async () => {
    const row = await run(CLOSED);
    expect(row['cases.slaViolationRate']).toBe(0.25);
    expect(row['cases.count']).toBe(4);
  });

  it('sum over the boolean counts the true rows here too — 2 and 1', async () => {
    expect([(await run())['cases.slaViolations'], (await run(CLOSED))['cases.slaViolations']]).toEqual([2, 1]);
  });

  /** Grouped, for the reason the data face's grouped row states. */
  it('grouped by is_closed: 0.25 closed / 1 open', async () => {
    const result = await service.query({
      cube: 'cases',
      measures: ['cases.slaViolationRate', 'cases.count'],
      dimensions: ['cases.isClosed'],
    } as any);
    const byClosed = Object.fromEntries(
      (result.rows as any[]).map((r) => [String(r['cases.isClosed']), [r['cases.slaViolationRate'], r['cases.count']]]),
    );
    expect(byClosed).toEqual({ true: [0.25, 4], false: [1, 1] });
  });

  /** The same narrowness guard the data face carries: text stays excluded. */
  it('a non-numeric text column is still excluded here too', async () => {
    const result = await service.query({ cube: 'cases', measures: ['cases.avgNote'] } as any);
    expect((result.rows[0] as Record<string, unknown>)['cases.avgNote']).toBeNull();
  });

  /** The response describes the measure as `number`; the cell must be one. */
  it('answers a number, matching the field type the response declares', async () => {
    const result = await service.query({ cube: 'cases', measures: ['cases.slaViolationRate'] } as any);
    expect((result.fields as any[]).find((f) => f.name === 'cases.slaViolationRate')?.type).toBe('number');
    expect(typeof (result.rows[0] as Record<string, unknown>)['cases.slaViolationRate']).toBe('number');
  });
});
