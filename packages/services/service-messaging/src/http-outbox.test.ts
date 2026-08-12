// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { HttpDispatcher } from './http-dispatcher.js';
import type { FetchImpl } from './http-sender.js';

/** A fetch stub that records calls and returns a scripted sequence of responses. */
function makeFetch(responses: Array<{ ok: boolean; status: number; body?: string } | 'throw'>): {
    impl: FetchImpl;
    calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }>;
} {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
    let i = 0;
    const impl: FetchImpl = async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body });
        const r = responses[Math.min(i, responses.length - 1)];
        i++;
        if (r === 'throw') throw new Error('network down');
        return { ok: r.ok, status: r.status, async text() { return r.body ?? ''; } };
    };
    return { impl, calls };
}

describe('MemoryHttpOutbox', () => {
    it('dedups on (source, dedupKey)', async () => {
        const outbox = new MemoryHttpOutbox();
        const a = await outbox.enqueue({ source: 'flow', refId: 'f1', dedupKey: 'k1', url: 'https://x', payload: {} });
        const b = await outbox.enqueue({ source: 'flow', refId: 'f1', dedupKey: 'k1', url: 'https://x', payload: {} });
        expect(a).toBe(b);
        // Different source, same dedupKey → distinct row.
        const c = await outbox.enqueue({ source: 'webhook', refId: 'f1', dedupKey: 'k1', url: 'https://x', payload: {} });
        expect(c).not.toBe(a);
        expect(await outbox.list()).toHaveLength(2);
    });

    it('claim is exclusive and partition-filtered', async () => {
        const outbox = new MemoryHttpOutbox();
        await outbox.enqueue({ source: 'flow', refId: 'a', dedupKey: '1', url: 'https://x', payload: {} });
        const first = await outbox.claim({ nodeId: 'n1', limit: 10, claimTtlMs: 1000 });
        expect(first).toHaveLength(1);
        // Second claim sees nothing — the row is in_flight.
        const second = await outbox.claim({ nodeId: 'n2', limit: 10, claimTtlMs: 1000 });
        expect(second).toHaveLength(0);
    });
});

describe('HttpDispatcher', () => {
    it('delivers a pending row on success', async () => {
        const outbox = new MemoryHttpOutbox();
        await outbox.enqueue({
            source: 'flow',
            refId: 'r1',
            dedupKey: 'd1',
            label: 'flow:node1',
            url: 'https://example.test/hook',
            method: 'POST',
            payload: { hello: 'world' },
        });
        const { impl, calls } = makeFetch([{ ok: true, status: 200, body: 'ok' }]);
        const dispatcher = new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 });

        await dispatcher.tick();

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://example.test/hook');
        expect(calls[0].headers['X-Objectstack-Event']).toBe('flow:node1');
        expect(JSON.parse(calls[0].body)).toEqual({ hello: 'world' });
        const rows = await outbox.list();
        expect(rows[0].status).toBe('success');
        expect(rows[0].attempts).toBe(1);
        expect(rows[0].responseCode).toBe(200);
    });

    it('schedules a retry on a 500 (stays pending with nextRetryAt)', async () => {
        const outbox = new MemoryHttpOutbox();
        await outbox.enqueue({ source: 'flow', refId: 'r', dedupKey: 'd', url: 'https://x', payload: {} });
        const { impl } = makeFetch([{ ok: false, status: 500, body: 'boom' }]);
        const dispatcher = new HttpDispatcher({
            nodeId: 'n1',
            outbox,
            fetchImpl: impl,
            partitionCount: 1,
            rng: () => 0.5,
            now: () => 1_000,
        });

        await dispatcher.tick();

        const rows = await outbox.list();
        expect(rows[0].status).toBe('pending');
        expect(rows[0].attempts).toBe(1);
        expect(rows[0].nextRetryAt).toBeGreaterThan(1_000);
    });

    it('dead-letters a permanent 4xx failure immediately', async () => {
        const outbox = new MemoryHttpOutbox();
        await outbox.enqueue({ source: 'flow', refId: 'r', dedupKey: 'd', url: 'https://x', payload: {} });
        const { impl } = makeFetch([{ ok: false, status: 400, body: 'bad request' }]);
        const dispatcher = new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 });

        await dispatcher.tick();

        const rows = await outbox.list();
        expect(rows[0].status).toBe('dead');
    });

    it('adds an HMAC signature header when signingSecret is set', async () => {
        const outbox = new MemoryHttpOutbox();
        await outbox.enqueue({
            source: 'webhook',
            refId: 'w1',
            dedupKey: 'e1',
            url: 'https://x',
            signingSecret: 's3cr3t',
            payload: { a: 1 },
        });
        const { impl, calls } = makeFetch([{ ok: true, status: 204 }]);
        const dispatcher = new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 });

        await dispatcher.tick();

        // Verify the way a receiver does: recompute HMAC-SHA256 over the RAW
        // body that arrived. `toMatch(/^sha256=/)` only proved a header was
        // present — it would pass on a signature computed over other bytes.
        const expected = createHmac('sha256', 's3cr3t').update(calls[0].body).digest('hex');
        expect(calls[0].headers['X-Objectstack-Signature']).toBe(`sha256=${expected}`);
    });

    // [#7722] The secret is consumed by enqueue, never stored: the row the
    // dispatcher works from carries the signature only.
    it('keeps the signing secret off the delivery row', async () => {
        const outbox = new MemoryHttpOutbox();
        await outbox.enqueue({
            source: 'webhook',
            refId: 'w1',
            dedupKey: 'e1',
            url: 'https://x',
            signingSecret: 's3cr3t',
            payload: { a: 1 },
        });

        const [row] = await outbox.list();
        expect(row.signature).toMatch(/^sha256=[0-9a-f]{64}$/);
        expect(JSON.stringify(row)).not.toContain('s3cr3t');
    });
});
