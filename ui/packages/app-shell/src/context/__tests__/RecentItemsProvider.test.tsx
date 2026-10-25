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

const mockUser = { current: { id: 'user-1', name: 'Alice', email: 'a@x' } as any | null };
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: mockUser.current, isAuthenticated: !!mockUser.current, isLoading: false }),
}));

import {
  RecentItemsProvider,
  useRecentItems,
  type RecentItem,
} from '../RecentItemsProvider';
import { recentViewId } from '../../hooks/useTrackRouteAsRecent';
import {
  UserStateAdaptersProvider,
  useAttachUserStateAdapters,
  type UserDataAdapter,
} from '../UserStateAdapters';

function makeAdapter(initial: RecentItem[] = []) {
  const loadMock = vi.fn().mockResolvedValue(initial);
  const saveMock = vi.fn().mockResolvedValue(undefined);
  return { load: loadMock, save: saveMock, loadMock, saveMock } as UserDataAdapter<RecentItem> & {
    loadMock: ReturnType<typeof vi.fn>;
    saveMock: ReturnType<typeof vi.fn>;
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <UserStateAdaptersProvider>
      <RecentItemsProvider>{children}</RecentItemsProvider>
    </UserStateAdaptersProvider>
  );
}

function useHarness() {
  const attach = useAttachUserStateAdapters();
  const recent = useRecentItems();
  return { attach, recent };
}

describe('RecentItemsProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser.current = { id: 'user-1', name: 'Alice', email: 'a@x' } as any;
  });

  it('hydrates synchronously from user-scoped localStorage on mount', () => {
    const seeded: RecentItem[] = [
      { id: 'object:c', type: 'object', name: 'c', href: '/c', visitedAt: '2024-01-01' },
    ];
    localStorage.setItem('objectui-recent-items:u:user-1', JSON.stringify(seeded));

    const { result } = renderHook(() => useRecentItems(), { wrapper });
    expect(result.current.recentItems).toEqual(seeded);
  });

  it('addRecentItem prepends and updates timestamp on revisit', () => {
    const { result } = renderHook(() => useRecentItems(), { wrapper });

    act(() => result.current.addRecentItem({ id: 'object:a', type: 'object', name: 'a', href: '/a' }));
    act(() => result.current.addRecentItem({ id: 'object:b', type: 'object', name: 'b', href: '/b' }));
    act(() => result.current.addRecentItem({ id: 'object:a', type: 'object', name: 'a', href: '/a' }));

    // 'a' moves back to the front; no duplicate.
    expect(result.current.recentItems.map(r => r.id)).toEqual(['object:a', 'object:b']);
  });

  it('caps recent items at 20 (objectui#12604)', () => {
    const { result } = renderHook(() => useRecentItems(), { wrapper });

    act(() => {
      for (let i = 0; i < 25; i++) {
        result.current.addRecentItem({
          id: `object:r-${i}`,
          type: 'object',
          name: `r-${i}`,
          href: `/r/${i}`,
        });
      }
    });

    expect(result.current.recentItems).toHaveLength(20);
    // Most recent first; the five oldest fell off the end.
    expect(result.current.recentItems[0].id).toBe('object:r-24');
    expect(result.current.recentItems[19].id).toBe('object:r-5');
  });

  it('a stored list longer than 20 is read back capped (objectui#12604)', () => {
    const stored = Array.from({ length: 23 }, (_, i) => ({
      id: `object:s-${i}`, type: 'object', name: `s-${i}`, href: `/s/${i}`, visitedAt: '2026-10-16T00:00:00.000Z',
    }));
    localStorage.setItem('objectui-recent-items:u:user-1', JSON.stringify(stored));
    const { result } = renderHook(() => useRecentItems(), { wrapper });
    expect(result.current.recentItems).toHaveLength(20);
  });

  it('persists to user-scoped localStorage only', () => {
    const { result } = renderHook(() => useRecentItems(), { wrapper });

    act(() =>
      result.current.addRecentItem({ id: 'page:x', type: 'page', name: 'x', href: '/x' }),
    );

    expect(localStorage.getItem('objectui-recent-items')).toBeNull();
    const stored = JSON.parse(localStorage.getItem('objectui-recent-items:u:user-1') || '[]');
    expect(stored[0]).toMatchObject({ id: 'page:x', type: 'page', name: 'x' });
  });

  it('hydrates from adapter and overrides localStorage state', async () => {
    localStorage.setItem(
      'objectui-recent-items:u:user-1',
      JSON.stringify([{ id: 'object:local', type: 'object', name: 'local', href: '/l', visitedAt: 't' }]),
    );
    const remote: RecentItem[] = [
      { id: 'dashboard:remote', type: 'dashboard', name: 'remote', href: '/r', visitedAt: 't' },
    ];
    const adapter = makeAdapter(remote);

    const { result } = renderHook(() => useHarness(), { wrapper });
    expect(result.current.recent.recentItems.map(r => r.id)).toEqual(['object:local']);

    act(() => result.current.attach('recent', adapter));

    await waitFor(() => {
      expect(result.current.recent.recentItems.map(r => r.id)).toEqual(['dashboard:remote']);
    });
    expect(JSON.parse(localStorage.getItem('objectui-recent-items:u:user-1') || '[]')).toEqual(remote);
  });

  it('debounces adapter.save() across a burst of additions', async () => {
    const adapter = makeAdapter([]);
    const { result } = renderHook(() => useHarness(), { wrapper });

    act(() => result.current.attach('recent', adapter));
    await waitFor(() => expect(adapter.loadMock).toHaveBeenCalled());
    adapter.saveMock.mockClear();

    act(() => {
      result.current.recent.addRecentItem({ id: 'object:1', type: 'object', name: '1', href: '/1' });
      result.current.recent.addRecentItem({ id: 'object:2', type: 'object', name: '2', href: '/2' });
      result.current.recent.addRecentItem({ id: 'object:3', type: 'object', name: '3', href: '/3' });
    });

    expect(adapter.saveMock).not.toHaveBeenCalled();
    await waitFor(() => expect(adapter.saveMock).toHaveBeenCalledTimes(1), { timeout: 1500 });

    const persisted = adapter.saveMock.mock.calls[0][0] as RecentItem[];
    expect(persisted.map(p => p.id).sort()).toEqual(['object:1', 'object:2', 'object:3']);
  });

  it('clearRecentItems empties the list and persists []', () => {
    const { result } = renderHook(() => useRecentItems(), { wrapper });

    act(() => result.current.addRecentItem({ id: 'object:a', type: 'object', name: 'a', href: '/a' }));
    act(() => result.current.clearRecentItems());

    expect(result.current.recentItems).toEqual([]);
    expect(localStorage.getItem('objectui-recent-items:u:user-1')).toBe('[]');
  });

  it('returns a no-op when used outside a provider', () => {
    const { result } = renderHook(() => useRecentItems());
    expect(result.current.recentItems).toEqual([]);
    expect(() =>
      result.current.addRecentItem({ id: 'object:x', type: 'object', name: 'x', href: '/x' }),
    ).not.toThrow();
  });
});

/**
 * objectui#11678 — "a visit that does not change the list writes nothing" is a
 * property of the STORE, not of whoever reports the visit: the route tracker,
 * a record page, a host's own call. Each write the provider makes is a
 * localStorage write plus an `adapter.save()` — a `sys_user_preference` PATCH
 * and an audit row — so these count both.
 */
describe('RecentItemsProvider — no change, no write (objectui#11678)', () => {
  const KEY = 'objectui-recent-items:u:user-1';

  beforeEach(() => {
    localStorage.clear();
  });

  /** An attached, hydrated adapter whose saves are counted from zero. */
  async function mountWithAdapter() {
    const adapter = makeAdapter([]);
    const view = renderHook(() => useHarness(), { wrapper });
    act(() => view.result.current.attach('recent', adapter));
    await waitFor(() => expect(adapter.loadMock).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    adapter.saveMock.mockClear();
    return { ...view, adapter };
  }

  /** Every localStorage write to the recent-items key, counted. */
  function countStorageWrites() {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    return {
      count: () => spy.mock.calls.filter(([key]) => key === KEY).length,
      restore: () => spy.mockRestore(),
    };
  }

  it('re-adding the entry already at the head writes nothing — not even a fresher visitedAt', async () => {
    const { result, adapter } = await mountWithAdapter();
    act(() =>
      result.current.recent.addRecentItem({ id: 'dashboard:ops', type: 'dashboard', name: 'ops', href: '/d/ops' }),
    );
    await waitFor(() => expect(adapter.saveMock).toHaveBeenCalledTimes(1), { timeout: 1500 });
    const visitedAt = result.current.recent.recentItems[0].visitedAt;

    const writes = countStorageWrites();
    try {
      act(() =>
        result.current.recent.addRecentItem({ id: 'dashboard:ops', type: 'dashboard', name: 'ops', href: '/d/ops' }),
      );
      await new Promise(r => setTimeout(r, 700));
      expect(writes.count()).toBe(0);
    } finally {
      writes.restore();
    }
    expect(adapter.saveMock).toHaveBeenCalledTimes(1);
    expect(result.current.recent.recentItems[0].visitedAt).toBe(visitedAt);
  });

  it('clearing an already-empty list writes nothing', async () => {
    const { result, adapter } = await mountWithAdapter();
    const writes = countStorageWrites();
    try {
      act(() => result.current.recent.clearRecentItems());
      await new Promise(r => setTimeout(r, 700));
      expect(writes.count()).toBe(0);
    } finally {
      writes.restore();
    }
    expect(adapter.saveMock).not.toHaveBeenCalled();
  });

  it('control: a head whose content changed (a record title that resolved) IS written', async () => {
    const { result, adapter } = await mountWithAdapter();
    act(() =>
      result.current.recent.addRecentItem({ id: 'record:acct:1', type: 'record', label: 'acct-1', href: '/r/1' }),
    );
    await waitFor(() => expect(adapter.saveMock).toHaveBeenCalledTimes(1), { timeout: 1500 });
    act(() =>
      result.current.recent.addRecentItem({ id: 'record:acct:1', type: 'record', label: 'Acme Corp', href: '/r/1' }),
    );
    await waitFor(() => expect(adapter.saveMock).toHaveBeenCalledTimes(2), { timeout: 1500 });
    expect(result.current.recent.recentItems).toEqual([
      { id: 'record:acct:1', type: 'record', label: 'Acme Corp', href: '/r/1', visitedAt: expect.any(String) },
    ]);
  });
});

/**
 * objectui#11678 — the lists already in users' `ui.recent` rows carry the old
 * shape: an object / dashboard / page / report entry with a `label` minted at
 * visit time ("Showcase Ops Dashboard") and no `name`. The reader keeps the
 * entry and drops the minted text: the identity was always in `id`
 * (`<type>:<name>`), so the item's current label replaces it on render.
 */
describe('RecentItemsProvider — reading a list stored before the identity shape (objectui#11678)', () => {
  const LEGACY = [
    {
      id: 'dashboard:showcase_ops_dashboard',
      label: 'Showcase Ops Dashboard',
      href: '/apps/showcase_app/dashboard/showcase_ops_dashboard',
      type: 'dashboard',
      visitedAt: '2026-10-06T09:00:00.000Z',
    },
    {
      id: 'object:showcase_task',
      label: 'Task',
      href: '/apps/showcase_app/showcase_task',
      type: 'object',
      visitedAt: '2026-10-06T08:59:00.000Z',
    },
    // A record and a Studio metadata item keep their text: neither has a
    // metadata label to resolve.
    {
      id: 'record:showcase_task:t1',
      label: 'Write the brief',
      href: '/apps/showcase_app/showcase_task/record/t1',
      type: 'record',
      visitedAt: '2026-10-06T08:58:00.000Z',
    },
    {
      id: 'metadata:object:sys_user',
      label: 'sys_user',
      href: '/apps/setup/metadata/object/sys_user',
      type: 'metadata',
      visitedAt: '2026-10-06T08:57:00.000Z',
    },
    // A host's own write whose id carries no `<type>:` names nothing to resolve.
    { id: 'my-page', label: 'Mine', href: '/x', type: 'page', visitedAt: '2026-10-06T08:56:00.000Z' },
  ];
  const READ: RecentItem[] = [
    {
      id: 'dashboard:showcase_ops_dashboard',
      type: 'dashboard',
      name: 'showcase_ops_dashboard',
      href: '/apps/showcase_app/dashboard/showcase_ops_dashboard',
      visitedAt: '2026-10-06T09:00:00.000Z',
    },
    {
      id: 'object:showcase_task',
      type: 'object',
      name: 'showcase_task',
      href: '/apps/showcase_app/showcase_task',
      visitedAt: '2026-10-06T08:59:00.000Z',
    },
    {
      id: 'record:showcase_task:t1',
      type: 'record',
      label: 'Write the brief',
      href: '/apps/showcase_app/showcase_task/record/t1',
      visitedAt: '2026-10-06T08:58:00.000Z',
    },
    {
      id: 'metadata:object:sys_user',
      type: 'metadata',
      label: 'sys_user',
      href: '/apps/setup/metadata/object/sys_user',
      visitedAt: '2026-10-06T08:57:00.000Z',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
  });

  it('from localStorage: the identity is read out of the id, the minted label is dropped', () => {
    localStorage.setItem('objectui-recent-items:u:user-1', JSON.stringify(LEGACY));
    const { result } = renderHook(() => useRecentItems(), { wrapper });
    expect(result.current.recentItems).toEqual(READ);
  });

  it('from the adapter: the same read, and reading it writes nothing back', async () => {
    const adapter = makeAdapter(LEGACY as unknown as RecentItem[]);
    const { result } = renderHook(() => useHarness(), { wrapper });
    act(() => result.current.attach('recent', adapter));
    await waitFor(() => expect(result.current.recent.recentItems).toEqual(READ));
    await new Promise(r => setTimeout(r, 700));
    expect(adapter.saveMock).not.toHaveBeenCalled();
  });

  it('the next change writes the identity shape, with no legacy label left in it', async () => {
    const adapter = makeAdapter(LEGACY as unknown as RecentItem[]);
    const { result } = renderHook(() => useHarness(), { wrapper });
    act(() => result.current.attach('recent', adapter));
    await waitFor(() => expect(result.current.recent.recentItems).toEqual(READ));
    act(() =>
      result.current.recent.addRecentItem({
        id: 'page:showcase_capability_map',
        type: 'page',
        name: 'showcase_capability_map',
        href: '/apps/showcase_app/page/showcase_capability_map',
      }),
    );
    await waitFor(() => expect(adapter.saveMock).toHaveBeenCalledTimes(1), { timeout: 1500 });
    const saved = adapter.saveMock.mock.calls[0][0] as RecentItem[];
    expect(saved.slice(1)).toEqual(READ);
    expect(JSON.stringify(saved)).not.toContain('Showcase Ops Dashboard');
  });
});

describe('RecentItemsProvider — a Studio package entry (objectui#11863)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser.current = { id: 'user-1', name: 'Alice', email: 'a@x' };
  });

  it('is kept by identity: no display text is stored, even when one is handed in', () => {
    const { result } = renderHook(() => useRecentItems(), { wrapper });
    act(() =>
      result.current.addRecentItem({
        id: 'package:com.acme.crm',
        type: 'package',
        name: 'com.acme.crm',
        href: '/studio/com.acme.crm',
        // Not part of the shape; a caller that mints one anyway stores nothing of it.
        label: 'Acme CRM',
      } as never),
    );
    const [entry] = result.current.recentItems;
    expect(entry).toEqual({
      id: 'package:com.acme.crm',
      type: 'package',
      name: 'com.acme.crm',
      href: '/studio/com.acme.crm',
      visitedAt: expect.any(String),
    });
    expect(localStorage.getItem('objectui-recent-items:u:user-1')).not.toContain('Acme CRM');
  });

  it('reads back from storage as the same entry', () => {
    const stored = { id: 'package:com.acme.crm', type: 'package', name: 'com.acme.crm', href: '/studio/com.acme.crm', visitedAt: '2026-10-08T09:00:00.000Z' };
    localStorage.setItem('objectui-recent-items:u:user-1', JSON.stringify([stored]));
    const { result } = renderHook(() => useRecentItems(), { wrapper });
    expect(result.current.recentItems).toEqual([stored]);
  });
});

/**
 * objectui#12604 — the store keeps one entry per TARGET: one per record, one
 * per object view. A list view is stored by identity, its object and its view
 * name, both required.
 */
describe('RecentItemsProvider — one entry per target (objectui#12604)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser.current = { id: 'user-1', name: 'Alice', email: 'a@x' };
  });

  const record = (id: string, label: string) =>
    ({ id: `record:crm_account:${id}`, type: 'record', label, href: `/apps/crm/crm_account/record/${id}` }) as const;
  const view = (name: string) =>
    ({ id: recentViewId('crm_account', name), type: 'view', object: 'crm_account', name, href: `/apps/crm/crm_account/view/${name}` }) as const;

  it('a record visited twice is one entry, moved to the head, under its newest title', () => {
    const { result } = renderHook(() => useRecentItems(), { wrapper });
    act(() => result.current.addRecentItem(record('a1', 'Acme')));
    act(() => result.current.addRecentItem(record('b2', 'Globex')));
    act(() => result.current.addRecentItem(record('a1', 'Acme Corporation')));

    expect(result.current.recentItems.map((r) => r.id)).toEqual(['record:crm_account:a1', 'record:crm_account:b2']);
    expect(result.current.recentItems[0]).toMatchObject({ type: 'record', label: 'Acme Corporation' });
  });

  it('two views of one object are two entries; a view revisited is one', () => {
    const { result } = renderHook(() => useRecentItems(), { wrapper });
    act(() => result.current.addRecentItem(view('crm_account.all')));
    act(() => result.current.addRecentItem(view('crm_account.mine')));
    act(() => result.current.addRecentItem(view('crm_account.all')));

    expect(result.current.recentItems.map((r) => r.id)).toEqual([
      'view:crm_account:crm_account.all',
      'view:crm_account:crm_account.mine',
    ]);
  });

  it('a view entry is stored by identity — object and view name, no display text', () => {
    const { result } = renderHook(() => useRecentItems(), { wrapper });
    // A label handed in is not kept, as for every identity kind.
    act(() => result.current.addRecentItem({ ...view('crm_account.all'), label: 'All Accounts' } as never));

    const stored = JSON.parse(localStorage.getItem('objectui-recent-items:u:user-1')!);
    expect(stored).toHaveLength(1);
    const { visitedAt, ...entry } = stored[0];
    expect(entry).toEqual({
      id: 'view:crm_account:crm_account.all',
      type: 'view',
      object: 'crm_account',
      name: 'crm_account.all',
      href: '/apps/crm/crm_account/view/crm_account.all',
    });
    expect(typeof visitedAt).toBe('string');
  });

  it('a view entry with no object, or no view name, names nothing to open and is dropped', () => {
    localStorage.setItem(
      'objectui-recent-items:u:user-1',
      JSON.stringify([
        { id: 'view:x', type: 'view', name: 'crm_account.all', href: '/a', visitedAt: '' },
        { id: 'view:y', type: 'view', object: 'crm_account', href: '/b', visitedAt: '' },
        { id: 'view:z', type: 'view', object: 'crm_account', name: 'crm_account.all', href: '/c', visitedAt: '' },
      ]),
    );
    const { result } = renderHook(() => useRecentItems(), { wrapper });
    expect(result.current.recentItems.map((r) => r.id)).toEqual(['view:z']);
  });
});
