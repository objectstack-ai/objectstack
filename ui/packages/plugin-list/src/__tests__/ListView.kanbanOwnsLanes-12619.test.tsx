/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12619 — the list half: what this view hands the board it mounts.
 *
 * A board under this view used to be handed this view's window — on a view
 * declaring `pagination.pageSize: 25`, one page of the grid — and the view's
 * columns whole, as entries a card reads as field names. Measured on HotCRM's
 * 45 opportunities: 25 cards, the closed columns at 0, "Showing first 25
 * records" in the footer, and cards carrying the record's name only.
 *
 * `plugin-kanban` is not a dependency of `plugin-list`, so the board slot is a
 * registry stub that records the props it is handed (the device
 * `ListView.viewSwitchRefetch-7394.test.tsx` uses). The real board under the
 * real list is `packages/app-shell/src/__tests__/listKanbanEveryRecord-12619.test.tsx`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'crm_opportunity';
const TOTAL = 45;

const FIELDS = {
  name: { type: 'text', label: 'Opportunity Name' },
  account: { type: 'text', label: 'Account' },
  stage: {
    type: 'select',
    label: 'Stage',
    options: [
      { value: 'open', label: 'Open' },
      { value: 'won', label: 'Won' },
    ],
  },
  amount: { type: 'number', label: 'Amount' },
  probability: { type: 'number', label: 'Probability' },
  owner_id: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
};

function makeDataSource(objectDef: Record<string, unknown> = { name: OBJECT, fields: FIELDS }) {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? TOTAL;
    const rows = Array.from({ length: Math.min(top, TOTAL) }, (_, i) => ({
      id: `o-${i}`,
      name: `Deal ${i}`,
      account: `Account ${i}`,
      stage: i % 2 === 0 ? 'open' : 'won',
      amount: i,
    }));
    return { data: rows, total: TOTAL };
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  } as any;
}

const VIEW = {
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'kanban',
  columns: [{ field: 'name' }, { field: 'account' }, { field: 'stage' }, { field: 'amount' }, { field: 'probability' }],
  pagination: { pageSize: 25, pageSizeOptions: [25, 50] },
  options: { kanban: { groupByField: 'stage', titleField: 'name' } },
};

let lastKanbanProps: any = null;
let prevKanban: any;
beforeAll(() => {
  prevKanban = ComponentRegistry.get('object-kanban');
  ComponentRegistry.register('object-kanban', (props: any) => {
    lastKanbanProps = props;
    return <div data-testid="kanban-stub" />;
  }, { namespace: 'plugin-kanban' } as never);
});
afterAll(() => {
  if (prevKanban) ComponentRegistry.register('object-kanban', prevKanban);
  else ComponentRegistry.unregister('object-kanban');
});
beforeEach(() => { lastKanbanProps = null; });
afterEach(() => { cleanup(); lastKanbanProps = null; });

function renderList(ds: any, view: Record<string, unknown> = VIEW) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={view as any} dataSource={ds} />
    </SchemaRendererProvider>,
  );
}

async function boardProps() {
  await waitFor(() => expect(screen.queryByTestId('kanban-stub')).not.toBeNull());
  return lastKanbanProps;
}

describe('a list view hands its board the query, not a page (objectui#12619)', () => {
  it('withholds its window and hands the board the lane paging request', async () => {
    const ds = makeDataSource();
    renderList(ds);
    const props = await boardProps();

    expect(props.data).toBeUndefined();
    expect(props.lanePaging).toEqual({ search: '', reloadKey: expect.any(String) });
    expect(props.schema.groupBy).toBe('stage');
  });

  it('hands the board the EFFECTIVE filter it queries its lanes under, lowered as this view\'s own query sends it', async () => {
    const ds = makeDataSource();
    renderList(ds, { ...VIEW, filter: [{ field: 'amount', operator: 'greater_than', value: 3 }] });
    const props = await boardProps();

    const sent = JSON.stringify(props.schema.filter);
    expect(sent).toContain('amount');
    // The lowered node, not the authored rule objects (`selfQueryFilter`).
    expect(sent).not.toContain('"operator"');
    const ownQuery = ds.find.mock.calls[0][1];
    expect(props.schema.filter).toEqual(ownQuery.$filter);
  });

  it('the footer counts the view, and no longer says the board is its first page', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await boardProps();

    await waitFor(() => expect(screen.getByTestId('record-count-bar')).toHaveTextContent(`${TOTAL} records`));
    expect(screen.queryByTestId('data-limit-warning')).not.toBeInTheDocument();
    // Each lane asks its own page, so a page size would change nothing drawn.
    expect(screen.queryByTestId('page-size-selector')).not.toBeInTheDocument();
  });

  it('a card carries the view\'s next two columns past its title and its lane, by name', async () => {
    const ds = makeDataSource();
    renderList(ds);
    const props = await boardProps();

    expect(props.schema.cardFields).toEqual(['account', 'amount']);
  });

  it('the kanban block\'s own `columns` is the author\'s card list, every one of it', async () => {
    const ds = makeDataSource();
    renderList(ds, { ...VIEW, options: { kanban: { groupByField: 'stage', columns: ['amount', 'probability', 'account'] } } });
    const props = await boardProps();

    expect(props.schema.cardFields).toEqual(['amount', 'probability', 'account']);
  });

  it('names the owner field the object declares, for the card\'s avatar', async () => {
    const ds = makeDataSource();
    renderList(ds);
    const props = await boardProps();

    expect(props.ownerField).toBe('owner_id');
  });

  it('CONTROL: names no owner field on an object whose ownership gives its records none', async () => {
    const ds = makeDataSource({ name: OBJECT, ownership: 'org', fields: FIELDS });
    renderList(ds);
    const props = await boardProps();

    expect(props.ownerField).toBeUndefined();
  });

  it('CONTROL: a board whose lanes are not known before the query keeps the window', async () => {
    const { stage: _stage, ...rest } = FIELDS;
    const ds = makeDataSource({ name: OBJECT, fields: { ...rest, stage: { type: 'text', label: 'Stage' } } });
    renderList(ds);
    const props = await boardProps();

    expect(props.lanePaging).toBeUndefined();
    expect(Array.isArray(props.data)).toBe(true);
    expect(props.data).toHaveLength(25);
  });

  it('CONTROL: a board grouped into swimlanes keeps the window', async () => {
    const ds = makeDataSource();
    renderList(ds, { ...VIEW, grouping: { fields: [{ field: 'account', order: 'asc', collapsed: false }] } });
    const props = await boardProps();

    expect(props.lanePaging).toBeUndefined();
    expect(Array.isArray(props.data)).toBe(true);
  });
});
