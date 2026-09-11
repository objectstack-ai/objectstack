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
  // #16390 — the other two members of the same declared reference class. The
  // `user` one deliberately omits `reference`: its target is a constant of the
  // type, and metadata authored without it is fully specified.
  assignee: { type: 'user' },
  parent: { type: 'tree', reference: 'task' },
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
      const byTarget: Record<string, Record<string, string>> = {
        crm_account: { acc1: 'Acme Corp', acc2: 'Globex' },
        sys_user: { usr_ada: 'Ada Lovelace' },
        task: { tsk_root: 'Root Task' },
      };
      const names = byTarget[target] ?? {};
      const m = new Map<unknown, string>();
      for (const id of ids) if (names[String(id)]) m.set(id, names[String(id)]);
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

  // ── #16390 — the same class, the same reading ─────────────────────────
  it('maps a user dimension id → the referenced user\'s display name', async () => {
    const rows = [{ assignee: 'usr_ada', budget_sum: 3 }];
    await resolveDimensionLabels('task', [{ name: 'assignee', field: 'assignee' }], rows, deps());
    // The field declares no `reference`; `sys_user` is the constant of the type.
    expect(rows).toEqual([{ assignee: 'Ada Lovelace', budget_sum: 3 }]);
  });

  it('maps a tree dimension id → the referenced record\'s display name', async () => {
    const rows = [{ parent: 'tsk_root', budget_sum: 4 }];
    await resolveDimensionLabels('task', [{ name: 'parent', field: 'parent' }], rows, deps());
    expect(rows).toEqual([{ parent: 'Root Task', budget_sum: 4 }]);
  });

  it('leaves an unresolved user id untouched, exactly as an unresolved lookup id is', async () => {
    const rows = [{ assignee: 'usr_gone', budget_sum: 1 }];
    await resolveDimensionLabels('task', [{ name: 'assignee', field: 'assignee' }], rows, deps());
    expect(rows).toEqual([{ assignee: 'usr_gone', budget_sum: 1 }]);
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

  // ── #3602 — the label lookup must carry the REFERENCED object's read scope ──
  describe('lookup label read scope (#3602)', () => {
    it('passes the referenced object scope through to fetchRecordLabels', async () => {
      let seenScope: unknown = 'UNSET';
      let seenTarget: string | undefined;
      const d = deps({
        fetchRecordLabels: async (target, ids, scope) => {
          seenTarget = target;
          seenScope = scope;
          return new Map<unknown, string>(ids.map((id) => [id, `name-${String(id)}`]));
        },
      });
      const rows = [{ account: 'acc1', n: 1 }];
      // resolveScope returns the referenced object's own RLS predicate.
      await resolveDimensionLabels('task', [{ name: 'account', field: 'account' }], rows, d, (target) => {
        expect(target).toBe('crm_account'); // the REFERENCED object, not the base
        return { organization_id: 'org_A' };
      });
      expect(seenTarget).toBe('crm_account');
      expect(seenScope).toEqual({ organization_id: 'org_A' });
    });

    it('fails CLOSED: when the scope cannot be resolved, the id is left raw (no unscoped fetch)', async () => {
      let fetched = false;
      const d = deps({
        fetchRecordLabels: async (_t, ids) => {
          fetched = true;
          return new Map<unknown, string>(ids.map((id) => [id, 'LEAKED NAME']));
        },
      });
      const rows = [{ account: 'acc1', n: 1 }];
      await resolveDimensionLabels('task', [{ name: 'account', field: 'account' }], rows, d, () => {
        throw new Error('security service unavailable');
      });
      // The label fetch must NOT have run, and the raw id must survive.
      expect(fetched).toBe(false);
      expect(rows).toEqual([{ account: 'acc1', n: 1 }]);
    });

    it('a select dimension is unaffected by scope resolution (no referenced object)', async () => {
      let scopeCalls = 0;
      const rows = [{ status: 'backlog', n: 1 }];
      await resolveDimensionLabels('task', [{ name: 'status', field: 'status' }], rows, deps(), () => {
        scopeCalls++;
        return undefined;
      });
      // A select dimension resolves from field metadata alone — it reads no
      // other object, so there is no target scope to resolve. This stays true
      // after #16390 widened the reference class; the positive counterpart for
      // the four members that DO read another object is the next case.
      expect(scopeCalls).toBe(0);
      expect(rows).toEqual([{ status: 'Backlog', n: 1 }]);
    });

    it('#16390 — a user and a tree dimension resolve the REFERENCED object scope, same as lookup', async () => {
      const asked: string[] = [];
      const seen: Array<{ target: string; scope: unknown }> = [];
      const d = deps({
        fetchRecordLabels: async (target, ids, scope) => {
          seen.push({ target, scope });
          return new Map<unknown, string>(ids.map((id) => [id, `name-${String(id)}`]));
        },
      });
      const rows = [{ account: 'acc1', assignee: 'usr_ada', parent: 'tsk_root', n: 1 }];
      await resolveDimensionLabels(
        'task',
        [
          { name: 'account', field: 'account' },
          { name: 'assignee', field: 'assignee' },
          { name: 'parent', field: 'parent' },
        ],
        rows,
        d,
        (target) => {
          asked.push(target);
          return { organization_id: 'org_A' };
        },
      );
      // Turning a user id into a name is a read of `sys_user`; it must carry
      // that object's own RLS, not the base object's.
      expect(asked).toEqual(['crm_account', 'sys_user', 'task']);
      expect(seen).toEqual([
        { target: 'crm_account', scope: { organization_id: 'org_A' } },
        { target: 'sys_user', scope: { organization_id: 'org_A' } },
        { target: 'task', scope: { organization_id: 'org_A' } },
      ]);
    });

    it('no resolver (no security configured) → unscoped fetch, unchanged behaviour', async () => {
      let seenScope: unknown = 'UNSET';
      const d = deps({
        fetchRecordLabels: async (_t, ids, scope) => {
          seenScope = scope;
          return new Map<unknown, string>(ids.map((id) => [id, 'Acme Corp']));
        },
      });
      const rows = [{ account: 'acc1', n: 1 }];
      await resolveDimensionLabels('task', [{ name: 'account', field: 'account' }], rows, d /* no resolveScope */);
      expect(seenScope).toBeUndefined();
      expect(rows).toEqual([{ account: 'Acme Corp', n: 1 }]);
    });
  });

  // ── #16773 — select option label i18n ───────────────────────────────────
  describe('select option i18n (#16773)', () => {
    it('routes a select dimension through translateSelectOptions when the plugin wires one, using the request locale', async () => {
      const seen: Array<{ objectName: string; fieldName: string; locale: string | undefined }> = [];
      const d = deps({
        translateSelectOptions: (objectName, fieldName, options, locale) => {
          seen.push({ objectName, fieldName, locale });
          return options.map((o) => (o.value === 'backlog' ? { ...o, label: '待办' } : o));
        },
      });
      const rows = [{ status: 'backlog', n: 1 }, { status: 'done', n: 2 }];
      await resolveDimensionLabels(
        'task',
        [{ name: 'status', field: 'status' }],
        rows,
        d,
        undefined,
        { locale: 'zh-CN' } as any,
      );
      expect(seen).toEqual([{ objectName: 'task', fieldName: 'status', locale: 'zh-CN' }]);
      // Only the translated option changed; an option the translator didn't
      // touch (`done`) still renders its AUTHORED label ('Done') — from the
      // returned array, not silently dropped.
      expect(rows).toEqual([{ status: '待办', n: 1 }, { status: 'Done', n: 2 }]);
    });

    it('falls back to the field\'s own authored label when translateSelectOptions declines (no i18n / nothing for this locale)', async () => {
      const d = deps({ translateSelectOptions: () => undefined });
      const rows = [{ status: 'backlog', n: 1 }];
      await resolveDimensionLabels(
        'task',
        [{ name: 'status', field: 'status' }],
        rows,
        d,
        undefined,
        { locale: 'fr-FR' } as any,
      );
      expect(rows).toEqual([{ status: 'Backlog', n: 1 }]);
    });

    it('behaves exactly as before when the plugin declares no translateSelectOptions capability at all', async () => {
      const rows = [{ status: 'backlog', n: 1 }];
      await resolveDimensionLabels('task', [{ name: 'status', field: 'status' }], rows, deps() /* no translator */);
      expect(rows).toEqual([{ status: 'Backlog', n: 1 }]);
    });

    // The dotted/cross-object CONTROL (#16773): a relationship-path field name
    // (`account.region`) never matches a key in the BASE object's own field
    // map, so `resolveDimensionLabels` skips it entirely via `if (!meta)
    // continue` — select-branch translation included. This is the measured
    // reason the dotted arm needs no change: it never reaches this file's
    // select branch in the first place, on EITHER strategy, regardless of
    // `translateSelectOptions`.
    it('a dotted cross-object field name never matches the base object field map — left untouched, translateSelectOptions never consulted', async () => {
      let called = false;
      const d = deps({ translateSelectOptions: () => { called = true; return undefined; } });
      const rows = [{ region: 'backlog', n: 1 }]; // arbitrary raw value; must survive verbatim
      await resolveDimensionLabels(
        'task',
        [{ name: 'region', field: 'account.region' }],
        rows,
        d,
        undefined,
        { locale: 'zh-CN' } as any,
      );
      expect(called).toBe(false);
      expect(rows).toEqual([{ region: 'backlog', n: 1 }]);
    });
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

  it('resolves labels on server-side totals rows (#1753)', async () => {
    const res = await service().queryDataset(dataset, {
      dimensions: ['status', 'account'],
      measures: ['task_count'],
      totals: { groupings: [['account']] },
    });
    expect(res.totals).toEqual([{
      dimensions: ['account'],
      rows: [
        { account: 'Acme Corp', task_count: 4 },
        { account: 'Globex', task_count: 2 },
      ],
    }]);
  });

  it('#16773 — a same-object select dimension renders the LOCALIZED option label end to end when the plugin bridge wires translateSelectOptions', async () => {
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [
        { status: 'backlog', task_count: 5 },
        { status: 'done', task_count: 3 },
      ],
      labelResolver: {
        getObjectFields: (obj) => (obj === 'task' ? TASK_FIELDS : undefined),
        fetchRecordLabels: async () => new Map(),
        translateSelectOptions: (objectName, fieldName, options, locale) => {
          if (objectName !== 'task' || fieldName !== 'status' || locale !== 'zh-CN') return undefined;
          const zh: Record<string, string> = { backlog: '待办', in_review: '审核中', done: '完成' };
          return options.map((o) => (typeof o.value === 'string' && zh[o.value] ? { ...o, label: zh[o.value] } : o));
        },
      },
    });
    const statusOnly = DatasetSchema.parse({
      name: 'task_status',
      label: 'Task Status',
      object: 'task',
      dimensions: [{ name: 'status', field: 'status', type: 'string' }],
      measures: [{ name: 'task_count', aggregate: 'count' }],
    });
    const res = await svc.queryDataset(
      statusOnly,
      { dimensions: ['status'], measures: ['task_count'] },
      { tenantId: 'org_A', locale: 'zh-CN' } as any,
    );
    expect(res.rows).toEqual([
      { status: '待办', task_count: 5 },
      { status: '完成', task_count: 3 },
    ]);
  });

  it('enriches measure fields with their display label + format', async () => {
    const labelledDataset = DatasetSchema.parse({
      name: 'sales_metrics',
      label: 'Sales',
      object: 'task',
      dimensions: [{ name: 'status', field: 'status', type: 'string' }],
      measures: [{ name: 'spent_sum', aggregate: 'sum', field: 'spent', label: 'Total Spent', format: '$0,0' }],
    });
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [{ status: 'backlog', spent_sum: 616000 }],
    });
    const res = await svc.queryDataset(labelledDataset, { dimensions: ['status'], measures: ['spent_sum'] });
    const field = res.fields.find((f) => f.name === 'spent_sum');
    expect(field).toMatchObject({ name: 'spent_sum', label: 'Total Spent', format: '$0,0' });
  });
});
