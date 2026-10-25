/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u' }, isAuthenticated: true, isLoading: false }),
}));

import { useTrackRouteAsRecent } from '../useTrackRouteAsRecent';
import {
  RecentItemsProvider,
  useRecentItems,
  type RecentItem,
} from '../../context/RecentItemsProvider';
import {
  UserStateAdaptersProvider,
  useAttachUserStateAdapters,
  type UserDataAdapter,
} from '../../context/UserStateAdapters';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <UserStateAdaptersProvider>
      <RecentItemsProvider>{children}</RecentItemsProvider>
    </UserStateAdaptersProvider>
  );
}

function useHarness(
  pathname: string,
  appName: string | undefined,
  objects: any[] = [],
  disabled = false,
) {
  useTrackRouteAsRecent({ pathname, appName, objects, disabled });
  const { recentItems } = useRecentItems();
  return recentItems;
}

describe('useTrackRouteAsRecent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // objectui#11678 — an object, dashboard, page or report is recorded by its
  // identity (`type` + `name`) and with NO label: the route has nothing but the
  // machine name to make one from, and the label is resolved where the entry
  // is rendered (`useRecentItemLabel`). `toEqual`, not `toMatchObject`, so a
  // `label` coming back fails the pin.
  it('records an object route by identity, with no label', () => {
    const { result } = renderHook(
      () =>
        useHarness('/apps/sales/contact', 'sales', [{ name: 'contact', label: 'Contacts' }]),
      { wrapper },
    );
    expect(result.current[0]).toEqual({
      id: 'object:contact',
      type: 'object',
      name: 'contact',
      href: '/apps/sales/contact',
      visitedAt: expect.any(String),
    });
  });

  // objectui#12604 — opening a named list view records THAT view: its object
  // and its view name, by identity, with the view's own address. The object's
  // own entry is not recorded for it: the view is the target that was opened.
  it('records a list-view route as the view, by identity, with no label', () => {
    const { result } = renderHook(
      () =>
        useHarness('/apps/sales/contact/view/contact.my_contacts', 'sales', [{ name: 'contact', label: 'Contacts' }]),
      { wrapper },
    );
    expect(result.current).toEqual([
      {
        id: 'view:contact:contact.my_contacts',
        type: 'view',
        object: 'contact',
        name: 'contact.my_contacts',
        href: '/apps/sales/contact/view/contact.my_contacts',
        visitedAt: expect.any(String),
      },
    ]);
  });

  it('a view route keeps the segment as the address and decodes the name', () => {
    const { result } = renderHook(
      () => useHarness('/apps/sales/contact/view/my%20view', 'sales', [{ name: 'contact' }]),
      { wrapper },
    );
    expect(result.current[0]).toMatchObject({
      id: 'view:contact:my view',
      name: 'my view',
      href: '/apps/sales/contact/view/my%20view',
    });
  });

  // objectui#12604 — a record page is a visit to the record, which the record
  // page records itself; the route under the object does not ALSO record the
  // object's list, a second target for one visit (measured on HotCRM: every
  // record opened pushed "Accounts" into Home's list beside it).
  it('a record, create or edit route under an object does not record the object’s list', () => {
    for (const path of ['/apps/sales/contact/record/c1', '/apps/sales/contact/new', '/apps/sales/contact/record/c1/edit']) {
      const { result } = renderHook(() => useHarness(path, 'sales', [{ name: 'contact' }]), { wrapper });
      expect(result.current).toEqual([]);
      localStorage.clear();
    }
  });

  it('control: the object’s data surface is its list, recorded as the object', () => {
    const { result } = renderHook(() => useHarness('/apps/sales/contact/data', 'sales', [{ name: 'contact' }]), { wrapper });
    expect(result.current.map(r => r.id)).toEqual(['object:contact']);
  });

  it('a view route of an object the app does not have records nothing', () => {
    const { result } = renderHook(
      () => useHarness('/apps/sales/unknown_obj/view/all', 'sales', [{ name: 'contact' }]),
      { wrapper },
    );
    expect(result.current).toEqual([]);
  });

  it('records a dashboard route by identity — no label minted from the slug', () => {
    const { result } = renderHook(
      () => useHarness('/apps/sales/dashboard/sales_overview', 'sales'),
      { wrapper },
    );
    expect(result.current[0]).toEqual({
      id: 'dashboard:sales_overview',
      type: 'dashboard',
      name: 'sales_overview',
      href: '/apps/sales/dashboard/sales_overview',
      visitedAt: expect.any(String),
    });
  });

  it('records a page route by identity', () => {
    const { result } = renderHook(
      () => useHarness('/apps/cs/page/welcome-tour', 'cs'),
      { wrapper },
    );
    expect(result.current[0]).toEqual({
      id: 'page:welcome-tour',
      type: 'page',
      name: 'welcome-tour',
      href: '/apps/cs/page/welcome-tour',
      visitedAt: expect.any(String),
    });
  });

  it('records a report route by identity', () => {
    const { result } = renderHook(
      () => useHarness('/apps/sales/report/q3-results', 'sales'),
      { wrapper },
    );
    expect(result.current[0]).toEqual({
      id: 'report:q3-results',
      type: 'report',
      name: 'q3-results',
      href: '/apps/sales/report/q3-results',
      visitedAt: expect.any(String),
    });
  });

  it('records a Studio metadata item route', () => {
    const { result } = renderHook(
      () => useHarness('/apps/admin/metadata/object/sys_user', 'admin'),
      { wrapper },
    );
    expect(result.current[0]).toMatchObject({
      id: 'metadata:object:sys_user',
      label: 'sys_user',
      href: '/apps/admin/metadata/object/sys_user',
      type: 'metadata',
    });
  });

  it('records the metadata item when on its history sub-route', () => {
    const { result } = renderHook(
      () => useHarness('/apps/admin/metadata/view/account_grid/history', 'admin'),
      { wrapper },
    );
    expect(result.current[0]).toMatchObject({
      id: 'metadata:view:account_grid',
      href: '/apps/admin/metadata/view/account_grid',
      type: 'metadata',
    });
  });

  it('skips metadata list, directory and create routes', () => {
    const { result: list } = renderHook(
      () => useHarness('/apps/admin/metadata/object', 'admin'),
      { wrapper },
    );
    expect(list.current).toEqual([]);

    const { result: dir } = renderHook(
      () => useHarness('/apps/admin/metadata', 'admin'),
      { wrapper },
    );
    expect(dir.current).toEqual([]);

    const { result: create } = renderHook(
      () => useHarness('/apps/admin/metadata/object/new', 'admin'),
      { wrapper },
    );
    expect(create.current).toEqual([]);
  });

  it('skips when objectName resolves to a route prefix (e.g. "design")', () => {
    const { result } = renderHook(() => useHarness('/apps/sales/design', 'sales'), {
      wrapper,
    });
    expect(result.current).toEqual([]);
  });

  it('skips when object is unknown', () => {
    const { result } = renderHook(
      () => useHarness('/apps/sales/unknown_obj', 'sales', [{ name: 'contact' }]),
      { wrapper },
    );
    expect(result.current).toEqual([]);
  });

  it('skips when appName is undefined or pathname does not match', () => {
    const { result: r1 } = renderHook(
      () => useHarness('/apps/sales/contact', undefined),
      { wrapper },
    );
    expect(r1.current).toEqual([]);

    const { result: r2 } = renderHook(() => useHarness('/login', 'sales'), { wrapper });
    expect(r2.current).toEqual([]);
  });

  it('does nothing when disabled', () => {
    const { result } = renderHook(
      () =>
        useHarness(
          '/apps/sales/contact',
          'sales',
          [{ name: 'contact', label: 'Contacts' }],
          true,
        ),
      { wrapper },
    );
    expect(result.current).toEqual([]);
  });

  it('records each navigation as pathname changes (rerender)', () => {
    const objects = [
      { name: 'contact', label: 'Contacts' },
      { name: 'order', label: 'Orders' },
    ];
    const { result, rerender } = renderHook(
      ({ p }: { p: string }) => useHarness(p, 'sales', objects),
      { wrapper, initialProps: { p: '/apps/sales/contact' } },
    );

    rerender({ p: '/apps/sales/order' });

    const ids = (result.current as RecentItem[]).map(r => r.id);
    expect(ids).toEqual(['object:order', 'object:contact']);
  });
});

/**
 * objectui#11678 — "revisiting the most recent item makes no write".
 *
 * Measured before the fix (the real provider and this hook over a counting
 * adapter): coming back to the entry already at the head of the list, and
 * moving from an object's list route to one of its view routes, each saved the
 * list a second time — identical but for a fresher `visitedAt` — and every
 * save is a `sys_user_preference` PATCH. These drive the hook through real
 * route changes and count `adapter.save()` calls; the provider's own pins are
 * in `RecentItemsProvider.test.tsx`.
 */
describe('useTrackRouteAsRecent — a visit that does not change the list writes nothing (objectui#11678)', () => {
  const OBJECTS = [{ name: 'showcase_task', label: 'Task' }];

  function makeAdapter() {
    const save = vi.fn().mockResolvedValue(undefined);
    const adapter: UserDataAdapter<RecentItem> = { load: vi.fn().mockResolvedValue([]), save };
    return { adapter, save };
  }

  function Visit({ pathname, adapter }: { pathname: string; adapter: UserDataAdapter<RecentItem> }) {
    const attach = useAttachUserStateAdapters();
    useEffect(() => {
      attach('recent', adapter);
      return () => attach('recent', null);
    }, [attach, adapter]);
    useTrackRouteAsRecent({ pathname, appName: 'showcase_app', objects: OBJECTS });
    return null;
  }

  /** Let hydration settle and the 500ms write debounce run out. */
  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
  }

  /**
   * Mount on a route the hook ignores, so the adapter is attached and hydrated
   * before the first tracked visit (a visit landing before hydration resolves
   * is overwritten by it — a separate race this file does not pin).
   */
  async function mount(adapter: UserDataAdapter<RecentItem>) {
    const ui = (pathname: string) => wrapper({ children: <Visit pathname={pathname} adapter={adapter} /> });
    const view = render(ui('/home'));
    await settle();
    return (pathname: string) => view.rerender(ui(pathname));
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('revisiting the most recent item makes no write', async () => {
    const { adapter, save } = makeAdapter();
    const go = await mount(adapter);

    go('/apps/showcase_app/dashboard/showcase_ops_dashboard');
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    go('/home');
    await settle();
    go('/apps/showcase_app/dashboard/showcase_ops_dashboard');
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a named list view is its own target: opening it after the object’s list is saved, revisiting it is not (objectui#12604)', async () => {
    const { adapter, save } = makeAdapter();
    const go = await mount(adapter);

    go('/apps/showcase_app/showcase_task');
    await settle();
    go('/apps/showcase_app/showcase_task/view/all_tasks');
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1][0] as RecentItem[]).map(r => r.id)).toEqual([
      'view:showcase_task:all_tasks',
      'object:showcase_task',
    ]);

    go('/home');
    await settle();
    go('/apps/showcase_app/showcase_task/view/all_tasks');
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('control: a visit that DOES change the list is saved', async () => {
    const { adapter, save } = makeAdapter();
    const go = await mount(adapter);

    go('/apps/showcase_app/dashboard/showcase_ops_dashboard');
    await settle();
    go('/apps/showcase_app/page/showcase_task_schedule');
    await settle();
    go('/apps/showcase_app/dashboard/showcase_ops_dashboard');
    await settle();
    expect(save).toHaveBeenCalledTimes(3);
    const last = save.mock.calls[2][0] as RecentItem[];
    expect(last.map(r => r.id)).toEqual([
      'dashboard:showcase_ops_dashboard',
      'page:showcase_task_schedule',
    ]);
  });
});
