/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11880 item 5 — the filter `ObjectView` hands the `ObjectGrid` it draws,
 * read through the REAL grid and an adapter that APPLIES the `$filter` it receives.
 *
 * The node this component builds for its own grid carries the whole authored
 * filter chain in ONE slot, `filter`: an active view's filter, else `table.filter`
 * unless it lowers to nothing, else the deprecated `table.defaultFilters`. Before
 * this card the chain was split across two slots (the view's filter and
 * `table.defaultFilters` in `defaultFilters`, `table.filter` in `filter`), and
 * `ObjectGrid` read `defaultFilters` only when `filter` lowered to nothing.
 *
 * Every reading here is of what the grid SENDS and what it DRAWS:
 *
 *   - the rung order, which the move to one slot does not change (each rung and
 *     each pair reads the same `$filter` and rows as on the two-slot hand-off);
 *   - the three readers inside `ObjectGrid` that look at `filter` and not at
 *     `defaultFilters`: the server-streamed export and the page reset, whose
 *     answers this card CORRECTS (a filter riding `defaultFilters` narrowed the
 *     rows but not the downloaded file, and changing it in place kept the old
 *     page), and the refused-filter state, which it keeps.
 *
 * The corrected rows were lit by their before-readings: on the two-slot hand-off
 * (the objectui#11880 PR records the ablation) the export was handed no filter
 * and the next query kept a page index above 0, while every rung row stayed
 * green.
 *
 * ⚠️ objectui#12030 retired the third rung. `@objectstack/spec` 18 tombstones
 * `object-grid.defaultFilters` (objectstack#11509), refusing it by name, and
 * `ObjectView` no longer reads `table.defaultFilters`. The rows that pinned it
 * as a rung now pin it as inert: alone it sends no `$filter` and draws every
 * row, and beside a live rung it changes nothing. The page-reset row for it is
 * gone with it: a key nothing reads cannot move the page.
 */

import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { ValueDataSource } from '@object-ui/core';
import type { DataSource, ObjectViewSchema } from '@object-ui/types';
import { ObjectView } from '../ObjectView';
import { installExplainDouble } from './explainDouble';

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const OBJECT = 'handoff_deal';

const ROWS = [
  { id: '1', name: 'Acme', stage: 'open' },
  { id: '2', name: 'Beta', stage: 'won' },
  { id: '3', name: 'Cyan', stage: 'lost' },
  { id: '4', name: 'Dune', stage: 'open' },
];
const NAMES = ROWS.map((r) => r.name);

type Rule = { field: string; operator: string; value: unknown };
/** One rule per rung, each matching a different set, so the winner is readable. */
const VIEW: Rule[] = [{ field: 'stage', operator: 'equals', value: 'open' }]; // Acme, Dune
const TABLE: Rule[] = [{ field: 'stage', operator: 'equals', value: 'won' }]; // Beta
const DEFAULTS: Rule[] = [{ field: 'stage', operator: 'equals', value: 'lost' }]; // Cyan, were it read

const VIEW_AST = [['stage', 'equals', 'open']];
const TABLE_AST = [['stage', 'equals', 'won']];

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});

beforeEach(() => {
  installExplainDouble();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Adapter {
  find: ReturnType<typeof vi.fn>;
  exportDownload: ReturnType<typeof vi.fn>;
  getObjectSchema: ReturnType<typeof vi.fn>;
}

/** `find` answers through a `ValueDataSource`, so `$filter` and paging are applied. */
function makeAdapter(rows: Array<Record<string, unknown>> = ROWS): Adapter & DataSource {
  const source = new ValueDataSource({ items: rows, idField: 'id' });
  return {
    find: vi.fn((resource: string, params: Record<string, unknown>) => source.find(resource, params as never)),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    exportDownload: vi.fn(async () => new Blob(['x'])),
    getObjectSchema: vi.fn(async () => ({
      name: OBJECT,
      label: 'Deal',
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'text', label: 'Stage' },
      },
    })),
  } as unknown as Adapter & DataSource;
}

interface Authored {
  view?: unknown;
  table?: unknown;
  tableDefaults?: unknown;
}

/** An `object-view` carrying the authored rungs given, every other member fixed. */
function viewSchema({ view, table, tableDefaults }: Authored, extraTable: Record<string, unknown> = {}): ObjectViewSchema {
  const t: Record<string, unknown> = { columns: ['name'], exportOptions: { formats: ['csv'] }, ...extraTable };
  if (table !== undefined) t.filter = table;
  if (tableDefaults !== undefined) t.defaultFilters = tableDefaults;
  const named = view !== undefined
    ? { defaultListView: 'v1', listViews: { v1: { label: 'Deals', type: 'grid', columns: ['name'], filter: view } } }
    : {};
  return {
    type: 'object-view',
    objectName: OBJECT,
    layout: 'drawer',
    table: t,
    ...named,
  } as unknown as ObjectViewSchema;
}

function mount(schema: ObjectViewSchema, ds: DataSource) {
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

function objectFinds(ds: Adapter) {
  return ds.find.mock.calls.filter(([resource]) => resource === OBJECT) as Array<[string, Record<string, unknown>]>;
}

/** Render; return the `$filter` the grid's first query sent and the names it drew. */
async function draw(authored: Authored): Promise<{ $filter: unknown; drawn: string[] }> {
  const ds = makeAdapter();
  mount(viewSchema(authored), ds);
  await waitFor(() => expect(objectFinds(ds).length).toBeGreaterThan(0));
  const index = ds.find.mock.calls.findIndex(([resource]) => resource === OBJECT);
  const params = objectFinds(ds)[0][1];
  const answer = (await ds.find.mock.results[index].value) as { data: Array<{ name: string }> };
  const expected = answer.data.map((r) => r.name);
  if (expected.length > 0) await screen.findByText(expected[0]);
  const drawn = NAMES.filter((name) => screen.queryByText(name) !== null);
  return { $filter: params.$filter, drawn };
}

/** Render, open the export menu, export CSV; return the `filter` the server export was handed. */
async function exported(authored: Authored): Promise<{ called: boolean; filter: unknown; fetched: unknown }> {
  // Only the download hand-off is stubbed: the request the export makes is
  // what is read, never the file.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:handoff');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);
  const ds = makeAdapter();
  mount(viewSchema(authored), ds);
  await waitFor(() => expect(objectFinds(ds).length).toBeGreaterThan(0));
  const fetched = objectFinds(ds)[0][1].$filter;
  fireEvent.click(await screen.findByRole('button', { name: /export/i }));
  fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
  await waitFor(() => expect(ds.exportDownload).toHaveBeenCalled());
  const options = (ds.exportDownload.mock.calls[0] as [string, { filter?: unknown }])[1];
  return { called: true, filter: options.filter, fetched };
}

describe('objectui#11880 item 5 — the rung order through the real grid', () => {
  it('CONTROL: no rung sends no `$filter` and draws every row', async () => {
    const r = await draw({});
    expect(r.$filter).toBeUndefined();
    expect(r.drawn).toEqual(['Acme', 'Beta', 'Cyan', 'Dune']);
  });

  it('rung 1 alone: a named view filter', async () => {
    expect(await draw({ view: VIEW })).toEqual({ $filter: VIEW_AST, drawn: ['Acme', 'Dune'] });
  });

  it('rung 2 alone: `table.filter`', async () => {
    expect(await draw({ table: TABLE })).toEqual({ $filter: TABLE_AST, drawn: ['Beta'] });
  });

  it('the retired `table.defaultFilters` alone is not a rung: no `$filter`, every row (objectui#12030)', async () => {
    expect(await draw({ tableDefaults: DEFAULTS }))
      .toEqual({ $filter: undefined, drawn: ['Acme', 'Beta', 'Cyan', 'Dune'] });
  });

  it('rungs 1 + 2: the view wins over `table.filter`', async () => {
    expect(await draw({ view: VIEW, table: TABLE })).toEqual({ $filter: VIEW_AST, drawn: ['Acme', 'Dune'] });
  });

  it('the view answers beside a retired `table.defaultFilters`', async () => {
    expect(await draw({ view: VIEW, tableDefaults: DEFAULTS })).toEqual({ $filter: VIEW_AST, drawn: ['Acme', 'Dune'] });
  });

  it('`table.filter` answers beside a retired `table.defaultFilters`', async () => {
    expect(await draw({ table: TABLE, tableDefaults: DEFAULTS })).toEqual({ $filter: TABLE_AST, drawn: ['Beta'] });
  });

  it('rungs 1 + 2, with a retired `table.defaultFilters` beside them: the view wins', async () => {
    expect(await draw({ view: VIEW, table: TABLE, tableDefaults: DEFAULTS }))
      .toEqual({ $filter: VIEW_AST, drawn: ['Acme', 'Dune'] });
  });

  it('an EMPTY named-view filter is still the view rung: no `$filter`, every row', async () => {
    expect(await draw({ view: [], table: TABLE, tableDefaults: DEFAULTS }))
      .toEqual({ $filter: undefined, drawn: ['Acme', 'Beta', 'Cyan', 'Dune'] });
  });

  it('an EMPTY `table.filter` lowers to nothing, and a retired `table.defaultFilters` does not answer for it', async () => {
    expect(await draw({ table: [], tableDefaults: DEFAULTS }))
      .toEqual({ $filter: undefined, drawn: ['Acme', 'Beta', 'Cyan', 'Dune'] });
  });
});

describe('objectui#11880 item 5 — the server-streamed export', () => {
  it('a named view filter reaches the export, as it reaches the rows', async () => {
    const r = await exported({ view: VIEW });
    expect(r.fetched).toEqual(VIEW_AST);
    expect(r.filter).toEqual(VIEW_AST);
  });

  it('a retired `table.defaultFilters` reaches neither the rows nor the export (objectui#12030)', async () => {
    const r = await exported({ tableDefaults: DEFAULTS });
    expect(r.fetched).toBeUndefined();
    expect(r.filter).toBeUndefined();
  });

  it('CONTROL: `table.filter` reaches the export, as before', async () => {
    const r = await exported({ table: TABLE });
    expect(r.fetched).toEqual(TABLE_AST);
    expect(r.filter).toEqual(TABLE_AST);
  });
});

describe('objectui#11880 item 5 — the page reset when the filter changes in place', () => {
  const MANY = Array.from({ length: 8 }, (_, i) => ({
    id: String(i + 1),
    name: `Row ${i + 1}`,
    stage: i % 2 === 0 ? 'open' : 'won',
    region: i < 4 ? 'east' : 'west',
  }));
  const EAST: Rule[] = [{ field: 'region', operator: 'equals', value: 'east' }];
  const WEST: Rule[] = [{ field: 'region', operator: 'equals', value: 'west' }];

  async function skipAfterChange(before: Authored, after: Authored): Promise<unknown> {
    const ds = makeAdapter(MANY);
    const page = { pagination: { pageSize: 2 } };
    const { container, rerender } = mount(viewSchema(before, page), ds);
    await waitFor(() => expect(objectFinds(ds).length).toBeGreaterThan(0));
    await screen.findAllByText(/^Row /);
    const last = container.querySelector('.lucide-chevrons-right')?.closest('button');
    expect(last).toBeTruthy();
    fireEvent.click(last as HTMLButtonElement);
    await waitFor(() => expect((objectFinds(ds).at(-1)?.[1].$skip as number) ?? 0).toBeGreaterThan(0));
    const settled = objectFinds(ds).length;
    rerender(
      <ActionProvider>
        <SchemaRendererProvider dataSource={ds}>
          <ObjectView schema={viewSchema(after, page)} dataSource={ds} />
        </SchemaRendererProvider>
      </ActionProvider>,
    );
    await waitFor(() => expect(objectFinds(ds).length).toBeGreaterThan(settled));
    await new Promise((r) => setTimeout(r, 50));
    return objectFinds(ds).at(-1)?.[1].$skip ?? 0;
  }

  it('a named view filter changed in place returns to page 1', async () => {
    expect(await skipAfterChange({ view: EAST }, { view: WEST })).toBe(0);
  });

  it('CONTROL: `table.filter` changed in place returns to page 1, as before', async () => {
    expect(await skipAfterChange({ table: EAST }, { table: WEST })).toBe(0);
  });
});

describe('objectui#11880 item 5 — a refused filter still draws its panel', () => {
  it('a refused named-view filter names the operator and queries nothing', async () => {
    const ds = makeAdapter();
    mount(viewSchema({ view: [{ field: 'stage', operator: 'equals', value: ['a', 'b'] }] }), ds);
    const headline = await screen.findByTestId('grid-malformed-filter-subject');
    expect(headline.textContent).toContain('equals');
    await new Promise((r) => setTimeout(r, 50));
    expect(objectFinds(ds)).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/error loading grid/i);
  });

  it('a refused `table.filter` is kept, with a retired `table.defaultFilters` beside it', async () => {
    const ds = makeAdapter();
    mount(viewSchema({ table: [{ field: 'stage', operator: 'equals', value: ['a', 'b'] }], tableDefaults: DEFAULTS }), ds);
    const headline = await screen.findByTestId('grid-malformed-filter-subject');
    expect(headline.textContent).toContain('equals');
    await new Promise((r) => setTimeout(r, 50));
    expect(objectFinds(ds)).toHaveLength(0);
  });
});
