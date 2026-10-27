// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `fields[].polarity` — a dataset measure's declared polarity reaches the
 * renderer on the measure column's descriptor, and on its `__compare` column.
 *
 * The dashboard renderer (`DatasetWidget`) colours a period-over-period delta
 * from the dataset answer alone: it reads `fields[]` for every column's display
 * metadata and never fetches the dataset document. So "lower is better" for an
 * approval-turnaround measure has to ride the descriptor, like `format` and
 * `currency`, or a slower turnaround keeps being drawn green.
 *
 * The control half: a measure that declares no polarity, and every dimension
 * column, carry no `polarity` key at all, so an answer over a dataset that never
 * declares one is byte-identical to before. Each pin is asserted on both paths
 * that produce a dataset answer: the live engine query and the draft preview.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';

interface Approval extends Record<string, unknown> {
  status: string;
  turnaround_days: number;
  submitted_on: string;
}

const ROWS: Approval[] = [
  { status: 'approved', turnaround_days: 4, submitted_on: '2026-02-03' },
  { status: 'approved', turnaround_days: 6, submitted_on: '2026-02-10' },
  { status: 'rejected', turnaround_days: 2, submitted_on: '2026-01-20' },
];

const DATASET = DatasetSchema.parse({
  name: 'approval_ds',
  object: 'approval',
  dimensions: [
    { name: 'status', field: 'status', type: 'string', label: 'Status' },
    { name: 'submitted_on', field: 'submitted_on', type: 'date' },
  ],
  measures: [
    { name: 'turnaround', aggregate: 'sum', field: 'turnaround_days', label: 'Turnaround', polarity: 'lower' },
    { name: 'approved_count', aggregate: 'count', polarity: 'higher' },
    { name: 'request_count', aggregate: 'count', polarity: 'neutral' },
    // Undeclared: no key on the wire.
    { name: 'row_count', aggregate: 'count' },
  ],
});

const CTX = { tenantId: 'org_A' } as ExecutionContext;

function evaluateAggregate(opts: { groupBy?: unknown; aggregations?: unknown }) {
  const groupBy = (opts.groupBy ?? []) as Array<string | { field: string }>;
  const aggs = (opts.aggregations ?? []) as Array<{ field: string; method: string; alias: string }>;
  const buckets = new Map<string, { key: Record<string, unknown>; rows: Approval[] }>();
  for (const r of ROWS) {
    const key: Record<string, unknown> = {};
    for (const g of groupBy) {
      const f = typeof g === 'string' ? g : g.field;
      key[f] = r[f];
    }
    const id = JSON.stringify(Object.values(key));
    let b = buckets.get(id);
    if (!b) { b = { key, rows: [] }; buckets.set(id, b); }
    b.rows.push(r);
  }
  return [...buckets.values()].map(({ key, rows }) => {
    const row: Record<string, unknown> = { ...key };
    for (const a of aggs) {
      row[a.alias] = a.method === 'sum'
        ? rows.reduce((s, r) => s + Number(r[a.field] ?? 0), 0)
        : rows.length;
    }
    return row;
  });
}

function svc(preview: boolean) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, options: Record<string, unknown>) => evaluateAggregate(options),
    ...(preview ? { draftRowsResolver: async () => ROWS as Record<string, unknown>[] } : {}),
  });
}

type Field = Awaited<ReturnType<AnalyticsService['queryDataset']>>['fields'][number];
const byName = (fields: Field[]) => Object.fromEntries(fields.map((f) => [f.name, f]));

const MEASURES = ['turnaround', 'approved_count', 'request_count', 'row_count'];

async function bothPaths(selection: Record<string, unknown>) {
  const live = await svc(false).queryDataset(DATASET, selection as never, CTX);
  const preview = await svc(true).queryDataset(DATASET, selection as never, CTX, { previewDrafts: true });
  return [['live', byName(live.fields)], ['preview', byName(preview.fields)]] as const;
}

describe('fields[].polarity — a dataset answer relays each measure\'s declared polarity', () => {
  it('carries each declared value as written, on both paths', async () => {
    for (const [path, fields] of await bothPaths({ dimensions: ['status'], measures: MEASURES })) {
      expect(fields.turnaround?.polarity, path).toBe('lower');
      expect(fields.approved_count?.polarity, path).toBe('higher');
      expect(fields.request_count?.polarity, path).toBe('neutral');
    }
  });

  it('writes no polarity key on an undeclared measure, nor on a dimension column', async () => {
    for (const [path, fields] of await bothPaths({ dimensions: ['status'], measures: MEASURES })) {
      expect(fields.row_count, path).toBeDefined();
      expect('polarity' in (fields.row_count ?? {}), path).toBe(false);
      expect(fields.status, path).toBeDefined();
      expect('polarity' in (fields.status ?? {}), path).toBe(false);
    }
  });

  it('a `__compare` column carries its measure\'s polarity, on both paths', async () => {
    const selection = {
      dimensions: ['status'],
      measures: ['turnaround', 'row_count'],
      timeDimensions: [{ dimension: 'submitted_on', dateRange: ['2026-02-01', '2026-02-28'] }],
      compareTo: { kind: 'previousPeriod', dimension: 'submitted_on' },
    };
    for (const [path, fields] of await bothPaths(selection)) {
      expect(fields.turnaround__compare, path).toBeDefined();
      expect(fields.turnaround__compare?.polarity, path).toBe('lower');
      expect(fields.row_count__compare, path).toBeDefined();
      expect('polarity' in (fields.row_count__compare ?? {}), path).toBe(false);
    }
  });
});
