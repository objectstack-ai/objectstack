// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36448 — the list page offers the object's views to change only to
 * a reader the `view` metadata write doors admit: an administrator holding
 * `manage_metadata` (`mayManageViews`, `./objectViewViewSharing.ts`).
 *
 * ## The defect this pins
 *
 * Manage views, the view settings panel and Create View were gated on
 * `isAdmin` alone. Every write they lead to (`PUT`/`DELETE /meta/view/NAME`)
 * is refused without `manage_metadata`, so an organization administrator who
 * lacks it was offered them and met a 403 on the first save. The Shared
 * choice of a new view already read the capability (objectstack#36409); these
 * entries now read the same answer.
 *
 * ## What runs
 *
 * The real `ObjectView` under the real router, its real title switcher,
 * `ManageViewsDialog`, `ViewConfigPanel` and `CreateViewDialog`; the
 * principal (`useWorkspaceAdminStatus`, `useCanAuthorMetadata`) is a stand-in
 * each case sets. The plugin view's own Create View and view actions are read
 * off the schema `useObjectViewPluginSchema` hands it.
 *
 * Direction, written before the run: on the unmodified tree the
 * administrator-without-capability cases go RED (Manage views and the plugin's
 * entries are offered) and the with-capability cases stay GREEN, the control
 * that a metadata administrator keeps every entry.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { render, cleanup, act, screen, fireEvent, renderHook } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const viewer = vi.hoisted(() => ({ isAdmin: true, canAuthorMetadata: true }));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities: `ListView` names `perms` in its fetch dependencies.
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
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => viewer.canAuthorMetadata,
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

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let client: MetadataClient;
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { ObjectView, type ConsoleObjectViewProps } from './ObjectView';
import { useObjectViewPluginSchema } from './objectViewPluginSchema';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'crm_deal';
const PAGE = `/apps/demo/${OBJECT_NAME}`;
const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: {} })),
  } as unknown as ConsoleObjectViewProps['dataSource'];
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

async function mountList() {
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada' }}>
      <MemoryRouter initialEntries={[PAGE]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/*"
            element={
              <ObjectView
                dataSource={makeDataSource()}
                objects={[{
                  name: OBJECT_NAME,
                  label: 'Deal',
                  fields: FIELDS,
                  listViews: { [`${OBJECT_NAME}.all`]: { name: `${OBJECT_NAME}.all`, label: 'All', type: 'grid', columns: ['name'] } },
                }]}
                onEdit={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await settle();
  fireEvent.click(screen.getByTestId('list-view-switcher'));
}

beforeEach(() => {
  cleanup();
  viewer.isAdmin = true;
  viewer.canAuthorMetadata = true;
  client = new MetadataClient({
    baseUrl: 'http://localhost',
    fetch: vi.fn(async (input: string) => {
      const path = new URL(input, 'http://localhost').pathname;
      if (path.endsWith('/meta/dataset')) return json([], 200);
      return json({ data: [] }, 200);
    }) as unknown as typeof fetch,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('objectstack#36448 — Manage views, view settings and Create View read manage_metadata', () => {
  it('an organization administrator without manage_metadata is not offered Manage views', async () => {
    viewer.canAuthorMetadata = false;
    await mountList();
    expect(screen.queryByTestId('list-view-switcher-manage')).toBeNull();
    expect(screen.queryByTestId('manage-views-dialog')).toBeNull();
    expect(screen.queryByTestId('create-view-dialog')).toBeNull();
  });

  it('an administrator holding it reaches Manage views, and from it Create View (control)', async () => {
    await mountList();
    fireEvent.click(screen.getByTestId('list-view-switcher-manage'));
    expect(await screen.findByTestId('manage-views-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('manage-views-add'));
    expect(await screen.findByTestId('create-view-dialog')).toBeTruthy();
  });

  it('a member is offered none of them, as before', async () => {
    viewer.isAdmin = false;
    await mountList();
    expect(screen.queryByTestId('list-view-switcher-manage')).toBeNull();
  });
});

describe('objectstack#36448 — the plugin view\'s Create View and view actions read the same answer', () => {
  const schemaFor = (canManageViews: boolean) => renderHook(() =>
    useObjectViewPluginSchema({
      views: [{ id: 'all', name: 'all', label: 'All', type: 'grid' }] as never,
      activeViewId: 'all',
      viewDraft: null,
      activeView: { id: 'all', name: 'all', label: 'All', type: 'grid' } as never,
      objectDef: { name: OBJECT_NAME, label: 'Deal', fields: {} } as never,
      onEdit: vi.fn(),
      canManageViews,
      location: { pathname: PAGE, search: '', hash: '', state: null, key: 'k' },
      navigate: vi.fn(),
      viewId: undefined,
      servedViews: { views: [], objects: [] } as never,
      viewLabel: (_object: string, _view: string, fallback: string) => fallback,
      unlabelledViewText: 'Untitled view',
      language: 'en',
    }),
  ).result.current.objectViewSchema;

  it('without it: no Create View and no view actions (settings, share, delete)', () => {
    const schema = schemaFor(false);
    expect(schema.allowCreateView).toBe(false);
    expect(schema.viewActions).toEqual([]);
  });

  it('with it: both offered (control)', () => {
    const schema = schemaFor(true);
    expect(schema.allowCreateView).toBe(true);
    expect(schema.viewActions.map((a) => a.type)).toEqual(['settings', 'share', 'delete']);
  });
});
