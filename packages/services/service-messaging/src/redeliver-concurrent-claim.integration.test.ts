// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11009 — `redeliver`'s terminal-status compare-and-set must actually hold
 * against a concurrent claim.
 *
 * ## The measured defect this file pins the fix for
 *
 * `redeliver` is a check-then-act: read the row, refuse a non-terminal one,
 * then reset it — re-stating the terminal requirement IN the write
 * (`where: { id, status: { $in: ['success','failed','dead'] } }`) so a row
 * that changed underneath is not reset. On `multi: false` that predicate
 * dispatched BY-ID, and the by-id driver path binds only the primary key —
 * the status guard was silently discarded. Measured on `origin/main`
 * @ `95437e7d2` (better-sqlite3, real `ObjectQL` + `SqlDriver`, this exact
 * harness): a row claimed `in_flight` between `redeliver`'s read and its
 * write was reset to `pending, attempts: 0` anyway, and `redeliver` reported
 * SUCCESS — while the in-flight attempt kept running, so the delivery could
 * go out twice with the attempt counter reading 0.
 *
 * The fix has two halves, both asserted here:
 *  - the engine now REFUSES the by-id spelling outright
 *    (`engine-update-dispatch.ts`, #11009 — nothing is written), and
 *  - `redeliver` rides the predicate path (`multi: true`), whose write
 *    compiles EVERY `where` key — so the concurrent-claim window closes: the
 *    reset misses, and `redeliver` reports refusal, not success.
 *
 * ## How the race is made deterministic
 *
 * `RedeliverOptions.guard` is awaited BETWEEN the read and the write — the
 * exact window the `HttpDispatcher` tick can claim a `pending` row into
 * `in_flight`. The guard here performs the claim flip itself, so the test
 * stands in the window rather than hoping to hit it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL, engineByIdUnhonouredPredicateMessage } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { HttpDelivery, SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';

let engine: ObjectQL;
let driver: SqlDriver;

beforeEach(async () => {
    driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(HttpDelivery as any, '@objectstack/service-messaging');
    await engine.syncSchemas();
});

afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
});

async function seedRow(id: string, over: Record<string, unknown> = {}): Promise<void> {
    const now = new Date();
    await engine.insert(SYS_HTTP_DELIVERY, {
        id, source: 'webhook', ref_id: id, dedup_key: id,
        url: 'https://receiver.example/hook', method: 'POST', payload_json: '{}',
        partition_key: 0, status: 'pending', attempts: 0,
        created_at: now, updated_at: now, ...over,
    } as any);
}

async function readRow(id: string): Promise<any> {
    return engine.findOne(SYS_HTTP_DELIVERY, { where: { id } });
}

describe('#11009 — the by-id CAS spelling is refused, nothing is written', () => {
    it("the issue's minimal shape now throws the unhonoured-predicate refusal instead of landing", async () => {
        await seedRow('p1', { status: 'pending', attempts: 7 });
        // Pre-fix this call SUCCEEDED and reset attempts to 0 although the
        // predicate demanded a terminal status (measured — see the header).
        await expect(engine.update(
            SYS_HTTP_DELIVERY,
            { attempts: 0 },
            { where: { id: 'p1', status: { $in: ['success', 'failed', 'dead'] } }, multi: false } as any,
        )).rejects.toThrow(engineByIdUnhonouredPredicateMessage('Update', ['status']));
        // …and the refusal wrote NOTHING: the silent unconditional write was
        // the defect, so the row must be byte-identical.
        const row = await readRow('p1');
        expect(`${row.status}:${row.attempts}`).toBe('pending:7');
    });

    it('the delete twin refuses the same shape symmetrically', async () => {
        await seedRow('p2', { status: 'pending', attempts: 1 });
        await expect(engine.delete(
            SYS_HTTP_DELIVERY,
            { where: { id: 'p2', status: { $in: ['dead'] } } } as any,
        )).rejects.toThrow(engineByIdUnhonouredPredicateMessage('Delete', ['status']));
        expect(await readRow('p2')).toBeTruthy();
    });
});

describe('#11009 — redeliver vs a concurrent claim (the triage acceptance evidence)', () => {
    it('a row claimed in_flight between read and write is NOT reset, and redeliver reports refusal', async () => {
        await seedRow('d1', { status: 'dead', attempts: 3, error: 'receiver down' });
        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });

        // The guard runs in the read→write window; flip the row exactly there,
        // as the dispatcher's claim tick would.
        const claimedAt = Date.now();
        await expect(outbox.redeliver('d1', {
            tenantId: undefined,
            guard: async () => {
                await engine.update(
                    SYS_HTTP_DELIVERY,
                    { status: 'in_flight', claimed_by: 'racer', claimed_at: claimedAt, attempts: 4 },
                    { where: { id: 'd1' } } as any,
                );
            },
        })).rejects.toMatchObject({
            name: 'HttpRedeliverError',
            code: 'DELIVERY_NOT_ELIGIBLE',
        });

        // The reset did NOT land: the in-flight claim survives untouched.
        // Pre-fix (measured): status=pending, attempts=0, claimed_by=null —
        // and redeliver resolved successfully.
        const row = await readRow('d1');
        expect(row.status).toBe('in_flight');
        expect(row.attempts).toBe(4);
        expect(row.claimed_by).toBe('racer');
    });

    it('still works: an unraced terminal row is reset and redeliver succeeds', async () => {
        // The still-works leg — a refusal that refused everything would score
        // green on the race test alone.
        await seedRow('d2', { status: 'dead', attempts: 5, error: 'receiver down' });
        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        const replayed = await outbox.redeliver('d2', { tenantId: undefined });
        expect(`${replayed.id}:${replayed.status}:${replayed.attempts}`).toBe('d2:pending:0');
        const row = await readRow('d2');
        expect(`${row.status}:${row.attempts}:${row.error ?? ''}`).toBe('pending:0:');
    });
});

describe('#11009 — MemoryHttpOutbox honours the same contract (one interface, one verdict)', () => {
    it('a row claimed in_flight during the guard window is NOT reset, and redeliver reports refusal', async () => {
        const outbox = new MemoryHttpOutbox();
        const id = await outbox.enqueue({ source: 'webhook', refId: 'm1', dedupKey: 'm1', url: 'https://x', payload: {} });
        // Drive it terminal the way the store itself does.
        await outbox.claim({ nodeId: 'n1', limit: 1, claimTtlMs: 60_000 });
        await outbox.ack(id, { success: false, dead: true, error: 'receiver down', durationMs: 1 });

        await expect(outbox.redeliver(id, {
            tenantId: undefined,
            guard: async () => {
                // A competing writer flips the row inside the read→write
                // window. `list()` returns copies and `claim()` only takes
                // `pending` rows, so the flip goes through the store's own
                // map — the same stand-in for "another actor wrote the row"
                // the SQL leg above expresses through the engine.
                (outbox as unknown as { rows: Map<string, { status: string }> }).rows.get(id)!.status = 'in_flight';
            },
        })).rejects.toMatchObject({ name: 'HttpRedeliverError', code: 'DELIVERY_NOT_ELIGIBLE' });

        const [row] = await outbox.list();
        expect(row.status).toBe('in_flight');
    });
});
