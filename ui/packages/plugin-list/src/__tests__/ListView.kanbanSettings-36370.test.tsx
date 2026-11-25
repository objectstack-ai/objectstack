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
 *   - the lane field picker offers the option-backed fields (a select, a
 *     radio) and the single-valued references (a lookup, a user, a
 *     master-detail, a tree: objectstack#36643), never a many-valued
 *     reference, a boolean or a text field; choosing a person writes it as
 *     the board's `groupByField`;
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
    parent: { name: 'parent', type: 'master_detail', label: 'Parent', reference: 'account' },
    region: { name: 'region', type: 'tree', label: 'Region', reference: 'region' },
    partners: { name: 'partners', type: 'lookup', label: 'Partners', reference: 'account', multiple: true },
    watchers: { name: 'watchers', type: 'user', label: 'Watchers', multiple: true },
    closed: { name: 'closed', type: 'boolean', label: 'Closed' },
    amount: { name: 'amount', type: 'currency', label: 'Amount' },
    seats: { name: 'seats', type: 'number', label: 'Seats' },
    rate: { name: 'rate', type: 'percent', label: 'Rate' },
    score: { name: 'score', type: 'formula', label: 'Score' },
    close_date: { name: 'close_date', type: 'date', label: 'Close date' },
    signed_at: { name: 'signed_at', type: 'datetime', label: 'Signed at' },
    call_time: { name: 'call_time', type: 'time', label: 'Call time' },
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

function mount(opts: { userId?: string; laneCollapseKey?: string; schemaExtras?: Record<string, unknown>; onKanbanChange?: (patch: Record<string, unknown>) => void } = {}) {
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
        onKanbanChange={opts.onKanbanChange ?? (() => {})}
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
  it('offers option-backed and single-valued reference lane fields, never a many-valued one', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('object-kanban-spy')).toBeTruthy());
    fireEvent.click(await screen.findByTestId('toolbar-display-trigger'));
    fireEvent.click(await screen.findByTestId('options-row-lane-field'));
    for (const offered of ['stage', 'tier', 'account', 'owner', 'parent', 'region']) {
      expect(screen.getByTestId(`options-lane-field-${offered}`)).toBeTruthy();
    }
    for (const out of ['partners', 'watchers', 'closed', 'name', 'amount']) {
      expect(screen.queryByTestId(`options-lane-field-${out}`)).toBeNull();
    }
  });

  it('choosing a person in the lane field picker writes it as the lane field (objectstack#36643)', async () => {
    const onKanbanChange = vi.fn();
    mount({ onKanbanChange });
    await waitFor(() => expect(screen.getByTestId('object-kanban-spy')).toBeTruthy());
    fireEvent.click(await screen.findByTestId('toolbar-display-trigger'));
    fireEvent.click(await screen.findByTestId('options-row-lane-field'));
    fireEvent.click(screen.getByTestId('options-lane-field-owner'));
    // The lanes chosen on the old field name none of the owners: they go.
    expect(onKanbanChange).toHaveBeenCalledWith({ groupByField: 'owner', lanes: null });
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

/**
 * objectstack#36880 — each lane statistic offers the fields the aggregate
 * table's row for THAT function accepts (the verdict `@objectstack/lint` gives
 * `kanban.summary`): a date, a date-time and a time have a minimum and a
 * maximum, and neither a sum nor an average; a percent averages but does not
 * add; a formula and a boolean are offered under none.
 */
describe('ListView on a board: each lane statistic offers its own fields (objectstack#36880)', () => {
  const OFFERED: Record<string, string[]> = {
    sum: ['amount', 'seats'],
    avg: ['amount', 'seats', 'rate'],
    min: ['amount', 'seats', 'rate', 'close_date', 'signed_at', 'call_time'],
    max: ['amount', 'seats', 'rate', 'close_date', 'signed_at', 'call_time'],
  };
  const CANDIDATES = ['amount', 'seats', 'rate', 'score', 'closed', 'name', 'close_date', 'signed_at', 'call_time'];

  it('offers min and max over the temporal fields, and every function only what its row accepts', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('object-kanban-spy')).toBeTruthy());
    fireEvent.click(await screen.findByTestId('toolbar-display-trigger'));
    fireEvent.click(await screen.findByTestId('options-row-lane-summary'));
    for (const [fn, offered] of Object.entries(OFFERED)) {
      const shown = CANDIDATES.filter((name) => screen.queryByTestId(`options-lane-summary-${fn}:${name}`) !== null);
      expect({ fn, shown }).toEqual({ fn, shown: offered });
    }
  });
});
