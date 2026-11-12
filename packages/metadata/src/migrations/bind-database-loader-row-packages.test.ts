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
import { ITEM_KEY_DISCRIMINATORS } from '@objectstack/metadata-core';
import { PACKAGE_SLOTTED_STORE_TYPES, isBundledStoreType } from '../package-slotted-store.js';

const SLOTTED = [...PACKAGE_SLOTTED_STORE_TYPES];
const BUNDLED = SLOTTED.filter(isBundledStoreType);
const UNBUNDLED = SLOTTED.find((type) => !isBundledStoreType(type))!;
const CONTROL_TYPE = ['view', 'object'].find((type) => !PACKAGE_SLOTTED_STORE_TYPES.has(type))!;
const A = 'com.acme.alpha';
const B = 'com.acme.beta';

/**
 * In-memory `sys_metadata`: equality and `$in` per field, nothing else. With
 * `uniqueKey`, an update is refused as the overlay unique index
 * `(type, name, package_id, bundle_member)` refuses it.
 */
function rowStore(seed: Array<Record<string, unknown>>, options: { uniqueKey?: boolean } = {}) {
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
      const keyOf = (of: Record<string, unknown>) => JSON.stringify([of.type, of.name, of.package_id ?? '', of.bundle_member ?? '']);
      if (options.uniqueKey && [...rows.values()].some((other) => other.id !== id && keyOf(other) === keyOf(updated))) {
        throw new Error('rowStore: UNIQUE constraint failed: sys_metadata.type, name, package_id, bundle_member');
      }
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
  return {
    store,
    packageOf: (id: string) => rows.get(id)?.package_id ?? null,
    memberOf: (id: string) => rows.get(id)?.bundle_member ?? null,
  };
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

/**
 * [#32489, ADR-0150 D4] A bundled type (`email_template`, keyed by `locale`)
 * holds a row per member in one `(package, name)` slot, as `DatabaseLoader.save`
 * writes it (#31699 R4-A). The migration's slot-taken test keys by the member
 * too — the row's `bundle_member` column first, else the member its body
 * declares — so another member's bound row never leaves a free member unbound;
 * a member whose own slot is taken is still left `slot-taken`, never bound
 * over it.
 */
describe('migrateDatabaseLoaderRowPackages — a bundled type\'s slot is per member (#32489)', () => {
  it('derives at least one bundled by-package type, and one that is not', () => {
    expect(BUNDLED.length).toBeGreaterThan(0);
    expect(UNBUNDLED).toBeDefined();
  });

  it.each(BUNDLED)('%s: an unbound member binds beside another member\'s column-bound row of the same name — by its body, or by its `bundle_member` column', async (type) => {
    const { field, canonical } = ITEM_KEY_DISCRIMINATORS[type]!;
    const { store, packageOf } = rowStore([
      row('canonical', type, { name: 'x', [field]: canonical, _packageId: A }, { package_id: A }),
      row('by-body', type, { name: 'x', [field]: 'fr-FR', _packageId: A }),
      row('by-column', type, { name: 'x', _packageId: A }, { bundle_member: 'de-DE' }),
    ]);
    const result = await migrateDatabaseLoaderRowPackages(store);
    expect([packageOf('by-body'), packageOf('by-column')]).toEqual([A, A]);
    expect(result.bound.map((bound) => [bound.id, bound.packageId])).toEqual([['by-body', A], ['by-column', A]]);
    expect(result.left).toEqual([]);
  });

  it.each(BUNDLED)('%s: a member whose own slot is taken is still left `slot-taken` — the canonical one spelled by value or by omission, and a member bound earlier in the same run', async (type) => {
    const { field, canonical } = ITEM_KEY_DISCRIMINATORS[type]!;
    const { store, packageOf } = rowStore([
      row('canonical-bound', type, { name: 'x', _packageId: A }, { package_id: A }),
      row('canonical-legacy', type, { name: 'x', [field]: canonical, _packageId: A }),
      row('fr-bound', type, { name: 'x', [field]: 'fr-FR', _packageId: A }, { package_id: A, bundle_member: 'fr-FR' }),
      row('fr-legacy', type, { name: 'x', [field]: 'fr-FR', _packageId: A }),
      row('de-first', type, { name: 'x', [field]: 'de-DE', _packageId: A }),
      row('de-second', type, { name: 'x', _packageId: A }, { bundle_member: 'de-DE' }),
    ]);
    const result = await migrateDatabaseLoaderRowPackages(store);
    expect([packageOf('canonical-legacy'), packageOf('fr-legacy'), packageOf('de-first'), packageOf('de-second')]).toEqual([null, null, A, null]);
    expect(result.bound.map((bound) => bound.id)).toEqual(['de-first']);
    expect(result.left.map((left) => [left.id, left.reason])).toEqual([
      ['canonical-legacy', 'slot-taken'],
      ['fr-legacy', 'slot-taken'],
      ['de-second', 'slot-taken'],
    ]);
  });

  it(`a type that declares no member keeps one row per slot, whatever its body carries (${UNBUNDLED})`, async () => {
    const { store, packageOf } = rowStore([
      row('bound', UNBUNDLED, { name: 'x', locale: 'en-US', _packageId: A }, { package_id: A }),
      row('legacy', UNBUNDLED, { name: 'x', locale: 'fr-FR', _packageId: A }, { bundle_member: 'fr-FR' }),
    ]);
    const result = await migrateDatabaseLoaderRowPackages(store);
    expect(packageOf('legacy')).toBeNull();
    expect(result.left.map((left) => [left.id, left.reason])).toEqual([['legacy', 'slot-taken']]);
  });
});

/**
 * [#32540, ADR-0150 D4/D6] One package may bind one action name to several
 * objects, and `DatabaseLoader` keeps a row per binding (`bundle_member` names
 * the object). A legacy row of the package on one object is not in the slot
 * of the package's bound row on another object: it is bound beside it.
 * BASE (main 874166b6): the slot was `(package, name)` alone, so the legacy
 * row was left `slot-taken`.
 */
describe('migrateDatabaseLoaderRowPackages: an action\'s slot names the object it is bound to (#32540)', () => {
  it('binds a legacy row of a package\'s action on o1 beside the package\'s bound row on o2, and still leaves a second legacy row on o1', async () => {
    const { store, packageOf } = rowStore([
      row('bound-o2', 'action', { name: 'shared_action', objectName: 'o2', _packageId: A }, { package_id: A, bundle_member: 'o2' }),
      row('legacy-o1', 'action', { name: 'shared_action', objectName: 'o1', _packageId: A }),
      row('legacy-o1-again', 'action', { name: 'shared_action', objectName: 'o1', _packageId: A }),
    ]);
    const result = await migrateDatabaseLoaderRowPackages(store as unknown as IDataDriver);
    expect(result.bound.map((entry) => entry.id)).toEqual(['legacy-o1']);
    expect(result.left).toEqual([{ id: 'legacy-o1-again', type: 'action', name: 'shared_action', reason: 'slot-taken' }]);
    expect(packageOf('legacy-o1')).toBe(A);
  });

  // [#32540 C3; contract record 6820015366 item 1] Rows as every released writer left them: `bundle_member` NULL on all.
  it.each([
    ['the package\'s bound row on o2', { name: 'shared_action', objectName: 'o2', _packageId: A }, 'o2'],
    ['the package\'s object-less row', { name: 'shared_action', _packageId: A }, null],
  ] as const)('with every `bundle_member` NULL under the unique key, a legacy row on o1 beside %s is bound, its object named in the same update, the package\'s row named first (BEFORE this fix: update-failed on the unique key)', async (_shape, body, named) => {
    const { store, packageOf, memberOf } = rowStore([
      row('bound', 'action', body, { package_id: A }),
      row('legacy-o1', 'action', { name: 'shared_action', objectName: 'o1', _packageId: A }),
    ], { uniqueKey: true });
    const result = await migrateDatabaseLoaderRowPackages(store as unknown as IDataDriver);
    expect(result.left).toEqual([]);
    expect(result.bound.map((entry) => entry.id)).toEqual(['legacy-o1']);
    expect([packageOf('legacy-o1'), memberOf('legacy-o1')]).toEqual([A, 'o1']);
    expect(memberOf('bound')).toBe(named);
  });

  it('an object-less legacy row beside the package\'s bound row on o2, every `bundle_member` NULL: the bound row is named o2 first, then the legacy row is bound object-less', async () => {
    const { store, packageOf, memberOf } = rowStore([
      row('bound-o2', 'action', { name: 'shared_action', objectName: 'o2', _packageId: A }, { package_id: A }),
      row('legacy', 'action', { name: 'shared_action', _packageId: A }),
    ], { uniqueKey: true });
    const result = await migrateDatabaseLoaderRowPackages(store as unknown as IDataDriver);
    expect(result).toEqual({ bound: [{ id: 'legacy', type: 'action', name: 'shared_action', packageId: A }], left: [] });
    expect([packageOf('legacy'), memberOf('legacy'), memberOf('bound-o2')]).toEqual([A, null, 'o2']);
  });

  it('C8 — a legacy row bound to an object longer than `bundle_member` stores keeps the object-less place: left `slot-taken` beside the package\'s object-less row, nothing truncated', async () => {
    const long = `o_${'x'.repeat(99)}`;
    const { store, packageOf, memberOf } = rowStore([
      row('bound', 'action', { name: 'shared_action', _packageId: A }, { package_id: A }),
      row('legacy-long', 'action', { name: 'shared_action', objectName: long, _packageId: A }),
    ], { uniqueKey: true });
    const result = await migrateDatabaseLoaderRowPackages(store as unknown as IDataDriver);
    expect(result.left).toEqual([{ id: 'legacy-long', type: 'action', name: 'shared_action', reason: 'slot-taken' }]);
    expect([packageOf('legacy-long'), memberOf('legacy-long')]).toEqual([null, null]);
  });
});
