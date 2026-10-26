/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5144, triage's ruling E — the console's inline-edit toggle is
 * session state and writes nothing.
 *
 * The view's `inlineEdit` and `userActions.editInline` are the author's
 * permission keys, and `normalizeListViewSchema` folds the first into the
 * second. The toggle used to persist a user's edit mode into `inlineEdit`
 * through `persistViewPatch` (the toolbar's view write, retired in
 * objectui#12504). After the fold, switching it off stored
 * `inlineEdit: false`, which reads as "not offered", so the toggle was gone
 * from the next load. Ruling E removes that write.
 *
 * ## What runs
 *
 * The harness of `ObjectView.fallbackTabSessionOnly-11643.test.tsx`: the real
 * object page over the real `ObjectStackAdapter`, whose metadata client is a
 * store that judges every PUT with the spec's `ViewMetadataSchema`. `ListView` is stubbed
 * to capture what the page hands it. Whether the toggle is OFFERED is
 * `ListView`'s `inlineEditOffered`, which reads the folded
 * `userActions.editInline` (pinned in `@object-ui/plugin-list`'s
 * `ListView.permissions.test.tsx`). These cases read that input: the schema the
 * page hands `ListView`, through the fold.
 *
 * The first "writes nothing" case carries its firing control: a view write
 * made in the same test through the real adapter IS recorded by the store, so
 * an empty write log is a reading of the toggle and not of a harness that
 * cannot see writes. (It was a density change on the same view until
 * objectui#12474 made the density the user's own list state.)
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
/** The firing control's own view: a write beside the views under test. */
const PROBE_ID = `${OBJECT_NAME}.probe`;

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  status: { type: 'text', label: 'Status' },
};

/** A served view that opts in to inline editing, the remedy the changeset names. */
const OPTED_IN_OBJECT = {
  name: OBJECT_NAME,
  label: 'Note',
  fields: FIELDS,
  listViews: {
    all: { label: 'All notes', type: 'grid', columns: ['title', 'status'], userActions: { editInline: true } },
  },
};

/** A served view that declares neither key. */
const PLAIN_OBJECT = {
  name: OBJECT_NAME,
  label: 'Note',
  fields: FIELDS,
  listViews: { all: { label: 'All notes', type: 'grid', columns: ['title', 'status'] } },
};

/** A user-saved view whose own row stores `inlineEdit: true`. */
const SAVED_ROW = {
  name: SAVED_ID,
  object: OBJECT_NAME,
  viewKind: 'list',
  label: 'Mine',
  config: {
    type: 'grid',
    data: { provider: 'object', object: OBJECT_NAME },
    columns: ['title', 'status'],
    inlineEdit: true,
  },
};

/**
 * A marked overlay on the served view from an earlier session, so the tab
 * carries a `viewKind` and its density write is a row the door keeps (the
 * same seed `ObjectView.fallbackTabSessionOnly-11643.test.tsx` uses).
 */
const SERVED_OVERLAY = {
  name: 'all',
  object: OBJECT_NAME,
  viewKind: 'list',
  columnState: { widths: { title: 240 } },
  _isOverride: true,
};

/** The firing control's write: a new view beside the served one, carrying no `inlineEdit`. */
const PROBE_ROW = {
  name: PROBE_ID,
  object: OBJECT_NAME,
  viewKind: 'list',
  label: 'Probe',
  config: {
    type: 'grid',
    data: { provider: 'object', object: OBJECT_NAME },
    columns: ['title'],
  },
};

/** An overlay the OLD toggle wrote on the served view: `inlineEdit: false`. */
const OLD_TOGGLE_OVERLAY = {
  name: 'all',
  object: OBJECT_NAME,
  viewKind: 'list',
  inlineEdit: false,
  _isOverride: true,
};

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
    createView: vi.fn((objectName: string, spec: any) => ds.createView(objectName, spec)),
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


/** The schema the page hands `ListView`, through the fold `ListView` runs. */
function folded(): { editInline: unknown; inlineEdit: unknown } {
  const schema = normalizeListViewSchema(listSchema) as { userActions?: Record<string, unknown>; inlineEdit?: unknown };
  return { editInline: schema.userActions?.editInline, inlineEdit: schema.inlineEdit };
}

/** Every body the store was asked to save that carries an `inlineEdit` anywhere. */
function bodiesCarryingInlineEdit(bodies: any[]): any[] {
  return bodies.filter((b) => b && ('inlineEdit' in b || (b.config && 'inlineEdit' in b.config)));
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

describe('objectui#5144 (ruling E) — the console inline-edit toggle writes nothing', () => {
  it('switching the toggle on a served view sends no write; the store records a view write when one is made', async () => {
    const { meta, rows, bodies } = makeStore([SERVED_OVERLAY]);
    const ds = await openPage(meta, OPTED_IN_OBJECT, 'all');
    expect(listSchema.label).toBe('All notes');
    expect(typeof listProps.onInlineEditChange).toBe('function');

    act(() => {
      listProps.onInlineEditChange(true);
      listProps.onInlineEditChange(false);
    });
    // Past the old toolbar write's 300 ms debounce, with room to spare.
    await wait(700);
    expect(meta.saveItem).not.toHaveBeenCalled();
    expect(rows.get('all')).toEqual(SERVED_OVERLAY);

    // Firing control: the store records a view write when one is made. No
    // list toolbar control makes one (objectui#12474, and objectui#12504
    // retired the toolbar's view write), so the write is the real adapter's
    // own, a view created beside the served one.
    await act(async () => {
      await ds.createView(OPTED_IN_OBJECT.name, PROBE_ROW);
    });
    expect(meta.saveItem).toHaveBeenCalledTimes(1);
    expect(rows.get(PROBE_ID).label).toBe('Probe');
    expect(rows.get('all')).toEqual(SERVED_OVERLAY);
    expect(bodiesCarryingInlineEdit(bodies)).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('two-way: on a view that declares `userActions.editInline: true`, the toggle is still offered after it is switched off and the view remounts', async () => {
    const { meta, rows } = makeStore([SERVED_OVERLAY]);
    await openPage(meta, OPTED_IN_OBJECT, 'all');
    expect(folded().editInline).toBe(true);

    act(() => listProps.onInlineEditChange(false));
    await wait(700);
    expect(rows.get('all')).toEqual(SERVED_OVERLAY);

    cleanup();
    await openPage(meta, OPTED_IN_OBJECT, 'all');
    expect(folded().editInline).toBe(true);
    // Nothing was stored, so the mode is seeded from the view again.
    expect(folded().inlineEdit).toBeUndefined();
  });

  it('a saved view: the toggle switched off writes nothing, and the stored `inlineEdit: true` is what the next load reads', async () => {
    // Recorded cost of ruling E: the edit mode is not remembered across loads.
    const { meta, rows, bodies } = makeStore([SAVED_ROW]);
    await openPage(meta, PLAIN_OBJECT, SAVED_ID);
    expect(listSchema.label).toBe('Mine');
    expect(folded()).toEqual({ editInline: true, inlineEdit: true });

    act(() => listProps.onInlineEditChange(false));
    await wait(700);
    expect(meta.saveItem).not.toHaveBeenCalled();

    // Since objectui#12474 a density change on the same saved view writes no
    // row either (it is the user's own list state), so the row's own
    // `inlineEdit` is untouched and no body carries the toggle's `false`.
    act(() => listSchema.onDensityChange('comfortable'));
    await wait(700);
    expect(meta.saveItem).not.toHaveBeenCalled();
    expect(rows.get(SAVED_ID).config.inlineEdit).toBe(true);
    expect(bodiesCarryingInlineEdit(bodies)).toEqual([]);

    cleanup();
    await openPage(meta, PLAIN_OBJECT, SAVED_ID);
    expect(folded()).toEqual({ editInline: true, inlineEdit: true });
  });

  it('an overlay the old toggle wrote, `inlineEdit: false`, still reads off', async () => {
    // Recorded cost of ruling E: existing data, and the maintainer's ruling
    // rejects migrating it. `@object-ui/data-objectstack` still lists
    // `inlineEdit` among the keys an overlay owns, so the row is read.
    const { meta } = makeStore([OLD_TOGGLE_OVERLAY]);
    await openPage(meta, PLAIN_OBJECT, 'all');
    expect(folded()).toEqual({ editInline: false, inlineEdit: false });
  });

  it('control: the same served view with no overlay declares nothing, which `ListView` reads on by the v18 spec default (objectui#12086)', async () => {
    const { meta } = makeStore([]);
    await openPage(meta, PLAIN_OBJECT, 'all');
    expect(folded()).toEqual({ editInline: undefined, inlineEdit: undefined });
  });
});
