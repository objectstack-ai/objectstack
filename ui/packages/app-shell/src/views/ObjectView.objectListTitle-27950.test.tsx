/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27950 — an object list's title names the object.
 *
 * ⚠️ REDRAWN by objectstack#35548 (epic #35547): the page bar's heading is the
 * object's plural alone (no link, no switcher), and the one view switcher
 * leads the view bar under it, at every width. The ruling-B heading
 * 「OBJECT / VIEW ▾」 described below is retired; the pins that follow read
 * the new frame. What is unchanged: the object is named once, the view once,
 * with the sidebar either way and with a record open beside the list.
 *
 * Since objectstack#27594 the list title is the view switcher, and the app bar
 * draws no object crumb (objectui#12461: the page header is the one place a
 * page is named). The maintainer's ruling B puts the object's plural ahead of
 * the switcher: 「OBJECT / VIEW ▾」, the plural linking to the object's
 * default list; where the row is short the object label stays whole and the
 * view label gives way.
 *
 * The real chain, as `ObjectView.titleViewSwitcher-27594`: the real
 * `ObjectView`, the real plugin `ObjectView` and the real `ListView`.
 *
 * WHAT IS PINNED.
 *  - On the object's bare address and on a view's, the heading reads the
 *    plural, then the switcher; the plural is a link to `/apps/APP/OBJECT`,
 *    and following it opens the object's default view.
 *  - The same with the sidebar expanded and collapsed (the real
 *    `SidebarProvider`, whose state is read back).
 *  - A record open beside the list (the split pane) leaves one object label.
 *  - A view with no label is the plural already: the heading names it once.
 *  - Narrow rows: the object label is `shrink-0` and unwrapped, the view label
 *    is the switcher's `truncate` span. The test DOM computes no layout, so the
 *    classes that decide it are what is read.
 *  - On a phone (objectstack#27058) the app bar's view dropdown and its
 *    「OBJECT / VIEW」 trigger are retired with the channel that fed them
 *    (`MobileViewSwitcherContext`): the one switcher leads the list's toolbar
 *    row, and the app bar's label names the object.
 *
 * The record route's crumb is not drawn by this page (`RecordDetailView`);
 * `AppHeader.appBarLeftGroup-12461` pins that it stays absent from the app bar.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { SidebarProvider, useSidebar } from '@object-ui/components';

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
  useAuth: () => ({ user: { id: 'u1', name: 'Sales Manager' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { RECORD_OPEN_PREFERENCE_KEY } from '../utils/recordOpenPreference';

// The page's own reads (the security `explain` probe among them) are relative
// fetches, which happy-dom would send to a real socket. One double, installed
// at module scope and never torn down, so no read the mounted tree issues
// after a test body returns can reach the network.
vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));

const LEAD = {
  name: 'crm_lead',
  label: 'Lead',
  pluralLabel: 'Leads',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
  listViews: {
    all: { name: 'all', label: 'All Leads', type: 'grid', columns: ['name'] },
    mine: { name: 'mine', label: 'My Leads', type: 'grid', columns: ['name'] },
  },
};

/** An object whose one view the author left unnamed: the view is called by the plural. */
const NOTE = {
  name: 'crm_note',
  label: 'Note',
  pluralLabel: 'Notes',
  fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
  listViews: { all: { type: 'grid', columns: ['name'] } },
};

const OBJECTS = [LEAD, NOTE];
const ROWS = [{ id: 'lead_1', name: 'Ada' }];

/** Where the router is, read back after a click. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

/** The sidebar state the page renders under, read back. */
function SidebarStateProbe() {
  return <output data-testid="sidebar-state">{useSidebar().state}</output>;
}

function mount(entry: string, { sidebarOpen = true }: { sidebarOpen?: boolean } = {}) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  const page = <ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />;
  return render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Sales Manager' }}>
        <SidebarProvider open={sidebarOpen}>
          <MemoryRouter initialEntries={[entry]}>
            <LocationProbe />
            <SidebarStateProbe />
            <Routes>
              <Route path="/apps/:appName/:objectName/view/:viewId" element={page} />
              <Route path="/apps/:appName/:objectName" element={page} />
            </Routes>
          </MemoryRouter>
        </SidebarProvider>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

/** The list's toolbar has drawn: its Filter control is on screen. */
const listToolbar = () =>
  waitFor(() => expect(screen.getByTestId('toolbar-filter-trigger')).toBeInTheDocument(), { timeout: 5000 });

const heading = () => screen.getByRole('heading', { level: 1 });
/** The view bar's leading slot: the one view switcher (objectstack#35548). */
const viewBarLead = () => screen.getByTestId('list-toolbar-leading');
const switcher = () => within(viewBarLead()).getByTestId('list-view-switcher');

beforeEach(() => {
  localStorage.clear();
});

const DESKTOP_WIDTH = window.innerWidth;

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { value: DESKTOP_WIDTH, configurable: true, writable: true });
});

describe('objectstack#27950, as redrawn by objectstack#35548 — the page bar names the object, the view bar names the view', () => {
  it.each([
    ['the object\'s address', '/apps/crm/crm_lead', 'All Leads'],
    ['a view\'s address', '/apps/crm/crm_lead/view/mine', 'My Leads'],
  ])('on %s the heading reads 「Leads」 and the view bar\'s switcher reads the view', async (_where, entry, view) => {
    mount(entry);
    await listToolbar();
    expect(heading()).toHaveTextContent(/^Leads$/);
    expect(within(heading()).queryByTestId('list-view-switcher')).toBeNull();
    expect(within(switcher()).getByTestId('list-view-switcher-label')).toHaveTextContent(view);
    // The page bar comes first, the view bar under it.
    expect(heading().compareDocumentPosition(switcher()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['expanded', true],
    ['collapsed', false],
  ])('with the sidebar %s the object is named once and the view once', async (state, open) => {
    mount('/apps/crm/crm_lead/view/mine', { sidebarOpen: open });
    await listToolbar();
    expect(screen.getByTestId('sidebar-state')).toHaveTextContent(state);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(heading()).toHaveTextContent(/^Leads$/);
    expect(screen.getAllByTestId('list-view-switcher')).toHaveLength(1);
  });

  it('a record open in the drawer over the list leaves one object label and one switcher', async () => {
    localStorage.removeItem(RECORD_OPEN_PREFERENCE_KEY);
    mount('/apps/crm/crm_lead/view/mine?recordId=lead_1');
    await listToolbar();
    expect(screen.getAllByTestId('list-view-switcher')).toHaveLength(1);
    expect(screen.getAllByTestId('page-header').filter((h) => h.dataset.posture === 'list')).toHaveLength(1);
  });

  it('a view with no label reads the plural in the switcher', async () => {
    mount('/apps/crm/crm_note');
    await listToolbar();
    expect(heading()).toHaveTextContent(/^Notes$/);
    expect(within(switcher()).getByTestId('list-view-switcher-label')).toHaveTextContent('Notes');
  });

  it('a short row keeps the switcher in one line: the view label truncates', async () => {
    mount('/apps/crm/crm_lead/view/mine');
    await listToolbar();
    const viewLabel = within(switcher()).getByText('My Leads');
    expect(viewLabel).toHaveClass('truncate');
    expect(switcher()).toHaveClass('min-w-0');
    expect(heading()).toHaveClass('truncate');
  });

  it('on a phone the one switcher leads the list\'s toolbar row', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    mount('/apps/crm/crm_lead/view/mine');
    await listToolbar();
    expect(screen.getAllByTestId('list-view-switcher')).toHaveLength(1);
    const phoneTitle = within(viewBarLead()).getByTestId('list-phone-title');
    expect(within(phoneTitle).getByTestId('list-view-switcher')).toHaveTextContent('My Leads');
  });
});
