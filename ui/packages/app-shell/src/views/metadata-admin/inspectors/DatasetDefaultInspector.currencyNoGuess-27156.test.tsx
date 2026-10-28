// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27156 — the dataset inspector never guesses a measure currency.
 *
 * Picking the "Currency" display format used to store `currency: 'USD'` when no
 * code was chosen, and the picker pre-selected USD. A measure's own `currency`
 * outranks both the source field's fixed currency and the tenant default in the
 * analytics chain, so a CNY tenant's dashboard showed `$` with no error. The
 * ruling (no surface guesses a currency) makes the empty pick the default and
 * stores no `currency` key at all, so the measure inherits.
 *
 *   - empty pick over a `currency` field ⇒ the measure carries no `currency`
 *     key (not `undefined`, not `''`), and the picker reads "inherit";
 *   - CONTROL: a picked CNY is stored as `currency: 'CNY'`;
 *   - a stored `currency: 'USD'` is explicit authoring and round-trips as is;
 *   - a measure over a plain number field has nothing to inherit: no "inherit"
 *     row, the picker asks for a code, and the kind stays "Currency" meanwhile;
 *   - on load, a code-less numeral format over a `currency` field reads back as
 *     "Currency · inherit" — CONTROL: the same format over a number field reads
 *     back as "Number".
 *
 * Ablation: restoring `currency || 'USD'` in `buildMeasureFormat` turns the
 * first case red. Run recorded on the PR.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({
    relationships: [],
    fieldOptions: [
      { value: 'amount', label: 'Amount', type: 'currency' },
      { value: 'quantity', label: 'Quantity', type: 'number' },
    ],
    loading: false,
  }),
  useDatasetUsage: () => ({ reports: 0, dashboards: 0, loading: false }),
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));

import { DatasetDefaultInspector } from './DatasetDefaultInspector';

afterEach(cleanup);

type Draft = { measures: Array<Record<string, unknown>> } & Record<string, unknown>;

const draftWith = (measure: Record<string, unknown>): Draft => ({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  dimensions: [{ name: 'stage', field: 'stage', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', ...measure }],
});

/** Holds the draft the way the designer does, so every pick re-renders from what was written. */
function mount(initial: Draft) {
  const held = { current: initial };
  const onPatch = vi.fn();
  function Harness() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    return (
      <DatasetDefaultInspector
        type="dataset"
        name="sales"
        locale="en-US"
        draft={draft}
        readOnly={false}
        onPatch={(patch: Record<string, unknown>) => {
          onPatch(patch);
          setDraft((d) => (held.current = { ...d, ...patch } as Draft));
        }}
      />
    );
  }
  render(<Harness />);
  return { measure: () => held.current.measures[0]!, onPatch };
}

const combo = (name: string) => screen.getByRole('combobox', { name });

async function pick(name: string, option: string | RegExp) {
  await userEvent.click(combo(name));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('dataset inspector stores no guessed measure currency (objectstack#27156)', () => {
  it('stores no currency key when Currency is picked with no code', async () => {
    const { measure } = mount(draftWith({ field: 'amount' }));
    await pick('Display format', /^Currency/);
    expect(measure()).not.toHaveProperty('currency');
    expect(measure().format).toBe('0,0');
    expect(combo('Display format')).toHaveTextContent(/^Currency/);
    expect(combo('Currency')).toHaveTextContent('Inherit — field or organization default');
  });

  it('CONTROL: stores a picked CNY', async () => {
    const { measure } = mount(draftWith({ field: 'amount' }));
    await pick('Display format', /^Currency/);
    await pick('Currency', 'CNY (¥)');
    expect(measure()).toMatchObject({ format: '0,0', currency: 'CNY' });
  });

  it('round-trips a stored currency USD unchanged', async () => {
    const { measure, onPatch } = mount(draftWith({ field: 'amount', format: '0,0.00', currency: 'USD' }));
    expect(onPatch).not.toHaveBeenCalled();
    expect(combo('Currency')).toHaveTextContent('USD ($)');
    await pick('Decimals', '0');
    expect(measure()).toMatchObject({ format: '0,0', currency: 'USD' });
  });

  it('asks for a code over a plain number field and keeps the Currency kind meanwhile', async () => {
    const { measure } = mount(draftWith({ field: 'quantity' }));
    await pick('Display format', /^Currency/);
    expect(measure()).not.toHaveProperty('currency');
    expect(combo('Display format')).toHaveTextContent(/^Currency/);
    expect(combo('Currency')).toHaveTextContent('Choose a currency');
    await userEvent.click(combo('Currency'));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByRole('option', { name: /^Inherit/ })).toBeNull();
  });

  it('reads a code-less format over a currency field back as Currency · inherit', () => {
    mount(draftWith({ field: 'amount', format: '0,0.00' }));
    expect(combo('Display format')).toHaveTextContent(/^Currency/);
    expect(combo('Currency')).toHaveTextContent('Inherit — field or organization default');
  });

  it('CONTROL: reads the same format over a number field back as Number', () => {
    mount(draftWith({ field: 'quantity', format: '0,0.00' }));
    expect(combo('Display format')).toHaveTextContent(/^Number/);
    expect(screen.queryByRole('combobox', { name: 'Currency' })).toBeNull();
  });
});
