/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-master-detail-form.details` — the MEMBER shape THIS block reads
 * (objectui#8071, criterion from objectui#8068).
 *
 * Unlike the three parent keys objectui#8071 slice 15 pinned, `details` is not
 * carried onto the parent `<ObjectForm>`: it is this block's OWN half, and
 * `MasterDetailForm` is its only reader. A member is one detail collection,
 * typed `MasterDetailDetailConfig`.
 *
 * What a member IS is declared on both sides, and both declarations are the
 * spec's since `@objectstack/spec` 17.6.0 (objectstack-ai/objectstack#21215,
 * objectui#11396): the spec row is an array of CLOSED entries — `childObject`
 * required, an undeclared key refused by name, `columns` the spec's inline grid
 * column — and `MasterDetailDetailConfig` is derived from that entry by
 * reference, with ONE key left off: `sortField`, which this block does not read
 * (objectui#11070 round 9 retired the authored override; row 2c below pins that
 * a written one reaches nothing). That was a fork through 17.6.0, which
 * declared the member; `@objectstack/spec` 17.7.0 retires it too
 * (objectstack-ai/objectstack#21589, a `retiredKey()` tombstone the entry still
 * lists), so the fork is closed (objectui#11717). The registration declares
 * `of: 'object'`, derived from that single-kind member contract. The
 * compile-time block at the end of this file holds the config equal to the
 * spec's entry minus that key and spells the member list out, so the member
 * count is re-derived by the compiler rather than by this sentence. A
 * declaration fixes an entry's SHAPE, not what this block DOES with a member,
 * so the read site is still the whole member contract, and every row below is
 * measured there.
 *
 * ## Where each member lands
 *
 *   - `title` heads the collection's own section, with `Line Items` as the
 *     fallback. `columns` is handed to the line grid in authored order.
 *   - Four members reach the grid through ONE hand-written object. Since
 *     objectui#11610 renamed the grid's keys to camelCase, three keep their
 *     name (`minRows`, `maxRows`, `addLabel`) and one is RENAMED on the way:
 *     the detail's `amountField` lands on the grid's `totalField`, the CHILD
 *     column summed. ⚠️ The detail's own `totalField` is the PARENT field the
 *     sum is saved to and is NOT forwarded, so the same name carries a
 *     different value on each side. Beside them and `columns`, the object
 *     carries `sortField`, which is no member: the block DERIVES it from the
 *     child object (`deriveDetail` picks its `position` / `sort_order` / …
 *     field), and objectui#11070 round 9 retired the detail's `sortField`
 *     member that used to override it. It also carries `allowAdd` and
 *     `allowDelete`, which are no members either: they are the
 *     affordance-to-grant map's verdicts on the CHILD object (`relatedNew` /
 *     `relatedRowDelete`, objectui#12082), both open with no permission
 *     provider mounted, as here, so an authored `allowAdd` still reaches
 *     nothing (row 2). A member dropped from that object, or
 *     a key the grid does not declare, reaches a grid that reads nothing
 *     there; since objectui#11610 the object is checked against
 *     `GridFieldMetadata` at compile time, and a retired snake_case key there
 *     would draw the grid's named refusal. Row 2 still pins the object as a
 *     SORTED KEY SET and not as a few spot values.
 *   - `inlineMode` and `formFields` choose the form factor: list-plus-form or
 *     editable cells, and whether a row can be opened in the full form.
 *   - `childObject` and `relationshipField` address the collection's writes
 *     (the child legs of the atomic batch) and its edit-mode read.
 *     `amountField` and `totalField` roll the lines up into the PARENT leg.
 *   - With only `childObject` authored, the relationship field and the columns
 *     are DERIVED from the child object's metadata. That is the one behaviour
 *     the spec's description promises ("FK and columns auto-derive from child
 *     metadata").
 *
 * ## The rows
 *
 *   1. Each member renders as its own section, in AUTHORED order, headed by
 *      `title` (or `Line Items`), with `columns` in authored order.
 *   2. The grid object is exactly eight keys. Each authored member arrives
 *      under the grid's key, and off-list members are NOT forwarded, including
 *      one written in the grid's own spelling (`allowAdd`): the grid's
 *      `allowAdd` / `allowDelete` are the map's verdicts, never the author's.
 *   2c. `sortField` is no member (objectui#11070 round 9). On a detail the
 *      block derives, the grid's `sortField` is the child's sort-named field
 *      even when a `sortField` naming another field is written beside it. On
 *      a fully configured detail, which derives nothing, a written one leaves
 *      the grid's `sortField` empty. The compile-time block at the end of this
 *      file refuses the member by name.
 *   3. `inlineMode: 'form'` turns the grid into a list with an `Add` action.
 *      In grid mode, `formFields` wider than `columns` offers the row form, and
 *      without that the offer is withheld. Each arm is the control for the
 *      other.
 *   4. The atomic batch: each line becomes a create on `childObject`, linked
 *      back through `relationshipField`. `totalField` receives the sum of the
 *      lines' `amountField` on the PARENT leg, and a collection with no
 *      `totalField` puts nothing on the parent.
 *   5. `{ childObject }` alone: the FK is the child field that references the
 *      parent, the columns come from the child's editable fields (FK
 *      excluded), and the derived FK is the one the batch writes.
 *   6. `edit` mode: each collection's lines are read from `childObject`,
 *      scoped by `relationshipField` to the parent record, capped at 500.
 *   7. The non-vacuity control: `details: []` renders no section and mounts no
 *      grid, and the batch carries the parent leg alone.
 *
 * ⛔ Deliberately NOT re-asserted, because a neighbour owns it and a copy buys
 * nothing: a member with no `childObject`
 * (`MasterDetailForm.detailChildObjectDecline.test.tsx`), a child schema that
 * cannot be loaded (`MasterDetailForm.detailSchemaFetchFailure.test.tsx`), a
 * derive that finds no relationship field
 * (`MasterDetailForm.detailDeriveFailure.test.tsx`), entry identity across a
 * reorder (`MasterDetailForm.detailEntryIdentity.test.tsx`), and the unit-level
 * derive rules (`deriveMasterDetail.test.ts`). This file pins what a member IS
 * and where each of its keys lands.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields, type GridColumn } from '@object-ui/fields';
import type { ObjectMasterDetailFormProps } from '@objectstack/spec/ui';
import { MasterDetailForm, type MasterDetailDetailConfig } from '../MasterDetailForm';

/**
 * Every prop object `MasterDetailForm` hands the line grid, captured on the
 * way in. The REAL `LineItemsField` still renders, so the cells rows 4 and 5
 * fill are the product's own.
 */
const { gridProps } = vi.hoisted(() => ({ gridProps: [] as Array<Record<string, any>> }));
vi.mock('@object-ui/fields', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/fields')>();
  const { createElement } = await import('react');
  const RealLineItemsField = actual.LineItemsField;
  return {
    ...actual,
    LineItemsField: (props: Record<string, any>) => {
      gridProps.push(props);
      return createElement(RealLineItemsField as any, props);
    },
  };
});

registerAllFields();

/** The parent and three child objects, keyed by name, as the adapter serves them. */
const OBJECTS: Record<string, { name: string; fields: Record<string, any> }> = {
  // Row 2c's child: two sort-named fields, so a derived pick and a written
  // `sortField` can name DIFFERENT fields. The derivation takes the first of
  // the child's fields that is sort-named, which is `position`.
  po_step: {
    name: 'po_step',
    fields: {
      po: { type: 'master_detail', reference: 'po', label: 'Purchase order' },
      position: { type: 'number', label: 'Position' },
      line_no: { type: 'number', label: 'Line No' },
      note: { type: 'text', label: 'Note' },
    },
  },
  po: { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } },
  po_line: {
    name: 'po_line',
    fields: {
      po: { type: 'master_detail', reference: 'po', label: 'Purchase order' },
      qty: { type: 'number', label: 'Qty' },
      price: { type: 'number', label: 'Price' },
    },
  },
  po_note: {
    name: 'po_note',
    fields: {
      po: { type: 'lookup', reference: 'po', label: 'Purchase order' },
      note: { type: 'text', label: 'Note' },
    },
  },
};

function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    getObjectSchema: vi.fn(async (name: string) => OBJECTS[name] ?? { name, fields: {} }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] }),
    ...overrides,
  } as any;
}

const QTY = { name: 'qty', label: 'Qty', type: 'number' as const };
const PRICE = { name: 'price', label: 'Price', type: 'number' as const };
const NOTE = { name: 'note', label: 'Note', type: 'text' as const };

/** Mount the block and wait for the parent form, so every section has resolved. */
async function mount(schema: Record<string, unknown>, dataSource = makeDataSource()) {
  const view = render(
    <MasterDetailForm schema={{ objectName: 'po', mode: 'create', ...schema } as any} dataSource={dataSource} />,
  );
  await waitFor(() => {
    if (!view.container.querySelector('input[name="ref"]')) throw new Error('parent form not ready');
  });
  return { ...view, dataSource };
}

/** The props the grid of the section headed `heading` received LAST. */
function gridOf(heading: string): Record<string, any> {
  const section = screen.getByRole('heading', { name: heading }).closest('section');
  if (!section) throw new Error(`no section headed ${heading}`);
  const index = Array.from(document.querySelectorAll('section')).indexOf(section);
  // One grid per section, mounted in section order, so the Nth section's
  // props are every Nth capture of the latest render pass.
  const sections = document.querySelectorAll('section').length;
  const latest = gridProps.slice(-sections);
  return latest[index];
}

const headings = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('section > h3')).map((h) => h.textContent);

/** Fill the Nth ghost `Qty` cell (0-based), which turns it into a real line. */
async function fillQty(n: number, value: string) {
  const cell = await waitFor(() => {
    const cells = screen.getAllByLabelText('Qty');
    if (cells.length <= n) throw new Error(`no Qty cell ${n} yet`);
    return cells[n] as HTMLInputElement;
  });
  fireEvent.change(cell, { target: { value } });
}

describe('`object-master-detail-form` — the member shape of `details`', () => {
  beforeEach(() => {
    gridProps.length = 0;
  });

  it('1. each member is its own section, in AUTHORED order, headed by `title` (or `Line Items`), with `columns` in authored order', async () => {
    const { container } = await mount({
      details: [
        { childObject: 'po_line', relationshipField: 'po', title: 'Lines', columns: [PRICE, QTY] },
        { childObject: 'po_note', relationshipField: 'po', columns: [NOTE] },
      ],
    });
    await waitFor(() => expect(headings(container)).toEqual(['Lines', 'Line Items']));
    expect(
      gridOf('Lines').field.columns.map((c: { name: string }) => c.name),
      'the authored column order, not the child object’s field order',
    ).toEqual(['price', 'qty']);
    expect(gridOf('Line Items').field.columns.map((c: { name: string }) => c.name)).toEqual(['note']);
  });

  it('2. four members reach the grid under its keys, as exactly eight keys, and off-list members are not forwarded', async () => {
    await mount({
      details: [
        {
          childObject: 'po_line',
          relationshipField: 'po',
          title: 'Lines',
          columns: [QTY],
          minRows: 1,
          maxRows: 3,
          addLabel: 'Add a line',
          amountField: 'qty',
          // Off the list. The second is the GRID's own spelling: the map is
          // explicit, so writing the target key by hand reaches nothing.
          readonly: true,
          allowAdd: false,
        },
      ],
    });
    const field = await waitFor(() => gridOf('Lines').field);
    expect(Object.keys(field).sort(), 'the one object this block hands the grid').toEqual([
      'addLabel',
      'allowAdd',
      'allowDelete',
      'columns',
      'maxRows',
      'minRows',
      'sortField',
      'totalField',
    ]);
    expect(field).toMatchObject({
      minRows: 1,
      maxRows: 3,
      addLabel: 'Add a line',
      // The detail's `amountField`, the CHILD column summed.
      totalField: 'qty',
      // The map's verdicts on the child (objectui#12082), open with no
      // permission provider: the authored `allowAdd: false` reached nothing.
      allowAdd: true,
      allowDelete: true,
    });
    expect(field.sortField, 'a fully configured detail derives nothing (row 2c)').toBeUndefined();
    expect(gridOf('Lines').displayMode).toBe('grid');
  });

  it('2b. control: with none of the four authored and nothing derived, the same eight keys arrive, the members EMPTY', async () => {
    await mount({ details: [{ childObject: 'po_line', relationshipField: 'po', title: 'Lines', columns: [QTY] }] });
    const field = await waitFor(() => gridOf('Lines').field);
    // The key set first: `toEqual` treats a key holding `undefined` as absent,
    // so on its own it could not tell "eight keys, five empty" from "three keys".
    expect(Object.keys(field).sort()).toEqual([
      'addLabel',
      'allowAdd',
      'allowDelete',
      'columns',
      'maxRows',
      'minRows',
      'sortField',
      'totalField',
    ]);
    expect(field).toEqual({
      columns: [QTY],
      sortField: undefined,
      minRows: undefined,
      maxRows: undefined,
      addLabel: undefined,
      totalField: undefined,
      allowAdd: true,
      allowDelete: true,
    });
  });

  it('2c. `sortField` is no member: a derived detail stamps the child’s sort-named field and a fully configured one stamps none, whatever the detail writes (objectui#11070 round 9)', async () => {
    await mount({
      details: [
        // The lit control: nothing written, and the derivation's pick reaches
        // the grid, so the row below cannot pass on a sort field that never
        // arrives at all.
        { childObject: 'po_step', title: 'Steps' },
        // The same child with a `sortField` naming its OTHER sort-named field.
        { childObject: 'po_step', title: 'Steps, written', sortField: 'line_no' },
        // Fully configured (FK set, every column typed): no child schema is
        // loaded and nothing is derived, so a written `sortField` is the only
        // candidate there is, and it still reaches nothing.
        {
          childObject: 'po_step',
          relationshipField: 'po',
          title: 'Steps, configured',
          columns: [NOTE],
          sortField: 'position',
        },
      ],
    });
    const derived = await waitFor(() => {
      const f = gridOf('Steps').field;
      if (!f.columns?.length) throw new Error('columns not derived yet');
      return f;
    });
    expect(derived.sortField, 'the first of the child’s sort-named fields').toBe('position');
    const written = await waitFor(() => {
      const f = gridOf('Steps, written').field;
      if (!f.columns?.length) throw new Error('columns not derived yet');
      return f;
    });
    expect(written.sortField, 'the detail’s written `sortField` is read by nothing').toBe('position');
    expect(gridOf('Steps, configured').field.sortField, 'nothing derived, and the written one not read').toBeUndefined();
  });

  it('3. `inlineMode` and `formFields` choose the form factor, each arm the other’s control', async () => {
    await mount({
      details: [
        { childObject: 'po_line', relationshipField: 'po', title: 'As a list', columns: [QTY], inlineMode: 'form' },
        {
          childObject: 'po_line',
          relationshipField: 'po',
          title: 'Wider form',
          columns: [QTY],
          formFields: ['qty', 'price'],
        },
        { childObject: 'po_note', relationshipField: 'po', title: 'Cells only', columns: [NOTE], formFields: ['note'] },
      ],
    });
    const list = await waitFor(() => gridOf('As a list'));
    expect(list.displayMode).toBe('list');
    expect(typeof list.onAdd, 'list mode adds through the full form').toBe('function');
    expect(typeof list.onRowExpand, 'list mode edits through the full form').toBe('function');
    expect(list.field.addLabel, 'list mode names its Add action even when the detail’s `addLabel` is unset').toBe('Add');

    const wider = gridOf('Wider form');
    expect(wider.displayMode).toBe('grid');
    expect(typeof wider.onRowExpand, '`formFields` wider than `columns` offers the row form').toBe('function');
    expect(wider.onAdd).toBeUndefined();
    expect(wider.field.addLabel, 'grid mode leaves the label to the grid').toBeUndefined();

    const cells = gridOf('Cells only');
    expect(cells.displayMode).toBe('grid');
    expect(cells.onRowExpand, 'a form no wider than the cells adds nothing to open').toBeUndefined();
  });

  it('4. the atomic batch: lines are creates on `childObject` linked by `relationshipField`, and `totalField` rolls `amountField` onto the PARENT leg', async () => {
    const { container, dataSource } = await mount({
      details: [
        {
          childObject: 'po_line',
          relationshipField: 'po',
          title: 'Lines',
          columns: [QTY],
          amountField: 'qty',
          totalField: 'total_qty',
        },
        // No `totalField`: this collection's lines are written, and it puts
        // nothing on the parent.
        { childObject: 'po_note', relationshipField: 'po', title: 'Notes', columns: [NOTE] },
      ],
    });
    fireEvent.change(container.querySelector('input[name="ref"]')!, { target: { value: 'PO-1' } });
    await fillQty(0, '5');
    await fillQty(1, '7');
    fireEvent.change(screen.getAllByLabelText('Note')[0], { target: { value: 'rush' } });

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = dataSource.batchTransaction.mock.calls[0][0] as Array<Record<string, any>>;

    expect(ops[0]).toMatchObject({ object: 'po', action: 'create' });
    expect(ops[0].data, 'the lines’ `qty` summed onto the parent under `totalField`').toEqual({
      ref: 'PO-1',
      total_qty: 12,
    });
    expect(ops.slice(1)).toEqual([
      { object: 'po_line', action: 'create', data: { qty: 5, po: { $ref: 0 } } },
      { object: 'po_line', action: 'create', data: { qty: 7, po: { $ref: 0 } } },
      { object: 'po_note', action: 'create', data: { note: 'rush', po: { $ref: 0 } } },
    ]);
  });

  it('5. `{ childObject }` alone: the FK and the columns are DERIVED from the child object, and the batch writes the derived FK', async () => {
    const { container, dataSource } = await mount({ details: [{ childObject: 'po_line', title: 'Lines' }] });
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalledWith('po_line'));
    const field = await waitFor(() => {
      const f = gridOf('Lines').field;
      if (!f.columns?.length) throw new Error('columns not derived yet');
      return f;
    });
    expect(
      field.columns.map((c: { name: string }) => c.name),
      'the child’s editable fields, with the FK back to the parent left out',
    ).toEqual(['qty', 'price']);

    fireEvent.change(container.querySelector('input[name="ref"]')!, { target: { value: 'PO-2' } });
    await fillQty(0, '3');
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = dataSource.batchTransaction.mock.calls[0][0] as Array<Record<string, any>>;
    // `toMatchObject`: a derived line also carries the untouched `price` cell
    // as `null`, which is the grid's blank-cell value and not this row's claim.
    expect(ops[1], 'the derived FK is the child field whose `reference` is the parent').toMatchObject({
      object: 'po_line',
      action: 'create',
      data: { qty: 3, po: { $ref: 0 } },
    });
    expect(ops).toHaveLength(2);
  });

  it('6. `edit` mode: each collection’s lines are read from `childObject`, scoped by `relationshipField` to the record, capped at 500', async () => {
    const find = vi.fn(async (object: string) =>
      object === 'po_line' ? { data: [{ id: 'l1', po: 'po1', qty: 4 }] } : { data: [] },
    );
    const findOne = vi.fn().mockResolvedValue({ id: 'po1', ref: 'PO-7' });
    await mount(
      {
        mode: 'edit',
        recordId: 'po1',
        details: [
          { childObject: 'po_line', relationshipField: 'po', title: 'Lines', columns: [QTY] },
          { childObject: 'po_note', relationshipField: 'po', title: 'Notes', columns: [NOTE] },
        ],
      },
      makeDataSource({ find, findOne }),
    );
    // Compared as a SET of distinct calls: the load re-runs once the entries
    // resolve, so each collection is read more than once, and the claim is
    // WHAT each read asks for, not how often it is asked.
    const expected = [
      ['po_line', { $filter: { po: 'po1' }, $top: 500 }],
      ['po_note', { $filter: { po: 'po1' }, $top: 500 }],
    ].map((call) => JSON.stringify(call));
    const distinct = () => [...new Set(find.mock.calls.map((call) => JSON.stringify(call)))].sort();
    await waitFor(() => expect(distinct()).toEqual(expected));
    await waitFor(() => expect(gridOf('Lines').value).toEqual([{ id: 'l1', po: 'po1', qty: 4 }]));
    expect(gridOf('Notes').value).toEqual([]);
  });

  it('7. control: `details: []` renders no section and mounts no grid, and the batch is the parent leg alone', async () => {
    const { container, dataSource } = await mount({ details: [] });
    expect(headings(container)).toEqual([]);
    expect(gridProps).toHaveLength(0);

    fireEvent.change(container.querySelector('input[name="ref"]')!, { target: { value: 'PO-3' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(dataSource.batchTransaction).toHaveBeenCalledTimes(1));
    expect(dataSource.batchTransaction.mock.calls[0][0]).toEqual([
      { object: 'po', action: 'create', data: { ref: 'PO-3' } },
    ]);
  });
});

// ── The member list, held by the compiler (`tsc -p tsconfig.test.json`, this
// package's `type-check`; runtime erases all of it) ──

/** Exact type equality: `true` only when A and B are the same type. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

/** The spec's own `details` entry, on its authoring face (objectui#11396). */
type SpecDetailEntry = NonNullable<ObjectMasterDetailFormProps['details']>[number];

/**
 * The config IS the spec's entry minus `sortField`, by reference
 * (objectui#11396): a member the spec adds, drops or retypes lands on the
 * config with no hand edit, and a hand-written restatement that drifts is red
 * here before it is red anywhere else. The installed 18.1.0 entry carries a
 * `retiredKey()` tombstone for `sortField` (objectstack-ai/objectstack#21589);
 * 17.6.0 declared it as a string, and the subtraction removes the key either
 * way. ⛔ No row here pins which of the two shapes the spec has; the `Spec Main
 * Shape Gate` compiles this file against objectstack `main`, so such a row is
 * red there the day the two differ. The runtime pin in `@object-ui/types`
 * (`object-master-detail-form-details-entry-11396.test.ts`) records
 * `sortField` as REFUSED, with the spec's retired-key message, since the
 * 17.7.0 bump (objectui#11717).
 */
const derivedFromSpec: Equal<MasterDetailDetailConfig, Omit<SpecDetailEntry, 'sortField'>> = true;

/** A `columns` entry is the spec's inline grid column, the type the line grid reads. */
const columnsAreTheGridColumn: Equal<NonNullable<MasterDetailDetailConfig['columns']>[number], GridColumn> = true;

/**
 * Every member a detail can be authored with, spelled out: the spec entry's
 * keys minus `sortField` (objectui#11070 round 9). A key the spec adds is a
 * red row here, never a silent widening of what this block is said to read.
 */
const memberList: Equal<
  keyof MasterDetailDetailConfig,
  | 'childObject'
  | 'relationshipField'
  | 'columns'
  | 'formFields'
  | 'inlineMode'
  | 'amountField'
  | 'totalField'
  | 'title'
  | 'minRows'
  | 'maxRows'
  | 'addLabel'
> = true;

/** The lit control for the directive below: the same literal without the retired member compiles. */
const authoredDetail: MasterDetailDetailConfig = { childObject: 'po_step', amountField: 'qty' };
// @ts-expect-error objectui#11070 round 9: `sortField` is retired as a detail member; the sort field is derived from the child object. This face leaves it off on purpose (objectui#11396), and the spec retired it too in 17.7.0 (objectstack-ai/objectstack#21589).
const retiredSortField: MasterDetailDetailConfig = { childObject: 'po_step', sortField: 'line_no' };
void [derivedFromSpec, columnsAreTheGridColumn, memberList, authoredDetail, retiredSortField];
