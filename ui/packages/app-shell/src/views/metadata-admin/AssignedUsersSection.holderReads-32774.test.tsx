// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32774 — the Assigned users section, for one holder of a name
 * more than one holder serves (ADR-0150 D3/D8):
 *
 *  - item 3: a grant the resolver reads as no holder's (no package under two
 *    package holders, or a package that holds no set of the name) grants
 *    nothing; it is shown apart as unresolved, removable, ⛔ never listed or
 *    counted as either holder's;
 *  - item 6: a refused Add whose refusal names the holders (the client's error
 *    for either body shape) opens the same holder pick the other doors open;
 *    the pick sends the grant again with the chosen holder's package;
 *  - item 8: where a listed position may be another holder's on the server,
 *    the section says that it may count more people, never fewer.
 *
 * CONTROL each time: with no holding, every request and screen is as before.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AssignedUsersSection } from './AssignedUsersSection';

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => mockAdapter,
  useMetadata: () => mockMetadataStore,
}));
vi.mock('@object-ui/fields', async (importOriginal) => {
  const { createElement } = await import('react');
  return {
    ...(await importOriginal<typeof import('@object-ui/fields')>()),
    RecordPickerDialog: (props: { open: boolean; onSelectRecords?: (records: unknown[]) => void }) =>
      props.open
        ? createElement('button', { type: 'button', onClick: () => props.onSelectRecords?.(pickedUsers) }, 'pick')
        : null,
  };
});
const pickedUsers = [{ id: 'u_new', name: 'New Nora' }];
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

let positions: Array<Record<string, unknown>> = [];
const mockMetadataStore = { ensureType: vi.fn(async () => positions) };

const data: Record<string, any[]> = {};
function seed() {
  data.sys_user_permission_set = [
    { id: 'g_sales', permission_set: 'sales_rep', permission_set_package: 'com.acme.sales', user_id: 'u_sales' },
    { id: 'g_crm', permission_set: 'sales_rep', permission_set_package: 'com.acme.crm', user_id: 'u_crm' },
    { id: 'g_bare', permission_set: 'sales_rep', permission_set_package: null, user_id: 'u_bare' },
  ];
  data.sys_user_position = [{ id: 'up_l', user_id: 'u_lead', position: 'crm_lead' }];
  data.sys_user = [
    { id: 'u_sales', name: 'Sales Sam' },
    { id: 'u_crm', name: 'Crm Cora' },
    { id: 'u_bare', name: 'Bare Bo' },
    { id: 'u_lead', name: 'Lead Lee' },
  ];
  positions = [];
}

let createImpl: (object: string, body: Record<string, unknown>) => Promise<unknown> = async (_o, body) => body;
const mockAdapter = {
  find: vi.fn(async (object: string, query: any) => {
    const rows = data[object] ?? [];
    const filter = query?.$filter ?? {};
    return rows.filter((r) =>
      Object.entries(filter).every(([k, v]: [string, any]) => {
        if (v && typeof v === 'object' && Array.isArray(v.$in)) return v.$in.includes(r[k]);
        return r[k] === v;
      }),
    );
  }),
  create: vi.fn((object: string, body: Record<string, unknown>) => createImpl(object, body)),
  delete: vi.fn(async () => ({})),
};

const TWO = ['com.acme.crm', 'com.acme.sales'];
const SENTENCE = 'Permission set "sales_rep" is held by more than one package; name one.';
/** The client's error for the `/data` door's 409 (flat body, objectstack#32740): `code`, `details`. */
const conflictError = () =>
  Object.assign(new Error(SENTENCE), {
    code: 'RESOURCE_CONFLICT',
    httpStatus: 409,
    details: { candidates: [{ kind: 'package', packageId: 'com.acme.crm' }, { kind: 'package', packageId: 'com.acme.sales' }] },
  });

afterEach(() => {
  cleanup();
  createImpl = async (_o, body) => body;
  mockAdapter.find.mockClear();
  mockAdapter.create.mockClear();
  mockAdapter.delete.mockClear();
});

describe('a grant no holder reaches is shown apart (objectstack#32774 item 3)', () => {
  it("lists it as unresolved, outside this holder's rows and count, and Remove deletes its row", async () => {
    seed();
    const onHoldersRead = vi.fn();
    render(
      <AssignedUsersSection permissionSetName="sales_rep" holding={{ packageId: 'com.acme.sales', holders: TWO }} onHoldersRead={onHoldersRead} />,
    );
    const block = await screen.findByTestId('assigned-users-unresolved');
    expect(within(block).getByText('Bare Bo')).toBeTruthy();
    expect(within(block).queryByText('Sales Sam')).toBeNull();
    expect(screen.queryByText('Crm Cora')).toBeNull();
    // Only the holder's own grant is counted.
    expect(onHoldersRead).toHaveBeenLastCalledWith(1, 'sales_rep');
    expect(screen.getByText('1')).toBeTruthy();

    fireEvent.click(within(block).getByTestId('assigned-users-unresolved-remove-u_bare'));
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));
    await waitFor(() => expect(mockAdapter.delete).toHaveBeenCalledWith('sys_user_permission_set', 'g_bare'));
  });

  it("CONTROL: the environment's own set holds the grant that names no package; with no holding nothing is apart", async () => {
    seed();
    render(<AssignedUsersSection permissionSetName="sales_rep" holding={{ packageId: null, holders: [null, 'com.acme.crm'] }} />);
    await waitFor(() => expect(screen.getByText('Bare Bo')).toBeTruthy());
    expect(screen.queryByTestId('assigned-users-unresolved')).toBeNull();
    cleanup();

    seed();
    render(<AssignedUsersSection permissionSetName="sales_rep" />);
    await waitFor(() => expect(screen.getByText('Bare Bo')).toBeTruthy());
    expect(screen.getByText('Crm Cora')).toBeTruthy();
    expect(screen.queryByTestId('assigned-users-unresolved')).toBeNull();
    const userRead = mockAdapter.find.mock.calls.filter(([o]) => o === 'sys_user').at(-1)?.[1];
    expect(userRead?.$filter).toEqual({ id: { $in: ['u_sales', 'u_crm', 'u_bare'] } });
  });
});

describe('a refused Add opens the holder pick (objectstack#32774 item 6)', () => {
  it("shows the server's sentence and one button per holder; the pick grants with that holder's package", async () => {
    seed();
    createImpl = async (_o, body) => {
      if (!body.permission_set_package) throw conflictError();
      return body;
    };
    render(<AssignedUsersSection permissionSetName="sales_rep" />);
    await waitFor(() => expect(screen.getByText('Sales Sam')).toBeTruthy());
    fireEvent.click(screen.getByText('Add user'));
    fireEvent.click(await screen.findByText('pick'));

    const pick = await screen.findByTestId('perm-holder-pick');
    expect(within(pick).getByText(SENTENCE)).toBeTruthy();
    expect(screen.queryByRole('alert', { name: /Failed to assign/ })).toBeNull();
    fireEvent.click(within(pick).getByTestId('perm-holder-pick-com.acme.sales'));
    await waitFor(() => expect(mockAdapter.create).toHaveBeenCalledTimes(2));
    expect(mockAdapter.create).toHaveBeenNthCalledWith(1, 'sys_user_permission_set', { user_id: 'u_new', permission_set: 'sales_rep' });
    expect(mockAdapter.create).toHaveBeenNthCalledWith(2, 'sys_user_permission_set', {
      user_id: 'u_new',
      permission_set: 'sales_rep',
      permission_set_package: 'com.acme.sales',
    });
    await waitFor(() => expect(screen.queryByTestId('perm-holder-pick')).toBeNull());
  });

  it('CONTROL: a refusal that names no holder is said in its words, with no pick', async () => {
    seed();
    createImpl = async () => {
      throw Object.assign(new Error('Grant refused: not a member of this organization'), { code: 'PERMISSION_DENIED' });
    };
    render(<AssignedUsersSection permissionSetName="sales_rep" />);
    await waitFor(() => expect(screen.getByText('Sales Sam')).toBeTruthy());
    fireEvent.click(screen.getByText('Add user'));
    fireEvent.click(await screen.findByText('pick'));
    expect(await screen.findByText('Grant refused: not a member of this organization')).toBeTruthy();
    expect(screen.queryByTestId('perm-holder-pick')).toBeNull();
    expect(mockAdapter.create).toHaveBeenCalledTimes(1);
  });
});

describe('the section says what it counts (objectstack#32774 item 8)', () => {
  const crmLead = { name: 'crm_lead', label: 'CRM lead', _packageId: 'com.acme.crm', permissionSets: ['sales_rep'] };

  it("the environment's section, counting a package's position, says it may count more", async () => {
    seed();
    positions = [crmLead];
    render(<AssignedUsersSection permissionSetName="sales_rep" holding={{ packageId: null, holders: [null, 'com.acme.crm'] }} />);
    await waitFor(() => expect(screen.getByText('Lead Lee')).toBeTruthy());
    expect(screen.getByTestId('assigned-users-over-count').textContent).toMatch(/more people than hold this set, never fewer/);
  });

  it("CONTROL: the package's own section, and no holding, say nothing more", async () => {
    seed();
    positions = [crmLead];
    render(<AssignedUsersSection permissionSetName="sales_rep" holding={{ packageId: 'com.acme.crm', holders: [null, 'com.acme.crm'] }} />);
    await waitFor(() => expect(screen.getByText('Lead Lee')).toBeTruthy());
    expect(screen.queryByTestId('assigned-users-over-count')).toBeNull();
    cleanup();

    seed();
    positions = [crmLead];
    render(<AssignedUsersSection permissionSetName="sales_rep" />);
    await waitFor(() => expect(screen.getByText('Lead Lee')).toBeTruthy());
    expect(screen.queryByTestId('assigned-users-over-count')).toBeNull();
  });
});
