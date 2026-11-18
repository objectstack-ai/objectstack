/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#13333 — the related list's row Delete asks a sentence that names
 * the row by its title, the ONE ADR-0079 resolver (`getRecordDisplayName`)
 * over the list's object schema, instead of "Are you sure you want to delete
 * this record?". A grant row (a user's permission-set assignment) declares a
 * `nameField` formula that names the grant and its user, so the sentence says
 * which grant goes and from whom.
 *
 * The data-table is captured rather than rendered (as
 * `RelatedList.rowactions.test.tsx` does): the case drives the row Delete the
 * list hands the table, then reads the in-app AlertDialog the list draws.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig } from '@object-ui/types';
import { RelatedList } from '../RelatedList';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const h = vi.hoisted(() => ({ schema: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.schema = props.schema;
      return null;
    },
  };
});

const nativeConfirm = vi.fn(() => true);
beforeEach(() => {
  h.schema = null;
  nativeConfirm.mockClear();
  vi.stubGlobal('confirm', nativeConfirm);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(nativeConfirm).not.toHaveBeenCalled();
});

/** The grant junction object as its schema declares it: a `nameField` formula. */
const GRANT_SCHEMA = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  nameField: 'display_title',
  fields: {
    display_title: { name: 'display_title', type: 'formula', label: 'Title' },
    permission_set: { name: 'permission_set', type: 'text', label: 'Permission Set' },
  },
};

function grantDataSource() {
  return {
    getObjectSchema: vi.fn(async () => GRANT_SCHEMA),
    find: vi.fn(async () => ({ data: [] })),
  } as any;
}

async function openDelete(props: Partial<React.ComponentProps<typeof RelatedList>>, row: any) {
  render(
    <RelatedList
      title="Permission Sets"
      type="table"
      columns={[{ accessorKey: 'permission_set', header: 'Permission Set' }]}
      {...(props as any)}
    />,
  );
  await waitFor(() => expect(typeof h.schema?.onRowDelete).toBe('function'));
  act(() => {
    h.schema.onRowDelete(row);
  });
  return await screen.findByRole('alertdialog');
}

describe('RelatedList — the row delete confirm names the row (objectui#13333)', () => {
  it('a grant row is named by its declared title, which names the grant and its user', async () => {
    const row = { id: 'g1', display_title: 'Ada Lovelace → sales_manager', permission_set: 'sales_manager' };
    const onRowDelete = vi.fn();
    const dialog = await openDelete(
      { api: 'sys_user_permission_set', objectName: 'sys_user_permission_set', dataSource: grantDataSource(), data: [row], onRowDelete },
      row,
    );
    await waitFor(() =>
      expect(dialog.textContent).toContain('Are you sure you want to delete "Ada Lovelace → sales_manager"?'),
    );
    expect(dialog.textContent).not.toContain('delete this record');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onRowDelete).toHaveBeenCalledWith(row));
  });

  it('with no object schema, the resolver still reads the row`s own name', async () => {
    const row = { id: 'c1', name: 'Alice' };
    const dialog = await openDelete(
      { api: 'contact', objectName: 'contact', data: [row], onRowDelete: vi.fn() },
      row,
    );
    expect(dialog.textContent).toContain('Are you sure you want to delete "Alice"?');
  });

  it('CONTROL: Cancel deletes nothing', async () => {
    const row = { id: 'c1', name: 'Alice' };
    const onRowDelete = vi.fn();
    const dialog = await openDelete({ api: 'contact', objectName: 'contact', data: [row], onRowDelete }, row);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onRowDelete).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#34788 — the confirm names a FETCHED row, and the list's `$select`
 * projection decides which keys that row carries. A child whose declared
 * `nameField` no authored column shows must still have it requested, through
 * the projection's own gates (declared, readable), or the sentence reads the
 * `Record #<id>` floor. The backend below honours `$select` the way the
 * ObjectStack data API does: only the asked keys come back.
 */
describe('RelatedList — the row delete confirm names a fetched row by its declared nameField (objectstack#34788)', () => {
  const CONTACT = 'crm_contact';
  const CONTACT_SCHEMA = {
    name: CONTACT,
    nameField: 'full_name',
    fields: {
      first_name: { name: 'first_name', type: 'text', label: 'First Name' },
      last_name: { name: 'last_name', type: 'text', label: 'Last Name' },
      full_name: { name: 'full_name', type: 'formula', returnType: 'text', label: 'Full Name' },
      email: { name: 'email', type: 'email', label: 'Email' },
      account: { name: 'account', type: 'lookup', reference: 'crm_account', label: 'Account' },
    },
  };
  const STORED = {
    id: 'c1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    full_name: 'Ada Lovelace',
    email: 'ada@acme.example',
    account: 'acc_1',
  };

  function projectingDataSource() {
    return {
      getObjectSchema: vi.fn(async () => CONTACT_SCHEMA),
      find: vi.fn(async (_api: string, params: any) => {
        const select: string[] | undefined = params?.$select;
        const row = select
          ? Object.fromEntries(Object.entries(STORED).filter(([k]) => select.includes(k)))
          : { ...STORED };
        return { data: [row], total: 1 };
      }),
    } as any;
  }

  const denying = (...fields: string[]): ObjectPermissionConfig[] => [
    {
      object: CONTACT,
      roles: { staff: { actions: ['read', 'delete'], fieldPermissions: fields.map((field) => ({ field, read: false })) } },
    },
  ];

  /** Render the list, wait for the table to hold the fetched row, then open Delete on THAT row. */
  async function openDeleteOnFetchedRow(ds: any, columns: string[], permissions: ObjectPermissionConfig[]) {
    render(
      <PermissionProvider roles={[{ name: 'staff', label: 'Staff' }]} permissions={permissions} userRoles={['staff']}>
        <RelatedList
          title="Contacts"
          type="table"
          api={CONTACT}
          objectName={CONTACT}
          referenceField="account"
          parentId="acc_1"
          dataSource={ds}
          columns={columns}
          onRowDelete={vi.fn()}
        />
      </PermissionProvider>,
    );
    await waitFor(() => expect(h.schema?.data?.length ?? 0).toBeGreaterThan(0));
    const fetched = h.schema.data[0];
    act(() => {
      h.schema.onRowDelete(fetched);
    });
    const dialog = await screen.findByRole('alertdialog');
    const selects: string[][] = ds.find.mock.calls
      .filter(([api]: any[]) => api === CONTACT)
      .map(([, params]: any[]) => params?.$select);
    return { dialog, fetched, selects, drawn: (h.schema.columns ?? []).map((c: any) => c.accessorKey) };
  }

  it('a nameField no column shows is requested, never drawn, and names the row', async () => {
    const ds = projectingDataSource();
    const { dialog, fetched, selects, drawn } = await openDeleteOnFetchedRow(ds, ['email'], denying());
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) expect(select).toEqual(expect.arrayContaining(['id', 'email', 'full_name']));
    expect(fetched.full_name).toBe('Ada Lovelace');
    expect(drawn).toEqual(['email']);
    expect(dialog.textContent).toContain('Are you sure you want to delete "Ada Lovelace"?');
  });

  it('a nameField the principal cannot read is not requested, and the confirm reads the id floor', async () => {
    const ds = projectingDataSource();
    const { dialog, fetched, selects } = await openDeleteOnFetchedRow(ds, ['email'], denying('full_name'));
    for (const select of selects) expect(select).not.toContain('full_name');
    expect(fetched).not.toHaveProperty('full_name');
    expect(dialog.textContent).toContain('Are you sure you want to delete "Record #c1"?');
  });

  it('CONTROL: a shown name column is requested once, as before', async () => {
    const ds = projectingDataSource();
    const { dialog, selects, drawn } = await openDeleteOnFetchedRow(ds, ['full_name', 'email'], denying());
    for (const select of selects) {
      expect([...select].sort()).toEqual(['email', 'full_name', 'id']);
    }
    expect(drawn).toEqual(['full_name', 'email']);
    expect(dialog.textContent).toContain('Are you sure you want to delete "Ada Lovelace"?');
  });
});
