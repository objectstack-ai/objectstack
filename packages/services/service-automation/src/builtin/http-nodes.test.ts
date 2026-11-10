// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerHttpNodes } from './http-nodes.js';

function createTestLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        child: () => createTestLogger(),
    } as any;
}

interface HttpSurface {
    isHttpDeliveryReady?(): boolean;
    enqueueHttp?(input: any): Promise<string>;
}

function createCtx(messaging?: HttpSurface) {
    return {
        logger: createTestLogger(),
        getService(name: string) {
            if (name === 'messaging') return messaging;
            return undefined;
        },
    } as any;
}

function httpFlow(type: 'http', config: Record<string, unknown>) {
    return {
        name: 'http_flow',
        label: 'HTTP Flow',
        type: 'autolaunched' as const,
        variables: [
            { name: 'host', type: 'text' as const, isInput: true },
            { name: 'http.status', type: 'number' as const, isOutput: true },
        ],
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'http', type: type as any, label: 'HTTP', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'http' },
            { id: 'e2', source: 'http', target: 'end' },
        ],
    };
}

describe('http (canonical node)', () => {
    it('publishes a builtin io descriptor flagged needsOutbox', () => {
        const engine = new AutomationEngine(createTestLogger());
        registerHttpNodes(engine, createCtx());
        const d = engine.getActionDescriptor('http');
        expect(d?.source).toBe('builtin');
        expect(d?.category).toBe('io');
        expect(d?.needsOutbox).toBe(true);
        expect(d?.paradigms).toEqual(expect.arrayContaining(['flow', 'approval']));
    });

    // #20590 — the designer palette (`GET /api/v1/automation/actions`) serves
    // this configSchema as the node's authoring form. A credential typed into
    // `url` or `headers` is served with the flow definition, so both fields
    // name the route that keeps it out: a declarative connector's
    // `auth.credentialRef`, called through `connector_action` (for `url`, the
    // route for a query-string key; a path-borne secret has no `credentialRef`
    // variant and is sent to a token-authenticated connector instead). The
    // prose is free to change; the named route is what is held here.
    it.each(['url', 'headers'])('the %s field names the connector credentialRef route for a credential', (key) => {
        const engine = new AutomationEngine(createTestLogger());
        registerHttpNodes(engine, createCtx());
        const props = (engine.getActionDescriptor('http')?.configSchema as
            | { properties?: Record<string, { description?: string }> }
            | undefined)?.properties;
        const description = props?.[key]?.description ?? '';
        expect(description).toContain('auth.credentialRef');
        expect(description).toContain('connector_action');
    });

    it('does NOT register the removed http_request/http_call/webhook aliases (11.0)', () => {
        const engine = new AutomationEngine(createTestLogger());
        registerHttpNodes(engine, createCtx());
        for (const removed of ['http_request', 'http_call', 'webhook']) {
            expect(engine.getRegisteredNodeTypes()).not.toContain(removed);
            expect(engine.getActionDescriptor(removed)).toBeUndefined();
        }
    });

    describe('durable mode', () => {
        it('enqueues onto the messaging HTTP outbox and returns a deliveryId', async () => {
            const enqueued: any[] = [];
            const messaging: HttpSurface = {
                isHttpDeliveryReady: () => true,
                async enqueueHttp(input) {
                    enqueued.push(input);
                    return 'dlv_1';
                },
            };
            const engine = new AutomationEngine(createTestLogger());
            registerHttpNodes(engine, createCtx(messaging));
            engine.registerFlow(
                'http_flow',
                httpFlow('http', { url: 'https://example.test/hook', durable: true, body: { a: 1 } }),
            );

            const result = await engine.execute('http_flow');
            expect(result.success).toBe(true);
            expect(enqueued).toHaveLength(1);
            expect(enqueued[0]).toMatchObject({
                source: 'flow',
                url: 'https://example.test/hook',
                method: 'POST',
                payload: { a: 1 },
            });
        });

        it('degrades to an inline fetch when no HTTP outbox is wired', async () => {
            const fetchMock = vi.fn(async () => ({ ok: true, status: 200, async json() { return { ok: true }; }, async text() { return ''; } }));
            vi.stubGlobal('fetch', fetchMock);
            const messaging: HttpSurface = { isHttpDeliveryReady: () => false };
            const engine = new AutomationEngine(createTestLogger());
            registerHttpNodes(engine, createCtx(messaging));
            engine.registerFlow('http_flow', httpFlow('http', { url: 'https://x/y', durable: true }));

            const result = await engine.execute('http_flow');
            expect(result.success).toBe(true);
            expect(fetchMock).toHaveBeenCalledOnce();
        });

        // [#13546] The producer pin: `sys_http_delivery` rows must carry the
        // organization of the run that caused them, or they land in the
        // driver's `organization_id IS NULL` global-row arm — visible to and
        // replayable by every organization through redeliver() (#10740). The
        // organization is THREADED from the run's own acting context
        // (`AutomationContext.tenantId`) — the same source, and the same
        // no-fallback rule, as the notify node's #11303 repair.
        it("threads the run's acting organization onto the enqueue input (#13546)", async () => {
            const enqueued: any[] = [];
            const messaging: HttpSurface = {
                isHttpDeliveryReady: () => true,
                async enqueueHttp(input) {
                    enqueued.push(input);
                    return 'dlv_1';
                },
            };
            const engine = new AutomationEngine(createTestLogger());
            registerHttpNodes(engine, createCtx(messaging));
            engine.registerFlow(
                'http_flow',
                httpFlow('http', { url: 'https://example.test/hook', durable: true }),
            );

            const result = await engine.execute('http_flow', { tenantId: 'org_pin_alpha' } as any);

            expect(result.success).toBe(true);
            expect(enqueued).toHaveLength(1);
            // Verbatim — the acting tenant, not a derived or defaulted value.
            expect(enqueued[0].organizationId).toBe('org_pin_alpha');
        });

        it('with NO organization in scope: still enqueues, passes NO organizationId key, and says so out loud (#13546)', async () => {
            // The over-denial control (the notify suite's PIN C shape): a
            // `single`-posture install and a stack before its first
            // organization legitimately have no tenant to thread, and a
            // durable callout there must still enqueue — org-less, loudly,
            // never refused and never guessed.
            const warnings: string[] = [];
            const logger: any = {
                info: () => {}, error: () => {}, debug: () => {},
                warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); },
            };
            logger.child = () => logger;
            const enqueued: any[] = [];
            const messaging: HttpSurface = {
                isHttpDeliveryReady: () => true,
                async enqueueHttp(input) {
                    enqueued.push(input);
                    return 'dlv_1';
                },
            };
            const engine = new AutomationEngine(logger);
            registerHttpNodes(engine, {
                logger,
                getService: (name: string) => (name === 'messaging' ? messaging : undefined),
            } as any);
            engine.registerFlow(
                'http_flow',
                httpFlow('http', { url: 'https://example.test/hook', durable: true }),
            );

            const result = await engine.execute('http_flow');

            expect(result.success).toBe(true);
            expect(enqueued).toHaveLength(1);
            // Absent, not null and not '' — the outbox normalizes a missing
            // value to NULL exactly once, at its insert.
            expect('organizationId' in enqueued[0]).toBe(false);
            // Fail-LOUD: the org-less durable callout is a visible event.
            expect(warnings.some((w) => w.includes('organization_id = NULL'))).toBe(true);
        });
    });

    describe('request/response mode (default)', () => {
        let fetchMock: any;
        beforeEach(() => {
            fetchMock = vi.fn(async () => ({
                ok: true,
                status: 201,
                async json() { return { created: true }; },
                async text() { return ''; },
            }));
            vi.stubGlobal('fetch', fetchMock);
        });
        afterEach(() => vi.unstubAllGlobals());

        it('runs an inline fetch and returns response + status', async () => {
            const engine = new AutomationEngine(createTestLogger());
            registerHttpNodes(engine, createCtx());
            engine.registerFlow('http_flow', httpFlow('http', { url: 'https://api.test/items', method: 'POST', body: { n: 1 } }));

            const result = await engine.execute('http_flow');
            expect(result.success).toBe(true);
            expect(fetchMock).toHaveBeenCalledOnce();
            const [, init] = fetchMock.mock.calls[0];
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toEqual({ n: 1 });
        });

        it('fails the step when url is missing', async () => {
            const engine = new AutomationEngine(createTestLogger());
            registerHttpNodes(engine, createCtx());
            // #20316 — `url` is the key the http contract requires, so a node
            // without it is refused at registration now…
            expect(() => engine.registerFlow('http_flow', httpFlow('http', { method: 'GET' }))).toThrow(/leaves out `url`/);
            // …and the executor still refuses one that reaches it past the doors.
            const stored = engine.registerFlow('http_flow', httpFlow('http', { method: 'GET', url: 'https://example.invalid/x' }));
            delete (stored.nodes.find((n) => n.id === 'http')!.config as Record<string, unknown>).url;
            const result = await engine.execute('http_flow');
            expect(result.success).toBe(false);
            expect(result.error).toContain('url');
        });

    });
});

describe('http (canonical node) — a failed call names its host and cause', () => {
    // Real fetches against real failures: the cause shape is undici's, not a mock's.
    async function run(config: Record<string, unknown>) {
        const engine = new AutomationEngine(createTestLogger());
        registerHttpNodes(engine, createCtx());
        engine.registerFlow('http_flow', httpFlow('http', config));
        return engine.execute('http_flow');
    }

    it('an unknown host reports the host and the DNS cause, not a bare "fetch failed"', async () => {
        const result = await run({ url: 'http://no-such-host.invalid/path' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('http: fetch failed');
        expect(result.error).toContain('no-such-host.invalid');
        expect(result.error).toContain('ENOTFOUND');
    });

    it('a refused port reports the host:port and ECONNREFUSED', async () => {
        const { createServer } = await import('node:http');
        const server = createServer();
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as { port: number }).port;
        await new Promise<void>((r) => server.close(() => r()));
        const result = await run({ url: `http://127.0.0.1:${port}/x` });
        expect(result.success).toBe(false);
        expect(result.error).toContain(`127.0.0.1:${port}`);
        expect(result.error).toContain('ECONNREFUSED');
    });

    it('never names the path, query secret or userinfo of the url', async () => {
        // A query secret on a url that fails to connect.
        const q = await run({ url: 'http://no-such-host.invalid/hook/PATHSECRET?token=QUERYSECRET' });
        expect(q.error).toContain('no-such-host.invalid');
        expect(q.error).not.toContain('QUERYSECRET');
        expect(q.error).not.toContain('PATHSECRET');
        // Userinfo makes undici throw a TypeError that quotes the whole url.
        const u = await run({ url: 'https://user:USERPW@no-such-host.invalid/x?token=QUERYSECRET' });
        expect(u.success).toBe(false);
        expect(u.error).toContain('no-such-host.invalid');
        expect(u.error).not.toContain('USERPW');
        expect(u.error).not.toContain('QUERYSECRET');
    });

    it('a timeout still reads "timeout after Nms"', async () => {
        const { createServer } = await import('node:http');
        const server = createServer(() => { /* never answers */ });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as { port: number }).port;
        try {
            const result = await run({ url: `http://127.0.0.1:${port}/slow`, timeoutMs: 50 });
            expect(result.success).toBe(false);
            expect(result.error).toBe('http: timeout after 50ms');
        } finally {
            server.closeAllConnections?.();
            await new Promise<void>((r) => server.close(() => r()));
        }
    });

    it('a failure with no cause keeps its own message and the host', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
        try {
            const result = await run({ url: 'https://api.test/items' });
            expect(result.error).toBe('http: boom — api.test');
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
