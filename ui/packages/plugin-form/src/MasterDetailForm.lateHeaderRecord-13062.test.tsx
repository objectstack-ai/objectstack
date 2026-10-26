/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A stored paid invoice opens with its `readonlyWhen: parent.status == 'paid'`
 * line cells locked however late its header record arrives (objectui#13062).
 *
 * The line grids' `parent` used to be a DOM scrape of the header taken at mount
 * and on three timers (120 / 360 / 800 ms). A header whose read answered after
 * the last tick fired no event, so `parent` stayed empty and the locked cells
 * came up editable. The parent is now the header's own record, published when
 * the header's read answers, with the user's edits laid over it.
 *
 * The header read here is a DEFERRED `findOne`, answered well past 800 ms of
 * real time, so the timers have all run out before the record exists.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

// A text `status` header field: a real <select> cannot be driven by synthetic
// events in jsdom (the same choice the #1581 rows in MasterDetailForm.test.tsx make).
const INV_SCHEMA = { name: 'inv', fields: { status: { type: 'text', label: 'Status' } } };

const details = [
  {
    childObject: 'inv_line',
    relationshipField: 'inv',
    columns: [
      { name: 'product', label: 'Product', type: 'text' },
      { name: 'qty', label: 'Qty', type: 'number', readonlyWhen: "parent.status == 'paid'" },
    ],
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Longer than the last of the retired scrape timers (800 ms). */
const PAST_THE_TIMERS_MS = 1100;

function renderEdit(stored: Record<string, unknown>) {
  const header = deferred<Record<string, unknown>>();
  const ds: any = {
    getObjectSchema: vi.fn().mockResolvedValue(INV_SCHEMA),
    findOne: vi.fn(() => header.promise),
    find: vi.fn(async (o: string) => ({
      data: o === 'inv_line' ? [{ id: 'l1', inv: 'inv1', product: 'Widget', qty: 6 }] : [],
    })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
  };
  const view = render(
    <MasterDetailForm
      schema={{ objectName: 'inv', mode: 'edit', recordId: 'inv1', fields: ['status'], details } as any}
      dataSource={ds}
    />,
  );
  const land = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, PAST_THE_TIMERS_MS));
    });
    await act(async () => {
      header.resolve({ id: 'inv1', ...stored });
      await header.promise;
    });
  };
  return { ...view, ds, land };
}

const qty = () => screen.getAllByLabelText('Qty')[0] as HTMLInputElement;
const product = () => screen.getAllByLabelText('Product')[0] as HTMLInputElement;
const statusInput = async (container: HTMLElement, value: string) =>
  waitFor(() => {
    const el = container.querySelector('input[name="status"]') as HTMLInputElement | null;
    if (!el || el.value !== value) throw new Error(`header has not landed '${value}'`);
    return el;
  });

describe('MasterDetailForm — a late header record still drives parent-scoped line rules (objectui#13062)', () => {
  it('(a) a stored paid record whose header arrives past 800 ms opens with the locked line cells disabled', async () => {
    const { container, ds, land } = renderEdit({ status: 'paid' });
    // The line row is on screen before the header record exists.
    await waitFor(() => expect(product().value).toBe('Widget'));

    await land();

    // The header shows the stored record — the read reached it untouched.
    await statusInput(container, 'paid');
    expect(ds.findOne).toHaveBeenCalledWith('inv', 'inv1');
    await waitFor(() => expect(qty().disabled).toBe(true));
    // A column without a rule stays editable.
    expect(product().disabled).toBe(false);
  }, 15000);

  it('(b) a live header flip locks the cells at once, and a flip back unlocks them', async () => {
    const { container, land } = renderEdit({ status: 'draft' });
    await waitFor(() => expect(product().value).toBe('Widget'));
    await land();
    const status = await statusInput(container, 'draft');
    await waitFor(() => expect(qty().disabled).toBe(false));

    fireEvent.change(status, { target: { value: 'paid' } });
    await waitFor(() => expect(qty().disabled).toBe(true));

    fireEvent.change(status, { target: { value: 'draft' } });
    await waitFor(() => expect(qty().disabled).toBe(false));
  }, 15000);

  it('(c) control: a stored non-paid record leaves the cells editable', async () => {
    const { container, land } = renderEdit({ status: 'sent' });
    await waitFor(() => expect(product().value).toBe('Widget'));
    await land();
    await statusInput(container, 'sent');
    expect(qty().disabled).toBe(false);
  }, 15000);

  it('(c) control: a create form with an empty parent leaves the cells editable', async () => {
    const ds: any = {
      getObjectSchema: vi.fn().mockResolvedValue(INV_SCHEMA),
      findOne: vi.fn(),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulk: vi.fn(),
    };
    const { container } = render(
      <MasterDetailForm
        schema={{ objectName: 'inv', mode: 'create', fields: ['status'], details } as any}
        dataSource={ds}
      />,
    );
    const status = await statusInput(container, '');
    await waitFor(() => expect(qty().disabled).toBe(false));
    // A create form reads no record.
    expect(ds.findOne).not.toHaveBeenCalled();
    // The live path is the same as an edit form's.
    fireEvent.change(status, { target: { value: 'paid' } });
    await waitFor(() => expect(qty().disabled).toBe(true));
  }, 15000);
});
