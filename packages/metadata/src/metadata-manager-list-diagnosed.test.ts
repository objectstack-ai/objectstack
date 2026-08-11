// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6504 — a KNOWN-PARTIAL `list()` answer must be reachable AS known-partial,
 * not only as a shorter array.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * #5184 taught `readListUncached()` to compute `degraded` — did assembling this
 * set lose a loader? — and #5253 taught the read to be single-flight. Both kept
 * the verdict entirely inside the manager: `list()` spent it on a cache TTL and
 * returned `items` alone, and `IMetadataService` declared no plural counterpart
 * to `getDiagnosed`. So a consumer receiving a short list could not ask whether
 * it was short because that is all anyone declared, or because a loader was
 * down.
 *
 * That is #5840's shape one read over, and sharper there than here: `list` is
 * the read whose answer carries a **count**, and a count is the strongest
 * positive claim a read can make. `reportLoaderReadFailure`'s own message
 * already says what it costs — "every list served from now on is a PARTIAL set
 * presented as a complete one, and the server keeps reporting healthy" — but
 * until `listDiagnosed` existed that sentence was addressed to a log reader
 * only, because no caller had a way to ask.
 *
 * ---------------------------------------------------------------------------
 * Why the failure is REAL and not stubbed
 * ---------------------------------------------------------------------------
 * Every degraded case below is produced by a `DatabaseLoader` over a driver
 * whose `find()` throws `ECONNRESET` — the same harness #5184 uses — so the
 * `catch` in `readListUncached()` is the thing under test and `degraded` is
 * computed rather than injected. A test that handed the manager a pre-made
 * verdict would prove only that a boolean can be passed along, which is exactly
 * the property that was never in doubt.
 *
 * ---------------------------------------------------------------------------
 * What is asserted, and why it is the COUNT
 * ---------------------------------------------------------------------------
 * The load-bearing case is `the outage and the small environment are BYTE-EQUAL
 * through list()`: two managers, one whose single loader is down and one that
 * genuinely holds nothing more, produce `list()` answers that are deep-equal
 * *and equal in length*, while `listDiagnosed()` separates them. A test that
 * only checked "a `degraded` flag exists" would pass on an implementation that
 * reports the flag against the wrong read; pinning the equality is what makes
 * the flag mean something.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red. Reversion is defined as deleting `listDiagnosed()` and letting
 * `list()` narrow the read itself — i.e. the pre-#6504 producer.
 *
 * Predicted, written down before running: **9 red / 1 green**. Every case that
 * calls `listDiagnosed` goes red (vitest transpiles rather than type-checks, so
 * the missing member surfaces as a runtime `TypeError`, not a compile error),
 * and exactly ONE case — *"list() alone cannot tell them apart"* — stays green.
 *
 * That one is an invariant pin rather than a gap, and it is green in BOTH
 * directions on purpose: `list()`'s answer is deliberately unchanged by this
 * PR, which is what keeps every existing caller working. A case that went red
 * there would be reporting a regression, not this fix. The measured result is
 * recorded in the PR body as it came out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager } from './metadata-manager.js';
import { DatabaseLoader } from './loaders/database-loader.js';
import { MemoryLoader } from './loaders/memory-loader.js';

// Stable logger mock — the outage cases would otherwise print one `error` line
// each, and one case reads what was logged.
const logger = vi.hoisted(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
}));

vi.mock('@objectstack/core', () => ({
    createLogger: () => logger,
}));

/** The degraded TTL, read off the class so this file cannot drift from the policy. */
const degradedTtl = (): number =>
    (MetadataManager as unknown as { DEGRADED_LIST_CACHE_TTL_MS: number }).DEGRADED_LIST_CACHE_TTL_MS;

const connectionReset = (): Error =>
    Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

/** A named metadata row, as both the registry and the loader hand them back. */
interface NamedItem {
    name: string;
}

const names = (items: unknown[]): string[] =>
    (items as NamedItem[]).map((i) => i.name).sort();

/**
 * A `sys_metadata` store that fails every read until `heal()`, then serves two
 * `permission` rows. Minimal on purpose: `loadMany()` only reaches `syncSchema`
 * and `find`.
 *
 * Two rows rather than #5184's one so the outage is a real subtraction from a
 * countable total — the healthy answer is 3, the degraded answer is 1, and the
 * gap is the thing a `totalCount` consumer would have understated.
 */
function healableStore(): { driver: IDataDriver; heal: () => void } {
    let broken = true;
    const find = vi.fn(async (): Promise<Record<string, unknown>[]> => {
        if (broken) throw connectionReset();
        return [
            { id: 'r1', name: 'from_db_a', type: 'permission', metadata: JSON.stringify({ name: 'from_db_a' }) },
            { id: 'r2', name: 'from_db_b', type: 'permission', metadata: JSON.stringify({ name: 'from_db_b' }) },
        ];
    });
    const driver = {
        name: 'mock',
        version: '1.0.0',
        supports: {},
        connect: async (): Promise<void> => {},
        disconnect: async (): Promise<void> => {},
        syncSchema: async (): Promise<void> => {},
        find,
    } as unknown as IDataDriver;

    return {
        driver,
        heal: (): void => {
            broken = false;
        },
    };
}

/** Registry item + a `DatabaseLoader` over a store that is down. */
function managerOverBrokenStore(): { manager: MetadataManager; heal: () => void } {
    const store = healableStore();
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    // `cache: { enabled: false }` keeps the loader's OWN LRU out of the picture.
    manager.registerLoader(new DatabaseLoader({ driver: store.driver, cache: { enabled: false } }));
    manager.registerInMemory('permission', 'from_code', { name: 'from_code' });
    return { manager, heal: store.heal };
}

/**
 * A manager that is genuinely small: one declaration, every loader answering.
 * Its `list('permission')` is the answer the broken one above IMITATES.
 */
function managerOverHealthyStore(): MetadataManager {
    const manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
    manager.registerInMemory('permission', 'from_code', { name: 'from_code' });
    return manager;
}

beforeEach(() => {
    logger.error.mockClear();
    logger.info.mockClear();
    logger.warn.mockClear();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('#6504 — the fact the defect was: an outage and a small environment are the same list()', () => {
    it('list() alone cannot tell them apart — same items, same COUNT', async () => {
        const { manager: degraded } = managerOverBrokenStore();
        const healthy = managerOverHealthyStore();

        const fromOutage = await degraded.list('permission');
        const fromSmallEnvironment = await healthy.list('permission');

        // Byte-equal through `list()`. This is the defect stated as an
        // assertion, and it is deliberately still TRUE after the fix: `list()`
        // is unchanged, which is what keeps every existing caller working.
        expect(fromOutage).toEqual(fromSmallEnvironment);
        expect(fromOutage).toHaveLength(fromSmallEnvironment.length);
        expect(names(fromOutage)).toEqual(['from_code']);

        // A consumer rendering the length as a total therefore states the same
        // number in both cases — and in one of them it is wrong.
        expect(fromOutage.length).toBe(1);
    });

    it('listDiagnosed() separates them, and the count claim is what it withholds', async () => {
        const { manager: degraded } = managerOverBrokenStore();
        const healthy = managerOverHealthyStore();

        const outage = await degraded.listDiagnosed('permission');
        const small = await healthy.listDiagnosed('permission');

        // The one thing `list()` could not say.
        expect(outage.degraded).toBe(true);
        expect(small.degraded).toBe(false);

        // Same items and the same count as each other — so the verdict, not the
        // payload, is the entire difference. A fix that changed what is served
        // would be a functional regression wearing a diagnosis fix's clothes.
        expect(outage.items).toEqual(small.items);
        expect(outage.items).toHaveLength(small.items.length);

        // And the count that WOULD have been claimed is knowably a floor, not a
        // total: the environment declares at least 1 permission, and in fact 3.
        expect(outage.items).toHaveLength(1);
    });

    it('names which loader was lost, in `loadDiagnosed`\'s format', async () => {
        const { manager } = managerOverBrokenStore();

        const outage = await manager.listDiagnosed('permission');

        expect(outage.errors).toHaveLength(1);
        expect(outage.errors[0]).toMatch(/^database: /);
        expect(outage.errors[0]).toMatch(/ECONNRESET/);

        // A complete read carries no messages at all — `errors` is empty, never
        // a stale set left over from a previous outage.
        const healthy = await managerOverHealthyStore().listDiagnosed('permission');
        expect(healthy.errors).toEqual([]);
    });
});

describe('#6504 — the healthy direction: a complete read signals nothing degraded', () => {
    it('a reachable loader set yields the FULL count with degraded false', async () => {
        const { manager, heal } = managerOverBrokenStore();
        heal();

        const read = await manager.listDiagnosed('permission');

        // All three: the registry item plus both rows the store holds.
        expect(names(read.items)).toEqual(['from_code', 'from_db_a', 'from_db_b']);
        expect(read.items).toHaveLength(3);
        expect(read.degraded).toBe(false);
        expect(read.errors).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('the outage is a MEASURABLE subtraction from that count, not a different shape', async () => {
        const { manager: broken } = managerOverBrokenStore();
        const { manager: working, heal } = managerOverBrokenStore();
        heal();

        const outage = await broken.listDiagnosed('permission');
        const complete = await working.listDiagnosed('permission');

        // The gap a `totalCount` consumer would have reported as fact: 1 vs 3.
        expect(outage.items.length).toBeLessThan(complete.items.length);
        expect(outage.items).toHaveLength(1);
        expect(complete.items).toHaveLength(3);
    });
});

describe('#6504 — list() and listDiagnosed() are one read seen at two widths', () => {
    it('agree on the items in both directions, and hand back the SAME array instance', async () => {
        const { manager: broken } = managerOverBrokenStore();
        const { manager: working, heal } = managerOverBrokenStore();
        heal();

        // Degraded: same instance, so the two members cannot drift.
        const brokenItems = await broken.list('permission');
        expect((await broken.listDiagnosed('permission')).items).toBe(brokenItems);

        // Healthy: likewise.
        const workingItems = await working.list('permission');
        expect((await working.listDiagnosed('permission')).items).toBe(workingItems);
    });

    it('asking for the verdict costs no extra loader walk — one cache entry serves both', async () => {
        const memory = new MemoryLoader();
        await memory.save('permission', 'stored', { name: 'stored' });
        const manager = new MetadataManager({ formats: ['json'], loaders: [memory] });
        const loadMany = vi.spyOn(memory, 'loadMany');

        await manager.list('permission');
        expect(loadMany).toHaveBeenCalledTimes(1);

        // Served from the entry the `list()` above filled — `listDiagnosed` is
        // the same read, not a second one.
        const diagnosed = await manager.listDiagnosed('permission');
        expect(loadMany).toHaveBeenCalledTimes(1);
        expect(names(diagnosed.items)).toEqual(['stored']);
        expect(diagnosed.degraded).toBe(false);
    });

    it('a memoized DEGRADED read serves its verdict too, not just its items', async () => {
        const { manager } = managerOverBrokenStore();

        await manager.list('permission');
        expect(logger.error).toHaveBeenCalledTimes(1);

        // Inside the degraded window: answered from cache, still known-partial.
        // Before #6504 the cache was the only place this fact lived.
        const cached = await manager.listDiagnosed('permission');
        expect(cached.degraded).toBe(true);
        expect(cached.errors).toHaveLength(1);
        // Still one line — reading the verdict must not re-walk the loaders and
        // re-report the outage.
        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('a listDiagnosed caller JOINING an in-flight read receives that read\'s verdict', async () => {
        const { manager } = managerOverBrokenStore();

        // Issued together, so the second joins the first rather than starting
        // its own walk (#5253). The joiner must not lose the verdict the read
        // it joined had already computed.
        const [plain, diagnosed] = await Promise.all([
            manager.list('permission'),
            manager.listDiagnosed('permission'),
        ]);

        expect(diagnosed.degraded).toBe(true);
        expect(diagnosed.items).toBe(plain);
        // One read, so one outage line — not one per caller.
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});

describe('#6504 — recovery is reported through the verdict, not only the log', () => {
    it('flips back to degraded:false once the store heals and the short TTL lapses', async () => {
        const { manager, heal } = managerOverBrokenStore();

        const duringOutage = await manager.listDiagnosed('permission');
        expect(duringOutage.degraded).toBe(true);
        expect(duringOutage.items).toHaveLength(1);

        heal();
        vi.advanceTimersByTime(degradedTtl() + 1);

        const afterRecovery = await manager.listDiagnosed('permission');
        expect(afterRecovery.degraded).toBe(false);
        expect(afterRecovery.errors).toEqual([]);
        // The count a consumer may now state as a total.
        expect(afterRecovery.items).toHaveLength(3);
    });
});
