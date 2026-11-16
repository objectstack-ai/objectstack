// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    MessagingService,
    MemoryHttpOutbox,
    HttpDispatcher,
    signHttpBody,
    HTTP_SIGNATURE_HEADER,
} from '@objectstack/service-messaging';
import { signHttpBody as coreSignHttpBody, HTTP_SIGNATURE_HEADER as CORE_HTTP_SIGNATURE_HEADER } from '@objectstack/core';
import { AutomationEngine } from '../engine.js';
import { registerHttpNodes } from './http-nodes.js';

/**
 * `signingSecret` on a flow `http` node means `X-Objectstack-Signature` on the
 * wire, on EVERY arm the node can take.
 *
 * The key is declared without qualification — `HttpConfigSchema.signingSecret`
 * reads "HMAC-SHA256 secret → X-Objectstack-Signature", and the descriptor's
 * `configSchema` says it signs each request — yet only the durable arm used
 * to hand it to anything that signs (the messaging outbox). The inline arm,
 * and the durable
 * arm's no-outbox fallback that degrades to it, built their `fetch` from
 * `headers` alone: the request went out unsigned and the run said
 * `success: true`.
 *
 * Every assertion here is made by a REAL local receiver, on the bytes and
 * headers it actually received, and a signature counts only if it verifies with
 * the published scheme (`signHttpBody` over the received body) — the check a
 * real receiving endpoint makes. A mocked `fetch` would pin what the node
 * INTENDED to send; the receiver pins what arrived.
 *
 * The refusal cases pin the other half: a secret the author wrote as a 17.x
 * template must stop the call, never let it leave signed with the braces or
 * unsigned. Since #19939 `signingSecret` is a literal, read as written (after
 * the credential channel), so a `{…}` token in it is refused by the contract
 * parse at the run — the build doors leave this key to the run, whose
 * credential store may hold the secret. An explicitly empty
 * `signingSecret: ''` is the documented way to send unsigned on purpose, and it
 * behaves the same on every arm.
 */

const SECRET = 'flow-hook-secret';

/**
 * `sha256=` + hex HMAC-SHA256 of the EMPTY body under {@link SECRET}. Pinned as
 * a literal so no arm can drift to signing something other than the empty body
 * a bodyless request actually carries (`'{}'`, `'null'`, …) while still
 * agreeing with a helper that drifted alongside it.
 */
const EMPTY_BODY_SIGNATURE = 'sha256=28c9179fd9763c0e7d41dc5241d9d77607270f8912e3b7692426f677bd5187f7';

const SIGNATURE_HEADER_LC = 'x-objectstack-signature';

interface Received {
    method: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

let server: Server;
let baseUrl: string;
const received: Received[] = [];

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
            received.push({
                method: req.method ?? '',
                headers: req.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
    received.length = 0;
});

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** An engine with the `http` node wired against the given `messaging` service (or none). */
function engineWith(messaging?: unknown): AutomationEngine {
    const engine = new AutomationEngine(silentLogger());
    registerHttpNodes(engine, {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : undefined),
    } as any);
    return engine;
}

function flow(config: Record<string, unknown>) {
    return {
        name: 'signed_callout',
        label: 'Signed callout',
        type: 'autolaunched' as const,
        variables: [{ name: 'signing_key', type: 'text' as const, isInput: true }],
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'call', type: 'http' as const, label: 'Call', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    };
}

async function run(engine: AutomationEngine, config: Record<string, unknown>, params?: Record<string, unknown>) {
    engine.registerFlow('signed_callout', flow(config));
    return engine.execute('signed_callout', params ? ({ params } as any) : undefined);
}

/** The one received request, asserting there was exactly one. */
function only(): Received {
    expect(received).toHaveLength(1);
    return received[0];
}

/** The signature a receiver would compute over what it received, with the shared secret. */
function expectVerifies(req: Received, secret: string): void {
    const sent = req.headers[SIGNATURE_HEADER_LC];
    expect(sent, 'no X-Objectstack-Signature arrived').toBeTypeOf('string');
    expect(sent).toBe(signHttpBody(req.body, secret));
}

/**
 * The two arms that call `fetch` in-process: the default request/response arm,
 * and `durable: true` on a host with no messaging HTTP outbox, which degrades
 * to that same inline call. The fallback is driven twice — no `messaging`
 * service at all, and a real `MessagingService` with no outbox wired — because
 * those are the two compositions that take it.
 */
const INLINE_ARMS: Array<{ arm: string; durable: boolean; messaging: () => unknown }> = [
    { arm: 'inline (default)', durable: false, messaging: () => undefined },
    { arm: 'durable, no messaging service', durable: true, messaging: () => undefined },
    {
        arm: 'durable, messaging with no HTTP outbox',
        durable: true,
        messaging: () => new MessagingService({ logger: silentLogger() }),
    },
];

describe.each(INLINE_ARMS)('http node signing — $arm arm', ({ durable, messaging }) => {
    const base = () => ({ url: `${baseUrl}/hook`, ...(durable ? { durable: true } : {}) });

    it('signs a JSON body: the receiver verifies the signature over the bytes it received', async () => {
        const result = await run(engineWith(messaging()), {
            ...base(),
            method: 'POST',
            headers: { 'X-Control': 'kept' },
            signingSecret: SECRET,
            body: { order: 42, lines: ['a', 'b'] },
        });

        expect(result.success).toBe(true);
        const req = only();
        expect(req.headers['x-control']).toBe('kept');
        expect(JSON.parse(req.body)).toEqual({ order: 42, lines: ['a', 'b'] });
        expectVerifies(req, SECRET);
    });

    it('signs the exact serialization it sends — a string body goes out JSON-encoded, and that is what is signed', async () => {
        const result = await run(engineWith(messaging()), {
            ...base(),
            method: 'POST',
            signingSecret: SECRET,
            body: 'hello',
        });

        expect(result.success).toBe(true);
        const req = only();
        // The inline arm's own serialization (`JSON.stringify`), which is NOT
        // the outbox's `deliveryBody` (that one sends a string verbatim). Each
        // arm signs what it sends; the receiver only ever sees the bytes.
        expect(req.body).toBe('"hello"');
        expectVerifies(req, SECRET);
    });

    it('signs a GET with no body over the empty body the receiver sees', async () => {
        const result = await run(engineWith(messaging()), { ...base(), method: 'GET', signingSecret: SECRET });

        expect(result.success).toBe(true);
        const req = only();
        expect(req.method).toBe('GET');
        expect(req.body).toBe('');
        expect(req.headers[SIGNATURE_HEADER_LC]).toBe(EMPTY_BODY_SIGNATURE);
        expectVerifies(req, SECRET);
    });

    it('REFUSES, and sends nothing, for a secret written as a template — even with the variable bound', async () => {
        // [#19939] Until then the template resolved from the flow variable and
        // signed with it. `signingSecret` is read as written now: the token is
        // refused, never sent as the secret with its braces.
        const result = await run(
            engineWith(messaging()),
            { ...base(), method: 'POST', signingSecret: '{signing_key}', body: { a: 1 } },
            { signing_key: SECRET },
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('config.signingSecret');
        expect(result.error).toContain('a single-brace `{…}` token is not resolved here');
        expect(result.error).not.toContain(SECRET);
        expect(received).toHaveLength(0);
    });

    it('sends NO signature header when the node sets no signingSecret', async () => {
        const result = await run(engineWith(messaging()), { ...base(), method: 'POST', body: { a: 1 } });

        expect(result.success).toBe(true);
        expect(only().headers[SIGNATURE_HEADER_LC]).toBeUndefined();
    });

    it("sends NO signature header for an explicitly empty signingSecret: '' — the unsigned-on-purpose spelling", async () => {
        const result = await run(engineWith(messaging()), {
            ...base(),
            method: 'POST',
            signingSecret: '',
            body: { a: 1 },
        });

        expect(result.success).toBe(true);
        expect(only().headers[SIGNATURE_HEADER_LC]).toBeUndefined();
    });

    it('REFUSES, and sends nothing, for a templated secret whose variable is unbound or empty', async () => {
        // The 17.x "resolved to nothing" refusals: the token is refused before
        // any resolution is attempted, so a secret never leaves unsigned.
        for (const params of [undefined, { signing_key: '' }]) {
            const result = await run(
                engineWith(messaging()),
                { ...base(), method: 'POST', signingSecret: '{signing_key}', body: { a: 1 } },
                params,
            );
            expect(result.success, JSON.stringify(params)).toBe(false);
            expect(result.error).toContain('config.signingSecret');
        }
        expect(received).toHaveLength(0);
    });

    it('signs with a literal secret that carries braces in no token position — read as written', async () => {
        // CONTROL: a literal secret is used byte for byte (only a `{…}` token is refused).
        const literal = 'pre}fix-{';
        const result = await run(engineWith(messaging()), { ...base(), method: 'POST', signingSecret: literal, body: { a: 1 } });

        expect(result.success).toBe(true);
        expectVerifies(only(), literal);
    });
});

/**
 * The durable arm with the outbox wired — the arm that already signed. It is
 * driven end to end (real `MessagingService` + `MemoryHttpOutbox` +
 * `HttpDispatcher` on the global `fetch`) so the same receiver check covers
 * both arms: one secret, one header, one verification, whichever arm ran.
 */
describe('http node signing — durable arm with the outbox wired', () => {
    function outboxStack() {
        const outbox = new MemoryHttpOutbox();
        const messaging = new MessagingService({ logger: silentLogger() });
        messaging.setHttpOutbox(outbox);
        const dispatcher = new HttpDispatcher({
            nodeId: 'node-signing-test',
            outbox,
            partitionCount: 1,
            intervalMs: 10_000, // ticked by hand
            logger: silentLogger(),
        });
        return { outbox, dispatcher, engine: engineWith(messaging) };
    }

    it('delivers a signature the receiver verifies over the bytes it received', async () => {
        const { dispatcher, engine } = outboxStack();
        const result = await run(engine, { url: `${baseUrl}/hook`, durable: true, signingSecret: SECRET, body: { a: 1 } });
        expect(result.success).toBe(true);

        await dispatcher.tick();
        expectVerifies(only(), SECRET);
    });

    it("delivers NO signature for signingSecret: ''", async () => {
        const { dispatcher, engine } = outboxStack();
        const result = await run(engine, { url: `${baseUrl}/hook`, durable: true, signingSecret: '', body: { a: 1 } });
        expect(result.success).toBe(true);

        await dispatcher.tick();
        expect(only().headers[SIGNATURE_HEADER_LC]).toBeUndefined();
    });

    it('REFUSES, and enqueues nothing, for a secret written as a template', async () => {
        const { outbox, dispatcher, engine } = outboxStack();
        const result = await run(engine, {
            url: `${baseUrl}/hook`,
            durable: true,
            signingSecret: '{signing_key}',
            body: { a: 1 },
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('signingSecret');
        expect(await outbox.list()).toHaveLength(0);
        await dispatcher.tick();
        expect(received).toHaveLength(0);
    });
});

/**
 * A durable node that authors no `method` sends ONE verb, whether or not an
 * outbox is wired. The descriptor says "Default GET; POST when durable is
 * true", and the outbox enqueues POST; the no-outbox fallback used to resolve
 * its own default (`GET`), so the same flow sent POST in one environment and a
 * bodyless GET — counted as a read, `acted: 0` — in another.
 *
 * The outbox arm is the reference: it is driven end to end and its request, as
 * the receiver got it, is what every fallback must reproduce byte for byte —
 * the verb, the body and the signature over it.
 */
describe('http node verb — durable with no method sends what the outbox sends, on every arm', () => {
    const config = () => ({
        url: `${baseUrl}/hook`,
        durable: true,
        signingSecret: SECRET,
        body: { order: 42, lines: ['a', 'b'] },
    });

    /** The request the outbox delivers for {@link config}, as the receiver got it. */
    async function outboxReference(): Promise<Received> {
        const outbox = new MemoryHttpOutbox();
        const messaging = new MessagingService({ logger: silentLogger() });
        messaging.setHttpOutbox(outbox);
        const dispatcher = new HttpDispatcher({
            nodeId: 'node-verb-test',
            outbox,
            partitionCount: 1,
            intervalMs: 10_000, // ticked by hand
            logger: silentLogger(),
        });
        const result = await run(engineWith(messaging), config());
        expect(result.success).toBe(true);
        await dispatcher.tick();
        const req = only();
        received.length = 0;
        return req;
    }

    function expectSameRequest(req: Received, reference: Received): void {
        expect(reference.method).toBe('POST');
        expect(req.method).toBe(reference.method);
        expect(req.body).toBe(reference.body);
        expect(req.headers[SIGNATURE_HEADER_LC]).toBe(reference.headers[SIGNATURE_HEADER_LC]);
        expectVerifies(req, SECRET);
    }

    it.each([
        { arm: 'no messaging service', messaging: () => undefined },
        { arm: 'messaging with no HTTP outbox', messaging: () => new MessagingService({ logger: silentLogger() }) },
    ])('awaited fallback ($arm): POSTs the signed bytes the outbox sends, and counts the accepted POST as an act', async ({ messaging }) => {
        const reference = await outboxReference();

        const result = await run(engineWith(messaging()), config());

        expect(result.success).toBe(true);
        expectSameRequest(only(), reference);
        // A POST the receiver accepted is one effect, not a read's measured zero.
        expect(result.summary).toMatchObject({ acted: 1, unmeasured: 0 });
    });

    it('background fallback on the save path: POSTs the signed bytes the outbox sends', async () => {
        const reference = await outboxReference();
        const engine = engineWith();
        engine.registerFlow('signed_callout', flow(config()));

        const result = await engine.execute('signed_callout', {
            event: 'afterUpdate',
            object: 'lead',
            record: { id: 'l1' },
        } as any);

        expect(result.success).toBe(true);
        await vi.waitFor(() => expect(received).toHaveLength(1));
        expectSameRequest(only(), reference);
    });

    it('awaited fallback with no body: still a POST, and counted as an act — never a read\'s measured zero', async () => {
        // Before the fix this arm sent a bodyless GET and reported `acted: 0`,
        // a run claiming it changed nothing. (With a body it did not send at
        // all: `fetch` refuses a GET that carries one.)
        const result = await run(engineWith(), { url: `${baseUrl}/hook`, durable: true });

        expect(result.success).toBe(true);
        expect(only().method).toBe('POST');
        expect(result.summary).toMatchObject({ acted: 1, unmeasured: 0 });
    });

    // The changeset names `method: 'GET'` as the opt-out: an authored verb is
    // sent as written on the fallback, never replaced by the durable default.
    it.each([
        { method: 'GET', body: undefined, sentBody: '', summary: { acted: 0, unmeasured: 0 } },
        { method: 'PUT', body: { a: 1 }, sentBody: '{"a":1}', summary: { acted: 1, unmeasured: 0 } },
    ])('awaited fallback with an authored method ($method): sends that verb, not the durable POST', async ({ method, body, sentBody, summary }) => {
        const result = await run(engineWith(), {
            url: `${baseUrl}/hook`, durable: true, method, ...(body ? { body } : {}),
        });

        expect(result.success).toBe(true);
        const req = only();
        expect(req.method).toBe(method);
        expect(req.body).toBe(sentBody);
        expect(result.summary).toMatchObject(summary);
    });

    it('CONTROL: a request/response node with no method still GETs, and counts it as a read', async () => {
        const result = await run(engineWith(), { url: `${baseUrl}/hook`, signingSecret: SECRET });

        expect(result.success).toBe(true);
        const req = only();
        expect(req.method).toBe('GET');
        expect(req.body).toBe('');
        expect(req.headers[SIGNATURE_HEADER_LC]).toBe(EMPTY_BODY_SIGNATURE);
        expect(result.summary).toMatchObject({ acted: 0, unmeasured: 0 });
    });
});

/**
 * One scheme, not two copies: the signer the node uses (`@objectstack/core`'s)
 * and the one `@objectstack/service-messaging` publishes to receivers are the
 * SAME binding, not two implementations that happen to agree today.
 */
describe('http signature scheme — one binding', () => {
    it("service-messaging's published signer and header are @objectstack/core's own", () => {
        expect(signHttpBody).toBe(coreSignHttpBody);
        expect(HTTP_SIGNATURE_HEADER).toBe(CORE_HTTP_SIGNATURE_HEADER);
        expect(HTTP_SIGNATURE_HEADER.toLowerCase()).toBe(SIGNATURE_HEADER_LC);
    });
});
