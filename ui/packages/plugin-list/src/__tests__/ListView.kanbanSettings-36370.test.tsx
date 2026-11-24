/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36370 — what `ListView` hands the board's 视图设置 and the lane
 * header menu.
 *
 * Pinned here:
 *   - the lane field picker offers the option-backed fields only (a select or
 *     a radio): a lookup, a user or a boolean draws no sensible lanes yet;
 *   - the lane statistic sums what the aggregate table's `sum` row accepts
 *     (a number, a currency), never a percent, a formula or a boolean — the
 *     verdict `@objectstack/lint` gives `kanban.summary`;
 *   - the lane collapse key is the reader's own: `<user>:<object>:<view>`, the
 *     view named by the host's `laneCollapseKey`, else the schema's id, else
 *     its name; without a signed-in user it reads `-`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider, FilterScopeProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'settings_deal';

const objectDef = {
  name: OBJECT,
  label: 'Deal',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    stage: { name: 'stage', type: 'select', label: 'Stage', options: [{ label: 'New', value: 'new' }, { label: 'Won', value: 'won' }] },
    tier: { name: 'tier', type: 'radio', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }] },
    account: { name: 'account', type: 'lookup', label: 'Account', reference: 'account' },
    owner: { name: 'owner', type: 'user', label: 'Owner' },
    closed: { name: 'closed', type: 'boolean', label: 'Closed' },
    amount: { name: 'amount', type: 'currency', label: 'Amount' },
    seats: { name: 'seats', type: 'number', label: 'Seats' },
    rate: { name: 'rate', type: 'percent', label: 'Rate' },
    score: { name: 'score', type: 'formula', label: 'Score' },
  },
};

const rows = [{ id: 'd1', name: 'Alpha', stage: 'new' }];

let laneMenus: Array<Record<string, any> | undefined> = [];

ComponentRegistry.register(
  'object-kanban',
  (props: Record<string, any>) => {
    laneMenus.push(props.laneMenu);
    return <div data-testid="object-kanban-spy" />;
  },
  { namespace: 'test', label: 'object-kanban spy', category: 'view' },
);

const makeDataSource = () =>
  ({
    find: vi.fn(async () => rows),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => rows.length),
    getObjectSchema: vi.fn(async () => objectDef),
    getObjects: vi.fn(async () => []),
    onMutation: () => () => {},
  }) as any;

function mount(opts: { userId?: string; laneCollapseKey?: string; schemaExtras?: Record<string, unknown> } = {}) {
  laneMenus = [];
  const list = (
    <SchemaRendererProvider dataSource={makeDataSource()}>
      <ListView
        schema={{
          type: 'list-view',
          objectName: OBJECT,
          viewType: 'kanban',
          columns: ['name'],
          kanban: { groupByField: 'stage' },
          ...(opts.schemaExtras ?? {}),
        } as never}
        dataSource={makeDataSource()}
        laneCollapseKey={opts.laneCollapseKey}
        onKanbanChange={() => {}}
      />
    </SchemaRendererProvider>
  );
  return render(opts.userId ? <FilterScopeProvider currentUserId={opts.userId}>{list}</FilterScopeProvider> : list);
}

async function collapseKey(): Promise<string | undefined> {
  await waitFor(() => expect(laneMenus[laneMenus.length - 1]?.collapseKey).toBeDefined());
  return laneMenus[laneMenus.length - 1]?.collapseKey;
}

afterEach(cleanup);

describe('ListView on a board: the settings it offers (objectstack#36370)', () => {
  it('offers only option-backed lane fields: a select and a radio', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('object-kanban-spy')).toBeTruthy());
    fireEvent.click(await screen.findByTestId('toolbar-display-trigger'));
    fireEvent.click(await screen.findByTestId('options-row-lane-field'));
    expect(screen.getByTestId('options-lane-field-stage')).toBeTruthy();
    expect(screen.getByTestId('options-lane-field-tier')).toBeTruthy();
    for (const out of ['account', 'owner', 'closed', 'name', 'amount']) {
      expect(screen.queryByTestId(`options-lane-field-${out}`)).toBeNull();
    }
  });

  it('offers a sum over the fields the aggregate table adds, and no percent, formula or boolean', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('object-kanban-spy')).toBeTruthy());
    fireEvent.click(await screen.findByTestId('toolbar-display-trigger'));
    fireEvent.click(await screen.findByTestId('options-row-lane-summary'));
    expect(screen.getByTestId('options-lane-summary-sum:amount')).toBeTruthy();
    expect(screen.getByTestId('options-lane-summary-sum:seats')).toBeTruthy();
    for (const out of ['rate', 'score', 'closed', 'name']) {
      expect(screen.queryByTestId(`options-lane-summary-sum:${out}`)).toBeNull();
    }
  });

  it('keys lane collapse by the reader, the object and the view', async () => {
    mount({ userId: 'u1', laneCollapseKey: 'pipeline' });
    expect(await collapseKey()).toBe(`u1:${OBJECT}:pipeline`);
    cleanup();

    // Another reader of the same board keeps their own.
    mount({ userId: 'u2', laneCollapseKey: 'pipeline' });
    expect(await collapseKey()).toBe(`u2:${OBJECT}:pipeline`);
    cleanup();

    // Without the host's key the schema's own id names the view; signed out reads `-`.
    mount({ schemaExtras: { id: 'board_view' } });
    expect(await collapseKey()).toBe(`-:${OBJECT}:board_view`);
  });
});
