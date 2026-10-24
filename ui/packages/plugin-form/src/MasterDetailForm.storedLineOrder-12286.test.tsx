/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A master-detail edit opens its lines in STORED order, and its save writes
 * only the lines that changed (objectui#12286).
 *
 * Two halves, and each alone leaves a case:
 *
 * - **Read.** The lines were read with no sort, so the grid drew the server's
 *   order. The grid stamps each line's index into the child's sort field, so
 *   the next renumber wrote that arbitrary order over the stored one: an
 *   untouched line was written, its position swapped. The read now asks for
 *   the lines ascending by the derived sort field, the record id breaking ties.
 * - **Write.** The grid renumbered on every change, a cell edit included. On
 *   lines whose stored positions are tied or empty, even a read in stored order
 *   gives them new positions, so editing one cell wrote every line. A cell
 *   edit now renumbers nothing; adding, removing and moving a line still do,
 *   and the save (which already sent only the fields that differ from the read,
 *   objectui#10108) sends a line only when one of its values moved.
 *
 * Every row drives the real `MasterDetailForm` with the real line grid. The
 * fixture is the showcase invoice line's shape (a `position` number field that
 * is not a column, identity-only inline columns, as `attachInlineSubforms`
 * builds them), and the data source is a fake SERVER: it returns the lines in
 * its own order, which is not the stored order, unless the read asks for one,
 * and it reads only the `$orderby` form the form sends, so a read in another
 * shape fails loudly rather than passing unsorted.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const INV_SCHEMA = { name: 'inv', fields: { ref: { type: 'text', label: 'Ref' } } };
const LINE_SCHEMA = {
  name: 'inv_line',
  fields: {
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'inv', inlineEdit: 'grid' },
    // Derived as the grid's sort field (its name is `position`); never a column.
    position: { type: 'number', label: 'Position', defaultValue: 0 },
    description: { type: 'text', label: 'Description' },
    quantity: { type: 'number', label: 'Qty' },
  },
};
/** What `attachInlineSubforms` builds for a relationship field with identity-only `inlineColumns`. */
const DETAIL = {
  childObject: 'inv_line',
  relationshipField: 'invoice',
  inlineMode: 'grid',
  title: 'Line Items',
  columns: [{ name: 'description' }, { name: 'quantity' }],
};

type Row = Record<string, unknown>;
type Op = { object: string; action?: string; id?: string; data?: Record<string, unknown> };
type Sort = Array<{ field: string; order?: 'asc' | 'desc' }>;

/** Order rows by an `$orderby` array, as a server does; nulls sort first ascending (SQLite's order). */
function serverOrder(rows: Row[], orderby: unknown): Row[] {
  if (orderby === undefined) return rows;
  if (!Array.isArray(orderby) || orderby.some((s) => typeof s !== 'object')) {
    throw new Error(`fake server: unread $orderby shape ${JSON.stringify(orderby)}`);
  }
  return [...rows].sort((a, b) => {
    for (const { field, order } of orderby as Sort) {
      const av = a[field] as number | string | null | undefined;
      const bv = b[field] as number | string | null | undefined;
      if (av === bv || (av == null && bv == null)) continue;
      const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1;
      return order === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

/** The two members of a read's query the fake server answers. */
type ReadParams = { $filter?: { invoice?: unknown }; $orderby?: unknown } | undefined;

/** Mount an edit form over `table`, the server's lines in the server's own order. */
function renderForm(table: Row[]) {
  const batch = vi.fn(async (ops: Op[]) => ({
    results: ops.map((op) => (op.action === 'delete' ? true : { id: op.id ?? 'new', ...op.data })),
  }));
  const ds = {
    getObjectSchema: vi.fn(async (o: string) => (o === 'inv_line' ? LINE_SCHEMA : INV_SCHEMA)),
    findOne: vi.fn().mockResolvedValue({ id: 'inv1', ref: 'INV-1' }),
    find: vi.fn(async (o: string, params: ReadParams) =>
      o === 'inv_line'
        ? {
            data: serverOrder(
              table.filter((r) => r.invoice === params?.$filter?.invoice),
              params?.$orderby,
            ).map((r) => ({ ...r })),
          }
        : { data: [] },
    ),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchTransaction: batch,
  };
  const view = render(
    <MasterDetailForm
      schema={{ objectName: 'inv', mode: 'edit', recordId: 'inv1', fields: ['ref'], details: [DETAIL] } as never}
      dataSource={ds as never}
    />,
  );
  return { ...view, ds, batch };
}

type FakeServer = ReturnType<typeof renderForm>['ds'];

const descriptions = () => screen.getAllByLabelText('Description') as HTMLInputElement[];
const qtys = () => screen.getAllByLabelText('Qty') as HTMLInputElement[];
const saveButton = () => screen.getByTestId('md-form-submit') as HTMLButtonElement;
/** The query of each read of the lines, in the order they were sent. */
const lineReads = (ds: FakeServer): ReadParams[] =>
  ds.find.mock.calls.filter(([o]) => o === 'inv_line').map(([, params]) => params);

/**
 * The parent record and `lines` stored lines have landed (plus the grid's
 * trailing entry row), from the read sent once the detail RESOLVED. The lines
 * are read twice: once on mount, before the child schema has loaded and the
 * sort field is derived, and again once it has; the second read supersedes the
 * first. Waiting for both keeps a pin from reading the first one's rows.
 */
async function ready(container: HTMLElement, ds: FakeServer, lines: number) {
  await waitFor(() => {
    const ref = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
    expect(ref?.value).toBe('INV-1');
  });
  await waitFor(() => expect(lineReads(ds).length).toBeGreaterThanOrEqual(2));
  await act(async () => {});
  await waitFor(() => expect(descriptions()).toHaveLength(lines + 1));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

/** The order the grid draws: each stored line's description, the entry row left off. */
const drawn = () => descriptions().slice(0, -1).map((el) => el.value);

/** Save, and return the batch's child operations. */
async function saveChildOps(batch: ReturnType<typeof renderForm>['batch']): Promise<Op[]> {
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
  return (batch.mock.calls[0][0] as Op[]).slice(1);
}

/** The invoice's two lines; the server returns Widget first, and Consulting is stored first. */
const TWO_LINES: Row[] = [
  { id: 'l2', invoice: 'inv1', description: 'Widget A units', quantity: 4, position: 1 },
  { id: 'l1', invoice: 'inv1', description: 'Consulting hours', quantity: 10, position: 0 },
];

describe('a master-detail edit opens its lines in stored order and writes only what changed (objectui#12286)', () => {
  it('the grid opens in stored order when the server returns another, and the read asks for it', async () => {
    const { container, ds } = renderForm(TWO_LINES);
    await ready(container, ds, 2);
    expect(drawn()).toEqual(['Consulting hours', 'Widget A units']);
    // The read whose rows the grid holds: ascending by the derived sort field,
    // the record id breaking ties.
    expect(lineReads(ds).at(-1)).toEqual({
      $filter: { invoice: 'inv1' },
      $orderby: [
        { field: 'position', order: 'asc' },
        { field: 'id', order: 'asc' },
      ],
      $top: 500,
    });
  });

  it("editing one line's field sends exactly one update, and it carries no position", async () => {
    const { container, ds, batch } = renderForm(TWO_LINES);
    await ready(container, ds, 2);
    await act(async () => {
      fireEvent.change(qtys()[0], { target: { value: '11' } });
    });
    expect(await saveChildOps(batch)).toEqual([
      { object: 'inv_line', action: 'update', id: 'l1', data: { quantity: 11 } },
    ]);
  });

  it('moving one line sends only the lines whose position changed', async () => {
    const { container, ds, batch } = renderForm([
      { id: 'c', invoice: 'inv1', description: 'C', quantity: 3, position: 2 },
      { id: 'a', invoice: 'inv1', description: 'A', quantity: 1, position: 0 },
      { id: 'b', invoice: 'inv1', description: 'B', quantity: 2, position: 1 },
    ]);
    await ready(container, ds, 3);
    expect(drawn()).toEqual(['A', 'B', 'C']);
    // Drag line 3 (C) onto line 2 (B): A stays at 0, C and B swap.
    const target = screen.getByTestId('line-items-drag-1').closest('tr')!;
    await act(async () => {
      fireEvent.dragStart(screen.getByTestId('line-items-drag-2'));
      fireEvent.dragOver(target);
      fireEvent.drop(target);
    });
    expect(drawn()).toEqual(['A', 'C', 'B']);
    expect(await saveChildOps(batch)).toEqual([
      { object: 'inv_line', action: 'update', id: 'c', data: { position: 1 } },
      { object: 'inv_line', action: 'update', id: 'b', data: { position: 2 } },
    ]);
  });

  it.each([
    ['tied', 0],
    ['empty', null],
  ])('%s positions: the lines open in id order, and editing one sends that line alone', async (_label, position) => {
    const { container, ds, batch } = renderForm([
      { id: 'l2', invoice: 'inv1', description: 'Second', quantity: 2, position },
      { id: 'l1', invoice: 'inv1', description: 'First', quantity: 1, position },
    ]);
    await ready(container, ds, 2);
    expect(drawn()).toEqual(['First', 'Second']);
    await act(async () => {
      fireEvent.change(qtys()[1], { target: { value: '5' } });
    });
    expect(await saveChildOps(batch)).toEqual([
      { object: 'inv_line', action: 'update', id: 'l2', data: { quantity: 5 } },
    ]);
  });
});
