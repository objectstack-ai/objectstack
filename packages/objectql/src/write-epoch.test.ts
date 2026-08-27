// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11968] The engine-seam write epoch — the invalidation substrate of the
 * ruled #11633 caching design (§2.1, §3; maintainer acceptance 2026-08-25).
 *
 * Two things are pinned here, and the second is the half that a substrate card
 * most easily ships without:
 *
 *  1. **The seam covers the writes and only the writes.** `insert` / `update` /
 *     `delete` advance the counter; every read verb leaves it alone. The
 *     covered set is the one `executeWithMiddleware` sees, which is what makes
 *     it un-forgettable rather than a list somebody maintains.
 *  2. ⭐ **Runtime behaviour is unchanged while there are no consumers.** That
 *     is the card's own acceptance criterion, and it is asserted rather than
 *     described: a freshly-initialised engine has ZERO epoch subscribers and no
 *     `authz.invalidated` binding, so the substrate publishes nothing, drops
 *     nothing and cannot change a query multiset. A counter nobody reads is the
 *     whole of the observable difference this card lands.
 *
 * ⚠️ The bump is asserted through the ENGINE, not by calling `WriteEpoch`
 * directly, for the same reason #11633 §2.1 chose a seam over a call-site list:
 * the claim is about where the counter is wired, and a unit test of the counter
 * cannot fail when the wiring moves. The unit-level cases below cover the
 * counter's own contract only, and are labelled as such.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import {
  WriteEpoch,
  WRITE_EPOCH_OPERATIONS,
  isWriteEpochLike,
  isWriteEpochOperation,
} from './write-epoch.js';

/** Owning package id — `registerObject` requires one; it is not optional. */
const WRITE_EPOCH_TEST_PACKAGE = 'os-write-epoch-test';

const epochObject = {
  name: 'epoch_task',
  label: 'Task',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

const otherObject = {
  name: 'epoch_other',
  label: 'Other',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

/**
 * A minimal store-backed driver. Its WHERE matcher **refuses** anything it does
 * not implement instead of skipping it: a `$`-prefixed combinator read as a
 * field name is the silently-wrong shape hand-written matchers keep landing in,
 * and this file has no need of one — every predicate below is `{ id }`.
 */
function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) {
      s = new Map();
      stores.set(obj, s);
    }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (where === undefined || where === null) return true;
    if (typeof where !== 'object') {
      throw new Error(`epoch stub driver: unsupported WHERE ${String(where)}`);
    }
    for (const [k, v] of Object.entries(where as Record<string, unknown>)) {
      if (k.startsWith('$')) {
        throw new Error(`epoch stub driver: combinator "${k}" is not supported`);
      }
      if (v !== null && typeof v === 'object') {
        throw new Error(`epoch stub driver: operator object on "${k}" is not supported`);
      }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory',
    version: '0.0.0',
    supports: {} as any,
    async connect() {},
    async disconnect() {},
    async checkHealth() {
      return true;
    },
    async execute() {
      return null;
    },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The caller's bound is applied AFTER the filter, by PRESENCE — a double
      // that silently drops `limit` answers a different question than the
      // engine asked, and every assertion built on it reads as evidence.
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return next;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) {
      return storeFor(object).delete(id);
    },
    async count(object: string, ast: any) {
      return (await this.find(object, ast)).length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() {
      return [];
    },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() {
      return { commit: async () => {}, rollback: async () => {} };
    },
    async commit() {},
    async rollback() {},
  };
  return driver;
}

describe('[#11968] the engine seam advances the write epoch', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(makeStubDriver(), true);
    await engine.init();
    engine.registry.registerObject(epochObject, WRITE_EPOCH_TEST_PACKAGE);
    engine.registry.registerObject(otherObject, WRITE_EPOCH_TEST_PACKAGE);
  });

  it('starts at zero and exposes the substrate surface', () => {
    expect(engine.writeEpoch.current).toBe(0);
    expect(isWriteEpochLike(engine.writeEpoch)).toBe(true);
  });

  it('insert, update and delete each advance it exactly once', async () => {
    const row: any = await engine.insert('epoch_task', { title: 'a' });
    expect(engine.writeEpoch.current).toBe(1);

    await engine.update('epoch_task', { title: 'b' }, { where: { id: row.id } });
    expect(engine.writeEpoch.current).toBe(2);

    await engine.delete('epoch_task', { where: { id: row.id } });
    expect(engine.writeEpoch.current).toBe(3);
  });

  it('no read verb advances it — a cache that never hits is not a tightening', async () => {
    const row: any = await engine.insert('epoch_task', { title: 'a' });
    const afterWrite = engine.writeEpoch.current;

    await engine.find('epoch_task');
    await engine.findOne('epoch_task', { where: { id: row.id } });
    await engine.count('epoch_task');

    expect(engine.writeEpoch.current).toBe(afterWrite);
  });

  it('advances even when a middleware REFUSES the write', async () => {
    // The bump is ahead of the whole chain on purpose: a refusal is still a
    // point at which the answer to "may this caller do that" may have moved,
    // and `plugin-security`'s own bump sat ahead of its `isSystem` bypass for
    // the same reason. An epoch that only advanced on writes that SUCCEEDED
    // would be a seam with a hole exactly where a permission check lives.
    engine.registerMiddleware(async () => {
      throw new Error('refused by middleware');
    });

    await expect(engine.insert('epoch_task', { title: 'a' })).rejects.toThrow(/refused/);
    expect(engine.writeEpoch.current).toBe(1);
  });

  it('advances for an object no middleware is registered for', async () => {
    // ⛔ The regression this pins: moving the bump below the `applicable`
    // filter. That filter selects middleware BY OBJECT, so an epoch computed
    // after it would advance only when somebody happened to register a
    // middleware for the written object — un-missable turned into
    // conditionally-missing, with every existing test still green.
    engine.registerMiddleware(
      async (_ctx: any, next: () => Promise<void>) => {
        await next();
      },
      { object: 'epoch_other' },
    );

    await engine.insert('epoch_task', { title: 'a' });
    expect(engine.writeEpoch.current).toBe(1);
  });
});

describe('[#11968] ⭐ with no consumers, the substrate is inert', () => {
  // The acceptance criterion of this card, as an assertion rather than a
  // sentence: substrate landed, no cache built, runtime behaviour unchanged.
  it('a fresh engine has no epoch subscriber and no cluster binding', async () => {
    const engine = new ObjectQL();
    engine.registerDriver(makeStubDriver(), true);
    await engine.init();
    engine.registry.registerObject(epochObject, WRITE_EPOCH_TEST_PACKAGE);

    expect(engine.writeEpoch.listenerCount).toBe(0);

    await engine.insert('epoch_task', { title: 'a' });

    // The counter moved; nothing observed it, so nothing was published and
    // nothing was invalidated. That is the entire observable delta of this card.
    expect(engine.writeEpoch.current).toBe(1);
    expect(engine.writeEpoch.listenerCount).toBe(0);
  });

  it('detaching a bridge that was never attached is a no-op', () => {
    const engine = new ObjectQL();
    expect(() => engine.detachAuthzInvalidationPubSub()).not.toThrow();
  });
});

describe('[#11968] the counter contract (unit level)', () => {
  it('is monotonic and reports the new value', () => {
    const epoch = new WriteEpoch();
    expect(epoch.current).toBe(0);
    expect(epoch.bump('write')).toBe(1);
    expect(epoch.bump('metadata')).toBe(2);
    expect(epoch.current).toBe(2);
  });

  it('notifies subscribers with the POST-bump value', () => {
    const epoch = new WriteEpoch();
    const seen: Array<[number, string]> = [];
    epoch.subscribe((n, reason) => seen.push([n, reason]));
    epoch.bump('write');
    epoch.bump('remote');
    expect(seen).toEqual([
      [1, 'write'],
      [2, 'remote'],
    ]);
  });

  it('a throwing subscriber does not fail the write, and the epoch still moved', () => {
    const epoch = new WriteEpoch();
    const other: number[] = [];
    epoch.subscribe(() => {
      throw new Error('bridge exploded');
    });
    epoch.subscribe((n) => other.push(n));

    expect(() => epoch.bump('write')).not.toThrow();
    expect(epoch.current).toBe(1);
    // The second subscriber still ran — one bad listener does not strand the
    // rest, which is what makes over-invalidation the worst case here.
    expect(other).toEqual([1]);
  });

  it('unsubscribe is idempotent and really stops delivery', () => {
    const epoch = new WriteEpoch();
    const seen: number[] = [];
    const off = epoch.subscribe((n) => seen.push(n));
    epoch.bump('write');
    off();
    off();
    epoch.bump('write');
    expect(seen).toEqual([1]);
    expect(epoch.listenerCount).toBe(0);
  });

  it('the counted operations are the three write verbs, and nothing else', () => {
    expect([...WRITE_EPOCH_OPERATIONS].sort()).toEqual(['delete', 'insert', 'update']);
    for (const op of ['insert', 'update', 'delete']) {
      expect(isWriteEpochOperation(op)).toBe(true);
    }
    for (const op of ['find', 'findOne', 'count', 'aggregate', '', undefined, null, 7]) {
      expect(isWriteEpochOperation(op)).toBe(false);
    }
  });

  it('isWriteEpochLike refuses a partial shape', () => {
    expect(isWriteEpochLike(null)).toBe(false);
    expect(isWriteEpochLike({ current: 0 })).toBe(false);
    expect(isWriteEpochLike({ current: 0, bump: () => 1 })).toBe(false);
    expect(isWriteEpochLike({ current: 0, bump: () => 1, subscribe: () => () => {} })).toBe(true);
  });
});
