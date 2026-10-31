/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28211 — `ListView`'s kanban branch hands the block's `lanes` to
 * the board as the `object-kanban` node's `columns`, in the author's order and
 * titled by the lane field's option labels, through `kanbanDeclaredLanes`
 * (`@object-ui/core`), the mapping `ObjectView`'s twin makes. A block without
 * `lanes` emits no `columns`, so the board keeps one lane per option.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';

const OBJECT = 'lanes_task';

const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    status: {
      name: 'status',
      type: 'select',
      label: 'Status',
      options: [
        { label: 'Not Started', value: 'not_started' },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Completed', value: 'completed' },
        { label: 'Cancelled', value: 'cancelled', kind: 'lost' },
      ],
    },
  },
};

const rows = [{ id: 'r1', name: 'Alpha', status: 'in_progress' }];

let nodes: Array<Record<string, any>> = [];

ComponentRegistry.register(
  'object-kanban',
  (props: Record<string, any>) => {
    nodes.push(props.schema);
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

/** Mount `ListView` on a kanban view and return the last board node, once `accept` holds. */
async function kanbanNode(kanban: Record<string, unknown>, accept: (node: Record<string, any>) => boolean) {
  cleanup();
  nodes = [];
  render(
    <SchemaRendererProvider dataSource={makeDataSource()}>
      <ListView
        schema={{ type: 'list-view', objectName: OBJECT, viewType: 'kanban', columns: ['name'], kanban } as never}
        dataSource={makeDataSource()}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => {
    expect(nodes.length).toBeGreaterThan(0);
    expect(accept(nodes[nodes.length - 1])).toBe(true);
  });
  return nodes[nodes.length - 1];
}

beforeEach(() => {
  cleanup();
  nodes = [];
});

describe('objectstack#28211 — the list view board draws the declared lanes', () => {
  it('emits `kanban.lanes` as the node\'s `columns`, in order, titled by option label', async () => {
    const node = await kanbanNode(
      { groupByField: 'status', lanes: ['in_progress', 'not_started', 'cancelled'] },
      (n) => n.columns?.[0]?.title === 'In Progress',
    );
    expect(node.groupBy).toBe('status');
    expect(node.columns).toEqual([
      { id: 'in_progress', title: 'In Progress' },
      { id: 'not_started', title: 'Not Started' },
      { id: 'cancelled', title: 'Cancelled', collapsed: true },
    ]);
    // `kanban.columns` stays the card fields; the lanes never land there.
    expect(node.cardFields).not.toContain('in_progress');
  });

  it('CONTROL: a block without `lanes` emits no `columns`', async () => {
    const node = await kanbanNode({ groupByField: 'status' }, (n) => n.groupBy === 'status');
    expect(Object.prototype.hasOwnProperty.call(node, 'columns')).toBe(false);
  });
});
