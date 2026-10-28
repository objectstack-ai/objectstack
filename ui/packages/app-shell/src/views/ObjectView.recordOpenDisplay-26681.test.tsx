/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26681 — the console object page's Display menu writes the
 * reader's record-open preference, and the name cell's ↗ opens the record as
 * the full page.
 *
 * End to end through `ObjectView`, the host that resolves the mode and keeps
 * the preference (`utils/recordOpenPreference.ts`):
 *
 *   - a drawer object: the Open records section draws Drawer | Split; choosing
 *     Split keeps `split` under `os:record-open-mode`, and the next row click
 *     draws the record BESIDE the list (the split face: the list's record-count
 *     footer and the pane's close control) — no reload, no remount;
 *   - a view that declares `page`: the read-only line, no segments, and no ↗
 *     (its rows already open the page);
 *   - the ↗ beside a drawer row's record link is a real anchor to the record route,
 *     and a plain click on it lands there, leaving the preference as it was.
 *
 * The record body is not what this file reads, so `RecordDetailView` is a
 * null sink.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
// The record body: not what this file reads.
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
const ROWS = [{ id: 'r1', name: 'Alpha' }];

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
  window.history.replaceState(null, '', '/');
});

/** Mount the object list, its one row drawn. */
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
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  await screen.findByTestId('primary-field-link', undefined, { timeout: 5000 });
}

function openDisplay() {
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
}

describe('objectstack#26681 — Open records in the Display menu', () => {
  it('a drawer object: choosing Split keeps the preference, and the next row click opens the record beside the list', async () => {
    await openList(objectsWith());
    openDisplay();
    const drawerSegment = await screen.findByRole('radio', { name: 'Drawer' });
    expect(drawerSegment.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Split' }));

    expect(window.localStorage.getItem(RECORD_OPEN_PREFERENCE_KEY)).toBe('split');
    // The section reads the live value back: no reload, no remount.
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Split' }).getAttribute('aria-checked')).toBe('true'),
    );

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('primary-field-link'));
    expect(await screen.findByTestId('record-count-footer', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a drawer object with no choice made: the row opens the drawer', async () => {
    await openList(objectsWith());
    fireEvent.click(screen.getByTestId('primary-field-link'));
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('record-count-footer')).toBeNull();
  });

  it('a view that declares `page`: the read-only line, no segments, and no ↗', async () => {
    window.localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, 'split');
    await openList(objectsWith({ mode: 'page' }));
    expect(screen.queryByTestId('record-open-as-page')).toBeNull();
    openDisplay();
    expect(await screen.findByTestId('display-record-open-declared')).toBeTruthy();
    expect(within(screen.getByTestId('display-record-open')).queryByRole('radio')).toBeNull();
  });

  it('the ↗ beside a drawer row is an anchor to the record route, and a click lands there without changing the preference', async () => {
    await openList(objectsWith());
    const arrow = await screen.findByTestId('record-open-as-page');
    expect(arrow.tagName).toBe('A');
    expect(arrow.getAttribute('href')).toBe(`/apps/demo/${OBJECT_NAME}/record/r1`);
    expect(arrow.getAttribute('aria-label')).toBe('Open as full page');
    expect(arrow.getAttribute('title')).toBe('Open as full page');
    // Beside the row's record link, never inside it.
    const pair = arrow.closest('[data-testid="link-cell-trailing"]') as HTMLElement;
    expect(pair.querySelector('[data-testid="primary-field-link"]')).not.toBeNull();
    expect(arrow.parentElement?.closest('a')).toBeNull();

    fireEvent.click(arrow);
    expect(await screen.findByTestId('record-page-route')).toBeTruthy();
    // Neither the drawer nor the pane opened on the way, and nothing was kept.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(RECORD_OPEN_PREFERENCE_KEY)).toBeNull();
  });
});
