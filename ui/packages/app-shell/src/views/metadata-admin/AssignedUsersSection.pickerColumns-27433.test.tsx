// Copyright (c) 2026 ObjectStack. Licensed under the MIT license.

/**
 * objectstack#27433 — a permission set's Add user picker shows each person's
 * email beside their name, as the assigned rows do, so two people of one name
 * can be told apart before either is granted the set. The same shape as the
 * positions page (objectstack#27410).
 *
 * Pinned against the real `RecordPickerDialog` (not a stub), so what is read
 * is the table the admin sees:
 *
 *  - the picker draws a name column and an email column;
 *  - CONTROL: choosing a person still writes the grant BY NAME, the picker
 *    still offers the active organization's members only, and the AI-seat cap
 *    refusal still shows inline;
 *  - CONTROL: under a loaded policy that denies `sys_user.email`, the picker's
 *    own read rule leaves the name column alone — the section adds no check of
 *    its own and reads the email no other way.
 */
import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig } from '@object-ui/types';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ activeOrganization: { id: 'org_1' } }),
}));

const users = [
  { id: 'u_1', name: 'Ada Admin', email: 'ada@example.com' },
  { id: 'u_2', name: 'Sam Lee', email: 'sam.lee@example.com' },
  { id: 'u_3', name: 'Sam Lee', email: 'slee@example.com' },
  { id: 'u_9', name: 'Olga Outsider', email: 'olga@example.com' },
];
const grants = [{ id: 'grant_1', permission_set: 'ai_seat', user_id: 'u_1' }];
/** `u_9` holds no membership row in `org_1`. */
const members = [
  { id: 'm_1', user_id: 'u_1', organization_id: 'org_1' },
  { id: 'm_2', user_id: 'u_2', organization_id: 'org_1' },
  { id: 'm_3', user_id: 'u_3', organization_id: 'org_1' },
  { id: 'm_9', user_id: 'u_9', organization_id: 'org_2' },
];
const registered = [{ name: 'sys_user_permission_set' }, { name: 'sys_member' }, { name: 'sys_user' }];

/** Every `id.$in` list anywhere in a filter — the members filter, however the picker nests it. */
function idLists(filter: unknown, out: string[][] = []): string[][] {
  if (Array.isArray(filter)) filter.forEach((f) => idLists(f, out));
  else if (filter && typeof filter === 'object') {
    for (const [k, v] of Object.entries(filter as Record<string, unknown>)) {
      if (k === 'id' && Array.isArray((v as { $in?: unknown } | null)?.$in)) out.push((v as { $in: string[] }).$in);
      else idLists(v, out);
    }
  }
  return out;
}

const adapter = {
  find: vi.fn(async (object: string, query: any) => {
    if (object === 'sys_user_permission_set') return { data: grants };
    if (object === 'sys_member') {
      return { data: members.filter((m) => m.organization_id === query?.$filter?.organization_id) };
    }
    if (object === 'sys_user') {
      const lists = idLists(query?.$filter);
      const data = users.filter((u) => lists.every((ids) => ids.includes(u.id)));
      return { data, total: data.length };
    }
    return { data: [] };
  }),
  create: vi.fn(async (_object: string, _row: unknown): Promise<unknown> => ({})),
  delete: vi.fn(async () => ({})),
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
  useMetadata: () => ({ objects: registered, ensureType: async () => [] }),
}));

import { AssignedUsersSection } from './AssignedUsersSection';

/** A policy under which `viewer` may write grants but may not read `sys_user.email`. */
const EMAIL_DENIED: ObjectPermissionConfig[] = [
  {
    object: 'sys_user',
    roles: { viewer: { actions: ['read'], fieldPermissions: [{ field: 'email', read: false }] } },
  } as ObjectPermissionConfig,
  {
    object: 'sys_user_permission_set',
    roles: { viewer: { actions: ['read', 'create', 'delete'] } },
  } as ObjectPermissionConfig,
];

function cells(field: string): string[] {
  return Array.from(document.querySelectorAll(`[data-lookup-cell="${field}"]`)).map((el) => el.textContent ?? '');
}

async function openPicker(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Ada Admin')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /Add user/ }));
  await waitFor(() => expect(screen.getByTestId('record-row-u_3')).toBeInTheDocument());
}

beforeEach(() => {
  adapter.find.mockClear();
  adapter.create.mockReset();
  adapter.create.mockImplementation(async () => ({}));
});

afterEach(() => {
  cleanup();
});

describe('AssignedUsersSection — the picker shows email beside the name (objectstack#27433)', () => {
  it('draws a name column and an email column', async () => {
    render(<AssignedUsersSection permissionSetName="ai_seat" />);
    await openPicker();

    const dialog = screen.getByTestId('record-picker-dialog');
    expect(dialog).toHaveTextContent('Email');
    expect(cells('name')).toEqual(['Ada Admin', 'Sam Lee', 'Sam Lee']);
    expect(cells('email')).toEqual(['ada@example.com', 'sam.lee@example.com', 'slee@example.com']);
  });

  it('CONTROL: offers the active organization’s members only', async () => {
    render(<AssignedUsersSection permissionSetName="ai_seat" />);
    await openPicker();

    expect(screen.queryByTestId('record-row-u_9')).toBeNull();
    expect(screen.getByTestId('record-picker-dialog')).not.toHaveTextContent('Olga Outsider');
  });

  it('CONTROL: choosing a person still writes the grant by name', async () => {
    render(<AssignedUsersSection permissionSetName="ai_seat" />);
    await openPicker();

    fireEvent.click(screen.getByTestId('record-row-u_3'));
    fireEvent.click(screen.getByTestId('record-picker-confirm'));
    await waitFor(() => expect(adapter.create).toHaveBeenCalledTimes(1));
    expect(adapter.create).toHaveBeenCalledWith('sys_user_permission_set', { user_id: 'u_3', permission_set: 'ai_seat' });
  });

  it('CONTROL: the AI-seat cap refusal still shows inline', async () => {
    adapter.create.mockImplementation(async () => {
      throw new Error('AI seat cap reached: 1 of 1 seats in use');
    });
    render(<AssignedUsersSection permissionSetName="ai_seat" />);
    await openPicker();

    fireEvent.click(screen.getByTestId('record-row-u_3'));
    fireEvent.click(screen.getByTestId('record-picker-confirm'));
    expect(await screen.findByText(/All 1 AI seat\(s\) are in use/)).toBeInTheDocument();
  });

  it('CONTROL: a viewer who may not read email gets the name column alone', async () => {
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={EMAIL_DENIED}>
        <AssignedUsersSection permissionSetName="ai_seat" />
      </PermissionProvider>,
    );
    await openPicker();

    expect(cells('name')).toEqual(['Ada Admin', 'Sam Lee', 'Sam Lee']);
    expect(cells('email')).toEqual([]);
    expect(screen.getByTestId('record-picker-dialog')).not.toHaveTextContent('slee@example.com');
  });
});
