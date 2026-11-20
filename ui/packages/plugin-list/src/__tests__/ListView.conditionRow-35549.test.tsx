/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list's filter and sort redo, wired into `ListView` (objectstack#35549,
 * objectstack#35550): the Filter and Sort triggers open the shared field list,
 * and the condition row fills the `list-condition-row` slot objectstack#35548
 * laid under the view bar. The controls' own behaviour is pinned in
 * `conditions/__tests__/listConditions.test.tsx`; layout and a real drag in
 * `ui/e2e/list-condition-row-35549.spec.ts`. This file pins the seams: what
 * `ListView` hands the controls and what it does with what they hand back.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'deal_35549';
const DEFINITION = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'proposal', label: 'Proposal' },
        { value: 'negotiation', label: 'Negotiation' },
      ],
    },
    amount: { type: 'number', label: 'Amount' },
    close_date: { type: 'date', label: 'Close date' },
  },
};

function mount(node: Record<string, unknown> = {}, props: Partial<React.ComponentProps<typeof ListView>> = {}) {
  const ds = {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'A', stage: 'proposal', amount: 3 }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => structuredClone(DEFINITION)),
  };
  const schema = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    columns: [{ field: 'name' }, { field: 'amount' }, { field: 'stage' }],
    ...node,
  } as unknown as ListViewSchema;
  render(
    <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
      <ListView schema={schema} dataSource={ds as unknown as DataSource} {...props} />
    </SchemaRendererProvider>,
  );
  return ds;
}

const slot = () => screen.getByTestId('list-condition-row');

afterEach(() => cleanup());

describe('ListView condition row and panels (objectstack#35549, objectstack#35550)', () => {
  it('CONTROL: with no sort and no filter the slot stays empty', async () => {
    const ds = mount();
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    expect(slot()).toBeEmptyDOMElement();
  });

  it('the Filter trigger opens the field list, the fields the view shows first; a pick applies at once and draws a chip', async () => {
    const onFilterChange = vi.fn();
    const ds = mount({}, { onFilterChange });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('toolbar-filter-trigger'));
    const shown = await screen.findByTestId('filter-panel-fields-shown');
    expect(within(shown).getAllByRole('option').map((o) => o.getAttribute('data-field'))).toEqual(['name', 'amount', 'stage']);
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-stage'));
    fireEvent.click(within(await screen.findByTestId('filter-panel-values-option-negotiation')).getByRole('checkbox'));
    await waitFor(() => expect(onFilterChange).toHaveBeenCalled());
    const applied = onFilterChange.mock.calls.at(-1)![0];
    expect(applied.conditions).toEqual([expect.objectContaining({ field: 'stage', operator: 'in', value: ['negotiation'] })]);
    expect(within(slot()).getByTestId('filter-chip-stage')).toHaveTextContent('Stage: Negotiation');
  });

  it('the Sort trigger adds a level in the chosen direction, and the chip reads it; × hands back the sort without it', async () => {
    const onSortChange = vi.fn();
    const ds = mount({}, { onSortChange });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('toolbar-sort-trigger'));
    fireEvent.click(await screen.findByTestId('sort-panel-order-desc'));
    fireEvent.click(screen.getByTestId('sort-panel-fields-item-amount'));
    await waitFor(() => expect(onSortChange).toHaveBeenCalled());
    expect(onSortChange.mock.calls.at(-1)![0].map((s: { field: string; order: string }) => [s.field, s.order])).toEqual([['amount', 'desc']]);
    const chip = within(slot()).getByTestId('sort-chip-amount');
    expect(chip).toHaveAttribute('data-order', 'desc');
    fireEvent.click(within(slot()).getByTestId('sort-chip-remove-amount'));
    await waitFor(() => expect(onSortChange.mock.calls.at(-1)![0]).toEqual([]));
  });

  it("the view's own filter is a locked chip, and Reset is disabled while the list matches the view", async () => {
    const ds = mount({ filter: [['stage', '=', 'proposal']] });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    const locked = await within(slot()).findByTestId('view-condition-chip');
    expect(locked).toHaveAttribute('data-locked', 'true');
    expect(within(locked).queryByRole('button')).toBeNull();
    expect(within(slot()).getByTestId('condition-reset')).toBeDisabled();
  });

  it('Reset clears the reader\'s filter and returns the sort to the view as saved', async () => {
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const ds = mount(
      { sort: [{ field: 'name', order: 'asc' }] },
      {
        onFilterChange,
        onSortChange,
        initialFilters: { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'a' }] },
      },
    );
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(await within(slot()).findByTestId('sort-chip-toggle-name'));
    await waitFor(() => expect(onSortChange.mock.calls.at(-1)?.[0]?.[0]?.order).toBe('desc'));
    const reset = within(slot()).getByTestId('condition-reset');
    expect(reset).toBeEnabled();
    await act(async () => fireEvent.click(reset));
    expect(onFilterChange.mock.calls.at(-1)![0].conditions).toEqual([]);
    expect(onSortChange.mock.calls.at(-1)![0].map((s: { field: string; order: string }) => [s.field, s.order])).toEqual([['name', 'asc']]);
    await waitFor(() => expect(within(slot()).queryByTestId('filter-chip-name')).toBeNull());
  });
});
