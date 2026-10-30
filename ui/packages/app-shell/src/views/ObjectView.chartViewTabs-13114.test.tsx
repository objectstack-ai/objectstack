/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13114 — a `type: 'chart'` saved view keeps a way to the other views.
 *
 * `renderListView`'s chart branch returns before `ListView` is reached, so a
 * switcher carried by the list's toolbar vanished on a chart view, and the
 * only way back to the grid was the browser's Back button. Since
 * objectstack#27594 the view switcher is the page title, above every face, so
 * a chart view has it like any other and no face draws a row of view tabs.
 *
 * Everything here is the real chain: the real `ObjectView`, the real plugin
 * `ObjectView` calling the page's `renderListView`, the real `ListView` and the
 * real `ObjectChart`.
 *
 * WHAT IS PINNED.
 *  - A chart view draws the title switcher and no view-tab row; choosing the
 *    grid view from it switches back to the grid.
 *  - CONTROL: a grid view draws the same one switcher, and no tab bar in the
 *    list's toolbar.
 *  - CONTROL: the switcher sits in the page header the phone does not draw
 *    (`hidden sm:block`); the app bar's switcher is the phone's control.
 *  - The view description is shown once (objectui#12528): a chart face, with
 *    no toolbar row, carries it as the switcher's tooltip; a grid face draws it
 *    as the list's info control, and the switcher carries none.
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
    all: { name: 'all', label: 'All Projects', type: 'grid', columns: ['name'], description: 'Every project' },
    // An unbound chart: `ObjectChart` refuses it on screen
    // (`chart-missing-category-axis`), which is enough to prove the chart
    // face — not the grid — is what is drawn.
    budget_chart: {
      name: 'budget_chart',
      label: 'Budget by Account',
      type: 'chart',
      description: 'Budget per account',
      chart: { chartType: 'bar' },
    },
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

/** Open the title's view switcher and choose the view `viewId`. */
function chooseView(viewId: string) {
  fireEvent.click(screen.getByTestId('list-view-switcher'));
  const row = screen.getAllByTestId(`view-switcher-row-${viewId}`).at(-1)!;
  fireEvent.click(row.querySelector('button')!);
}

describe('objectui#13114 — a chart view keeps the view switcher', () => {
  it('a chart view draws the title switcher and no tab row, and the switcher goes back to the grid', async () => {
    setViewportWidth(1440);
    mountProjects('budget_chart');
    await chartFace();

    expect(screen.getAllByTestId('list-view-switcher')).toHaveLength(1);
    expect(screen.getByTestId('list-view-switcher')).toHaveTextContent('Budget by Account');
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
    expect(screen.queryByTestId('view-tab-bar')).toBeNull();
    expect(screen.queryByTestId('list-toolbar-leading')).toBeNull();

    chooseView('all');
    await listToolbar();

    expect(screen.queryByTestId('chart-missing-category-axis')).toBeNull();
    expect(screen.getByTestId('list-view-switcher')).toHaveTextContent('All Projects');
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
    expect(screen.queryByTestId('view-tab-bar')).toBeNull();
  });

  it('CONTROL: a grid view draws the same one switcher, and no tab bar in the list toolbar', async () => {
    setViewportWidth(1440);
    mountProjects('all');
    await listToolbar();

    expect(screen.getAllByTestId('list-view-switcher')).toHaveLength(1);
    expect(screen.queryByTestId('view-tab-bar')).toBeNull();
    expect(screen.queryByTestId('list-toolbar-leading')).toBeNull();
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
  });

  it('a chart face carries its description on the switcher; a grid face draws it as the list\'s info control', async () => {
    setViewportWidth(1440);
    mountProjects('budget_chart');
    await chartFace();

    expect(screen.getByTestId('list-view-switcher')).toHaveAttribute('title', 'Budget per account');
    expect(screen.queryByTestId('view-description-info')).toBeNull();

    chooseView('all');
    await listToolbar();

    expect(screen.getByTestId('list-view-switcher').hasAttribute('title')).toBe(false);
    expect(screen.getByTestId('view-description-info')).toHaveAttribute('title', 'Every project');
  });

  it('CONTROL: the switcher is in the page header a phone does not draw — the app bar switcher is the phone\'s control', async () => {
    setViewportWidth(390);
    mountProjects('budget_chart');
    await chartFace();

    expect(screen.getByTestId('list-view-switcher').closest('.hidden.sm\\:block')).not.toBeNull();
    expect(screen.queryByTestId('view-tab-bar')).toBeNull();
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
  });
});
