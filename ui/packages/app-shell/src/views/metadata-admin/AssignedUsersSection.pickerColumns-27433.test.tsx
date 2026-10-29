// Copyright (c) 2026 ObjectStack. Licensed under the MIT license.

/**
 * objectstack#27433 — a permission set's Add user picker shows each person's
 * email beside their name, as the assigned rows do, so two people of one name
 * can be told apart before either is granted the set (the pattern the
 * position Add holder picker follows).
 *
 * Pinned against the real `RecordPickerDialog` (not a stub), so what is read
 * is the table the admin sees:
 *
 *  - the picker draws a name column and an email column;
 *  - CONTROL: choosing a person still grants the set BY NAME;
 *  - CONTROL: under a loaded policy that denies `sys_user.email`, the picker's
 *    own read rule leaves the name column alone — the section adds no check of
 *    its own and reads the email no other way.
 */
import * as React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig } from '@object-ui/types';

const users = [
  { id: 'u_1', name: 'Ada Auditor', email: 'ada@example.com' },
  { id: 'u_2', name: 'Sam Lee', email: 'sam.lee@example.com' },
  { id: 'u_3', name: 'Sam Lee', email: 'slee@example.com' },
];
const grants = [{ id: 'grant_1', user_id: 'u_1', permission_set: 'showcase_auditor' }];

const adapter = {
  find: vi.fn(async (object: string, query: any) => {
    if (object === 'sys_user_permission_set') {
      return { data: grants.filter((g) => g.permission_set === query?.$filter?.permission_set) };
    }
    if (object === 'sys_user') {
      const ids: string[] | undefined = query?.$filter?.id?.$in;
      const data = ids ? users.filter((u) => ids.includes(u.id)) : users;
      return { data, total: data.length };
    }
    return { data: [] };
  }),
  create: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
};
const metadataStore = { ensureType: vi.fn(async () => []) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
  useMetadata: () => metadataStore,
}));

import { AssignedUsersSection } from './AssignedUsersSection';

/** A policy under which `viewer` may not read `sys_user.email`. */
const EMAIL_DENIED: ObjectPermissionConfig[] = [
  {
    object: 'sys_user',
    roles: { viewer: { actions: ['read'], fieldPermissions: [{ field: 'email', read: false }] } },
  } as ObjectPermissionConfig,
];

function cells(field: string): string[] {
  return Array.from(document.querySelectorAll(`[data-lookup-cell="${field}"]`)).map((el) => el.textContent ?? '');
}

async function openPicker(): Promise<void> {
  await waitFor(() => expect(screen.getByText('Ada Auditor')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /Add user/ }));
  await waitFor(() => expect(screen.getByTestId('record-row-u_3')).toBeTruthy());
}

beforeEach(() => {
  adapter.find.mockClear();
  adapter.create.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('AssignedUsersSection — the picker shows email beside the name (objectstack#27433)', () => {
  it('draws a name column and an email column', async () => {
    render(<AssignedUsersSection permissionSetName="showcase_auditor" />);
    await openPicker();

    const dialog = screen.getByTestId('record-picker-dialog');
    expect(dialog).toHaveTextContent('Email');
    expect(cells('name')).toEqual(['Ada Auditor', 'Sam Lee', 'Sam Lee']);
    expect(cells('email')).toEqual(['ada@example.com', 'sam.lee@example.com', 'slee@example.com']);
  });

  it('CONTROL: choosing a person still grants the set by name', async () => {
    render(<AssignedUsersSection permissionSetName="showcase_auditor" />);
    await openPicker();

    fireEvent.click(screen.getByTestId('record-row-u_3'));
    fireEvent.click(screen.getByTestId('record-picker-confirm'));
    await waitFor(() => expect(adapter.create).toHaveBeenCalledTimes(1));
    expect(adapter.create).toHaveBeenCalledWith('sys_user_permission_set', {
      user_id: 'u_3',
      permission_set: 'showcase_auditor',
    });
  });

  it('CONTROL: a viewer who may not read email gets the name column alone', async () => {
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={EMAIL_DENIED}>
        <AssignedUsersSection permissionSetName="showcase_auditor" />
      </PermissionProvider>,
    );
    await openPicker();

    expect(cells('name')).toEqual(['Ada Auditor', 'Sam Lee', 'Sam Lee']);
    expect(cells('email')).toEqual([]);
    expect(screen.getByTestId('record-picker-dialog')).not.toHaveTextContent('slee@example.com');
  });
});
