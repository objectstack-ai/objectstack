// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27410 — Add holder's user picker shows each person's email beside
 * their name, as the holder rows do, so two people of one name can be told
 * apart before either is granted the position.
 *
 * Pinned against the real `RecordPickerDialog` (not a stub), so what is read
 * is the table the admin sees:
 *
 *  - the picker draws a name column and an email column;
 *  - CONTROL: choosing a person still assigns the position BY NAME;
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
const assignments = [{ id: 'up_1', user_id: 'u_1', position: 'auditor' }];

const adapter = {
  find: vi.fn(async (object: string, query: any) => {
    if (object === 'sys_user_position') {
      return { data: assignments.filter((a) => a.position === query?.$filter?.position) };
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
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
}));

import { PositionHoldersSection } from './PositionHoldersSection';

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
  fireEvent.click(screen.getByRole('button', { name: /Add holder/ }));
  await waitFor(() => expect(screen.getByTestId('record-row-u_3')).toBeTruthy());
}

beforeEach(() => {
  adapter.find.mockClear();
  adapter.create.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('PositionHoldersSection — the picker shows email beside the name (objectstack#27410)', () => {
  it('draws a name column and an email column', async () => {
    render(<PositionHoldersSection name="auditor" />);
    await openPicker();

    const dialog = screen.getByTestId('record-picker-dialog');
    expect(dialog).toHaveTextContent('Email');
    expect(cells('name')).toEqual(['Ada Auditor', 'Sam Lee', 'Sam Lee']);
    expect(cells('email')).toEqual(['ada@example.com', 'sam.lee@example.com', 'slee@example.com']);
  });

  it('CONTROL: choosing a person still assigns the position by name', async () => {
    render(<PositionHoldersSection name="auditor" />);
    await openPicker();

    fireEvent.click(screen.getByTestId('record-row-u_3'));
    fireEvent.click(screen.getByTestId('record-picker-confirm'));
    await waitFor(() => expect(adapter.create).toHaveBeenCalledTimes(1));
    expect(adapter.create).toHaveBeenCalledWith('sys_user_position', { user_id: 'u_3', position: 'auditor' });
  });

  it('CONTROL: a viewer who may not read email gets the name column alone', async () => {
    render(
      <PermissionProvider roles={[]} userRoles={['viewer']} permissions={EMAIL_DENIED}>
        <PositionHoldersSection name="auditor" />
      </PermissionProvider>,
    );
    await openPicker();

    expect(cells('name')).toEqual(['Ada Auditor', 'Sam Lee', 'Sam Lee']);
    expect(cells('email')).toEqual([]);
    expect(screen.getByTestId('record-picker-dialog')).not.toHaveTextContent('slee@example.com');
  });
});
