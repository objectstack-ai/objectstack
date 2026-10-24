/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11536 — `record:line_items` declares every key of its
 * `@objectstack/spec` 17.6.0 `ComponentPropsMap` row, and this file is the
 * measurement each declaration rests on.
 *
 * The rule the card was ruled under: declare what the renderer honours, leave
 * out what it does not, and never declare a key the renderer does not read. A
 * source read alone cannot settle "honours": `SchemaRenderer` hoists the
 * `properties` bag onto the node and the block wraps the panel in
 * `ElementDataSourceGate`, so a key can be read, rewritten or dropped between
 * the authored node and `LineItemsPanel`. So every key is authored here the
 * way the spec authors it, in the node's `properties` bag, rendered through
 * the real `SchemaRenderer` and this package's own registration, and asserted
 * at what it does: the query the adapter receives, the batch Save sends, or
 * the DOM the user sees. Every row has a control beside it that differs only
 * by that key, so a key the panel ignored would read the same twice and fail.
 *
 * The first describe block is the ten keys the card declared (`parentObject`,
 * `parentId`, `recordId`, `title`, `readonly`, `minRows`, `maxRows`, `filter`,
 * `sort`, `limit`). All ten move the panel, so all ten are declared, and the
 * row's other five (`childObject`, `relationshipField`, `columns`,
 * `amountField`, `totalField`) were declared before it. `filter` / `sort` /
 * `limit` are measured as TOP-LEVEL keys with no binding on the node: the gate
 * hands such a schema through untouched, so the panel reads them itself.
 *
 * The other four describe blocks are the member pins the console's repo-wide
 * parity gate registers for this block's array/object-armed inputs:
 * `record:line_items.columns`, `record:line_items.dataSource`,
 * `record:line_items.filter` and `record:line_items.sort`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider, RecordContextProvider } from '@object-ui/react';
// Registers `record:line_items` through this package's own entry.
import '../index';

const COLUMNS = [
  { name: 'label', label: 'Line', type: 'text' },
  { name: 'amount', label: 'Amount', type: 'number' },
];

type Row = Record<string, unknown>;

const TWO_LINES: Row[] = [
  { id: 'l1', label: 'first', amount: 5 },
  { id: 'l2', label: 'second', amount: 7 },
];

/**
 * A recording adapter. The child schema is answered with none, so a saved
 * line is written as the grid holds it (no field-list strip in between).
 */
function makeAdapter(rows: Row[] = TWO_LINES, listViews: Record<string, unknown> = {}) {
  return {
    find: vi.fn().mockResolvedValue({ data: rows }),
    getObjectSchema: vi.fn(async () =>
      Object.keys(listViews).length > 0 ? { name: 'po_line', fields: {}, listViews } : null,
    ),
    batchTransaction: vi.fn().mockResolvedValue({ results: [] }),
  };
}
type Adapter = ReturnType<typeof makeAdapter>;

/** A `record:line_items` node in the spec's `{ type, properties }` form. */
const node = (properties: Row, nodeLevel: Row = {}) => ({
  type: 'record:line_items',
  ...nodeLevel,
  properties: { childObject: 'po_line', relationshipField: 'po', columns: COLUMNS, ...properties },
});

interface PageRecord {
  objectName: string;
  recordId: string;
}

function mount(adapter: Adapter, schema: Row, record?: PageRecord) {
  const block = <SchemaRenderer schema={schema as any} />;
  return render(
    <SchemaRendererProvider dataSource={adapter as any}>
      {record ? (
        <RecordContextProvider objectName={record.objectName} recordId={record.recordId}>
          {block}
        </RecordContextProvider>
      ) : (
        block
      )}
    </SchemaRendererProvider>,
  );
}

/** The first query the panel sent, once it has sent one. */
async function firstQuery(adapter: Adapter): Promise<[string, Row]> {
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return adapter.find.mock.calls[0] as [string, Row];
}

const lineInputs = () =>
  Array.from(document.body.querySelectorAll('input[aria-label="Line"]')) as HTMLInputElement[];
const buttonNamed = (name: string) =>
  Array.from(document.body.querySelectorAll('button')).find(
    (b) => (b.textContent ?? '').trim() === name || b.getAttribute('aria-label') === name,
  ) as HTMLButtonElement | undefined;
const buttonsLabelled = (label: string) =>
  Array.from(document.body.querySelectorAll(`button[aria-label="${label}"]`)) as HTMLButtonElement[];
/** The panel's heading: the card title (`CardTitle`, whose own class is `tracking-tight`). */
const heading = () => document.body.querySelector('.tracking-tight')?.textContent;
/** The grid's column headers, without the line-number and row-action columns. */
const columnHeaders = () =>
  Array.from(document.body.querySelectorAll('thead th'))
    .map((th) => (th.textContent ?? '').trim())
    .filter((text) => text !== '' && text !== '#');

/** Waits for both lines to be drawn, so an absence below is not an unfinished load. */
async function linesDrawn() {
  await waitFor(() => expect(lineInputs().map((i) => i.value)).toEqual(expect.arrayContaining(['first', 'second'])));
}

/** Edits the first line, clicks Save, and returns the batch Save sent. */
async function editAndSave(adapter: Adapter): Promise<Row[]> {
  await waitFor(() => expect(lineInputs().length).toBeGreaterThan(0));
  await act(async () => {
    fireEvent.change(lineInputs()[0], { target: { value: 'edited' } });
  });
  await waitFor(() => expect(buttonNamed('Save')?.disabled).toBe(false));
  await act(async () => {
    fireEvent.click(buttonNamed('Save')!);
  });
  await waitFor(() => expect(adapter.batchTransaction).toHaveBeenCalledTimes(1));
  return adapter.batchTransaction.mock.calls[0][0] as Row[];
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('record:line_items: each of the ten declared keys moves the panel (objectui#11536)', () => {
  it('parentId scopes the load to that parent; CONTROL: with no parent id nothing is loaded', async () => {
    const scoped = makeAdapter();
    mount(scoped, node({ parentId: 'p1' }));
    expect(await firstQuery(scoped)).toEqual(['po_line', { $filter: { po: 'p1' }, $top: 500 }]);
    cleanup();

    const unscoped = makeAdapter();
    const view = mount(unscoped, node({}));
    await waitFor(() => expect(view.container.textContent).toContain('Save the record first to add line items.'));
    expect(unscoped.find).not.toHaveBeenCalled();
  });

  it('parentId saves a new line under that parent', async () => {
    const adapter = makeAdapter([]);
    mount(adapter, node({ parentId: 'p1' }));
    const ops = await editAndSave(adapter);
    expect(ops).toEqual([{ object: 'po_line', action: 'create', data: { label: 'edited', amount: null, po: 'p1' } }]);
  });

  it('recordId scopes the load when parentId is unset, and outranks the record the page shows', async () => {
    const alone = makeAdapter();
    mount(alone, node({ recordId: 'r9' }));
    expect((await firstQuery(alone))[1]).toEqual({ $filter: { po: 'r9' }, $top: 500 });
    cleanup();

    const overPage = makeAdapter();
    mount(overPage, node({ recordId: 'r9' }), { objectName: 'po', recordId: 'page-1' });
    expect((await firstQuery(overPage))[1]).toEqual({ $filter: { po: 'r9' }, $top: 500 });
    cleanup();

    // CONTROL: the record the page shows is the parent when neither key is set.
    const pageOnly = makeAdapter();
    mount(pageOnly, node({}), { objectName: 'po', recordId: 'page-1' });
    expect((await firstQuery(pageOnly))[1]).toEqual({ $filter: { po: 'page-1' }, $top: 500 });
  });

  it('parentId outranks recordId', async () => {
    const adapter = makeAdapter();
    mount(adapter, node({ parentId: 'p1', recordId: 'r9' }));
    expect((await firstQuery(adapter))[1]).toEqual({ $filter: { po: 'p1' }, $top: 500 });
  });

  it('parentObject names the parent leg Save writes the line total to; CONTROL: without it there is no parent leg', async () => {
    const named = makeAdapter([{ id: 'l1', label: 'first', amount: 5 }]);
    mount(named, node({ parentId: 'p1', parentObject: 'purchase_order', totalField: 'total_amount', amountField: 'amount' }));
    expect(await editAndSave(named)).toEqual([
      { object: 'purchase_order', action: 'update', id: 'p1', data: { total_amount: 5 } },
      { object: 'po_line', action: 'update', id: 'l1', data: { label: 'edited', po: 'p1' } },
    ]);
    cleanup();

    const unnamed = makeAdapter([{ id: 'l1', label: 'first', amount: 5 }]);
    mount(unnamed, node({ parentId: 'p1', totalField: 'total_amount', amountField: 'amount' }));
    expect(await editAndSave(unnamed)).toEqual([
      { object: 'po_line', action: 'update', id: 'l1', data: { label: 'edited', po: 'p1' } },
    ]);
  });

  it('parentObject outranks the object of the record the page shows', async () => {
    const authored = makeAdapter([{ id: 'l1', label: 'first', amount: 5 }]);
    mount(
      authored,
      node({ parentObject: 'purchase_order', totalField: 'total_amount', amountField: 'amount' }),
      { objectName: 'po', recordId: 'page-1' },
    );
    expect((await editAndSave(authored))[0]).toEqual({
      object: 'purchase_order',
      action: 'update',
      id: 'page-1',
      data: { total_amount: 5 },
    });
    cleanup();

    // CONTROL: the page's object is the parent object when the key is unset.
    const fromPage = makeAdapter([{ id: 'l1', label: 'first', amount: 5 }]);
    mount(fromPage, node({ totalField: 'total_amount', amountField: 'amount' }), { objectName: 'po', recordId: 'page-1' });
    expect((await editAndSave(fromPage))[0]).toEqual({ object: 'po', action: 'update', id: 'page-1', data: { total_amount: 5 } });
  });

  it('title is the heading; CONTROL: without it the heading is the default', async () => {
    const titled = makeAdapter();
    mount(titled, node({ parentId: 'p1', title: 'Order lines' }));
    await linesDrawn();
    expect(heading()).toBe('Order lines');
    cleanup();

    const untitled = makeAdapter();
    mount(untitled, node({ parentId: 'p1' }));
    await linesDrawn();
    expect(heading()).toBe('Line Items');
  });

  it('readonly draws a read-only table with no Save and no row actions; CONTROL: without it the grid is editable', async () => {
    const editable = makeAdapter();
    mount(editable, node({ parentId: 'p1' }));
    await linesDrawn();
    expect(buttonNamed('Save')).toBeDefined();
    expect(buttonNamed('Add line')).toBeDefined();
    expect(buttonsLabelled('Remove row')).toHaveLength(2);
    expect(document.body.querySelector('[data-testid="line-items-readonly"]')).toBeNull();
    cleanup();

    const readonly = makeAdapter();
    mount(readonly, node({ parentId: 'p1', readonly: true }));
    await waitFor(() => expect(document.body.querySelector('[data-testid="line-items-readonly"]')).not.toBeNull());
    expect(document.body.textContent).toContain('first');
    expect(lineInputs()).toHaveLength(0);
    expect(buttonNamed('Save')).toBeUndefined();
    expect(buttonNamed('Add line')).toBeUndefined();
    expect(buttonsLabelled('Remove row')).toHaveLength(0);
    expect(buttonsLabelled('Duplicate row')).toHaveLength(0);
  });

  it('minRows disables Remove row while the grid holds that many lines; CONTROL: without it Remove row is enabled', async () => {
    const free = makeAdapter();
    mount(free, node({ parentId: 'p1' }));
    await linesDrawn();
    expect(buttonsLabelled('Remove row').map((b) => b.disabled)).toEqual([false, false]);
    cleanup();

    const floored = makeAdapter();
    mount(floored, node({ parentId: 'p1', minRows: 2 }));
    await linesDrawn();
    expect(buttonsLabelled('Remove row').map((b) => b.disabled)).toEqual([true, true]);
    // It adds no blank lines to reach the number: two lines plus the entry row.
    expect(lineInputs()).toHaveLength(3);
  });

  it('maxRows disables Add line and Duplicate row and drops the entry row at that many lines; CONTROL: without it they stay', async () => {
    const open = makeAdapter();
    mount(open, node({ parentId: 'p1' }));
    await linesDrawn();
    expect(buttonNamed('Add line')?.disabled).toBe(false);
    expect(buttonsLabelled('Duplicate row').map((b) => b.disabled)).toEqual([false, false]);
    expect(lineInputs()).toHaveLength(3);
    cleanup();

    const capped = makeAdapter();
    mount(capped, node({ parentId: 'p1', maxRows: 2 }));
    await linesDrawn();
    expect(buttonNamed('Add line')?.disabled).toBe(true);
    expect(buttonsLabelled('Duplicate row').map((b) => b.disabled)).toEqual([true, true]);
    expect(lineInputs()).toHaveLength(2);
  });

  it('filter narrows the load behind the parent scope; CONTROL: without it the query is the parent scope alone', async () => {
    const filtered = makeAdapter();
    mount(filtered, node({ parentId: 'p1', filter: [{ field: 'billable', operator: 'equals', value: true }] }));
    expect((await firstQuery(filtered))[1]).toEqual({
      $filter: ['and', ['po', '=', 'p1'], [['billable', 'equals', true]]],
      $top: 500,
    });
    cleanup();

    const unfiltered = makeAdapter();
    mount(unfiltered, node({ parentId: 'p1' }));
    expect((await firstQuery(unfiltered))[1]).toEqual({ $filter: { po: 'p1' }, $top: 500 });
  });

  it('sort orders the load; CONTROL: without it the query carries no ordering', async () => {
    const sorted = makeAdapter();
    mount(sorted, node({ parentId: 'p1', sort: [{ field: 'amount', order: 'desc' }] }));
    expect((await firstQuery(sorted))[1]).toEqual({ $filter: { po: 'p1' }, $orderby: { amount: 'desc' }, $top: 500 });
    cleanup();

    const unsorted = makeAdapter();
    mount(unsorted, node({ parentId: 'p1' }));
    expect((await firstQuery(unsorted))[1]).not.toHaveProperty('$orderby');
  });

  it('limit caps the load; CONTROL: without it the cap is 500', async () => {
    const capped = makeAdapter();
    mount(capped, node({ parentId: 'p1', limit: 25 }));
    expect((await firstQuery(capped))[1]).toEqual({ $filter: { po: 'p1' }, $top: 25 });
    cleanup();

    const uncapped = makeAdapter();
    mount(uncapped, node({ parentId: 'p1' }));
    expect((await firstQuery(uncapped))[1]).toEqual({ $filter: { po: 'p1' }, $top: 500 });
  });
});

describe('record:line_items.columns: the members the grid draws (objectui#11536)', () => {
  it('each member is one column in AUTHORED order, headed by its label, or by its name when it has none', async () => {
    const adapter = makeAdapter([{ id: 'l1', label: 'first', amount: 5, qty: 2 }]);
    mount(
      adapter,
      node({
        parentId: 'p1',
        columns: [
          { name: 'qty', label: 'Quantity', type: 'number' },
          { name: 'label' },
          { name: 'amount', label: 'Amount', type: 'number' },
        ],
      }),
    );
    await waitFor(() => expect(columnHeaders()).toEqual(['Quantity', 'label', 'Amount']));
  });

  it('a member draws exactly what it declares: its type picks the cell control, and a typeless member is a text cell', async () => {
    const adapter = makeAdapter([{ id: 'l1', label: 'first', amount: 5 }]);
    mount(
      adapter,
      node({ parentId: 'p1', columns: [{ name: 'amount', label: 'Typed', type: 'number' }, { name: 'amount', label: 'Untyped' }] }),
    );
    await waitFor(() => expect(document.body.querySelectorAll('input[aria-label="Typed"]').length).toBeGreaterThan(0));
    // The panel does not hydrate a column from the child object's fields: the
    // same `amount` value is a number cell only where the member says so.
    expect((document.body.querySelector('input[aria-label="Typed"]') as HTMLInputElement).type).toBe('number');
    expect((document.body.querySelector('input[aria-label="Untyped"]') as HTMLInputElement).type).toBe('text');
  });

  it('defaultHidden keeps a member out of the drawn columns; CONTROL: required outranks it, and marks its header', async () => {
    const adapter = makeAdapter([{ id: 'l1', label: 'first', amount: 5 }]);
    mount(
      adapter,
      node({
        parentId: 'p1',
        columns: [
          { name: 'label', label: 'Line', type: 'text' },
          { name: 'amount', label: 'Amount', type: 'number', defaultHidden: true },
          { name: 'note', label: 'Note', type: 'text', defaultHidden: true, required: true },
        ],
      }),
    );
    await waitFor(() => expect(columnHeaders()).toEqual(['Line', 'Note *']));
  });

  it('a member names the field its cell edits, and Save writes the edit under that name', async () => {
    const adapter = makeAdapter([{ id: 'l1', label: 'first', amount: 5 }]);
    mount(adapter, node({ parentId: 'p1' }));
    expect(await editAndSave(adapter)).toEqual([
      { object: 'po_line', action: 'update', id: 'l1', data: { label: 'edited', po: 'p1' } },
    ]);
  });
});

describe('record:line_items.filter: the members the load reads (objectui#11536)', () => {
  it('ViewFilterRule members reach the query in order, as one group ANDed BEHIND the parent scope', async () => {
    const adapter = makeAdapter();
    mount(
      adapter,
      node({
        parentId: 'p1',
        filter: [
          { field: 'billable', operator: 'equals', value: true },
          { field: 'amount', operator: 'greater_than', value: 0 },
        ],
      }),
    );
    expect((await firstQuery(adapter))[1].$filter).toEqual([
      'and',
      ['po', '=', 'p1'],
      [
        ['billable', 'equals', true],
        ['amount', 'greater_than', 0],
      ],
    ]);
  });

  it('an empty list is no criterion: the query stays the parent scope object', async () => {
    const adapter = makeAdapter();
    mount(adapter, node({ parentId: 'p1', filter: [] }));
    expect((await firstQuery(adapter))[1].$filter).toEqual({ po: 'p1' });
  });

  it('a member never replaces the parent scope, even when it names the relationship field', async () => {
    const adapter = makeAdapter();
    mount(adapter, node({ parentId: 'p1', filter: [{ field: 'po', operator: 'equals', value: 'p2' }] }));
    expect((await firstQuery(adapter))[1].$filter).toEqual(['and', ['po', '=', 'p1'], [['po', 'equals', 'p2']]]);
  });
});

describe('record:line_items.sort: the members the load reads (objectui#11536)', () => {
  it('{ field, order } members reach the query in authored order', async () => {
    const adapter = makeAdapter();
    mount(
      adapter,
      node({ parentId: 'p1', sort: [{ field: 'amount', order: 'desc' }, { field: 'label', order: 'asc' }] }),
    );
    const orderBy = (await firstQuery(adapter))[1].$orderby as Record<string, string>;
    expect(orderBy).toEqual({ amount: 'desc', label: 'asc' });
    expect(Object.keys(orderBy)).toEqual(['amount', 'label']);
  });

  it('a member with no field is dropped while its siblings survive, and an order other than desc reads ascending', async () => {
    const adapter = makeAdapter();
    mount(adapter, node({ parentId: 'p1', sort: [{ order: 'desc' }, { field: 'label', order: 'up' }] }));
    expect((await firstQuery(adapter))[1].$orderby).toEqual({ label: 'asc' });
  });

  it('a list with no usable member sends no ordering at all', async () => {
    const adapter = makeAdapter();
    mount(adapter, node({ parentId: 'p1', sort: [{ order: 'desc' }] }));
    expect((await firstQuery(adapter))[1]).not.toHaveProperty('$orderby');
  });
});

describe('record:line_items.dataSource: the binding members the block reads (objectui#11536)', () => {
  const HOT_VIEW = {
    name: 'hot',
    label: 'Billable lines',
    columns: ['amount'],
    filter: [{ field: 'billable', operator: 'equals', value: true }],
    sort: [{ field: 'amount', order: 'desc' }],
    pagination: { pageSize: 7 },
  };

  it('object lands on childObject and OUTRANKS an authored childObject', async () => {
    const adapter = makeAdapter();
    mount(adapter, node({ parentId: 'p1', childObject: 'po_line' }, { dataSource: { object: 'invoice_line' } }));
    expect((await firstQuery(adapter))[0]).toBe('invoice_line');
  });

  it('view contributes its filter behind the parent scope, its sort and its page size', async () => {
    const adapter = makeAdapter(TWO_LINES, { hot: HOT_VIEW });
    mount(adapter, node({ parentId: 'p1' }, { dataSource: { object: 'po_line', view: 'hot' } }));
    expect((await firstQuery(adapter))[1]).toEqual({
      $filter: ['and', ['po', '=', 'p1'], [['billable', 'equals', true]]],
      $orderby: { amount: 'desc' },
      $top: 7,
    });
  });

  it('an unresolvable view reports instead of loading', async () => {
    const adapter = makeAdapter(TWO_LINES, { hot: HOT_VIEW });
    const view = mount(adapter, node({ parentId: 'p1' }, { dataSource: { object: 'po_line', view: 'nope' } }));
    await waitFor(() =>
      expect(view.container.querySelector('[data-testid="record-line-items-datasource-error"]')).not.toBeNull(),
    );
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('the panel’s own sort and limit outrank the view’s', async () => {
    const adapter = makeAdapter(TWO_LINES, { hot: HOT_VIEW });
    mount(
      adapter,
      node({ parentId: 'p1', sort: [{ field: 'label', order: 'asc' }], limit: 25 }, { dataSource: { object: 'po_line', view: 'hot' } }),
    );
    const query = (await firstQuery(adapter))[1];
    expect(query.$orderby).toEqual({ label: 'asc' });
    expect(query.$top).toBe(25);
  });

  it('the binding’s own sort and limit outrank the panel’s', async () => {
    const adapter = makeAdapter(TWO_LINES, { hot: HOT_VIEW });
    mount(
      adapter,
      node(
        { parentId: 'p1', sort: [{ field: 'label', order: 'asc' }], limit: 25 },
        { dataSource: { object: 'po_line', view: 'hot', sort: [{ field: 'amount', order: 'asc' }], limit: 3 } },
      ),
    );
    const query = (await firstQuery(adapter))[1];
    expect(query.$orderby).toEqual({ amount: 'asc' });
    expect(query.$top).toBe(3);
  });

  it('the binding’s filter is ANDed with the panel’s, and the parent scope survives both', async () => {
    const adapter = makeAdapter();
    mount(
      adapter,
      node(
        { parentId: 'p1', filter: [{ field: 'void', operator: 'equals', value: false }] },
        { dataSource: { object: 'po_line', filter: [{ field: 'amount', operator: 'greater_than', value: 0 }] } },
      ),
    );
    expect((await firstQuery(adapter))[1].$filter).toEqual([
      'and',
      ['po', '=', 'p1'],
      ['and', [['void', 'equals', false]], [['amount', 'greater_than', 0]]],
    ]);
  });

  it('a view’s columns are NOT read: the grid keeps the authored columns', async () => {
    const adapter = makeAdapter(TWO_LINES, { hot: HOT_VIEW });
    mount(adapter, node({ parentId: 'p1' }, { dataSource: { object: 'po_line', view: 'hot' } }));
    await waitFor(() => expect(columnHeaders()).toEqual(['Line', 'Amount']));
  });
});
