// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { MetadataManager } from './metadata-manager';
import { MemoryLoader } from './loaders/memory-loader';
import type { MetadataLoader } from './loaders/loader-interface.js';
import type { MetadataLoaderContract, MetadataLoadResult, MetadataSaveResult, MetadataStats } from '@objectstack/spec/system';
import type { IPubSub, PubSubMessage } from '@objectstack/spec/contracts';

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
 * Tiny in-test pub/sub double — same semantics as MemoryPubSub from
 * @objectstack/service-cluster but inlined here to keep this package's
 * test deps zero.
 */
class TestPubSub implements IPubSub {
    private subs = new Map<string, Set<(m: PubSubMessage<unknown>) => void>>();

    async publish<T>(channel: string, payload: T): Promise<void> {
        const bucket = this.subs.get(channel);
        if (!bucket) return;
        for (const h of Array.from(bucket)) {
            h({ channel, payload, publishedAt: Date.now() });
        }
    }
    subscribe<T>(channel: string, handler: (m: PubSubMessage<T>) => void) {
        let bucket = this.subs.get(channel);
        if (!bucket) { bucket = new Set(); this.subs.set(channel, bucket); }
        const wrapped = handler as (m: PubSubMessage<unknown>) => void;
        bucket.add(wrapped);
        return () => { bucket!.delete(wrapped); };
    }
    async close(): Promise<void> { this.subs.clear(); }
}

/**
 * A writable, `datasource:`-protocol loader whose storage can be SHARED by two
 * managers — the in-test stand-in for the one `sys_metadata` table two cluster
 * replicas both read and write.
 *
 * `MemoryLoader` cannot play this role: its protocol is `memory:`, and
 * `MetadataManager.register()` persists only to `datasource:` loaders that
 * declare `capabilities.write`. Without a shared writable store, node A's
 * write is invisible to node B no matter how node B's caches behave, and the
 * #5109 regression cannot be observed at all.
 */
class SharedStoreLoader implements MetadataLoader {
    readonly contract: MetadataLoaderContract = {
        name: 'shared-store',
        protocol: 'datasource:',
        capabilities: { read: true, write: true, watch: false, list: true },
    };

    // type -> name -> data. Deliberately public: tests assert on it.
    readonly storage = new Map<string, Map<string, unknown>>();

    async load(type: string, name: string): Promise<MetadataLoadResult> {
        const data = this.storage.get(type)?.get(name);
        return data ? { data, source: 'shared-store', format: 'json', loadTime: 0 } : { data: null };
    }
    async loadMany<T = unknown>(type: string): Promise<T[]> {
        return Array.from((this.storage.get(type) ?? new Map()).values()) as T[];
    }
    async exists(type: string, name: string): Promise<boolean> {
        return this.storage.get(type)?.has(name) ?? false;
    }
    async stat(type: string, name: string): Promise<MetadataStats | null> {
        return (await this.exists(type, name))
            ? { size: 0, mtime: new Date().toISOString(), format: 'json' }
            : null;
    }
    async list(type: string): Promise<string[]> {
        return Array.from((this.storage.get(type) ?? new Map()).keys());
    }
    async save(type: string, name: string, data: unknown): Promise<MetadataSaveResult> {
        let typeStore = this.storage.get(type);
        if (!typeStore) { typeStore = new Map(); this.storage.set(type, typeStore); }
        typeStore.set(name, data);
        return { success: true, path: `${type}/${name}` };
    }
    async delete(type: string, name: string): Promise<void> {
        this.storage.get(type)?.delete(name);
    }
}

const flush = () => new Promise<void>((r) => setImmediate(r));

/** Read a manager's private list cache without waiting on any async seam. */
const cachedTypes = (mgr: MetadataManager): string[] =>
    Array.from((mgr as unknown as { listCache: Map<string, unknown> }).listCache.keys());

/**
 * Two managers wired to one bus and one shared store — the cluster shape:
 * two replicas of the same app in front of the same `sys_metadata`.
 */
function makeCluster() {
    const bus = new TestPubSub();
    const store = new SharedStoreLoader();
    const a = new MetadataManager({ formats: ['json'], loaders: [store] });
    const b = new MetadataManager({ formats: ['json'], loaders: [store] });
    a.attachClusterPubSub(bus, 'node-A');
    b.attachClusterPubSub(bus, 'node-B');
    return { bus, store, a, b };
}

const viewNames = (items: unknown[]): string[] =>
    (items as { name: string }[]).map((v) => v.name).sort();

function makeManager(): MetadataManager {
    return new MetadataManager({
        formats: ['json'],
        loaders: [new MemoryLoader()],
    });
}

describe('MetadataManager — cluster pub/sub bridge', () => {
    it('replays remote events through local watchers', async () => {
        const bus = new TestPubSub();
        const mgr = makeManager();
        mgr.attachClusterPubSub(bus, 'node-B');

        const received: unknown[] = [];
        mgr.subscribe('object', (evt) => { received.push(evt); });

        await bus.publish('metadata.changed', {
            originNode: 'node-A',
            type: 'object',
            event: { type: 'changed', name: 'account', timestamp: Date.now() },
        });
        await flush();

        expect(received).toHaveLength(1);
        expect((received[0] as { name: string }).name).toBe('account');
    });

    it('suppresses loopback events (originNode === local)', async () => {
        const bus = new TestPubSub();
        const mgr = makeManager();
        mgr.attachClusterPubSub(bus, 'node-A');

        const received: unknown[] = [];
        mgr.subscribe('object', (evt) => { received.push(evt); });

        await bus.publish('metadata.changed', {
            originNode: 'node-A',
            type: 'object',
            event: { type: 'changed', name: 'account', timestamp: Date.now() },
        });
        await flush();

        expect(received).toHaveLength(0);
    });

    it('cross-node: A publish reaches B but not back to A', async () => {
        const bus = new TestPubSub();
        const mgrA = makeManager();
        const mgrB = makeManager();
        mgrA.attachClusterPubSub(bus, 'node-A');
        mgrB.attachClusterPubSub(bus, 'node-B');

        const a: unknown[] = [];
        const b: unknown[] = [];
        mgrA.subscribe('object', (e) => a.push(e));
        mgrB.subscribe('object', (e) => b.push(e));

        // Simulate manager A emitting a watch event by going through the
        // public publish surface directly (we don't have a repository
        // attached, so we drive the bus by hand — same path the
        // production code takes inside notifyWatchers).
        await bus.publish('metadata.changed', {
            originNode: 'node-A',
            type: 'object',
            event: { type: 'changed', name: 'task', timestamp: Date.now() },
        });
        await flush();

        expect(a).toHaveLength(0);                              // A skips its own
        expect(b).toHaveLength(1);                              // B replays
        expect((b[0] as { name: string }).name).toBe('task');
    });

    it('detachClusterPubSub stops replay and is idempotent', async () => {
        const bus = new TestPubSub();
        const mgr = makeManager();
        mgr.attachClusterPubSub(bus, 'node-B');

        const received: unknown[] = [];
        mgr.subscribe('object', (e) => received.push(e));

        mgr.detachClusterPubSub();
        mgr.detachClusterPubSub(); // idempotent

        await bus.publish('metadata.changed', {
            originNode: 'node-A',
            type: 'object',
            event: { type: 'changed', name: 'x', timestamp: Date.now() },
        });
        await flush();

        expect(received).toHaveLength(0);
    });

    it('re-attaching with same (pubsub,nodeId) is a no-op', async () => {
        const bus = new TestPubSub();
        const mgr = makeManager();

        const off1 = mgr.attachClusterPubSub(bus, 'node-B');
        const off2 = mgr.attachClusterPubSub(bus, 'node-B'); // should not double-subscribe

        const received: unknown[] = [];
        mgr.subscribe('object', (e) => received.push(e));

        await bus.publish('metadata.changed', {
            originNode: 'node-A',
            type: 'object',
            event: { type: 'changed', name: 'view_a', timestamp: Date.now() },
        });
        await flush();

        expect(received).toHaveLength(1);
        off1(); off2();
    });

    it('drops malformed payloads silently', async () => {
        const bus = new TestPubSub();
        const mgr = makeManager();
        mgr.attachClusterPubSub(bus, 'node-B');

        const received: unknown[] = [];
        mgr.subscribe('object', (e) => received.push(e));

        await bus.publish('metadata.changed', { originNode: 'node-A' }); // missing type/event
        await bus.publish('metadata.changed', null);
        await flush();

        expect(received).toHaveLength(0);
    });
});

/**
 * #5109 — a peer's write must invalidate THIS node's caches, not just wake its
 * watchers.
 *
 * Before this, `attachClusterPubSub`'s subscriber did exactly one thing on an
 * incoming `metadata.changed`: `notifyWatchersLocal()`. It never touched
 * `registry` or `listCache`. So node B's watchers were woken while every
 * `list(type)` on B kept answering the pre-write set for up to
 * `LIST_CACHE_TTL_MS` (30s) — and a watcher that responded to the wake-up by
 * re-reading through `list()` was handed the stale set back. An invalidation
 * notice carrying invalidated data.
 *
 * The fix reuses `applyRepoEvent`'s long-standing shape (delete the registry
 * entry, drop the list cache, THEN announce) via `invalidateForForeignWrite`.
 */
describe('MetadataManager — a cluster peer write invalidates local caches (#5109)', () => {
    const view = (name: string, title: string) => ({ name, title, object: 'account' });

    it('B\'s pre-warmed list() sees A\'s register() without waiting out the 30s TTL', async () => {
        const { store, a, b } = makeCluster();
        await store.save('view', 'v_existing', view('v_existing', 'existing'));

        // B pre-warms its list cache — the issue's repro, verbatim.
        expect(viewNames(await b.list('view'))).toEqual(['v_existing']);

        // A writes. Same tick, no timers: the 30s TTL has not lapsed.
        await a.register('view', 'v_new', view('v_new', 'new'));

        expect(viewNames(await b.list('view'))).toEqual(['v_existing', 'v_new']);
    });

    it('propagates A\'s unregister() to B\'s list()', async () => {
        const { store, a, b } = makeCluster();
        await store.save('view', 'v_doomed', view('v_doomed', 'doomed'));
        expect(viewNames(await b.list('view'))).toEqual(['v_doomed']);

        await a.unregister('view', 'v_doomed');

        expect(await b.list('view')).toEqual([]);
    });

    it('invalidates SYNCHRONOUSLY on receipt — not inside the deferred replay', async () => {
        const { store, a, b } = makeCluster();
        await store.save('view', 'v_existing', view('v_existing', 'existing'));
        await b.list('view');
        expect(cachedTypes(b)).toEqual(['view']);

        const woken: unknown[] = [];
        b.subscribe('view', (e: unknown) => { woken.push(e); });

        await a.register('view', 'v_new', view('v_new', 'new'));

        // Resuming from `await` is a microtask, so no `setImmediate` callback
        // can have run yet: the watcher replay is still pending...
        expect(woken).toHaveLength(0);
        // ...and the cache is ALREADY gone. This is the seam the fix pins: a
        // read landing between receipt and the deferred tick — every `await`
        // inside a request handler is such a window — must not be served
        // stale. Deferring the invalidation alongside the notify would leave
        // this expectation red.
        expect(cachedTypes(b)).toEqual([]);

        await flush();
        expect(woken).toHaveLength(1);
    });

    it('a watcher that re-reads via list() on the wake-up gets the post-write set', async () => {
        const { store, a, b } = makeCluster();
        await store.save('view', 'v_existing', view('v_existing', 'existing'));
        await b.list('view');

        // The ObjectQL SchemaRegistry bridge and the HMR SSE stream both react
        // to the event by re-reading. That re-read is what used to contradict
        // the notification it was answering.
        let seenByWatcher: string[] = [];
        const observed = new Promise<void>((resolve) => {
            b.subscribe('view', () => {
                void b.list('view').then((items: unknown[]) => {
                    seenByWatcher = viewNames(items);
                    resolve();
                });
            });
        });

        await a.register('view', 'v_new', view('v_new', 'new'));
        await observed;

        expect(seenByWatcher).toEqual(['v_existing', 'v_new']);
    });

    it('drops B\'s stale registry entry so get() falls through to the shared store', async () => {
        const { store, a, b } = makeCluster();
        // B holds its own copy in the in-memory registry, which shadows the
        // store in both get() and list(). Dropping the list cache alone would
        // leave B serving this copy forever.
        await b.register('view', 'v_shared', view('v_shared', 'old'));
        expect((await b.get('view', 'v_shared') as { title: string }).title).toBe('old');

        await a.register('view', 'v_shared', view('v_shared', 'new'));

        expect((await b.get('view', 'v_shared') as { title: string }).title).toBe('new');
        expect((await b.list('view') as { title: string }[])[0].title).toBe('new');
        // Deleted, never pre-filled from the payload — the answer came from
        // the store, which is the source of truth (see
        // `invalidateForForeignWrite`).
        expect(store.storage.get('view')?.get('v_shared')).toMatchObject({ title: 'new' });
    });

    it('a nameless remote event invalidates the list cache but keeps in-memory-only entries', async () => {
        const bus = new TestPubSub();
        const mgr = makeManager();
        mgr.attachClusterPubSub(bus, 'node-B');

        // `registerInMemory` artefacts (code-owned datasources, ADR-0015
        // Addendum) exist in NO loader — evicting one on a nameless event
        // would be an unrecoverable loss in exchange for a guess.
        mgr.registerInMemory('datasource', 'crm_db', { name: 'crm_db', origin: 'code' });
        await mgr.list('datasource');
        expect(cachedTypes(mgr)).toEqual(['datasource']);

        // `MetadataWatchEvent.name` is optional in the spec, so this payload
        // is legal on the wire.
        await bus.publish('metadata.changed', {
            originNode: 'node-A',
            type: 'datasource',
            event: { type: 'changed', path: '/some/file.json', timestamp: Date.now() },
        });
        await flush();

        expect(cachedTypes(mgr)).toEqual([]);
        expect(await mgr.get('datasource', 'crm_db')).toMatchObject({ name: 'crm_db' });
    });

    it('leaves the local node\'s own caches alone on a loopback event', async () => {
        const { store, a } = makeCluster();
        await store.save('view', 'v_existing', view('v_existing', 'existing'));
        await a.list('view');
        expect(cachedTypes(a)).toEqual(['view']);

        // A hears its own broadcast back on a driver without dedup — the
        // loopback guard must still short-circuit before any invalidation, or
        // every local write would pay a needless cache rebuild.
        await (a as unknown as { clusterPubSub: IPubSub }).clusterPubSub.publish(
            'metadata.changed',
            { originNode: 'node-A', type: 'view', event: { type: 'changed', name: 'v_existing', path: '' } },
        );

        expect(cachedTypes(a)).toEqual(['view']);
    });
});

/**
 * #13609 — the seam behind "delete keeps being served cluster-wide, longer
 * than any TTL", measured statically (no live multi-node deployment
 * available; see the issue for the full write-up).
 *
 * Every test above in this file shares ONE `TestPubSub` bus between A and
 * B — the correct model of a WORKING cross-node transport (a real `redis` /
 * `postgres` cluster driver), and it is why `unregister()`'s cluster fan-out
 * (`notifyWatchers` → `CLUSTER_CHANNEL` → the peer's `invalidateForForeignWrite`)
 * checks out as correct: register() and unregister() call it identically, so
 * the #13405 reading ("create broadcasts, delete does not mirror") is false
 * as a claim about this mechanism.
 *
 * But `Runtime`'s shipped DEFAULT (`cluster` option omitted) is
 * `defineCluster({})` → `driver: 'memory'`, and `MemoryPubSub`'s own
 * doc-comment is explicit: "No cross-process delivery — use the redis /
 * postgres / nats driver for real multi-node setups." Each of N replica
 * PROCESSES constructs its OWN `MemoryPubSub` instance; nothing wires them
 * together. The split-brain guard (`assertClusterDriverSafeForTopology`,
 * `split-brain-guard.ts`) only fires when the operator has *declared*
 * multi-node via `OS_EXPECT_MULTI_NODE` / `OS_CLUSTER_REPLICAS>1` — silent
 * otherwise, by design (ADR-0010, path A).
 *
 * So the below gives A and B *separate* `TestPubSub` instances instead of
 * `makeCluster()`'s shared one — the faithful in-process stand-in for two
 * real OS processes each on the shipped default driver. No live cluster is
 * needed to observe the isolation: it is a property of the transport object
 * (no socket, no IPC — see `MemoryPubSub`'s full implementation), identical
 * whether the two instances live in one test process or two real ones.
 *
 * Both replicas locally `register()` the row before the delete, matching
 * what `restoreRuntimeDatasources` does on every replica's own boot: each
 * reads the same durable `sys_metadata` row and calls `metadata.register()`
 * LOCALLY — not via a broadcast. That is also the reconciling condition for
 * the three-way tension: `readListUncached()` merges the in-memory registry
 * BEFORE the loader and never overwrites a registry hit with a loader
 * answer (see `metadata-manager.ts`). A **new** name a peer's registry has
 * never seen falls through to the (shared, authoritative) loader on every
 * read, so a create looks like it "reaches" peers within one `list()` call —
 * no propagation required. A name a peer's registry already holds POSITIVE
 * is never re-checked against the loader at all, so a stale positive
 * survives every list-cache TTL window forever, not for ~30s. That asymmetry
 * — not "delete doesn't broadcast" — is what #13405 actually observed.
 */
describe('MetadataManager — default `memory` cluster driver does not cross OS processes (#13609)', () => {
    const dsRow = (name: string) => ({ name, driver: 'postgres', origin: 'runtime' as const });

    it('control: WITH a working cross-node transport, unregister() on A evicts B immediately', async () => {
        // `makeCluster()` shares one bus — models a real redis/postgres driver.
        const { store, a, b } = makeCluster();
        await store.save('datasource', 'ds_doomed', dsRow('ds_doomed'));
        // Both replicas locally register at "boot", exactly like
        // `restoreRuntimeDatasources` reading the same `sys_metadata` row.
        await a.register('datasource', 'ds_doomed', dsRow('ds_doomed'));
        await b.register('datasource', 'ds_doomed', dsRow('ds_doomed'));
        expect(await b.get('datasource', 'ds_doomed')).toBeTruthy();

        await a.unregister('datasource', 'ds_doomed');

        // Positive control: the probe below (get + list, same door
        // `/api/v1/meta/datasource` reads through) WOULD have seen this.
        expect(await b.get('datasource', 'ds_doomed')).toBeUndefined();
        expect(viewNames(await b.list('datasource'))).toEqual([]);
    });

    it('WITHOUT it (the shipped default across real replicas): B keeps serving the deleted row past 10 list-cache TTL windows', async () => {
        vi.useFakeTimers();
        try {
            const store = new SharedStoreLoader();
            const a = new MetadataManager({ formats: ['json'], loaders: [store] });
            const b = new MetadataManager({ formats: ['json'], loaders: [store] });
            // Two INDEPENDENT pubsub instances, not shared — the isolation
            // `defineCluster({ driver: 'memory' })` (the omitted-config
            // default) actually ships with across two real processes.
            a.attachClusterPubSub(new TestPubSub(), 'node-A');
            b.attachClusterPubSub(new TestPubSub(), 'node-B');

            await store.save('datasource', 'ds_doomed', dsRow('ds_doomed'));
            await a.register('datasource', 'ds_doomed', dsRow('ds_doomed'));
            await b.register('datasource', 'ds_doomed', dsRow('ds_doomed'));
            expect(await b.get('datasource', 'ds_doomed')).toBeTruthy();

            // DELETE lands on A (e.g. the admin REST door). Storage-first,
            // in-memory second (#5259): A is correct immediately, and the
            // shared DB row is gone too.
            await a.unregister('datasource', 'ds_doomed');
            expect(await a.get('datasource', 'ds_doomed')).toBeUndefined();
            expect(store.storage.get('datasource')?.has('ds_doomed')).toBe(false);

            // B's broadcast never arrives (separate pubsub instance). Advance
            // WAY past the list-cache TTL this manager applies to `list()` —
            // if this were TTL-bound (the #5109 / A2.3 shape) it would have
            // cleared by now. It has not: the stale entry lives in the
            // REGISTRY, which carries no TTL at all, and every fresh
            // `readListUncached()` re-derives the same answer because the
            // registry hit is never checked against the (correct) loader.
            const ttl = (MetadataManager as unknown as { LIST_CACHE_TTL_MS: number })
                .LIST_CACHE_TTL_MS;
            vi.advanceTimersByTime(ttl * 10);

            // This is exactly what `/api/v1/meta/datasource` reads through
            // (`MetadataProtocol` → `metadataService.list('datasource')`) and
            // what the admin `listDatasourceRecords` reads for the
            // detail/admin registry (`metadataOf()?.list('datasource')`).
            expect(await b.get('datasource', 'ds_doomed')).toBeTruthy();
            expect(viewNames(await b.list('datasource'))).toEqual(['ds_doomed']);
        } finally {
            vi.useRealTimers();
        }
    });
});
