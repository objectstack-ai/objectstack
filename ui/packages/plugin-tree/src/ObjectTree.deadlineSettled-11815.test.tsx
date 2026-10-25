/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — the tree judges a declared deadline against each node's
 * record: an open node's past deadline reads "Overdue Nd" in red, a done
 * node's reads neutral (ruling D).
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { DataSource } from '@object-ui/types';
import { ObjectTree } from './ObjectTree';

afterEach(cleanup);

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const OBJECT_SCHEMA = {
  name: 'milestone',
  fields: {
    name: { type: 'text', label: 'Name' },
    parent_id: { type: 'tree', reference: 'milestone', label: 'Parent' },
    status: { type: 'text', label: 'Status' },
    deliver_by: { type: 'date', label: 'Deliver by', dueLike: true, settledWhen: "record.status == 'done'" },
  },
};

const ROWS = [
  { id: 'm1', name: 'Open milestone', parent_id: null, status: 'open', deliver_by: daysAgo(5) },
  { id: 'm2', name: 'Done milestone', parent_id: null, status: 'done', deliver_by: daysAgo(5) },
];

const TREE_SCHEMA = {
  type: 'object-tree',
  objectName: 'milestone',
  parentField: 'parent_id',
  labelField: 'name',
  fields: ['name', 'status', 'deliver_by'],
};

const ds = {
  find: async () => ROWS,
  getObjectSchema: async () => OBJECT_SCHEMA,
} as unknown as DataSource;

const isRed = (text: string) => screen.getByText(text).closest('span.tabular-nums')?.className.includes('text-red-600');

describe('objectui#11815 — tree', () => {
  it("an open node's declared deadline reads overdue, a done node's reads neutral", async () => {
    render(<ObjectTree schema={TREE_SCHEMA as never} dataSource={ds} data={ROWS} />);
    await waitFor(() => expect(screen.getByText('Overdue 5d')).toBeInTheDocument());
    expect(isRed('Overdue 5d')).toBe(true);
    expect(screen.getAllByText('5 days ago')).toHaveLength(1);
    expect(isRed('5 days ago')).toBe(false);
  });
});
