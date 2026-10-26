/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11105 — a server-grouped grid whose columns are OBJECTS asks for
 * field NAMES in `$select`, never the column objects themselves.
 *
 * `ListView` hands its effective column entries to the grid as `fields` AND
 * `columns` alike (its `baseProps` carry `fields: effectiveFields`, and the
 * grid branch adds `columns: effectiveFields`). A spec column is an object
 * (`{ field, width, … }`). The projection's `schemaFields` branch returned
 * those entries unmapped, so the objects reached `$select`, and the
 * ObjectStack adapter serialized them with `join(',')` as `[object Object]`.
 * Since the grid groups on the server (objectui#7189) every group's row page
 * carries that `$select`, and a 17.5 server answers an unknown select key with
 * 400 INVALID_FIELD, so every group showed the error instead of its rows.
 *
 * The double below answers the way that server does: a `$select` entry that
 * is not a declared field name is refused, naming it. The grid is handed the
 * node `ListView` hands it — the same object entries under `fields` and
 * `columns`.
 *
 * CONTROL: the same grid with the column NAMES as strings. It asks for the
 * same projection before and after the fix, so the instrument reads the shape
 * of `$select`, not something the fix happened to change elsewhere.
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

const OBJECT = 'crm_product';

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  category: { type: 'text', label: 'Category' },
  list_price: { type: 'number', label: 'List Price' },
};

const ROWS: Array<Record<string, unknown>> = [
  { id: 'p1', name: 'Router X1', category: 'hardware', list_price: 100 },
  { id: 'p2', name: 'Switch S2', category: 'hardware', list_price: 200 },
  { id: 'p3', name: 'Onsite Setup', category: 'service', list_price: 300 },
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
 * A data source that answers the group header query and pages rows, and —
 * like the 17.5 server — refuses a `$select` entry that is not a declared
 * field name. The adapter joins `$select` with `','`, so the refusal names the
 * entry as it would reach the wire.
 */
const makeDataSource = () => ({
  queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[] }) => {
    const groupBy = query.groupBy ?? [];
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
    const unknownKey = select.find((entry) => typeof entry !== 'string' || !(entry in OBJECT_FIELDS));
    if (unknownKey !== undefined) {
      throw new Error(`INVALID_FIELD: Unknown field '${String(unknownKey)}' on object '${OBJECT}'`);
    }
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

/** Spec columns as `ListView` forwards them: objects carrying more than a name. */
const OBJECT_COLUMNS = [
  { field: 'name', width: 240 },
  { field: 'list_price', width: 120 },
];

const renderGrid = (ds: ReturnType<typeof makeDataSource>, columns: unknown[], schemaExtra: Record<string, unknown> = {}) =>
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: OBJECT,
          // The node `ListView` builds: the same entries under both keys.
          // `ObjectGridSchema.fields` is declared `string[]`, and this is the
          // object-entry node the grid receives anyway, hence the cast.
          fields: columns,
          columns,
          ...schemaExtra,
        } as unknown as ObjectGridSchema}
        dataSource={ds as unknown as DataSource}
      />
    </ActionProvider>,
  );

const GROUPING = { grouping: { fields: [{ field: 'category', order: 'asc' }] } };

const groupRowErrors = () => [...document.querySelectorAll('[data-testid^="group-rows-error-"]')];

afterEach(() => cleanup());

describe('a server-grouped grid with object columns asks for field names (objectui#11105)', () => {
  it('every group page selects names only — id, the columns, and the grouping key', async () => {
    const ds = makeDataSource();
    renderGrid(ds, OBJECT_COLUMNS, GROUPING);

    // One row page per group, each answered with its rows.
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    for (const [, params] of ds.find.mock.calls) {
      expect(params.$select).toEqual(['id', 'name', 'list_price', 'category']);
    }
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(screen.getByText('Router X1')).toBeInTheDocument();
    expect(screen.getByText('Switch S2')).toBeInTheDocument();
    expect(groupRowErrors()).toHaveLength(0);
  });

  it('an entry with no field identity is left out of the projection, not sent', async () => {
    const ds = makeDataSource();
    renderGrid(ds, [...OBJECT_COLUMNS, { width: 80 }], GROUPING);

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    for (const [, params] of ds.find.mock.calls) {
      expect(params.$select).toEqual(['id', 'name', 'list_price', 'category']);
    }
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(groupRowErrors()).toHaveLength(0);
  });

  it('the ungrouped fetch the grid makes for itself selects names too', async () => {
    const ds = makeDataSource();
    renderGrid(ds, OBJECT_COLUMNS);

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    expect(ds.find.mock.calls[0][1].$select).toEqual(['id', 'name', 'list_price']);
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
  });

  // ── CONTROL: the string spelling asks for the same projection ────────────
  it('CONTROL — the same grid with string columns selects the same names', async () => {
    const ds = makeDataSource();
    renderGrid(ds, ['name', 'list_price'], GROUPING);

    await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    for (const [, params] of ds.find.mock.calls) {
      expect(params.$select).toEqual(['id', 'name', 'list_price', 'category']);
    }
    await vi.waitFor(() => expect(screen.getByText('Onsite Setup')).toBeInTheDocument());
    expect(groupRowErrors()).toHaveLength(0);
  });
});
