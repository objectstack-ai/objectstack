/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createObjectStackUserStateAdapter } from './userState';
import type { DataSource } from '@object-ui/types';

function mockDataSource(overrides: Partial<DataSource<any>> = {}): DataSource<any> {
  return {
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as DataSource<any>;
}

describe('createObjectStackUserStateAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('load', () => {
    it('returns [] when no row exists for the (user, key) pair', async () => {
      const ds = mockDataSource();
      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u1',
        key: 'ui.favorites',
      });

      const items = await adapter.load();

      expect(items).toEqual([]);
      expect(ds.find).toHaveBeenCalledWith('sys_user_preference', {
        $filter: { user_id: 'u1', key: 'ui.favorites' },
        $top: 1,
      });
    });

    it('returns parsed value when row exists (array value)', async () => {
      const value = [{ id: 'object:contact', label: 'Contact' }];
      const ds = mockDataSource({
        find: vi.fn().mockResolvedValue({
          data: [{ id: 'row-1', user_id: 'u1', key: 'ui.recent', value }],
        }) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u1',
        key: 'ui.recent',
      });

      await expect(adapter.load()).resolves.toEqual(value);
    });

    it('parses string-encoded JSON values', async () => {
      const items = [{ id: 'a' }, { id: 'b' }];
      const ds = mockDataSource({
        find: vi.fn().mockResolvedValue({
          data: [{ id: 1, value: JSON.stringify(items) }],
        }) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
      });

      await expect(adapter.load()).resolves.toEqual(items);
    });

    it('returns [] when value is malformed JSON', async () => {
      const ds = mockDataSource({
        find: vi.fn().mockResolvedValue({
          data: [{ id: 1, value: '{not json' }],
        }) as any,
      });
      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
      });

      await expect(adapter.load()).resolves.toEqual([]);
    });

    it('swallows errors and returns [] when find() throws', async () => {
      const onError = vi.fn();
      const ds = mockDataSource({
        find: vi.fn().mockRejectedValue(new Error('boom')) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
        onError,
      });

      await expect(adapter.load()).resolves.toEqual([]);
      expect(onError).toHaveBeenCalledWith('load', expect.any(Error));
    });

    it('uses a custom resource name when provided', async () => {
      const ds = mockDataSource();
      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
        resource: 'my_prefs',
      });

      await adapter.load();

      expect(ds.find).toHaveBeenCalledWith('my_prefs', expect.any(Object));
    });
  });

  describe('save', () => {
    it('creates a new row when none exists', async () => {
      const created = { id: 'new-row' };
      const ds = mockDataSource({
        create: vi.fn().mockResolvedValue(created) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u1',
        key: 'ui.favorites',
      });

      await adapter.save([{ id: 'a' } as any]);

      expect(ds.create).toHaveBeenCalledWith('sys_user_preference', {
        user_id: 'u1',
        key: 'ui.favorites',
        value: [{ id: 'a' }],
      });
    });

    it('updates the existing row when one exists', async () => {
      const ds = mockDataSource({
        find: vi.fn().mockResolvedValue({
          data: [{ id: 'row-99', user_id: 'u', key: 'k', value: [] }],
        }) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
      });

      await adapter.save([{ id: 'x' } as any]);

      expect(ds.update).toHaveBeenCalledWith('sys_user_preference', 'row-99', {
        value: [{ id: 'x' }],
      });
      expect(ds.create).not.toHaveBeenCalled();
    });

    // #3794 — `updated_at` is server-managed. A caller-supplied value is
    // stripped (framework #2948) and reported back as a dropped field, which
    // the console turns into a "Some fields were not saved" toast. Stamping it
    // here fired that warning on every recents/favorites write, about a field
    // no user ever touched — noise on the exact surface that is supposed to
    // tell a user their edit did not land.
    it('never sends the server-managed updated_at column', async () => {
      const ds = mockDataSource({
        find: vi.fn().mockResolvedValue({ data: [] }) as any,
        create: vi.fn().mockResolvedValue({ id: 'row-1' }) as any,
      });
      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'ui.recent',
      });

      await adapter.save([{ id: 'a' } as any]);
      await adapter.save([{ id: 'b' } as any]);

      for (const call of [...(ds.create as any).mock.calls, ...(ds.update as any).mock.calls]) {
        expect(call[call.length - 1]).not.toHaveProperty('updated_at');
      }
    });

    it('uses the cached row id from a previous load on subsequent saves', async () => {
      const ds = mockDataSource({
        find: vi.fn().mockResolvedValue({
          data: [{ id: 'row-42', value: [] }],
        }) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
      });

      await adapter.load();
      (ds.find as any).mockClear();

      await adapter.save([{ id: 'b' } as any]);

      // No second find() — went straight to update via cached id.
      expect(ds.find).not.toHaveBeenCalled();
      expect(ds.update).toHaveBeenCalledWith('sys_user_preference', 'row-42', expect.any(Object));
    });

    it('falls back to insert when cached row update fails (row deleted server-side)', async () => {
      const ds = mockDataSource({
        find: vi.fn()
          .mockResolvedValueOnce({ data: [{ id: 'stale', value: [] }] })
          .mockResolvedValueOnce({ data: [] }) as any,
        update: vi.fn().mockRejectedValue(new Error('not found')) as any,
        create: vi.fn().mockResolvedValue({ id: 'new' }) as any,
      });
      const onError = vi.fn();

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
        onError,
      });

      await adapter.load(); // primes cachedRowId = 'stale'
      await adapter.save([{ id: 'z' } as any]);

      expect(ds.update).toHaveBeenCalledTimes(1);
      expect(ds.create).toHaveBeenCalledWith('sys_user_preference', expect.objectContaining({
        user_id: 'u',
        key: 'k',
        value: [{ id: 'z' }],
      }));
    });

    it('recovers from a UNIQUE(user_id, key) insert failure by updating in place', async () => {
      // First findExisting() (no cached id) misses; create() loses the race and
      // throws; the recovery findExisting() now sees the row → update.
      const ds = mockDataSource({
        find: vi.fn()
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [{ id: 'row-7', user_id: 'u', key: 'k', value: [] }] }) as any,
        create: vi.fn().mockRejectedValue(new Error('UNIQUE constraint failed')) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
      });

      await adapter.save([{ id: 'q' } as any]);

      expect(ds.create).toHaveBeenCalledTimes(1);
      expect(ds.update).toHaveBeenCalledWith('sys_user_preference', 'row-7', {
        value: [{ id: 'q' }],
      });
    });

    it('serializes concurrent saves so only one insert happens', async () => {
      // Both saves start before either resolves. Without serialization both
      // would findExisting()→[]→create() and the second would trip the
      // UNIQUE constraint. With the save chain, the second waits, sees the
      // cached row id from the first, and updates.
      const ds = mockDataSource({
        find: vi.fn().mockResolvedValue({ data: [] }) as any,
        create: vi.fn().mockResolvedValue({ id: 'row-1' }) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'ui.recent',
      });

      await Promise.all([
        adapter.save([{ id: 'a' } as any]),
        adapter.save([{ id: 'a' }, { id: 'b' }] as any),
      ]);

      expect(ds.create).toHaveBeenCalledTimes(1);
      expect(ds.update).toHaveBeenCalledWith('sys_user_preference', 'row-1', {
        value: [{ id: 'a' }, { id: 'b' }],
      });
    });

    it('swallows errors when save() throws', async () => {
      const onError = vi.fn();
      const ds = mockDataSource({
        find: vi.fn().mockRejectedValue(new Error('network down')) as any,
      });

      const adapter = createObjectStackUserStateAdapter({
        dataSource: ds,
        userId: 'u',
        key: 'k',
        onError,
      });

      await expect(adapter.save([{ id: 'a' } as any])).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalledWith('save', expect.any(Error));
    });
  });
});
