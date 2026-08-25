// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11453 — `ack()` is the dispatcher's completion callback for a row IT
 * CLAIMED, and both implementations must enforce that.
 *
 * ## The measured defect this file pins the fix for
 *
 * Neither implementation checked the row's status. Measured on `origin/main`
 * @ `a1c804bc9` with this exact harness, on BOTH backends:
 * `ack(id, { success: false, suppressed: true })` against a `pending` row that
 * was never claimed RESOLVED, flipped the row to terminal `suppressed`, and
 * incremented `attempts` to 1 — recording a delivery attempt that never
 * happened, on a row no dispatcher ever held.
 *
 * That made `ack` read like the missing `cancel` primitive, and it is a trap:
 *
 *  - **It races the dispatcher.** Between a caller's `list()` and its `ack()`,
 *    `claim()` can take the row — `claim` is atomic by contract and `ack` was
 *    never part of that atom — so a suppression could land on a delivery
 *    already on the wire, or a dispatcher's real outcome could be overwritten.
 *  - **It corrupts `attempts`.** The counter feeds the retry schedule
 *    (`classifyDeliveryAttempt(result, errorClass, row.attempts, …)`), and a
 *    row "cancelled" this way arrives at its next real attempt with the
 *    backoff already advanced by an attempt that never went out.
 *
 * ## Why this file is ONE table over BOTH backends
 *
 * The precondition is a property of {@link INotificationOutbox}, not of either
 * implementation, and the two drifting apart is the specific failure this
 * shape prevents: a memory-only pin would let the SQL path keep the hole (it
 * is the production store), and a SQL-only pin would let every unit test in
 * the repo keep exercising the trap. Every case below therefore runs
 * identically against both, and the SQL leg runs on a REAL engine
 * (`ObjectQL` + `SqlDriver`, better-sqlite3 `:memory:` — the #5704 ruled test
 * backend) rather than a fake, because the SQL half of the fix is an ATOMIC
 * conditional UPDATE and a fake engine cannot refuse a write.
 *
 * ## The vacuity traps closed explicitly
 *
 *  1. **"a refusal that refuses everything."** Every refusal case is paired
 *     with a still-works leg on the same backend: a claimed row still acks to
 *     `success`, and a retry ack still re-arms the row. A precondition that
 *     rejected unconditionally would fail those.
 *  2. **"the assertion passes because nothing ran."** Identities, not counts:
 *     each case names the row, its expected terminal state AND its `attempts`
 *     value, so a no-op implementation cannot read as a pass.
 *  3. **`toThrow()` alone is not a refusal test.** An un-fixed backend throws
 *     nothing and a broken one could throw anything, so the refusals below
 *     assert the ERROR IDENTITY (`name` + ADR-0112 `code`), not merely that
 *     something was thrown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { SqlNotificationOutbox } from './sql-outbox.js';
import { NotificationDelivery } from './objects/notification-delivery.object.js';
import type { ClaimedDeliveryRecord, INotificationOutbox, NotificationDeliveryRecord } from './outbox.js';

/**
 * The refusal identity both backends must produce. `DELIVERY_NOT_ELIGIBLE` is
 * this package's already-registered ADR-0112 code for "this delivery row's
 * state does not permit the operation" — the same refusal
 * `SqlHttpOutbox.redeliver` raises when its own compare-and-set misses.
 */
const REFUSAL = { name: 'NotificationAckError', code: 'DELIVERY_NOT_ELIGIBLE' };

interface Backend {
    readonly name: string;
    create(): Promise<INotificationOutbox>;
    destroy(): Promise<void>;
}

function memoryBackend(): Backend {
    return {
        name: 'MemoryNotificationOutbox',
        async create() { return new MemoryNotificationOutbox(1); },
        async destroy() { /* nothing to tear down */ },
    };
}

function sqlBackend(): Backend {
    let engine: ObjectQL | undefined;
    return {
        name: 'SqlNotificationOutbox',
        async create() {
            const driver = new SqlDriver({
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
            });
            engine = new ObjectQL();
            engine.registerDriver(driver, true);
            await engine.init();
            engine.registry.registerObject(NotificationDelivery as any, '@objectstack/service-messaging');
            await engine.syncSchemas();
            return new SqlNotificationOutbox(engine as any, { partitionCount: 1 });
        },
        async destroy() {
            try { await engine?.destroy(); } catch { /* noop */ }
            engine = undefined;
        },
    };
}

const CLAIM = { nodeId: 'node-a', limit: 10, claimTtlMs: 60_000 };

describe.each([memoryBackend(), sqlBackend()])('$name — ack() status precondition (#11453)', (backend) => {
    let outbox: INotificationOutbox;

    beforeEach(async () => { outbox = await backend.create(); });
    afterEach(async () => { await backend.destroy(); });

    async function enqueueOne(notificationId = 'n1'): Promise<string> {
        return outbox.enqueue({
            notificationId,
            recipientId: 'u1',
            channel: 'inbox',
            payload: { title: 'hello', body: 'world' },
        });
    }

    async function readRow(id: string): Promise<NotificationDeliveryRecord> {
        const rows = await outbox.list();
        const row = rows.find((r) => r.id === id);
        if (!row) throw new Error(`row '${id}' vanished — the harness, not the contract, is broken`);
        return row;
    }

    it('refuses ack on an unclaimed pending row, and writes NOTHING', async () => {
        const id = await enqueueOne();
        expect(`${(await readRow(id)).status}:${(await readRow(id)).attempts}`).toBe('pending:0');

        // The card's trap, verbatim: ack-as-cancel on a row no dispatcher
        // holds. [#11859] `ack` now takes the claimed record back, so the
        // literal spelling of the trap is handing it a `list()` row — which
        // carries NO claim credential; the cast is the JS caller/miscast this
        // pin keeps refused at runtime, not just at compile time.
        await expect(
            outbox.ack((await readRow(id)) as ClaimedDeliveryRecord, { success: false, suppressed: true }),
        ).rejects.toMatchObject(REFUSAL);

        // A refused ack is not a partial one: the row keeps its identity, its
        // status AND its attempt count, so it is still claimable and its
        // backoff position is still honest.
        const after = await readRow(id);
        expect(`${after.id}:${after.status}:${after.attempts}`).toBe(`${id}:pending:0`);
    });

    it('still acks a CLAIMED row — the precondition refuses the unclaimed, not everything', async () => {
        const id = await enqueueOne();
        const claimed = await outbox.claim(CLAIM);
        expect(claimed.map((r) => r.id)).toEqual([id]);

        await expect(outbox.ack(claimed[0], { success: true, durationMs: 5 })).resolves.toBeUndefined();

        const after = await readRow(id);
        expect(`${after.id}:${after.status}:${after.attempts}`).toBe(`${id}:success:1`);
    });

    it('refuses a SECOND ack on a terminal row, leaving the first outcome intact', async () => {
        const id = await enqueueOne();
        const [rec] = await outbox.claim(CLAIM);
        await outbox.ack(rec, { success: true });

        // The SAME once-genuine record, handed back a second time: its
        // credential was real, but the row is terminal now and the first
        // outcome must stand.
        await expect(
            outbox.ack(rec, { success: false, suppressed: true }),
        ).rejects.toMatchObject(REFUSAL);

        // `attempts` is the assertion that matters: an unconditional increment
        // would read 2 here for ONE delivery that went out once.
        const after = await readRow(id);
        expect(`${after.id}:${after.status}:${after.attempts}`).toBe(`${id}:success:1`);
    });

    it('re-arms a retried row, then refuses an ack on the re-armed (pending) row', async () => {
        const id = await enqueueOne();
        const [rec] = await outbox.claim(CLAIM);

        // A real failed attempt: the row goes back to `pending` for a later try.
        await outbox.ack(rec, { success: false, error: 'transport blip', nextAttemptAt: 1 });
        const retried = await readRow(id);
        expect(`${retried.id}:${retried.status}:${retried.attempts}`).toBe(`${id}:pending:1`);

        // …and now it is unclaimed again, so the precondition applies to it
        // exactly as it did before the first claim. This is the case a
        // read-back implementation gets wrong: the CAS's post-state (`pending`)
        // and the refused row's state (`pending`) are the SAME status, so only
        // a real conditional write tells them apart.
        await expect(
            outbox.ack(rec, { success: false, suppressed: true }),
        ).rejects.toMatchObject(REFUSAL);

        const after = await readRow(id);
        expect(`${after.id}:${after.status}:${after.attempts}`).toBe(`${id}:pending:1`);
    });

    it('a claimed row acked as suppressed by a REAL attempt still reaches suppressed', async () => {
        // `classifyDeliveryAttempt` returns `suppressed: true` for an
        // `invalid_recipient` send outcome — a genuine attempt whose terminal
        // state happens to be `suppressed`. The precondition must not confuse
        // that legitimate dispatcher outcome with ack-as-cancel.
        const id = await enqueueOne();
        const [rec] = await outbox.claim(CLAIM);

        await outbox.ack(rec, { success: false, suppressed: true, error: 'no such recipient' });

        const after = await readRow(id);
        expect(`${after.id}:${after.status}:${after.attempts}`).toBe(`${id}:suppressed:1`);
    });
});
