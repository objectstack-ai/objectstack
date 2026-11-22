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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { GridField, lookupAutofillPatch, planLookupAutofill } from './GridField';
import {
  amountCurrencyOf,
  crossCurrencyRefusal,
  declaredLookupAutofillPatch,
  lookupAutofillByField,
  pickedAmountCurrencyOf,
  planDeclaredLookupAutofill,
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
    sourceCurrency: (source: string, v: unknown) => pickedAmountCurrencyOf((productFields as Record<string, never>)[source], v, widget),
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
    const ds = {
      getObjectSchema: vi.fn(async () => ({ name: 'product', fields: { name: { type: 'text' }, description: { type: 'text' }, unit_price: { type: 'currency', label: 'Unit Price' } } })),
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

    function Line({ currency }: { currency?: Record<string, string | undefined> }) {
      const [rows, setRows] = React.useState<Record<string, unknown>[]>([{ product: null, description: null, unit_price: null }]);
      return (
        <LocalizationProvider value={{ currency: 'USD' }}>
          <SchemaRendererContext.Provider value={{ dataSource: ds } as never}>
            <GridField
              value={rows}
              onChange={(next: Record<string, unknown>[]) => setRows(next)}
              field={{ columns: lineColumns } as never}
              columnCurrencies={currency}
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
  });
});
