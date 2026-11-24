// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36011 — Manage views restores the factory version of a view a
 * read-only package ships, after a pin, a rename or a set-default wrote the
 * view into the package's customization pair (ruling record 7058654416 keeps
 * those three on such a view).
 *
 * A row the list serves with the override declaration naming the package it
 * is served under (`overrides`, ADR-0146 D2) is marked "customized" and
 * offers "Restore factory version". One confirm says every user of the view
 * sees the factory version again; on confirm the host calls the adapter's
 * `restoreFactoryView`, reads the views again and shows the package's own
 * view. A view without a customization offers no restore. A refused restore
 * says why, with the door's message.
 *
 * What runs: the real `ObjectView` and the real `ManageViewsDialog` (held
 * open), under the real English `I18nProvider`, on a stub data source whose
 * list answers what the server stores: the pin writes the override, the
 * restore removes it. `ListView` and the view panel are stand-ins.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor, screen, fireEvent, within } from '@testing-library/react';
import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
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

vi.mock('./ViewConfigPanel', () => ({ ViewConfigPanel: () => null }));

/** The session-held package list, as `GET /api/v1/packages` answers it (parsed). */
const packageList = vi.hoisted(() => ({ answer: (): Promise<any[]> => Promise.resolve([]) }));
vi.mock('./studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSessionPackages: vi.fn(() => packageList.answer()),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT = 'showcase_task';
const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const VIEW = `${OBJECT}.in_progress`;
const OTHER = `${OBJECT}.done`;

/** The package's own view, as `listViews()` serves it. */
const factory = (name: string, label: string) => ({
  name, object: OBJECT, label, type: 'grid', columns: ['name', 'amount'], _packageId: BASE,
});

const PACKAGES = [
  { id: BASE, name: 'Showcase', writable: false, namespace: 'showcase' },
  { id: PAIR, name: 'Showcase (custom)', writable: true, namespace: 'showcase' },
];

/**
 * The stored state behind the stub: the pair's override of VIEW, or none.
 * `updateView` writes the override (served under the base, declaring it);
 * `restoreFactoryView` removes it, or throws `refusal` when one is set.
 */
function makeDataSource(opts: { refusal?: Error } = {}) {
  let override: Record<string, unknown> | null = null;
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: {} })),
    listViews: vi.fn(async () => [override ?? factory(VIEW, 'In progress'), factory(OTHER, 'Done')]),
    updateView: vi.fn(async (_object: string, name: string, patch: Record<string, unknown>) => {
      if (name !== VIEW) throw new Error('only VIEW is customized in this test');
      override = { ...factory(VIEW, 'In progress'), ...(override ?? {}), ...patch, overrides: { package: BASE, basedOn: '0.1.0' } };
      return override;
    }),
    restoreFactoryView: vi.fn(async () => {
      if (opts.refusal) throw opts.refusal;
      override = null;
      return { deleted: true };
    }),
  };
  return dataSource;
}

function mount(dataSource: ReturnType<typeof makeDataSource>) {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/view/${encodeURIComponent(OTHER)}`]}>
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
      </ExpressionProvider>
    </I18nProvider>,
  );
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

async function openMenu(id: string) {
  const trigger = await waitFor(() => screen.getByTestId(`manage-views-actions-${id}`));
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
}
async function closeMenu() {
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}
/** Whether the row offers a restore, read by opening its menu. */
async function offersRestore(id: string): Promise<boolean> {
  await openMenu(id);
  const offered = screen.queryByTestId(`manage-views-action-restore-${id}`) !== null;
  await closeMenu();
  return offered;
}
const marked = (id: string) => screen.queryByTestId(`manage-views-customized-${id}`) !== null;

/** Pin VIEW from its row: the write that creates the override. */
async function pin() {
  await waitFor(async () => expect((await rowReady(VIEW))).toBe(true));
  fireEvent.click(screen.getByTestId(`manage-views-pin-${VIEW}`));
}
async function rowReady(id: string) {
  // The row is a read-only package's once its configuration reads "View config".
  await openMenu(id);
  const label = screen.queryByTestId(`manage-views-action-config-${id}`)?.textContent?.trim();
  await closeMenu();
  return label === 'View config';
}

/** Click the row's restore, and answer the confirm (`true` confirms). */
async function restore(confirm: boolean) {
  await openMenu(VIEW);
  fireEvent.click(screen.getByTestId(`manage-views-action-restore-${VIEW}`));
  const dialog = await screen.findByRole('alertdialog');
  const text = dialog.textContent ?? '';
  const button = within(dialog).getByRole('button', { name: confirm ? 'Restore' : 'Cancel' });
  await act(async () => { fireEvent.click(button); });
  return text;
}

beforeEach(() => {
  packageList.answer = () => Promise.resolve(PACKAGES);
  localStorage.clear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('objectstack#36011 — restore the factory version of a customized package view', () => {
  it('pin a factory view, then restore it: the override is removed and the list shows the package\'s own view', async () => {
    const dataSource = makeDataSource();
    mount(dataSource);
    await settle();
    // Before: the package's own view, unmarked, no restore.
    await waitFor(async () => expect(await rowReady(VIEW)).toBe(true));
    expect(marked(VIEW)).toBe(false);
    expect(await offersRestore(VIEW)).toBe(false);

    await pin();
    expect(dataSource.updateView).toHaveBeenCalledWith(OBJECT, VIEW, { isPinned: true });
    await waitFor(() => expect(marked(VIEW)).toBe(true));
    expect(await offersRestore(VIEW)).toBe(true);
    // The uncustomized view beside it offers none.
    expect(marked(OTHER)).toBe(false);
    expect(await offersRestore(OTHER)).toBe(false);

    const said = await restore(true);
    expect(said).toContain('Everyone who uses this view will see the factory version again');
    expect(said).toContain('In progress');
    await waitFor(() => expect(dataSource.restoreFactoryView).toHaveBeenCalledWith(OBJECT, VIEW));
    // The views are read again: the factory view, unmarked and unpinned.
    await waitFor(() => expect(marked(VIEW)).toBe(false));
    expect(screen.getByTestId(`manage-views-pin-${VIEW}`).getAttribute('aria-label')).toBe('Pin View');
    expect(await offersRestore(VIEW)).toBe(false);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a cancelled confirm removes nothing', async () => {
    const dataSource = makeDataSource();
    mount(dataSource);
    await settle();
    await pin();
    await waitFor(() => expect(marked(VIEW)).toBe(true));

    await restore(false);
    await settle();
    expect(dataSource.restoreFactoryView).not.toHaveBeenCalled();
    expect(marked(VIEW)).toBe(true);
  });

  it('a refused restore says why, with the door\'s message, and the view stays customized', async () => {
    const reason = 'Deleting metadata requires the Manage Metadata permission';
    const dataSource = makeDataSource({ refusal: Object.assign(new Error(reason), { status: 403, code: 'PERMISSION_DENIED' }) });
    mount(dataSource);
    await settle();
    await pin();
    await waitFor(() => expect(marked(VIEW)).toBe(true));

    await restore(true);
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [title, options] = vi.mocked(toast.error).mock.calls[0] as [string, { description?: string }];
    expect(title).toBe('Failed to restore the factory version');
    expect(options.description).toContain(reason);
    expect(toast.success).not.toHaveBeenCalled();
    expect(marked(VIEW)).toBe(true);
  });
});
