/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3951, master-detail half — the derivation is a PRODUCER of the very
 * columns `GridField` consumes, so it must emit the declared spelling
 * (`name`, the spec's inline grid column key — objectui#11070) and read
 * author-supplied columns by the same key. Before the fix `deriveColumns`
 * emitted `{ field: name, … }` and
 * `hydrateColumns` looked the child field up as `fields[col.field]`: that pair
 * agreed with the widget's old `c.field` reader, which is precisely why the
 * master-detail path worked while spec-compliant hand-authored metadata did
 * not.
 *
 * The end-to-end case below is the one that would have caught #3951 from
 * either side: derived columns are fed straight into the real widget, so
 * producer and reader can never again drift onto two different keys while both
 * halves' own unit tests stay green.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { GridField } from '@object-ui/fields';
import { deriveColumns, hydrateColumns, deriveDetail } from './deriveMasterDetail';
import { en } from '@object-ui/i18n';

/** The `en` session's word for a boolean value: what `useBooleanValueLabel`
 *  (`@object-ui/fields`) draws under `en`. The derive functions require one
 *  (objectui#12924). */
const booleanLabel = (value: boolean) => (value ? en.common.yes : en.common.no);

const lineSchema = {
  name: 'expense_line',
  fields: {
    id: { type: 'text', system: true },
    description: { type: 'text', label: 'Description', required: true },
    quantity: { type: 'number', label: 'Qty' },
    amount: { type: 'currency', label: 'Amount' },
    expense_claim: { type: 'master_detail', label: 'Claim', reference: 'expense_claim' },
  },
};

describe('deriveMasterDetail speaks the declared column spelling (objectui#3951)', () => {
  it('deriveColumns emits `name`, and no column carries the retired `field` key', () => {
    const cols = deriveColumns(lineSchema, { booleanLabel, relationshipField: 'expense_claim' });
    expect(cols.map((c) => c.name)).toEqual(['description', 'quantity', 'amount']);
    for (const c of cols) expect(c).not.toHaveProperty('field');
  });

  it('hydrateColumns resolves a bare `name`-keyed author column against the child schema', () => {
    const [col] = hydrateColumns([{ name: 'amount' }] as any, lineSchema, { booleanLabel });
    expect(col).toMatchObject({ name: 'amount', type: 'currency', label: 'Amount' });
  });

  it('a `field`-keyed column is NOT silently rehabilitated (no tolerant dual-read)', () => {
    // AGENTS.md #0.1: the retired spelling stops being understood — it is not
    // aliased onto `name`. The column passes through untouched (no `type`
    // resolved, no label filled), which is the visible, debuggable outcome.
    const [col] = hydrateColumns([{ field: 'amount' }] as any, lineSchema, { booleanLabel });
    expect(col).toEqual({ field: 'amount' });
    expect(col).not.toHaveProperty('name');
  });

  it('deriveDetail picks the running-total column by its declared name', () => {
    const d = deriveDetail('expense_line', lineSchema, 'expense_claim', { booleanLabel });
    expect(d.amountField).toBe('amount');
    expect(d.columns.map((c) => c.name)).toContain('amount');
  });

  it('end to end: derived columns render POPULATED cells in the real GridField', () => {
    const { columns } = deriveDetail('expense_line', lineSchema, 'expense_claim', { booleanLabel });
    render(
      <GridField
        value={[{ description: 'Taxi to airport', quantity: 1, amount: 42.5 }]}
        onChange={() => {}}
        field={{ columns } as any}
      />,
    );
    expect((screen.getAllByLabelText('Description')[0] as HTMLInputElement).value).toBe('Taxi to airport');
    expect((screen.getAllByLabelText('Qty')[0] as HTMLInputElement).value).toBe('1');
    expect((screen.getAllByLabelText('Amount')[0] as HTMLInputElement).value).toBe('42.5');
  });
});
