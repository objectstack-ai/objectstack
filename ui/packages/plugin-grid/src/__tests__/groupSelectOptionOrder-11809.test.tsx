/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11809 — a grid grouped by a select field lists its groups in the
 * field's DECLARED option order, not in the order of their labels.
 *
 * The showcase task's `status` declares Backlog → To Do → In Progress →
 * In Review → Done. Grouped by it, the grid read Backlog, Done, In Progress,
 * In Review, To Do: both group sorts in `useGroupedData` compared the header
 * LABELS. The Kanban board over the same field draws its lanes in the declared
 * order, which is the order the author wrote and the one these pins hold.
 *
 * Both of the grid's group sources are pinned, since each sorts on its own:
 *   - SERVER-grouped (the grid owns its fetch, objectui#7189): the header
 *     query answers in the stored values' order and the hook reorders it;
 *   - CLIENT-grouped (a host hands the rows in): the hook buckets the rows.
 *
 * Empty and undeclared values sit after the declared options in both
 * directions. CONTROL: a field with no options keeps label order, the order
 * every non-select grouping had before.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { useGroupedData, useGroupedDataInOptionOrder } from '../useGroupedData';
import { buildCategoryOrder, buildCategoryRank } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'showcase_task';

/** The showcase task's two picklists, options in their declared order. */
const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  status: {
    type: 'select',
    label: 'Status',
    options: [
      { value: 'backlog', label: 'Backlog' },
      { value: 'todo', label: 'To Do' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'in_review', label: 'In Review' },
      { value: 'done', label: 'Done' },
    ],
  },
  priority: {
    type: 'select',
    label: 'Priority',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'urgent', label: 'Urgent' },
    ],
  },
  // CONTROL: free text, no option order to follow.
  area: { type: 'text', label: 'Area' },
};

/**
 * Rows listed in the stored values' alphabetical order — the order a
 * `GROUP BY` answers in — with one value the options do not declare
 * (`legacy`) and one empty status.
 */
const ROWS: Array<Record<string, unknown>> = [
  { id: 't1', title: 'Spec the API', status: 'backlog', priority: 'high', area: 'platform' },
  { id: 't2', title: 'Ship it', status: 'done', priority: 'low', area: 'console' },
  { id: 't3', title: 'Build it', status: 'in_progress', priority: 'medium', area: 'billing' },
  { id: 't4', title: 'Review it', status: 'in_review', priority: 'urgent', area: 'console' },
  { id: 't5', title: 'Old import', status: 'legacy', priority: 'low', area: 'platform' },
  { id: 't6', title: 'Plan it', status: 'todo', priority: 'high', area: 'billing' },
  { id: 't7', title: 'Untriaged', status: null, priority: 'medium', area: 'console' },
];

const DECLARED_STATUS = ['Backlog', 'To Do', 'In Progress', 'In Review', 'Done'];

/** The `FilterCondition` subset the compiled group queries use. */
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matches(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

/**
 * A data source that answers the group header query — its buckets in the
 * stored values' sorted order, as a `GROUP BY` does, the empty bucket first —
 * and pages each group's rows.
 */
const makeServerSource = () => ({
  queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[] }) => {
    const groupBy = query.groupBy ?? [];
    const buckets = new Map<string, number>();
    for (const row of ROWS.filter((r) => matches(r, query.where))) {
      const key = JSON.stringify(groupBy.map((f) => row[f] ?? null));
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, count]) => {
        const values = JSON.parse(key) as unknown[];
        return { ...Object.fromEntries(groupBy.map((f, i) => [f, values[i]])), count };
      });
  }),
  find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
    const matching = ROWS.filter((r) => matches(r, params.$filter));
    const skip = (params.$skip as number | undefined) ?? 0;
    const top = (params.$top as number | undefined) ?? matching.length;
    return { data: matching.slice(skip, skip + top), total: matching.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
});

/** The client path: the rows are handed in; the source answers the definition only. */
const makeSchemaOnlySource = () => ({
  find: vi.fn(),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
});

type GroupingEntry = { field: string; order?: 'asc' | 'desc' };

const renderServerGrouped = (grouping: GroupingEntry[]) => {
  const ds = makeServerSource();
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: ['title', 'status', 'priority', 'area'],
          grouping: { fields: grouping },
        } as unknown as ObjectGridSchema}
        dataSource={ds as unknown as DataSource}
      />
    </ActionProvider>,
  );
  return ds;
};

const renderClientGrouped = (grouping: GroupingEntry[]) => {
  const ds = makeSchemaOnlySource();
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: ['title', 'status', 'priority', 'area'],
          data: { provider: 'value', items: ROWS },
          grouping: { fields: grouping },
        } as unknown as ObjectGridSchema}
        dataSource={ds as unknown as DataSource}
      />
    </ActionProvider>,
  );
  return ds;
};

/** The group headers, top to bottom, as the grid paints them. */
const groupLabels = () =>
  Array.from(document.querySelectorAll('.group-label')).map((el) => el.textContent);

/** Wait until the grid painted `n` group headers AND the definition landed. */
async function settled(ds: { getObjectSchema: ReturnType<typeof vi.fn> }, n: number) {
  await vi.waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await vi.waitFor(() => expect(groupLabels()).toHaveLength(n));
}

afterEach(() => cleanup());

describe('grid groups follow a select field\'s declared option order (objectui#11809)', () => {
  describe('server-grouped (the grid owns its fetch)', () => {
    it('Group by Status reads Backlog → To Do → In Progress → In Review → Done, then undeclared, then empty', async () => {
      const ds = renderServerGrouped([{ field: 'status' }]);
      await settled(ds, 7);
      await vi.waitFor(() =>
        expect(groupLabels()).toEqual([...DECLARED_STATUS, 'legacy', '(empty)']),
      );
    });

    it('Group by Priority reads Low → Medium → High → Urgent', async () => {
      const ds = renderServerGrouped([{ field: 'priority' }]);
      await settled(ds, 4);
      await vi.waitFor(() => expect(groupLabels()).toEqual(['Low', 'Medium', 'High', 'Urgent']));
    });

    it('`order: desc` reverses the declared order; undeclared and empty still sit last', async () => {
      const ds = renderServerGrouped([{ field: 'status', order: 'desc' }]);
      await settled(ds, 7);
      await vi.waitFor(() =>
        expect(groupLabels()).toEqual([...DECLARED_STATUS].reverse().concat(['legacy', '(empty)'])),
      );
    });

    it('CONTROL — a text field keeps label order', async () => {
      const ds = renderServerGrouped([{ field: 'area' }]);
      await settled(ds, 3);
      await vi.waitFor(() => expect(groupLabels()).toEqual(['billing', 'console', 'platform']));
    });
  });

  describe('client-grouped (a host hands the rows in)', () => {
    it('Group by Status reads Backlog → To Do → In Progress → In Review → Done, then undeclared, then empty', async () => {
      const ds = renderClientGrouped([{ field: 'status' }]);
      await settled(ds, 7);
      await vi.waitFor(() =>
        expect(groupLabels()).toEqual([...DECLARED_STATUS, 'legacy', '(empty)']),
      );
    });

    it('`order: desc` reverses the declared order; undeclared and empty still sit last', async () => {
      const ds = renderClientGrouped([{ field: 'status', order: 'desc' }]);
      await settled(ds, 7);
      await vi.waitFor(() =>
        expect(groupLabels()).toEqual([...DECLARED_STATUS].reverse().concat(['legacy', '(empty)'])),
      );
    });

    it('CONTROL — a text field keeps label order', async () => {
      const ds = renderClientGrouped([{ field: 'area' }]);
      await settled(ds, 3);
      await vi.waitFor(() => expect(groupLabels()).toEqual(['billing', 'console', 'platform']));
    });
  });
});

describe('the hook\'s option order, below the grid (objectui#11809)', () => {
  const TAGS = [
    { value: 'api', label: 'API' },
    { value: 'billing', label: 'Billing' },
    { value: 'console', label: 'Console' },
  ];
  const ranks = new Map([['tags', buildCategoryRank(buildCategoryOrder(TAGS))!]]);
  const rows = [
    { id: 1, tags: ['console'] },
    { id: 2, tags: ['api', 'console'] },
    { id: 3, tags: ['api'] },
    { id: 4, tags: ['zeta'] },
    { id: 5, tags: [] },
    { id: 6, tags: ['api', 'billing'] },
  ];
  const config = { fields: [{ field: 'tags' }] };

  it('a multi-value key ranks as the tuple of its members; undeclared and empty sit last', () => {
    const { result } = renderHook(() =>
      useGroupedDataInOptionOrder(config, rows, undefined, undefined, undefined, ranks),
    );
    expect(result.current.groups.map((g) => g.keyValues.tags)).toEqual([
      ['api'],
      ['api', 'billing'],
      ['api', 'console'],
      ['console'],
      ['zeta'],
      [],
    ]);
  });

  it('CONTROL — the published hook, which carries no option order, keeps label order', () => {
    const statusRows = ROWS.map((r) => ({ ...r }));
    const { result } = renderHook(() => useGroupedData({ fields: [{ field: 'status' }] }, statusRows));
    expect(result.current.groups.map((g) => g.label)).toEqual([
      '(empty)',
      'backlog',
      'done',
      'in_progress',
      'in_review',
      'legacy',
      'todo',
    ]);
  });
});
