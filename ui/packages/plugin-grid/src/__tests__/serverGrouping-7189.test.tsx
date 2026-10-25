/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7189 — a grouped grid groups on the SERVER.
 *
 * Maintainer ruling A (「7189 A  其他同意」): grouping on a list view is
 * server-side. The set of groups and every number in a group header (the
 * count, and any per-group aggregation) are properties of the query, not of
 * the fetched page; rows inside a group are paged. The acceptance carried from
 * objectstack#14556: the 186-row, five-unit, `$top: 100` fixture renders five
 * group headers reading 86/61/31/7/1 regardless of row order, opening the
 * 86-row group pages its rows, and every row is reachable through the UI.
 * (The acceptance also asked that no "Partial" marker render when counts are
 * true; objectui#10881, ruling F, retired that marker everywhere, so there is
 * no marker left to be absent.)
 *
 * ## What the double answers, and why that is enough here
 *
 * The data source below answers `queryGroupHeaders` by reducing EVERY stored
 * row under the compiled query's own `groupBy` / `aggregations` / `where`, and
 * `find` by applying the compiled row query's `$filter` / `$top` / `$skip` —
 * the two faces the platform serves through `POST /data/:object/query`. That
 * the real door answers the compiled queries this way (five groups 86/61/31/7/1
 * in both orders, the 86-row group paged 50 + 36) is the platform half's pin
 * (objectstack#15330, `list-view-grouping-query-door.test.ts`) and was
 * re-measured for this card against `@objectstack/spec` 17.4.0, the version installed then;
 * what THIS file pins is the grid consuming those answers — and not the page.
 *
 * Every positive pin has a control that must come out differently: the SAME
 * fixture through a data source that cannot answer the header query does not
 * group at all — it used to group the fetched page (86 + 14 contiguous) and
 * mark it partial, and since objectui#10881 (ruling F) it refuses, naming
 * `queryGroupHeaders`, and asks for no rows.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { withinBand } from './groupBandScope';
import '@testing-library/jest-dom';
import React from 'react';
import { compileListViewGroupQuery } from '@objectstack/spec/ui';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'duly_task';

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  business_unit: { type: 'text', label: 'Business Unit' },
  amount: { type: 'number', label: 'Amount' },
};

/** The card's distribution: 186 rows over five units sized 86/61/31/7/1. */
const UNITS: Array<[string, number]> = [
  ['Northgate Operations', 86],
  ['Northgate Plant', 61],
  ['Northgate Quality', 31],
  ['Riverside Plant', 7],
  ['Riverside Depot', 1],
];
const EXPECTED: Record<string, number> = Object.fromEntries(UNITS);

interface Row { id: string; subject: string; business_unit: string; amount: number }

const buildRows = (interleaved: boolean): Row[] => {
  const buckets = UNITS.map(([unit, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `${unit}-${i}`, subject: `${unit} #${i}`, business_unit: unit, amount: i + 1 })),
  );
  if (!interleaved) return buckets.flat();
  const out: Row[] = [];
  for (let i = 0; ; i++) {
    let took = false;
    for (const b of buckets) if (i < b.length) { out.push(b[i]); took = true; }
    if (!took) return out;
  }
};

/** The `FilterCondition` subset the compiled queries use: `$and`, `$eq`, `$null`, equality. */
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

type Agg = { function: string; field?: string; alias: string };

/** A data source serving BOTH compiled queries over the whole row store. */
const makeServerDataSource = (rows: Row[]) => {
  const ds = {
    queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[]; aggregations?: Agg[] }) => {
      const groupBy = query.groupBy ?? [];
      const buckets = new Map<string, Row[]>();
      for (const row of rows.filter((r) => matches(r as any, query.where))) {
        const key = JSON.stringify(groupBy.map((f) => (row as any)[f] ?? null));
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(row);
      }
      return [...buckets.entries()].map(([key, members]) => {
        const values = JSON.parse(key) as unknown[];
        const out: Record<string, unknown> = Object.fromEntries(groupBy.map((f, i) => [f, values[i]]));
        for (const agg of query.aggregations ?? []) {
          const nums = members.map((m) => (agg.field ? (m as any)[agg.field] : null)).filter((v) => typeof v === 'number') as number[];
          out[agg.alias] =
            agg.function === 'count' ? (agg.field ? members.filter((m) => (m as any)[agg.field!] != null).length : members.length)
            : agg.function === 'sum' ? nums.reduce((a, b) => a + b, 0)
            : agg.function === 'count_distinct' ? new Set(members.map((m) => (m as any)[agg.field!])).size
            : null;
        }
        return out as { count: number };
      });
    }),
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      if (Array.isArray(params.$filter)) throw new Error('double: the grouped grid sent an AST filter, i.e. a flat window');
      const matching = rows.filter((r) => matches(r as any, params.$filter));
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? matching.length;
      return { data: matching.slice(skip, skip + top), total: matching.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  };
  return ds;
};

/** The CONTROL: the same store, a data source that declares no header query. */
const makePageOnlyDataSource = (rows: Row[]) => {
  const { queryGroupHeaders: _none, ...rest } = makeServerDataSource(rows);
  rest.find = vi.fn(async (_object: string, params: Record<string, unknown>) => {
    const skip = (params.$skip as number | undefined) ?? 0;
    const top = (params.$top as number | undefined) ?? rows.length;
    return { data: rows.slice(skip, skip + top), total: rows.length };
  });
  return rest;
};

const groupRows = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
const headerOf = (el: Element) => ({
  label: el.querySelector('.group-label')?.textContent ?? '',
  count: el.querySelector('.group-count')?.textContent ?? '',
});
const headerCounts = () => Object.fromEntries(groupRows().map((r) => { const h = headerOf(r); return [h.label, Number(h.count)]; }));
const groupRowEl = (label: string) => groupRows().find((r) => headerOf(r).label === label)!;
const subjectsIn = (el: Element, unit: string) =>
  withinBand(el).queryAllByText(new RegExp(`^${unit} #\\d+$`)).map((n) => n.textContent);

const renderGrid = (dataSource: unknown, schemaExtra: Record<string, unknown> = {}) =>
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: ['subject'],
          grouping: { fields: [{ field: 'business_unit' }] },
          pagination: { pageSize: 100 },
          ...schemaExtra,
        } as any}
        dataSource={dataSource as any}
      />
    </ActionProvider>,
  );

afterEach(() => cleanup());

describe('ObjectGrid groups on the server (objectui#7189)', () => {
  it.each([
    ['contiguous', false],
    ['interleaved', true],
  ])('%s rows: five headers reading 86/61/31/7/1', async (_name, interleaved) => {
    const ds = makeServerDataSource(buildRows(interleaved));
    renderGrid(ds);

    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    expect(headerCounts()).toEqual(EXPECTED);
    // Ordered by label (`GroupingField.order`, default asc) over the whole set.
    expect(groupRows().map((r) => headerOf(r).label)).toEqual([
      'Northgate Operations', 'Northgate Plant', 'Northgate Quality', 'Riverside Depot', 'Riverside Plant',
    ]);
  });

  it('asks the header query the SPEC compiles, and never fetches a flat window', async () => {
    const ds = makeServerDataSource(buildRows(false));
    renderGrid(ds);
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));

    expect(ds.queryGroupHeaders).toHaveBeenCalledTimes(1);
    const [object, query] = ds.queryGroupHeaders.mock.calls[0];
    expect(object).toBe(OBJECT);
    expect(query).toEqual(compileListViewGroupQuery(
      { grouping: { fields: [{ field: 'business_unit' }] }, columns: [] },
      { depth: 1 },
    ));
    // Every row read is ONE group's page: its filter is the compiled group
    // predicate, never the flat window the page-scoped grouping bucketed.
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(5));
    for (const [, params] of ds.find.mock.calls) {
      expect(params.$filter).toMatchObject({ $and: [{ business_unit: { $eq: expect.any(String) } }] });
      expect(params.$skip).toBe(0);
      expect(params.$top).toBe(100);
    }
  });

  it('opening the 86-row group pages its rows: 86 of them under a 100-row window', async () => {
    const ds = makeServerDataSource(buildRows(true));
    renderGrid(ds);
    await vi.waitFor(() => expect(subjectsIn(groupRowEl('Northgate Operations'), 'Northgate Operations')).toHaveLength(86));
  });

  it('pages a group larger than the window: 50, then the next 36 — all 86 reachable', async () => {
    const ds = makeServerDataSource(buildRows(false));
    renderGrid(ds, { pagination: { pageSize: 50 } });
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    const group = () => groupRowEl('Northgate Operations');
    await vi.waitFor(() => expect(subjectsIn(group(), 'Northgate Operations')).toHaveLength(50));
    const firstPage = subjectsIn(group(), 'Northgate Operations');

    const pageInfo = withinBand(group()).getByText('Page 1 of 2');
    const next = pageInfo.parentElement!.querySelectorAll('button')[2];
    fireEvent.click(next);

    await vi.waitFor(() => expect(withinBand(group()).getByText('Page 2 of 2')).toBeInTheDocument());
    await vi.waitFor(() => expect(subjectsIn(group(), 'Northgate Operations')).toHaveLength(36));
    const secondPage = subjectsIn(group(), 'Northgate Operations');
    expect(new Set([...firstPage, ...secondPage]).size).toBe(86);
    // The second page was asked of the server, for this group only.
    const lastCall = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    expect(lastCall).toMatchObject({
      $filter: { $and: [{ business_unit: { $eq: 'Northgate Operations' } }] },
      $skip: 50,
      $top: 50,
    });
  });

  it('every one of the 186 rows is reachable through the group pagers', async () => {
    const ds = makeServerDataSource(buildRows(true));
    renderGrid(ds, { pagination: { pageSize: 50 } });
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    const seen = new Set<string>();
    for (const [unit, size] of UNITS) {
      const group = () => groupRowEl(unit);
      await vi.waitFor(() => expect(subjectsIn(group(), unit).length).toBe(Math.min(size, 50)));
      subjectsIn(group(), unit).forEach((s) => seen.add(s!));
      if (size > 50) {
        const next = withinBand(group()).getByText('Page 1 of 2').parentElement!.querySelectorAll('button')[2];
        fireEvent.click(next);
        await vi.waitFor(() => expect(subjectsIn(group(), unit).length).toBe(size - 50));
        subjectsIn(group(), unit).forEach((s) => seen.add(s!));
      }
    }
    expect(seen.size).toBe(186);
  });

  it('a per-group aggregation is the QUERY\'s number, not the page\'s', async () => {
    const rows = buildRows(false);
    const ds = makeServerDataSource(rows);
    renderGrid(ds, { aggregations: [{ field: 'amount', type: 'sum' }] });
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    const chip = groupRowEl('Northgate Operations').querySelector('.group-aggregations')?.textContent ?? '';
    // 1 + 2 + … + 86 over the whole unit.
    expect(chip).toContain(`sum: ${(86 * 87) / 2}`);
    // …and the query asked for it by the spec's own alias.
    const [, query] = ds.queryGroupHeaders.mock.calls[0];
    expect(query.aggregations).toContainEqual({ function: 'sum', field: 'amount', alias: 'sum_amount' });
  });

  it('a collapsed group costs no row query', async () => {
    const ds = makeServerDataSource(buildRows(false));
    renderGrid(ds, { grouping: { fields: [{ field: 'business_unit', collapsed: true }] } });
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    expect(headerCounts()).toEqual(EXPECTED);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('every LEVEL is the query\'s: an outer header counts its whole subtree, from its own depth query', async () => {
    const rows = buildRows(true).map((r) => ({ ...r, region: r.business_unit.startsWith('Northgate') ? 'North' : 'River' }));
    const ds = makeServerDataSource(rows as Row[]);
    renderGrid(ds, { grouping: { fields: [{ field: 'region' }, { field: 'business_unit' }] } });
    await vi.waitFor(() => expect(groupRows()).toHaveLength(2 + 5));
    const outer = groupRows().filter((r) => !(r.getAttribute('data-testid') ?? '').includes('__'));
    expect(Object.fromEntries(outer.map((r) => [headerOf(r).label, Number(headerOf(r).count)]))).toEqual({
      North: 86 + 61 + 31,
      River: 7 + 1,
    });
    // One header query per depth — `count` would fold, `avg` would not.
    expect(ds.queryGroupHeaders.mock.calls.map(([, q]) => q.groupBy)).toEqual([['region'], ['region', 'business_unit']]);
    // A leaf's rows are asked for with BOTH levels of its key.
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect((ds.find.mock.calls[0][1].$filter as { $and: unknown[] }).$and).toHaveLength(2);
  });

  it('a reference-typed key is labelled from the referenced record, not printed as its id', async () => {
    const rows = buildRows(false).map((r) => ({ ...r, business_unit: `bu_${UNITS.findIndex(([u]) => u === r.business_unit)}` }));
    const ds = makeServerDataSource(rows as Row[]);
    const units = UNITS.map(([name], i) => ({ id: `bu_${i}`, name }));
    const rowsFind = ds.find;
    // The referenced object answers the label read; every other read is a row page.
    const withLabels = {
      ...ds,
      find: vi.fn(async (object: string, params: Record<string, unknown>) =>
        object === 'business_unit'
          ? {
            data: units.filter((u) => ((params.$filter as { id: { $in: string[] } }).id.$in).includes(u.id)),
            total: units.length,
          }
          : rowsFind(object, params)),
      getObjectSchema: vi.fn(async () => ({
        name: OBJECT,
        fields: { ...OBJECT_FIELDS, business_unit: { type: 'lookup', label: 'Business Unit', reference: 'business_unit' } },
      })),
    };
    renderGrid(withLabels);
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    await vi.waitFor(() => expect(headerCounts()).toEqual(EXPECTED));
  });

  // ── CONTROL: the instrument can see the defect ──────────────────────────
  it('CONTROL — a data source with no header query does not group the page: it refuses, and asks for no rows', async () => {
    const ds = makePageOnlyDataSource(buildRows(false));
    renderGrid(ds);
    await vi.waitFor(() => expect(screen.getByTestId('grid-grouping-needs-header-query')).toBeInTheDocument());
    // It used to answer two headers (86, 14) for five units and mark them
    // partial; ruling F (objectui#10881) refuses instead of grouping a page.
    await vi.waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    expect(ds.find).not.toHaveBeenCalled();
    expect(groupRows()).toHaveLength(0);
  });
});
