// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3112 — `register()` / `unregister()` announce to `subscribe()` watchers.
 *
 * Before this contract existed, `register()` updated the registry, persisted to
 * writable loaders and published to realtime, but never called
 * `notifyWatchers()`. `subscribe()` therefore looked like it covered every
 * write while silently missing all of them — ObjectQL's SchemaRegistry bridge
 * (the component that keeps queryable schemas in sync) never heard about
 * anything registered at runtime, and served the pre-write definition until
 * the process restarted.
 *
 * These tests pin both halves of the contract: announcing is the DEFAULT, and
 * silence is only ever opt-in.
 *
 * [#6043] The "announces AFTER the write lands" case below used to assert an
 * ORDERING guarantee by awaiting `get()` inside the callback and reading the
 * result back after `register()` resolved. `notifyWatchers` dispatches with
 * `void callback(event)` and never awaits its handlers, so what that shape
 * actually measured was how many `await` hops `get()` happens to have — fewer
 * than the microtasks `await register(...)` yields, and the assertion passed.
 * It was a real cost, not a theoretical one: #5840 abandoned an equivalent,
 * tidier `getDiagnosed` delegation in `get()` because this case went red on it,
 * and kept three duplicated lines to preserve the frame count. Measured the
 * other way, hoisting the announcement above the realtime publish and the
 * writable-loader save loop — a violation of the ordering `register()`
 * documents — left the case fully GREEN. The invariant is worth pinning; the
 * shape could not pin it. It is now asserted where the ordering is decided:
 * SYNCHRONOUSLY, inside the callback, against the registry `register()` writes.
 *
 * Scope note: `register()` claims the announcement follows the write into the
 * registry AND into every writable loader. Only the registry half is pinned
 * here — this fixture's `MemoryLoader` declares `memory:`, and `register()`
 * persists to `datasource:` loaders only, so no loader in this file is ever
 * written to and the second half is not observable from it. Tracked separately;
 * it needs a writable-datasource fixture rather than another assertion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager';
import { MemoryLoader } from './loaders/memory-loader';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

vi.mock('@objectstack/core', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/**
 * [#6043] Peek at the manager's private in-memory registry — the state
 * `register()` writes FIRST and the one every re-reading subscriber resolves
 * against (it outranks every loader in `get()`). Internal by design, and
 * load-bearing here precisely because it is the only observation that is
 * immune to `get()`'s implementation: the ordering claim must not be restated
 * in terms of the method whose refactors keep breaking it. Same narrow cast the
 * sibling internal-state peeks use (`metadata-manager-unregister-invalidate-order.test.ts`).
 */
type InternalRegistry = Map<string, Map<string, unknown>>;
const registryOf = (mgr: MetadataManager): InternalRegistry =>
  (mgr as unknown as { registry: InternalRegistry }).registry;
const registryHas = (mgr: MetadataManager, type: string, name: string): boolean =>
  registryOf(mgr).get(type)?.has(name) ?? false;
const registryPeek = (mgr: MetadataManager, type: string, name: string): unknown =>
  registryOf(mgr).get(type)?.get(name);

describe('#3112 — register()/unregister() notify subscribe() watchers', () => {
  let manager: MetadataManager;

  beforeEach(() => {
    manager = new MetadataManager({
      formats: ['json'],
      loaders: [new MemoryLoader()],
    });
    manager.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);
  });

  describe('register()', () => {
    it('announces a first registration as "added"', async () => {
      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.register('object', 'account', { name: 'account', label: 'Account' });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        type: 'added',
        metadataType: 'object',
        name: 'account',
        data: { name: 'account', label: 'Account' },
      });
    });

    it('announces an overwrite as "changed", carrying the NEW body', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'V1' });

      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.register('object', 'account', { name: 'account', label: 'V2' });

      expect(seen).toHaveLength(1);
      expect(seen[0].type).toBe('changed');
      expect(seen[0].data).toEqual({ name: 'account', label: 'V2' });
    });

    it('announces AFTER the write lands — the registry already holds the new body at broadcast time', async () => {
      // [#6043] The literal reading of the method's promise, asserted at the one
      // instant it is decidable: the moment the callback runs. Everything here is
      // synchronous, so no `await` hop of any consumer method can move the
      // verdict — hoist the announcement above the write and this reads
      // `{ had: false }`, which is what the regression looks like.
      const atBroadcast: Array<{ had: boolean; body: unknown }> = [];
      manager.subscribe('object', () => {
        atBroadcast.push({
          had: registryHas(manager, 'object', 'account'),
          body: registryPeek(manager, 'object', 'account'),
        });
      });

      await manager.register('object', 'account', { name: 'account', label: 'Fresh' });

      expect(atBroadcast).toHaveLength(1);
      expect(atBroadcast[0].had).toBe(true);
      expect(atBroadcast[0].body).toEqual({ name: 'account', label: 'Fresh' });
    });

    it('announces AFTER the write lands on an OVERWRITE too — never with the pre-write body still in place', async () => {
      // [#6043] The overwrite half exists so the failure is READABLE. On a first
      // registration an early announcement and an unsettled promise both surface
      // as `undefined`; here the pre-write body is a distinct value, so
      // announcing too early fails with 'V1' where 'V2' was required and names
      // the defect on sight.
      await manager.register('object', 'account', { name: 'account', label: 'V1' }, { notify: false });

      let bodyAtBroadcast: unknown;
      manager.subscribe('object', () => {
        bodyAtBroadcast = registryPeek(manager, 'object', 'account');
      });

      await manager.register('object', 'account', { name: 'account', label: 'V2' });

      expect(bodyAtBroadcast).toEqual({ name: 'account', label: 'V2' });
    });

    it('a subscriber that re-reads through get() sees the new body — awaited, not raced', async () => {
      // [#6043] The consumer-shaped half of the same guarantee: ObjectQL's bridge
      // re-reads via get() on the event rather than trusting the payload. The
      // subscriber's promise is CAPTURED and awaited by the test, because
      // `notifyWatchers` dispatches with `void callback(event)` — nothing else
      // ever awaits it, so an assertion that just reads a variable afterwards is
      // asserting against `get()`'s frame count instead of against the read.
      const reads: Promise<unknown>[] = [];
      manager.subscribe('object', () => {
        reads.push(manager.get('object', 'account'));
      });

      await manager.register('object', 'account', { name: 'account', label: 'Fresh' });

      expect(reads).toHaveLength(1);
      await expect(reads[0]).resolves.toEqual({ name: 'account', label: 'Fresh' });
    });

    it('is silent when the caller opts out with { notify: false }', async () => {
      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.register('object', 'account', { name: 'account' }, { notify: false });

      expect(seen).toHaveLength(0);
      // Silence must not mean "skipped" — the write still landed.
      expect(await manager.get('object', 'account')).toEqual({ name: 'account' });
    });

    it('only notifies watchers of the written type', async () => {
      const objects: any[] = [];
      const views: any[] = [];
      manager.subscribe('object', (evt) => objects.push(evt));
      manager.subscribe('view', (evt) => views.push(evt));

      await manager.register('object', 'account', { name: 'account' });

      expect(objects).toHaveLength(1);
      expect(views).toHaveLength(0);
    });

    it('does not notify when the write is refused (persistence.writable=false)', async () => {
      const readOnly = new MetadataManager({
        formats: ['json'],
        loaders: [new MemoryLoader()],
        persistence: { writable: false },
      });
      readOnly.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);

      const seen: any[] = [];
      readOnly.subscribe('object', (evt) => seen.push(evt));

      await readOnly.register('object', 'account', { name: 'account' });

      expect(seen).toHaveLength(0);
    });

    it('survives a throwing subscriber without failing the write', async () => {
      manager.subscribe('object', () => {
        throw new Error('subscriber blew up');
      });

      await expect(
        manager.register('object', 'account', { name: 'account' }),
      ).resolves.toBeUndefined();
      expect(await manager.get('object', 'account')).toEqual({ name: 'account' });
    });

    it('stops notifying after unsubscribe', async () => {
      const seen: any[] = [];
      const off = manager.subscribe('object', (evt) => seen.push(evt));

      await manager.register('object', 'a', { name: 'a' });
      off();
      await manager.register('object', 'b', { name: 'b' });

      expect(seen).toHaveLength(1);
      expect(seen[0].name).toBe('a');
    });
  });

  describe('unregister()', () => {
    it('announces a removal as "deleted"', async () => {
      await manager.register('object', 'account', { name: 'account' });

      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.unregister('object', 'account');

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        type: 'deleted',
        metadataType: 'object',
        name: 'account',
      });
    });

    it('is silent when the caller opts out with { notify: false }', async () => {
      await manager.register('object', 'account', { name: 'account' }, { notify: false });

      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.unregister('object', 'account', { notify: false });

      expect(seen).toHaveLength(0);
      expect(await manager.get('object', 'account')).toBeUndefined();
    });
  });

  describe('bulk forms', () => {
    it('bulkRegister announces one event per item by default', async () => {
      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.bulkRegister([
        { type: 'object', name: 'a', data: { name: 'a' } },
        { type: 'object', name: 'b', data: { name: 'b' } },
      ]);

      expect(seen.map((e) => e.name)).toEqual(['a', 'b']);
    });

    it('bulkRegister forwards { notify: false } to every item', async () => {
      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.bulkRegister(
        [
          { type: 'object', name: 'a', data: { name: 'a' } },
          { type: 'object', name: 'b', data: { name: 'b' } },
        ],
        { notify: false },
      );

      expect(seen).toHaveLength(0);
      expect(await manager.get('object', 'a')).toEqual({ name: 'a' });
    });

    it('bulkUnregister announces one deleted event per item', async () => {
      await manager.bulkRegister(
        [
          { type: 'object', name: 'a', data: { name: 'a' } },
          { type: 'object', name: 'b', data: { name: 'b' } },
        ],
        { notify: false },
      );

      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.bulkUnregister([
        { type: 'object', name: 'a' },
        { type: 'object', name: 'b' },
      ]);

      expect(seen.map((e) => e.type)).toEqual(['deleted', 'deleted']);
    });
  });

  describe('unregisterPackage()', () => {
    it('announces every removed item, so cached consumers drop the uninstalled schemas', async () => {
      // Latent today — nothing calls unregisterPackage() in production — but it
      // is the shape the silent write path would have broken: the objects leave
      // the registry while ObjectQL's SchemaRegistry bridge, never hearing a
      // 'deleted' event, keeps resolving them until the process restarts.
      await manager.register('object', 'crm_account', { name: 'crm_account', packageId: 'com.acme.crm' }, { notify: false });
      await manager.register('object', 'crm_contact', { name: 'crm_contact', packageId: 'com.acme.crm' }, { notify: false });
      await manager.register('object', 'other', { name: 'other', packageId: 'com.other' }, { notify: false });

      const seen: any[] = [];
      manager.subscribe('object', (evt) => seen.push(evt));

      await manager.unregisterPackage('com.acme.crm');

      expect(seen.map((e) => e.name).sort()).toEqual(['crm_account', 'crm_contact']);
      expect(seen.every((e) => e.type === 'deleted')).toBe(true);
      // The untouched package must not be announced (or removed).
      expect(await manager.get('object', 'other')).toMatchObject({ name: 'other' });
    });
  });

  describe('registerInMemory()', () => {
    it('stays silent by design (GitOps-owned artefacts, documented on the method)', async () => {
      const seen: any[] = [];
      manager.subscribe('datasource', (evt) => seen.push(evt));

      manager.registerInMemory('datasource', 'crm_db', { name: 'crm_db', origin: 'code' });

      expect(seen).toHaveLength(0);
      expect(await manager.get('datasource', 'crm_db')).toMatchObject({ name: 'crm_db' });
    });
  });
});
