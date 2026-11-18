/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34901 — a grid never asks the data door for a field a DISABLED
 * package contributes.
 *
 * While the extending package is off the served definition leaves the field
 * out and names it under `_withheldFields`, and the door refuses it on every
 * axis. The double answers as the door does: a `$select`, `$orderby` or
 * `groupBy` name the served object does not declare is refused, naming it.
 * Enabling the package serves the field again and drops the marker.
 *
 * CONTROL: each shape with the package ON asks for the field exactly as
 * before, so the pins read the marker, not the field's name.
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

const OBJECT = 'crm_expense';
const WITHHELD = 'crm_project';

const BASE_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  category: { type: 'text', label: 'Category' },
};
const PROJECT = { type: 'text', label: 'Project' };

const ROWS: Array<Record<string, unknown>> = [
  { id: 'e1', name: 'Taxi', category: 'travel', crm_project: 'apollo' },
  { id: 'e2', name: 'Hotel', category: 'travel', crm_project: 'gemini' },
  { id: 'e3', name: 'Laptop', category: 'hardware', crm_project: 'apollo' },
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

/** The door and the served definition over one state: `packageOff` withholds `crm_project`. */
function makeDataSource(state: { packageOff: boolean }) {
  const servedFields = () => (state.packageOff ? BASE_FIELDS : { ...BASE_FIELDS, [WITHHELD]: PROJECT });
  const refuse = (name: unknown) => {
    throw new Error(`INVALID_FIELD: Unknown field '${String(name)}' on object '${OBJECT}'`);
  };
  const orderByNames = (orderBy: unknown): string[] => (typeof orderBy === 'string'
    ? orderBy.split(',').map((part) => part.trim().split(/\s+/)[0])
    : Array.isArray(orderBy) ? orderBy.map((s: any) => s?.field) : []);
  const ds = {
    queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[] }) => {
      const groupBy = query.groupBy ?? [];
      const unknown = groupBy.find((f) => !(f in servedFields()));
      if (unknown !== undefined) refuse(unknown);
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
      const unknownSelect = select.find((entry) => typeof entry !== 'string' || !(entry in servedFields()));
      if (unknownSelect !== undefined) refuse(unknownSelect);
      const unknownOrder = orderByNames(params.$orderby).find((f) => !(f in servedFields()));
      if (unknownOrder !== undefined) refuse(unknownOrder);
      const matching = ROWS.filter((r) => matches(r, params.$filter));
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? matching.length;
      const project = (row: Record<string, unknown>) => (select.length === 0
        ? row
        : Object.fromEntries(select.map((f) => [f as string, row[f as string]])));
      return { data: matching.slice(skip, skip + top).map(project), total: matching.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => (state.packageOff
      ? { name: OBJECT, fields: BASE_FIELDS, _withheldFields: { [WITHHELD]: { packageId: 'com.example.projects' } } }
      : { name: OBJECT, fields: { ...BASE_FIELDS, [WITHHELD]: PROJECT } })),
  };
  return ds;
}
type Ds = ReturnType<typeof makeDataSource>;

const gridNode = (ds: Ds, schemaExtra: Record<string, unknown>) => (
  <ActionProvider>
    <ObjectGrid
      schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name', WITHHELD], ...schemaExtra } as unknown as ObjectGridSchema}
      dataSource={ds as unknown as DataSource}
    />
  </ActionProvider>
);

const SORTED = { sort: [{ field: WITHHELD, order: 'asc' }, { field: 'name', order: 'desc' }] };
const BY_PROJECT_THEN_CATEGORY = { grouping: { fields: [{ field: WITHHELD, order: 'asc' }, { field: 'category', order: 'asc' }] } };

const everyRequest = (ds: Ds) => JSON.stringify([...ds.find.mock.calls, ...ds.queryGroupHeaders.mock.calls]);
const groupBys = (ds: Ds) => ds.queryGroupHeaders.mock.calls.map(([, q]) => (q as { groupBy?: string[] }).groupBy);
const groupRowErrors = () => [...document.querySelectorAll('[data-testid^="group-rows-error-"]')];

describe('a grid over a field a disabled package withholds (objectstack#34901)', () => {
  it('flat: no `$select` or `$orderby` names it, the column is not drawn, and the rows load', async () => {
    const ds = makeDataSource({ packageOff: true });
    render(gridNode(ds, SORTED));

    await vi.waitFor(() => expect(screen.getByText('Laptop')).toBeInTheDocument());
    expect(everyRequest(ds)).not.toContain(WITHHELD);
    const params = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    expect(params.$select).toEqual(['id', 'name']);
    expect(params.$orderby).toBe('name desc');
    expect(screen.queryByText('Project')).not.toBeInTheDocument();
    expect(screen.queryByText('Error loading grid')).not.toBeInTheDocument();
  });

  it('grouped: never sent as `groupBy`; groups by the key left, and no group row page selects it', async () => {
    const ds = makeDataSource({ packageOff: true });
    render(gridNode(ds, { columns: ['name'], ...BY_PROJECT_THEN_CATEGORY }));

    await vi.waitFor(() => expect(screen.getByText('Laptop')).toBeInTheDocument());
    expect(groupBys(ds).length).toBeGreaterThan(0);
    for (const groupBy of groupBys(ds)) expect(groupBy).toEqual(['category']);
    expect(everyRequest(ds)).not.toContain(WITHHELD);
    expect(groupRowErrors()).toHaveLength(0);
    expect(screen.queryByText('Error loading grid')).not.toBeInTheDocument();
  });

  it('CONTROL — with the package on, the column, the sort and the grouping key are all asked for', async () => {
    const ds = makeDataSource({ packageOff: false });
    render(gridNode(ds, { ...SORTED, ...BY_PROJECT_THEN_CATEGORY }));

    await vi.waitFor(() => expect(screen.getByText('Laptop')).toBeInTheDocument());
    expect(groupBys(ds)).toContainEqual([WITHHELD, 'category']);
    const lastRowPage = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    expect(lastRowPage.$select).toContain(WITHHELD);
    expect(lastRowPage.$orderby).toContain(WITHHELD);
    expect(screen.getAllByText('Project').length).toBeGreaterThan(0);
  });

  it('enabling the package brings the column and the grouping back in place, with no reload', async () => {
    const state = { packageOff: true };
    const ds = makeDataSource(state);
    const { rerender } = render(gridNode(ds, { ...BY_PROJECT_THEN_CATEGORY }));
    await vi.waitFor(() => expect(screen.getByText('Laptop')).toBeInTheDocument());
    expect(everyRequest(ds)).not.toContain(WITHHELD);

    state.packageOff = false;
    rerender(gridNode({ ...ds } as Ds, { ...BY_PROJECT_THEN_CATEGORY }));
    await vi.waitFor(() => expect(groupBys(ds)).toContainEqual([WITHHELD, 'category']));
    await vi.waitFor(() => expect(screen.getAllByText('Project').length).toBeGreaterThan(0));
    expect(groupRowErrors()).toHaveLength(0);
  });
});
