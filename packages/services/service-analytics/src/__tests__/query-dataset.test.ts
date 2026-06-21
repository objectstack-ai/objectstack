// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

const dataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', certified: true }],
});

function service(captured: { sql: string; params: unknown[] }[]) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_o, sql, params) => { captured.push({ sql, params }); return [{ region: 'NA', revenue: 100 }]; },
    getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
  });
}

describe('AnalyticsService.queryDataset', () => {
  it('compiles an inline dataset, runs it, and returns rows', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const result = await service(captured).queryDataset(
      dataset,
      { dimensions: ['region'], measures: ['revenue'] },
      { tenantId: 'org_A' } as ExecutionContext,
    );
    expect(result.rows).toEqual([{ region: 'NA', revenue: 100 }]);
  });

  it('auto-wires the join allowlist from the compiled dataset (D-C) — declared join allowed', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    await service(captured).queryDataset(dataset, { dimensions: ['region'], measures: ['revenue'] }, { tenantId: 'org_A' } as ExecutionContext);
    // account join present + both tables tenant-scoped, with no getAllowedRelationships config passed.
    expect(captured[0].sql).toContain('LEFT JOIN "account"');
    expect(captured[0].sql).toMatch(/"opportunity"\."organization_id"/);
    expect(captured[0].sql).toMatch(/"account"\."organization_id"/);
  });

  it('rejects an inline dataset whose dimension traverses an undeclared relationship', async () => {
    const bad = DatasetSchema.parse({
      name: 'bad', label: 'Bad', object: 'opportunity', include: [],
      dimensions: [{ name: 'region', field: 'account.region' }],
      measures: [{ name: 'cnt', aggregate: 'count' }],
    });
    await expect(
      service([]).queryDataset(bad, { dimensions: ['region'], measures: ['cnt'] }),
    ).rejects.toThrow(/not declared in the dataset's `include`/);
  });

  it('degrades to an empty result when the backing table is missing (no such table)', async () => {
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => { throw new Error('SELECT COUNT(*) FROM "opportunity" - no such table: opportunity'); },
    });
    const result = await svc.queryDataset(dataset, { dimensions: ['region'], measures: ['revenue'] }, { tenantId: 'org_A' } as ExecutionContext);
    expect(result).toEqual({ rows: [], fields: [], totals: [] });
  });

  it('still throws on a non-missing-source error (real query bugs surface)', async () => {
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => { throw new Error('syntax error near "FROM"'); },
    });
    await expect(
      svc.queryDataset(dataset, { dimensions: ['region'], measures: ['revenue'] }, { tenantId: 'org_A' } as ExecutionContext),
    ).rejects.toThrow(/syntax error/);
  });

  it('pre-registered datasets (config.datasets) are compiled at construction', () => {
    const svc = new AnalyticsService({
      datasets: [dataset],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [],
    });
    expect(svc.cubeRegistry.has('sales')).toBe(true);
  });

  // ── ADR-0021 D2 drill-through metadata ──────────────────────────────────
  it('exposes drill-through metadata: object, dimensionFields, and a raw-value sidecar', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const result = await service(captured).queryDataset(
      dataset,
      { dimensions: ['region'], measures: ['revenue'] },
      { tenantId: 'org_A' } as ExecutionContext,
    ) as any;
    // The host drills into the dataset's base object…
    expect(result.object).toBe('opportunity');
    // …mapping the drillable dimension name to its underlying field…
    expect(result.dimensionFields).toEqual({ region: 'account.region' });
    // …and the RAW grouped value is preserved in a parallel array (rows are
    // NOT mutated — they keep exactly their measure/dimension columns).
    expect(result.drillRawRows).toEqual([{ region: 'NA' }]);
    expect(result.rows[0]).toEqual({ region: 'NA', revenue: 100 });
  });

  it('enriches a measure column with its declared currency (ISO 4217)', async () => {
    const priced = DatasetSchema.parse({
      name: 'sales_priced', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', label: 'Revenue', format: '0,0', currency: 'USD', certified: true }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [{ stage: 'Won', revenue: 1000 }],
      getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
    });
    const result = await svc.queryDataset(
      priced,
      { dimensions: ['stage'], measures: ['revenue'] },
      { tenantId: 'org_A' } as ExecutionContext,
    ) as any;
    // The measure's declared currency rides onto the result field so the client
    // renders a locale-correct symbol via Intl (not a "$" baked into `format`).
    const revenueField = (result.fields ?? []).find((f: any) => f.name === 'revenue');
    expect(revenueField?.currency).toBe('USD');
    expect(revenueField?.format).toBe('0,0');
  });

  it('enriches dimension columns with their dataset display label', async () => {
    const labeled = DatasetSchema.parse({
      name: 'sales2', label: 'Sales', object: 'opportunity', include: ['account'],
      dimensions: [{ name: 'region', field: 'account.region', type: 'string', label: 'Region' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', label: 'Revenue', certified: true }],
    });
    const result = await service([]).queryDataset(
      labeled,
      { dimensions: ['region'], measures: ['revenue'] },
      { tenantId: 'org_A' } as ExecutionContext,
    ) as any;
    const regionField = (result.fields ?? []).find((f: any) => f.name === 'region' || f.name === 'account.region');
    expect(regionField?.label).toBe('Region');
  });

  it('does NOT mark a date dimension drillable (a humanized bucket cannot be exact-matched)', async () => {
    const dated = DatasetSchema.parse({
      name: 'sales3', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [{ name: 'closed', field: 'close_date', type: 'date' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', certified: true }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [{ closed: 1700000000000, revenue: 100 }],
      getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
    });
    const result = await svc.queryDataset(dated, { dimensions: ['closed'], measures: ['revenue'] }, { tenantId: 'org_A' } as ExecutionContext) as any;
    // No drillable (non-date) dimension → no drill metadata at all.
    expect(result.dimensionFields).toBeUndefined();
    expect(result.object).toBeUndefined();
    expect(result.drillRawRows).toBeUndefined();
  });

  it('marks a LOOKUP dimension drillable, exposing the raw FK for exact-match drill', async () => {
    const byAccount = DatasetSchema.parse({
      name: 'sales_acct', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [{ name: 'account', field: 'account', type: 'lookup', label: 'Account' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', certified: true }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [{ account: 'acc_123', revenue: 1000 }],
      getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
    });
    const result = await svc.queryDataset(byAccount, { dimensions: ['account'], measures: ['revenue'] }, { tenantId: 'org_A' } as ExecutionContext) as any;
    // A lookup dim IS drillable (unlike a date bucket): its raw FK is exposed so
    // the report drill filters by the stored id, not the resolved display name.
    expect(result.object).toBe('opportunity');
    expect(result.dimensionFields).toEqual({ account: 'account' });
    expect(result.drillRawRows).toEqual([{ account: 'acc_123' }]);
  });
});
