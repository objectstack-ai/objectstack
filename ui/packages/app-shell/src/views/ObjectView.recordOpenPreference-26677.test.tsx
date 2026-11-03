/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26677 — how the console object page opens a record is the
 * READER's preference, not metadata.
 *
 * An object opens its records in the drawer, which expands to the full page
 * (maintainer ruling 2026-10-27); how a row opens a drawer-mode record is
 * each reader's own choice, read from `os:record-open-mode`
 * (`utils/recordOpenPreference.ts`). objectstack#28915 retired the split pane
 * beside the list (「默认改抽屉，分屏彻底退役，只留抽屉和整页」). Rows, one
 * mount each, the record opened the way a link opens it (`?recordId=`):
 *
 *   - no preference → the drawer: a dialog-role sheet, nothing beside the list;
 *   - preference `drawer` → the drawer, the same;
 *   - a stored `split` → an unknown value: the drawer, the default;
 *   - preference `page` → a `?recordId=` link still opens the drawer (a row
 *     click is what the page preference changes);
 *   - a view that DECLARES `page` → the declaration wins over the preference:
 *     no drawer is drawn on the list.
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
  await screen.findByTestId('list-view-switcher', undefined, { timeout: 5000 });
  await new Promise((settle) => setTimeout(settle, 80));
}

describe('objectstack#26677 — how a record opens is the reader\'s preference', () => {
  const drawnBesideList = () => screen.queryByTestId('record-split-pane');

  it('objectstack#28915 — no preference: the record opens in the drawer, nothing beside the list', async () => {
    await openRecord(objectsWith());
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(drawnBesideList()).toBeNull();
    expect(screen.queryByTestId('record-count-footer')).toBeNull();
  });

  it('preference `drawer`: the record opens in the drawer, and nothing is drawn beside the list', async () => {
    window.localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, 'drawer');
    await openRecord(objectsWith());
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(drawnBesideList()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close panel' })).toBeNull();
  });

  it('objectstack#28915 — a stored `split` reads as the default: the drawer', async () => {
    window.localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, 'split');
    await openRecord(objectsWith());
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(drawnBesideList()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close panel' })).toBeNull();
  });

  it('preference `page`: a `?recordId=` link still opens the drawer', async () => {
    window.localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, 'page');
    await openRecord(objectsWith());
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
  });

  it('a view that declares `page` keeps its declaration: no drawer over the list', async () => {
    window.localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, 'drawer');
    await openRecord(objectsWith({ mode: 'page' }));
    expect(drawnBesideList()).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
