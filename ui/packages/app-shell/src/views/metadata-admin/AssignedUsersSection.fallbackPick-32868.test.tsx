// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32868 — the Assigned users section's Add pick and holder rows,
 * after objectstack#32807 and the server's objectstack#32867:
 *
 *  - item 1: the environment's button sends the grant by the name alone. The
 *    fakes answer as the server does (measured on a real metadata store, see
 *    the PR): where the registry serves the name, the environment's own set
 *    answers it and the grant is stored (CONTROL); where the registry holds
 *    the name nowhere and the catalog falls back to the metadata service, a
 *    name two packages hold beside the environment's own row is refused by
 *    the name alone, `409 ambiguous-in-environment` naming the packages only.
 *    That refusal is the next pick, in the server's words, with the users
 *    still to grant; nothing more is sent until a holder is clicked, and ⛔ no
 *    holder is chosen by order;
 *  - item 2: a user with a direct grant read with no `id`, who also holds the
 *    set through a position, shows the "held via a position" hint, and no
 *    Remove.
 *
 * CONTROL: one holder, the rows read as before.
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
const pickedUsers = [
  { id: 'u_new', name: 'New Nora' },
  { id: 'u_two', name: 'Two Tia' },
];
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

let positions: Array<Record<string, unknown>> = [];
const mockMetadataStore = { ensureType: vi.fn(async () => positions) };

const data: Record<string, any[]> = {};

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

afterEach(() => {
  cleanup();
  createImpl = async (_o, body) => body;
  mockAdapter.find.mockClear();
  mockAdapter.create.mockClear();
  mockAdapter.delete.mockClear();
});

const CRM = 'com.acme.crm';
const HR = 'com.acme.hr';
/** The page's holder, which no longer holds the name: its grant is refused `not-held-by-qualifier`. */
const STALE = 'com.acme.sales';

const NOT_HELD = 'Package "com.acme.sales" holds no permission set named "sales_rep"; it is held by com.acme.crm, com.acme.hr, the environment.';
const AMBIGUOUS = 'Permission set "sales_rep" is held by more than one package (com.acme.crm, com.acme.hr); name one.';

const refusal = (message: string, candidates: unknown[]) =>
  Object.assign(new Error(message), { code: 'RESOURCE_CONFLICT', httpStatus: 409, details: { candidates } });

function seedHolders() {
  data.sys_user_permission_set = [
    { id: 'g_sales', permission_set: 'sales_rep', permission_set_package: STALE, user_id: 'u_sales' },
  ];
  data.sys_user_position = [];
  data.sys_user = [{ id: 'u_sales', name: 'Sales Sam' }];
  positions = [];
}

async function addTwoUsers() {
  render(
    <AssignedUsersSection
      permissionSetName="sales_rep"
      holding={{ packageId: STALE, holders: [STALE, CRM, HR, null] }}
    />,
  );
  await waitFor(() => expect(screen.getByText('Sales Sam')).toBeTruthy());
  fireEvent.click(screen.getByText('Add user'));
  fireEvent.click(await screen.findByText('pick'));
}

const sent = () => mockAdapter.create.mock.calls.map(([, body]) => body);

describe("the environment's button on the Add pick, on each catalog path (objectstack#32868 item 1)", () => {
  it('metadata-service fallback: the refused re-send is the next pick, packages only, the users still to grant; nothing is chosen', async () => {
    seedHolders();
    let calls = 0;
    createImpl = async (_o, body) => {
      calls += 1;
      // The first user is granted under the page's holder; the second is
      // refused naming every holder the catalog lists, the environment last.
      if (calls === 1) return body;
      if (body.permission_set_package === STALE) {
        throw refusal(NOT_HELD, [
          { kind: 'package', packageId: CRM },
          { kind: 'package', packageId: HR },
          { kind: 'environment' },
        ]);
      }
      // The metadata store refuses the name alone across two packages, even
      // beside the environment's own row, naming the packages only.
      if (body.permission_set_package === undefined) {
        throw refusal(AMBIGUOUS, [
          { kind: 'package', packageId: CRM },
          { kind: 'package', packageId: HR },
        ]);
      }
      return body;
    };
    await addTwoUsers();

    const first = await screen.findByTestId('perm-holder-pick');
    expect(within(first).getByText(NOT_HELD)).toBeTruthy();
    fireEvent.click(within(first).getByTestId('perm-holder-pick-environment'));

    await waitFor(() => expect(screen.getByText(AMBIGUOUS)).toBeTruthy());
    const next = screen.getByTestId('perm-holder-pick');
    expect(within(next).queryByTestId('perm-holder-pick-environment')).toBeNull();
    expect(within(next).getAllByRole('button')).toHaveLength(2);
    expect(within(next).getByTestId(`perm-holder-pick-${CRM}`)).toBeTruthy();
    expect(within(next).getByTestId(`perm-holder-pick-${HR}`)).toBeTruthy();
    // Settled with the next pick open: nothing re-sent by order.
    await new Promise((r) => setTimeout(r, 30));
    expect(sent()).toEqual([
      { user_id: 'u_new', permission_set: 'sales_rep', permission_set_package: STALE },
      { user_id: 'u_two', permission_set: 'sales_rep', permission_set_package: STALE },
      { user_id: 'u_two', permission_set: 'sales_rep' },
    ]);

    fireEvent.click(within(next).getByTestId(`perm-holder-pick-${HR}`));
    await waitFor(() => expect(mockAdapter.create).toHaveBeenCalledTimes(4));
    expect(sent()[3]).toEqual({ user_id: 'u_two', permission_set: 'sales_rep', permission_set_package: HR });
    await waitFor(() => expect(screen.queryByTestId('perm-holder-pick')).toBeNull());
  });

  it("CONTROL registry path: the environment's own set answers the name alone, and the re-send is stored", async () => {
    seedHolders();
    createImpl = async (_o, body) => {
      if (body.permission_set_package === STALE) {
        throw refusal(NOT_HELD, [
          { kind: 'package', packageId: CRM },
          { kind: 'package', packageId: HR },
          { kind: 'environment' },
        ]);
      }
      return body;
    };
    await addTwoUsers();

    const pick = await screen.findByTestId('perm-holder-pick');
    fireEvent.click(within(pick).getByTestId('perm-holder-pick-environment'));
    await waitFor(() => expect(mockAdapter.create).toHaveBeenCalledTimes(3));
    expect(sent()).toEqual([
      { user_id: 'u_new', permission_set: 'sales_rep', permission_set_package: STALE },
      { user_id: 'u_new', permission_set: 'sales_rep' },
      { user_id: 'u_two', permission_set: 'sales_rep' },
    ]);
    await waitFor(() => expect(screen.queryByTestId('perm-holder-pick')).toBeNull());
  });
});

const HINT = /Held via a position/;

function seedRows(grants: any[]) {
  data.sys_user_permission_set = grants;
  data.sys_user_position = [
    { id: 'up_l', user_id: 'u_lead', position: 'crm_lead' },
    { id: 'up_p', user_id: 'u_pos', position: 'crm_lead' },
    { id: 'up_s', user_id: 'u_sales', position: 'crm_lead' },
  ];
  data.sys_user = [
    { id: 'u_lead', name: 'Lead Lee' },
    { id: 'u_pos', name: 'Pos Pia' },
    { id: 'u_sales', name: 'Sales Sam' },
    { id: 'u_bare', name: 'Bare Bo' },
  ];
  positions = [{ name: 'crm_lead', permissionSets: ['sales_rep'] }];
}

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('a direct grant read with no id, beside a position (objectstack#32868 item 2)', () => {
  it('shows the position hint and no Remove', async () => {
    seedRows([{ permission_set: 'sales_rep', user_id: 'u_lead' }]);
    render(<AssignedUsersSection permissionSetName="sales_rep" />);
    await waitFor(() => expect(screen.getByText('Lead Lee')).toBeTruthy());
    const row = rowOf('Lead Lee');
    expect(within(row).getByText('direct')).toBeTruthy();
    expect(within(row).getByText('via position crm_lead')).toBeTruthy();
    expect(within(row).getByTitle(HINT)).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('CONTROL one holder: a position-only row keeps the hint, an id-less direct-only row shows neither, a removable grant keeps its Remove', async () => {
    seedRows([
      { permission_set: 'sales_rep', user_id: 'u_bare' },
      { id: 'g_sales', permission_set: 'sales_rep', user_id: 'u_sales' },
    ]);
    render(<AssignedUsersSection permissionSetName="sales_rep" />);
    await waitFor(() => expect(screen.getByText('Pos Pia')).toBeTruthy());

    expect(within(rowOf('Pos Pia')).getByTitle(HINT)).toBeTruthy();
    expect(within(rowOf('Pos Pia')).queryByRole('button', { name: 'Remove' })).toBeNull();

    expect(within(rowOf('Bare Bo')).queryByTitle(HINT)).toBeNull();
    expect(within(rowOf('Bare Bo')).queryByRole('button', { name: 'Remove' })).toBeNull();

    // A removable direct grant beside a position: Remove, and no hint.
    expect(within(rowOf('Sales Sam')).queryByTitle(HINT)).toBeNull();
    fireEvent.click(within(rowOf('Sales Sam')).getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));
    await waitFor(() => expect(mockAdapter.delete).toHaveBeenCalledWith('sys_user_permission_set', 'g_sales'));
    expect(mockAdapter.delete).toHaveBeenCalledTimes(1);
  });
});
