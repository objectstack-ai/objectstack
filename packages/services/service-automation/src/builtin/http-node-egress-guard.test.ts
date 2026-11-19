// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MessagingService, MemoryHttpOutbox, HttpDispatcher } from '@objectstack/service-messaging';
import { createEgressGuard, createEnvEgressPolicy, type EgressContext, type EgressGuard } from '@objectstack/core/egress';
import { AutomationEngine } from '../engine.js';
import { registerHttpNodes } from './http-nodes.js';

/**
 * The rule for the flow `http` node: a request it makes never reaches a
 * private, loopback, link-local or metadata address unless the operator
 * allowlists the target, and a metadata address never does — on the inline
 * arm, on every redirect hop, and on the durable arm through the outbox. A
 * refused call answers a named failure. A REAL loopback receiver counts what
 * arrived.
 */

let server: Server;
let port: number;
let hits: string[] = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        hits.push(`${req.headers.host} ${req.url}`);
        const m = /^\/redirect\?to=(.+)$/.exec(req.url ?? '');
        if (m) {
            res.writeHead(302, { location: decodeURIComponent(m[1]!) });
            res.end();
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"inside":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
    hits = [];
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** A guard whose every test host name resolves to the loopback receiver. */
function guardFor(allowedTargets: string): EgressGuard {
    return createEgressGuard({
        policy: createEnvEgressPolicy({ allowedTargets }),
        resolve: async () => [{ address: '127.0.0.1' }],
    });
}

function engineWith(options: { egress?: EgressGuard; messaging?: unknown } = {}): AutomationEngine {
    const engine = new AutomationEngine(silentLogger());
    registerHttpNodes(
        engine,
        { logger: silentLogger(), getService: (name: string) => (name === 'messaging' ? options.messaging : undefined) } as any,
        { egress: options.egress },
    );
    return engine;
}

async function run(engine: AutomationEngine, config: Record<string, unknown>, tenantId?: string) {
    engine.registerFlow('callout', {
        name: 'callout',
        label: 'Callout',
        type: 'autolaunched' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'call', type: 'http' as const, label: 'Call', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'call' },
            { id: 'e2', source: 'call', target: 'end' },
        ],
    } as any);
    return engine.execute('callout', tenantId ? ({ tenantId } as any) : undefined) as Promise<{ success: boolean; error?: string }>;
}

describe('the inline arm refuses a non-public target with a named failure', () => {
    it('a loopback target is refused, EGRESS_REFUSED, nothing received', async () => {
        const result = await run(engineWith(), { url: `http://127.0.0.1:${port}/x` });
        expect(result.success).toBe(false);
        expect(result.error).toContain('EGRESS_REFUSED: the request to 127.0.0.1 was not sent');
        expect(hits).toEqual([]);
    });

    it('a metadata target is refused', async () => {
        const result = await run(engineWith(), { url: 'http://169.254.169.254/latest/meta-data/' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('EGRESS_REFUSED');
    });

    it('a metadata target is refused even when the allowlist covers its range', async () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '100.64.0.0/10');
        const result = await run(engineWith(), { url: 'http://100.100.100.200/latest/meta-data/' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('EGRESS_REFUSED');
    });

    it('a host name resolving to a private address is refused', async () => {
        const result = await run(engineWith({ egress: guardFor('') }), { url: `http://hooks.example:${port}/x` });
        expect(result.error).toContain('EGRESS_REFUSED: the request to hooks.example was not sent');
        expect(hits).toEqual([]);
    });

    it('a redirect to a private address is refused at that hop', async () => {
        const to = encodeURIComponent(`http://127.0.0.1:${port}/inside`);
        const result = await run(engineWith({ egress: guardFor('hooks.example') }), {
            url: `http://hooks.example:${port}/redirect?to=${to}`,
        });
        expect(result.error).toContain('EGRESS_REFUSED: the request to 127.0.0.1 was not sent');
        expect(hits).toEqual([`hooks.example:${port} /redirect?to=${to}`]);
    });

    it('the guard is asked with the run\'s organization and the flow-http source', async () => {
        const seen: EgressContext[] = [];
        const egress = createEgressGuard({
            policy: { canConnect: (_t, ctx) => { seen.push(ctx); return { allow: false }; } },
        });
        await run(engineWith({ egress }), { url: `http://127.0.0.1:${port}/x` }, 'org_9');
        expect(seen).toEqual([{ source: 'flow-http', organizationId: 'org_9' }]);
    });
});

describe('CONTROL: an allowed target answers, and a redirect between allowed targets is followed', () => {
    it('an allowlisted loopback target (OS_EGRESS_ALLOWED_TARGETS) answers and the run reads the response', async () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '127.0.0.1');
        const result = await run(engineWith(), { url: `http://127.0.0.1:${port}/x` });
        expect(result.success).toBe(true);
        expect(hits).toEqual([`127.0.0.1:${port} /x`]);
    });

    it('a redirect to another allowed target is followed', async () => {
        const to = encodeURIComponent(`http://second.example:${port}/landed`);
        const result = await run(engineWith({ egress: guardFor('hooks.example,second.example') }), {
            url: `http://hooks.example:${port}/redirect?to=${to}`,
        });
        expect(result.success).toBe(true);
        expect(hits).toEqual([`hooks.example:${port} /redirect?to=${to}`, `second.example:${port} /landed`]);
    });
});

describe('the durable arm refuses through the outbox', () => {
    function outboxStack() {
        const outbox = new MemoryHttpOutbox();
        const messaging = new MessagingService({ logger: silentLogger() });
        messaging.setHttpOutbox(outbox);
        const dispatcher = new HttpDispatcher({ nodeId: 'egress-test', outbox, partitionCount: 1, intervalMs: 10_000, logger: silentLogger() });
        return { outbox, dispatcher, engine: engineWith({ messaging }) };
    }

    it('a durable callout to a loopback target dead-letters with EGRESS_REFUSED, nothing received', async () => {
        const { outbox, dispatcher, engine } = outboxStack();
        const result = await run(engine, { url: `http://127.0.0.1:${port}/hook`, durable: true, body: { a: 1 } });
        expect(result.success).toBe(true);
        await dispatcher.tick();
        const [row] = await outbox.list();
        expect(row!.status).toBe('dead');
        expect(row!.attempts).toBe(1);
        expect(row!.error?.startsWith('EGRESS_REFUSED')).toBe(true);
        expect(hits).toEqual([]);
    });

    it('CONTROL: an allowlisted durable callout delivers', async () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '127.0.0.1');
        const { outbox, dispatcher, engine } = outboxStack();
        await run(engine, { url: `http://127.0.0.1:${port}/hook`, durable: true, body: { a: 1 } });
        await dispatcher.tick();
        const [row] = await outbox.list();
        expect(row!.status).toBe('success');
        expect(hits).toHaveLength(1);
    });
});
