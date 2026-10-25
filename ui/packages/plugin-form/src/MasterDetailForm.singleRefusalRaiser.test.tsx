/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A refused master-detail save puts the SAME refusal on screen ONCE, not
 * twice (objectui#7354).
 *
 * ## The two raisers this pins apart
 *
 * `MasterDetailForm.outcomeToastSupersede.test.tsx` (objectui#7345) already
 * documents — and deliberately works AROUND — a second raiser: the parent
 * `<ObjectForm>`'s own submit re-throws after calling this form's
 * `handleError`, and that throw surfaces in the form renderer's own catch
 * (`packages/components/src/renderers/form/form.tsx`), which toasts the same
 * message again under its OWN `form-outcome:<id>` sonner id (a DIFFERENT id
 * from this form's — both call `React.useId()` independently, so the shared
 * `form-outcome:` PREFIX from #7345 never bought de-duplication ACROSS the
 * two raisers, only WITHIN each one's own retries). #7345's pin compares
 * DISTINCT `type:message` statements for exactly this reason, so it stays
 * green whether one raiser reports an outcome or two.
 *
 * This file asserts the thing #7345 deliberately does not: the RAW sonner
 * registry — not deduplicated by message text — holds exactly one entry
 * after a single refused save. Comparing raw entries (not `type:message`
 * dedup) is what tells the two-raiser defect apart from the fixed, one-raiser
 * behaviour: two raisers publishing the identical text collapse to one
 * DISTINCT statement either way, so only the raw count can tell them apart.
 *
 * ## The lit control
 *
 * A pin that merely asserted "at most one toast" would pass just as well by
 * silencing everything — no refusal shown at all is not this card's fix. The
 * first assertion below requires the surviving entry to still be the error
 * message: the count must be exactly one AND that one must be lit.
 *
 * ⚠️ The mock target is `@object-ui/components/ui/sonner`, NOT bare
 * `'sonner'` — see the #7345 test file's docstring for why; this file reuses
 * the identical registry-modelling harness for the same reason.
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

/** Refuses every save the way the server did (a batch-transaction rejection). */
const makeDataSource = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(parentObjectSchema),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  bulk: vi.fn(),
  batchTransaction: vi.fn(async () => {
    throw Object.assign(new Error(REFUSAL), { status: 400, code: 'VALIDATION_FAILED' });
  }),
});

const masterDetail = (dataSource: any) =>
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

/** What the user can actually see, RAW — one entry per raiser, undeduplicated. */
const onScreen = (): ToastEntry[] => [...toastRegistry.values()];

beforeEach(() => {
  toastRegistry.clear();
});

afterEach(() => {
  cleanup();
});

describe('MasterDetailForm — a refused save reports its refusal exactly once (objectui#7354)', () => {
  it('leaves exactly one error toast on screen, not one per raiser', async () => {
    const ds = makeDataSource();
    const { container } = masterDetail(ds);

    fireEvent.change(await headerInput(container), { target: { value: 'PO-1' } });
    save();
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(1));

    // Wait for the outcome to settle, then read the raw (undeduplicated)
    // registry: this is the count that told the two-raiser defect apart from
    // the fix. Give the throw its full trip through `<ObjectForm>`'s catch
    // and back up into the form renderer's before asserting.
    await waitFor(() => expect(onScreen().length).toBeGreaterThan(0));

    const entries = onScreen();
    // The lit control: the surviving entry must still be the refusal, so this
    // cannot pass by silencing every raiser instead of collapsing to one.
    expect(entries).toEqual([{ type: 'error', message: REFUSAL }]);
  });
});
