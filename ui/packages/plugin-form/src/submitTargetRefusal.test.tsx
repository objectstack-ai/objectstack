/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A form with nothing to submit TO must REFUSE, never confirm (objectui#6300).
 *
 * ## What went wrong
 *
 * Each of the five variant containers opened `handleSubmit` with
 *
 *     if (!dataSource) { await schema.onSuccess?.(data); return data; }
 *
 * — a success signal emitted without consulting `submitHandler` and without
 * persisting anything. Re-derived on the merged tree (2e11c8c5b), driving each
 * `formType` through `ObjectForm` with a `submitHandler` declared and NO
 * `dataSource`:
 *
 *     variant | rendered | onSuccess | submitHandler
 *     tabbed  |   yes    |     1     |      0
 *     wizard  |   yes    |     1     |      0
 *     split   |   yes    |     1     |      0
 *     drawer  |   yes    |     1     |      0
 *     modal   |   yes    |     1     |      0
 *     simple  |   NO     |     0     |      0   ← never renders a form at all
 *
 * The `simple` row is the contrast, and it is not "throws on submit":
 * `SimpleObjectForm` refuses at LOAD — with no `dataSource` and no inline
 * `customFields` its schema effect takes the branch it comments as "cannot
 * proceed" and no submittable form is ever mounted, so its
 * `'DataSource is required for form submission'` throw is not reached on this
 * path. The five variants build their fields from `sections` and therefore DO
 * render, which is why the refusal has to live at submit time for them.
 *
 * ## Why it is user-reachable, not just a unit-level oddity
 *
 * `MasterDetailForm` builds its parent schema with BOTH
 * `submitHandler: submitViaBatch` and `onSuccess: handleSaved`. The early
 * return jumped straight to `handleSaved`, measured on the merged tree as
 * `toast.success("Created")` — plus, in create mode, a `formKey` bump that
 * remounts and CLEARS the parent form. The submitter is told the save worked
 * and watches their input disappear, with nothing written and
 * `submitViaBatch` (which would have said `dataSource is required`) never
 * called. That is the half this file pins in `describe` block 5.
 *
 * ## The sixth renderer (objectui#6388)
 *
 * `SimpleObjectForm` had the same hole in its own dialect. Its carve-out reads
 * `hasInlineFields && !dataSource` — non-empty `customFields`, its own inline
 * field source — and it too opened `handleSubmit`, ahead of the persistence
 * chain. Re-derived on the merged tree (faa863dce) with `customFields`, a
 * `submitHandler` and NO `dataSource`: `onSuccess 1 / submitHandler 0`. Its
 * cases in blocks 1 and 3 sit beside the family's on a `customFields`
 * fixture, because `baseSchema`'s section lists a bare NAME, which under
 * `simple` resolves against a field pool that only `customFields` or an
 * object schema can fill — so that fixture renders no fields there.
 *
 * ## The inline-sections shape on all six (objectui#11615)
 *
 * A section of self-describing inline `FormField`s is a different matter.
 * Until objectui#11615 `simple` resolved even those against its pool, so the
 * README's inline-sections shape rendered ZERO fields under `simple` and its
 * submit refused, and `simple` kept its own `customFields`-only predicate for
 * that reason (a case here pinned the refusal as its BOUNDARY). `simple` now
 * draws such an entry whatever its pool holds, as the five variants do, and
 * reads the shared `hasInlineFieldSource` — so block 3's two sections cases
 * run all six renderers, its boundary included: one bare name among inline
 * entries still refuses on every one of them.
 *
 * ## The blocks below
 *
 * 1. the declared `submitHandler` seam is consulted with no `dataSource`;
 * 2. no seam, no adapter, no inline fields → refuse loudly;
 * 3. CARVE-OUT — a legitimate inline-fields form still works, in BOTH the
 *    shapes this package documents (`customFields`, and sections of inline
 *    runtime fields — the README's own wizard example), plus the boundary case
 *    that keeps the carve-out from widening into a blanket escape;
 * 4. DEGENERATE CONTROL — `dataSource` present, the write really happens, so
 *    blocks 1-2 are attributable to its ABSENCE and not to a blanket change;
 * 5. the `MasterDetailForm` reachability path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { MasterDetailForm } from './MasterDetailForm';
import { NO_SUBMIT_TARGET_MESSAGE } from './submitTarget';
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
// mocks this exact deep path for the same reason. Block 5 below asserts the
// EXACT message text; `extractWriteErrorMessage`'s prefix-stripping only
// touches an ALL-CAPS `CODE:` prefix, so `'MasterDetailForm: dataSource is
// required'` (mixed case before the colon) reaches the renderer's toast
// byte-for-byte unchanged — this switch does not need that assertion to move.
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

/** The five renderers `ObjectForm` routes to that own an early-return submit. */
const VARIANTS = ['tabbed', 'wizard', 'split', 'drawer', 'modal'] as const;
/** The two of them that implement an inline-`customFields` field source. */
const INLINE_RENDERERS = ['drawer', 'modal'] as const;
/**
 * All six renderers, for the inline-SECTIONS shape: `simple` draws a section of
 * self-describing entries whatever its field pool holds (objectui#11615), so
 * that shape means the same thing under every `formType`.
 */
const SECTION_RENDERERS = [...VARIANTS, 'simple'] as const;

const parentObject = {
  name: 'po',
  fields: { ref: { type: 'text', label: 'Ref' } },
};

/** A self-describing field — no object schema, and therefore no adapter, needed. */
const INLINE_FIELDS = [{ name: 'ref', label: 'Ref', type: 'text' }] as any[];

const baseSchema = (formType: string, extra: Record<string, unknown> = {}) => ({
  type: 'object-form',
  objectName: 'po',
  mode: 'create',
  formType,
  // `drawer` / `modal` host the form in a dialog — open it, or there is no form
  // to submit and every assertion below passes vacuously.
  open: true,
  submitText: 'Save Now',
  sections: [{ name: 's1', label: 'Sec One', fields: ['ref'] }],
  ...extra,
});

/**
 * `simple` (`SimpleObjectForm`) — the sixth renderer. Its inline field source is
 * `customFields`, so it gets its own fixture rather than `baseSchema`'s
 * `sections`: a bare field NAME in a section is resolved against fields that
 * only `customFields` or an object schema can supply, so `baseSchema('simple')`
 * with no `dataSource` renders zero fields and every assertion on it would pass
 * vacuously.
 */
const simpleSchema = (extra: Record<string, unknown> = {}) => ({
  type: 'object-form',
  objectName: 'po',
  mode: 'create',
  formType: 'simple',
  submitText: 'Save Now',
  customFields: INLINE_FIELDS,
  ...extra,
});

/** Type into the one field and press the form's own submit button. */
async function fillAndSubmit(value = 'PO-1') {
  const ref = await waitFor(() => {
    const el = document.querySelector('input[name="ref"]') as HTMLInputElement | null;
    if (!el) throw new Error('form never rendered — the assertions below would pass vacuously');
    return el;
  });
  fireEvent.change(ref, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /save now/i }));
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
});
afterEach(cleanup);

describe('1. a declared `submitHandler` is consulted even with NO dataSource', () => {
  it.each(VARIANTS)(
    'formType `%s`: the host seam runs and success is reported from ITS result',
    async (formType) => {
      const submitHandler = vi.fn().mockResolvedValue({ id: 'p1' });
      const onSuccess = vi.fn();
      const onError = vi.fn();

      render(
        <ObjectForm
          schema={baseSchema(formType, { submitHandler, onSuccess, onError }) as any}
        />,
      );
      await fillAndSubmit();

      // THE PIN. On the merged tree this read 0: the early return fired first,
      // so a host that had DECLARED it owns the write was never asked.
      await waitFor(() => expect(submitHandler).toHaveBeenCalledTimes(1));
      expect(submitHandler).toHaveBeenCalledWith(expect.objectContaining({ ref: 'PO-1' }));
      // Success is still reported — but only AFTER the host wrote, and carrying
      // what the host returned rather than the raw form values.
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(onSuccess).toHaveBeenCalledWith({ id: 'p1' });
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('formType `simple`: inline fields + a declared seam — the seam is what runs', async () => {
    const submitHandler = vi.fn().mockResolvedValue({ id: 'p1' });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    render(
      <ObjectForm schema={simpleSchema({ submitHandler, onSuccess, onError }) as any} />,
    );
    await fillAndSubmit();

    // THE PIN (objectui#6388). Measured on the merged tree: `onSuccess 1 /
    // submitHandler 0` — the inline-fields carve-out opened `handleSubmit`, so a
    // host that had DECLARED it owns the write was never asked, and got a
    // success signal for a write that never happened.
    await waitFor(() => expect(submitHandler).toHaveBeenCalledTimes(1));
    expect(submitHandler).toHaveBeenCalledWith(expect.objectContaining({ ref: 'PO-1' }));
    // Success still reported — after the host wrote, carrying ITS result.
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith({ id: 'p1' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('formType `simple`: the seam wins over a PRESENT dataSource too (objectui#6176)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'written-by-adapter' });
    const submitHandler = vi.fn().mockResolvedValue({ id: 'written-by-host' });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const dataSource = {
      getObjectSchema: vi.fn().mockResolvedValue(parentObject),
      find: vi.fn().mockResolvedValue({ data: [] }),
      findOne: vi.fn().mockResolvedValue({}),
      create,
      update: vi.fn(),
      delete: vi.fn(),
      bulk: vi.fn(),
    } as any;

    // The inverse of the pin above: `submitHandler` is documented as handing the
    // values to the host INSTEAD of calling `dataSource.create` / `update`, so
    // the adapter being available changes nothing about who writes. Passes on
    // the merged tree as well — the ordering defect was reachable only through
    // the `!dataSource` carve-out, and this case is what says so.
    render(
      <ObjectForm
        schema={simpleSchema({ submitHandler, onSuccess, onError }) as any}
        dataSource={dataSource}
      />,
    );
    await fillAndSubmit();

    await waitFor(() => expect(submitHandler).toHaveBeenCalledTimes(1));
    expect(create).not.toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith({ id: 'written-by-host' });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('2. no seam, no adapter, no inline fields → refuse loudly', () => {
  it.each(VARIANTS)(
    'formType `%s`: onSuccess is NOT called and the reason reaches onError',
    async (formType) => {
      const onSuccess = vi.fn();
      const onError = vi.fn();

      render(<ObjectForm schema={baseSchema(formType, { onSuccess, onError }) as any} />);
      await fillAndSubmit();

      // THE PIN — the false success is gone.
      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect((onError.mock.calls[0][0] as Error).message).toBe(NO_SUBMIT_TARGET_MESSAGE);
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );

  it.each(INLINE_RENDERERS)(
    'formType `%s`: the dialog is NOT dismissed over an unwritten record',
    async (formType) => {
      const onOpenChange = vi.fn();
      const onError = vi.fn();

      render(
        <ObjectForm schema={baseSchema(formType, { onOpenChange, onError }) as any} />,
      );
      await fillAndSubmit();

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      // The old early return closed the overlay as part of its "success",
      // taking the submitter's still-unsaved input off screen with it.
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    },
  );
});

describe('3. CARVE-OUT: a legitimate inline-fields form still works', () => {
  it.each(INLINE_RENDERERS)(
    'formType `%s`: fields authored inline, no adapter — onSuccess IS the write',
    async (formType) => {
      const onSuccess = vi.fn();
      const onError = vi.fn();

      // No `sections` at all: `customFields` is the whole field source, which is
      // the shape `ObjectFormSchema` documents as working without a dataSource
      // and the one the `object-form` element gate exempts from
      // `requiresDataSource`.
      render(
        <ObjectForm
          schema={{
            type: 'object-form',
            objectName: 'po',
            mode: 'create',
            formType,
            open: true,
            submitText: 'Save Now',
            customFields: INLINE_FIELDS,
            onSuccess,
            onError,
          } as any}
        />,
      );
      await fillAndSubmit();

      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ ref: 'PO-1' }));
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it.each(SECTION_RENDERERS)(
    'formType `%s`: sections of inline runtime fields — the README\u2019s own shape — still work',
    async (formType) => {
      const onSuccess = vi.fn();
      const onError = vi.fn();

      // This package's README ships exactly this: `<WizardForm schema={wizard} />`
      // under *"dataSource omitted: every step lists inline fields"*. It is the
      // sectioned variants' inline mode — they have no `customFields` of their
      // own — and a `customFields`-only carve-out would have made the repo's own
      // published example throw. Measured before the guard existed: it rendered
      // and submitted.
      render(
        <ObjectForm
          schema={baseSchema(formType, {
            sections: [{ name: 's1', label: 'Sec One', fields: INLINE_FIELDS }],
            onSuccess,
            onError,
          }) as any}
        />,
      );
      await fillAndSubmit();

      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ ref: 'PO-1' }));
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it.each(SECTION_RENDERERS)(
    'formType `%s`: BOUNDARY — one bare field name among inline ones still refuses',
    async (formType) => {
      const onSuccess = vi.fn();
      const onError = vi.fn();

      // The carve-out is all-or-nothing on purpose. `'memo'` is a NAME: only an
      // object schema can say what it is, and only an adapter can serve one. A
      // form that needed metadata it could not get did not collect what it was
      // authored to collect, so confirming it would be the same false success in
      // a narrower dress. Without this case the carve-out could quietly become a
      // blanket escape the moment any form declared one inline field.
      render(
        <ObjectForm
          schema={baseSchema(formType, {
            sections: [{ name: 's1', label: 'Sec One', fields: [...INLINE_FIELDS, 'memo'] }],
            onSuccess,
            onError,
          }) as any}
        />,
      );
      await fillAndSubmit();

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect((onError.mock.calls[0][0] as Error).message).toBe(NO_SUBMIT_TARGET_MESSAGE);
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );

  it('formType `simple`: CONTROL — no seam declared, the carve-out still fires', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    // THE DEGENERATE CONTROL for objectui#6388. `simple`'s inline collector is
    // legitimate and must survive the reordering untouched: with no
    // `submitHandler` to consult, `onSuccess` IS the write and it receives the
    // RAW collected values, not an adapter's result. Passes on the merged tree
    // and after the fix, deliberately — it is what makes block 1's `simple` pin
    // attributable to the declared seam rather than to the carve-out having
    // been narrowed or removed.
    render(<ObjectForm schema={simpleSchema({ onSuccess, onError }) as any} />);
    await fillAndSubmit();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ ref: 'PO-1' }));
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(SECTION_RENDERERS)(
    'formType `%s`: the inline-sections collector opens on `initialValues` and submits what it holds',
    async (formType) => {
      const onSuccess = vi.fn();
      const onError = vi.fn();

      // The collector half the refusal cases above never reach: with no adapter
      // there is nothing to read, so the form opens on the caller's record. This
      // case replaces `simple`'s old BOUNDARY row, which pinned the REFUSAL of
      // this very form while `simple` drew none of its fields (objectui#11615).
      // Now that it draws them, it must also open on `initialValues` as the five
      // variants do — the `simple` row is the one that goes red without the
      // members-only seeding in `SimpleObjectForm`'s schema and record effects.
      render(
        <ObjectForm
          schema={baseSchema(formType, {
            initialValues: { ref: 'SEEDED' },
            sections: [{ name: 's1', label: 'Sec One', fields: INLINE_FIELDS }],
            onSuccess,
            onError,
          }) as any}
        />,
      );
      const ref = await waitFor(() => {
        const el = document.querySelector('input[name="ref"]') as HTMLInputElement | null;
        if (!el) throw new Error('form never rendered — the assertions below would pass vacuously');
        return el;
      });
      expect(ref.value, 'the collector opens on the caller\'s record').toBe('SEEDED');
      fireEvent.click(screen.getByRole('button', { name: /save now/i }));

      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ ref: 'SEEDED' }));
      expect(onError).not.toHaveBeenCalled();
    },
  );
});

describe('4. DEGENERATE CONTROL: with a dataSource the write really happens', () => {
  // Passes on the merged tree AND after the fix — deliberately. It is what makes
  // blocks 1-2 attributable to the ABSENCE of a dataSource rather than to a
  // blanket refusal bolted onto every submit.
  it.each(VARIANTS)(
    'formType `%s`: dataSource.create is called and success is reported',
    async (formType) => {
      const create = vi.fn().mockResolvedValue({ id: 'p1' });
      const onSuccess = vi.fn();
      const onError = vi.fn();
      const dataSource = {
        getObjectSchema: vi.fn().mockResolvedValue(parentObject),
        find: vi.fn().mockResolvedValue({ data: [] }),
        findOne: vi.fn().mockResolvedValue({}),
        create,
        update: vi.fn(),
        delete: vi.fn(),
        bulk: vi.fn(),
      } as any;

      render(
        <ObjectForm
          schema={baseSchema(formType, { onSuccess, onError }) as any}
          dataSource={dataSource}
        />,
      );
      await fillAndSubmit();

      await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      expect(create).toHaveBeenCalledWith('po', expect.objectContaining({ ref: 'PO-1' }));
      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(onError).not.toHaveBeenCalled();
    },
  );
});

describe('5. MasterDetailForm — the path that made this user-visible', () => {
  const masterDetailSchema = {
    objectName: 'po',
    mode: 'create',
    formType: 'tabbed',
    sections: [{ name: 's1', label: 'Sec One', fields: ['ref'] }],
    details: [
      {
        childObject: 'po_line',
        relationshipField: 'po',
        columns: [{ name: 'qty', label: 'Qty', type: 'number' }],
      },
    ],
  };

  const clickHostSave = () =>
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

  it('with NO dataSource: no success toast, no reset — the failure is reported instead', async () => {
    const { container } = render(
      <MasterDetailForm schema={masterDetailSchema as any} />,
    );

    const ref = await waitFor(() => {
      const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
      if (!el) throw new Error('parent form never rendered');
      return el;
    });
    fireEvent.change(ref, { target: { value: 'PO-1' } });
    clickHostSave();

    // THE PIN — on the merged tree this was `toast.success("Created")`.
    //
    // The message is the HOST's own, not `NO_SUBMIT_TARGET_MESSAGE`, and that is
    // the fix working as designed: `MasterDetailForm` DECLARED `submitHandler`,
    // so the seam is consulted first (block 1) and `submitViaBatch` gets to
    // state the precise reason. The renderer's generic refusal is what a form
    // with no seam at all falls through to (block 2).
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(String(toastError.mock.calls[0][0])).toBe('MasterDetailForm: dataSource is required');
    expect(toastSuccess).not.toHaveBeenCalled();

    // …and the submitter's input is still there. `handleSaved` bumps `formKey`
    // in create mode, which remounts the parent form and wipes it — the visible
    // half of the data loss.
    const after = container.querySelector('input[name="ref"]') as HTMLInputElement;
    expect(after.value).toBe('PO-1');
  });

  it('CONTROL — with a dataSource the batch commits and the save is confirmed', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
    const dataSource = {
      getObjectSchema: vi.fn().mockResolvedValue(parentObject),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulk: vi.fn(),
      batchTransaction,
    } as any;

    const { container } = render(
      <MasterDetailForm schema={masterDetailSchema as any} dataSource={dataSource} />,
    );

    const ref = await waitFor(() => {
      const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
      if (!el) throw new Error('parent form never rendered');
      return el;
    });
    fireEvent.change(ref, { target: { value: 'PO-1' } });
    clickHostSave();

    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});
