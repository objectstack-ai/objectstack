// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30429] The runtime package-publish door's fallback seed apply reports
 * `seedApplied.landed` on a load that THREW part-way, exactly as
 * `metadata-protocol`'s in-protocol apply does: the datasets that FINISHED
 * before the throw are listed (created vs matched, through the shared
 * `seedAppliedLanded`), the dataset that threw is not, and a failure before
 * any load ran leaves `landed` absent.
 *
 * The in-protocol half is pinned at a real engine in `@objectstack/objectql`'s
 * `publish-seed-receipt-landed-ids.test.ts`. This file pins the second
 * producer, which reads the same `seedLoadPartialWrites` off the error: a
 * dispatcher whose protocol does NOT self-apply seeds, driving the REAL
 * `SeedLoaderService` (harness shape copied from
 * `packages-seed-apply-disclosure.test.ts`, so each file fails on its own).
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** The object whose existing-row read fails — the throw inside the second dataset. */
const BROKEN = 'broken_thing';

function makeDoor(opts: { brokenSeed?: boolean; failGetMetaItem?: boolean } = {}) {
    const published = [
        { type: 'seed', name: 'project_seed', version: 'h' },
        ...(opts.brokenSeed ? [{ type: 'seed', name: 'broken_seed', version: 'h' }] : []),
    ];
    const publishPackageDrafts = vi.fn().mockResolvedValue({
        success: true, publishedCount: published.length, failedCount: 0, published, failed: [],
    });
    const bodies: Record<string, unknown> = {
        project_seed: { object: 'project', externalId: 'name', mode: 'ignore', records: [{ name: 'Apollo' }, { name: 'Gemini' }] },
        broken_seed: { object: BROKEN, externalId: 'name', mode: 'ignore', records: [{ name: 'X' }] },
    };
    const getMetaItem = vi.fn().mockImplementation(async ({ name }: { name: string }) => {
        if (opts.failGetMetaItem) throw new Error('read-back failed');
        return { type: 'seed', name, lock: null, editable: true, item: bodies[name] };
    });
    // The rows the engine handed back ids for, in write order — the ids the
    // receipt must name, read here rather than derived from the code under test.
    const insertedIds: string[] = [];
    const insert = vi.fn().mockImplementation(async (_object: string, rec: any) => {
        const one = (r: any) => { const id = `id_${r.name}`; insertedIds.push(id); return { id }; };
        return Array.isArray(rec) ? rec.map(one) : one(rec);
    });
    // A customer's own `Gemini` already exists, so `ignore` matches it.
    const find = vi.fn().mockImplementation(async (object: string) => {
        if (object === 'sys_organization') return [{ id: 'org_default' }];
        if (object === BROKEN) throw new Error('the broken_thing table is unreadable');
        if (object === 'project') return [{ id: 'cust_gemini', name: 'Gemini' }];
        return [];
    });
    const getObject = vi.fn().mockImplementation(async (name: string) => ({
        name, fields: { name: { type: 'text' } },
    }));
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return Promise.resolve({ publishPackageDrafts, getMetaItem });
            if (name === 'objectql') {
                return Promise.resolve({
                    insert, find, update: vi.fn(),
                    registry: { getAllPackages: vi.fn().mockReturnValue([]) },
                });
            }
            if (name === 'metadata') return Promise.resolve({ getObject });
            return null;
        },
        context: { getService: () => null },
    };
    return { dispatcher: new HttpDispatcher(kernel), insertedIds, find };
}

async function publishDrafts(opts: Parameters<typeof makeDoor>[0] = {}) {
    const door = makeDoor(opts);
    const result = await door.dispatcher.handlePackages('/com.workspace/publish-drafts', 'POST', {}, {}, PKG_ADMIN());
    expect(result.response?.status).toBe(200);
    return { ...door, seedApplied: (result.response as any)?.body?.data?.seedApplied };
}

const list = (ids: string[]) => ({ ids, total: ids.length, truncated: false });

describe('#30429 · the runtime fallback reports a thrown load\'s finished datasets', () => {
    it('positive control: a returned load lists the rows, created vs matched', async () => {
        const { seedApplied, insertedIds } = await publishDrafts();

        expect(seedApplied?.success).toBe(true);
        expect(insertedIds).toEqual(['id_Apollo']);
        expect(seedApplied?.landed).toEqual([{ object: 'project', inserted: list(insertedIds), matched: list(['cust_gemini']) }]);
    });

    it('a load that threw on a later dataset still lists the dataset that finished, and not the one that threw', async () => {
        const { seedApplied, insertedIds, find } = await publishDrafts({ brokenSeed: true });

        // The throw is the second dataset's own existing-row read, after the
        // first dataset wrote its row.
        expect(find).toHaveBeenCalledWith(BROKEN, expect.anything());
        expect(insertedIds).toEqual(['id_Apollo']);
        expect(seedApplied?.success).toBe(false);
        expect(seedApplied?.landed).toEqual([{ object: 'project', inserted: list(insertedIds), matched: list(['cust_gemini']) }]);
    });

    it('a failure before any load ran leaves `landed` absent: "not reported"', async () => {
        const { seedApplied } = await publishDrafts({ failGetMetaItem: true });

        expect(seedApplied?.success).toBe(false);
        expect(seedApplied && 'landed' in seedApplied).toBe(false);
    });
});
