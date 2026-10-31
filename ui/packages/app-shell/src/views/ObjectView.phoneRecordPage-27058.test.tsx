/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27058, Targets 1 and 2 — on a phone the console's object list
 * opens a record as a page, always, end to end through `ObjectView`:
 *
 *  - a row tap lands on the record route, handed the list as its way back and
 *    its rows as the page's ↓ ↑ set; no pane and no drawer is mounted on the
 *    way;
 *  - a `?recordId=` link (a shared pane URL) is replaced by the record page,
 *    so Back does not return to a URL that reopens it;
 *  - a reader's split or drawer preference draws nothing on a phone, and the
 *    Display menu has no Open records section to set one;
 *  - control: at 1440 px the same `?recordId=` opens the pane beside the list.
 *
 * The record body is not what this file reads, so `RecordDetailView` is a
 * null sink.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
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
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => <div data-testid="record-body" /> }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { RECORD_OPEN_PREFERENCE_KEY } from '../utils/recordOpenPreference';

const OBJECT_NAME = 'duly_task';
const VIEW_ID = `${OBJECT_NAME}.all`;
const LIST_PATH = `/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}`;
const ROWS = [
  { id: 'r1', name: 'Alpha' },
  { id: 'r2', name: 'Beta' },
  { id: 'r3', name: 'Gamma' },
];

const objects = [
  {
    name: OBJECT_NAME,
    label: 'Task',
    pluralLabel: 'Tasks',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    listViews: {
      [VIEW_ID]: { name: VIEW_ID, label: 'Everything', type: 'grid', columns: ['name'] },
    },
  },
];

const PHONE_WIDTH = 390;
const DESKTOP_WIDTH = 1440;

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

/** Where the router is, how it got there, and the history state. */
function LocationProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="navigation-type">{navigationType}</output>
      <output data-testid="location-state">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
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
  vi.restoreAllMocks();
  setWidth(DESKTOP_WIDTH);
  window.localStorage.removeItem(RECORD_OPEN_PREFERENCE_KEY);
  window.history.replaceState(null, '', '/');
});

function mountList(search = '') {
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
  window.history.replaceState(null, '', LIST_PATH);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        <MemoryRouter initialEntries={[`${LIST_PATH}${search}`]}>
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
}

const location = () => screen.getByTestId('location').textContent;
const locationState = () => JSON.parse(screen.getByTestId('location-state').textContent ?? 'null');
const noRecordSurface = () => {
  expect(screen.queryByTestId('record-split-pane')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByTestId('record-body')).toBeNull();
};

describe('on a phone a record opens as a page, always (objectstack#27058)', () => {
  it('a row tap lands on the record page, with the list as its way back and its rows as ↓ ↑', async () => {
    setWidth(PHONE_WIDTH);
    mountList();
    await screen.findByText('Gamma', undefined, { timeout: 5000 });
    noRecordSurface();
    fireEvent.click(screen.getByText('Gamma'));
    await screen.findByTestId('record-page-route', undefined, { timeout: 5000 });
    expect(location()).toBe(`/apps/demo/${OBJECT_NAME}/record/r3`);
    const from = locationState()?.from;
    expect(from?.pathname).toBe(LIST_PATH);
    expect(from?.siblings).toEqual(['r1', 'r2', 'r3']);
  });

  it('a ?recordId= link is replaced by the record page', async () => {
    setWidth(PHONE_WIDTH);
    mountList('?recordId=r2');
    await screen.findByTestId('record-page-route', undefined, { timeout: 5000 });
    expect(location()).toBe(`/apps/demo/${OBJECT_NAME}/record/r2`);
    expect(screen.getByTestId('navigation-type').textContent).toBe('REPLACE');
    expect(screen.queryByTestId('record-split-pane')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([['split'], ['drawer']])('a reader who prefers %s: nothing is drawn beside the list, and the Display menu offers no Open records', async (preference) => {
    window.localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, preference);
    setWidth(PHONE_WIDTH);
    mountList();
    await screen.findByText('Alpha', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    // The menu is open (its other sections draw) and holds no Open records.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.queryByTestId('display-record-open')).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByText('Alpha'));
    await screen.findByTestId('record-page-route', undefined, { timeout: 5000 });
    expect(location()).toBe(`/apps/demo/${OBJECT_NAME}/record/r1`);
    expect(window.localStorage.getItem(RECORD_OPEN_PREFERENCE_KEY)).toBe(preference);
  });

  it('control: at 1440 px the same ?recordId= opens the pane beside the list', async () => {
    setWidth(DESKTOP_WIDTH);
    mountList('?recordId=r2');
    await screen.findByTestId('record-split-pane', undefined, { timeout: 5000 });
    expect(location()).toBe(`${LIST_PATH}?recordId=r2`);
    expect(screen.queryByTestId('record-page-route')).toBeNull();
  });
});
