/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26677 — the console object page draws the split pane from the
 * READER's preference, not from metadata.
 *
 * `split` left `NavigationModeSchema` (maintainer ruling 2026-10-27: an object
 * opens its records in the drawer, which expands to the full page; a
 * side-by-side pane is each reader's own choice). The console's `ObjectView`
 * now reads `os:record-open-mode` (`utils/recordOpenPreference.ts`) where it
 * used to read `navOverlay.mode === 'split'`. Three rows, one mount each, the
 * record opened the way a row click opens it (`?recordId=`):
 *
 *   - preference `split` → the split face: the list in the left pane with its
 *     record-count footer (drawn only there) and the pane's own close control;
 *   - no preference → the drawer: a dialog-role sheet, no footer, no pane;
 *   - a view that DECLARES `page` → the declaration wins over the preference:
 *     neither the pane nor the drawer is drawn on the list.
 *
 * The record itself is not what this file reads, so `RecordDetailView` is a
 * null sink.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
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
// The split pane's right half: the record is not what this file reads.
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { RECORD_OPEN_PREFERENCE_KEY } from '../utils/recordOpenPreference';

const OBJECT_NAME = 'duly_task';
const VIEW_ID = `${OBJECT_NAME}.all`;

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
  window.localStorage.removeItem(RECORD_OPEN_PREFERENCE_KEY);
});

/** Mount the object page with one record opened through the URL. */
async function openRecord(objects: ReturnType<typeof objectsWith>) {
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 3 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}?recordId=r1`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  // The list's own page is drawn in every row; the overlay settles after it.
  await screen.findByTestId('view-tab-bar', undefined, { timeout: 5000 });
  await new Promise((settle) => setTimeout(settle, 80));
}

describe('objectstack#26677 — the split pane is the reader\'s preference', () => {
  it('preference `split`: the record opens beside the list', async () => {
    window.localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, 'split');
    await openRecord(objectsWith());
    expect(await screen.findByTestId('record-count-footer', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeTruthy();
  });

  it('no preference: the record opens in the drawer, and nothing is drawn beside the list', async () => {
    await openRecord(objectsWith());
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('record-count-footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close panel' })).toBeNull();
  });

  it('a view that declares `page` keeps its declaration: the preference draws no pane', async () => {
    window.localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, 'split');
    await openRecord(objectsWith({ mode: 'page' }));
    expect(screen.queryByTestId('record-count-footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close panel' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
