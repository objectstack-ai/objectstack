// Copyright (c) 2026 ObjectStack. Licensed under the MIT license.

/**
 * objectui#13408 — a permission set's Assigned Users: Remove asks first, and
 * the picker offers the organization's members only. The same shape as the
 * positions page (objectui#13337, `PositionHoldersSection.confirmAndMembers-13337.test.tsx`).
 *
 *  - Remove on a direct grant opens a confirm that names the person and sends
 *    nothing; Cancel writes nothing; only the confirm deletes the grant row;
 *  - Add reads the active organization's `sys_member` rows (every page) and
 *    hands the picker their user ids as its hard filter, so a user removed
 *    from the organization (no membership row) is not offered;
 *  - a refused membership read is said in the server's words and the picker
 *    stays shut; an organization with no members says so;
 *  - where the server judges no membership — no active organization, or no
 *    `sys_member` registered — the picker opens unfiltered and nothing is read.
 */
import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';

interface PickerProps {
  open: boolean;
  baseFilter?: unknown;
  onSelectRecords: (records: any[]) => void;
}
let picker: PickerProps | null = null;
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: (props: PickerProps) => {
    picker = props;
    return null;
  },
}));

const auth = { activeOrganization: { id: 'org_1' } as { id: string } | null };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ activeOrganization: auth.activeOrganization }),
}));

const grants = [{ id: 'grant_1', permission_set: 'crm_sales_user', user_id: 'u_1' }];
const users = [{ id: 'u_1', name: 'Dana Direct', email: 'dana@example.com' }];
/** `u_9` (QA Csv) was removed from `org_1`: no membership row names them there. */
let members: Array<{ id: string; user_id: string; organization_id: string }> = [];
let membershipRead: (() => never) | null = null;
const registered = {
  objects: [{ name: 'sys_user_permission_set' }, { name: 'sys_member' }] as Array<{ name: string }>,
};

const adapter = {
  find: vi.fn(async (object: string, query: any) => {
    if (object === 'sys_user_permission_set') return { data: grants };
    if (object === 'sys_user') {
      const ids: string[] = query?.$filter?.id?.$in ?? [];
      return { data: users.filter((u) => ids.includes(u.id)) };
    }
    if (object === 'sys_member') {
      if (membershipRead) membershipRead();
      const rows = members.filter((m) => m.organization_id === query?.$filter?.organization_id);
      return { data: rows.slice(query?.$skip ?? 0, (query?.$skip ?? 0) + (query?.$top ?? rows.length)) };
    }
    return { data: [] };
  }),
  create: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => adapter,
  useMetadata: () => ({ objects: registered.objects, ensureType: async () => [] }),
}));

import { AssignedUsersSection } from './AssignedUsersSection';

const memberReads = () => adapter.find.mock.calls.filter(([o]) => o === 'sys_member');

async function mount() {
  render(<AssignedUsersSection permissionSetName="crm_sales_user" />);
  await waitFor(() => expect(screen.getByText('Dana Direct')).toBeInTheDocument());
}

beforeEach(() => {
  picker = null;
  auth.activeOrganization = { id: 'org_1' };
  registered.objects = [{ name: 'sys_user_permission_set' }, { name: 'sys_member' }];
  membershipRead = null;
  members = [
    { id: 'm_1', user_id: 'u_1', organization_id: 'org_1' },
    { id: 'm_3', user_id: 'u_3', organization_id: 'org_1' },
    { id: 'm_9', user_id: 'u_9', organization_id: 'org_2' },
  ];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Remove on a direct grant confirms first and names the person (objectui#13408)', () => {
  it('opens a confirm naming the grantee and sends nothing; Cancel writes nothing', async () => {
    await mount();
    expect(screen.queryByTestId('assigned-user-remove-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByTestId('assigned-user-remove-dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Remove Dana Direct from this permission set?');
    expect(adapter.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('assigned-user-remove-cancel'));
    await waitFor(() => expect(screen.queryByTestId('assigned-user-remove-dialog')).toBeNull());
    expect(adapter.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Dana Direct')).toBeInTheDocument();
  });

  it('deletes the grant row once confirmed', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByTestId('assigned-user-remove-confirm'));
    await waitFor(() => expect(adapter.delete).toHaveBeenCalledWith('sys_user_permission_set', 'grant_1'));
    expect(adapter.delete).toHaveBeenCalledTimes(1);
  });
});

describe("the add picker offers the organization's members only (objectui#13408)", () => {
  it("reads the active organization's membership and hands the picker those users", async () => {
    await mount();
    expect(memberReads()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(picker?.open).toBe(true));
    expect(memberReads()).toEqual([
      ['sys_member', { $filter: { organization_id: 'org_1' }, $top: 500, $skip: 0 }],
    ]);
    expect(picker!.baseFilter).toEqual({ id: { $in: ['u_1', 'u_3'] } });
  });

  it('reads every page of the membership', async () => {
    members = Array.from({ length: 501 }, (_, i) => ({ id: `m_${i}`, user_id: `u_${i}`, organization_id: 'org_1' }));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(picker?.open).toBe(true));
    expect(memberReads().map(([, q]) => (q as { $skip: number }).$skip)).toEqual([0, 500]);
    expect((picker!.baseFilter as { id: { $in: string[] } }).id.$in).toHaveLength(501);
  });

  it("a refused membership read is said in the server's words and the picker stays shut", async () => {
    const sentence = 'Permission denied: sys_member.';
    membershipRead = () => {
      throw new Error(sentence);
    };
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence);
    expect(picker?.open).toBe(false);
  });

  it('an organization with no members says so and opens no picker', async () => {
    members = [];
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This organization has no members to assign yet.');
    expect(picker?.open).toBe(false);
  });

  it('with no active organization the picker opens unfiltered and reads no membership', async () => {
    auth.activeOrganization = null;
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(picker?.open).toBe(true));
    expect(picker!.baseFilter).toBeUndefined();
    expect(memberReads()).toHaveLength(0);
  });

  it('with no `sys_member` registered the picker opens unfiltered and reads no membership', async () => {
    registered.objects = [{ name: 'sys_user_permission_set' }];
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add user' }));
    await waitFor(() => expect(picker?.open).toBe(true));
    expect(picker!.baseFilter).toBeUndefined();
    expect(memberReads()).toHaveLength(0);
  });
});
