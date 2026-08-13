// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5840 — `MetadataManager.get()` discarded the `degraded` verdict
 * `loadDiagnosed` had already computed, two hops before any consumer could see
 * it.
 *
 * ---------------------------------------------------------------------------
 * The defect
 * ---------------------------------------------------------------------------
 * `loadDiagnosed` exists for ADR-0110 D3: a MISS and an OUTAGE are different
 * facts with opposite security meanings, and its own TSDoc says so — "callers
 * that gate on a declaration MUST NOT read that `null` as 'the author declared
 * no gate'". But the chain flattened it immediately:
 *
 *     load()  =  (await loadDiagnosed(...)).data     // keeps `.data` only
 *     get()   =  (await load(...)) ?? undefined      // and `null` → `undefined`
 *
 * So every consumer of `get()` — six of them at the time this was filed, in
 * `metadata-protocol`, `objectql`, `plugin-security` and `mcp` — received one
 * `undefined` for two opposite facts and could not have told them apart even
 * if it had wanted to: the verdict was computed, then dropped, inside the
 * method it would have had to ask.
 *
 * ---------------------------------------------------------------------------
 * What these tests pin
 * ---------------------------------------------------------------------------
 * 1. The two facts are now SEPARATELY observable, and separable ONLY by
 *    `degraded` — `data` is `undefined` in both, so no downstream consumer can
 *    reconstruct the distinction from the payload and grow a second, weaker
 *    way of asking.
 * 2. A registry hit is never degraded: it consulted no loader, so there is
 *    nothing to be unsure about — this is what makes `getDiagnosed` the
 *    counterpart of `get` rather than of `loadDiagnosed`, and it is why the
 *    consumers could not simply switch to `loadDiagnosed` (that one skips the
 *    in-memory registry and would resolve different items).
 * 3. `get()` itself is byte-identical in behaviour — same signature, same
 *    answer for every one of these cases. Callers pay nothing; only callers
 *    that ASK for the verdict get it.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red, and deliberately PARTIAL. The lap is `getDiagnosed` reading
 * through the discarding chain again — `const data = await this.load(type,
 * name); return { data: data ?? undefined, degraded: false, errors: [] }`,
 * which is exactly what a consumer could observe before this issue.
 *
 * Predicted 4 red / 5 green; measured 4 red / 5 green, the same four:
 * "a loader that THREW", "separable ONLY by `degraded`", "a registry hit is
 * never degraded" (its closing assertion reads a NON-registry name back), and
 * "errors from several failing loaders".
 *
 * The five that stay green are the point of the split. Every assertion about
 * a MISS survives the revert, because a miss was never the broken half — read
 * as a whole, the pair proves the new verdict changed the outage answer and
 * left the miss answer alone, which is the ADR-0110 D3 shape. The `get()`
 * parity describe stays green for the same reason: `get()` is untouched.
 */

import { describe, it, expect, vi } from 'vitest';
import type { MetadataLoadOptions, MetadataLoadResult } from '@objectstack/spec/system';
import { MetadataManager } from './metadata-manager.js';
import type { MetadataLoader } from './loaders/loader-interface.js';

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

/** An outage: the row may well be there and simply was not seen. */
const connectionRefused = () =>
    Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });

/**
 * A read-only loader whose `load()` either throws (outage) or answers `null`
 * (clean miss) or answers a body. Deliberately minimal: `getDiagnosed` walks
 * `load()` and nothing else.
 */
function loader(
    name: string,
    load: (type: string, itemName: string) => Promise<MetadataLoadResult>,
): MetadataLoader {
    return {
        contract: {
            name,
            protocol: `${name}:`,
            capabilities: { read: true, write: false, watch: false, list: true },
        },
        load: async (type: string, itemName: string, _options?: MetadataLoadOptions) =>
            load(type, itemName),
        loadMany: async () => [],
        list: async () => [],
        exists: async () => false,
        stat: async () => null,
    } as unknown as MetadataLoader;
}

/** A loader that cannot read its store — #5108's posture, one layer down. */
const brokenLoader = (name = 'broken') =>
    loader(name, async () => { throw connectionRefused(); });

/** A loader that answers, and simply does not hold the item. */
const emptyLoader = (name = 'empty') =>
    loader(name, async () => ({ data: null }));

/** A loader that holds `body` under every name it is asked for. */
const holdingLoader = (body: unknown, name = 'holding') =>
    loader(name, async () => ({ data: body, source: 'memory', format: 'json', loadTime: 0 }));

function managerWith(...loaders: MetadataLoader[]): MetadataManager {
    const mgr = new MetadataManager({});
    for (const l of loaders) mgr.registerLoader(l);
    return mgr;
}

describe('[#5840] getDiagnosed — an outage and a miss stop being the same answer', () => {
    it('a loader that THREW is reported degraded, with the failure text', async () => {
        const mgr = managerWith(brokenLoader());

        const read = await mgr.getDiagnosed('permission', 'admin_all');

        expect(read.degraded).toBe(true);
        expect(read.data).toBeUndefined();
        expect(read.errors).toHaveLength(1);
        expect(read.errors[0]).toContain('broken');
        expect(read.errors[0]).toContain('ECONNREFUSED');
    });

    it('a name nobody declared is NOT degraded — a clean miss is a fact', async () => {
        const mgr = managerWith(emptyLoader());

        const read = await mgr.getDiagnosed('permission', 'never_declared');

        expect(read.degraded).toBe(false);
        expect(read.data).toBeUndefined();
        expect(read.errors).toEqual([]);
    });

    it('the two are separable ONLY by `degraded` — `data` cannot rebuild it', async () => {
        const outage = await managerWith(brokenLoader()).getDiagnosed('permission', 'admin_all');
        const miss = await managerWith(emptyLoader()).getDiagnosed('permission', 'admin_all');

        // The payload halves are indistinguishable, deliberately: if `data`
        // could carry the difference, a consumer would soon read the weaker
        // signal instead of the verdict.
        expect(outage.data).toBe(miss.data);
        expect(outage.data).toBeUndefined();

        // The verdict is the whole difference.
        expect([outage.degraded, miss.degraded]).toEqual([true, false]);
    });

    it('a healthy loader answering AFTER a broken one is not degraded', async () => {
        // `degraded` means "nothing answered AND something failed" — a store
        // that produced the item is a complete answer no matter what happened
        // beside it. Same posture as `loadDiagnosed`, inherited not re-decided.
        const mgr = managerWith(brokenLoader(), holdingLoader({ name: 'admin_all' }));

        const read = await mgr.getDiagnosed('permission', 'admin_all');

        expect(read.data).toEqual({ name: 'admin_all' });
        expect(read.degraded).toBe(false);
    });

    it('an in-memory registry hit is never degraded — it consulted no loader', async () => {
        // This is the half `loadDiagnosed` cannot express, and the reason the
        // consumers of `get()` needed their OWN diagnosed read: switching them
        // to `loadDiagnosed` would have skipped this registry entirely and
        // changed which items they resolve.
        const mgr = managerWith(brokenLoader());
        mgr.registerInMemory('view', 'accounts_grid', { name: 'accounts_grid' });

        const read = await mgr.getDiagnosed('view', 'accounts_grid');

        expect(read.data).toEqual({ name: 'accounts_grid' });
        expect(read.degraded).toBe(false);
        expect(read.errors).toEqual([]);

        // And the loader really is broken for anything the registry lacks.
        expect((await mgr.getDiagnosed('view', 'other')).degraded).toBe(true);
    });

    it('errors from several failing loaders are all reported', async () => {
        const mgr = managerWith(brokenLoader('db'), brokenLoader('remote'));

        const read = await mgr.getDiagnosed('permission', 'admin_all');

        expect(read.degraded).toBe(true);
        expect(read.errors).toHaveLength(2);
        expect(read.errors.join(' ')).toContain('db');
        expect(read.errors.join(' ')).toContain('remote');
    });
});

describe('[#5840] `get()` is unchanged — zero breaking, by construction', () => {
    it('answers exactly `getDiagnosed().data` in all four cases', async () => {
        const cases: Array<[string, MetadataManager, string, unknown]> = [
            ['outage', managerWith(brokenLoader()), 'admin_all', undefined],
            ['miss', managerWith(emptyLoader()), 'admin_all', undefined],
            ['hit', managerWith(holdingLoader({ name: 'admin_all' })), 'admin_all', { name: 'admin_all' }],
            ['no loaders at all', managerWith(), 'admin_all', undefined],
        ];

        for (const [label, mgr, name, expected] of cases) {
            const viaGet = await mgr.get('permission', name);
            const viaDiagnosed = await mgr.getDiagnosed('permission', name);
            expect(viaGet, label).toEqual(expected);
            expect(viaGet, label).toEqual(viaDiagnosed.data);
        }
    });

    it('still prefers the in-memory registry over every loader', async () => {
        const mgr = managerWith(holdingLoader({ name: 'from_loader' }));
        mgr.registerInMemory('view', 'accounts_grid', { name: 'from_registry' });

        expect(await mgr.get('view', 'accounts_grid')).toEqual({ name: 'from_registry' });
    });

    it('an outage still resolves rather than throwing — the contract callers rely on', async () => {
        // Direction (b) of the issue — making `get()` throw on `degraded` — was
        // deliberately NOT taken: it changes a public contract and the boot
        // path degrades on purpose (see the TSDoc on `restoreMetadataFromDb`,
        // #5897). The diagnosis is offered, never imposed.
        const mgr = managerWith(brokenLoader());

        await expect(mgr.get('permission', 'admin_all')).resolves.toBeUndefined();
    });
});
