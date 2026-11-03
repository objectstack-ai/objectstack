// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The data API's host-configured read limits on the analytics doors —
 * `query()` (`/analytics/query`) and `queryDataset()` (the dataset door that
 * reports and dashboards read through). The rule is `@objectstack/types`'
 * `query-read-limits.ts`; this file is the door half.
 *
 * An analytics answer carries no `hasMore`, so it is never cut silently: a
 * read naming no limit runs one row past the default page size, and an answer
 * holding more than the default is refused. A limit over the maximum, or a
 * window over the row budget, is refused before any strategy runs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsQuery, IAnalyticsService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

const ENV_VARS = ['OS_DATA_DEFAULT_PAGE_SIZE', 'OS_DATA_MAX_PAGE_SIZE', 'OS_DATA_QUERY_ROW_BUDGET'] as const;
const saved = Object.fromEntries(ENV_VARS.map((n) => [n, process.env[n]]));

function setLimits(limits: Partial<Record<(typeof ENV_VARS)[number], string>>) {
  for (const name of ENV_VARS) {
    if (limits[name] === undefined) delete process.env[name];
    else process.env[name] = limits[name];
  }
}

afterEach(() => {
  for (const name of ENV_VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const silentLogger = () => ({
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis(),
}) as any;

const ordersCube: Cube = {
  name: 'orders',
  title: 'Orders',
  sql: 'orders',
  measures: { count: { label: 'Count', type: 'count', sql: '*' } },
  dimensions: { status: { label: 'Status', type: 'string', sql: 'status' } },
} as Cube;

const baseQuery: AnalyticsQuery = { cube: 'orders', measures: ['orders.count'], dimensions: ['orders.status'] };

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ 'orders.status': `s${i}`, 'orders.count': 1 }));

/** The cube door over a fallback service that records the query it was handed. */
function cubeService(rows: number) {
  const seen: AnalyticsQuery[] = [];
  const logger = silentLogger();
  const fallback: IAnalyticsService = {
    query: vi.fn(async (q: AnalyticsQuery) => { seen.push(q); return { rows: rowsOf(rows), fields: [] }; }),
    getMeta: vi.fn(),
  };
  const svc = new AnalyticsService({ cubes: [ordersCube], logger, fallbackService: fallback });
  return { svc, seen, logger };
}

const accounts = DatasetSchema.parse({
  name: 'account_metrics',
  label: 'Accounts',
  object: 'crm_account',
  include: [],
  dimensions: [{ name: 'industry', field: 'industry', type: 'string' }],
  measures: [{ name: 'account_count', aggregate: 'count' }],
});
const CTX = { tenantId: 'org_A' } as ExecutionContext;

/** The dataset door over native SQL; records every statement it runs. */
function datasetService(rows: number) {
  const statements: string[] = [];
  const logger = silentLogger();
  const svc = new AnalyticsService({
    logger,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_o, sql) => {
      statements.push(sql);
      return Array.from({ length: rows }, (_, i) => ({ industry: `i${i}`, account_count: 1 }));
    },
  });
  return { svc, statements, logger };
}

async function refusal(run: () => Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try {
    await run();
  } catch (e) {
    return e as { status: number; code: string; message: string };
  }
  throw new Error('expected a refusal, got none');
}

describe('analytics read limits — no limits configured', () => {
  it('both doors answer exactly as before: no limit added, every row served', async () => {
    setLimits({});
    const cube = cubeService(500);
    const answer = await cube.svc.query(baseQuery);
    expect(answer.rows).toHaveLength(500);
    expect(cube.seen[0].limit).toBeUndefined();

    const ds = datasetService(500);
    const dsAnswer = await ds.svc.queryDataset(accounts, { dimensions: ['industry'], measures: ['account_count'] }, CTX);
    expect(dsAnswer.rows).toHaveLength(500);
    expect(ds.statements[0]).not.toMatch(/LIMIT/i);
  });
});

describe('analytics read limits — the default page size never cuts an answer silently', () => {
  it('cube door: an unpaged read probes one row past the default and is served when it fits', async () => {
    setLimits({ OS_DATA_DEFAULT_PAGE_SIZE: '3', OS_DATA_MAX_PAGE_SIZE: '10' });
    const cube = cubeService(3);
    const answer = await cube.svc.query(baseQuery);
    expect(cube.seen[0].limit).toBe(4);
    expect(answer.rows).toHaveLength(3);
  });

  it('cube door: an unpaged answer past the default is a 400 MAX_RECORDS_EXCEEDED, logged with the cube and counts', async () => {
    setLimits({ OS_DATA_DEFAULT_PAGE_SIZE: '3', OS_DATA_MAX_PAGE_SIZE: '10' });
    const cube = cubeService(4);
    const err = await refusal(() => cube.svc.query(baseQuery));
    expect(err.status).toBe(400);
    expect(err.code).toBe('MAX_RECORDS_EXCEEDED');
    expect(err.message).toContain('answers more than 3 rows');
    expect(err.message).toContain('Name a limit of at most 10');
    expect(cube.logger.warn).toHaveBeenCalledWith(
      '[data] read refused: code=MAX_RECORDS_EXCEEDED surface=analytics object=orders rows=4 limit=3',
    );
  });

  it('dataset door: the probe reaches the SQL, and an answer past the default is refused', async () => {
    setLimits({ OS_DATA_DEFAULT_PAGE_SIZE: '3' });
    const fits = datasetService(3);
    const answer = await fits.svc.queryDataset(accounts, { dimensions: ['industry'], measures: ['account_count'] }, CTX);
    expect(answer.rows).toHaveLength(3);
    expect(fits.statements[0]).toMatch(/LIMIT 4\b/i);

    const over = datasetService(4);
    const err = await refusal(() => over.svc.queryDataset(accounts, { dimensions: ['industry'], measures: ['account_count'] }, CTX));
    expect(err.code).toBe('MAX_RECORDS_EXCEEDED');
  });

  it('a caller\'s own limit within the maximum runs as asked, with no probe', async () => {
    setLimits({ OS_DATA_DEFAULT_PAGE_SIZE: '3', OS_DATA_MAX_PAGE_SIZE: '10' });
    const cube = cubeService(10);
    const answer = await cube.svc.query({ ...baseQuery, limit: 10 });
    expect(cube.seen[0].limit).toBe(10);
    expect(answer.rows).toHaveLength(10);
  });
});

describe('analytics read limits — the maximum page size and the row budget refuse before any strategy runs', () => {
  it('a limit over the maximum: 400 MAX_RECORDS_EXCEEDED on both doors, nothing run', async () => {
    setLimits({ OS_DATA_MAX_PAGE_SIZE: '10' });
    const cube = cubeService(1);
    const err = await refusal(() => cube.svc.query({ ...baseQuery, limit: 11 }));
    expect(err.status).toBe(400);
    expect(err.code).toBe('MAX_RECORDS_EXCEEDED');
    expect(err.message).toContain('maximum page size is 10');
    expect(cube.seen).toHaveLength(0);

    const ds = datasetService(1);
    const dsErr = await refusal(() => ds.svc.queryDataset(accounts, { dimensions: ['industry'], measures: ['account_count'], limit: 11 }, CTX));
    expect(dsErr.code).toBe('MAX_RECORDS_EXCEEDED');
    expect(ds.statements).toHaveLength(0);
  });

  it('offset plus limit over the budget: 400 QUERY_ROW_BUDGET_EXCEEDED naming the budget, nothing run', async () => {
    setLimits({ OS_DATA_QUERY_ROW_BUDGET: '100' });
    const cube = cubeService(1);
    const err = await refusal(() => cube.svc.query({ ...baseQuery, limit: 10, offset: 91 }));
    expect(err.status).toBe(400);
    expect(err.code).toBe('QUERY_ROW_BUDGET_EXCEEDED');
    expect(err.message).toContain('query row budget of 100');
    expect(cube.seen).toHaveLength(0);

    const ok = await cube.svc.query({ ...baseQuery, limit: 10, offset: 90 });
    expect(ok.rows).toHaveLength(1);
  });

  it('a budget with no page size: an unpaged answer past the budget is refused', async () => {
    setLimits({ OS_DATA_QUERY_ROW_BUDGET: '5' });
    const cube = cubeService(6);
    const err = await refusal(() => cube.svc.query(baseQuery));
    expect(err.code).toBe('QUERY_ROW_BUDGET_EXCEEDED');
    expect(cube.seen[0].limit).toBe(6);
  });
});
