/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27057 — on the console object page a calendar event, a gantt
 * bar and a kanban card open the same record page a grid row opens.
 *
 * The maintainer ruling of 2026-10-27 gives each object one way of opening a
 * record: the drawer, which is the record page at a narrower width (with ⤢ to
 * the full page), or `page` where the object or view declares it. In the
 * console that page is `RecordDetailView`, mounted `embedded` in the drawer
 * stack. The calendar and the gantt used to answer their own clicks with the
 * quick-look `RecordDetailPanel` instead, because their drawer outranked the
 * host's `onRowClick` (and the gantt's registration never forwarded one).
 *
 * This file is the join, and the console is where it can be made: it is the
 * only package that holds the object page (`app-shell`) and all three
 * renderers. The renderers are REAL; only the record itself is a sink, since
 * what is read here is which surface the click reached, not what the record
 * page draws. The sink reports its overrides and carries one link that opens
 * a second record through the drawer stack, as a related row or a lookup on
 * the real page does.
 *
 * Rows, one mount each:
 *   - calendar event, gantt bar (its open control), kanban card → the URL
 *     carries `?recordId=`, the record page opens `embedded` on that record,
 *     and the quick-look panel never mounts;
 *   - from the calendar, a link on the page → a second level, with the trail;
 *   - a calendar view that declares `page` → the page route, and no drawer.
 *
 * REVERSE VERIFICATION, run both ways: restore the calendar's suppression
 * (the host's `onRowClick` dropped whenever its mode is the drawer) and the
 * three calendar rows go red, 3 failed / 2 passed. The `page` row is one of
 * them, which was not predicted: `ListView` puts no `navigation` on the
 * calendar's node, so the calendar's own mode was always the drawer and the
 * old guard swallowed a view's authored `page` along with the host's click.
 * Drop the gantt registration's `onRowClick` and only the gantt row goes red,
 * 1 failed / 4 passed. The kanban row stays green in both: it is the CONTROL,
 * already the host's.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { SchemaRendererProvider } from '@object-ui/react';

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

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  // The quick-look payload of the calendar's and the gantt's own drawer.
  RecordDetailPanel: ({ recordId }: { recordId: string | number }) => (
    <div data-testid="quick-look-panel" data-record-id={String(recordId)} />
  ),
}));

vi.mock('../../../../packages/app-shell/src/views/MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

vi.mock('../../../../packages/app-shell/src/views/metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

// The one record page, as a sink: which record it was handed, whether it is
// the embedded face, and a record link that opens through the drawer stack.
vi.mock('../../../../packages/app-shell/src/views/RecordDetailView', async () => {
  const { useRecordDrawer } = await import('../../../../packages/app-shell/src/views/recordDrawerContext');
  return {
    RecordDetailView: ({ objectNameOverride, recordIdOverride, embedded }: Record<string, unknown>) => {
      const drawer = useRecordDrawer();
      return (
        <div
          data-testid="record-page"
          data-object={String(objectNameOverride)}
          data-record-id={String(recordIdOverride)}
          data-embedded={String(!!embedded)}
        >
          <button type="button" onClick={() => drawer?.open(OBJECT_NAME, '2', { fromTitle: 'Ada onboarding' })}>
            open related
          </button>
        </div>
      );
    },
  };
});

import '@object-ui/plugin-list';
import '@object-ui/plugin-calendar';
import '@object-ui/plugin-gantt';
import '@object-ui/plugin-kanban';
import { ObjectView, ExpressionProvider } from '@object-ui/app-shell';

const OBJECT_NAME = 'duly_task';

// Inside the month the calendar opens on, so its events are drawn.
const now = new Date();
const day = (d: number) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const ROWS = [
  { id: '1', name: 'Ada onboarding', status: 'open', start_date: day(10), end_date: day(12) },
  { id: '2', name: 'Grace onboarding', status: 'open', start_date: day(14), end_date: day(15) },
];

const VIEWS: Record<string, Record<string, unknown>> = {
  calendar: { type: 'calendar', calendar: { startDateField: 'start_date', titleField: 'name' } },
  gantt: { type: 'gantt', gantt: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'name' } },
  kanban: { type: 'kanban', kanban: { groupByField: 'status' } },
};

const objectsWith = (viewKey: string, navigation?: Record<string, unknown>) => [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
      start_date: { type: 'date', label: 'Start' },
      end_date: { type: 'date', label: 'End' },
    },
    listViews: {
      [`${OBJECT_NAME}.${viewKey}`]: {
        name: `${OBJECT_NAME}.${viewKey}`,
        label: viewKey,
        columns: ['name'],
        ...VIEWS[viewKey],
        ...(navigation ? { navigation } : {}),
      },
    },
  },
];

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location" data-path={location.pathname} data-search={location.search} />;
}

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
});

/** Mount the object page on one view, with no record open. */
async function mountView(viewKey: string, navigation?: Record<string, unknown>) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => ROWS[0]),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  const objects = objectsWith(viewKey, navigation);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        {/* The console shell's provider: the renderers read the data source from it. */}
        <SchemaRendererProvider dataSource={dataSource}>
          <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${OBJECT_NAME}.${viewKey}`]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/view/:viewId"
                element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
              />
              <Route path="*" element={null} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </SchemaRendererProvider>
      </ExpressionProvider>
    </I18nProvider>,
  );
  await screen.findByTestId('view-tab-bar', undefined, { timeout: 5000 });
}

/** The record page is open, embedded, on record `id` — and the quick-look is not. */
async function expectRecordPage(id: string) {
  const page = await screen.findByTestId('record-page', undefined, { timeout: 5000 });
  expect(page.getAttribute('data-object')).toBe(OBJECT_NAME);
  expect(page.getAttribute('data-record-id')).toBe(id);
  expect(page.getAttribute('data-embedded')).toBe('true');
  expect(new URLSearchParams(screen.getByTestId('location').getAttribute('data-search') ?? '').get('recordId')).toBe(id);
  expect(screen.queryByTestId('quick-look-panel')).toBeNull();
}

describe('objectstack#27057 — every view opens the one record page on the console object page', () => {
  it('a calendar event opens the record page in the drawer', async () => {
    await mountView('calendar');
    fireEvent.click(await screen.findByText('Ada onboarding', undefined, { timeout: 5000 }));
    await expectRecordPage('1');
  });

  it('a gantt bar opens the record page in the drawer', async () => {
    await mountView('gantt');
    // The bar's open control: a click on the bar itself only selects it.
    fireEvent.click(await screen.findByTestId('gantt-row-open-1', undefined, { timeout: 5000 }));
    await expectRecordPage('1');
  });

  it('CONTROL: a kanban card opens the record page in the drawer, as it did before', async () => {
    await mountView('kanban');
    fireEvent.click(await screen.findByText('Ada onboarding', undefined, { timeout: 5000 }));
    await expectRecordPage('1');
  });

  it('from a calendar event, a record link on the page opens one level down, with the trail', async () => {
    await mountView('calendar');
    fireEvent.click(await screen.findByText('Ada onboarding', undefined, { timeout: 5000 }));
    await expectRecordPage('1');

    fireEvent.click(screen.getByRole('button', { name: 'open related' }));
    const trail = await screen.findByTestId('record-drawer-trail');
    expect(trail.textContent).toContain('Ada onboarding');
    await waitFor(() => expect(screen.getByTestId('record-page').getAttribute('data-record-id')).toBe('2'));
    expect(screen.queryByTestId('quick-look-panel')).toBeNull();
  });

  it('a calendar view that declares `page` opens the record route, and no drawer', async () => {
    await mountView('calendar', { mode: 'page' });
    fireEvent.click(await screen.findByText('Ada onboarding', undefined, { timeout: 5000 }));

    await waitFor(() => expect(screen.getByTestId('location').getAttribute('data-path')).toMatch(/\/record\/1$/));
    expect(screen.queryByTestId('record-page')).toBeNull();
    expect(screen.queryByTestId('quick-look-panel')).toBeNull();
  });
});
