/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13330 — Setup → Users on a cloud-managed environment
 * (`features.cloudManaged`, the objectstack-ai/objectstack#25083 ruling, Q1 B
 * and Q3 A), through the real `ObjectView` → `ListView` → `ObjectGrid` chain:
 *
 *   - one line above the list says where people are invited;
 *   - a user who holds no permission set beyond the baseline carries the
 *     「未授权」 marker beside their name, read from the grant rows the server
 *     serves (direct `sys_user_permission_set` rows, and `sys_user_position`
 *     rows whose position lists a set), and a user who holds one does not;
 *   - the identity import entry is not offered.
 *
 * The control (the flag absent or `false`) draws none of the line and the
 * marker, reads no grant rows, and keeps the identity import entry.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => (url: string, init?: RequestInit) => fetch(url, init),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

// The position registry, as the metadata store serves it. One frozen value: a
// fresh context value per render would re-run every effect that names it.
const POSITIONS = [
  { name: 'everyone', permissionSets: ['member_default'] },
  { name: 'guest', permissionSets: [] },
  { name: 'sales_rep', permissionSets: ['sales'] },
  // Lists only the baseline; its holders get the `closer` set by name.
  { name: 'closer', permissionSets: ['member_default'] },
];
const PERMISSION_SETS = [{ name: 'member_default' }, { name: 'sales' }, { name: 'closer' }];
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  const none: never[] = [];
  const store = Object.freeze({
    apps: none,
    objects: none,
    dashboards: none,
    reports: none,
    pages: none,
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async (type: string) => (type === 'position' ? POSITIONS : type === 'permission' ? PERMISSION_SETS : []),
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  });
  return { ...actual, useMetadata: () => store };
});

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const SYS_USER = {
  name: 'sys_user',
  label: 'User',
  pluralLabel: 'Users',
  managedBy: 'better-auth',
  titleFormat: '{name}',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    email: { type: 'email', label: 'Email' },
  },
  listViews: {
    all_users: { name: 'all_users', label: 'All', type: 'grid', columns: ['name', 'email'] },
  },
};

const USERS = [
  { id: 'u_ada', name: 'Ada Baseline', email: 'ada@example.com' },
  { id: 'u_bob', name: 'Bob Direct', email: 'bob@example.com' },
  { id: 'u_cy', name: 'Cy Position', email: 'cy@example.com' },
  { id: 'u_dee', name: 'Dee Expired', email: 'dee@example.com' },
  { id: 'u_eve', name: 'Eve Folded', email: 'eve@example.com' },
];

const GRANTS = [
  // The baseline set, held explicitly: still nothing beyond it.
  { id: 'g1', user_id: 'u_ada', permission_set: 'member_default' },
  { id: 'g2', user_id: 'u_bob', permission_set: 'sales' },
  // A grant whose window closed: not held now.
  { id: 'g3', user_id: 'u_dee', permission_set: 'sales', valid_until: '2020-01-01T00:00:00Z' },
];
const ASSIGNMENTS = [
  { id: 'a1', user_id: 'u_cy', position: 'sales_rep' },
  // Granted the `closer` set by the position's name alone.
  { id: 'a3', user_id: 'u_eve', position: 'closer' },
  // The anchor: every user holds it, and it lists only the baseline.
  { id: 'a2', user_id: 'u_ada', position: 'everyone' },
];

let find: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
  ));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mountUsers(features: Record<string, unknown>) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  find = vi.fn(async (resource: string) => {
    if (resource === 'sys_user_permission_set') return { data: GRANTS, total: GRANTS.length };
    if (resource === 'sys_user_position') return { data: ASSIGNMENTS, total: ASSIGNMENTS.length };
    return { data: USERS, total: USERS.length };
  });
  const dataSource = {
    find,
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => (name === 'sys_user' ? SYS_USER : null)),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Dev Admin' }} features={features}>
        <MemoryRouter initialEntries={['/apps/setup/sys_user/view/all_users']}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={[SYS_USER]} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

/** The row that names `name`, once the grid has drawn it. */
async function rowOf(name: string): Promise<HTMLElement> {
  const cell = await screen.findByText(name, undefined, { timeout: 5000 });
  const row = cell.closest('tr');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

const grantReads = () =>
  find.mock.calls.filter(([resource]) => resource === 'sys_user_permission_set' || resource === 'sys_user_position');

describe('objectui#13330 — Setup → Users on a managed environment', () => {
  it('says where people are invited, in one line above the list', async () => {
    mountUsers({ admin: true, cloudManaged: true });
    const line = await screen.findByTestId('managed-users-invite-line', undefined, { timeout: 5000 });
    expect(line).toHaveTextContent(/Invite people to your organization there/);
  });

  it('marks the users who hold nothing beyond the baseline, and only them', async () => {
    mountUsers({ admin: true, cloudManaged: true });
    for (const name of ['Ada Baseline', 'Dee Expired']) {
      const row = await rowOf(name);
      await waitFor(() => expect(within(row).getByTestId('managed-users-unauthorized')).toHaveTextContent('Not authorized'), {
        timeout: 5000,
      });
    }
    for (const name of ['Bob Direct', 'Cy Position', 'Eve Folded']) {
      expect(within(await rowOf(name)).queryByTestId('managed-users-unauthorized')).toBeNull();
    }
    // One read per object answers the whole page, asked by user.
    const reads = grantReads();
    expect(reads.map(([resource]) => resource).sort()).toEqual(['sys_user_permission_set', 'sys_user_position']);
    expect((reads[0][1] as { $filter: { user_id: { $in: string[] } } }).$filter.user_id.$in.sort()).toEqual(
      ['u_ada', 'u_bob', 'u_cy', 'u_dee', 'u_eve'],
    );
  });

  it('does not offer the identity import', async () => {
    mountUsers({ admin: true, cloudManaged: true });
    await rowOf('Ada Baseline');
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  });
});

describe.each([
  ['absent', { admin: true }],
  ['false', { admin: true, cloudManaged: false }],
])('CONTROL: with the flag %s, Setup → Users is unchanged', (_label, features) => {
  it('draws no invite line and no marker, and reads no grant rows', async () => {
    mountUsers(features);
    await rowOf('Ada Baseline');
    await rowOf('Bob Direct');
    expect(screen.queryByTestId('managed-users-invite-line')).toBeNull();
    expect(screen.queryByTestId('managed-users-unauthorized')).toBeNull();
    expect(grantReads()).toEqual([]);
  });

  it('offers the identity import to an admin', async () => {
    mountUsers(features);
    expect(await screen.findByRole('button', { name: 'Import' }, { timeout: 5000 })).toBeInTheDocument();
  });
});
