/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A master-detail form takes no input into its lines, and sends no second
 * batch, while its save is in flight (objectui#10631).
 *
 * Two defects shared that one theme:
 *
 * - **The Save guard released on a timer.** `handleSave` armed a 1.5 s timer
 *   that re-enabled Save whatever the batch was doing. A batch slower than that
 *   left Save clickable, and a second click built a second batch from the same
 *   baseline: two records written.
 * - **The grid stayed editable.** objectui#10564 gives a row the id its create
 *   echoed by identity with the row object the batch was built from. A grid
 *   with a sort field maps EVERY row to a new object on any change, so one
 *   keystroke during a slow save left every line that save created without its
 *   id, and the next save deleted and re-created them all.
 *
 * Every row drives the real `MasterDetailForm` with the real line-item grid and
 * the real payload sanitizer. The batch double holds its FIRST call until the
 * test lands or fails it, so "slower than the old guard" is a fact of the test,
 * not a race; later calls answer at once, per the `batchTransaction` contract
 * (results index-aligned with the operations, a create echoing the record under
 * a freshly minted id).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const PO_SCHEMA = { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } };
const LINE_SCHEMA = {
  name: 'po_line',
  fields: {
    qty: { type: 'number', label: 'Qty' },
    note: { type: 'text', label: 'Note' },
    po: { type: 'master_detail', label: 'PO', reference: 'po' },
  },
};
/** The same child with a `line_no` field: the grid derives it as its sort field. */
const SORTED_LINE_SCHEMA = {
  name: 'po_line',
  fields: {
    qty: { type: 'number', label: 'Qty' },
    line_no: { type: 'number', label: 'Line No' },
    po: { type: 'master_detail', label: 'PO', reference: 'po' },
  },
};

/** A detail whose FK and typed columns are authored: no derive, no sort field. */
const PLAIN_DETAIL = {
  childObject: 'po_line',
  relationshipField: 'po',
  columns: [{ name: 'qty', label: 'Qty', type: 'number' }],
};

type Op = { object: string; action?: string; id?: string; data?: Record<string, any> };

/**
 * A batch whose FIRST call is held until the test calls `land()` or `fail()`.
 * Every later call answers at once.
 */
function heldBatch() {
  let minted = 0;
  const echo = (ops: Op[]) => ({
    results: ops.map((op) => {
      if (op.action === 'create') return { id: `new${++minted}`, ...op.data };
      if (op.action === 'delete') return true;
      return { id: op.id, ...op.data };
    }),
  });
  let settle: { land: () => void; fail: (err: Error) => void } | null = null;
  const batch = vi.fn((ops: Op[]) => {
    if (batch.mock.calls.length === 1) {
      return new Promise<ReturnType<typeof echo>>((resolve, reject) => {
        settle = { land: () => resolve(echo(ops)), fail: reject };
      });
    }
    return Promise.resolve(echo(ops));
  });
  return {
    batch,
    land: () => settle!.land(),
    fail: (err: Error) => settle!.fail(err),
  };
}

function renderForm(opts: {
  mode?: 'create' | 'edit';
  lines?: Record<string, any>[];
  batchTransaction: any;
  lineSchema?: Record<string, any>;
  parentSchema?: Record<string, any>;
  detail?: Record<string, any>;
}) {
  const mode = opts.mode ?? 'edit';
  const lines = opts.lines ?? [];
  const lineSchema = opts.lineSchema ?? LINE_SCHEMA;
  const parentSchema = opts.parentSchema ?? PO_SCHEMA;
  // A host that keeps the form mounted after the save (no navigation).
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const ds: any = {
    getObjectSchema: vi.fn(async (o: string) => (o === 'po_line' ? lineSchema : parentSchema)),
    findOne: vi.fn().mockResolvedValue({ id: 'po1', ref: 'PO-1' }),
    find: vi.fn(async (o: string) => ({ data: o === 'po_line' ? lines.map((l) => ({ ...l })) : [] })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchTransaction: opts.batchTransaction,
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
        details: [opts.detail ?? PLAIN_DETAIL],
      } as any}
      dataSource={ds}
    />,
  );
  return { ...view, ds, onSuccess, onError };
}

const saveButton = () => screen.getByTestId('md-form-submit') as HTMLButtonElement;
const qtyInputs = () => screen.getAllByLabelText('Qty') as HTMLInputElement[];
const refInput = (container: HTMLElement) => container.querySelector('input[name="ref"]') as HTMLInputElement;

/** The parent form has its values and the stored lines have landed. */
async function ready(container: HTMLElement, mode: 'create' | 'edit', storedLines: number) {
  await waitFor(() => {
    const ref = refInput(container);
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

const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

/** Let real time run past the 1.5 s the old guard re-armed Save after. */
const pastTheOldGuard = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 1700));
  });

/** Long enough for a second click's deferred submit to reach the batch. */
const aBeat = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });

/** Press Save and wait until the attempt has settled, whatever its outcome. */
async function save(calls: () => number) {
  const before = calls();
  await click(saveButton());
  await waitFor(() => expect(calls()).toBeGreaterThan(before));
  await waitFor(() => expect(saveButton().disabled).toBe(false));
}

/** The child operations of the batch sent on save number `n` (0-based). */
const childOps = (batch: any, n: number): Op[] => (batch.mock.calls[n][0] as Op[]).slice(1);

/** No line of the grid takes input: every cell is disabled, and there is no ghost row, add or remove. */
function expectGridInert(lines: number) {
  expect(qtyInputs()).toHaveLength(lines);
  for (const input of qtyInputs()) expect(input.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Remove row' })).toBeNull();
  expect(screen.queryByTestId('line-items-add')).toBeNull();
}

describe('the Save guard holds until the batch settles, not for 1.5 s', () => {
  it('edit mode: Save stays disabled through a batch slower than the old guard, and a second click sends no second batch', async () => {
    const { batch, land } = heldBatch();
    const { container, onSuccess } = renderForm({ batchTransaction: batch });
    await ready(container, 'edit', 0);

    await change(qtyInputs()[0], '5');
    await click(saveButton());
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));

    await pastTheOldGuard();
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().textContent).toBe('Saving…');
    await click(saveButton());
    await aBeat();
    expect(batch).toHaveBeenCalledTimes(1);

    await act(async () => {
      land();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(batch).toHaveBeenCalledTimes(1);

    // The one record exists once, under its echoed id: nothing left to send.
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 1)).toEqual([]);
  });

  it('a failed batch re-arms Save, the refusal shows, and the retry sends the same batch', async () => {
    const { batch, fail } = heldBatch();
    const { container, onSuccess, onError } = renderForm({ batchTransaction: batch });
    await ready(container, 'edit', 0);

    await change(qtyInputs()[0], '5');
    await click(saveButton());
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    await pastTheOldGuard();
    expect(saveButton().disabled).toBe(true);

    await act(async () => {
      fail(new Error('The server refused the batch'));
    });
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(await screen.findByText('The server refused the batch')).toBeTruthy();
    // The grid takes input again after a failure, too.
    expect(qtyInputs()).toHaveLength(2);
    expect(qtyInputs()[0].disabled).toBe(false);

    await save(() => batch.mock.calls.length);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[1][0]).toEqual(batch.mock.calls[0][0]);
  });

  it('a submit the header validation blocks never reaches the batch: Save re-arms after a beat, as the old guard intended', async () => {
    const { batch } = heldBatch();
    const { container } = renderForm({
      mode: 'create',
      batchTransaction: batch,
      parentSchema: { name: 'po', fields: { ref: { type: 'text', label: 'Ref', required: true } } },
    });
    await ready(container, 'create', 0);

    await change(qtyInputs()[0], '5'); // the required header field stays empty
    await click(saveButton());
    expect(saveButton().disabled).toBe(true);
    await pastTheOldGuard();
    expect(batch).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);

    await change(refInput(container), 'PO-9');
    await click(saveButton());
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
  });

  it('create mode: the guard holds the same way', async () => {
    const { batch, land } = heldBatch();
    const { container, onSuccess } = renderForm({ mode: 'create', batchTransaction: batch });
    await ready(container, 'create', 0);

    await change(refInput(container), 'PO-9');
    await change(qtyInputs()[0], '5');
    await click(saveButton());
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));

    await pastTheOldGuard();
    expect(saveButton().disabled).toBe(true);
    expectGridInert(1);
    await click(saveButton());
    await aBeat();
    expect(batch).toHaveBeenCalledTimes(1);

    await act(async () => {
      land();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    // Cleared for the next entry, and still exactly one create.
    await waitFor(() => expect(qtyInputs()).toHaveLength(1));
    await waitFor(() => expect(refInput(container).value).toBe(''));
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('a save started by submitting the header form (not the Save button) holds the form, and a second submit sends no second batch', async () => {
    const { batch, land } = heldBatch();
    const { container, onSuccess, onError } = renderForm({ batchTransaction: batch });
    await ready(container, 'edit', 0);

    await change(qtyInputs()[0], '5');
    // The header form is the first <form>: an implicit submission (Enter in a
    // header that has a single text input) reaches it without the Save button.
    const headerForm = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      fireEvent.submit(headerForm);
    });
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    expect(saveButton().disabled).toBe(true);
    expectGridInert(1);

    await act(async () => {
      fireEvent.submit(headerForm);
    });
    await aBeat();
    expect(batch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    // The refused submit is not the in-flight batch's outcome: it releases nothing.
    expect(saveButton().disabled).toBe(true);

    await act(async () => {
      land();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(batch).toHaveBeenCalledTimes(1);
  });
});

describe('the lines take no input while the save is in flight, so the created lines keep their ids', () => {
  async function createTwoLinesAndHoldTheSave(detail: Record<string, any>, lineSchema: Record<string, any>) {
    const held = heldBatch();
    const view = renderForm({ batchTransaction: held.batch, detail, lineSchema });
    await ready(view.container, 'edit', 0);
    await change(qtyInputs()[0], '5');
    await change(qtyInputs()[1], '7'); // the new ghost row
    await click(saveButton());
    await waitFor(() => expect(held.batch).toHaveBeenCalledTimes(1));
    return { ...held, ...view };
  }

  it('a sort-field child (`line_no`): the grid is disabled during the save, and the next save sends no delete-and-create', async () => {
    // `line_no` is derived as the grid's sort field, so every grid change maps
    // every row to a new object.
    const { batch, land, onSuccess } = await createTwoLinesAndHoldTheSave(
      { childObject: 'po_line' },
      SORTED_LINE_SCHEMA,
    );
    expect(childOps(batch, 0)).toEqual([
      { object: 'po_line', action: 'create', data: { qty: 5, line_no: 0, po: 'po1' } },
      { object: 'po_line', action: 'create', data: { qty: 7, line_no: 1, po: 'po1' } },
    ]);

    expectGridInert(2);
    const user = userEvent.setup();
    await user.type(qtyInputs()[1], '9');
    expect(qtyInputs()[1].value).toBe('7');

    await act(async () => {
      land();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await waitFor(() => expect(qtyInputs()).toHaveLength(3)); // the ghost row is back
    expect(qtyInputs()[1].disabled).toBe(false);

    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 1)).toEqual([]);

    // Both lines are records now: an edit is an update by the echoed id.
    await change(qtyInputs()[1], '8');
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 2)).toEqual([
      { object: 'po_line', action: 'update', id: 'new2', data: { qty: 8 } },
    ]);
  });

  it('the same without a sort field (control)', async () => {
    const { batch, land, onSuccess } = await createTwoLinesAndHoldTheSave(PLAIN_DETAIL, LINE_SCHEMA);
    expect(childOps(batch, 0)).toEqual([
      { object: 'po_line', action: 'create', data: { qty: 5, po: 'po1' } },
      { object: 'po_line', action: 'create', data: { qty: 7, po: 'po1' } },
    ]);

    expectGridInert(2);
    const user = userEvent.setup();
    await user.type(qtyInputs()[1], '9');
    expect(qtyInputs()[1].value).toBe('7');

    await act(async () => {
      land();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    await waitFor(() => expect(qtyInputs()).toHaveLength(3));

    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 1)).toEqual([]);

    await change(qtyInputs()[1], '8');
    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 2)).toEqual([
      { object: 'po_line', action: 'update', id: 'new2', data: { qty: 8 } },
    ]);
  });

  it('an open row editor cannot apply to a line while the save is in flight; applied after it lands, the line keeps its id', async () => {
    const { batch, land, onSuccess } = await createTwoLinesAndHoldTheSave(
      // The row form carries a field the grid does not, so each row offers "expand".
      { ...PLAIN_DETAIL, formFields: ['qty', 'note'] },
      LINE_SCHEMA,
    );
    // The expand control is the one grid control `disabled` does not remove;
    // the editor it opens is held by the save instead.
    await click(screen.getByTestId('line-items-expand-1'));
    const editor = await screen.findByTestId('md-row-form');
    const note = await waitFor(() => {
      const el = editor.querySelector('input[name="note"]') as HTMLInputElement | null;
      if (!el) throw new Error('row editor not ready');
      return el;
    });
    const apply = within(editor).getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    expect(note).toBeDisabled();

    const user = userEvent.setup();
    await user.click(apply);
    expect(screen.getByTestId('md-row-form')).toBeTruthy(); // not applied, still open

    await act(async () => {
      land();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apply).not.toBeDisabled());

    await change(note, 'rush');
    await click(apply);
    await waitFor(() => expect(screen.queryByTestId('md-row-form')).toBeNull());

    await save(() => batch.mock.calls.length);
    expect(childOps(batch, 1)).toEqual([
      { object: 'po_line', action: 'update', id: 'new2', data: { note: 'rush' } },
    ]);
  });
});

describe('the header stays editable during the save: its edits are not lost (objectui#10631, A3)', () => {
  it('edit mode: a header edit made while the save is in flight is sent by the next save', async () => {
    const { batch, land } = heldBatch();
    const { container, onSuccess } = renderForm({ batchTransaction: batch });
    await ready(container, 'edit', 0);

    await change(refInput(container), 'PO-2');
    await click(saveButton());
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    expect(batch.mock.calls[0][0][0]).toEqual({ object: 'po', action: 'update', id: 'po1', data: { ref: 'PO-2' } });

    await change(refInput(container), 'PO-3');
    await act(async () => {
      land();
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(refInput(container).value).toBe('PO-3');

    await save(() => batch.mock.calls.length);
    expect(batch.mock.calls[1][0][0]).toEqual({ object: 'po', action: 'update', id: 'po1', data: { ref: 'PO-3' } });
  });
});
