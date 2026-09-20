// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18997] `/discovery`'s `capabilities.transactionalBatch` answers the SAME
 * question the atomic-batch refusal asks — "can this runtime actually roll
 * back?" — and is derived from the SAME predicate (`engineCanRollBack`).
 *
 * The defect: `getDiscovery()` derived the bit from the ENGINE alone
 * (`typeof this.engine?.transaction === 'function'`), while `runAtomicBatch`
 * refuses with `501 NOT_IMPLEMENTED` on `engineCanRollBack(this.engine)`, which
 * also asks the DEFAULT DRIVER. `engine.transaction` is always a function on a
 * real engine, so a composition whose default driver cannot carry a transaction
 * advertised `transactionalBatch: true` and then answered 501 — and the 501's
 * own remedy text tells the caller to 「probe `capabilities.transactionalBatch`
 * on /discovery first」. The prescribed remedy routed the caller to a signal
 * that was wrong in exactly the case the remedy exists for.
 *
 * BOTH DIRECTIONS ARE PINNED ON PURPOSE. A fix that made the flag honest by
 * making it always `false` would be worse than the bug, and a pin that only
 * asserts the `false` arm cannot tell the two apart. So every composition below
 * states the expected bit AND is driven through `batchData({ atomic: true })`
 * in the same test: the advertisement and the refusal must agree, composition
 * by composition.
 *
 * The two `false` populations are measured SEPARATELY because they arrived
 * separately and could regress separately:
 *   (a) a default driver with NO `beginTransaction` at all — pre-existing;
 *   (b) a default driver that INHERITS `beginTransaction` but declares
 *       `supports.transactionsUnsupported` (the live example is
 *       `TursoDriver` on its remote transport) — the population #18063 added
 *       when `engineCanRollBack` moved from a presence test to
 *       `driverSupportsTransactions`.
 */

import { describe, it, expect, vi } from 'vitest';
import { engineCanRollBack } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'invoice',
    fields: {
        title: { name: 'title', type: 'text' },
    },
};

interface Composition {
    /** Does the engine expose `transaction()` at all? */
    hasTransaction?: boolean;
    /**
     * Is the driver registry inspectable? A metadata-only host or a test double
     * exposes no `getDefaultDriverName`, and then the engine-level probe is all
     * there is — `engineCanRollBack` says so in its own header.
     */
    driverRegistryInspectable?: boolean;
    /** Population (a) when false: the default driver has no `beginTransaction`. */
    driverHasBeginTransaction?: boolean;
    /** Population (b) when true: `beginTransaction` inherited, transport denies it. */
    driverDeclaresUnsupported?: boolean;
}

function makeEngine(c: Composition = {}) {
    const {
        hasTransaction = true,
        driverRegistryInspectable = true,
        driverHasBeginTransaction = true,
        driverDeclaresUnsupported = false,
    } = c;

    const handle = { id: 'trx-1' };
    const commits: unknown[] = [];
    const insert = vi.fn(async (_object: string, data: any, _options?: any) => ({
        id: `rec-${insert.mock.calls.length}`,
        ...data,
    }));

    const driver: Record<string, unknown> = {
        supports: driverDeclaresUnsupported ? { transactionsUnsupported: true } : {},
    };
    if (driverHasBeginTransaction) driver.beginTransaction = async () => handle;

    const engine: any = {
        registry: { getObject: () => SCHEMA, getRegisteredTypes: () => [] },
        insert,
    };
    if (driverRegistryInspectable) {
        engine.getDefaultDriverName = () => 'default';
        engine.getDriverByName = () => driver;
    }
    if (hasTransaction) {
        engine.transaction = vi.fn(async (callback: (ctx: any) => Promise<any>, baseContext?: any) => {
            const result = await callback({ ...(baseContext ?? {}), transaction: handle });
            commits.push(handle);
            return result;
        });
    }
    return { engine, insert, commits };
}

async function advertisedBit(engine: any): Promise<boolean> {
    const discovery: any = await new ObjectStackProtocolImplementation(engine).getDiscovery();
    return discovery.capabilities.transactionalBatch.enabled;
}

/** Drive the refusal path on the same composition. `null` = it did NOT refuse. */
async function atomicBatchRefusal(engine: any, insert: { mock: { calls: unknown[] } }) {
    const p = new ObjectStackProtocolImplementation(engine);
    try {
        await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }],
                options: { atomic: true },
            },
        } as any);
        return null;
    } catch (err: any) {
        // A refusal writes nothing — the caller asked for all-or-nothing.
        expect(insert.mock.calls).toHaveLength(0);
        return { status: err?.status, code: err?.code, message: String(err?.message ?? '') };
    }
}

describe('[#18997] /discovery advertises transactionalBatch iff the runtime can actually roll back', () => {
    // ── The TRUE arm — without it, "honest" would be indistinguishable from
    //    "the capability is turned off", which the card calls worse than the bug.
    it('STILL advertises true when the default driver CAN roll back, and the atomic batch then runs', async () => {
        const t = makeEngine();

        expect(await advertisedBit(t.engine)).toBe(true);
        expect(await atomicBatchRefusal(t.engine, t.insert)).toBeNull();
        expect(t.commits).toHaveLength(1);
    });

    it('STILL advertises true for a host whose driver registry is not inspectable (test doubles, metadata-only hosts)', async () => {
        const t = makeEngine({ driverRegistryInspectable: false });

        expect(await advertisedBit(t.engine)).toBe(true);
        expect(await atomicBatchRefusal(t.engine, t.insert)).toBeNull();
    });

    // ── Population (a): pre-existing on `main`, not introduced by #18063.
    it('population (a): advertises FALSE when the default driver has no beginTransaction — the 501 population', async () => {
        const t = makeEngine({ driverHasBeginTransaction: false });

        expect(await advertisedBit(t.engine)).toBe(false);

        const refusal = await atomicBatchRefusal(t.engine, t.insert);
        expect(refusal).toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });
        // The remedy text is the reason this card exists: it sends the caller to
        // the very bit this test pins, so the bit must be the one it meant.
        expect(refusal!.message).toContain('probe capabilities.transactionalBatch on /discovery first');
    });

    // ── Population (b): the population #18063 added.
    it('population (b): advertises FALSE when the default driver declares supports.transactionsUnsupported', async () => {
        const t = makeEngine({ driverDeclaresUnsupported: true });

        expect(await advertisedBit(t.engine)).toBe(false);
        expect(await atomicBatchRefusal(t.engine, t.insert)).toMatchObject({
            status: 501,
            code: 'NOT_IMPLEMENTED',
        });
    });

    it('advertises FALSE when the engine exposes no transaction() at all (unchanged)', async () => {
        const t = makeEngine({ hasTransaction: false });

        expect(await advertisedBit(t.engine)).toBe(false);
        expect(await atomicBatchRefusal(t.engine, t.insert)).toMatchObject({
            status: 501,
            code: 'NOT_IMPLEMENTED',
        });
    });

    // ── The rule itself, stated once over every composition: ONE predicate,
    //    two ends. A future composition that satisfies one end and not the
    //    other reds here even if nobody thought to add a case above.
    it('the advertised bit equals engineCanRollBack() for every composition — one predicate, two ends', async () => {
        const compositions: Array<[string, Composition]> = [
            ['driver can roll back', {}],
            ['driver registry not inspectable', { driverRegistryInspectable: false }],
            ['(a) driver has no beginTransaction', { driverHasBeginTransaction: false }],
            ['(b) driver declares transactionsUnsupported', { driverDeclaresUnsupported: true }],
            ['engine has no transaction()', { hasTransaction: false }],
        ];

        for (const [label, composition] of compositions) {
            const { engine } = makeEngine(composition);
            expect(
                { [label]: await advertisedBit(engine) },
            ).toEqual({ [label]: engineCanRollBack(engine) });
        }
    });
});
