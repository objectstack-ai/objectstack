/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A pick in a line-item grid's lookup cell fills the targets the child field's
 * `lookupAutofill` declares (objectstack#28245, the ui half of
 * `FieldSchema.lookupAutofill`).
 *
 * Pinned on the pure patch: a declared pair fills an empty target, keeps a
 * value somebody wrote, `overwrite: true` replaces it, a value an earlier pick
 * filled is replaced, the pair applies whatever the column's `autofill` says,
 * and a declared target is taken out of the same-named copy. Control: with no
 * pair the patch is the same-named copy it always was. Then through the grid
 * itself: the host hands the pairs over, a cell pick fills the row, and the
 * next pick replaces only what the first one filled.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { GridFieldWidget as GridField } from './grid-field/GridFieldWidget';
import { lookupAutofillPatch, planLookupAutofill } from './GridField';
import {
  amountCurrencyOf,
  crossCurrencyRefusal,
  declaredLookupAutofillPatch,
  lookupAutofillByField,
  pickedAmountCurrencyOf,
  planDeclaredLookupAutofill,
  copiedAutofillNow,
  withheldAutofillNow,
} from './lookupAutofill';

afterEach(cleanup);

const cols = [
  { name: 'product', type: 'lookup' as const, reference: 'product' },
  { name: 'description', type: 'text' as const },
  { name: 'unit_price', type: 'currency' as const },
];
const widget = { value: 'p1', label: 'Widget', name: 'Widget', description: 'Standard widget', unit_price: 29.99, list_price: 25 };
const gadget = { value: 'p2', label: 'Gadget', name: 'Gadget', description: 'Gadget', unit_price: 59.99, list_price: 50 };
const pairs = [{ target: 'unit_price', source: 'list_price' }];

describe('lookupAutofillPatch with declared lookupAutofill pairs (objectstack#28245)', () => {
  it('fills an empty target from the declared source, not from the same-named field', () => {
    const patch = lookupAutofillPatch(cols, cols[0], widget, { pairs, row: { unit_price: null } });
    expect(patch).toEqual({ product: 'p1', description: 'Standard widget', unit_price: 25 });
  });

  it("keeps a value somebody wrote: the same-named copy no longer writes a declared target", () => {
    const patch = lookupAutofillPatch(cols, cols[0], widget, { pairs, row: { unit_price: 10 } });
    expect(patch).toEqual({ product: 'p1', description: 'Standard widget' });
  });

  it('`overwrite: true` replaces a value somebody wrote', () => {
    const patch = lookupAutofillPatch(cols, cols[0], widget, {
      pairs: [{ target: 'unit_price', source: 'list_price', overwrite: true }],
      row: { unit_price: 10 },
    });
    expect(patch.unit_price).toBe(25);
  });

  it('replaces a value the earlier pick filled', () => {
    const patch = lookupAutofillPatch(cols, cols[0], gadget, { pairs, row: { product: 'p1', unit_price: 25 }, previous: widget });
    expect(patch.unit_price).toBe(50);
  });

  it('applies the declared pair on a column with `autofill: false`', () => {
    const patch = lookupAutofillPatch(cols, { ...cols[0], autofill: false }, widget, { pairs, row: {} });
    expect(patch).toEqual({ product: 'p1', unit_price: 25 });
  });

  it('control: with no declared pair the patch is the same-named copy', () => {
    expect(lookupAutofillPatch(cols, cols[0], widget, { row: { unit_price: 10 } })).toEqual(lookupAutofillPatch(cols, cols[0], widget));
    expect(lookupAutofillPatch(cols, cols[0], widget)).toEqual({ product: 'p1', description: 'Standard widget', unit_price: 29.99 });
  });
});

describe('declaredLookupAutofillPatch (objectstack#28245)', () => {
  it('writes nothing for a source the picked record does not carry', () => {
    expect(declaredLookupAutofillPatch(pairs, { id: 'p3', name: 'Hidden price' }, {})).toEqual({});
  });

  it('control: no pairs, no writes', () => {
    expect(declaredLookupAutofillPatch(undefined, widget, {})).toEqual({});
    expect(declaredLookupAutofillPatch([], widget, {})).toEqual({});
  });

  it('reads the pairs of single-value relationship fields only', () => {
    expect(
      lookupAutofillByField({
        product: { type: 'lookup', reference: 'product', lookupAutofill: pairs },
        tags: { type: 'lookup', reference: 'tag', multiple: true, lookupAutofill: pairs },
        name: { type: 'text', lookupAutofill: pairs },
        account: { type: 'lookup', reference: 'account' },
      }),
    ).toEqual({ product: pairs });
  });
});

describe('GridField — a lookup cell pick fills the declared targets (objectstack#28245)', () => {
  const ROWS = [
    { id: 'p1', name: 'Widget', list_price: 25 },
    { id: 'p2', name: 'Gadget', list_price: 50 },
  ];
  const ds = {
    find: vi.fn(async (_o: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
      const wanted = params?.$filter?.id?.$in;
      const rows = ROWS.filter((r) => !wanted || wanted.includes(r.id));
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }),
    findOne: vi.fn(async (_o: string, id: string) => {
      const row = ROWS.find((r) => r.id === id);
      return row ? { ...row } : null;
    }),
  };
  const gridColumns = [
    { name: 'product', type: 'lookup' as const, reference: 'product' },
    { name: 'unit_price', type: 'number' as const },
  ];

  function Host({ initial }: { initial: Record<string, unknown>[] }) {
    const [rows, setRows] = React.useState(initial);
    // The grid's lookup cells read their records through the renderer
    // context's data source, as in the console.
    return (
      <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
        <GridField
          value={rows}
          onChange={(next: Record<string, unknown>[]) => setRows(next)}
          field={{ columns: gridColumns } as never}
          lookupAutofill={{ product: pairs }}
        />
        <output data-testid="rows">{JSON.stringify(rows)}</output>
      </SchemaRendererContext.Provider>
    );
  }

  const rowsNow = () => JSON.parse(screen.getByTestId('rows').textContent || '[]');

  async function pickInFirstRow(name: string): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('lookup-trigger')[0]);
    });
    const option = await waitFor(() => {
      const el = screen.getAllByRole('option').find((o) => (o.getAttribute('title') ?? o.textContent ?? '').includes(name));
      if (!el) throw new Error(`${name} not offered`);
      return el;
    }, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(option);
    });
  }

  it('fills the target on a pick, replaces it on the next pick, and keeps an edited value', async () => {
    render(<Host initial={[{ product: null, unit_price: null }]} />);

    await pickInFirstRow('Widget');
    await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', unit_price: 25 }));

    await pickInFirstRow('Gadget');
    await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p2', unit_price: 50 }));
  });

  it('a pick from the browse-all dialog reaches the grid once, with its record, and fills the target', async () => {
    render(<Host initial={[{ product: null, unit_price: null }]} />);
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('browse-all-records')[0]);
    });
    const row = await screen.findByTestId('record-row-p2', {}, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(row);
    });
    await waitFor(() => expect(rowsNow()).toEqual([{ product: 'p2', unit_price: 50 }]));
  });

  it("keeps a stored line's own price: a value no pick in this grid filled", async () => {
    render(<Host initial={[{ product: 'p1', unit_price: 19 }]} />);

    await pickInFirstRow('Gadget');
    await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p2' }));
    expect(rowsNow()[0].unit_price).toBe(19);
  });
});

describe('a pick does not copy an amount across currencies (objectstack#36249)', () => {
  const HOME = { kind: 'home' } as const;
  const eur = { kind: 'code', code: 'EUR' } as const;
  const usd = { kind: 'code', code: 'USD' } as const;

  it('the rule: same currency copies, another currency or none is withheld, a number copies', () => {
    expect(crossCurrencyRefusal(HOME, HOME, 'USD')).toBeUndefined();
    expect(crossCurrencyRefusal(HOME, HOME, undefined)).toBeUndefined();
    expect(crossCurrencyRefusal(undefined, eur, 'USD')).toBeUndefined();
    expect(crossCurrencyRefusal(HOME, undefined, 'USD')).toBeUndefined();
    expect(crossCurrencyRefusal(usd, HOME, 'USD')).toBeUndefined();
    expect(crossCurrencyRefusal(HOME, eur, 'EUR')).toBeUndefined();
    expect(crossCurrencyRefusal({ kind: 'unknown' }, HOME, 'USD')).toBeUndefined();
    expect(crossCurrencyRefusal(HOME, eur, 'USD')).toEqual({ reason: 'differs', from: 'USD', to: 'EUR' });
    expect(crossCurrencyRefusal(eur, HOME, 'USD')).toEqual({ reason: 'differs', from: 'EUR', to: 'USD' });
    expect(crossCurrencyRefusal(HOME, { kind: 'unset' }, 'USD')).toEqual({ reason: 'noTargetCurrency', from: 'USD' });
    expect(crossCurrencyRefusal({ kind: 'unknown' }, eur, 'USD')).toEqual({ reason: 'noSourceCurrency', to: 'EUR' });
    expect(crossCurrencyRefusal(HOME, eur, undefined)).toEqual({ reason: 'noSourceCurrency', to: 'EUR' });
  });

  it("an amount's currency is its field's: home, fixed, the record's code, or none for a number", () => {
    expect(amountCurrencyOf({ type: 'currency' })).toEqual(HOME);
    expect(amountCurrencyOf({ type: 'currency', currencyConfig: { currencyMode: 'dynamic' } })).toEqual(HOME);
    expect(amountCurrencyOf({ type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'JPY' } })).toEqual({ kind: 'code', code: 'JPY' });
    const record = { type: 'currency', currencyConfig: { currencyMode: 'record' as const, currencyField: 'currency_code' } };
    expect(amountCurrencyOf(record, { currency_code: 'EUR' })).toEqual(eur);
    expect(amountCurrencyOf(record, {})).toEqual({ kind: 'unset' });
    expect(amountCurrencyOf({ type: 'number' })).toBeUndefined();
    expect(amountCurrencyOf({ type: 'formula', returnType: 'currency' })).toEqual(HOME);
  });

  const productFields = { unit_price: { type: 'currency' }, list_price: { type: 'currency' }, description: { type: 'text' } };
  const homeContext = (lineCurrency: string | undefined | null) => ({
    home: 'USD',
    sourceCurrency: (source: string, v: unknown) => pickedAmountCurrencyOf((productFields as Record<string, { type: string }>)[source], v, widget),
    targetCurrency: (target: string) =>
      target !== 'unit_price' ? undefined : lineCurrency === null ? HOME : lineCurrency ? { kind: 'code' as const, code: lineCurrency } : { kind: 'unset' as const },
  });

  it('the same-named copy: a EUR line keeps its price empty and lists why; a USD line fills', () => {
    const eurPlan = planLookupAutofill(cols, cols[0], widget, undefined, homeContext('EUR'));
    expect(eurPlan.patch).toEqual({ product: 'p1', description: 'Standard widget' });
    expect(eurPlan.withheld).toEqual([
      { target: 'unit_price', source: 'unit_price', amount: 29.99, reason: 'differs', from: 'USD', to: 'EUR' },
    ]);
    const usdPlan = planLookupAutofill(cols, cols[0], widget, undefined, homeContext(null));
    expect(usdPlan.patch).toEqual({ product: 'p1', description: 'Standard widget', unit_price: 29.99 });
    expect(usdPlan.withheld).toEqual([]);
  });

  it('a declared pair: a EUR line keeps its price empty and lists why; a USD line fills', () => {
    const eurPlan = planLookupAutofill(cols, cols[0], widget, { pairs, row: { unit_price: null } }, homeContext('EUR'));
    expect(eurPlan.patch).toEqual({ product: 'p1', description: 'Standard widget' });
    expect(eurPlan.withheld).toEqual([
      { target: 'unit_price', source: 'list_price', amount: 25, reason: 'differs', from: 'USD', to: 'EUR' },
    ]);
    const usdPlan = planLookupAutofill(cols, cols[0], widget, { pairs, row: { unit_price: null } }, homeContext(null));
    expect(usdPlan.patch).toEqual({ product: 'p1', description: 'Standard widget', unit_price: 25 });
    expect(planDeclaredLookupAutofill(pairs, widget, { unit_price: null }, null, homeContext('EUR')).patch).toEqual({});
  });

  it('a line whose header holds no currency yet fills no price', () => {
    const plan = planLookupAutofill(cols, cols[0], widget, undefined, homeContext(undefined));
    expect(plan.patch).not.toHaveProperty('unit_price');
    expect(plan.withheld[0]).toMatchObject({ target: 'unit_price', reason: 'noTargetCurrency', from: 'USD' });
  });

  describe('through the grid', () => {
    const ROWS = [{ id: 'p1', name: 'Widget', description: 'Standard widget', unit_price: 100 }];
    // The product's price field; a test may give it a `fixed` code.
    let productPrice: Record<string, unknown> = { type: 'currency', label: 'Unit Price' };
    beforeEach(() => {
      productPrice = { type: 'currency', label: 'Unit Price' };
    });
    const ds = {
      getObjectSchema: vi.fn(async () => ({ name: 'product', fields: { name: { type: 'text' }, description: { type: 'text' }, unit_price: productPrice } })),
      find: vi.fn(async (_o: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
        const wanted = params?.$filter?.id?.$in;
        const rows = ROWS.filter((r) => !wanted || wanted.includes(r.id));
        return { data: rows.map((r) => ({ ...r })), total: rows.length };
      }),
      findOne: vi.fn(async (_o: string, id: string) => {
        const row = ROWS.find((r) => r.id === id);
        return row ? { ...row } : null;
      }),
    };
    const lineColumns = [
      { name: 'product', type: 'lookup' as const, reference: 'product' },
      { name: 'description', type: 'text' as const },
      { name: 'unit_price', type: 'currency' as const, label: 'Unit Price' },
    ];

    function Line({
      currency,
      columnFields,
      home = 'USD',
      line,
      lookupAutofill,
    }: {
      currency?: Record<string, string | undefined>;
      columnFields?: Record<string, unknown>;
      home?: string;
      line?: Record<string, unknown>;
      lookupAutofill?: Record<string, { target: string; source: string }[]>;
    }) {
      const [rows, setRows] = React.useState<Record<string, unknown>[]>([{ product: null, description: null, unit_price: null, ...line }]);
      return (
        <LocalizationProvider value={{ currency: home || undefined }}>
          <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
            <GridField
              value={rows}
              onChange={(next: Record<string, unknown>[]) => setRows(next)}
              field={{ columns: lineColumns } as never}
              columnCurrencies={currency}
              columnFields={columnFields}
              lookupAutofill={lookupAutofill}
            />
            <output data-testid="rows">{JSON.stringify(rows)}</output>
          </SchemaRendererContext.Provider>
        </LocalizationProvider>
      );
    }

    const rowsNow = () => JSON.parse(screen.getByTestId('rows').textContent || '[]');

    async function pickWidget(): Promise<void> {
      // The cell's lookup reads the product schema first: the pick judges the
      // price by its field.
      await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      await act(async () => {
        fireEvent.click(screen.getAllByTestId('lookup-trigger')[0]);
      });
      const option = await waitFor(() => {
        const el = screen.getAllByRole('option').find((o) => (o.getAttribute('title') ?? o.textContent ?? '').includes('Widget'));
        if (!el) throw new Error('Widget not offered');
        return el;
      }, { timeout: 3000 });
      await act(async () => {
        fireEvent.click(option);
      });
    }

    it('a EUR line: the price stays empty and the line says why, naming both currencies and the price', async () => {
      render(<Line currency={{ unit_price: 'EUR' }} />);
      await pickWidget();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', description: 'Standard widget' }));
      expect(rowsNow()[0].unit_price).toBeNull();
      const note = await screen.findByTestId('line-items-autofill-withheld-0');
      expect(note.textContent).toContain('Unit Price was not filled');
      expect(note.textContent).toContain('$100.00');
      expect(note.textContent).toContain('EUR');
    });

    it('a USD line: the price fills as before, with no note', async () => {
      render(<Line />);
      await pickWidget();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', description: 'Standard widget', unit_price: 100 }));
      expect(screen.queryByTestId('line-items-autofill-withheld-0')).toBeNull();
    });

    // A line column carries no `currencyConfig`: the host hands the grid the
    // child field behind it (`columnFields`), and the column is in that
    // field's currency, as on the record form.
    const FIXED_EUR = { unit_price: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } } };

    it('a fixed EUR price into a fixed EUR column fills, under a USD home currency', async () => {
      productPrice = { type: 'currency', label: 'Unit Price', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } };
      render(<Line columnFields={FIXED_EUR} />);
      await pickWidget();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', unit_price: 100 }));
      expect(screen.queryByTestId('line-items-autofill-withheld-0')).toBeNull();
    });

    it('a fixed EUR price into a fixed EUR column fills with no home currency configured', async () => {
      productPrice = { type: 'currency', label: 'Unit Price', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } };
      render(<Line columnFields={FIXED_EUR} home="" />);
      await pickWidget();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', unit_price: 100 }));
      expect(screen.queryByTestId('line-items-autofill-withheld-0')).toBeNull();
    });

    it('a home-currency price into a fixed EUR column is withheld, and the line says why', async () => {
      render(<Line columnFields={FIXED_EUR} />);
      await pickWidget();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', description: 'Standard widget' }));
      expect(rowsNow()[0].unit_price).toBeNull();
      const note = await screen.findByTestId('line-items-autofill-withheld-0');
      expect(note.textContent).toContain('$100.00');
      expect(note.textContent).toContain('EUR');
    });

    it('a declared target that is not a drawn column is judged by its child field: a home price into a fixed EUR field is withheld', async () => {
      render(
        <Line
          columnFields={{ net_price: { type: 'currency', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } } }}
          lookupAutofill={{ product: [{ target: 'net_price', source: 'unit_price' }] }}
        />,
      );
      await pickWidget();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', description: 'Standard widget' }));
      expect(rowsNow()[0].net_price ?? null).toBeNull();
      const note = await screen.findByTestId('line-items-autofill-withheld-0');
      expect(note.querySelector('[data-withheld-target="net_price"]')).not.toBeNull();
    });

    it("a home-currency price onto a line whose own code is JPY is withheld", async () => {
      render(
        <Line
          columnFields={{ unit_price: { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'line_currency' } } }}
          line={{ line_currency: 'JPY' }}
        />,
      );
      await pickWidget();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', description: 'Standard widget' }));
      expect(rowsNow()[0].unit_price).toBeNull();
      const note = await screen.findByTestId('line-items-autofill-withheld-0');
      expect(note.textContent).toContain('JPY');
    });
  });
});

describe('cross-currency pick follow-ups: a re-pick over a filled cell, and a code-plus-amount pick (objectstack#36412)', () => {
  const recordPrice = { type: 'currency', currencyConfig: { currencyMode: 'record' as const, currencyField: 'currency_code' } };
  const parentPrice = { type: 'currency', currencyConfig: { currencyMode: 'record' as const, currencyField: 'invoice.currency_code' } };

  it("an amount's currency reads this pick's own write to its code field; a parent's code is not the record's to write", () => {
    expect(amountCurrencyOf(recordPrice, {}, { currency_code: 'EUR' })).toEqual({ kind: 'code', code: 'EUR' });
    expect(amountCurrencyOf(recordPrice, { currency_code: 'JPY' }, { currency_code: 'EUR' })).toEqual({ kind: 'code', code: 'EUR' });
    // Control: without the write, the record as it stands.
    expect(amountCurrencyOf(recordPrice, {}, {})).toEqual({ kind: 'unset' });
    expect(amountCurrencyOf(recordPrice, { currency_code: 'JPY' })).toEqual({ kind: 'code', code: 'JPY' });
    expect(amountCurrencyOf(parentPrice, {}, { 'invoice.currency_code': 'EUR', invoice: { currency_code: 'EUR' } })).toEqual({ kind: 'unset' });
  });

  // A product carries its own code and a price in it; a line carries the same pair.
  const product = { value: 'p1', currency_code: 'EUR', unit_price: 100, description: 'Euro widget' };
  const lineDefs: Record<string, unknown> = { currency_code: { type: 'text' }, unit_price: recordPrice };
  const productDefs: Record<string, unknown> = { currency_code: { type: 'text' }, unit_price: recordPrice };
  const context = (line: Record<string, unknown>) => ({
    home: 'USD',
    sourceCurrency: (source: string, v: unknown) => pickedAmountCurrencyOf(productDefs[source] as never, v, product),
    targetCurrency: (target: string, writes?: Readonly<Record<string, unknown>>) => amountCurrencyOf(lineDefs[target] as never, line, writes),
  });
  const codeCols = [
    { name: 'product', type: 'lookup' as const, reference: 'product' },
    { name: 'currency_code', type: 'text' as const },
    { name: 'unit_price', type: 'currency' as const },
  ];

  it('the same-named copy writes the code and judges the price in it: both copy onto a fresh line', () => {
    const plan = planLookupAutofill(codeCols, codeCols[0], product, { row: {} }, context({}));
    expect(plan.patch).toEqual({ product: 'p1', currency_code: 'EUR', unit_price: 100 });
    expect(plan.withheld).toEqual([]);
    // Control: a grid that draws no code column writes no code, so the line
    // still holds none and the price is withheld.
    const noCode = planLookupAutofill([codeCols[0], codeCols[2]], codeCols[0], product, { row: {} }, context({}));
    expect(noCode.patch).toEqual({ product: 'p1' });
    expect(noCode.withheld[0]).toMatchObject({ target: 'unit_price', reason: 'noTargetCurrency', from: 'EUR' });
  });

  it('declared pairs: a pair writing the code puts the price beside it in that code', () => {
    const both = [{ target: 'currency_code', source: 'currency_code' }, { target: 'unit_price', source: 'unit_price' }];
    expect(planDeclaredLookupAutofill(both, product, {}, null, context({}))).toEqual({
      patch: { currency_code: 'EUR', unit_price: 100 },
      withheld: [],
      // objectstack#36412: the price is recorded as copied under the code the same pick wrote.
      copied: [{ target: 'unit_price', source: 'unit_price', value: 100, under: 'EUR' }],
    });
    // Control: a code the record already holds is kept (no `overwrite`), and
    // the price is judged in it.
    const kept = planDeclaredLookupAutofill(both, product, { currency_code: 'JPY' }, null, context({ currency_code: 'JPY' }));
    expect(kept.patch).toEqual({});
    expect(kept.withheld[0]).toMatchObject({ target: 'unit_price', reason: 'differs', from: 'EUR', to: 'JPY' });
  });

  it('a value withheld over a filled target names what the target kept; one over an empty target does not', () => {
    const eur = { home: 'USD', sourceCurrency: () => ({ kind: 'home' as const }), targetCurrency: (t: string) => (t === 'unit_price' ? { kind: 'code' as const, code: 'EUR' } : undefined) };
    const over = planDeclaredLookupAutofill([{ target: 'unit_price', source: 'list_price', overwrite: true }], widget, { unit_price: 80 }, null, eur);
    expect(over.withheld).toEqual([{ target: 'unit_price', source: 'list_price', amount: 25, reason: 'differs', from: 'USD', to: 'EUR', held: 80 }]);
    const empty = planDeclaredLookupAutofill([{ target: 'unit_price', source: 'list_price' }], widget, { unit_price: null }, null, eur);
    expect(empty.withheld[0]).not.toHaveProperty('held');
    // The re-pick case: the target still holds what the earlier pick filled.
    const repick = planDeclaredLookupAutofill(pairs, gadget, { unit_price: 25 }, widget, eur);
    expect(repick.withheld[0]).toMatchObject({ held: 25 });
  });

  describe('through the grid', () => {
    const ROWS = [{ id: 'p1', name: 'Euro widget', description: 'Euro widget', currency_code: 'EUR', unit_price: 100 }];
    const ds = {
      getObjectSchema: vi.fn(async () => ({
        name: 'product',
        fields: { name: { type: 'text' }, description: { type: 'text' }, currency_code: { type: 'text' }, unit_price: { ...recordPrice, label: 'Unit Price' } },
      })),
      find: vi.fn(async (_o: string, params?: { $filter?: { id?: { $in?: unknown[] } } }) => {
        const wanted = params?.$filter?.id?.$in;
        const rows = ROWS.filter((r) => !wanted || wanted.includes(r.id));
        return { data: rows.map((r) => ({ ...r })), total: rows.length };
      }),
      findOne: vi.fn(async (_o: string, id: string) => {
        const row = ROWS.find((r) => r.id === id);
        return row ? { ...row } : null;
      }),
    };
    const drawn = [
      { name: 'product', type: 'lookup' as const, reference: 'product' },
      { name: 'description', type: 'text' as const },
      { name: 'currency_code', type: 'text' as const },
      { name: 'unit_price', type: 'currency' as const, label: 'Unit Price' },
    ];

    function Line({ columns = drawn, currency, line }: { columns?: typeof drawn; currency?: Record<string, string | undefined>; line?: Record<string, unknown> }) {
      const [rows, setRows] = React.useState<Record<string, unknown>[]>([{ product: null, description: null, unit_price: null, ...line }]);
      return (
        <LocalizationProvider value={{ currency: 'USD' }}>
          <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
            <GridField
              value={rows}
              onChange={(next: Record<string, unknown>[]) => setRows(next)}
              field={{ columns } as never}
              columnCurrencies={currency}
              columnFields={{ unit_price: recordPrice }}
            />
            <output data-testid="rows">{JSON.stringify(rows)}</output>
          </SchemaRendererContext.Provider>
        </LocalizationProvider>
      );
    }
    const rowsNow = () => JSON.parse(screen.getByTestId('rows').textContent || '[]');

    async function pickProduct(): Promise<void> {
      await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      await act(async () => {
        fireEvent.click(screen.getAllByTestId('lookup-trigger')[0]);
      });
      const option = await waitFor(() => {
        const el = screen.getAllByRole('option').find((o) => (o.getAttribute('title') ?? o.textContent ?? '').includes('Euro widget'));
        if (!el) throw new Error('Euro widget not offered');
        return el;
      }, { timeout: 3000 });
      await act(async () => {
        fireEvent.click(option);
      });
    }

    it('a fresh line: the pick copies the code and the price in it, with no note', async () => {
      render(<Line />);
      await pickProduct();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', currency_code: 'EUR', unit_price: 100 }));
      expect(screen.queryByTestId('line-items-autofill-withheld-0')).toBeNull();
    });

    it('control: a grid that draws no code column leaves the price empty and says no currency is chosen', async () => {
      render(<Line columns={drawn.filter((c) => c.name !== 'currency_code')} />);
      await pickProduct();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', description: 'Euro widget' }));
      expect(rowsNow()[0].unit_price).toBeNull();
      expect((await screen.findByTestId('line-items-autofill-withheld-0')).textContent).toContain('no currency is chosen');
    });

    it('a pick over a filled cell in another currency keeps the earlier price and says so, until the cell is edited', async () => {
      render(<Line columns={drawn.filter((c) => c.name !== 'currency_code')} currency={{ unit_price: 'JPY' }} line={{ unit_price: 80 }} />);
      await pickProduct();
      await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', description: 'Euro widget' }));
      expect(rowsNow()[0].unit_price).toBe(80);
      const note = await screen.findByTestId('line-items-autofill-withheld-0');
      expect(note.textContent).toContain('JPY');
      expect(note.textContent).toContain('Unit Price still holds its earlier value.');
      // Once somebody writes the cell, the note has said what it had to say.
      fireEvent.change(screen.getAllByLabelText('Unit Price')[0], { target: { value: '9000' } });
      await waitFor(() => expect(rowsNow()[0].unit_price).toBe(9000));
      expect(screen.queryByTestId('line-items-autofill-withheld-0')).toBeNull();
    });

    it('control: a pick over an empty cell in another currency says why without the kept sentence', async () => {
      render(<Line columns={drawn.filter((c) => c.name !== 'currency_code')} currency={{ unit_price: 'JPY' }} />);
      await pickProduct();
      const note = await screen.findByTestId('line-items-autofill-withheld-0');
      expect(note.textContent).toContain('JPY');
      expect(note.textContent).not.toContain('earlier value');
    });
  });
});

describe('a same-edit currency change keeps a line’s amounts and says so (objectstack#36412, ruling 「保留金额并提示」)', () => {
  // A product priced in its own code (EUR); a line whose price follows its
  // header's currency, which the host hands over per column.
  const recordPrice = { type: 'currency', currencyConfig: { currencyMode: 'record' as const, currencyField: 'currency_code' } };
  const ROWS = [{ id: 'p1', name: 'Euro widget', description: 'Euro widget', currency_code: 'EUR', unit_price: 100 }];
  const ds = {
    getObjectSchema: vi.fn(async () => ({
      name: 'product',
      fields: { name: { type: 'text' }, description: { type: 'text' }, currency_code: { type: 'text' }, unit_price: { ...recordPrice, label: 'Unit Price' } },
    })),
    find: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length })),
    findOne: vi.fn(async (_o: string, id: string) => {
      const row = ROWS.find((r) => r.id === id);
      return row ? { ...row } : null;
    }),
  };
  const drawn = [
    { name: 'product', type: 'lookup' as const, reference: 'product' },
    { name: 'description', type: 'text' as const },
    { name: 'unit_price', type: 'currency' as const, label: 'Unit Price' },
  ];
  function Line({ header }: { header: string }) {
    const [rows, setRows] = React.useState<Record<string, unknown>[]>([{ product: null, description: null, unit_price: null }]);
    return (
      <LocalizationProvider value={{ currency: 'USD' }}>
        <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
          <GridField value={rows} onChange={(next: Record<string, unknown>[]) => setRows(next)} field={{ columns: drawn } as never} columnCurrencies={{ unit_price: header }} />
          <output data-testid="rows">{JSON.stringify(rows)}</output>
        </SchemaRendererContext.Provider>
      </LocalizationProvider>
    );
  }
  const rowsNow = () => JSON.parse(screen.getByTestId('rows').textContent || '[]');
  async function pickProduct(): Promise<void> {
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('lookup-trigger')[0]);
    });
    const option = await waitFor(() => {
      const el = screen.getAllByRole('option').find((o) => (o.getAttribute('title') ?? o.textContent ?? '').includes('Euro widget'));
      if (!el) throw new Error('Euro widget not offered');
      return el;
    }, { timeout: 3000 });
    await act(async () => {
      fireEvent.click(option);
    });
    await waitFor(() => expect(rowsNow()[0]).toMatchObject({ product: 'p1', description: 'Euro widget' }));
  }
  const copiedNote = () => screen.queryByTestId('line-items-autofill-copied-0');
  const withheldNote = () => screen.queryByTestId('line-items-autofill-withheld-0');

  it('a copied amount stays through a header currency change, and a note names the code it was copied under', async () => {
    const view = render(<Line header="EUR" />);
    await pickProduct();
    expect(rowsNow()[0].unit_price).toBe(100);
    // Control: copied in the line's own currency, nothing to say.
    expect(copiedNote()).toBeNull();

    view.rerender(<Line header="USD" />);
    expect(rowsNow()[0].unit_price).toBe(100);
    expect(copiedNote()?.textContent).toBe('Unit Price was copied as €100.00, but the record is now in USD. Enter Unit Price in USD if it should change.');

    // Control: back in the currency it was copied under, the note ends.
    view.rerender(<Line header="EUR" />);
    expect(copiedNote()).toBeNull();
    expect(rowsNow()[0].unit_price).toBe(100);
  });

  it('a withheld note refreshes to the header’s new currency, and the cell stays empty', async () => {
    const view = render(<Line header="JPY" />);
    await pickProduct();
    expect(withheldNote()?.textContent).toContain('here is in JPY');

    view.rerender(<Line header="GBP" />);
    expect(withheldNote()?.textContent).toContain('here is in GBP');
    expect(withheldNote()?.textContent).not.toContain('JPY');
    expect(rowsNow()[0].unit_price).toBeNull();
  });

  it('branch B: the header turns to the picked amount’s own currency, the note stays and says so, and the cell stays empty', async () => {
    const view = render(<Line header="USD" />);
    await pickProduct();
    expect(withheldNote()?.textContent).toContain('here is in USD');

    view.rerender(<Line header="EUR" />);
    expect(withheldNote()?.textContent).toBe('Unit Price was not filled when it was picked. The record is now in EUR: pick again to fill €100.00.');
    expect(rowsNow()[0].unit_price).toBeNull();
    expect(copiedNote()).toBeNull();
  });

  it('a hand-typed amount gets no note through a currency change, nor one typed over a copied amount', async () => {
    const view = render(<Line header="EUR" />);
    fireEvent.change(screen.getAllByLabelText('Unit Price')[0], { target: { value: '70' } });
    await waitFor(() => expect(rowsNow()[0].unit_price).toBe(70));
    view.rerender(<Line header="USD" />);
    expect(rowsNow()[0].unit_price).toBe(70);
    expect(copiedNote()).toBeNull();
    expect(withheldNote()).toBeNull();

    cleanup();

    const over = render(<Line header="EUR" />);
    await pickProduct();
    expect(rowsNow()[0].unit_price).toBe(100);
    fireEvent.change(screen.getAllByLabelText('Unit Price')[0], { target: { value: '9000' } });
    await waitFor(() => expect(rowsNow()[0].unit_price).toBe(9000));
    over.rerender(<Line header="USD" />);
    expect(rowsNow()[0].unit_price).toBe(9000);
    expect(copiedNote()).toBeNull();
  });

  it('the pure judgement: a withheld item follows the currency now, and a copied one is named only while its target holds it', () => {
    const item = { target: 'unit_price', source: 'unit_price', amount: 100, reason: 'differs' as const, from: 'EUR', to: 'JPY' };
    expect(withheldAutofillNow(item, { kind: 'code', code: 'GBP' }, 'USD')).toEqual({ ...item, to: 'GBP' });
    expect(withheldAutofillNow(item, { kind: 'code', code: 'EUR' }, 'USD')).toEqual({ ...item, reason: 'nowSameCurrency', to: 'EUR' });
    // Control: a currency not known now leaves the note as it was judged.
    expect(withheldAutofillNow(item, undefined, 'USD')).toBe(item);
    const copied = { target: 'unit_price', source: 'unit_price', value: 100, under: 'EUR' };
    expect(copiedAutofillNow(copied, 100, { kind: 'home' }, 'USD')).toBe('USD');
    expect(copiedAutofillNow(copied, 100, { kind: 'code', code: 'EUR' }, 'USD')).toBeUndefined();
    expect(copiedAutofillNow(copied, 90, { kind: 'home' }, 'USD')).toBeUndefined();
    // A plan that wrote no amount under a judged currency carries no `copied`: absent means none.
    expect(planDeclaredLookupAutofill(pairs, widget, {}, null)).not.toHaveProperty('copied');
    expect(planLookupAutofill(cols, cols[0], widget, { pairs, row: {} })).not.toHaveProperty('copied');
  });
});
