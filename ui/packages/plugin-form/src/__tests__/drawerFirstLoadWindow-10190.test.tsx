/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DrawerForm` offers no editable form for a record whose FIRST read has not
 * landed (objectui#10190).
 *
 * The drawer already refused this for a record SWAP (`recordSwapLoading.test.tsx`)
 * but not for the first load: the fetch effect and the fields effect both key
 * on `objectSchema`, so the commit that publishes the schema runs both — the
 * fetch effect enters the loading state and fires `findOne`, and the fields
 * effect, declared after it, used to end the loading state unconditionally.
 * The form painted empty and editable while the read was in flight, and the
 * record landing replaced whatever had been typed: the value was gone from the
 * screen and from the submit, with no warning and no dirty flag.
 *
 * `findOne` is held open here by the test, so the window is deterministic
 * rather than a race against the worker's load — which is how it surfaced, as
 * an order-dependent red in `fieldSecurityPayload.test.tsx`.
 *
 * The last case is the CONTROL that separates the two readings the card
 * named. A stale submit closure would lose a value typed AFTER the record
 * landed too; it does not, so the loss is the landing record replacing the
 * form's values, i.e. the window this file pins shut.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { DrawerForm } from '../DrawerForm';

registerAllFields();
afterEach(() => cleanup());

const RECORD = { id: 'r1', title: 'Record One', note: 'kept' };

/** A data source whose single `findOne` the test resolves by hand. */
function heldRead() {
  let resolveRead: ((v: unknown) => void) | undefined;
  const update = vi.fn(async (_o: string, _id: string, d: Record<string, unknown>) => ({ id: 'r1', ...d }));
  const ds = {
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'task',
      fields: {
        title: { type: 'text', label: 'Title' },
        note: { type: 'text', label: 'Note' },
      },
    }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update,
    findOne: vi.fn(() => new Promise((resolve) => { resolveRead = resolve; })),
  } as any;
  return {
    ds,
    update,
    /** Resolve the in-flight read once it has actually been issued. */
    async land() {
      await waitFor(() => {
        if (!resolveRead) throw new Error('findOne not issued yet');
      });
      await act(async () => {
        resolveRead!(RECORD);
      });
    },
  };
}

const SHAPES = [
  ['flat fields', { fields: ['title', 'note'] }],
  ['sections', { sections: [{ name: 'basics', label: 'Basics', fields: ['title', 'note'] }] }],
] as const;

const schemaFor = (shape: Record<string, unknown>, mode: 'edit' | 'create' = 'edit') =>
  ({
    type: 'object-form',
    formType: 'drawer',
    objectName: 'task',
    mode,
    ...(mode === 'edit' ? { recordId: 'r1' } : {}),
    open: true,
    onOpenChange: vi.fn(),
    ...shape,
  }) as any;

const titleInput = () => document.body.querySelector<HTMLInputElement>('input[name="title"]');

/**
 * Flush the commits that follow the object schema resolving: the one that
 * publishes it (running both effects) and anything they schedule.
 */
async function settleWithReadHeld(ds: any) {
  await waitFor(() => expect(ds.findOne).toHaveBeenCalledTimes(1));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe.each(SHAPES)('DrawerForm first load (%s) — objectui#10190', (_label, shape) => {
  it('offers no editable input while the first record read is in flight', async () => {
    const { ds, land } = heldRead();
    render(<DrawerForm schema={schemaFor(shape)} dataSource={ds} />);
    await settleWithReadHeld(ds);

    const pending = titleInput();
    // Either absent or not editable — never a live input for a record the form
    // has not got.
    expect(pending === null || pending.disabled || pending.readOnly).toBe(true);

    await land();
    await waitFor(() => expect(titleInput()?.value).toBe('Record One'));
    expect(titleInput()!.disabled).toBe(false);
  });

  it('CONTROL — a value typed after the record lands is the value submitted', async () => {
    const { ds, update, land } = heldRead();
    render(<DrawerForm schema={schemaFor(shape)} dataSource={ds} />);
    await land();
    const input = await waitFor(() => {
      const el = titleInput();
      if (!el || el.value !== 'Record One') throw new Error('record not on screen');
      return el;
    });

    fireEvent.change(input, { target: { value: 'typed' } });
    const form = document.body.querySelector('form');
    if (!form) throw new Error('no form element');
    fireEvent.submit(form);

    await waitFor(() => expect(update).toHaveBeenCalled());
    // An edit writes only the fields that differ from the record it read
    // (objectui#10156). So `note` is absent precisely because the form still
    // holds the 'kept' the record landed with: an emptied `note` would differ
    // from the read and be written.
    expect(update.mock.calls[0][2]).toEqual({ title: 'typed' });
  });
});

describe('DrawerForm create mode — objectui#10190 boundary', () => {
  it('reads no record and renders straight to an editable form', async () => {
    const { ds } = heldRead();
    render(<DrawerForm schema={schemaFor(SHAPES[0][1], 'create')} dataSource={ds} />);
    await waitFor(() => expect(titleInput()).not.toBeNull());
    expect(titleInput()!.disabled).toBe(false);
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});
