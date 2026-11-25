/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36276 — a group-header aggregate over a `record`-mode quantity
 * or amount is judged per grouping DEPTH, against the levels that depth's own
 * header query groups by.
 *
 * ADR-0144 D6 (amounts) and ADR-0158 U7 R1 (quantities): a raw `sum` / `avg`
 * / `min` / `max` over a measure whose unit each row names itself stands only
 * inside one unit, so the engine refuses one unless the query groups by the
 * measure's unit or currency field (`INVALID_FIELD`, 400). A grid grouped on
 * two levels asks one header query per depth: depth 1 groups by the first
 * level only. Grouped region, then `unit_code`, the depth-1 query groups by
 * `region` alone, so a record-mode quantity sum on it is refused — and every
 * header of the view failed with it. The group in a nested band stands inside
 * every level ABOVE it, never the ones below.
 *
 * The data source below is the engine's door as a double: it refuses, and
 * records, a raw aggregate over a record-mode measure whose unit field the
 * query does not group by, and answers every other query by reducing the
 * stored rows under the query's own `groupBy` / `aggregations`. The same
 * rows handed in whole (no header query) pin the browser-bucketed path, where
 * nothing refuses and a mixed-unit sum would simply be drawn.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { honestGroupAggregations, honestGroupAggregationsByDepth } from '../recordCurrencyAggregates';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
});

afterEach(() => cleanup());

const OBJECT = 'stock_move';

const OBJECT_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  region: { type: 'text', label: 'Region' },
  unit_code: { type: 'text', label: 'Unit' },
  qty: { type: 'number', label: 'Quantity', unitConfig: { unitMode: 'record', unitField: 'unit_code' } },
  currency_code: { type: 'text', label: 'Currency' },
  amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
};

interface Row { id: string; name: string; region: string; unit_code: string; qty: number; currency_code: string; amount: number }

/** North mixes KGM and LBR (and USD and EUR); a sum over all of North adds them. */
const ROWS: Row[] = [
  { id: 'r1', name: 'Move 1', region: 'North', unit_code: 'KGM', qty: 10, currency_code: 'USD', amount: 100 },
  { id: 'r2', name: 'Move 2', region: 'North', unit_code: 'LBR', qty: 5, currency_code: 'EUR', amount: 50 },
  { id: 'r3', name: 'Move 3', region: 'North', unit_code: 'KGM', qty: 3, currency_code: 'USD', amount: 30 },
  { id: 'r4', name: 'Move 4', region: 'South', unit_code: 'LBR', qty: 7, currency_code: 'EUR', amount: 70 },
];

type Agg = { function: string; field?: string; alias: string };
type HeaderQuery = { where?: unknown; groupBy?: string[]; aggregations?: Agg[] };

/** The unit or currency field of a record-mode measure, as the engine's two doors read it. */
function recordUnitOf(def: Record<string, unknown> | undefined): string | undefined {
  const currency = def?.currencyConfig as { currencyMode?: unknown; currencyField?: unknown } | undefined;
  if (currency?.currencyMode === 'record' && typeof currency.currencyField === 'string') return currency.currencyField;
  const unit = def?.unitConfig as { unitMode?: unknown; unitField?: unknown } | undefined;
  if (def?.type === 'number' && unit?.unitMode === 'record' && typeof unit.unitField === 'string' && unit.unitField !== '') {
    return unit.unitField;
  }
  return undefined;
}

/** The `FilterCondition` subset the compiled row queries use: `$and`, `$eq`, `$null`, equality. */
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matches(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

function makeServerDataSource() {
  /** Every aggregate the engine's door refused: `fn(field) by [groupBy]`. */
  const refusals: string[] = [];
  const ds = {
    queryGroupHeaders: vi.fn(async (_object: string, query: HeaderQuery) => {
      const groupBy = query.groupBy ?? [];
      const refused = (query.aggregations ?? []).filter((node) => ['sum', 'avg', 'min', 'max'].includes(node.function)
        && node.field !== undefined
        && (() => { const unit = recordUnitOf(OBJECT_FIELDS[node.field!]); return unit !== undefined && !groupBy.includes(unit); })());
      if (refused.length > 0) {
        refusals.push(...refused.map((node) => `${node.function}(${node.field}) by [${groupBy.join(', ')}]`));
        throw Object.assign(new Error('refused: a raw aggregate across units'), { code: 'INVALID_FIELD', status: 400 });
      }
      const buckets = new Map<string, Row[]>();
      for (const row of ROWS.filter((r) => matches(r as never, query.where))) {
        const key = JSON.stringify(groupBy.map((f) => (row as never)[f] ?? null));
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(row);
      }
      return [...buckets.entries()].map(([key, members]) => {
        const values = JSON.parse(key) as unknown[];
        const out: Record<string, unknown> = Object.fromEntries(groupBy.map((f, i) => [f, values[i]]));
        for (const node of query.aggregations ?? []) {
          const cells = members.map((m) => (node.field ? (m as never)[node.field] : null)).filter((v) => v !== null && v !== undefined);
          out[node.alias] = node.function === 'count'
            ? (node.field ? cells.length : members.length)
            : node.function === 'sum' ? (cells as number[]).reduce((a, b) => a + b, 0)
            : node.function === 'count_distinct' ? new Set(cells).size
            : null;
        }
        return out as { count: number };
      });
    }),
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      const rows = ROWS.filter((r) => matches(r as never, params.$filter));
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? rows.length;
      return { data: rows.slice(skip, skip + top).map((r) => ({ ...r })), total: rows.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  };
  return Object.assign(ds, { refusals });
}

/** The two-level groupings the card names, and the measure each pins. */
const CASES = [
  { name: 'a record-mode quantity, region → unit_code', measure: 'qty', unitField: 'unit_code', inner: ['KGM', 'LBR'], northInner: { KGM: 13, LBR: 5 } },
  { name: 'a record-mode amount, region → currency_code', measure: 'amount', unitField: 'currency_code', inner: ['USD', 'EUR'], northInner: { USD: 130, EUR: 50 } },
] as const;

function grid(c: (typeof CASES)[number], dataSource: unknown, extra: Record<string, unknown> = {}) {
  return (
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: ['name'],
          grouping: { fields: [{ field: 'region' }, { field: c.unitField }] },
          aggregations: [
            { field: c.measure, type: 'sum' },
            // Unit-free and read off the field: it stands at every depth, so a
            // depth-1 header with no chip at all would not read as the sum
            // being left out.
            { field: c.measure, type: 'count_distinct' },
          ],
          pagination: { pageSize: 50 },
          ...extra,
        } as never}
        dataSource={dataSource as never}
      />
    </ActionProvider>
  );
}

/** The chips a group header draws, by the composite key `useGroupedData` gives it. */
function chipsOf(key: string): string[] | undefined {
  const row = document.querySelector(`[data-testid="group-row-${key}"]`);
  if (!row) return undefined;
  return Array.from(row.querySelectorAll('.group-aggregations > span')).map(
    (chip) => (chip.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

const sumChips = (chips: string[] | undefined) => (chips ?? []).filter((chip) => chip.startsWith('sum'));

describe('server grouping on two levels: each depth asks only what its own groupBy admits (objectstack#36276)', () => {
  it.each(CASES)('$name: depth 1 sends no such sum, no refused request is sent, and the deeper depth keeps it', async (c) => {
    const ds = makeServerDataSource();
    render(grid(c, ds));

    await waitFor(() => expect(chipsOf(`0:North__1:${c.inner[0]}`)).toBeDefined());

    // No request the engine refuses — the defect sent one, and failed the view.
    expect(ds.refusals).toEqual([]);

    const queries = ds.queryGroupHeaders.mock.calls.map(([, query]) => query as HeaderQuery);
    const depth1 = queries.filter((q) => JSON.stringify(q.groupBy) === JSON.stringify(['region']));
    const depth2 = queries.filter((q) => JSON.stringify(q.groupBy) === JSON.stringify(['region', c.unitField]));
    expect(depth1.length).toBeGreaterThan(0);
    expect(depth2.length).toBeGreaterThan(0);
    const sumsOver = (q: HeaderQuery) => (q.aggregations ?? []).filter((n) => n.function === 'sum' && n.field === c.measure);
    for (const q of depth1) {
      expect(sumsOver(q)).toEqual([]);
      // The unit-free distinct count still rides on the depth-1 query.
      expect((q.aggregations ?? []).some((n) => n.function === 'count_distinct' && n.field === c.measure)).toBe(true);
    }
    for (const q of depth2) expect(sumsOver(q)).toHaveLength(1);

    // The headers drawn: the region bands carry the count and no sum, the
    // unit bands carry their one-unit sum.
    expect(sumChips(chipsOf('0:North'))).toEqual([]);
    expect(chipsOf('0:North')).toContain('count_distinct: 3');
    expect(sumChips(chipsOf(`0:North__1:${c.inner[0]}`))).toHaveLength(1);
    expect(sumChips(chipsOf(`0:North__1:${c.inner[0]}`))[0]).toContain(String(c.northInner[c.inner[0] as keyof typeof c.northInner]));
    expect(sumChips(chipsOf(`0:North__1:${c.inner[1]}`))[0]).toContain(String(c.northInner[c.inner[1] as keyof typeof c.northInner]));
  });

  it.each(CASES)('CONTROL — $name grouped by the unit field first: depth 1 keeps the sum', async (c) => {
    const ds = makeServerDataSource();
    render(grid(c, ds, { grouping: { fields: [{ field: c.unitField }, { field: 'region' }] } }));

    await waitFor(() => expect(chipsOf(`0:${c.inner[0]}__1:North`)).toBeDefined());
    expect(ds.refusals).toEqual([]);
    for (const [, query] of ds.queryGroupHeaders.mock.calls) {
      expect(((query as HeaderQuery).aggregations ?? []).filter((n) => n.function === 'sum' && n.field === c.measure)).toHaveLength(1);
    }
    expect(sumChips(chipsOf(`0:${c.inner[0]}`))).toHaveLength(1);
  });
});

describe('rows handed in whole, bucketed in the browser: the same per-depth rule (objectstack#36276)', () => {
  it.each(CASES)('$name: the region bands draw no sum across units; the unit bands do', async (c) => {
    // Rows handed in whole; the definition still comes from the data source.
    const ds = makeServerDataSource();
    const { queryGroupHeaders: _none, ...pageOnly } = ds;
    render(grid(c, pageOnly, { data: { provider: 'value', items: ROWS } }));

    await waitFor(() => expect(sumChips(chipsOf(`0:North__1:${c.inner[0]}`))).toHaveLength(1));
    expect(sumChips(chipsOf('0:North'))).toEqual([]);
    expect(chipsOf('0:North')).toContain('count_distinct: 3');
    expect(sumChips(chipsOf(`0:North__1:${c.inner[0]}`))[0]).toContain(String(c.northInner[c.inner[0] as keyof typeof c.northInner]));
  });
});

describe('honestGroupAggregationsByDepth: each depth judged on its own prefix of the levels (objectstack#36276)', () => {
  const AGGS = [
    { field: 'qty', type: 'sum' as const },
    { field: 'amount', type: 'max' as const },
    { field: 'qty', type: 'count_distinct' as const },
  ];

  it('region → unit_code → currency_code: the quantity sum from depth 2, the amount max from depth 3', () => {
    expect(honestGroupAggregationsByDepth(AGGS, OBJECT_FIELDS, ['region', 'unit_code', 'currency_code'])).toEqual([
      [AGGS[2]],
      [AGGS[0], AGGS[2]],
      AGGS,
    ]);
  });

  it('the deepest depth answers what the all-levels judgment answers', () => {
    const levels = ['region', 'currency_code'];
    const byDepth = honestGroupAggregationsByDepth(AGGS, OBJECT_FIELDS, levels);
    expect(byDepth[byDepth.length - 1]).toEqual(honestGroupAggregations(AGGS, OBJECT_FIELDS, levels));
    expect(byDepth[0]).toEqual([AGGS[2]]);
  });

  it('no grouping levels, no depths', () => {
    expect(honestGroupAggregationsByDepth(AGGS, OBJECT_FIELDS, [])).toEqual([]);
  });
});
