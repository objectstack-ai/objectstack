// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `DatasetDimension.nullLabel` reaches the renderer on the dimension column's
 * descriptor, as `fields[].nullLabel`.
 *
 * The chart renderer (objectui `DatasetWidget`) reads a dataset answer's
 * `fields[]` for every column's display metadata and never fetches the dataset
 * document, so the null bucket's authored name has to ride that descriptor. It
 * is resolved to a string at the request locale by the same `resolveI18nLabel`
 * the column's `label` uses, so a viewer reads the bucket in their own
 * language and the wire never carries a raw locale map.
 *
 * The other half is the control: a dimension that declares no `nullLabel`, and
 * every measure column, carry no `nullLabel` key at all, so an answer over a
 * dataset that never declares one is byte-identical to before.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

const dataset = DatasetSchema.parse({
  name: 'audit_metrics',
  object: 'sys_audit_log',
  include: [],
  dimensions: [
    { name: 'action', label: 'Action', field: 'action', type: 'string' },
    {
      name: 'user_id',
      label: 'User',
      field: 'user_id',
      type: 'string',
      nullLabel: { en: 'System', 'zh-CN': '系统' },
    },
    { name: 'source', field: 'source', type: 'string', nullLabel: 'Unknown' },
  ],
  // `user_id` is also a measure's field: the measure column must not inherit
  // the dimension's null label through the descriptor pass's field match.
  measures: [
    { name: 'event_count', label: 'Events', aggregate: 'count' },
    { name: 'user_id_count', aggregate: 'count_distinct', field: 'user_id' },
  ],
});

const DIMENSIONS = ['action', 'user_id', 'source'];
const MEASURES = ['event_count', 'user_id_count'];

function sqlService() {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [
      { action: 'create', user_id: null, source: null, event_count: 740, user_id_count: 0 },
      { action: 'login', user_id: 'usr_1', source: 'web', event_count: 3, user_id_count: 1 },
    ],
  });
}

function aggregateService() {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: Record<string, unknown>) => {
      const groupBy = (options.groupBy ?? []) as Array<string | { field: string }>;
      const aggregations = (options.aggregations ?? []) as Array<{ alias: string }>;
      const row: Record<string, unknown> = {};
      for (const g of groupBy) row[typeof g === 'string' ? g : g.field] = null;
      for (const a of aggregations) row[a.alias] = 1;
      return [row];
    },
  });
}

const STRATEGIES: [string, () => AnalyticsService][] = [
  ['NativeSQLStrategy', sqlService],
  ['ObjectQLStrategy', aggregateService],
];

async function nullLabels(svc: AnalyticsService, context?: ExecutionContext) {
  const result = await svc.queryDataset(dataset, { dimensions: DIMENSIONS, measures: MEASURES }, context);
  const out: Record<string, unknown> = {};
  for (const f of result.fields) {
    if (f.nullLabel !== undefined) expect(typeof f.nullLabel).toBe('string');
    out[f.name] = 'nullLabel' in f ? f.nullLabel : '(no nullLabel key)';
  }
  return out;
}

describe.each(STRATEGIES)('dataset dimension nullLabel on the wire (%s)', (_name, service) => {
  it('carries the declared null label, resolved to the request locale', async () => {
    const zh = await nullLabels(service(), { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext);
    const en = await nullLabels(service(), { tenantId: 'org_A', locale: 'en-US' } as ExecutionContext);
    expect(zh.user_id).toBe('系统');
    expect(en.user_id).toBe('System');
  });

  it('carries a plain-string null label as authored, whatever the locale', async () => {
    const zh = await nullLabels(service(), { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext);
    expect(zh.source).toBe('Unknown');
  });

  it('falls back to the platform source language when the request states no locale', async () => {
    const noContext = await nullLabels(service());
    expect(noContext.user_id).toBe('System');
  });

  it('writes no nullLabel key on a dimension that declares none, nor on any measure column', async () => {
    const cols = await nullLabels(service(), { tenantId: 'org_A', locale: 'zh-CN' } as ExecutionContext);
    expect(cols.action).toBe('(no nullLabel key)');
    expect(cols.event_count).toBe('(no nullLabel key)');
    expect(cols.user_id_count).toBe('(no nullLabel key)');
  });
});
