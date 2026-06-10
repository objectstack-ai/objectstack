// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import {
  resolveDimensionLabels,
  pickDisplayField,
  formatDateBucket,
  type DimensionLabelDeps,
  type FieldMetaLite,
} from '../dimension-labels.js';

// ── Field maps the fake engine exposes ──────────────────────────────────
const TASK_FIELDS: Record<string, FieldMetaLite> = {
  status: {
    type: 'select',
    options: [
      { value: 'backlog', label: 'Backlog' },
      { value: 'in_review', label: 'In Review' },
      { value: 'done', label: 'Done' },
    ],
  },
  account: { type: 'lookup', reference: 'crm_account' },
  created_at: { type: 'date' },
};
const ACCOUNT_FIELDS: Record<string, FieldMetaLite> = {
  name: { type: 'text' },
  region: { type: 'text' },
};

function deps(overrides: Partial<DimensionLabelDeps> = {}): DimensionLabelDeps {
  return {
    getObjectFields: (obj) =>
      obj === 'task' ? TASK_FIELDS : obj === 'crm_account' ? ACCOUNT_FIELDS : undefined,
    fetchRecordLabels: async (target, ids) => {
      const names: Record<string, string> = { acc1: 'Acme Corp', acc2: 'Globex' };
      const m = new Map<unknown, string>();
      if (target === 'crm_account') for (const id of ids) if (names[String(id)]) m.set(id, names[String(id)]);
      return m;
    },
    ...overrides,
  };
}

describe('resolveDimensionLabels', () => {
  it('maps a select dimension value → option label', async () => {
    const rows = [
      { status: 'backlog', task_count: 5 },
      { status: 'done', task_count: 3 },
    ];
    await resolveDimensionLabels('task', [{ name: 'status', field: 'status' }], rows, deps());
    expect(rows).toEqual([
      { status: 'Backlog', task_count: 5 },
      { status: 'Done', task_count: 3 },
    ]);
  });

  it('maps a lookup dimension id → related record display name', async () => {
    const rows = [
      { account: 'acc1', budget_sum: 800000 },
      { account: 'acc2', budget_sum: 200000 },
    ];
    await resolveDimensionLabels('task', [{ name: 'account', field: 'account' }], rows, deps());
    expect(rows).toEqual([
      { account: 'Acme Corp', budget_sum: 800000 },
      { account: 'Globex', budget_sum: 200000 },
    ]);
  });

  it('leaves an unresolved lookup id untouched (no blanks)', async () => {
    const rows = [{ account: 'orphan', budget_sum: 1 }];
    await resolveDimensionLabels('task', [{ name: 'account', field: 'account' }], rows, deps());
    expect(rows).toEqual([{ account: 'orphan', budget_sum: 1 }]);
  });

  it('formats a date dimension value to a human bucket label', async () => {
    // epoch-ms for 2026-04-15T00:00:00Z
    const ts = Date.UTC(2026, 3, 15);
    const rows = [{ created_at: ts, task_count: 2 }];
    await resolveDimensionLabels(
      'task',
      [{ name: 'created_at', field: 'created_at', type: 'date', dateGranularity: 'month' }],
      rows,
      deps(),
    );
    expect(rows).toEqual([{ created_at: '2026-04', task_count: 2 }]);
  });

  it('is a no-op for a plain string dimension', async () => {
    const rows = [{ progress: '50', task_count: 2 }];
    await resolveDimensionLabels('task', [{ name: 'progress', field: 'progress' }], rows, deps());
    expect(rows).toEqual([{ progress: '50', task_count: 2 }]);
  });

  it('does nothing when the object is unknown to the engine', async () => {
    const rows = [{ status: 'backlog', n: 1 }];
    await resolveDimensionLabels('mystery', [{ name: 'status', field: 'status' }], rows, deps());
    expect(rows).toEqual([{ status: 'backlog', n: 1 }]);
  });

  it('only fetches lookup labels once per distinct id set', async () => {
    let calls = 0;
    const rows = [
      { account: 'acc1', n: 1 },
      { account: 'acc1', n: 2 },
      { account: 'acc2', n: 3 },
    ];
    const d = deps({
      fetchRecordLabels: async (_t, ids) => {
        calls++;
        expect(ids.sort()).toEqual(['acc1', 'acc2']); // de-duped
        return new Map<unknown, string>([['acc1', 'Acme Corp'], ['acc2', 'Globex']]);
      },
    });
    await resolveDimensionLabels('task', [{ name: 'account', field: 'account' }], rows, d);
    expect(calls).toBe(1);
    expect(rows.map((r) => r.account)).toEqual(['Acme Corp', 'Acme Corp', 'Globex']);
  });
});

describe('formatDateBucket', () => {
  const ts = Date.UTC(2026, 3, 15); // 2026-04-15
  it('formats per granularity', () => {
    expect(formatDateBucket(ts, 'year')).toBe('2026');
    expect(formatDateBucket(ts, 'quarter')).toBe('2026-Q2');
    expect(formatDateBucket(ts, 'month')).toBe('2026-04');
    expect(formatDateBucket(ts, 'day')).toBe('2026-04-15');
    expect(formatDateBucket(ts, undefined)).toBe('2026-04-15');
  });
  it('parses epoch-ms numeric strings and ISO strings', () => {
    expect(formatDateBucket(String(ts), 'month')).toBe('2026-04');
    expect(formatDateBucket('2026-04-15T10:00:00Z', 'month')).toBe('2026-04');
  });
  it('parses epoch-seconds', () => {
    expect(formatDateBucket(String(Math.floor(ts / 1000)), 'month')).toBe('2026-04');
  });
  it('returns the input unchanged when not a parseable date', () => {
    expect(formatDateBucket('not-a-date', 'month')).toBe('not-a-date');
    expect(formatDateBucket(null)).toBe(null);
  });
});

describe('pickDisplayField', () => {
  it('prefers name > title > label', () => {
    expect(pickDisplayField({ title: { type: 'text' }, name: { type: 'text' } })).toBe('name');
    expect(pickDisplayField({ label: { type: 'text' }, title: { type: 'text' } })).toBe('title');
  });
  it('falls back to the first text-like field', () => {
    expect(pickDisplayField({ amount: { type: 'number' }, code: { type: 'text' } })).toBe('code');
  });
  it('returns undefined when nothing suitable exists', () => {
    expect(pickDisplayField({ amount: { type: 'number' } })).toBeUndefined();
    expect(pickDisplayField(undefined)).toBeUndefined();
  });
});

describe('AnalyticsService.queryDataset — label resolution (integration)', () => {
  const dataset = DatasetSchema.parse({
    name: 'task_metrics',
    label: 'Task Metrics',
    object: 'task',
    dimensions: [
      { name: 'status', field: 'status', type: 'string' },
      { name: 'account', field: 'account', type: 'lookup' },
    ],
    measures: [{ name: 'task_count', aggregate: 'count' }],
  });

  function service() {
    return new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (object, { groupBy }) => {
        // Lookup name fetch: group by id + display field → return (id, name) rows.
        if (object === 'crm_account' && groupBy?.includes('name')) {
          return [
            { id: 'acc1', name: 'Acme Corp', _c: 1 },
            { id: 'acc2', name: 'Globex', _c: 1 },
          ];
        }
        // Primary aggregate: grouped by the selected dimension (raw values).
        if (groupBy?.includes('status')) {
          return [
            { status: 'backlog', task_count: 5 },
            { status: 'done', task_count: 3 },
          ];
        }
        return [
          { account: 'acc1', task_count: 4 },
          { account: 'acc2', task_count: 2 },
        ];
      },
      labelResolver: {
        getObjectFields: (obj) =>
          obj === 'task' ? TASK_FIELDS : obj === 'crm_account' ? ACCOUNT_FIELDS : undefined,
        // Reuse the real plugin shape: fetch via the same executeAggregate path is
        // exercised by the e2e build; here we resolve directly for a focused unit.
        fetchRecordLabels: async (_t, ids) => {
          const names: Record<string, string> = { acc1: 'Acme Corp', acc2: 'Globex' };
          const m = new Map<unknown, string>();
          for (const id of ids) if (names[String(id)]) m.set(id, names[String(id)]);
          return m;
        },
      },
    });
  }

  it('returns select option labels for a select dimension', async () => {
    const res = await service().queryDataset(dataset, { dimensions: ['status'], measures: ['task_count'] });
    expect(res.rows).toEqual([
      { status: 'Backlog', task_count: 5 },
      { status: 'Done', task_count: 3 },
    ]);
  });

  it('returns related-record names for a lookup dimension', async () => {
    const res = await service().queryDataset(dataset, { dimensions: ['account'], measures: ['task_count'] });
    expect(res.rows).toEqual([
      { account: 'Acme Corp', task_count: 4 },
      { account: 'Globex', task_count: 2 },
    ]);
  });
});
