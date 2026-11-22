// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36370 — a board's changed settings are a part of the list's
 * DRAFT (objectstack#35955), and 「Save as my view」 keeps them.
 *
 * Measured live on the CRM pipeline (a view a read-only package ships): the
 * reader hid a lane, turned the field names off and picked a count, saved
 * the board as one of their own views, and the new view opened with none of
 * it — 「Save as my view」 laid the row colour over the body and never the
 * board's part. Pinned here on the real `ObjectView` with the harness of
 * `ObjectView.footerCalculationDraft-36194.test.tsx`: the changes go through
 * the list's `onKanbanChange` door, write nothing, and the stored row's
 * `config.kanban` carries them.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';

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
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
  // The shared view's saves are an administrator's.
  useWorkspaceAdminStatus: () => ({ isAdmin: reader.admin, isResolved: true }),
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

/** Whether the reader is a workspace administrator. */
const reader = vi.hoisted(() => ({ admin: true }));

/** The props the list was last handed. */
const listProps = vi.hoisted(() => ({ current: null as Record<string, any> | null }));
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    listProps.current = props;
    // The condition row's end: Discard and Save while the list holds a draft.
    return <div data-testid="list-stand-in">{props.conditionRowEnd}</div>;
  },
}));

/** The session-held package list, as `GET /api/v1/packages` answers it (parsed). */
const packageList = vi.hoisted(() => ({ answer: (): Promise<any[]> => Promise.resolve([]) }));
vi.mock('./studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchSessionPackages: vi.fn(() => packageList.answer()),
}));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { resetListDraftStoreForTests } from './listDraftStore';

const OBJECT = 'showcase_task';
const SHIPPED_PACKAGE = 'com.example.showcase';
const CUSTOM_PACKAGE = 'com.example.showcase.custom';

/** A view the read-only code package ships, as `listViews()` serves it. */
const SHIPPED = {
  name: `${OBJECT}.in_progress`, object: OBJECT, label: 'In progress', type: 'grid',
  columns: ['name', 'amount'], _packageId: SHIPPED_PACKAGE,
};
/** A shared view the console saved: dotted the same way, in the customization package. */
const CUSTOM = {
  name: `${OBJECT}.team_tasks`, object: OBJECT, label: 'Team tasks', type: 'grid',
  columns: ['name', 'amount'], _packageId: CUSTOM_PACKAGE,
};
/** A stored view bound to no package. */
/** A board the read-only package ships. */
const BOARD = {
  name: `${OBJECT}.board`, object: OBJECT, label: 'Board', type: 'kanban',
  columns: ['name', 'amount'], kanban: { groupByField: 'status', columns: ['name', 'amount'] },
  _packageId: SHIPPED_PACKAGE,
};
const UNBOUND = { name: `${OBJECT}.unbound`, object: OBJECT, label: 'Unbound', type: 'grid', columns: ['name', 'amount'] };
/** A stored view that declares no columns (the list draws the object's defaults). */
const BARE = { name: `${OBJECT}.bare`, object: OBJECT, label: 'Bare', type: 'grid' };
/** The reader's own view (`sys_personal_view`). */
const PERSONAL = {
  id: 'pv_mine', user_id: 'u1', object_name: OBJECT, label: 'My tasks',
  config: { type: 'grid', columns: ['name', 'amount'], data: { provider: 'object', object: OBJECT } },
};

/** The packages row for each id: the server's `writable` verdict. */
const PACKAGES = [
  { id: SHIPPED_PACKAGE, name: 'Showcase', writable: false, namespace: 'showcase' },
  { id: CUSTOM_PACKAGE, name: 'Showcase (custom)', writable: true, namespace: 'showcase' },
];

function mount(viewId: string) {
  const dataSource = {
    find: vi.fn(async (resource: string) =>
      resource === 'sys_personal_view' ? { data: [PERSONAL], total: 1 } : { data: [], total: 0 }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async (_resource: string, data: Record<string, any>) => ({ id: 'pv_new', ...data })),
    update: vi.fn(async (_resource: string, _id: string, _patch: Record<string, any>) => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: {} })),
    listViews: vi.fn(async () => [SHIPPED, CUSTOM, UNBOUND, BARE, BOARD]),
    updateView: vi.fn(async () => ({})),
  };
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/view/${encodeURIComponent(viewId)}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={
              <ObjectView
                dataSource={dataSource as never}
                objects={[{
                  name: OBJECT,
                  label: 'Task',
                  fields: {
                    name: { type: 'text', label: 'Name' },
                    amount: { type: 'number', label: 'Amount' },
                    status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }] },
                  },
                }]}
                onEdit={() => {}}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  return { dataSource };
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));

/** Whether the list is handed the footer's calculation pick. */
const offersMenu = () => typeof listProps.current?.onColumnSummaryPick === 'function';
/** Pick a calculation through the list's door, as the grid's footer menu does. */
const pick = (field: string, summary: string | null) =>
  act(async () => {
    expect(await listProps.current!.onColumnSummaryPick(field, summary)).toBe(true);
  });
/** The calculation the list draws under `field`, as its schema's columns carry it. */
const summaryOf = (field: string) => {
  const columns = (listProps.current?.schema?.columns ?? []) as Array<string | { field: string; summary?: unknown }>;
  const column = columns.find((c) => (typeof c === 'string' ? c : c.field) === field);
  return column && typeof column === 'object' ? column.summary : undefined;
};
const storedSummaries = (config: any) =>
  Object.fromEntries(
    ((config?.columns ?? []) as Array<string | { field: string; summary?: unknown }>)
      .filter((c): c is { field: string; summary?: unknown } => typeof c === 'object' && c.summary !== undefined)
      .map((c) => [c.field, c.summary]),
  );
const openSave = async () => {
  fireEvent.pointerDown(await screen.findByTestId('list-draft-save'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByTestId('list-draft-save-menu');
};

/** Every request the page sends through `fetch` that is not a read. */
const writes: string[] = [];
vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') writes.push(`${method} ${String(input)}`);
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
}));

beforeEach(() => {
  listProps.current = null;
  reader.admin = true;
  writes.length = 0;
  packageList.answer = () => Promise.resolve(PACKAGES);
  localStorage.clear();
  resetListDraftStoreForTests();
});

afterEach(() => {
  cleanup();
});

describe('objectstack#36370 — 「Save as my view」 keeps a board\'s changed settings', () => {
  it('the changes write nothing, Save names them, and the new view stores them', async () => {
    const page = mount(BOARD.name);
    await settle();
    await waitFor(() => expect(typeof listProps.current?.onKanbanChange).toBe('function'));

    act(() => {
      listProps.current!.onKanbanChange({ lanes: ['done'] });
    });
    act(() => {
      listProps.current!.onKanbanChange({ showFieldLabels: false, summary: { type: 'count' } });
    });
    await settle();
    expect(listProps.current?.schema?.kanban).toMatchObject({ lanes: ['done'], showFieldLabels: false, summary: { type: 'count' } });
    expect(writes).toEqual([]);
    expect(page.dataSource.updateView).not.toHaveBeenCalled();

    await openSave();
    fireEvent.click(await screen.findByTestId('list-draft-save-as'));
    fireEvent.click(await screen.findByTestId('personal-view-name-submit'));
    await waitFor(() => expect(page.dataSource.create).toHaveBeenCalledTimes(1));
    const [resource, row] = page.dataSource.create.mock.calls[0];
    expect(resource).toBe('sys_personal_view');
    expect(row.config.kanban).toMatchObject({
      groupByField: 'status',
      lanes: ['done'],
      showFieldLabels: false,
      summary: { type: 'count' },
    });
    expect(writes).toEqual([]);
  });
});
