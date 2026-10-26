/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A master-detail EDIT form that stays mounted after a save diffs its next
 * save against the child rows as they now stand on the server, not as first
 * read (objectui#10564).
 *
 * The child-row twin of the parent-record baseline advance (objectui#10156,
 * `advanceLoadedRecord`). Every row drives the real `MasterDetailForm` with the
 * real line-item grid, and a host `onSuccess` that stays on the form — the
 * only kind of host for which a second save from the same mounted form exists.
 *
 * The batch double answers the way the `batchTransaction` contract says a
 * server does: `results` index-aligned with the operations, a create echoing
 * the written record with the id the server minted.
 *
 * Two of these rows cannot go red on the pre-fix component, and are here for
 * the fix, not for the defect: a FAILED save must leave both baselines where
 * they were (a baseline that advanced on a write that did not land would drop
 * that write from the retry), and create mode's reset is the control.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const PO_SCHEMA = { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } };
const LINE_SCHEMA = {
  name: 'po_line',
  fields: {
    qty: { type: 'number', label: 'Qty' },
    po: { type: 'master_detail', label: 'PO', reference: 'po' },
  },
};

type Op = { object: string; action?: string; id?: string; data?: Record<string, any> };

/**
 * A batch that answers per the contract: creates echo the written record under
 * a freshly minted id, updates echo the record, deletes echo `true`.
 */
function echoBatch() {
  let minted = 0;
  return vi.fn(async (ops: Op[]) => ({
    results: ops.map((op) => {
      if (op.action === 'create') return { id: `new${++minted}`, ...op.data };
      if (op.action === 'delete') return true;
      return { id: op.id, ...op.data };
    }),
  }));
}

function renderForm(opts: {
  mode?: 'create' | 'edit';
  lines?: Record<string, any>[];
  batchTransaction?: any;
  ds?: Record<string, any>;
}) {
  const mode = opts.mode ?? 'edit';
  const lines = opts.lines ?? [];
  // A host that keeps the form mounted after the save (no navigation).
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const ds: any = {
    getObjectSchema: vi.fn(async (o: string) => (o === 'po_line' ? LINE_SCHEMA : PO_SCHEMA)),
    findOne: vi.fn().mockResolvedValue({ id: 'po1', ref: 'PO-1' }),
    find: vi.fn(async (o: string) => ({ data: o === 'po_line' ? lines.map((l) => ({ ...l })) : [] })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ...(opts.batchTransaction ? { batchTransaction: opts.batchTransaction } : {}),
    ...opts.ds,
  };
  const view = render(
    <MasterDetailForm
      schema={{
        objectName: 'po',
        mode,
        ...(mode === 'edit' ? { recordId: 'po1' } : {}),
        fields: ['ref'],
        onSuccess,
        onError,
        details: [
          {
            childObject: 'po_line',
            relationshipField: 'po',
            columns: [{ name: 'qty', label: 'Qty', type: 'number' } as any],
          },
        ],
      } as any}
      dataSource={ds}
    />,
  );
  return { ...view, ds, onSuccess, onError };
}

const saveButton = () => screen.getByTestId('md-form-submit') as HTMLButtonElement;
const qtyInputs = () => screen.getAllByLabelText('Qty') as HTMLInputElement[];

/** The parent form has its values and the stored lines have landed. */
async function ready(container: HTMLElement, mode: 'create' | 'edit', storedLines: number) {
  await waitFor(() => {
    const ref = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
    if (!ref) throw new Error('parent form not ready');
    if (mode === 'edit' && ref.value !== 'PO-1') throw new Error('parent record not loaded');
  });
  // Every stored line plus the grid's trailing ghost row.
  await waitFor(() => expect(qtyInputs()).toHaveLength(storedLines + 1));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

const change = async (el: HTMLElement, value: string) => {
  await act(async () => {
    fireEvent.change(el, { target: { value } });
  });
};

/** Press Save and wait until the attempt has settled, whatever its outcome. */
async function save(calls: () => number) {
  const before = calls();
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await waitFor(() => expect(calls()).toBeGreaterThan(before));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

/** The child operations of the batch sent on save number `n` (0-based). */
const childOps = (batch: any, n: number): Op[] => (batch.mock.calls[n][0] as Op[]).slice(1);

describe('a mounted master-detail edit form: the next save diffs against what the last save wrote', () => {
  it('a row the first save created is not created again, and a later edit updates it by its new id', async () => {
    const batch = echoBatch();
    const { container, onSuccess } = renderForm({ batchTransaction: batch });
    await ready(container, 'edit', 0);

    await change(qtyInputs()[0], '5'); // type into the ghost row
    await save(() => batch.mock.calls.length);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(childOps(batch, 0)).toEqual([
      { object: 'po_line', action: 'create', data: { qty: 5, po: 'po1' } },
    ]);

    // Nothing changed: no child operation at all — not a second create.
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 1)).toEqual([]);
    expect(qtyInputs()).toHaveLength(2); // the one line, and the ghost row

    // The created row carries the server's id now: editing it is an update.
    await change(qtyInputs()[0], '6');
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 2)).toEqual([
      { object: 'po_line', action: 'update', id: 'new1', data: { qty: 6 } },
    ]);
  });

  it('a cell changed and then changed back to its first-read value is written, not dropped', async () => {
    const batch = echoBatch();
    const { container } = renderForm({
      batchTransaction: batch,
      lines: [{ id: 'L1', qty: 1, po: 'po1' }],
    });
    await ready(container, 'edit', 1);
    expect(qtyInputs()[0].value).toBe('1');

    await change(qtyInputs()[0], '2');
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 0)).toEqual([
      { object: 'po_line', action: 'update', id: 'L1', data: { qty: 2 } },
    ]);

    await change(qtyInputs()[0], '1');
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 1)).toEqual([
      { object: 'po_line', action: 'update', id: 'L1', data: { qty: 1 } },
    ]);
  });

  it('a created row edited while its save was in flight is not duplicated: the next save replaces the created record', async () => {
    const echo = echoBatch();
    let land: () => void = () => {};
    const batch = vi.fn(async (ops: Op[]) => {
      if (batch.mock.calls.length === 1) await new Promise<void>((r) => { land = r; });
      return echo(ops);
    });
    const { container, onSuccess } = renderForm({ batchTransaction: batch });
    await ready(container, 'edit', 0);

    await change(qtyInputs()[0], '5');
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    await change(qtyInputs()[0], '8'); // the batch has not answered yet
    await act(async () => {
      land();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));

    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 1)).toEqual([
      { object: 'po_line', action: 'create', data: { qty: 8, po: 'po1' } },
      { object: 'po_line', action: 'delete', id: 'new1' },
    ]);
  });

  it('a row the first save deleted is not deleted again', async () => {
    const batch = echoBatch();
    const { container } = renderForm({
      batchTransaction: batch,
      lines: [
        { id: 'L1', qty: 1, po: 'po1' },
        { id: 'L2', qty: 2, po: 'po1' },
      ],
    });
    await ready(container, 'edit', 2);

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove row' })[1]);
    });
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 0)).toEqual([{ object: 'po_line', action: 'delete', id: 'L2' }]);

    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 1)).toEqual([]);
  });
});

describe('a FAILED save advances neither baseline: the retry carries every operation again', () => {
  it('a refused batch: the retry sends the same parent and child operations', async () => {
    const echo = echoBatch();
    const batch = vi.fn(async (ops: Op[]) => {
      if (batch.mock.calls.length === 1) throw new Error('BATCH_ERROR: rolled back');
      return echo(ops);
    });
    const { container, onSuccess, onError } = renderForm({
      batchTransaction: batch,
      lines: [{ id: 'L1', qty: 1, po: 'po1' }],
    });
    await ready(container, 'edit', 1);

    await change(container.querySelector('input[name="ref"]') as HTMLElement, 'PO-2');
    await change(qtyInputs()[0], '2');
    await change(qtyInputs()[1], '7'); // the ghost row
    await save(() => batch.mock.calls.length);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    const first = batch.mock.calls[0][0];
    expect(first).toEqual([
      { object: 'po', action: 'update', id: 'po1', data: { ref: 'PO-2' } },
      { object: 'po_line', action: 'create', data: { qty: 7, po: 'po1' } },
      { object: 'po_line', action: 'update', id: 'L1', data: { qty: 2 } },
    ]);

    // The retry is the same batch: nothing was taken as written.
    await save(() => batch.mock.calls.length);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[1][0]).toEqual(first);

    // And once the retry has landed, a third save carries no child operation.
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 2)).toEqual([]);
  });

  it('a partially applied save (no atomic endpoint: the parent write landed, a child write failed) advances neither', async () => {
    let failChildCreate = true;
    let minted = 0;
    const create = vi.fn(async (object: string, data: any) => {
      if (object === 'po_line' && failChildCreate) {
        failChildCreate = false;
        throw new Error('child create failed');
      }
      return { id: `new${++minted}`, ...data };
    });
    const update = vi.fn(async (_o: string, id: string, data: any) => ({ id, ...data }));
    const del = vi.fn(async () => true);
    // No `batchTransaction`: the emulation runs the operations one by one.
    const { container, onSuccess, onError } = renderForm({
      lines: [{ id: 'L1', qty: 1, po: 'po1' }],
      ds: { create, update, delete: del },
    });
    await ready(container, 'edit', 1);

    await change(container.querySelector('input[name="ref"]') as HTMLElement, 'PO-2');
    await change(qtyInputs()[0], '2');
    await change(qtyInputs()[1], '7');
    await save(() => create.mock.calls.length);
    expect(onError).toHaveBeenCalledTimes(1);
    // The parent write went through before the child create failed.
    expect(update.mock.calls).toEqual([['po', 'po1', { ref: 'PO-2' }]]);

    await save(() => create.mock.calls.length);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    // The retry re-sends the parent write AND both child writes.
    expect(update.mock.calls.slice(1)).toEqual([
      ['po', 'po1', { ref: 'PO-2' }],
      ['po_line', 'L1', { qty: 2 }],
    ]);
    expect(create.mock.calls[1]).toEqual(['po_line', { qty: 7, po: 'po1' }]);
  });
});

describe('create mode is unchanged (control)', () => {
  it('a successful create still empties the lines and the header for the next entry', async () => {
    const batch = echoBatch();
    const { container, onSuccess } = renderForm({ mode: 'create', batchTransaction: batch });
    await ready(container, 'create', 0);

    await change(container.querySelector('input[name="ref"]') as HTMLElement, 'PO-9');
    await change(qtyInputs()[0], '5');
    await save(() => batch.mock.calls.length);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toEqual([
      { object: 'po', action: 'create', data: { ref: 'PO-9' } },
      { object: 'po_line', action: 'create', data: { qty: 5, po: { $ref: 0 } } },
    ]);

    // Lines back to the lone ghost row, header cleared.
    await waitFor(() => expect(qtyInputs()).toHaveLength(1));
    expect(qtyInputs()[0].value).toBe('');
    await waitFor(() =>
      expect((container.querySelector('input[name="ref"]') as HTMLInputElement).value).toBe(''),
    );

    // The next entry is a new document: its create carries no line.
    await change(container.querySelector('input[name="ref"]') as HTMLElement, 'PO-10');
    await save(() => batch.mock.calls.length);
    expect(batch.mock.calls[1][0]).toEqual([
      { object: 'po', action: 'create', data: { ref: 'PO-10' } },
    ]);
  });
});
