/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35854 — a Console object list opens a record ONE way, for every
 * reader and every list (maintainer 2026-11-20: 「鼠标滑到…行，右侧显示一个右侧
 * 打开的图标，点击才从右侧打开，否则都是进全屏打开。这样就不需要任何设置」).
 * It retires the Display menu's 「Open records: Drawer / Full page」
 * (objectstack#26681) and the stored preference behind it (objectstack#26677).
 *
 * End to end through `ObjectView`:
 *
 *   - the record's name opens the full page, carrying where it came from
 *     (`location.state.from`: the list URL, the view's label, the rows in
 *     order and the matched total);
 *   - the icon beside the name opens the side panel over the list;
 *   - the Display menu holds no Open records section;
 *   - a view declaring `navigation.mode: 'page' | 'drawer'` behaves as one
 *     declaring nothing (the key is deprecated), while `'none'` still opens
 *     nothing.
 *
 * The record body is not what this file reads, so `RecordDetailView` is a
 * null sink.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { render, cleanup, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
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
// The record body: not what this file reads.
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';
const VIEW_ID = `${OBJECT_NAME}.all`;
const ROWS = [{ id: 'r1', name: 'Alpha' }, { id: 'r2', name: 'Beta' }];

const objectsWith = (navigation?: Record<string, unknown>) => [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    listViews: {
      [VIEW_ID]: {
        name: VIEW_ID,
        label: 'Everything',
        type: 'grid',
        columns: ['name'],
        ...(navigation ? { navigation } : {}),
      },
    },
  },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

/** Where the router is, and the history state it carries. */
function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{location.pathname + location.search}</output>
      <output data-testid="location-state">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

const location = () => screen.getByTestId('location').textContent;
const locationState = () => JSON.parse(screen.getByTestId('location-state').textContent ?? 'null');
const LIST_PATH = `/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}`;

/** Mount the object list, its rows drawn. */
async function openList(objects: ReturnType<typeof objectsWith>) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
  } as never;
  // The list's own record href is built from the DOCUMENT's path
  // (`listRecordDetailUrl`), which a `MemoryRouter` does not move.
  window.history.replaceState(null, '', `/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}`);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
            />
            <Route
              path="/apps/:appName/:objectName/record/:recordId"
              element={<output data-testid="record-page-route">record page</output>}
            />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  await screen.findByText('Alpha', undefined, { timeout: 5000 });
}

const nameLink = (name: string) => screen.getByText(name).closest('[data-testid="primary-field-link"]') as HTMLElement;
const panelIconOf = (name: string) =>
  within(nameLink(name).closest('[data-testid="link-cell-trailing"]') as HTMLElement).getByTestId('record-open-in-panel');

describe('a list opens a record one way: the name opens the page, the icon beside it the side panel', () => {
  it('the name opens the full page, carrying the list it came from', async () => {
    await openList(objectsWith());
    fireEvent.click(nameLink('Beta'));
    expect(await screen.findByTestId('record-page-route', undefined, { timeout: 5000 })).toBeTruthy();
    expect(location()).toBe(`/apps/demo/${OBJECT_NAME}/record/r2`);
    expect(screen.queryByRole('dialog')).toBeNull();
    const from = locationState()?.from;
    expect(from?.pathname).toBe(LIST_PATH);
    expect(from?.label).toBe('Everything');
    expect(from?.siblings).toEqual(['r1', 'r2']);
    expect(from?.total).toBe(2);
  });

  it('the icon beside the name opens the side panel over the list, which stays', async () => {
    await openList(objectsWith());
    const icon = panelIconOf('Alpha');
    expect(icon.tagName).toBe('BUTTON');
    expect(icon.getAttribute('aria-label')).toBe('Open in side panel');
    expect(icon.getAttribute('title')).toBe('Open in side panel');
    // Beside the row's record link, never inside it.
    expect(icon.closest('a')).toBeNull();
    fireEvent.click(icon);
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(location()).toBe(`${LIST_PATH}?recordId=r1`);
    expect(screen.getByTestId('record-list-host')).toBeTruthy();
    expect(screen.queryByTestId('record-page-route')).toBeNull();
  });

  it('the Display menu holds no Open records section, and no reader setting is kept', async () => {
    await openList(objectsWith());
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    await screen.findByTestId('view-settings-content');
    expect(screen.queryByTestId('display-record-open')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Drawer' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Full page' })).toBeNull();
    expect(window.localStorage.getItem('os:record-open-mode')).toBeNull();
  });

  it.each([['page'], ['drawer'], ['new_window']])(
    'a view declaring the deprecated `navigation.mode: %s` opens the same way as one declaring nothing',
    async (mode) => {
      await openList(objectsWith({ mode }));
      fireEvent.click(panelIconOf('Alpha'));
      expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
      fireEvent.click(nameLink('Beta'));
      expect(await screen.findByTestId('record-page-route', undefined, { timeout: 5000 })).toBeTruthy();
      expect(location()).toBe(`/apps/demo/${OBJECT_NAME}/record/r2`);
    },
  );

  it.each([[{ mode: 'none' }], [{ preventNavigation: true }]])(
    'a view declaring %j opens nothing: no icon, and the name stays put',
    async (navigation) => {
      await openList(objectsWith(navigation));
      expect(screen.queryAllByTestId('record-open-in-panel')).toHaveLength(0);
      const name = screen.queryByText('Alpha');
      if (name) fireEvent.click(name);
      expect(location()).toBe(LIST_PATH);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByTestId('record-page-route')).toBeNull();
    },
  );
});
