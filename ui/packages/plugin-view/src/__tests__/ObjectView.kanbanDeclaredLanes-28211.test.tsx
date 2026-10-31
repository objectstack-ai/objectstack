/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28211 — `generateViewSchema`'s kanban branch hands the block's
 * `lanes` to the board as the `object-kanban` node's `columns`, in the
 * author's order and titled by the lane field's option labels, through
 * `kanbanDeclaredLanes` (`@object-ui/core`), the mapping `ListView`'s twin
 * makes. A block without `lanes` emits no `columns`, so the board keeps one
 * lane per option.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every schema the view hands to SchemaRenderer, in order. */
const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const ReactMod = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: ReactMod.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const FIELDS = {
  status: {
    name: 'status',
    type: 'select',
    label: 'Status',
    options: [
      { value: 'not_started', label: 'Not Started' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'completed', label: 'Completed' },
      { value: 'cancelled', label: 'Cancelled', kind: 'lost' },
    ],
  },
};

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: FIELDS }),
});

/** The last `object-kanban` node, once `accept` holds for it. */
async function kanbanNode(kanban: Record<string, unknown>, accept: (node: any) => boolean): Promise<any> {
  cleanup();
  rendered.length = 0;
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task' } as unknown as ObjectViewSchema}
      views={[{ id: 'k', label: 'Board', type: 'kanban' as any, kanban }] as any}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => {
    const node = rendered[rendered.length - 1];
    expect(node?.type).toBe('object-kanban');
    expect(accept(node)).toBe(true);
  });
  return rendered[rendered.length - 1];
}

beforeEach(() => {
  rendered.length = 0;
});

describe('objectstack#28211 — the generated board draws the declared lanes', () => {
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
  });

  it('CONTROL: a block without `lanes` emits no `columns`', async () => {
    const node = await kanbanNode({ groupByField: 'status' }, () => true);
    expect(Object.prototype.hasOwnProperty.call(node, 'columns')).toBe(false);
  });
});
