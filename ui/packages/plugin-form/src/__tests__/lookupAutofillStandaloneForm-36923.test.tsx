/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36923 — `lookupAutofill` is an object fact, run where the object
 * is read: a record form and a line-item grid column. A `lookupAutofill`
 * written by hand on a field of a standalone `form` node is not run (ruling
 * record 7138010812): the pick sets the lookup and copies nothing into other
 * fields, and a development build names the field once.
 *
 * The widget tells a record form apart by the stamp the record form puts on
 * every lookup that declares pairs (`withLookupAutofillTargets`, applied by
 * `stampRecordFormFields` in the one step every layout draws through). The
 * stamp is written even when the field map names none of the targets, and
 * only a stamp the form issued counts: the key written as data is none.
 *
 * Pinned: a bare form node's pick fills nothing and warns once; a forged
 * stamp opts nothing in; a record form still fills a same-currency amount and
 * still withholds a cross-currency one (the cross-currency rule); a line-item
 * grid column still fills.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, fireEvent, screen, act, cleanup } from '@testing-library/react';
import React from 'react';

import '@object-ui/components';
import {
  registerAllFields,
  GridField,
  preloadGridField,
  LOOKUP_AUTOFILL_TARGETS_KEY,
  readLookupAutofillTargets,
  withLookupAutofillTargets,
} from '@object-ui/fields';
import { SchemaRenderer, SchemaRendererContext, SchemaRendererProvider } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { ObjectForm } from '../ObjectForm';
import { stampRecordFormFields } from '../recordFormStamp';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PAIRS = [
  { target: 'unit_price', source: 'list_price' },
  { target: 'description', source: 'summary' },
];

const SCHEMAS: Record<string, unknown> = {
  fx_quote: {
    name: 'fx_quote',
    fields: {
      currency_code: { type: 'text', label: 'Currency' },
      product: { type: 'lookup', label: 'Product', reference: 'fx_product', lookupAutofill: PAIRS },
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

const PRODUCTS = [
  { id: 'p1', name: 'Widget', list_price: 100, summary: 'A widget' },
  { id: 'p2', name: 'Gadget', list_price: 250, summary: 'A gadget' },
];

const makeDS = () => ({
  getObjectSchema: vi.fn(async (name: string) => SCHEMAS[name]),
  find: vi.fn(async (_name: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
    const wanted = params?.$filter?.id?.$in;
    const rows = PRODUCTS.filter((r) => !wanted || wanted.includes(r.id));
    return { data: rows.map((r) => ({ ...r })), total: rows.length };
  }),
  findOne: vi.fn(async (_name: string, id: string) => {
    const row = PRODUCTS.find((r) => r.id === id);
    return row ? { ...row } : null;
  }),
  create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'q1', ...d })),
  update: vi.fn(),
});

const valueOf = (c: HTMLElement, name: string) =>
  (c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function pick(trigger: HTMLElement, title: string): Promise<void> {
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
  await settle();
}

/** The development-build warnings that name `field` as a `lookupAutofill` not run. */
const refusals = (warn: { mock: { calls: unknown[][] } }, field: string) =>
  warn.mock.calls.filter(([m]: unknown[]) => typeof m === 'string' && m.includes(`lookupAutofill on "${field}" is not executed`));

function renderBareForm(lookup: Record<string, unknown>) {
  const ds = makeDS();
  const view = render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          fields: [
            lookup,
            { name: 'unit_price', label: 'Unit Price', type: 'number' },
            { name: 'description', label: 'Description', type: 'text' },
          ],
        } as any}
      />
    </SchemaRendererProvider>,
  );
  return { ds, container: view.container, rerender: view.rerender };
}

describe('a standalone form node does not run a lookupAutofill written on its field (objectstack#36923)', () => {
  it('a pick sets the lookup and copies nothing into other fields; a development build names the field once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderBareForm({
      name: 'bare_product',
      label: 'Product',
      type: 'lookup',
      reference: 'fx_product',
      lookupAutofill: PAIRS,
    });
    await pick(await screen.findByTestId('lookup-trigger-bare_product'), 'Widget');

    await waitFor(() => expect(screen.getByTestId('lookup-trigger-bare_product').textContent).toContain('Widget'));
    expect(valueOf(container, 'unit_price')).toBe('');
    expect(valueOf(container, 'description')).toBe('');
    expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();

    // A second pick: still nothing copied, and the field is named once only.
    await pick(screen.getByTestId('lookup-trigger-bare_product'), 'Gadget');
    expect(valueOf(container, 'description')).toBe('');
    expect(refusals(warn, 'bare_product')).toHaveLength(1);
  });

  it('a production build copies nothing and says nothing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { container } = renderBareForm({
        name: 'prod_product',
        label: 'Product',
        type: 'lookup',
        reference: 'fx_product',
        lookupAutofill: PAIRS,
      });
      await pick(await screen.findByTestId('lookup-trigger-prod_product'), 'Widget');

      await waitFor(() => expect(screen.getByTestId('lookup-trigger-prod_product').textContent).toContain('Widget'));
      expect(valueOf(container, 'description')).toBe('');
      expect(refusals(warn, 'prod_product')).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a lookupAutofillTargets key written by hand is no stamp: the pick still copies nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderBareForm({
      name: 'forged_product',
      label: 'Product',
      type: 'lookup',
      reference: 'fx_product',
      lookupAutofill: PAIRS,
      [LOOKUP_AUTOFILL_TARGETS_KEY]: { description: { type: 'text' }, unit_price: { type: 'number' } },
    });
    await pick(await screen.findByTestId('lookup-trigger-forged_product'), 'Widget');

    await waitFor(() => expect(screen.getByTestId('lookup-trigger-forged_product').textContent).toContain('Widget'));
    expect(valueOf(container, 'unit_price')).toBe('');
    expect(valueOf(container, 'description')).toBe('');
    expect(refusals(warn, 'forged_product')).toHaveLength(1);
  });
});

describe('the record-form stamp is the test, and it is written even when no target is in the field map (objectstack#36923)', () => {
  const lookup = { name: 'product', type: 'lookup', reference: 'fx_product', lookupAutofill: PAIRS };

  it('a lookup declaring pairs is stamped with no field map, and with a map that names none of its targets', () => {
    for (const fields of [null, undefined, { other: { type: 'text' } }]) {
      const targets = readLookupAutofillTargets(withLookupAutofillTargets(lookup, fields));
      expect(targets).toEqual({});
    }
    const [stamped] = stampRecordFormFields([lookup], undefined) ?? [];
    expect(readLookupAutofillTargets(stamped)).toEqual({});
  });

  it('control: a field without pairs is not stamped, and the key written as data reads as no stamp', () => {
    const plain = { name: 'account', type: 'lookup', reference: 'account' };
    expect(withLookupAutofillTargets(plain, SCHEMAS.fx_quote as never)).toBe(plain);
    expect(readLookupAutofillTargets({ ...lookup, [LOOKUP_AUTOFILL_TARGETS_KEY]: {} })).toBeUndefined();
  });
});

describe('a record form keeps running the object lookupAutofill, the cross-currency rule included (objectstack#36923)', () => {
  function renderQuote(initialValues: Record<string, unknown>) {
    const ds = makeDS();
    const view = render(
      <LocalizationProvider value={{ currency: 'USD' }}>
        <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
          <ObjectForm
            schema={{ type: 'object-form', objectName: 'fx_quote', mode: 'create', initialValues } as any}
            dataSource={ds as any}
          />
        </SchemaRendererContext.Provider>
      </LocalizationProvider>,
    );
    return { container: view.container };
  }

  it('a USD quote: the price and the description fill, with no note and no warning', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { container } = renderQuote({ currency_code: 'USD' });
    await pick(await screen.findByTestId('lookup-trigger-product'), 'Widget');

    await waitFor(() => expect(valueOf(container, 'description')).toBe('A widget'));
    await waitFor(() => expect(valueOf(container, 'unit_price')).toBe('100'));
    expect(screen.queryByTestId('lookup-autofill-withheld')).toBeNull();
    expect(refusals(warn, 'product')).toHaveLength(0);
  });

  it('a EUR quote: the description fills, the price stays empty and the form says why', async () => {
    const { container } = renderQuote({ currency_code: 'EUR' });
    await pick(await screen.findByTestId('lookup-trigger-product'), 'Widget');

    await waitFor(() => expect(valueOf(container, 'description')).toBe('A widget'));
    const note = await screen.findByTestId('lookup-autofill-withheld');
    expect(note.querySelector('[data-withheld-target="unit_price"]')).not.toBeNull();
    expect(valueOf(container, 'unit_price')).toBe('');
  });
});

describe('a line-item grid column keeps running its pairs (objectstack#36923)', () => {
  it('a cell pick fills the declared target', async () => {
    await preloadGridField();
    const ds = makeDS();
    function Host() {
      const [rows, setRows] = React.useState<Record<string, unknown>[]>([{ product: null, unit_price: null }]);
      return (
        <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
          <GridField
            value={rows}
            onChange={(next: Record<string, unknown>[]) => setRows(next)}
            field={{ columns: [
              { name: 'product', type: 'lookup', reference: 'fx_product' },
              { name: 'unit_price', type: 'number' },
            ] } as never}
            lookupAutofill={{ product: [{ target: 'unit_price', source: 'list_price' }] }}
          />
          <output data-testid="rows">{JSON.stringify(rows)}</output>
        </SchemaRendererContext.Provider>
      );
    }
    render(<Host />);
    await pick(screen.getAllByTestId('lookup-trigger')[0], 'Widget');
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId('rows').textContent || '[]')[0]).toMatchObject({ product: 'p1', unit_price: 100 }),
    );
  });
});
