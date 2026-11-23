/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35875 — the bare data page (`ObjectDataPage`,
 * `/apps/:app/:object/data`) opens a record by the list's one rule
 * (objectstack#35854), as the object list does:
 *
 *   - the record's name opens the full page, which carries the data page as
 *     its origin: its URL with its conditions, its name, the rows it shows and
 *     the count it matched;
 *   - the name cell's 「在侧边打开」 icon opens the side drawer over the list,
 *     through `?recordId=`, and the list stays;
 *   - a click on any other cell opens nothing;
 *   - the page's way back (`useRecordPageReturn().toList`, the top bar's ✕)
 *     lands on the data page with its conditions;
 *   - a list-only object draws no icon;
 *   - on a phone the page is pushed over the data page (the history-state
 *     marker the page's 「‹」 reads to go back), as the object list's is.
 *
 * Driven through the real `ObjectDataPage`, the real `ListView` grid and the
 * real `MePermissionsProvider`. The record body is not what this file reads,
 * so `RecordDetailView` is a null sink; the record route mounts a probe that
 * reads the page's origin with the hook the record page's top bar uses.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

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

// The record body: not what this file reads.
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('./metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => ({ save: vi.fn(async () => ({})), get: vi.fn(async () => null) }),
}));

// The page reaches a dynamic `import('@objectstack/lint')`: pay its load at
// collection, never inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { ObjectDataPage } from './ObjectDataPage';
import { useRecordPageReturn } from './recordDrawerStack';
import { isRecordPagePushed } from './recordPagePush';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'demo_account';
const DATA_PATH = `/apps/sales/${OBJECT_NAME}/data`;
/** The data page's own condition: its address is the list. */
const DATA_SEARCH = '?filter[status]=active';

/** The served operations of a list-only object: `list` and what derives from it, no `get`. */
const LIST_ONLY_OPERATIONS = ['list', 'aggregate', 'export', 'search'];

const ROWS = [
  { id: 'a1', name: 'Acme', status: 'active', city: 'Lyon' },
  { id: 'a2', name: 'Globex', status: 'active', city: 'Oslo' },
];
const MATCHED = 7;

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Account',
    pluralLabel: 'Accounts',
    fields: {
      name: { type: 'text', label: 'Name' },
      status: { type: 'text', label: 'Status' },
      city: { type: 'text', label: 'City' },
    },
  },
];

function answer(apiOperations?: string[]): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: null,
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: ['admin'],
    systemPermissions: [],
    objects: {
      [OBJECT_NAME]: {
        allowRead: true,
        allowCreate: true,
        allowEdit: true,
        allowDelete: true,
        ...(apiOperations ? { apiOperations } : {}),
      },
    },
    fields: {},
  } as MePermissionsAuthenticatedResponse;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location-pathname">{location.pathname}</output>
      <output data-testid="location-search">{location.search}</output>
    </>
  );
}

/** The record route: the page's origin as the history state carries it, and its ✕. */
function RecordPageProbe() {
  const location = useLocation();
  const recordId = location.pathname.split('/').pop();
  const pageReturn = useRecordPageReturn(recordId);
  const from = (location.state as { from?: unknown } | null)?.from;
  const position = pageReturn.stepper?.position;
  return (
    <div data-testid="record-page">
      <output data-testid="record-from">{JSON.stringify(from ?? null)}</output>
      <output data-testid="record-pushed">{String(isRecordPagePushed(location.state))}</output>
      <output data-testid="record-position">
        {position ? `${position.index + 1}/${position.total}` : ''}
      </output>
      {pageReturn.toList && (
        <button type="button" data-testid="record-close" onClick={pageReturn.toList}>close</button>
      )}
    </div>
  );
}

let openSpy: ReturnType<typeof vi.fn>;
const DESKTOP_WIDTH = window.innerWidth;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}
let findOne: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  openSpy = vi.fn(() => null);
  vi.stubGlobal('open', openSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setViewportWidth(DESKTOP_WIDTH);
  window.history.replaceState(null, '', '/');
});

async function mountDataPage(apiOperations?: string[]) {
  findOne = vi.fn(async () => null);
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: MATCHED })),
    findOne,
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS.find((o) => o.name === name) ?? null),
  } as never;
  window.history.replaceState(null, '', DATA_PATH);
  render(
    <MePermissionsProvider initialPermissions={answer(apiOperations)}>
      <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
        <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
          <MemoryRouter initialEntries={[`${DATA_PATH}${DATA_SEARCH}`]}>
            <Routes>
              <Route path="/apps/:appName/:objectName/data" element={<ObjectDataPage dataSource={dataSource} objects={OBJECTS} />} />
              <Route path="/apps/:appName/:objectName/record/:recordId" element={<RecordPageProbe />} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </ExpressionProvider>
      </I18nProvider>
    </MePermissionsProvider>,
  );
  await screen.findByText('Globex', undefined, { timeout: 5000 });
}

/** Absence is only meaningful after the page has had a chance to react. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}

const pathname = () => screen.getByTestId('location-pathname').textContent;
const search = () => screen.getByTestId('location-search').textContent;
const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

/** A plain click on the record's name, the record link the name cell draws. */
function clickName(text: string): void {
  const row = rowOf(text);
  const link = within(row).getByText(text).closest('a, [role="link"]') as HTMLElement;
  expect(link).not.toBeNull();
  fireEvent.click(link);
}

describe('objectstack#35875 — the bare data page opens a record by the list\'s one rule', () => {
  it('the name opens the full page, which carries the data page as its origin', async () => {
    await mountDataPage();
    clickName('Acme');
    await screen.findByTestId('record-page', undefined, { timeout: 5000 });
    expect(pathname()).toBe(`/apps/sales/${OBJECT_NAME}/record/a1`);
    const from = JSON.parse(screen.getByTestId('record-from').textContent ?? 'null');
    expect(from).toEqual({
      pathname: `${DATA_PATH}?${new URLSearchParams(DATA_SEARCH).toString()}`,
      label: 'Accounts',
      siblings: ['a1', 'a2'],
      total: MATCHED,
    });
    // The page's top bar counts the record among the data page's matched rows.
    expect(screen.getByTestId('record-position').textContent).toBe(`1/${MATCHED}`);
    // A desktop opens the page in place of the list: nothing is pushed over it.
    expect(screen.getByTestId('record-pushed').textContent).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('on a phone the name pushes the page over the data page, so the page\'s 「‹」 goes back to it', async () => {
    setViewportWidth(390);
    await mountDataPage();
    fireEvent.click(screen.getByText('Acme'));
    await screen.findByTestId('record-page', undefined, { timeout: 5000 });
    expect(pathname()).toBe(`/apps/sales/${OBJECT_NAME}/record/a1`);
    expect(screen.getByTestId('record-pushed').textContent).toBe('true');
    expect(JSON.parse(screen.getByTestId('record-from').textContent ?? 'null')?.pathname)
      .toBe(`${DATA_PATH}?${new URLSearchParams(DATA_SEARCH).toString()}`);
  });

  it('the name cell\'s hover icon opens the side drawer over the list, which stays', async () => {
    await mountDataPage();
    const icon = within(rowOf('Acme')).getByTestId('record-open-in-panel');
    expect(icon.getAttribute('aria-label')).toBe('Open in side panel');
    fireEvent.click(icon);
    await waitFor(() => expect(new URLSearchParams(search() ?? '').get('recordId')).toBe('a1'));
    expect(pathname()).toBe(DATA_PATH);
    expect(await screen.findByRole('dialog', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByTestId('record-page')).toBeNull();
  });

  it('a click on any other cell of the row opens nothing', async () => {
    await mountDataPage();
    fireEvent.click(within(rowOf('Acme')).getByText('Lyon'));
    await settle();
    expect(pathname()).toBe(DATA_PATH);
    expect(new URLSearchParams(search() ?? '').get('recordId')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('record-page')).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('the full page\'s ✕ returns to the data page with its conditions', async () => {
    await mountDataPage();
    clickName('Globex');
    fireEvent.click(await screen.findByTestId('record-close', undefined, { timeout: 5000 }));
    await screen.findByText('Globex', undefined, { timeout: 5000 });
    expect(pathname()).toBe(DATA_PATH);
    expect(new URLSearchParams(search() ?? '').get('filter[status]')).toBe('active');
    expect(screen.getByTestId('object-data-page')).toBeTruthy();
  });

  it('a list-only object draws no 「Open in side panel」, and its name opens no page', async () => {
    await mountDataPage(LIST_ONLY_OPERATIONS);
    await settle();
    expect(screen.queryByTestId('record-open-in-panel')).toBeNull();
    fireEvent.click(screen.getByText('Acme'));
    await settle();
    expect(pathname()).toBe(DATA_PATH);
    expect(screen.queryByTestId('record-page')).toBeNull();
  });
});

describe('objectstack#36300 — the data page\'s side drawer draws ⤢ 「Open as full page」', () => {
  /** The name cell's hover icon, then the drawer it opens. */
  async function openDrawer(text: string, id: string): Promise<HTMLElement> {
    fireEvent.click(within(rowOf(text)).getByTestId('record-open-in-panel'));
    await waitFor(() => expect(new URLSearchParams(search() ?? '').get('recordId')).toBe(id));
    return screen.findByRole('dialog', undefined, { timeout: 5000 });
  }

  it('the drawer\'s ⤢ opens the full page with the origin a name click carries, and the drawer closes', async () => {
    await mountDataPage();
    const drawer = await openDrawer('Globex', 'a2');
    const expand = within(drawer).getByRole('button', { name: 'Open as full page' });
    expect(expand.getAttribute('data-testid')).toBe('record-pane-open-page');
    fireEvent.click(expand);
    await screen.findByTestId('record-page', undefined, { timeout: 5000 });
    expect(pathname()).toBe(`/apps/sales/${OBJECT_NAME}/record/a2`);
    // The origin is the data page with its conditions, without the drawer's `?recordId=`.
    expect(JSON.parse(screen.getByTestId('record-from').textContent ?? 'null')).toEqual({
      pathname: `${DATA_PATH}?${new URLSearchParams(DATA_SEARCH).toString()}`,
      label: 'Accounts',
      siblings: ['a1', 'a2'],
      total: MATCHED,
    });
    expect(screen.getByTestId('record-position').textContent).toBe(`2/${MATCHED}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the full page\'s ✕ after ⤢ returns to the data page with its conditions and no drawer', async () => {
    await mountDataPage();
    const drawer = await openDrawer('Acme', 'a1');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open as full page' }));
    fireEvent.click(await screen.findByTestId('record-close', undefined, { timeout: 5000 }));
    await screen.findByText('Globex', undefined, { timeout: 5000 });
    expect(pathname()).toBe(DATA_PATH);
    const params = new URLSearchParams(search() ?? '');
    expect(params.get('filter[status]')).toBe('active');
    expect(params.get('recordId')).toBeNull();
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/**
 * objectstack#36408 — the data page's list keeps its own state in the address,
 * under the keys `ObjectView` keeps it in: the search (`uf__search`), the sort
 * (`uf__sort`), the grouping (`uf__group`) and the Filter panel (`uf__filter`).
 * So the record page's ✕, which returns to the address the list was left at,
 * and a reload of that address, open the list as the reader left it. The
 * page's own address conditions (`filter[...]`) are a separate layer the list
 * applies with the panel; neither rewrites the other.
 */
describe('objectstack#36408 — the data page keeps its list\'s search, sort, grouping and Filter panel in the address', () => {
  const SOURCE_OBJECTS = [
    {
      ...OBJECTS[0],
      fields: { ...OBJECTS[0].fields, parent: { type: 'lookup', reference: 'demo_parent', label: 'Parent' } },
    },
    { name: 'demo_parent', label: 'Parent', pluralLabel: 'Parents', fields: { name: { type: 'text', label: 'Name' } } },
  ];
  const CITY_OSLO = { logic: 'and', conditions: [{ field: 'city', operator: 'equals', value: 'Oslo' }] };
  const BY_STATUS = { fields: [{ field: 'status', order: 'asc', collapsed: false }] };
  /** The list queries, newest last; the record-count probe (`$top: 0`) is left out. */
  let queries: Array<Record<string, any>> = [];
  let groupQueries: Array<{ groupBy?: string[] }> = [];
  const lastQuery = () => queries[queries.length - 1];
  const filterOf = (query: Record<string, any> | undefined) => JSON.stringify(query?.$filter ?? null);
  const addressParams = () => new URLSearchParams(search() ?? '');

  function address(params: Record<string, unknown>): string {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      sp.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
    return `?${sp.toString()}`;
  }

  async function mountAt(entrySearch: string, objects: unknown[] = OBJECTS, waitForRows = true) {
    queries = [];
    groupQueries = [];
    const dataSource = {
      find: vi.fn(async (_object: string, params: Record<string, any>) => {
        if (params?.$top !== 0) queries.push(params);
        return { data: ROWS, total: MATCHED };
      }),
      findOne: vi.fn(async () => null),
      // A grouped grid asks the server for its groups; recorded so a case can
      // read which fields the list is grouped by.
      queryGroupHeaders: vi.fn(async (_object: string, query: { groupBy?: string[] }) => {
        groupQueries.push(query);
        return [];
      }),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      getObjectSchema: vi.fn(async (name: string) => (objects as Array<{ name: string }>).find((o) => o.name === name) ?? null),
    } as never;
    window.history.replaceState(null, '', DATA_PATH);
    render(
      <MePermissionsProvider initialPermissions={answer()}>
        <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })}>
          <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
            <MemoryRouter initialEntries={[`${DATA_PATH}${entrySearch}`]}>
              <Routes>
                <Route path="/apps/:appName/:objectName/data" element={<ObjectDataPage dataSource={dataSource} objects={objects} />} />
                <Route path="/apps/:appName/:objectName/record/:recordId" element={<RecordPageProbe />} />
              </Routes>
              <LocationProbe />
            </MemoryRouter>
          </ExpressionProvider>
        </I18nProvider>
      </MePermissionsProvider>,
    );
    if (waitForRows) await screen.findByText('Globex', undefined, { timeout: 5000 });
    else await waitFor(() => expect(queries.length).toBeGreaterThan(0), { timeout: 5000 });
    await settle();
  }

  /** The record's full page by its name, then the page's ✕ back to the data page. */
  async function openAndClose(name: string) {
    clickName(name);
    await screen.findByTestId('record-page', undefined, { timeout: 5000 });
    const from = JSON.parse(screen.getByTestId('record-from').textContent ?? 'null');
    fireEvent.click(screen.getByTestId('record-close'));
    await screen.findByText('Globex', undefined, { timeout: 5000 });
    await settle();
    return from as { pathname: string };
  }

  it('a search, then a record opened and closed: the search is still applied', async () => {
    await mountAt(DATA_SEARCH);
    fireEvent.click(screen.getByTestId('search-icon-button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'Acm' } });
    await settle();
    expect(addressParams().get('uf__search')).toBe('Acm');
    expect(lastQuery().$search).toBe('Acm');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();

    const from = await openAndClose('Acme');
    // The record page's origin is the address with the search in it.
    expect(new URLSearchParams(from.pathname.split('?')[1]).get('uf__search')).toBe('Acm');
    expect(pathname()).toBe(DATA_PATH);
    expect(addressParams().get('uf__search')).toBe('Acm');
    expect(addressParams().get('filter[status]')).toBe('active');
    // The list the close returned to searches, and says so on its toolbar.
    expect(lastQuery().$search).toBe('Acm');
    expect(screen.getByTestId('search-active-keyword').textContent).toBe('Acm');
  });

  it('a reload of an address with a search, a sort and a Filter panel opens that list, on top of its own conditions', async () => {
    await mountAt(address({
      'filter[status]': 'active',
      uf__search: 'Glo',
      uf__sort: [{ field: 'city', order: 'desc' }],
      uf__filter: CITY_OSLO,
    }));
    const q = lastQuery();
    expect(q.$search).toBe('Glo');
    expect(q.$orderby).toEqual([{ field: 'city', order: 'desc' }]);
    // The two layers, both applied: the page's condition and the panel's.
    expect(filterOf(q)).toContain('"status","=","active"');
    expect(filterOf(q)).toContain('"city","=","Oslo"');
    // Neither layer rewrote the other: the address keeps both as they came.
    const params = addressParams();
    expect(params.get('filter[status]')).toBe('active');
    expect(JSON.parse(params.get('uf__filter')!)).toEqual(CITY_OSLO);
    expect(JSON.parse(params.get('uf__sort')!)).toEqual([{ field: 'city', order: 'desc' }]);
    // The panel condition is the list's, not one of the page's 「Filtered by」 tags.
    expect(screen.queryByTestId('object-data-remove-filter-city')).toBeNull();
    expect(screen.getByTestId('object-data-remove-filter-status')).toBeTruthy();

    // And they survive a record opened and closed.
    const from = await openAndClose('Globex');
    expect(new URLSearchParams(from.pathname.split('?')[1]).get('uf__sort')).toBe(params.get('uf__sort'));
    const back = lastQuery();
    expect(back.$search).toBe('Glo');
    expect(back.$orderby).toEqual([{ field: 'city', order: 'desc' }]);
    expect(filterOf(back)).toContain('"status","=","active"');
    expect(filterOf(back)).toContain('"city","=","Oslo"');
  });

  it('a reload of an address with a grouping groups the list, and the address keeps it', async () => {
    await mountAt(address({ uf__group: BY_STATUS }), OBJECTS, false);
    await waitFor(() => expect(groupQueries.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(groupQueries[groupQueries.length - 1].groupBy).toEqual(['status']);
    expect(JSON.parse(addressParams().get('uf__group')!)).toEqual(BY_STATUS);
  });

  it('CONTROL — an address without list state: no search, no sort, no grouping, and none is written', async () => {
    await mountAt(DATA_SEARCH);
    const q = lastQuery();
    expect(q.$search).toBeUndefined();
    expect(q.$orderby ?? []).toEqual([]);
    expect(groupQueries).toHaveLength(0);
    for (const key of ['uf__search', 'uf__sort', 'uf__group', 'uf__filter']) {
      expect(addressParams().has(key)).toBe(false);
    }
  });

  it('a Filter panel naming a field the object does not declare is refused whole, and leaves the address', async () => {
    await mountAt(address({
      'filter[status]': 'active',
      uf__filter: { logic: 'and', conditions: [{ field: 'ghost', operator: 'equals', value: 'x' }, ...CITY_OSLO.conditions] },
    }));
    for (const q of queries) {
      expect(filterOf(q)).not.toContain('ghost');
      expect(filterOf(q)).not.toContain('Oslo');
    }
    expect(addressParams().has('uf__filter')).toBe(false);
    expect(addressParams().get('filter[status]')).toBe('active');
  });

  it('「Reset」 to the source clears the list\'s search with its address param, and the list stops searching', async () => {
    const trail = JSON.stringify([{ o: 'demo_parent', i: 'P-1', t: 'Launch' }]);
    await mountAt(address({ 'filter[parent]': 'P-1', 'filter[status]': 'active', from: trail, uf__search: 'Glo' }), SOURCE_OBJECTS);
    expect(lastQuery().$search).toBe('Glo');
    const reset = screen.getByTestId('object-data-reset-source') as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    await screen.findByText('Globex', undefined, { timeout: 5000 });
    await settle();
    expect(addressParams().has('uf__search')).toBe(false);
    expect(addressParams().get('filter[parent]')).toBe('P-1');
    expect(addressParams().has('filter[status]')).toBe(false);
    // The list on screen is the address's: no search term left in it.
    expect(lastQuery().$search).toBeUndefined();
    expect(screen.queryByTestId('search-active-keyword')).toBeNull();
    expect((screen.getByTestId('object-data-reset-source') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a sort the reader removes leaves the address, and the list asks for none', async () => {
    await mountAt(address({ 'filter[status]': 'active', uf__sort: [{ field: 'city', order: 'desc' }] }));
    expect(lastQuery().$orderby).toEqual([{ field: 'city', order: 'desc' }]);
    fireEvent.click(await within(screen.getByTestId('list-condition-row')).findByTestId('condition-sort'));
    const row = await screen.findByTestId('sort-builder-row');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove sort' }));
    await settle();
    expect(addressParams().has('uf__sort')).toBe(false);
    expect(lastQuery().$orderby ?? []).toEqual([]);
    // No sort is this page's own: the list offers no 「Reset to default」 for the address's.
    expect(screen.queryByTestId('sort-reset-default')).toBeNull();
  });
});
