/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35053 — the filter value picker names a lookup's candidate
 * records by the TARGET object's declared `nameField` when the lookup declares
 * no `displayField`, the default the spec's `FieldSchema.displayField` states.
 * The target here is titled by an autonumber `deal_number` and has no `name`,
 * `label` or `title`, so the old `displayField || "name"` read printed every
 * option, and the chosen value's chip, as the raw record id.
 *
 * The control: an explicit `displayField` on the lookup still wins. The value
 * the picker writes stays the record's id.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { FilterBuilder } from '../custom/filter-builder';

const TARGET = 'crm_deal_confirmation';

const TARGET_DEF = {
  name: TARGET,
  nameField: 'deal_number',
  fields: {
    deal_number: { type: 'autonumber', label: 'Deal Number' },
    code: { type: 'text', label: 'Code' },
  },
};

const DEALS = [
  { id: 'KC3TKTKQPLwGVqsJ', deal_number: 'DEAL-2026-0002', code: 'C-2' },
  { id: 'T1lF9T1kq45KAN06', deal_number: 'DEAL-2026-0001', code: 'C-1' },
];

function fakeDataSource() {
  return {
    find: vi.fn(async (_object: string, params: Record<string, any>) => {
      const ids: string[] | undefined = params.$filter?.id?.$in;
      return { data: ids ? DEALS.filter((d) => ids.includes(d.id)) : DEALS };
    }),
    getObjectSchema: vi.fn(async (name: string) => (name === TARGET ? TARGET_DEF : undefined)),
  };
}

function renderRow(lookupExtra: Record<string, unknown>, value: unknown, dataSource: unknown) {
  const onChange = vi.fn();
  const fields = [
    { value: 'deal_confirmation', label: 'Deal', type: 'lookup', referenceTo: TARGET, ...lookupExtra },
  ];
  const tree = {
    id: 'root',
    logic: 'and',
    conditions: [{ id: 'c1', field: 'deal_confirmation', operator: 'equals', value }],
  };
  render(
    <SchemaRendererContext.Provider value={{ dataSource } as any}>
      <FilterBuilder fields={fields as any} value={tree as any} onChange={onChange} />
    </SchemaRendererContext.Provider>,
  );
  return onChange;
}

describe('filter value picker names lookup options by the target nameField (objectstack#35053)', () => {
  it('lists the deal numbers, not the record ids, and writes the id it picks', async () => {
    const dataSource = fakeDataSource();
    const onChange = renderRow({}, '', dataSource);
    fireEvent.click(screen.getByTestId('lookup-picker-deal_confirmation'));
    const option = await screen.findByText('DEAL-2026-0001');
    expect(screen.getByText('DEAL-2026-0002')).toBeInTheDocument();
    expect(screen.queryByText(DEALS[1].id)).not.toBeInTheDocument();
    expect(dataSource.getObjectSchema).toHaveBeenCalledWith(TARGET);

    fireEvent.click(option);
    const calls = onChange.mock.calls;
    expect(calls[calls.length - 1][0].conditions[0]).toMatchObject({ value: DEALS[1].id });
  });

  it('the chosen value\'s chip reads the deal number', async () => {
    renderRow({}, DEALS[1].id, fakeDataSource());
    await waitFor(() =>
      expect(screen.getByTestId('lookup-picker-deal_confirmation')).toHaveTextContent('DEAL-2026-0001'),
    );
  });

  it('CONTROL — an explicit `displayField` on the lookup still wins over the nameField', async () => {
    renderRow({ displayField: 'code' }, '', fakeDataSource());
    fireEvent.click(screen.getByTestId('lookup-picker-deal_confirmation'));
    expect(await screen.findByText('C-1')).toBeInTheDocument();
    expect(screen.getByText('C-2')).toBeInTheDocument();
    expect(screen.queryByText('DEAL-2026-0001')).not.toBeInTheDocument();
  });
});
