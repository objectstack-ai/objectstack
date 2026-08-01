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
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
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
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', label: 'Revenue', format: '0,0', currency: 'USD' }],
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

  // ── ADR-0053 currency chain (measure → field currencyConfig → tenant ctx) ──
  function pricedSvc(rows: Array<Record<string, unknown>>, sourceFieldMeta?: (o: string, f: string) => { type?: string; defaultCurrency?: string; max?: number } | undefined) {
    return new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => rows,
      getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
      ...(sourceFieldMeta ? { sourceFieldMeta } : {}),
    });
  }
  const moneyDataset = (measure: Record<string, unknown>) => DatasetSchema.parse({
    name: 'money', label: 'Money', object: 'opportunity', include: [],
    dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', label: 'Revenue', ...measure }],
  });

  it('chain: a currency-FIELD measure (no explicit currency) inherits the field defaultCurrency', async () => {
    const svc = pricedSvc([{ stage: 'Won', revenue: 1000 }], (_o, f) => f === 'amount' ? { type: 'currency', defaultCurrency: 'EUR' } : undefined);
    const r = await svc.queryDataset(moneyDataset({}), { dimensions: ['stage'], measures: ['revenue'] }, { tenantId: 'o' } as ExecutionContext) as any;
    expect(r.fields.find((f: any) => f.name === 'revenue')?.currency).toBe('EUR');
  });

  it('chain: a currency field with no defaultCurrency falls back to the tenant ctx.currency', async () => {
    const svc = pricedSvc([{ stage: 'Won', revenue: 1000 }], (_o, f) => f === 'amount' ? { type: 'currency' } : undefined);
    const r = await svc.queryDataset(moneyDataset({}), { dimensions: ['stage'], measures: ['revenue'] }, { tenantId: 'o', currency: 'GBP' } as ExecutionContext) as any;
    expect(r.fields.find((f: any) => f.name === 'revenue')?.currency).toBe('GBP');
  });

  it('chain: an explicit measure currency wins over the field default and the tenant ctx', async () => {
    const svc = pricedSvc([{ stage: 'Won', revenue: 1000 }], (_o, f) => f === 'amount' ? { type: 'currency', defaultCurrency: 'EUR' } : undefined);
    const r = await svc.queryDataset(moneyDataset({ currency: 'JPY' }), { dimensions: ['stage'], measures: ['revenue'] }, { tenantId: 'o', currency: 'GBP' } as ExecutionContext) as any;
    expect(r.fields.find((f: any) => f.name === 'revenue')?.currency).toBe('JPY');
  });

  it('chain: a NON-currency field measure never gets a currency (even with a tenant default)', async () => {
    const svc = pricedSvc([{ stage: 'Won', revenue: 1000 }], (_o, f) => f === 'amount' ? { type: 'number' } : undefined);
    const r = await svc.queryDataset(moneyDataset({}), { dimensions: ['stage'], measures: ['revenue'] }, { tenantId: 'o', currency: 'USD' } as ExecutionContext) as any;
    expect(r.fields.find((f: any) => f.name === 'revenue')?.currency).toBeUndefined();
  });

  // ── percent scale chain (objectui#3136) ───────────────────────────────────
  // A "%" format says how to PRINT a number, not what scale it is on, and the
  // two readings collide at exactly 1 ("100%" vs "1%"). The scale is answerable
  // from metadata, so it rides onto the result column next to `currency`.
  const rateDataset = (measures: Array<Record<string, unknown>>) => DatasetSchema.parse({
    name: 'sla', label: 'SLA', object: 'ticket', include: [],
    dimensions: [{ name: 'status', field: 'status', type: 'string' }],
    measures,
  });

  it('marks a derived RATIO as fraction-scaled — the 1.0 = 100% case', async () => {
    // Two of two met: the ratio is exactly 1, the value that renders as "1.0%"
    // when a renderer guesses the scale from the number's magnitude.
    const svc = pricedSvc([{ status: 'met', met_count: 2, base_count: 2 }]);
    const r = await svc.queryDataset(
      rateDataset([
        { name: 'base_count', aggregate: 'count', label: 'Applicable' },
        { name: 'met_count', aggregate: 'count', field: 'met', label: 'Met' },
        { name: 'sla_rate', label: 'SLA rate', derived: { op: 'ratio', of: ['met_count', 'base_count'] }, format: '0.0%' },
      ]),
      { dimensions: ['status'], measures: ['base_count', 'met_count', 'sla_rate'] },
      { tenantId: 'o' } as ExecutionContext,
    ) as any;
    expect(r.rows[0].sla_rate).toBe(1);
    expect(r.fields.find((f: any) => f.name === 'sla_rate')?.percentScale).toBe('fraction');
    // A count is not a percentage — annotating it would be a lie about the scale.
    expect(r.fields.find((f: any) => f.name === 'base_count')?.percentScale).toBeUndefined();
  });

  it('a measure-scoped COUNT over a group with no matching rows is 0, not blank', async () => {
    // The supplementary query for `met_count` returns only the groups that had
    // a matching row; the database reports "none matched" by omitting the group
    // entirely. That omission is a measured ZERO for a count — reporting it as
    // missing blanked the cell and left the ratio null, hiding "0% of breached
    // tickets met the SLA" on the one dashboard that exists to show it.
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      // The base pass sees both groups; the filtered pass only "met".
      executeRawSql: async (_o, sql) => sql.includes('met_count')
        ? [{ status: 'met', met_count: 2 }]
        : [{ status: 'met', base_count: 2 }, { status: 'breached', base_count: 3 }],
      getReadScope: () => undefined,
    });
    const r = await svc.queryDataset(
      rateDataset([
        { name: 'base_count', aggregate: 'count', label: 'Applicable' },
        { name: 'met_count', aggregate: 'count', field: 'met', label: 'Met', filter: { sla_met: true } },
        { name: 'sla_rate', label: 'SLA rate', derived: { op: 'ratio', of: ['met_count', 'base_count'] }, format: '0.0%' },
      ]),
      { dimensions: ['status'], measures: ['base_count', 'met_count', 'sla_rate'] },
      { tenantId: 'o' } as ExecutionContext,
    ) as any;
    const breached = r.rows.find((x: any) => x.status === 'breached');
    expect(breached.met_count).toBe(0);
    expect(breached.sla_rate).toBe(0);
    // The group that DID match is untouched — and is the 1.0 = 100% case.
    expect(r.rows.find((x: any) => x.status === 'met').sla_rate).toBe(1);
  });

  it('inherits the SOURCE FIELD scale: a `max: 100` percent field is whole-scaled', async () => {
    const svc = pricedSvc([{ status: 'open', allocation: 80 }], (_o, f) => f === 'allocation_percent' ? { type: 'percent', max: 100 } : undefined);
    const r = await svc.queryDataset(
      rateDataset([{ name: 'allocation', aggregate: 'avg', field: 'allocation_percent', label: 'Allocation', format: '0.0%' }]),
      { dimensions: ['status'], measures: ['allocation'] },
      { tenantId: 'o' } as ExecutionContext,
    ) as any;
    expect(r.fields.find((f: any) => f.name === 'allocation')?.percentScale).toBe('whole');
  });

  it('inherits the SOURCE FIELD scale: a bare percent field is fraction-scaled', async () => {
    const svc = pricedSvc([{ status: 'open', win: 0.75 }], (_o, f) => f === 'win_probability' ? { type: 'percent' } : undefined);
    const r = await svc.queryDataset(
      rateDataset([{ name: 'win', aggregate: 'avg', field: 'win_probability', label: 'Win', format: '0.0%' }]),
      { dimensions: ['status'], measures: ['win'] },
      { tenantId: 'o' } as ExecutionContext,
    ) as any;
    expect(r.fields.find((f: any) => f.name === 'win')?.percentScale).toBe('fraction');
  });

  it('leaves a plain-number measure unannotated — its format string stays the only word', async () => {
    const svc = pricedSvc([{ status: 'open', tax: 7 }], (_o, f) => f === 'tax_rate' ? { type: 'number', max: 100 } : undefined);
    const r = await svc.queryDataset(
      rateDataset([{ name: 'tax', aggregate: 'avg', field: 'tax_rate', label: 'Tax', format: '0.0%' }]),
      { dimensions: ['status'], measures: ['tax'] },
      { tenantId: 'o' } as ExecutionContext,
    ) as any;
    expect(r.fields.find((f: any) => f.name === 'tax')?.percentScale).toBeUndefined();
  });

  it('enriches dimension columns with their dataset display label', async () => {
    const labeled = DatasetSchema.parse({
      name: 'sales2', label: 'Sales', object: 'opportunity', include: ['account'],
      dimensions: [{ name: 'region', field: 'account.region', type: 'string', label: 'Region' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', label: 'Revenue' }],
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
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
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
    // …and, absent a `dateGranularity`, no RANGE sidecar either (it's not a bucket).
    expect(result.drillRanges).toBeUndefined();
  });

  // ── #1752 — half-open date-RANGE drill sidecar for granularity buckets ─────
  // Granularity bucketing runs through the ObjectQL aggregate path (the native
  // SQL strategy declines it), so these drive `executeAggregate` and mock the
  // already-bucketed rows (the strategy lowers the dim to a `dateGranularity`
  // groupBy). Dimension name == field so the mocked row key is unambiguous.
  it('#1752 — emits a half-open date range for a granularity-bucketed date dimension', async () => {
    const q = DatasetSchema.parse({
      name: 'sales_q', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [{ name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'quarter' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ close_date: '2026-Q2', revenue: 100 }],
      getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
    });
    const result = await svc.queryDataset(q, { dimensions: ['close_date'], measures: ['revenue'] }, { tenantId: 'org_A' } as ExecutionContext) as any;
    // The date bucket "2026-Q2" drills into the SPAN [2026-04-01, 2026-07-01).
    expect(result.object).toBe('opportunity');
    expect(result.drillRanges).toEqual([
      { close_date: { field: 'close_date', gte: '2026-04-01', lt: '2026-07-01' } },
    ]);
    // Range is its OWN channel — the date dim is still absent from the equality sidecar.
    expect(result.dimensionFields).toBeUndefined();
    expect(result.drillRawRows).toBeUndefined();
  });

  it('#1752 — a matrix "X by time" report carries BOTH the equality dim and the date range', async () => {
    const mx = DatasetSchema.parse({
      name: 'pipe_mx', label: 'Pipe', object: 'opportunity', include: [],
      dimensions: [
        { name: 'stage', field: 'stage', type: 'string' },
        { name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'month' },
      ],
      measures: [{ name: 'cnt', aggregate: 'count' }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ stage: 'qualification', close_date: '2026-06', cnt: 3 }],
      getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
    });
    const result = await svc.queryDataset(mx, { dimensions: ['stage', 'close_date'], measures: ['cnt'] }, { tenantId: 'org_A' } as ExecutionContext) as any;
    expect(result.object).toBe('opportunity');
    // The non-date dim drills by equality; the date dim drills by range — side by side.
    expect(result.dimensionFields).toEqual({ stage: 'stage' });
    expect(result.drillRawRows).toEqual([{ stage: 'qualification' }]);
    expect(result.drillRanges).toEqual([
      { close_date: { field: 'close_date', gte: '2026-06-01', lt: '2026-07-01' } },
    ]);
  });

  it('#1752 — a datetime field under a non-UTC reference tz drills the tz midnight instants', async () => {
    const q = DatasetSchema.parse({
      name: 'sales_dt', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [{ name: 'closed_at', field: 'closed_at', type: 'date', dateGranularity: 'month' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ closed_at: '2026-06', revenue: 100 }],
      // closed_at is a datetime instant → its month bucket boundary is that tz's
      // MIDNIGHT INSTANT. June/July 2026 in New York are EDT (−04), so local
      // midnight is 04:00 UTC.
      sourceFieldMeta: (_o, f) => (f === 'closed_at' ? { type: 'datetime' } : undefined),
      getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
    });
    const result = await svc.queryDataset(
      q,
      { dimensions: ['closed_at'], measures: ['revenue'], timezone: 'America/New_York' },
      { tenantId: 'org_A' } as ExecutionContext,
    ) as any;
    expect(result.object).toBe('opportunity');
    expect(result.drillRanges).toEqual([
      { closed_at: { field: 'closed_at', gte: '2026-06-01T04:00:00.000Z', lt: '2026-07-01T04:00:00.000Z' } },
    ]);
  });

  it('#1752 — still emits the range for a tz-naive date field under a non-UTC tz', async () => {
    const q = DatasetSchema.parse({
      name: 'sales_d_tz', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [{ name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'month' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ close_date: '2026-06', revenue: 100 }],
      sourceFieldMeta: (_o, f) => (f === 'close_date' ? { type: 'date' } : undefined),
      getReadScope: (_o, ctx?: ExecutionContext) => (ctx?.tenantId ? { organization_id: ctx.tenantId } : undefined),
    });
    const result = await svc.queryDataset(
      q,
      { dimensions: ['close_date'], measures: ['revenue'], timezone: 'America/New_York' },
      { tenantId: 'org_A' } as ExecutionContext,
    ) as any;
    // A `date` is a tz-naive calendar day (ADR-0053) → bounds are exact under any tz.
    expect(result.drillRanges).toEqual([
      { close_date: { field: 'close_date', gte: '2026-06-01', lt: '2026-07-01' } },
    ]);
  });

  it('marks a LOOKUP dimension drillable, exposing the raw FK for exact-match drill', async () => {
    const byAccount = DatasetSchema.parse({
      name: 'sales_acct', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [{ name: 'account', field: 'account', type: 'lookup', label: 'Account' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
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

  // ── #3214 — raw-value drill sidecar for totals / subtotal rows ────────────
  it('snapshots raw values for totals rows too (#3214), aligned to result.totals', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const result = await service(captured).queryDataset(
      dataset,
      { dimensions: ['region'], measures: ['revenue'], totals: { groupings: [['region'], []] } },
      { tenantId: 'org_A' } as ExecutionContext,
    ) as any;
    // drillRawTotals[i] ↔ result.totals[i]; drillRawTotals[i][j] ↔ result.totals[i].rows[j].
    expect(result.drillRawTotals).toEqual([
      // The ['region'] subtotal grouping snapshots its drillable dim's raw value…
      [{ region: 'NA' }],
      // …while the grand-total grouping ([]) has no drillable dim → an empty map
      // per row, which keeps index alignment and drills the unfiltered object.
      [{}],
    ]);
    // The data-row sidecar is unchanged (regression guard).
    expect(result.drillRawRows).toEqual([{ region: 'NA' }]);
  });

  it('preserves the raw FK for a subtotal row even after label resolution overwrites it (#3214)', async () => {
    const byAccount = DatasetSchema.parse({
      name: 'sales_matrix', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [
        { name: 'account', field: 'account', type: 'lookup', label: 'Account' },
        { name: 'stage', field: 'stage', type: 'string' },
      ],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (_object, { groupBy }) => {
        const g = groupBy ?? [];
        // Main grid: account × stage.
        if (g.includes('stage')) return [
          { account: 'acc1', stage: 'won', revenue: 30 },
          { account: 'acc2', stage: 'won', revenue: 20 },
        ];
        // Per-account subtotal grouping (raw FK values, pre-label).
        if (g.includes('account')) return [
          { account: 'acc1', revenue: 30 },
          { account: 'acc2', revenue: 20 },
        ];
        // Grand total.
        return [{ revenue: 50 }];
      },
      labelResolver: {
        getObjectFields: (obj) => ({
          opportunity: { account: { type: 'lookup', reference: 'crm_account' } },
          crm_account: { name: { type: 'text' } },
        } as Record<string, Record<string, { type?: string; reference?: string }>>)[obj],
        fetchRecordLabels: async (target, ids) => {
          const names: Record<string, string> = { acc1: 'Acme Corp', acc2: 'Globex' };
          const m = new Map<unknown, string>();
          if (target === 'crm_account') for (const id of ids) if (names[String(id)]) m.set(id, names[String(id)]);
          return m;
        },
      },
    });
    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['account', 'stage'], measures: ['revenue'], totals: { groupings: [['account'], []] } },
      { tenantId: 'org_A' } as ExecutionContext,
    ) as any;
    // The subtotal row now reads the display NAME (label resolution ran on it)…
    expect(result.totals[0].dimensions).toEqual(['account']);
    expect(result.totals[0].rows).toEqual([
      { account: 'Acme Corp', revenue: 30 },
      { account: 'Globex', revenue: 20 },
    ]);
    // …but the sidecar still carries the raw FK id, restricted to the grouping's
    // drillable dim (stage is not part of the ['account'] grouping), so a drill
    // from the subtotal filters by the stored value, not the record name.
    expect(result.drillRawTotals[0]).toEqual([{ account: 'acc1' }, { account: 'acc2' }]);
    // Grand total: no drillable dim → an empty map for its single row.
    expect(result.totals[1].dimensions).toEqual([]);
    expect(result.drillRawTotals[1]).toEqual([{}]);
  });

  // ── #3602 — the lookup label read is scoped to the REFERENCED object's RLS ──
  it('threads the referenced object read scope (not the base object) into the label fetch', async () => {
    const byAccount = DatasetSchema.parse({
      name: 'sales_acct_scoped', label: 'Sales', object: 'opportunity', include: [],
      dimensions: [{ name: 'account', field: 'account', type: 'lookup', label: 'Account' }],
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
    });
    const labelScopes: Array<{ target: string; scope: unknown }> = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [{ account: 'acc1', revenue: 1000 }],
      // Per-object scope: opportunity and crm_account get DIFFERENT predicates, so
      // the assertion proves the label fetch used the referenced object's scope,
      // not the base object's.
      getReadScope: (object, ctx?: ExecutionContext) => {
        if (!ctx?.tenantId) return undefined;
        return object === 'crm_account'
          ? { organization_id: ctx.tenantId, is_public: true }
          : { organization_id: ctx.tenantId };
      },
      labelResolver: {
        getObjectFields: (obj) => ({
          opportunity: { account: { type: 'lookup', reference: 'crm_account' } },
          crm_account: { name: { type: 'text' } },
        } as Record<string, Record<string, { type?: string; reference?: string }>>)[obj],
        fetchRecordLabels: async (target, ids, scope) => {
          labelScopes.push({ target, scope });
          const m = new Map<unknown, string>();
          for (const id of ids) m.set(id, `name-${String(id)}`);
          return m;
        },
      },
    });

    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['account'], measures: ['revenue'] },
      { tenantId: 'org_A' } as ExecutionContext,
    ) as any;

    // The label fetch ran against the referenced object, carrying ITS scope.
    expect(labelScopes).toEqual([
      { target: 'crm_account', scope: { organization_id: 'org_A', is_public: true } },
    ]);
    // And the label actually resolved (end-to-end sanity).
    expect(result.rows).toEqual([{ account: 'name-acc1', revenue: 1000 }]);
  });
});
