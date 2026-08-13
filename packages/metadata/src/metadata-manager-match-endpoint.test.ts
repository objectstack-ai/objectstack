// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5089 (#5040 E2) — `MetadataManager.matchEndpoint`, the `metadata` slot's
 * occupant wiring of the endpoint matcher.
 *
 * `endpoint-matcher.test.ts` pins the matching semantics against the contract
 * text. This file pins the WIRING that the unit tests cannot see:
 *
 *   • the index is built from `api`-type items (registry + loaders), lazily;
 *   • every path that mutates the stored set invalidates it — including the
 *     `{ notify: false }` writes the artifact ingest and HMR reload use, which
 *     by construction never reach a `subscribe()` watcher, AND a cluster
 *     peer's write, which reaches watchers ONLY;
 *   • a loader that cannot be read makes `matchEndpoint` THROW rather than
 *     report a miss (`list()` deliberately warns-and-continues; the endpoint
 *     read deliberately does not, because its miss becomes a 404).
 *
 * Nothing here is reachable over HTTP in 17.x: the dispatcher seam is #5090's
 * and publish still rejects a non-empty `apis:` (#4936). These tests drive the
 * service directly, which is the acceptance posture the #5040 design chose
 * ("结构性不可达"): the code is exercised without being exposed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager.js';
import { MemoryLoader } from './loaders/memory-loader.js';
import type { MetadataLoader } from './loaders/loader-interface.js';

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/**
 * A stored `api` item that parses AND passes the identity-free publish gates
 * the index applies since #5189 — `objectParams` is required for an
 * `object_operation` (E7's target gate), so without it the item would be
 * excluded from the index instead of matched.
 */
function endpoint(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'list_tasks',
    path: '/api/v1/apps/showcase/tasks',
    method: 'GET',
    type: 'object_operation',
    target: 'showcase_task',
    objectParams: { object: 'showcase_task', operation: 'find' },
    ...over,
  };
}

const TASKS = { method: 'GET', path: '/api/v1/apps/showcase/tasks' };

describe('#5089 — MetadataManager.matchEndpoint', () => {
  let manager: MetadataManager;

  beforeEach(() => {
    manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
  });

  it('is present on the manager — consumers probe it with `typeof === "function"`', () => {
    expect(typeof manager.matchEndpoint).toBe('function');
  });

  it('answers `undefined` when nothing is declared', async () => {
    await expect(manager.matchEndpoint(TASKS)).resolves.toBeUndefined();
  });

  it('resolves a registered api item, parsed (authRequired defaulted to true)', async () => {
    await manager.register('api', 'list_tasks', endpoint());

    const match = await manager.matchEndpoint(TASKS);
    expect(match?.endpoint.name).toBe('list_tasks');
    expect(match?.endpoint.authRequired).toBe(true);
    expect(match?.params).toEqual({});
  });

  it('resolves an item that only a loader holds (not the in-memory registry)', async () => {
    const loader = new MemoryLoader();
    await loader.save('api', 'list_tasks', endpoint());
    manager.registerLoader(loader);

    const match = await manager.matchEndpoint(TASKS);
    expect(match?.endpoint.name).toBe('list_tasks');
  });

  it('normalizes the request verb — a lower-case method still hits', async () => {
    await manager.register('api', 'list_tasks', endpoint());
    const match = await manager.matchEndpoint({ method: 'get', path: TASKS.path });
    expect(match?.endpoint.name).toBe('list_tasks');
  });

  it('ignores items of other metadata types', async () => {
    await manager.register('action', 'list_tasks', endpoint());
    await expect(manager.matchEndpoint(TASKS)).resolves.toBeUndefined();
  });

  // ── #5189 (#5040 E7b) — the load-time backstop, end to end ─────────────
  //
  // `register()` is route 3 of #5189: a direct metadata write that no publish
  // gate ever sees. Before the backstop it minted an anonymous, zero-quota
  // execution entry point — the runtime honours `authRequired: false` and an
  // unarmed budget meters nothing. It must now MISS.
  describe('#5189 — a directly-registered item that never passed publish', () => {
    it('does not match when it violates ADR-0121 D6 (anonymous + no armed budget)', async () => {
      await manager.register('api', 'open_tasks', endpoint({ name: 'open_tasks', authRequired: false }));
      await expect(manager.matchEndpoint(TASKS)).resolves.toBeUndefined();
    });

    it('matches once the same declaration arms its budget', async () => {
      await manager.register(
        'api',
        'open_tasks',
        endpoint({
          name: 'open_tasks',
          authRequired: false,
          rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 },
        }),
      );
      const match = await manager.matchEndpoint(TASKS);
      expect(match?.endpoint.name).toBe('open_tasks');
      expect(match?.endpoint.authRequired).toBe(false);
    });
  });

  describe('invalidation', () => {
    it('rebuilds after a register() — a newly declared endpoint is matchable', async () => {
      await expect(manager.matchEndpoint(TASKS)).resolves.toBeUndefined();
      await manager.register('api', 'list_tasks', endpoint());
      await expect(manager.matchEndpoint(TASKS)).resolves.toMatchObject({
        endpoint: { name: 'list_tasks' },
      });
    });

    it('rebuilds after an unregister() — a removed endpoint stops matching', async () => {
      await manager.register('api', 'list_tasks', endpoint());
      await expect(manager.matchEndpoint(TASKS)).resolves.toBeDefined();

      await manager.unregister('api', 'list_tasks');
      await expect(manager.matchEndpoint(TASKS)).resolves.toBeUndefined();
    });

    it('rebuilds after an OVERWRITE — the new target is served, not the cached one', async () => {
      await manager.register('api', 'list_tasks', endpoint({ target: 'old_object' }));
      expect((await manager.matchEndpoint(TASKS))?.endpoint.target).toBe('old_object');

      await manager.register('api', 'list_tasks', endpoint({ target: 'new_object' }));
      expect((await manager.matchEndpoint(TASKS))?.endpoint.target).toBe('new_object');
    });

    it('rebuilds after a `{ notify: false }` write — the artifact-ingest / HMR path', async () => {
      // `_parseAndRegisterArtifact` and `_reloadAndAnnounce` both register with
      // notify:false and announce once for the whole batch, so this write never
      // reaches a subscribe() watcher. The index must still go stale.
      await manager.register('api', 'list_tasks', endpoint(), { notify: false });
      await expect(manager.matchEndpoint(TASKS)).resolves.toMatchObject({
        endpoint: { name: 'list_tasks' },
      });
    });

    it('rebuilds after registerInMemory() — the deliberately silent seeding path', async () => {
      manager.registerInMemory('api', 'list_tasks', endpoint());
      await expect(manager.matchEndpoint(TASKS)).resolves.toBeDefined();
    });

    it('rebuilds on a watcher event alone — the cluster peer-replay path', async () => {
      const loader = new MemoryLoader();
      manager.registerLoader(loader);
      await expect(manager.matchEndpoint(TASKS)).resolves.toBeUndefined();

      // Write behind the manager's back, then deliver only the event a remote
      // node's write produces (`attachClusterPubSub` → `notifyWatchersLocal`),
      // which never touches this node's caches directly.
      await loader.save('api', 'list_tasks', endpoint());
      (manager as unknown as { notifyWatchers(t: string, e: unknown): void }).notifyWatchers('api', {
        type: 'changed',
        metadataType: 'api',
        name: 'list_tasks',
        path: '',
        data: undefined,
        timestamp: new Date().toISOString(),
      });

      await expect(manager.matchEndpoint(TASKS)).resolves.toMatchObject({
        endpoint: { name: 'list_tasks' },
      });
    });

    it('a change to another metadata type does not disturb a live index', async () => {
      await manager.register('api', 'list_tasks', endpoint());
      await manager.register('object', 'showcase_task', { name: 'showcase_task' });
      await expect(manager.matchEndpoint(TASKS)).resolves.toBeDefined();
    });
  });

  describe('a stored item that fails to parse is skipped, loudly', () => {
    it('does not break matching of the good items around it', async () => {
      await manager.register('api', 'broken_ep', { name: 'broken_ep', path: '/api/v1/apps/showcase/x' });
      await manager.register('api', 'list_tasks', endpoint());

      await expect(manager.matchEndpoint(TASKS)).resolves.toMatchObject({
        endpoint: { name: 'list_tasks' },
      });
      await expect(manager.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/x' }))
        .resolves.toBeUndefined();
    });
  });

  describe('duplicate claims resolve deterministically', () => {
    it('lexicographically-first `name` keeps the route', async () => {
      await manager.register('api', 'zeta_tasks', endpoint({ name: 'zeta_tasks', target: 'z' }));
      await manager.register('api', 'alpha_tasks', endpoint({ name: 'alpha_tasks', target: 'a' }));

      const match = await manager.matchEndpoint(TASKS);
      expect(match?.endpoint.name).toBe('alpha_tasks');
      expect(match?.endpoint.target).toBe('a');
    });
  });

  describe('an unreadable store THROWS — it must not masquerade as a 404', () => {
    /** A loader whose plural read fails, the way a real store outage looks. */
    function brokenLoader(): MetadataLoader {
      return {
        contract: {
          name: 'broken',
          protocol: 'datasource:',
          capabilities: { read: true, write: false },
        },
        async load() { throw new Error('sys_metadata unreachable'); },
        async loadMany() { throw new Error('sys_metadata unreachable'); },
        async exists() { return false; },
        async stat() { return null; },
        async list() { return []; },
      } as unknown as MetadataLoader;
    }

    it('matchEndpoint rejects when a loader cannot be read', async () => {
      manager.registerLoader(brokenLoader());
      await expect(manager.matchEndpoint(TASKS)).rejects.toThrow('sys_metadata unreachable');
    });

    it('…even when other loaders answered — a partial read cannot prove absence', async () => {
      const good = new MemoryLoader();
      await good.save('api', 'list_tasks', endpoint());
      manager.registerLoader(good);
      manager.registerLoader(brokenLoader());

      await expect(manager.matchEndpoint(TASKS)).rejects.toThrow('sys_metadata unreachable');
    });

    it('contrast: plain list() still degrades gracefully — only the endpoint read is strict', async () => {
      manager.registerLoader(brokenLoader());
      await expect(manager.list('api')).resolves.toEqual([]);
    });
  });
});
