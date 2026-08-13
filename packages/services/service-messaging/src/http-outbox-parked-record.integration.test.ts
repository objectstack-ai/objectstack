// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8069 — a dropped webhook subscription must leave a durable record, and that
 * record must NOT become a button that sends the delivery unsigned.
 *
 * ## The defect these tests pin
 * When `plugin-webhooks` cannot resolve a webhook's encrypted signing secret it
 * drops the subscription — correctly, fail-closed (#7799) — but the drop left
 * no `sys_http_delivery` row, so an operator reading the delivery table found
 * nothing. The obvious fix (write the discarded event as a `dead` row) is
 * *actively unsafe on its own*: `redeliver()` reset ANY terminal row to
 * `pending` with no signature check, behind `POST /api/v1/webhooks/redeliver`
 * which any authenticated user can reach. A parked row has no signature —
 * the signature is computed at enqueue from the very secret that could not be
 * resolved — so redelivering one would put the payload on the wire UNSIGNED,
 * reopening #7799 through a door nobody would think to audit.
 *
 * **An unsigned redelivery is strictly worse than an unrecorded drop**, which
 * is why the refusal is tested first and tested hardest.
 *
 * ## Why the real storage path
 * Same harness as `http-signature-at-rest.integration.test.ts`: ObjectQL +
 * `@objectstack/driver-sql` on better-sqlite3 `:memory:`, the production
 * `SqlHttpOutbox` and `HttpDispatcher`. The refusal is a claim about what a
 * real row in a real table does when a real dispatcher runs, and both halves of
 * that — "the row is still `dead` afterwards" and "nothing went on the wire" —
 * are only observable end to end.
 *
 * ## The vacuity traps closed here, explicitly
 *  1. **A row that was never signable anyway.** A test asserting the refusal on
 *     a `pending` row would pass against a completely unfixed tree, because
 *     `redeliver()` already refused non-terminal rows. Every refusal test below
 *     uses a **`dead`** row — the state the old code happily reset — and the
 *     first one builds it with `engine.insert` alone, so it is a behavioural
 *     RED against unmodified `redeliver()` rather than a compile error.
 *  2. **A durable record that is merely present.** Asserting "a row exists" is
 *     what the PROHIBITED naive shape also satisfies. So the record tests
 *     assert the row is unsendable: not claimed by a real dispatcher, and
 *     refused by `redeliver()`.
 *  3. **An over-broad refusal.** A `redeliver()` that refused everything would
 *     pass every test above while breaking the feature, so the last test
 *     replays a genuinely failed, genuinely signed row and checks it still goes
 *     out with the same bytes and the same signature.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { HttpRedeliverError, type IHttpOutbox } from './http-outbox.js';
import { HttpDelivery, SYS_HTTP_DELIVERY } from './objects/http-delivery.object.js';
import type { FetchImpl } from './http-sender.js';

const SECRET = 'whsec_8069_signing_key';

const DROP_REASON =
    "[INTERNAL_ERROR/500] webhook 'orders' holds an encrypted signing secret that could not be "
    + 'decrypted, so this event was NOT delivered. Fix: register a CryptoProvider with the same key '
    + 'the signing secret was written under.';

function makeSqliteDriver() {
    return new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    });
}

function makeFetch(): {
    impl: FetchImpl;
    calls: Array<{ url: string; headers: Record<string, string>; body: string }>;
} {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const impl: FetchImpl = async (url, init) => {
        calls.push({ url, headers: init.headers, body: init.body });
        return { ok: true, status: 204, async text() { return ''; } };
    };
    return { impl, calls };
}

describe('sys_http_delivery — parked drop records are not redeliverable (#8069)', () => {
    let engine: ObjectQL | undefined;

    afterEach(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
        engine = undefined;
    });

    async function boot() {
        const driver = makeSqliteDriver();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(HttpDelivery as any, '@objectstack/service-messaging');
        await engine.syncSchemas();
        return { driver, engine: engine! };
    }

    /**
     * The refusal, against a row built WITHOUT any API this issue added.
     *
     * This is the behavioural RED: on `origin/main` `redeliver()` sees a `dead`
     * row, resets it to `pending`, and returns — no throw, and the dispatcher
     * then puts an unsigned body on the wire. Both consequences are asserted,
     * because "it threw" alone would not distinguish a refusal from a refusal
     * that still mutated the row first.
     */
    it('refuses to redeliver a terminal row that was never attempted', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        const now = new Date();
        await eng.insert(SYS_HTTP_DELIVERY, {
            id: 'parked_1',
            source: 'webhook',
            ref_id: 'wh_1',
            dedup_key: 'crm_order:o1:created:1760000000000',
            label: 'data.record.created',
            url: 'https://receiver.example/hook',
            method: 'POST',
            payload_json: JSON.stringify({ recordId: 'o1' }),
            partition_key: 0,
            status: 'dead',
            attempts: 0,
            error: DROP_REASON,
            created_at: now,
            updated_at: now,
        });

        await expect(outbox.redeliver('parked_1')).rejects.toMatchObject({
            name: 'HttpRedeliverError',
            code: 'DELIVERY_NEVER_SENT',
        });

        // The refusal ran before any write: the row is untouched, reason intact.
        const [row] = await outbox.list({ status: 'dead' });
        expect(row.id).toBe('parked_1');
        expect(row.attempts).toBe(0);
        expect(row.error).toBe(DROP_REASON);

        // …and nothing reaches the wire, which is the consequence that matters.
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        expect(calls).toHaveLength(0);
    });

    it('records a drop as a durable dead row carrying the cause, with no signature', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        const id = await outbox.recordUndeliverable({
            source: 'webhook',
            refId: 'wh_1',
            dedupKey: 'crm_order:o1:created:1760000000000',
            label: 'data.record.created',
            url: 'https://receiver.example/hook',
            payload: { recordId: 'o1', object: 'crm_order' },
            reason: DROP_REASON,
        });

        // Durable: an operator reading the table finds the discarded event AND
        // why it was discarded — the existing reason column, no new state.
        const [row] = await outbox.list({ source: 'webhook' });
        expect(row.id).toBe(id);
        expect(row.status).toBe('dead');
        expect(row.attempts).toBe(0);
        expect(row.error).toBe(DROP_REASON);
        expect(row.signature).toBeUndefined();
        // The payload really is on the row — a record of nothing is not a record.
        expect(row.payload).toEqual({ recordId: 'o1', object: 'crm_order' });

        // Unsendable by both routes: the dispatcher never claims it…
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        expect(calls).toHaveLength(0);
        // …and an operator cannot conjure a first delivery out of it.
        await expect(outbox.redeliver(id)).rejects.toMatchObject({ code: 'DELIVERY_NEVER_SENT' });
    });

    it('converges duplicates like enqueue does — one discarded event, one record', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });
        const input = {
            source: 'webhook',
            refId: 'wh_1',
            dedupKey: 'same-event',
            url: 'https://receiver.example/hook',
            payload: {},
            reason: DROP_REASON,
        };
        const a = await outbox.recordUndeliverable(input);
        const b = await outbox.recordUndeliverable(input);
        expect(a).toBe(b);
        expect(await outbox.list()).toHaveLength(1);
    });

    /**
     * The producer's veto, for the case the maintainer named: the row's webhook
     * config was DELETED, so nothing can say this delivery may still be signed
     * and sent. The outbox cannot know that on its own — `service-messaging`
     * knows nothing about `sys_webhook` — so it asks the guard.
     */
    it('refuses a previously-attempted row when the producer guard vetoes it', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });

        const id = await outbox.enqueue({
            source: 'webhook',
            refId: 'wh_deleted',
            dedupKey: 'e1',
            url: 'https://receiver.example/hook',
            signingSecret: SECRET,
            payload: { recordId: 'o1' },
        });
        // Make it a genuine dead-letter: attempted, failed, terminal.
        await outbox.ack(id, { success: false, dead: true, error: 'boom', durationMs: 1 });

        const seen: string[] = [];
        await expect(
            outbox.redeliver(id, (row) => {
                seen.push(row.refId);
                return 'the sys_webhook subscription no longer exists';
            }),
        ).rejects.toMatchObject({ code: 'DELIVERY_NOT_ELIGIBLE' });

        // The guard was asked about THIS row, not some default.
        expect(seen).toEqual(['wh_deleted']);
        const [row] = await outbox.list();
        expect(row.status).toBe('dead');
        expect(row.attempts).toBe(1);
    });

    it('treats a guard that throws as a refusal — "could not check" is never "allowed"', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });
        const id = await outbox.enqueue({
            source: 'webhook', refId: 'wh_1', dedupKey: 'e1',
            url: 'https://receiver.example/hook', signingSecret: SECRET, payload: {},
        });
        await outbox.ack(id, { success: false, dead: true, error: 'boom', durationMs: 1 });

        await expect(
            outbox.redeliver(id, () => { throw new Error('sys_webhook read failed'); }),
        ).rejects.toMatchObject({ code: 'DELIVERY_NOT_ELIGIBLE' });
        const [row] = await outbox.list();
        expect(row.status).toBe('dead');
    });

    /**
     * The anti-over-refusal test. Everything above would also pass if
     * `redeliver()` simply refused everything, which would break the feature
     * #8022's source retest verified working — so a genuinely failed, genuinely
     * signed row must still replay, with the SAME bytes and the SAME signature.
     */
    it('still replays a real dead-letter byte-for-byte, signature intact', async () => {
        const { engine: eng } = await boot();
        const outbox = new SqlHttpOutbox(eng as any, { partitionCount: 1 });
        const payload = { object: 'crm_order', recordId: 'o1', action: 'created' };

        const id = await outbox.enqueue({
            source: 'webhook',
            refId: 'wh_live',
            dedupKey: 'e1',
            url: 'https://receiver.example/hook',
            signingSecret: SECRET,
            payload,
        });
        await outbox.ack(id, { success: false, dead: true, error: 'receiver down', durationMs: 1 });

        const replayed = await outbox.redeliver(id);
        expect(replayed.status).toBe('pending');

        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();

        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0].body)).toEqual(payload);
        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
    });
});

/**
 * The two implementations must not drift: `MemoryHttpOutbox` is what most tests
 * in this repo assert against, so a refusal present only in the SQL one would
 * be invisible exactly where it is most often exercised.
 */
describe.each<[string, () => IHttpOutbox]>([
    ['MemoryHttpOutbox', () => new MemoryHttpOutbox()],
])('%s — parked-record contract (#8069)', (_name, make) => {
    it('parks with the reason on the row and refuses redelivery', async () => {
        const outbox = make();
        const id = await outbox.recordUndeliverable({
            source: 'webhook', refId: 'wh_1', dedupKey: 'e1',
            url: 'https://x', payload: { a: 1 }, reason: DROP_REASON,
        });
        const [row] = await outbox.list();
        expect(row.status).toBe('dead');
        expect(row.attempts).toBe(0);
        expect(row.error).toBe(DROP_REASON);
        expect(row.signature).toBeUndefined();

        // Never claimed…
        expect(await outbox.claim({ nodeId: 'n1', limit: 10, claimTtlMs: 1000 })).toHaveLength(0);
        // …and never redeliverable.
        await expect(outbox.redeliver(id)).rejects.toBeInstanceOf(HttpRedeliverError);
        await expect(outbox.redeliver(id)).rejects.toMatchObject({ code: 'DELIVERY_NEVER_SENT' });
    });

    it('refuses the parked discriminator at the delivery door', async () => {
        const outbox = make();
        // The routing in `MessagingService.enqueueHttp` is what normally keeps
        // this input away from `enqueue()`. If it is ever bypassed, minting a
        // `pending` unsigned row is the catastrophe — so the door refuses
        // rather than ignoring the flag it does not act on.
        await expect(
            outbox.enqueue({
                source: 'webhook', refId: 'wh_1', dedupKey: 'e1', url: 'https://x',
                payload: {}, undeliverableReason: DROP_REASON,
            }),
        ).rejects.toThrow(/recordUndeliverable/);
        expect(await outbox.list()).toHaveLength(0);
    });
});
