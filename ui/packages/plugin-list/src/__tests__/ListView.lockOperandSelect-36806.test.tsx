/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36806 (REWORK S1) — a list projects the field locks' operands of
 * every field a person edits in place from it.
 *
 * Each surface judges `readonlyWhen` / `uiReadonlyWhen` over the ROW
 * (`fieldReadOnlyByHand`): the grid cell, the kanban card drag (it writes the
 * lane field) and the calendar event drag (it writes the start / end fields).
 * `ListView` builds the `$select` those rows arrive through, and a list that
 * did not show the predicate's operand fetched rows without it: CEL faulted
 * `No such key`, and the hand lock (which fails closed) held the field locked
 * on every row. The harvest sits beside the deadline arm
 * (`ListView.deadlineSettledSelect-11815.test.tsx`).
 *
 * What is pinned: the operand is in `$select` for a shown grid column, the
 * kanban lane field and the calendar date fields; CONTROL: an operand the
 * viewer may not read is not requested (the FLS gate inside `addSpeculative`).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

const { holder, makePerms } = vi.hoisted(() => {
  const makePerms = (isLoaded: boolean, denied: string[]) => ({
    isLoaded,
    checkField: (_object: string, field: string, action: string) =>
      action === 'read' ? !denied.includes(field) : true,
    check: () => ({ allowed: true }),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    userId: null,
    systemPermissions: undefined,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  });
  return { holder: { current: makePerms(true, []) }, makePerms };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => holder.current as any };
});

import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';

const OBJECT = 'hlk_order';

const objectDef = {
  name: OBJECT,
  label: 'Order',
  fields: {
    id: { name: 'id', type: 'text' },
    title: { name: 'title', type: 'text', label: 'Title' },
    status: { name: 'status', type: 'text', label: 'Status' },
    approved: { name: 'approved', type: 'boolean', label: 'Approved' },
    stage: { name: 'stage', type: 'select', label: 'Stage', options: [{ value: 'a', label: 'A' }], uiReadonlyWhen: "record.status != 'draft'" },
    amount: { name: 'amount', type: 'number', label: 'Amount', readonlyWhen: 'record.approved == true' },
    starts_on: { name: 'starts_on', type: 'date', label: 'Starts on', uiReadonlyWhen: "record.status == 'closed'" },
    ends_on: { name: 'ends_on', type: 'date', label: 'Ends on', uiReadonlyWhen: 'record.approved == true' },
    secret_flag: { name: 'secret_flag', type: 'boolean', label: 'Secret flag' },
    note: { name: 'note', type: 'text', label: 'Note', uiReadonlyWhen: 'record.secret_flag == true' },
  },
};

const makeDataSource = (def: Record<string, unknown> = objectDef) =>
  ({
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? def : null)),
  }) as any;

async function selectFor(extra: Record<string, unknown>, def?: Record<string, unknown>): Promise<string[]> {
  const dataSource = makeDataSource(def);
  const schema: any = { type: 'list-view', objectName: OBJECT, viewType: 'grid', userActions: { editInline: false }, ...extra };
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  return [...((dataSource.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [])].sort();
}

const STUBBED = ['object-grid', 'object-kanban', 'object-calendar'];
const prev: Record<string, unknown> = {};
beforeAll(() => {
  for (const type of STUBBED) {
    prev[type] = ComponentRegistry.get(type);
    ComponentRegistry.register(type, () => <div data-testid={`${type}-stub`} />, { namespace: 'stub' } as never);
  }
});
afterAll(() => {
  for (const type of STUBBED) {
    if (prev[type]) ComponentRegistry.register(type, prev[type] as never);
    else ComponentRegistry.unregister(type);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  holder.current = makePerms(true, ['secret_flag']);
});
afterEach(() => cleanup());

describe('ListView — the field locks\' operands are projected (objectstack#36806)', () => {
  it('a shown grid column: the uiReadonlyWhen and readonlyWhen operands', async () => {
    expect(await selectFor({ columns: ['title', 'stage'] })).toEqual(['id', 'stage', 'status', 'title']);
    expect(await selectFor({ columns: ['title', 'amount'] })).toEqual(['amount', 'approved', 'id', 'title']);
  });

  it('the kanban lane field\'s operand, though no column shows it', async () => {
    const select = await selectFor({ viewType: 'kanban', columns: ['title'], kanban: { groupByField: 'stage' } });
    expect(select).toContain('status');
    expect(select).toContain('stage');
  });

  it('objectstack#37448 — the lane field the board detects when the block names none', async () => {
    // No `groupByField`: the board takes the object's declared lifecycle
    // (`stageField`, ADR-0085), so a card drag writes `stage` and its
    // predicate's operand rides the projection as the named lane field's does.
    const select = await selectFor(
      { viewType: 'kanban', columns: ['title'], kanban: {} },
      { ...objectDef, stageField: 'stage' },
    );
    expect(select).toContain('status');
  });

  it('the calendar start and end fields\' operands', async () => {
    const select = await selectFor({
      viewType: 'calendar',
      columns: ['title'],
      calendar: { startDateField: 'starts_on', endDateField: 'ends_on' },
    });
    expect(select).toEqual(expect.arrayContaining(['approved', 'ends_on', 'starts_on', 'status']));
  });

  it('CONTROL: an operand the viewer may not read is not requested', async () => {
    expect(await selectFor({ columns: ['title', 'note'] })).toEqual(['id', 'note', 'title']);
  });

  it('CONTROL: a column with no lock predicate pulls nothing in', async () => {
    expect(await selectFor({ columns: ['title', 'status'] })).toEqual(['id', 'status', 'title']);
  });
});
