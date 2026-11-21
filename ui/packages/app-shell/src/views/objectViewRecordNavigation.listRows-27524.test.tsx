// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27524, Target 7 — a page a list opens counts and steps through
 * the rows that list showed. The list hands them along in the page's `from`
 * state whenever the record is one of them (the record's name — the one way a
 * list opens a page since objectstack#35854 — or a record link), with the
 * count the list's query matched as `total` (the counter's M). A record the
 * list does not show gets the origin alone, so its page draws no counter.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, useSearchParams, type Location } from 'react-router-dom';

import { useObjectViewRecordNavigation } from './objectViewRecordNavigation';

const ROWS = [{ id: 'r-1' }, { id: 'r-2' }, { id: 'r-3' }];
const LIST = { pathname: '/apps/crm/crm_lead', search: '?view=all', state: null, hash: '', key: 'k' } as Location;

function mount(navigation?: { mode: 'page' | 'drawer' }, total?: number) {
  const navigate = vi.fn();
  const { result } = renderHook(() =>
    useObjectViewRecordNavigation({
      activeView: { id: 'all', name: 'all', label: 'All leads' } as never,
      objectDef: { name: 'crm_lead', label: 'Lead', fields: {}, ...(navigation ? { navigation } : {}) } as never,
      objects: [{ name: 'crm_lead', label: 'Lead' }] as never,
      appName: 'crm',
      viewId: undefined,
      searchParams: new URLSearchParams('view=all'),
      setSearchParams: vi.fn(),
      location: LIST,
      navigate,
      routerRootHref: '/',
      servedViews: { views: [], objects: [] } as never,
      viewLabel: (_object: string, _view: string, fallback: string) => fallback,
      unlabelledViewText: 'Untitled view',
      language: 'en',
      // A desktop console: on a phone every record opens as a page.
      phone: false,
    }),
    { wrapper: ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={['/apps/crm/crm_lead?view=all']}>{children}</MemoryRouter> },
  );
  act(() => result.current.handleListRowsChange(ROWS));
  if (total !== undefined) act(() => result.current.handleListTotalChange(total));
  return { result, navigate };
}

const lastState = (navigate: ReturnType<typeof vi.fn>) => navigate.mock.calls.at(-1)![1].state;

describe('a page the list opens carries the list\'s rows (objectstack#27524, Target 7)', () => {
  it('the record\'s name: the origin, its view\'s name and the rows shown', () => {
    const { result, navigate } = mount();
    act(() => result.current.handleRowClick({ id: 'r-2' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toBe('record/r-2');
    expect(lastState(navigate)).toEqual({
      from: { pathname: '/apps/crm/crm_lead?view=all', label: 'All leads', siblings: ['r-1', 'r-2', 'r-3'] },
    });
  });

  it('objectstack#35854 — with the list\'s matched count reported, the origin carries it as the total', () => {
    const { result, navigate } = mount(undefined, 40);
    act(() => result.current.handleRowClick({ id: 'r-2' }));
    expect(lastState(navigate).from).toEqual({
      pathname: '/apps/crm/crm_lead?view=all', label: 'All leads', siblings: ['r-1', 'r-2', 'r-3'], total: 40,
    });
  });

  it('objectstack#35854 — a declared `navigation.mode` changes nothing: the name still opens the page', () => {
    for (const mode of ['page', 'drawer'] as const) {
      const { result, navigate } = mount({ mode });
      act(() => result.current.handleRowClick({ id: 'r-1' }));
      expect(navigate.mock.calls.at(-1)![0]).toBe('record/r-1');
    }
  });

  it('control: a record the list does not show gets the origin alone', () => {
    const { result, navigate } = mount();
    act(() => result.current.handleRowClick({ id: 'r-9' }));
    expect(lastState(navigate)).toEqual({ from: { pathname: '/apps/crm/crm_lead?view=all', label: 'All leads' } });
  });
});

describe('a lookup chip opens the record it names in the list\'s drawer (objectstack#36015)', () => {
  const OBJECTS = [{ name: 'crm_lead', label: 'Lead' }, { name: 'crm_account', label: 'Account' }];

  function mountDrawer(search: string) {
    const navigate = vi.fn();
    const setSearchParams = vi.fn();
    const { result } = renderHook(() =>
      useObjectViewRecordNavigation({
        activeView: { id: 'all', name: 'all', label: 'All leads' } as never,
        objectDef: { name: 'crm_lead', label: 'Lead', fields: {} } as never,
        objects: OBJECTS as never,
        appName: 'crm',
        viewId: undefined,
        searchParams: new URLSearchParams(search),
        setSearchParams,
        location: { ...LIST, search: `?${search}` },
        navigate,
        routerRootHref: '/',
        servedViews: { views: [], objects: [] } as never,
        viewLabel: (_object: string, _view: string, fallback: string) => fallback,
        unlabelledViewText: 'Untitled view',
        language: 'en',
        phone: false,
      }),
      { wrapper: ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[`/apps/crm/crm_lead?${search}`]}>{children}</MemoryRouter> },
    );
    act(() => result.current.handleListRowsChange(ROWS));
    const lastParams = () => String(setSearchParams.mock.calls.at(-1)![0]);
    return { result, navigate, lastParams, setSearchParams };
  }

  it('another object\'s record: its id and its object in the URL, beside the list\'s own params', () => {
    const { result, lastParams } = mountDrawer('view=all');
    act(() => result.current.handleOpenReferencedRecord('crm_account', 'a7'));
    expect(lastParams()).toBe('view=all&recordId=a7&recordObject=crm_account');
  });

  it('the record the drawer already shows is not pushed again, so one Back still closes it', () => {
    const foreign = mountDrawer('view=all&recordId=a7&recordObject=crm_account');
    act(() => foreign.result.current.handleOpenReferencedRecord('crm_account', 'a7'));
    const own = mountDrawer('view=all&recordId=r-2');
    act(() => own.result.current.handleOpenReferencedRecord('crm_lead', 'r-2'));
    expect(foreign.setSearchParams).not.toHaveBeenCalled();
    expect(own.setSearchParams).not.toHaveBeenCalled();
    // The same id under another object is another record.
    act(() => foreign.result.current.handleOpenReferencedRecord('crm_lead', 'a7'));
    expect(foreign.lastParams()).toBe('view=all&recordId=a7');
  });

  it('in a router: a chip opened twice (a double-click) leaves one history entry, and one Back closes the drawer', () => {
    // The console's declarative router pushes on every navigate, the same URL included.
    function useRouted() {
      const [searchParams, setSearchParams] = useSearchParams();
      const location = useLocation();
      const navigate = useNavigate();
      const nav = useObjectViewRecordNavigation({
        activeView: { id: 'all', name: 'all', label: 'All leads' } as never,
        objectDef: { name: 'crm_lead', label: 'Lead', fields: {} } as never,
        objects: OBJECTS as never,
        appName: 'crm',
        viewId: undefined,
        searchParams,
        setSearchParams,
        location,
        navigate,
        routerRootHref: '/',
        servedViews: { views: [], objects: [] } as never,
        viewLabel: (_object: string, _view: string, fallback: string) => fallback,
        unlabelledViewText: 'Untitled view',
        language: 'en',
        phone: false,
      });
      return { nav, search: location.search, back: () => navigate(-1) };
    }
    const { result } = renderHook(useRouted, {
      wrapper: ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={['/apps/crm/crm_lead?view=all']}>{children}</MemoryRouter>,
    });
    act(() => result.current.nav.handleListRowsChange(ROWS));
    act(() => result.current.nav.handleOpenReferencedRecord('crm_account', 'a7'));
    act(() => result.current.nav.handleOpenReferencedRecord('crm_account', 'a7'));
    expect(result.current.search).toBe('?view=all&recordId=a7&recordObject=crm_account');
    act(() => result.current.back());
    expect(result.current.search).toBe('?view=all');
  });

  it('a record of the listed object opens as the name cell\'s icon opens it, with no object param', () => {
    const { result, lastParams } = mountDrawer('view=all&recordId=a7&recordObject=crm_account');
    act(() => result.current.handleOpenReferencedRecord('crm_lead', 'r-2'));
    expect(lastParams()).toBe('view=all&recordId=r-2');
  });

  it('the drawer\'s root is that record, with no sibling set; an object the console does not know opens nothing', () => {
    expect(mountDrawer('recordId=a7&recordObject=crm_account').result.current.drawerRoot).toEqual({ objectName: 'crm_account', recordId: 'a7' });
    expect(mountDrawer('recordId=a7&recordObject=crm_unknown').result.current.drawerRoot).toBeNull();
    // The listed object's row keeps its sibling set.
    expect(mountDrawer('recordId=r-2').result.current.drawerRoot).toEqual({ objectName: 'crm_lead', recordId: 'r-2', siblings: ['r-1', 'r-2', 'r-3'] });
  });

  it('closing the drawer drops both params; its full-page button opens that object\'s page', () => {
    const { result, navigate, lastParams } = mountDrawer('view=all&recordId=a7&recordObject=crm_account');
    act(() => result.current.handleDrawerClose());
    expect(lastParams()).toBe('view=all');
    act(() => result.current.handleOpenAsPage([{ objectName: 'crm_account', recordId: 'a7' }]));
    expect(navigate).toHaveBeenLastCalledWith('/apps/crm/crm_account/record/a7');
  });
});
