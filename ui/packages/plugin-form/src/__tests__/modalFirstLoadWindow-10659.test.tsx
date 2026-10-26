/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The edit MODAL offers no editable form for a record whose FIRST read has not
 * landed (objectui#10659), the gate objectui#10190 gave the drawer.
 *
 * `ModalForm` reads its object schema, then builds its fields and reads its
 * record in two effects that both key on `objectSchema`. The commit that
 * publishes the schema runs both, fetch first: the fetch effect enters the
 * loading state and fires `findOne`, and the fields effect used to end the
 * loading state unconditionally. The modal painted an empty, editable form
 * while the read was in flight, and the landing record replaced what had been
 * typed. The save then compared the record with itself, found nothing changed,
 * and sent the whole record with its ORIGINAL values — the payload CI received
 * from `editDirtyPayload-10156`'s modal row when the race went the wrong way.
 *
 * `findOne` is held open here by the test, so the window is deterministic
 * instead of a race against the worker's load. The drawer rows are the
 * CONTROL: the same sequence through the arm that already carries the gate.
 * Both shapes are driven because the modal's fields effect ends loading on two
 * separate branches, one for authored `sections` and one for everything else.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();
afterEach(() => cleanup());

const VERSION = '2026-09-25 00:00:00.000';

const DEAL_SCHEMA = {
  name: 'deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'text', label: 'Stage' },
    updated_at: { type: 'datetime', label: 'Updated', system: true },
  },
};

const STORED = { id: 'd1', name: 'Mine', stage: 'open', updated_at: VERSION };

/** A data source whose single `findOne` the test resolves by hand. */
function heldRead() {
  let resolveRead: ((v: unknown) => void) | undefined;
  const ds = {
    getObjectSchema: vi.fn().mockResolvedValue(DEAL_SCHEMA),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(async (_o: string, _id: string, d: Record<string, unknown>) => ({ ...STORED, ...d })),
    findOne: vi.fn(() => new Promise((resolve) => { resolveRead = resolve; })),
  } as any;
  return {
    ds,
    /** Resolve the in-flight read once it has actually been issued. */
    async land() {
      await waitFor(() => {
        if (!resolveRead) throw new Error('findOne not issued yet');
      });
      await act(async () => {
        resolveRead!({ ...STORED });
      });
    },
  };
}

const SHAPES = [
  ['flat fields', {}],
  ['sections', { sections: [{ name: 'basics', label: 'Basics', fields: ['name', 'stage'] }] }],
] as const;

const FORM_TYPES = [
  ['modal', 'ModalForm'],
  ['drawer', 'DrawerForm (control)'],
] as const;

const editSchema = (formType: string, shape: Record<string, unknown>) =>
  ({
    type: 'object-form',
    formType,
    objectName: 'deal',
    mode: 'edit',
    recordId: 'd1',
    open: true,
    onOpenChange: vi.fn(),
    ...shape,
  }) as any;

const nameInput = () => document.body.querySelector<HTMLInputElement>('input[name="name"]');
const isEditable = (el: HTMLInputElement | null) => !!el && !el.disabled && !el.readOnly;

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

describe.each(FORM_TYPES)('ObjectForm formType %s (%s) — first record read (objectui#10659)', (formType) => {
  describe.each(SHAPES)('%s', (_label, shape) => {
    it('offers no editable input while the first record read is in flight', async () => {
      const { ds, land } = heldRead();
      render(<ObjectForm schema={editSchema(formType, shape)} dataSource={ds} />);
      await settleWithReadHeld(ds);

      // Either absent or not editable — never a live input for a record the
      // form has not got.
      expect(isEditable(nameInput())).toBe(false);

      await land();
      await waitFor(() => expect(nameInput()?.value).toBe('Mine'));
      expect(isEditable(nameInput())).toBe(true);
    });

    it('a value typed into the first input the form offers is the value submitted', async () => {
      const { ds, land } = heldRead();
      render(<ObjectForm schema={editSchema(formType, shape)} dataSource={ds} />);
      await settleWithReadHeld(ds);

      // A user types into the first input they are offered. If the form offers
      // one while the read is held, that is where the typing lands.
      let typed = false;
      const early = nameInput();
      if (isEditable(early)) {
        fireEvent.change(early!, { target: { value: 'Mine v2' } });
        typed = true;
      }

      await land();

      if (!typed) {
        const input = await waitFor(() => {
          const el = nameInput();
          if (!isEditable(el)) throw new Error('no editable input yet');
          return el!;
        });
        fireEvent.change(input, { target: { value: 'Mine v2' } });
      }

      const form = document.body.querySelector('form');
      if (!form) throw new Error('no form element');
      await act(async () => {
        fireEvent.submit(form);
      });

      await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
      // The edit, and nothing else: the record was read once, so no later
      // landing can replace the typed value.
      expect(ds.update).toHaveBeenCalledWith('deal', 'd1', { name: 'Mine v2' }, { ifMatch: VERSION });
      expect(ds.findOne).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ObjectForm formType modal create mode — objectui#10659 boundary', () => {
  it('reads no record and renders straight to an editable form', async () => {
    const { ds } = heldRead();
    render(
      <ObjectForm
        schema={{ type: 'object-form', formType: 'modal', objectName: 'deal', mode: 'create', open: true } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(isEditable(nameInput())).toBe(true));
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});
