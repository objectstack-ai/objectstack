// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Trigger dispatch idempotency (#10220): the persisted `sys_flow_dispatch`
// claim ledger and the `AutomationEngine.claim()` surface triggers consume.
//
// #14501 extends the same ledger with the OUTCOME half the maintainer's
// A + a2 ruling requires: a claim is settled after the launch returns, and
// read back before an operator replay.

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { AutomationEngine } from './engine.js';
import {
    InMemoryFlowDispatchStore,
    ObjectStoreFlowDispatchStore,
    isSettleAllowed,
} from './flow-dispatch-store.js';
import type { FlowDispatchStoreEngine } from './flow-dispatch-store.js';

function testLogger() {
    const warn = vi.fn();
    const logger = {
        info: () => {},
        warn,
        error: () => {},
        debug: () => {},
        child: () => logger,
    } as any;
    return { logger, warn };
}

/**
 * Fake ObjectQL slice with a real primary-key uniqueness on `id`. The `where`
 * handling REFUSES any shape other than the keyed-by-id read the store makes —
 * an unsupported filter must fail the test, never silently match everything.
 */
function fakeQl() {
    const rows = new Map<string, Record<string, unknown>>();
    const engine: FlowDispatchStoreEngine = {
        async find(_table, options) {
            const where = (options?.where ?? {}) as Record<string, unknown>;
            const keys = Object.keys(where);
            if (keys.length === 0) return [...rows.values()];
            if (keys.length !== 1 || keys[0] !== 'id' || typeof where.id !== 'string') {
                throw new Error(`fake driver: unsupported where shape ${JSON.stringify(where)}`);
            }
            const row = rows.get(where.id);
            return row ? [row] : [];
        },
        async insert(_table, data) {
            const id = (data as { id: string }).id;
            if (rows.has(id)) throw new Error('UNIQUE constraint failed: sys_flow_dispatch.id');
            rows.set(id, data as Record<string, unknown>);
            return data;
        },
        async update(_table, data, options) {
            // Routed through ObjectQL's OWN dispatch predicate, so this fake
            // cannot be looser than the engine it stands in for — the gate is
            // `pnpm check:engine-double-contract`, and a fake that accepted a
            // shape the engine rejects is how a dead write path ships green.
            const dispatch = assertEngineUpdateDispatch(data, options);
            if (dispatch.kind !== 'by-id') {
                throw new Error(`fake driver: the ledger only ever writes by id, got ${dispatch.kind}`);
            }
            const id = String(dispatch.id);
            const row = rows.get(id);
            if (!row) throw new Error(`fake driver: no row ${id}`);
            const { id: _ignored, ...fields } = data as Record<string, unknown>;
            rows.set(id, { ...row, ...fields });
            return rows.get(id);
        },
    };
    return { engine, rows };
}

describe('ObjectStoreFlowDispatchStore', () => {
    it('claim() is check-and-record: first true (row written), repeat false', async () => {
        const { engine, rows } = fakeQl();
        const store = new ObjectStoreFlowDispatchStore(engine);

        await expect(store.claim('time-relative:f:2026-07-25:offset7:c1')).resolves.toBe(true);
        const row = rows.get('time-relative:f:2026-07-25:offset7:c1');
        expect(row).toBeDefined();
        expect(row?.dispatched_at).toEqual(expect.any(String));

        await expect(store.claim('time-relative:f:2026-07-25:offset7:c1')).resolves.toBe(false);
        expect(rows.size).toBe(1);
    });

    it('distinct keys claim independently', async () => {
        const { engine } = fakeQl();
        const store = new ObjectStoreFlowDispatchStore(engine);
        await expect(store.claim('k1')).resolves.toBe(true);
        await expect(store.claim('k2')).resolves.toBe(true);
    });

    it('an insert lost to a concurrent claimer reads as false, not as a store error', async () => {
        // First find sees no row; the insert then collides (a racing sweep won);
        // the re-check finds the winner's row → the key IS claimed.
        let finds = 0;
        const engine: FlowDispatchStoreEngine = {
            async find() {
                finds++;
                return finds === 1 ? [] : [{ id: 'k1' }];
            },
            async insert() {
                throw new Error('UNIQUE constraint failed: sys_flow_dispatch.id');
            },
            async update(_t: string, data: any, options?: any) {
                assertEngineUpdateDispatch(data, options);
                throw new Error('not reached');
            },
        };
        const store = new ObjectStoreFlowDispatchStore(engine);
        await expect(store.claim('k1')).resolves.toBe(false);
    });

    it('a genuine store failure propagates (the engine decides the fallback)', async () => {
        const engine: FlowDispatchStoreEngine = {
            async find() { return []; },
            async insert() { throw new Error('no such table: sys_flow_dispatch'); },
            async update(_t: string, data: any, options?: any) {
                assertEngineUpdateDispatch(data, options);
                throw new Error('not reached');
            },
        };
        const store = new ObjectStoreFlowDispatchStore(engine);
        await expect(store.claim('k1')).rejects.toThrow('no such table');
    });
});

describe('AutomationEngine.claim (#10220)', () => {
    it('uses the persisted ledger when attached — dedup survives a "rebuild" (new engine, same store)', async () => {
        const store = new InMemoryFlowDispatchStore();
        const a = testLogger();
        const engineA = new AutomationEngine(a.logger);
        engineA.setFlowDispatchStore(store);

        await expect(engineA.claim('k1')).resolves.toBe(true);
        await expect(engineA.claim('k1')).resolves.toBe(false);

        // Kernel rebuild: a FRESH engine instance over the same surviving store.
        const b = testLogger();
        const engineB = new AutomationEngine(b.logger);
        engineB.setFlowDispatchStore(store);
        await expect(engineB.claim('k1')).resolves.toBe(false);
        await expect(engineB.claim('k2')).resolves.toBe(true);

        // No degradation warning on the healthy path.
        expect(a.warn).not.toHaveBeenCalled();
        expect(b.warn).not.toHaveBeenCalled();
    });

    it('no ledger attached: in-process dedup, degradation warned exactly once', async () => {
        const { logger, warn } = testLogger();
        const engine = new AutomationEngine(logger);

        await expect(engine.claim('k1')).resolves.toBe(true);
        await expect(engine.claim('k1')).resolves.toBe(false);
        await expect(engine.claim('k2')).resolves.toBe(true);

        const degradations = warn.mock.calls.filter(
            (c) => typeof c[0] === 'string' && (c[0] as string).includes('IN-PROCESS ONLY'),
        );
        expect(degradations).toHaveLength(1);
    });

    it('a ledger ERROR never blocks the claim: falls back to in-process for that key (availability over strict-once)', async () => {
        const { logger, warn } = testLogger();
        const engine = new AutomationEngine(logger);
        engine.setFlowDispatchStore({
            async claim() { throw new Error('ledger unreachable'); },
        });

        // First claim: store fails → in-process has no record → dispatch allowed.
        await expect(engine.claim('k1')).resolves.toBe(true);
        // Second claim of the SAME key in the same process: still deduped.
        await expect(engine.claim('k1')).resolves.toBe(false);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('falling back to in-process dedup'),
            expect.anything(),
        );
    });
});

describe('the claim OUTCOME half (#14501)', () => {
    it('ObjectStoreFlowDispatchStore: claim leaves the row unsettled, settle() writes the terminal outcome', async () => {
        const { engine, rows } = fakeQl();
        const store = new ObjectStoreFlowDispatchStore(engine);

        await store.claim('schedule:digest:2026-09-07T01:00:00.000Z');
        await expect(store.read('schedule:digest:2026-09-07T01:00:00.000Z')).resolves.toMatchObject({
            outcome: null,
            settledAt: null,
        });

        await store.settle('schedule:digest:2026-09-07T01:00:00.000Z', 'succeeded');
        const claim = await store.read('schedule:digest:2026-09-07T01:00:00.000Z');
        expect(claim?.outcome).toBe('succeeded');
        expect(claim?.settledAt).toEqual(expect.any(String));
        // The claim columns are untouched by the settle — it is a transition,
        // not a rewrite.
        expect(rows.get('schedule:digest:2026-09-07T01:00:00.000Z')?.dispatched_at).toEqual(
            expect.any(String),
        );
    });

    it("read() of a key that was never claimed is null, not a fabricated 'absent' claim", async () => {
        const { engine } = fakeQl();
        const store = new ObjectStoreFlowDispatchStore(engine);
        await expect(store.read('never-claimed')).resolves.toBeNull();
    });

    it('InMemoryFlowDispatchStore settles and reads back the same three states', async () => {
        const store = new InMemoryFlowDispatchStore();
        await expect(store.read('k')).resolves.toBeNull();
        await store.claim('k');
        await expect(store.read('k')).resolves.toMatchObject({ outcome: null });
        await store.settle('k', 'failed');
        await expect(store.read('k')).resolves.toMatchObject({ outcome: 'failed' });
    });

    it('settle() of a key that was never claimed does not invent a row', async () => {
        const store = new InMemoryFlowDispatchStore();
        await store.settle('ghost', 'succeeded');
        await expect(store.read('ghost')).resolves.toBeNull();
    });

    it('AutomationEngine.settleDispatch/readDispatch carry the outcome through the ledger', async () => {
        const { logger, warn } = testLogger();
        const engine = new AutomationEngine(logger);
        engine.setFlowDispatchStore(new InMemoryFlowDispatchStore());

        await expect(engine.claim('k1')).resolves.toBe(true);
        await expect(engine.readDispatch('k1')).resolves.toMatchObject({ outcome: null });
        await engine.settleDispatch('k1', 'succeeded');
        await expect(engine.readDispatch('k1')).resolves.toMatchObject({ outcome: 'succeeded' });
        expect(warn).not.toHaveBeenCalled();
    });

    it('a ledger predating #14501 (no read/settle) reports every claim unclaimed, warned exactly once', async () => {
        const { logger, warn } = testLogger();
        const engine = new AutomationEngine(logger);
        // A pre-#14501 store: `claim` only.
        engine.setFlowDispatchStore({ async claim() { return true; } });

        await expect(engine.readDispatch('k1')).resolves.toBeNull();
        await expect(engine.readDispatch('k2')).resolves.toBeNull();
        const degradations = warn.mock.calls.filter(
            (c) => typeof c[0] === 'string' && (c[0] as string).includes('has no read()/settle()'),
        );
        expect(degradations).toHaveLength(1);
    });

    it('a read that THROWS reports the key unclaimed — a refusal is a positive reading, never a failed one', async () => {
        const { logger, warn } = testLogger();
        const engine = new AutomationEngine(logger);
        engine.setFlowDispatchStore({
            async claim() { return true; },
            async read() { throw new Error('ledger unreachable'); },
            async settle() { throw new Error('ledger unreachable'); },
        });

        await expect(engine.readDispatch('k1')).resolves.toBeNull();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('reporting the key as UNCLAIMED'),
            expect.anything(),
        );
    });

    it('a settle that THROWS never fails the caller — the dispatch already happened', async () => {
        const { logger, warn } = testLogger();
        const engine = new AutomationEngine(logger);
        engine.setFlowDispatchStore({
            async claim() { return true; },
            async settle() { throw new Error('ledger unreachable'); },
        });

        await expect(engine.settleDispatch('k1', 'succeeded')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('stays UNSETTLED'),
            expect.anything(),
        );
    });

    it('with NO ledger attached the in-process fallback still carries an outcome', async () => {
        const { logger } = testLogger();
        const engine = new AutomationEngine(logger);
        await expect(engine.claim('k1')).resolves.toBe(true);
        await engine.settleDispatch('k1', 'succeeded');
        await expect(engine.readDispatch('k1')).resolves.toMatchObject({ outcome: 'succeeded' });
        await expect(engine.readDispatch('never')).resolves.toBeNull();
    });
});

describe('the settle write rule: `succeeded` is ABSORBING (#14501 contract review)', () => {
    it('ObjectStoreFlowDispatchStore: failed -> succeeded is allowed — a repaired window must refuse the next replay', async () => {
        const { engine, rows } = fakeQl();
        const store = new ObjectStoreFlowDispatchStore(engine);
        await store.claim('schedule:digest:w1');
        await store.settle('schedule:digest:w1', 'failed');
        await expect(store.read('schedule:digest:w1')).resolves.toMatchObject({ outcome: 'failed' });

        await store.settle('schedule:digest:w1', 'succeeded');
        await expect(store.read('schedule:digest:w1')).resolves.toMatchObject({ outcome: 'succeeded' });
        expect(rows.get('schedule:digest:w1')?.outcome).toBe('succeeded');
    });

    it('ObjectStoreFlowDispatchStore: succeeded -> failed is REFUSED, and refused means no write at all', async () => {
        // Counting `update` calls, not rows: "the row still says succeeded"
        // would also be true of a store that wrote `failed` and then wrote
        // `succeeded` back. The claim under test is that NOTHING is written.
        //
        // This is a second engine double in its own right — it RESTATES
        // `update()` rather than passing the base's through — so it carries the
        // dispatch predicate itself, exactly as `fakeQl()`'s does.
        let updates = 0;
        const { engine, rows } = fakeQl();
        const counting: FlowDispatchStoreEngine = {
            find: engine.find,
            insert: engine.insert,
            update: (table: string, data: any, options?: any) => {
                assertEngineUpdateDispatch(data, options);
                updates++;
                return engine.update(table, data, options);
            },
        };
        const store = new ObjectStoreFlowDispatchStore(counting);
        await store.claim('schedule:digest:w1');
        await store.settle('schedule:digest:w1', 'succeeded');
        expect(updates).toBe(1);

        // A FORCED replay that throws must not rewrite a delivered window:
        // doing so would silently reopen the UNFORCED re-delivery door.
        await store.settle('schedule:digest:w1', 'failed');
        expect(updates).toBe(1);
        expect(rows.get('schedule:digest:w1')?.outcome).toBe('succeeded');
    });

    it('the refusal is a no-op, never a throw — it is the invariant working, not an error', async () => {
        const { engine } = fakeQl();
        const store = new ObjectStoreFlowDispatchStore(engine);
        await store.claim('k');
        await store.settle('k', 'succeeded');
        await expect(store.settle('k', 'failed')).resolves.toBeUndefined();
    });

    it('InMemoryFlowDispatchStore holds the same rule', async () => {
        const store = new InMemoryFlowDispatchStore();
        await store.claim('k');
        await store.settle('k', 'failed');
        await store.settle('k', 'succeeded');
        await expect(store.read('k')).resolves.toMatchObject({ outcome: 'succeeded' });
        await store.settle('k', 'failed');
        await expect(store.read('k')).resolves.toMatchObject({ outcome: 'succeeded' });
    });

    it('isSettleAllowed is the predicate, and it names exactly one refused transition', () => {
        expect(isSettleAllowed(null, 'succeeded')).toBe(true);
        expect(isSettleAllowed(null, 'failed')).toBe(true);
        expect(isSettleAllowed('failed', 'succeeded')).toBe(true);
        expect(isSettleAllowed('failed', 'failed')).toBe(true);
        expect(isSettleAllowed('succeeded', 'succeeded')).toBe(true);
        expect(isSettleAllowed('succeeded', 'failed')).toBe(false);
    });

    it("the engine's IN-PROCESS fallback obeys the same rule, so it cannot reopen a door the ledger keeps shut", async () => {
        const { logger } = testLogger();
        const engine = new AutomationEngine(logger);
        await engine.claim('k');
        await engine.settleDispatch('k', 'succeeded');
        await engine.settleDispatch('k', 'failed');
        await expect(engine.readDispatch('k')).resolves.toMatchObject({ outcome: 'succeeded' });
    });
});
