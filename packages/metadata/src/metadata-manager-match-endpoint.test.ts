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
import { PackageScopedNameRefusedError } from '@objectstack/core';
import { MetadataManager } from './metadata-manager.js';
import { PACKAGE_SLOTTED_STORE_TYPES } from './package-slotted-store.js';
import { MemoryLoader } from './loaders/memory-loader.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import type { MetadataLoader } from './loaders/loader-interface.js';
import { MetadataEventType } from '@objectstack/spec/api';
import type { IDataDriver, IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import type { MetadataWatchEvent } from '@objectstack/spec/system';

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

/**
 * [ADR-0150 D4, child E6] The index's item list keeps one slot per
 * `(package, name)`, not per bare name: a bare-name map let one package's
 * stored `api` item overwrite another package's same-named item before the
 * matcher ever saw it. A package-less row under a name one package holds is
 * that holder's customization and shares its slot (D4).
 */
describe('the endpoint index keeps one slot per (package, name) (ADR-0150 D4)', () => {
  /** A store whose keyed read answers the given rows, in order, the way `sys_metadata` does. */
  function storeOf(rows: Array<{ name: string; data: Record<string, unknown> }>): MetadataLoader {
    return {
      contract: { name: 'rows', protocol: 'datasource:', capabilities: { read: true, write: false } },
      async load() { return { data: null }; },
      async loadMany(type: string) { return type === 'api' ? rows.map((r) => r.data) : []; },
      async loadManyKeyed(type: string) { return type === 'api' ? rows : []; },
      async exists() { return false; },
      async stat() { return null; },
      async list() { return []; },
    } as unknown as MetadataLoader;
  }
  const A_PATH = { method: 'GET', path: '/api/v1/apps/alpha/tasks' };
  const B_PATH = { method: 'GET', path: '/api/v1/apps/beta/tasks' };

  it('serves two packages\' same-named api items, each on its own route', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(storeOf([
      { name: 'list_tasks', data: { ...endpoint({ path: A_PATH.path, target: 'a' }), packageId: 'com.acme.alpha' } },
      { name: 'list_tasks', data: { ...endpoint({ path: B_PATH.path, target: 'b' }), packageId: 'com.acme.beta' } },
    ]));
    expect((await manager.matchEndpoint(A_PATH))?.endpoint.target).toBe('a');
    expect((await manager.matchEndpoint(B_PATH))?.endpoint.target).toBe('b');
  });

  it('CONTROL — a package-less row under a name one package holds shares that holder\'s slot: the first one read keeps it', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(storeOf([
      { name: 'list_tasks', data: { ...endpoint({ path: A_PATH.path, target: 'customized' }) } },
      { name: 'list_tasks', data: { ...endpoint({ path: B_PATH.path, target: 'shipped' }), packageId: 'com.acme.alpha' } },
    ]));
    expect((await manager.matchEndpoint(A_PATH))?.endpoint.target).toBe('customized');
    expect(await manager.matchEndpoint(B_PATH)).toBeUndefined();
  });

  it('CONTROL — an environment-authored row whose name no package holds is served', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(storeOf([{ name: 'list_tasks', data: endpoint({ path: A_PATH.path, target: 'env' }) }]));
    expect((await manager.matchEndpoint(A_PATH))?.endpoint.target).toBe('env');
  });
});

/**
 * [ADR-0150 D3/D4, #32069] The in-memory store keeps one slot per
 * `(package, name)` for `api`, so the index above sees every package's item.
 * On main ff04ad81 the store was keyed by bare name: the second package's
 * `registerInMemory('api', NAME, …)` overwrote the first's, the first
 * package's path answered 404, and `get` answered the survivor whatever
 * package the read named. The items are stamped the way the boot registrar
 * stamps them (`applyProtection`: `_packageId`).
 */
describe('the in-memory api store keeps one slot per (package, name) (ADR-0150 D4, #32069)', () => {
  const A_PATH = { method: 'GET', path: '/api/v1/apps/alpha/feed' };
  const B_PATH = { method: 'GET', path: '/api/v1/apps/beta/feed' };
  const shipped = (packageId: string, path: string, target: string) =>
    endpoint({ name: 'feed', path, target, _packageId: packageId, _provenance: 'package' });

  function twoHolders(): MetadataManager {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('api', 'feed', shipped('com.acme.alpha', A_PATH.path, 'a'));
    manager.registerInMemory('api', 'feed', shipped('com.acme.beta', B_PATH.path, 'b'));
    return manager;
  }

  it('serves both packages\' endpoints, each on its own path (BASE: the first package\'s path answered nothing)', async () => {
    const manager = twoHolders();
    expect((await manager.matchEndpoint(A_PATH))?.endpoint.target).toBe('a');
    expect((await manager.matchEndpoint(B_PATH))?.endpoint.target).toBe('b');
  });

  // [#31700] The API narrowed to one holder per namespace: two namespaces may
  // each publish an api of one name. The publish gate puts each path under
  // `/api/v1/apps/<namespace>/` (`apis-publish-gates.test.ts`: "rejects a path
  // under ANOTHER package's namespace"), so their routes differ and the
  // matcher's duplicate-claim rule is never reached between them.
  const duplicateClaims = (manager: MetadataManager) =>
    (manager as unknown as { logger: { error: ReturnType<typeof vi.fn> } }).logger.error.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('duplicate endpoint claim'));

  it('[#31700] two namespaces\' same-named apis are both indexed, each on its own path, with no duplicate claim', async () => {
    const manager = twoHolders();
    expect((await manager.matchEndpoint(A_PATH))?.endpoint.target).toBe('a');
    expect((await manager.matchEndpoint(B_PATH))?.endpoint.target).toBe('b');
    expect(duplicateClaims(manager)).toEqual([]);
  });

  it('CONTROL — the same two items on ONE path is a duplicate claim, announced at error', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('api', 'feed', shipped('com.acme.alpha', A_PATH.path, 'a'));
    manager.registerInMemory('api', 'feed', shipped('com.acme.beta', A_PATH.path, 'b'));
    expect((await manager.matchEndpoint(A_PATH))?.endpoint.target).toBeDefined();
    expect(duplicateClaims(manager)).toHaveLength(1);
  });

  it('a read naming a package answers that package\'s item, both faces alike; a package holding no slot answers nothing', async () => {
    const manager = twoHolders();
    expect(((await manager.get('api', 'feed', 'com.acme.alpha')) as any)?.target).toBe('a');
    expect(((await manager.get('api', 'feed', 'com.acme.beta')) as any)?.target).toBe('b');
    expect(((await manager.getDiagnosed('api', 'feed', 'com.acme.alpha')).data as any)?.target).toBe('a');
    expect(await manager.get('api', 'feed', 'com.acme.gamma'), 'never another package\'s item').toBeUndefined();
    expect(await manager.getDiagnosed('api', 'feed', 'com.acme.gamma')).toEqual({ data: undefined, degraded: false, errors: [] });
  });

  it('a read naming no package of a two-holder name is refused naming both (D3), never one of them picked', async () => {
    const manager = twoHolders();
    for (const read of [() => manager.get('api', 'feed'), () => manager.getDiagnosed('api', 'feed')]) {
      const err = await read().then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
      expect(err, 'the read refuses').toBeInstanceOf(PackageScopedNameRefusedError);
      expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
      expect(err!.refusal.candidates).toEqual([
        { kind: 'package', packageId: 'com.acme.alpha' },
        { kind: 'package', packageId: 'com.acme.beta' },
      ]);
    }
  });

  it('enumerates both items under the one name; unregisterPackage drops only its own slot; unregister drops every slot', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('api', 'feed', { ...shipped('com.acme.alpha', A_PATH.path, 'a'), packageId: 'com.acme.alpha' });
    manager.registerInMemory('api', 'feed', { ...shipped('com.acme.beta', B_PATH.path, 'b'), packageId: 'com.acme.beta' });
    expect(((await manager.list('api')) as any[]).map((i) => i.target)).toEqual(['a', 'b']);
    expect(await manager.listNames('api')).toEqual(['feed']);
    expect(await manager.exists('api', 'feed')).toBe(true);
    await manager.unregisterPackage('com.acme.alpha');
    expect(((await manager.list('api')) as any[]).map((i) => i.target)).toEqual(['b']);
    expect(await manager.matchEndpoint(A_PATH)).toBeUndefined();
    expect((await manager.matchEndpoint(B_PATH))?.endpoint.target).toBe('b');
    await manager.unregister('api', 'feed');
    expect(await manager.exists('api', 'feed')).toBe(false);
  });

  describe('CONTROL — one holder per name: the store holds and answers the one item the bare-name map did', () => {
    it('one package\'s item is answered to every read, the very object registered', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      const item = shipped('com.acme.alpha', A_PATH.path, 'a');
      manager.registerInMemory('api', 'feed', item);
      expect(await manager.get('api', 'feed')).toBe(item);
      expect(await manager.get('api', 'feed', 'com.acme.alpha')).toBe(item);
      expect(await manager.list('api')).toEqual([item]);
      expect((await manager.matchEndpoint(A_PATH))?.endpoint.target).toBe('a');
    });

    it('a package-less write of the held name replaces the holder\'s item (its customization, D4), as the bare-name map did', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      manager.registerInMemory('api', 'feed', shipped('com.acme.alpha', A_PATH.path, 'shipped'));
      const custom = endpoint({ name: 'feed', path: A_PATH.path, target: 'custom' });
      await manager.register('api', 'feed', custom);
      expect(await manager.get('api', 'feed')).toBe(custom);
      expect(await manager.get('api', 'feed', 'com.acme.alpha')).toBe(custom);
      expect(await manager.list('api')).toEqual([custom]);
    });

    it('a package\'s write of a name the environment authored replaces it, as the bare-name map did', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      manager.registerInMemory('api', 'feed', endpoint({ name: 'feed', path: A_PATH.path, target: 'env' }));
      const item = shipped('com.acme.alpha', A_PATH.path, 'a');
      manager.registerInMemory('api', 'feed', item);
      expect(await manager.list('api')).toEqual([item]);
      expect(await manager.get('api', 'feed')).toBe(item);
    });

    it('an environment-authored item no package holds is answered to a read naming none or any package', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      const item = endpoint({ name: 'feed', path: A_PATH.path, target: 'env' });
      manager.registerInMemory('api', 'feed', item);
      expect(await manager.get('api', 'feed')).toBe(item);
      expect(await manager.get('api', 'feed', 'com.acme.alpha')).toBe(item);
    });
  });

  it('a type outside the slotted set keeps one item per name: the later write replaces the earlier', async () => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerInMemory('flow', 'f', { name: 'f', _packageId: 'com.acme.alpha' });
    const later = { name: 'f', _packageId: 'com.acme.beta' };
    manager.registerInMemory('flow', 'f', later);
    expect(await manager.get('flow', 'f')).toBe(later);
    expect(await manager.list('flow')).toEqual([later]);
  });
});

/**
 * [ADR-0150 D3/D4, #32151] The in-memory store keeps one slot per
 * `(package, name)` for every type whose one-holder rule has narrowed to the
 * namespace — `agent` and `skill` (objectql's
 * `NAMESPACE_SCOPED_BARE_NAME_TYPES`, #31701; objectql pins that set a subset
 * of `PACKAGE_SLOTTED_STORE_TYPES`), and [#31700] the picklist family's
 * `picklist`, `mapping` and `dataset` (`api` has its own describe above, the
 * object-less `action` its own file). Two packages of two namespaces may each
 * install such a name, and the artifact door registers every package body's
 * items here through `register(…, { notify: false })`, stamped by
 * `applyProtection` (`_packageId`). On main 45f0f81f the store was keyed by
 * bare name for these types: the second package's register overwrote the
 * first's, and every read — the one naming the first package included — was
 * answered the survivor.
 */
describe('the in-memory store keeps one slot per (package, name) for every namespace-scoped type (ADR-0150 D4, #32151)', () => {
  const NAMESPACE_SCOPED = ['agent', 'skill', 'picklist', 'mapping', 'dataset'] as const;
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  const shipped = (type: string, packageId: string, tag: string, envelope = false) => ({
    name: `shared_${type}`,
    label: `${tag} ${type}`,
    instructions: `${tag} instructions`,
    _packageId: packageId,
    _provenance: 'package',
    ...(envelope ? { packageId } : {}),
  });

  async function twoHolders(type: string, envelope = false): Promise<MetadataManager> {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    await manager.register(type, `shared_${type}`, shipped(type, A, 'alpha', envelope), { notify: false });
    await manager.register(type, `shared_${type}`, shipped(type, B, 'beta', envelope), { notify: false });
    return manager;
  }

  it('the slotted set holds every namespace-scoped type', () => {
    for (const type of NAMESPACE_SCOPED) expect(PACKAGE_SLOTTED_STORE_TYPES.has(type), type).toBe(true);
  });

  it.each(NAMESPACE_SCOPED)('%s: a read naming a package answers that package\'s own item, both faces alike; a package holding no slot answers nothing (BASE: both packages were answered the later one)', async (type) => {
    const manager = await twoHolders(type);
    const name = `shared_${type}`;
    expect(((await manager.get(type, name, A)) as any)?.label).toBe(`alpha ${type}`);
    expect(((await manager.get(type, name, B)) as any)?.label).toBe(`beta ${type}`);
    expect(((await manager.getDiagnosed(type, name, A)).data as any)?.label).toBe(`alpha ${type}`);
    expect(((await manager.getDiagnosed(type, name, B)).data as any)?.label).toBe(`beta ${type}`);
    expect(await manager.get(type, name, 'com.acme.gamma'), 'never another package\'s item').toBeUndefined();
  });

  it.each(NAMESPACE_SCOPED)('%s: a read naming no package of a two-holder name is refused naming both (D3), never one of them picked (BASE: the later one was served)', async (type) => {
    const manager = await twoHolders(type);
    const name = `shared_${type}`;
    for (const read of [() => manager.get(type, name), () => manager.getDiagnosed(type, name)]) {
      const err = await read().then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
      expect(err, 'the read refuses').toBeInstanceOf(PackageScopedNameRefusedError);
      expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
      expect(err!.refusal.candidates).toEqual([
        { kind: 'package', packageId: A },
        { kind: 'package', packageId: B },
      ]);
    }
  });

  it.each(NAMESPACE_SCOPED)('%s: a read naming a package that holds no slot of a one-holder name answers nothing, both faces alike, and no loader is asked (BASE: the one holder\'s item)', async (type) => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    const name = `shared_${type}`;
    await manager.register(type, name, shipped(type, A, 'alpha'), { notify: false });
    expect(await manager.get(type, name, B), 'never another package\'s item').toBeUndefined();
    expect(await manager.getDiagnosed(type, name, B)).toEqual({ data: undefined, degraded: false, errors: [] });
    expect(((await manager.get(type, name)) as any)?.label, 'the bare read still serves the one holder').toBe(`alpha ${type}`);
  });

  /**
   * [ADR-0150 D4] A package-less row bearing a package-held name is that
   * holder's customization, never a second item. With two holders there is no
   * one holder for it to customize: the write lands in the name's bare slot,
   * `list` enumerates it beside the two package items, and no by-name read
   * answers it — a read naming a package reads that package's slot, and the
   * read naming none is refused naming the two package holders only.
   */
  it.each(NAMESPACE_SCOPED)('%s: a package-less write under a name two packages hold is stored in the bare slot and listed, and no by-name read answers it', async (type) => {
    const manager = await twoHolders(type);
    const name = `shared_${type}`;
    await manager.register(type, name, { name, label: `env ${type}`, instructions: 'env instructions' }, { notify: false });
    expect(((await manager.list(type)) as any[]).map((i) => i.label)).toEqual([`alpha ${type}`, `beta ${type}`, `env ${type}`]);
    expect(await manager.listNames(type)).toEqual([name]);
    expect(((await manager.get(type, name, A)) as any)?.label).toBe(`alpha ${type}`);
    expect(((await manager.get(type, name, B)) as any)?.label).toBe(`beta ${type}`);
    const err = await manager.get(type, name).then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
    expect([err?.code, err?.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 'ambiguous-in-environment']);
    expect(err!.refusal.candidates).toEqual([
      { kind: 'package', packageId: A },
      { kind: 'package', packageId: B },
    ]);
  });

  it.each(NAMESPACE_SCOPED)('%s: both items are enumerated under the one name; removing either package leaves the other\'s item, for items that carry `packageId` (BASE: removing the later one left nothing)', async (type) => {
    const name = `shared_${type}`;
    const labels = async (m: MetadataManager) => ((await m.list(type)) as any[]).map((i) => i.label);
    const first = await twoHolders(type, true);
    expect(await labels(first)).toEqual([`alpha ${type}`, `beta ${type}`]);
    expect(await first.listNames(type)).toEqual([name]);
    await first.unregisterPackage(B);
    expect(await labels(first)).toEqual([`alpha ${type}`]);
    expect(((await first.get(type, name)) as any)?.label, 'one holder left: the bare read serves it').toBe(`alpha ${type}`);

    const second = await twoHolders(type, true);
    await second.unregisterPackage(A);
    expect(await labels(second)).toEqual([`beta ${type}`]);
    expect(((await second.get(type, name, B)) as any)?.label).toBe(`beta ${type}`);
  });

  /**
   * [#32198] `unregisterPackage` selects a package's items by `packageId`,
   * `package` or `_packageId`, the key the artifact door's items carry alone.
   * On main 0eca80a7 it read the first two only and removed none of them; this
   * pin recorded that state until #32198 flipped it. The live-set pins are in
   * the "removal by (package, name)" block below.
   */
  it.each(NAMESPACE_SCOPED)('%s: `unregisterPackage` removes an item that carries only the `_packageId` stamp (the artifact door\'s shape) (BASE: it removed nothing)', async (type) => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    const name = `shared_${type}`;
    await manager.register(type, name, shipped(type, A, 'alpha'), { notify: false });
    await manager.unregisterPackage(A);
    expect(await manager.list(type)).toEqual([]);
    expect(await manager.get(type, name, A)).toBeUndefined();
  });

  describe.each(NAMESPACE_SCOPED)('CONTROL — %s, one holder per name: every read is answered the very object registered, as the bare-name map answered it', (type) => {
    const name = `shared_${type}`;

    it('one package\'s item', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      const item = shipped(type, A, 'alpha');
      await manager.register(type, name, item, { notify: false });
      expect(await manager.get(type, name)).toBe(item);
      expect(await manager.get(type, name, A)).toBe(item);
      expect((await manager.getDiagnosed(type, name)).data).toBe(item);
      expect(await manager.list(type)).toEqual([item]);
    });

    it('an environment-authored item no package holds, to a read naming none or any package', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      const item = { name, label: 'env', instructions: 'env instructions' };
      await manager.register(type, name, item, { notify: false });
      expect(await manager.get(type, name)).toBe(item);
      expect(await manager.get(type, name, A)).toBe(item);
    });
  });
});

/**
 * A minimal `IDataDriver` over in-memory tables, for a `DatabaseLoader` the
 * removal pins read rows back from. Only what the loader calls.
 */
function rowDriver(): {
  driver: IDataDriver;
  rows: (type: string) => Array<Record<string, unknown>>;
  history: (type: string) => Array<Record<string, unknown>>;
} {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  // Equality and `$in` per field, every key conjoined; a combinator or another
  // operator it does not implement is refused, never read as a field name.
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (key.startsWith('$')) throw new Error(`rowDriver: combinator ${key} is not implemented`);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const ops = Object.keys(value);
        if (ops.length === 1 && ops[0] === '$in') return ((value as { $in: unknown[] }).$in).includes(row[key]);
        throw new Error(`rowDriver: operator ${ops.join(', ')} on ${key} is not implemented`);
      }
      return row[key] === value;
    });
  // `orderBy` by plain field comparison, applied before `limit`.
  const ordered = (rows: Array<Record<string, unknown>>, orderBy: unknown) => {
    if (orderBy === undefined) return rows;
    const keys = orderBy as Array<{ field: string; order?: 'asc' | 'desc' }>;
    return [...rows].sort((a, b) => {
      for (const { field, order } of keys) {
        const [x, y] = [a[field] as any, b[field] as any];
        if (x !== y) return (x < y ? -1 : 1) * (order === 'desc' ? -1 : 1);
      }
      return 0;
    });
  };
  const driver = {
    name: 'rows',
    version: '1.0.0',
    supports: {},
    connect: async () => undefined,
    disconnect: async () => undefined,
    checkHealth: async () => true,
    execute: async () => undefined,
    syncSchema: async () => undefined,
    find: async (name: string, query: any) => {
      const rows = ordered([...table(name).values()].filter((r) => matches(r, query?.where)), query?.orderBy);
      const page = typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    findOne: async (name: string, query: any) => {
      const row = ordered([...table(name).values()].filter((r) => matches(r, query?.where)), query?.orderBy)[0];
      return row ? { ...row } : null;
    },
    create: async (name: string, data: Record<string, unknown>) => {
      // `sys_metadata_history` is unique on `(type, name, version)`, as the
      // real table's index is: a colliding history row is refused.
      if (name === 'sys_metadata_history' && [...table(name).values()].some((row) =>
        row.type === data.type && row.name === data.name && row.version === data.version)) {
        throw new Error('rowDriver: UNIQUE constraint failed: sys_metadata_history.type, name, version');
      }
      table(name).set(data.id as string, { ...data });
      return { ...data };
    },
    update: async (name: string, id: string, data: Record<string, unknown>) => {
      const updated = { ...table(name).get(id), ...data };
      table(name).set(id, updated);
      return updated;
    },
    delete: async (name: string, id: string) => table(name).delete(id),
    count: async (name: string, query: any) => [...table(name).values()].filter((r) => matches(r, query?.where)).length,
  } as unknown as IDataDriver;
  return {
    driver,
    rows: (type) => [...table('sys_metadata').values()].filter((row) => row.type === type),
    history: (type) => [...table('sys_metadata_history').values()].filter((row) => row.type === type),
  };
}

/**
 * [ADR-0150 D3/D4, #32198] Removal by `(package, name)`, pinned for EVERY
 * member of the live `PACKAGE_SLOTTED_STORE_TYPES` at this head — never a
 * restated list, so a type that joins the set is covered the day it joins.
 *
 * The boot is the artifact door's shape: its sink saves each item into the
 * door's `MemoryLoader` and registers it here with `{ notify: false }`, the
 * item carrying only the `_packageId` stamp (`applyProtection`), and the
 * door's loader is registered afterwards. One `DatabaseLoader` is the writable
 * `datasource:` loader `register` persists into and `unregister` deletes from.
 * Since #32246 both loaders hold such a type per `(package, name)`: a name two
 * packages hold has a row and a door entry per package.
 *
 * BASE (main 0eca80a7): `unregisterPackage` matched `packageId` / `package`
 * only, so it removed nothing of these items; a removal of one package's
 * `packageId` item deleted the name's row whoever's body it held; the
 * realtime `deleted` event named no package; `unregister(type, name)` took
 * every package's slot.
 */
describe('removal by (package, name) for every type stored per package (ADR-0150 D3/D4, #32198)', () => {
  const SLOTTED = [...PACKAGE_SLOTTED_STORE_TYPES];
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  const nameOf = (type: string) => `shared_${type}`;
  const doorItem = (type: string, packageId: string) => ({
    name: nameOf(type),
    label: `${packageId === A ? 'alpha' : 'beta'} ${type}`,
    _packageId: packageId,
    _provenance: 'package',
  });

  async function boot(type: string, holders: readonly string[] = [A, B]) {
    const { driver, rows, history } = rowDriver();
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(new DatabaseLoader({ driver, tableName: 'sys_metadata' }));
    const published: RealtimeEventPayload[] = [];
    const realtime: IRealtimeService = {
      publish: async (event: RealtimeEventPayload) => { published.push(event); },
      subscribe: async () => 'sub-1',
      unsubscribe: async () => undefined,
    };
    manager.setRealtimeService(realtime);
    const door = new MemoryLoader();
    for (const packageId of holders) {
      const item = doorItem(type, packageId);
      await door.save(type, nameOf(type), item);
      await manager.register(type, nameOf(type), item, { notify: false });
    }
    manager.registerLoader(door);
    const watched: MetadataWatchEvent[] = [];
    manager.subscribe(type, (event) => { watched.push(event); });
    published.length = 0;
    const labels = async () => ((await manager.list(type)) as any[]).map((item) => item.label);
    const rowBodies = () => rows(type).map((row) => JSON.parse(row.metadata as string).label);
    return { manager, published, watched, labels, rowBodies, name: nameOf(type), driver, door, rows, history };
  }

  const hasRealtimeDeleted = (type: string) =>
    (MetadataEventType.options as readonly string[]).includes(`metadata.${type}.deleted`);

  it('the live set is the one these pins iterate, and it is not empty', () => {
    expect(SLOTTED.length).toBeGreaterThan(0);
    // [#31700] The picklist family is iterated here since it joined the set.
    expect(SLOTTED).toEqual(expect.arrayContaining(['api', 'agent', 'skill', 'picklist', 'mapping', 'dataset']));
  });

  it.each(SLOTTED)('%s: `unregisterPackage` removes each package\'s `_packageId`-only item from its own slot and leaves the other\'s, in either order (BASE: it removed nothing)', async (type) => {
    const first = await boot(type);
    await first.manager.unregisterPackage(A);
    expect(await first.labels()).toEqual([`beta ${type}`]);
    expect(await first.manager.get(type, first.name, A), 'never another package\'s item').toBeUndefined();
    expect(((await first.manager.get(type, first.name, B)) as any)?.label).toBe(`beta ${type}`);
    expect(((await first.manager.get(type, first.name)) as any)?.label, 'one holder left: the bare read serves it').toBe(`beta ${type}`);

    const second = await boot(type);
    await second.manager.unregisterPackage(B);
    expect(await second.labels()).toEqual([`alpha ${type}`]);
    expect(await second.manager.get(type, second.name, B)).toBeUndefined();
    expect(((await second.manager.get(type, second.name, A)) as any)?.label).toBe(`alpha ${type}`);
  });

  it.each(SLOTTED)('%s: the storage half deletes only the removed package\'s row — removing alpha keeps beta\'s row, removing beta keeps alpha\'s (BASE: removing alpha deleted beta\'s row)', async (type) => {
    const first = await boot(type);
    expect(first.rowBodies(), 'a row per package (#32246)').toEqual([`alpha ${type}`, `beta ${type}`]);
    await first.manager.unregisterPackage(A);
    expect(first.rowBodies()).toEqual([`beta ${type}`]);

    const second = await boot(type);
    await second.manager.unregisterPackage(B);
    expect(second.rowBodies()).toEqual([`alpha ${type}`]);
  });

  it.each(SLOTTED)('%s: the realtime `deleted` event names the removed package, where the type has a realtime event; the watcher event names the item only (BASE: no package on either)', async (type) => {
    const ctx = await boot(type);
    await ctx.manager.unregisterPackage(A);
    const deleted = ctx.published.map((event) => event.payload as any).filter((event) => event.type === `metadata.${type}.deleted`);
    if (hasRealtimeDeleted(type)) {
      expect(deleted.map((event) => [event.name, event.packageId])).toEqual([[ctx.name, A]]);
    } else {
      // Outside the closed `MetadataEventType` enum: nothing is published for the type at all.
      expect(ctx.published).toEqual([]);
    }
    // ⛔ The spec's `MetadataWatchEvent` declares no package field; unchanged.
    expect(ctx.watched.map((event) => [event.type, event.name, event.data])).toEqual([['deleted', ctx.name, undefined]]);
  });

  it.each(SLOTTED)('%s: `unregister(type, name)` naming no package, of a name two packages hold, is refused naming both, and removes and announces nothing (BASE: both slots and the row went)', async (type) => {
    const ctx = await boot(type);
    const err = await ctx.manager.unregister(type, ctx.name).then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);
    expect(err, 'the removal refuses').toBeInstanceOf(PackageScopedNameRefusedError);
    expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
    expect(err!.refusal.candidates).toEqual([
      { kind: 'package', packageId: A },
      { kind: 'package', packageId: B },
    ]);
    expect(await ctx.labels()).toEqual([`alpha ${type}`, `beta ${type}`]);
    expect(ctx.rowBodies()).toEqual([`alpha ${type}`, `beta ${type}`]);
    expect(ctx.published).toEqual([]);
    expect(ctx.watched).toEqual([]);
  });

  it.each(SLOTTED)('%s: `unregister(type, name, { packageId })` removes that package\'s slot and only its row, and names it on the realtime event', async (type) => {
    const ctx = await boot(type);
    await ctx.manager.unregister(type, ctx.name, { packageId: A });
    expect(await ctx.labels()).toEqual([`beta ${type}`]);
    expect(await ctx.manager.get(type, ctx.name, A)).toBeUndefined();
    expect(ctx.rowBodies(), 'beta\'s row: kept').toEqual([`beta ${type}`]);
    if (hasRealtimeDeleted(type)) {
      expect(ctx.published.map((event) => (event.payload as any).packageId)).toEqual([A]);
    }
    await ctx.manager.unregister(type, ctx.name, { packageId: B });
    expect(ctx.rowBodies(), 'beta\'s row: deleted with beta').toEqual([]);
    // No slot of the name is left; the residue pin below reads what is served now (#32246).
  });

  /**
   * [#31700, epic seat ruling R2-B (a)] A removal naming a package that holds
   * no slot of the name takes nothing: that package's slot is empty. Outside
   * the set the store keeps one item per name and the removal takes it
   * whatever package it names, which is what `picklist`, `mapping` and
   * `dataset` did before #31700. The announcement is unchanged and is not
   * this move: `unregister` announces every call, an absent name's too — the
   * watcher hears `deleted` by name and the realtime event names the package
   * the call named.
   */
  it.each(SLOTTED)('%s: `unregister(type, name, { packageId })` naming a package that holds no slot of a one-holder name removes nothing (BASE, outside the set: the item and its row went)', async (type) => {
    const ctx = await boot(type, [A]);
    await ctx.manager.unregister(type, ctx.name, { packageId: B });
    expect(await ctx.labels()).toEqual([`alpha ${type}`]);
    expect(((await ctx.manager.get(type, ctx.name)) as any)?.label).toBe(`alpha ${type}`);
    expect(ctx.rowBodies()).toEqual([`alpha ${type}`]);
    expect(ctx.watched.map((event) => [event.type, event.name])).toEqual([['deleted', ctx.name]]);
    if (hasRealtimeDeleted(type)) {
      expect(ctx.published.map((event) => (event.payload as any).packageId)).toEqual([B]);
    } else {
      expect(ctx.published).toEqual([]);
    }
  });

  describe.each(SLOTTED)('CONTROL — %s, one holder: a removal naming no package is unchanged', (type) => {
    it('`unregister(type, name)` removes the item and its row, and the event names no package (the name is gone, not one package\'s slot)', async () => {
      const ctx = await boot(type, [A]);
      await ctx.manager.unregister(type, ctx.name);
      expect(ctx.rowBodies()).toEqual([]);
      expect(ctx.watched.map((event) => [event.type, event.name])).toEqual([['deleted', ctx.name]]);
      if (hasRealtimeDeleted(type)) {
        expect(ctx.published.map((event) => (event.payload as any).packageId)).toEqual([undefined]);
      }
    });
  });

  // #32162 Do 3, named: permission sets ride the rule above unchanged. A set
  // carries grants, so the pin reads the surviving package's grants back.
  it('permission (#32162): uninstalling P1 leaves P2\'s same-named set, with its own grants, in the store AND in the loader rows', async () => {
    expect(PACKAGE_SLOTTED_STORE_TYPES.has('permission'), 'permission is a slotted type').toBe(true);
    const ctx = await boot('permission');
    const grantsOf = (item: any) => Object.keys(item?.objects ?? {});
    // Give each package's slot its own grant, the way two packages' sets differ.
    await ctx.manager.register('permission', ctx.name, { ...doorItem('permission', A), objects: { alpha_thing: { allowRead: true } } }, { notify: false });
    await ctx.manager.register('permission', ctx.name, { ...doorItem('permission', B), objects: { beta_thing: { allowRead: true } } }, { notify: false });
    await ctx.manager.unregisterPackage(A);
    expect(await ctx.manager.get('permission', ctx.name, A)).toBeUndefined();
    expect(grantsOf(await ctx.manager.get('permission', ctx.name, B))).toEqual(['beta_thing']);
    expect(grantsOf(await ctx.manager.get('permission', ctx.name)), 'one holder left: the bare read serves P2').toEqual(['beta_thing']);
    expect(ctx.rowBodies(), 'the row holding P2\'s set is kept').toEqual(['beta permission']);
  });

  // #32162 S1: the security-catalog echo drops a stale slot with
  // `{ packageId, notify: false }` while the name's stored row is live. The
  // real manager removes that slot only, keeps the row it does not hold, and
  // announces nothing to watchers — so nothing reaches the cluster channel,
  // whose peers would drop every slot of the name. The realtime `deleted`
  // still names the removed package (it is not governed by `notify`).
  it('permission (#32162): a silent removal naming a package takes that slot only, keeps the other\'s row, and announces nothing to watchers', async () => {
    const ctx = await boot('permission');
    await ctx.manager.unregister('permission', ctx.name, { packageId: A, notify: false });
    expect(await ctx.manager.get('permission', ctx.name, A)).toBeUndefined();
    expect(((await ctx.manager.get('permission', ctx.name, B)) as any)?.label).toBe('beta permission');
    expect(ctx.rowBodies()).toEqual(['beta permission']);
    expect(ctx.watched, 'no watcher event, so no cluster broadcast').toEqual([]);
    expect(ctx.published.map((event) => [(event.payload as any).type, (event.payload as any).packageId]))
      .toEqual([['metadata.permission.deleted', A]]);
  });

  /**
   * [#32246] The residue #32198 pinned, flipped. The artifact door's
   * `MemoryLoader` is a `memory:` loader, which no removal used to delete
   * from, and it kept one item per name: the body registered last. Once every
   * slot of a name was removed, every read fell through to it and was
   * answered that body — the read naming the removed package included. A
   * removal of a by-package type now deletes from the door's store too, by
   * the same `(package, name)` key.
   */
  it.each(SLOTTED)('%s: once every slot of the name is removed, nothing answers any read: the door\'s in-memory loader was deleted from too (BASE: it served the body registered last)', async (type) => {
    const ctx = await boot(type);
    await ctx.manager.unregisterPackage(A);
    await ctx.manager.unregisterPackage(B);
    expect(ctx.rowBodies()).toEqual([]);
    expect(await ctx.door.loadSlots(type, ctx.name)).toEqual([]);
    expect(await ctx.labels()).toEqual([]);
    expect(await ctx.manager.get(type, ctx.name)).toBeUndefined();
    expect(await ctx.manager.get(type, ctx.name, A)).toBeUndefined();
    expect(await ctx.manager.exists(type, ctx.name)).toBe(false);
  });

  describe('CONTROL — a type outside the set keeps one item per name, and removal by name', () => {
    const CONTROL_TYPE = ['view', 'object'].find((type) => !PACKAGE_SLOTTED_STORE_TYPES.has(type))!;

    it('`unregister(type, name, { packageId })` removes the item and deletes its row by name, whatever package is named; the event names no package', async () => {
      const ctx = await boot(CONTROL_TYPE, [B]);
      await ctx.manager.unregister(CONTROL_TYPE, ctx.name, { packageId: A });
      expect(ctx.rowBodies()).toEqual([]);
      expect(ctx.watched.map((event) => [event.type, event.name])).toEqual([['deleted', ctx.name]]);
      if (hasRealtimeDeleted(CONTROL_TYPE)) {
        expect(ctx.published.map((event) => (event.payload as any).packageId)).toEqual([undefined]);
      }
    });

    it('`unregisterPackage` removes a `_packageId`-only item and deletes its row by name (BASE: it removed nothing)', async () => {
      const ctx = await boot(CONTROL_TYPE, [A]);
      await ctx.manager.unregisterPackage(A);
      expect(ctx.rowBodies()).toEqual([]);
      expect(ctx.watched.map((event) => [event.type, event.name])).toEqual([['deleted', ctx.name]]);
    });
  });
});

/**
 * [ADR-0150 D3/D4, #32246] Per-package loader storage, pinned for EVERY member
 * of the live `PACKAGE_SLOTTED_STORE_TYPES` at this head.
 *
 * Same boot as the removal pins: the artifact door saves each item into its
 * `MemoryLoader` and registers it with `{ notify: false }` (the item carries
 * only `_packageId`), and one `DatabaseLoader` is the writable `datasource:`
 * loader. A second manager over the same rows and the same door store, with
 * an empty registry, is the state a read reaches the loaders in: a restart
 * over stored rows, or a cluster peer after its replay dropped the slots.
 *
 * BASE (main 60b99f8f): both loaders kept one entry per name — the body saved
 * last, with `package_id` empty — so alpha's stored item was gone at beta's
 * save; the manager's loader fallback named no package, so a read naming alpha
 * was served beta's body and a bare read the last writer instead of `409`;
 * `list` admitted loader items one per name; both rows' history was numbered
 * `1`, so the second history row was refused.
 */
describe('per-package loader storage for every type stored per package (ADR-0150 D3/D4, #32246)', () => {
  const SLOTTED = [...PACKAGE_SLOTTED_STORE_TYPES];
  const A = 'com.acme.alpha';
  const B = 'com.acme.beta';
  const nameOf = (type: string) => `shared_${type}`;
  const label = (type: string, packageId: string) => `${packageId === A ? 'alpha' : 'beta'} ${type}`;
  const doorItem = (type: string, packageId: string) => ({
    name: nameOf(type),
    label: label(type, packageId),
    _packageId: packageId,
    _provenance: 'package',
  });
  const labelsOf = (items: unknown[]) => (items as any[]).map((item) => item.label).sort();

  async function boot(type: string, holders: readonly string[] = [A, B]) {
    const { driver, rows, history } = rowDriver();
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(new DatabaseLoader({ driver, tableName: 'sys_metadata' }));
    const published: RealtimeEventPayload[] = [];
    manager.setRealtimeService({
      publish: async (event: RealtimeEventPayload) => { published.push(event); },
      subscribe: async () => 'sub-1',
      unsubscribe: async () => undefined,
    });
    const door = new MemoryLoader();
    for (const packageId of holders) {
      const item = doorItem(type, packageId);
      await door.save(type, nameOf(type), item);
      await manager.register(type, nameOf(type), item, { notify: false });
    }
    manager.registerLoader(door);
    /** A manager with an empty registry over the given loaders of this boot. */
    const peer = (loaders: ReadonlyArray<'database' | 'door'>) => {
      const fresh = new MetadataManager({ formats: ['json'], loaders: [] });
      for (const which of loaders) {
        fresh.registerLoader(which === 'door' ? door : new DatabaseLoader({ driver, tableName: 'sys_metadata' }));
      }
      return fresh;
    };
    return { manager, published, door, peer, rows: () => rows(type), history: () => history(type), name: nameOf(type) };
  }

  const refusalOf = (read: Promise<unknown>) =>
    read.then(() => undefined, (e: unknown) => e as PackageScopedNameRefusedError);

  it('the live set is the one these pins iterate, and it is not empty', () => {
    expect(SLOTTED.length).toBeGreaterThan(0);
    // [#31700] The picklist family is iterated here since it joined the set.
    expect(SLOTTED).toEqual(expect.arrayContaining(['api', 'agent', 'skill', 'picklist', 'mapping', 'dataset']));
  });

  it.each(SLOTTED)('%s: each package\'s item has its own row with `package_id` filled, and its own entry in the door\'s store (BASE: one row and one entry, the body saved last)', async (type) => {
    const ctx = await boot(type);
    expect(ctx.rows().map((row) => [row.package_id, JSON.parse(row.metadata as string).label])).toEqual([
      [A, label(type, A)],
      [B, label(type, B)],
    ]);
    expect((await ctx.door.loadSlots(type, ctx.name)).map((slot) => [slot.packageId, (slot.data as any).label])).toEqual([
      [A, label(type, A)],
      [B, label(type, B)],
    ]);
  });

  it.each(SLOTTED)('%s: both packages\' history rows are written, numbered per name across the packages (BASE: both numbered 1, the second refused)', async (type) => {
    const ctx = await boot(type);
    expect(ctx.history().map((row) => [row.version, JSON.parse(row.metadata as string).label])).toEqual([
      [1, label(type, A)],
      [2, label(type, B)],
    ]);
    expect(ctx.rows().map((row) => row.version)).toEqual([1, 2]);
  });

  it.each(SLOTTED)('%s: with history not tracked, versions are still numbered per name across the packages\' rows, so the row saved last is the highest (BASE: each row numbered on its own)', async (type) => {
    const { driver, rows } = rowDriver();
    const loader = new DatabaseLoader({ driver, tableName: 'sys_metadata', trackHistory: false });
    await loader.save(type, nameOf(type), doorItem(type, A));
    await loader.save(type, nameOf(type), doorItem(type, B));
    await loader.save(type, nameOf(type), { ...doorItem(type, A), label: 'alpha again' });
    expect(rows(type).map((row) => [row.package_id, row.version])).toEqual([[A, 3], [B, 2]]);
    expect((await loader.loadManyKeyed(type)).map((entry) => (entry.data as any).label)).toEqual(['alpha again']);
  });

  describe.each([
    ['the stored rows', ['database']],
    ['the door\'s store', ['door']],
    ['both, door first', ['door', 'database']],
  ] as const)('a read that reaches the loaders (empty registry) over %s', (_, loaders) => {
    it.each(SLOTTED)('%s: a read naming a package is that package\'s item (BASE: the body saved last, for either package)', async (type) => {
      const peer = (await boot(type)).peer(loaders);
      expect(((await peer.get(type, nameOf(type), A)) as any)?.label).toBe(label(type, A));
      expect(((await peer.get(type, nameOf(type), B)) as any)?.label).toBe(label(type, B));
      expect(((await peer.getDiagnosed(type, nameOf(type), A)).data as any)?.label).toBe(label(type, A));
    });

    it.each(SLOTTED)('%s: a read naming a package that holds nothing is not found (BASE: another package\'s body)', async (type) => {
      const peer = (await boot(type)).peer(loaders);
      expect(await peer.get(type, nameOf(type), 'com.acme.gamma')).toBeUndefined();
      expect(await peer.getDiagnosed(type, nameOf(type), 'com.acme.gamma')).toEqual({ data: undefined, degraded: false, errors: [] });
    });

    it.each(SLOTTED)('%s: a read naming no package is refused naming both holders, as the registry refuses it (BASE: the body saved last)', async (type) => {
      const peer = (await boot(type)).peer(loaders);
      for (const read of [peer.get(type, nameOf(type)), peer.getDiagnosed(type, nameOf(type))]) {
        const err = await refusalOf(read);
        expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
        expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
        expect(err!.refusal.candidates).toEqual([
          { kind: 'package', packageId: A },
          { kind: 'package', packageId: B },
        ]);
      }
    });

    it.each(SLOTTED)('%s: `list` serves both packages\' items (BASE: one, the body saved last)', async (type) => {
      const peer = (await boot(type)).peer(loaders);
      expect(labelsOf(await peer.list(type))).toEqual([label(type, A), label(type, B)]);
    });
  });

  /**
   * The loaders' own unscoped reads — what `MetadataManager.load`,
   * `loadDiagnosed`, `loadMany` and `loadManyKeyed` read, and what the action
   * router's third rung and objectql's action audit call — still answer one
   * item per name, the one saved last, as when each loader kept one entry.
   */
  it.each(SLOTTED)('%s: the loaders\' unscoped reads still answer one item per name, the one saved last (unchanged)', async (type) => {
    const ctx = await boot(type);
    for (const peer of [ctx.peer(['database']), ctx.peer(['door'])]) {
      expect(((await peer.load(type, nameOf(type))) as any)?.label).toBe(label(type, B));
      expect((((await peer.loadDiagnosed(type, nameOf(type))).data) as any)?.label).toBe(label(type, B));
      expect(labelsOf(await peer.loadMany(type))).toEqual([label(type, B)]);
      expect((await peer.loadManyKeyed(type)).map((entry) => [entry.name, (entry.data as any).label])).toEqual([[nameOf(type), label(type, B)]]);
    }
  });

  it.each(SLOTTED)('%s: with one package\'s slot in the registry, `list` adds the other package\'s stored item, and no second copy of the first (BASE: the registry\'s item only)', async (type) => {
    const ctx = await boot(type);
    const peer = ctx.peer(['database', 'door']);
    await peer.register(type, nameOf(type), doorItem(type, A), { notify: false });
    expect(labelsOf(await peer.list(type))).toEqual([label(type, A), label(type, B)]);
  });

  /**
   * An action bound to an object is slotted by its object and name (#31697),
   * so the loaders' items are keyed the same way: the door's store keeps one
   * package's two same-named actions of two objects, and the registry's copy
   * of each shadows the door's.
   */
  it.runIf(PACKAGE_SLOTTED_STORE_TYPES.has('action'))('action: one package\'s two same-named actions bound to two objects are both listed from the door\'s store, and each once beside the registry', async () => {
    const ctx = await boot('action', []);
    const bound = (objectName: string) => ({ name: 'approve', objectName, label: `approve ${objectName}`, _packageId: A });
    for (const objectName of ['account', 'contact']) {
      await ctx.door.save('action', 'approve', bound(objectName));
      await ctx.manager.register('action', 'approve', bound(objectName), { notify: false });
    }
    expect(labelsOf(await ctx.manager.list('action'))).toEqual(['approve account', 'approve contact']);
    expect(labelsOf(await ctx.peer(['door']).list('action'))).toEqual(['approve account', 'approve contact']);

    await ctx.manager.unregisterPackage(A);
    expect(await ctx.door.loadSlots('action', 'approve'), 'the door\'s copies go with the package').toEqual([]);
    expect(await ctx.manager.list('action')).toEqual([]);
    expect(await ctx.manager.get('action', 'approve', A)).toBeUndefined();
  });

  it.each(SLOTTED)('%s: a package-less write of a name one package holds is that package\'s customization in storage too: it goes in the holder\'s row and binds it (D4)', async (type) => {
    const ctx = await boot(type, [A]);
    await ctx.manager.register(type, ctx.name, { name: ctx.name, label: 'customized' }, { notify: false });
    expect(ctx.rows().map((row) => [row.package_id, JSON.parse(row.metadata as string).label])).toEqual([[A, 'customized']]);
    expect(((await ctx.peer(['database']).get(type, ctx.name, A)) as any)?.label).toBe('customized');
  });

  it.each(SLOTTED)('%s: a package\'s first item takes over the name\'s package-less row when no package holds the name, as the store takes over its slot', async (type) => {
    const ctx = await boot(type, []);
    await ctx.manager.register(type, ctx.name, { name: ctx.name, label: 'env' }, { notify: false });
    await ctx.manager.register(type, ctx.name, doorItem(type, A), { notify: false });
    expect(ctx.rows().map((row) => [row.package_id, JSON.parse(row.metadata as string).label])).toEqual([[A, label(type, A)]]);
  });

  /**
   * [#32246 item 3] A package-less write of a name P holds lands in P's slot
   * (D4); `unregisterPackage(P)` judged items by their body alone and left it,
   * still served to a read naming P and to the bare read.
   */
  it.each(SLOTTED)('%s: `unregisterPackage` also removes a package-less customization in the package\'s slot, and its row (BASE: left, and still served)', async (type) => {
    const ctx = await boot(type, [A]);
    await ctx.manager.register(type, ctx.name, { name: ctx.name, label: 'customized' }, { notify: false });
    await ctx.manager.unregisterPackage(A);
    expect(await ctx.manager.get(type, ctx.name, A)).toBeUndefined();
    expect(await ctx.manager.get(type, ctx.name)).toBeUndefined();
    expect(ctx.rows()).toEqual([]);
  });

  /** [#32246 item 2] The realtime arrival names the package a `_packageId`-only item carries. */
  it.each(SLOTTED)('%s: the realtime `created`/`updated` event names the package of an item that carries only `_packageId`, where the type has a realtime event (BASE: no package)', async (type) => {
    const ctx = await boot(type, []);
    await ctx.manager.register(type, ctx.name, doorItem(type, A), { notify: false });
    await ctx.manager.register(type, ctx.name, { ...doorItem(type, A), label: 'again' }, { notify: false });
    const arrivals = ctx.published.map((event) => event.payload as any);
    if ((MetadataEventType.options as readonly string[]).includes(`metadata.${type}.created`)) {
      expect(arrivals.map((event) => [event.type, event.packageId])).toEqual([
        [`metadata.${type}.created`, A],
        [`metadata.${type}.updated`, A],
      ]);
    } else {
      expect(ctx.published).toEqual([]);
    }
  });

  /**
   * [#32246 item 6, recorded] A package-less item beside two package slots
   * keeps its own package-less row; a removal naming no package is refused
   * while the packages hold the name, and takes the package-less item and row
   * once they are gone.
   */
  it.each(SLOTTED)('%s: a package-less item beside two package slots has its own row, removable by name once both packages are gone', async (type) => {
    const ctx = await boot(type);
    await ctx.manager.register(type, ctx.name, { name: ctx.name, label: 'env' }, { notify: false });
    expect(ctx.rows().map((row) => row.package_id ?? null)).toEqual([A, B, null]);
    expect(await refusalOf(ctx.manager.unregister(type, ctx.name))).toBeInstanceOf(PackageScopedNameRefusedError);
    await ctx.manager.unregisterPackage(A);
    await ctx.manager.unregisterPackage(B);
    expect(ctx.rows().map((row) => row.package_id ?? null)).toEqual([null]);
    await ctx.manager.unregister(type, ctx.name);
    expect(ctx.rows()).toEqual([]);
    expect(await ctx.manager.exists(type, ctx.name)).toBe(false);
  });

  /** The realtime events and watcher events `manager` announces for `type`. */
  const observe = (manager: MetadataManager, type: string) => {
    const published: RealtimeEventPayload[] = [];
    manager.setRealtimeService({
      publish: async (event: RealtimeEventPayload) => { published.push(event); },
      subscribe: async () => 'sub-1',
      unsubscribe: async () => undefined,
    });
    const watched: MetadataWatchEvent[] = [];
    manager.subscribe(type, (event) => { watched.push(event); });
    return { published, watched };
  };

  /**
   * [#32246 review M1] A removal naming no package is judged over the same
   * holders a read is: the registry's slots and the loaders' stored items. A
   * peer (empty registry over the stored rows and the door's store) holds the
   * name only in its loaders.
   */
  describe.each([
    ['the stored rows', ['database']],
    ['the door\'s store', ['door']],
    ['both, door first', ['door', 'database']],
  ] as const)('a removal naming no package on a peer over %s', (_, loaders) => {
    it.each(SLOTTED)('%s: of a name two packages hold only in the loaders, it is refused naming both before anything is deleted or announced (BASE: it resolved, deleted nothing and announced `deleted`)', async (type) => {
      const ctx = await boot(type);
      const peer = ctx.peer(loaders);
      const seen = observe(peer, type);
      const err = await refusalOf(peer.unregister(type, ctx.name));
      expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
      expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
      expect(err!.refusal.candidates).toEqual([
        { kind: 'package', packageId: A },
        { kind: 'package', packageId: B },
      ]);
      expect(ctx.rows().map((row) => row.package_id), 'every row kept').toEqual([A, B]);
      expect((await ctx.door.loadSlots(type, ctx.name)).map((slot) => slot.packageId), 'every door entry kept').toEqual([A, B]);
      expect([seen.published, seen.watched]).toEqual([[], []]);

      const bulk = await peer.bulkUnregister([{ type, name: ctx.name }]);
      expect([bulk.succeeded, bulk.failed, bulk.errors?.map((entry) => entry.name)]).toEqual([0, 1, [ctx.name]]);
      expect(ctx.rows()).toHaveLength(2);
    });

    it.each(SLOTTED)('%s: CONTROL — of a name one package holds only in the loaders, it removes the stored item and announces it', async (type) => {
      const ctx = await boot(type, [A]);
      const peer = ctx.peer(loaders);
      const seen = observe(peer, type);
      await peer.unregister(type, ctx.name);
      const holds = (which: 'database' | 'door') => (loaders as ReadonlyArray<string>).includes(which);
      if (holds('database')) expect(ctx.rows()).toEqual([]);
      if (holds('door')) expect(await ctx.door.loadSlots(type, ctx.name)).toEqual([]);
      expect(seen.watched.map((event) => [event.type, event.name])).toEqual([['deleted', ctx.name]]);
    });
  });

  it.each(SLOTTED)('%s: a removal naming no package is judged over the registry and the loaders together: one package\'s registry slot beside the other package\'s stored item is refused (BASE: the registry\'s slot and the other package\'s stored item both went)', async (type) => {
    const ctx = await boot(type, [B]);
    const peer = ctx.peer(['door']);
    await peer.register(type, ctx.name, doorItem(type, A), { notify: false });
    const seen = observe(peer, type);
    const err = await refusalOf(peer.unregister(type, ctx.name));
    expect([err?.code, err?.status, err?.refusal.candidates]).toEqual(['RESOURCE_CONFLICT', 409, [
      { kind: 'package', packageId: A },
      { kind: 'package', packageId: B },
    ]]);
    expect(((await peer.get(type, ctx.name, A)) as any)?.label, 'the registry\'s slot kept').toBe(label(type, A));
    expect((await ctx.door.loadSlots(type, ctx.name)).map((slot) => slot.packageId), 'the stored item kept').toEqual([B]);
    expect([seen.published, seen.watched]).toEqual([[], []]);
  });

  /**
   * [#32246 review S2] A read naming a package the registry holds no slot for
   * is read over the registry's slots and the loaders' stored items together,
   * as `list` already lists them: the package's stored item answers beside
   * another package's registry slot, and ⛔ never another package's item.
   */
  it.each(SLOTTED)('%s: a read naming a package whose item only a loader stores answers it, beside another package\'s registry slot (BASE: not found)', async (type) => {
    const ctx = await boot(type);
    for (const loaders of [['database'], ['door']] as const) {
      const peer = ctx.peer(loaders);
      await peer.register(type, ctx.name, doorItem(type, A), { notify: false });
      expect(((await peer.get(type, ctx.name, B)) as any)?.label).toBe(label(type, B));
      expect(((await peer.getDiagnosed(type, ctx.name, B)).data as any)?.label).toBe(label(type, B));
      expect(((await peer.get(type, ctx.name, A)) as any)?.label, 'the registry\'s slot').toBe(label(type, A));
      expect(await peer.get(type, ctx.name, 'com.acme.gamma'), 'never another package\'s item').toBeUndefined();
    }
  });

  /**
   * [#32246 review S3] `sys_metadata_history` is unique on `(type, name,
   * version)` and keeps a removed package's rows: the next version is one past
   * the highest the name has had there too, not over the live rows alone.
   */
  it.each(SLOTTED)('%s: a package removed and saved again takes the name\'s next version over its history, and its history row is written (BASE over live rows: it reused version 2 and its history row was refused)', async (type) => {
    const ctx = await boot(type);
    await ctx.manager.unregister(type, ctx.name, { packageId: B });
    expect(ctx.rows().map((row) => [row.package_id, row.version])).toEqual([[A, 1]]);
    await ctx.manager.register(type, ctx.name, { ...doorItem(type, B), label: 'beta again' }, { notify: false });
    expect(ctx.rows().map((row) => [row.package_id, row.version])).toEqual([[A, 1], [B, 3]]);
    expect(ctx.history().map((row) => [row.version, JSON.parse(row.metadata as string).label])).toEqual([
      [1, label(type, A)],
      [2, label(type, B)],
      [3, 'beta again'],
    ]);
  });

  /**
   * [#32246 red-line R1] A rollback by name of a name two packages' rows hold
   * cannot tell whose row it restores: it used to overwrite the first row the
   * driver returned, with a body that could be the other package's. It is
   * refused naming both, before any write or history row. Rollback by package
   * is a follow-up card.
   */
  it.each(SLOTTED)('%s: a rollback of a name two packages\' rows hold is refused naming both, every row byte-unchanged and no history row written (BASE: the first row the driver returned was overwritten)', async (type) => {
    const ctx = await boot(type);
    const rowsBefore = JSON.stringify(ctx.rows());
    const historyBefore = ctx.history().length;
    const err = await refusalOf(ctx.manager.rollback(type, ctx.name, 2));
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
    expect(err!.refusal.candidates).toEqual([
      { kind: 'package', packageId: A },
      { kind: 'package', packageId: B },
    ]);
    expect(JSON.stringify(ctx.rows())).toBe(rowsBefore);
    expect(ctx.history()).toHaveLength(historyBefore);
    expect(((await ctx.manager.get(type, ctx.name, A)) as any)?.label, 'the registry untouched').toBe(label(type, A));
  });

  /**
   * [#32246 red-line R1b] One package's row beside the name's package-less row
   * is two row slots too: a rollback by name would overwrite whichever the
   * driver returned first. Reach: A and B save, a package-less save lands on
   * the bare row (item 6), B is removed. Refused naming A and the environment,
   * before any write or history row.
   */
  it.each(SLOTTED)('%s: a rollback of a name whose rows are one package\'s and the package-less row is refused naming both, both rows byte-unchanged and no history row written (BASE: the first row the driver returned was overwritten)', async (type) => {
    const ctx = await boot(type);
    await ctx.manager.register(type, ctx.name, { name: ctx.name, label: 'env' }, { notify: false });
    await ctx.manager.unregisterPackage(B);
    expect(ctx.rows().map((row) => row.package_id ?? null)).toEqual([A, null]);
    const rowsBefore = JSON.stringify(ctx.rows());
    const historyBefore = ctx.history().length;
    const err = await refusalOf(ctx.manager.rollback(type, ctx.name, 1));
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect([err!.code, err!.status, err!.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
    expect(err!.refusal.candidates).toEqual([{ kind: 'package', packageId: A }, { kind: 'environment' }]);
    expect(JSON.stringify(ctx.rows())).toBe(rowsBefore);
    expect(ctx.history()).toHaveLength(historyBefore);
  });

  it.each(SLOTTED)('%s: CONTROL — a rollback of a name one package holds still restores that version into its row', async (type) => {
    const ctx = await boot(type, [A]);
    await ctx.manager.register(type, ctx.name, { ...doorItem(type, A), label: 'alpha edited' }, { notify: false });
    await ctx.manager.rollback(type, ctx.name, 1);
    expect(ctx.rows().map((row) => [row.package_id, row.version, JSON.parse(row.metadata as string).label])).toEqual([[A, 3, label(type, A)]]);
    expect(ctx.history().map((row) => [row.version, row.operation_type])).toEqual([[1, 'create'], [2, 'update'], [3, 'revert']]);
  });

  describe('CONTROL — a type outside the set keeps one row and one door entry per name, the body saved last', () => {
    const CONTROL_TYPE = ['view', 'object'].find((type) => !PACKAGE_SLOTTED_STORE_TYPES.has(type))!;

    it('two packages\' items of one name: one row with no `package_id`, one door entry, and every read on an empty registry answers the body saved last', async () => {
      const ctx = await boot(CONTROL_TYPE);
      expect(ctx.rows().map((row) => [row.package_id, JSON.parse(row.metadata as string).label])).toEqual([[undefined, label(CONTROL_TYPE, B)]]);
      expect((await ctx.door.loadManyKeyed(CONTROL_TYPE)).map((entry) => [entry.name, entry.packageId, (entry.data as any).label])).toEqual([
        [ctx.name, undefined, label(CONTROL_TYPE, B)],
      ]);
      const peer = ctx.peer(['database']);
      expect(((await peer.get(CONTROL_TYPE, ctx.name, A)) as any)?.label).toBe(label(CONTROL_TYPE, B));
      expect(((await peer.get(CONTROL_TYPE, ctx.name)) as any)?.label).toBe(label(CONTROL_TYPE, B));
      expect(labelsOf(await peer.list(CONTROL_TYPE))).toEqual([label(CONTROL_TYPE, B)]);
    });

    it('a removal deletes from the door\'s store too: nothing answers (#32353; BASE: its copy kept answering)', async () => {
      const ctx = await boot(CONTROL_TYPE, [A]);
      await ctx.manager.unregisterPackage(A);
      expect(ctx.rows()).toEqual([]);
      expect(await ctx.door.loadManyKeyed(CONTROL_TYPE)).toEqual([]);
      expect(await ctx.manager.get(CONTROL_TYPE, ctx.name)).toBeUndefined();
      expect(await ctx.manager.exists(CONTROL_TYPE, ctx.name)).toBe(false);
      expect(await ctx.manager.list(CONTROL_TYPE)).toEqual([]);
    });
  });
});

/**
 * [#32353] The non-slotted half of #32246: a removal of a type outside
 * `PACKAGE_SLOTTED_STORE_TYPES` deletes the artifact door's in-memory copy
 * too, by name, so the removed item stops answering. Pinned per first-party
 * call shape (step 0 census, read at 2513e3ad):
 *
 *  - objectql `settleRuntimeObjectCopy` and install-local's
 *    `withdrawObjectCopies`: `unregister('object', name, { notify: false })`;
 *  - the datasource admin's delete and its `/meta` door follower:
 *    `unregister('datasource', name)`; the runtime's package-datasource
 *    withdraw: `unregister('datasource', name, { notify: false })`;
 *  - plugin-security's `dropEcho` of a `position`: `unregister('position',
 *    name)`, and with the echo slot's `{ packageId }`; its stale echo-slot
 *    drop: `{ packageId, notify: false }`;
 *  - `view`, the CONTROL type of the #32246 pins.
 *
 * Each over the door boot (the door's `MemoryLoader` saved first, then
 * `register(…, { notify: false })`, one writable `DatabaseLoader`), read on
 * the live manager and on a manager with an empty registry over the same door
 * and rows. BASE: every read answered the door's body after the removal; with
 * a customization registered over the door item, the removal brought the
 * door's body back.
 */
describe('a removal of a type outside the set deletes the door\'s copy too (#32353)', () => {
  const P = 'com.acme.alpha';
  const nameOf = (type: string) => `door_${type}`;
  const doorItem = (type: string, name = nameOf(type)) => ({ name, label: `door ${type}`, _packageId: P, _provenance: 'package' });

  const SHAPES: ReadonlyArray<readonly [string, string, Record<string, unknown> | undefined]> = [
    ['objectql settleRuntimeObjectCopy / install-local withdrawObjectCopies', 'object', { notify: false }],
    ['datasource admin delete / its /meta door follower', 'datasource', undefined],
    ['runtime package-datasource withdraw', 'datasource', { notify: false }],
    ['plugin-security dropEcho, by name', 'position', undefined],
    ['plugin-security dropEcho, naming the echo slot\'s package', 'position', { packageId: P }],
    ['plugin-security stale echo-slot drop, silent', 'position', { packageId: P, notify: false }],
    ['CONTROL type', 'view', undefined],
  ];

  async function boot(type: string, opts: { customize?: boolean } = {}) {
    const { driver, rows } = rowDriver();
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    manager.registerLoader(new DatabaseLoader({ driver, tableName: 'sys_metadata' }));
    const door = new MemoryLoader();
    for (const item of [doorItem(type), doorItem(type, `kept_${type}`)]) {
      await door.save(type, item.name, item);
      await manager.register(type, item.name, item, { notify: false });
    }
    if (opts.customize) {
      await manager.register(type, nameOf(type), { name: nameOf(type), label: `edited ${type}`, _packageId: P }, { notify: false });
    }
    manager.registerLoader(door);
    const peer = () => {
      const fresh = new MetadataManager({ formats: ['json'], loaders: [] });
      fresh.registerLoader(door);
      fresh.registerLoader(new DatabaseLoader({ driver, tableName: 'sys_metadata' }));
      return fresh;
    };
    return { manager, door, peer, rows: () => rows(type), name: nameOf(type) };
  }

  /** What a read answers for the removed name: its `list` labels, bare `get`, `exists`. */
  async function readsOf(manager: MetadataManager, type: string, name: string) {
    const listed = ((await manager.list(type)) as any[]).filter((item) => item?.name === name).map((item) => item.label);
    return { listed, get: ((await manager.get(type, name)) as any)?.label, exists: await manager.exists(type, name) };
  }
  const GONE = { listed: [], get: undefined, exists: false };

  it('every shape\'s type is outside the set (the set\'s own removal is pinned above)', () => {
    for (const [, type] of SHAPES) expect(PACKAGE_SLOTTED_STORE_TYPES.has(type), type).toBe(false);
  });

  it.each(SHAPES)('%s (%s): after the removal no read answers the door item, live or over an empty registry (BASE: the door body)', async (_, type, options) => {
    const ctx = await boot(type);
    await ctx.manager.unregister(type, ctx.name, options as any);
    expect(await readsOf(ctx.manager, type, ctx.name)).toEqual(GONE);
    expect(await readsOf(ctx.peer(), type, ctx.name)).toEqual(GONE);
    expect((await ctx.door.load(type, ctx.name)).data).toBeNull();
    expect(ctx.rows().map((row) => row.name)).toEqual([`kept_${type}`]);
  });

  it.each(SHAPES)('%s (%s): a customization removed over the door item does not bring the door body back (BASE: it did)', async (_, type, options) => {
    const ctx = await boot(type, { customize: true });
    expect((await readsOf(ctx.manager, type, ctx.name)).get).toBe(`edited ${type}`);
    await ctx.manager.unregister(type, ctx.name, options as any);
    expect(await readsOf(ctx.manager, type, ctx.name)).toEqual(GONE);
    expect(await readsOf(ctx.peer(), type, ctx.name)).toEqual(GONE);
  });

  it.each(SHAPES)('%s (%s): CONTROL — another name\'s door item keeps answering, and a re-register of the removed one serves it again', async (_, type, options) => {
    const ctx = await boot(type);
    await ctx.manager.unregister(type, ctx.name, options as any);
    const kept = `kept_${type}`;
    expect(await readsOf(ctx.manager, type, kept)).toEqual({ listed: [`door ${type}`], get: `door ${type}`, exists: true });
    expect(await readsOf(ctx.peer(), type, kept)).toEqual({ listed: [`door ${type}`], get: `door ${type}`, exists: true });
    await ctx.manager.register(type, ctx.name, doorItem(type), { notify: false });
    expect(await readsOf(ctx.manager, type, ctx.name)).toEqual({ listed: [`door ${type}`], get: `door ${type}`, exists: true });
  });
});
