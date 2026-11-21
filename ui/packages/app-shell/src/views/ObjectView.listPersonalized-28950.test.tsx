/**
 * objectstack#35955 — Discard and Save on a list that holds a draft (the
 * 「Personalized」 marker of objectstack#28950 before it), at the host seam: the real object page, the real
 * `ListPreferencesProvider` and the real router, with `ListView` captured (its
 * own half, what of the list differs from the view, is pinned in plugin-list's
 * `ListView.personalization-28950.test.tsx`).
 *
 * ## The pins
 *
 *   1. `withoutListStateParams` strips the reader's whole `uf_*` family (the
 *      Filter panel, search, sort, grouping and every chip) and keeps every
 *      other param: a `filter[...]` scope a "View all" link opened the list
 *      with, the open record.
 *   2. Discard and Save are drawn only while the list reports a draft part
 *      (or holds a column order or an added column): the row height and a
 *      search alone draw nothing. Save's menu names the parts; the compact
 *      face holds Discard in it; the ⋯ menu carries no reset.
 *   3. After a reload (the list seeded from the URL), Discard opens the list
 *      as the view declares it: the address bar has no `uf_*` param left, a
 *      reload would not bring the old list back, and the chips start empty.
 *   4. In session, the search term is the draft's, kept in no storage, and
 *      Discard drops it.
 *   5. Column widths are the reader's: never a draft, and Discard keeps them.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// `ObjectView` reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { render, cleanup, act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

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
    // objectstack#35878 — the condition row's end (the 「Personalized」 marker) draws too.
    return (
      <>
        {typeof lead === 'function' ? lead({ recordCount: null, layout: 'grid' }) : lead ?? null}
        {props.conditionRowEnd ?? null}
      </>
    );
  },
}));

const OBJECT_NAME = 'crm_deal';
const SYSTEM_ID = `${OBJECT_NAME}.all`;
const SAVED_ID = `${OBJECT_NAME}.pipeline`;
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let client: MetadataClient;
vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
}));

import { ObjectView, type ConsoleObjectViewProps } from './ObjectView';
import { listDraftScope, readListDraft, resetListDraftStoreForTests } from './listDraftStore';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { UserStateAdaptersProvider, useAttachListStateFamily } from '../context/UserStateAdapters';
import { ListPreferencesProvider } from '../context/ListPreferencesProvider';
import { withoutListStateParams } from './objectViewListUrlState';
import { applyListStateParams, applyUserFilterParams } from './userFilterUrlState';
import { buildListFilterKey } from './listFilterStorage';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  stage: { type: 'text', label: 'Stage' },
  amount: { type: 'number', label: 'Amount' },
};
const AUTHORED_SORT = [{ field: 'name', order: 'asc' }];
const SAVED_ROW = { name: SAVED_ID, object: OBJECT_NAME, label: 'Pipeline', type: 'grid', columns: ['name'] };
const OBJECT = {
  name: OBJECT_NAME,
  label: 'Deal',
  fields: FIELDS,
  listViews: {
    [SYSTEM_ID]: { name: SYSTEM_ID, label: 'All', type: 'grid', columns: ['name', 'stage', 'amount'], sort: AUTHORED_SORT },
  },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT_NAME, fields: {} })),
    listViews: vi.fn(async () => [SAVED_ROW]),
    updateView: vi.fn(async () => ({})),
    deleteView: vi.fn(async () => ({})),
  } as unknown as ConsoleObjectViewProps['dataSource'];
}

function makeFamily(rows: Record<string, unknown>) {
  return {
    prefix: 'ui.list.',
    load: vi.fn(async () => structuredClone(rows) as Record<string, any>),
    save: vi.fn(async (key: string, value: unknown) => {
      rows[key] = structuredClone(value);
    }),
  };
}

function AttachFamily({ family }: { family: any }) {
  const attach = useAttachListStateFamily();
  React.useEffect(() => {
    attach(family);
    return () => attach(null);
  }, [attach, family]);
  return null;
}

/** The address bar, as the page last wrote it. */
let currentSearch = '';
function LocationProbe() {
  const { search } = useLocation();
  React.useEffect(() => {
    currentSearch = search;
  }, [search]);
  return null;
}

function mount(family: any, query = '') {
  return render(
    <UserStateAdaptersProvider>
      <AttachFamily family={family} />
      <ListPreferencesProvider>
        <ExpressionProvider user={{ id: session.userId, name: 'Ada', profile: 'admin' }}>
          <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/${SYSTEM_ID}${query}`]}>
            <Routes>
              <Route
                path="/apps/:appName/:objectName/view/:viewId"
                element={(
                  <>
                    <LocationProbe />
                    <ObjectView dataSource={makeDataSource()} objects={[OBJECT as any]} onEdit={() => {}} />
                  </>
                )}
              />
            </Routes>
          </MemoryRouter>
        </ExpressionProvider>
      </ListPreferencesProvider>
    </UserStateAdaptersProvider>,
  );
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

async function listReady() {
  await waitFor(() => expect(typeof listProps?.onPersonalizationChange).toBe('function'));
  await wait(50);
}

/** The `uf_*` params of the address bar. */
const ufParams = () => [...new URLSearchParams(currentSearch).keys()].filter((key) => key.startsWith('uf_'));

/** A link carrying a whole personalized list: panel filter, search, sort, grouping and a chip. */
function personalizedQuery(): string {
  let params = new URLSearchParams('filter[owner]=u1');
  params = applyListStateParams(params, {
    filters: { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'Acme' }] } as any,
    search: 'Alan',
    sort: [{ field: 'amount', order: 'desc' }],
    grouping: { fields: [{ field: 'stage', order: 'asc', collapsed: false }] } as any,
  });
  params = applyUserFilterParams(params, { stage: ['won'] });
  return `?${params.toString()}`;
}

beforeEach(() => {
  cleanup();
  session.userId = 'u1';
  listProps = null;
  currentSearch = '';
  localStorage.clear();
  resetListDraftStoreForTests();
  client = new MetadataClient({ baseUrl: 'http://localhost', fetch: vi.fn(async () => json({ data: [] }, 200)) as unknown as typeof fetch });
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

describe('withoutListStateParams (objectstack#28950)', () => {
  it('strips the reader\'s whole `uf_*` family and keeps every other param', () => {
    const params = new URLSearchParams(personalizedQuery().slice(1));
    params.set('recordId', 'r1');
    expect([...params.keys()].filter((key) => key.startsWith('uf_')).length).toBe(5);

    const stripped = withoutListStateParams(params);
    expect([...stripped.keys()].filter((key) => key.startsWith('uf_'))).toEqual([]);
    expect(stripped.get('filter[owner]')).toBe('u1');
    expect(stripped.get('recordId')).toBe('r1');
    // A copy: the params handed in are untouched.
    expect(params.get('uf__search')).toBe('Alan');
  });
});

/** Open a Radix menu the way a pointer does (jsdom sends no click-open). */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

describe('Discard and Save, while the list holds a draft (objectstack#35955; the marker of objectstack#28950 before it)', () => {
  it('is drawn only while the list reports a draft part, names the parts in the Save menu, and the header ⋯ carries no reset', async () => {
    mount(makeFamily({}));
    await listReady();
    expect(screen.queryByTestId('list-draft')).toBeNull();

    // The row height is the reader's, and a search alone is not a change to the view.
    act(() => listProps.onPersonalizationChange(['search', 'density']));
    await wait(50);
    expect(screen.queryByTestId('list-draft')).toBeNull();

    act(() => listProps.onPersonalizationChange(['sort', 'search', 'rowColor']));
    expect(await screen.findByTestId('list-draft-discard')).toBeTruthy();
    // The compact face (a phone, a narrow list) holds Discard in Save's menu.
    openMenu(screen.getByTestId('list-draft-compact'));
    const menu = await screen.findByTestId('list-draft-compact-menu');
    expect(within(menu).getByTestId('list-draft-parts').textContent).toBe(
      'console.objectView.draft.heading: console.objectView.personalizedParts.sort'
      + 'console.objectView.draft.partSeparator'
      + 'console.objectView.personalizedParts.rowColor',
    );
    expect(within(menu).getByTestId('list-draft-compact-discard')).toBeTruthy();
    expect(screen.queryByTestId('object-view-reset-view-button')).toBeNull();

    act(() => listProps.onPersonalizationChange([]));
    await waitFor(() => expect(screen.queryByTestId('list-draft')).toBeNull());
  });

  it('after a reload, Discard opens the list as the view declares it and leaves no `uf_*` param behind', async () => {
    const family = makeFamily({});
    mount(family, personalizedQuery());
    await listReady();
    // The list opened from the link: every part of it is the reader's.
    expect(listProps.initialSearchTerm).toBe('Alan');
    expect(listProps.schema.sort).toEqual([{ field: 'amount', order: 'desc' }]);
    expect(listProps.userFilterSelections).toEqual({ stage: ['won'] });
    expect(ufParams().length).toBe(5);
    const before = listProps;

    act(() => listProps.onPersonalizationChange(['filters', 'search', 'sort', 'grouping']));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('list-draft-discard'));
    });
    await wait(400);

    expect(listProps).not.toBe(before);
    expect(listProps.initialSearchTerm).toBeUndefined();
    expect(listProps.initialFilters).toBeUndefined();
    expect(listProps.schema.sort).toEqual(AUTHORED_SORT);
    expect(listProps.schema.grouping).toBeUndefined();
    expect(listProps.userFilterSelections).toBeUndefined();
    expect(ufParams()).toEqual([]);
    // The drill scope is not the reader's list state: it stays.
    expect(new URLSearchParams(currentSearch).get('filter[owner]')).toBe('u1');
    expect(screen.queryByTestId('list-draft')).toBeNull();
  });

  it('in session, the search is the draft\'s: kept nowhere durable, and Discard drops it', async () => {
    mount(makeFamily({}));
    await listReady();
    const cacheKey = buildListFilterKey(session.userId, OBJECT_NAME, SYSTEM_ID);

    act(() => listProps.onSearchChange('Alan'));
    await wait(400);
    expect(localStorage.getItem(cacheKey!)).toBeNull();
    expect(readListDraft(listDraftScope(session.userId, OBJECT_NAME, SYSTEM_ID)).search).toBe('Alan');
    expect(new URLSearchParams(currentSearch).get('uf__search')).toBe('Alan');

    act(() => listProps.onPersonalizationChange(['search', 'sort']));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('list-draft-discard'));
    });
    await wait(400);

    expect(readListDraft(listDraftScope(session.userId, OBJECT_NAME, SYSTEM_ID))).toEqual({});
    expect(listProps.initialSearchTerm).toBeUndefined();
    expect(ufParams()).toEqual([]);
  });

  it('column widths are the reader\'s, never a draft: a stored width draws nothing, and Discard keeps it', async () => {
    const family = makeFamily({ [`ui.list.${OBJECT_NAME}`]: { perView: { [SYSTEM_ID]: { columnState: { widths: { name: 280 } } } } } });
    mount(family);
    await listReady();
    expect(screen.queryByTestId('list-draft')).toBeNull();
    expect(listProps.schema.columnState).toEqual({ widths: { name: 280 } });

    // A drag of the column order is a draft; the width rides on the same report.
    act(() => listProps.schema.onColumnStateChange({ order: ['amount', 'name'], widths: { name: 280 } }));
    expect(await screen.findByTestId('list-draft-discard')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId('list-draft-discard'));
    });
    await wait(700);

    expect(listProps.schema.columnState).toEqual({ widths: { name: 280 } });
    expect(screen.queryByTestId('list-draft')).toBeNull();
    // Nothing of the order reached the reader's stored row.
    for (const [, value] of family.save.mock.calls) {
      expect(JSON.stringify(value)).not.toContain('order');
    }
  });
});
