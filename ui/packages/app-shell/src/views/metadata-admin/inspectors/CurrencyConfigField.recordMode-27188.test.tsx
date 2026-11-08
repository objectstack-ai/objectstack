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
  homeAmountCandidates,
  nextCurrencyCodeFieldName,
  setHomeAmountPointer,
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

// ADR-0144 D5: the `homeAmount` pickers. The spec's object judge
// (`refuseDishonestHomeAmount`) exports no predicate, so the spec itself is the
// oracle: every pick the editor offers must parse, and every shape it leaves
// out must be refused, at `homeAmount`. No refusal text is asserted.
describe('Studio homeAmount editor (ADR-0144 D5)', () => {
  const RO_CURRENCY = (label: string) => ({ type: 'currency', label, readonly: true });
  const RO_NUMBER = (label: string, extra: Record<string, unknown> = {}) => ({ type: 'number', label, readonly: true, ...extra });
  const RECORD = { currencyMode: 'record', currencyField: 'currency_code' } as const;
  const OBJECT: Record<string, Record<string, unknown>> = {
    currency_code: CODE,
    other_code: { ...CODE, label: 'Other currency' },
    invoice_date: { type: 'date', label: 'Invoice date' },
    posted_at: { type: 'datetime', label: 'Posted at' },
    note: { type: 'text', label: 'Note' },
    amount: { type: 'currency', label: 'Amount', currencyConfig: RECORD },
    amount_home: RO_CURRENCY('Home'),
    home_2: RO_CURRENCY('Home 2'),
    home_writable: { type: 'currency', label: 'Writable' },
    home_expr: { ...RO_CURRENCY('Computed'), expression: 'record.amount' },
    home_fixed: { ...RO_CURRENCY('Fixed'), currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'EUR' } },
    amount_rate: RO_NUMBER('Rate'),
    rate_12: RO_NUMBER('Rate 12', { scale: 12 }),
    rate_low: RO_NUMBER('Rate 2', { scale: 2 }),
    rate_writable: { type: 'number', label: 'Writable rate' },
    other_amount: { type: 'currency', label: 'Other', currencyConfig: { ...RECORD, homeAmount: { field: 'claimed_home', rateDate: 'invoice_date', rateField: 'shared_rate' } } },
    claimed_home: RO_CURRENCY('Claimed'),
    shared_rate: RO_NUMBER('Shared rate'),
  };
  const withHome = (homeAmount: Record<string, string>, amount: Record<string, unknown> = {}) => ({
    ...OBJECT,
    amount: { ...OBJECT.amount, ...amount, currencyConfig: { ...RECORD, ...(amount.currencyConfig as object), homeAmount } },
  });
  const entriesOf = (fields: Record<string, Record<string, unknown>>) => Object.entries(fields).map(([name, def]) => ({ name, def }));
  const parse = (fields: Record<string, unknown>) => ObjectSchema.safeParse({ name: 'invoice', label: 'Invoice', fields });
  const refusedAtHomeAmount = (fields: Record<string, unknown>) => {
    const r = parse(fields);
    // At either claimant's `homeAmount`: the judge gives a shared home field to
    // the first amount declared and refuses the other one.
    return !r.success && r.error.issues.some((i) => /^fields\.[a-z_]+\.currencyConfig\.homeAmount/.test(i.path.join('.')));
  };

  it('the fixture object parses as it stands', () => {
    expect(parse(OBJECT).success).toBe(true);
  });

  it('lists each pointer\'s candidates, the rate field judged against the picked document date and code field', () => {
    expect(homeAmountCandidates(entriesOf(OBJECT), 'amount')).toEqual({
      field: ['amount_home', 'home_2'],
      rateDate: ['invoice_date', 'posted_at'],
      rateField: ['amount_rate', 'rate_12'],
    });
    // Same code field and document date as `other_amount`: its rate field may be shared.
    expect(homeAmountCandidates(entriesOf(withHome({ rateDate: 'invoice_date' })), 'amount').rateField).toEqual(['amount_rate', 'rate_12', 'shared_rate']);
    expect(homeAmountCandidates(entriesOf(withHome({ rateDate: 'invoice_date' }, { currencyConfig: { currencyField: 'other_code' } })), 'amount').rateField).toEqual(['amount_rate', 'rate_12']);
  });

  it('ORACLE: every combination the editor offers parses', () => {
    const offered = homeAmountCandidates(entriesOf(OBJECT), 'amount');
    let combos = 0;
    for (const rateDate of offered.rateDate) {
      const now = homeAmountCandidates(entriesOf(withHome({ rateDate })), 'amount');
      for (const field of now.field) {
        for (const rateField of now.rateField) {
          const fields = withHome({ field, rateDate, rateField });
          expect(parse(fields).success, `${field} / ${rateDate} / ${rateField}`).toBe(true);
          combos += 1;
        }
      }
    }
    expect(combos).toBe(2 * 3 + 2 * 2);
  });

  it('ORACLE: every shape the editor leaves out is refused at homeAmount', () => {
    const ok = { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' };
    expect(parse(withHome(ok)).success).toBe(true);
    for (const field of ['home_writable', 'home_expr', 'home_fixed', 'claimed_home']) {
      expect(refusedAtHomeAmount(withHome({ ...ok, field })), field).toBe(true);
    }
    for (const rateField of ['rate_low', 'rate_writable']) {
      expect(refusedAtHomeAmount(withHome({ ...ok, rateField })), rateField).toBe(true);
    }
    expect(refusedAtHomeAmount(withHome({ ...ok, rateDate: 'posted_at', rateField: 'shared_rate' })), 'shared rate, other date').toBe(true);
    expect(refusedAtHomeAmount(withHome({ ...ok, rateDate: 'note' })), 'text date').toBe(true);
    const formula = { type: 'formula', label: 'Net', expression: 'record.gross * 0.9', returnType: 'currency' };
    expect(refusedAtHomeAmount({ ...withHome(ok, formula), gross: { type: 'currency', label: 'Gross' } }), 'formula amount').toBe(true);
  });

  it('a pointer unpicked is deleted, and homeAmount with it once none is left', () => {
    const one = setHomeAmountPointer({ currencyMode: 'record', currencyField: 'currency_code' }, 'field', 'amount_home');
    expect(one).toEqual({ currencyMode: 'record', currencyField: 'currency_code', homeAmount: { field: 'amount_home' } });
    expect(setHomeAmountPointer(one, 'field', '')).toEqual({ currencyMode: 'record', currencyField: 'currency_code' });
  });

  it('picking the three pointers writes homeAmount, and the object parses', async () => {
    const { saved } = renderAmountLive(OBJECT);
    expect(screen.getByTestId('currency-config-home-amount')).toBeInTheDocument();
    await pick('Home amount field', 'amount_home');
    await pick('Document date', 'invoice_date');
    await pick('Rate field', 'shared_rate');
    const fields = saved();
    expect((fields.amount.currencyConfig as any).homeAmount).toEqual({ field: 'amount_home', rateDate: 'invoice_date', rateField: 'shared_rate' });
    expect(parse(fields).success).toBe(true);
  });

  it('re-picking the currency field keeps homeAmount; leaving record mode drops it', async () => {
    const home = { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' };
    const { saved } = renderAmountLive(withHome(home));
    await pick(/Currency field/, 'other_code');
    expect(saved().amount.currencyConfig).toEqual({ currencyMode: 'record', currencyField: 'other_code', homeAmount: home });
    await pick('Currency mode', 'Dynamic — the organization currency');
    expect(saved().amount.currencyConfig).toEqual({ currencyMode: 'dynamic' });
    expect(switchCurrencyMode({ currencyMode: 'record', currencyField: 'currency_code', homeAmount: home }, 'record')).toEqual({ currencyMode: 'record', currencyField: 'currency_code', homeAmount: home });
  });

  it('shows the editor only under record mode, and never on a formula amount', () => {
    renderAmount({ ...OBJECT, amount: { type: 'currency', label: 'Amount' } });
    expect(screen.queryByTestId('currency-config-home-amount')).toBeNull();
    cleanup();
    renderAmount({ ...OBJECT, amount: { type: 'formula', label: 'Net', expression: 'record.gross', returnType: 'currency', currencyConfig: RECORD } });
    expect(screen.getByRole('combobox', { name: /Currency field/ })).toBeInTheDocument();
    expect(screen.queryByTestId('currency-config-home-amount')).toBeNull();
  });
});
