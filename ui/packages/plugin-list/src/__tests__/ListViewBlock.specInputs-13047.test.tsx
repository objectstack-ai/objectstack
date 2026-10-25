/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13047 — `list-view` publishes the keys of its `@objectstack/spec`
 * `ComponentPropsMap` row that the renderer honours, and this file is the
 * measurement each publication rests on.
 *
 * The rule the card was ruled under (objectui#11111 decision 3 = B): publish
 * what the renderer honours, leave out what it does not, and never publish a
 * key no renderer reads. A source read alone cannot settle "honours":
 * `SchemaRenderer` hoists the `properties` bag onto the node, `ListViewBlock`
 * rewrites the page spelling and runs the `ElementDataSourceGate`, and only
 * then does `ListView` see the node. So every key is authored here the way the
 * spec authors it, in the node's `properties` bag, rendered through the REAL
 * `SchemaRenderer` and this package's own `list-view` registration, and
 * asserted at what it does: the DOM the list draws, the query the adapter
 * receives, or the node `ListView` builds for the view it draws. Every row has
 * a control beside it that differs only by that key, so a key the list ignored
 * would read the same twice and fail.
 *
 * The child views are stand-ins that record the node `ListView` hands them —
 * the device every other test in this package uses, because `plugin-grid`,
 * `plugin-kanban` and the other view packages are not dependencies of this
 * one. For the keys that act on the view's node (the grid's row keys, each
 * kind's own block) the measurement is therefore the hand-off: the member
 * reaches the node of the view that draws it, on the page path. What each
 * child view then draws from its own node is pinned in that view's package.
 *
 * Every fixture is first parsed by the spec's own `list-view` row, so a key
 * measured here is measured in a shape the platform accepts.
 *
 * The last describe block is the keys measured NOT honoured on a page node,
 * each held out of `inputs` with its reason in the console's repo-wide parity
 * gate: `name` (read by nothing here), `sharing` (draws a button that does
 * nothing on a page node), and `filterableFields` (read as the Filter panel's
 * field list, not as the quick-filter shorthand the row declared it to be,
 * until objectui#13118 removed that reader with the spec's retirement of the
 * key; it is read as nothing now, and since the pin at `@objectstack/spec`
 * 18.0.0 the row refuses it by name, objectui#13261). `requiredPermissions` was measured
 * here too, until objectui#13074 honoured it on a page node; its pins now live
 * in `ListViewBlock.inertKeys-13074.test.tsx`, beside the `addRecord` routing
 * rows under a provider that serves `onCreate`. `addRecord` was held out too,
 * until objectui#13089 had the console's page host serve that `onCreate`; the
 * row below stays as the block's half: no host create, no button. One MEMBER is
 * recorded the same way beside the key that carries it:
 * `appearance.allowedVisualizations` narrows a view switcher a page node does
 * not draw, while `appearance.showDescription` acts.
 *
 * The rows double as the member pins the console's repo-wide parity gate
 * registers for this block's array/object-armed inputs (`list-view.data`,
 * `list-view.columns`, `list-view.filter`, `list-view.sort`,
 * `list-view.options`, and every structured key published here).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor, cleanup, act, fireEvent, screen, within } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider, RelatedRecordActionsProvider } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { ComponentPropsMap } from '@objectstack/spec/ui';
// Registers the REAL `list-view` (and the `object-gallery` this file replaces below).
import '../index';

const OBJECT = 'crm_task';

type Row = Record<string, unknown>;

const ROWS: Row[] = [
  { id: 't-1', name: 'Draft the brief', stage: 'todo', amount: 5, owner: 'ada', due: '2026-10-20', finish: '2026-10-22', parent: null, location: 'Room 4' },
  { id: 't-2', name: 'Ship the fold', stage: 'doing', amount: 7, owner: 'bo', due: '2026-10-21', finish: '2026-10-25', parent: 't-1', location: 'Zoom' },
];

const OBJECT_DEF = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    stage: {
      name: 'stage',
      type: 'select',
      label: 'Stage',
      options: [
        { label: 'To do', value: 'todo' },
        { label: 'Doing', value: 'doing' },
      ],
    },
    amount: { name: 'amount', type: 'number', label: 'Amount' },
    owner: { name: 'owner', type: 'text', label: 'Owner' },
    due: { name: 'due', type: 'date', label: 'Due' },
    finish: { name: 'finish', type: 'date', label: 'Finish' },
    parent: { name: 'parent', type: 'lookup', label: 'Parent', reference_to: OBJECT },
    location: { name: 'location', type: 'text', label: 'Location' },
  },
};

/** The node `ListView` built for each child view, in render order. */
const handed: Record<string, Row[]> = {};
/** The rows `ListView` handed each child view beside its node, in render order. */
const handedRows: Record<string, unknown[]> = {};
const CHILD_VIEWS = [
  'object-grid',
  'object-kanban',
  'object-calendar',
  'object-gallery',
  'object-timeline',
  'object-gantt',
  'object-map',
  'object-tree',
  'object-chart',
] as const;
type ChildView = (typeof CHILD_VIEWS)[number];

for (const type of CHILD_VIEWS) {
  ComponentRegistry.register(
    type,
    (props: { schema: Row; data?: unknown }) => {
      (handed[type] ??= []).push(props.schema);
      (handedRows[type] ??= []).push(props.data);
      return <div data-testid={`${type}-standin`} />;
    },
    { namespace: 'test', label: `${type} stand-in`, category: 'view' },
  );
}

const lastHanded = (type: ChildView): Row => {
  const nodes = handed[type] ?? [];
  return nodes[nodes.length - 1];
};

function makeDataSource(rows: Row[] = ROWS, extra: Row = {}) {
  return {
    ...extra,
    find: vi.fn(async (_object: string, _params?: Row) => ({ data: rows, total: rows.length })),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  };
}
type Adapter = ReturnType<typeof makeDataSource>;

/** The `properties` every node carries: the object, and three columns. */
const BASE: Row = {
  data: { provider: 'object', object: OBJECT },
  columns: ['name', 'stage', 'amount'],
};

/**
 * A page `list-view` node in the spec's `{ type, properties }` form. The
 * properties are first parsed by the spec's own `list-view` row, so every
 * fixture is one the platform's save gate accepts.
 */
function node(properties: Row = {}): Row {
  const bag = { ...BASE, ...properties };
  const parsed = (ComponentPropsMap as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }>)[
    'list-view'
  ].safeParse(bag);
  if (!parsed.success) {
    throw new Error(`fixture refused by the spec's list-view row: ${JSON.stringify(parsed.error)}`);
  }
  return { type: 'list-view', properties: bag };
}

function mount(properties: Row = {}, rows: Row[] = ROWS, locale?: string, adapterExtra: Row = {}) {
  const dataSource = makeDataSource(rows, adapterExtra);
  const tree = (
    <SchemaRendererProvider dataSource={dataSource as never}>
      <SchemaRenderer schema={node(properties) as never} />
    </SchemaRendererProvider>
  );
  // `LocalizationProvider` pins the display locale, the first limb of
  // `useDisplayLocale()` — the channel this package's other locale pins use.
  const view = render(locale ? <LocalizationProvider value={{ locale }}>{tree}</LocalizationProvider> : tree);
  return { dataSource, ...view };
}

/** The query params of the first `find` the list sent. */
async function firstQuery(dataSource: Adapter): Promise<Row> {
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  expect(dataSource.find.mock.calls[0][0]).toBe(OBJECT);
  return (dataSource.find.mock.calls[0][1] ?? {}) as Row;
}

/** Waits until `ListView` has handed a node to this child view. */
async function handedTo(type: ChildView): Promise<Row> {
  await waitFor(() => expect((handed[type] ?? []).length).toBeGreaterThan(0));
  return lastHanded(type);
}

/** Waits for the object definition, so an absence below is not an unfinished load. */
async function loaded(dataSource: Adapter): Promise<void> {
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const resetHanded = () => {
  for (const type of CHILD_VIEWS) {
    handed[type] = [];
    handedRows[type] = [];
  }
};

beforeEach(resetHanded);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectui#13047 — every `list-view` fixture here is one the spec row accepts', () => {
  it('CONTROL: the row refuses a key it does not declare, so the guard in `node()` can fail', () => {
    expect(() => node({ groupField: 'stage' })).toThrow(/refused by the spec/);
  });
});

describe('objectui#13047 — the toolbar and chrome keys, drawn by `ListView` itself', () => {
  it('`description`: a string draws the info control with that text; absent draws none', async () => {
    const control = mount();
    await loaded(control.dataSource);
    expect(screen.queryByTestId('view-description-info')).toBeNull();
    cleanup();

    const { dataSource } = mount({ description: 'Open work only' });
    await loaded(dataSource);
    expect(screen.getByTestId('view-description-info').getAttribute('aria-label')).toBe('Open work only');
  });

  it('`description`: an inline locale map resolves against the UI language', async () => {
    const { dataSource } = mount({ description: { en: 'Open work only', 'zh-CN': '仅未完成' } }, ROWS, 'zh-CN');
    await loaded(dataSource);
    expect(screen.getByTestId('view-description-info').getAttribute('aria-label')).toBe('仅未完成');
  });

  it('`appearance.showDescription: false` hides the description the same node declares', async () => {
    const { dataSource } = mount({ description: 'Open work only', appearance: { showDescription: false } });
    await loaded(dataSource);
    expect(screen.queryByTestId('view-description-info')).toBeNull();
  });

  it('`appearance.allowedVisualizations` changes nothing on a page node: the authored kind still draws, and no switcher is drawn to narrow', async () => {
    // The whitelist narrows the kinds the view SWITCHER offers, and a page
    // node draws no switcher (it is a host prop, `showViewSwitcher`, not a
    // key of the row). So this member is inert here; `showDescription` above
    // is the member that acts. Recorded, not hidden.
    const { dataSource } = mount({
      type: 'kanban',
      kanban: { groupByField: 'owner', columns: ['name'] },
      appearance: { allowedVisualizations: ['grid'] },
    });
    await handedTo('object-kanban');
    await loaded(dataSource);
    expect(handed['object-grid']).toHaveLength(0);
  });

  it('`userActions`: `sort: false` takes the Sort control off the toolbar; absent keeps it', async () => {
    const control = mount();
    await loaded(control.dataSource);
    expect(screen.queryByTestId('toolbar-sort-trigger')).not.toBeNull();
    cleanup();

    const { dataSource } = mount({ userActions: { sort: false } });
    await loaded(dataSource);
    expect(screen.queryByTestId('toolbar-sort-trigger')).toBeNull();
    // Only the member it names: Filter stays.
    expect(screen.queryByTestId('toolbar-filter-trigger')).not.toBeNull();
  });

  it('`compactToolbar: false` puts the inline-edit toggle back on the toolbar; the default keeps it in the Display form', async () => {
    const control = mount({ inlineEdit: false });
    await loaded(control.dataSource);
    const compactButtons = control.container.querySelectorAll('[data-print-hide] button').length;
    cleanup();

    const { dataSource, container } = mount({ inlineEdit: false, compactToolbar: false });
    await loaded(dataSource);
    expect(container.querySelectorAll('[data-print-hide] button').length).toBeGreaterThan(compactButtons);
  });

  it('`allowPrinting: true` draws the Print button; absent draws none', async () => {
    const control = mount();
    await loaded(control.dataSource);
    expect(screen.queryByTestId('print-button')).toBeNull();
    cleanup();

    const { dataSource } = mount({ allowPrinting: true });
    await loaded(dataSource);
    expect(screen.getByTestId('print-button')).toBeTruthy();
  });

  it('`showRecordCount: false` takes the record count off the footer; absent shows it', async () => {
    const control = mount();
    await loaded(control.dataSource);
    await waitFor(() => expect(screen.queryByTestId('record-count-bar')).not.toBeNull());
    cleanup();

    const { dataSource } = mount({ showRecordCount: false });
    await loaded(dataSource);
    expect(screen.queryByTestId('record-count-bar')).toBeNull();
  });

  it('`emptyState`: `title` and `message` replace the default empty copy when no record comes back', async () => {
    const control = mount({}, []);
    await loaded(control.dataSource);
    expect(control.container.textContent ?? '').not.toContain('Nothing planned');
    cleanup();

    const { dataSource, container } = mount({ emptyState: { title: 'Nothing planned', message: 'Add the first task' } }, []);
    await loaded(dataSource);
    await waitFor(() => expect(container.textContent ?? '').toContain('Nothing planned'));
    expect(container.textContent ?? '').toContain('Add the first task');
  });

  it('`userFilters`: a dropdown over `stage` draws the quick-filter bar; absent draws none', async () => {
    const control = mount();
    await loaded(control.dataSource);
    expect(screen.queryByTestId('user-filters')).toBeNull();
    cleanup();

    const { dataSource } = mount({ userFilters: { element: 'dropdown', fields: [{ field: 'stage' }] } });
    await loaded(dataSource);
    const bar = await screen.findByTestId('user-filters');
    expect(bar.textContent ?? '').toContain('Stage');
  });

  it('`exportOptions`: `{ formats: [\'csv\'] }` offers the export, and `fileNamePrefix` names the file; absent offers none', async () => {
    const control = mount({ compactToolbar: false });
    await loaded(control.dataSource);
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
    cleanup();

    const downloads: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const { dataSource } = mount({ compactToolbar: false, exportOptions: { formats: ['csv'], fileNamePrefix: 'tasks_export' } });
    await loaded(dataSource);
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
    await waitFor(() => expect(downloads.length).toBeGreaterThan(0));
    expect(downloads[0]).toContain('tasks_export');
    expect(downloads[0]).toMatch(/\.csv$/);
  });

  it('`label`: names the exported file, a string as written and a locale map resolved against the UI language', async () => {
    const downloads: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const exportCsv = async () => {
      fireEvent.click(screen.getByRole('button', { name: /export/i }));
      fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
      await waitFor(() => expect(downloads.length).toBeGreaterThan(0));
      return downloads.splice(0).pop() ?? '';
    };
    const exporting = { compactToolbar: false, exportOptions: { formats: ['csv'] } };

    const control = mount(exporting);
    await loaded(control.dataSource);
    expect(await exportCsv()).not.toContain('Quarterly');
    cleanup();

    const plain = mount({ ...exporting, label: 'Quarterly Review' });
    await loaded(plain.dataSource);
    expect(await exportCsv()).toContain('Quarterly');
    cleanup();

    const map = mount({ ...exporting, label: { en: 'Quarterly Review', 'zh-CN': '季度回顾' } }, ROWS, 'zh-CN');
    await loaded(map.dataSource);
    const name = await exportCsv();
    expect(name).toContain('季度回顾');
    expect(name).not.toContain('object');
  });

  it('`pagination.pageSize` caps the query; absent sends the default page', async () => {
    const control = mount();
    const controlTop = (await firstQuery(control.dataSource)).$top;
    expect(controlTop).not.toBe(7);
    cleanup();

    const { dataSource } = mount({ pagination: { pageSize: 7 } });
    expect((await firstQuery(dataSource)).$top).toBe(7);
  });

  it('`searchableFields`: a typed term is searched over the listed fields only', async () => {
    const control = mount();
    await loaded(control.dataSource);
    fireEvent.click(screen.getByTestId('search-icon-button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Dune' } });
    await waitFor(() =>
      expect(control.dataSource.find.mock.calls.some((call) => (call[1] as Row | undefined)?.$search === 'Dune')).toBe(true),
    );
    const controlSearch = control.dataSource.find.mock.calls.find((call) => (call[1] as Row | undefined)?.$search === 'Dune')?.[1] as Row;
    expect(controlSearch.$searchFields).toBeUndefined();
    cleanup();

    const { dataSource } = mount({ searchableFields: ['name', 'owner'] });
    await loaded(dataSource);
    fireEvent.click(screen.getByTestId('search-icon-button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Dune' } });
    await waitFor(() =>
      expect(dataSource.find.mock.calls.some((call) => (call[1] as Row | undefined)?.$search === 'Dune')).toBe(true),
    );
    const searched = dataSource.find.mock.calls.find((call) => (call[1] as Row | undefined)?.$search === 'Dune')?.[1] as Row;
    expect(searched.$searchFields).toEqual(['name', 'owner']);
  });

});

describe('objectui#13047 — the record-source and query keys (the member pins the bump booked)', () => {
  it('`data`: an `object` provider lists that object; a `value` provider hands its `items` to the view and queries nothing', async () => {
    const { dataSource } = mount();
    await firstQuery(dataSource);
    await waitFor(() => expect(JSON.stringify(handedRows['object-grid'])).toContain('Draft the brief'));
    cleanup();

    const inline = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={inline as never}>
        <SchemaRenderer
          schema={{
            type: 'list-view',
            properties: { data: { provider: 'value', items: [{ id: 'v-1', name: 'Inline row' }] }, columns: ['name'] },
          } as never}
        />
      </SchemaRendererProvider>,
    );
    await handedTo('object-grid');
    await waitFor(() => expect(JSON.stringify(handedRows['object-grid'])).toContain('Inline row'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(inline.find).not.toHaveBeenCalled();
  });

  it('`columns`: field names project the query in authored order, and the grid draws them in that order', async () => {
    const { dataSource } = mount({ columns: ['owner', 'name'] });
    const query = await firstQuery(dataSource);
    expect(query.$select).toEqual(expect.arrayContaining(['owner', 'name']));
    expect(query.$select).not.toContain('amount');
    const grid = await handedTo('object-grid');
    const names = (grid.columns as Array<string | { field?: string; name?: string }>).map((c) =>
      typeof c === 'string' ? c : (c.field ?? c.name),
    );
    expect(names).toEqual(['owner', 'name']);
  });

  it('`filter`: `ViewFilterRule` members reach `$filter` as `[field, operator, value]` triples; absent sends none', async () => {
    const control = mount();
    expect((await firstQuery(control.dataSource)).$filter).toBeUndefined();
    cleanup();

    const { dataSource } = mount({ filter: [{ field: 'stage', operator: 'equals', value: 'todo' }] });
    const filter = (await firstQuery(dataSource)).$filter;
    expect(JSON.stringify(filter)).toContain('"stage"');
    expect(JSON.stringify(filter)).toContain('"todo"');
  });

  it('`sort`: `{ field, order }` members reach `$orderby` in authored order', async () => {
    const { dataSource } = mount({ sort: [{ field: 'amount', order: 'desc' }, { field: 'name', order: 'asc' }] });
    const orderby = (await firstQuery(dataSource)).$orderby as Array<{ field: string; order: string }>;
    expect(orderby.map((s) => `${s.field} ${s.order}`)).toEqual(['amount desc', 'name asc']);
  });

  it('`options`: the per-kind bag binds the kind it names — `options.kanban.groupByField` lanes the board on a field the list would not pick', async () => {
    // CONTROL first: the bare kanban node lanes on a field the list derives
    // itself (the fixture's select field), so the authored `owner` below can
    // only come from the bag.
    const control = mount({ type: 'kanban' });
    await loaded(control.dataSource);
    const derived = lastHanded('object-kanban')?.groupBy;
    expect(derived).not.toBe('owner');
    cleanup();
    resetHanded();

    const { dataSource } = mount({ type: 'kanban', options: { kanban: { groupByField: 'owner', columns: ['name'] } } });
    const board = await handedTo('object-kanban');
    await loaded(dataSource);
    expect(board.type).toBe('object-kanban');
    expect(lastHanded('object-kanban').groupBy).toBe('owner');
    expect(lastHanded('object-kanban').cardFields).toEqual(['name']);
  });
});

describe('objectui#13047 — the grid keys, handed to the `object-grid` node `ListView` builds', () => {
  async function gridFor(properties: Row): Promise<Row> {
    const { dataSource } = mount(properties);
    await handedTo('object-grid');
    await loaded(dataSource);
    return lastHanded('object-grid');
  }
  async function controlGrid(): Promise<Row> {
    const grid = await gridFor({});
    cleanup();
    resetHanded();
    return grid;
  }

  it('`resizable: false` reaches the grid; absent leaves the grid its own default', async () => {
    expect((await controlGrid()).resizable).toBeUndefined();
    expect((await gridFor({ resizable: false })).resizable).toBe(false);
  });

  it('`selection.type` reaches the grid', async () => {
    expect((await controlGrid()).selection).toBeUndefined();
    expect((await gridFor({ selection: { type: 'single' } })).selection).toEqual({ type: 'single' });
  });

  it('`rowHeight` sets the grid\'s density', async () => {
    const control = (await controlGrid()).rowHeight;
    const tall = (await gridFor({ rowHeight: 'tall' })).rowHeight;
    expect(tall).not.toBe(control);
    expect(tall).toBe('tall');
  });

  it('`grouping.fields` groups the grid by the named field, over an adapter that answers the group header query', async () => {
    expect((await controlGrid()).grouping).toBeUndefined();
    const { dataSource } = mount({ grouping: { fields: [{ field: 'stage', order: 'asc' }] } }, ROWS, undefined, {
      queryGroupHeaders: vi.fn(async () => []),
    });
    await handedTo('object-grid');
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
    const grouping = lastHanded('object-grid').grouping as { fields: Array<{ field: string }> };
    expect(grouping.fields.map((f) => f.field)).toEqual(['stage']);
  });

  it('`grouping.fields` over an adapter that cannot answer the group header query refuses instead of grouping one page', async () => {
    const { dataSource } = mount({ grouping: { fields: [{ field: 'stage', order: 'asc' }] } });
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
    await screen.findByTestId('list-grouping-needs-header-query');
    expect(handed['object-grid']).toHaveLength(0);
  });

  it('`rowColor.field` colours the grid\'s rows by that field', async () => {
    expect((await controlGrid()).rowColor).toBeUndefined();
    const rowColor = (await gridFor({ rowColor: { field: 'stage', colors: { todo: '#ff0000' } } })).rowColor as Row;
    expect(rowColor.field).toBe('stage');
    expect(rowColor.colors).toEqual({ todo: '#ff0000' });
  });

  it('`hiddenFields`: a member subtracts that column from the grid; a name no column projects subtracts nothing', async () => {
    const names = (grid: Row) =>
      (grid.columns as Array<string | { field?: string; name?: string }>).map((c) => (typeof c === 'string' ? c : (c.field ?? c.name)));
    expect(names(await controlGrid())).toEqual(['name', 'stage', 'amount']);
    expect(names(await gridFor({ hiddenFields: ['stage', 'owner'] }))).toEqual(['name', 'amount']);
  });

  it('`fieldOrder`: members order the surviving columns, and an unlisted column sorts last', async () => {
    const names = (grid: Row) =>
      (grid.columns as Array<string | { field?: string; name?: string }>).map((c) => (typeof c === 'string' ? c : (c.field ?? c.name)));
    expect(names(await controlGrid())).toEqual(['name', 'stage', 'amount']);
    expect(names(await gridFor({ fieldOrder: ['amount', 'name'] }))).toEqual(['amount', 'name', 'stage']);
  });

  it('`rowActions`: the action names reach the grid\'s row menu', async () => {
    expect((await controlGrid()).rowActions).toBeUndefined();
    expect((await gridFor({ rowActions: ['complete_task', 'reassign'] })).rowActions).toEqual(['complete_task', 'reassign']);
  });

  it('`bulkActions`: the action names reach the grid as its batch actions', async () => {
    expect((await controlGrid()).batchActions).toBeUndefined();
    expect((await gridFor({ bulkActions: ['complete_task'] })).batchActions).toEqual(['complete_task']);
  });

  it('`bulkActionDefs`: the definitions reach the grid unchanged', async () => {
    expect((await controlGrid()).bulkActionDefs).toBeUndefined();
    const defs = [{ name: 'mark_doing', label: 'Mark doing', operation: 'update', patch: { stage: 'doing' } }];
    expect((await gridFor({ bulkActionDefs: defs })).bulkActionDefs).toEqual(defs);
  });

  it('`conditionalFormatting`: `{ condition, style }` rules reach the grid', async () => {
    expect((await controlGrid()).conditionalFormatting).toBeUndefined();
    const rules = [{ condition: "record.stage == 'todo'", style: { backgroundColor: '#ff0000' } }];
    expect((await gridFor({ conditionalFormatting: rules })).conditionalFormatting).toEqual(rules);
  });

  it('`inlineEdit: true` renders the grid editable', async () => {
    expect((await controlGrid()).editable).toBe(false);
    expect((await gridFor({ inlineEdit: true })).editable).toBe(true);
  });

  it('`navigation.mode: \'drawer\'` opens the record in a drawer titled by the list\'s `label` when a row is clicked', async () => {
    const clickFirstRow = async () => {
      const grid = lastHanded('object-grid');
      await act(async () => {
        (grid.onRowClick as (row: Row) => void)(ROWS[0]);
      });
    };

    const control = mount({ label: 'Quarterly' });
    await handedTo('object-grid');
    await loaded(control.dataSource);
    await clickFirstRow();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    resetHanded();

    const { dataSource } = mount({ label: 'Quarterly', navigation: { mode: 'drawer' } });
    await handedTo('object-grid');
    await loaded(dataSource);
    await clickFirstRow();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent ?? '').toContain('Quarterly');
  });
});

describe('objectui#13047 — each kind\'s own block, handed to the node of the view that draws it', () => {
  it('`kanban`: `groupByField` lanes the board and `titleField` titles its cards', async () => {
    const { dataSource } = mount({ type: 'kanban', kanban: { groupByField: 'owner', titleField: 'name', columns: ['amount'] } });
    await handedTo('object-kanban');
    await loaded(dataSource);
    const board = lastHanded('object-kanban');
    expect(board.groupBy).toBe('owner');
    expect(board.titleField).toBe('name');
    expect(board.cardFields).toEqual(['amount']);
  });

  it('CONTROL: `type: \'kanban\'` without a kanban block lanes the board on a field the list derives, not on `owner`', async () => {
    const { dataSource } = mount({ type: 'kanban' });
    await loaded(dataSource);
    const board = lastHanded('object-kanban');
    expect(board?.groupBy).not.toBe('owner');
  });

  it('`calendar`: `startDateField` / `endDateField` / `titleField` bind the calendar', async () => {
    const control = mount({ type: 'calendar' });
    await loaded(control.dataSource);
    expect(lastHanded('object-calendar')?.startDateField).toBeUndefined();
    cleanup();
    resetHanded();

    const { dataSource } = mount({ type: 'calendar', calendar: { startDateField: 'due', endDateField: 'finish', titleField: 'owner' } });
    await handedTo('object-calendar');
    await loaded(dataSource);
    const calendar = lastHanded('object-calendar');
    expect(calendar.startDateField).toBe('due');
    expect(calendar.endDateField).toBe('finish');
    expect(calendar.titleField).toBe('owner');
  });

  it('`gantt`: `startDateField` / `endDateField` / `titleField` bind the chart', async () => {
    const control = mount({ type: 'gantt' });
    await loaded(control.dataSource);
    expect(lastHanded('object-gantt')?.startDateField).toBeUndefined();
    cleanup();
    resetHanded();

    const { dataSource } = mount({ type: 'gantt', gantt: { startDateField: 'due', endDateField: 'finish', titleField: 'owner' } });
    await handedTo('object-gantt');
    await loaded(dataSource);
    const gantt = lastHanded('object-gantt');
    expect(gantt.startDateField).toBe('due');
    expect(gantt.endDateField).toBe('finish');
    expect(gantt.titleField).toBe('owner');
  });

  it('`gallery`: `coverField` and `titleField` reach the gallery', async () => {
    const control = mount({ type: 'gallery' });
    await loaded(control.dataSource);
    expect((lastHanded('object-gallery')?.gallery as Row | undefined)?.coverField).toBeUndefined();
    cleanup();
    resetHanded();

    const { dataSource } = mount({ type: 'gallery', gallery: { coverField: 'location', titleField: 'owner' } });
    await handedTo('object-gallery');
    await loaded(dataSource);
    const gallery = lastHanded('object-gallery');
    expect((gallery.gallery as Row).coverField).toBe('location');
    expect(gallery.titleField).toBe('owner');
  });

  it('`timeline`: `startDateField` and `titleField` bind the timeline', async () => {
    const control = mount({ type: 'timeline' });
    await loaded(control.dataSource);
    expect(lastHanded('object-timeline')?.startDateField).toBeUndefined();
    cleanup();
    resetHanded();

    const { dataSource } = mount({ type: 'timeline', timeline: { startDateField: 'due', titleField: 'owner' } });
    await handedTo('object-timeline');
    await loaded(dataSource);
    const timeline = lastHanded('object-timeline');
    expect(timeline.startDateField).toBe('due');
    expect(timeline.titleField).toBe('owner');
    expect((timeline.timeline as Row).startDateField).toBe('due');
  });

  it('`map`: `latitudeField` / `longitudeField` bind the map', async () => {
    const control = mount({ type: 'map' });
    await loaded(control.dataSource);
    expect(lastHanded('object-map')?.latitudeField).toBeUndefined();
    cleanup();
    resetHanded();

    const { dataSource } = mount({ type: 'map', map: { latitudeField: 'amount', longitudeField: 'amount' } });
    await handedTo('object-map');
    await loaded(dataSource);
    const map = lastHanded('object-map');
    expect(map.latitudeField).toBe('amount');
    expect(map.longitudeField).toBe('amount');
  });

  it('`tree`: `parentField` and `labelField` bind the tree', async () => {
    const control = mount({ type: 'tree' });
    await loaded(control.dataSource);
    expect(lastHanded('object-tree')?.parentField).toBeUndefined();
    cleanup();
    resetHanded();

    const { dataSource } = mount({ type: 'tree', tree: { parentField: 'parent', labelField: 'owner' } });
    await handedTo('object-tree');
    await loaded(dataSource);
    const tree = lastHanded('object-tree');
    expect(tree.parentField).toBe('parent');
    expect(tree.labelField).toBe('owner');
  });

  it('`chart`: the `dataset` binding and its `values` / `dimensions` reach the chart', async () => {
    const { dataSource } = mount({
      type: 'chart',
      chart: { dataset: 'task_metrics', values: ['total_amount'], dimensions: ['stage'] },
    });
    await handedTo('object-chart');
    await loaded(dataSource);
    const chart = lastHanded('object-chart');
    expect(chart.dataset).toBe('task_metrics');
    expect(chart.values).toEqual(['total_amount']);
    expect(chart.dimensions).toEqual(['stage']);
  });
});

describe('objectui#13047 — measured NOT honoured on a page `list-view` node (held out of `inputs`)', () => {
  it('`name`: the node draws and queries the same with and without it', async () => {
    const control = mount();
    const controlQuery = await firstQuery(control.dataSource);
    await loaded(control.dataSource);
    const controlText = control.container.textContent;
    const controlGrid = JSON.stringify({ ...lastHanded('object-grid'), onRowClick: null });
    cleanup();
    resetHanded();

    const { dataSource, container } = mount({ name: 'open_tasks' });
    expect(await firstQuery(dataSource)).toEqual(controlQuery);
    await loaded(dataSource);
    expect(container.textContent).toBe(controlText);
    expect(JSON.stringify({ ...lastHanded('object-grid'), onRowClick: null })).toBe(controlGrid);
    expect(container.textContent ?? '').not.toContain('open_tasks');
  });

  it('`sharing`: draws a Share button that carries no click handler — the sharing config is enforced nowhere here', async () => {
    const { dataSource } = mount({ sharing: { type: 'personal' } });
    await loaded(dataSource);
    const share = screen.getByTestId('share-button');
    // React attaches no handler: a click changes nothing on the page.
    const before = document.body.innerHTML;
    fireEvent.click(share);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(document.body.innerHTML).toBe(before);
  });

  // objectui#13261 — these rows mounted `filterableFields` as a key the row
  // accepted and the list ignored (objectui#13047, then objectui#13118). The pin
  // at `@objectstack/spec` 18.0.0 carries the spec's retirement tombstone
  // (objectstack#24640, ruling C), so the row now refuses the key by name and no
  // page node the save gate accepts can carry it. The renderer half stays
  // measured, on a node built past the row on purpose.
  it('`filterableFields`: RETIRED by the spec — the `list-view` row refuses it by name, with the spec\'s prescription', () => {
    const row = (ComponentPropsMap as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }>)['list-view'];
    // The accept leg first, on the same row: without it the refusal reads a row that refuses everything.
    expect(row.safeParse(BASE).success).toBe(true);
    const parsed = row.safeParse({ ...BASE, filterableFields: ['stage'] });
    expect(parsed.success).toBe(false);
    const issues = parsed.error?.issues ?? [];
    expect(issues.map((i) => i.path.join('.'))).toEqual(['filterableFields']);
    expect(issues[0]?.message).toContain('was removed in @objectstack/spec 18');
  });

  it('`filterableFields`: RETIRED (objectui#13118) — the list does not read it as the Filter panel\'s field list, so "Add filter" starts where it does without the key', async () => {
    const firstFilterField = async (): Promise<string> => {
      fireEvent.click(screen.getByRole('button', { name: /^filter/i }));
      await screen.findByText('Filter Records');
      const panel = screen.getByText('Filter Records').closest('[role="dialog"]') as HTMLElement;
      fireEvent.click(within(panel).getByRole('button', { name: /add filter/i }));
      let text = '';
      await waitFor(() => {
        text = within(panel).getAllByRole('combobox')[0].textContent ?? '';
        expect(text).not.toBe('');
      });
      return text;
    };

    const control = mount();
    await loaded(control.dataSource);
    expect(await firstFilterField()).toBe('Name');
    cleanup();

    // Built past `node()`: the spec's row refuses this key (the row above), so
    // only a node no save gate judged can still carry it to the renderer.
    const dataSource = makeDataSource(ROWS);
    render(
      <SchemaRendererProvider dataSource={dataSource as never}>
        <SchemaRenderer schema={{ type: 'list-view', properties: { ...BASE, filterableFields: ['amount', 'owner'] } } as never} />
      </SchemaRendererProvider>,
    );
    await loaded(dataSource);
    expect(await firstFilterField()).toBe('Name');
  });

  it('`addRecord.enabled`: no Add button on a page node under no `onCreate` host — withheld, not drawn dead', async () => {
    // No provider at all.
    const bare = mount({ addRecord: { enabled: true } });
    await loaded(bare.dataSource);
    expect(screen.queryByTestId('add-record-button')).toBeNull();
    expect(bare.dataSource.create).not.toHaveBeenCalled();
    cleanup();

    // A provider that answers the object with no handlers at all, as a host
    // that serves no create does.
    const dataSource = makeDataSource(ROWS, {});
    const resolve = vi.fn(() => Object.freeze({}));
    render(
      <RelatedRecordActionsProvider value={{ resolve }}>
        <SchemaRendererProvider dataSource={dataSource as never}>
          <SchemaRenderer schema={node({ addRecord: { enabled: true } }) as never} />
        </SchemaRendererProvider>
      </RelatedRecordActionsProvider>,
    );
    await loaded(dataSource);
    expect(resolve).toHaveBeenCalledWith({ objectName: OBJECT });
    expect(screen.queryByTestId('add-record-button')).toBeNull();
    expect(dataSource.create).not.toHaveBeenCalled();
  });
});
