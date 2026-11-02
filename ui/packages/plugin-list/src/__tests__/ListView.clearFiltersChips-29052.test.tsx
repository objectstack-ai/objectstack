/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29052 — a list emptied by a user-filter chip offers the same
 * "Clear filters" as one emptied by the filter panel, and the click clears
 * the chip.
 *
 * Before, the chip-only empty list said "your current filters or search" and
 * offered only "Add record": `UserFilters` kept its selection to itself, so the
 * list could not clear it.
 *
 * Pinned:
 * - a chip alone (restored from the host, or the author's default) empties
 *   the list: "Clear filters" leads; a click clears the chip, reports every
 *   chip field empty to the host (which drops its `uf_*` params), and the rows
 *   come back;
 * - a chip and a panel condition together: one click clears both;
 * - a preset tab is not the reader's filter: a list it empties offers no clear
 *   action.
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

/** One lead; any query carrying the reader's miss (`zzz`) answers zero rows. */
function leadsDataSource() {
  return {
    find: vi.fn(async (_object: string, params: unknown) =>
      JSON.stringify(params ?? {}).includes(MISS) ? [] : [{ _id: 'l1', name: 'Acme', status: 'open' }],
    ),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: OBJECT,
      fields: {
        name: { name: 'name', type: 'text' },
        status: { name: 'status', type: 'text' },
        rating: { name: 'rating', type: 'text' },
      },
    }),
  };
}

const session: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  // No queue: the "In a queue" toggle stays off the toolbar.
  hasAnyQueue: false,
  positions: [],
  permissionSets: ['member_default'],
  objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  fields: {},
};

const STATUS_CHIP = { field: 'status', options: [{ label: 'Miss', value: MISS }, { label: 'Open', value: 'open' }] };
const RATING_CHIP = { field: 'rating', options: [{ label: 'Hot', value: 'hot' }] };

const authored = (node: Record<string, unknown> = {}): ListViewSchema =>
  ({ type: 'list-view', objectName: OBJECT, fields: ['name'], addRecord: { enabled: true }, ...node }) as unknown as ListViewSchema;

const chips = (...fields: unknown[]) => authored({ userFilters: { element: 'dropdown', fields } });

type HostProps = Pick<
  React.ComponentProps<typeof ListView>,
  'initialFilters' | 'onFilterChange' | 'userFilterSelections' | 'onUserFilterSelectionsChange'
>;

function mount(schema: ListViewSchema, props: HostProps = {}) {
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

const q = (root: ParentNode, id: string) => root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const isPrimary = (el: HTMLElement | null) => !!el && el.className.includes('bg-primary');

async function emptyPanel(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(q(container, 'empty-state')).not.toBeNull());
  return q(container, 'empty-state')!;
}

describe('ListView "Clear filters" clears the user-filter chips (objectstack#29052)', () => {
  it('a restored chip alone: "Clear filters" leads, and a click clears the chip and brings the rows back', async () => {
    const onUserFilterSelectionsChange = vi.fn();
    const { container, ds } = mount(chips(STATUS_CHIP, RATING_CHIP), {
      userFilterSelections: { status: [MISS] },
      onUserFilterSelectionsChange,
    });
    const panel = await emptyPanel(container);

    // The copy names filters, and now the page offers the action it names.
    expect(panel.textContent).toMatch(/your current filters or search/i);
    const clear = q(panel, 'empty-state-clear-filters');
    expect(clear?.textContent).toBe('Clear filters');
    expect(isPrimary(clear)).toBe(true);
    expect(isPrimary(q(panel, 'empty-state-add-record'))).toBe(false);
    expect(q(container, 'filter-clear-status')).not.toBeNull();

    fireEvent.click(clear!);

    await waitFor(() => expect(q(container, 'empty-state')).toBeNull());
    expect(q(container, 'filter-clear-status')).toBeNull();
    expect(JSON.stringify(ds.find.mock.calls.at(-1))).not.toContain(MISS);
    // Every chip field is reported empty, so the host drops each `uf_*` param.
    expect(onUserFilterSelectionsChange).toHaveBeenLastCalledWith({ status: [], rating: [] });
  });

  it('a chip the author defaulted is the reader\'s to clear too', async () => {
    const { container } = mount(chips({ ...STATUS_CHIP, defaultValues: [MISS] }));
    const panel = await emptyPanel(container);

    fireEvent.click(q(panel, 'empty-state-clear-filters')!);

    await waitFor(() => expect(q(container, 'empty-state')).toBeNull());
    expect(q(container, 'filter-clear-status')).toBeNull();
  });

  it('a chip and a panel condition together: one click clears both', async () => {
    const onFilterChange = vi.fn();
    const { container, ds } = mount(chips(STATUS_CHIP), {
      userFilterSelections: { status: [MISS] },
      initialFilters: {
        id: 'root',
        logic: 'and',
        conditions: [{ id: 'c1', field: 'rating', operator: 'equals', value: MISS }],
      } as never,
      onFilterChange,
    });
    const panel = await emptyPanel(container);

    expect(panel.querySelectorAll('[data-testid^="empty-state-clear-"]')).toHaveLength(1);
    fireEvent.click(q(panel, 'empty-state-clear-filters')!);

    await waitFor(() => expect(q(container, 'empty-state')).toBeNull());
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ conditions: [] }));
    expect(q(container, 'filter-clear-status')).toBeNull();
    expect(JSON.stringify(ds.find.mock.calls.at(-1))).not.toContain(MISS);
  });

  it('a list emptied by a preset tab offers no clear action: the tab is the view\'s preset', async () => {
    const { container } = mount(
      authored({
        userFilters: {
          element: 'tabs',
          tabs: [{ id: 'miss', label: 'Miss', filters: [['status', '=', MISS]], default: true }],
        },
      }),
    );
    const panel = await emptyPanel(container);

    expect(q(container, 'filter-tab-miss')).not.toBeNull();
    expect(q(panel, 'empty-state-clear-filters')).toBeNull();
  });
});
