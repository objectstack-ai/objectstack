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
import { render, waitFor, fireEvent, screen, act, cleanup } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from './ObjectForm';
import { ModalForm } from './ModalForm';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererContext } from '@object-ui/react';
import { createI18n, I18nProvider, LocalizationProvider } from '@object-ui/i18n';

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

/**
 * A create form that OPENS with the lookup already holding a record — a
 * related list's New pre-linking its parent, a URL prefill, a form view
 * default — fills that lookup's declared targets from it, as a pick does
 * (objectstack#35050). The record is the one the lookup reads for its label,
 * so the fill costs no second read. Only an empty target fills: a value the
 * form opened with is an explicit one, and `overwrite: true` does not replace
 * it. Controls: an edit form fills nothing from the stored record; a lookup
 * without the key fills nothing.
 */
describe('ObjectForm — a create form opened with a lookup value fills its declared targets (objectstack#35050)', () => {
  function renderSeeded(initialValues: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const ds = makeDS();
    const view = render(
      <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
        <ObjectForm
          schema={{ type: 'object-form', objectName: 'quote_line', mode: 'create', initialValues, ...extra } as any}
          dataSource={ds as any}
        />
      </SchemaRendererContext.Provider>,
    );
    return { ds, container: view.container };
  }

  const valueOf = (c: HTMLElement, name: string) => (c.querySelector(`input[name="${name}"]`) as HTMLInputElement).value;

  it('fills the empty targets from the record the lookup opened with, and saves them', async () => {
    const { ds, container } = renderSeeded({ product: 'p1' });
    await input(container, 'unit_price');

    await waitFor(() => expect(valueOf(container, 'unit_price')).toBe('100'));
    expect(valueOf(container, 'description')).toBe('A widget');

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    expect(ds.create.mock.calls[0][1]).toMatchObject({ product: 'p1', unit_price: 100, description: 'A widget' });
  });

  it('keeps every value the form opened with, `overwrite: true` included, and fills the rest', async () => {
    const { container } = renderSeeded({ product: 'p1', description: 'my words' });
    await input(container, 'unit_price');

    await waitFor(() => expect(valueOf(container, 'unit_price')).toBe('100'));
    expect(valueOf(container, 'description')).toBe('my words');
  });

  it('a pick after the opening fill still follows the pick rule', async () => {
    const { container } = renderSeeded({ product: 'p1' });
    await input(container, 'unit_price');
    await waitFor(() => expect(valueOf(container, 'unit_price')).toBe('100'));

    await pick('product', 'Gadget');
    await waitFor(() => expect(valueOf(container, 'unit_price')).toBe('250'));
    expect(valueOf(container, 'description')).toBe('A gadget');
  });

  it('the opening fill is not an edit: an untouched form closes without the discard prompt, a touched one still asks', async () => {
    const ds = makeDS();
    const onOpenChange = vi.fn();
    render(
      <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
        <ModalForm
          schema={{ objectName: 'quote_line', mode: 'create', open: true, onOpenChange, initialValues: { product: 'p1' } } as any}
          dataSource={ds as any}
        />
      </SchemaRendererContext.Provider>,
    );
    const price = await input(document.body, 'unit_price');
    await waitFor(() => expect(price.value).toBe('100'));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Discard changes?')).toBeNull();

    // The guard is live in this form: the user's own edit is one.
    onOpenChange.mockClear();
    fireEvent.change(await input(document.body, 'note'), { target: { value: 'typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Discard changes?')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('control: an edit form fills nothing from the record it loaded', async () => {
    const ds = makeDS();
    ds.findOne.mockImplementation(async (name: string, id: string) => {
      if (name === 'quote_line' && id === 'l9') return { id: 'l9', product: 'p1', unit_price: null, description: null };
      const row = (ROWS[name] ?? []).find((r) => r.id === id);
      return row ? { ...row } : null;
    });
    const { container } = render(
      <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
        <ObjectForm schema={{ type: 'object-form', objectName: 'quote_line', mode: 'edit', recordId: 'l9' } as any} dataSource={ds as any} />
      </SchemaRendererContext.Provider>,
    );
    await input(container, 'unit_price');
    // The lookup read its record for the label: the fill had what it needed.
    await waitFor(() => expect(ds.findOne).toHaveBeenCalledWith('product', 'p1'));
    await waitFor(() => expect(screen.getByTestId('lookup-trigger-product').textContent).toContain('Widget'));
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    expect(valueOf(container, 'unit_price')).toBe('');
    expect(valueOf(container, 'description')).toBe('');
  });

  it('control: a lookup without the key fills nothing from its opening value', async () => {
    const { ds, container } = renderSeeded({ account: 'a1', product: 'p1' });
    await input(container, 'note');
    await waitFor(() => expect(valueOf(container, 'unit_price')).toBe('100'));
    await waitFor(() => expect(ds.findOne).toHaveBeenCalledWith('account', 'a1'));
    expect(valueOf(container, 'note')).toBe('');
  });
});

describe('ObjectForm — a pick does not copy an amount into a field in another currency (objectstack#36249)', () => {
  // A quote whose price follows its own currency code (ADR-0144 D2), and a
  // catalog whose price is in the home currency (USD here).
  const CURRENCY_SCHEMAS: Record<string, unknown> = {
    fx_quote: {
      name: 'fx_quote',
      fields: {
        currency_code: { type: 'text', label: 'Currency' },
        product: {
          type: 'lookup',
          label: 'Product',
          reference: 'fx_product',
          lookupAutofill: [
            { target: 'unit_price', source: 'list_price' },
            { target: 'description', source: 'summary' },
          ],
        },
        unit_price: {
          type: 'currency',
          label: 'Unit Price',
          currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
        },
        description: { type: 'text', label: 'Description' },
      },
    },
    fx_product: {
      name: 'fx_product',
      fields: {
        name: { type: 'text', label: 'Name' },
        list_price: { type: 'currency', label: 'List Price' },
        summary: { type: 'text', label: 'Summary' },
      },
    },
  };
  const CURRENCY_ROWS: Record<string, Record<string, unknown>[]> = {
    fx_product: [{ id: 'p1', name: 'Widget', list_price: 100, summary: 'A widget' }],
  };
  const makeCurrencyDS = () => ({
    getObjectSchema: vi.fn(async (name: string) => CURRENCY_SCHEMAS[name]),
    find: vi.fn(async (name: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
      const wanted = params?.$filter?.id?.$in;
      const rows = (CURRENCY_ROWS[name] ?? []).filter((r) => !wanted || wanted.includes(r.id));
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }),
    findOne: vi.fn(async (name: string, id: string) => {
      const row = (CURRENCY_ROWS[name] ?? []).find((r) => r.id === id);
      return row ? { ...row } : null;
    }),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'q1', ...d })),
    update: vi.fn(),
  });

  function renderQuote(initialValues: Record<string, unknown>, i18n?: ReturnType<typeof createI18n>) {
    const ds = makeCurrencyDS();
    const form = (
      <LocalizationProvider value={{ currency: 'USD' }}>
        <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
          <ObjectForm
            schema={{ type: 'object-form', objectName: 'fx_quote', mode: 'create', initialValues } as any}
            dataSource={ds as any}
          />
        </SchemaRendererContext.Provider>
      </LocalizationProvider>
    );
    const view = render(i18n ? <I18nProvider instance={i18n}>{form}</I18nProvider> : form);
    return { ds, container: view.container };
  }

  it('a EUR quote: the price stays empty and the form says why; the description still fills', async () => {
    const { container } = renderQuote({ currency_code: 'EUR' });
    await input(container, 'description');
    await pick('product', 'Widget');

    await waitFor(() => expect((container.querySelector('input[name="description"]') as HTMLInputElement).value).toBe('A widget'));
    const note = await screen.findByTestId('lookup-autofill-withheld');
    expect(note.querySelector('[data-withheld-target="unit_price"]')).not.toBeNull();
    expect(note.textContent).toContain('$100.00');
    expect(note.textContent).toContain('USD');
    expect(note.textContent).toContain('EUR');
    const price = container.querySelector('input[name="unit_price"]') as HTMLInputElement | null;
    expect(price?.value ?? '').toBe('');
  });

  it('the note names the field as the form shows it: the translated label, not the authored one', async () => {
    const i18n = createI18n({
      defaultLanguage: 'zh',
      detectBrowserLanguage: false,
      resources: { zh: { app: { fields: { fx_quote: { unit_price: '单价' } } } } },
    });
    const { container } = renderQuote({ currency_code: 'EUR' }, i18n);
    await input(container, 'description');
    await screen.findByText('单价');
    await pick('product', 'Widget');

    const note = await screen.findByTestId('lookup-autofill-withheld');
    const line = note.querySelector('[data-withheld-target="unit_price"]');
    expect(line?.textContent).toContain('单价');
    expect(line?.textContent).not.toContain('Unit Price');
    expect(line?.textContent).not.toContain('unit_price');
  });

  it('a USD quote: the price fills as before, with no note', async () => {
    const { container } = renderQuote({ currency_code: 'USD' });
    await input(container, 'description');
    await pick('product', 'Widget');

    await waitFor(() => expect((container.querySelector('input[name="description"]') as HTMLInputElement).value).toBe('A widget'));
    await waitFor(() => expect((container.querySelector('input[name="unit_price"]') as HTMLInputElement).value).toBe('100'));
    expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();
  });

  it('the opening fill follows the same rule: a EUR quote opened with a product fills no price', async () => {
    const { container } = renderQuote({ currency_code: 'EUR', product: 'p1' });
    await waitFor(() => expect((container.querySelector('input[name="description"]') as HTMLInputElement).value).toBe('A widget'));
    await screen.findByTestId('lookup-autofill-withheld');
    const price = container.querySelector('input[name="unit_price"]') as HTMLInputElement | null;
    expect(price?.value ?? '').toBe('');
  });
});

describe('ObjectForm — cross-currency pick follow-ups (objectstack#36412)', () => {
  const recordPrice = (currencyField: string) => ({
    type: 'currency',
    label: 'Unit Price',
    currencyConfig: { currencyMode: 'record', currencyField },
  });
  const SCHEMAS_36412: Record<string, unknown> = {
    // A quote whose price follows its own code; a pick may write the price over a typed one.
    ow_quote: {
      name: 'ow_quote',
      fields: {
        currency_code: { type: 'text', label: 'Currency' },
        product: {
          type: 'lookup',
          label: 'Product',
          reference: 'cc_product',
          lookupAutofill: [
            { target: 'unit_price', source: 'list_price', overwrite: true },
            { target: 'description', source: 'summary' },
          ],
        },
        unit_price: recordPrice('currency_code'),
        description: { type: 'text', label: 'Description' },
      },
    },
    // A quote whose pick copies the product's code and its price together.
    cc_quote: {
      name: 'cc_quote',
      fields: {
        currency_code: { type: 'text', label: 'Currency' },
        product: {
          type: 'lookup',
          label: 'Product',
          reference: 'cc_product',
          lookupAutofill: [
            { target: 'currency_code', source: 'currency_code' },
            { target: 'unit_price', source: 'list_price' },
          ],
        },
        unit_price: recordPrice('currency_code'),
      },
    },
    // Control: the same quote, whose pick does not copy the code.
    nc_quote: {
      name: 'nc_quote',
      fields: {
        currency_code: { type: 'text', label: 'Currency' },
        product: {
          type: 'lookup',
          label: 'Product',
          reference: 'cc_product',
          lookupAutofill: [{ target: 'unit_price', source: 'list_price' }],
        },
        unit_price: recordPrice('currency_code'),
      },
    },
    // A line whose price follows its header's code (ADR-0144 D2 as amended).
    fp_line: {
      name: 'fp_line',
      fields: {
        invoice: { type: 'master_detail', label: 'Invoice', reference: 'fp_invoice' },
        product: {
          type: 'lookup',
          label: 'Product',
          reference: 'fx_product',
          lookupAutofill: [
            { target: 'unit_price', source: 'list_price' },
            { target: 'description', source: 'summary' },
          ],
        },
        unit_price: recordPrice('invoice.currency_code'),
        description: { type: 'text', label: 'Description' },
      },
    },
    fp_invoice: { name: 'fp_invoice', fields: { name: { type: 'text', label: 'Name' }, currency_code: { type: 'text', label: 'Currency' } } },
    fx_product: {
      name: 'fx_product',
      fields: {
        name: { type: 'text', label: 'Name' },
        list_price: { type: 'currency', label: 'List Price' },
        summary: { type: 'text', label: 'Summary' },
      },
    },
    cc_product: {
      name: 'cc_product',
      fields: {
        name: { type: 'text', label: 'Name' },
        currency_code: { type: 'text', label: 'Currency' },
        list_price: recordPrice('currency_code'),
        summary: { type: 'text', label: 'Summary' },
      },
    },
  };
  const ROWS_36412: Record<string, Record<string, unknown>[]> = {
    fx_product: [{ id: 'p1', name: 'Widget', list_price: 100, summary: 'A widget' }],
    cc_product: [{ id: 'p1', name: 'Widget', currency_code: 'EUR', list_price: 100, summary: 'A widget' }],
    fp_invoice: [{ id: 'h1', name: 'INV-1', currency_code: 'USD' }],
  };
  const makeDS36412 = (parentRead: 'answers' | 'fails' | 'none' = 'answers') => {
    const ds: Record<string, unknown> = {
      getObjectSchema: vi.fn(async (name: string) => SCHEMAS_36412[name]),
      find: vi.fn(async (name: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
        const wanted = params?.$filter?.id?.$in;
        const rows = (ROWS_36412[name] ?? []).filter((r) => !wanted || wanted.includes(r.id));
        return { data: rows.map((r) => ({ ...r })), total: rows.length };
      }),
      create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'n1', ...d })),
      update: vi.fn(),
    };
    if (parentRead !== 'none') {
      ds.findOne = vi.fn(async (name: string, id: string) => {
        if (name === 'fp_invoice' && parentRead === 'fails') throw new Error('network down');
        const row = (ROWS_36412[name] ?? []).find((r) => r.id === id);
        return row ? { ...row } : null;
      });
    }
    return ds;
  };

  function renderOn(objectName: string, initialValues: Record<string, unknown>, parentRead?: 'answers' | 'fails' | 'none') {
    const ds = makeDS36412(parentRead);
    const view = render(
      <LocalizationProvider value={{ currency: 'USD' }}>
        <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
          <ObjectForm schema={{ type: 'object-form', objectName, mode: 'create', initialValues } as any} dataSource={ds as any} />
        </SchemaRendererContext.Provider>
      </LocalizationProvider>,
    );
    return { ds, container: view.container };
  }
  const valueOf = (c: HTMLElement, name: string) => (c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';

  it('a pick over a filled amount in another currency keeps it and says so', async () => {
    const { container } = renderOn('ow_quote', { currency_code: 'JPY', unit_price: 80 });
    await input(container, 'description');
    await pick('product', 'Widget');

    await waitFor(() => expect(valueOf(container, 'description')).toBe('A widget'));
    const note = await screen.findByTestId('lookup-autofill-withheld');
    expect(note.querySelector('[data-withheld-target="unit_price"]')?.textContent).toContain('Unit Price still holds its earlier value.');
    expect(note.textContent).toContain('JPY');
    expect(valueOf(container, 'unit_price')).toContain('80');
  });

  it('control: the same pick over a filled amount in its own currency replaces it, with no note', async () => {
    const { container } = renderOn('ow_quote', { currency_code: 'EUR', unit_price: 80 });
    await input(container, 'description');
    await pick('product', 'Widget');

    await waitFor(() => expect(valueOf(container, 'unit_price')).toContain('100'));
    expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();
  });

  it('a pick that copies the code and the price together copies both onto a quote with no code yet', async () => {
    // The create form seeds a code field with the home currency: cleared here.
    const { container } = renderOn('cc_quote', { currency_code: null });
    await input(container, 'currency_code');
    await pick('product', 'Widget');

    await waitFor(() => expect(valueOf(container, 'currency_code')).toBe('EUR'));
    await waitFor(() => expect(valueOf(container, 'unit_price')).toContain('100'));
    expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();
  });

  it('control: a pick that does not copy the code leaves the price empty and says no currency is chosen', async () => {
    const { container } = renderOn('nc_quote', { currency_code: null });
    await input(container, 'currency_code');
    await pick('product', 'Widget');

    const note = await screen.findByTestId('lookup-autofill-withheld');
    expect(note.textContent).toContain('no currency is chosen');
    expect(valueOf(container, 'unit_price')).toBe('');
  });

  it('the opening fill does not wait for a parent read that failed: the description fills, the price says why', async () => {
    const { container } = renderOn('fp_line', { invoice: 'h1', product: 'p1' }, 'fails');
    await waitFor(() => expect(valueOf(container, 'description')).toBe('A widget'));
    const note = await screen.findByTestId('lookup-autofill-withheld');
    expect(note.textContent).toContain('the currency here could not be read');
    expect(valueOf(container, 'unit_price')).toBe('');
  });

  it('the opening fill does not wait for a parent read that cannot run (no findOne)', async () => {
    const { container } = renderOn('fp_line', { invoice: 'h1', product: 'p1' }, 'none');
    await waitFor(() => expect(valueOf(container, 'description')).toBe('A widget'));
    expect((await screen.findByTestId('lookup-autofill-withheld')).textContent).toContain('the currency here could not be read');
  });

  // Every layout a record form draws through stamps the targets
  // (`gateFormFields` → `stampRecordFormFields`), so the rule reaches each.
  const HOST_LAYOUTS: Array<{ layout: string; schema: Record<string, unknown> }> = [
    { layout: 'simple / flat (default arm)', schema: {} },
    { layout: 'simple / sections (default arm)', schema: { sections: [{ name: 'main', label: 'Main', fields: ['currency_code', 'product', 'unit_price'] }] } },
    { layout: 'drawer (DrawerForm)', schema: { formType: 'drawer' } },
    { layout: 'modal (ModalForm)', schema: { formType: 'modal' } },
    { layout: 'tabbed (TabbedForm)', schema: { formType: 'tabbed', sections: [{ name: 'main', label: 'Main', fields: ['currency_code', 'product', 'unit_price'] }] } },
    { layout: 'wizard (WizardForm)', schema: { formType: 'wizard', sections: [{ name: 'main', label: 'Main', fields: ['currency_code', 'product', 'unit_price'] }] } },
  ];
  for (const { layout, schema } of HOST_LAYOUTS) {
    it(`every record-form host judges the pick: ${layout} withholds a EUR price from a JPY quote, and fills a EUR one`, async () => {
      for (const [code, fills] of [['JPY', false], ['EUR', true]] as const) {
        const ds = makeDS36412();
        const view = render(
          <LocalizationProvider value={{ currency: 'USD' }}>
            <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
              <ObjectForm
                schema={{ type: 'object-form', objectName: 'nc_quote', mode: 'create', initialValues: { currency_code: code }, ...schema } as any}
                dataSource={ds as any}
              />
            </SchemaRendererContext.Provider>
          </LocalizationProvider>,
        );
        await input(document.body, 'currency_code');
        await pick('product', 'Widget');
        if (fills) {
          await waitFor(() => expect(valueOf(document.body, 'unit_price')).toContain('100'));
          expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();
        } else {
          expect((await screen.findByTestId('lookup-autofill-withheld')).textContent).toContain('JPY');
          expect(valueOf(document.body, 'unit_price')).toBe('');
        }
        view.unmount();
      }
    });
  }

  it('control: a parent read that answers fills the price in its code, with no note', async () => {
    const { container } = renderOn('fp_line', { invoice: 'h1', product: 'p1' }, 'answers');
    await waitFor(() => expect(valueOf(container, 'description')).toBe('A widget'));
    await waitFor(() => expect(valueOf(container, 'unit_price')).toContain('100'));
    expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();
  });
});

describe('ObjectForm — a same-edit currency change keeps amounts and says so (objectstack#36412, ruling 「保留金额并提示」)', () => {
  // A quote whose price follows its own code, and a catalog priced in the
  // home currency (USD here).
  const SCHEMAS_RULING: Record<string, unknown> = {
    cn_quote: {
      name: 'cn_quote',
      fields: {
        currency_code: { type: 'text', label: 'Currency' },
        product: {
          type: 'lookup',
          label: 'Product',
          reference: 'cn_product',
          lookupAutofill: [
            { target: 'unit_price', source: 'list_price' },
            { target: 'description', source: 'summary' },
          ],
        },
        unit_price: { type: 'currency', label: 'Unit Price', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
        description: { type: 'text', label: 'Description' },
      },
    },
    // The same quote whose pick replaces a price somebody wrote.
    cn_ow_quote: {
      name: 'cn_ow_quote',
      fields: {
        currency_code: { type: 'text', label: 'Currency' },
        product: {
          type: 'lookup',
          label: 'Product',
          reference: 'cn_product',
          lookupAutofill: [
            { target: 'unit_price', source: 'list_price', overwrite: true },
            { target: 'description', source: 'summary' },
          ],
        },
        unit_price: { type: 'currency', label: 'Unit Price', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
        description: { type: 'text', label: 'Description' },
      },
    },
    cn_product: {
      name: 'cn_product',
      fields: {
        name: { type: 'text', label: 'Name' },
        list_price: { type: 'currency', label: 'List Price' },
        summary: { type: 'text', label: 'Summary' },
      },
    },
  };
  const PRODUCTS = [{ id: 'p1', name: 'Widget', list_price: 100, summary: 'A widget' }];
  function renderQuote(currency_code: string, objectName = 'cn_quote', extra: Record<string, unknown> = {}) {
    const ds = {
      getObjectSchema: vi.fn(async (name: string) => SCHEMAS_RULING[name]),
      find: vi.fn(async (name: string) => {
        const rows = name === 'cn_product' ? PRODUCTS : [];
        return { data: rows.map((r) => ({ ...r })), total: rows.length };
      }),
      findOne: vi.fn(async (name: string, id: string) => (name === 'cn_product' ? { ...PRODUCTS.find((r) => r.id === id) } : null)),
      create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'q1', ...d })),
      update: vi.fn(),
    };
    const view = render(
      <LocalizationProvider value={{ currency: 'USD' }}>
        <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
          <ObjectForm schema={{ type: 'object-form', objectName, mode: 'create', initialValues: { currency_code, ...extra } } as any} dataSource={ds as any} />
        </SchemaRendererContext.Provider>
      </LocalizationProvider>,
    );
    return view.container;
  }
  const valueOf = (c: HTMLElement, name: string) => (c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';
  async function type(c: HTMLElement, name: string, value: string): Promise<void> {
    const el = await input(c, name);
    await act(async () => {
      fireEvent.change(el, { target: { value } });
    });
    await waitFor(() => expect(valueOf(c, name)).toContain(value));
  }

  it('a copied amount stays through a currency change, and a note names the code it was copied under', async () => {
    const c = renderQuote('USD');
    await input(c, 'description');
    await pick('product', 'Widget');
    await waitFor(() => expect(valueOf(c, 'unit_price')).toContain('100'));
    // Control: copied in the record's own currency, nothing to say.
    expect(screen.queryByTestId('lookup-autofill-copied')).toBeNull();

    await type(c, 'currency_code', 'EUR');
    expect(valueOf(c, 'unit_price')).toContain('100');
    const note = await screen.findByTestId('lookup-autofill-copied');
    expect(note.querySelector('[data-copied-target="unit_price"]')?.textContent).toBe(
      'Unit Price was copied as $100.00, but the record is now in EUR. Enter Unit Price in EUR if it should change.',
    );

    // Control: back in the currency it was copied under, the note ends.
    await type(c, 'currency_code', 'USD');
    await waitFor(() => expect(screen.queryByTestId('lookup-autofill-copied')).toBeNull());
    expect(valueOf(c, 'unit_price')).toContain('100');
  });

  it('a withheld note refreshes to the record’s new currency, and the amount stays empty', async () => {
    const c = renderQuote('JPY');
    await input(c, 'description');
    await pick('product', 'Widget');
    expect((await screen.findByTestId('lookup-autofill-withheld')).textContent).toContain('here is in JPY');

    await type(c, 'currency_code', 'GBP');
    await waitFor(() => expect(screen.getByTestId('lookup-autofill-withheld').textContent).toContain('here is in GBP'));
    expect(screen.getByTestId('lookup-autofill-withheld').textContent).not.toContain('JPY');
    expect(valueOf(c, 'unit_price')).toBe('');
  });

  it('branch B: the record turns to the picked amount’s own currency, the note stays, says so, and nothing fills until a pick again', async () => {
    const c = renderQuote('EUR');
    await input(c, 'description');
    await pick('product', 'Widget');
    await screen.findByTestId('lookup-autofill-withheld');

    await type(c, 'currency_code', 'USD');
    await waitFor(() =>
      expect(screen.getByTestId('lookup-autofill-withheld').textContent).toBe(
        'Unit Price was not filled when it was picked. The record is now in USD: pick again to fill $100.00.',
      ),
    );
    expect(valueOf(c, 'unit_price')).toBe('');

    // Control: the pick again the note offers fills it, and nothing is left to say.
    await pick('product', 'Widget');
    await waitFor(() => expect(valueOf(c, 'unit_price')).toContain('100'));
    expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();
    expect(screen.queryByTestId('lookup-autofill-copied')).toBeNull();
  });

  it('branch B over a price that still holds an earlier value: the note says to clear it, then pick again', async () => {
    const c = renderQuote('EUR', 'cn_ow_quote', { unit_price: 80 });
    await input(c, 'description');
    await pick('product', 'Widget');
    expect((await screen.findByTestId('lookup-autofill-withheld')).textContent).toContain('Unit Price still holds its earlier value.');

    await type(c, 'currency_code', 'USD');
    await waitFor(() =>
      expect(screen.getByTestId('lookup-autofill-withheld').textContent).toBe(
        'Unit Price was not filled when it was picked and still holds its earlier value. The record is now in USD: clear Unit Price, then pick again to fill $100.00.',
      ),
    );
    expect(valueOf(c, 'unit_price')).toContain('80');
  });

  it('a hand-typed amount gets no note through a currency change, nor one typed over a copied amount', async () => {
    const typed = renderQuote('USD');
    await type(typed, 'unit_price', '55');
    await type(typed, 'currency_code', 'EUR');
    expect(valueOf(typed, 'unit_price')).toContain('55');
    expect(screen.queryByTestId('lookup-autofill-copied')).toBeNull();
    expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();
    cleanup();

    const over = renderQuote('USD');
    await input(over, 'description');
    await pick('product', 'Widget');
    await waitFor(() => expect(valueOf(over, 'unit_price')).toContain('100'));
    await type(over, 'unit_price', '55');
    await type(over, 'currency_code', 'EUR');
    expect(valueOf(over, 'unit_price')).toContain('55');
    expect(screen.queryByTestId('lookup-autofill-copied')).toBeNull();
  });
});
