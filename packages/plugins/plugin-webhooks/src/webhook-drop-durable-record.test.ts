// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8069 — the webhook half of "a dropped subscription leaves a durable record,
 * and that record is not a button that sends unsigned".
 *
 * ## What was wrong
 * `AutoEnqueuer` drops a subscription whose encrypted signing secret it cannot
 * resolve — correct and fail-closed (#7799) — by omitting it from the cache
 * entirely. Every matching record change then found no subscription and
 * vanished: no delivery, no `sys_http_delivery` row, nothing for an operator
 * reading the delivery table to find. #8043 made the drop LOUD (say-once
 * `error` with the remedy); it did not make it DURABLE, and the card says so
 * explicitly.
 *
 * ## Why the whole chain, not the enqueuer alone
 * The drop record only means something if it is unsendable, and "unsendable" is
 * a property of the outbox and the redeliver path, not of the enqueuer. So
 * these tests drive the real `AutoEnqueuer`, the real `MessagingService`
 * routing seam, the real `MemoryHttpOutbox` (same write path shape as the SQL
 * one) and the real refusal — because the failure mode being excluded lives
 * precisely in the hand-offs between them.
 *
 * ## The vacuity trap closed here
 * A test asserting "a row exists after a drop" is satisfied by the PROHIBITED
 * naive shape — the bare `dead` row plus a live redeliver button. So the
 * end-to-end test asserts the record AND that `redeliverHttp()` refuses it AND
 * that a dispatcher tick puts nothing on the wire. Conversely, a subscription
 * that is legitimately unsigned must keep delivering, so that is pinned too:
 * otherwise "refuse everything" would pass.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DataEventSchema } from '@objectstack/spec/api';
import type {
    IDataEngine,
    IRealtimeService,
    RealtimeEventHandler,
    RealtimeEventPayload,
} from '@objectstack/spec/contracts';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import {
    HttpDispatcher,
    MemoryHttpOutbox,
    MessagingService,
    type EnqueueHttpInput,
    type FetchImpl,
} from '@objectstack/service-messaging';
import { AutoEnqueuer } from './auto-enqueuer.js';
import { createWebhookRedeliverGuard } from './redeliver-guard.js';

/** objectql's opaque stored form — present, but not the key. */
const SECRET_REF = 'secret:sec_8069';

class FakeRealtime implements IRealtimeService {
    private subs = new Map<string, { handler: RealtimeEventHandler; opts?: any }>();
    private n = 0;
    async publish(event: RealtimeEventPayload): Promise<void> {
        for (const sub of this.subs.values()) {
            const o = sub.opts ?? {};
            if (o.object && event.object !== o.object) continue;
            await sub.handler(event);
        }
    }
    async subscribe(_channel: string, handler: any, opts?: any): Promise<string> {
        const id = `s-${++this.n}`;
        this.subs.set(id, { handler, opts });
        return id;
    }
    async unsubscribe(id: string): Promise<void> {
        this.subs.delete(id);
    }
}

/**
 * Just enough engine to serve the subscription cache and the guard's lookup.
 *
 * The write verbs open with the PRODUCER's own dispatch predicates, per
 * `check:engine-double-contract` — a double looser than the real engine turns a
 * green suite into no suite on exactly the call shapes ObjectQL refuses.
 *
 * `resolveSecretField` is the privileged dereference the enqueuer uses; a
 * `null` return models the engine's own "there is a stored value but nothing
 * came back" outcome, and a throw models the fail-closed refusals (no
 * CryptoProvider registered, `sys_secret` row gone).
 */
function makeEngine(
    rows: any[],
    resolveSecretField?: (object: string, id: string, field: string) => Promise<string | null>,
): IDataEngine {
    const engine: any = {
        async find() { return rows; },
        async findOne(_n: string, opts?: any) {
            const id = opts?.where?.id;
            if (id === undefined) return rows[0] ?? null;
            return rows.find((r) => r.id === id) ?? null;
        },
        async insert(_n: string, d: any) { return d; },
        async update(_n: string, data: any, options?: any) {
            assertEngineUpdateDispatch(data, options);
            return { affected: 0 };
        },
        async delete(_n: string, options?: any) {
            assertEngineDeleteDispatch(options);
            return { affected: 0 };
        },
        async count() { return rows.length; },
        async aggregate() { return []; },
    };
    if (resolveSecretField) engine.resolveSecretField = resolveSecretField;
    return engine as IDataEngine;
}

function recordEvent(object: string, record: any): RealtimeEventPayload {
    const payload = DataEventSchema.parse({
        id: randomUUID(),
        type: 'data.record.created',
        object,
        recordId: String(record.id),
        after: record,
        timestamp: '2026-08-13T00:00:00.000Z',
    });
    return { type: payload.type, object, payload: { ...payload }, timestamp: payload.timestamp };
}

function subscriptionRow(over: Record<string, unknown> = {}) {
    return {
        id: 'wh-1',
        name: 'orders_hook',
        active: true,
        object_name: 'crm_order',
        triggers: ['create'],
        url: 'https://receiver.example/hook',
        method: 'POST',
        definition_json: '{}',
        ...over,
    };
}

/** The production wiring shape: one injected door, the service routes it. */
function wire(engine: IDataEngine) {
    const outbox = new MemoryHttpOutbox();
    const messaging = new MessagingService({ logger: { info() {}, warn() {}, error() {}, debug() {} } as any });
    messaging.setHttpOutbox(outbox);
    messaging.registerRedeliverGuard('webhook', createWebhookRedeliverGuard(engine));
    const realtime = new FakeRealtime();
    const enqueuer = new AutoEnqueuer(
        engine,
        realtime,
        (input: EnqueueHttpInput) => messaging.enqueueHttp(input),
        { logger: { info() {}, warn() {}, error() {}, debug() {} } },
    );
    return { outbox, messaging, realtime, enqueuer };
}

function makeFetch() {
    const calls: Array<{ headers: Record<string, string>; body: string }> = [];
    const impl: FetchImpl = async (_url, init) => {
        calls.push({ headers: init.headers, body: init.body });
        return { ok: true, status: 200, async text() { return 'ok'; } };
    };
    return { impl, calls };
}

describe('dropped webhook subscription leaves a durable, unsendable record (#8069)', () => {
    it('records the discarded event instead of losing it, and refuses to redeliver it', async () => {
        // A webhook that HAS a stored key the engine cannot decrypt — the
        // rotated-key / missing-sys_secret shape, the residue #8043 left.
        const engine = makeEngine(
            [subscriptionRow({ signing_secret: SECRET_REF })],
            async () => { throw new Error('Cannot resolve secret: sys_secret row "sec_8069" not found (fail-closed).'); },
        );
        const { outbox, messaging, realtime, enqueuer } = wire(engine);
        await enqueuer.start();

        await realtime.publish(recordEvent('crm_order', { id: 'o1', total: 42 }));
        await new Promise((r) => setTimeout(r, 0)); // enqueue is fire-and-forget
        await enqueuer.stop();

        // ── DURABLE: the discarded event is in the delivery table, with cause ──
        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.source).toBe('webhook');
        expect(row.refId).toBe('wh-1');
        expect(row.status).toBe('dead');
        expect(row.attempts).toBe(0);
        // The reason column carries the cause AND the remedy — this is the
        // measured answer to the ruling's step 3: no new lifecycle state needed.
        expect(row.error).toContain('could not be decrypted');
        expect(row.error).toContain('setCryptoProvider');
        expect(row.error).toContain('sec_8069'); // the underlying engine cause, not a generic string
        // …and the event itself is recorded, not just an empty marker.
        expect(row.payload).toMatchObject({ object: 'crm_order', recordId: 'o1', action: 'created' });

        // ── UNSENDABLE: no signature, never claimed, never redeliverable ──
        expect(row.signature).toBeUndefined();
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        expect(calls).toHaveLength(0);

        await expect(messaging.redeliverHttp(row.id)).rejects.toMatchObject({
            code: 'DELIVERY_NEVER_SENT',
        });
        // The refusal did not mutate the row on its way out.
        expect((await outbox.list())[0]).toMatchObject({ status: 'dead', attempts: 0 });
    });

    it('parks without copying the header map onto a row that will never be sent', async () => {
        // Secret resolves; the HEADER map does not. Same drop rule (#7986), and
        // the parked row must not carry the authored headers — that map is the
        // ordinary place an Authorization credential goes, and a 30d-retained
        // row is a credential copy bought for nothing.
        const engine = makeEngine(
            [subscriptionRow({ signing_secret: SECRET_REF, headers_secret: SECRET_REF })],
            async (_o, _id, field) =>
                field === 'headers_secret'
                    ? Promise.reject(new Error('no CryptoProvider'))
                    : 'whsec_live',
        );
        const { outbox, realtime, enqueuer } = wire(engine);
        await enqueuer.start();
        await realtime.publish(recordEvent('crm_order', { id: 'o2' }));
        await new Promise((r) => setTimeout(r, 0));
        await enqueuer.stop();

        const [row] = await outbox.list();
        expect(row.status).toBe('dead');
        expect(row.headers).toBeUndefined();
        // And the resolved signing secret did not ride along either.
        expect(JSON.stringify(row)).not.toContain('whsec_live');
    });

    /**
     * The one wiring that can still lose a drop record, and the register it is
     * reported in. Bound straight to `IHttpOutbox.enqueue`, the parked input is
     * refused at the delivery door — correct, since the alternative is minting
     * a `pending` unsigned row — but the record is then lost, which is the very
     * gap this card closes. That is a durability degradation, so it owes an
     * `error`, not the ordinary "enqueue failed" `warn`.
     */
    it('reports a lost drop record at error level, naming the mis-wiring', async () => {
        const engine = makeEngine(
            [subscriptionRow({ signing_secret: SECRET_REF })],
            async () => { throw new Error('no CryptoProvider'); },
        );
        const outbox = new MemoryHttpOutbox();
        const realtime = new FakeRealtime();
        const errors: string[] = [];
        const warns: string[] = [];
        const enqueuer = new AutoEnqueuer(
            engine,
            realtime,
            // ⛔ the unsupported wiring: the raw delivery door, not the seam.
            (input: EnqueueHttpInput) => outbox.enqueue(input),
            {
                logger: {
                    info() {}, debug() {},
                    warn(m: string) { warns.push(m); },
                    error(m: string) { errors.push(m); },
                },
            },
        );
        await enqueuer.start();
        await realtime.publish(recordEvent('crm_order', { id: 'o6' }));
        await new Promise((r) => setTimeout(r, 0));
        await enqueuer.stop();

        // Nothing was minted — in particular, no `pending` row that would have
        // gone out unsigned. That is the half that must never regress.
        expect(await outbox.list()).toHaveLength(0);
        // …and the loss is loud, in the register AGENTS.md assigns it.
        const lost = errors.find((m) => m.includes('could not record the undeliverable event'));
        expect(lost).toBeDefined();
        expect(lost).toContain('MessagingService.enqueueHttp');
        expect(warns.some((m) => m.includes('enqueue failed'))).toBe(false);
    });

    it('still delivers a legitimately unsigned webhook — the refusal is not a blanket', async () => {
        // `secret` is optional on the authoring envelope. A webhook that stores
        // no key is not parked, and its rows stay ordinary deliveries; without
        // this, "park everything" would pass every test above.
        const engine = makeEngine([subscriptionRow()]);
        const { outbox, realtime, enqueuer } = wire(engine);
        await enqueuer.start();
        await realtime.publish(recordEvent('crm_order', { id: 'o3' }));
        await new Promise((r) => setTimeout(r, 0));
        await enqueuer.stop();

        const [row] = await outbox.list();
        expect(row.status).toBe('pending');
        expect(row.error).toBeUndefined();

        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        expect(calls).toHaveLength(1);
    });

    it('re-arms cleanly: once the secret resolves, deliveries are signed again (#8022)', async () => {
        // The parked state must not be sticky. This is the #8022 regression
        // guard: a refresh that can resolve the credential clears the park.
        let broken = true;
        const engine = makeEngine(
            [subscriptionRow({ signing_secret: SECRET_REF })],
            async () => {
                if (broken) throw new Error('no CryptoProvider');
                return 'whsec_recovered';
            },
        );
        const { outbox, realtime, enqueuer } = wire(engine);
        await enqueuer.start();
        await realtime.publish(recordEvent('crm_order', { id: 'o4' }));
        await new Promise((r) => setTimeout(r, 0));

        broken = false;
        await enqueuer.refresh();
        await realtime.publish(recordEvent('crm_order', { id: 'o5' }));
        await new Promise((r) => setTimeout(r, 0));
        await enqueuer.stop();

        const rows = await outbox.list();
        expect(rows).toHaveLength(2);
        const parked = rows.find((r) => (r.payload as any).recordId === 'o4')!;
        const delivered = rows.find((r) => (r.payload as any).recordId === 'o5')!;
        expect(parked.status).toBe('dead');
        expect(delivered.status).toBe('pending');
        expect(delivered.signature).toMatch(/^sha256=/);
    });
});

describe('webhook redeliver guard — signing configuration availability (#8069)', () => {
    const row = { source: 'webhook', refId: 'wh-1' };

    it('refuses when the subscription was deleted — the case the ruling names', async () => {
        const guard = createWebhookRedeliverGuard(makeEngine([]));
        await expect(guard(row)).resolves.toContain('no longer exists');
    });

    it('refuses when a secret is stored but cannot be recovered', async () => {
        const guard = createWebhookRedeliverGuard(
            makeEngine([subscriptionRow({ signing_secret: SECRET_REF })], async () => {
                throw new Error('no CryptoProvider');
            }),
        );
        // A throwing resolver surfaces as a throw; `assertRedeliverAllowed`
        // turns that into a refusal — "could not check" is never "allowed".
        await expect(guard(row)).rejects.toThrow(/CryptoProvider/);
    });

    /**
     * The narrow fail-open this guard closes deliberately.
     *
     * `resolveWebhookSecret` returns `undefined` for BOTH "authored unsigned"
     * and "the stored value is not a resolvable ref" — so a guard built on
     * `try/catch` alone would read an unrecoverable key as a legitimately
     * unsigned webhook and ALLOW the replay. Presence is decidable from the
     * masked read even when the value is not, so the guard asks that instead.
     */
    it('refuses a stored secret that resolves to nothing, not just one that throws', async () => {
        const guard = createWebhookRedeliverGuard(
            makeEngine([subscriptionRow({ signing_secret: SECRET_REF })], async () => null),
        );
        await expect(guard(row)).resolves.toContain('cannot be recovered');
    });

    it('allows a healthy signed subscription and a legitimately unsigned one', async () => {
        const signed = createWebhookRedeliverGuard(
            makeEngine([subscriptionRow({ signing_secret: SECRET_REF })], async () => 'whsec_live'),
        );
        await expect(signed(row)).resolves.toBeUndefined();

        const unsigned = createWebhookRedeliverGuard(makeEngine([subscriptionRow()]));
        await expect(unsigned(row)).resolves.toBeUndefined();
    });

    it('speaks only for webhook rows', async () => {
        // A flow row must not be judged against `sys_webhook` — this guard has
        // no opinion on another producer's configuration.
        const guard = createWebhookRedeliverGuard(makeEngine([]));
        await expect(guard({ source: 'flow', refId: 'node_1' })).resolves.toBeUndefined();
    });
});
