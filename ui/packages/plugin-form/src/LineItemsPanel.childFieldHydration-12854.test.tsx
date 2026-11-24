/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `record:line_items` column the author left untyped takes its `label`,
 * `type` and `options` from the child object's field (objectui#12854), through
 * the same `hydrateColumns` the master-detail carriers call.
 *
 * Before this, an identity-only column (`{ name }`) was headed by the bare
 * field name and drew its value as text, on screen and on a print page. The
 * spec's `RecordLineItemsProps.columns` describe declares the hydration default
 * (objectstack-ai/objectstack#24140).
 *
 * The heading's translation is the master-detail carriers' path: the
 * object-metadata endpoint serves the child object translated into the session
 * locale (`translateObject`, from `objects.CHILD.fields.F.label`), and the
 * hydrated label is the served one. The zh case therefore serves the child
 * schema the way that endpoint answers a zh session.
 *
 * The `CONTROL` cases pin the other half: an authored `label` is kept, and a
 * column whose field the child object does not declare renders as written.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';

registerAllFields();

afterEach(() => cleanup());

const CHILD_EN = {
  name: 'invoice_line',
  fields: {
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice' },
    quantity: { type: 'number', label: 'Quantity' },
    status: {
      type: 'select',
      label: 'Line status',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'billed', label: 'Billed' },
      ],
    },
  },
};

/** The same child object as the metadata endpoint serves it to a zh session. */
const CHILD_ZH = {
  name: 'invoice_line',
  fields: {
    invoice: { type: 'master_detail', label: '发票', reference: 'invoice' },
    quantity: { type: 'number', label: '数量' },
    status: {
      type: 'select',
      label: '行状态',
      options: [
        { value: 'open', label: '未结' },
        { value: 'billed', label: '已开票' },
      ],
    },
  },
};

const ROWS = [{ id: 'l1', quantity: 3, status: 'open', note: 'rush' }];

function panel(columns: unknown[]) {
  return {
    childObject: 'invoice_line',
    relationshipField: 'invoice',
    parentObject: 'invoice',
    parentId: 'inv1',
    columns,
  };
}

function dataSource(childSchema: unknown) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(childSchema),
    find: vi.fn(async () => ({ data: ROWS })),
  };
}

function mount(columns: unknown[], childSchema: unknown, language?: string) {
  const tree = (
    <SchemaRendererProvider dataSource={dataSource(childSchema) as never}>
      <LineItemsPanel schema={panel(columns) as never} />
    </SchemaRendererProvider>
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{tree}</I18nProvider>
    ) : (
      tree
    ),
  );
}

describe('record:line_items hydrates an untyped column from the child field (objectui#12854)', () => {
  it('an identity-only column is headed by the child field label, and draws through its type and options', async () => {
    mount([{ name: 'quantity' }, { name: 'status' }], CHILD_EN);

    expect(await screen.findByRole('columnheader', { name: 'Quantity' })).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: 'Line status' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'quantity' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'status' })).toBeNull();
    // `type: 'select'` and `options` came from the field: the cell is a picker
    // named by the hydrated label, showing the option's label rather than the
    // stored value.
    const [status] = await screen.findAllByRole('combobox', { name: 'Line status' });
    expect(status).toHaveTextContent('Open');
    expect(status).not.toHaveTextContent('open');
  });

  it('zh: the heading and the option label are the child field\'s translation as served', async () => {
    mount([{ name: 'quantity' }, { name: 'status' }], CHILD_ZH, 'zh');

    expect(await screen.findByRole('columnheader', { name: '数量' })).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: '行状态' })).toBeInTheDocument();
    expect((await screen.findAllByRole('combobox', { name: '行状态' }))[0]).toHaveTextContent('未结');
    expect(screen.queryByRole('columnheader', { name: 'quantity' })).toBeNull();
  });

  it('CONTROL — an authored label is kept; the type and options still come from the field', async () => {
    mount([{ name: 'quantity', label: 'Units' }, { name: 'status', label: 'State' }], CHILD_EN);

    expect(await screen.findByRole('columnheader', { name: 'Units' })).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: 'State' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Quantity' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Line status' })).toBeNull();
    expect((await screen.findAllByRole('combobox', { name: 'State' }))[0]).toHaveTextContent('Open');
  });

  it('CONTROL — a column whose field the child object does not declare renders as written', async () => {
    mount([{ name: 'quantity' }, { name: 'note' }], CHILD_EN);

    expect(await screen.findByRole('columnheader', { name: 'Quantity' })).toBeInTheDocument();
    expect(await screen.findByRole('columnheader', { name: 'note' })).toBeInTheDocument();
    // As before: no type, so a plain text input over the stored value.
    expect(((await screen.findAllByLabelText('note'))[0] as HTMLInputElement).value).toBe('rush');
  });
});

/**
 * objectstack-ai/objectstack#34286 — an identity-only column over a `formula`
 * child field formats the way that formula reads everywhere else. A formula
 * declaring `returnType: 'currency'` used to hydrate as text and print the bare
 * number (`157780`) where a plain currency field printed money; the column now
 * takes the type the formula's value is declared as (`hydrateColumns`).
 *
 * The tenant currency is USD here so money and a grouped number read
 * differently: `$157,780.00` against `157,780`.
 */
describe('record:line_items types a formula column by its returnType (#34286)', () => {
  const QUOTE_LINE = {
    name: 'quote_line',
    fields: {
      quote: { type: 'master_detail', label: 'Quote', reference: 'quote' },
      quantity: { type: 'number', label: 'Quantity' },
      unit_price: { type: 'currency', label: 'Unit price' },
      total_price: { type: 'formula', label: 'Total price', expression: 'quantity * unit_price', returnType: 'currency' },
      total_units: { type: 'formula', label: 'Total units', expression: 'quantity * unit_price', returnType: 'number' },
      total_raw: { type: 'formula', label: 'Total raw', expression: 'quantity * unit_price' },
    },
  };
  const LINES = [{ id: 'q1', quantity: 20, unit_price: 7889, total_price: 157780, total_units: 157780, total_raw: 157780 }];

  function mountQuote(columns: unknown[]) {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(QUOTE_LINE),
      find: vi.fn(async () => ({ data: LINES })),
    };
    return render(
      <LocalizationProvider value={{ locale: 'en', currency: 'USD' }}>
        <SchemaRendererProvider dataSource={ds as never}>
          <LineItemsPanel
            schema={{ childObject: 'quote_line', relationshipField: 'quote', parentObject: 'quote', parentId: 'qt1', columns } as never}
          />
        </SchemaRendererProvider>
      </LocalizationProvider>,
    );
  }
  const cell = async (name: string) => (await screen.findAllByText((_t, el) => el?.getAttribute('data-computed') === name))[0];

  it('a name-only column over a returnType currency formula prints money, not the bare number', async () => {
    mountQuote([{ name: 'quantity' }, { name: 'total_price' }]);
    expect(await screen.findByRole('columnheader', { name: 'Total price' })).toBeInTheDocument();
    expect(await cell('total_price')).toHaveTextContent('$157,780.00');
  });

  it('a name-only column over a returnType number formula prints a grouped number', async () => {
    mountQuote([{ name: 'quantity' }, { name: 'total_units' }]);
    expect(await cell('total_units')).toHaveTextContent(/^157,780$/);
  });

  it('CONTROL — a formula with no returnType prints as before (text)', async () => {
    mountQuote([{ name: 'quantity' }, { name: 'total_raw' }]);
    expect(await cell('total_raw')).toHaveTextContent(/^157780$/);
  });

  it('CONTROL — an authored type still wins', async () => {
    mountQuote([{ name: 'quantity' }, { name: 'unit_price' }, { name: 'total_price', type: 'number', computed: true, expr: 'quantity * unit_price' }]);
    expect(await cell('total_price')).toHaveTextContent(/^157,780$/);
  });
});
