// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, #32246] `migrateDatabaseLoaderRowPackages` binds a
 * `DatabaseLoader` row of a by-package type to the package its body names —
 * only the loader's own rows (`source = 'database'`), only a type in the live
 * `PACKAGE_SLOTTED_STORE_TYPES`, never a guess, and any number of times.
 */

import { describe, expect, it } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { migrateDatabaseLoaderRowPackages } from './index.js';
import { DatabaseLoader } from '../loaders/database-loader.js';
import { PACKAGE_SLOTTED_STORE_TYPES } from '../package-slotted-store.js';

const SLOTTED = [...PACKAGE_SLOTTED_STORE_TYPES];
const CONTROL_TYPE = ['view', 'object'].find((type) => !PACKAGE_SLOTTED_STORE_TYPES.has(type))!;
const A = 'com.acme.alpha';
const B = 'com.acme.beta';

/** In-memory `sys_metadata`: equality and `$in` per field, nothing else. */
function rowStore(seed: Array<Record<string, unknown>>) {
  const rows = new Map(seed.map((row) => [String(row.id), { ...row }]));
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value !== null && typeof value === 'object') {
        const ops = Object.keys(value);
        if (ops.length !== 1 || ops[0] !== '$in') throw new Error(`rowStore: ${ops.join(', ')} is not implemented`);
        return (value as { $in: unknown[] }).$in.includes(row[key]);
      }
      return row[key] === value;
    });
  const store = {
    find: async (_table: string, query: any) => {
      const found = [...rows.values()].filter((row) => matches(row, query?.where));
      const page = typeof query?.limit === 'number' ? found.slice(0, query.limit) : found;
      return page.map((row) => ({ ...row }));
    },
    findOne: async (_table: string, query: any) => [...rows.values()].find((row) => matches(row, query?.where)) ?? null,
    count: async (_table: string, query: any) => [...rows.values()].filter((row) => matches(row, query?.where)).length,
    update: async (_table: string, id: string, data: Record<string, unknown>) => {
      const updated = { ...rows.get(id), ...data };
      rows.set(id, updated);
      return updated;
    },
    create: async (_table: string, data: Record<string, unknown>) => {
      rows.set(String(data.id), { ...data });
      return { ...data };
    },
    delete: async (_table: string, id: string) => rows.delete(id),
    syncSchema: async () => undefined,
    execute: async () => undefined,
  };
  return { store, packageOf: (id: string) => rows.get(id)?.package_id ?? null };
}

const row = (id: string, type: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  name: `shared_${type}`,
  metadata: JSON.stringify(body),
  source: 'database',
  ...extra,
});

describe('migrateDatabaseLoaderRowPackages (ADR-0150 D4, #32246)', () => {
  it.each(SLOTTED)('%s: binds a loader row whose body names a package — by the `_packageId` stamp or the envelope\'s `packageId` — and leaves a package-less one', async (type) => {
    const { store, packageOf } = rowStore([
      row('stamp', type, { name: 'x', _packageId: A }),
      { ...row('envelope', type, { packageId: B, metadata: { name: 'y' } }), name: 'other' },
      { ...row('env', type, { name: 'z' }), name: 'third' },
    ]);
    const result = await migrateDatabaseLoaderRowPackages(store);
    expect([packageOf('stamp'), packageOf('envelope'), packageOf('env')]).toEqual([A, B, null]);
    expect(result.bound.map((bound) => [bound.id, bound.packageId])).toEqual([['stamp', A], ['envelope', B]]);
    expect(result.left.map((left) => [left.id, left.reason])).toEqual([['env', 'package-less']]);
  });

  it.each(SLOTTED)('%s: re-runnable — a second run binds nothing and leaves the same rows', async (type) => {
    const { store } = rowStore([row('stamp', type, { name: 'x', _packageId: A }), { ...row('env', type, { name: 'z' }), name: 'third' }]);
    await migrateDatabaseLoaderRowPackages(store);
    const second = await migrateDatabaseLoaderRowPackages(store);
    expect(second.bound).toEqual([]);
    expect(second.left.map((left) => left.id)).toEqual(['env']);
  });

  it.each(SLOTTED)('%s: never makes a second row of one slot — a row whose package already has a row of the name is left', async (type) => {
    const { store, packageOf } = rowStore([
      row('bound', type, { name: 'x', _packageId: A }, { package_id: A }),
      row('legacy', type, { name: 'x', _packageId: A }),
    ]);
    const result = await migrateDatabaseLoaderRowPackages(store);
    expect(packageOf('legacy')).toBeNull();
    expect(result.left.map((left) => [left.id, left.reason])).toEqual([['legacy', 'slot-taken']]);
  });

  it('touches no row of a type outside the set, and no row another writer stored (`source` other than `database`)', async () => {
    const { store, packageOf } = rowStore([
      row('control', CONTROL_TYPE, { name: 'x', _packageId: A }),
      row('foreign', SLOTTED[0]!, { name: 'x', _packageId: A }, { source: undefined }),
    ]);
    const result = await migrateDatabaseLoaderRowPackages(store);
    expect([packageOf('control'), packageOf('foreign')]).toEqual([null, null]);
    expect(result).toEqual({ bound: [], left: [] });
  });

  it.each(SLOTTED)('%s: without it, `DatabaseLoader` reads a row written before #32246 by its body, and its next save of that package\'s item binds it', async (type) => {
    const { store, packageOf } = rowStore([row('legacy', type, { name: `shared_${type}`, label: 'old', _packageId: A })]);
    const loader = new DatabaseLoader({ driver: store as unknown as IDataDriver, trackHistory: false });
    expect((await loader.loadSlots(type, `shared_${type}`)).map((slot) => slot.packageId)).toEqual([A]);
    expect(packageOf('legacy'), 'a read binds nothing').toBeNull();
    await loader.save(type, `shared_${type}`, { name: `shared_${type}`, label: 'new', _packageId: A });
    expect(packageOf('legacy')).toBe(A);
    expect(await loader.loadSlots(type, `shared_${type}`)).toHaveLength(1);
  });
});
