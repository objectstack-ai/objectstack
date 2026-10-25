/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11642 — two toolbar changes to one view in one session both survive
 * a reload, on every row kind: an envelope row, a flat row and an overlay.
 *
 * ## The defect this pins
 *
 * `persistViewPatch` sent a whole-document PUT (`updateViewConfig` →
 * `client.meta.saveItem`). It built every body from the active tab as it was
 * when the page loaded — or, for an overlay, from the pending patch alone — and
 * nothing moved that base after a write landed. So the second change was built
 * from a row that no longer existed and dropped the first. Measured live on
 * objectstack `main` (showcase): density, then a header sort, then a reload
 * showed the sort and the OLD density, on all three row kinds.
 *
 * Triage's ruling: after a successful write, the base for the next write is the
 * row that write stored, on every row kind; no client-side merge of guessed
 * fields. The PUT answer carries no row (measured: `{ success, version, seq,
 * state, message }`), and the door drops undeclared keys, so the row is READ
 * BACK — through `loadViewOverrides`, the reader a reload uses — when each write
 * runs.
 *
 * ## What runs
 *
 * The real object page over the real `ObjectStackAdapter`, whose metadata
 * client is a store that judges every PUT with the spec's own
 * `ViewMetadataSchema`, keeps
 * the parsed value (so it drops what the door drops), and answers the PUT the
 * way the door was measured to answer it: with no row. `ListView` is stubbed to
 * capture the schema the page hands it, so a toolbar change is the page's own
 * `onDensityChange` / `onHiddenFieldsChange` callback. A "reload" unmounts the
 * page and mounts it again over a fresh adapter on the same store.
 *
 * The second change was the header sort until objectui#12418 made the sort the
 * user's own list state (`sys_user_preference`, never the view). Since
 * objectui#12474 the density and the hide-field toggle are the user's too, so
 * no toolbar change writes the view at all: each case now pins that both
 * changes survive the reload from the user's state while the stored row stays
 * exactly as it was. `persistViewPatch` itself retired in objectui#12504, with
 * the adapter's `updateViewConfig`. The direction note below is the original
 * fix's.
 *
 * ## Direction, written before the reverse-verification run
 *
 * With `persistViewPatch` put back to building the body from the page-load tab
 * (envelope and flat) and from the pending patch alone (overlay), every
 * `two changes … both survive a reload` case is PREDICTED to go red on the
 * FIRST change's key (the density), and the in-flight case red the same way.
 * The single-write coalescing case is predicted to stay green: one debounced
 * write carrying both keys never depended on the base.
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

/** The list schema the object page hands down: captured, not rendered. */
let listSchema: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    listSchema = props.schema;
    return null;
  },
}));

import { toast } from 'sonner';
import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'track_task';
const ENVELOPE_ID = `${OBJECT_NAME}.in_progress`;
const FLAT_ID = `${OBJECT_NAME}.flat_mine`;
const OVERLAY_ID = `${OBJECT_NAME}.done`;

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  status: { type: 'text', label: 'Status' },
};

/** A served list view's stored row: the ViewItem envelope. */
const ENVELOPE_ROW = {
  name: ENVELOPE_ID,
  object: OBJECT_NAME,
  viewKind: 'list',
  label: 'In Progress',
  config: {
    type: 'grid',
    data: { provider: 'object', object: OBJECT_NAME },
    columns: ['title', 'status'],
    filter: [{ field: 'status', operator: 'equals', value: 'in_progress' }],
  },
};

/** A saved view whose row is flat — no `config`, no overlay marker. */
const FLAT_ROW = {
  name: FLAT_ID,
  object: OBJECT_NAME,
  viewKind: 'list',
  label: 'Flat Mine',
  type: 'grid',
  columns: ['title', 'status'],
  filter: [{ field: 'status', operator: 'equals', value: 'todo' }],
};

/** The code-defined view an overlay shadows — it has no row of its own. */
const DONE_SOURCE = {
  name: OVERLAY_ID,
  label: 'Done',
  type: 'grid',
  columns: ['title', 'status'],
  filter: [{ field: 'status', operator: 'equals', value: 'done' }],
};

/** A marked overlay on that view, from an earlier session. */
const OVERLAY_ROW = {
  name: OVERLAY_ID,
  object: OBJECT_NAME,
  viewKind: 'list',
  columnState: { widths: { title: 240 } },
  _isOverride: true,
};

/** The object's views as the served object document lists them. */
const DEFINED_VIEWS = {
  [ENVELOPE_ID]: { ...ENVELOPE_ROW.config, name: ENVELOPE_ID, label: ENVELOPE_ROW.label },
  [FLAT_ID]: { ...FLAT_ROW },
  [OVERLAY_ID]: { ...DONE_SOURCE },
};

/** The field the Hide Fields popover hides: the second toolbar change. */
const HIDDEN = ['status'];

/**
 * A `sys_metadata`-shaped store: every PUT is judged by the spec's
 * `ViewMetadataSchema` and the PARSED value is kept, and the PUT is answered
 * the way the door answers it — with no row.
 */
function makeStore(seed: Record<string, any>[], opts: { putDelayMs?: (n: number) => number } = {}) {
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
      const n = bodies.push(structuredClone(item));
      const delay = opts.putDelayMs?.(n) ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      const judged = ViewMetadataSchema.safeParse(item);
      if (!judged.success) {
        throw Object.assign(new Error(`422 INVALID_METADATA: ${judged.error.message}`), { status: 422 });
      }
      // The parsed value of every key the body carried: an undeclared key is
      // gone, and a schema default the body never named is not invented.
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

/** Mount the object page on `viewId` and wait for the page's list schema. */
async function openView(meta: any, viewId: string) {
  listSchema = null;
  const dataSource = pageDataSource(meta);
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${viewId}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={
              <ObjectView
                dataSource={dataSource}
                objects={[{ name: OBJECT_NAME, label: 'Task', fields: FIELDS, listViews: DEFINED_VIEWS }]}
                onEdit={() => {}}
              />
            }
          />
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
async function reload(meta: any, viewId: string) {
  cleanup();
  await openView(meta, viewId);
  await waitFor(() => expect(listSchema?.options).toBeTruthy());
  return {
    rowHeight: (normalizeListViewSchema(listSchema) as { rowHeight?: unknown }).rowHeight,
    hiddenFields: listSchema.hiddenFields,
  };
}

/** Density, wait past the 300 ms debounce and the round trip, then a hidden field. */
async function densityThenHide(gapMs = 600) {
  act(() => listSchema.onDensityChange('comfortable'));
  await wait(gapMs);
  act(() => listSchema.onHiddenFieldsChange(HIDDEN));
  await wait(600);
}

beforeEach(() => {
  cleanup();
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

describe('objectui#11642 — two toolbar changes in one session both survive a reload, on every row kind', () => {
  /**
   * objectui#12474 — the density and the hidden fields are the USER's own
   * list state now (`listPrefs`, beside the sort and the column layout), so
   * neither change writes the view on any row kind: each row is left exactly
   * as stored, and the reload shows both changes from the user's state. This
   * harness mounts no preference provider, so that state is this browser's
   * (the provider-less fallback); the cross-device half is
   * `ObjectView.userListState-12418.test.tsx`'s.
   */
  async function bothSurviveWithNoViewWrite(seed: Record<string, any>, viewId: string) {
    const { meta, rows } = makeStore([seed]);
    await openView(meta, viewId);
    await densityThenHide();

    expect(meta.saveItem).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // The stored row is the view, untouched.
    expect(rows.get(viewId)).toEqual(seed);

    expect(await reload(meta, viewId)).toEqual({ rowHeight: 'medium', hiddenFields: HIDDEN });
  }

  it('envelope row: both changes are the user\'s, and the row is not written', async () => {
    await bothSurviveWithNoViewWrite(ENVELOPE_ROW, ENVELOPE_ID);
  });

  it('flat row: both changes are the user\'s, and the row is not written', async () => {
    await bothSurviveWithNoViewWrite(FLAT_ROW, FLAT_ID);
  });

  it('overlay: both changes are the user\'s, the overlay is not written, and the source view still reaches the tab', async () => {
    await bothSurviveWithNoViewWrite(OVERLAY_ROW, OVERLAY_ID);
    // …and the source view's own filter still reaches the reloaded tab.
    expect(listSchema.filter).toEqual(DONE_SOURCE.filter);
  });
});

// The debounce-and-chain cases this file carried pinned `persistViewPatch`'s
// own write queue (a 300 ms debounce, then each PUT waiting for the previous
// one). Since objectui#12474 no list toolbar control reached that function, and
// objectui#12504 retired it, so there is no toolbar write left to queue; the
// user's state has its own debounce, pinned by
// `ObjectView.userListState-12418.test.tsx`.
