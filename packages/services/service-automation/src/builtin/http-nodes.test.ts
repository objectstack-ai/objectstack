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
            engine.registerFlow('http_flow', httpFlow('http', { method: 'GET' }));
            const result = await engine.execute('http_flow');
            expect(result.success).toBe(false);
            expect(result.error).toContain('url');
        });

    });
});
