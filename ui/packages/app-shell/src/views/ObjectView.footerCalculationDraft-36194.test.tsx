// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36194 + objectstack#36195 — the footer's calculation is a part of
 * the list's DRAFT (objectstack#35955), like the sort and the filter.
 *
 * A pick applies at once (the columns the list is handed carry it) and writes
 * nothing: no view save, no draft save, no write to the reader's own view.
 * Save's menu names it (「Calculations」) beside the other unsaved parts;
 * Discard drops it; picking the view's own calculation again drops the column
 * from the draft. A save keeps it: 「Save to this view」 on the reader's own
 * view, 「Save as my view」 anywhere.
 *
 * So a view the reader cannot change in place (one a read-only package ships,
 * objectstack#35933, or a shared view of a reader who is no admin) offers the
 * menu too: the pick goes into the draft, and Save offers 「Save as my view」
 * alone. Nothing a pick does reaches the door that refused it
 * (objectstack#36195: `PUT /meta/view/<name>?mode=draft` answered
 * `NOT_OVERRIDABLE` in English).
 *
 * The menu is offered on the columns a saved body carries: the columns the
 * list draws (the view's own, or the defaults drawn into a view that declares
 * none) and the ones the reader added.
 *
 * What runs: the real `ObjectView` on a stub data source. `ListView` is
 * replaced by a stand-in that records the props it is handed and draws the
 * condition row's end (Discard and Save), so the menu's presence is read as
 * the `onColumnSummaryPick` the list receives (the grid draws the menu exactly
 * when it has one, pinned in plugin-grid's `footerCalculationPicker-35702`
 * tests). The package list is stubbed at `fetchSessionPackages`; every request
 * the page sends through `fetch` is recorded.
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
import { listDraftScope, readListDraft, resetListDraftStoreForTests } from './listDraftStore';

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
    listViews: vi.fn(async () => [SHIPPED, CUSTOM, UNBOUND, BARE]),
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
                  fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
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

describe('objectstack#36194 — a footer pick is a part of the list\'s draft', () => {
  it('a pick applies at once and writes nothing; Save names it; picking the view\'s own drops it', async () => {
    const page = mount(CUSTOM.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
    expect(listProps.current?.columnSummaryPickFields).toEqual(['name', 'amount']);

    await pick('amount', 'sum');
    expect(summaryOf('amount')).toBe('sum');
    expect(screen.getByTestId('list-draft')).toBeInTheDocument();
    const menu = await openSave();
    expect(menu.querySelector('[data-testid="list-draft-parts"]')).toHaveTextContent('personalizedParts.summaries');
    expect(writes).toEqual([]);
    expect(page.dataSource.update).not.toHaveBeenCalled();
    expect(page.dataSource.updateView).not.toHaveBeenCalled();

    // None, over a column the view does not sum, is the view's own again.
    await pick('amount', null);
    expect(summaryOf('amount')).toBeUndefined();
    await waitFor(() => expect(screen.queryByTestId('list-draft')).toBeNull());
    expect(readListDraft(listDraftScope('u1', OBJECT, CUSTOM.name))).toEqual({});
    expect(writes).toEqual([]);
  });

  it('Discard takes the calculation off: the list is the view\'s again', async () => {
    mount(CUSTOM.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
    await pick('amount', 'avg');
    fireEvent.click(await screen.findByTestId('list-draft-discard'));
    await waitFor(() => expect(screen.queryByTestId('list-draft')).toBeNull());
    expect(summaryOf('amount')).toBeUndefined();
    expect(writes).toEqual([]);
  });

  it('the reader\'s own view: the pick writes nothing until 「Save to this view」, which stores it', async () => {
    const page = mount(PERSONAL.id);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
    await pick('amount', 'max');
    expect(summaryOf('amount')).toBe('max');
    expect(page.dataSource.update).not.toHaveBeenCalled();

    await openSave();
    fireEvent.click(await screen.findByTestId('list-draft-save-to-view'));
    await waitFor(() => expect(page.dataSource.update).toHaveBeenCalledTimes(1));
    const [resource, id, patch] = page.dataSource.update.mock.calls[0];
    expect([resource, id]).toEqual(['sys_personal_view', PERSONAL.id]);
    expect(storedSummaries(patch.config)).toEqual({ amount: 'max' });
    expect(writes).toEqual([]);
  });

  it('a view that declares no columns: the menu is on the columns the list draws, and 「Save as my view」 keeps them with the pick', async () => {
    const page = mount(BARE.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
    const drawn = listProps.current?.columnSummaryPickFields as string[];
    expect(drawn).toContain('amount');
    await pick('amount', 'sum');
    await openSave();
    fireEvent.click(await screen.findByTestId('list-draft-save-as'));
    fireEvent.click(await screen.findByTestId('personal-view-name-submit'));
    await waitFor(() => expect(page.dataSource.create).toHaveBeenCalledTimes(1));
    const [, row] = page.dataSource.create.mock.calls[0];
    expect(storedSummaries(row.config)).toEqual({ amount: 'sum' });
    expect(writes).toEqual([]);
  });
});

describe('objectstack#36195 — a view the reader cannot change in place: the pick goes into the draft, Save offers 「Save as my view」 alone', () => {
  it('a view a read-only package ships: the pick is drawn, nothing reaches the door, and 「Save as my view」 stores it', async () => {
    const page = mount(SHIPPED.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
    // objectstack#35974 — the rename lands in the package's customization pair.
    expect(typeof listProps.current?.onRenameView).toBe('function');

    await pick('amount', 'count_unique');
    expect(summaryOf('amount')).toBe('count_unique');
    expect(writes).toEqual([]);
    expect(page.dataSource.updateView).not.toHaveBeenCalled();

    await openSave();
    expect(screen.queryByTestId('list-draft-save-to-view')).toBeNull();
    fireEvent.click(await screen.findByTestId('list-draft-save-as'));
    fireEvent.click(await screen.findByTestId('personal-view-name-submit'));
    await waitFor(() => expect(page.dataSource.create).toHaveBeenCalledTimes(1));
    const [resource, row] = page.dataSource.create.mock.calls[0];
    expect(resource).toBe('sys_personal_view');
    expect(storedSummaries(row.config)).toEqual({ amount: 'count_unique' });
    expect(writes).toEqual([]);
  });

  it('the pick does not wait for the package list: while it is unread, the pick is a draft all the same', async () => {
    packageList.answer = () => new Promise<any[]>(() => {});
    const page = mount(SHIPPED.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
    await pick('amount', 'sum');
    expect(summaryOf('amount')).toBe('sum');
    expect(writes).toEqual([]);
    expect(page.dataSource.updateView).not.toHaveBeenCalled();
  });

  it('a reader who is no admin on a shared view: the pick is a draft too, and Save offers 「Save as my view」 alone', async () => {
    reader.admin = false;
    mount(UNBOUND.name);
    await settle();
    await waitFor(() => expect(offersMenu()).toBe(true));
    await pick('amount', 'sum');
    expect(summaryOf('amount')).toBe('sum');
    await openSave();
    expect(screen.queryByTestId('list-draft-save-to-view')).toBeNull();
    expect(screen.getByTestId('list-draft-save-as')).toBeInTheDocument();
    expect(writes).toEqual([]);
  });
});
