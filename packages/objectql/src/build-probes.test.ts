// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { runBuildProbes, type ProbeEngine } from '@objectstack/metadata-protocol';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * ADR-0038 L3 — runtime probes. Each probe is one real read; findings are
 * BuildIssue-shaped (layer 'runtime'); a probe must report, never throw.
 */

const ITEMS: Record<string, unknown> = {
  'seed expense_sample': { object: 'expense', records: [{ name: 'a' }] },
  'view expense.all': { name: 'expense.all', object: 'expense', viewKind: 'list', config: {} },
  'dashboard spending': {
    name: 'spending',
    widgets: [{ id: 'w1', dataset: 'expense_ds', values: ['amount'] }],
  },
  'dataset expense_ds': {
    name: 'expense_ds',
    object: 'expense',
    measures: [{ name: 'count', aggregate: 'count' }, { name: 'amount', aggregate: 'sum', field: 'amount' }],
    dimensions: [],
  },
};

const getItem = async (type: string, name: string) => ITEMS[`${type} ${name}`];

function engineWithRows(rowsByObject: Record<string, number>): ProbeEngine {
  return {
    find: async (object: string) =>
      Array.from({ length: Math.min(rowsByObject[object] ?? 0, 1) }, (_, i) => ({ id: String(i) })),
  };
}

describe('runBuildProbes — seeds', () => {
  it('flags seed_not_applied when the seeded object has no rows', async () => {
    const report = await runBuildProbes({
      engine: engineWithRows({ expense: 0 }),
      getItem,
      published: [{ type: 'seed', name: 'expense_sample' }],
    });
    expect(report.checked.seeds).toBe(1);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      layer: 'runtime',
      severity: 'error',
      code: 'seed_not_applied',
      artifact: { type: 'seed', name: 'expense_sample' },
      ref: { type: 'object', name: 'expense' },
    });
  });

  it('passes when rows exist', async () => {
    const report = await runBuildProbes({
      engine: engineWithRows({ expense: 3 }),
      getItem,
      published: [{ type: 'seed', name: 'expense_sample' }],
    });
    expect(report.issues).toHaveLength(0);
    expect(report.checked.seeds).toBe(1);
  });
});

describe('runBuildProbes — views', () => {
  it('flags view_read_failed when the read throws; empty tables are fine', async () => {
    const engine: ProbeEngine = {
      find: async (object: string) => {
        if (object === 'expense') throw new Error('no such table: expense');
        return [];
      },
    };
    const report = await runBuildProbes({
      engine,
      getItem,
      published: [{ type: 'view', name: 'expense.all' }],
    });
    expect(report.checked.views).toBe(1);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      code: 'view_read_failed',
      severity: 'error',
      artifact: { type: 'view', name: 'expense.all' },
    });
    expect(report.issues[0].message).toContain('no such table');

    const ok = await runBuildProbes({
      engine: engineWithRows({}), // empty result, no throw
      getItem,
      published: [{ type: 'view', name: 'expense.all' }],
    });
    expect(ok.issues).toHaveLength(0);
  });
});

describe('runBuildProbes — dashboard widgets', () => {
  it('flags empty_query when the dataset returns nothing on a populated object (incident #4)', async () => {
    const analytics = { queryDataset: vi.fn(async () => ({ rows: [] })) };
    const report = await runBuildProbes({
      engine: engineWithRows({ expense: 5 }),
      getItem,
      analytics,
      published: [{ type: 'dashboard', name: 'spending' }],
    });
    expect(analytics.queryDataset).toHaveBeenCalledOnce();
    // The widget's own values are used as the probe selection.
    expect((analytics.queryDataset.mock.calls[0][1] as any).measures).toEqual(['amount']);
    expect(report.checked.widgets).toBe(1);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      code: 'empty_query',
      severity: 'error',
      artifact: { type: 'dashboard', name: 'spending' },
      ref: { type: 'dataset', name: 'expense_ds', member: 'w1' },
    });
  });

  it('passes when the query returns data; empty-on-empty-object is fine', async () => {
    const withData = await runBuildProbes({
      engine: engineWithRows({ expense: 5 }),
      getItem,
      analytics: { queryDataset: async () => ({ rows: [{ amount: 42 }] }) },
      published: [{ type: 'dashboard', name: 'spending' }],
    });
    expect(withData.issues).toHaveLength(0);

    const emptyObject = await runBuildProbes({
      engine: engineWithRows({ expense: 0 }),
      getItem,
      analytics: { queryDataset: async () => ({ rows: [] }) },
      published: [{ type: 'dashboard', name: 'spending' }],
    });
    expect(emptyObject.issues).toHaveLength(0); // no rows promised, none missing
  });

  it('flags widget_query_failed when the query throws', async () => {
    const report = await runBuildProbes({
      engine: engineWithRows({ expense: 5 }),
      getItem,
      analytics: { queryDataset: async () => { throw new Error('RAW_SQL_UNSUPPORTED'); } },
      published: [{ type: 'dashboard', name: 'spending' }],
    });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].code).toBe('widget_query_failed');
    expect(report.issues[0].message).toContain('RAW_SQL_UNSUPPORTED');
  });

  it('emits ONE probes_unavailable warning when widgets exist but no analytics service does', async () => {
    const report = await runBuildProbes({
      engine: engineWithRows({ expense: 5 }),
      getItem,
      published: [{ type: 'dashboard', name: 'spending' }],
    });
    expect(report.checked.widgets).toBe(0);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: 'probes_unavailable', severity: 'warning' });
  });

  it('never throws — unreadable items and engine crashes degrade to findings/skips', async () => {
    const report = await runBuildProbes({
      engine: { find: async () => { throw new Error('engine down'); } },
      getItem: async () => { throw new Error('metadata down'); },
      published: [
        { type: 'seed', name: 'expense_sample' },
        { type: 'view', name: 'expense.all' },
        { type: 'dashboard', name: 'spending' },
      ],
    });
    // getItem failures mean no object bindings resolve — nothing probed, nothing thrown.
    expect(report.checked).toEqual({ seeds: 0, views: 0, widgets: 0 });
  });
});

describe('publishPackageDrafts — probes ride the response (ADR-0038 L3)', () => {
  it('runs probes over the published set and reports seed_not_applied', async () => {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    (protocol as any).ensureOverlayIndex = async () => {};
    (protocol as any).getOverlayRepo = () => ({
      listDrafts: async () => [
        { type: 'object', name: 'expense' },
        { type: 'seed', name: 'expense_sample' },
      ],
      get: async (_ref: any, opts: any) =>
        opts?.state === 'draft' ? { body: ITEMS['seed expense_sample'], hash: 'h' } : null,
    });
    vi.spyOn(protocol, 'publishMetaItem' as never).mockResolvedValue({ success: true, version: 'h', seq: 1 } as never);
    vi.spyOn(protocol as any, 'applySeedBodies').mockResolvedValue({ success: false, inserted: 0, updated: 0, error: 'boom' });
    // Probe reads: active items + an engine whose table stayed empty.
    (protocol as any).getMetaItem = async ({ type, name }: any) => ({ item: ITEMS[`${type} ${name}`] });
    (protocol as any).engine = { find: async () => [] };

    const res = await protocol.publishPackageDrafts({ packageId: 'app.exp' });

    expect(res.probes).toBeDefined();
    expect(res.probes!.checked.seeds).toBe(1);
    expect(res.probes!.issues.map((i) => i.code)).toEqual(['seed_not_applied']);
  });

  it('omits probes when nothing was published', async () => {
    const protocol = new ObjectStackProtocolImplementation({} as never);
    (protocol as any).ensureOverlayIndex = async () => {};
    (protocol as any).getOverlayRepo = () => ({ listDrafts: async () => [] });
    const res = await protocol.publishPackageDrafts({ packageId: 'app.empty' });
    expect(res.probes).toBeUndefined();
  });
});
