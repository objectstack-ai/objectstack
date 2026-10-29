// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0144 D2 in the Studio field editor: a currency amount's mode, the
 * `record`-mode `currencyField` picker over the object's own ISO 4217 code
 * fields, and "Create currency field", which writes explicit metadata.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectSchema } from '@objectstack/spec/data';
import {
  currencyCodeFieldCandidates,
  nextCurrencyCodeFieldName,
  switchCurrencyMode,
} from './CurrencyConfigField';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

beforeAll(() => {
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

function renderAmount(fields: Record<string, Record<string, unknown>>) {
  const onPatch = vi.fn();
  render(
    <ObjectFieldInspector
      type="object"
      name="invoice"
      draft={{ name: 'invoice', fields }}
      selection={{ kind: 'field', id: 'amount' }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale="en-US"
    />,
  );
  const saved = () => onPatch.mock.calls.at(-1)![0].fields as Record<string, Record<string, unknown>>;
  return { onPatch, saved };
}

/** {@link renderAmount}, with each patch applied to the draft, so a second edit sees the first. */
function renderAmountLive(initial: Record<string, Record<string, unknown>>) {
  const onPatch = vi.fn();
  function Live() {
    const [fields, setFields] = React.useState(initial);
    return (
      <ObjectFieldInspector
        type="object"
        name="invoice"
        draft={{ name: 'invoice', fields }}
        selection={{ kind: 'field', id: 'amount' }}
        onPatch={(patch) => {
          onPatch(patch);
          setFields(patch.fields as Record<string, Record<string, unknown>>);
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
  return { onPatch, saved };
}

const CODE = { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' };

async function pick(label: RegExp | string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('Studio currency section (ADR-0144 D2)', () => {
  it('a mode switch keeps only the keys that mode reads', () => {
    expect(switchCurrencyMode({ currencyMode: 'record', currencyField: 'currency_code' }, 'dynamic')).toEqual({ currencyMode: 'dynamic' });
    expect(switchCurrencyMode({ currencyMode: 'fixed', defaultCurrency: 'EUR' }, 'record')).toEqual({ currencyMode: 'record' });
    expect(switchCurrencyMode({ currencyMode: 'fixed', defaultCurrency: 'EUR' }, 'fixed')).toEqual({ currencyMode: 'fixed', defaultCurrency: 'EUR' });
  });

  it('the picker lists only text fields in the ISO 4217 domain, never the amount itself', () => {
    const entries = [
      { name: 'amount', def: { type: 'currency' } },
      { name: 'currency_code', def: CODE },
      { name: 'note', def: { type: 'text' } },
      { name: 'country', def: { type: 'text', valueDomain: 'iso_3166_alpha2' } },
    ];
    expect(currencyCodeFieldCandidates(entries, 'amount')).toEqual(['currency_code']);
    expect(nextCurrencyCodeFieldName(entries)).toBe('currency_code_2');
    expect(nextCurrencyCodeFieldName([])).toBe('currency_code');
  });

  it('offers the record mode and the currencyField picker on a currency field', () => {
    renderAmount({ amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } }, currency_code: CODE });
    expect(screen.getByRole('combobox', { name: 'Currency mode' })).toHaveTextContent('Record');
    expect(screen.getByRole('combobox', { name: /Currency field/ })).toHaveTextContent('currency_code');
  });

  it('switching a fixed amount to record writes no defaultCurrency, and the object parses (#27268 refuses one)', async () => {
    const { saved } = renderAmountLive({
      amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } },
      currency_code: CODE,
    });
    await pick('Currency mode', 'Record — each record names its currency');
    expect(saved().amount.currencyConfig).toEqual({ currencyMode: 'record' });
    await pick(/Currency field/, 'currency_code');
    const fields = saved();
    expect(fields.amount.currencyConfig).toEqual({ currencyMode: 'record', currencyField: 'currency_code' });
    expect(ObjectSchema.safeParse({ name: 'invoice', label: 'Invoice', fields }).success).toBe(true);
  });

  it('"Create currency field" writes an explicit code field and the pointer, and the object parses', async () => {
    const { saved } = renderAmount({ amount: { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record' } } });
    await userEvent.click(screen.getByTestId('currency-config-create-code-field'));
    const fields = saved();
    expect(fields.amount.currencyConfig).toEqual({ currencyMode: 'record', currencyField: 'currency_code' });
    expect(fields.currency_code).toEqual({ type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency', required: true });
    expect(ObjectSchema.safeParse({ name: 'invoice', label: 'Invoice', fields }).success).toBe(true);
  });
});
