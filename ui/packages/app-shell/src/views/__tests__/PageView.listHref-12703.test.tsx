/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12703, part 2 — a custom page supplies the object-list destination
 * its compact list blocks link "View all" to.
 *
 * `PageView` publishes `pageRecordActionsValue` on `RelatedRecordActionsContext`
 * (objectui#11293). It now carries `listHref` / `openList`: the app-scoped
 * route of an object's list, `/apps/APP/OBJECT`, or of one of its saved views,
 * `/apps/APP/OBJECT/view/VIEW`, the two routes the console mounts for them.
 * As for `recordHref` (objectui#12233), the href carries the router's basename
 * and the SPA open navigates by the bare route.
 *
 * The page, the router, the page renderer and the `list-view` block are real:
 * `PageView` under a `MemoryRouter` with basename `/_console`, rendering a page
 * whose narrow `aside` region holds two list blocks, one bound to a saved view
 * and one with an inline filter only. Region widths come from a stand-in
 * `ResizeObserver`, as in plugin-list's part-1 pin. The oracle for each href is
 * react-router's own `Link` for the same route.
 *
 * The last block pins the builder's refusals: an object outside the app's
 * metadata and a page outside an app route get no destination.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', role: 'user', image: null }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // STABLE identities: `ListView` names `perms` in its fetch dependency list.
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

const APP = 'crm';
const OBJECT = 'crm_event';

const FIELDS = {
  id: { name: 'id', type: 'text', label: 'Id' },
  subject: { name: 'subject', type: 'text', label: 'Subject' },
  status: { name: 'status', type: 'text', label: 'Status' },
};

const OBJECTS = [
  {
    name: OBJECT,
    label: 'Event',
    fields: FIELDS,
    listViews: { upcoming: { name: 'upcoming', label: 'Upcoming', type: 'grid', columns: ['subject', 'status'] } },
  },
];

const PAGE = {
  name: 'sales_home',
  label: 'Sales Home',
  type: 'home',
  template: 'three-column',
  regions: [
    { name: 'main', components: [] },
    {
      name: 'aside',
      width: 'medium',
      components: [
        { type: 'list-view', id: 'bound', label: 'Upcoming', dataSource: { object: OBJECT, view: 'upcoming' } },
        {
          type: 'list-view',
          id: 'inline',
          label: 'Planned',
          properties: {
            data: { provider: 'object', object: OBJECT },
            columns: ['subject'],
            filter: [['status', '=', 'planned']],
          },
        },
      ],
    },
  ],
};

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ pages: [PAGE], objects: OBJECTS, getTypeStatus: () => 'ready' }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

import { AdapterCtx, SchemaRendererProvider } from '@object-ui/react';
// The real page renderer and `list-view` (module scope, AGENTS.md §测试纪律).
import '@object-ui/components';
import '@object-ui/plugin-list';
import { PageView } from '../PageView';
import { pageRecordActionsValue } from '../pageRecordActions';

const VIEW_ROUTE = `/apps/${APP}/${OBJECT}/view/upcoming`;
const LIST_ROUTE = `/apps/${APP}/${OBJECT}`;

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: 'e-1', subject: 'Renewal review', status: 'planned' }], total: 1 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 1),
    getObjectSchema: vi.fn(async () => OBJECTS[0]),
    getObjects: vi.fn(async () => OBJECTS),
    onMutation: () => () => {},
  };
}

/** Reports these widths for the page body and each region. */
function stubWidths(widths: { page: number; regions: Record<string, number> }) {
  class WidthReportingObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const region = target.getAttribute('data-region');
      const width = region != null
        ? widths.regions[region]
        : target.matches('[data-page-type] > div') ? widths.page : undefined;
      if (width === undefined) return;
      this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as never);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', WidthReportingObserver);
}

/** The router's own location, basename stripped: where a left click took us. */
function RouterLocation() {
  const location = useLocation();
  return <output data-testid="router-location">{location.pathname}</output>;
}

function mount() {
  stubWidths({ page: 1200, regions: { main: 856, aside: 320 } });
  const ds = makeDataSource();
  return render(
    <AdapterCtx.Provider value={ds as never}>
      <SchemaRendererProvider dataSource={ds as never}>
        <MemoryRouter basename="/_console" initialEntries={[`/_console/apps/${APP}/page/${PAGE.name}`]}>
          <Routes>
            <Route path="/apps/:appName/page/:pageName" element={<PageView />} />
            <Route path="*" element={null} />
          </Routes>
          <Link to={VIEW_ROUTE} data-testid="oracle-view">view</Link>
          <Link to={LIST_ROUTE} data-testid="oracle-list">list</Link>
          <RouterLocation />
        </MemoryRouter>
      </SchemaRendererProvider>
    </AdapterCtx.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a custom page supplies its compact lists\' "View all" destination (objectui#12703)', () => {
  it('a block bound to a saved view links to that view\'s app route under the basename, and a left click routes there', async () => {
    const { container } = mount();
    const bound = await waitFor(() => {
      const el = container.querySelector('[data-region="aside"]');
      const links = el ? within(el as HTMLElement).queryAllByTestId('list-compact-view-all') : [];
      expect(links).toHaveLength(2);
      return links[0];
    });

    const href = bound.getAttribute('href');
    expect(href).toBe(`/_console${VIEW_ROUTE}`);
    expect(href).toBe(screen.getByTestId('oracle-view').getAttribute('href'));

    fireEvent.click(bound, { button: 0 });
    expect(screen.getByTestId('router-location').textContent).toBe(VIEW_ROUTE);
  });

  it('a block with an inline filter only links to the object\'s list route, with no query', async () => {
    const { container } = mount();
    const inline = await waitFor(() => {
      const links = within(container.querySelector('[data-region="aside"]') as HTMLElement)
        .queryAllByTestId('list-compact-view-all');
      expect(links).toHaveLength(2);
      return links[1];
    });
    expect(inline.getAttribute('href')).toBe(`/_console${LIST_ROUTE}`);
    expect(inline.getAttribute('href')).toBe(screen.getByTestId('oracle-list').getAttribute('href'));
  });
});

describe('the page\'s list destination builder refuses what it cannot route (objectui#12703)', () => {
  const navigate = vi.fn();

  it('an object outside the app\'s metadata has no destination, and opening it does nothing', () => {
    const host = pageRecordActionsValue(APP, OBJECTS, navigate, '/');
    expect(host.listHref?.('not_an_object')).toBeNull();
    host.openList?.('not_an_object', 'upcoming');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a page outside an app route has no destination', () => {
    const host = pageRecordActionsValue(undefined, OBJECTS, navigate, '/');
    expect(host.listHref?.(OBJECT)).toBeNull();
    expect(host.listHref?.(OBJECT, 'upcoming')).toBeNull();
  });

  it('a view name is one encoded path segment', () => {
    const host = pageRecordActionsValue(APP, OBJECTS, navigate, '/');
    expect(host.listHref?.(OBJECT, 'a/b c')).toBe(`/apps/${APP}/${OBJECT}/view/a%2Fb%20c`);
  });
});
