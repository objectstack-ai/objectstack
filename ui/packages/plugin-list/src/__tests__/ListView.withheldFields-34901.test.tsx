/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34901 — a view naming a field a DISABLED package contributes.
 *
 * The served object read leaves the field out and names it under
 * `_withheldFields`; the data door refuses it on every axis. The data source
 * below answers as the door does: any request naming `crm_project` is refused
 * `400 INVALID_FIELD`. The list must:
 *
 *  - name it in no request (`$select`, `$filter`, `$orderby`, `$searchFields`)
 *    and hand the grid no column, sort, grouping level, filter or searchable
 *    field on it, while still naming it in one line above the rows;
 *  - keep it in every sort it persists (the objectstack#30024 boundary), since
 *    the projection lacks it only while the package is off;
 *  - draw it again, and ask for it again, once the definition no longer marks
 *    it, with no write in between.
 *
 * A stub grid stands in for the renderer, as in
 * `ListView.groupedGridOwnsFetch-7189.test.tsx`: what is under test is what the
 * list asks for and hands down.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry, attachObjectSortability } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';

const OBJECT = 'crm_expense';
const WITHHELD = 'crm_project';
const PACKAGE = 'com.example.projects';

let lastGridProps: any = null;

/** The served definition: the field left out, named under `_withheldFields` while the package is off. */
function servedDefinition(packageOff: boolean) {
  const fields: Record<string, unknown> = {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  };
  if (!packageOff) fields[WITHHELD] = { type: 'text', label: 'Project' };
  const def: Record<string, unknown> = { name: OBJECT, label: 'Expense', fields };
  if (packageOff) def._withheldFields = { [WITHHELD]: { packageId: PACKAGE } };
  const sortability = { fields: Object.fromEntries(Object.keys(fields).map((f) => [f, { sortable: true }])) };
  return attachObjectSortability(def, sortability);
}

function makeDataSource(state: { packageOff: boolean }) {
  return {
    find: vi.fn(async (_object: string, params: unknown) => {
      if (state.packageOff && JSON.stringify(params ?? {}).includes(WITHHELD)) {
        throw Object.assign(new Error(`Unknown field '${WITHHELD}' on object '${OBJECT}'`), { httpStatus: 400, code: 'INVALID_FIELD' });
      }
      return { data: [{ id: 'e1', name: 'Taxi', amount: 12 }], total: 1 };
    }),
    queryGroupHeaders: vi.fn(async () => []),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => servedDefinition(state.packageOff)),
  } as any;
}

const viewSchema = (over: Record<string, unknown> = {}): ListViewSchema => ({
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'grid',
  columns: ['name', 'amount', WITHHELD],
  sort: [{ field: WITHHELD, order: 'asc' }, { field: 'name', order: 'asc' }],
  searchableFields: ['name', WITHHELD],
  filter: [[WITHHELD, '=', 'p1'], ['amount', '>', 1]],
  ...over,
} as unknown as ListViewSchema);

let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});
beforeEach(() => { lastGridProps = null; });
afterEach(() => { cleanup(); lastGridProps = null; });

function renderList(ds: any, schema: ListViewSchema, props: Record<string, unknown> = {}) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} {...props} />
    </SchemaRendererProvider>,
  );
}

/** Every argument this list handed the data source, as one string. */
const everyRequest = (ds: any) => JSON.stringify([...ds.find.mock.calls, ...ds.queryGroupHeaders.mock.calls]);
/**
 * What the grid draws and orders by. The query inputs (`filter`,
 * `searchableFields`) are handed only to a grid that runs its own grouped
 * query (`gridOwnsGroupedFetch`); a flat grid is handed the rows this list
 * fetched, so those two are read in the grouped case below.
 */
const gridNames = () => JSON.stringify({ columns: lastGridProps?.schema?.columns, fields: lastGridProps?.schema?.fields, sort: lastGridProps?.schema?.sort, grouping: lastGridProps?.schema?.grouping });
const gridQueryInputs = () => JSON.stringify({ filter: lastGridProps?.schema?.filter, searchableFields: lastGridProps?.schema?.searchableFields });

describe('ListView over a field a disabled package withholds (objectstack#34901)', () => {
  it('names it in no request on any axis, hands the grid nothing on it, and says so above the rows', async () => {
    const state = { packageOff: true };
    const ds = makeDataSource(state);
    renderList(ds, viewSchema(), { initialSearchTerm: 'taxi' });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await screen.findByTestId('list-withheld-fields-notice');

    expect(everyRequest(ds)).not.toContain(WITHHELD);
    const params = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    // Positive controls in the same request: each axis still carries the rest.
    expect(params.$select).toEqual(expect.arrayContaining(['name', 'amount']));
    expect(JSON.stringify(params.$filter)).toContain('amount');
    expect(JSON.stringify(params.$orderby ?? params.sort ?? params.$sort)).toContain('name');
    expect(params.$search ?? params.search).toBe('taxi');
    expect(JSON.stringify(params)).toContain('"name"');

    expect(gridNames()).not.toContain(WITHHELD);
    expect(screen.getByTestId('list-withheld-fields-notice')).toHaveTextContent(WITHHELD);
    expect(screen.queryByText(/INVALID_FIELD|Unknown field/)).not.toBeInTheDocument();
  });

  it('leaves a withheld grouping level out of the grouped query, and groups by the level left', async () => {
    const ds = makeDataSource({ packageOff: true });
    renderList(ds, viewSchema({
      grouping: { fields: [{ field: WITHHELD, order: 'asc', collapsed: false }, { field: 'amount', order: 'asc', collapsed: false }] },
    }), { initialSearchTerm: 'taxi' });
    await waitFor(() => expect(lastGridProps?.schema?.grouping).toBeTruthy());
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastGridProps.schema.grouping.fields.map((f: any) => f.field)).toEqual(['amount']);
    expect(gridNames()).not.toContain(WITHHELD);
    expect(gridQueryInputs(), 'the grid that runs its own grouped query is handed none of it').not.toContain(WITHHELD);
    expect(gridQueryInputs(), 'positive control: the rest of the filter is handed down').toContain('amount');
    expect(everyRequest(ds)).not.toContain(WITHHELD);
    expect(screen.getByTestId('list-withheld-fields-notice')).toHaveTextContent(WITHHELD);
  });

  it('keeps a withheld sort entry in the sort it persists, from the sort builder and from the grid', async () => {
    const onSortChange = vi.fn();
    const ds = makeDataSource({ packageOff: true });
    renderList(ds, viewSchema({ filter: undefined, searchableFields: undefined }), { onSortChange });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());

    // The sort builder: remove the `name` row; the withheld row stays in the write.
    fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
    // The builder is the Sort panel's advanced step (objectstack#35550).
    fireEvent.click(await screen.findByTestId('sort-panel-open-advanced'));
    const rows = await screen.findAllByTestId('sort-builder-row');
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1]).getByRole('button', { name: /remove sort/i }));
    await waitFor(() => expect(onSortChange).toHaveBeenCalled());
    expect(onSortChange.mock.calls.at(-1)![0].map((s: any) => [s.field, s.order])).toEqual([[WITHHELD, 'asc']]);

    // The grid's header seam crosses the same boundary: a withheld entry it
    // hands back is persisted, and an entry the projection refuses for any
    // other reason is still dropped.
    await waitFor(() => expect(typeof lastGridProps?.onSortChange).toBe('function'));
    lastGridProps.onSortChange([{ field: 'amount', order: 'desc' }, { field: WITHHELD, order: 'asc' }, { field: 'not_a_field', order: 'asc' }]);
    await waitFor(() => expect(onSortChange.mock.calls.at(-1)![0].map((s: any) => s.field)).toEqual(['amount', WITHHELD]));
    expect(everyRequest(ds)).not.toContain(WITHHELD);
  });

  it('draws the column and asks for it again once the definition no longer marks it, with no write', async () => {
    const state = { packageOff: true };
    const ds = makeDataSource(state);
    const onSortChange = vi.fn();
    const { unmount } = renderList(ds, viewSchema({ filter: undefined, searchableFields: undefined }), { onSortChange });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(gridNames()).not.toContain(WITHHELD);
    unmount();

    // The package is enabled: the next definition read serves the field.
    state.packageOff = false;
    lastGridProps = null;
    renderList(ds, viewSchema({ filter: undefined, searchableFields: undefined }), { onSortChange });
    await waitFor(() => expect(JSON.stringify(lastGridProps?.schema?.columns ?? [])).toContain(WITHHELD));
    await waitFor(() => expect(JSON.stringify(ds.find.mock.calls.at(-1)![1])).toContain(WITHHELD));
    expect(JSON.stringify(ds.find.mock.calls.at(-1)![1].$orderby ?? ds.find.mock.calls.at(-1)![1].sort)).toContain(WITHHELD);
    expect(screen.queryByTestId('list-withheld-fields-notice')).not.toBeInTheDocument();
    expect(onSortChange, 'nothing was written to bring it back').not.toHaveBeenCalled();
  });
});
