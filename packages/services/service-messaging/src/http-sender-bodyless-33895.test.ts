// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signHttpBody, verifyHttpSignature } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { SqlHttpOutbox } from './sql-http-outbox.js';
import { HttpDelivery } from './objects/http-delivery.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { deliveryBody, sendOnce, type FetchImpl } from './http-sender.js';
import type { HttpDelivery as HttpDeliveryRow } from './http-outbox.js';

/**
 * A GET or HEAD delivery goes out of the HTTP outbox with no body, and its
 * signature covers what it sends: the empty string, the published scheme's
 * bytes for a request with no body (the inline `http` node arm signs the same).
 *
 * The defect: the outbox always sent `deliveryBody(payload)` — `'{}'` for a
 * durable `http` node with no body — and `fetch` refuses a GET or HEAD that
 * carries any body, so the dispatcher retried a transport failure until the
 * delivery was dead. It also signed `'{}'`, bytes no receiver would see.
 *
 * The outbox never drops bytes to make that work: a GET or HEAD whose payload
 * is a real body (anything but absent, `null` or the node's empty `{}`) is
 * refused at enqueue, and a row that still holds one fails at send.
 */

const SECRET = 'bodyless-secret';
const EMPTY_BODY_SIGNATURE = signHttpBody('', SECRET);

interface Recorded {
    url: string;
    method: string;
    headers: Record<string, string>;
    hasBodyKey: boolean;
    body: string | undefined;
}

function recordingFetch(): { impl: FetchImpl; calls: Recorded[] } {
    const calls: Recorded[] = [];
    const impl: FetchImpl = async (url, init) => {
        calls.push({
            url,
            method: init.method,
            headers: init.headers,
            hasBodyKey: 'body' in init,
            body: init.body,
        });
        return { ok: true, status: 200, async text() { return 'ok'; } };
    };
    return { impl, calls };
}

async function enqueueAndTick(
    method: string,
    fetchImpl: FetchImpl | undefined,
    url = 'https://receiver.test/hook',
): Promise<MemoryHttpOutbox> {
    const outbox = new MemoryHttpOutbox();
    await outbox.enqueue({
        source: 'flow',
        refId: 'node_1',
        dedupKey: `d-${method}`,
        label: 'flow:node_1',
        url,
        method,
        signingSecret: SECRET,
        // What a durable `http` node with no `body` enqueues.
        payload: {},
    });
    const dispatcher = new HttpDispatcher({
        nodeId: 'n1',
        outbox,
        ...(fetchImpl ? { fetchImpl } : {}),
        partitionCount: 1,
    });
    await dispatcher.tick();
    return outbox;
}

describe('HTTP outbox — a GET or HEAD delivery sends no body and signs what it sends', () => {
    it.each(['GET', 'HEAD', 'get'])('%s: no body key reaches fetch, the signature is over the empty body, the row succeeds', async (method) => {
        const { impl, calls } = recordingFetch();
        const outbox = await enqueueAndTick(method, impl);

        expect(calls).toHaveLength(1);
        const [call] = calls;
        expect(call!.method).toBe(method);
        expect(call!.hasBodyKey).toBe(false);
        expect(call!.headers['Content-Type']).toBeUndefined();
        expect(call!.headers['X-Objectstack-Signature']).toBe(EMPTY_BODY_SIGNATURE);
        expect(verifyHttpSignature('', SECRET, call!.headers['X-Objectstack-Signature']!)).toEqual({
            valid: true,
            scheme: 'body-only',
        });

        const [row] = await outbox.list();
        expect(row!.status).toBe('success');
        expect(row!.attempts).toBe(1);
    });

    it('CONTROL: a POST still sends the serialized payload, signed over those bytes, as JSON', async () => {
        const { impl, calls } = recordingFetch();
        const outbox = await enqueueAndTick('POST', impl);

        const [call] = calls;
        expect(call!.method).toBe('POST');
        expect(call!.body).toBe('{}');
        expect(call!.headers['Content-Type']).toBe('application/json');
        expect(call!.headers['X-Objectstack-Signature']).toBe(signHttpBody('{}', SECRET));
        expect((await outbox.list())[0]!.status).toBe('success');
    });

    it('the signed bytes follow the method: empty for GET/HEAD, the payload otherwise', () => {
        expect(deliveryBody({}, 'GET')).toBe('');
        expect(deliveryBody(undefined, 'head')).toBe('');
        expect(deliveryBody({ a: 1 }, 'POST')).toBe('{"a":1}');
        expect(deliveryBody({ a: 1 })).toBe('{"a":1}');
        expect(deliveryBody('raw', 'PUT')).toBe('raw');
    });
});

describe('HTTP outbox — a GET or HEAD delivery reaches a real receiver through the real fetch', () => {
    let server: Server;
    let baseUrl: string;
    const received: Array<{ method: string; body: string; signature: string | undefined }> = [];

    // This suite's receiver listens on loopback, which the outbound-request guard
    // refuses unless the operator allowlists it — so the suite allowlists it the way
    // an operator does, through the environment.
    beforeAll(() => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '127.0.0.1');
    });
    afterAll(() => {
        vi.unstubAllEnvs();
    });

    beforeAll(async () => {
        server = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => {
                const sig = req.headers['x-objectstack-signature'];
                received.push({
                    method: req.method ?? '',
                    body: Buffer.concat(chunks).toString('utf8'),
                    signature: Array.isArray(sig) ? sig[0] : sig,
                });
                res.writeHead(204).end();
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it.each(['GET', 'HEAD'])('%s is delivered once and the receiver verifies its signature over what arrived', async (method) => {
        received.length = 0;
        const outbox = await enqueueAndTick(method, undefined, `${baseUrl}/hook`);

        const [row] = await outbox.list();
        expect(row!.error).toBeUndefined();
        expect(row!.status).toBe('success');
        expect(received).toHaveLength(1);
        expect(received[0]!.method).toBe(method);
        expect(received[0]!.body).toBe('');
        expect(verifyHttpSignature(received[0]!.body, SECRET, received[0]!.signature!)).toEqual({
            valid: true,
            scheme: 'body-only',
        });
    });
});

describe('SqlHttpOutbox — the production outbox signs a GET or HEAD over what it sends', () => {
    let engine: ObjectQL | undefined;

    afterAll(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    it.each(['GET', 'HEAD'])('%s on sqlite: stored signature covers the empty body, fetch gets no body, the row succeeds', async (method) => {
        engine = new ObjectQL();
        engine.registerDriver(
            new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
            true,
        );
        await engine.init();
        engine.registry.registerObject(HttpDelivery as any, '@objectstack/service-messaging');
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
        await outbox.enqueue({
            source: 'flow',
            refId: 'node_1',
            dedupKey: `sql-${method}`,
            url: 'https://receiver.test/hook',
            method,
            signingSecret: SECRET,
            payload: {},
        });

        const { impl, calls } = recordingFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();

        expect(calls).toHaveLength(1);
        expect(calls[0]!.hasBodyKey).toBe(false);
        expect(calls[0]!.headers['X-Objectstack-Signature']).toBe(EMPTY_BODY_SIGNATURE);
        const [row] = await outbox.list();
        expect(row!.status).toBe('success');
        await engine.destroy();
        engine = undefined;
    });
});

const REFUSAL = /a (GET|HEAD) delivery is sent with no body, and this one carries a payload.*Use POST or PUT/;

function bodyInput(method: string, payload: unknown, dedupKey = `r-${method}`) {
    return { source: 'flow', refId: 'node_1', dedupKey, url: 'https://receiver.test/hook', method, signingSecret: SECRET, payload };
}

describe('HTTP outbox — a GET or HEAD with a real body is refused, never sent without it', () => {
    it.each([
        ['GET', { a: 1 }],
        ['HEAD', 'raw'],
        ['get', [1]],
        ['GET', ''],
    ])('MemoryHttpOutbox refuses %s with payload %j at enqueue and writes no row', async (method, payload) => {
        const outbox = new MemoryHttpOutbox();
        await expect(outbox.enqueue(bodyInput(method, payload))).rejects.toThrow(REFUSAL);
        expect(await outbox.list()).toHaveLength(0);
    });

    it.each([undefined, null, {}])('MemoryHttpOutbox admits a GET whose payload is the no-body value %j', async (payload) => {
        const outbox = new MemoryHttpOutbox();
        await outbox.enqueue(bodyInput('GET', payload));
        expect(await outbox.list()).toHaveLength(1);
    });

    it('CONTROL: a POST with the same payload is admitted', async () => {
        const outbox = new MemoryHttpOutbox();
        await outbox.enqueue(bodyInput('POST', { a: 1 }));
        expect(await outbox.list()).toHaveLength(1);
    });

    it('a stored GET row that still holds a real payload fails at send without calling fetch, and is not retried', async () => {
        const { impl, calls } = recordingFetch();
        const row = {
            id: 'row_1', source: 'webhook', refId: 'wh_1', dedupKey: 'k', url: 'https://receiver.test/hook',
            method: 'GET', payload: { object: 'crm_order', recordId: 'o1' }, status: 'pending', attempts: 0,
            createdAt: 0, updatedAt: 0,
        } as unknown as HttpDeliveryRow;

        const outcome = await sendOnce(row, impl);

        expect(calls).toHaveLength(0);
        expect(outcome.success).toBe(false);
        expect(outcome).toMatchObject({ retriable: false });
        expect((outcome as { error?: string }).error).toMatch(REFUSAL);
    });

    it('SqlHttpOutbox on sqlite refuses a GET with a real body at enqueue and stores no row', async () => {
        const engine = new ObjectQL();
        engine.registerDriver(
            new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
            true,
        );
        await engine.init();
        engine.registry.registerObject(HttpDelivery as any, '@objectstack/service-messaging');
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        try {
            const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
            await expect(outbox.enqueue(bodyInput('GET', { a: 1 }))).rejects.toThrow(REFUSAL);
            expect(await outbox.list()).toHaveLength(0);
            await outbox.enqueue(bodyInput('GET', {}, 'admitted'));
            expect(await outbox.list()).toHaveLength(1);
        } finally {
            await engine.destroy();
        }
    });
});
