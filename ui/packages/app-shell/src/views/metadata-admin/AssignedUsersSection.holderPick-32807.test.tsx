// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32807 — the Assigned users section's Add pick and grant rows,
 * after objectstack#32774 (ADR-0150 D3/D5/D8):
 *
 *  - item 1: a refusal naming ONE holder is still a pick: one button, and no
 *    grant is sent again until it is clicked (⛔ never resolved by order);
 *  - item 2: a refusal whose `details.candidates` is an empty list is no pick:
 *    the server's sentence only;
 *  - item 4 (struck on `main`, see the PR): the environment's button sends the
 *    grant again by the name alone, the users still to grant only;
 *  - item 5: a grant row read with no `id` is shown with no Remove, and no
 *    delete is ever sent for it.
 *
 * CONTROL: with no holding (one holder), every request and screen is as before.
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

afterEach(() => {
  cleanup();
  pickedUsers.splice(0, pickedUsers.length, { id: 'u_new', name: 'New Nora' });
  createImpl = async (_o, body) => body;
  mockAdapter.find.mockClear();
  mockAdapter.create.mockClear();
  mockAdapter.delete.mockClear();
});

const pickWith = (candidates: unknown[]) => () =>
  Object.assign(new Error(SENTENCE), { code: 'RESOURCE_CONFLICT', httpStatus: 409, details: { candidates } });

async function openAddAndPick() {
  render(<AssignedUsersSection permissionSetName="sales_rep" />);
  await waitFor(() => expect(screen.getByText('Sales Sam')).toBeTruthy());
  fireEvent.click(screen.getByText('Add user'));
  fireEvent.click(await screen.findByText('pick'));
}

describe('a refusal naming one holder is a pick, never an automatic re-send (objectstack#32807 item 1)', () => {
  it('shows one button and sends nothing more until it is clicked; the click grants with that package', async () => {
    seed();
    const refusal = pickWith([{ kind: 'package', packageId: 'com.acme.sales' }]);
    createImpl = async (_o, body) => {
      if (!body.permission_set_package) throw refusal();
      return body;
    };
    await openAddAndPick();

    const pick = await screen.findByTestId('perm-holder-pick');
    expect(within(pick).getByText(SENTENCE)).toBeTruthy();
    expect(within(pick).getAllByRole('button')).toHaveLength(1);
    expect(within(pick).getByTestId('perm-holder-pick-com.acme.sales')).toBeTruthy();
    // Settled with the pick open: only the refused grant was sent.
    await new Promise((r) => setTimeout(r, 30));
    expect(mockAdapter.create).toHaveBeenCalledTimes(1);
    expect(mockAdapter.create).toHaveBeenCalledWith('sys_user_permission_set', { user_id: 'u_new', permission_set: 'sales_rep' });

    fireEvent.click(within(pick).getByTestId('perm-holder-pick-com.acme.sales'));
    await waitFor(() => expect(mockAdapter.create).toHaveBeenCalledTimes(2));
    expect(mockAdapter.create).toHaveBeenNthCalledWith(2, 'sys_user_permission_set', {
      user_id: 'u_new',
      permission_set: 'sales_rep',
      permission_set_package: 'com.acme.sales',
    });
    await waitFor(() => expect(screen.queryByTestId('perm-holder-pick')).toBeNull());
  });
});

describe('a refusal naming an empty list of holders is no pick (objectstack#32807 item 2)', () => {
  it("says the server's sentence only, and sends nothing more", async () => {
    seed();
    const refusal = pickWith([]);
    createImpl = async () => {
      throw refusal();
    };
    await openAddAndPick();

    expect(await screen.findByText(SENTENCE)).toBeTruthy();
    expect(screen.queryByTestId('perm-holder-pick')).toBeNull();
    expect(screen.queryByTestId('assigned-users-add-pick')).toBeNull();
    expect(mockAdapter.create).toHaveBeenCalledTimes(1);
  });
});

describe("the environment's button on the Add pick (objectstack#32807 item 4, struck)", () => {
  it('sends the grant again by the name alone, for the users still to grant', async () => {
    seed();
    pickedUsers.splice(0, pickedUsers.length, { id: 'u_new', name: 'New Nora' }, { id: 'u_two', name: 'Two Tia' });
    const refusal = pickWith([{ kind: 'package', packageId: 'com.acme.crm' }, { kind: 'environment' }]);
    let sent = 0;
    createImpl = async (_o, body) => {
      sent += 1;
      // The first user is granted, the second is refused naming the holders.
      if (sent === 2) throw refusal();
      return body;
    };
    render(<AssignedUsersSection permissionSetName="sales_rep" holding={{ packageId: 'com.acme.sales', holders: TWO }} />);
    await waitFor(() => expect(screen.getByText('Sales Sam')).toBeTruthy());
    fireEvent.click(screen.getByText('Add user'));
    fireEvent.click(await screen.findByText('pick'));

    const pick = await screen.findByTestId('perm-holder-pick');
    fireEvent.click(within(pick).getByTestId('perm-holder-pick-environment'));
    await waitFor(() => expect(mockAdapter.create).toHaveBeenCalledTimes(3));
    expect(mockAdapter.create.mock.calls.map(([, body]) => body)).toEqual([
      { user_id: 'u_new', permission_set: 'sales_rep', permission_set_package: 'com.acme.sales' },
      { user_id: 'u_two', permission_set: 'sales_rep', permission_set_package: 'com.acme.sales' },
      { user_id: 'u_two', permission_set: 'sales_rep' },
    ]);
  });
});

describe('a grant row read with no id has no Remove (objectstack#32807 item 5)', () => {
  it('an unresolved grant with no id is listed with no Remove', async () => {
    seed();
    data.sys_user_permission_set.push({ permission_set: 'sales_rep', permission_set_package: null, user_id: 'u_lead' });
    render(<AssignedUsersSection permissionSetName="sales_rep" holding={{ packageId: 'com.acme.sales', holders: TWO }} />);
    const block = await screen.findByTestId('assigned-users-unresolved');
    expect(within(block).getByText('Lead Lee')).toBeTruthy();
    expect(within(block).queryByTestId('assigned-users-unresolved-remove-u_lead')).toBeNull();
    // CONTROL: the unresolved grant with an id keeps its Remove, by that id.
    fireEvent.click(within(block).getByTestId('assigned-users-unresolved-remove-u_bare'));
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));
    await waitFor(() => expect(mockAdapter.delete).toHaveBeenCalledWith('sys_user_permission_set', 'g_bare'));
    expect(mockAdapter.delete).toHaveBeenCalledTimes(1);
  });

  it("a direct grant with no id is listed with no Remove, and never displaces the same user's removable grant", async () => {
    seed();
    data.sys_user_permission_set = [
      { permission_set: 'sales_rep', user_id: 'u_lead' },
      { id: 'g_sales', permission_set: 'sales_rep', user_id: 'u_sales' },
      { permission_set: 'sales_rep', user_id: 'u_sales' },
    ];
    render(<AssignedUsersSection permissionSetName="sales_rep" />);
    await waitFor(() => expect(screen.getByText('Lead Lee')).toBeTruthy());
    const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
    expect(within(rowOf('Lead Lee')).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(rowOf('Lead Lee')).queryByTitle(/Held via a position/)).toBeNull();

    fireEvent.click(within(rowOf('Sales Sam')).getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));
    await waitFor(() => expect(mockAdapter.delete).toHaveBeenCalledWith('sys_user_permission_set', 'g_sales'));
    expect(mockAdapter.delete).toHaveBeenCalledTimes(1);
  });
});

describe('CONTROL: one holder, every request and screen as before (objectstack#32807)', () => {
  it('Add sends the grant by the name alone, once per user; each direct grant is removed by its own id', async () => {
    seed();
    data.sys_user_position = [];
    render(<AssignedUsersSection permissionSetName="sales_rep" />);
    await waitFor(() => expect(screen.getByText('Bare Bo')).toBeTruthy());
    expect(screen.queryByTestId('assigned-users-unresolved')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(3);
    expect(mockAdapter.find.mock.calls.find(([o]) => o === 'sys_user_permission_set')?.[1]).toEqual({
      $filter: { permission_set: 'sales_rep' },
      $top: 500,
    });

    fireEvent.click(screen.getByText('Add user'));
    fireEvent.click(await screen.findByText('pick'));
    await waitFor(() => expect(mockAdapter.create).toHaveBeenCalledTimes(1));
    expect(mockAdapter.create).toHaveBeenCalledWith('sys_user_permission_set', { user_id: 'u_new', permission_set: 'sales_rep' });
    expect(screen.queryByTestId('perm-holder-pick')).toBeNull();

    const bare = screen.getByText('Bare Bo').closest('li') as HTMLElement;
    fireEvent.click(within(bare).getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));
    await waitFor(() => expect(mockAdapter.delete).toHaveBeenCalledWith('sys_user_permission_set', 'g_bare'));
  });
});
