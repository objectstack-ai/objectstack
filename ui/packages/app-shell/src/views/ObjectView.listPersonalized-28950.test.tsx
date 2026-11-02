/**
 * objectstack#28950 — the 「Personalized」 marker beside the list title and its
 * one reset, at the host seam: the real object page, the real
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
 *   2. The marker is drawn only while the list reports a part (or a column
 *      layout is stored), names the parts, and is the header's one reset: the
 *      ⋯ menu carries none.
 *   3. After a reload (the list seeded from the URL), the reset opens the list
 *      as the view declares it: the address bar has no `uf_*` param left, a
 *      reload would not bring the old list back, and the chips start empty.
 *      This is the case the header's old "Reset view" re-seeded from the URL.
 *   4. In session, the reset also drops the cached search term, which the old
 *      "Reset view" wrote back into the address bar.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen, fireEvent, waitFor } from '@testing-library/react';
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
    return null;
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

describe('the 「Personalized」 marker and its one reset (objectstack#28950)', () => {
  it('is drawn only while the list reports a part, names the parts, and the header ⋯ carries no reset', async () => {
    mount(makeFamily({}));
    await listReady();
    expect(screen.queryByTestId('list-personalized-marker')).toBeNull();

    act(() => listProps.onPersonalizationChange(['sort', 'search', 'rowColor']));
    const marker = await screen.findByTestId('list-personalized-marker');
    // Named by its label, which the icon-only phone face keeps as `aria-label`.
    expect(marker.getAttribute('aria-label')).toBe('console.objectView.personalized');
    fireEvent.click(marker);
    const parts = await screen.findByTestId('list-personalized-parts');
    expect([...parts.querySelectorAll('li')].map((li) => li.getAttribute('data-part'))).toEqual(['search', 'sort', 'rowColor']);
    expect([...parts.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'console.objectView.personalizedParts.search',
      'console.objectView.personalizedParts.sort',
      'console.objectView.personalizedParts.rowColor',
    ]);
    expect(screen.queryByTestId('object-view-reset-view-button')).toBeNull();

    act(() => listProps.onPersonalizationChange([]));
    await waitFor(() => expect(screen.queryByTestId('list-personalized-marker')).toBeNull());
  });

  it('after a reload, the reset opens the list as the view declares it and leaves no `uf_*` param behind', async () => {
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
    fireEvent.click(await screen.findByTestId('list-personalized-marker'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('list-personalized-reset'));
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
    expect(screen.queryByTestId('list-personalized-marker')).toBeNull();
  });

  it('in session, the reset drops the cached search term, which would otherwise seed the list again', async () => {
    mount(makeFamily({}));
    await listReady();
    const cacheKey = buildListFilterKey(session.userId, OBJECT_NAME, SYSTEM_ID);

    act(() => listProps.onSearchChange('Alan'));
    await wait(400);
    expect(JSON.parse(localStorage.getItem(cacheKey!) ?? '{}').search).toBe('Alan');
    expect(new URLSearchParams(currentSearch).get('uf__search')).toBe('Alan');

    act(() => listProps.onPersonalizationChange(['search']));
    fireEvent.click(await screen.findByTestId('list-personalized-marker'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('list-personalized-reset'));
    });
    await wait(400);

    expect(localStorage.getItem(cacheKey!)).toBeNull();
    expect(listProps.initialSearchTerm).toBeUndefined();
    expect(ufParams()).toEqual([]);
  });

  it('CONTROL: a stored column layout alone draws the marker, and the reset drops it with the rest of the entry', async () => {
    const family = makeFamily({ [`ui.list.${OBJECT_NAME}`]: { perView: { [SYSTEM_ID]: { columnState: { widths: { name: 280 } } } } } });
    mount(family);
    await listReady();

    fireEvent.click(await screen.findByTestId('list-personalized-marker'));
    const parts = await screen.findByTestId('list-personalized-parts');
    expect([...parts.querySelectorAll('li')].map((li) => li.getAttribute('data-part'))).toEqual(['columns']);
    await act(async () => {
      fireEvent.click(screen.getByTestId('list-personalized-reset'));
    });
    await wait(700);

    expect(family.save).toHaveBeenCalledWith(`ui.list.${OBJECT_NAME}`, {});
    expect(listProps.schema.columnState).toEqual({});
    expect(screen.queryByTestId('list-personalized-marker')).toBeNull();
  });
});
