// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0144 D2 as amended in the Studio field editor: a master-detail child's
 * amount may point its `record`-mode `currencyField` at the parent's code
 * field, `<master_detail>.<parent code field>`. The picker offers those paths
 * beside the object's own code fields, and a stored path reads as the
 * author's pick, never as a missing field.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';
// Paid during collection, not inside a case (see the record-mode suite).
import '@objectstack/formula';
import '@objectstack/lint';
import { masterDetailParents, parentCurrencyCodeFieldCandidates } from './CurrencyConfigField';

const CODE = { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' };

const state = vi.hoisted(() => ({
  objects: {} as Record<string, unknown>,
  /** Unset: every read answers at once. Set: reads wait for it. */
  gate: undefined as Promise<void> | undefined,
}));

vi.mock('../useMetadata', () => {
  const client = {
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
    get: vi.fn(async (_type: string, name: string) => {
      if (state.gate) await state.gate;
      return state.objects[name];
    }),
    withPreviewDrafts() {
      return client;
    },
  };
  return { useMetadataClient: () => client };
});

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(() => {
  cleanup();
  state.objects = {};
  state.gate = undefined;
});

beforeAll(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const INVOICE = { name: 'invoice', label: 'Invoice', fields: { name: { type: 'text', label: 'Name' }, currency_code: CODE } };

function renderLine(fields: Record<string, Record<string, unknown>>) {
  const onPatch = vi.fn();
  function Live() {
    const [current, setCurrent] = React.useState(fields);
    return (
      <ObjectFieldInspector
        type="object"
        name="invoice_line"
        draft={{ name: 'invoice_line', fields: current }}
        selection={{ kind: 'field', id: 'amount' }}
        onPatch={(patch) => {
          onPatch(patch);
          setCurrent(patch.fields as Record<string, Record<string, unknown>>);
        }}
        onClearSelection={vi.fn()}
        onSelectionChange={vi.fn()}
        readOnly={false}
        locale="en-US"
      />
    );
  }
  render(<Live />);
  const saved = () => onPatch.mock.calls.at(-1)![0].fields as Record<string, Record<string, unknown>>;
  return { saved };
}

const LINE = (currencyConfig: Record<string, unknown>) => ({
  invoice: { type: 'master_detail', label: 'Invoice', reference: 'invoice' },
  account: { type: 'lookup', label: 'Account', reference: 'account' },
  amount: { type: 'currency', label: 'Amount', currencyConfig },
});

async function openPicker() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: /Currency field/ }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  return screen.getAllByRole('option').map((o) => o.textContent);
}

describe('Studio currency picker: the parent path (ADR-0144 D2 as amended)', () => {
  it('names a parent code field through each master_detail field, never through a lookup', () => {
    const entries = Object.entries(LINE({ currencyMode: 'record' })).map(([name, def]) => ({ name, def }));
    const parents = masterDetailParents(entries, 'amount');
    expect(parents).toEqual([{ via: 'invoice', reference: 'invoice' }]);
    const parentFields = { invoice: Object.entries(INVOICE.fields).map(([name, def]) => ({ name, def })) };
    expect(parentCurrencyCodeFieldCandidates(parents, parentFields)).toEqual(['invoice.currency_code']);
    expect(parentCurrencyCodeFieldCandidates(parents, {})).toEqual([]);
  });

  it('offers the parent code field, and the picked path is written and parses', async () => {
    state.objects = { invoice: INVOICE, account: { name: 'account', fields: { currency_code: CODE } } };
    const { saved } = renderLine(LINE({ currencyMode: 'record' }));
    await waitFor(async () => expect(await openPicker()).toContain('invoice.currency_code'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).not.toContain('account.currency_code');
    fireEvent.click(screen.getByRole('option', { name: 'invoice.currency_code' }));
    const fields = saved();
    expect(fields.amount.currencyConfig).toEqual({ currencyMode: 'record', currencyField: 'invoice.currency_code' });
    expect(ObjectSchema.safeParse({ name: 'invoice_line', label: 'Invoice line', fields }).success).toBe(true);
  });

  it('a stored parent path reads as the pick once the parent is read', async () => {
    state.objects = { invoice: INVOICE };
    renderLine(LINE({ currencyMode: 'record', currencyField: 'invoice.currency_code' }));
    const picker = screen.getByRole('combobox', { name: /Currency field/ });
    await waitFor(() => expect(picker).toHaveTextContent('invoice.currency_code'));
    expect(picker).not.toHaveTextContent('not found');
  });

  it('a stored parent path reads as the pick while the parent is still being read', () => {
    state.objects = { invoice: INVOICE };
    state.gate = new Promise<void>(() => {});
    renderLine(LINE({ currencyMode: 'record', currencyField: 'invoice.currency_code' }));
    const picker = screen.getByRole('combobox', { name: /Currency field/ });
    expect(picker).toHaveTextContent('invoice.currency_code');
    expect(picker).not.toHaveTextContent('not found');
  });

  it('a path the parent does not have, or through a lookup, reads as not found', async () => {
    state.objects = { invoice: INVOICE, account: { name: 'account', fields: { currency_code: CODE } } };
    renderLine(LINE({ currencyMode: 'record', currencyField: 'invoice.other_code' }));
    const picker = screen.getByRole('combobox', { name: /Currency field/ });
    await waitFor(() => expect(picker).toHaveTextContent('not found'));
    cleanup();
    renderLine(LINE({ currencyMode: 'record', currencyField: 'account.currency_code' }));
    expect(screen.getByRole('combobox', { name: /Currency field/ })).toHaveTextContent('not found');
  });

  it('the sibling pointer is still offered and still reads as the pick', async () => {
    state.objects = { invoice: INVOICE };
    renderLine({ ...LINE({ currencyMode: 'record', currencyField: 'currency_code' }), currency_code: CODE });
    const picker = screen.getByRole('combobox', { name: /Currency field/ });
    expect(picker).toHaveTextContent('currency_code');
    expect(picker).not.toHaveTextContent('not found');
    await waitFor(async () => expect(await openPicker()).toEqual(expect.arrayContaining(['currency_code', 'invoice.currency_code'])));
  });
});
