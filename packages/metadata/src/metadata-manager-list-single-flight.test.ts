// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5253 — `MetadataManager.list()` reads are single-flight per metadata type.
 *
 * `listCache` is written only once a read has FINISHED, so before #5253 it
 * absorbed the caller that arrived second in *time* but never the caller that
 * arrived second in *flight*: N `list('permission')` calls issued while the
 * first one was still walking the loaders all missed and each walked every
 * loader themselves. The `listCache` field comment promises "the loader is only
 * hit once per TTL window"; that promise held for sequential callers only, and
 * the scenario the comment is built for — security middleware calling
 * `list('permission')` from inside a transaction while `DatabaseLoader` waits
 * out knex's 60s `acquireConnectionTimeout` — is exactly where concurrency is
 * most likely, i.e. 60s burned per caller instead of once for all of them.
 *
 * These tests pin the four halves of the fix:
 *   1. the issue's repro (3 concurrent callers ⇒ 1 loader walk) and that
 *      sequential callers still behave per-TTL exactly as before;
 *   2. the SHARED-OUTCOME contract — every sharer of one read gets that read's
 *      result, including when it is known-partial, and the memoized entry is
 *      still judged by #5184's `degraded` rules (2s TTL, not 30s);
 *   3. the mid-read invalidation decision: **the invalidation wins**. A read
 *      that was in flight when `invalidateListCache()` fired keeps running for
 *      the callers already waiting on it, but loses the right to memoize its
 *      pre-write answer, and a caller arriving after the write starts a fresh
 *      read rather than joining a pre-write one (#5219 / #5229's bar: a
 *      consumer woken by an event must not observe the event and pre-event
 *      state together);
 *   4. the in-flight map is self-cleaning — nothing accumulates, and a second
 *      wave after the cache lapses starts exactly one new read.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
    MetadataLoadOptions,
    MetadataLoadResult,
    MetadataLoaderContract,
    MetadataStats,
} from '@objectstack/spec/system';
import { MetadataManager } from './metadata-manager.js';
import type { MetadataLoader } from './loaders/loader-interface.js';

// Stable logger mock — the degraded assertions read what was logged.
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

/** Peek at the private in-flight map — internal by design, load-bearing for #5253. */
const inflight = (mgr: MetadataManager): Map<string, Promise<unknown[]>> =>
    (mgr as unknown as { inflightListReads: Map<string, Promise<unknown[]>> }).inflightListReads;

const ttls = () => {
    const c = MetadataManager as unknown as {
        LIST_CACHE_TTL_MS: number;
        DEGRADED_LIST_CACHE_TTL_MS: number;
    };
    return { healthy: c.LIST_CACHE_TTL_MS, degraded: c.DEGRADED_LIST_CACHE_TTL_MS };
};

const names = (items: unknown[]): string[] =>
    (items as { name: string }[]).map((i) => i.name).sort();

/** Minimal read-only loader; only `loadMany` is exercised by `list()`. */
abstract class TestLoader implements MetadataLoader {
    abstract readonly contract: MetadataLoaderContract;
    abstract loadMany<T = unknown>(type: string, options?: MetadataLoadOptions): Promise<T[]>;
    async load(): Promise<MetadataLoadResult> {
        return { data: null };
    }
    async exists(): Promise<boolean> {
        return false;
    }
    async stat(): Promise<MetadataStats | null> {
        return null;
    }
    async list(): Promise<string[]> {
        return [];
    }
}

/**
 * The issue's `SlowLoader`: `loadMany` resolves 100ms later. Timer-driven, so
 * the repro reads exactly as filed.
 */
class SlowLoader extends TestLoader {
    readonly contract: MetadataLoaderContract = {
        name: 'slow',
        protocol: 'memory:',
        capabilities: { read: true, write: false, watch: false, list: true },
    };
    loadManyCalls = 0;
    constructor(private readonly items: unknown[] = [{ name: 'from_loader' }]) {
        super();
    }
    async loadMany<T = unknown>(): Promise<T[]> {
        this.loadManyCalls += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        return this.items as T[];
    }
}

/**
 * A loader whose reads park until the test lets them through, one at a time.
 * Lets a test hold a read open across a `register()` — the mid-flight window
 * #5253 is about — without depending on timer ordering.
 */
class GatedLoader extends TestLoader {
    readonly contract: MetadataLoaderContract = {
        name: 'gated',
        protocol: 'memory:',
        capabilities: { read: true, write: false, watch: false, list: true },
    };
    loadManyCalls = 0;
    /** When true, a released read throws instead of answering (outage). */
    broken = false;
    private parked: Array<() => void> = [];

    constructor(private readonly items: unknown[] = [{ name: 'from_loader' }]) {
        super();
    }

    async loadMany<T = unknown>(): Promise<T[]> {
        this.loadManyCalls += 1;
        await new Promise<void>((resolve) => this.parked.push(resolve));
        if (this.broken) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
        return this.items as T[];
    }

    get parkedCount(): number {
        return this.parked.length;
    }

    /** Let the oldest parked read proceed. */
    releaseNext(): void {
        this.parked.shift()?.();
    }

    /** Let every currently parked read proceed. */
    releaseAll(): void {
        const parked = this.parked;
        this.parked = [];
        for (const resolve of parked) resolve();
    }
}

/** Give queued microtasks a chance to run without advancing fake time. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

beforeEach(() => {
    logger.error.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('#5253 — concurrent list() calls share one loader walk', () => {
    it('the issue repro: three concurrent list() calls hit the loader ONCE', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const slow = new SlowLoader();
        manager.registerLoader(slow);

        const all = Promise.all([
            manager.list('permission'),
            manager.list('permission'),
            manager.list('permission'),
        ]);
        await vi.advanceTimersByTimeAsync(100);
        const [a, b, c] = await all;

        // Expected 1 (the `listCache` comment's "only hit once per TTL
        // window"); before #5253 this was 3.
        expect(slow.loadManyCalls).toBe(1);
        expect(names(a)).toEqual(['from_loader']);
        expect(names(b)).toEqual(['from_loader']);
        expect(names(c)).toEqual(['from_loader']);
    });

    it('sharers receive the SAME result, not three equal copies assembled separately', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const gated = new GatedLoader();
        manager.registerLoader(gated);

        const reads = [manager.list('view'), manager.list('view'), manager.list('view')];
        await flush();
        expect(gated.loadManyCalls).toBe(1);

        gated.releaseAll();
        const [a, b, c] = await Promise.all(reads);

        expect(a).toBe(b);
        expect(b).toBe(c);
        // …and it is the very array memoized for the callers that come next.
        expect(peekEntry(manager, 'view')!.items).toBe(a);
    });

    it('the in-flight slot is self-cleaning: empty once the read settles', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const gated = new GatedLoader();
        manager.registerLoader(gated);

        const reads = [manager.list('view'), manager.list('view')];
        expect(inflight(manager).size).toBe(1);

        gated.releaseAll();
        await Promise.all(reads);

        expect(inflight(manager).size).toBe(0);
        expect(gated.loadManyCalls).toBe(1);
    });

    it('a second wave after settle is served by the cache, and after the TTL starts exactly ONE new read', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const gated = new GatedLoader();
        manager.registerLoader(gated);

        const first = [manager.list('view'), manager.list('view')];
        gated.releaseAll();
        await Promise.all(first);
        expect(gated.loadManyCalls).toBe(1);

        // Within the TTL: the cache answers, nothing reaches the loader.
        await manager.list('view');
        await manager.list('view');
        expect(gated.loadManyCalls).toBe(1);

        // Past the TTL: a fresh concurrent wave — one walk for the whole wave,
        // not one per caller and not a stale memoized promise either.
        vi.advanceTimersByTime(ttls().healthy + 1);
        const second = [manager.list('view'), manager.list('view'), manager.list('view')];
        await flush();
        expect(gated.loadManyCalls).toBe(2);
        gated.releaseAll();
        await Promise.all(second);
        expect(gated.loadManyCalls).toBe(2);
    });

    it('sequential callers are unchanged: one walk per TTL window, as before', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const slow = new SlowLoader();
        manager.registerLoader(slow);

        const read = async () => {
            const p = manager.list('view');
            await vi.advanceTimersByTimeAsync(100);
            return p;
        };

        await read();
        expect(slow.loadManyCalls).toBe(1);
        await manager.list('view');
        expect(slow.loadManyCalls).toBe(1);

        vi.advanceTimersByTime(ttls().healthy + 1);
        await read();
        expect(slow.loadManyCalls).toBe(2);
    });

    it('different types do not share a read', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const gated = new GatedLoader();
        manager.registerLoader(gated);

        const reads = [manager.list('view'), manager.list('permission')];
        await flush();
        expect(gated.loadManyCalls).toBe(2);
        expect(inflight(manager).size).toBe(2);

        gated.releaseAll();
        await Promise.all(reads);
        expect(inflight(manager).size).toBe(0);
    });
});

describe('#5253 — sharing a DEGRADED read is an explicit contract', () => {
    /**
     * `list()` is best-effort and does not throw, so a lost loader is not an
     * error to fail over from — it is the answer. Every sharer therefore gets
     * the same known-partial set, and #5184's judgment still applies to what is
     * memoized: single-flight must not become a back door onto the 30s TTL.
     */
    it('all concurrent callers get the same partial set, memoized degraded on the short TTL', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const gated = new GatedLoader();
        gated.broken = true;
        manager.registerLoader(gated);
        manager.registerInMemory('permission', 'from_code', { name: 'from_code' });

        const reads = [
            manager.list('permission'),
            manager.list('permission'),
            manager.list('permission'),
        ];
        await flush();
        expect(gated.loadManyCalls).toBe(1);

        gated.releaseAll();
        const [a, b, c] = await Promise.all(reads);

        // One outage, one walk, one shared answer.
        expect(gated.loadManyCalls).toBe(1);
        expect(names(a)).toEqual(['from_code']);
        expect(a).toBe(b);
        expect(b).toBe(c);
        // Said once, not once per sharer.
        expect(logger.error).toHaveBeenCalledTimes(1);

        // [#5184] The entry is stored AS degraded — sharing did not launder it.
        const entry = peekEntry(manager, 'permission')!;
        expect(entry.degraded).toBe(true);
        expect(entry.items).toBe(a);
    });

    it('the shared degraded entry expires on the 2s TTL, not the 30s one', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const gated = new GatedLoader();
        gated.broken = true;
        manager.registerLoader(gated);
        manager.registerInMemory('permission', 'from_code', { name: 'from_code' });

        const reads = [manager.list('permission'), manager.list('permission')];
        gated.releaseAll();
        await Promise.all(reads);
        expect(gated.loadManyCalls).toBe(1);

        // Inside the degraded window the burst is still absorbed…
        await manager.list('permission');
        expect(gated.loadManyCalls).toBe(1);

        // …and just past it the loader is re-asked, exactly as for a solo read.
        vi.advanceTimersByTime(ttls().degraded + 1);
        gated.broken = false;
        const retry = manager.list('permission');
        await flush();
        gated.releaseAll();
        expect(names(await retry)).toEqual(['from_code', 'from_loader']);
        expect(gated.loadManyCalls).toBe(2);
        expect(peekEntry(manager, 'permission')!.degraded).toBe(false);
    });
});

describe('#5253 — an invalidation that crosses an in-flight read WINS', () => {
    /**
     * The decision this pins (see the `inflightListReads` field comment):
     * callers already waiting still receive the in-flight, pre-write answer —
     * they asked before the write — but that answer is never memoized past the
     * invalidation, and nobody who asks after the write joins it.
     */
    const managerMidRead = async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const gated = new GatedLoader();
        manager.registerLoader(gated);
        // Read starts and parks inside the loader — the registry snapshot it
        // took is already fixed at this point.
        const firstRead = manager.list('permission');
        await flush();
        expect(gated.loadManyCalls).toBe(1);
        // A write lands mid-read.
        await manager.register('permission', 'from_write', { name: 'from_write' });
        return { manager, gated, firstRead };
    };

    it('the waiting caller still gets the pre-write result — it is not restarted under them', async () => {
        const { gated, firstRead } = await managerMidRead();

        gated.releaseAll();
        // Assembled before the write landed, and delivered as such: one walk,
        // no retry loop bolted onto a best-effort seam.
        expect(names(await firstRead)).toEqual(['from_loader']);
        expect(gated.loadManyCalls).toBe(1);
    });

    it('but that pre-write answer is NOT memoized: the next read observes the write', async () => {
        const { manager, gated, firstRead } = await managerMidRead();

        gated.releaseAll();
        await firstRead;

        // The invalidation wins: nothing was written back over it.
        expect(peekEntry(manager, 'permission')).toBeUndefined();
        expect(inflight(manager).size).toBe(0);

        const next = manager.list('permission');
        await flush();
        gated.releaseAll();
        expect(names(await next)).toEqual(['from_loader', 'from_write']);
        expect(gated.loadManyCalls).toBe(2);
        expect(names(peekEntry(manager, 'permission')!.items)).toEqual(['from_loader', 'from_write']);
    });

    it('a caller arriving AFTER the write starts a fresh read instead of joining the pre-write one', async () => {
        const { manager, gated, firstRead } = await managerMidRead();

        // #5219 / #5229's bar: a consumer woken by the change must not be handed
        // a read that began before it.
        const afterWrite = manager.list('permission');
        await flush();
        expect(gated.loadManyCalls).toBe(2);

        gated.releaseAll();
        const [before, after] = await Promise.all([firstRead, afterWrite]);
        expect(names(before)).toEqual(['from_loader']);
        expect(names(after)).toEqual(['from_loader', 'from_write']);
        // Only the post-write read gets to memoize.
        expect(names(peekEntry(manager, 'permission')!.items)).toEqual(['from_loader', 'from_write']);
    });

    it('the retracted read settling does not evict the fresh read that replaced it', async () => {
        const { manager, gated, firstRead } = await managerMidRead();

        const afterWrite = manager.list('permission');
        await flush();
        expect(gated.loadManyCalls).toBe(2);

        // Settle ONLY the retracted read.
        gated.releaseNext();
        await firstRead;

        // The fresh read still owns the slot…
        expect(inflight(manager).size).toBe(1);
        // …so a third caller joins it rather than starting a third walk.
        const joiner = manager.list('permission');
        await flush();
        expect(gated.loadManyCalls).toBe(2);

        gated.releaseAll();
        const [after, joined] = await Promise.all([afterWrite, joiner]);
        expect(after).toBe(joined);
        expect(names(joined)).toEqual(['from_loader', 'from_write']);
        expect(inflight(manager).size).toBe(0);
    });

    it('a foreign write (cluster peer / FS event) retracts the in-flight read the same way', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [] });
        const gated = new GatedLoader();
        manager.registerLoader(gated);

        const firstRead = manager.list('permission');
        await flush();

        // Same seam #5109 (cluster) and #5218 (filesystem) invalidate through.
        (manager as unknown as { invalidateForForeignWrite(t: string, n?: string): void })
            .invalidateForForeignWrite('permission', 'from_peer');

        gated.releaseAll();
        await firstRead;

        expect(peekEntry(manager, 'permission')).toBeUndefined();
    });
});
