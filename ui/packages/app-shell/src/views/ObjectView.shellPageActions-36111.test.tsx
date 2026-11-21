// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36111 — the list page's top row ends with the shell's top-right
 * button group. Since objectstack#35878 that row is the list's view bar (the
 * object's name, the view switcher, the search, the page's acts and ⋮), not
 * the console `PageHeader`, so the bar's right end draws the group itself:
 * after ⋮, behind a hairline. Turned off (the default while the top bar
 * stands) the bar is what it was. The group's own parts are pinned in
 * `layout/__tests__/ShellPageActions-36111`; here only where it goes.
 *
 * The real chain, as `ObjectView.objectListTitle-27950`: the real `ObjectView`,
 * the real plugin `ObjectView` and the real `ListView`.
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
import { ShellPageActionsScope } from '../layout/ShellPageActions';

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

function mount(entry: string, { sidebarOpen = true, shell }: { sidebarOpen?: boolean; shell?: boolean } = {}) {
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
          <ShellPageActionsScope on={shell}>
            <MemoryRouter initialEntries={[entry]}>
              <LocationProbe />
              <SidebarStateProbe />
              <Routes>
                <Route path="/apps/:appName/:objectName/view/:viewId" element={page} />
                <Route path="/apps/:appName/:objectName" element={page} />
              </Routes>
            </MemoryRouter>
          </ShellPageActionsScope>
        </SidebarProvider>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

/** The list's toolbar has drawn: its Filter control is on screen. */
const listToolbar = () =>
  waitFor(() => expect(screen.getByTestId('condition-add-filter')).toBeInTheDocument(), { timeout: 5000 });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('objectstack#36111 — the list view bar ends with the shell\'s group', () => {
  it('turned on: after the page\'s acts, behind a hairline, at the bar\'s right end', async () => {
    mount('/apps/crm/crm_lead/view/mine', { shell: true });
    await listToolbar();
    const end = await screen.findByTestId('list-view-bar-end');
    const ids = Array.from(end.children).map((c) => c.getAttribute('data-testid'));
    expect(ids).toEqual(['list-view-bar-tools', 'list-view-bar-shell-divider', 'shell-page-actions']);
    expect(screen.getAllByTestId('shell-page-actions')).toHaveLength(1);
    expect(within(screen.getByTestId('shell-page-actions')).getByTestId('shell-page-actions-help')).toBeInTheDocument();
  });

  it('turned off: the bar is what it was, no group and no hairline', async () => {
    mount('/apps/crm/crm_lead/view/mine', { shell: false });
    await listToolbar();
    const end = await screen.findByTestId('list-view-bar-end');
    expect(Array.from(end.children).map((c) => c.getAttribute('data-testid'))).toEqual(['list-view-bar-tools']);
    expect(screen.queryByTestId('shell-page-actions')).toBeNull();
  });
});
