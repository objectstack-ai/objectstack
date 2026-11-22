/**
 * objectui#12418 — on the object page, a toolbar change on a list is never the
 * shared view's: the view is written only by the view editor. objectstack#35955
 * — what the reader changes on the list is a DRAFT (`./listDraftStore.ts`): it
 * applies at once, is stored nowhere, and is kept with Save or dropped with
 * Discard. What stays stored for the reader is what never becomes a draft: the
 * column widths, the row height and the tab order.
 *
 * ## The defect objectui#12418 pinned
 *
 * A header sort went through `persistViewPatch` (the toolbar's view write,
 * retired in objectui#12504) into the view (`/meta/view`), a column drag the
 * same way, and a Manage Views drag PATCHed a `sortOrder` onto every saved
 * view's row: one user's click changed the list for every user.
 *
 * ## What runs
 *
 * The real object page, the real `ListPreferencesProvider` (its 500 ms write
 * debounce included) and a list-state family that records its `load` and
 * `save` the way `@object-ui/data-objectstack`'s does (`sys_user_preference`,
 * one `ui.list.<object>` row per object). The view writes are the adapter's
 * `updateView` spy and, for the view editor's save, a real `MetadataClient`
 * whose `PUT /meta/view/…` is counted. `ListView` is captured (a toolbar change
 * is the page's own callback) and Manage Views is reduced to its reorder and
 * its config entry.
 *
 * ## The pins
 *
 *   1. A header sort writes no view and nothing stored: it is the draft's. A
 *      column resize lands as ONE save of the object's row, widths only. A
 *      Manage Views drag lands as ONE save. The view editor's save still
 *      writes `/meta/view`.
 *   2. A fresh browser opens on the reader's stored tab order and column
 *      widths once the family has loaded; a sort or filter an earlier console
 *      stored there no longer applies. Another user sees the view's own.
 *      Discard puts the list back as its view declares it and keeps the
 *      widths; it writes nothing.
 *   3. objectui#12474 — the density stays the reader's stored choice; a Hide
 *      Fields change is the draft's. objectui#12505 — on a saved view that
 *      declares no `columns` the draft's hide applies over the drawn defaults.
 *   4. objectui#12949 — the list is handed the view's own density and hidden
 *      fields in `viewDefaults`, beside the reader's in `schema`.
 *   5. objectstack#28948 — the list's "Reset to view default" drops the reset
 *      parts (from the draft, or the stored row height), so the reader follows
 *      later changes to the view; a deliberate `sort: []` / `hiddenFields: []`
 *      is a draft part too.
 *   6. objectstack#30077 — a field the reader adds is a draft part: the list is
 *      handed it appended to the view's columns, and Discard drops it.
 *   7. CONTROL — no provider (a host without the console shell): a sort is the
 *      draft's there too; the older `viewOrder:<object>` key still orders the
 *      tabs, and the Filter panel's older per-browser group no longer applies.
 *   8. objectstack#32627 — a width change writes the reader's row only when it
 *      changes it.
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
 * stand-in draws nothing.
 */
let listProps: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    listProps = props;
    // objectstack#35548 — the view switcher leads the list's view bar: draw the slot.
    const lead = props.toolbarLeading;
    // objectstack#35878 — the condition row's end (Discard and Save, objectstack#35955) draws too.
    return (
      <>
        {typeof lead === 'function' ? lead({ recordCount: null, layout: 'grid' }) : lead ?? null}
        {props.conditionRowEnd ?? null}
      </>
    );
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
    // objectstack#35054: the view editor edits the saved view as stored, read
    // from its layers; no draft is pending (the draft read answers 404 below).
    if (path.endsWith(`/meta/view/${SAVED_ID}/layers`)) {
      return json({ code: null, overlay: SAVED_ROW, overlayScope: 'env', effective: SAVED_ROW, draft: null }, 200);
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

// Paid at collection, not in a case's clock: the view inspector's CEL authoring loads it on demand.
import '@objectstack/lint';
import { ObjectView, type ConsoleObjectViewProps } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { UserStateAdaptersProvider, useAttachListStateFamily } from '../context/UserStateAdapters';
import { ListPreferencesProvider, localListStateKey } from '../context/ListPreferencesProvider';
import { listDraftScope, patchListDraft, readListDraft, resetListDraftStoreForTests } from './listDraftStore';

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

/**
 * The list is mounted and the page's own reads (saved views) have landed: the
 * saved view is a row of the title's view switcher (objectstack#27594), which
 * is closed again.
 */
async function listReady() {
  await waitFor(() => expect(typeof listProps?.onSortChange).toBe('function'));
  fireEvent.click(await screen.findByTestId('list-view-switcher'));
  await screen.findByTestId(`view-switcher-row-${SAVED_ID}`);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByTestId('list-view-switcher-menu')).toBeNull());
  await wait(50);
}


/** objectstack#35955 — the draft the page holds for `viewId`, for the signed-in user. */
function draftOf(viewId: string = SYSTEM_ID) {
  return readListDraft(listDraftScope(session.userId, OBJECT_NAME, viewId));
}

/** objectstack#35955 — Discard, drawn at the condition row's end while the list holds a draft. */
async function discard() {
  const button = await screen.findByTestId('list-draft-discard');
  await act(async () => {
    fireEvent.click(button);
  });
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
  resetListDraftStoreForTests();
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

describe('a toolbar change writes no view (objectui#12418); what it changes is a draft (objectstack#35955)', () => {
  it('a header sort writes nothing stored; a column resize lands as one save of the object\'s row, widths only', async () => {
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
      perView: { [SYSTEM_ID]: { columnState: { widths: { name: 320 } } } },
    });
    // The sort is the draft's (the list holds it on screen itself).
    expect(draftOf().sort).toEqual([{ field: 'amount', order: 'desc' }]);
    // The page hands the grid the reader's widths back.
    expect(listProps.schema.columnState).toEqual({ widths: { name: 320 } });
  });

  it('a column drag is the draft\'s order; the widths reported with it are the only stored part', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();

    act(() => listProps.onColumnStateChange({ order: ['amount', 'name'], widths: { name: 300 } }));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, {
      perView: { [SYSTEM_ID]: { columnState: { widths: { name: 300 } } } },
    });
    expect(draftOf().columnOrder).toEqual(['amount', 'name']);
    expect(listProps.schema.columnState).toEqual({ order: ['amount', 'name'], widths: { name: 300 } });
    // A drag lights Discard and Save on its own: the list reports no part for it.
    expect(screen.getByTestId('list-draft')).toBeTruthy();
  });

  it('the schema-level sort relay is the same draft write', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();

    act(() => listProps.schema.onSortChange([{ field: 'amount', order: 'asc' }]));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(draftOf().sort).toEqual([{ field: 'amount', order: 'asc' }]);
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

describe('what the reader keeps follows them; the draft does not (objectui#12418, objectstack#35955)', () => {
  /** A row an earlier console stored: its sort and filters are no longer read. */
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

  it('a fresh browser opens on the stored tab order and column widths once the family has loaded; the stored sort and filters no longer apply', async () => {
    const ds = makeDataSource();
    const { family, release } = makeFamily(structuredClone(STORED), { held: true });
    mountWithFamily(ds, family);

    // The list waits for the reader's state: nothing to open on yet.
    await screen.findByTestId('object-view-list-preferences-pending');
    expect(listProps).toBeNull();

    await act(async () => release());
    await listReady();

    expect(family.load).toHaveBeenCalledTimes(1);
    expect(manageViewsOrder).toEqual([SAVED_ID, SYSTEM_ID]);
    expect(listProps.schema.columnState).toEqual({ widths: { name: 280 } });
    expect(listProps.schema.sort).toEqual(AUTHORED_SORT);
    expect(listProps.initialFilters).toBeUndefined();
    // Widths are not a draft: nothing to discard or save.
    expect(screen.queryByTestId('list-draft')).toBeNull();
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
    expect(screen.queryByTestId('list-draft')).toBeNull();
    expect(await overflowTestIds()).not.toContain('object-view-reset-view-button');
  });

  it('Discard puts the list back as its view declares it, keeps the widths and writes nothing', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();
    const filters = { id: 'root', logic: 'and', conditions: [{ id: 'c2', field: 'name', operator: 'contains', value: 'Beta' }] };
    act(() => {
      listProps.onSortChange([{ field: 'amount', order: 'asc' }]);
      listProps.onFilterChange(filters);
      listProps.onPersonalizationChange(['sort', 'filters']);
    });
    await wait(50);
    expect(draftOf().sort).toEqual([{ field: 'amount', order: 'asc' }]);
    const before = listProps;

    // This harness mounts no I18nProvider, so `t` answers with the key: the pin
    // is WHICH key labels Discard and which says what it covers.
    const button = screen.getByTestId('list-draft-discard');
    expect(button.textContent?.trim()).toBe('console.objectView.draft.discard');
    expect(button.getAttribute('title')).toBe('console.objectView.draft.discardTitle');
    await discard();
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(draftOf()).toEqual({});
    // The list is mounted again on the view's own.
    expect(listProps).not.toBe(before);
    expect(listProps.schema.sort).toEqual(AUTHORED_SORT);
    expect(listProps.initialFilters).toBeUndefined();
    expect(listProps.schema.columnState).toEqual({ widths: { name: 280 } });
    expect(screen.queryByTestId('list-draft')).toBeNull();
    // The header ⋯ has no reset of its own (objectstack#28950).
    expect(await overflowTestIds()).not.toContain('object-view-reset-view-button');
  });

  it('with no favorites entry (no app segment), the ⋯ offers no reset: the way back is Discard', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SYSTEM_ID, { app: false });
    await listReady();

    // objectstack#35548 — the page bar's ⋮ also holds the description and
    // Import, so it is drawn; it carries no favorites entry and no reset.
    const more = screen.queryByRole('button', { name: 'More actions' });
    if (more) {
      fireEvent.keyDown(more, { key: 'Enter' });
      const entries = screen.queryAllByRole('menuitem').map((el) => (el.textContent ?? '').trim());
      expect(entries.some((text) => /favorites|reset/i.test(text))).toBe(false);
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    }
    act(() => {
      listProps.onSortChange([{ field: 'amount', order: 'asc' }]);
      listProps.onPersonalizationChange(['sort']);
    });
    await discard();
    await wait(50);
    expect(screen.queryByTestId('list-draft')).toBeNull();
    expect(listProps.schema.sort).toEqual(AUTHORED_SORT);
  });

  it('"Clear all" in the Filter panel drops the draft\'s filters and keeps its sort', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();
    act(() => {
      listProps.onSortChange([{ field: 'amount', order: 'asc' }]);
      listProps.onFilterChange({ id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'Acme' }] });
    });
    expect(draftOf().filters).toBeDefined();

    act(() => listProps.onFilterChange({ id: 'root', logic: 'and', conditions: [] }));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(draftOf()).not.toHaveProperty('filters');
    expect(draftOf().sort).toEqual([{ field: 'amount', order: 'asc' }]);
  });
});

describe('the density stays the reader\'s; the hidden fields are the draft\'s (objectui#12474, objectstack#35955)', () => {
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
    expect(draftOf()).toEqual({});
  });

  it('a Hide Fields change writes no view and nothing stored: the list is handed the draft\'s', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);

    // The whole list the popover emits: the reader showed `amount` and hid `name`.
    act(() => listProps.onHiddenFieldsChange(['name']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(family.save).not.toHaveBeenCalled();
    expect(draftOf().hiddenFields).toEqual(['name']);
    expect(listProps.schema.hiddenFields).toEqual(['name']);
  });

  const STORED = {
    [LIST_KEY]: { perView: { [SYSTEM_ID]: { rowHeight: 'compact', hiddenFields: [] } } },
  };

  it('a fresh browser opens on the stored density; hidden fields an earlier console stored no longer apply', async () => {
    const ds = makeDataSource();
    const { family, release } = makeFamily(structuredClone(STORED), { held: true });
    mountWithFamily(ds, family);
    await screen.findByTestId('object-view-list-preferences-pending');
    await act(async () => release());
    await listReady();

    expect(listProps.schema.rowHeight).toBe('compact');
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
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

  it('Discard drops the hidden fields and keeps the stored density', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();
    act(() => {
      listProps.onHiddenFieldsChange(['name']);
      listProps.onPersonalizationChange(['density', 'hiddenFields']);
    });
    expect(listProps.schema.hiddenFields).toEqual(['name']);

    await discard();
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(listProps.schema.rowHeight).toBe('compact');
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
  });

  it('a density the list reports alone draws no Discard: it is not a draft part', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();
    act(() => listProps.onPersonalizationChange(['density']));
    await wait(50);
    expect(screen.queryByTestId('list-draft')).toBeNull();
  });
});

describe('on a saved view that declares no `columns`, the draft\'s hidden fields apply over the drawn defaults (objectui#12505)', () => {
  /**
   * The saved row with no `columns`: the page draws the object's defaults into
   * it, and declares no projection. Its own authored `hiddenFields` is never
   * applied there (objectui#10694); the draft's list is.
   */
  const UNPROJECTED_SAVED_ROW = { name: SAVED_ID, object: OBJECT_NAME, label: 'Pipeline', type: 'grid', hiddenFields: ['name'] };

  it('a Hide Fields change writes no view and nothing stored, and applies at once', async () => {
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
    expect(family.save).not.toHaveBeenCalled();
    expect(draftOf(SAVED_ID).hiddenFields).toEqual(['amount']);
    expect(listProps.schema.hiddenFields).toEqual(['amount']);
  });

  it('a list an earlier console stored for the view no longer applies', async () => {
    const ds = makeDataSource(UNPROJECTED_SAVED_ROW);
    const { family } = makeFamily({ [LIST_KEY]: { perView: { [SAVED_ID]: { hiddenFields: ['amount'] } } } });
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();

    expect(listProps.schema.columns).toEqual(expect.arrayContaining(['name', 'amount']));
    // Not the view's authored `['name']` either: it declares nothing on an unprojected view.
    expect(listProps.schema.hiddenFields).toBeUndefined();
  });

  it('Discard drops the draft\'s list, and the list opens on the default columns', async () => {
    const ds = makeDataSource(UNPROJECTED_SAVED_ROW);
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();
    act(() => {
      listProps.onHiddenFieldsChange(['amount']);
      listProps.onPersonalizationChange(['hiddenFields']);
    });

    await discard();
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(listProps.schema.hiddenFields).toBeUndefined();
  });

  it('CONTROL: on the saved view that declares `columns`, the hide applies the same way', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();
    expect(listProps.schema.columns).toEqual(['name']);

    act(() => listProps.onHiddenFieldsChange(['name']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(listProps.schema.hiddenFields).toEqual(['name']);
  });
});

describe('the list is handed the view\'s own density and hidden fields beside the reader\'s (objectui#12949)', () => {
  const STORED = { [LIST_KEY]: { perView: { [SYSTEM_ID]: { rowHeight: 'compact' } } } };

  it('`schema` carries the reader\'s density and the draft\'s hidden fields, `viewDefaults` the view\'s own', async () => {
    const ds = makeDataSource();
    const { family, release } = makeFamily(structuredClone(STORED), { held: true });
    mountWithFamily(ds, family);
    await screen.findByTestId('object-view-list-preferences-pending');
    await act(async () => release());
    await listReady();
    act(() => listProps.onHiddenFieldsChange(['name']));

    expect(listProps.schema.rowHeight).toBe('compact');
    expect(listProps.schema.hiddenFields).toEqual(['name']);
    expect(listProps.viewDefaults).toEqual({ hiddenFields: AUTHORED_HIDDEN, rowHeight: AUTHORED_ROW_HEIGHT, sort: AUTHORED_SORT, viewType: 'grid' });
  });

  it('a choice equal to the view\'s own, made through the controls\' doors, is still the reader\'s choice', async () => {
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
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, { perView: { [SYSTEM_ID]: { rowHeight: AUTHORED_ROW_HEIGHT } } });
    expect(draftOf().hiddenFields).toEqual(AUTHORED_HIDDEN);
    expect(listProps.schema.rowHeight).toBe(AUTHORED_ROW_HEIGHT);
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
    expect(listProps.viewDefaults).toEqual({ hiddenFields: AUTHORED_HIDDEN, rowHeight: AUTHORED_ROW_HEIGHT, sort: AUTHORED_SORT, viewType: 'grid' });
  });

  it('CONTROL: another user, with no state of their own, is handed the same value twice', async () => {
    session.userId = 'u2';
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();

    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
    expect(listProps.schema.rowHeight).toBe(AUTHORED_ROW_HEIGHT);
    expect(listProps.viewDefaults).toEqual({
      hiddenFields: listProps.schema.hiddenFields, rowHeight: listProps.schema.rowHeight, sort: listProps.schema.sort,
      // objectstack#35955 — the layout too: no draft, so the same value twice.
      viewType: listProps.schema.viewType,
    });
  });

  it('on a saved view that declares no `columns`, the view hides nothing: its authored key stays unapplied (objectui#12505)', async () => {
    const UNPROJECTED_SAVED_ROW = { name: SAVED_ID, object: OBJECT_NAME, label: 'Pipeline', type: 'grid', hiddenFields: ['name'] };
    const ds = makeDataSource(UNPROJECTED_SAVED_ROW);
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();
    act(() => listProps.onHiddenFieldsChange(['amount']));

    expect(listProps.schema.hiddenFields).toEqual(['amount']);
    expect(listProps.viewDefaults.hiddenFields).toBeUndefined();
  });
});

describe('the list\'s "Reset to view default" drops the reset parts instead of copying the view into them (objectstack#28948)', () => {
  const STORED = { [LIST_KEY]: { perView: { [SYSTEM_ID]: { rowHeight: 'compact' } } } };
  const VIEW = OBJECT.listViews[SYSTEM_ID] as Record<string, unknown>;

  /**
   * Mount on `rows` with a draft sort and hidden fields that differ from the
   * view's: the draft is held before the list mounts, as when the reader comes
   * back from a record.
   */
  async function mountChanged(rows: Record<string, any> = structuredClone(STORED)) {
    patchListDraft(listDraftScope(session.userId, OBJECT_NAME, SYSTEM_ID), {
      sort: [{ field: 'amount', order: 'desc' }],
      hiddenFields: ['name'],
    });
    const ds = makeDataSource();
    const { family } = makeFamily(rows);
    const mounted = mountWithFamily(ds, family);
    await listReady();
    return { ds, family, ...mounted };
  }

  it('the list is wired to tell a reset from a choice, and is handed the view\'s own sort', async () => {
    await mountChanged();

    expect(typeof listProps.onRestoreViewDefaults).toBe('function');
    // `schema.sort` is the draft's; the reset's baseline is the view's own.
    expect(listProps.schema.sort).toEqual([{ field: 'amount', order: 'desc' }]);
    expect(listProps.viewDefaults.sort).toEqual(AUTHORED_SORT);
  });

  it('a Display reset of density and hidden fields drops the draft\'s hidden fields and the stored row height', async () => {
    const { ds, family } = await mountChanged();

    act(() => listProps.onRestoreViewDefaults(['hiddenFields', 'rowHeight']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith(LIST_KEY, {});
    expect(draftOf()).toEqual({ sort: [{ field: 'amount', order: 'desc' }] });
    // The list is handed the view's own again.
    expect(listProps.schema.rowHeight).toBe(AUTHORED_ROW_HEIGHT);
    expect(listProps.schema.hiddenFields).toEqual(AUTHORED_HIDDEN);
  });

  it('after the reset the reader follows the view: a changed `rowHeight` and `hiddenFields` reach them on the next open', async () => {
    const rows = structuredClone(STORED) as Record<string, any>;
    const { unmount } = await mountChanged(rows);
    act(() => listProps.onRestoreViewDefaults(['hiddenFields', 'rowHeight']));
    await wait(700);
    unmount();

    // The view's author changes its defaults.
    const before = { rowHeight: VIEW.rowHeight, hiddenFields: VIEW.hiddenFields };
    VIEW.rowHeight = 'short';
    VIEW.hiddenFields = ['name'];
    try {
      listProps = null;
      mountWithFamily(makeDataSource(), makeFamily(rows).family);
      await listReady();
      expect(listProps.schema.rowHeight).toBe('short');
      expect(listProps.schema.hiddenFields).toEqual(['name']);
    } finally {
      VIEW.rowHeight = before.rowHeight;
      VIEW.hiddenFields = before.hiddenFields;
    }
  });

  it('a sort reset drops the draft\'s sort and writes nothing', async () => {
    const { ds, family } = await mountChanged({});

    act(() => listProps.onRestoreViewDefaults(['sort']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(draftOf()).toEqual({ hiddenFields: ['name'] });
  });

  it('CONTROL: a deliberate "no sort" and "show every column" are draft parts, and survive the list being mounted again', async () => {
    const rows: Record<string, any> = {};
    const { unmount } = mountWithFamily(makeDataSource(), makeFamily(rows).family);
    await listReady();
    act(() => {
      listProps.onSortChange([]);
      listProps.onHiddenFieldsChange([]);
    });
    await wait(700);
    expect(rows).toEqual({});
    expect(draftOf()).toEqual({ sort: [], hiddenFields: [] });
    unmount();

    // Opening a record as a page and coming back mounts the list again.
    listProps = null;
    mountWithFamily(makeDataSource(), makeFamily(rows).family);
    await listReady();
    expect(listProps.schema.sort).toEqual([]);
    expect(listProps.schema.hiddenFields).toEqual([]);
  });
});

describe('a field the reader adds to their list is a draft part (objectstack#30077, objectstack#35955)', () => {
  it('adding a field writes no view and nothing stored, and the list is handed it as a column', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();
    expect(listProps.schema.columns).toEqual(['name', 'amount']);
    expect(listProps.addedFields).toEqual([]);
    expect(typeof listProps.onAddedFieldsChange).toBe('function');

    act(() => listProps.onAddedFieldsChange(['owner']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(toast.error).not.toHaveBeenCalled();
    expect(family.save).not.toHaveBeenCalled();
    expect(draftOf().addedFields).toEqual(['owner']);
    expect(listProps.schema.columns).toEqual(['name', 'amount', 'owner']);
    expect(listProps.addedFields).toEqual(['owner']);
  });

  it('a field an earlier console stored as added no longer applies', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({ [LIST_KEY]: { perView: { [SYSTEM_ID]: { addedFields: ['owner'] } } } });
    mountWithFamily(ds, family);
    await listReady();

    expect(listProps.schema.columns).toEqual(['name', 'amount']);
    expect(listProps.addedFields).toEqual([]);
  });

  it('Discard drops the added field: the addition alone draws Discard and Save, and the list opens on the view\'s columns', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();
    act(() => listProps.onAddedFieldsChange(['owner']));
    expect(listProps.schema.columns).toEqual(['name', 'amount', 'owner']);

    // Nothing reported by the list: the addition is a part of its own.
    expect(screen.getByTestId('list-draft')).toBeTruthy();
    await discard();
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(listProps.schema.columns).toEqual(['name', 'amount']);
    expect(listProps.addedFields).toEqual([]);
    expect(screen.queryByTestId('list-draft')).toBeNull();
  });

  it('a name the view declares itself is the view\'s column, not an addition: no duplicate, nothing handed as added', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family);
    await listReady();
    act(() => listProps.onAddedFieldsChange(['amount', 'owner']));

    expect(listProps.schema.columns).toEqual(['name', 'amount', 'owner']);
    expect(listProps.addedFields).toEqual(['owner']);
  });

  it('on a saved view that declares `columns` the addition applies the same way', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily({});
    mountWithFamily(ds, family, SAVED_ID);
    await listReady();
    expect(listProps.schema.columns).toEqual(['name']);

    act(() => listProps.onAddedFieldsChange(['amount']));
    await wait(700);

    expect(viewWrites(ds)).toBe(0);
    expect(family.save).not.toHaveBeenCalled();
    expect(listProps.schema.columns).toEqual(['name', 'amount']);
  });
});

describe('CONTROL — no provider: a sort is the draft\'s here too (objectui#12418, objectstack#35955)', () => {
  function mountBare(ds: ConsoleObjectViewProps['dataSource'], viewId = SYSTEM_ID) {
    return render(page(ds, viewId));
  }

  it('a sort writes no view and nothing in this browser\'s storage, and the list mounted again opens on it', async () => {
    const ds = makeDataSource();
    mountBare(ds);
    await listReady();
    act(() => listProps.onSortChange([{ id: 'row-1', field: 'amount', order: 'desc' }]));
    await wait(400);

    expect(viewWrites(ds)).toBe(0);
    expect(localStorage.getItem(localListStateKey('u1', OBJECT_NAME))).toBeNull();

    cleanup();
    listProps = null;
    mountBare(makeDataSource());
    await listReady();
    expect(listProps.schema.sort).toEqual([{ field: 'amount', order: 'desc' }]);
  });

  it('the older `viewOrder:<object>` key still orders the tabs; the Filter panel\'s older per-browser group no longer applies', async () => {
    localStorage.setItem(`viewOrder:${OBJECT_NAME}`, JSON.stringify([SAVED_ID, SYSTEM_ID]));
    const filters = { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'Acme' }] };
    localStorage.setItem(`list-filters:u1:${OBJECT_NAME}:${SYSTEM_ID}`, JSON.stringify({ filters, search: 'acme' }));

    mountBare(makeDataSource());
    await listReady();

    expect(manageViewsOrder).toEqual([SAVED_ID, SYSTEM_ID]);
    expect(listProps.initialFilters).toBeUndefined();
    expect(listProps.initialSearchTerm ?? '').toBe('');
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

describe('a width change writes the reader\'s row only when it changes it (objectstack#32627)', () => {
  const STORED = { [LIST_KEY]: { perView: { [SYSTEM_ID]: { columnState: { widths: { name: 280 } } } } } };

  it('re-stating the stored widths, a sort, and clearing filters nobody set, sends no write', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();

    act(() => {
      listProps.onSortChange([{ id: 'row-1', field: 'amount', order: 'desc' }]);
      listProps.onColumnStateChange({ widths: { name: 280 } });
      listProps.onFilterChange({ id: 'root', logic: 'and', conditions: [] });
    });
    await wait(700);

    expect(family.save).not.toHaveBeenCalled();
  });

  it('a width change undone before the write leaves sends no write', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();

    act(() => listProps.onColumnStateChange({ widths: { name: 400 } }));
    act(() => listProps.onColumnStateChange({ widths: { name: 280 } }));
    await wait(700);

    expect(family.save).not.toHaveBeenCalled();
    expect(listProps.schema.columnState).toEqual({ widths: { name: 280 } });
  });

  it('CONTROL: a width that differs from the stored one is one write, and undoing it after it landed is another', async () => {
    const ds = makeDataSource();
    const { family } = makeFamily(structuredClone(STORED));
    mountWithFamily(ds, family);
    await listReady();

    act(() => listProps.onColumnStateChange({ widths: { name: 400 } }));
    await wait(700);
    expect(family.save).toHaveBeenCalledTimes(1);
    expect((family.save.mock.calls[0][1] as any).perView[SYSTEM_ID].columnState).toEqual({ widths: { name: 400 } });

    act(() => listProps.onColumnStateChange({ widths: { name: 280 } }));
    await wait(700);
    expect(family.save).toHaveBeenCalledTimes(2);
    expect((family.save.mock.calls[1][1] as any).perView[SYSTEM_ID].columnState).toEqual({ widths: { name: 280 } });
  });
});
