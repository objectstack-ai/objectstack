// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11581, the add-view door through its page: `ObjectView`'s
 * `handleViewCreate`, reached from the view tab bar's add button, persists the
 * spec the one builder (`buildNewViewSpec`, via `buildAddViewSpec`) builds,
 * with the columns mirrored into the kanban block the spec requires them in.
 *
 * The per-type enumeration over both doors' builders, and "Save as view"
 * through its page, are in `CreateViewDialog.viewTypeParse-11581.test.tsx`.
 * This file proves the add-view door's callback goes through that builder: the
 * real `ObjectView` and the real dialog run, and only the metadata client is a
 * stub, so the body asserted is the one `createRuntimeMetadata` hands
 * `metadataClient.save`.
 *
 * Direction, written before the run: GREEN on the tree before the builder too
 * (this door always mirrored `kanban.columns`); RED when the kanban mirror is
 * removed from `buildNewViewSpec`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ListViewSchema, ViewItemSchema } from '@objectstack/spec/ui';

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
  // The add-view button and the dialog are admin-only.
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
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

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

// The metadata seam's client: `createRuntimeMetadata` writes through `save`;
// the open dialog lists an empty dataset catalog through `list` / `get`.
const metadataClient = {
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => null),
  list: vi.fn(async () => []),
};
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => metadataClient,
}));

import { ObjectView, defaultListColumnsFromObject } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'crm_deal';
const DEAL = {
  name: OBJECT_NAME,
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'open', label: 'Open' }] },
    amount: { type: 'number', label: 'Amount' },
  },
  listViews: { [`${OBJECT_NAME}.all`]: { name: `${OBJECT_NAME}.all`, label: 'All', type: 'grid', columns: ['name'] } },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: {} })),
  } as any;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
/** The config pick for `key`: the shared Select's trigger, which shows the option it holds (objectui#11865). */
const picker = (key: string) => screen.getByTestId(`create-view-required-${key}`);

beforeEach(() => {
  cleanup();
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
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ObjectView.handleViewCreate persists a kanban through the one builder (objectui#11581)', () => {
  it('the saved config passes the spec ListViewSchema, the envelope the ViewItem gate, with the columns mirrored into kanban.columns', async () => {
    render(
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/*"
              element={<ObjectView dataSource={makeDataSource()} objects={[DEAL]} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>,
    );
    await settle();
    fireEvent.click(screen.getByTestId('view-tab-add'));
    const card = (await screen.findByTestId('create-view-type-kanban')) as HTMLButtonElement;
    await waitFor(() => expect(card.disabled).toBe(false));
    fireEvent.click(card);
    // `stage` is the object's one select field, so the dialog picks it.
    await waitFor(() => expect(picker('groupByField')).toHaveTextContent('Stage'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('create-view-submit'));
    });
    await waitFor(() => expect(metadataClient.save).toHaveBeenCalledTimes(1));
    const [type, , body, opts] = metadataClient.save.mock.calls[0] as unknown as [string, string, any, any];
    expect(type).toBe('view');
    expect(opts).toEqual({ mode: 'draft' });
    // The spec's verdict first: it is the claim this pin exists for.
    const listView = ListViewSchema.safeParse(body.config);
    expect(listView.success, JSON.stringify(listView.error?.issues)).toBe(true);
    const item = ViewItemSchema.safeParse(body);
    expect(item.success, JSON.stringify(item.error?.issues)).toBe(true);
    const columns = defaultListColumnsFromObject(DEAL, 5);
    expect(columns.length).toBeGreaterThan(0);
    expect(body.config.columns).toEqual(columns);
    expect(body.config.kanban).toEqual({ groupByField: 'stage', columns });
  });
});
