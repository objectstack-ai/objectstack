/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36806 (REWORK S1) — a grid reads its lock predicates' operands.
 *
 * The cell gate judges `readonlyWhen` / `uiReadonlyWhen` over the ROW
 * (`cellReadOnlyKind` → `fieldReadOnlyByHand`), and the row is the view's
 * projection. A grid showing `subject` but not the `status` its hand lock
 * reads fetched rows without `status`, so CEL faulted `No such key` on every
 * row. The fetch now unions the shown columns' lock operands into `$select`,
 * through the gates every other harvested field takes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

/** Stable stub identity: `ObjectGrid` carries `perms` in memo dep arrays. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { denied: string[] } = { denied: [] };
  return {
    state,
    permsStub: {
      isLoaded: true,
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? !state.denied.includes(field) : true,
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
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'hlk_order';

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject', uiReadonlyWhen: "record.status != 'draft'" },
  amount: { type: 'number', label: 'Amount', readonlyWhen: "record.stage == 'paid'" },
  note: { type: 'text', label: 'Note', uiReadonlyWhen: 'record.secret_flag == true' },
  status: { type: 'text', label: 'Status' },
  stage: { type: 'text', label: 'Stage' },
  secret_flag: { type: 'boolean', label: 'Secret flag' },
};

const ROWS: Array<Record<string, unknown>> = [
  { id: 'o1', subject: 'Draft order', amount: 1, note: 'n', status: 'draft', stage: 'open', secret_flag: false },
];

const makeDataSource = () => ({
  find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
    const select = params.$select as string[] | undefined;
    const data = ROWS.map((row) =>
      select ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]])) : { ...row },
    );
    return { data, total: data.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
});

type Ds = ReturnType<typeof makeDataSource>;

const renderGrid = (ds: Ds, columns: string[]) =>
  render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: OBJECT, columns } as unknown as ObjectGridSchema}
        dataSource={ds as unknown as DataSource}
      />
    </ActionProvider>,
  );

const lastSelect = (ds: Ds) => [...((ds.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [])].sort();

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = ['secret_flag'];
});
afterEach(() => cleanup());

describe('ObjectGrid — a shown column\'s lock operands are projected (objectstack#36806)', () => {
  it('asks for the operand of a shown column\'s uiReadonlyWhen', async () => {
    const ds = makeDataSource();
    renderGrid(ds, ['subject']);
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'status', 'subject']);
  });

  it('asks for the operand of a shown column\'s readonlyWhen too', async () => {
    const ds = makeDataSource();
    renderGrid(ds, ['amount']);
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['amount', 'id', 'stage']);
  });

  it('does not request an operand the principal may not read (the cell then stays locked)', async () => {
    const ds = makeDataSource();
    renderGrid(ds, ['note']);
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'note']);
  });

  it('control: a column with no lock predicate harvests nothing', async () => {
    const ds = makeDataSource();
    renderGrid(ds, ['status']);
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'status']);
  });
});

describe('ObjectGrid — the object-level hand lock\'s operands are projected (objectstack#37402)', () => {
  it('asks for the operand of the object\'s uiReadonlyWhen for a column that inherits it', async () => {
    const ds = makeDataSource();
    ds.getObjectSchema.mockImplementation(async () => ({
      name: OBJECT,
      uiReadonlyWhen: "record.stage == 'closed'",
      fields: OBJECT_FIELDS,
    }));
    renderGrid(ds, ['status']);
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'stage', 'status']);
  });

  it('control: a column whose field declares its own hand lock does not inherit the object operand', async () => {
    const ds = makeDataSource();
    ds.getObjectSchema.mockImplementation(async () => ({
      name: OBJECT,
      uiReadonlyWhen: "record.stage == 'closed'",
      fields: OBJECT_FIELDS,
    }));
    renderGrid(ds, ['subject']);
    await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(lastSelect(ds)).toEqual(['id', 'status', 'subject']);
  });
});
