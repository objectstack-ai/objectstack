// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35974 — on a list view a read-only package ships, the admin's
 * "configure view" panel is read-only (no Save) and Manage views offers no
 * pin, no set-as-default and no delete for it: the server refuses each of
 * those writes ("save it into the customization package"). A shared view the
 * console saved into the customization package and the reader's own view are
 * unchanged, and while the package's `writable` verdict is unknown (unread,
 * failed read) everything stays offered as before.
 *
 * The verdict is objectstack#35933's: the package the row was served under
 * (`listViews()` carries `_packageId`) and the session-held package list
 * (`fetchSessionPackages`), stubbed here.
 *
 * What runs: the real `ObjectView` on a stub data source. `ListView` is a
 * stand-in (the list itself is not under test). The real `ManageViewsDialog`
 * renders, held open, so the row affordances are read from the DOM, and its
 * "View config" entry is clicked through to the panel. The view panel is a
 * stand-in recording the props it is handed: its own read-only face is pinned
 * in `ViewConfigPanel.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor, screen, fireEvent } from '@testing-library/react';
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
  // Manage views and the view panel are an administrator's.
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

vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));

// The real dialog, held open: the host opens it from the title switcher.
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-view')>();
  const Dialog = actual.ManageViewsDialog;
  return {
    ...actual,
    ManageViewsDialog: (props: React.ComponentProps<typeof Dialog>) => (
      <Dialog {...props} open onOpenChange={() => {}} />
    ),
  };
});

/** The props the view panel was last handed. */
const panelProps = vi.hoisted(() => ({ current: null as Record<string, any> | null }));
vi.mock('./ViewConfigPanel', () => ({
  ViewConfigPanel: (props: any) => {
    panelProps.current = props;
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
    listViews: vi.fn(async () => [SHIPPED, CUSTOM]),
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

/** The write affordances Manage views draws on a row: pin, set default, the ⋯ menu (rename, delete). */
const rowOffers = (id: string) => ({
  pin: screen.queryByTestId(`manage-views-pin-${id}`) !== null,
  setDefault: screen.queryByTestId(`manage-views-default-${id}`) !== null,
  menu: screen.queryByTestId(`manage-views-actions-${id}`) !== null,
});

const OFFERED = { pin: true, setDefault: true, menu: true };

beforeEach(() => {
  panelProps.current = null;
  packageList.answer = () => Promise.resolve(PACKAGES);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('objectstack#35974 — a read-only package\'s view: read-only panel, no Manage views writes', () => {
  it('Manage views offers no pin, set default or delete on the shipped view, and keeps them on the custom one', async () => {
    mount(CUSTOM.name);
    await settle();
    await waitFor(() => expect(screen.getByTestId(`manage-views-row-${SHIPPED.name}`)).toBeTruthy());
    // The ⋯ menu stays, holding only "View config" (next case).
    await waitFor(() => expect(rowOffers(SHIPPED.name)).toEqual({ pin: false, setDefault: false, menu: true }));
    expect(screen.getByTestId(`manage-views-readonly-${SHIPPED.name}`)).toBeTruthy();
    expect(rowOffers(CUSTOM.name)).toEqual(OFFERED);
  });

  it('the shipped row\'s "View config" entry opens the panel on that view, read-only', async () => {
    mount(CUSTOM.name);
    await settle();
    const trigger = await waitFor(() => screen.getByTestId(`manage-views-actions-${SHIPPED.name}`));
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const entry = await waitFor(() => screen.getByTestId(`manage-views-action-config-${SHIPPED.name}`));
    expect(entry.textContent).toContain('View config');
    // Nothing else of the row's menu: no rename, set default, pin or delete.
    for (const key of ['rename', 'default', 'pin', 'delete']) {
      expect(screen.queryByTestId(`manage-views-action-${key}-${SHIPPED.name}`)).toBeNull();
    }
    fireEvent.click(entry);
    await waitFor(() => expect(panelProps.current?.open).toBe(true));
    await waitFor(() => expect(panelProps.current?.activeView?.id).toBe(SHIPPED.name));
    await waitFor(() => expect(panelProps.current?.readOnly).toBe(true));
    expect(panelProps.current?.mode).toBe('edit');
  });

  it('the custom row\'s entry still reads "Edit view config" and opens the panel savable', async () => {
    mount(SHIPPED.name);
    await settle();
    const trigger = await waitFor(() => screen.getByTestId(`manage-views-actions-${CUSTOM.name}`));
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const entry = await waitFor(() => screen.getByTestId(`manage-views-action-config-${CUSTOM.name}`));
    expect(entry.textContent).toContain('Edit view config');
    fireEvent.click(entry);
    await waitFor(() => expect(panelProps.current?.activeView?.id).toBe(CUSTOM.name));
    await waitFor(() => expect(panelProps.current?.open).toBe(true));
    expect(panelProps.current?.readOnly).toBe(false);
  });

  it('the panel opens on the shipped view read-only', async () => {
    mount(SHIPPED.name);
    await settle();
    await waitFor(() => expect(panelProps.current?.activeView?.id).toBe(SHIPPED.name));
    await waitFor(() => expect(panelProps.current?.readOnly).toBe(true));
  });

  it('the panel on a shared view saved into the customization package is not read-only', async () => {
    mount(CUSTOM.name);
    await settle();
    await waitFor(() => expect(panelProps.current?.activeView?.id).toBe(CUSTOM.name));
    expect(panelProps.current?.readOnly).toBe(false);
  });

  it('on the reader\'s own view the panel is not read-only and Manage views is unchanged', async () => {
    mount(PERSONAL.id);
    await settle();
    await waitFor(() => expect(panelProps.current?.activeView?.id).toBe(PERSONAL.id));
    expect(panelProps.current?.readOnly).toBe(false);
    // My views are no row of Manage views; the shared rows are judged as ever.
    expect(screen.queryByTestId(`manage-views-row-${PERSONAL.id}`)).toBeNull();
    await waitFor(() => expect(rowOffers(SHIPPED.name).pin).toBe(false));
    expect(rowOffers(CUSTOM.name)).toEqual(OFFERED);
  });

  it('while the package list is unread, the shipped view keeps every offer (the server still refuses)', async () => {
    packageList.answer = () => new Promise<any[]>(() => {});
    mount(SHIPPED.name);
    await settle();
    await waitFor(() => expect(screen.getByTestId(`manage-views-row-${SHIPPED.name}`)).toBeTruthy());
    expect(rowOffers(SHIPPED.name)).toEqual(OFFERED);
    expect(panelProps.current?.readOnly).toBe(false);
  });

  it('a failed package-list read keeps every offer', async () => {
    packageList.answer = () => Promise.reject(new Error('offline'));
    mount(SHIPPED.name);
    await settle();
    await waitFor(() => expect(screen.getByTestId(`manage-views-row-${SHIPPED.name}`)).toBeTruthy());
    expect(rowOffers(SHIPPED.name)).toEqual(OFFERED);
    expect(panelProps.current?.readOnly).toBe(false);
  });
});
