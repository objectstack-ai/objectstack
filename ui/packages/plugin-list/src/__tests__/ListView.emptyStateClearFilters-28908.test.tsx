/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28908 — a list emptied by a filter the READER applied offers
 * "Clear filters" as its primary action.
 *
 * Measured on the console: Leads, filter panel status equals Contacted, zero
 * rows. The copy said to adjust or clear the filters, and the only button was
 * "Add record", which creates a record while the list is filtered.
 *
 * Pinned:
 * - a panel filter (or the "In a queue" toggle) that empties the list draws
 *   "Clear filters" as the primary button and "Add record" as the secondary;
 *   a click removes the reader's query, the search with it, so the toolbar
 *   badge clears and the rows come back;
 * - a search alone keeps today's "Clear search" beside the primary
 *   "Add record";
 * - a list emptied by the view's DECLARED filter alone shows no clear action:
 *   that filter is not the reader's, and the action never removes it;
 * - user-filter chips are the reader's filter too since objectstack#29052:
 *   `ListView.clearFiltersChips-29052.test.tsx` pins them.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import type { ListViewSchema } from '@object-ui/types';

afterEach(cleanup);

const OBJECT = 'crm_lead';
const MISS = 'zzz';

/**
 * A data source holding one lead. A query that carries the reader's miss
 * (`zzz`, in a filter value or the search) or the queue-sitting condition
 * answers zero rows; any other query answers the lead.
 */
function leadsDataSource() {
  return {
    find: vi.fn(async (_object: string, params: unknown) => {
      const query = JSON.stringify(params ?? {});
      return query.includes(MISS) || query.includes('is_empty') ? [] : [{ _id: 'l1', name: 'Acme' }];
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: {
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
        queue: { name: 'queue', type: 'text', system: true, hidden: true },
      },
    }),
  };
}

const session: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  hasAnyQueue: true,
  positions: [],
  permissionSets: ['member_default'],
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  fields: {},
};

/** A `list-view` node as an author writes it (FilterNode-array filters). */
const authored = (node: Record<string, unknown> = {}): ListViewSchema =>
  ({ type: 'list-view', objectName: OBJECT, fields: ['name'], addRecord: { enabled: true }, ...node }) as unknown as ListViewSchema;

const PANEL_MISS = {
  id: 'root',
  logic: 'and',
  conditions: [{ id: 'c1', field: 'status', operator: 'equals', value: MISS }],
} as never;

type Session = Pick<
  React.ComponentProps<typeof ListView>,
  'initialFilters' | 'initialSearchTerm' | 'onFilterChange' | 'onSearchChange'
>;

function mount(schema: ListViewSchema, props: Session = {}) {
  const ds = leadsDataSource();
  const view = render(
    <MePermissionsProvider initialPermissions={session}>
      <SchemaRendererProvider dataSource={ds as any}>
        <ListView schema={schema} dataSource={ds as any} onAddRecord={() => {}} {...props} />
      </SchemaRendererProvider>
    </MePermissionsProvider>,
  );
  return { ds, ...view };
}

async function emptyPanel(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => {
    expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
  });
  return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
}

const q = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const isPrimary = (el: HTMLElement | null) => !!el && el.className.includes('bg-primary');

describe('ListView empty state — clear the reader\'s filters (objectstack#28908)', () => {
  it('a panel filter that empties the list offers "Clear filters" first, and a click brings the rows back', async () => {
    const onFilterChange = vi.fn();
    const { container, ds } = mount(authored(), { initialFilters: PANEL_MISS, onFilterChange });
    const panel = await emptyPanel(container);

    const clear = q(panel, 'empty-state-clear-filters');
    expect(clear?.textContent).toBe('Clear filters');
    expect(isPrimary(clear)).toBe(true);
    const add = q(panel, 'empty-state-add-record');
    expect(add).not.toBeNull();
    expect(isPrimary(add)).toBe(false);
    expect(q(panel, 'empty-state-clear-search')).toBeNull();
    expect(q(container, 'toolbar-filter-trigger')?.getAttribute('aria-label')).toMatch(/1 active/);

    fireEvent.click(clear!);

    await waitFor(() => expect(q(container, 'empty-state')).toBeNull());
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ conditions: [] }));
    expect(JSON.stringify(ds.find.mock.calls.at(-1))).not.toContain(MISS);
    expect(q(container, 'toolbar-filter-trigger')?.getAttribute('aria-label')).not.toMatch(/active/);
  });

  it('a search alone keeps "Clear search" beside the primary "Add record"', async () => {
    const onSearchChange = vi.fn();
    const { container } = mount(authored(), { initialSearchTerm: MISS, onSearchChange });
    const panel = await emptyPanel(container);

    expect(q(panel, 'empty-state-clear-filters')).toBeNull();
    const clearSearch = q(panel, 'empty-state-clear-search');
    expect(clearSearch?.textContent).toBe('Clear search');
    expect(isPrimary(clearSearch)).toBe(false);
    expect(isPrimary(q(panel, 'empty-state-add-record'))).toBe(true);

    fireEvent.click(clearSearch!);
    expect(onSearchChange).toHaveBeenLastCalledWith('');
    await waitFor(() => expect(q(container, 'empty-state')).toBeNull());
  });

  it('a filter and a search together: one "Clear filters" removes both', async () => {
    const onFilterChange = vi.fn();
    const onSearchChange = vi.fn();
    const { container } = mount(authored(), {
      initialFilters: PANEL_MISS,
      initialSearchTerm: MISS,
      onFilterChange,
      onSearchChange,
    });
    const panel = await emptyPanel(container);

    expect(panel.querySelectorAll('[data-testid^="empty-state-clear-"]')).toHaveLength(1);
    fireEvent.click(q(panel, 'empty-state-clear-filters')!);

    expect(onSearchChange).toHaveBeenLastCalledWith('');
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ conditions: [] }));
    await waitFor(() => expect(q(container, 'empty-state')).toBeNull());
  });

  it('the "In a queue" toggle is the reader\'s filter too', async () => {
    const { container } = mount(authored());
    await waitFor(() => expect(q(container, 'queue-sitting-filter')).not.toBeNull());
    fireEvent.click(q(container, 'queue-sitting-filter')!);
    const panel = await emptyPanel(container);

    fireEvent.click(q(panel, 'empty-state-clear-filters')!);

    await waitFor(() => expect(q(container, 'empty-state')).toBeNull());
    expect(q(container, 'queue-sitting-filter')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('a list emptied by the view\'s declared filter alone offers no clear action', async () => {
    const { container } = mount(authored({ filter: [['status', '=', MISS]] }));
    const panel = await emptyPanel(container);

    expect(panel.textContent).toContain('No records match this view’s filter.');
    expect(q(panel, 'empty-state-clear-filters')).toBeNull();
    expect(q(panel, 'empty-state-clear-search')).toBeNull();
    expect(isPrimary(q(panel, 'empty-state-add-record'))).toBe(true);
  });

  it('a reader filter over a declared filter clears only the reader\'s part', async () => {
    const onFilterChange = vi.fn();
    const { container, ds } = mount(authored({ filter: [['status', '!=', 'closed']] }), {
      initialFilters: PANEL_MISS,
      onFilterChange,
    });
    const panel = await emptyPanel(container);

    fireEvent.click(q(panel, 'empty-state-clear-filters')!);

    await waitFor(() => expect(q(container, 'empty-state')).toBeNull());
    const lastQuery = JSON.stringify(ds.find.mock.calls.at(-1));
    expect(lastQuery).not.toContain(MISS);
    expect(lastQuery).toContain('closed');
  });
});
