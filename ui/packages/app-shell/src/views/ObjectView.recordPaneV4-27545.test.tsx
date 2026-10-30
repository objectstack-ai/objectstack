/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27545 — the console object page's record pane v4, end to end
 * through `ObjectView` (maintainer rulings of 2026-10-29):
 *
 * - Target 1: with no choice made the record opens BESIDE the list; the list
 *   stays clickable, a click on another row swaps the record, and the open
 *   row is marked and follows `↓` `↑`.
 * - Target 3: `⤢` maximizes in place — same `?recordId=` URL, no history
 *   entry — and `Esc` restores.
 * - Target 5: a `?recordId=` change (a row click, a step) does not re-render
 *   the list: `ListView` renders are counted across both.
 *
 * The record body is not what this file reads, so `RecordDetailView` is a
 * null sink.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

const counter = vi.hoisted(() => ({ listViewRenders: 0 }));

// The list the page draws, counted: every render of it is one more here.
vi.mock('@object-ui/plugin-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-list')>();
  const { createElement } = await import('react');
  const CountedListView = (props: Record<string, unknown>) => {
    counter.listViewRenders += 1;
    return createElement(actual.ListView as never, props);
  };
  return { ...actual, ListView: CountedListView };
});

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
const ROWS = [
  { id: 'r1', name: 'Alpha' },
  { id: 'r2', name: 'Beta' },
  { id: 'r3', name: 'Gamma' },
];

const objects = [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    listViews: {
      [VIEW_ID]: { name: VIEW_ID, label: 'Everything', type: 'grid', columns: ['name'] },
    },
  },
];

/** Where the router is, and which history entry: a push or a replace moves `key`. */
function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location-search">{location.search}</output>
      <output data-testid="location-key">{location.key}</output>
    </>
  );
}

beforeEach(() => {
  counter.listViewRenders = 0;
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
  window.localStorage.removeItem(RECORD_OPEN_PREFERENCE_KEY);
  window.history.replaceState(null, '', '/');
});

async function openPage(search = '?recordId=r1') {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
  } as never;
  window.history.replaceState(null, '', `/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}`);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}${search}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
            />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  await screen.findByText('Gamma', undefined, { timeout: 5000 });
  await screen.findByTestId('record-split-pane', undefined, { timeout: 5000 });
  // The list reports its rows; the pane's ↑ ↓ step through them.
  await waitFor(() => expect((screen.getByRole('button', { name: 'Next record' }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => {
    await new Promise((settle) => setTimeout(settle, 50));
  });
}

const search = () => screen.getByTestId('location-search').textContent;
const historyKey = () => screen.getByTestId('location-key').textContent;
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
const isOpenRow = (name: string) => rowOf(name).hasAttribute('data-active-record');

describe('Target 1 — the record opens beside a readable, clickable list', () => {
  it('with no choice made: the pane beside the list, the open row marked, no dialog', async () => {
    await openPage();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isOpenRow('Alpha')).toBe(true);
    expect(isOpenRow('Beta')).toBe(false);
  });

  it('a click on another row swaps the record, and the mark moves with it', async () => {
    await openPage();
    fireEvent.click(screen.getByText('Gamma'));
    await waitFor(() => expect(search()).toBe('?recordId=r3'));
    expect(isOpenRow('Gamma')).toBe(true);
    expect(isOpenRow('Alpha')).toBe(false);
    expect(screen.getByTestId('record-split-pane')).toBeTruthy();
  });
});

describe('Target 5 — a `?recordId=` change does not re-render the list', () => {
  it('a ↓ step and a row click leave the ListView render count where it was', async () => {
    await openPage();
    const settled = counter.listViewRenders;
    expect(settled).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Next record' }));
    await waitFor(() => expect(search()).toBe('?recordId=r2'));
    await waitFor(() => expect(isOpenRow('Beta')).toBe(true));
    expect(isOpenRow('Alpha')).toBe(false);

    fireEvent.click(screen.getByText('Gamma'));
    await waitFor(() => expect(search()).toBe('?recordId=r3'));
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 50));
    });
    expect(counter.listViewRenders).toBe(settled);
  });
});

describe('Target 3 — ⤢ maximizes in place', () => {
  it('keeps the URL and the history entry, hides the list, and Esc restores', async () => {
    await openPage();
    const keyBefore = historyKey();
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }));
    const pane = screen.getByTestId('record-split-pane');
    expect(pane.hasAttribute('data-maximized')).toBe(true);
    expect(screen.getByTestId('record-split-list').hasAttribute('inert')).toBe(true);
    expect(search()).toBe('?recordId=r1');
    expect(historyKey()).toBe(keyBefore);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(pane.hasAttribute('data-maximized')).toBe(false);
    expect(search()).toBe('?recordId=r1');
    expect(historyKey()).toBe(keyBefore);
  });
});
