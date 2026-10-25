/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `submitHandler` is the DECLARED seam a host uses to own persistence, and
 * EVERY renderer `ObjectForm` routes to must honour it (objectui#6176).
 *
 * ## What went wrong
 *
 * `ObjectFormSchema.submitHandler` is documented as "the form validates and
 * hands the collected values to the host INSTEAD of calling dataSource.create /
 * dataSource.update". `ObjectForm` forwards the key into every variant it
 * routes to — the `{...schema}` spread carries it — but only `SimpleObjectForm`
 * ever read it. `TabbedForm`, `WizardForm`, `SplitForm`, `DrawerForm` and
 * `ModalForm` called `dataSource.create` directly instead.
 *
 * That is not cosmetic. `MasterDetailForm` supplies `submitHandler:
 * submitViaBatch` precisely so the parent AND its child collections commit as
 * ONE `batchTransaction` (#2679 / ADR-0034 item 4). With the parent half
 * rendered `tabbed`, the measured reading on `main` was:
 *
 *     batchTransaction 0 · dataSource.create 1 · args ["po", {"ref":"PO-1"}]
 *
 * and the consequence is worse than a bypassed transaction: the child leg was
 * never ATTEMPTED at all. The parent committed alone, the operator's entered
 * line items were silently discarded, no compensation ran, and a SUCCESS toast
 * confirmed it. `split` measured identically.
 *
 * ## What each block below pins
 *
 * 1. The data-integrity claim — a failing child leg must leave NO committed
 *    parent. This is the assertion that distinguishes the two worlds; "the
 *    parent was created" is true in both.
 * 2. The seam itself, per renderer — all six, because a fix landing on four of
 *    five still passes a suite that only exercises four.
 * 3. The master-detail composition reading the card measured.
 *
 * ## Scope, stated so it is not over-read
 *
 * This restores an implementation to a decision already taken; it does NOT
 * change the `object-master-detail-form.formType` vocabulary, which stays
 * `simple | tabbed` (objectui#5939). See `masterDetailFormTypeVocabulary.test.tsx`
 * — one exclusion rationale there is updated because this fix falsifies it, but
 * the SET is untouched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';
import { ObjectForm } from './ObjectForm';
import './index';

const toastSuccess = vi.fn();
const toastError = vi.fn();
// Mock target is the DEEP module `@object-ui/components/ui/sonner`, not the
// package barrel `@object-ui/components`. The barrel used to be enough only
// because `MasterDetailForm`'s OWN `handleError` toast (removed, objectui#7354)
// happened to go through it; the form renderer's toast
// (`packages/components/src/renderers/form/form.tsx`) imports `toast` via a
// RELATIVE path (`../../ui/sonner`) and never resolves through the barrel
// specifier a caller outside that package uses — see
// `MasterDetailForm.outcomeToastSupersede.test.tsx` (#7345), which already
// mocks this exact deep path for the same reason.
vi.mock('@object-ui/components/ui/sonner', async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    // Inherit the real toast surface and override only what this file spies
    // on — a hand-listed double leaves every other sonner method undefined.
    toast: {
      ...actual.toast,
      success: (...a: any[]) => toastSuccess(...a),
      error: (...a: any[]) => toastError(...a),
    },
  };
});

registerAllFields();

/** The full vocabulary `object-form` declares — every renderer `ObjectForm` routes to. */
const OBJECT_FORM_SIX = ['simple', 'tabbed', 'wizard', 'split', 'drawer', 'modal'] as const;

/**
 * The variants that render the parent half INLINE, so the master-detail host's
 * single Save bar can actually reach a `<form>`. `wizard` (mounts one step at a
 * time, and the Save bar drives its `Next`) and `drawer` / `modal` (parent half
 * lands in a portal dialog) are excluded by LAYOUT, not by the seam — that
 * exclusion is measured in `masterDetailFormTypeVocabulary.test.tsx`.
 */
const INLINE_PARENT_VARIANTS = ['simple', 'tabbed', 'split'] as const;

const parentObject = {
  name: 'po',
  fields: { ref: { type: 'text', label: 'Ref' }, memo: { type: 'text', label: 'Memo' } },
};

const masterDetailSchema = (formType: string) => ({
  objectName: 'po',
  mode: 'create',
  formType,
  sections: [
    { name: 's1', label: 'Sec One', fields: ['ref'] },
    { name: 's2', label: 'Sec Two', fields: ['memo'] },
  ],
  details: [
    {
      childObject: 'po_line',
      relationshipField: 'po',
      columns: [{ name: 'qty', label: 'Qty', type: 'number' }],
    },
  ],
});

/**
 * Fill the parent header AND the first (ghost) line, so the save carries BOTH
 * legs. Without a real child row the batch would be a single-op list and the
 * atomicity claim would have nothing to be atomic about.
 */
async function fillHeaderAndLine(container: HTMLElement) {
  const ref = await waitFor(() => {
    const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
    if (!el) throw new Error('parent form not ready');
    return el;
  });
  fireEvent.change(ref, { target: { value: 'PO-1' } });
  const qty = await waitFor(() => screen.getAllByLabelText('Qty')[0] as HTMLInputElement);
  fireEvent.change(qty, { target: { value: '5' } });
}

const clickHostSave = () =>
  fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe('a failing child leg leaves NO committed parent, whichever variant renders the parent half (objectui#6176)', () => {
  // A dataSource with NO `batchTransaction`: `runBatchTransaction` falls back to
  // `emulateBatchTransaction`, which drives the ops in order and COMPENSATES on
  // failure. The compensating delete is the observable stand-in for a rollback,
  // which is why this shape is used rather than a rejecting atomic stub — a
  // rejecting stub can only show that nothing was written, never that an
  // already-written parent gets removed.
  it.each(INLINE_PARENT_VARIANTS)(
    'formType `%s`: the child create fails → the just-created parent is compensated away, and the operator is told',
    async (formType) => {
      const create = vi.fn(async (object: string, data: any) => {
        if (object === 'po_line') throw new Error('child create failed');
        return { id: 'po1', ...data };
      });
      const del = vi.fn(async () => true);
      const dataSource = {
        getObjectSchema: vi.fn().mockResolvedValue(parentObject),
        find: vi.fn().mockResolvedValue({ data: [] }),
        create,
        update: vi.fn(),
        delete: del,
        bulk: vi.fn(),
        // deliberately NO batchTransaction
      } as any;

      const { container } = render(
        <MasterDetailForm schema={masterDetailSchema(formType) as any} dataSource={dataSource} />,
      );
      await fillHeaderAndLine(container);
      clickHostSave();

      // POSITIVE PROBE — the child leg was actually attempted. Without this the
      // assertions below pass vacuously on a form that never submitted at all,
      // which is exactly how the broken `tabbed` path read: parent written, the
      // child collection silently dropped, nothing to fail.
      await waitFor(() =>
        expect(create).toHaveBeenCalledWith('po_line', expect.objectContaining({ po: 'po1' })),
      );

      // THE PIN — no committed parent survives the failed leg.
      await waitFor(() => expect(del).toHaveBeenCalledWith('po', 'po1'));
      // …and the failure is surfaced. On the broken path the operator got a
      // SUCCESS toast over a half-written document.
      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(toastSuccess).not.toHaveBeenCalled();
    },
  );
});

describe('every renderer ObjectForm routes to honours the declared `submitHandler` seam', () => {
  // Mounted through `ObjectForm` itself — the component that OWNS the routing —
  // so this exercises the same forwarding path a real host uses, not each
  // variant in isolation.
  it.each(OBJECT_FORM_SIX)(
    'formType `%s`: hands the values to the host and does NOT persist on its own',
    async (formType) => {
      const submitHandler = vi.fn().mockResolvedValue({ id: 'p1' });
      const create = vi.fn().mockResolvedValue({ id: 'p1' });
      const update = vi.fn().mockResolvedValue({ id: 'p1' });
      const dataSource = {
        getObjectSchema: vi.fn().mockResolvedValue(parentObject),
        find: vi.fn().mockResolvedValue({ data: [] }),
        create,
        update,
        delete: vi.fn(),
        bulk: vi.fn(),
      } as any;

      render(
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'po',
            mode: 'create',
            formType,
            // `drawer` / `modal` host the form in a dialog — open it, or there
            // is no form to submit and every assertion below passes vacuously.
            open: true,
            submitText: 'Save Now',
            sections: [{ name: 's1', label: 'Sec One', fields: ['ref'] }],
            submitHandler,
          } as any}
          dataSource={dataSource}
        />,
      );

      const ref = await waitFor(() => {
        const el = document.querySelector('input[name="ref"]') as HTMLInputElement | null;
        if (!el) throw new Error('form not ready');
        return el;
      });
      fireEvent.change(ref, { target: { value: 'PO-1' } });
      fireEvent.click(screen.getByRole('button', { name: /save now/i }));

      // POSITIVE — the host was handed the collected values. A bare
      // "create was not called" would also hold for a form that never submitted.
      await waitFor(() => expect(submitHandler).toHaveBeenCalledTimes(1));
      expect(submitHandler).toHaveBeenCalledWith(expect.objectContaining({ ref: 'PO-1' }));
      // NEGATIVE — the form did not write on its own behind the host's back.
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );
});

describe('master-detail: the parent commits INSIDE the atomic batch, not beside it', () => {
  // The card's own measurement, re-expressed as a pin. On `main` the `tabbed`
  // and `split` rows read `batchTransaction 0 / create 1`.
  it.each(INLINE_PARENT_VARIANTS)(
    'formType `%s`: one batchTransaction carrying BOTH legs, and zero independent creates',
    async (formType) => {
      const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
      const create = vi.fn().mockResolvedValue({ id: 'po1' });
      const dataSource = {
        getObjectSchema: vi.fn().mockResolvedValue(parentObject),
        find: vi.fn().mockResolvedValue({ data: [] }),
        create,
        update: vi.fn(),
        delete: vi.fn(),
        bulk: vi.fn(),
        batchTransaction,
      } as any;

      const { container } = render(
        <MasterDetailForm schema={masterDetailSchema(formType) as any} dataSource={dataSource} />,
      );
      await fillHeaderAndLine(container);
      clickHostSave();

      await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
      const ops = batchTransaction.mock.calls[0][0];
      // BOTH legs in one operation list — the parent at index 0 and the child
      // pointing at it through `$ref: 0`, which is what makes the commit atomic.
      expect(ops).toHaveLength(2);
      expect(ops[0]).toMatchObject({ object: 'po', action: 'create', data: { ref: 'PO-1' } });
      expect(ops[1]).toMatchObject({ object: 'po_line', action: 'create', data: { po: { $ref: 0 } } });
      // The escape this card closed.
      expect(create).not.toHaveBeenCalled();
    },
  );
});
