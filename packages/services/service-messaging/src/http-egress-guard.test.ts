// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createEgressGuard, createEnvEgressPolicy, EgressAllowlistError, type EgressContext } from '@objectstack/core/egress';
import { MemoryHttpOutbox } from './memory-http-outbox.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { MessagingServicePlugin } from './messaging-service-plugin.js';

/**
 * The rule for the outbound-HTTP outbox (webhook deliveries and durable flow
 * `http` callouts): a delivery aimed at a non-public address is never sent
 * unless the operator allowlists the target, a metadata address never is, and
 * a refused delivery dead-letters at once with a named reason instead of
 * walking the retry schedule. A REAL loopback receiver counts what arrived.
 */

let server: Server;
let base: string;
let hits = 0;

beforeAll(async () => {
    server = createServer((_req, res) => {
        hits++;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('received');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
    hits = 0;
});

afterEach(() => {
    vi.unstubAllEnvs();
});

async function deliverOnce(url: string, options: { egress?: ReturnType<typeof createEgressGuard>; organizationId?: string } = {}) {
    const outbox = new MemoryHttpOutbox();
    const id = await outbox.enqueue({
        source: 'webhook',
        refId: 'wh_1',
        dedupKey: 'evt_1',
        url,
        payload: { hello: 'world' },
        ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    });
    const dispatcher = new HttpDispatcher({ nodeId: 'n1', outbox, partitionCount: 1, egress: options.egress });
    await dispatcher.tick();
    const [row] = (await outbox.list()).filter((r) => r.id === id);
    return row!;
}

describe('a delivery to a non-public address is refused and dead-letters with a named reason', () => {
    it('a loopback target dead-letters on its first attempt, EGRESS_REFUSED, nothing received', async () => {
        const row = await deliverOnce(`${base}/hook`);
        expect(row.status).toBe('dead');
        expect(row.attempts).toBe(1);
        expect(row.nextRetryAt).toBeUndefined();
        expect(row.error?.startsWith('EGRESS_REFUSED: the request to 127.0.0.1 was not sent')).toBe(true);
        expect(hits).toBe(0);
    });

    it('a metadata target dead-letters the same way', async () => {
        const row = await deliverOnce('http://169.254.169.254/latest/meta-data/');
        expect(row.status).toBe('dead');
        expect(row.error?.startsWith('EGRESS_REFUSED')).toBe(true);
    });

    it('a metadata target is refused even when the allowlist covers its range', async () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '100.64.0.0/10');
        const row = await deliverOnce('http://100.100.100.200/latest/meta-data/');
        expect(row.status).toBe('dead');
        expect(row.error?.startsWith('EGRESS_REFUSED')).toBe(true);
    });

    it('the guard is asked with the delivery\'s own source and organization', async () => {
        const seen: EgressContext[] = [];
        const egress = createEgressGuard({
            policy: {
                canConnect: (_target, ctx) => {
                    seen.push(ctx);
                    return { allow: false };
                },
            },
        });
        const row = await deliverOnce(`${base}/hook`, { egress, organizationId: 'org_42' });
        expect(row.status).toBe('dead');
        expect(seen).toEqual([{ source: 'webhook', organizationId: 'org_42' }]);
        expect(hits).toBe(0);
    });
});

describe('CONTROL: an allowed target delivers', () => {
    it('an allowlisted loopback target (OS_EGRESS_ALLOWED_TARGETS) delivers and its response is recorded', async () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '127.0.0.1');
        const row = await deliverOnce(`${base}/hook`);
        expect(row.status).toBe('success');
        expect(row.responseBody).toBe('received');
        expect(hits).toBe(1);
    });

    it('a policy that opens the target delivers', async () => {
        const egress = createEgressGuard({ policy: { canConnect: () => ({ allow: true }) } });
        const row = await deliverOnce(`${base}/hook`, { egress });
        expect(row.status).toBe('success');
        expect(hits).toBe(1);
    });

    it('a transport failure that is not a refusal still walks the retry schedule', async () => {
        const egress = createEgressGuard({ policy: createEnvEgressPolicy({ allowedTargets: '127.0.0.1' }) });
        const closed = createServer();
        await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
        const port = (closed.address() as AddressInfo).port;
        await new Promise<void>((resolve) => closed.close(() => resolve()));
        const row = await deliverOnce(`http://127.0.0.1:${port}/gone`, { egress });
        expect(row.status).toBe('pending');
        expect(row.nextRetryAt).toBeTypeOf('number');
        expect(row.error?.startsWith('EGRESS_REFUSED')).toBe(false);
    });
});

describe('a host name that does not resolve reads as a refusal does, and stays retriable', () => {
    it('the recorded error is the refusal text a refused target records, and the delivery is retried', async () => {
        const egress = createEgressGuard({
            policy: createEnvEgressPolicy({ allowedTargets: '' }),
            resolve: async (hostname) => {
                if (hostname === 'nowhere.example') throw Object.assign(new Error('getaddrinfo ENOTFOUND nowhere.example'), { code: 'ENOTFOUND' });
                return [{ address: '10.1.2.3' }];
            },
        });
        const unresolved = await deliverOnce('http://nowhere.example/hook', { egress });
        const refused = await deliverOnce('http://inside.example/hook', { egress });
        expect(unresolved.error).toBe(refused.error!.replace('inside.example', 'nowhere.example'));
        expect(unresolved.status).toBe('pending');
        expect(unresolved.nextRetryAt).toBeTypeOf('number');
        expect(refused.status).toBe('dead');
        expect(hits).toBe(0);
    });
});

describe('the boot', () => {
    function ctx(info: (msg: string) => void) {
        const services = new Map<string, unknown>([['manifest', { register() {} }]]);
        const c = {
            logger: { info, warn: () => {}, error: () => {}, debug: () => {}, child: () => c.logger },
            registerService(name: string, svc: unknown) {
                services.set(name, svc);
            },
            getService<T>(name: string): T {
                return services.get(name) as T;
            },
        } as any;
        return c;
    }

    it('init prints the guard\'s boot line with the allowlist size', async () => {
        const lines: string[] = [];
        const policy = createEnvEgressPolicy({ allowedTargets: '127.0.0.1' });
        await new MessagingServicePlugin({ egressPolicy: policy, reliableDelivery: false }).init(ctx((m) => lines.push(m)));
        expect(lines.filter((l) => l.startsWith('[egress] outbound guard active'))).toHaveLength(1);
        expect(lines.find((l) => l.startsWith('[egress]'))).toContain('1 allowlisted target from OS_EGRESS_ALLOWED_TARGETS');
    });

    it('a malformed allowlist fails init', async () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', 'http://not-a-host/');
        await expect(new MessagingServicePlugin({ reliableDelivery: false }).init(ctx(() => {}))).rejects.toThrow(EgressAllowlistError);
    });
});
