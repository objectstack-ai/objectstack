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
 * namespace — today `agent` and `skill` (objectql's
 * `NAMESPACE_SCOPED_BARE_NAME_TYPES`, #31701; objectql pins that set a subset
 * of `PACKAGE_SLOTTED_STORE_TYPES`). Two packages of two namespaces may each
 * install such a name, and the artifact door registers every package body's
 * items here through `register(…, { notify: false })`, stamped by
 * `applyProtection` (`_packageId`). On main 45f0f81f the store was keyed by
 * bare name for these types: the second package's register overwrote the
 * first's, and every read — the one naming the first package included — was
 * answered the survivor.
 */
describe('the in-memory store keeps one slot per (package, name) for every namespace-scoped type (ADR-0150 D4, #32151)', () => {
  const NAMESPACE_SCOPED = ['agent', 'skill'] as const;
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

  it.each(NAMESPACE_SCOPED)('%s: both items are enumerated under the one name; removing either package leaves the other\'s item (BASE: removing the later one left nothing)', async (type) => {
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
