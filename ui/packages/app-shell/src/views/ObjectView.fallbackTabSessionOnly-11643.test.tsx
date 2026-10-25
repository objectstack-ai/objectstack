/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11643 — on an object that declares no list view, the tab the console
 * makes for it ("All Records", id `all`) keeps its toolbar changes for the
 * session and sends no metadata write.
 *
 * ## The defect this pins
 *
 * `buildViewTabs` pushes a console-made fallback tab when an object declares no
 * defined or primary view. Its toolbar changes went down `persistViewPatch`'s
 * overlay branch (the toolbar's view write, retired in objectui#12504) like a
 * served view's: measured live on objectstack `main`
 * (showcase, `showcase_account`), a density toggle sent `PUT
 * /api/v1/meta/view/all` with `{ rowHeight, object, name: 'all', _isOverride }`
 * and no `viewKind`, the door answered `422 INVALID_METADATA`, and the density
 * was gone on reload.
 *
 * Triage's ruling (comment `5988346142`): the fallback tab's toolbar changes
 * apply for the session and send no `PUT /meta/view/…`; no view is created to
 * hold them. On an object with a served view the save path is unchanged.
 *
 * ## What runs
 *
 * The harness of `ObjectView.toolbarWritesCompose-11642.test.tsx`: the real
 * object page over the real `ObjectStackAdapter`, whose metadata client is a
 * store that judges every PUT with the spec's own `ViewMetadataSchema` and
 * keeps the parsed value. `ListView` is stubbed to capture what the page hands
 * it, so a toolbar change is the page's own callback — every one that used to
 * reach the toolbar's view write. A "reload" unmounts the page and mounts it
 * again over a fresh adapter on the same store.
 *
 * ## Since objectui#12418 and objectui#12474
 *
 * No list toolbar control writes a view any more: the sort and the column
 * layout (objectui#12418), the density and the hidden fields (objectui#12474)
 * are the user's own list state. The console-made tab still sends nothing; the
 * real rows beside it, which this file pinned keeping their save path, now
 * keep the change as the user's state too and are not written. objectui#12504
 * retired the toolbar's view write itself (`persistViewPatch`, with the
 * console-made tab's mark that guarded it, and the adapter's
 * `updateViewConfig`), so these cases now pin that no toolbar control on any
 * tab writes a view. The direction note below is the original fix's.
 *
 * ## Direction of the reverse-verification run
 *
 * - Guard removed: every case that drives the console-made tab goes red on its
 *   write count — the first test, and the first half of the saved-view test,
 *   which toggles that tab before it opens the saved view. The prediction named
 *   the first test only; the run showed both. The two cases keyed on `all`
 *   stay green.
 * - Guard keyed on the id `all` instead of the mark: the served view named `all`
 *   and the stored row named `all` go red (their writes stop); the two
 *   console-made-tab cases stay green. As predicted.
 * - The stored-row clause dropped: only the stored row named `all` goes red. As
 *   predicted.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { normalizeListViewSchema } from '@object-ui/core';
import { ViewMetadataSchema } from '@objectstack/spec/ui';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

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

/** What the object page hands `ListView`: captured, not rendered. */
let listProps: any = null;
let listSchema: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    listProps = props;
    listSchema = props.schema;
    return null;
  },
}));

import { toast } from 'sonner';
import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'track_note';
const SAVED_ID = `${OBJECT_NAME}.mine`;

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  status: { type: 'text', label: 'Status' },
};

/** An object that declares no list view: the page makes the "All Records" tab for it. */
const VIEWLESS_OBJECT = { name: OBJECT_NAME, label: 'Note', fields: FIELDS };

/** A user-saved view on that object — a real row, beside the console-made tab. */
const SAVED_ROW = {
  name: SAVED_ID,
  object: OBJECT_NAME,
  viewKind: 'list',
  label: 'Mine',
  config: {
    type: 'grid',
    data: { provider: 'object', object: OBJECT_NAME },
    columns: ['title', 'status'],
    filter: [{ field: 'status', operator: 'equals', value: 'mine' }],
  },
};

/**
 * A stored row whose name is `all` and that carries no overlay marker, so the
 * switcher lists it as a saved view and it shadows the console-made tab.
 */
const STORED_ALL_ROW = {
  name: 'all',
  object: OBJECT_NAME,
  viewKind: 'list',
  label: 'All (stored)',
  type: 'grid',
  columns: ['title', 'status'],
};

/** An object whose OWN `listViews` declares a served view under the bare key `all`. */
const SERVED_ALL_OBJECT = {
  ...VIEWLESS_OBJECT,
  listViews: { all: { label: 'All notes', type: 'grid', columns: ['title', 'status'] } },
};

/** A marked overlay on that served view, from an earlier session. */
const SERVED_ALL_OVERLAY = {
  name: 'all',
  object: OBJECT_NAME,
  viewKind: 'list',
  columnState: { widths: { title: 240 } },
  _isOverride: true,
};

const SORT = [{ id: 'row-1', field: 'title', order: 'asc' }];

/** The console-made tab's label: no locale bundle is loaded here, so the key renders. */
const FALLBACK_TAB_LABEL = 'console.objectView.allRecords';

/**
 * A `sys_metadata`-shaped store: every PUT is judged by the spec's
 * `ViewMetadataSchema`, the PARSED value is kept, and the PUT is answered the
 * way the door answers it — with no row.
 */
function makeStore(seed: Record<string, any>[]) {
  const rows = new Map<string, any>();
  for (const row of seed) rows.set(row.name, structuredClone(row));
  let seq = 0;
  const bodies: any[] = [];
  const meta = {
    getItems: vi.fn(async (type: string) => ({
      type,
      items: type === 'view' ? [...rows.values()].map((r) => structuredClone(r)) : [],
    })),
    getItem: vi.fn(async (type: string, name: string) => {
      const item = type === 'view' ? rows.get(name) : undefined;
      if (!item) throw Object.assign(new Error(`Not found: ${type}/${name}`), { status: 404 });
      return { type, name, item: structuredClone(item) };
    }),
    saveItem: vi.fn(async (_type: string, name: string, item: any) => {
      bodies.push(structuredClone(item));
      const judged = ViewMetadataSchema.safeParse(item);
      if (!judged.success) {
        throw Object.assign(new Error(`422 INVALID_METADATA: ${judged.error.message}`), { status: 422 });
      }
      const kept = Object.fromEntries(
        Object.entries(judged.data as Record<string, unknown>).filter(([key]) => key in item),
      );
      rows.set(name, kept);
      seq += 1;
      return { success: true, version: `hmac-sha256:${'0'.repeat(63)}${seq}`, seq, state: 'active', message: `Saved view '${name}'` };
    }),
  };
  return { meta, rows, bodies };
}

/** The real adapter over the store, and the page's data source over the adapter. */
function pageDataSource(meta: any) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { meta };
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    listViews: (objectName: string, o?: any) => ds.listViews(objectName, o),
    listViewOverrides: (objectName: string) => ds.listViewOverrides(objectName),
    getView: (objectName: string, viewId: string) => ds.getView(objectName, viewId),
  } as any;
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/** Mount the object page (on `viewId`, or on the object's default tab) and wait for its list schema. */
async function openPage(meta: any, object: Record<string, any>, viewId?: string) {
  listProps = null;
  listSchema = null;
  const dataSource = pageDataSource(meta);
  const page = (
    <ObjectView dataSource={dataSource} objects={[object]} onEdit={() => {}} />
  );
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[viewId ? `/apps/demo/${OBJECT_NAME}/view/${viewId}` : `/apps/demo/${OBJECT_NAME}`]}>
        <Routes>
          <Route path="/apps/:appName/:objectName" element={page} />
          <Route path="/apps/:appName/:objectName/view/:viewId" element={page} />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await waitFor(() => expect(typeof listSchema?.onDensityChange).toBe('function'));
  // Let the page's own reads (saved views, stored rows) land before a toggle.
  await wait(50);
  return dataSource;
}

/** Unmount, then open the view again over a fresh adapter: what a reload renders. */
async function reload(meta: any, object: Record<string, any>, viewId: string) {
  cleanup();
  await openPage(meta, object, viewId);
  await waitFor(() => expect(listSchema?.options).toBeTruthy());
  return (normalizeListViewSchema(listSchema) as { rowHeight?: unknown }).rowHeight;
}

/** What a refused view write logs (the view-config panel's save still does) before it toasts. */
function persistFailuresLogged(): unknown[][] {
  return (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((call) => String(call[0]).includes('Failed to persist view config'));
}

beforeEach(() => {
  cleanup();
  listProps = null;
  listSchema = null;
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/**
 * objectui#12474 — a density change on a real row used to be written into
 * it (the save path this file kept open beside the console-made tab). The
 * density is the user's own list state now, on every tab, so a real row is
 * not written either: the change survives the reload from the user's state
 * (this harness mounts no preference provider, so that state is this
 * browser's), and the row stays exactly as stored.
 */
async function densityIsTheUsers(meta: any, rows: Map<string, any>, object: Record<string, any>, viewId: string) {
  const before = structuredClone(rows.get(viewId));
  await openPage(meta, object, viewId);
  act(() => listSchema.onDensityChange('comfortable'));
  await wait(700);

  expect(meta.saveItem).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(rows.get(viewId)).toEqual(before);
  expect(await reload(meta, object, viewId)).toBe('medium');
}

describe('objectui#11643 — the console-made tab of a view-less object keeps its toolbar changes for the session', () => {
  it('every toolbar control on it sends no metadata write and raises no error', async () => {
    const { meta, rows } = makeStore([]);
    await openPage(meta, VIEWLESS_OBJECT);
    // The page opened the tab it made: the object declares nothing else.
    expect(listSchema.label).toBe(FALLBACK_TAB_LABEL);

    // Every control that used to reach the toolbar's view write, through both
    // the schema's and the list's own spelling of it. `onInlineEditChange` no longer reaches
    // it at all (objectui#5144, ruling E: the toggle is session-only); it stays
    // here because it must still write nothing.
    act(() => {
      listSchema.onDensityChange('comfortable');
      listSchema.onSortChange(SORT);
      listSchema.onHiddenFieldsChange(['status']);
      listSchema.onColumnStateChange({ widths: { title: 240 } });
      listProps.onSortChange(SORT);
      listProps.onHiddenFieldsChange(['status']);
      listProps.onInlineEditChange(true);
      listProps.onColumnStateChange({ order: ['status', 'title'] });
    });
    // Past the 300 ms debounce and any round trip it would have started.
    await wait(700);

    expect(meta.saveItem).not.toHaveBeenCalled();
    expect(meta.getItem).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(persistFailuresLogged()).toEqual([]);
  });

  it('a saved view beside it is a real row: its density change is the user\'s, writes no row, and survives a reload', async () => {
    const { meta, rows } = makeStore([SAVED_ROW]);

    // The console-made tab sits beside the saved view and still sends nothing.
    await openPage(meta, VIEWLESS_OBJECT, 'all');
    expect(listSchema.label).toBe(FALLBACK_TAB_LABEL);
    act(() => listSchema.onDensityChange('comfortable'));
    await wait(700);
    expect(meta.saveItem).not.toHaveBeenCalled();

    cleanup();
    await densityIsTheUsers(meta, rows, VIEWLESS_OBJECT, SAVED_ID);
    expect(listSchema.label).toBe('Mine');
  });
});

describe('objectui#11643 — provenance decides, not the id `all`', () => {
  it('a served view whose tab id is `all`: its density change is the user\'s and writes no overlay', async () => {
    const { meta, rows } = makeStore([SERVED_ALL_OVERLAY]);
    await densityIsTheUsers(meta, rows, SERVED_ALL_OBJECT, 'all');
    expect(listSchema.label).toBe('All notes');
  });

  it('a stored row named `all` that shadows the console-made tab: its density change is the user\'s and writes no row', async () => {
    const { meta, rows } = makeStore([STORED_ALL_ROW]);
    await densityIsTheUsers(meta, rows, VIEWLESS_OBJECT, 'all');
    // The stored row's own label: the switcher merged it onto the tab the page made.
    expect(listSchema.label).toBe('All (stored)');
  });
});
