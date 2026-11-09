/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30850 — the console list keeps the page a reader turned to.
 *
 * The record route is a sibling of the list route, so a record opened as a
 * full page unmounts the list, and Back mounts it again. The page now lives in
 * the address (`uf__page`, written with replace), so:
 *
 *   - page 2 → "Open as full page" → Back lands on page 2, and the record
 *     page's own way back carries it too;
 *   - on a phone (≤ 640 px every record opens as a page, objectstack#27058):
 *     the card list's pager turns the same page, and Back lands on it;
 *   - a reload or a copied link opens on the page it names;
 *   - turning the page never adds a history entry;
 *   - a change to the query (here: a search term) sends the list back to page
 *     1 and clears the param, and a page past the end clamps to the last one.
 *
 * Everything that decides it renders for real — this page, `plugin-view`'s
 * `ObjectView`, `plugin-list`'s `ListView` and `plugin-grid`'s grid and card
 * list — under a real router, driven by clicks. The window the list asked for
 * is read at the data source. Only the record body is a stub.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
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
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import '@object-ui/plugin-grid';
// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { LIST_PAGE_PARAM, LIST_SEARCH_PARAM } from './userFilterUrlState';

const OBJ = 'paged_task_30850';
const VIEW_ID = 'all';
const LIST_PATH = `/apps/demo/${OBJ}/view/${VIEW_ID}`;
const PAGE_SIZE = 10;
const TOTAL = 25;
const LAST_PAGE = Math.ceil(TOTAL / PAGE_SIZE);
const ALL_ROWS = Array.from({ length: TOTAL }, (_, i) => ({ id: `t${i + 1}`, name: `Task ${i + 1}` }));

const OBJECTS = [
  {
    name: OBJ,
    label: 'Task',
    pluralLabel: 'Tasks',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
    },
    listViews: {
      [VIEW_ID]: { name: VIEW_ID, label: 'All', type: 'grid', columns: ['name'], pagination: { pageSize: PAGE_SIZE } },
    },
  },
];

/** The windows `ListView` asked for, newest last. The record-count probe (`$top: 0`) is excluded. */
let windows: Array<{ skip: number; search?: string }> = [];

function makeDataSource() {
  return {
    find: vi.fn(async (object: string, params: any) => {
      const top = Number(params?.$top ?? PAGE_SIZE);
      const skip = Number(params?.$skip ?? 0);
      if (object === OBJ && top !== 0) windows.push({ skip, search: params?.$search });
      const matched = params?.$search
        ? ALL_ROWS.filter((r) => r.name.toLowerCase().includes(String(params.$search).toLowerCase()))
        : ALL_ROWS;
      return { data: matched.slice(skip, skip + top), total: matched.length };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
  } as never;
}

const lastWindow = () => windows[windows.length - 1];

/** A window long enough for every effect a step schedules to have fired. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

const PHONE_WIDTH = 390;
const DESKTOP_WIDTH = 1440;
function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

interface Host {
  search: () => URLSearchParams;
  pathname: () => string;
  /** How every navigation after mount was made (`PUSH` / `REPLACE` / `POP`). */
  navigations: () => string[];
  back: () => Promise<void>;
}

async function mountHost(entries: string[]): Promise<Host> {
  const seen: Array<{ type: string; pathname: string; search: string }> = [];
  let navigate: ReturnType<typeof useNavigate> = () => {};
  function Probe() {
    navigate = useNavigate();
    const location = useLocation();
    const type = useNavigationType();
    React.useEffect(() => {
      seen.push({ type, pathname: location.pathname, search: location.search });
    }, [location.key, type, location.pathname, location.search]);
    return null;
  }
  const page = <ObjectView dataSource={makeDataSource()} objects={OBJECTS as any} onEdit={() => {}} />;
  // The list's own record href is built from the DOCUMENT's path
  // (`listRecordDetailUrl`), which a `MemoryRouter` does not move.
  window.history.replaceState(null, '', LIST_PATH);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
          <Probe />
          <Routes>
            <Route path="/elsewhere" element={<div>elsewhere</div>} />
            <Route path="/apps/:appName/:objectName/view/:viewId" element={page} />
            {/* The record route is the list route's SIBLING, as in `AppContent`: opening it unmounts the list. */}
            <Route path="/apps/:appName/:objectName/record/:recordId" element={<output data-testid="record-page-route" />} />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  await settle();
  const mountedAt = seen.length;
  const current = () => seen[seen.length - 1];
  return {
    search: () => new URLSearchParams(current().search),
    pathname: () => current().pathname,
    navigations: () => seen.slice(mountedAt).map((s) => s.type),
    back: async () => {
      await act(async () => { navigate(-1); });
      await settle();
    },
  };
}

/** The table's pager, or the phone card list's (both carry the table's words). */
async function turnToNextPage() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Next page' })[0]);
  await settle();
}

beforeEach(() => {
  windows = [];
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setWidth(DESKTOP_WIDTH);
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the console list keeps the page a reader turned to (objectstack#30850)', () => {
  it('page 2 → open as full page → Back lands on page 2; the turn added no history entry', async () => {
    setWidth(DESKTOP_WIDTH);
    const host = await mountHost(['/elsewhere', LIST_PATH]);
    await screen.findByText('Task 1', undefined, { timeout: 5000 });
    expect(lastWindow().skip).toBe(0);

    await turnToNextPage();
    expect(host.search().get(LIST_PAGE_PARAM)).toBe('2');
    expect(lastWindow().skip).toBe(PAGE_SIZE);
    await screen.findByText('Task 11');
    expect(host.navigations().every((type) => type === 'REPLACE')).toBe(true);

    // The row's ↗ — "Open as full page" — on a row of page 2.
    const row = screen.getByText('Task 11').closest('tr')!;
    fireEvent.click(row.querySelector('[data-testid="record-open-as-page"]')!);
    await screen.findByTestId('record-page-route', undefined, { timeout: 5000 });
    expect(host.pathname()).toBe(`/apps/demo/${OBJ}/record/t11`);
    expect(screen.queryByText('Task 11')).toBeNull();

    windows = [];
    await host.back();
    expect(host.pathname()).toBe(LIST_PATH);
    expect(host.search().get(LIST_PAGE_PARAM)).toBe('2');
    await screen.findByText('Task 11', undefined, { timeout: 5000 });
    // The remounted list asked for page 2 and nothing else.
    expect(windows.map((w) => w.skip)).toEqual(windows.map(() => PAGE_SIZE));
    expect(screen.getByText(`Page 2 of ${LAST_PAGE}`)).toBeTruthy();

    // One more Back leaves the list: turning the page pushed nothing.
    await host.back();
    expect(host.pathname()).toBe('/elsewhere');
  });

  it('on a phone the card list turns the same page, and Back from the record page lands on it', async () => {
    setWidth(PHONE_WIDTH);
    const host = await mountHost(['/elsewhere', LIST_PATH]);
    await screen.findByText('Task 1', undefined, { timeout: 5000 });
    // A phone pages; it does not load more on scroll.
    expect(screen.getByTestId('object-grid-card-pager')).toBeTruthy();

    await turnToNextPage();
    expect(host.search().get(LIST_PAGE_PARAM)).toBe('2');
    await screen.findByText('Task 11');

    fireEvent.click(screen.getByText('Task 12'));
    await screen.findByTestId('record-page-route', undefined, { timeout: 5000 });
    expect(host.pathname()).toBe(`/apps/demo/${OBJ}/record/t12`);

    windows = [];
    await host.back();
    expect(host.search().get(LIST_PAGE_PARAM)).toBe('2');
    await screen.findByText('Task 12', undefined, { timeout: 5000 });
    expect(windows.map((w) => w.skip)).toEqual(windows.map(() => PAGE_SIZE));
    expect(screen.getByTestId('object-grid-card-page-info').textContent).toBe(`Page 2 of ${LAST_PAGE}`);
  });

  it('a reload or a copied link opens on the page it names', async () => {
    const host = await mountHost([`${LIST_PATH}?${LIST_PAGE_PARAM}=3`]);
    await screen.findByText('Task 21', undefined, { timeout: 5000 });
    expect(windows.map((w) => w.skip)).toEqual(windows.map(() => 2 * PAGE_SIZE));
    expect(host.search().get(LIST_PAGE_PARAM)).toBe('3');
  });

  it('a change to the query sends the list back to page 1 and clears the param', async () => {
    const host = await mountHost([`${LIST_PATH}?${LIST_PAGE_PARAM}=2`]);
    await screen.findByText('Task 11', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('search-icon-button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Task 1' } });
    await settle();
    await waitFor(() => expect(host.search().get(LIST_SEARCH_PARAM)).toBe('Task 1'));
    expect(host.search().has(LIST_PAGE_PARAM)).toBe(false);
    expect(lastWindow()).toEqual({ skip: 0, search: 'Task 1' });
  });

  it('a page past the end clamps to the last reachable one, and the address follows', async () => {
    const host = await mountHost([`${LIST_PATH}?${LIST_PAGE_PARAM}=40`]);
    await screen.findByText('Task 25', undefined, { timeout: 5000 });
    expect(host.search().get(LIST_PAGE_PARAM)).toBe(String(LAST_PAGE));
    expect(lastWindow().skip).toBe((LAST_PAGE - 1) * PAGE_SIZE);
  });

  it('CONTROL: a value that is not a page opens page 1', async () => {
    await mountHost([`${LIST_PATH}?${LIST_PAGE_PARAM}=two`]);
    await screen.findByText('Task 1', undefined, { timeout: 5000 });
    expect(windows.every((w) => w.skip === 0)).toBe(true);
  });
});
