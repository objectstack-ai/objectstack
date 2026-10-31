/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A pick in a lookup fills the fields its `lookupAutofill` declares, in the
 * record form (objectstack#28245, the ui half of `FieldSchema.lookupAutofill`).
 *
 * End to end through ObjectForm: the object schema carries the pairs, the form
 * renderer hands the lookup its `onAutofill` writer, and the lookup applies the
 * spec's overwrite rule. Pinned: a pick fills an empty target; a value the
 * user typed is kept; `overwrite: true` replaces it; a value an earlier pick
 * filled is replaced by the next pick; the filled value is saved. Control: a
 * lookup without the key fills nothing, not even a same-named field.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererContext } from '@object-ui/react';

registerAllFields();

const SCHEMAS: Record<string, unknown> = {
  quote_line: {
    name: 'quote_line',
    fields: {
      product: {
        type: 'lookup',
        label: 'Product',
        reference: 'product',
        lookupAutofill: [
          { target: 'unit_price', source: 'list_price' },
          { target: 'description', source: 'summary', overwrite: true },
        ],
      },
      unit_price: { type: 'number', label: 'Sales Price' },
      description: { type: 'text', label: 'Description' },
      account: { type: 'lookup', label: 'Account', reference: 'account' },
      note: { type: 'text', label: 'Note' },
    },
  },
  product: {
    name: 'product',
    fields: {
      name: { type: 'text', label: 'Name' },
      list_price: { type: 'number', label: 'List Price' },
      summary: { type: 'text', label: 'Summary' },
    },
  },
  account: {
    name: 'account',
    fields: {
      name: { type: 'text', label: 'Name' },
      note: { type: 'text', label: 'Note' },
    },
  },
};

const ROWS: Record<string, Record<string, unknown>[]> = {
  product: [
    { id: 'p1', name: 'Widget', list_price: 100, summary: 'A widget' },
    { id: 'p2', name: 'Gadget', list_price: 250, summary: 'A gadget' },
  ],
  account: [{ id: 'a1', name: 'Acme', note: 'from the account' }],
};

const makeDS = () => ({
  getObjectSchema: vi.fn(async (name: string) => SCHEMAS[name]),
  find: vi.fn(async (name: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
    const wanted = params?.$filter?.id?.$in;
    const rows = (ROWS[name] ?? []).filter((r) => !wanted || wanted.includes(r.id));
    return { data: rows.map((r) => ({ ...r })), total: rows.length };
  }),
  findOne: vi.fn(async (name: string, id: string) => {
    const row = (ROWS[name] ?? []).find((r) => r.id === id);
    return row ? { ...row } : null;
  }),
  create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'l1', ...d })),
  update: vi.fn(),
});

const input = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

async function pick(field: string, title: string): Promise<void> {
  const trigger = await screen.findByTestId(`lookup-trigger-${field}`);
  await act(async () => {
    fireEvent.click(trigger);
  });
  const option = await waitFor(() => {
    const el = screen.getAllByRole('option').find((o) => (o.getAttribute('title') ?? o.textContent ?? '').includes(title));
    if (!el) throw new Error(`${title} not offered`);
    return el;
  }, { timeout: 3000 });
  await act(async () => {
    fireEvent.click(option);
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function renderForm() {
  const ds = makeDS();
  // Mounted the way the console mounts a form: the lookup reads its records
  // through the renderer context's data source.
  const view = render(
    <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'quote_line', mode: 'create' } as any}
        dataSource={ds as any}
      />
    </SchemaRendererContext.Provider>,
  );
  return { ds, container: view.container };
}

describe('ObjectForm — a lookup pick fills its declared lookupAutofill targets (objectstack#28245)', () => {
  it('fills an empty target from the picked record, and saves the filled value', async () => {
    const { ds, container } = renderForm();
    await input(container, 'unit_price');
    await pick('product', 'Widget');

    await waitFor(() => expect((container.querySelector('input[name="unit_price"]') as HTMLInputElement).value).toBe('100'));
    expect((container.querySelector('input[name="description"]') as HTMLInputElement).value).toBe('A widget');

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ product: 'p1', unit_price: 100, description: 'A widget' });
  });

  it("keeps a value the user typed, and `overwrite: true` replaces one", async () => {
    const { container } = renderForm();
    fireEvent.change(await input(container, 'unit_price'), { target: { value: '77' } });
    fireEvent.change(await input(container, 'description'), { target: { value: 'my words' } });
    await pick('product', 'Widget');

    await waitFor(() => expect((container.querySelector('input[name="description"]') as HTMLInputElement).value).toBe('A widget'));
    expect((container.querySelector('input[name="unit_price"]') as HTMLInputElement).value).toBe('77');
  });

  it('replaces a value an earlier pick filled, and keeps it once the user edits it', async () => {
    const { container } = renderForm();
    await input(container, 'unit_price');
    await pick('product', 'Widget');
    await waitFor(() => expect((container.querySelector('input[name="unit_price"]') as HTMLInputElement).value).toBe('100'));

    await pick('product', 'Gadget');
    await waitFor(() => expect((container.querySelector('input[name="unit_price"]') as HTMLInputElement).value).toBe('250'));

    fireEvent.change(await input(container, 'unit_price'), { target: { value: '90' } });
    await pick('product', 'Widget');
    await waitFor(() => expect((container.querySelector('input[name="description"]') as HTMLInputElement).value).toBe('A widget'));
    expect((container.querySelector('input[name="unit_price"]') as HTMLInputElement).value).toBe('90');
  });

  it('a pick from the browse-all dialog fills the target too', async () => {
    const { container } = renderForm();
    await input(container, 'unit_price');
    const browse = await waitFor(() => {
      const el = container.querySelector('[data-field="product"] [data-testid="browse-all-records"]') as HTMLElement | null;
      if (!el) throw new Error('browse not ready');
      return el;
    });
    await act(async () => {
      fireEvent.click(browse);
    });
    const row = await screen.findByTestId('record-row-p2', {}, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(row);
    });
    await waitFor(() => expect((container.querySelector('input[name="unit_price"]') as HTMLInputElement).value).toBe('250'));
  });

  it('control: a lookup without the key fills nothing, not even a same-named field', async () => {
    const { ds, container } = renderForm();
    await input(container, 'note');
    await pick('account', 'Acme');

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const saved = ds.create.mock.calls[0][1];
    expect(saved).toMatchObject({ account: 'a1' });
    expect(saved.note ?? '').toBe('');
    expect(saved.unit_price ?? null).toBe(null);
    expect((container.querySelector('input[name="note"]') as HTMLInputElement).value).toBe('');
  });
});
