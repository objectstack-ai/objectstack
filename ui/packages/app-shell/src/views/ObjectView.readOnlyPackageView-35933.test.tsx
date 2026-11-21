// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35933 — a view a read-only package ships offers an admin no save
 * of its own: no footer calculation menu (objectstack#35702) and no Rename in
 * the list's options menu. A shared view the console saved into the
 * customization package, and the reader's own view, still offer the menu.
 *
 * A dotted view name cannot tell the two apart: every stored view is named
 * `object.key`, the console's own saved views included. What tells them apart
 * is the package the row was served under (`listViews()` carries the item's
 * `_packageId`) and the server's `writable` verdict for that package, read from
 * the session-held package list the Studio entries read (`fetchSessionPackages`).
 * While that verdict is unknown the menu stays offered, as it was before: the
 * server refuses the save and the pick is taken back.
 *
 * What runs: the real `ObjectView` on a stub data source. `ListView` is
 * replaced by a stand-in that records the props it is handed, so the menu's
 * presence is read as the `onColumnSummaryPick` the list receives (the grid
 * draws the menu exactly when it has one, pinned in plugin-grid's
 * `footerCalculationPicker-35702` tests). The package list is stubbed at
 * `fetchSessionPackages`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities: `ListView` names `perms` in its fetch dependencies.
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
  // The shared view's saves are an administrator's.
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

/** The props the list was last handed. */
const listProps = vi.hoisted(() => ({ current: null as Record<string, any> | null }));
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    listProps.current = props;
    return null;
  },
}));

/** The session-held package list, as `GET /api/v1/packages` answers it (parsed). */
const packageList = vi.hoisted(() => ({ answer: (): Promise<any[]> => Promise.resolve([]) }));
vi.mock('./studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSessionPackages: vi.fn(() => packageList.answer()),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT = 'showcase_task';
const SHIPPED_PACKAGE = 'com.example.showcase';
const CUSTOM_PACKAGE = 'com.example.showcase.custom';

/** A view the read-only code package ships, as `listViews()` serves it. */
const SHIPPED = {
  name: `${OBJECT}.in_progress`, object: OBJECT, label: 'In progress', type: 'grid',
  columns: ['name', 'amount'], _packageId: SHIPPED_PACKAGE,
};
/** A shared view the console saved: dotted the same way, in the customization package. */
const CUSTOM = {
  name: `${OBJECT}.team_tasks`, object: OBJECT, label: 'Team tasks', type: 'grid',
  columns: ['name', 'amount'], _packageId: CUSTOM_PACKAGE,
};
/** A stored view bound to no package. */
const UNBOUND = { name: `${OBJECT}.unbound`, object: OBJECT, label: 'Unbound', type: 'grid', columns: ['name', 'amount'] };
/** The reader's own view (`sys_personal_view`). */
const PERSONAL = {
  id: 'pv_mine', user_id: 'u1', object_name: OBJECT, label: 'My tasks',
  config: { type: 'grid', columns: ['name', 'amount'], data: { provider: 'object', object: OBJECT } },
};

/** The packages row for each id: the server's `writable` verdict. */
const PACKAGES = [
  { id: SHIPPED_PACKAGE, name: 'Showcase', writable: false, namespace: 'showcase' },
  { id: CUSTOM_PACKAGE, name: 'Showcase (custom)', writable: true, namespace: 'showcase' },
];

function mount(viewId: string) {
  const dataSource = {
    find: vi.fn(async (resource: string) =>
      resource === 'sys_personal_view' ? { data: [PERSONAL], total: 1 } : { data: [], total: 0 }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: {} })),
    listViews: vi.fn(async () => [SHIPPED, CUSTOM, UNBOUND]),
    updateView: vi.fn(async () => ({})),
  };
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/view/${encodeURIComponent(viewId)}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={
              <ObjectView
                dataSource={dataSource as never}
                objects={[{
                  name: OBJECT,
                  label: 'Task',
                  fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
                }]}
                onEdit={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

/** Whether the list is handed the footer's calculation pick. */
const offersMenu = () => typeof listProps.current?.onColumnSummaryPick === 'function';

beforeEach(() => {
  listProps.current = null;
  packageList.answer = () => Promise.resolve(PACKAGES);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('objectstack#35933 — a read-only package\'s view offers no save of its own', () => {
  it('a view a read-only package ships: no calculation menu, no Rename', async () => {
    mount(SHIPPED.name);
    await settle();
    await waitFor(() => expect(listProps.current).not.toBeNull());
    expect(offersMenu()).toBe(false);
    expect(listProps.current?.onRenameView).toBeUndefined();
  });

  it('a shared view saved into the customization package keeps the menu and Rename', async () => {
    mount(CUSTOM.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
    expect(listProps.current?.columnSummaryPickFields).toEqual(['name', 'amount']);
    expect(typeof listProps.current?.onRenameView).toBe('function');
  });

  it('a stored view bound to no package keeps the menu', async () => {
    mount(UNBOUND.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
  });

  it('the reader\'s own view keeps the menu', async () => {
    mount(PERSONAL.id);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
  });

  it('while the package list is unread, the shipped view keeps the menu (the server still refuses)', async () => {
    packageList.answer = () => new Promise<any[]>(() => {});
    mount(SHIPPED.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
  });

  it('a failed package-list read keeps the menu', async () => {
    packageList.answer = () => Promise.reject(new Error('offline'));
    mount(SHIPPED.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
  });
});
