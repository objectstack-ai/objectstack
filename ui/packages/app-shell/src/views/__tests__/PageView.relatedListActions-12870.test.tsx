/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12870 — on a custom `app` page, a `record:related_list` whose parent
 * is bound through `parentDataSource` draws its authored toolbar and row
 * actions, and runs them through the record page's related-list executor.
 *
 * The page published `resolve: () => NO_RELATED_HANDLERS`, so the list drew
 * its rows and none of its authored `actions`, without a word. `PageView` now
 * mounts the record page's `RelatedRecordActionsBridge` inside the page's own
 * action runtime and serves its `onToolbarAction` / `onRowAction` to a list
 * that resolved its parent (`pageRecordActionsValue`'s `related` argument).
 *
 * Every case mounts the real `PageView`, the real console action runtime
 * (`ConsoleActionRuntimeProvider`), the real page renderer, `@object-ui/plugin-detail`'s
 * registration and the real `RelatedList`, then reads the DOM. "Runs" is read
 * off the request the runtime's api handler sends through the authenticated
 * fetch: the action's target, with the clicked row's id interpolated.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn(async (_url: string, _init?: unknown) =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', role: 'user', image: null }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => apiFetch,
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities: the bridge and the list name `perms` in memo deps.
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
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [], readableFields: (f: string[]) => f };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

const APP = 'cloud';
const PARENT = 'sys_organization';
const CHILD = 'sys_member';

/**
 * The child object's registered actions. `invite_user` is the list's header
 * action; `change_role` a `record_related` row action — placed only inside a
 * parent record, which the page list is only by its bound parent; `remove` a
 * `list_item` row action.
 */
const CHILD_ACTIONS = [
  { name: 'invite_user', label: 'Invite user', type: 'api', target: '/api/v1/org/invite', locations: ['list_toolbar'] },
  { name: 'change_role', label: 'Change role', type: 'api', target: '/api/v1/members/{id}/role', locations: ['record_related'] },
  { name: 'remove', label: 'Remove', type: 'api', target: '/api/v1/members/{id}/remove', locations: ['list_item'] },
];

const OBJECTS = [
  { name: PARENT, label: 'Organization', fields: { name: { name: 'name', type: 'text', label: 'Name' } } },
  {
    name: CHILD,
    label: 'Member',
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      organization_id: { name: 'organization_id', type: 'lookup', reference: PARENT, label: 'Organization' },
    },
    actions: CHILD_ACTIONS,
  },
];

/** The page's one block, varied per case. */
let block: Record<string, unknown> = {};

const listBlock = (extra: Record<string, unknown> = {}) => ({
  type: 'record:related_list',
  id: 'members',
  properties: {
    objectName: CHILD,
    relationshipField: 'organization_id',
    columns: ['name'],
    ...extra,
  },
});
const BOUND = { parentDataSource: { object: PARENT, filter: [{ field: 'id', operator: 'equals', value: 'org-1' }], limit: 1 } };

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    pages: [{ name: 'team', label: 'Team', type: 'app', regions: [{ name: 'main', components: [block] }] }],
    objects: OBJECTS,
    getTypeStatus: () => 'ready',
  }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

import { AdapterCtx, MetadataCtx, SchemaRendererProvider, type MetadataContextValue } from '@object-ui/react';
// The real page renderer and `record:related_list` (module scope, AGENTS.md §测试纪律).
import '@object-ui/components';
import '@object-ui/plugin-detail';
import { PageView } from '../PageView';

/** `useMetadataItem('object', …)` — the lookup the authored `actions` resolve through. */
const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' ? OBJECTS.find((o) => o.name === name) ?? null : null,
);
const METADATA: MetadataContextValue = {
  apps: [],
  objects: OBJECTS,
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

function makeDataSource() {
  return {
    find: vi.fn(async (object: string) =>
      object === PARENT
        ? { data: [{ id: 'org-1', name: 'Acme' }], total: 1 }
        : object === CHILD
          ? { data: [{ id: 'm-1', name: 'Alice', organization_id: 'org-1' }], total: 1 }
          : { data: [], total: 0 },
    ),
    findOne: vi.fn(async () => null),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(async () => 1),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name)),
    getObjects: vi.fn(async () => OBJECTS),
    onMutation: () => () => {},
  };
}

function mount(node: Record<string, unknown>) {
  block = node;
  const ds = makeDataSource();
  return render(
    <MetadataCtx.Provider value={METADATA}>
      <AdapterCtx.Provider value={ds as never}>
        <SchemaRendererProvider dataSource={ds as never}>
          <MemoryRouter initialEntries={[`/apps/${APP}/page/team`]}>
            <Routes>
              <Route path="/apps/:appName/page/:pageName" element={<PageView />} />
            </Routes>
          </MemoryRouter>
        </SchemaRendererProvider>
      </AdapterCtx.Provider>
    </MetadataCtx.Provider>,
  );
}

/** Desktop (objectui#8399): the row menu read below is the data table's. */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
  apiFetch.mockClear();
  getItem.mockClear();
});

const toolbarNames = (): string[] =>
  screen
    .queryAllByTestId(/^related-toolbar-action-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('related-toolbar-action-', ''));
const rowTriggers = () => screen.queryAllByLabelText('Row actions');
async function openRowMenu(): Promise<HTMLElement> {
  await waitFor(() => expect(rowTriggers().length).toBeGreaterThan(0));
  fireEvent.pointerDown(rowTriggers()[0], { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}
const rowMenuNames = (menu: HTMLElement): string[] =>
  within(menu)
    .queryAllByTestId(/^row-action-/)
    .map((el) => (el.getAttribute('data-testid') ?? '').replace('row-action-', ''))
    .filter((name) => !name.startsWith('builtin-'));
const unserved = () => screen.queryByTestId('record-related-list-actions-unserved');
const calledUrls = () => apiFetch.mock.calls.map(([url]) => String(url));

describe('objectui#12870 — an app page serves the record page’s related-list executor to a list bound by `parentDataSource`', () => {
  it('draws the authored toolbar action and row actions, and runs each through the page’s action runtime', async () => {
    mount(listBlock({ ...BOUND, actions: ['invite_user', 'change_role', 'remove'] }));
    await screen.findByText('Alice');

    await waitFor(() => expect(toolbarNames()).toEqual(['invite_user']));
    const menu = await openRowMenu();
    // `change_role` is `record_related`: placed because the bound parent puts
    // the list inside a parent record, as on the record page.
    expect(rowMenuNames(menu)).toEqual(['change_role', 'remove']);
    expect(unserved()).toBeNull();

    fireEvent.click(within(menu).getByTestId('row-action-change_role'));
    await waitFor(() => expect(calledUrls()).toContain('/api/v1/members/m-1/role'));

    fireEvent.click(screen.getByTestId('related-toolbar-action-invite_user'));
    await waitFor(() => expect(calledUrls()).toContain('/api/v1/org/invite'));
  });

  it('a list with no parent in scope draws no authored action, and says so', async () => {
    mount(listBlock({ actions: ['invite_user', 'change_role'] }));
    await waitFor(() => expect(unserved()).not.toBeNull());
    expect(unserved()).toHaveTextContent('invite_user');
    expect(unserved()).toHaveTextContent('change_role');
    expect(unserved()).toHaveTextContent('parentDataSource');
    expect(toolbarNames()).toEqual([]);
    expect(rowTriggers()).toHaveLength(0);
  });

  it('CONTROL: a bound list that authors no `actions` is unchanged — rows, and no action, no New, no notice', async () => {
    mount(listBlock(BOUND));
    await screen.findByText('Alice');
    expect(toolbarNames()).toEqual([]);
    expect(rowTriggers()).toHaveLength(0);
    expect(screen.queryByTestId('related-list-new')).toBeNull();
    expect(unserved()).toBeNull();
  });
});
