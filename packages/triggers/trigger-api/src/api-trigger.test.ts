// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiTrigger, verifySignature } from './api-trigger.js';
import type { QueueServiceSurface } from './api-trigger.js';

/** In-memory queue: publish stores, deliver() drains to subscribers. */
function makeFakeQueue() {
    const subs = new Map<string, (m: { data: any }) => Promise<void> | void>();
    const pending = new Map<string, any[]>();
    let n = 0;
    const q: QueueServiceSurface & {
        deliver(): Promise<number>;
        published: Array<{ queue: string; data: any; idempotencyKey?: string }>;
        subscribed: string[];
    } = {
        published: [],
        subscribed: [],
        async publish(queue, data, options) {
            this.published.push({ queue, data, idempotencyKey: options?.idempotencyKey });
            (pending.get(queue) ?? pending.set(queue, []).get(queue)!).push(data);
            return `msg_${++n}`;
        },
        async subscribe(queue, handler) { this.subscribed.push(queue); subs.set(queue, handler as any); },
        async unsubscribe(queue) { subs.delete(queue); },
        async deliver() {
            let delivered = 0;
            for (const [queue, items] of pending) {
                const handler = subs.get(queue);
                if (!handler) continue;
                for (const data of items.splice(0)) { await handler({ data }); delivered++; }
            }
            return delivered;
        },
    };
    return q;
}

const logger = { info: vi.fn(), warn: vi.fn() };

function sig(secret: string, body: string): string {
    return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('ApiTrigger', () => {
    let queue: ReturnType<typeof makeFakeQueue>;
    let trigger: ApiTrigger;
    let runs: any[];

    beforeEach(() => {
        queue = makeFakeQueue();
        trigger = new ApiTrigger(() => queue, logger as any);
        runs = [];
        vi.clearAllMocks();
    });

    function arm(config: Record<string, unknown> = {}) {
        trigger.start({ flowName: 'lead_intake', config }, async (ctx) => { runs.push(ctx); });
    }

    it('verifySignature accepts a correct GitHub-style signature and rejects others', () => {
        const body = '{"a":1}';
        expect(verifySignature('s3cret', body, sig('s3cret', body))).toBe(true);
        expect(verifySignature('s3cret', body, sig('wrong', body))).toBe(false);
        expect(verifySignature('s3cret', body, undefined)).toBe(false);
        expect(verifySignature('s3cret', body, 'sha256=zz')).toBe(false);
    });

    it('202-enqueues a valid post and the consumer runs the flow with the payload as record', async () => {
        arm({ hookId: 'hk1', secret: 's3cret' });
        const body = JSON.stringify({ title: 'New lead', amount: 5000 });
        const res = await trigger.handleRequest({
            flowName: 'lead_intake', hookId: 'hk1', rawBody: body, signatureHeader: sig('s3cret', body),
        });
        expect(res.status).toBe(202);
        expect(res.body.accepted).toBe(true);
        expect(runs).toHaveLength(0); // never executed in-band
        expect(await queue.deliver()).toBe(1);
        expect(runs).toHaveLength(1);
        expect(runs[0].record).toEqual({ title: 'New lead', amount: 5000 });
        expect(runs[0].params).toEqual({ title: 'New lead', amount: 5000 });
    });

    it('answers 404 identically for unknown flows and wrong hookIds (no probing oracle)', async () => {
        arm({ hookId: 'hk1', secret: 's3cret' });
        const a = await trigger.handleRequest({ flowName: 'nope', hookId: 'hk1', rawBody: '{}' });
        const b = await trigger.handleRequest({ flowName: 'lead_intake', hookId: 'wrong', rawBody: '{}' });
        expect(a).toEqual(b);
        expect(a.status).toBe(404);
    });

    it('401s a missing or bad signature', async () => {
        arm({ hookId: 'hk1', secret: 's3cret' });
        const body = '{"x":1}';
        expect((await trigger.handleRequest({ flowName: 'lead_intake', hookId: 'hk1', rawBody: body })).status).toBe(401);
        expect((await trigger.handleRequest({
            flowName: 'lead_intake', hookId: 'hk1', rawBody: body, signatureHeader: sig('other', body),
        })).status).toBe(401);
    });

    // ADR-0041: a per-flow secret is required. A binding without a usable one
    // is refused at arm time — nothing is stored, nothing is subscribed, and
    // the flow has no hook for any post to reach.
    for (const [label, config] of [
        ['no secret at all', {}],
        ['a blank secret', { secret: '   ' }],
        ['a non-string secret', { secret: 42 }],
    ] as const) {
        it(`refuses to arm a flow with ${label}: start() throws naming the flow, and no hook exists`, async () => {
            expect(() => arm({ ...config })).toThrow(/'lead_intake'.*config\.secret/);

            // Nothing armed, nothing subscribed, nothing logged as armed.
            expect(trigger.listHooks()).toEqual([]);
            expect(queue.subscribed).toEqual([]);
            expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('armed:'));

            // A post to the flow finds no hook: the same 404 an unknown flow
            // gets, and nothing reaches the queue or the flow.
            const res = await trigger.handleRequest({ flowName: 'lead_intake', hookId: 'default', rawBody: '{"x":1}' });
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'No such hook.' } });
            expect(queue.published).toEqual([]);
            expect(await queue.deliver()).toBe(0);
            expect(runs).toEqual([]);
        });
    }

    it('400s non-object or invalid JSON bodies', async () => {
        arm({ secret: 's3cret' });
        expect((await trigger.handleRequest({
            flowName: 'lead_intake', hookId: 'default', rawBody: 'not json', signatureHeader: sig('s3cret', 'not json'),
        })).status).toBe(400);
        expect((await trigger.handleRequest({
            flowName: 'lead_intake', hookId: 'default', rawBody: '[1,2]', signatureHeader: sig('s3cret', '[1,2]'),
        })).status).toBe(400);
    });

    it('passes x-idempotency-key through to the queue dedup window', async () => {
        arm({ secret: 's3cret' });
        await trigger.handleRequest({
            flowName: 'lead_intake', hookId: 'default', rawBody: '{}', signatureHeader: sig('s3cret', '{}'), idempotencyKey: 'evt_42',
        });
        expect(queue.published[0].idempotencyKey).toBe('evt_42');
    });

    it('503s when no queue service is registered', async () => {
        const t = new ApiTrigger(() => null, logger as any);
        t.start({ flowName: 'f', config: { secret: 's3cret' } }, async () => {});
        const res = await t.handleRequest({ flowName: 'f', hookId: 'default', rawBody: '{}', signatureHeader: sig('s3cret', '{}') });
        expect(res.status).toBe(503);
    });

    it('stop() disarms the hook and unsubscribes the queue', async () => {
        arm({ hookId: 'hk1', secret: 's3cret' });
        trigger.stop('lead_intake');
        const res = await trigger.handleRequest({ flowName: 'lead_intake', hookId: 'hk1', rawBody: '{}' });
        expect(res.status).toBe(404);
        expect(trigger.listHooks()).toHaveLength(0);
    });
});

/**
 * [#20790] A flow stored through the metadata save door keeps its secret in the
 * write-only flow credential store, not in its start node, so the engine's
 * binding hands this trigger a reader instead: the hook arms on it, every post
 * is verified against what it reads at that moment, and a secret that cannot
 * be read refuses the post rather than verifying it against nothing.
 */
describe('ApiTrigger — a secret read at verification time', () => {
    const HELD = 'pin-trigger-held-5e1a';
    const ROTATED = 'pin-trigger-rotated-b82d';

    function armWith(resolveSecret: () => Promise<string | undefined>, config: Record<string, unknown> = {}) {
        const queue = makeFakeQueue();
        const t = new ApiTrigger(() => queue, logger as any);
        t.start({ flowName: 'held_intake', config, resolveSecret }, async () => {});
        const post = (secret: string) =>
            t.handleRequest({ flowName: 'held_intake', hookId: 'default', rawBody: '{"a":1}', signatureHeader: sig(secret, '{"a":1}') });
        return { t, queue, post };
    }

    it('arms with no secret in its config, and verifies against what the reader holds', async () => {
        let current = HELD;
        const { t, queue, post } = armWith(async () => current);
        expect(t.listHooks()).toEqual([{ flowName: 'held_intake', hookId: 'default', signed: true }]);
        expect((await post(HELD)).status).toBe(202);
        expect((await post('not-the-secret')).status).toBe(401);
        expect(queue.published).toHaveLength(1);

        // A rotation applies to the next post — nothing re-arms.
        current = ROTATED;
        expect((await post(HELD)).status).toBe(401);
        expect((await post(ROTATED)).status).toBe(202);
    });

    it('the reader is read as the literal was: trimmed', async () => {
        const { post } = armWith(async () => `  ${HELD}  `);
        expect((await post(HELD)).status).toBe(202);
    });

    it('a secret the reader cannot produce refuses the post with 503 — never verified, never enqueued', async () => {
        for (const reader of [
            async () => { throw new Error('no crypto provider'); },
            async () => undefined,
            async () => '   ',
        ]) {
            const { queue, post } = armWith(reader as () => Promise<string | undefined>);
            const res = await post(HELD);
            expect(res.status).toBe(503);
            expect((res.body as any).error.code).toBe('SERVICE_UNAVAILABLE');
            expect(queue.published).toEqual([]);
        }
    });

    it('an unknown hook still answers 404 before any secret is read (no oracle)', async () => {
        let reads = 0;
        const { t } = armWith(async () => { reads += 1; return HELD; });
        const res = await t.handleRequest({ flowName: 'held_intake', hookId: 'wrong', rawBody: '{}', signatureHeader: sig(HELD, '{}') });
        expect(res.status).toBe(404);
        expect(reads).toBe(0);
    });
});
