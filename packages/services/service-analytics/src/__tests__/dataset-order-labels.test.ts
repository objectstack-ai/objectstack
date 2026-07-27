// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3680 — `DatasetSelection.order` on a select/lookup dimension sorts by the
 * DISPLAY label the user reads, not the stored value.
 *
 * The executor sorts the assembled grid before `queryDataset` rewrites stored
 * values into display labels, so a "sort by Account" used to order by the FK
 * id — deterministic, but arbitrary to the reader once the names render. These
 * tests pin the fixed contract: the sort key is the label, the window cuts
 * AFTER the label sort (top-N by name is the right N), the rows still carry
 * raw values until the display pass (drill metadata depends on that), and the
 * label fetch is paid at most once per request.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { applyOrdering } from '../dataset-executor.js';
import type { DimensionLabelDeps, FieldMetaLite } from '../dimension-labels.js';

const CTX = { tenantId: 'org_A' } as ExecutionContext;

/** Opportunities grouped by a lookup (account) and a select (status). */
const byAccount = DatasetSchema.parse({
  name: 'sales_by_account', label: 'Sales', object: 'opportunity', include: [],
  dimensions: [
    { name: 'account', field: 'account', type: 'lookup', label: 'Account' },
    { name: 'status', field: 'status', type: 'string', label: 'Status' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

type FetchCall = { target: string; ids: unknown[]; scope: unknown };

/**
 * Label capabilities for the fixture: `account` references `crm_account`
 * (ids deliberately ordered OPPOSITE to their names), `status` is a select
 * whose option labels invert the stored-value order.
 */
const FIELDS: Record<string, Record<string, FieldMetaLite>> = {
  opportunity: {
    account: { type: 'lookup', reference: 'crm_account' },
    status: {
      type: 'select',
      options: [
        { value: 'a_active', label: 'Working' },
        { value: 'b_churned', label: 'Ended' },
      ],
    },
  },
  crm_account: { name: { type: 'text' } },
};

function labelResolver(names: Record<string, string>, calls: FetchCall[] = []): DimensionLabelDeps {
  return {
    getObjectFields: (obj) => FIELDS[obj],
    fetchRecordLabels: async (target, ids, scope) => {
      calls.push({ target, ids: [...ids], scope });
      const m = new Map<unknown, string>();
      if (target === 'crm_account') {
        for (const id of ids) if (names[String(id)]) m.set(id, names[String(id)]);
      }
      return m;
    },
  };
}

/** ObjectQL-aggregate service (the path with no ordering grammar of its own). */
function aggSvc(rows: Record<string, unknown>[], names: Record<string, string>, calls: FetchCall[] = []) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async () => rows,
    labelResolver: labelResolver(names, calls),
  });
}

/** Native-SQL service; captures every emitted statement. */
function sqlSvc(rows: Record<string, unknown>[], names: Record<string, string>, captured: string[] = [], calls: FetchCall[] = []) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async (_o, sql) => { captured.push(sql); return rows; },
    labelResolver: labelResolver(names, calls),
  });
}

describe('#3680 — a lookup order key sorts by the related record name', () => {
  it('orders by display name, not the FK id, and keeps the drill sidecar aligned', async () => {
    // Raw-id ascending would put a1 (Zebra) before b2 (Apple).
    const svc = aggSvc(
      [
        { account: 'a1', revenue: 10 },
        { account: 'b2', revenue: 20 },
      ],
      { a1: 'Zebra', b2: 'Apple' },
    );
    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['account'], measures: ['revenue'], order: { account: 'asc' } },
      CTX,
    ) as never as { rows: Record<string, unknown>[]; drillRawRows: Record<string, unknown>[] };
    expect(result.rows.map((r) => r.account)).toEqual(['Apple', 'Zebra']);
    // The drill sidecar snapshots the STORED ids, aligned to the sorted rows.
    expect(result.drillRawRows).toEqual([{ account: 'b2' }, { account: 'a1' }]);
  });

  it('a value the resolver cannot map sorts (and renders) by its raw form', async () => {
    const svc = aggSvc(
      [
        { account: 'zzz_9', revenue: 1 },   // orphaned — no label
        { account: 'a1', revenue: 2 },
        { account: 'b2', revenue: 3 },
      ],
      { a1: 'Zebra', b2: 'Alpha' },
    );
    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['account'], measures: ['revenue'], order: { account: 'asc' } },
      CTX,
    );
    expect(result.rows.map((r) => r.account)).toEqual(['Alpha', 'Zebra', 'zzz_9']);
  });
});

describe('#3680 — a select order key sorts by the option label', () => {
  it('orders by label even when it inverts the stored-value order', async () => {
    // Stored ascending: a_active < b_churned. Labels invert it: Ended < Working.
    const svc = aggSvc(
      [
        { status: 'a_active', revenue: 10 },
        { status: 'b_churned', revenue: 20 },
      ],
      {},
    );
    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['status'], measures: ['revenue'], order: { status: 'asc' } },
      CTX,
    );
    expect(result.rows.map((r) => r.status)).toEqual(['Ended', 'Working']);
  });
});

describe('#3680 — windowing and query pushdown around a label sort', () => {
  it('cuts the window AFTER the label sort, so a top-N by name is the right N', async () => {
    const calls: FetchCall[] = [];
    const svc = aggSvc(
      [
        { account: 'r1', revenue: 1 },
        { account: 'r2', revenue: 2 },
        { account: 'r3', revenue: 3 },
      ],
      { r1: 'Charlie', r2: 'Alpha', r3: 'Bravo' },
      calls,
    );
    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['account'], measures: ['revenue'], order: { account: 'asc' }, limit: 2 },
      CTX,
    );
    // By stored id the first two would be r1/r2 (Charlie, Alpha) — by name they
    // are Alpha and Bravo.
    expect(result.rows.map((r) => r.account)).toEqual(['Alpha', 'Bravo']);
    // The sort-key fetch covered the FULL pre-window id set…
    expect(new Set(calls[0]?.ids)).toEqual(new Set(['r1', 'r2', 'r3']));
    // …and the display pass reused it via the per-request cache: ONE fetch total.
    expect(calls).toHaveLength(1);
  });

  it('keeps the window OUT of the SQL when ordering by a label-bearing dimension', async () => {
    const captured: string[] = [];
    const svc = sqlSvc(
      [
        { account: 'a1', revenue: 10 },
        { account: 'b2', revenue: 20 },
      ],
      { a1: 'Zebra', b2: 'Apple' },
      captured,
    );
    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['account'], measures: ['revenue'], order: { account: 'asc' }, limit: 1 },
      CTX,
    );
    // A SQL ORDER BY would sort the stored id and LIMIT would truncate the
    // wrong window — both must stay in memory for a label-bearing order key.
    expect(captured[0]).not.toContain('ORDER BY');
    expect(captured[0]).not.toContain('LIMIT');
    expect(result.rows.map((r) => r.account)).toEqual(['Apple']);
  });

  it('still pushes a MEASURE ordering into the SQL (the common case is unchanged)', async () => {
    const captured: string[] = [];
    const svc = sqlSvc([{ account: 'a1', revenue: 10 }], { a1: 'Zebra' }, captured);
    await svc.queryDataset(
      byAccount,
      { dimensions: ['account'], measures: ['revenue'], order: { revenue: 'desc' }, limit: 5 },
      CTX,
    );
    expect(captured[0]).toContain('ORDER BY "revenue" DESC');
    expect(captured[0]).toContain('LIMIT 5');
  });
});

describe('#3680 × #3602 — the sort-key label fetch stays scoped', () => {
  it('carries the REFERENCED object read scope into the sort-time fetch', async () => {
    const calls: FetchCall[] = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [
        { account: 'a1', revenue: 10 },
        { account: 'b2', revenue: 20 },
      ],
      getReadScope: (object, ctx?: ExecutionContext) => {
        if (!ctx?.tenantId) return undefined;
        return object === 'crm_account'
          ? { organization_id: ctx.tenantId, is_public: true }
          : { organization_id: ctx.tenantId };
      },
      labelResolver: labelResolver({ a1: 'Zebra', b2: 'Apple' }, calls),
    });
    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['account'], measures: ['revenue'], order: { account: 'asc' } },
      CTX,
    );
    expect(result.rows.map((r) => r.account)).toEqual(['Apple', 'Zebra']);
    expect(calls).toHaveLength(1);
    expect(calls[0].scope).toEqual({ organization_id: 'org_A', is_public: true });
  });

  it('fails CLOSED when the referenced object scope cannot be resolved: sorts by the stored value, fetches nothing', async () => {
    const calls: FetchCall[] = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => [
        { account: 'b2', revenue: 20 },
        { account: 'a1', revenue: 10 },
      ],
      getReadScope: (object) => {
        if (object === 'crm_account') throw new Error('scope resolution failed');
        return undefined;
      },
      labelResolver: labelResolver({ a1: 'Zebra', b2: 'Apple' }, calls),
    });
    const result = await svc.queryDataset(
      byAccount,
      { dimensions: ['account'], measures: ['revenue'], order: { account: 'asc' } },
      CTX,
    );
    // No unscoped fetch happened, for the sort key OR the display pass…
    expect(calls).toHaveLength(0);
    // …and the rows fall back to stored-value order, rendering the raw ids —
    // exactly what the display pass does for an unresolvable label.
    expect(result.rows.map((r) => r.account)).toEqual(['a1', 'b2']);
  });
});

describe('#3680 — applyOrdering sort-key substitution (unit)', () => {
  it('compares by the mapped value and falls back to the raw cell where unmapped', () => {
    const rows = [{ v: 'id_z' }, { v: 'id_a' }, { v: 'raw' }];
    const sorted = applyOrdering(rows, { v: 'asc' }, {
      v: new Map<unknown, unknown>([['id_z', 'Apple'], ['id_a', 'Zebra']]),
    });
    expect(sorted.map((r) => r.v)).toEqual(['id_z', 'raw', 'id_a']);
  });

  it('keeps nulls last regardless of the substitution map', () => {
    const rows = [{ v: null }, { v: 'id_a' }];
    const sorted = applyOrdering(rows, { v: 'desc' }, { v: new Map([['id_a', 'Alpha']]) });
    expect(sorted.map((r) => r.v)).toEqual(['id_a', null]);
  });
});
