/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34898 — under the console's draft preview a grouped grid never
 * asks the data door for a field only the draft declares.
 *
 * Under `?preview=draft` the host's data source answers `getObjectSchema` with
 * the published definition plus each field only the draft adds, marked
 * `_draftOnly`. The door still judges every `$select` and `groupBy` name
 * against the PUBLISHED object and refuses one it does not know. Measured on
 * origin/main with this double: a draft-only COLUMN went into every group's
 * row-page `$select` (`['id','name','priority','category']`, every group
 * INVALID_FIELD), and a GROUPING on a draft-only field went out as
 * `groupBy: ['priority']` (the whole grid drew "Error loading grid").
 *
 * The double answers the way that door does: a `$select` or `groupBy` name the
 * published object does not declare is refused, naming it. Publishing moves
 * the field into the published set and drops the marker.
 *
 * CONTROL: each shape with the same field PUBLISHED (no marker) asks for it
 * exactly as before, so the pins read the marker, not the field's name.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

beforeAll(() => {
  registerAllFields();
});

afterEach(() => cleanup());

const OBJECT = 'crm_product';

const BASE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  category: { type: 'text', label: 'Category' },
};
const PRIORITY = { type: 'text', label: 'Priority' };

const ROWS: Array<Record<string, unknown>> = [
  { id: 'p1', name: 'Router X1', category: 'hardware', priority: 'high' },
  { id: 'p2', name: 'Switch S2', category: 'hardware', priority: 'low' },
  { id: 'p3', name: 'Onsite Setup', category: 'service', priority: 'high' },
];

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
 * The door and the preview definition over one state. `published: false` is
 * the draft preview (the definition marks `priority`, the door does not know
 * it); `true` is after Publish (declared, unmarked, served).
 */
function makeDataSource(state: { published: boolean }) {
  const publishedFields = () => (state.published ? { ...BASE_FIELDS, priority: PRIORITY } : BASE_FIELDS);
  const ds = {
    queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[] }) => {
      const groupBy = query.groupBy ?? [];
      const unknown = groupBy.find((f) => !(f in publishedFields()));
      if (unknown !== undefined) {
        throw new Error(`INVALID_FIELD: Unknown groupBy field '${unknown}' on object '${OBJECT}'`);
      }
      const buckets = new Map<string, number>();
      for (const row of ROWS.filter((r) => matches(r, query.where))) {
        const key = JSON.stringify(groupBy.map((f) => row[f] ?? null));
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      return [...buckets.entries()].map(([key, count]) => {
        const values = JSON.parse(key) as unknown[];
        return { ...Object.fromEntries(groupBy.map((f, i) => [f, values[i]])), count };
      });
    }),
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      const select = (params.$select as unknown[] | undefined) ?? [];
      const unknown = select.find((entry) => typeof entry !== 'string' || !(entry in publishedFields()));
      if (unknown !== undefined) {
        throw new Error(`INVALID_FIELD: Unknown field '${String(unknown)}' on object '${OBJECT}'`);
      }
      const matching = ROWS.filter((r) => matches(r, params.$filter));
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? matching.length;
      // Projected as the door projects: only the selected keys come back.
      const project = (row: Record<string, unknown>) => (select.length === 0
        ? row
        : Object.fromEntries(select.map((f) => [f as string, row[f as string]])));
      return { data: matching.slice(skip, skip + top).map(project), total: matching.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: OBJECT,
      fields: state.published
        ? { ...BASE_FIELDS, priority: PRIORITY }
        : { ...BASE_FIELDS, priority: { ...PRIORITY, _draftOnly: true } },
    })),
  };
  return ds;
}
type Ds = ReturnType<typeof makeDataSource>;

const gridNode = (ds: Ds, schemaExtra: Record<string, unknown>) => (
  <ActionProvider>
    <ObjectGrid
      schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name', 'priority'], ...schemaExtra } as unknown as ObjectGridSchema}
      dataSource={ds as unknown as DataSource}
    />
  </ActionProvider>
);

const BY_CATEGORY = { grouping: { fields: [{ field: 'category', order: 'asc' }] } };
const BY_PRIORITY = { grouping: { fields: [{ field: 'priority', order: 'asc' }] } };
const BY_PRIORITY_THEN_CATEGORY = { grouping: { fields: [{ field: 'priority', order: 'asc' }, { field: 'category', order: 'asc' }] } };

const groupRowErrors = () => [...document.querySelectorAll('[data-testid^="group-rows-error-"]')];
const draftNote = () => screen.queryByTestId('grid-grouping-draft-only');
const groupBys = (ds: Ds) => ds.queryGroupHeaders.mock.calls.map(([, q]) => (q as { groupBy?: string[] }).groupBy);

describe('a draft-only COLUMN is never projected (objectstack#34898)', () => {
  it('grouped by a published field: no group row page selects it, and the column still draws', async () => {
    const ds = makeDataSource({ published: false });
    render(gridNode(ds, BY_CATEGORY));

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    for (const [, params] of ds.find.mock.calls) {
      expect(params.$select).toEqual(['id', 'name', 'category']);
    }
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(groupRowErrors()).toHaveLength(0);
    expect(groupBys(ds)).toEqual([['category']]);
    // Drawn, empty, under its draft label; no grouping was dropped, so no note.
    expect(screen.getAllByText('Priority').length).toBeGreaterThan(0);
    expect(screen.queryByText('high')).not.toBeInTheDocument();
    expect(draftNote()).not.toBeInTheDocument();
  });

  it('ungrouped: the flat fetch does not select it either', async () => {
    const ds = makeDataSource({ published: false });
    render(gridNode(ds, {}));

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    expect(ds.find.mock.calls[0][1].$select).toEqual(['id', 'name']);
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
  });

  it('CONTROL — the same column PUBLISHED is selected on every group row page', async () => {
    const ds = makeDataSource({ published: true });
    render(gridNode(ds, BY_CATEGORY));

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    for (const [, params] of ds.find.mock.calls) {
      expect(params.$select).toEqual(['id', 'name', 'priority', 'category']);
    }
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(screen.getAllByText('high').length).toBeGreaterThan(0);
    expect(groupRowErrors()).toHaveLength(0);
  });
});

describe('a grouping on a draft-only field degrades visibly (objectstack#34898)', () => {
  it('the only grouping key: never sent as groupBy, the grid draws flat and names the field', async () => {
    const ds = makeDataSource({ published: false });
    render(gridNode(ds, { columns: ['name'], ...BY_PRIORITY }));

    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
    expect(screen.queryByText('Error loading grid')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="group-row-"]')).toHaveLength(0);
    for (const [, params] of ds.find.mock.calls) {
      expect(params.$select).not.toContain('priority');
    }
    expect(draftNote()).toBeInTheDocument();
    expect(draftNote()).toHaveTextContent('Priority');
  });

  it('beside a published key: groups by the published key alone, and names the dropped one', async () => {
    const ds = makeDataSource({ published: false });
    render(gridNode(ds, { columns: ['name'], ...BY_PRIORITY_THEN_CATEGORY }));

    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(groupBys(ds).length).toBeGreaterThan(0);
    for (const groupBy of groupBys(ds)) expect(groupBy).toEqual(['category']);
    expect(screen.queryByText('Error loading grid')).not.toBeInTheDocument();
    expect(groupRowErrors()).toHaveLength(0);
    expect(draftNote()).toHaveTextContent('Priority');
  });

  it('CONTROL — the same grouping PUBLISHED is sent as groupBy and draws no note', async () => {
    const ds = makeDataSource({ published: true });
    render(gridNode(ds, { columns: ['name'], ...BY_PRIORITY }));

    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(groupBys(ds)).toEqual([['priority']]);
    expect(draftNote()).not.toBeInTheDocument();
  });

  it('after Publish the grouping and the column work in place, with no reload', async () => {
    const state = { published: false };
    const ds = makeDataSource(state);
    const { rerender } = render(gridNode(ds, BY_PRIORITY));
    await vi.waitFor(() => expect(draftNote()).toBeInTheDocument());
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();

    // Publish: the door now serves `priority` and the definition drops the
    // marker. The host hands the same grid a data source answering for the
    // published state (a new identity, as leaving the preview does); the grid
    // is re-rendered, never re-mounted, and re-reads the definition.
    state.published = true;
    const published = { ...ds };
    rerender(gridNode(published as Ds, BY_PRIORITY));

    await vi.waitFor(() => expect(draftNote()).not.toBeInTheDocument());
    await vi.waitFor(() => expect(groupBys(ds)).toContainEqual(['priority']));
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    const lastRowPage = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    expect(lastRowPage.$select).toContain('priority');
    expect(groupRowErrors()).toHaveLength(0);
    expect(screen.queryByText('Error loading grid')).not.toBeInTheDocument();
  });
});
