/**
 * objectui#12418 — on the object page, a list's sort, column layout, Filter
 * panel conditions and tab order are the signed-in user's own state, and the
 * shared view is written only by the view editor.
 *
 * ## The defect this pins
 *
 * A header sort went through `persistViewPatch` (the toolbar's view write,
 * retired in objectui#12504) into the view (`/meta/view`), a column drag the
 * same way, and a Manage Views drag PATCHed a `sortOrder`
 * onto every saved view's row: one user's click changed the list for every
 * user. The Filter panel and the tab order lived in this browser only, so they
 * were gone on another device.
 *
 * ## What runs
 *
 * The real object page, the real `ListPreferencesProvider` (its 500 ms write
 * debounce included) and a list-state family that records its `load` and
 * `save` the way `@object-ui/data-objectstack`'s does (`sys_user_preference`,
 * one `ui.list.<object>` row per object). The view writes are the adapter's
 * `updateView` spy and, for the view editor's save, a
 * real `MetadataClient` whose `PUT /meta/view/…` is counted. `ListView` is
 * captured (a toolbar change is the page's own callback) and Manage Views is
 * reduced to its reorder and its config entry.
 *
 * ## The pins
 *
 *   1. A header sort and a column resize write no view and land as ONE save
 *      of the object's row.
 *   2. A Manage Views drag writes no view and lands as ONE save.
 *   3. The view editor's save still writes `/meta/view`.
 *   4. Cross-device: a fresh browser opens on the user's stored order, sort
 *      and filters once the family has loaded; another user sees the view's
 *      authored defaults. The list waits for that load.
 *   5. "Reset view", an entry of the header's ⋯ menu shown only while the
 *      user has stored state for the view, drops that state and the list
 *      opens on the view's own sort again.
 *   6. objectui#12474 — the density toggle and a Hide Fields change are the
 *      user's too: each writes no view and lands as ONE save; a fresh browser
 *      opens on them, another user sees the view's own, and "Reset view"
 *      drops them.
 *   6b. objectui#12505 — on a SAVED view that declares no `columns`, a Hide
 *      Fields change is stored the same way and applied over the drawn
 *      defaults; another user sees the defaults; "Reset view" drops it.
 *   6c. objectui#12949 — the list is handed the view's own density and
 *      hidden fields in `viewDefaults`, beside the user's in `schema`, so
 *      its Display reset compares against the view; on an unprojected saved
 *      view the view hides nothing.
 *   7. CONTROL — no provider (a host without the console shell): the state is
 *      this browser's, as the tab order and filters were before; a sort still
 *      writes no view; the older `viewOrder:<object>` key is still honoured.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';
import { toast } from 'sonner';

const { session } = vi.hoisted(() => ({ session: { userId: 'u1' } }));

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
  useAuth: () => ({ user: { id: session.userId, name: 'Ada' }, activeOrganization: null }),
  // Manage Views and the config panel are admin-only.
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

/**
 * The props the object page hands its list: captured, not rendered. The
 * stand-in draws only the page's `toolbarLeading` node — the view tab strip
 * rides the list's toolbar row since objectui#12440.
 */
let listProps: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    listProps = props;
    return props.toolbarLeading ?? null;
  },
}));

// The panel's spec inspector, reduced to one edit: a new label.
vi.mock('./metadata-admin/inspectors/ViewVariantInspector', () => ({
  ViewVariantInspector: ({ onPatch }: any) => (
    <button type="button" data-testid="stub-inspector-edit" onClick={() => onPatch({ label: 'Pipeline EDITED' })}>
      edit
    </button>
  ),
}));

const OBJECT_NAME = 'crm_deal';
const SYSTEM_ID = `${OBJECT_NAME}.all`;
const SAVED_ID = `${OBJECT_NAME}.pipeline`;
const LIST_KEY = `ui.list.${OBJECT_NAME}`;

/** The tab order Manage Views is handed, as its stub last saw it. */
let manageViewsOrder: string[] = [];
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-view')>()),
  ManageViewsDialog: (props: any) => {
    manageViewsOrder = (props.views ?? []).map((v: any) => v.id);
    return (
      <div>
        <button type="button" data-testid="stub-config" onClick={() => props.onConfigView?.(SAVED_ID)}>config</button>
        <button type="button" data-testid="stub-reorder" onClick={() => props.onReorder?.([SAVED_ID, SYSTEM_ID])}>reorder</button>
      </div>
    );
  },
}));

/** Every `PUT /meta/view/…` the view editor's real client sent. */
const puts: string[] = [];
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function wire() {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://localhost').pathname;
    if (init?.method === 'PUT' && path.includes('/meta/view/')) {
      puts.push(path);
      return json({ success: true }, 200);
    }
    if (path.includes('/meta/view/')) return json({ success: false }, 404);
    if (path.endsWith('/meta/dataset')) return json([], 200);
    return json({ data: [] }, 200);
  });
}
let client: MetadataClient;
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { ObjectView, type ConsoleObjectViewProps } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { UserStateAdaptersProvider, useAttachListStateFamily } from '../context/UserStateAdapters';
import { ListPreferencesProvider, localListStateKey } from '../context/ListPreferencesProvider';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  amount: { type: 'number', label: 'Amount' },
};
const AUTHORED_SORT = [{ field: 'name', order: 'asc' }];
/** objectui#12474 — the view's own density and hidden fields: every user's default. */
const AUTHORED_ROW_HEIGHT = 'tall';
const AUTHORED_HIDDEN = ['amount'];
/** The saved view: an overlay row the adapter's `listViews` serves. */
const SAVED_ROW = { name: SAVED_ID, object: OBJECT_NAME, label: 'Pipeline', type: 'grid', columns: ['name'] };
const OBJECT = {
  name: OBJECT_NAME,
  label: 'Deal',
  fields: FIELDS,
  listViews: {
    [SYSTEM_ID]: {
      name: SYSTEM_ID, label: 'All', type: 'grid', columns: ['name', 'amount'], sort: AUTHORED_SORT,
      rowHeight: AUTHORED_ROW_HEIGHT, hiddenFields: AUTHORED_HIDDEN,
    },
  },
};

function makeDataSource(savedRow: Record<string, unknown> = SAVED_ROW) {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: {} })),
    listViews: vi.fn(async () => [savedRow]),
    updateView: vi.fn(async () => ({})),
    deleteView: vi.fn(async () => ({})),
  } as unknown as ConsoleObjectViewProps['dataSource'];
}

/** A list-state family recording its traffic; `rows` is the user's stored rows. */
function makeFamily(rows: Record<string, unknown>, opts: { held?: boolean } = {}) {
  let release: () => void = () => {};
  const gate = opts.held ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  const family = {
    prefix: 'ui.list.',
    load: vi.fn(async () => {
      await gate;
      return structuredClone(rows) as Record<string, any>;
    }),
    save: vi.fn(async (key: string, value: unknown) => {
      rows[key] = structuredClone(value);
    }),
  };
  return { family, release: () => release() };
}

function AttachFamily({ family }: { family: any }) {
  const attach = useAttachListStateFamily();
  React.useEffect(() => {
    attach(family);
    return () => attach(null);
  }, [attach, family]);
  return null;
}

function page(dataSource: ConsoleObjectViewProps['dataSource'], viewId: string, opts: { app?: boolean } = {}) {
  // `app: false` mounts the page with no app segment, the one case in which
  // the page has no favorites entry (`useObjectListFavorite` answers null).
  const withApp = opts.app !== false;
  return (
    <ExpressionProvider user={{ id: session.userId, name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[withApp ? `/apps/demo/${OBJECT_NAME}/view/${viewId}` : `/${OBJECT_NAME}/view/${viewId}`]}>
        <Routes>
          <Route
            path={withApp ? '/apps/:appName/:objectName/view/:viewId' : '/:objectName/view/:viewId'}
            element={<ObjectView dataSource={dataSource} objects={[OBJECT as any]} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>
  );
}

/** Mount the page in the console's preference providers, with `family` attached. */
function mountWithFamily(dataSource: ConsoleObjectViewProps['dataSource'], family: any, viewId = SYSTEM_ID, opts: { app?: boolean } = {}) {
  return render(
    <UserStateAdaptersProvider>
      <AttachFamily family={family} />
      <ListPreferencesProvider>{page(dataSource, viewId, opts)}</ListPreferencesProvider>
    </UserStateAdaptersProvider>,
  );
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/** The list is mounted and the page's own reads (saved views) have landed. */
async function listReady() {
  await waitFor(() => expect(typeof listProps?.onSortChange).toBe('function'));
  await screen.findByText('Pipeline');
  await wait(50);
}

/** Open the header's ⋯ menu (keyboard, as Radix opens it under test) and find one entry. */
async function openOverflowItem(testId: string): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
  return screen.findByTestId(testId);
}

/** The ⋯ menu's entries by test id; `[]` when the page draws no ⋯ at all. */
async function overflowTestIds(): Promise<string[]> {
  const trigger = screen.queryByRole('button', { name: 'More actions' });
  if (!trigger) return [];
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const items = await screen.findAllByRole('menuitem');
  const ids = items.map((el) => el.getAttribute('data-testid') ?? '');
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  return ids;
}

/** Every view write the page can make, counted. */
function viewWrites(ds: any) {
  return ds.updateView.mock.calls.length + puts.length;
}

beforeEach(() => {
  cleanup();
  session.userId = 'u1';
  puts.length = 0;
  listProps = null;
  manageViewsOrder = [];
  localStorage.clear();
  client = new MetadataClient({ baseUrl: 'http://localhost', fetch: wire() as unknown as typeof fetch });
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] }, 200)));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('a toolbar change is the user\'s, not the view\'s (objectui#12418)', () => {
  it('a header sort and a column resize write no view and land as one save of the object\'s row', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();

    act(() => {
      listProps.onSortChange([{ id: 'row-1', field: 'amount', order: 'desc' }]);
      listProps.onColumnStateChange({ widths: { name: 320 } });
    });
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, {
      perView: { [SYSTEM_ID]: { sort: [{ field: 'amount', order: 'desc' }], columnState: { widths: { name: 320 } } } },
    });
    // The page hands the grid the user's layout back.
    expect(listProps.schema.columnState).toEqual({ widths: { name: 320 } });
  });

  it('the schema-level sort relay is the same user write', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();

    act(() => listProps.schema.onSortChange([{ field: 'amount', order: 'asc' }]));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save.mock.calls[0][1]).toEqual({ perView: { [SYSTEM_ID]: { sort: [{ field: 'amount', order: 'asc' }] } } });
  });

  it('a Manage Views drag writes no view and lands as one save', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();
    expect(manageViewsOrder).toEqual([SYSTEM_ID, SAVED_ID]);

    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-reorder'));
    });
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, { viewOrder: [SAVED_ID, SYSTEM_ID] });
    // The tabs follow the user's order at once.
    expect(manageViewsOrder).toEqual([SAVED_ID, SYSTEM_ID]);
  });

  it('the view editor\'s save still writes /meta/view', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();

    fireEvent.click(screen.getByTestId('stub-config'));
    await screen.findByTestId('stub-inspector-edit');
    fireEvent.click(screen.getByTestId('stub-inspector-edit'));
    const save = screen.getByTestId('view-config-save') as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(save);
    });

    await waitFor(() => expect(puts).toEqual([`/api/v1/meta/view/${SAVED_ID}`]));
    expect(family.save).not.toHaveBeenCalled();
  });
});

describe('the user\'s state follows them, and only them (objectui#12418)', () => {
  const STORED = {
    [LIST_KEY]: {
      viewOrder: [SAVED_ID, SYSTEM_ID],
      perView: {
        [SYSTEM_ID]: {
          sort: [{ field: 'amount', order: 'desc' }],
          filters: { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'Acme' }] },
          columnState: { widths: { name: 280 } },
        },
      },
    },
  };

  it('a fresh browser opens on the stored order, sort, filters and column layout once the family has loaded', async () => {
    const ds = makeDataSource();
    const { family, release } = makeFamily(structuredClone(STORED), { held: true });
    mountWithFamily(ds, family);

    // The list waits for the user's state: nothing to open on yet.
    await screen.findByTestId('object-view-list-preferences-pending');
    expect(listProps).toBeNull();

    await act(async () => release());
    await listReady();

    expect(family.load).toHaveBeenCalledTimes(1);
    expect(manageViewsOrder).toEqual([SAVED_ID, SYSTEM_ID]);
    expect(listProps.schema.sort).toEqual([{ field: 'amount', order: 'desc' }]);
    expect(listProps.initialFilters).toEqual(STORED[LIST_KEY].perView[SYSTEM_ID].filters);
    expect(listProps.schema.columnState).toEqual({ widths: { name: 280 } });
    // Written through to this browser's cache.
    expect(JSON.parse(localStorage.getItem(localListStateKey('u1', OBJECT_NAME)) ?? '{}')).toEqual(STORED[LIST_KEY]);
  });

  it('another user, with no state of their own, sees the view\'s authored defaults', async () => {
    session.userId = 'u2';
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();

    expect(manageViewsOrder).toEqual([SYSTEM_ID, SAVED_ID]);
    expect(listProps.schema.sort).toEqual(AUTHORED_SORT);
    expect(listProps.initialFilters).toBeUndefined();
    // No layout of anyone's: the grid is handed none, so its own cache cannot stand in.
    expect(listProps.schema.columnState).toEqual({});
    // Nothing of theirs to reset: the ⋯ menu carries no "Reset view".
    expect(await overflowTestIds()).not.toContain('object-view-reset-view-button');
  });

  it('"Reset view" drops the user\'s state for the view and the list opens on the view\'s own sort again', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();
    expect(listProps.schema.sort).toEqual([{ field: 'amount', order: 'desc' }]);
    const before = listProps;

    // An entry of the header's ⋯ menu, not a header button: nothing of it is
    // drawn until the menu opens, so the one-row header keeps its shape.
    expect(screen.queryByTestId('object-view-reset-view-button')).toBeNull();
    const item = await openOverflowItem('object-view-reset-view-button');
    expect(item.getAttribute('role')).toBe('menuitem');
    // This harness mounts no I18nProvider, so `t` answers with the key: the pin
    // is WHICH key labels the entry and which titles it, not the English copy.
    expect(item.textContent?.trim()).toBe('console.objectView.resetView');
    expect(item.getAttribute('title')).toBe('console.objectView.resetViewTitle');
    await act(async () => {
      fireEvent.click(item);
    });
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    // The view's entry is gone; the tab order is not the view's to reset.
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, { viewOrder: [SAVED_ID, SYSTEM_ID] });
    expect(listProps).not.toBe(before);
    expect(listProps.schema.sort).toEqual(AUTHORED_SORT);
    expect(listProps.initialFilters).toBeUndefined();
    expect(listProps.schema.columnState).toEqual({});
    // Nothing stored for the view any more: nothing to reset, so no entry.
    expect(await overflowTestIds()).not.toContain('object-view-reset-view-button');
  });

  it('with no favorites entry (no app segment), the ⋯ is drawn for "Reset view" alone, and only while there is state to reset', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family, SYSTEM_ID, { app: false });
    await listReady();

    expect(await overflowTestIds()).toEqual(['object-view-reset-view-button']);
    await act(async () => {
      fireEvent.click(await openOverflowItem('object-view-reset-view-button'));
    });
    await wait(700);
    // Nothing left to reset and no favorites entry: no ⋯ at all.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('"Clear all" in the Filter panel clears the user\'s filters for the view', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();

    act(() => listProps.onFilterChange({ id: 'root', logic: 'and', conditions: [] }));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).toHaveBeenCalledTimes(1);
    const saved = family.save.mock.calls[0][1] as any;
    expect(saved.perView[SYSTEM_ID]).not.toHaveProperty('filters');
    expect(saved.perView[SYSTEM_ID].sort).toEqual([{ field: 'amount', order: 'desc' }]);
  });
});

describe('the density and the hidden fields are the user\'s too (objectui#12474)', () => {
  it('a density toggle writes no view and lands as one save of the object\'s row', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();
    expect(listProps.schema.rowHeight).toBe(AUTHORED_ROW_HEIGHT);

    act(() => listProps.schema.onDensityChange('compact'));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, { perView: { [SYSTEM_ID]: { rowHeight: 'compact' } } });
    expect(listProps.schema.rowHeight).toBe('compact');
  });

  it('a Hide Fields change writes no view and lands as one save of the object\'s row', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);

    // The whole list the popover emits: the user showed `amount` and hid `name`.
    act(() => listProps.onHiddenFieldsChange(['name']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, { perView: { [SYSTEM_ID]: { hiddenFields: ['name'] } } });
    expect(listProps.schema.hiddenFields).toEqual(['name']);
  });

  const STORED = {
    [LIST_KEY]: { perView: { [SYSTEM_ID]: { rowHeight: 'compact', hiddenFields: [] } } },
  };

  it('a fresh browser opens on the stored density and hidden fields once the family has loaded', async () => {
    const ds = makeDataSource();
    const { family, release } = makeFamily(structuredClone(STORED), { held: true });
    mountWithFamily(ds, family);
    await screen.findByTestId('object-view-list-preferences-pending');
    await act(async () => release());
    await listReady();

    expect(listProps.schema.rowHeight).toBe('compact');
    // An empty list is the user's choice ("show every column"), not the view's.
    expect(listProps.schema.hiddenFields).toEqual([]);
  });

  it('another user, with no state of their own, sees the view\'s authored density and hidden fields', async () => {
    session.userId = 'u2';
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();

    expect(listProps.schema.rowHeight).toBe(AUTHORED_ROW_HEIGHT);
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
  });

  it('"Reset view" drops the stored density and hidden fields, and the list opens on the view\'s own', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();
    expect(listProps.schema.rowHeight).toBe('compact');

    await act(async () => {
      fireEvent.click(await openOverflowItem('object-view-reset-view-button'));
    });
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, {});
    expect(listProps.schema.rowHeight).toBe(AUTHORED_ROW_HEIGHT);
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
  });
});

describe('on a saved view that declares no `columns`, the hidden fields are the user\'s own too (objectui#12505)', () => {
  /**
   * The saved row with no `columns`: the page draws the object's defaults into
   * it, and declares no projection. Its own authored `hiddenFields` is never
   * applied there (objectui#10694); the user's list is.
   */
  const UNPROJECTED_SAVED_ROW = { name: SAVED_ID, object: OBJECT_NAME, label: 'Pipeline', type: 'grid', hiddenFields: ['name'] };
  const STORED = { [LIST_KEY]: { perView: { [SAVED_ID]: { hiddenFields: ['amount'] } } } };

  it('a Hide Fields change writes no view and lands as one save of the object\'s row', async () => {
    const ds = makeDataSource(UNPROJECTED_SAVED_ROW);
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();
    // The drawn defaults, with neither the view's key nor anyone's list applied.
    expect(listProps.schema.columns).toEqual(expect.arrayContaining(['name', 'amount']));
    expect(listProps.schema.hiddenFields).toBeUndefined();

    act(() => listProps.onHiddenFieldsChange(['amount']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, { perView: { [SAVED_ID]: { hiddenFields: ['amount'] } } });
    expect(listProps.schema.hiddenFields).toEqual(['amount']);
  });

  it('a fresh browser opens on the stored list once the family has loaded', async () => {
    const ds = makeDataSource(UNPROJECTED_SAVED_ROW);
    const { family, release } = makeFamily(structuredClone(STORED), { held: true });
    mountWithFamily(ds, family, SAVED_ID);
    await screen.findByTestId('object-view-list-preferences-pending');
    await act(async () => release());
    await listReady();

    expect(listProps.schema.hiddenFields).toEqual(['amount']);
  });

  it('another user, with no state of their own, sees the default columns', async () => {
    session.userId = 'u2';
    const ds = makeDataSource(UNPROJECTED_SAVED_ROW);
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();

    expect(listProps.schema.columns).toEqual(expect.arrayContaining(['name', 'amount']));
    // Not the view's authored `['name']`: it declares nothing on an unprojected view.
    expect(listProps.schema.hiddenFields).toBeUndefined();
  });

  it('"Reset view" drops the stored list, and the list opens on the default columns', async () => {
    const ds = makeDataSource(UNPROJECTED_SAVED_ROW);
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();
    expect(listProps.schema.hiddenFields).toEqual(['amount']);

    await act(async () => {
      fireEvent.click(await openOverflowItem('object-view-reset-view-button'));
    });
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, {});
    expect(listProps.schema.hiddenFields).toBeUndefined();
  });

  it('CONTROL: on the saved view that declares `columns`, the hide is stored and applied as before', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();
    expect(listProps.schema.columns).toEqual(['name']);

    act(() => listProps.onHiddenFieldsChange(['name']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, { perView: { [SAVED_ID]: { hiddenFields: ['name'] } } });
    expect(listProps.schema.hiddenFields).toEqual(['name']);
  });
});

describe('the list is handed the view\'s own density and hidden fields beside the user\'s (objectui#12949)', () => {
  /** A stored choice that differs from the view's on both settings. */
  const STORED = {
    [LIST_KEY]: { perView: { [SYSTEM_ID]: { rowHeight: 'compact', hiddenFields: ['name'] } } },
  };

  it('after a reload, `schema` carries the user\'s choice and `viewDefaults` the view\'s own', async () => {
    const ds = makeDataSource();
    const { family, release } = makeFamily(structuredClone(STORED), { held: true });
    mountWithFamily(ds, family);
    await screen.findByTestId('object-view-list-preferences-pending');
    await act(async () => release());
    await listReady();

    expect(listProps.schema.rowHeight).toBe('compact');
    expect(listProps.schema.hiddenFields).toEqual(['name']);
    expect(listProps.viewDefaults).toEqual({ hiddenFields: AUTHORED_HIDDEN, rowHeight: AUTHORED_ROW_HEIGHT });
  });

  it('the list\'s reset writes the view\'s own through the controls\' doors, and it lands as the user\'s choice', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();

    act(() => {
      listProps.onHiddenFieldsChange(listProps.viewDefaults.hiddenFields);
      listProps.schema.onDensityChange('spacious');
    });
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, {
      perView: { [SYSTEM_ID]: { rowHeight: AUTHORED_ROW_HEIGHT, hiddenFields: AUTHORED_HIDDEN } },
    });
    expect(listProps.schema.rowHeight).toBe(AUTHORED_ROW_HEIGHT);
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
    expect(listProps.viewDefaults).toEqual({ hiddenFields: AUTHORED_HIDDEN, rowHeight: AUTHORED_ROW_HEIGHT });
  });

  it('CONTROL: another user, with no state of their own, is handed the same value twice', async () => {
    session.userId = 'u2';
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();

    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
    expect(listProps.schema.rowHeight).toBe(AUTHORED_ROW_HEIGHT);
    expect(listProps.viewDefaults).toEqual({ hiddenFields: listProps.schema.hiddenFields, rowHeight: listProps.schema.rowHeight });
  });

  it('on a saved view that declares no `columns`, the view hides nothing: its authored key stays unapplied (objectui#12505)', async () => {
    const UNPROJECTED_SAVED_ROW = { name: SAVED_ID, object: OBJECT_NAME, label: 'Pipeline', type: 'grid', hiddenFields: ['name'] };
    const ds = makeDataSource(UNPROJECTED_SAVED_ROW);
    const { family } = makeFamily({ [LIST_KEY]: { perView: { [SAVED_ID]: { hiddenFields: ['amount'] } } } });
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();

    expect(listProps.schema.hiddenFields).toEqual(['amount']);
    expect(listProps.viewDefaults.hiddenFields).toBeUndefined();
  });
});

describe('CONTROL — no provider: this browser\'s state, as before (objectui#12418)', () => {
  function mountBare(ds: ConsoleObjectViewProps['dataSource'], viewId = SYSTEM_ID) {
    return render(page(ds, viewId));
  }

  it('a sort writes no view, persists in this browser, and the next mount opens on it', async () => {
    const ds = makeDataSource();
    mountBare(ds);
    await listReady();
    act(() => listProps.onSortChange([{ id: 'row-1', field: 'amount', order: 'desc' }]));
    await wait(400);

    expect(viewWrites(ds)).toBe(0);
    expect(JSON.parse(localStorage.getItem(localListStateKey('u1', OBJECT_NAME)) ?? '{}')).toEqual({
      perView: { [SYSTEM_ID]: { sort: [{ field: 'amount', order: 'desc' }] } },
    });

    cleanup();
    listProps = null;
    mountBare(makeDataSource());
    await listReady();
    expect(listProps.schema.sort).toEqual([{ field: 'amount', order: 'desc' }]);
  });

  it('the older per-browser keys still open the list: `viewOrder:<object>` and the Filter panel\'s group', async () => {
    localStorage.setItem(`viewOrder:${OBJECT_NAME}`, JSON.stringify([SAVED_ID, SYSTEM_ID]));
    const filters = { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'Acme' }] };
    localStorage.setItem(`list-filters:u1:${OBJECT_NAME}:${SYSTEM_ID}`, JSON.stringify({ filters, search: 'acme' }));

    mountBare(makeDataSource());
    await listReady();

    expect(manageViewsOrder).toEqual([SAVED_ID, SYSTEM_ID]);
    expect(listProps.initialFilters).toEqual(filters);
    expect(listProps.initialSearchTerm).toBe('acme');
  });

  it('a drag writes no view and keeps the order in this browser', async () => {
    const ds = makeDataSource();
    mountBare(ds);
    await listReady();
    await act(async () => {
      fireEvent.click(screen.getByTestId('stub-reorder'));
    });
    await wait(100);

    expect(viewWrites(ds)).toBe(0);
    expect(manageViewsOrder).toEqual([SAVED_ID, SYSTEM_ID]);
    expect(JSON.parse(localStorage.getItem(localListStateKey('u1', OBJECT_NAME)) ?? '{}')).toEqual({
      viewOrder: [SAVED_ID, SYSTEM_ID],
    });
  });
});
