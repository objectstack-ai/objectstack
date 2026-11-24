/**
 * objectstack#35955 — the list LAYOUT is this browser's alone: the tab order,
 * and per view the column widths and the row height.
 *
 *   - A stored value keeps only what the entry declares, well formed: a
 *     malformed piece, and any part an earlier Console kept (a sort, filters,
 *     a column order, hidden or added columns), is dropped.
 *   - A patch sets a part beside the others; `null` clears only its own part,
 *     and a view left with nothing is removed.
 *   - The hook writes localStorage and nothing else: no request leaves the
 *     page, and every reader of the same object sees the write at once.
 *   - The entry is the signed-in reader's: with nobody signed in there is no
 *     key, and nothing is read or written.
 *   - The keys an earlier Console wrote list state under are removed once,
 *     and never read: their values are not carried over.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  clearRetiredListStateKeys,
  listLayoutStorageKey,
  patchViewLayout,
  readListLayout,
  resetListLayoutStoreForTests,
  sanitizeObjectListLayout,
  setViewOrderLayout,
  useObjectListLayout,
  writeListLayout,
} from './listLayoutStore';

const { session } = vi.hoisted(() => ({ session: { userId: 'u1' as string | null } }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: session.userId ? { id: session.userId, name: 'Ada' } : null, activeOrganization: null }),
}));

beforeEach(() => {
  session.userId = 'u1';
  localStorage.clear();
  resetListLayoutStoreForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the entry keeps only what it declares (objectstack#35955)', () => {
  it('keeps widths, a spec row height and the tab order; drops malformed pieces and every retired part', () => {
    expect(sanitizeObjectListLayout({
      viewOrder: ['a', 2, '', 'b'],
      perView: {
        v1: { widths: { name: 200, bad: 'wide', zero: 0 }, rowHeight: 'compact', sort: [{ field: 'name', order: 'desc' }] },
        v2: { rowHeight: 'enormous', filters: { conditions: [{ field: 'x' }] }, hiddenFields: ['x'] },
        v3: 'not an object',
        v4: { columnState: { order: ['name'], widths: { name: 120 } } },
      },
      unknown: true,
    })).toEqual({
      viewOrder: ['a', 'b'],
      perView: { v1: { widths: { name: 200 }, rowHeight: 'compact' } },
    });
  });

  it('answers `{}` for anything that is not an object', () => {
    expect(sanitizeObjectListLayout(null)).toEqual({});
    expect(sanitizeObjectListLayout([1, 2])).toEqual({});
    expect(sanitizeObjectListLayout('x')).toEqual({});
  });
});

describe('a view\'s patch (objectstack#35955)', () => {
  it('sets each part beside the other, and `null` clears only its own part', () => {
    let state = patchViewLayout({}, 'v1', { widths: { name: 180 } });
    state = patchViewLayout(state, 'v1', { rowHeight: 'tall' });
    expect(state).toEqual({ perView: { v1: { widths: { name: 180 }, rowHeight: 'tall' } } });
    state = patchViewLayout(state, 'v1', { rowHeight: null });
    expect(state).toEqual({ perView: { v1: { widths: { name: 180 } } } });
  });

  it('drops a view left with nothing, and an empty width map clears the widths', () => {
    const state = patchViewLayout({ viewOrder: ['v1'], perView: { v1: { widths: { name: 180 } } } }, 'v1', { widths: {} });
    expect(state).toEqual({ viewOrder: ['v1'] });
  });

  it('sets the tab order, and an empty list clears it', () => {
    const state = setViewOrderLayout({}, ['b', 'a']);
    expect(state).toEqual({ viewOrder: ['b', 'a'] });
    expect(setViewOrderLayout(state, [])).toEqual({});
  });
});

describe('the hook keeps the layout in this browser only (objectstack#35955)', () => {
  it('a width, a row height and a tab order are written to localStorage, per user and object, and send no request', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { result } = renderHook(() => useObjectListLayout('account'));
    act(() => result.current.patchView('account.all', { widths: { name: 240 } }));
    act(() => result.current.patchView('account.all', { rowHeight: 'short' }));
    act(() => result.current.setViewOrder(['account.mine', 'account.all']));

    expect(result.current.layout).toEqual({
      viewOrder: ['account.mine', 'account.all'],
      perView: { 'account.all': { widths: { name: 240 }, rowHeight: 'short' } },
    });
    expect(JSON.parse(localStorage.getItem('list-layout:u1:account')!)).toEqual(result.current.layout);
    expect(listLayoutStorageKey('u1', 'account')).toBe('list-layout:u1:account');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('every reader of the same object sees a write at once; another object is untouched', () => {
    const a = renderHook(() => useObjectListLayout('account'));
    const b = renderHook(() => useObjectListLayout('account'));
    const other = renderHook(() => useObjectListLayout('contact'));
    act(() => a.result.current.patchView('account.all', { widths: { name: 300 } }));
    expect(b.result.current.layout).toEqual({ perView: { 'account.all': { widths: { name: 300 } } } });
    expect(other.result.current.layout).toEqual({});
  });

  it('clearing the last part removes the entry', () => {
    const { result } = renderHook(() => useObjectListLayout('account'));
    act(() => result.current.patchView('account.all', { rowHeight: 'tall' }));
    act(() => result.current.patchView('account.all', { rowHeight: null }));
    expect(localStorage.getItem('list-layout:u1:account')).toBeNull();
    expect(result.current.layout).toEqual({});
  });

  it('with nobody signed in there is no entry: the layout is `{}` and a change writes nothing', () => {
    session.userId = null;
    expect(listLayoutStorageKey(null, 'account')).toBeNull();
    expect(listLayoutStorageKey('u1', '')).toBeNull();
    const { result } = renderHook(() => useObjectListLayout('account'));
    act(() => result.current.patchView('account.all', { widths: { name: 240 } }));
    act(() => result.current.setViewOrder(['account.mine']));
    expect(result.current.layout).toEqual({});
    expect(Object.keys(localStorage).filter((k) => k.startsWith('list-layout'))).toEqual([]);
    writeListLayout(undefined, 'account', { viewOrder: ['account.mine'] });
    expect(Object.keys(localStorage).filter((k) => k.startsWith('list-layout'))).toEqual([]);
  });

  it('reads and writes outside the hook through the same key', () => {
    writeListLayout('u2', 'deal', { viewOrder: ['deal.won'] });
    expect(readListLayout('u2', 'deal')).toEqual({ viewOrder: ['deal.won'] });
    expect(readListLayout('u1', 'deal')).toEqual({});
  });
});

describe('the keys an earlier Console wrote are removed, never read (objectstack#35955)', () => {
  const seedRetired = () => {
    localStorage.setItem('list-state:u1:account', JSON.stringify({ viewOrder: ['account.mine'], perView: { 'account.all': { columnState: { widths: { name: 400 } }, rowHeight: 'tall' } } }));
    localStorage.setItem('list-filters:u1:account:account.all', JSON.stringify({ search: 'acme' }));
    localStorage.setItem('viewOrder:account', JSON.stringify(['account.mine']));
    localStorage.setItem('objectui-locale', 'de');
    localStorage.setItem('list-layout:u1:contact', JSON.stringify({ viewOrder: ['contact.all'] }));
  };

  it('the sweep removes every retired key and keeps every other one', () => {
    seedRetired();
    clearRetiredListStateKeys();
    expect(Object.keys(localStorage).sort()).toEqual(['list-layout:u1:contact', 'objectui-locale']);
  });

  it('the first hook of the page load sweeps them, and what they held is not carried over', () => {
    seedRetired();
    const { result } = renderHook(() => useObjectListLayout('account'));
    expect(result.current.layout).toEqual({});
    expect(localStorage.getItem('list-state:u1:account')).toBeNull();
    expect(localStorage.getItem('list-filters:u1:account:account.all')).toBeNull();
    expect(localStorage.getItem('viewOrder:account')).toBeNull();
    expect(localStorage.getItem('objectui-locale')).toBe('de');
  });
});
