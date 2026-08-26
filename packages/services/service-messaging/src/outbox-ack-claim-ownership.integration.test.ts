// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11859 — `ack()` proves OWNERSHIP, not just "a claim exists": the claim
 * credential rides the record `claim()` returns, and the compare-and-set
 * binds it (ruling C on the card; option A's caller-supplied identity and
 * option B's required `nodeId` parameter were both refused).
 *
 * ## The reachable sequence this file replays — for real
 *
 *  1. node A claims row R and starts a send;
 *  2. the send outruns `claimTtlMs`;
 *  3. another node's `claim()` reaps R back to `pending` and re-claims it —
 *     R is `in_flight` again, claimed by B;
 *  4. node A finishes and acks. Before #11859, `status = 'in_flight'` MATCHED
 *     and A's outcome was written over B's live attempt.
 *
 * Every step is driven through the public contract (`claim` with an explicit
 * `now`, never a hand-set `claimed_by`), because the defect lives in the
 * interaction of the reap, the re-claim and the late ack — a fixture that
 * fakes step 3 by poking the store would pin the poke, not the race.
 *
 * ## The vacuity traps closed explicitly
 *
 *  - **Refusal alone cannot tell "refused" from "landed, then errored".**
 *    Each refusal leg also asserts what the ack did NOT do: the row still
 *    belongs to B's claim, B's attempt counter is untouched, and B's own ack
 *    then lands — the outcome the late ack would have overwritten.
 *  - **A backend that refuses EVERY ack passes the refusal legs.** The
 *    negative control runs the same sequence WITHOUT the reap (B's claim
 *    finds nothing to take) and requires A's ack to succeed.
 *  - **`toThrow()` alone proves nothing** (an unfixed backend throws nothing;
 *    a broken one could throw anything): refusals assert the ERROR IDENTITY —
 *    `name` + the ADR-0112 `code`. There is no HTTP envelope on this surface,
 *    so `code` is the whole machine-readable identity
 *    (`NotificationAckError` carries no HTTP status).
 *
 * ## Why both backends, one table
 *
 * Same warrant as the #11453 file beside this one: the guarantee is a
 * property of {@link INotificationOutbox}, the SQL leg runs on a REAL engine
 * (`ObjectQL` + `SqlDriver`, better-sqlite3 `:memory:` — the #5704 ruled test
 * backend) because the fix IS an atomic conditional UPDATE and a fake engine
 * cannot refuse a write, and the memory leg keeps every unit test in the repo
 * honest about the same contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { SqlNotificationOutbox } from './sql-outbox.js';
import { NotificationDelivery } from './objects/notification-delivery.object.js';
import type { INotificationOutbox, NotificationDeliveryRecord } from './outbox.js';

/** The refusal identity — `name` + ADR-0112 `code`, never a bare throw. */
const REFUSAL = { name: 'NotificationAckError', code: 'DELIVERY_NOT_ELIGIBLE' };

const TTL = 60_000;
/** Step-1 instant: node A's claim. */
const T0 = 1_000_000;
/** Step-3 instant: one past the visibility timeout, so the reap fires. */
const T_AFTER_TTL = T0 + TTL + 1;
/** The no-reap instant for the negative control: inside the timeout. */
const T_WITHIN_TTL = T0 + TTL - 1;

function claimOpts(nodeId: string, now: number) {
    return { nodeId, limit: 10, claimTtlMs: TTL, now };
}

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

describe.each([memoryBackend(), sqlBackend()])('$name — ack() claim ownership (#11859)', (backend) => {
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

    /** One line a human can diff: status, holder, claim instant, attempts, error. */
    function fingerprint(r: NotificationDeliveryRecord): string {
        return `${r.status}:${r.claimedBy ?? '-'}:${r.claimedAt ?? '-'}:${r.attempts}:${r.error ?? ''}`;
    }

    it('replays the card: a late ack from a reaped claim is refused, and touches NOTHING', async () => {
        const id = await enqueueOne();

        // 1. node A claims R and "starts a send".
        const claimedByA = await outbox.claim(claimOpts('node-a', T0));
        expect(claimedByA.map((r) => `${r.id}:${r.claimedBy}:${r.claimedAt}`)).toEqual([`${id}:node-a:${T0}`]);

        // 2.–3. The send outruns claimTtlMs; node B's claim() reaps R back to
        // pending and re-claims it in the same call. R is in_flight AGAIN —
        // the state #11453's status-only predicate cannot tell from step 1.
        const claimedByB = await outbox.claim(claimOpts('node-b', T_AFTER_TTL));
        expect(claimedByB.map((r) => `${r.id}:${r.claimedBy}:${r.claimedAt}`)).toEqual([`${id}:node-b:${T_AFTER_TTL}`]);

        // 4. node A finishes and acks — with the record its own claim returned.
        // Refused by identity, not by accident.
        await expect(
            outbox.ack(claimedByA[0], { success: true, durationMs: TTL + 5 }),
        ).rejects.toMatchObject(REFUSAL);

        // What the refusal did NOT do: the row still belongs to B's claim,
        // B's attempt is intact (attempts untouched, no error, no outcome).
        expect(fingerprint(await readRow(id))).toBe(`in_flight:node-b:${T_AFTER_TTL}:0:`);

        // …and B's own ack — the live attempt A would have overwritten —
        // still lands, recording exactly one real attempt.
        await expect(outbox.ack(claimedByB[0], { success: true, durationMs: 3 })).resolves.toBeUndefined();
        expect(fingerprint(await readRow(id))).toBe('success:-:-:1:');
    });

    it('negative control: the SAME sequence without the reap still acks successfully', async () => {
        const id = await enqueueOne();

        // 1. node A claims R.
        const claimedByA = await outbox.claim(claimOpts('node-a', T0));
        expect(claimedByA.map((r) => r.id)).toEqual([id]);

        // 2'. The send is slow but INSIDE the visibility timeout, so node B's
        // claim() reaps nothing and takes nothing — proven, not assumed.
        const claimedByB = await outbox.claim(claimOpts('node-b', T_WITHIN_TTL));
        expect(claimedByB).toEqual([]);
        expect(fingerprint(await readRow(id))).toBe(`in_flight:node-a:${T0}:0:`);

        // 4'. A's ack with the record its claim returned MUST land — a
        // predicate that refused every ack would fail here, not just pass
        // the refusal legs above.
        await expect(outbox.ack(claimedByA[0], { success: true, durationMs: 5 })).resolves.toBeUndefined();
        expect(fingerprint(await readRow(id))).toBe('success:-:-:1:');
    });

    it('the credential is the CLAIM, not the node: a stale ack loses to the same node\'s own re-claim', async () => {
        const id = await enqueueOne();

        // 1. node A claims R…
        const staleClaim = await outbox.claim(claimOpts('node-a', T0));
        expect(staleClaim.map((r) => r.id)).toEqual([id]);

        // 2.–3. …outruns the TTL, and A ITSELF reaps and re-claims on a later
        // tick. Same node id — a claimed_by-only predicate would match.
        const freshClaim = await outbox.claim(claimOpts('node-a', T_AFTER_TTL));
        expect(freshClaim.map((r) => `${r.claimedBy}:${r.claimedAt}`)).toEqual([`node-a:${T_AFTER_TTL}`]);

        // 4. The FIRST attempt's late ack is refused — `claimedAt` is what
        // tells two claims by one node apart. The outcome belongs to the
        // attempt, and a re-claim is a new attempt.
        await expect(
            outbox.ack(staleClaim[0], { success: false, error: 'timed out', nextAttemptAt: T_AFTER_TTL + 1 }),
        ).rejects.toMatchObject(REFUSAL);
        expect(fingerprint(await readRow(id))).toBe(`in_flight:node-a:${T_AFTER_TTL}:0:`);

        // The fresh claim's ack still lands.
        await expect(outbox.ack(freshClaim[0], { success: true })).resolves.toBeUndefined();
        expect(fingerprint(await readRow(id))).toBe('success:-:-:1:');
    });
});
