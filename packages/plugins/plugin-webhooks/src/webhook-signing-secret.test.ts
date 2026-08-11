// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7722 — the webhook chain, end to end: a subscriber's signing secret reaches
 * the receiver as a verifiable signature and reaches the delivery row as
 * nothing at all.
 *
 * The enqueuer still hands `signingSecret` to the outbox (it belongs to the
 * subscriber and the outbox needs it for exactly one HMAC); what changed is that
 * the outbox consumes it instead of copying it onto the attempt row. This test
 * drives the REAL classes on both sides of that hand-off — `AutoEnqueuer`,
 * `MemoryHttpOutbox` (same enqueue path as the SQL outbox), `HttpDispatcher` —
 * from a `data.record.created` event, because a unit test of either half alone
 * cannot see a secret that leaks between them.
 *
 * The at-rest scan against a real SQL table lives next to the outbox itself:
 * `service-messaging/src/http-signature-at-rest.integration.test.ts`.
 */

import { randomUUID, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DataEventSchema } from '@objectstack/spec/api';
import type {
    IDataEngine,
    IRealtimeService,
    RealtimeEventHandler,
    RealtimeEventPayload,
} from '@objectstack/spec/contracts';
import { MemoryHttpOutbox, HttpDispatcher, type FetchImpl } from '@objectstack/service-messaging';
import { AutoEnqueuer } from './auto-enqueuer.js';

const SECRET = 'whsec_7722_subscriber_key';

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

/** Just enough engine to serve the `sys_webhook` subscription cache. */
function makeEngine(rows: any[]): IDataEngine {
    return {
        async find() { return rows; },
        async findOne() { return rows[0] ?? null; },
        async insert(_n: string, d: any) { return d; },
        async update() { return { affected: 0 }; },
        async delete() { return { affected: 0 }; },
        async count() { return rows.length; },
        async aggregate() { return []; },
    } as unknown as IDataEngine;
}

function recordEvent(object: string, record: any): RealtimeEventPayload {
    const payload = DataEventSchema.parse({
        id: randomUUID(),
        type: 'data.record.created',
        object,
        recordId: String(record.id),
        after: record,
        timestamp: '2026-08-11T00:00:00.000Z',
    });
    return { type: payload.type, object, payload: { ...payload }, timestamp: payload.timestamp };
}

function makeFetch() {
    const calls: Array<{ headers: Record<string, string>; body: string }> = [];
    const impl: FetchImpl = async (_url, init) => {
        calls.push({ headers: init.headers, body: init.body });
        return { ok: true, status: 200, async text() { return 'ok'; } };
    };
    return { impl, calls };
}

describe('webhook signing secret (#7722)', () => {
    it('delivers a verifiable signature without persisting the subscriber secret', async () => {
        const engine = makeEngine([
            {
                id: 'wh-1',
                name: 'crm_hook',
                active: true,
                object_name: 'contact',
                triggers: ['create'],
                url: 'https://receiver.example/hook',
                method: 'POST',
                definition_json: JSON.stringify({ secret: SECRET, headers: { 'X-Team': 'crm' } }),
            },
        ]);
        const realtime = new FakeRealtime();
        const outbox = new MemoryHttpOutbox();
        const enqueuer = new AutoEnqueuer(engine, realtime, (input) => outbox.enqueue(input));
        await enqueuer.start();

        await realtime.publish(recordEvent('contact', { id: 'c1', name: 'Ada', email: 'ada@example.com' }));
        // The enqueue is deliberately fire-and-forget on the hot path.
        await new Promise((r) => setTimeout(r, 0));

        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        await enqueuer.stop();

        // ── The receiver's check: recompute HMAC-SHA256 over the raw body ──
        expect(calls).toHaveLength(1);
        const expected = createHmac('sha256', SECRET).update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
        // The signed body is the real event, and the subscriber's own headers
        // still ride along — a blank delivery would satisfy the HMAC too.
        expect(JSON.parse(calls[0].body)).toMatchObject({ object: 'contact', recordId: 'c1', action: 'created' });
        expect(calls[0].headers['X-Team']).toBe('crm');

        // ── …and no attempt row carries the key that produced it ──
        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows)).not.toContain(SECRET);
        expect(rows[0].signature).toBe(`sha256=${expected}`);
    });
});
