/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13114 — a `type: 'chart'` saved view keeps the view tabs.
 *
 * Since objectui#12440 the console list page hands its `ViewTabBar` to
 * `ListView` as `toolbarLeading`. `renderListView`'s chart branch returns
 * before `ListView` is reached, so a chart view drew no tabs at all: the
 * view switcher vanished and the only way back to the grid was the browser's
 * Back button. The chart branch now draws the strip itself, as a row of its
 * own above the chart (`view-tab-row`).
 *
 * Everything here is the real chain: the real `ObjectView`, the real plugin
 * `ObjectView` calling the page's `renderListView`, the real `ListView`, the
 * real `ViewTabBar` and the real `ObjectChart`.
 *
 * WHAT IS PINNED.
 *  - A chart view draws exactly one tab bar, in its own row, beside the chart
 *    face; clicking a grid tab from there switches back to the grid.
 *  - CONTROL: a grid view draws exactly one tab bar, inside the list's toolbar
 *    slot, and no standalone row (objectui#12440's placement, unchanged).
 *  - CONTROL: below `sm` a chart view hands out no strip either.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
// The chart face is behind `React.lazy` in `ObjectView`; importing the same
// specifier here moves its load out of the assertion windows (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-charts';

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

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

// The page's own reads are relative fetches, which happy-dom would send to a
// real socket. One double, installed at module scope and never torn down.
vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));

const PROJECT = {
  name: 'showcase_project',
  label: 'Project',
  pluralLabel: 'Projects',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
  listViews: {
    all: { name: 'all', label: 'All Projects', type: 'grid', columns: ['name'] },
    // An unbound chart: `ObjectChart` refuses it on screen
    // (`chart-missing-category-axis`), which is enough to prove the chart
    // face — not the grid — is what is drawn.
    budget_chart: { name: 'budget_chart', label: 'Budget by Account', type: 'chart', chart: { chartType: 'bar' } },
  },
};

const ROWS = [{ id: 'p_1', name: 'Apollo' }];

const DESKTOP_WIDTH = window.innerWidth;

function setViewportWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

function mountProjects(viewId: string) {
  const objects = [PROJECT];
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Sales Manager' }}>
        <MemoryRouter initialEntries={[`/apps/showcase/showcase_project/view/${viewId}`]}>
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
}

/** The chart face has drawn (its on-screen refusal of an unbound chart). */
const chartFace = () =>
  waitFor(() => expect(screen.getByTestId('chart-missing-category-axis')).toBeInTheDocument(), { timeout: 5000 });

/** The grid's toolbar has drawn: its Filter control is on screen. */
const listToolbar = () =>
  waitFor(() => expect(screen.getByTestId('toolbar-filter-trigger')).toBeInTheDocument(), { timeout: 5000 });

afterEach(() => {
  cleanup();
  setViewportWidth(DESKTOP_WIDTH);
});

describe('objectui#13114 — a chart view keeps the view tabs', () => {
  it('a chart view draws one tab bar in its own row, and its grid tab switches back to the grid', async () => {
    setViewportWidth(1440);
    mountProjects('budget_chart');
    await chartFace();

    const row = screen.getByTestId('view-tab-row');
    const tabBar = screen.getByTestId('view-tab-bar');
    expect(row.contains(tabBar)).toBe(true);
    expect(screen.getAllByTestId('view-tab-bar')).toHaveLength(1);
    // No grid on this face, so no toolbar slot carries a second strip.
    expect(screen.queryByTestId('list-toolbar-leading')).toBeNull();
    expect(screen.getByTestId('view-tab-budget_chart')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('view-tab-all'));
    await listToolbar();

    expect(screen.queryByTestId('chart-missing-category-axis')).toBeNull();
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
    expect(screen.getAllByTestId('view-tab-bar')).toHaveLength(1);
    expect(screen.getByTestId('list-toolbar-leading').contains(screen.getByTestId('view-tab-bar'))).toBe(true);
  });

  it('CONTROL: a grid view keeps its one tab bar in the list toolbar slot', async () => {
    setViewportWidth(1440);
    mountProjects('all');
    await listToolbar();

    expect(screen.getAllByTestId('view-tab-bar')).toHaveLength(1);
    expect(screen.getByTestId('list-toolbar-leading').contains(screen.getByTestId('view-tab-bar'))).toBe(true);
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
  });

  it('CONTROL: below `sm` a chart view draws no strip — the app bar switcher is the phone\'s control', async () => {
    setViewportWidth(390);
    mountProjects('budget_chart');
    await chartFace();

    expect(screen.queryByTestId('view-tab-bar')).toBeNull();
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
  });
});
