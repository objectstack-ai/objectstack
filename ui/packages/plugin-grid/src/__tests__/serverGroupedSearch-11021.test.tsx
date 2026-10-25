/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11021 — a grouped grid under a search groups the SEARCHED rows.
 *
 * `@objectstack/spec` 17.5.0 declares ADR-0061 `search` / `searchFields` on
 * `EngineAggregateOptions` (objectstack#20487), and the platform's grouped
 * branch honours them. So the grid sends its search term on the group header
 * query AND on every group's row query, as one pair: the headers count the
 * searched rows and the rows under them are those rows. Before, each group's
 * row query stripped the term and the header query never had it, so a searched
 * grouped grid drew the unsearched groups.
 *
 * ## How a term reaches a server-grouped grid here
 *
 * A server-grouped grid draws no search box of its own; its one box is the
 * flat table's. So a term reaches it two ways, and both are pinned:
 *
 *   - typed while the grid is flat, and grouping turned on after, the way a
 *     host that rewrites `grouping` at runtime does. The term stays the grid's
 *     while grouped; clearing it takes turning grouping off again;
 *   - handed down by a host that owns the term, as the `search` prop — how
 *     `ListView` hands its toolbar term to the grid that groups for it.
 *
 * ## What the double answers
 *
 * `queryGroupHeaders` and `find` both apply ONE matcher to the whole store:
 * the compiled `where` / `$filter`, then `search` / `$search` over
 * `searchFields` / `$searchFields` (default: every text field). The term `#1`
 * matches a SUBSET of each unit's rows (numbers 1 and 10-19), so a search sent
 * on only one of the two queries puts counts and rows in disagreement: a
 * header-only search draws "11" over a group's every row, a rows-only search
 * draws every unit at its full size over 11 rows.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
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
};

/** 186 rows over five units sized 86/61/31/7/1, as objectui#7189's fixture. */
const UNITS: Array<[string, number]> = [
  ['Northgate Operations', 86],
  ['Northgate Plant', 61],
  ['Northgate Quality', 31],
  ['Riverside Plant', 7],
  ['Riverside Depot', 1],
];
const UNSEARCHED: Record<string, number> = Object.fromEntries(UNITS);

interface Row { id: string; subject: string; business_unit: string }
const ROWS: Row[] = UNITS.flatMap(([unit, n]) =>
  Array.from({ length: n }, (_, i) => ({ id: `${unit}-${i}`, subject: `${unit} #${i}`, business_unit: unit })),
);

const TERM = '#1';
const SEARCH_FIELDS = ['subject'];
/** Numbers 1 and 10-19 of each unit: the Depot's one row (#0) has none. */
const SEARCHED: Record<string, number> = {
  'Northgate Operations': 11,
  'Northgate Plant': 11,
  'Northgate Quality': 11,
  'Riverside Plant': 1,
};

/** The `FilterCondition` subset the compiled queries use: `$and`, `$eq`, `$null`, equality. */
function matchesWhere(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matchesWhere(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

/** ADR-0061 as the double serves it: a substring over the searched fields. */
function matchesSearch(row: Record<string, unknown>, term: unknown, fields: unknown): boolean {
  if (term === undefined) return true;
  if (typeof term !== 'string' || term === '') throw new Error(`double: a search that is not a term: ${JSON.stringify(term)}`);
  const over = Array.isArray(fields) ? (fields as string[]) : ['subject', 'business_unit'];
  return over.some((f) => String(row[f] ?? '').toLowerCase().includes(term.toLowerCase()));
}

type Agg = { function: string; field?: string; alias: string };
type HeaderQuery = { where?: unknown; groupBy?: string[]; aggregations?: Agg[]; search?: unknown; searchFields?: unknown };

/** A data source serving BOTH compiled queries over the whole row store, with one matcher. */
const makeServerDataSource = () => ({
  queryGroupHeaders: vi.fn(async (_object: string, query: HeaderQuery) => {
    const groupBy = query.groupBy ?? [];
    const buckets = new Map<string, number>();
    for (const row of ROWS) {
      if (!matchesWhere(row as any, query.where) || !matchesSearch(row as any, query.search, query.searchFields)) continue;
      const key = JSON.stringify(groupBy.map((f) => (row as any)[f] ?? null));
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([key, count]) => {
      const values = JSON.parse(key) as unknown[];
      return { ...Object.fromEntries(groupBy.map((f, i) => [f, values[i]])), count };
    });
  }),
  find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
    const matching = ROWS.filter((r) =>
      matchesWhere(r as any, params.$filter) && matchesSearch(r as any, params.$search, params.$searchFields));
    const skip = (params.$skip as number | undefined) ?? 0;
    const top = (params.$top as number | undefined) ?? matching.length;
    return { data: matching.slice(skip, skip + top), total: matching.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
});
type ServerDataSource = ReturnType<typeof makeServerDataSource>;

const GROUPING = { fields: [{ field: 'business_unit' }] };

const grid = (ds: ServerDataSource, grouped: boolean, hostSearch?: string) => (
  <ActionProvider>
    <ObjectGrid
      schema={{
        type: 'object-grid',
        objectName: OBJECT,
        columns: ['subject'],
        searchableFields: SEARCH_FIELDS,
        pagination: { pageSize: 100 },
        ...(grouped ? { grouping: GROUPING } : {}),
      } as any}
      dataSource={ds as any}
      {...(hostSearch !== undefined ? { search: hostSearch } : {})}
    />
  </ActionProvider>
);

// U+2026, matching `table.search` in the en pack (objectui#3878).
const searchBox = () => document.querySelector('input[placeholder="Search…"]') as HTMLInputElement | null;
const groupRows = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
const headerOf = (el: Element) => ({
  label: el.querySelector('.group-label')?.textContent ?? '',
  count: el.querySelector('.group-count')?.textContent ?? '',
});
const headerCounts = () => Object.fromEntries(groupRows().map((r) => { const h = headerOf(r); return [h.label, Number(h.count)]; }));
const groupRowEl = (label: string) => groupRows().find((r) => headerOf(r).label === label)!;
const subjectsIn = (el: Element, unit: string) =>
  withinBand(el).queryAllByText(new RegExp(`^${unit} #\\d+$`)).map((n) => n.textContent);

/** The row page queries: each one carries a group key under `$and`. */
const groupRowFinds = (ds: ServerDataSource, from = 0) =>
  ds.find.mock.calls.slice(from).map(([, p]) => p).filter((p) => Array.isArray((p.$filter as { $and?: unknown } | undefined)?.$and));

/** Every header set the grid paints, sampled on each DOM mutation. */
function recordPaintedHeaders() {
  const painted: Array<Record<string, number>> = [];
  const observer = new MutationObserver(() => {
    const counts = headerCounts();
    if (Object.keys(counts).length > 0) painted.push(counts);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { painted, stop: () => observer.disconnect() };
}

/** Type the term into the flat grid's box, then turn grouping on. */
async function searchThenGroup(ds: ServerDataSource) {
  const view = render(grid(ds, false));
  await vi.waitFor(() => expect(searchBox()).not.toBeNull());
  fireEvent.change(searchBox()!, { target: { value: TERM } });
  await vi.waitFor(() => expect(ds.find.mock.calls.at(-1)?.[1].$search).toBe(TERM));
  view.rerender(grid(ds, true));
  return view;
}

afterEach(() => cleanup());

describe('a grouped grid under a search groups the searched rows (objectui#11021)', () => {
  it('SEARCHED: only the groups holding matches, each counting its matches, over exactly those rows', async () => {
    const ds = makeServerDataSource();
    await searchThenGroup(ds);

    await vi.waitFor(() => expect(headerCounts()).toEqual(SEARCHED));
    // The Depot's one row does not match, so it is not a group at all.
    expect(groupRows().map((r) => headerOf(r).label)).not.toContain('Riverside Depot');
    // Each group draws the rows its header counted, not the unit's every row.
    for (const [unit, count] of Object.entries(SEARCHED)) {
      await vi.waitFor(() => expect(subjectsIn(groupRowEl(unit), unit)).toHaveLength(count));
    }

    // One pair on both queries: the header query is the spec's compiled one
    // with the term on it…
    const [, headerQuery] = ds.queryGroupHeaders.mock.calls.at(-1)!;
    expect(headerQuery).toEqual({
      ...compileListViewGroupQuery({ grouping: GROUPING, columns: [] }, { depth: 1 }),
      search: TERM,
      searchFields: SEARCH_FIELDS,
    });
    // …and every group's row page carries the same term and fields.
    const rowFinds = groupRowFinds(ds);
    expect(rowFinds.length).toBeGreaterThanOrEqual(Object.keys(SEARCHED).length);
    for (const params of rowFinds.slice(-Object.keys(SEARCHED).length)) {
      expect(params.$search).toBe(TERM);
      expect(params.$searchFields).toEqual(SEARCH_FIELDS);
    }
  });

  it('UNSEARCHED: no search key on either query, and the five whole units', async () => {
    const ds = makeServerDataSource();
    render(grid(ds, true));

    await vi.waitFor(() => expect(headerCounts()).toEqual(UNSEARCHED));
    for (const [, query] of ds.queryGroupHeaders.mock.calls) {
      expect(query).not.toHaveProperty('search');
      expect(query).not.toHaveProperty('searchFields');
    }
    await vi.waitFor(() => expect(groupRowFinds(ds)).toHaveLength(UNITS.length));
    for (const params of groupRowFinds(ds)) {
      expect(params).not.toHaveProperty('$search');
      expect(params).not.toHaveProperty('$searchFields');
    }
  });

  it('clearing the search restores the unsearched groups, and drops the term from both queries', async () => {
    const ds = makeServerDataSource();
    const view = await searchThenGroup(ds);
    await vi.waitFor(() => expect(headerCounts()).toEqual(SEARCHED));

    // The box is the flat table's: back to flat, the term is still in it.
    view.rerender(grid(ds, false));
    await vi.waitFor(() => expect(searchBox()?.value).toBe(TERM));
    fireEvent.change(searchBox()!, { target: { value: '' } });
    await vi.waitFor(() => expect(ds.find.mock.calls.at(-1)?.[1]).not.toHaveProperty('$search'));

    const findsBefore = ds.find.mock.calls.length;
    const headerCallsBefore = ds.queryGroupHeaders.mock.calls.length;
    const recorder = recordPaintedHeaders();
    view.rerender(grid(ds, true));

    await vi.waitFor(() => expect(headerCounts()).toEqual(UNSEARCHED));
    await vi.waitFor(() => expect(subjectsIn(groupRowEl('Northgate Operations'), 'Northgate Operations')).toHaveLength(86));
    recorder.stop();
    // Re-entering grouping asks with the query the grid resolves NOW, never
    // with the row query it held when it last grouped: no header query after
    // the re-entry carries the cleared term, and no searched group set is
    // painted on the way to the unsearched one.
    const reentryHeaderQueries = ds.queryGroupHeaders.mock.calls.slice(headerCallsBefore).map(([, q]) => q);
    expect(reentryHeaderQueries.length).toBeGreaterThan(0);
    for (const query of reentryHeaderQueries) {
      expect(query).toEqual(compileListViewGroupQuery({ grouping: GROUPING, columns: [] }, { depth: 1 }));
    }
    expect(recorder.painted.length).toBeGreaterThan(0);
    for (const counts of recorder.painted) {
      expect(counts).not.toEqual(SEARCHED);
    }
    // Every unit's latest row page is asked without the term.
    for (const [unit] of UNITS) {
      const pages = groupRowFinds(ds, findsBefore).filter((p) =>
        JSON.stringify((p.$filter as { $and: unknown[] }).$and).includes(JSON.stringify({ business_unit: { $eq: unit } })));
      expect(pages.length).toBeGreaterThan(0);
      expect(pages.at(-1)).not.toHaveProperty('$search');
      expect(pages.at(-1)).not.toHaveProperty('$searchFields');
    }
  });

  it('a host that owns the term hands it down as `search`: both queries carry it, and an empty one restores the groups', async () => {
    const ds = makeServerDataSource();
    const view = render(grid(ds, true, TERM));

    await vi.waitFor(() => expect(headerCounts()).toEqual(SEARCHED));
    const [, headerQuery] = ds.queryGroupHeaders.mock.calls.at(-1)!;
    expect(headerQuery).toEqual({
      ...compileListViewGroupQuery({ grouping: GROUPING, columns: [] }, { depth: 1 }),
      search: TERM,
      searchFields: SEARCH_FIELDS,
    });
    for (const [unit, count] of Object.entries(SEARCHED)) {
      await vi.waitFor(() => expect(subjectsIn(groupRowEl(unit), unit)).toHaveLength(count));
    }
    for (const params of groupRowFinds(ds)) {
      expect(params.$search).toBe(TERM);
      expect(params.$searchFields).toEqual(SEARCH_FIELDS);
    }

    // The host clears its term: the grid's own box plays no part.
    const findsBefore = ds.find.mock.calls.length;
    view.rerender(grid(ds, true, ''));
    await vi.waitFor(() => expect(headerCounts()).toEqual(UNSEARCHED));
    expect(ds.queryGroupHeaders.mock.calls.at(-1)![1]).not.toHaveProperty('search');
    await vi.waitFor(() => expect(groupRowFinds(ds, findsBefore).length).toBeGreaterThanOrEqual(UNITS.length));
    for (const params of groupRowFinds(ds, findsBefore)) {
      expect(params).not.toHaveProperty('$search');
    }
  });
});
