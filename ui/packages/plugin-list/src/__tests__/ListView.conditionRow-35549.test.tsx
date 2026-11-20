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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('the Filter trigger opens the field list, the fields the view shows first; a pick applies at once and draws a chip', async () => {
    const onFilterChange = vi.fn();
    const ds = mount({}, { onFilterChange });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('condition-add-filter'));
    const shown = await screen.findByTestId('filter-panel-fields-shown');
    expect(within(shown).getAllByRole('option').map((o) => o.getAttribute('data-field'))).toEqual(['name', 'amount', 'stage']);
    fireEvent.click(screen.getByTestId('filter-panel-fields-item-stage'));
    fireEvent.click(within(await screen.findByTestId('filter-panel-values-option-negotiation')).getByRole('checkbox'));
    await waitFor(() => expect(onFilterChange).toHaveBeenCalled());
    const applied = onFilterChange.mock.calls.at(-1)![0];
    expect(applied.conditions).toEqual([expect.objectContaining({ field: 'stage', operator: 'in', value: ['negotiation'] })]);
    expect(within(slot()).getByTestId('filter-chip-stage')).toHaveTextContent('Stage: Negotiation');
  });


  it("the view's own filter is a locked chip, and no Reset is drawn while the list matches the view (objectstack#35727)", async () => {
    const ds = mount({ filter: [['stage', '=', 'proposal']] });
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    const locked = await within(slot()).findByTestId('view-condition-chip');
    expect(locked).toHaveAttribute('data-locked', 'true');
    expect(within(locked).queryByRole('button')).toBeNull();
    expect(within(slot()).queryByTestId('condition-reset')).toBeNull();
  });

});
