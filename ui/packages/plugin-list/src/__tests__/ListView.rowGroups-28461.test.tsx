/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28461 — a grouped grid and a board report the rows they show
 * group by group, and `ListView` relays the report through `onRowsChange`:
 * the rows end to end, and the groups as its second argument. The console's
 * record pane steps within the opened row's group or lane and names it.
 *
 * A grouped grid that groups on the server and a lane-paged board fetch their
 * rows themselves, so this component holds none of them: the view reports
 * what it draws (`onRowGroupsChange`, pinned on the real grid and board one
 * package over) and this component passes it on. Stubs stand in for both
 * renderers here: what is under test is the relay.
 *
 * Control: an ungrouped paged grid is not handed the channel, and reports its
 * rows with no groups, as before.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'crm_contact';

const ROWS = [
  { id: 'c-1', name: 'John Smith', account: 'Acme Corporation', stage: 'new' },
  { id: 'c-4', name: 'Hank Rearden', account: 'Globex', stage: 'won' },
  { id: 'c-2', name: 'Jane Doe', account: 'Acme Corporation', stage: 'new' },
];

/** What the stub view reports, in display order: two groups. */
const GROUPS = [
  { key: 'acme', label: 'Acme Corporation', rows: [{ id: 'c-1' }, { id: 'c-2' }] },
  { key: 'globex', label: 'Globex', rows: [{ id: 'c-4' }] },
];

const makeDataSource = () => ({
  find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
  queryGroupHeaders: vi.fn(async () => []),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: async (name: string) => ({
    name,
    fields: {
      id: { type: 'text' },
      name: { type: 'text', label: 'Name' },
      account: { type: 'text', label: 'Account' },
      stage: { type: 'select', label: 'Stage', options: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }] },
    },
  }),
}) as any;

const handed: Record<'grid' | 'kanban', any> = { grid: null, kanban: null };

/** A view that reports {@link GROUPS} once mounted, when handed the channel. */
const stubView = (kind: 'grid' | 'kanban') => (props: any) => {
  handed[kind] = props;
  React.useEffect(() => {
    props.onRowGroupsChange?.(GROUPS);
  }, [props.onRowGroupsChange]);
  return <div data-testid={`${kind}-stub`} />;
};

const previous: Record<string, any> = {};
beforeAll(() => {
  for (const [type, kind] of [['object-grid', 'grid'], ['object-kanban', 'kanban']] as const) {
    previous[type] = ComponentRegistry.get(type);
    ComponentRegistry.register(type, stubView(kind));
  }
});
afterAll(() => {
  for (const type of ['object-grid', 'object-kanban']) {
    if (previous[type]) ComponentRegistry.register(type, previous[type]);
    else ComponentRegistry.unregister(type);
  }
});
afterEach(() => {
  cleanup();
  handed.grid = null;
  handed.kanban = null;
});

function mount(schemaExtra: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const onRowsChange = vi.fn();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, columns: ['name'], ...schemaExtra } as any}
        dataSource={dataSource}
        onRowsChange={onRowsChange}
      />
    </SchemaRendererProvider>,
  );
  return { onRowsChange };
}

const lastReport = (fn: ReturnType<typeof vi.fn>) => {
  const [rows, groups] = fn.mock.calls.at(-1) ?? [];
  return {
    ids: (rows as Array<{ id: string }> | undefined)?.map((row) => row.id),
    groups: (groups as typeof GROUPS | undefined)?.map((group) => [group.label, group.rows.map((row) => row.id)]),
  };
};

describe('ListView relays the rows a grouped grid or a board shows, group by group (objectstack#28461)', () => {
  it('a grouped grid: the rows end to end, with the groups they sit in', async () => {
    const { onRowsChange } = mount({
      viewType: 'grid',
      grouping: { fields: [{ field: 'account' }] },
    });
    await waitFor(() => expect(handed.grid?.onRowGroupsChange).toBeTypeOf('function'));
    await waitFor(() =>
      expect(lastReport(onRowsChange)).toEqual({
        ids: ['c-1', 'c-2', 'c-4'],
        groups: [['Acme Corporation', ['c-1', 'c-2']], ['Globex', ['c-4']]],
      }),
    );
  });

  it('a board: the cards end to end, with the lanes they sit in', async () => {
    const { onRowsChange } = mount({
      viewType: 'kanban',
      options: { kanban: { groupBy: 'stage' } },
    });
    await waitFor(() => expect(handed.kanban?.onRowGroupsChange).toBeTypeOf('function'));
    await waitFor(() =>
      expect(lastReport(onRowsChange)).toEqual({
        ids: ['c-1', 'c-2', 'c-4'],
        groups: [['Acme Corporation', ['c-1', 'c-2']], ['Globex', ['c-4']]],
      }),
    );
  });

  it('control: an ungrouped grid is not handed the channel and reports its rows with no groups', async () => {
    const { onRowsChange } = mount({ viewType: 'grid' });
    await waitFor(() => expect(lastReport(onRowsChange).ids).toEqual(['c-1', 'c-4', 'c-2']));
    expect(handed.grid?.onRowGroupsChange).toBeUndefined();
    expect(lastReport(onRowsChange).groups).toBeUndefined();
  });
});
