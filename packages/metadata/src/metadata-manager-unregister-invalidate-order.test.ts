// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5259 — `unregister()` invalidates the list cache AFTER the storage delete
 * lands, not before it.
 *
 * `unregister()` used to drop the registry entry and call
 * `invalidateListCache(type)` and only THEN `await loader.delete(...)`. Between
 * those two steps the manager sat in a state that exists nowhere else —
 * **registry already empty, loader not yet empty** — and `list()` merges the
 * two. So a read arriving in that window missed the just-cleared cache,
 * assembled the still-stored row into its answer, and memoized it as a
 * COMPLETE read: the full 30s healthy TTL, because no loader threw and #5184's
 * 2s degraded TTL therefore never applied. Nothing invalidated again after the
 * delete landed (`notifyWatchers()` does not touch `listCache`), so a row that
 * was gone from storage kept being enumerated for up to half a minute — while
 * `get()`, which never reads that cache, said it was gone.
 *
 * `register()` never had the defect, and the reason is the fix: it writes the
 * registry first, and the registry outranks every loader in the merge, so its
 * own save window already shows the post-write state. The invariant is
 * therefore not "invalidate early" but **invalidate last, once every store
 * already holds the announced state** — which for a delete means storage first,
 * then registry + invalidate with nothing awaited between them, then announce
 * (#5219's invalidate-before-notify bar, unchanged).
 *
 * What these tests pin:
 *   1. the issue's probe, verbatim — a `list()` racing the delete must not
 *      leave the deleted item cached once the delete has landed;
 *   2. the composition with #5253's single-flight: a read still IN FLIGHT when
 *      the delete lands is covered by `invalidateListCache()` retracting its
 *      `inflightListReads` registration — dropping `listCache` alone cannot
 *      reach it, because it has not written its entry yet;
 *   3. the invalidation is after ALL loaders, not per loader;
 *   4. a watcher woken by the `deleted` event that re-reads sees the delete;
 *   5. the `loader.delete()` failure path is now loud at `error` with its
 *      consequence and its fix, once per un-deleted item;
 *   6. the deliberate decision that the registry entry is STILL dropped when
 *      the storage delete failed — the runtime converges on storage truth
 *      instead of pinning a second in-memory copy;
 *   7. `register()`'s own ordering is unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
    MetadataLoadOptions,
    MetadataLoadResult,
    MetadataLoaderContract,
    MetadataSaveResult,
    MetadataStats,
} from '@objectstack/spec/system';
import { MetadataManager } from './metadata-manager.js';
import type { MetadataLoader } from './loaders/loader-interface.js';
import type { MetadataWatchEvent } from '@objectstack/spec/system';

// Stable logger mock — the failure-path assertions read what was logged.
const logger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
    createLogger: () => logger,
}));

/** Mirror of the manager's private `ListCacheEntry` (deliberately not exported). */
type ListCacheEntry = { ts: number; items: unknown[]; degraded: boolean };

const peekEntry = (mgr: MetadataManager, type: string): ListCacheEntry | undefined =>
    (mgr as unknown as { listCache: Map<string, ListCacheEntry> }).listCache.get(type);

/** Peek at #5253's in-flight map — internal by design, load-bearing here. */
const inflight = (mgr: MetadataManager): Map<string, Promise<unknown[]>> =>
    (mgr as unknown as { inflightListReads: Map<string, Promise<unknown[]>> }).inflightListReads;

/** Peek at the in-memory registry — the half `list()` cannot tell apart from a loader hit. */
const registryHas = (mgr: MetadataManager, type: string, name: string): boolean =>
    (mgr as unknown as { registry: Map<string, Map<string, unknown>> }).registry.get(type)?.has(name) ??
    false;

const names = (items: unknown[]): string[] =>
    (items as { name: string }[]).map((i) => i.name).sort();

/** A gate a test opens by hand, so nothing depends on timer ordering. */
class Gate {
    private parked: Array<() => void> = [];
    closed = false;
    async pass(): Promise<void> {
        if (!this.closed) return;
        await new Promise<void>((resolve) => this.parked.push(resolve));
    }
    get parkedCount(): number {
        return this.parked.length;
    }
    releaseAll(): void {
        const parked = this.parked;
        this.parked = [];
        for (const resolve of parked) resolve();
    }
}

/**
 * A writable `datasource:` loader backed by a real store — the shape
 * `unregister()` actually persists to.
 *
 * `loadMany` SNAPSHOTS the store before parking, modelling a real read that
 * began before a concurrent delete committed: it answers with the rows it saw,
 * not with whatever the store holds when it finally returns. That is precisely
 * the read whose answer must not outlive the delete.
 */
class StoreLoader implements MetadataLoader {
    readonly contract: MetadataLoaderContract;
    /** type → name → data. */
    readonly store = new Map<string, Map<string, unknown>>();

    readonly readGate = new Gate();
    readonly writeGate = new Gate();
    readonly deleteGate = new Gate();

    /** When true, `delete()` throws instead of removing the row (storage outage). */
    failDeletes = false;
    /** When true the loader has no `delete` at all — see `hasDelete`. */
    loadManyCalls = 0;
    deleteCalls: Array<{ type: string; name: string }> = [];

    constructor(name = 'db') {
        this.contract = {
            name,
            protocol: 'datasource:',
            capabilities: { read: true, write: true, watch: false, list: true },
        };
    }

    seed(type: string, name: string, data: unknown): void {
        if (!this.store.has(type)) this.store.set(type, new Map());
        this.store.get(type)!.set(name, data);
    }

    has(type: string, name: string): boolean {
        return this.store.get(type)?.has(name) ?? false;
    }

    async loadMany<T = unknown>(type: string, _options?: MetadataLoadOptions): Promise<T[]> {
        this.loadManyCalls += 1;
        const snapshot = Array.from(this.store.get(type)?.values() ?? []);
        await this.readGate.pass();
        return snapshot as T[];
    }

    async save(type: string, name: string, data: unknown): Promise<MetadataSaveResult> {
        await this.writeGate.pass();
        this.seed(type, name, data);
        return { success: true };
    }

    async delete(type: string, name: string): Promise<void> {
        this.deleteCalls.push({ type, name });
        await this.deleteGate.pass();
        if (this.failDeletes) {
            throw Object.assign(new Error('delete failed: ECONNRESET'), { code: 'ECONNRESET' });
        }
        this.store.get(type)?.delete(name);
    }

    async load(type: string, name: string): Promise<MetadataLoadResult> {
        const data = this.store.get(type)?.get(name);
        return { data: data ?? null };
    }
    async exists(type: string, name: string): Promise<boolean> {
        return this.has(type, name);
    }
    async stat(): Promise<MetadataStats | null> {
        return null;
    }
    async list(type: string): Promise<string[]> {
        return Array.from(this.store.get(type)?.keys() ?? []);
    }
}

/** Give queued microtasks a chance to run. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

const newManager = (...loaders: MetadataLoader[]): MetadataManager => {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    for (const loader of loaders) manager.registerLoader(loader);
    return manager;
};

beforeEach(() => {
    logger.error.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
    logger.debug.mockClear();
});

describe('#5259 — a list() racing unregister() cannot outlive the delete', () => {
    it("the issue's probe: after the delete lands, list() is empty — not the deleted item for 30s", async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'doomed', { name: 'doomed' });
        expect(loader.has('view', 'doomed')).toBe(true);

        // Park the storage delete so the probe can read inside the window.
        loader.deleteGate.closed = true;
        const removal = manager.unregister('view', 'doomed');
        await flush();
        expect(loader.deleteGate.parkedCount).toBe(1);

        // The concurrent read. Inside the window the delete has neither landed
        // nor been announced, so seeing the item is the TRUTH, not the bug —
        // and, unlike before the fix, it is a coherent truth: registry and
        // loader agree, rather than the registry being empty already.
        const during = await manager.list('view');
        expect(names(during)).toEqual(['doomed']);
        expect(peekEntry(manager, 'view')).toBeDefined();

        // Let the delete land.
        loader.deleteGate.releaseAll();
        await removal;
        expect(loader.has('view', 'doomed')).toBe(false);

        // The pin. Before the fix this read was served from a 30s-TTL entry
        // written inside the window: `AFTER DELETE, list("view") =
        // [{"name":"doomed"}]` with the loader store already empty.
        expect(peekEntry(manager, 'view')).toBeUndefined();
        expect(await manager.list('view')).toEqual([]);
    });

    it('the deleted item does not come back on any read within the healthy TTL', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'doomed', { name: 'doomed' });
        await manager.register('view', 'keeper', { name: 'keeper' });

        loader.deleteGate.closed = true;
        const removal = manager.unregister('view', 'doomed');
        await flush();
        await manager.list('view'); // caches the pre-delete pair
        loader.deleteGate.releaseAll();
        await removal;

        // Nothing advances the clock: if the window's entry had survived, these
        // reads would serve it for the next 30s.
        for (let i = 0; i < 3; i++) {
            expect(names(await manager.list('view'))).toEqual(['keeper']);
        }
    });

    it('#5253 composition: a read still IN FLIGHT when the delete lands loses the right to cache', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'doomed', { name: 'doomed' });

        // A read that parks inside `loadMany`, having already snapshotted the
        // pre-delete rows. `listCache` cannot cover this one — it has not
        // written an entry yet, and would write the pre-delete answer AFTER any
        // invalidation. Only retracting its `inflightListReads` registration
        // reaches it, which is the mechanism #5253 added and this ordering fix
        // depends on.
        loader.readGate.closed = true;
        const inFlight = manager.list('view');
        await flush();
        expect(loader.readGate.parkedCount).toBe(1);
        expect(inflight(manager).has('view')).toBe(true);

        // The delete lands (and is announced) while that read is still parked.
        await manager.unregister('view', 'doomed');
        expect(loader.has('view', 'doomed')).toBe(false);
        expect(inflight(manager).has('view')).toBe(false); // registration retracted

        // The caller already waiting keeps its answer — it asked before the
        // delete, and restarting the read under it is what #5253 rejected.
        loader.readGate.releaseAll();
        expect(names(await inFlight)).toEqual(['doomed']);

        // But that answer was NOT memoized, so nobody else inherits it.
        expect(peekEntry(manager, 'view')).toBeUndefined();
        loader.readGate.closed = false;
        expect(await manager.list('view')).toEqual([]);
    });

    it('the invalidation happens after ALL writable loaders, not after each one', async () => {
        const fast = new StoreLoader('fast');
        const slow = new StoreLoader('slow');
        const manager = newManager(fast, slow);
        await manager.register('view', 'doomed', { name: 'doomed' });
        expect(fast.has('view', 'doomed')).toBe(true);
        expect(slow.has('view', 'doomed')).toBe(true);

        // `fast` deletes immediately, `slow` parks: the window where one store
        // is already empty and the other is not.
        slow.deleteGate.closed = true;
        const removal = manager.unregister('view', 'doomed');
        await flush();
        expect(fast.has('view', 'doomed')).toBe(false);
        expect(slow.deleteGate.parkedCount).toBe(1);

        // A read completing in that partial window still memoizes the item…
        expect(names(await manager.list('view'))).toEqual(['doomed']);
        expect(peekEntry(manager, 'view')).toBeDefined();

        // …and the single invalidation after the LAST delete clears it.
        slow.deleteGate.releaseAll();
        await removal;
        expect(peekEntry(manager, 'view')).toBeUndefined();
        expect(await manager.list('view')).toEqual([]);
    });

    it('#5219 bar: a watcher woken by the `deleted` event re-reads the post-delete state', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'doomed', { name: 'doomed' });
        await manager.list('view'); // warm the cache with the pre-delete answer

        let seen: unknown[] | undefined;
        const observed = new Promise<void>((resolve) => {
            manager.subscribe('view', async (event: MetadataWatchEvent) => {
                if (event.type !== 'deleted') return;
                seen = await manager.list('view');
                resolve();
            });
        });

        await manager.unregister('view', 'doomed');
        await observed;
        expect(seen).toEqual([]);
    });

    it('{ notify: false } still suppresses the announcement — and still invalidates', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'doomed', { name: 'doomed' });
        await manager.list('view');

        const events: MetadataWatchEvent[] = [];
        manager.subscribe('view', (event) => {
            events.push(event);
        });

        await manager.unregister('view', 'doomed', { notify: false });
        expect(events).toEqual([]);
        expect(await manager.list('view')).toEqual([]);
    });
});

describe('#5259 — a storage delete that fails is loud', () => {
    it('logs at `error` (not `warn`) and names both the consequence and the fix', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'doomed', { name: 'doomed' });
        logger.error.mockClear();
        logger.warn.mockClear();

        loader.failDeletes = true;
        // Still resolves: the seam is best-effort by contract, which is exactly
        // why the log has to carry the whole signal.
        await expect(manager.unregister('view', 'doomed')).resolves.toBeUndefined();

        expect(logger.error).toHaveBeenCalledTimes(1);
        const [message, cause, context] = logger.error.mock.calls[0] as [string, unknown, unknown];
        // Consequence — the row survived, and the system still looks healthy.
        expect(message).toContain('view/doomed');
        expect(message).toContain('db');
        expect(message).toMatch(/STILL in its store/);
        expect(message).toMatch(/reappears/);
        // Fix — what to do about it.
        expect(message).toMatch(/Fix:/);
        expect(cause).toBeInstanceOf(Error);
        expect(context).toMatchObject({ loader: 'db', type: 'view', name: 'doomed' });

        // The old `warn` is gone, not merely joined by an error.
        const warnedAboutDelete = logger.warn.mock.calls.some((call) =>
            String(call[0]).toLowerCase().includes('delete'),
        );
        expect(warnedAboutDelete).toBe(false);
    });

    it('reports once per un-deleted ITEM — a batch teardown does not lose the casualty list', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'alpha', { name: 'alpha' });
        await manager.register('view', 'beta', { name: 'beta' });
        logger.error.mockClear();

        loader.failDeletes = true;
        await manager.bulkUnregister([
            { type: 'view', name: 'alpha' },
            { type: 'view', name: 'beta' },
        ]);

        expect(logger.error).toHaveBeenCalledTimes(2);
        const messages = logger.error.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => m.includes('view/alpha'))).toBe(true);
        expect(messages.some((m) => m.includes('view/beta'))).toBe(true);
    });

    it('reports once per loader that failed, naming each store that kept the row', async () => {
        const a = new StoreLoader('db_a');
        const b = new StoreLoader('db_b');
        const manager = newManager(a, b);
        await manager.register('view', 'doomed', { name: 'doomed' });
        logger.error.mockClear();

        a.failDeletes = true;
        b.failDeletes = true;
        await manager.unregister('view', 'doomed');

        expect(logger.error).toHaveBeenCalledTimes(2);
        const messages = logger.error.mock.calls.map((call) => String(call[0]));
        expect(messages.some((m) => m.includes('db_a'))).toBe(true);
        expect(messages.some((m) => m.includes('db_b'))).toBe(true);
    });

    it('one loader failing does not stop the delete reaching the others', async () => {
        const broken = new StoreLoader('broken');
        const healthy = new StoreLoader('healthy');
        const manager = newManager(broken, healthy);
        await manager.register('view', 'doomed', { name: 'doomed' });

        broken.failDeletes = true;
        await manager.unregister('view', 'doomed');

        expect(broken.has('view', 'doomed')).toBe(true);
        expect(healthy.has('view', 'doomed')).toBe(false);
        expect(healthy.deleteCalls).toEqual([{ type: 'view', name: 'doomed' }]);
    });

    /**
     * The decision the issue asked for, pinned so it cannot be reversed by
     * accident: the registry entry is dropped even though the storage delete
     * failed.
     *
     * Keeping it would look safer and is not. The loader still holds the row
     * and `list()`/`get()` merge registry ∪ loaders, so the item is served
     * either way — the surviving registry entry would only decide WHICH copy
     * wins, pinning an in-memory definition on top of a stored row nobody
     * maintains anymore. Dropping it makes the next read fall through to
     * storage, which after a failed delete is the actual truth (the item still
     * exists), and makes that visible immediately instead of at the next
     * restart. The divergence is reported by the `error` above, not papered
     * over with a second in-memory copy.
     */
    it('drops the registry entry anyway, so the next read converges on storage truth', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'doomed', { name: 'doomed' });

        loader.failDeletes = true;
        await manager.unregister('view', 'doomed');

        expect(registryHas(manager, 'view', 'doomed')).toBe(false);
        // Storage kept the row, so the item is visibly back — immediately, and
        // in every face at once rather than `list()` and `get()` disagreeing.
        expect(loader.has('view', 'doomed')).toBe(true);
        expect(names(await manager.list('view'))).toEqual(['doomed']);
        expect(await manager.get('view', 'doomed')).toEqual({ name: 'doomed' });
    });
});

describe('#5259 — register() is unchanged', () => {
    it('still writes the registry BEFORE its save window, so a read inside it sees the new value', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);
        await manager.register('view', 'existing', { name: 'existing', v: 1 });
        await manager.list('view'); // warm the cache

        // Park the storage write: the mirror image of the delete window.
        loader.writeGate.closed = true;
        const write = manager.register('view', 'existing', { name: 'existing', v: 2 });
        await flush();
        expect(loader.writeGate.parkedCount).toBe(1);

        // Registry-first + invalidate-first is what makes this the NEW value:
        // the registry outranks the loader's still-old row in the merge. This
        // is the ordering #5259 deliberately did NOT change.
        const during = (await manager.list('view')) as Array<{ name: string; v: number }>;
        expect(during).toEqual([{ name: 'existing', v: 2 }]);

        loader.writeGate.releaseAll();
        await write;
        expect(await manager.list('view')).toEqual([{ name: 'existing', v: 2 }]);
        expect(loader.store.get('view')?.get('existing')).toEqual({ name: 'existing', v: 2 });
    });

    it('still announces added/changed, and the announcement still follows the invalidation', async () => {
        const loader = new StoreLoader();
        const manager = newManager(loader);

        const seen: Array<{ type: string; listedAtEvent: string[] }> = [];
        const settled: Array<Promise<void>> = [];
        manager.subscribe('view', (event: MetadataWatchEvent) => {
            settled.push(
                (async () => {
                    seen.push({
                        type: event.type,
                        listedAtEvent: names(await manager.list('view')),
                    });
                })(),
            );
        });

        await manager.register('view', 'a', { name: 'a' });
        await manager.register('view', 'a', { name: 'a', v: 2 });
        await manager.unregister('view', 'a');
        await Promise.all(settled);

        expect(seen.map((s) => s.type)).toEqual(['added', 'changed', 'deleted']);
        // Every watcher that re-read on the event saw the post-write state.
        expect(seen.map((s) => s.listedAtEvent)).toEqual([['a'], ['a'], []]);
    });
});
