/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12440 — the console list page draws its saved-view tabs on the
 * list's own toolbar row.
 *
 * The page used to spend two bordered rows on list chrome: the `ViewTabBar`
 * in a `hidden sm:block` row of its own above the list, then the list's
 * toolbar. Now the page hands the strip to `ListView` as its `toolbarLeading`
 * host prop, from `sm` up only.
 *
 * Everything here is the real chain: the real `ObjectView`, the real plugin
 * `ObjectView` calling the page's `renderListView`, the real `ListView` and the
 * real `ViewTabBar`.
 *
 * WHAT IS PINNED.
 *  - Desktop width: no standalone tab row; `view-tab-bar` sits inside the
 *    list's toolbar slot, and the strip still folds what its width does not
 *    hold into `view-tab-overflow` there (widths stubbed as in
 *    `ViewTabBar.widthFit-12423.test.tsx`; jsdom lays nothing out).
 *  - Phone width: no `view-tab-bar` at all, and no slot wrapper: nothing is
 *    handed to the list. The app bar's mobile switcher is the phone's control.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
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

// The page's own reads (the security `explain` probe among them) are relative
// fetches, which happy-dom would send to a real socket. One double, installed
// at module scope and never torn down, so no read the mounted tree issues
// after a test body returns can reach the network.
vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));

/** Eight grid views, so a narrow strip has something to fold. */
const LIST_VIEWS = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [
    `v${i + 1}`,
    { name: `v${i + 1}`, label: `View ${i + 1}`, type: 'grid', columns: ['name'] },
  ]),
);

const LEAD = {
  name: 'crm_lead',
  label: 'Lead',
  pluralLabel: 'Leads',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
  listViews: LIST_VIEWS,
};

const ROWS = [{ id: 'lead_1', name: 'Ada' }];

const DESKTOP_WIDTH = window.innerWidth;

function setViewportWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

/** Lay the strip out at `stripPx`; every tab frame is 98 px (as in the widthFit pins). */
let layoutSpy: { mockRestore: () => void } | undefined;
function layOutStrip(stripPx: number) {
  layoutSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const width =
      this.getAttribute('data-testid') === 'view-tab-strip'
        ? stripPx
        : this.hasAttribute('data-view-tab-frame')
          ? 98
          : 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
}

function mountLeads() {
  const objects = [LEAD];
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
        <MemoryRouter initialEntries={['/apps/crm/crm_lead/view/v1']}>
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

/** The list's toolbar has drawn: its Filter control is on screen. */
const listToolbar = () =>
  waitFor(() => expect(screen.getByTestId('toolbar-filter-trigger')).toBeInTheDocument(), { timeout: 5000 });

afterEach(() => {
  cleanup();
  layoutSpy?.mockRestore();
  layoutSpy = undefined;
  setViewportWidth(DESKTOP_WIDTH);
});

describe('objectui#12440 — the view tabs share the list toolbar row', () => {
  it('desktop: no standalone tab row; the strip is inside the list toolbar slot', async () => {
    setViewportWidth(1440);
    mountLeads();
    await listToolbar();

    const slot = screen.getByTestId('list-toolbar-leading');
    const tabBar = screen.getByTestId('view-tab-bar');
    expect(slot.contains(tabBar)).toBe(true);
    expect(screen.getAllByTestId('view-tab-bar')).toHaveLength(1);
    expect(screen.queryByTestId('view-tab-row')).toBeNull();

    // The slot is on the same row as the toolbar's Filter control.
    const row = slot.parentElement!.parentElement!;
    expect(row.contains(screen.getByTestId('toolbar-filter-trigger'))).toBe(true);
    expect(within(tabBar).getByTestId('view-tab-v1')).toBeInTheDocument();
  });

  it('desktop: the strip still folds what its width does not hold into "N more" there', async () => {
    setViewportWidth(1440);
    layOutStrip(320);
    mountLeads();
    await listToolbar();

    const slot = screen.getByTestId('list-toolbar-leading');
    await waitFor(() => expect(within(slot).getByTestId('view-tab-overflow')).toBeInTheDocument());
    const shown = slot.querySelectorAll('[data-view-tab-frame]').length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(8);
  });

  it('phone: no tab strip and no slot — nothing is handed to the list', async () => {
    setViewportWidth(390);
    mountLeads();
    await listToolbar();

    expect(screen.queryByTestId('view-tab-bar')).toBeNull();
    expect(screen.queryByTestId('list-toolbar-leading')).toBeNull();
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
  });
});
