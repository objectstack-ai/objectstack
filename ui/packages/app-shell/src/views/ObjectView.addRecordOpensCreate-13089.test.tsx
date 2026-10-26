/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */


/**
 * objectui#13089 item 2 — on the console's object list, a saved view that
 * declares `addRecord: { enabled: true }` draws `ListView`'s Add button, and
 * the button opens the object list's own create flow: the same `onEdit(null)`
 * the header's New calls (`useObjectActions().create`), which `AppContent`
 * turns into the record-form overlay or, for an `editMode: 'page'` object, the
 * full-page create route.
 *
 * Before the fix `renderListView` forwarded `addRecord` and no `onAddRecord`,
 * so the button drew and its click did nothing.
 *
 * The button follows the verdict the header's New follows: a viewer who may
 * not create (or whose create the object greys) gets no Add button, rather
 * than one that would open a form the server refuses.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { allowCreate } = vi.hoisted(() => ({ allowCreate: { value: true } }));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
  const perms = {
    check: (_object: string, action: string) => ({ allowed: action === 'create' ? allowCreate.value : true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: (_object: string, action: string) => (action === 'create' ? allowCreate.value : true),
    cannot: (_object: string, action: string) => (action === 'create' ? !allowCreate.value : false),
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
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

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';
const VIEW_ID = `${OBJECT_NAME}.all`;

function objects(addRecord?: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      listViews: {
        [VIEW_ID]: {
          name: VIEW_ID,
          label: 'Everything',
          type: 'grid',
          columns: ['name'],
          ...(addRecord ? { addRecord } : {}),
        },
      },
    },
  ];
}

beforeEach(() => {
  allowCreate.value = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(addRecord?: Record<string, unknown>) {
  const onEdit = vi.fn();
  const dataSource = {
    find: vi.fn(async () => ({ data: [{ id: 'r1', name: 'Alpha' }], total: 1 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${VIEW_ID}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={<ObjectView dataSource={dataSource as never} objects={objects(addRecord)} onEdit={onEdit} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  return { onEdit, dataSource };
}

describe('objectui#13089 — a saved view’s `addRecord` on the console object list opens the object list’s create', () => {
  it('draws the Add button, and clicking it calls the same create the header’s New calls', async () => {
    const { onEdit, dataSource } = mount({ enabled: true });
    await screen.findByText('Alpha', undefined, { timeout: 5000 });
    const add = await screen.findByTestId('add-record-button');
    fireEvent.click(add);
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    // A NEW record: no record handed over, as the header's New hands none.
    expect(onEdit).toHaveBeenCalledWith(null);
    expect(dataSource.create).not.toHaveBeenCalled();

    // The header's New is the same create.
    fireEvent.click(screen.getByTestId('object-view-new-button'));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(2));
    expect(onEdit.mock.calls[1]).toEqual(onEdit.mock.calls[0]);
  });

  it('a viewer who may not create gets no Add button, as they get no New', async () => {
    allowCreate.value = false;
    mount({ enabled: true });
    await screen.findByText('Alpha', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('object-view-new-button')).toBeNull();
    expect(screen.queryByTestId('add-record-button')).toBeNull();
  });

  it('CONTROL: a view that declares no `addRecord` draws no Add button', async () => {
    mount();
    await screen.findByText('Alpha', undefined, { timeout: 5000 });
    expect(screen.getByTestId('object-view-new-button')).toBeTruthy();
    expect(screen.queryByTestId('add-record-button')).toBeNull();
  });
});
