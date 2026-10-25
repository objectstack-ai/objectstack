/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A master-detail form never ends on a screen that asserts BOTH outcomes
 * (objectui#7345 — the objectui#7252 defect class, on a renderer PR #7342 did
 * not touch).
 *
 * ## Where the two toasts came from here (at the time this file was written)
 *
 * Unlike the wizard (whose refusal came from the step renderer and whose
 * success came from `WizardForm`), BOTH outcomes of a master-detail save were
 * raised by `MasterDetailForm` itself, one line apart:
 *
 *  - `handleSaved` -> `toast.success('Created' | '<title> saved')`;
 *  - `handleError` -> `toast.error(err.message || 'Save failed')`.
 *
 * Neither carried a sonner id, so each went out under sonner's auto-generated
 * one and nothing here held a handle on the previous attempt's toast. A save
 * the server refused left its error toast on screen, and the confirmation of
 * the corrected retry landed BESIDE it.
 *
 * ⚠️ **`handleError`'s toast is gone as of objectui#7354** — see that card and
 * `MasterDetailForm.singleRefusalRaiser.test.tsx`. It was a SEPARATE defect
 * from the one THIS file pins (a refused save reported its own refusal
 * TWICE, once here and once from the parent `<ObjectForm>`'s renderer — see
 * below), and removing it does not touch what this file asserts: `handleSaved`
 * still raises the built-in success toast this file pins, under the same id,
 * and the dismiss-on-retry mechanics below are unchanged. `handleError` now
 * only releases the save guard and forwards to `schema.onError`.
 *
 * ## The two paths, and why both are pinned
 *
 * 1. **No host `onSuccess`** (SDUI / embedded): the built-in success toast is
 *    the fallback, so the shared id is what makes the confirmation SUPERSEDE
 *    the refusal instead of stacking beside it.
 * 2. **Host supplies `onSuccess`** (the console): the built-in success toast is
 *    deliberately skipped, so a shared id alone would retire nothing — the
 *    refusal would outlive a save that SUCCEEDED. The `toast.dismiss` at the
 *    start of each attempt is what closes that half, which is why it is part of
 *    the shape and not decoration.
 *
 *    ⚠️ That `toast.dismiss` call dismisses THIS form's own id, which is not
 *    the id the refusal is raised under any more (see below) — it still
 *    closes this half because the form renderer's OWN submit-start dismiss
 *    (objectui#7252, unconditional, independent of this form's dismiss)
 *    retires the renderer's stale refusal before the retry's outcome is
 *    decided, whether that retry succeeds or fails again. Driven, not assumed:
 *    the second `it` below IS path 2, and it is green post-#7354.
 *
 * The parent `<ObjectForm>`'s own renderer also toasts a rejected write, under
 * its OWN `form-outcome:` id, and retires it at the top of the next submit
 * (objectui#7252). Before objectui#7354 that toast was already superseded and
 * was not what this file pinned; it was visible in the pre-fix registry below
 * as the second error entry. Post-#7354 it is the ONLY error entry — the
 * duplication objectui#7354 fixed is gone, so `distinctOnScreen` below now
 * sees the same one-error reality `onScreen` does; see
 * `MasterDetailForm.singleRefusalRaiser.test.tsx` for the pin that asserts
 * that directly on the raw (undeduplicated) registry.
 *
 * ## Why the pin models sonner rather than counting calls
 *
 * Asserting `toast.error` was called and `toast.success` was called says
 * nothing about what is on SCREEN — that is exactly the reading under which the
 * defect looks fine. So the module is replaced by a registry modelling the one
 * sonner behaviour the fix relies on: a toast raised under an id the registry
 * already holds REPLACES that entry, and `dismiss(id)` removes exactly that
 * one. The assertion is then the card's own sentence — what remains on screen.
 *
 * ⚠️ The mock target is `@object-ui/components/ui/sonner`, NOT bare `'sonner'`.
 * That wrapper is the single module every raiser here reaches — the `toast`
 * `MasterDetailForm` pulls from `@object-ui/components` is this module's
 * re-export (`src/index.ts` -> `export * from './ui'` -> `./ui/sonner`) — and
 * it is the only one of the two spellings that resolves from here:
 * `plugin-form` does not depend on `sonner`, so `vi.mock('sonner')` in this
 * package registers against an id nothing resolves to and intercepts NOTHING.
 * A green run here is therefore also the proof that the mock is in the graph.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

type ToastEntry = { type: string; message: string };

const { toastRegistry, fakeToast } = vi.hoisted(() => {
  const toastRegistry = new Map<string | number, { type: string; message: string }>();
  let auto = 0;
  const raise =
    (type: string) =>
    (message: unknown, options?: { id?: string | number }) => {
      // No id supplied is sonner's auto-id: a NEW toast every time, which is
      // precisely the pre-fix behaviour that let two outcomes coexist.
      const id = options?.id ?? `auto:${(auto += 1)}`;
      toastRegistry.set(id, { type, message: String(message) });
      return id;
    };
  const fakeToast: any = Object.assign(raise('message'), {
    success: raise('success'),
    error: raise('error'),
    info: raise('info'),
    warning: raise('warning'),
    loading: raise('loading'),
    custom: raise('custom'),
    promise: (p: unknown) => p,
    dismiss: (id?: string | number) => {
      if (id === undefined) toastRegistry.clear();
      else toastRegistry.delete(id);
      return id;
    },
  });
  return { toastRegistry, fakeToast };
});

vi.mock('@object-ui/components/ui/sonner', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: fakeToast };
});

import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const REFUSAL = 'Line 2 quantity exceeds the remaining allocation.';

const parentObjectSchema = { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } };

/** Refuses the first save the way the server did, accepts the second. */
const makeDataSource = (overrides: Record<string, unknown> = {}) => {
  let saves = 0;
  return {
    getObjectSchema: vi.fn().mockResolvedValue(parentObjectSchema),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn(async () => {
      saves += 1;
      if (saves === 1) {
        throw Object.assign(new Error(REFUSAL), { status: 400, code: 'VALIDATION_FAILED' });
      }
      return { results: [{ id: 'po1' }] };
    }),
    ...overrides,
  } as any;
};

const masterDetail = (dataSource: any, extraSchema: Record<string, unknown> = {}) =>
  render(
    <MasterDetailForm
      schema={
        {
          type: 'object-master-detail-form',
          objectName: 'po',
          mode: 'create',
          fields: ['ref'],
          details: [
            {
              childObject: 'po_line',
              relationshipField: 'po',
              columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any],
            },
          ],
          ...extraSchema,
        } as any
      }
      dataSource={dataSource as any}
    />,
  );

const headerInput = (container: HTMLElement) =>
  waitFor(() => {
    const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
    if (!el) throw new Error('parent form not ready');
    return el;
  });

/** Drive the bottom action bar's single Save/Create button. */
const save = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

/** What the user can actually see, in the order sonner holds it. */
const onScreen = (): ToastEntry[] => [...toastRegistry.values()];

/**
 * What the screen SAYS, with each distinct statement counted once.
 *
 * Before objectui#7354: a refused master-detail save put the SAME refusal on
 * screen twice — `handleError` here raised one, and the parent
 * `<ObjectForm>`'s renderer raised its own for the write it re-threw. That
 * duplication was a separate defect from the one THIS file pins, so the
 * assertions below were written to deliberately not depend on HOW MANY
 * raisers reported an outcome — only on WHICH outcomes remain readable.
 *
 * objectui#7354 fixed that duplication (removed `handleError`'s own toast),
 * so today `distinctOnScreen()` and the raw `onScreen()` agree on a refused
 * save — there is only the one raiser left. The dedup here is kept anyway:
 * this file's OWN subject (a later outcome superseding an earlier one on THIS
 * form) never depended on how many raisers were active, and
 * `MasterDetailForm.singleRefusalRaiser.test.tsx` is where the raw,
 * undeduplicated count is the point of the assertion.
 */
const distinctOnScreen = (): ToastEntry[] => {
  const seen = new Map<string, ToastEntry>();
  for (const t of onScreen()) seen.set(`${t.type}:${t.message}`, t);
  return [...seen.values()];
};

beforeEach(() => {
  toastRegistry.clear();
});

afterEach(() => {
  cleanup();
});

describe('MasterDetailForm — a later save outcome supersedes this form’s earlier one', () => {
  it('leaves only the success toast after a refused save is retried and accepted', async () => {
    const ds = makeDataSource();
    const { container } = masterDetail(ds);

    fireEvent.change(await headerInput(container), { target: { value: 'PO-1' } });
    save();
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(distinctOnScreen()).toEqual([{ type: 'error', message: REFUSAL }]));

    // The user corrects the input and saves again inside the refusal's lifetime.
    fireEvent.change(await headerInput(container), { target: { value: 'PO-1b' } });
    save();
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(2));

    // The card's own sentence: one form, one outcome on screen.
    await waitFor(() => expect(onScreen()).toEqual([{ type: 'success', message: 'Created' }]));
  });

  it('retires the refusal even when the host owns confirmation (no built-in success toast)', async () => {
    // The console path: `onSuccess` is supplied, so the built-in success toast
    // is deliberately skipped. A shared id alone would retire NOTHING here —
    // the refusal of the first attempt would outlive a save that succeeded.
    // The dismissal at the start of each attempt is what closes this half.
    const onSuccess = vi.fn();
    const ds = makeDataSource();
    const { container } = masterDetail(ds, { onSuccess });

    fireEvent.change(await headerInput(container), { target: { value: 'PO-2' } });
    save();
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(distinctOnScreen()).toEqual([{ type: 'error', message: REFUSAL }]));

    fireEvent.change(await headerInput(container), { target: { value: 'PO-2b' } });
    save();
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    // Nothing left asserting the save was refused.
    await waitFor(() => expect(onScreen()).toEqual([]));
  });

  it('does not stack a second refusal when the retry is refused too', async () => {
    const ds = makeDataSource({
      batchTransaction: vi.fn(async () => {
        throw Object.assign(new Error(REFUSAL), { status: 400, code: 'VALIDATION_FAILED' });
      }),
    });
    const { container } = masterDetail(ds);

    fireEvent.change(await headerInput(container), { target: { value: 'PO-3' } });
    save();
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(distinctOnScreen()).toEqual([{ type: 'error', message: REFUSAL }]));
    // How many raisers reported this refusal is not this file's subject; that
    // the SECOND attempt adds none of its own is.
    const afterFirstAttempt = onScreen().length;

    fireEvent.change(await headerInput(container), { target: { value: 'PO-3b' } });
    save();
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(distinctOnScreen()).toEqual([{ type: 'error', message: REFUSAL }]));
    expect(onScreen()).toHaveLength(afterFirstAttempt);
  });
});
