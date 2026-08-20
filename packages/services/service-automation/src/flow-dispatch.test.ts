// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Trigger dispatch idempotency (#10220): the persisted `sys_flow_dispatch`
// claim ledger and the `AutomationEngine.claim()` surface triggers consume.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from './engine.js';
import { InMemoryFlowDispatchStore, ObjectStoreFlowDispatchStore } from './flow-dispatch-store.js';
import type { SuspendedRunStoreEngine } from './suspended-run-store.js';

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

/** Fake ObjectQL slice with a real primary-key uniqueness on `id`. */
function fakeQl() {
    const rows = new Map<string, Record<string, unknown>>();
    const engine: SuspendedRunStoreEngine = {
        async find(_table, options) {
            const id = (options?.where as { id?: string } | undefined)?.id;
            if (id == null) return [...rows.values()];
            const row = rows.get(id);
            return row ? [row] : [];
        },
        async insert(_table, data) {
            const id = (data as { id: string }).id;
            if (rows.has(id)) throw new Error('UNIQUE constraint failed: sys_flow_dispatch.id');
            rows.set(id, data as Record<string, unknown>);
            return data;
        },
        async update() {
            throw new Error('claim never updates');
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
        const engine: SuspendedRunStoreEngine = {
            async find() {
                finds++;
                return finds === 1 ? [] : [{ id: 'k1' }];
            },
            async insert() {
                throw new Error('UNIQUE constraint failed: sys_flow_dispatch.id');
            },
            async update() { throw new Error('unused'); },
        };
        const store = new ObjectStoreFlowDispatchStore(engine);
        await expect(store.claim('k1')).resolves.toBe(false);
    });

    it('a genuine store failure propagates (the engine decides the fallback)', async () => {
        const engine: SuspendedRunStoreEngine = {
            async find() { return []; },
            async insert() { throw new Error('no such table: sys_flow_dispatch'); },
            async update() { throw new Error('unused'); },
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
