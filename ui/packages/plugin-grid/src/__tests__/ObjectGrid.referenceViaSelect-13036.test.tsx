/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13036 — a grid that fetches for itself asks for a `referenceVia`
 * pointer column's type half.
 *
 * A pointer column (objectui#12608, `ObjectGrid.recordPointerCell-12608.test.tsx`)
 * resolves its record from the ROW: `resolveRecordPointer` reads the sibling
 * the field's `referenceVia` names and answers null when it is absent, and the
 * column then draws the stored id. `getSelectFields` unioned the columns and
 * its other harvests with no arm for that sibling, so a grid whose columns
 * show `record_id` but not `object_name` fetched rows without `object_name`
 * and drew the raw id. This is the projection a standalone `object-grid` and a
 * grouped grid that owns its fetch (`gridOwnsGroupedFetch` in `ListView`) send;
 * `ListView`'s own fetch is pinned in plugin-list's
 * `ListView.referenceViaSelect-13036.test.tsx`.
 *
 * What is pinned:
 *   - a non-column sibling is in `$select`, and the record is drawn — on the
 *     grid's own fetch and on every group row page of a server-grouped grid;
 *   - control: a row whose sibling is genuinely blank keeps the stored text;
 *   - a sibling the principal may not read is not requested, and the row keeps
 *     the stored text; a pointer column the principal may not read harvests
 *     nothing; a sibling the object does not declare is not sent;
 *   - a sibling that is a column is sent once.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
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
import { ActionProvider, RelatedRecordActionsProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'sys_approval_request';

const REQUEST_FIELDS = {
  id: { name: 'id', type: 'text', label: 'Id' },
  process_name: { name: 'process_name', type: 'text', label: 'Source' },
  object_name: { name: 'object_name', type: 'text', label: 'Object' },
  record_id: { name: 'record_id', type: 'text', label: 'Record ID', referenceVia: 'object_name' },
  // A pointer whose sibling the object does not declare.
  loose_id: { name: 'loose_id', type: 'text', label: 'Loose ID', referenceVia: 'no_such_field' },
};

const OPPORTUNITY_DEF = {
  name: 'crm_opportunity',
  label: 'Opportunity',
  icon: 'briefcase',
  nameField: 'name',
  fields: { name: { name: 'name', type: 'text', label: 'Name' } },
};

const OPPORTUNITIES = [{ id: 'opp-1', name: 'Acme renewal' }];

/**
 * Answers the group header query and pages rows, and honours `$select` the way
 * a server does: a row carries the selected keys only. So a sibling left out of
 * the projection is really absent from the row the grid draws.
 */
const makeDataSource = (rows: Array<Record<string, unknown>>) => ({
  queryGroupHeaders: vi.fn(async () => [{ process_name: 'flow:approval', count: rows.length }]),
  find: vi.fn(async (object: string, params: Record<string, any>) => {
    if (object === 'crm_opportunity') {
      const wanted: string[] = params?.$filter?.id?.$in ?? [];
      return { data: OPPORTUNITIES.filter((r) => wanted.includes(r.id)) };
    }
    const select = params?.$select as string[] | undefined;
    const data = rows.map((row) =>
      select ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]])) : { ...row },
    );
    return { data, total: data.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => {
    if (name === OBJECT) return { name: OBJECT, label: 'Approval Request', fields: REQUEST_FIELDS };
    if (name === 'crm_opportunity') return OPPORTUNITY_DEF;
    throw new Error('unknown object');
  }),
});

type Ds = ReturnType<typeof makeDataSource>;

const ROW = { id: 'req-1', process_name: 'flow:approval', object_name: 'crm_opportunity', record_id: 'opp-1', loose_id: 'x-1' };

/** One array per column set: the fetch effect names `columns` by identity. */
const ID_HALF_ONLY = ['process_name', 'record_id'];
const BOTH_HALVES = ['process_name', 'object_name', 'record_id'];
const LOOSE_POINTER = ['process_name', 'loose_id'];
const GROUPED = { fields: [{ field: 'process_name', order: 'asc', collapsed: false }] };

const host = {
  resolve: () => ({}),
  recordHref: (objectName: string, recordId: string | number) =>
    `/apps/crm/${objectName}/record/${encodeURIComponent(String(recordId))}`,
  openRecord: vi.fn(),
} as any;

const renderGrid = (ds: Ds, extra: Record<string, unknown>) =>
  render(
    <ActionProvider>
      <RelatedRecordActionsProvider value={host}>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, ...extra } as unknown as ObjectGridSchema}
          dataSource={ds as unknown as DataSource}
        />
      </RelatedRecordActionsProvider>
    </ActionProvider>,
  );

/** Every `$select` the grid sent for its OWN object's rows. */
const rowSelects = (ds: Ds) =>
  ds.find.mock.calls
    .filter(([object]) => object === OBJECT)
    .map(([, params]) => [...((params?.$select as string[] | undefined) ?? [])].sort());

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = [];
});
afterEach(() => cleanup());

describe('ObjectGrid — a `referenceVia` pointer column asks for its type half (objectui#13036)', () => {
  it('asks for the sibling when no column shows it, and draws the record', async () => {
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: ID_HALF_ONLY });
    expect(await screen.findByRole('link', { name: 'Acme renewal' })).toHaveAttribute(
      'href',
      '/apps/crm/crm_opportunity/record/opp-1',
    );
    expect(rowSelects(ds).at(-1)).toEqual(['id', 'object_name', 'process_name', 'record_id']);
    expect(screen.queryByText('opp-1')).toBeNull();
  });

  it('a server-grouped grid asks for it on every group row page, and draws the record', async () => {
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: ID_HALF_ONLY, grouping: GROUPED });
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalled());
    expect(await screen.findByRole('link', { name: 'Acme renewal' })).toBeInTheDocument();
    const selects = rowSelects(ds);
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).toEqual(['id', 'object_name', 'process_name', 'record_id']);
    }
  });

  it('control: a row whose sibling is genuinely blank keeps the stored text', async () => {
    const ds = makeDataSource([{ ...ROW, object_name: '', record_id: 'loose-id' }]);
    renderGrid(ds, { columns: ID_HALF_ONLY });
    await waitFor(() => expect(screen.getByText('loose-id')).toBeInTheDocument());
    expect(rowSelects(ds).at(-1)).toContain('object_name');
    expect(document.querySelector('[data-record-pointer]')).toBeNull();
  });

  it('does not request a sibling the principal may not read; the row keeps the stored text', async () => {
    state.denied = ['object_name'];
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: ID_HALF_ONLY });
    await waitFor(() => expect(screen.getByText('opp-1')).toBeInTheDocument());
    expect(rowSelects(ds).at(-1)).toEqual(['id', 'process_name', 'record_id']);
    expect(document.querySelector('[data-record-pointer]')).toBeNull();
  });

  it('a pointer column the principal may not read harvests nothing', async () => {
    state.denied = ['record_id'];
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: ID_HALF_ONLY });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(rowSelects(ds).at(-1)).toEqual(['id', 'process_name']));
  });

  it('does not send a sibling the object does not declare', async () => {
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: LOOSE_POINTER });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(rowSelects(ds).at(-1)).toEqual(['id', 'loose_id', 'process_name']));
  });

  it('control: a sibling that is a column is sent once', async () => {
    const ds = makeDataSource([ROW]);
    renderGrid(ds, { columns: BOTH_HALVES });
    expect(await screen.findByRole('link', { name: 'Acme renewal' })).toBeInTheDocument();
    expect(rowSelects(ds).at(-1)).toEqual(['id', 'object_name', 'process_name', 'record_id']);
  });
});
