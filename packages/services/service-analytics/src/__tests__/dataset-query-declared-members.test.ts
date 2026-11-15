// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0021, ADR-0149 D1] `AnalyticsService.queryDataset` — the method
 * `POST /analytics/dataset/query` (single and batch), the dashboard, the
 * report and the AI tool all reach — answers only the members the dataset
 * declares.
 *
 * Before, it minted a measure the dataset does not declare (`count`, a raw
 * field read as its `sum`, an `<field>_sum` suffix spelling, a
 * `<dataset>.`-qualified spelling) and grouped by a raw field named as a
 * dimension or a time dimension, so a dashboard tile could show a number the
 * dataset never defines. `query_dataset` refused those since it gained the
 * closed-member rule; the service now refuses them on every face, with the
 * same `INVALID_FIELD` / 400 (`member` / `param` / `cube`), before anything
 * is read, naming the members THIS caller may use and the remedy.
 *
 * Unchanged, and pinned as controls: every declared member is served; a
 * declared member over a field the caller may not read still reaches the
 * field gate (403); a caller who may not read the object at all gets the read
 * refusal (403), never a member list; the cube door (`query()`, not a
 * dataset) still mints `count`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';

const ME = { userId: 'u_me', tenantId: 'org_a' } as ExecutionContext;
const ADMIN = { userId: 'u_admin', tenantId: 'org_a' } as ExecutionContext;

const OBJECTS: Record<string, { fields: Record<string, Record<string, unknown>> }> = {
  crm_opp: {
    fields: {
      id: { type: 'text' },
      stage: { type: 'text' },
      region: { type: 'text' },
      amount: { type: 'number' },
      margin: { type: 'number' },
      closed_on: { type: 'date' },
      secret: { type: 'number', internal: true },
    },
  },
  crm_locked: { fields: { id: { type: 'text' }, amount: { type: 'number' } } },
};

const PIPELINE: Dataset = DatasetSchema.parse({
  name: 'pipeline',
  label: 'Pipeline',
  object: 'crm_opp',
  dimensions: [
    { name: 'stage', label: 'Stage', field: 'stage', type: 'string' },
    { name: 'region', label: 'Region', field: 'region', type: 'string' },
    { name: 'close_month', label: 'Close month', field: 'closed_on', type: 'date' },
  ],
  measures: [
    { name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount' },
    { name: 'margin_total', label: 'Margin', aggregate: 'sum', field: 'margin' },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
    { name: 'secret_sum', label: 'Secret', aggregate: 'sum', field: 'secret' },
  ],
});
const LOCKED: Dataset = DatasetSchema.parse({
  name: 'locked_ds',
  label: 'Locked',
  object: 'crm_locked',
  dimensions: [],
  measures: [{ name: 'total', label: 'Total', aggregate: 'sum', field: 'amount' }],
});

const nativeSql = () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false });

/** u_me may not read `crm_locked` nor the `margin` field; u_admin reads everything. */
const security = {
  getReadFilter: async () => undefined,
  canReadObject: (object: string, ctx?: ExecutionContext) => !(ctx?.userId === 'u_me' && object === 'crm_locked'),
  getReadableFields: async (object: string, ctx?: ExecutionContext) => {
    const all = Object.keys(OBJECTS[object]?.fields ?? {});
    return ctx?.userId === 'u_me' ? all.filter((f) => f !== 'margin') : all;
  },
  getQueryableFields: async (object: string, ctx?: ExecutionContext) => {
    const all = Object.keys(OBJECTS[object]?.fields ?? {});
    return ctx?.userId === 'u_me' ? all.filter((f) => f !== 'margin') : all;
  },
};

async function boot(rows: Record<string, unknown>[] = [{ stage: 'won', revenue: 100 }]) {
  const reads: string[] = [];
  const engine = {
    execute: async (sql: unknown, options?: { object?: string }) => {
      reads.push(`execute:${options?.object ?? String(sql)}`);
      return { rows: rows.map((r) => ({ ...r })) };
    },
    hasObjectMiddleware: () => false,
    getObject: (name: string) => OBJECTS[name],
    resolveEffectiveDatasource: () => undefined,
  };
  const registered: Record<string, unknown> = {};
  const ctx = {
    getService: (name: string) => (name === 'security' ? security : name === 'data' ? engine : registered[name]),
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  await new AnalyticsServicePlugin({ queryCapabilities: nativeSql }).init(ctx as never);
  return { service: registered.analytics as AnalyticsService, reads };
}

const messageOf = (e: unknown) => String((e as Error)?.message ?? e);

describe('queryDataset refuses a selection member the dataset does not declare', () => {
  it.each([
    ['the ad-hoc count', { measures: ['count'] }, 'count', 'measures'],
    ['a raw field as a measure', { measures: ['amount'] }, 'amount', 'measures'],
    ['a suffix spelling', { measures: ['amount_sum'] }, 'amount_sum', 'measures'],
    ['a dataset-qualified spelling of a declared measure', { measures: ['pipeline.revenue'] }, 'pipeline.revenue', 'measures'],
    ['an undeclared measure beside a declared one', { measures: ['revenue', 'amount'] }, 'amount', 'measures'],
    ['a raw field as a dimension', { measures: ['revenue'], dimensions: ['region', 'amount'] }, 'amount', 'dimensions'],
    [
      'a raw field as a time dimension',
      { measures: ['revenue'], timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }] },
      'closed_on',
      'timeDimensions',
    ],
  ])('%s: 400 INVALID_FIELD naming the member, the declared ones and the remedy, reading nothing', async (_case, selection, member, param) => {
    const { service, reads } = await boot();
    const e = await service.queryDataset(PIPELINE, selection as never, ADMIN).catch((err) => err);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member, param, cube: 'pipeline' });
    expect(messageOf(e)).toContain(`The dataset "pipeline" does not declare the ${param === 'measures' ? 'measure' : 'dimension'} "${member}".`);
    for (const declared of ['revenue', 'margin_total', 'deal_count', 'stage', 'region', 'close_month']) {
      expect(messageOf(e)).toContain(declared);
    }
    expect(messageOf(e)).toContain('declare the member on the dataset');
    expect(reads).toEqual([]);
  });

  it('names every undeclared member, and only the members THIS caller may use', async () => {
    const { service, reads } = await boot();
    const e = await service
      .queryDataset(PIPELINE, { measures: ['count'], dimensions: ['amount'] } as never, ME)
      .catch((err) => err);
    expect(e).toMatchObject({ code: 'INVALID_FIELD', status: 400, member: 'count', param: 'measures' });
    expect(messageOf(e)).toContain('the measure "count", dimension "amount"');
    expect(messageOf(e)).toContain('revenue');
    // `margin` is withheld from u_me; `secret` is an internal field.
    expect(messageOf(e)).not.toContain('margin_total');
    expect(messageOf(e)).not.toContain('secret');
    expect(reads).toEqual([]);
  });

  it('an inline dataset is judged against its own declaration', async () => {
    const { service, reads } = await boot();
    const inline = DatasetSchema.parse({
      name: 'draft_ds',
      label: 'Draft',
      object: 'crm_opp',
      dimensions: [],
      measures: [{ name: 'opp_count', label: 'Count', aggregate: 'count' }],
    });
    await expect(service.queryDataset(inline, { measures: ['count'] } as never, ADMIN)).rejects.toMatchObject({
      code: 'INVALID_FIELD',
      status: 400,
      member: 'count',
      cube: 'draft_ds',
    });
    expect(reads).toEqual([]);
    const served = await service.queryDataset(inline, { measures: ['opp_count'] } as never, ADMIN);
    expect(Array.isArray(served.rows)).toBe(true);
  });

  it('CONTROL: a caller who may not read the object gets the read refusal, never a member list', async () => {
    const { service, reads } = await boot();
    const e = await service.queryDataset(LOCKED, { measures: ['count'] } as never, ME).catch((err) => err);
    expect(e).toMatchObject({ status: 403 });
    expect(messageOf(e)).not.toContain('Measures you may use');
    expect(reads).toEqual([]);
  });

  it('CONTROL: a declared member over a field the caller may not read still reaches the field gate (403)', async () => {
    const { service, reads } = await boot();
    const e = await service.queryDataset(PIPELINE, { measures: ['margin_total'] } as never, ME).catch((err) => err);
    expect(e).toMatchObject({ status: 403 });
    expect(reads).toEqual([]);
  });

  it('CONTROL: every declared measure and dimension, a declared time dimension included, is served', async () => {
    const { service, reads } = await boot([{ stage: 'won', revenue: 100, deal_count: 1 }]);
    const out = await service.queryDataset(
      PIPELINE,
      {
        measures: ['revenue', 'deal_count'],
        dimensions: ['stage', 'region'],
        timeDimensions: [{ dimension: 'close_month', dateRange: ['2026-01-01', '2026-12-31'] }],
      } as never,
      ADMIN,
    );
    expect(Array.isArray(out.rows)).toBe(true);
    expect(reads.length).toBeGreaterThan(0);
  });

  it('CONTROL: the cube door (query(), not a dataset) still mints `count`', async () => {
    const { service } = await boot([{ count: 3 }]);
    const spy = vi.fn();
    const out = await service.query({ cube: 'crm_opp', measures: ['count'] } as never, ADMIN).catch((e) => spy(e));
    expect(spy).not.toHaveBeenCalled();
    expect(out).toBeDefined();
  });
});
