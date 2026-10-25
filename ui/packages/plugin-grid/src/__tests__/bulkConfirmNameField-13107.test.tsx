/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13107 — the bulk confirm step names a record by the object's
 * declared `nameField` even when no column shows it, and never by another
 * text field.
 *
 * Measured on HotCRM's All Contacts: `crm_contact` declares
 * `nameField: 'full_name'` (a formula), the view's columns are `first_name`,
 * `last_name`, `title`, and the confirm step listed the contacts' job titles.
 * The step reads the GRID ROW, the row carried only the projected columns, and
 * the resolver's derive steps then picked `title`.
 *
 * Two halves, both pinned here on the real ObjectGrid + BulkActionDialog:
 *   - the grid's own `$select` asks for the declared `nameField` (a formula
 *     included), so the row carries it and the step lists it; the measured
 *     list groups by account, so a server-grouped grid's row pages are pinned
 *     too;
 *   - when the declared value still is not on the row, the step shows the
 *     resolver's `Record #<id>` floor, never a derived field's value.
 * Controls: an object whose `nameField` is a column (the lead list) and an
 * object that declares no `nameField` (the derive ladder) are unchanged.
 *
 * The data source honours `$select` the way a server does: a row carries the
 * selected keys only, so a field left out of the projection is really absent.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
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
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => {
  state.denied = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ADD_TO_CAMPAIGN = {
  name: 'add_to_campaign',
  label: 'Add to Campaign',
  type: 'api',
  target: '/api/v1/contacts/enroll',
};

/** HotCRM's contact shape: a formula `nameField` beside a job `title`. */
const CONTACT_FIELDS = {
  id: { type: 'text' },
  full_name: { type: 'formula', label: 'Full Name' },
  first_name: { type: 'text', label: 'First Name' },
  last_name: { type: 'text', label: 'Last Name' },
  title: { type: 'text', label: 'Title' },
};
const CONTACT_ROWS = [
  { id: 'c1', full_name: 'John Smith', first_name: 'John', last_name: 'Smith', title: 'VP of Engineering' },
  { id: 'c2', full_name: 'Marcus Reed', first_name: 'Marcus', last_name: 'Reed', title: 'Director of Commercial Systems' },
];
/** The All Contacts view: `full_name` is not a column. One array, one identity. */
const CONTACT_COLUMNS = [{ field: 'first_name' }, { field: 'last_name' }, { field: 'title' }];

function renderGrid(opts: {
  objectName: string;
  fields: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
  columns: unknown[];
  objectExtra?: Record<string, unknown>;
  /** Keys the server leaves off every row, selected or not. */
  withheld?: string[];
  /** A view grouping (the measured All Contacts list groups by account). */
  grouping?: Record<string, unknown>;
}) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true }),
  }));
  const dataSource = {
    // Present, so a grouped grid groups on the server and pages its own rows.
    queryGroupHeaders: vi.fn(async () => [{ last_name: null, count: opts.rows.length }]),
    find: vi.fn(async (_object: string, params: Record<string, any>) => {
      const select = params?.$select as string[] | undefined;
      const data = opts.rows.map((row) => {
        const keys = (select ?? Object.keys(row)).filter((k) => k in row && !(opts.withheld ?? []).includes(k));
        return Object.fromEntries(keys.map((k) => [k, row[k]]));
      });
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    getObjectSchema: async (name: string) => ({
      name,
      fields: opts.fields,
      actions: [ADD_TO_CAMPAIGN],
      ...opts.objectExtra,
    }),
  };
  render(
    <ActionProvider handlers={{}}>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: opts.objectName,
          columns: opts.columns,
          pagination: { pageSize: 50 },
          bulkActions: ['add_to_campaign'],
          ...(opts.grouping ? { grouping: opts.grouping } : {}),
        } as any}
        dataSource={dataSource as any}
      />
    </ActionProvider>,
  );
  return dataSource;
}

const GROUPED = { fields: [{ field: 'last_name', order: 'asc', collapsed: false }] };

/** The last `$select` the grid sent, sorted. */
const lastSelect = (ds: { find: { mock: { calls: any[][] } } }) =>
  [...((ds.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [])].sort();

/** Select every row, click the bulk button, and return the confirm step's list. */
async function openConfirm(firstCellText: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText(firstCellText)).toBeInTheDocument());
  await waitFor(() => expect(document.querySelector('thead [role="checkbox"]')).toBeTruthy());
  fireEvent.click(document.querySelector('thead [role="checkbox"]') as HTMLElement);
  fireEvent.click(await screen.findByTestId('bulk-action-add_to_campaign'));
  await screen.findByRole('button', { name: 'Run' });
  return within(screen.getByRole('dialog')).getByRole('list');
}

const listed = (list: HTMLElement) =>
  within(list).getAllByRole('listitem').map((li) => li.textContent?.replace(/^•\s*/, '').trim());

describe('bulk confirm step names a record by its declared nameField when no column shows it (objectui#13107)', () => {
  it('(a) the grid asks for a formula nameField that is not a column, and the step lists its values', async () => {
    const ds = renderGrid({
      objectName: 'crm_contact',
      fields: CONTACT_FIELDS,
      rows: CONTACT_ROWS,
      columns: CONTACT_COLUMNS,
      objectExtra: { nameField: 'full_name' },
    });
    const list = await openConfirm('VP of Engineering');
    expect(lastSelect(ds)).toEqual(['first_name', 'full_name', 'id', 'last_name', 'title']);
    expect(listed(list)).toEqual(['John Smith', 'Marcus Reed']);
    // Fetched, never drawn: no column header names it.
    expect(screen.queryByRole('columnheader', { name: /Full Name/ })).toBeNull();
  });

  it('(a) a server-grouped grid (the measured list groups) asks for it on every group row page', async () => {
    const ds = renderGrid({
      objectName: 'crm_contact',
      fields: CONTACT_FIELDS,
      rows: CONTACT_ROWS,
      columns: CONTACT_COLUMNS,
      objectExtra: { nameField: 'full_name' },
      grouping: GROUPED,
    });
    await waitFor(() => expect(ds.queryGroupHeaders).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('VP of Engineering')).toBeInTheDocument());
    const selects = ds.find.mock.calls.map(([, params]) => [...((params?.$select as string[] | undefined) ?? [])].sort());
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).toEqual(['first_name', 'full_name', 'id', 'last_name', 'title']);
    }
  });

  it('(b) a nameField value absent from the answer reads `Record #id`, never the job title', async () => {
    const ds = renderGrid({
      objectName: 'crm_contact',
      fields: CONTACT_FIELDS,
      rows: CONTACT_ROWS,
      columns: CONTACT_COLUMNS,
      objectExtra: { nameField: 'full_name' },
      withheld: ['full_name'],
    });
    const list = await openConfirm('VP of Engineering');
    expect(lastSelect(ds)).toContain('full_name');
    expect(listed(list)).toEqual(['Record #c1', 'Record #c2']);
  });

  it('(b) a nameField the principal may not read is not asked for, and the step reads `Record #id`', async () => {
    state.denied = ['full_name'];
    const ds = renderGrid({
      objectName: 'crm_contact',
      fields: CONTACT_FIELDS,
      rows: CONTACT_ROWS,
      columns: CONTACT_COLUMNS,
      objectExtra: { nameField: 'full_name' },
    });
    const list = await openConfirm('VP of Engineering');
    expect(lastSelect(ds)).toEqual(['first_name', 'id', 'last_name', 'title']);
    expect(listed(list)).toEqual(['Record #c1', 'Record #c2']);
  });

  it('CONTROL (c): a nameField that is a column (the lead list) is sent once and listed', async () => {
    const ds = renderGrid({
      objectName: 'crm_lead',
      fields: {
        id: { type: 'text' },
        display_title: { type: 'formula', label: 'Display Title' },
        company: { type: 'text', label: 'Company' },
      },
      rows: [{ id: 'l1', display_title: 'Mira Costa - Atlas Construction', company: 'Atlas Construction' }],
      columns: [{ field: 'display_title' }, { field: 'company' }],
      objectExtra: { nameField: 'display_title' },
    });
    const list = await openConfirm('Mira Costa - Atlas Construction');
    expect(lastSelect(ds)).toEqual(['company', 'display_title', 'id']);
    expect(listed(list)).toEqual(['Mira Costa - Atlas Construction']);
  });

  it('CONTROL (c): an object that declares no nameField keeps the derive ladder, and asks for nothing more', async () => {
    const ds = renderGrid({
      objectName: 'crm_contact',
      fields: CONTACT_FIELDS,
      rows: CONTACT_ROWS,
      columns: CONTACT_COLUMNS,
    });
    const list = await openConfirm('VP of Engineering');
    expect(lastSelect(ds)).toEqual(['first_name', 'id', 'last_name', 'title']);
    expect(listed(list)).toEqual(['VP of Engineering', 'Director of Commercial Systems']);
  });
});
