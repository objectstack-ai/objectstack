/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock useAuth before importing modules that consume it.
const mockUser = { current: { id: 'user-1', name: 'Alice', email: 'a@x' } as any | null };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: mockUser.current, isAuthenticated: !!mockUser.current, isLoading: false }),
}));

// Imported after the mock is set up.
import {
  FavoritesProvider,
  useFavorites,
} from '../FavoritesProvider';
import {
  UserStateAdaptersProvider,
  useAttachUserStateAdapters,
  type UserDataAdapter,
} from '../UserStateAdapters';
import type { FavoriteItem } from '../FavoritesProvider';

function makeAdapter(initial: FavoriteItem[] = []): UserDataAdapter<FavoriteItem> & {
  loadMock: ReturnType<typeof vi.fn>;
  saveMock: ReturnType<typeof vi.fn>;
} {
  const loadMock = vi.fn().mockResolvedValue(initial);
  const saveMock = vi.fn().mockResolvedValue(undefined);
  return {
    load: loadMock,
    save: saveMock,
    loadMock,
    saveMock,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <UserStateAdaptersProvider>
      <FavoritesProvider>{children}</FavoritesProvider>
    </UserStateAdaptersProvider>
  );
}

// Helper hook combining attach + favorites so tests can drive both.
function useTestHarness() {
  const attach = useAttachUserStateAdapters();
  const favs = useFavorites();
  return { attach, favs };
}

describe('FavoritesProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser.current = { id: 'user-1', name: 'Alice', email: 'a@x' } as any;
    vi.useRealTimers();
  });

  it('hydrates synchronously from user-scoped localStorage on mount', () => {
    const seeded: FavoriteItem[] = [
      { id: 'object:contact', label: 'Contact', href: '/c', type: 'object', favoritedAt: '2024-01-01' },
    ];
    localStorage.setItem('objectui-favorites:u:user-1', JSON.stringify(seeded));

    const { result } = renderHook(() => useFavorites(), { wrapper });

    expect(result.current.favorites).toEqual(seeded);
  });

  it('writes mutations through to user-scoped localStorage', () => {
    const { result } = renderHook(() => useFavorites(), { wrapper });

    act(() => {
      result.current.addFavorite({
        id: 'object:order',
        label: 'Order',
        href: '/o',
        type: 'object',
      });
    });

    const stored = JSON.parse(localStorage.getItem('objectui-favorites:u:user-1') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 'object:order' });
    // unscoped key must not be polluted
    expect(localStorage.getItem('objectui-favorites')).toBeNull();
  });

  it('toggleFavorite adds and removes an item', () => {
    const { result } = renderHook(() => useFavorites(), { wrapper });
    const item = { id: 'x', label: 'X', href: '/x', type: 'object' as const };

    act(() => result.current.toggleFavorite(item));
    expect(result.current.isFavorite('x')).toBe(true);

    act(() => result.current.toggleFavorite(item));
    expect(result.current.isFavorite('x')).toBe(false);
  });

  it('addFavorite is idempotent for the same id', () => {
    const { result } = renderHook(() => useFavorites(), { wrapper });
    const item = { id: 'x', label: 'X', href: '/x', type: 'object' as const };

    act(() => result.current.addFavorite(item));
    act(() => result.current.addFavorite(item));

    expect(result.current.favorites).toHaveLength(1);
  });

  it('caps favorites at 20', () => {
    const { result } = renderHook(() => useFavorites(), { wrapper });

    act(() => {
      for (let i = 0; i < 25; i++) {
        result.current.addFavorite({
          id: `item-${i}`,
          label: `Item ${i}`,
          href: `/i/${i}`,
          type: 'object',
        });
      }
    });

    expect(result.current.favorites).toHaveLength(20);
  });

  it('hydrates from adapter and overrides localStorage state', async () => {
    localStorage.setItem(
      'objectui-favorites:u:user-1',
      JSON.stringify([{ id: 'local', label: 'L', href: '/l', type: 'object', favoritedAt: 't' }]),
    );
    const remote: FavoriteItem[] = [
      { id: 'remote', label: 'R', href: '/r', type: 'dashboard', favoritedAt: 't' },
    ];
    const adapter = makeAdapter(remote);

    const { result } = renderHook(() => useTestHarness(), { wrapper });

    // Initial render reflects localStorage.
    expect(result.current.favs.favorites.map(f => f.id)).toEqual(['local']);

    act(() => {
      result.current.attach('favorites', adapter);
    });

    await waitFor(() => {
      expect(result.current.favs.favorites.map(f => f.id)).toEqual(['remote']);
    });
    expect(adapter.loadMock).toHaveBeenCalled();
    // Backend hydration is mirrored to localStorage.
    expect(JSON.parse(localStorage.getItem('objectui-favorites:u:user-1') || '[]')).toEqual(remote);
  });

  it('drops malformed remote items during hydration', async () => {
    const adapter = makeAdapter([
      { id: 'ok', label: 'OK', href: '/ok', type: 'object', favoritedAt: 't' },
      // @ts-expect-error testing runtime sanitization
      { label: 'no-id' },
      // `as unknown as FavoriteItem`, not `as any`: an `any` element collapses
      // the whole array literal's element type to `any`, which made the
      // `@ts-expect-error` above suppress nothing (TS2578) — the malformed item
      // it is documenting was no longer a type error at all (objectui#4040).
      null as unknown as FavoriteItem,
    ]);

    const { result } = renderHook(() => useTestHarness(), { wrapper });

    act(() => result.current.attach('favorites', adapter));

    await waitFor(() => {
      expect(result.current.favs.favorites.map(f => f.id)).toEqual(['ok']);
    });
  });

  it('debounces adapter.save() across a burst of mutations', async () => {
    const adapter = makeAdapter([]);
    const { result } = renderHook(() => useTestHarness(), { wrapper });

    act(() => result.current.attach('favorites', adapter));
    // Wait for initial hydration.
    await waitFor(() => expect(adapter.loadMock).toHaveBeenCalled());
    adapter.saveMock.mockClear();

    act(() => {
      result.current.favs.addFavorite({ id: 'a', label: 'A', href: '/a', type: 'object' });
      result.current.favs.addFavorite({ id: 'b', label: 'B', href: '/b', type: 'object' });
      result.current.favs.addFavorite({ id: 'c', label: 'C', href: '/c', type: 'object' });
    });

    // Before debounce window: no save calls yet.
    expect(adapter.saveMock).not.toHaveBeenCalled();

    await waitFor(() => expect(adapter.saveMock).toHaveBeenCalled(), { timeout: 1500 });
    // Coalesces 3 mutations into ≤1 save (the last payload wins).
    expect(adapter.saveMock).toHaveBeenCalledTimes(1);
    const persisted = adapter.saveMock.mock.calls[0][0] as FavoriteItem[];
    expect(persisted.map(f => f.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns a no-op when used outside a provider (graceful fallback)', () => {
    const { result } = renderHook(() => useFavorites());
    expect(result.current.favorites).toEqual([]);
    expect(() => result.current.addFavorite({ id: 'x', label: 'X', href: '/x', type: 'object' })).not.toThrow();
    expect(result.current.isFavorite('x')).toBe(false);
    expect(result.current.isPinned('x')).toBe(false);
    expect(result.current.pinnedNavIds.size).toBe(0);
    expect(() => result.current.setPinned('x', true)).not.toThrow();
  });

  it('syncs across tabs via the window storage event', async () => {
    const { result } = renderHook(() => useFavorites(), { wrapper });

    expect(result.current.favorites).toEqual([]);

    const incoming: FavoriteItem[] = [
      { id: 'remote', label: 'R', href: '/r', type: 'object', favoritedAt: 't' },
    ];

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'objectui-favorites:u:user-1',
          newValue: JSON.stringify(incoming),
          storageArea: localStorage,
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.favorites.map(f => f.id)).toEqual(['remote']);
    });
  });

  it('ignores storage events for unrelated keys', () => {
    const { result } = renderHook(() => useFavorites(), { wrapper });
    act(() => {
      result.current.addFavorite({ id: 'keep', label: 'K', href: '/k', type: 'object' });
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'some-other-key',
          newValue: JSON.stringify([]),
          storageArea: localStorage,
        }),
      );
    });

    expect(result.current.favorites.map(f => f.id)).toEqual(['keep']);
  });

  it('isolates state by user.id via scoped storage keys', () => {
    mockUser.current = { id: 'user-A' } as any;
    localStorage.setItem(
      'objectui-favorites:u:user-A',
      JSON.stringify([{ id: 'A', label: 'A', href: '/a', type: 'object', favoritedAt: 't' }]),
    );
    localStorage.setItem(
      'objectui-favorites:u:user-B',
      JSON.stringify([{ id: 'B', label: 'B', href: '/b', type: 'object', favoritedAt: 't' }]),
    );

    const { result, unmount } = renderHook(() => useFavorites(), { wrapper });
    expect(result.current.favorites.map(f => f.id)).toEqual(['A']);
    unmount();

    mockUser.current = { id: 'user-B' } as any;
    const { result: result2 } = renderHook(() => useFavorites(), { wrapper });
    expect(result2.current.favorites.map(f => f.id)).toEqual(['B']);
  });

  describe('pin merge — nav pins live in the favorites store', () => {
    it('setPinned flips the pinned flag and persists', () => {
      const { result } = renderHook(() => useFavorites(), { wrapper });
      act(() => {
        result.current.addFavorite({
          id: 'nav:contacts',
          label: 'Contacts',
          href: '/contacts',
          type: 'nav',
          navId: 'contacts',
          pinned: true,
        });
      });
      expect(result.current.isPinned('nav:contacts')).toBe(true);
      expect(result.current.pinnedNavIds.has('contacts')).toBe(true);

      act(() => result.current.setPinned('nav:contacts', false));
      expect(result.current.isPinned('nav:contacts')).toBe(false);
      expect(result.current.pinnedNavIds.has('contacts')).toBe(false);

      const stored = JSON.parse(
        localStorage.getItem('objectui-favorites:u:user-1') || '[]',
      );
      expect(stored[0].pinned).toBe(false);
    });

    it('migrates legacy objectui-nav-pins on mount (offline path) and deletes the key', async () => {
      localStorage.setItem('objectui-nav-pins', JSON.stringify(['contacts', 'orders']));
      const { result } = renderHook(() => useFavorites(), { wrapper });

      await waitFor(() => {
        expect(result.current.pinnedNavIds.has('contacts')).toBe(true);
      });
      expect(result.current.pinnedNavIds.has('orders')).toBe(true);
      // Legacy key consumed.
      expect(localStorage.getItem('objectui-nav-pins')).toBeNull();
      // Persisted as nav favorites.
      const stored: FavoriteItem[] = JSON.parse(
        localStorage.getItem('objectui-favorites:u:user-1') || '[]',
      );
      expect(stored.filter(f => f.type === 'nav').map(f => f.navId).sort()).toEqual([
        'contacts',
        'orders',
      ]);
    });

    it('migration is idempotent and does not duplicate existing nav favorites', async () => {
      localStorage.setItem('objectui-nav-pins', JSON.stringify(['contacts']));
      localStorage.setItem(
        'objectui-favorites:u:user-1',
        JSON.stringify([
          {
            id: 'nav:contacts',
            label: 'Contacts',
            href: '/contacts',
            type: 'nav',
            navId: 'contacts',
            pinned: true,
            favoritedAt: '2024-01-01',
          },
        ]),
      );

      const { result } = renderHook(() => useFavorites(), { wrapper });

      await waitFor(() => {
        expect(localStorage.getItem('objectui-nav-pins')).toBeNull();
      });
      // Still exactly one nav favorite for `contacts`.
      const nav = result.current.favorites.filter(f => f.type === 'nav');
      expect(nav).toHaveLength(1);
      expect(nav[0].navId).toBe('contacts');
    });

    it('migrates and pushes to backend when adapter is attached', async () => {
      localStorage.setItem('objectui-nav-pins', JSON.stringify(['sales']));
      const adapter = makeAdapter([]); // backend says: no favorites

      const { result } = renderHook(() => useTestHarness(), { wrapper });
      act(() => result.current.attach('favorites', adapter));

      await waitFor(() => {
        expect(adapter.loadMock).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(result.current.favs.pinnedNavIds.has('sales')).toBe(true);
      });
      // Legacy key cleared.
      expect(localStorage.getItem('objectui-nav-pins')).toBeNull();
      // The merged list (with the migrated nav pin) was scheduled for the
      // backend.
      await waitFor(
        () => expect(adapter.saveMock).toHaveBeenCalled(),
        { timeout: 1500 },
      );
      const persisted = adapter.saveMock.mock.calls.at(-1)![0] as FavoriteItem[];
      expect(persisted.some(f => f.type === 'nav' && f.navId === 'sales')).toBe(true);
    });

    it('content (20) and nav (20) buckets cap independently', () => {
      const { result } = renderHook(() => useFavorites(), { wrapper });

      act(() => {
        for (let i = 0; i < 22; i++) {
          result.current.addFavorite({
            id: `obj-${i}`,
            label: `O${i}`,
            href: `/o/${i}`,
            type: 'object',
          });
        }
        for (let i = 0; i < 22; i++) {
          result.current.addFavorite({
            id: `nav:n-${i}`,
            label: `N${i}`,
            href: '',
            type: 'nav',
            navId: `n-${i}`,
            pinned: true,
          });
        }
      });

      const byType = result.current.favorites.reduce<Record<string, number>>(
        (acc, f) => ({ ...acc, [f.type]: (acc[f.type] ?? 0) + 1 }),
        {},
      );
      expect(byType.object).toBe(20);
      expect(byType.nav).toBe(20);
    });
  });
});
