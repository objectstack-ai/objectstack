/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The nav pins keep the user's order in the favorites store (objectui#12059).
 *
 * The sidebar's pinned section is the one place a user orders entries, and its
 * order is the order of the `type: 'nav'` favorites in the stored list, so it
 * syncs with the pins through the same `UserDataAdapter` row. A new pin joins
 * the end (a content favorite still leads, as before); `reorderNavPins` puts
 * the named pins in a new order in the places they already hold, so a pin it
 * does not name and every content favorite stay put.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'user-1' }, isAuthenticated: true, isLoading: false }),
}));

import { FavoritesProvider, useFavorites, type FavoriteItem } from '../FavoritesProvider';
import { UserStateAdaptersProvider } from '../UserStateAdapters';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <UserStateAdaptersProvider>
      <FavoritesProvider>{children}</FavoritesProvider>
    </UserStateAdaptersProvider>
  );
}

const STORE = 'objectui-favorites:u:user-1';

const navPin = (navId: string, favoritedAt = '2026-10-01T00:00:00.000Z'): FavoriteItem => ({
  id: `nav:${navId}`,
  label: navId,
  href: '',
  type: 'nav',
  navId,
  pinned: true,
  favoritedAt,
});
const record = (id: string): FavoriteItem => ({
  id,
  label: id,
  href: `/r/${id}`,
  type: 'record',
  favoritedAt: '2026-10-01T00:00:00.000Z',
});

const ids = (items: FavoriteItem[]) => items.map((f) => f.id);
const stored = () => ids(JSON.parse(localStorage.getItem(STORE) ?? '[]'));

beforeEach(() => {
  localStorage.clear();
});

describe('objectui#12059 — nav pins keep the user’s order in the favorites store', () => {
  it('a new nav pin joins the end of the pinned order; a content favorite still leads', () => {
    localStorage.setItem(STORE, JSON.stringify([navPin('a'), record('r1'), navPin('b')]));
    const { result } = renderHook(() => useFavorites(), { wrapper });

    act(() => {
      result.current.addFavorite({ id: 'nav:c', label: 'c', href: '', type: 'nav', navId: 'c', pinned: true });
    });
    expect(ids(result.current.favorites)).toEqual(['nav:a', 'r1', 'nav:b', 'nav:c']);
    expect([...result.current.pinnedNavIds]).toEqual(['a', 'b', 'c']);

    // Control: a content favorite is still put first.
    act(() => {
      result.current.addFavorite({ id: 'r2', label: 'r2', href: '/r/r2', type: 'record' });
    });
    expect(ids(result.current.favorites)[0]).toBe('r2');
  });

  it('reorderNavPins puts the named pins in order, in their own places, and persists it', () => {
    localStorage.setItem(
      STORE,
      JSON.stringify([navPin('a'), record('r1'), navPin('other_app'), navPin('b'), navPin('c')]),
    );
    const { result } = renderHook(() => useFavorites(), { wrapper });

    act(() => result.current.reorderNavPins(['c', 'a', 'b']));

    // `other_app` is not named, so it and the record keep their places; the
    // three named pins fill the places they held, in the new order.
    const expected = ['nav:c', 'r1', 'nav:other_app', 'nav:a', 'nav:b'];
    expect(ids(result.current.favorites)).toEqual(expected);
    expect([...result.current.pinnedNavIds]).toEqual(['c', 'other_app', 'a', 'b']);
    expect(stored()).toEqual(expected);
  });

  it('an id with no nav pin is ignored, and an order that moves nothing writes nothing', () => {
    const initial = [navPin('a'), navPin('b')];
    localStorage.setItem(STORE, JSON.stringify(initial));
    const { result } = renderHook(() => useFavorites(), { wrapper });
    const before = result.current.favorites;

    act(() => result.current.reorderNavPins(['ghost', 'a', 'b']));
    expect(result.current.favorites).toBe(before);

    // Lit control: the same call with the order swapped does move them.
    act(() => result.current.reorderNavPins(['b', 'ghost', 'a']));
    expect(ids(result.current.favorites)).toEqual(['nav:b', 'nav:a']);
  });

  it('at the cap, a new pin still joins the end and the earliest-pinned one rolls off', () => {
    const full = Array.from({ length: 20 }, (_, i) =>
      navPin(`n${i}`, `2026-10-01T00:00:${String(59 - i).padStart(2, '0')}.000Z`),
    );
    // n19 was pinned earliest (…:00:40), though it sits last in the order.
    localStorage.setItem(STORE, JSON.stringify(full));
    const { result } = renderHook(() => useFavorites(), { wrapper });

    act(() => {
      result.current.addFavorite({ id: 'nav:new', label: 'new', href: '', type: 'nav', navId: 'new', pinned: true });
    });

    const pinnedOrder = [...result.current.pinnedNavIds];
    expect(pinnedOrder).toHaveLength(20);
    expect(pinnedOrder.at(-1)).toBe('new');
    expect(pinnedOrder).not.toContain('n19');
    expect(pinnedOrder.slice(0, 19)).toEqual(Array.from({ length: 19 }, (_, i) => `n${i}`));
  });
});
