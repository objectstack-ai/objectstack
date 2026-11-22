/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ⌘K palette previews the record hit it is on, offers to create a record
 * from what was typed, finds "New OBJECT" entries, and says what Enter does
 * (objectstack#36286).
 *
 * Pinned against the real `CommandPaletteProvider` (opened through its
 * `?palette=1` deep link) over the per-object `find` fanout, with the record
 * preview reading the record through the data source's `findOne`. Where Enter
 * went is read off the router.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

/** The member may read everything and create everything but an invoice. */
const PERMS = {
  isLoaded: true,
  can: (object: string, action: string) => !(object === 'invoice_36286' && action === 'create'),
  cannot: (object: string, action: string) => object === 'invoice_36286' && action === 'create',
  check: () => ({ allowed: true }),
  checkField: () => true,
  getFieldPermissions: () => [],
  getRowFilter: () => undefined,
  getObjectApiOperations: () => undefined,
  roles: [],
  userId: 'u1',
  systemPermissions: undefined,
  hasCapabilities: () => true,
  hasAnyQueue: undefined,
  objectsUsingQueues: undefined,
};
vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePermissions: () => PERMS,
}));

// The preview's key fields draw through `lazy()`: load the detail entry at
// module scope, so its cost is paid at import (ui/AGENTS.md, lazy boundaries).
import '@object-ui/plugin-detail';

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';
import { paletteEnterAction } from './PaletteEnterHint';
import { paletteCreateTargets, palettePrefillField, routeObjectName } from './paletteCreate';
import { paletteCurrentPage } from './PaletteCurrentPage';
import { FavoritesProvider, recordFavoriteItem, type FavoriteItem } from '../context/FavoritesProvider';
import { RecentItemsProvider, useRecentItems } from '../context/RecentItemsProvider';
import { useFavorites } from '../hooks/useFavorites';
import { scopedKey } from '../context/UserStateAdapters';
import { useObjectListFavorite } from '../layout/SidebarItemMenu';

const CUSTOMER = 'customer_36286';
const CONTACT = 'contact_36286';
const INVOICE = 'invoice_36286';

const OBJECTS = [
  {
    name: CUSTOMER,
    label: 'Customer',
    nameField: 'name',
    highlightFields: ['industry', 'phone'],
    fields: {
      name: { type: 'text', label: 'Customer Name' },
      industry: { type: 'text', label: 'Industry' },
      phone: { type: 'text', label: 'Phone' },
    },
  },
  { name: CONTACT, label: 'Contact', nameField: 'full_name', fields: { full_name: { type: 'text', label: 'Full Name' } } },
  { name: INVOICE, label: 'Invoice', nameField: 'subject', fields: { subject: { type: 'text', label: 'Subject' } } },
];

const ROWS: Record<string, Array<Record<string, unknown>>> = {
  [CUSTOMER]: [
    { id: 'C1', name: 'Qingdao Haichen Foods', industry: 'Food processing', phone: '0532-1000' },
    { id: 'C2', name: 'Qingdao Harbour Logistics', industry: 'Logistics', phone: '0532-2000' },
  ],
  [CONTACT]: [],
  [INVOICE]: [],
};

const CRM = {
  name: 'crm',
  label: 'CRM',
  navigation: [
    { id: 'n_contact', type: 'object', objectName: CONTACT, label: 'Contacts' },
    { id: 'n_invoice', type: 'object', objectName: INVOICE, label: 'Invoices' },
    { id: 'n_customer', type: 'object', objectName: CUSTOMER, label: 'Customers' },
  ],
};
const SALES = { name: 'sales', label: 'Sales', navigation: [] };

function metadataValue() {
  return {
    apps: [],
    objects: [],
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async (type: string, name: string) => (type === 'object' ? OBJECTS.find((o) => o.name === name) ?? null : null),
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

function Probe() {
  const location = useLocation();
  return <span data-testid="location" data-path={location.pathname} data-search={location.search} />;
}

function mount(path = `/apps/crm/${CUSTOMER}`) {
  const ds = {
    find: vi.fn(async (name: string, params: { $search?: string }) => ({
      data: (ROWS[name] ?? []).filter((row) =>
        String(row.name ?? '').toLowerCase().includes(String(params?.$search ?? '').toLowerCase()),
      ),
    })),
    findOne: vi.fn(async (name: string, id: string) => (ROWS[name] ?? []).find((row) => row.id === id) ?? null),
  };
  const metadata = metadataValue();
  render(
    <MetadataCtx.Provider value={metadata as never}>
      <MemoryRouter initialEntries={[`${path}?palette=1`]}>
        <CommandPaletteProvider>
          <Probe />
          <CommandPalette apps={[CRM, SALES]} activeApp={CRM} objects={OBJECTS} onAppChange={() => {}} dataSource={ds} />
        </CommandPaletteProvider>
      </MemoryRouter>
    </MetadataCtx.Provider>,
  );
  const input = document.querySelector('[cmdk-input]') as HTMLInputElement | null;
  if (!input) throw new Error('the palette did not open');
  return { ds, input };
}

const type = (input: HTMLInputElement, value: string) => fireEvent.change(input, { target: { value } });
const press = (input: HTMLInputElement, key: string) => fireEvent.keyDown(input, { key });
const pane = () => screen.queryByTestId('palette-preview');
const hint = () => screen.getByTestId('palette-enter-hint').getAttribute('data-enter-action');
const selected = () => document.querySelector('[cmdk-item][data-selected="true"]')?.getAttribute('data-value');
const values = (prefix: string) =>
  Array.from(document.querySelectorAll(`[cmdk-item][data-value^="${prefix}"]`)).map((el) => el.getAttribute('data-value'));
const location = () => {
  const probe = screen.getByTestId('location');
  return `${probe.getAttribute('data-path')}${probe.getAttribute('data-search')}`;
};

async function recordHitsShown(count: number) {
  await waitFor(() => expect(values('record ')).toHaveLength(count), { timeout: 4000 });
}

afterEach(() => cleanup());

describe('objectstack#36286 — a record hit is previewed beside the results', () => {
  it('draws the selected hit read-only: its title and the object\'s declared key fields; Enter opens the record', async () => {
    const { ds, input } = mount();
    type(input, 'haichen');
    await recordHitsShown(1);

    // The palette widens for two halves, and the pane follows the selection.
    expect(document.querySelector('[role="dialog"]')?.className).toContain('sm:max-w-3xl');
    await waitFor(() => expect(pane()?.querySelector('[data-record-preview="readable"]')).not.toBeNull(), { timeout: 4000 });
    expect(pane()).toHaveTextContent('Qingdao Haichen Foods');
    expect(await screen.findByText('Food processing')).toBeInTheDocument();
    expect(pane()).toHaveTextContent('Industry');
    expect(ds.findOne).toHaveBeenCalledWith(CUSTOMER, 'C1');
    expect(hint()).toBe('openRecord');

    press(input, 'Enter');
    expect(location()).toBe(`/apps/crm/${CUSTOMER}/record/C1`);
  });

  it('ArrowDown moves the preview to the second hit, reading only the record it settles on', async () => {
    const { ds, input } = mount();
    type(input, 'qingdao');
    await recordHitsShown(2);
    await waitFor(() => expect(pane()?.getAttribute('data-preview-record')).toBe('C1'), { timeout: 4000 });

    press(input, 'ArrowDown');
    await waitFor(() => expect(pane()?.getAttribute('data-preview-record')).toBe('C2'), { timeout: 4000 });
    await waitFor(() => expect(pane()).toHaveTextContent('Qingdao Harbour Logistics'), { timeout: 4000 });
    expect(pane()).toHaveTextContent('Logistics');
    expect(ds.findOne.mock.calls.map((call) => call[1])).toEqual(['C1', 'C2']);
  });

  it('the pane shows only from a 45rem palette: a container query on the palette frame', async () => {
    const { input } = mount();
    type(input, 'haichen');
    await recordHitsShown(1);
    expect(document.querySelector('[cmdk-root]')?.className).toContain('@container/palette');
    expect(pane()?.className).toMatch(/(^| )hidden( |$)/);
    expect(pane()?.className).toContain('@min-[45rem]/palette:block');
  });

  it('CONTROL: no record hit, no pane and no wide palette', async () => {
    const { input } = mount();
    type(input, 'zhang san');
    await waitFor(() => expect(values('create as ')).not.toHaveLength(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(pane()).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.className).not.toContain('sm:max-w-3xl');
  });
});

describe('objectstack#36286 — "Create \'words\' as OBJECT" below the results', () => {
  it('lists the creatable objects, the page\'s own object first; Enter opens its create form seeded with the words', async () => {
    const { input } = mount();
    type(input, 'Zhang San');
    await waitFor(() => expect(values('create as ')).toEqual([`create as ${CUSTOMER}`, `create as ${CONTACT}`]));
    expect(screen.getByText('Create "Zhang San" as Customer')).toBeInTheDocument();
    // No create grant on invoices: no row offers to create one.
    expect(values('create ').some((value) => value?.includes(INVOICE))).toBe(false);

    expect(selected()).toBe(`create as ${CUSTOMER}`);
    expect(hint()).toBe('create');
    press(input, 'Enter');
    expect(location()).toBe(`/apps/crm/${CUSTOMER}/new?name=Zhang+San`);
  });

  it('on a page of no object, the app\'s navigation order stands', async () => {
    const { input } = mount('/apps/crm');
    type(input, 'Zhang San');
    await waitFor(() => expect(values('create as ')).toEqual([`create as ${CONTACT}`, `create as ${CUSTOMER}`]));
  });

  it('CONTROL: the empty palette offers no create row', async () => {
    mount();
    await act(async () => {});
    expect(values('create ')).toEqual([]);
  });

  it('clearing the query takes the create rows away again', async () => {
    const { input } = mount();
    type(input, 'Zhang San');
    await waitFor(() => expect(values('create as ')).not.toHaveLength(0));
    type(input, '');
    await waitFor(() => expect(values('create ')).toEqual([]));
  });
});

describe('objectstack#36286 — "New OBJECT" entries', () => {
  it('"new" finds one per object the member may create, never one it may not', async () => {
    const { input } = mount();
    type(input, 'new');
    await waitFor(() => expect(values('create new ')).toEqual([`create new ${CUSTOMER}`, `create new ${CONTACT}`]));
    expect(screen.getByText('New Customer')).toBeInTheDocument();
    expect(screen.getByText('New Contact')).toBeInTheDocument();
    expect(screen.queryByText('New Invoice')).toBeNull();
    // The query names the action, not a record called "new".
    expect(values('create as ')).toEqual([]);
  });

  it('an object\'s own name finds its entry; Enter opens its empty create form', async () => {
    const { input } = mount('/apps/crm');
    type(input, 'contact');
    await waitFor(() => expect(values('create new ')).toEqual([`create new ${CONTACT}`]));
    // The other creatable object still takes the words as a record name.
    expect(values('create as ')).toEqual([`create as ${CUSTOMER}`]);
    act(() => {
      fireEvent.click(document.querySelector(`[cmdk-item][data-value="create new ${CONTACT}"]`)!);
    });
    expect(location()).toBe(`/apps/crm/${CONTACT}/new`);
  });
});

describe('objectstack#36286 — the footer says what Enter does', () => {
  it('reads the action off the selected entry\'s kind', () => {
    expect(paletteEnterAction(`record Qingdao Customer ${CUSTOMER} C1`)).toBe('openRecord');
    expect(paletteEnterAction('recent Qingdao C1')).toBe('openRecord');
    expect(paletteEnterAction(`create as ${CUSTOMER}`)).toBe('create');
    expect(paletteEnterAction(`create new ${CUSTOMER}`)).toBe('create');
    expect(paletteEnterAction('app Sales sales')).toBe('switchApp');
    expect(paletteEnterAction('theme dark')).toBe('applyTheme');
    expect(paletteEnterAction(`object Customers ${CUSTOMER}`)).toBe('open');
    expect(paletteEnterAction('search all results full page')).toBe('open');
    expect(paletteEnterAction('')).toBeNull();
  });

  it('an app entry says Switch app', async () => {
    const { input } = mount();
    type(input, 'sales');
    await waitFor(() => expect(selected()).toBe('app Sales sales'));
    expect(hint()).toBe('switchApp');
    expect(screen.getByTestId('palette-enter-hint')).toHaveTextContent('Switch app');
  });
});

describe('objectstack#36286 — which objects a create row offers', () => {
  const byName = new Map(OBJECTS.map((o) => [o.name, o]));
  const names = OBJECTS.map((o) => o.name);

  it('the create action\'s toolbar visibleWhen (fails closed) and disabledWhen hide an object', () => {
    const hidden = { ...OBJECTS[1], userActions: { create: { visibleWhen: 'false' } } };
    const greyed = { ...OBJECTS[0], userActions: { create: { disabledWhen: 'true' } } };
    const map = new Map<string, any>([[CUSTOMER, greyed], [CONTACT, hidden], [INVOICE, OBJECTS[2]]]);
    expect(paletteCreateTargets(names, map, PERMS as never, {}).map((t) => t.objectName)).toEqual([]);
    expect(paletteCreateTargets(names, byName as never, PERMS as never, {}).map((t) => t.objectName)).toEqual([
      CUSTOMER,
      CONTACT,
    ]);
  });

  it('only a writable text title field takes the typed words', () => {
    const base = OBJECTS[1];
    expect(palettePrefillField(base as never, PERMS as never)).toBe('full_name');
    expect(palettePrefillField({ ...base, fields: { full_name: { type: 'lookup' } } } as never, PERMS as never)).toBeUndefined();
    expect(palettePrefillField({ ...base, fields: { full_name: { type: 'text', readonly: true } } } as never, PERMS as never)).toBeUndefined();
    const noCreateField = { ...PERMS, checkField: () => false };
    expect(palettePrefillField(base as never, noCreateField as never)).toBeUndefined();
  });

  it('the route\'s object is read off /apps/APP/OBJECT, only when the app lists it', () => {
    expect(routeObjectName(`/apps/crm/${CUSTOMER}/record/C1`, names)).toBe(CUSTOMER);
    expect(routeObjectName('/apps/crm/dashboard/sales', names)).toBeUndefined();
    expect(routeObjectName('/apps/crm', names)).toBeUndefined();
  });
});

describe('objectstack#36286 — the empty palette leads with the current page\'s entries', () => {
  /** The list's own favorites entry, as `ObjectView`'s ⋮ More reads it. */
  let listFavorite: { isFavorite: boolean } | null = null;
  let favorites: FavoriteItem[] = [];
  function PageProbe({ objectName }: { objectName?: string }) {
    const list = useObjectListFavorite({ appSegment: 'crm', objectName, label: 'Customers' });
    const stored = useFavorites().favorites;
    React.useEffect(() => {
      listFavorite = list;
      favorites = stored;
    });
    return null;
  }
  /** The visit the record page records once its title is known. */
  function SeedVisit({ recordId, title }: { recordId: string; title: string }) {
    const { addRecentItem } = useRecentItems();
    React.useEffect(() => {
      addRecentItem({ id: `record:${CUSTOMER}:${recordId}`, label: title, href: `/apps/crm/${CUSTOMER}/record/${recordId}`, type: 'record' });
    }, [addRecentItem, recordId, title]);
    return null;
  }

  function mountPage(path: string, { visit, listObject }: { visit?: { recordId: string; title: string }; listObject?: string } = {}) {
    const metadata = { ...metadataValue(), apps: [CRM] };
    const ds = { find: vi.fn(async () => ({ data: [] })), findOne: vi.fn(async () => null) };
    const view = render(
      <MetadataCtx.Provider value={metadata as never}>
        <FavoritesProvider>
          <RecentItemsProvider>
            <MemoryRouter initialEntries={[`${path}?palette=1`]}>
              <CommandPaletteProvider>
                <Probe />
                <PageProbe objectName={listObject} />
                {visit && <SeedVisit {...visit} />}
                <CommandPalette apps={[CRM, SALES]} activeApp={CRM} objects={OBJECTS} onAppChange={() => {}} dataSource={ds} />
              </CommandPaletteProvider>
            </MemoryRouter>
          </RecentItemsProvider>
        </FavoritesProvider>
      </MetadataCtx.Provider>,
    );
    return view;
  }
  const input = () => document.querySelector('[cmdk-input]') as HTMLInputElement | null;
  const heading = () => document.querySelector('[cmdk-group-heading]')?.textContent;
  const row = () => screen.queryByTestId('palette-current-page-favorite');

  afterEach(() => {
    localStorage.clear();
    listFavorite = null;
    favorites = [];
  });

  it('on an object\'s list: first, selected, and Enter runs the list\'s own favorites entry', async () => {
    mountPage(`/apps/crm/${CUSTOMER}`, { listObject: CUSTOMER });
    await waitFor(() => expect(row()).not.toBeNull());
    expect(heading()).toBe('Current page');
    expect(row()).toHaveTextContent('Add to favorites');
    await waitFor(() => expect(selected()).toBe(`favorite-add current page list ${CUSTOMER}`));
    expect(hint()).toBe('addFavorite');
    expect(screen.getByTestId('palette-enter-hint')).toHaveTextContent('Add to favorites');
    expect(listFavorite?.isFavorite).toBe(false);

    press(input()!, 'Enter');
    // The page's own entry turned on: the app lists the object, so its navigation entry is pinned.
    await waitFor(() => expect(listFavorite?.isFavorite).toBe(true));
    expect(favorites.map((f) => f.id)).toEqual(['nav:n_customer']);
    expect(location()).toBe(`/apps/crm/${CUSTOMER}`);
    expect(input()).toBeNull();
  });

  it('a named view of the list is the list too', async () => {
    mountPage(`/apps/crm/${CUSTOMER}/view/all`);
    await waitFor(() => expect(row()).not.toBeNull());
    expect(row()?.getAttribute('data-value')).toBe(`favorite-add current page list ${CUSTOMER}`);
  });

  it('on a record page: Enter stars the record, named by the title it was visited under', async () => {
    mountPage(`/apps/crm/${CUSTOMER}/record/C1`, { visit: { recordId: 'C1', title: 'Qingdao Haichen Foods' } });
    await waitFor(() => expect(row()).not.toBeNull());
    expect(heading()).toBe('Current page');
    await waitFor(() => expect(selected()).toBe(`favorite-add current page record ${CUSTOMER}`));

    press(input()!, 'Enter');
    await waitFor(() => expect(favorites).toHaveLength(1));
    // The very entry the record page's star toggles.
    expect(favorites[0]).toMatchObject(recordFavoriteItem('crm', CUSTOMER, 'C1', 'Qingdao Haichen Foods'));
  });

  it('a record already starred offers to take the star off', async () => {
    const starred = { ...recordFavoriteItem('crm', CUSTOMER, 'C1', 'Qingdao Haichen Foods'), favoritedAt: '2026-11-22T00:00:00.000Z' };
    localStorage.setItem(scopedKey('objectui-favorites', 'u1'), JSON.stringify([starred]));
    mountPage(`/apps/crm/${CUSTOMER}/record/C1`);
    await waitFor(() => expect(row()).toHaveTextContent('Remove from favorites'));
    await waitFor(() => expect(hint()).toBe('removeFavorite'));
    press(input()!, 'Enter');
    await waitFor(() => expect(favorites).toEqual([]));
  });

  it('typing takes the group away; clearing brings it back', async () => {
    mountPage(`/apps/crm/${CUSTOMER}`);
    await waitFor(() => expect(row()).not.toBeNull());
    type(input()!, 'zhang');
    await waitFor(() => expect(row()).toBeNull());
    type(input()!, '');
    await waitFor(() => expect(row()).not.toBeNull());
  });

  it.each([
    ['the app\'s landing', '/apps/crm'],
    ['a dashboard', '/apps/crm/dashboard/sales'],
    ['the full search page', '/apps/crm/search'],
    ['a create form', `/apps/crm/${CUSTOMER}/new`],
    ['an object the console does not serve', '/apps/crm/no_such_object'],
  ])('CONTROL: no group on %s', async (_name, path) => {
    mountPage(path);
    await waitFor(() => expect(input()).not.toBeNull());
    await act(async () => {});
    expect(row()).toBeNull();
    expect(screen.queryByText('Current page')).toBeNull();
  });

  it('reads the page off the address, by the console\'s own route table', () => {
    const served = (name: string) => name === CUSTOMER;
    expect(paletteCurrentPage(`/apps/crm/${CUSTOMER}`, served)).toEqual({ kind: 'list', appSegment: 'crm', objectName: CUSTOMER });
    expect(paletteCurrentPage(`/apps/crm/${CUSTOMER}/view/all`, served)?.kind).toBe('list');
    expect(paletteCurrentPage(`/apps/crm/${CUSTOMER}/record/C1/page/print`, served)).toEqual({
      kind: 'record',
      appSegment: 'crm',
      objectName: CUSTOMER,
      recordId: 'C1',
    });
    expect(paletteCurrentPage(`/apps/crm/${CUSTOMER}/record/C1/edit`, served)).toBeNull();
    expect(paletteCurrentPage(`/apps/crm/${CUSTOMER}/data`, served)).toBeNull();
    expect(paletteCurrentPage('/apps/crm/reports', served)).toBeNull();
    expect(paletteCurrentPage('/home', served)).toBeNull();
  });

  it('the footer reads the favorites rows\' kind', () => {
    expect(paletteEnterAction(`favorite-add current page list ${CUSTOMER}`)).toBe('addFavorite');
    expect(paletteEnterAction(`favorite-remove current page record ${CUSTOMER}`)).toBe('removeFavorite');
  });
});
