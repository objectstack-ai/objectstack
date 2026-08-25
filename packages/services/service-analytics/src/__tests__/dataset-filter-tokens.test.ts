// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

/**
 * framework#3582 — a dashboard widget's filter placeholders are expanded on the
 * SERVER, before the strategy compiles SQL.
 *
 * The dashboard path needs its own resolution rather than inheriting the
 * ObjectQL engine's: `NativeSQLStrategy` compiles a raw `SELECT … WHERE` and
 * binds comparands directly, so a widget filtered on `{current_year_start}`
 * never passes through `engine.find()`. That is precisely why such widgets
 * rendered zero — the placeholder was bound as the literal text.
 *
 * The assertions read the BOUND PARAMS, i.e. what the database actually
 * compares against.
 */
const dataset = DatasetSchema.parse({
  name: 'pipeline',
  label: 'Pipeline',
  object: 'opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

function service(captured: { sql: string; params: unknown[] }[]) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_o, sql, params) => {
      captured.push({ sql, params });
      return [{ stage: 'won', revenue: 100 }];
    },
  });
}

const CTX = { userId: 'usr_1', tenantId: 'org_9', timezone: 'UTC' } as ExecutionContext;
const THIS_YEAR_START = `${new Date().getUTCFullYear()}-01-01`;

describe('dataset filter placeholders (framework#3582)', () => {
  it('expands a date macro in a widget runtimeFilter into a bound date', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await service(captured).queryDataset(
      dataset,
      {
        dimensions: ['stage'],
        measures: ['revenue'],
        runtimeFilter: { close_date: { $gte: '{current_year_start}' } },
      },
      CTX,
    );

    expect(captured[0].params).toContain(THIS_YEAR_START);
    expect(captured[0].params).not.toContain('{current_year_start}');
  });

  it('expands a context token in a widget runtimeFilter', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await service(captured).queryDataset(
      dataset,
      { dimensions: ['stage'], measures: ['revenue'], runtimeFilter: { owner: '{current_user_id}' } },
      CTX,
    );

    expect(captured[0].params).toContain('usr_1');
  });

  it("expands the dataset's own intrinsic filter", async () => {
    const scoped = DatasetSchema.parse({
      ...dataset,
      name: 'my_pipeline',
      filter: { owner: '{current_user_id}' },
    });
    const captured: { sql: string; params: unknown[] }[] = [];
    await service(captured).queryDataset(
      scoped,
      { dimensions: ['stage'], measures: ['revenue'] },
      CTX,
    );

    expect(captured[0].params).toContain('usr_1');
    // [#12230] The absence half is the load-bearing assertion: the #10298
    // dataset-scope conjunct used to AND the REGISTRY's unresolved copy in
    // beside the executor's resolved one — `owner = $viewer AND
    // owner = '{current_user_id}'` binds both params and selects nothing,
    // and `toContain('usr_1')` alone stayed green through it.
    expect(captured[0].params).not.toContain('{current_user_id}');
  });

  it('expands a measure-scoped filter', async () => {
    const scoped = DatasetSchema.parse({
      ...dataset,
      name: 'ytd_pipeline',
      measures: [
        {
          name: 'revenue_ytd',
          aggregate: 'sum',
          field: 'amount',
          filter: { close_date: { $gte: '{current_year_start}' } },
        },
      ],
    });
    const captured: { sql: string; params: unknown[] }[] = [];
    await service(captured).queryDataset(
      scoped,
      { dimensions: ['stage'], measures: ['revenue_ytd'] },
      CTX,
    );

    expect(captured.some((c) => c.params.includes(THIS_YEAR_START))).toBe(true);
    // [#12230] Same absence pin for the measure-filter channel: the strategy's
    // conditional aggregate (`CASE WHEN`) used to compile the registry's
    // unresolved measure filter, zeroing the measure while the resolved copy
    // in `where` kept this presence assertion green.
    expect(captured.every((c) => !c.params.includes('{current_year_start}'))).toBe(true);
  });

  it('never mutates the registered dataset — it is reused across requests', async () => {
    const scoped = DatasetSchema.parse({
      ...dataset,
      name: 'shared_pipeline',
      filter: { owner: '{current_user_id}' },
    });
    const captured: { sql: string; params: unknown[] }[] = [];
    const svc = service(captured);

    await svc.queryDataset(scoped, { dimensions: ['stage'], measures: ['revenue'] }, CTX);
    await svc.queryDataset(
      scoped,
      { dimensions: ['stage'], measures: ['revenue'] },
      { ...CTX, userId: 'usr_2' } as ExecutionContext,
    );

    // Second render must scope to the SECOND user, not a baked-in first one.
    expect(captured[1].params).toContain('usr_2');
    expect(captured[1].params).not.toContain('usr_1');
    expect(captured[1].params).not.toContain('{current_user_id}');
    expect(scoped.filter).toEqual({ owner: '{current_user_id}' });
  });

  it('fails loudly on an unresolvable placeholder instead of charting zero', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await expect(
      service(captured).queryDataset(
        dataset,
        { dimensions: ['stage'], measures: ['revenue'], runtimeFilter: { owner: '{current_user}' } },
        CTX,
      ),
    ).rejects.toThrow(/current_user_id/);
    expect(captured).toHaveLength(0);
  });
});
