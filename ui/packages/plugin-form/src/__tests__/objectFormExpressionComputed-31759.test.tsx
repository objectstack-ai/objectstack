/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A stored field carrying an `expression` is computed on the record form
 * (objectstack#31759).
 *
 * `@objectstack/spec`'s `FieldSchema.expression`: on a non-`formula` field the
 * engine computes the value from the row the write stores and stores it, "so a
 * client-sent value never stands". The form drew such a field (the showcase's
 * `showcase_invoice_line.amount`, a `currency` over quantity × unit price) as
 * an editable input, and the save replaced what the user typed without a word.
 *
 * The rule pinned here: such a field is computed exactly as a `formula` is.
 * The auto-layout create form drops it; the edit form, and an authored
 * section on either form, draw its type's READ face (no input, the formatted
 * value), through `readonly: true` on the FormField, which the edit submit
 * also omits. CONTROL rows: a plain `currency` field of the same shape stays an
 * input everywhere, and a `formula` answers as it did.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from '../ObjectForm';

const OBJECT = {
  name: 'invoice_line',
  fields: {
    quantity: { type: 'number', label: 'Quantity' },
    unit_price: { type: 'currency', label: 'Unit Price' },
    amount: { type: 'currency', label: 'Amount', expression: 'record.quantity * record.unit_price' },
    margin: {
      type: 'number',
      label: 'Margin',
      expression: { dialect: 'cel', source: 'record.unit_price - 1' },
    },
    doubled: { type: 'formula', label: 'Doubled', expression: 'record.quantity * 2', returnType: 'number' },
  },
};

const RECORD = { id: 'r1', quantity: 2, unit_price: 5, amount: 10, margin: 4, doubled: 4 };

const makeDataSource = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(OBJECT),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'r1', ...d })),
  update: vi.fn(async (_o: string, _id: string, d: Record<string, unknown>) => ({ id: 'r1', ...d })),
  findOne: vi.fn(async () => RECORD),
});

const SECTIONS = [{ name: 'lines', label: 'Line', fields: ['quantity', 'unit_price', 'amount', 'margin', 'doubled'] }];

async function renderForm(mode: 'create' | 'edit', extra: Record<string, unknown> = {}) {
  const ds = makeDataSource();
  const { container } = render(
    <ObjectForm
      schema={{
        type: 'object-form',
        objectName: 'invoice_line',
        mode,
        ...(mode === 'edit' ? { recordId: 'r1' } : {}),
        ...extra,
      } as any}
      dataSource={ds as any}
    />,
  );
  await waitFor(() => {
    const q = container.querySelector<HTMLInputElement>('input[name="quantity"]');
    if (!q) throw new Error('form not ready');
    if (mode === 'edit' && q.value !== '2') throw new Error('record not on screen');
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return {
    ds,
    container,
    input: (name: string) => container.querySelector<HTMLInputElement>(`[name="${name}"]`),
    text: () => container.textContent ?? '',
  };
}

describe('auto-layout create form: a field carrying an expression is dropped, as a formula is', () => {
  it('draws neither the stored-expression fields nor the formula', async () => {
    const { input, text } = await renderForm('create');
    expect(input('amount')).toBeNull();
    expect(input('margin')).toBeNull();
    expect(text()).not.toContain('Amount');
    expect(text()).not.toContain('Margin');
    expect(text()).not.toContain('Doubled');
  });

  it('CONTROL: the plain currency field of the same shape is an input', async () => {
    const { input } = await renderForm('create');
    expect(input('unit_price')).not.toBeNull();
  });
});

describe('auto-layout edit form: a field carrying an expression draws its read face', () => {
  it('offers no input and shows the stored value, for a bare string and an envelope', async () => {
    const { input, text } = await renderForm('edit');
    expect(input('amount')).toBeNull();
    expect(input('margin')).toBeNull();
    expect(text()).toContain('Amount');
    // The currency read face's formatted amount (no tenant currency here, so
    // no symbol): the stored 10, never an input holding it.
    expect(text()).toMatch(/Amount10\.00/);
    expect(text()).toMatch(/Margin4/);
  });

  it('CONTROL: the plain currency field stays an editable input; the formula is drawn read-only, as before', async () => {
    const { input, text } = await renderForm('edit');
    const price = input('unit_price');
    expect(price).not.toBeNull();
    expect(price!.disabled).toBe(false);
    expect(price!.readOnly).toBe(false);
    expect(input('doubled')).toBeNull();
    expect(text()).toContain('Doubled');
  });
});

describe('authored sections: a field carrying an expression draws its read face on create and edit', () => {
  for (const mode of ['create', 'edit'] as const) {
    it(`${mode}: the listed field is drawn with no input; the plain currency stays an input`, async () => {
      const { input, text } = await renderForm(mode, { sections: SECTIONS });
      expect(input('amount')).toBeNull();
      expect(input('margin')).toBeNull();
      expect(text()).toContain('Amount');
      const price = input('unit_price');
      expect(price).not.toBeNull();
      expect(price!.disabled).toBe(false);
    });
  }
});
