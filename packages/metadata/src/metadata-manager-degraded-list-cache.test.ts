// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5184 — a KNOWN-PARTIAL `list()` result must not be memoized as if it were a
 * complete one.
 *
 * After #5108 a loader that cannot read its store throws instead of answering
 * `[]`, so `MetadataManager.list()` catches, logs one line at `error`, and
 * assembles the result from whatever the remaining loaders hold. That
 * best-effort posture is deliberate. What was not deliberate is the next line:
 * the known-short result went into `listCache` on the SAME 30s TTL as a
 * complete read. One `error` line therefore covered a 30s window in which the
 * loader was never asked again — no retry, no second signal — and after the
 * store healed it took up to another 30s before anyone noticed, delaying
 * `reportLoaderReadRecovered` by the same amount. The entry also carried no
 * marker, so no consumer of the cache could tell a partial answer from a
 * complete one.
 *
 * **Why the entry is still cached at all.** The obvious fix — don't cache a
 * degraded read — was rejected, and re-verified before it was rejected. The
 * `listCache` field comment records why the cache exists: security middleware
 * calling `list('permission')` from inside a user-initiated DB transaction,
 * where `DatabaseLoader`'s `engine.find('sys_metadata', …)` tries to acquire a
 * second knex connection while the transaction holds SQLite's only one, and
 * knex waits out `acquireConnectionTimeout` (60s). That hazard is live on the
 * current stack, re-measured under #7708 on 2026-08-11 against a real
 * `ObjectQL` + `SqlDriver` (better-sqlite3): `DatabaseLoader._find()` still
 * does not thread the caller's transaction, and `driver-sql` still models
 * SQLite as a single-connection pool (`activeTransactions`,
 * `assertBareKnexSafe` — a dev/test guard that no-ops in production, so
 * production still eats the timeout). The re-measurement narrowed it to a
 * CONDITION rather than retiring it: a transaction opened directly on the
 * driver stalls the full 60s and then throws knex's acquire-timeout, while one
 * opened through `engine.transaction()` returns at once because the engine
 * publishes it into the ambient `txStore` (ADR-0034) and threads it onto the
 * read. `SqlDriver.ensureSequencesTable()` is the live witness that this is
 * worth designing against — it takes `parentTrx` for exactly this reason. (The
 * witness cited here until #7708 was `plugin-audit`'s `captureBefore`, retired
 * by #6656; it was replaced, not dropped.) Refusing to cache degraded reads
 * would swap one 30s silent window for a 60s stall *per call*. So the policy
 * is: cache it, but mark it `degraded` and expire it on a far shorter TTL.
 *
 * These tests pin all three halves of that: the flag exists on the entry, the
 * degraded TTL is short, and the healthy TTL is untouched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager } from './metadata-manager.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import { MemoryLoader } from './loaders/memory-loader.js';

// Stable logger mock — the recovery timing assertions read what was logged.
const logger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('@objectstack/core', () => ({
    createLogger: () => logger,
}));

/** Mirror of the manager's private `ListCacheEntry` (deliberately not exported). */
type ListCacheEntry = { ts: number; items: unknown[]; degraded: boolean };

/** Peek at the private list cache — the shape under test is internal by design. */
const peekEntry = (mgr: MetadataManager, type: string): ListCacheEntry | undefined =>
    (mgr as unknown as { listCache: Map<string, ListCacheEntry> }).listCache.get(type);

/** The two TTLs, read off the class so the test cannot drift from the policy. */
const ttls = () => {
    const c = MetadataManager as unknown as {
        LIST_CACHE_TTL_MS: number;
        DEGRADED_LIST_CACHE_TTL_MS: number;
    };
    return { healthy: c.LIST_CACHE_TTL_MS, degraded: c.DEGRADED_LIST_CACHE_TTL_MS };
};

const connectionReset = () =>
    Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

/**
 * A `sys_metadata` store that fails every read until `heal()`, then serves one
 * `permission` row. Minimal on purpose: `loadMany()` only reaches `syncSchema`
 * and `find`.
 */
function healableStore() {
    let broken = true;
    const find = vi.fn(async (): Promise<Record<string, unknown>[]> => {
        if (broken) throw connectionReset();
        return [
            {
                id: 'r1',
                name: 'from_db',
                type: 'permission',
                metadata: JSON.stringify({ name: 'from_db' }),
            },
        ];
    });
    const driver = {
        name: 'mock',
        version: '1.0.0',
        supports: {},
        connect: async () => {},
        disconnect: async () => {},
        syncSchema: async () => {},
        find,
    } as unknown as IDataDriver;

    return {
        driver,
        find,
        heal: () => {
            broken = false;
        },
    };
}

/** The issue's repro, assembled: registry item + a DatabaseLoader over a dead store. */
function managerOverBrokenStore() {
    const store = healableStore();
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    // `cache: { enabled: false }` keeps the loader's OWN LRU out of the picture;
    // the memoization under test is the manager's.
    manager.registerLoader(new DatabaseLoader({ driver: store.driver, cache: { enabled: false } }));
    manager.registerInMemory('permission', 'from_code', { name: 'from_code' });
    return { manager, store };
}

const names = (items: unknown[]): string[] =>
    (items as { name: string }[]).map((i) => i.name).sort();

/** Everything logged at `info` so far, joined — `registerLoader` also logs here. */
const infoLines = (): string => logger.info.mock.calls.map((c) => c[0]).join('\n');

beforeEach(() => {
    logger.error.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('#5184 — a degraded list() result is cached AS degraded', () => {
    it('marks the entry `degraded` instead of storing it like a complete read', async () => {
        const { manager } = managerOverBrokenStore();

        expect(names(await manager.list('permission'))).toEqual(['from_code']);

        const entry = peekEntry(manager, 'permission');
        expect(entry).toBeDefined();
        // Still cached — that is what keeps the knex path from re-burning 60s.
        expect(entry!.items).toHaveLength(1);
        // …but no longer indistinguishable from a complete answer.
        expect(entry!.degraded).toBe(true);
    });

    it('a complete read is cached as NOT degraded', async () => {
        const manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
        manager.registerInMemory('permission', 'from_code', { name: 'from_code' });

        await manager.list('permission');

        expect(peekEntry(manager, 'permission')!.degraded).toBe(false);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('degraded entries expire far sooner than complete ones', () => {
        const { healthy, degraded } = ttls();
        expect(healthy).toBe(30_000);
        // The ruling's 1–2s band, and an order of magnitude below the healthy TTL.
        expect(degraded).toBeGreaterThanOrEqual(1_000);
        expect(degraded).toBeLessThanOrEqual(2_000);
        expect(degraded * 10).toBeLessThanOrEqual(healthy);
    });
});

describe('#5184 — the issue repro: a healed store is not shadowed by the degraded entry', () => {
    it('re-asks the loader once the degraded TTL lapses, and serves the healed set', async () => {
        const { manager, store } = managerOverBrokenStore();

        // 1. Outage: one error line, best-effort result, degraded entry cached.
        expect(names(await manager.list('permission'))).toEqual(['from_code']);
        expect(logger.error).toHaveBeenCalledTimes(1);
        const callsAfterFirstList = store.find.mock.calls.length;

        // 2. Inside the degraded window the cache still absorbs the lookups —
        //    the whole reason the entry is cached at all.
        expect(names(await manager.list('permission'))).toEqual(['from_code']);
        expect(store.find.mock.calls.length).toBe(callsAfterFirstList);

        // 3. Storage recovers.
        store.heal();

        // 4. Before #5184 this stayed stale for the rest of a 30s window. It no
        //    longer does: just past the degraded TTL the loader is asked again.
        vi.advanceTimersByTime(ttls().degraded + 1);
        expect(names(await manager.list('permission'))).toEqual(['from_code', 'from_db']);
        expect(store.find.mock.calls.length).toBeGreaterThan(callsAfterFirstList);
    });

    it('the recovery line lands within seconds of the heal, not up to 30s later', async () => {
        const { manager, store } = managerOverBrokenStore();

        await manager.list('permission');
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(infoLines()).not.toMatch(/readable again/i);

        const healedAt = Date.now();
        store.heal();

        vi.advanceTimersByTime(ttls().degraded + 1);
        await manager.list('permission');

        // Well inside the OLD 30s window — under the previous policy nothing
        // would have re-read the loader yet, so `reportLoaderReadRecovered`
        // could not have fired.
        expect(Date.now() - healedAt).toBeLessThan(ttls().healthy);

        expect(infoLines()).toMatch(/readable again/i);
        // Still exactly one outage line — the faster retry must not become log spam.
        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('a second outage after recovery is reported again, and re-marked degraded', async () => {
        const { manager } = managerOverBrokenStore();

        await manager.list('permission');
        expect(peekEntry(manager, 'permission')!.degraded).toBe(true);
        expect(logger.error).toHaveBeenCalledTimes(1);

        // Let the degraded entry lapse against a store that is STILL broken:
        // the rewritten entry must be degraded again, not age into a "complete"
        // one just because it was re-read.
        vi.advanceTimersByTime(ttls().degraded + 1);
        await manager.list('permission');
        expect(peekEntry(manager, 'permission')!.degraded).toBe(true);
        // Once per outage episode, not once per read.
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});

describe('#5184 — the healthy TTL is untouched', () => {
    it('a complete read is still served from cache for the full 30s', async () => {
        const memory = new MemoryLoader();
        await memory.save('permission', 'stored', { name: 'stored' });
        const manager = new MetadataManager({ formats: ['json'], loaders: [memory] });
        const loadMany = vi.spyOn(memory, 'loadMany');

        expect(names(await manager.list('permission'))).toEqual(['stored']);
        expect(loadMany).toHaveBeenCalledTimes(1);

        // Past the degraded TTL, nowhere near the healthy one.
        vi.advanceTimersByTime(ttls().degraded * 3);
        await manager.list('permission');
        expect(loadMany).toHaveBeenCalledTimes(1);

        // Just short of 30s — still cached.
        vi.advanceTimersByTime(ttls().healthy - ttls().degraded * 3 - 1);
        await manager.list('permission');
        expect(loadMany).toHaveBeenCalledTimes(1);

        // Past 30s — re-read, exactly as before.
        vi.advanceTimersByTime(2);
        await manager.list('permission');
        expect(loadMany).toHaveBeenCalledTimes(2);
    });
});

describe('#5184 — 现象二: the comment now describes the code', () => {
    /**
     * The old field comment promised "we only cache positive (non-empty) hits
     * or repeated hits with a stable miss signature". No such condition ever
     * existed. Rather than re-assert prose, pin the behaviour the replacement
     * comment claims: an empty result IS cached, unconditionally.
     */
    it('an empty complete read is cached too — there is no non-empty condition', async () => {
        const memory = new MemoryLoader();
        const manager = new MetadataManager({ formats: ['json'], loaders: [memory] });
        const loadMany = vi.spyOn(memory, 'loadMany');

        expect(await manager.list('permission')).toEqual([]);
        const entry = peekEntry(manager, 'permission');
        expect(entry).toBeDefined();
        expect(entry!.items).toEqual([]);
        expect(entry!.degraded).toBe(false);

        // And it is served from cache, not re-read.
        await manager.list('permission');
        expect(loadMany).toHaveBeenCalledTimes(1);
    });
});
