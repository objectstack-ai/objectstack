/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11021 — a grouped LIST VIEW under a toolbar search groups on the
 * server, and its group counts are the searched rows' counts.
 *
 * objectui#7189 ruling A: "the set of groups and every number in a group
 * header ... are properties of the query, not of the fetched page". Since
 * `@objectstack/spec` 17.5.0 the group header query takes ADR-0061
 * `search` / `searchFields`, and the grid sends the term on the header query
 * and on every group's row query as one pair. What reaches the console's
 * grouped list view is the other half: `ListView` has to hand its toolbar term
 * to the grid that groups on the server, instead of grouping one fetched
 * window of searched rows in the browser (whose counts are page slices once
 * the matches outnumber the window).
 *
 * ## Why this file lives in `app-shell`
 *
 * The claim is about two components at once — the toolbar term is
 * `ListView`'s, the queries are `ObjectGrid`'s — so both are mounted for real.
 * `app-shell` already depends on `plugin-list` and `plugin-grid`, so this adds
 * no dependency edge (the same reason `displayPageSizeFromSpec-9853.test.tsx`
 * lives here). `plugin-list`'s own handoff pin, over a stub grid, is
 * `ListView.groupedGridOwnsFetch-7189.test.tsx`; the grid's own reading of the
 * handed term is `serverGroupedSearch-11021.test.tsx` in `plugin-grid`.
 *
 * ## What the double answers
 *
 * `queryGroupHeaders` and `find` apply ONE matcher to the whole store: the
 * compiled `where` / `$filter`, then `search` / `$search` over `searchFields`
 * / `$searchFields`. The term `#1` matches numbers 1 and 10-19 of each unit:
 * 34 rows, more than the view's page of 20, and none of the Depot's one row.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ListView } from '@object-ui/plugin-list';
// Registers `object-grid`, the renderer `ListView` mounts through the registry.
import '@object-ui/plugin-grid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

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
/** The view's page: fewer rows than the term matches. */
const PAGE_SIZE = 20;

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

type HeaderQuery = { where?: unknown; groupBy?: string[]; search?: unknown; searchFields?: unknown };

/** A data source serving BOTH compiled queries, and the list's own window, with one matcher. */
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

const GROUPING = { fields: [{ field: 'business_unit', order: 'asc', collapsed: false }] };

const listSchema = (grouped: boolean) => ({
  type: 'list-view',
  objectName: OBJECT,
  columns: ['subject'],
  searchableFields: SEARCH_FIELDS,
  pagination: { pageSize: PAGE_SIZE },
  ...(grouped ? { grouping: GROUPING } : {}),
}) as any;

const view = (ds: ServerDataSource, grouped: boolean) => (
  <SchemaRendererProvider dataSource={ds as any}>
    <ActionProvider>
      <ListView schema={listSchema(grouped)} dataSource={ds as any} />
    </ActionProvider>
  </SchemaRendererProvider>
);

const groupRows = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
const headerOf = (el: Element) => ({
  label: el.querySelector('.group-label')?.textContent ?? '',
  count: el.querySelector('.group-count')?.textContent ?? '',
});
const headerCounts = () => Object.fromEntries(groupRows().map((r) => { const h = headerOf(r); return [h.label, Number(h.count)]; }));
const groupRowEl = (label: string) => groupRows().find((r) => headerOf(r).label === label)!;
// objectui#12620 — a grouped grid is ONE table and a group is a band row in
// it: the group's rows are the rows after its band, up to the next band.
const bandRowsOf = (el: Element): HTMLElement[] => {
  const rows: HTMLElement[] = [];
  const band = el.closest('tr[data-testid="data-table-group-band"]');
  if (!band) throw new Error('bandRowsOf: not inside a group band row');
  for (let tr = band.nextElementSibling; tr && tr.getAttribute('data-testid') !== 'data-table-group-band'; tr = tr.nextElementSibling) {
    rows.push(tr as HTMLElement);
  }
  return rows;
};
const subjectsIn = (el: Element, unit: string) =>
  bandRowsOf(el)
    .flatMap((row) => within(row).queryAllByText(new RegExp(`^${unit} #\\d+$`)))
    .map((n) => n.textContent);

/** The grid's row page queries: each one carries a group key under `$and`. */
const groupRowFinds = (ds: ServerDataSource, from = 0) =>
  ds.find.mock.calls.slice(from).map(([, p]) => p).filter((p) => Array.isArray((p.$filter as { $and?: unknown } | undefined)?.$and));

/** Type into the list's toolbar Search box (the popover's input). */
function typeInToolbarSearch(value: string) {
  if (!screen.queryByPlaceholderText(/search/i)) fireEvent.click(screen.getByTestId('search-icon-button'));
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value } });
}

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

afterEach(() => cleanup());

describe('a grouped list view under a toolbar search groups on the server (objectui#11021)', () => {
  it('the fixture: the term matches more rows than the view\'s page', () => {
    const matches = Object.values(SEARCHED).reduce((a, b) => a + b, 0);
    expect(matches).toBeGreaterThan(PAGE_SIZE);
  });

  it('SEARCHED: only the groups holding matches, each counting all its matches, over exactly those rows', async () => {
    const ds = makeServerDataSource();
    render(view(ds, true));
    await waitFor(() => expect(headerCounts()).toEqual(UNSEARCHED));

    typeInToolbarSearch(TERM);

    await waitFor(() => expect(headerCounts()).toEqual(SEARCHED));
    // The Depot's one row does not match, so it is not a group at all.
    expect(groupRows().map((r) => headerOf(r).label)).not.toContain('Riverside Depot');
    // Each group draws the rows its header counted.
    for (const [unit, count] of Object.entries(SEARCHED)) {
      await waitFor(() => expect(subjectsIn(groupRowEl(unit), unit)).toHaveLength(count));
    }

    // One pair on both of the grid's queries.
    const [, headerQuery] = ds.queryGroupHeaders.mock.calls.at(-1)!;
    expect(headerQuery.search).toBe(TERM);
    expect(headerQuery.searchFields).toEqual(SEARCH_FIELDS);
    const rowFinds = groupRowFinds(ds).slice(-Object.keys(SEARCHED).length);
    expect(rowFinds).toHaveLength(Object.keys(SEARCHED).length);
    for (const params of rowFinds) {
      expect(params.$search).toBe(TERM);
      expect(params.$searchFields).toEqual(SEARCH_FIELDS);
    }
  });

  it('UNSEARCHED: the five whole units, and no search key on either of the grid\'s queries', async () => {
    const ds = makeServerDataSource();
    render(view(ds, true));

    await waitFor(() => expect(headerCounts()).toEqual(UNSEARCHED));
    for (const [, query] of ds.queryGroupHeaders.mock.calls) {
      expect(query).not.toHaveProperty('search');
      expect(query).not.toHaveProperty('searchFields');
    }
    await waitFor(() => expect(groupRowFinds(ds).length).toBeGreaterThanOrEqual(UNITS.length));
    for (const params of groupRowFinds(ds)) {
      expect(params).not.toHaveProperty('$search');
      expect(params).not.toHaveProperty('$searchFields');
    }
  });

  it('clearing the toolbar search restores the unsearched groups, and drops the term from both queries', async () => {
    const ds = makeServerDataSource();
    render(view(ds, true));
    typeInToolbarSearch(TERM);
    await waitFor(() => expect(headerCounts()).toEqual(SEARCHED));
    for (const [unit, count] of Object.entries(SEARCHED)) {
      await waitFor(() => expect(subjectsIn(groupRowEl(unit), unit)).toHaveLength(count));
    }

    const findsBefore = ds.find.mock.calls.length;
    typeInToolbarSearch('');

    await waitFor(() => expect(headerCounts()).toEqual(UNSEARCHED));
    const [, lastHeaderQuery] = ds.queryGroupHeaders.mock.calls.at(-1)!;
    expect(lastHeaderQuery).not.toHaveProperty('search');
    expect(lastHeaderQuery).not.toHaveProperty('searchFields');
    // Every unit's latest row page is asked without the term.
    await waitFor(() => expect(subjectsIn(groupRowEl('Riverside Depot'), 'Riverside Depot')).toHaveLength(1));
    for (const [unit] of UNITS) {
      const pages = groupRowFinds(ds, findsBefore).filter((p) =>
        JSON.stringify((p.$filter as { $and: unknown[] }).$and).includes(JSON.stringify({ business_unit: { $eq: unit } })));
      expect(pages.length).toBeGreaterThan(0);
      expect(pages.at(-1)).not.toHaveProperty('$search');
      expect(pages.at(-1)).not.toHaveProperty('$searchFields');
    }
  });

  it('turning grouping back on after the term was cleared asks and paints no stale searched groups', async () => {
    const ds = makeServerDataSource();
    const { rerender } = render(view(ds, true));
    typeInToolbarSearch(TERM);
    await waitFor(() => expect(headerCounts()).toEqual(SEARCHED));

    // Grouping off: a flat list. The term is cleared while nothing is grouped.
    rerender(view(ds, false));
    await waitFor(() => expect(groupRows()).toHaveLength(0));
    typeInToolbarSearch('');
    await waitFor(() => expect(ds.find.mock.calls.at(-1)?.[1]).not.toHaveProperty('$search'));

    // Grouping back on.
    const headerCallsBefore = ds.queryGroupHeaders.mock.calls.length;
    const recorder = recordPaintedHeaders();
    rerender(view(ds, true));
    await waitFor(() => expect(headerCounts()).toEqual(UNSEARCHED));
    recorder.stop();

    // No header query after the re-entry carries the cleared term…
    const reentryHeaderQueries = ds.queryGroupHeaders.mock.calls.slice(headerCallsBefore).map(([, q]) => q);
    expect(reentryHeaderQueries.length).toBeGreaterThan(0);
    for (const query of reentryHeaderQueries) {
      expect(query).not.toHaveProperty('search');
    }
    // …and no searched group set is painted on the way to the unsearched one.
    expect(recorder.painted.length).toBeGreaterThan(0);
    for (const counts of recorder.painted) {
      expect(counts).not.toEqual(SEARCHED);
    }
  });
});
