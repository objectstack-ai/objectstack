/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#32627 — a grouped grid asks the record-grained write verdict
 * once per operation for the rows it shows, not once per group.
 *
 * The grid asks the explain engine about the rows in `data`
 * (`useRecordCrudVerdicts`, one batched `POST /security/explain` per
 * operation), and a server-grouped grid pages each open group with a request
 * of its own. Measured on a hosted tenant: a list grouped into seven groups
 * sent fourteen explain requests, two per group, because `data` grew by one
 * group each time a group's page answered and every growth asked about the
 * new rows. The double below answers each group's page after a different
 * delay, the way a network does, so the growth is reproduced here.
 *
 * Pins: with every group answering at a different moment, the grid sends ONE
 * explain request per operation, carrying every row on screen. CONTROL: the
 * same rows, ungrouped, cost the same two requests, so the grouped count is
 * the list's own budget and not a smaller number reached by asking nothing.
 */
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { installExplainDouble, type ExplainDoubleCall } from './explainDouble';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'crm_forecast';
const PERIODS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];
const ROWS = PERIODS.flatMap((period, g) =>
  [0, 1].map((i) => ({ id: `f_${g}_${i}`, name: `Forecast ${g}.${i}`, period_label: period })),
);
const ALL_IDS = ROWS.map((row) => row.id).sort();

/** The equality subset the compiled group row query uses. */
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (!cond) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matches(row, c));
    if (value && typeof value === 'object' && '$eq' in (value as object)) return row[key] === (value as { $eq: unknown }).$eq;
    return row[key] === value;
  });
}

/** Each group's page answers after its own delay; the flat window answers at once. */
const makeDataSource = () => ({
  queryGroupHeaders: vi.fn(async () =>
    PERIODS.map((period) => ({ period_label: period, count: ROWS.filter((r) => r.period_label === period).length })),
  ),
  find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
    const filter = Array.isArray(params?.$filter) ? undefined : params?.$filter;
    const data = ROWS.filter((row) => matches(row, filter));
    const group = PERIODS.findIndex((period) => JSON.stringify(filter ?? null).includes(`"${period}"`));
    if (group >= 0) await new Promise((resolve) => setTimeout(resolve, 15 * (group + 1)));
    return { data, total: data.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({
    name: OBJECT,
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      period_label: { type: 'text', label: 'Period' },
    },
  })),
});

const renderGrid = (dataSource: unknown, schemaExtra: Record<string, unknown>) =>
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name', 'period_label'], pagination: { pageSize: 50 }, ...schemaExtra } as any}
        dataSource={dataSource as any}
        onEdit={() => {}}
        onDelete={() => {}}
      />
    </ActionProvider>,
  );

const explainAsks = (calls: ExplainDoubleCall[]) =>
  calls
    .filter((call) => call.url.endsWith('/api/v1/security/explain'))
    .map((call) => ({ operation: call.body?.operation, ids: [...((call.body?.recordIds as string[]) ?? [])].sort() }));

/** Every group answered, and long enough after the last one for any late ask to have gone out. */
async function settled(ds: ReturnType<typeof makeDataSource>, finds: number) {
  await vi.waitFor(() => expect(ds.find).toHaveBeenCalledTimes(finds));
  await new Promise((resolve) => setTimeout(resolve, 15 * PERIODS.length + 200));
}

let calls: ExplainDoubleCall[];
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  calls = installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a grouped grid asks the row write verdict once per operation (objectstack#32627)', () => {
  it('seven groups answering one after another cost one explain request per operation, covering every row', async () => {
    const ds = makeDataSource();
    renderGrid(ds, { grouping: { fields: [{ field: 'period_label' }] } });
    await settled(ds, PERIODS.length);

    expect(explainAsks(calls)).toEqual([
      { operation: 'update', ids: ALL_IDS },
      { operation: 'delete', ids: ALL_IDS },
    ]);
  });

  it('CONTROL: the same rows ungrouped cost the same two requests', async () => {
    const ds = makeDataSource();
    renderGrid(ds, {});
    await settled(ds, 1);

    expect(explainAsks(calls)).toEqual([
      { operation: 'update', ids: ALL_IDS },
      { operation: 'delete', ids: ALL_IDS },
    ]);
  });
});
