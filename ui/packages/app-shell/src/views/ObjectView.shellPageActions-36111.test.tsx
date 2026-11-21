// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36111 — the list page's top row ends with the shell's top-right
 * button group. Since objectstack#36113 that row is the console `PageHeader`
 * again, the object's icon and name alone, and the group ends it as it ends
 * every console page; the list's view bar under it ends with the page's acts.
 * Turned off (the default while the top bar stands) no group is drawn. The
 * group's own parts are pinned in `layout/__tests__/ShellPageActions-36111`;
 * here only where it goes.
 *
 * objectstack#36113 — the list page's top, three rows: the object's row, the
 * view bar (switcher and 视图设置; search, 「Import / Export」, 「New Lead」 and
 * ⋮ at its end) and the condition row. 「Import / Export」 folds into ⋮ More on
 * a list narrower than `VIEW_BAR_IO_FOLD_WIDTH`.
 *
 * The real chain, as `ObjectView.objectListTitle-27950`: the real `ObjectView`,
 * the real plugin `ObjectView` and the real `ListView`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, within, fireEvent } from '@testing-library/react';
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
import { VIEW_BAR_IO_FOLD_WIDTH } from './objectViewPageHeader';

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
    mine: { name: 'mine', label: 'My Leads', type: 'grid', columns: ['name'], exportOptions: ['csv'] },
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

describe('objectstack#36111, as moved by objectstack#36113 — the list page\'s first row ends with the shell\'s group', () => {
  it('turned on: the object\'s row ends with it; the view bar under it ends with the page\'s acts', async () => {
    mount('/apps/crm/crm_lead/view/mine', { shell: true });
    await listToolbar();
    const header = screen.getAllByTestId('page-header').find((h) => h.dataset.posture === 'list')!;
    expect(within(header).getByTestId('shell-page-actions')).toBeInTheDocument();
    expect(within(header).getByTestId('shell-page-actions-help')).toBeInTheDocument();
    expect(screen.getAllByTestId('shell-page-actions')).toHaveLength(1);
    const end = await screen.findByTestId('list-view-bar-end');
    expect(Array.from(end.children).map((c) => c.getAttribute('data-testid'))).toEqual(['list-view-bar-tools']);
    expect(within(end).queryByTestId('shell-page-actions')).toBeNull();
  });

  it('turned off: no group on either row', async () => {
    mount('/apps/crm/crm_lead/view/mine', { shell: false });
    await listToolbar();
    const end = await screen.findByTestId('list-view-bar-end');
    expect(Array.from(end.children).map((c) => c.getAttribute('data-testid'))).toEqual(['list-view-bar-tools']);
    expect(screen.queryByTestId('shell-page-actions')).toBeNull();
  });
});

/** The list page's object row: the `PageHeader` in its list posture. */
const objectRow = () => screen.getAllByTestId('page-header').find((h) => h.dataset.posture === 'list')!;

/** Opens a Radix menu trigger the way a keyboard does. */
const openMenu = (trigger: HTMLElement) => {
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.keyDown(trigger, { key: 'Enter' });
};

describe('objectstack#36113 — the list page\'s top: object row, view bar, condition row', () => {
  it('the object\'s row names the page and draws none of its acts; the view bar and the condition row follow', async () => {
    mount('/apps/crm/crm_lead/view/mine', { shell: true });
    await listToolbar();
    const row = objectRow();
    expect(within(row).getByRole('heading', { level: 1 })).toHaveTextContent(/^Leads$/);
    expect(within(row).queryByTestId('object-view-new-button')).toBeNull();
    expect(within(row).queryByTestId('object-view-more-actions')).toBeNull();
    expect(within(row).queryByTestId('object-view-import-export')).toBeNull();
    // Its one cluster is the shell's group.
    expect(within(row).getByTestId('shell-page-actions')).toBeInTheDocument();
    const lead = screen.getByTestId('list-toolbar-leading');
    const conditions = screen.getByTestId('list-condition-row');
    expect(row.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lead.compareDocumentPosition(conditions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The view bar no longer leads with the object's name (objectstack#35878 did).
    expect(screen.queryByTestId('list-view-bar-object')).toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('the view bar ends search · Import / Export · New Lead · ⋮', async () => {
    mount('/apps/crm/crm_lead/view/mine');
    await listToolbar();
    const tools = await screen.findByTestId('list-view-bar-tools');
    const order = ['search-icon-button', 'object-view-import-export', 'object-view-new-button', 'object-view-more-actions']
      .map((id) => within(tools).getByTestId(id));
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(tools).getByTestId('object-view-new-button')).toHaveTextContent('New Lead');
    expect(within(tools).getByTestId('object-view-import-export')).toHaveTextContent('Import / Export');
  });

  it('「Import / Export」 holds Import and each export format; ⋮ More holds neither', async () => {
    mount('/apps/crm/crm_lead/view/mine');
    await listToolbar();
    openMenu(await screen.findByTestId('object-view-import-export'));
    expect(await screen.findByTestId('object-view-import-button')).toBeInTheDocument();
    expect(screen.getByTestId('object-view-export-csv')).toHaveTextContent('Export as CSV');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('object-view-export-csv')).toBeNull());
    openMenu(screen.getByTestId('object-view-more-actions'));
    await screen.findByTestId('object-view-favorite');
    expect(screen.queryByTestId('object-view-import-button')).toBeNull();
    expect(screen.queryByTestId('object-view-export-csv')).toBeNull();
  });

  it(`a list narrower than ${VIEW_BAR_IO_FOLD_WIDTH}px folds 「Import / Export」 into ⋮ More`, async () => {
    const real = HTMLElement.prototype.getBoundingClientRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('@container/list')
        ? ({ width: VIEW_BAR_IO_FOLD_WIDTH - 1, height: 600, top: 0, left: 0, right: VIEW_BAR_IO_FOLD_WIDTH - 1, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
        : real.call(this);
    });
    try {
      mount('/apps/crm/crm_lead/view/mine');
      await listToolbar();
      const tools = await screen.findByTestId('list-view-bar-tools');
      await waitFor(() => expect(within(tools).queryByTestId('object-view-import-export')).toBeNull());
      openMenu(within(tools).getByTestId('object-view-more-actions'));
      expect(await screen.findByTestId('object-view-import-button')).toBeInTheDocument();
      expect(screen.getByTestId('object-view-export-csv')).toBeInTheDocument();
      expect(screen.getByTestId('object-view-favorite')).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('the 视图设置 footer keeps its own export entries', async () => {
    mount('/apps/crm/crm_lead/view/mine');
    await listToolbar();
    fireEvent.click(await screen.findByTestId('toolbar-display-trigger'));
    expect(await screen.findByTestId('display-export-csv')).toBeInTheDocument();
  });
});
