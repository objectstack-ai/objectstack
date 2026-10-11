// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

    it('answers unknown flows and wrong hookIds identically, with the unverified-post refusal', async () => {
        arm({ hookId: 'hk1', secret: 's3cret' });
        const a = await trigger.handleRequest({ flowName: 'nope', hookId: 'hk1', rawBody: '{}' });
        const b = await trigger.handleRequest({ flowName: 'lead_intake', hookId: 'wrong', rawBody: '{}' });
        expect(a).toEqual(b);
        expect(a.status).toBe(401);
        expect((a.body as any).error.code).toBe('INVALID_SIGNATURE');
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

            // A post to the flow finds no hook: the same refusal an unknown
            // flow gets, and nothing reaches the queue or the flow.
            const res = await trigger.handleRequest({ flowName: 'lead_intake', hookId: 'default', rawBody: '{"x":1}' });
            expect(res).toEqual(await trigger.handleRequest({ flowName: 'never_armed', hookId: 'default', rawBody: '{"x":1}' }));
            expect(res.status).toBe(401);
            expect((res.body as any).error.code).toBe('INVALID_SIGNATURE');
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
        const res = await trigger.handleRequest({
            flowName: 'lead_intake', hookId: 'hk1', rawBody: '{}', signatureHeader: sig('s3cret', '{}'),
        });
        expect(res.status).toBe(401);
        expect((res.body as any).error.code).toBe('INVALID_SIGNATURE');
        expect(queue.published).toEqual([]);
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

    it('a wrong hook id is refused before any secret is read', async () => {
        let reads = 0;
        const { t } = armWith(async () => { reads += 1; return HELD; });
        const res = await t.handleRequest({ flowName: 'held_intake', hookId: 'wrong', rawBody: '{}', signatureHeader: sig(HELD, '{}') });
        expect(res.status).toBe(401);
        expect((res.body as any).error.code).toBe('INVALID_SIGNATURE');
        expect(reads).toBe(0);
    });
});

/**
 * The timestamped signature form beside the body-only one. A third-party
 * sender computes it on its own, so the helper below derives it with
 * `createHmac` directly from the published recipe rather than through
 * `@objectstack/core`: these pins check the receiver against the wire form,
 * not against the function it verifies with.
 *
 *   x-objectstack-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 *
 * Every refusal asserts the whole bad-signature envelope — `401`, code
 * `INVALID_SIGNATURE` — and that nothing reached the queue.
 */
describe('ApiTrigger — the timestamped signature form', () => {
    const NOW = 1760000000;
    const WINDOW = 300;
    const SECRET = 'pin-trigger-v1-3f9a';
    const BODY = JSON.stringify({ event: 'invoice.paid', id: 'evt_77' });
    const REFUSED = { status: 401, body: { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } } };

    function sigV1(secret: string, body: string, t: number): string {
        return `t=${t},v1=` + createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
    }

    let queue: ReturnType<typeof makeFakeQueue>;
    let log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
    let trigger: ApiTrigger;
    let runs: any[];

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW * 1000);
        queue = makeFakeQueue();
        log = { info: vi.fn(), warn: vi.fn() };
        trigger = new ApiTrigger(() => queue, log as any);
        runs = [];
        trigger.start({ flowName: 'invoice_intake', config: { hookId: 'hk_v1', secret: SECRET } }, async (ctx) => { runs.push(ctx); });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const post = (signatureHeader: string | undefined, rawBody = BODY) =>
        trigger.handleRequest({ flowName: 'invoice_intake', hookId: 'hk_v1', rawBody, signatureHeader });

    /** The deprecation lines this trigger has logged so far. */
    const deprecationLines = () =>
        log.warn.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('deprecated'));

    it('accepts a fresh timestamped post: 202, enqueued, the flow runs — and no deprecation line', async () => {
        const res = await post(sigV1(SECRET, BODY, NOW));
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ accepted: true, messageId: 'msg_1' });
        expect(await queue.deliver()).toBe(1);
        expect(runs[0].record).toEqual({ event: 'invoice.paid', id: 'evt_77' });
        expect(deprecationLines()).toEqual([]);
    });

    it('refuses a replay outside the window: the post it accepted, sent again later, is a 401 and is not enqueued', async () => {
        const header = sigV1(SECRET, BODY, NOW);
        expect((await post(header)).status).toBe(202);
        expect(queue.published).toHaveLength(1);

        vi.setSystemTime((NOW + WINDOW + 1) * 1000);
        expect(await post(header)).toEqual(REFUSED);
        expect(queue.published).toHaveLength(1);
    });

    it('refuses a stale timestamp the HMAC genuinely covers, and a future one past the window; accepts the edges', async () => {
        expect(await post(sigV1(SECRET, BODY, NOW - WINDOW - 1))).toEqual(REFUSED);
        expect(await post(sigV1(SECRET, BODY, NOW + WINDOW + 1))).toEqual(REFUSED);
        expect(queue.published).toEqual([]);
        expect((await post(sigV1(SECRET, BODY, NOW - WINDOW))).status).toBe(202);
        expect((await post(sigV1(SECRET, BODY, NOW + WINDOW))).status).toBe(202);
    });

    it('refuses a stale timestamp carried with a valid BODY-ONLY signature — a timestamp claims the versioned form, with no fallback', async () => {
        const bodyOnlyHex = sig(SECRET, BODY).slice('sha256='.length);
        for (const t of [NOW - WINDOW - 1, NOW - 3600, NOW]) {
            expect(await post(`t=${t},v1=${bodyOnlyHex}`), `v1 at ${t}`).toEqual(REFUSED);
            expect(await post(`t=${t},sha256=${bodyOnlyHex}`), `sha256 at ${t}`).toEqual(REFUSED);
        }
        expect(queue.published).toEqual([]);
        expect(deprecationLines()).toEqual([]);
    });

    it('refuses a malformed timestamped value with the same envelope a bad signature gets', async () => {
        const hex = sigV1(SECRET, BODY, NOW).split(',v1=')[1]!;
        for (const malformed of [
            `t=${NOW}`,
            `t=${NOW},v1=${hex.slice(2)}`,
            `t=${NOW},v1=${hex.toUpperCase()}`,
            `v1=${hex},t=${NOW}`,
            `t=0${NOW},v1=${hex}`,
            `t=abc,v1=${hex}`,
            `t=${NOW},v1=${hex},v0=${hex}`,
        ]) {
            expect(await post(malformed), malformed).toEqual(REFUSED);
        }
        // The same envelope as a plain bad signature.
        expect(await post(sig('not-the-secret', BODY))).toEqual(REFUSED);
        expect(queue.published).toEqual([]);
    });

    it('refuses the timestamped form under the wrong secret, or over a body other than the one received', async () => {
        expect(await post(sigV1('not-the-secret', BODY, NOW))).toEqual(REFUSED);
        expect(await post(sigV1(SECRET, BODY, NOW), `${BODY}\n`)).toEqual(REFUSED);
        expect(queue.published).toEqual([]);
    });

    it('CONTROL: still accepts a body-only signature, and logs its deprecation once per armed hook, naming the flow and the hook', async () => {
        expect((await post(sig(SECRET, BODY))).status).toBe(202);
        expect((await post(sig(SECRET, BODY))).status).toBe(202);
        expect(queue.published).toHaveLength(2);

        const lines = deprecationLines();
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain("flow 'invoice_intake'");
        expect(lines[0]).toContain("hook 'hk_v1'");
        expect(lines[0]).toContain('t=<unix seconds>,v1=');

        // A timestamped post adds nothing to it; re-arming the hook says it once more.
        expect((await post(sigV1(SECRET, BODY, NOW))).status).toBe(202);
        expect(deprecationLines()).toHaveLength(1);
        trigger.stop('invoice_intake');
        trigger.start({ flowName: 'invoice_intake', config: { hookId: 'hk_v1', secret: SECRET } }, async () => {});
        expect((await post(sig(SECRET, BODY))).status).toBe(202);
        expect(deprecationLines()).toHaveLength(2);
    });

    it('verifySignature, the exported check, accepts both forms and refuses a stale one', () => {
        expect(verifySignature(SECRET, BODY, sigV1(SECRET, BODY, NOW))).toBe(true);
        expect(verifySignature(SECRET, BODY, sig(SECRET, BODY))).toBe(true);
        expect(verifySignature(SECRET, BODY, sigV1(SECRET, BODY, NOW - WINDOW - 1))).toBe(false);
    });
});

/**
 * One answer for every post that does not verify, whatever the flow and the
 * hook id: an unknown flow, an armed flow under the default hook id, an armed
 * flow under a custom hook id posted with the wrong hook id, and each of those
 * unsigned or with a signature that does not verify. Every answer is the same
 * status and the same body, so the answer does not separate armed flow names
 * from unarmed ones. The cause goes to the server log only.
 *
 * These pins assert the status, the code, and that every answer equals every
 * other; the message prose is not pinned. Two CONTROLS beside them: a valid
 * post is still accepted under the default and a custom hook id, and the
 * `503` for a secret that cannot be read (the declared residual) is unchanged.
 */
describe('ApiTrigger — one answer for every post that does not verify', () => {
    const NOW = 1760000000;
    const SECRET_DEFAULT = 'pin-uniform-default-61c2';
    const SECRET_CUSTOM = 'pin-uniform-custom-9d04';
    const BODY = JSON.stringify({ event: 'uniform.pin', marker: 'pin-body-marker-4b7e' });

    function sigV1(secret: string, body: string, t: number): string {
        return `t=${t},v1=` + createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex');
    }

    let queue: ReturnType<typeof makeFakeQueue>;
    let log: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
    let trigger: ApiTrigger;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW * 1000);
        queue = makeFakeQueue();
        log = { info: vi.fn(), warn: vi.fn() };
        trigger = new ApiTrigger(() => queue, log as any);
        trigger.start({ flowName: 'armed_on_default', config: { secret: SECRET_DEFAULT } }, async () => {});
        trigger.start({ flowName: 'armed_on_custom', config: { hookId: 'hk_custom', secret: SECRET_CUSTOM } }, async () => {});
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    /** Where a post is sent, and the cause the log must record whatever it is signed with (`null`: the signature's). */
    const ADDRESSES = [
        ['an unknown flow', 'never_armed', 'default', 'unknown-flow'],
        ['an unknown flow, under a custom-looking hook id', 'never_armed', 'hk_custom', 'unknown-flow'],
        ['an armed flow under the default hook id', 'armed_on_default', 'default', null],
        ['an armed flow under a custom hook id, posted with the wrong hook id', 'armed_on_custom', 'default', 'wrong-hook-id'],
        ['an armed flow under a custom hook id, posted with its hook id', 'armed_on_custom', 'hk_custom', null],
    ] as const;

    /** A signature that does not verify for any of the addresses, and the cause it records. */
    const BAD_SIGNATURES = [
        ['unsigned', undefined, 'signature-absent'],
        ['a malformed signature', 'not-a-signature-value', 'signature-malformed'],
        ['a body-only signature under another secret', sig('not-the-secret', BODY), 'signature-mismatch'],
        ['a timestamped signature under another secret', sigV1('not-the-secret', BODY, NOW), 'signature-mismatch'],
    ] as const;

    /** Posts that carry the RIGHT secret for some flow and still must not verify. */
    const SIGNED_BUT_UNVERIFIED = [
        ['the right secret, posted with the wrong hook id', 'armed_on_custom', 'default', sig(SECRET_CUSTOM, BODY), 'wrong-hook-id'],
        ['another flow\'s secret, posted to an unknown flow', 'never_armed', 'default', sig(SECRET_DEFAULT, BODY), 'unknown-flow'],
        ['another flow\'s secret, posted to an armed flow', 'armed_on_default', 'default', sig(SECRET_CUSTOM, BODY), 'signature-mismatch'],
        ['the right secret, with a timestamp outside the window', 'armed_on_default', 'default', sigV1(SECRET_DEFAULT, BODY, NOW - 3600), 'signature-outside-window'],
    ] as const;

    type Case = { label: string; flowName: string; hookId: string; header: string | undefined; cause: string };
    const CASES: Case[] = [
        ...ADDRESSES.flatMap(([where, flowName, hookId, addressCause]) =>
            BAD_SIGNATURES.map(([how, header, signatureCause]) => ({
                label: `${where}, ${how}`, flowName, hookId, header, cause: addressCause ?? signatureCause,
            }))),
        ...SIGNED_BUT_UNVERIFIED.map(([label, flowName, hookId, header, cause]) => ({ label, flowName, hookId, header, cause })),
    ];

    const post = (c: Case) =>
        trigger.handleRequest({ flowName: c.flowName, hookId: c.hookId, rawBody: BODY, signatureHeader: c.header });

    /** The `cause` of every refusal line logged so far. */
    const refusalCauses = () =>
        log.warn.mock.calls
            .map((call) => call[1] as { cause?: unknown } | undefined)
            .filter((meta) => meta != null && typeof meta === 'object' && 'cause' in meta)
            .map((meta) => meta!.cause);

    it('every unverified post gets the same status and the same envelope, and nothing is enqueued', async () => {
        expect(CASES).toHaveLength(ADDRESSES.length * BAD_SIGNATURES.length + SIGNED_BUT_UNVERIFIED.length);
        const answers = [];
        for (const c of CASES) answers.push({ label: c.label, answer: await post(c) });

        const [first] = answers;
        expect(first!.answer.status).toBe(401);
        expect(first!.answer.body.success).toBe(false);
        expect((first!.answer.body as any).error.code).toBe('INVALID_SIGNATURE');
        for (const { label, answer } of answers) {
            expect(answer, label).toEqual(first!.answer);
        }
        expect(queue.published).toEqual([]);
    });

    it('the server log records the real cause of each refusal, once, and never the secret, the signature or the body', async () => {
        for (const c of CASES) {
            log.warn.mockClear();
            await post(c);
            expect(refusalCauses(), c.label).toEqual([c.cause]);
            const logged = JSON.stringify([...log.warn.mock.calls, ...log.info.mock.calls]);
            for (const secret of [SECRET_DEFAULT, SECRET_CUSTOM]) {
                expect(logged.includes(secret), `${c.label}: the secret`).toBe(false);
            }
            if (c.header) expect(logged.includes(c.header), `${c.label}: the signature value`).toBe(false);
            expect(logged.includes('pin-body-marker-4b7e'), `${c.label}: the body`).toBe(false);
        }
    });

    it('CONTROL: a valid post is still accepted under the default hook id and under a custom one, in both signature forms', async () => {
        for (const [flowName, hookId, secret] of [
            ['armed_on_default', 'default', SECRET_DEFAULT],
            ['armed_on_custom', 'hk_custom', SECRET_CUSTOM],
        ] as const) {
            for (const header of [sigV1(secret, BODY, NOW), sig(secret, BODY)]) {
                const res = await trigger.handleRequest({ flowName, hookId, rawBody: BODY, signatureHeader: header });
                expect(res.status, `${flowName}/${hookId}`).toBe(202);
                expect(res.body.accepted).toBe(true);
            }
        }
        expect(queue.published).toHaveLength(4);
        expect(refusalCauses()).toEqual([]);
    });

    it('CONTROL: a secret that cannot be read still answers 503 for its flow and hook id, signed or not; a wrong hook id never reads it', async () => {
        let reads = 0;
        trigger.start(
            { flowName: 'armed_unreadable', config: {}, resolveSecret: async () => { reads += 1; throw new Error('store offline'); } },
            async () => {},
        );
        for (const header of [undefined, sig('not-the-secret', BODY)]) {
            const res = await trigger.handleRequest({ flowName: 'armed_unreadable', hookId: 'default', rawBody: BODY, signatureHeader: header });
            expect(res.status).toBe(503);
            expect((res.body as any).error.code).toBe('SERVICE_UNAVAILABLE');
        }
        expect(reads).toBe(2);

        const wrongHook = await trigger.handleRequest({ flowName: 'armed_unreadable', hookId: 'other', rawBody: BODY });
        expect(wrongHook).toEqual(await post(CASES[0]!));
        expect(reads).toBe(2);
        expect(queue.published).toEqual([]);
    });
});
