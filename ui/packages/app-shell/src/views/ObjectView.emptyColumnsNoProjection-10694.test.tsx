/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10694 — on the object route, a view that declares no `columns`
 * applies neither `hiddenFields` nor `fieldOrder`.
 *
 * ## The contract
 *
 * `ListViewSchema.columns` in `@objectstack/spec` source at objectstack
 * `origin/main` (objectstack#19598, not yet in the released 17.4.0): "An empty
 * list declares no projection, so neither of them applies: which columns show
 * is then left to the renderer". The composition docblock says the same: "An
 * EMPTY `columns` declares no projection, so steps 2 and 3 do not apply".
 * `InterfaceListPage` already reads a source view that way (objectui#10638).
 *
 * ## The defect this pins
 *
 * The views memo draws the object's default columns into a grid-like view that
 * declares none. The relay then applied that view's `hiddenFields` and
 * `fieldOrder` over those defaults, so the defaults came out subtracted and
 * re-sorted.
 *
 * ## The hide-column toggle on such a view (ruling 5839344270, B)
 *
 * With neither key applied, a `hiddenFields` the toggle persisted into a SYSTEM
 * view's overlay would be read by nothing on reload, and that overlay cannot
 * carry `columns` (`VIEW_OVERLAY_OWNED_KEYS`). So on a system view that
 * declares no projection the toggle is session-only: it hides the column in
 * `ListView`'s own state and writes nothing. A SAVED view's write is the whole
 * view, drawn `columns` included, so it keeps persisting and the reload
 * applies it.
 *
 * ## Since objectui#12474
 *
 * The toggle's choice is the USER's own list state, not a view write: on a view
 * that declares `columns` it is stored there and applied over the view's
 * `columns` on reload. A saved view's hide no longer persists through a
 * whole-view write that declared the drawn defaults as `columns`. This file
 * also measures the card's premise with the real `ListView`: the user's list
 * subtracts from `columns` and never adds a column.
 *
 * ## Since objectui#12505
 *
 * On a SAVED view that declares no `columns`, the user's choice is stored too
 * and subtracted from the defaults the views memo draws; the view's own
 * authored `hiddenFields` stays unapplied there, a stale name is inert, and a
 * field the caller may not read is neither offered nor stored. On a SYSTEM
 * view that declares none the toggle stays session-only (ruling B above).
 *
 * ## A config-panel draft is not a declaration
 *
 * `ViewConfigPanel` seeds its draft from the active view, whose `columns` on an
 * unprojected tab are the defaults the views memo drew, and it relays every
 * field on every edit and again on Discard. Those drawn defaults do not count
 * as a declared projection; only `columns` the admin changed do.
 *
 * ## What this file measures
 *
 * The column list the grid is handed, from a real `ObjectView` mount: the
 * real `plugin-view` host, the real `ListView`, and only `object-grid` stubbed
 * so it records its `columns`. The renderer's own columns are read off a view
 * that declares no projection and carries neither key, so the defaults are
 * never restated here. The toggle is driven through `ListView`'s own hide-fields
 * popover, and the writes are read off the data source's view writes
 * (`updateView` / `createView`; the toolbar's own view write,
 * `updateViewConfig`, retired in objectui#12504).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';

/** objectui#12474 — fields the caller may not read (field security, objectui#11984). */
const { unreadable } = vi.hoisted(() => ({ unreadable: new Set<string>() }));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
  const perms = {
    check: () => ({ allowed: true }),
    checkField: (_object: string, field: string) => !unreadable.has(field),
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    // Loaded only while a case withholds a field, so the gate is otherwise
    // deferred exactly as before.
    get isLoaded() { return unreadable.size > 0; },
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
  // The view config panel is admin-only.
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

// The real `ViewConfigPanel` runs (its draft seeding, its relay of every flat
// field, its Discard); only its heavy spec-driven inspector is swapped for two
// edits: one to an unrelated field, one to `columns`.
vi.mock('./metadata-admin/inspectors/ViewVariantInspector', () => ({
  ViewVariantInspector: ({ draft, onPatch }: any) => (
    <div>
      <button
        type="button"
        data-testid="inspector-edit-unrelated"
        onClick={() => onPatch({ config: { ...(draft?.config ?? {}), resizable: false } })}
      >
        unrelated
      </button>
      <button
        type="button"
        data-testid="inspector-edit-columns"
        onClick={() => onPatch({ config: { ...(draft?.config ?? {}), columns: ['name', 'stage', 'owner'] } })}
      >
        columns
      </button>
    </div>
  ),
}));
// The ADR-0034 draft/publish chrome does its own metadata reads.
vi.mock('./RuntimeDraftBar', () => ({ RuntimeDraftBar: () => null }));

// The host opens the panel from the plugin's `settings` view action. The plugin
// draws that action only inside its view switcher, so a button here calls the
// host's own `onViewAction` handler, and the real plugin view renders beside it.
vi.mock('@object-ui/plugin-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-view')>();
  const Real = actual.ObjectView as React.ComponentType<any>;
  return {
    ...actual,
    ObjectView: (props: any) => (
      <>
        <button type="button" data-testid="open-view-settings" onClick={() => props.onViewAction?.('settings', 'grid')}>
          settings
        </button>
        <Real {...props} />
      </>
    ),
  };
});

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { localListStateKey } from '../context/ListPreferencesProvider';

const OBJECT_NAME = 'duly_task';

/** The column identities the grid was last handed. */
let drawn: string[] | undefined;
/**
 * The `resizable` the grid was last handed: the panel's unrelated edit. (It was
 * `wrapHeaders` until objectui#11013 dropped that key's view rung: a stored view
 * no longer supplies it, so an edit of it no longer reaches the grid.)
 */
let drawnResizable: unknown;

// `ListView` draws its rows through `object-grid`. The stub records what it is
// handed and nothing else, so what the grid would derive on its own stays out
// of the measurement.
let prevObjectGrid: unknown;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', ((props: { schema?: { columns?: unknown; resizable?: unknown } }) => {
    const cols = props.schema?.columns;
    drawnResizable = props.schema?.resizable;
    drawn = Array.isArray(cols)
      ? cols.map((c: any) => (typeof c === 'string' ? c : (c?.field ?? c?.name)))
      : undefined;
    return <div data-testid="grid-stub" />;
  }) as never);
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid as never);
  else ComponentRegistry.unregister('object-grid');
});

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  stage: { type: 'text', label: 'Stage' },
  owner: { type: 'text', label: 'Owner' },
  amount: { type: 'number', label: 'Amount' },
  region: { type: 'text', label: 'Region' },
};

/** Both composition keys. Each would change the defaults if applied. */
const KEYS = { hiddenFields: ['stage'], fieldOrder: ['owner', 'name'] };

const PROBE_ID = `${OBJECT_NAME}.probe`;

/** A data source with one row, so `ListView` draws the grid rather than its empty state. */
function makeDataSource(extra: Record<string, unknown> = {}) {
  return {
    find: vi.fn(async () => ({ data: [{ id: 'r1', name: 'Row one' }], total: 1 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    ...extra,
  } as any;
}

/** Mount the object route on `viewId` and wait until the grid is drawn. */
async function mountRoute(listViews: Record<string, unknown>, viewId: string, dataSource: any): Promise<void> {
  const objects = [{ name: OBJECT_NAME, label: 'Task', fields: FIELDS, listViews }];
  drawn = undefined;
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${viewId}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await screen.findByTestId('grid-stub', undefined, { timeout: 8000 });
}

/** Draw one system list view on the object route; return the columns the grid got. */
async function drawView(view: Record<string, unknown>): Promise<string[] | undefined> {
  await mountRoute({ [PROBE_ID]: { name: PROBE_ID, label: 'Probe', type: 'grid', ...view } }, PROBE_ID, makeDataSource());
  const got = drawn;
  cleanup();
  return got;
}

/**
 * Untick `field` in `ListView`'s hide-fields list, as a user does: since
 * objectui#12423 a section of the toolbar's Display panel, collapsed while
 * nothing is hidden.
 */
async function hideThroughToggle(field: string): Promise<void> {
  if (!screen.queryByTestId('view-settings-content')) {
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  }
  const panel = await screen.findByTestId('view-settings-content');
  const name = new RegExp(`^${field}$`, 'i');
  if (!within(panel).queryByText(name)) {
    fireEvent.click(within(panel).getByRole('button', { name: 'Hide Fields' }));
  }
  const label = await within(panel).findByText(name);
  fireEvent.click(label.closest('label')!.querySelector('input')!);
}

/** The data source's view writes, each a spy: what a write to the shared view would call. */
const viewWriteSpies = () => ({ updateView: vi.fn(async () => ({})), createView: vi.fn(async () => ({})) });

/** Every view write the page made through the data source. */
const viewWrites = (dataSource: any): unknown[][] => [
  ...dataSource.updateView.mock.calls,
  ...dataSource.createView.mock.calls,
];

/**
 * objectui#12474 — the hidden fields this user stored for `viewId`, read off
 * their list state. This harness mounts no preference provider, so the state
 * is this browser's cache (the provider-less fallback).
 */
function storedHiddenFields(viewId: string): unknown {
  const raw = localStorage.getItem(localListStateKey('u1', OBJECT_NAME));
  return raw ? JSON.parse(raw)?.perView?.[viewId]?.hiddenFields : undefined;
}

/** Longer than the old view write's 300ms debounce, with room to spare. */
const PAST_DEBOUNCE_MS = 900;

/** Open the view config panel on the active view, as the host's `settings` action does. */
async function openPanel(): Promise<void> {
  fireEvent.click(screen.getByTestId('open-view-settings'));
  await screen.findByTestId('inspector-edit-unrelated');
}

/** Edit a field that is not `columns`, and wait until the edit reaches the grid. */
async function editUnrelatedField(): Promise<void> {
  fireEvent.click(screen.getByTestId('inspector-edit-unrelated'));
  await waitFor(() => expect(drawnResizable).toBe(false));
}

/** Discard the panel, and wait until the revert reaches the grid. */
async function discardPanel(): Promise<void> {
  fireEvent.click(screen.getByTestId('view-config-discard'));
  await waitFor(() => expect(drawnResizable).toBeUndefined());
}

/** The unprojected view the panel cases edit: both keys, and the hide toggle on. */
const UNPROJECTED_WITH_TOGGLE = {
  [PROBE_ID]: {
    name: PROBE_ID, label: 'Probe', type: 'grid',
    columns: [], ...KEYS, userActions: { hideFields: true },
  },
};

/** objectui#12505 — a SAVED view (a row `listViews` serves) that declares no `columns`. */
const SAVED_ID = `${OBJECT_NAME}.mine`;
/** A system view beside the saved one, so the saved one is not the only tab. */
const SAVED_BESIDE = {
  [`${OBJECT_NAME}.other`]: { name: `${OBJECT_NAME}.other`, label: 'Other', type: 'grid', columns: ['name'] },
};
/** A data source serving the saved row (plus `extra` on it), with a view-write spy. */
function savedViewSource(extra: Record<string, unknown> = {}) {
  const savedRow = { name: SAVED_ID, label: 'Mine', type: 'grid', userActions: { hideFields: true }, ...extra };
  return makeDataSource({
    ...viewWriteSpies(),
    listViews: vi.fn(async () => [savedRow]),
  });
}

/** The toggle on an unprojected system view hides in-session and writes nothing. */
async function expectSessionOnlyToggle(dataSource: any): Promise<void> {
  await hideThroughToggle('region');
  await waitFor(() => expect(drawn).not.toContain('region'));
  await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
  expect(viewWrites(dataSource)).toEqual([]);
  expect(storedHiddenFields(PROBE_ID)).toBeUndefined();
}

beforeEach(() => {
  localStorage.clear();
  unreadable.clear();
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
  cleanup();
  vi.unstubAllGlobals();
});

describe('an unprojected view applies neither hiddenFields nor fieldOrder on the object route (objectui#10694)', () => {
  it('THE FIX: `columns: []` with both keys draws the renderer\'s own columns', async () => {
    const own = await drawView({ columns: [] });
    // The fixture discriminates: applying `hiddenFields` would drop `stage`,
    // and applying `fieldOrder` would put `owner` ahead of `name`.
    expect(own).toContain('stage');
    expect(own!.indexOf('name')).toBeLessThan(own!.indexOf('owner'));

    expect(await drawView({ columns: [], ...KEYS })).toEqual(own);
  });

  it('THE FIX: an ABSENT `columns` reads as an empty one', async () => {
    // The spec requires the key, so a view without it declares no projection
    // either. The shape still reaches this route from a stored view body.
    const own = await drawView({ columns: [] });
    expect(await drawView({ ...KEYS })).toEqual(own);
  });

  it('CONTROL: a declared projection is subtracted and sorted, as before', async () => {
    // `columns` projects, `hiddenFields` removes `stage`, `fieldOrder` sorts
    // `owner` and `name` first and leaves the unlisted `amount` last.
    expect(await drawView({ columns: ['name', 'stage', 'owner', 'amount'], ...KEYS }))
      .toEqual(['owner', 'name', 'amount']);
  });

  it('THE FIX: on a system view with no declared `columns`, the hide toggle is session-only', async () => {
    const dataSource = makeDataSource(viewWriteSpies());
    await mountRoute(
      { [PROBE_ID]: { name: PROBE_ID, label: 'Probe', type: 'grid', columns: [], userActions: { hideFields: true } } },
      PROBE_ID,
      dataSource,
    );
    expect(drawn).toContain('region');

    await hideThroughToggle('region');
    // The column goes, in this session.
    await waitFor(() => expect(drawn).not.toContain('region'));
    // And nothing is written or stored: a `hiddenFields` on this view would
    // be read by nothing on reload (the CONTROL below shows the store is live).
    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    expect(viewWrites(dataSource)).toEqual([]);
    expect(storedHiddenFields(PROBE_ID)).toBeUndefined();
  });

  it('CONTROL: on a system view that declares `columns`, the toggle is stored as the user\'s own, and the view is not written (objectui#12474)', async () => {
    const dataSource = makeDataSource(viewWriteSpies());
    const listViews = {
      [PROBE_ID]: {
        name: PROBE_ID, label: 'Probe', type: 'grid',
        columns: ['name', 'stage', 'region'], userActions: { hideFields: true },
      },
    };
    await mountRoute(listViews, PROBE_ID, dataSource);
    await hideThroughToggle('region');
    await waitFor(() => expect(storedHiddenFields(PROBE_ID)).toEqual(['region']), { timeout: 3000 });
    await waitFor(() => expect(drawn).toEqual(['name', 'stage']));
    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    expect(viewWrites(dataSource)).toEqual([]);
    cleanup();

    // Reload: the user's choice is applied over the view's own `columns`.
    await mountRoute(listViews, PROBE_ID, makeDataSource());
    await waitFor(() => expect(drawn).toEqual(['name', 'stage']));
  });

  it('THE FIX (objectui#12505): on a saved view with no `columns`, the hide is this user\'s own and survives a reload; the row is not written', async () => {
    // objectui#12474 made the hide session-only here (it used to persist only
    // through a whole-view write that declared the drawn defaults as `columns`
    // for every user). It is now stored on the user's own list state and
    // subtracted from the drawn defaults, with no view write.
    const first = savedViewSource();
    await mountRoute(SAVED_BESIDE, SAVED_ID, first);
    await waitFor(() => expect(drawn).toContain('region'), { timeout: 5000 });
    const defaults = drawn!;
    await hideThroughToggle('region');
    await waitFor(() => expect(storedHiddenFields(SAVED_ID)).toEqual(['region']), { timeout: 3000 });
    await waitFor(() => expect(drawn).toEqual(defaults.filter((f) => f !== 'region')));
    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
    // No `/meta/view` write: no view write of the data source is called.
    expect(viewWrites(first)).toEqual([]);
    cleanup();

    // Reload: the stored list is applied over the drawn defaults.
    await mountRoute(SAVED_BESIDE, SAVED_ID, savedViewSource());
    await waitFor(() => expect(drawn).toEqual(defaults.filter((f) => f !== 'region')), { timeout: 5000 });
  });

  it('THE FIX (objectui#12505): the saved view\'s own authored `hiddenFields` stays unapplied; only the user\'s list subtracts', async () => {
    const own = savedViewSource({ hiddenFields: ['stage'] });
    await mountRoute(SAVED_BESIDE, SAVED_ID, own);
    await waitFor(() => expect(drawn).toContain('region'), { timeout: 5000 });
    // The view's key declares nothing on an unprojected view (objectui#10694).
    expect(drawn).toContain('stage');
    const defaults = drawn!;
    cleanup();

    localStorage.setItem(
      localListStateKey('u1', OBJECT_NAME),
      JSON.stringify({ perView: { [SAVED_ID]: { hiddenFields: ['amount'] } } }),
    );
    await mountRoute(SAVED_BESIDE, SAVED_ID, savedViewSource({ hiddenFields: ['stage'] }));
    await waitFor(() => expect(drawn).toEqual(defaults.filter((f) => f !== 'amount')), { timeout: 5000 });
  });

  it('THE FIX (objectui#12505): a stored name the drawn defaults lack is inert and adds no column', async () => {
    await mountRoute(SAVED_BESIDE, SAVED_ID, savedViewSource());
    await waitFor(() => expect(drawn).toContain('region'), { timeout: 5000 });
    const defaults = drawn!;
    // `id` is a field the defaults leave out; `ghost` is no field at all.
    expect(defaults).not.toContain('id');
    cleanup();

    localStorage.setItem(
      localListStateKey('u1', OBJECT_NAME),
      JSON.stringify({ perView: { [SAVED_ID]: { hiddenFields: ['ghost', 'id', 'region'] } } }),
    );
    await mountRoute(SAVED_BESIDE, SAVED_ID, savedViewSource());
    await waitFor(() => expect(drawn).toEqual(defaults.filter((f) => f !== 'region')), { timeout: 5000 });
  });

  it('FIELD SECURITY (objectui#11984, objectui#12505): on a saved view with no `columns`, a drawn field the caller may not read is not offered and not stored', async () => {
    unreadable.add('owner');
    await mountRoute(SAVED_BESIDE, SAVED_ID, savedViewSource());
    await waitFor(() => expect(drawn).toContain('region'), { timeout: 5000 });
    expect(drawn).not.toContain('owner');
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    const panel = await screen.findByTestId('view-settings-content');
    fireEvent.click(within(panel).getByRole('button', { name: 'Hide Fields' }));
    await within(panel).findByText(/^region$/i);
    expect(within(panel).queryByText(/^owner$/i)).toBeNull();

    await hideThroughToggle('region');
    await waitFor(() => expect(storedHiddenFields(SAVED_ID)).toEqual(['region']), { timeout: 3000 });
  });

  it('CONTROL (objectui#12505): a stored list on a SYSTEM view with no `columns` is still not applied (ruling 5839344270, B)', async () => {
    const defaults = await drawView({ columns: [] });
    localStorage.setItem(
      localListStateKey('u1', OBJECT_NAME),
      JSON.stringify({ perView: { [PROBE_ID]: { hiddenFields: ['region'] } } }),
    );
    expect(await drawView({ columns: [] })).toEqual(defaults);
  });

  it('PREMISE (objectui#12474): a user\'s hidden fields subtract from the view\'s `columns` and never add a column', async () => {
    // The view hides `stage`; this user has stored "show every column" ([])
    // and, from some other source, a name the view does not declare.
    const listViews = {
      [PROBE_ID]: {
        name: PROBE_ID, label: 'Probe', type: 'grid',
        columns: ['name', 'stage', 'owner'], hiddenFields: ['stage'], userActions: { hideFields: true },
      },
    };
    const own = makeDataSource();
    await mountRoute(listViews, PROBE_ID, own);
    await waitFor(() => expect(drawn).toEqual(['name', 'owner']));
    cleanup();

    localStorage.setItem(
      localListStateKey('u1', OBJECT_NAME),
      JSON.stringify({ perView: { [PROBE_ID]: { hiddenFields: ['region'] } } }),
    );
    await mountRoute(listViews, PROBE_ID, makeDataSource());
    // `stage` is back (it is in `columns`); `region` is in no `columns`, so
    // naming it hides nothing and adds nothing.
    await waitFor(() => expect(drawn).toEqual(['name', 'stage', 'owner']));
    cleanup();

    // On a view that declares no projection the stored list is not applied.
    const unprojected = { [PROBE_ID]: { name: PROBE_ID, label: 'Probe', type: 'grid', columns: [] } };
    const defaults = await drawView({ columns: [] });
    localStorage.setItem(
      localListStateKey('u1', OBJECT_NAME),
      JSON.stringify({ perView: { [PROBE_ID]: { hiddenFields: ['stage'] } } }),
    );
    await mountRoute(unprojected, PROBE_ID, makeDataSource());
    await waitFor(() => expect(drawn).toEqual(defaults));
  });

  it('FIELD SECURITY (objectui#11984, objectui#12474): a field the caller may not read is not offered, and the stored list keeps a withheld entry', async () => {
    unreadable.add('owner');
    const listViews = {
      [PROBE_ID]: {
        name: PROBE_ID, label: 'Probe', type: 'grid',
        columns: ['name', 'stage', 'owner', 'region'], hiddenFields: ['owner'], userActions: { hideFields: true },
      },
    };
    await mountRoute(listViews, PROBE_ID, makeDataSource());
    fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
    const panel = await screen.findByTestId('view-settings-content');
    fireEvent.click(within(panel).getByRole('button', { name: 'Hide Fields' }));
    await within(panel).findByText(/^region$/i);
    expect(within(panel).queryByText(/^owner$/i)).toBeNull();

    await hideThroughToggle('region');
    await waitFor(() => expect(storedHiddenFields(PROBE_ID)).toEqual(expect.arrayContaining(['region', 'owner'])), { timeout: 3000 });
    expect(drawn).not.toContain('owner');
  });

  it('THE FIX: after a panel edit of an unrelated field, the view stays unprojected', async () => {
    const own = await drawView({ columns: [] });
    await mountRoute(UNPROJECTED_WITH_TOGGLE, PROBE_ID, makeDataSource());
    expect(drawn).toEqual(own);

    await openPanel();
    await editUnrelatedField();
    // The panel's draft now carries the drawn defaults as `columns`.
    expect(drawn).toEqual(own);
  });

  it('THE FIX: after a panel edit of an unrelated field, the system view\'s hide toggle stays session-only', async () => {
    const dataSource = makeDataSource(viewWriteSpies());
    await mountRoute(UNPROJECTED_WITH_TOGGLE, PROBE_ID, dataSource);
    await openPanel();
    await editUnrelatedField();
    await expectSessionOnlyToggle(dataSource);
  });

  it('THE FIX: after a panel edit and Discard, the view stays unprojected', async () => {
    const own = await drawView({ columns: [] });
    await mountRoute(UNPROJECTED_WITH_TOGGLE, PROBE_ID, makeDataSource());
    await openPanel();
    await editUnrelatedField();
    await discardPanel();
    // Discard replays the opening fields, drawn `columns` included.
    expect(drawn).toEqual(own);
  });

  it('THE FIX: after a panel edit and Discard, the system view\'s hide toggle stays session-only', async () => {
    const dataSource = makeDataSource(viewWriteSpies());
    await mountRoute(UNPROJECTED_WITH_TOGGLE, PROBE_ID, dataSource);
    await openPanel();
    await editUnrelatedField();
    await discardPanel();
    await expectSessionOnlyToggle(dataSource);
  });

  it('CONTROL: `columns` the admin changed in the panel answer for themselves, and the keys apply', async () => {
    await mountRoute(UNPROJECTED_WITH_TOGGLE, PROBE_ID, makeDataSource());
    await openPanel();
    fireEvent.click(screen.getByTestId('inspector-edit-columns'));
    // [name, stage, owner] projected; `stage` hidden; `owner` sorted first.
    await waitFor(() => expect(drawn).toEqual(['owner', 'name']));
  });
});
