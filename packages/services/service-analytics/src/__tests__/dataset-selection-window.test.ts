// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3588 — presentation-scope query options reach the generated query.
 *
 * Three widget options were accepted by the metadata layer and then dropped on
 * the floor by the query builder: `dateGranularity` never became a date
 * truncation, `sortBy`/`sortOrder` never became an ordering, and `limit`
 * truncated an arbitrary subset because nothing ordered the rows first. These
 * tests pin the query the executor now builds, on BOTH strategy paths:
 *
 *  - native SQL — asserts the emitted statement (pushdown), and
 *  - the ObjectQL aggregate path — which native SQL hands every date-bucketed
 *    query to, and which has no ordering grammar of its own, so ordering there
 *    must come from the executor's post-pass.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { applyOrdering, applyWindow, resolveOrdering } from '../dataset-executor.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

/** A date dimension with NO dataset-level granularity — the widget must supply it. */
const accounts = DatasetSchema.parse({
  name: 'account_metrics',
  label: 'Accounts',
  object: 'crm_account',
  include: [],
  dimensions: [
    { name: 'created_at', field: 'created_at', type: 'date' },
    { name: 'industry', field: 'industry', type: 'string' },
  ],
  measures: [
    { name: 'account_count', aggregate: 'count' },
    { name: 'annual_revenue_sum', aggregate: 'sum', field: 'annual_revenue' },
  ],
});

type AggCall = { object: string; options: Record<string, unknown> };

/**
 * ObjectQL-aggregate service; captures every `executeAggregate` call.
 *
 * [#8286] `debugSql` is the response-level SQL echo, off by default outside
 * development. Only the tests that read `result.sql` — the block asserting the
 * echo tells the truth — need it on; the rest of this file measures the CALL
 * the executor made, which the gate does not touch.
 */
function aggService(
  rows: Record<string, unknown>[],
  calls: AggCall[] = [],
  options: { debugSql?: boolean } = {},
) {
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (object, opts) => {
      calls.push({ object, options: opts as Record<string, unknown> });
      return rows;
    },
    debugSql: options.debugSql,
  });
  return { svc, calls };
}

/** Native-SQL service; captures every statement it is asked to run. */
function sqlService(rows: Record<string, unknown>[], captured: string[] = []) {
  const svc = new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_o, sql) => { captured.push(sql); return rows; },
  });
  return { svc, captured };
}

const groupByOf = (call: AggCall) => call.options.groupBy as Array<string | { field: string; dateGranularity?: string }>;

describe('#3588 — selection.dateGranularity reaches the GROUP BY', () => {
  it('buckets a date dimension the DATASET left ungranulated', async () => {
    // The `new_accounts_by_month` case: the dataset declares `created_at` as a
    // plain date dimension, so before this change the query grouped on the raw
    // timestamp — one bucket per record, five identical bars.
    const { svc, calls } = aggService([{ created_at: '2026-06', account_count: 4 }]);
    const result = await svc.queryDataset(
      accounts,
      { dimensions: ['created_at'], measures: ['account_count'], dateGranularity: 'month' },
      CTX,
    );
    expect(groupByOf(calls[0])).toEqual([{ field: 'created_at', dateGranularity: 'month' }]);
    expect(result.rows).toEqual([{ created_at: '2026-06', account_count: 4 }]);
  });

  it('leaves the dimension unbucketed when the selection asks for nothing', async () => {
    const { svc, calls } = aggService([{ created_at: '2026-06-01', account_count: 1 }]);
    await svc.queryDataset(accounts, { dimensions: ['created_at'], measures: ['account_count'] }, CTX);
    expect(groupByOf(calls[0])).toEqual(['created_at']);
  });

  it('overrides the dataset dimension default for this widget only', async () => {
    const monthly = DatasetSchema.parse({
      name: 'opp', label: 'Opp', object: 'opportunity', include: [],
      dimensions: [{ name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'month' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    });
    const { svc, calls } = aggService([{ close_date: '2026', revenue: 1 }]);
    await svc.queryDataset(
      monthly,
      { dimensions: ['close_date'], measures: ['revenue'], dateGranularity: 'year' },
      CTX,
    );
    expect(groupByOf(calls[0])).toEqual([{ field: 'close_date', dateGranularity: 'year' }]);
  });

  it('never overrides an explicit timeDimensions entry', async () => {
    const { svc, calls } = aggService([{ created_at: '2026-06-08', account_count: 1 }]);
    await svc.queryDataset(
      accounts,
      {
        dimensions: ['created_at'],
        measures: ['account_count'],
        dateGranularity: 'month',
        timeDimensions: [{ dimension: 'created_at', granularity: 'week' }],
      },
      CTX,
    );
    expect(groupByOf(calls[0])).toEqual([{ field: 'created_at', dateGranularity: 'week' }]);
  });

  it('applies only to DATE dimensions, never to a string dimension', async () => {
    const { svc, calls } = aggService([{ industry: 'Tech', account_count: 2 }]);
    await svc.queryDataset(
      accounts,
      { dimensions: ['industry'], measures: ['account_count'], dateGranularity: 'month' },
      CTX,
    );
    expect(groupByOf(calls[0])).toEqual(['industry']);
  });

  it('buckets the compareTo pass identically, so the grids actually merge', async () => {
    // The comparison query used to be hand-built without granularity resolution:
    // a month-bucketed primary grid was merged against raw-timestamp comparison
    // rows, no dimension key matched, and every `__compare` column came back
    // empty.
    const calls: AggCall[] = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (object, options) => {
        calls.push({ object, options: options as Record<string, unknown> });
        return [{ created_at: '2026-06', account_count: calls.length }];
      },
    });
    const result = await svc.queryDataset(
      accounts,
      {
        dimensions: ['created_at'],
        measures: ['account_count'],
        dateGranularity: 'month',
        timeDimensions: [{ dimension: 'created_at', dateRange: ['2026-06-01', '2026-06-30'] }],
        compareTo: { kind: 'previousPeriod', dimension: 'created_at' },
      },
      CTX,
    );
    // Both passes bucket by month…
    expect(groupByOf(calls[0])).toEqual([{ field: 'created_at', dateGranularity: 'month' }]);
    expect(groupByOf(calls[1])).toEqual([{ field: 'created_at', dateGranularity: 'month' }]);
    // …so the comparison column lands on the same row instead of a phantom bucket.
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ created_at: '2026-06', account_count: 1, account_count__compare: 2 });
  });
});

describe('#3588 — sortBy/sortOrder become a real ordering', () => {
  it('orders a measure descending on the ObjectQL path (which has no ORDER BY of its own)', async () => {
    // The `accounts_by_industry` case: rows arrive in whatever order the group-by
    // produced (alphabetical here, which was ascending revenue — the exact
    // opposite of the requested `desc`).
    const { svc } = aggService([
      { industry: 'Finance', annual_revenue_sum: 3_500_000 },
      { industry: 'Healthcare', annual_revenue_sum: 8_000_000 },
      { industry: 'Manufacturing', annual_revenue_sum: 12_000_000 },
      { industry: 'Technology', annual_revenue_sum: 30_000_000 },
    ]);
    const result = await svc.queryDataset(
      accounts,
      { dimensions: ['industry'], measures: ['annual_revenue_sum'], order: { annual_revenue_sum: 'desc' } },
      CTX,
    );
    expect(result.rows.map((r) => r.industry)).toEqual(['Technology', 'Manufacturing', 'Healthcare', 'Finance']);
  });

  it('pushes ordering + window into the SQL when the selection is a single query', async () => {
    const { svc, captured } = sqlService([{ industry: 'Tech', annual_revenue_sum: 1 }]);
    await svc.queryDataset(
      accounts,
      { dimensions: ['industry'], measures: ['annual_revenue_sum'], order: { annual_revenue_sum: 'desc' }, limit: 10 },
      CTX,
    );
    expect(captured[0]).toContain('ORDER BY "annual_revenue_sum" DESC');
    expect(captured[0]).toContain('LIMIT 10');
  });

  it('rejects an order key the selection does not project', async () => {
    const { svc } = aggService([]);
    await expect(
      svc.queryDataset(
        accounts,
        { dimensions: ['industry'], measures: ['account_count'], order: { annual_revenue_sum: 'desc' } },
        CTX,
      ),
    ).rejects.toThrow(/not a selected dimension or measure/);
  });

  it('sorts nulls last in both directions', () => {
    const rows = [{ v: 5 }, { v: null }, { v: 9 }];
    expect(applyOrdering(rows, { v: 'asc' }).map((r) => r.v)).toEqual([5, 9, null]);
    expect(applyOrdering(rows, { v: 'desc' }).map((r) => r.v)).toEqual([9, 5, null]);
  });

  it('compares numeric strings numerically, not lexicographically', () => {
    const rows = [{ v: '9' }, { v: '10' }];
    expect(applyOrdering(rows, { v: 'asc' }).map((r) => r.v)).toEqual(['9', '10']);
  });

  it('orders by a DERIVED measure — a column no single SQL statement computes', async () => {
    const withRatio = DatasetSchema.parse({
      name: 'ratio_ds', label: 'Ratio', object: 'opportunity', include: [],
      dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
      measures: [
        { name: 'won', aggregate: 'sum', field: 'won_amount' },
        { name: 'total', aggregate: 'sum', field: 'amount' },
        { name: 'win_rate', derived: { op: 'ratio', of: ['won', 'total'] } },
      ],
    });
    const { svc } = aggService([
      { stage: 'a', won: 1, total: 10 },   // 0.1
      { stage: 'b', won: 9, total: 10 },   // 0.9
      { stage: 'c', won: 5, total: 10 },   // 0.5
    ]);
    const result = await svc.queryDataset(
      withRatio,
      { dimensions: ['stage'], measures: ['win_rate'], order: { win_rate: 'desc' } },
      CTX,
    );
    expect(result.rows.map((r) => r.stage)).toEqual(['b', 'c', 'a']);
  });
});

describe('#3588 — limit depends on a deterministic ordering', () => {
  it('orders by the selected dimensions when a bare limit is requested', () => {
    expect(resolveOrdering({ measures: ['m'], limit: 3 }, ['a', 'b'])).toEqual({ a: 'asc', b: 'asc' });
    // …and stays out of the way when nothing asked for a window.
    expect(resolveOrdering({ measures: ['m'] }, ['a'])).toBeUndefined();
  });

  it('truncates the TOP rows, not an arbitrary subset', async () => {
    const { svc } = aggService([
      { industry: 'Finance', annual_revenue_sum: 3 },
      { industry: 'Technology', annual_revenue_sum: 30 },
      { industry: 'Healthcare', annual_revenue_sum: 8 },
    ]);
    const result = await svc.queryDataset(
      accounts,
      { dimensions: ['industry'], measures: ['annual_revenue_sum'], order: { annual_revenue_sum: 'desc' }, limit: 2 },
      CTX,
    );
    expect(result.rows.map((r) => r.industry)).toEqual(['Technology', 'Healthcare']);
  });

  it('applies offset after ordering', () => {
    const rows = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }];
    expect(applyWindow(rows, 2, 1).map((r) => r.v)).toEqual([2, 3]);
    expect(applyWindow(rows, undefined, 2).map((r) => r.v)).toEqual([3, 4]);
    expect(applyWindow(rows, undefined, undefined)).toBe(rows);
  });
});

describe('#3588 — ordering never corrupts a multi-query selection', () => {
  const scoped = DatasetSchema.parse({
    name: 'scoped_ds', label: 'Scoped', object: 'opportunity', include: [],
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [
      { name: 'total', aggregate: 'sum', field: 'amount' },
      { name: 'won', aggregate: 'sum', field: 'amount', filter: { stage: 'closed_won' } },
    ],
  });

  it('keeps ORDER BY/LIMIT out of measure-scoped sub-queries, ordering the merged grid instead', async () => {
    // A supplementary query selects ONE measure. Forwarding `ORDER BY "won"` to
    // the primary (which never selects `won`) is invalid SQL, and forwarding
    // `LIMIT` to either truncates it before the merge — rows would silently
    // disappear from the assembled grid.
    const captured: string[] = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async (_o, sql) => {
        captured.push(sql);
        // Dispatch on the projected alias — the scoped filter's value is bound
        // as a parameter, so it never appears in the statement text.
        return sql.includes('AS "won"')
          ? [{ stage: 'proposal', won: 5 }, { stage: 'negotiation', won: 50 }]
          : [{ stage: 'proposal', total: 10 }, { stage: 'negotiation', total: 100 }];
      },
    });
    const result = await svc.queryDataset(
      scoped,
      { dimensions: ['stage'], measures: ['total', 'won'], order: { won: 'desc' }, limit: 1 },
      CTX,
    );
    // No sub-query carried the window…
    expect(captured).toHaveLength(2);
    for (const sql of captured) {
      expect(sql).not.toContain('ORDER BY');
      expect(sql).not.toContain('LIMIT');
    }
    // …and the assembled grid is ordered by the merged column and then cut.
    expect(result.rows).toEqual([{ stage: 'negotiation', total: 100, won: 50 }]);
  });

  it('leaves totals covering the whole selection, unaffected by the window', async () => {
    const { svc } = aggService([
      { industry: 'Finance', annual_revenue_sum: 3 },
      { industry: 'Technology', annual_revenue_sum: 30 },
    ]);
    const result = await svc.queryDataset(
      accounts,
      {
        dimensions: ['industry'],
        measures: ['annual_revenue_sum'],
        order: { annual_revenue_sum: 'desc' },
        limit: 1,
        totals: { groupings: [[]] },
      },
      CTX,
    );
    expect(result.rows).toHaveLength(1);
    // The grand total still saw BOTH rows (mock returns the full set per call).
    expect(result.totals?.[0].rows).toHaveLength(2);
  });
});

/**
 * [#8286] Every service in this block enables the echo explicitly. The claim —
 * that the echoed statement is an honest account of the query that ran — is
 * unchanged and still worth pinning; what changed is that the echo now has a
 * precondition, and a block whose whole subject is the echo's CONTENT must
 * state it rather than inherit whatever `NODE_ENV` the runner happens to have.
 */
describe('#3588 — the echoed SQL tells the truth on the ObjectQL path', () => {
  it('renders date_trunc for a bucketed dimension instead of the bare column', async () => {
    const { svc } = aggService([{ created_at: '2026-06', account_count: 4 }], [], { debugSql: true });
    const result = await svc.queryDataset(
      accounts,
      { dimensions: ['created_at'], measures: ['account_count'], dateGranularity: 'month' },
      CTX,
    );
    expect(result.sql).toContain(`date_trunc('month', created_at)`);
    expect(result.sql).toContain('GROUP BY');
    expect(result.sql).toContain('COUNT(*) AS "account_count"');
  });

  it('renders the ordering and window that the response rows actually reflect', async () => {
    const { svc } = aggService([{ industry: 'Tech', annual_revenue_sum: 1 }], [], { debugSql: true });
    const result = await svc.queryDataset(
      accounts,
      { dimensions: ['industry'], measures: ['annual_revenue_sum'], order: { annual_revenue_sum: 'desc' }, limit: 10 },
      CTX,
    );
    expect(result.sql).toContain('ORDER BY "annual_revenue_sum" DESC');
    expect(result.sql).toContain('LIMIT 10');
  });

  it('parameterizes filter values rather than inlining them into the echoed statement', async () => {
    const { svc } = aggService([{ industry: 'Tech', account_count: 1 }], [], { debugSql: true });
    const result = await svc.queryDataset(
      accounts,
      { dimensions: ['industry'], measures: ['account_count'], runtimeFilter: { industry: 'Tech' } },
      CTX,
    );
    expect(result.sql).toContain('WHERE industry = $1');
    expect(result.sql).not.toContain('Tech');
  });
});
