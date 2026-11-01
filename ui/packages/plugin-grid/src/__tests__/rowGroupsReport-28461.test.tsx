/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28461 — a GROUPED grid reports the rows it draws, group by group
 * (`onRowGroupsChange`), so a record pane opened from a row can step within
 * that row's group and name it.
 *
 * Pinned on a grid that groups on the server (`queryGroupHeaders`), the
 * console's case: only the grid holds those rows, each group's page fetched
 * by the grid itself. Each open group is reported in display order with its
 * heading and its drawn rows; a group the reader collapses draws no rows and
 * drops out of the report. Control: an ungrouped grid reports nothing.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid, type ObjectGridRowGroup } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'crm_contact';
const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  account: { type: 'text', label: 'Account' },
};

interface Row { id: string; name: string; account: string }

const ROWS: Row[] = [
  { id: 'c-1', name: 'John Smith', account: 'Acme Corporation' },
  { id: 'c-4', name: 'Hank Rearden', account: 'Globex' },
  { id: 'c-2', name: 'Jane Doe', account: 'Acme Corporation' },
  { id: 'c-5', name: 'Dagny Taggart', account: 'Globex' },
  { id: 'c-3', name: 'Ann Lee', account: 'Acme Corporation' },
];

/** Equality and `$and` only: the subset the compiled group queries use. */
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

/** A data source answering the header query and each group's row query. */
const makeServerDataSource = () => ({
  queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[] }) => {
    const groupBy = query.groupBy ?? [];
    const buckets = new Map<string, number>();
    for (const row of ROWS.filter((r) => matches(r as any, query.where))) {
      const key = JSON.stringify(groupBy.map((f) => (row as any)[f] ?? null));
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([key, count]) => {
      const values = JSON.parse(key) as unknown[];
      return { ...Object.fromEntries(groupBy.map((f, i) => [f, values[i]])), count };
    });
  }),
  find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
    const matching = ROWS.filter((r) => matches(r as any, params.$filter));
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

const renderGrid = (onRowGroupsChange: (groups: readonly ObjectGridRowGroup[]) => void, grouped = true) =>
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          columns: ['name'],
          ...(grouped ? { grouping: { fields: [{ field: 'account' }] } } : {}),
          pagination: { pageSize: 50 },
        } as any}
        dataSource={makeServerDataSource() as any}
        onRowGroupsChange={onRowGroupsChange}
      />
    </ActionProvider>,
  );

const summary = (groups: readonly ObjectGridRowGroup[] | undefined) =>
  (groups ?? []).map((group) => [group.label, group.rows.map((row) => row.id)]);

afterEach(() => cleanup());

describe('a grouped grid reports its open groups and their rows (objectstack#28461)', () => {
  it('reports each open group in display order, with its heading and the rows it draws', async () => {
    const report = vi.fn();
    renderGrid(report);
    await vi.waitFor(() =>
      expect(summary(report.mock.calls.at(-1)?.[0])).toEqual([
        ['Acme Corporation', ['c-1', 'c-2', 'c-3']],
        ['Globex', ['c-4', 'c-5']],
      ]),
    );
  });

  it('a group the reader collapses draws no rows and leaves the report', async () => {
    const report = vi.fn();
    const { container } = renderGrid(report);
    await vi.waitFor(() => expect(summary(report.mock.calls.at(-1)?.[0])).toHaveLength(2));
    const acme = report.mock.calls.at(-1)![0][0] as ObjectGridRowGroup;
    const band = [...container.querySelectorAll('[data-testid^="group-row-"]')]
      .find((el) => el.getAttribute('data-testid') === `group-row-${acme.key}`)!;
    fireEvent.click(band.querySelector('button')!);
    await vi.waitFor(() =>
      expect(summary(report.mock.calls.at(-1)?.[0])).toEqual([['Globex', ['c-4', 'c-5']]]),
    );
  });

  it('control: an ungrouped grid reports nothing', async () => {
    const report = vi.fn();
    const { findByText } = renderGrid(report, false);
    await findByText('John Smith');
    expect(report).not.toHaveBeenCalled();
  });
});
