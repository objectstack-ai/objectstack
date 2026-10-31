// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27524, Target 7 — a page a list opens counts and steps through
 * the rows that list showed. The list hands them along: in the page's `from`
 * state whenever the record is one of them (a row click on an object whose
 * rows open as pages, a record link), and in the ↗'s way back to the pane as
 * well (`recordDrawerReturnState`). A record the list does not show gets the
 * origin alone, so its page draws no counter.
 */

import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, type Location } from 'react-router-dom';

import { useObjectViewRecordNavigation } from './objectViewRecordNavigation';

const ROWS = [{ id: 'r-1' }, { id: 'r-2' }, { id: 'r-3' }];
const LIST = { pathname: '/apps/crm/crm_lead', search: '?view=all', state: null, hash: '', key: 'k' } as Location;

function mount(navigation?: { mode: 'page' | 'drawer' }) {
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
      recordOpenPreference: 'object' as never,
    }),
    { wrapper: ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={['/apps/crm/crm_lead?view=all']}>{children}</MemoryRouter> },
  );
  act(() => result.current.handleListRowsChange(ROWS));
  return { result, navigate };
}

const lastState = (navigate: ReturnType<typeof vi.fn>) => navigate.mock.calls.at(-1)![1].state;

describe('a page the list opens carries the list\'s rows (objectstack#27524, Target 7)', () => {
  it('a row that opens as a page: the origin, its view\'s name and the rows shown', () => {
    const { result, navigate } = mount({ mode: 'page' });
    act(() => result.current.handleRowClick({ id: 'r-2' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toBe('record/r-2');
    expect(lastState(navigate)).toEqual({
      from: { pathname: '/apps/crm/crm_lead?view=all', label: 'All leads', siblings: ['r-1', 'r-2', 'r-3'] },
    });
  });

  it('control: a record the list does not show gets the origin alone', () => {
    const { result, navigate } = mount({ mode: 'page' });
    act(() => result.current.handleRowClick({ id: 'r-9' }));
    expect(lastState(navigate)).toEqual({ from: { pathname: '/apps/crm/crm_lead?view=all', label: 'All leads' } });
  });

  it('the row\'s ↗: the rows go in the way back to the pane, and in the origin', () => {
    const { result, navigate } = mount();
    act(() => result.current.handleOpenRowAsPage('r-3'));
    const state = lastState(navigate);
    expect(state.from.siblings).toEqual(['r-1', 'r-2', 'r-3']);
    expect(state.recordDrawerReturn.path).toEqual([{ objectName: 'crm_lead', recordId: 'r-3', siblings: ['r-1', 'r-2', 'r-3'] }]);
    expect(state.recordDrawerReturn.search).toBe('?view=all&recordId=r-3');
  });
});
