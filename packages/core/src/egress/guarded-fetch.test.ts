// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createEgressGuard, EGRESS_REFUSED, findEgressRefusal, installEgressGuard, type EgressResolver } from './guarded-fetch.js';
import { createEnvEgressPolicy, EgressAllowlistError } from './policy.js';

/**
 * The rule, on the wire: the guard judges the address the socket connects to
 * — a literal IP, every address a host name resolves to, and every redirect
 * hop — and a refused connect never reaches the receiver. Every assertion is
 * made by a REAL loopback receiver counting what arrived.
 */

let server: Server;
let port: number;
const hits: string[] = [];

beforeAll(async () => {
    server = createServer((req, res) => {
        hits.push(`${req.headers.host} ${req.url}`);
        const m = /^\/redirect\?to=(.+)$/.exec(req.url ?? '');
        if (m) {
            res.writeHead(302, { location: decodeURIComponent(m[1]!) });
            res.end();
            return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`body of ${req.url}`);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
    hits.length = 0;
});

/** Every test host name resolves to the loopback receiver unless named otherwise. */
const resolver = (table: Record<string, string[]> = {}): EgressResolver => async (hostname) =>
    (table[hostname] ?? ['127.0.0.1']).map((address) => ({ address }));

function guard(allowedTargets = '', table?: Record<string, string[]>) {
    return createEgressGuard({ policy: createEnvEgressPolicy({ allowedTargets }), resolve: resolver(table) });
}

const ctx = { source: 'webhook', organizationId: 'org_1' } as const;

async function refusal(promise: Promise<unknown>) {
    const err = await promise.then(
        () => {
            throw new Error('the request was sent');
        },
        (e: unknown) => e,
    );
    const refused = findEgressRefusal(err);
    expect(refused, `not an egress refusal: ${String(err)}`).toBeDefined();
    expect(refused!.code).toBe(EGRESS_REFUSED);
    return refused!;
}

describe('a refused connect never reaches the receiver', () => {
    it('a literal loopback IP is refused', async () => {
        await refusal(guard().fetch(`http://127.0.0.1:${port}/x`, {}, ctx));
        expect(hits).toEqual([]);
    });

    it('a literal IPv4-mapped loopback IP is refused', async () => {
        await refusal(guard().fetch(`http://[::ffff:127.0.0.1]:${port}/x`, {}, ctx));
        expect(hits).toEqual([]);
    });

    it('a host name resolving to a private address is refused', async () => {
        const refused = await refusal(guard().fetch(`http://hooks.example:${port}/x`, {}, ctx));
        expect(refused.decision.denyClass).toBe('loopback');
        expect(hits).toEqual([]);
    });

    it('a host name with any private address among its answers is refused', async () => {
        await refusal(guard('', { 'mixed.example': ['93.184.215.14', '127.0.0.1'] }).fetch(`http://mixed.example:${port}/x`, {}, ctx));
        expect(hits).toEqual([]);
    });

    it('a redirect to a private address is refused at that hop', async () => {
        const to = encodeURIComponent(`http://127.0.0.1:${port}/inside`);
        await refusal(guard('hooks.example').fetch(`http://hooks.example:${port}/redirect?to=${to}`, {}, ctx));
        expect(hits).toEqual([`hooks.example:${port} /redirect?to=${to}`]);
    });

    it('a metadata address is refused even when its host name is allowlisted', async () => {
        const refused = await refusal(
            guard('meta.example', { 'meta.example': ['169.254.169.254'] }).fetch(`http://meta.example:${port}/latest`, {}, ctx),
        );
        expect(refused.decision.denyClass).toBe('link-local');
    });

    it("the refusal's message names the host and the rule, never the resolved address", async () => {
        const refused = await refusal(guard('', { 'hooks.example': ['10.9.8.7'] }).fetch(`http://hooks.example:${port}/x`, {}, ctx));
        expect(refused.message.startsWith(`${EGRESS_REFUSED}: the request to hooks.example was not sent`)).toBe(true);
        expect(refused.message).not.toContain('10.9.8.7');
        expect(refused.decision.reason).toContain('10.9.8.7');
    });

    it('a policy that throws refuses (fail-closed)', async () => {
        const g = createEgressGuard({
            policy: { canConnect: () => { throw new Error('boom'); } },
            resolve: resolver(),
        });
        await refusal(g.fetch(`http://hooks.example:${port}/x`, {}, ctx));
        expect(hits).toEqual([]);
    });

    it('the policy is asked with the organization and source of the request', async () => {
        const seen: unknown[] = [];
        const g = createEgressGuard({
            policy: { canConnect: (target, c) => { seen.push({ ...c, address: target.address }); return { allow: false }; } },
            resolve: resolver(),
        });
        await refusal(g.fetch(`http://hooks.example:${port}/x`, {}, { source: 'flow-http', organizationId: 'org_7' }));
        expect(seen).toEqual([{ source: 'flow-http', organizationId: 'org_7', address: '127.0.0.1' }]);
    });
});

describe('CONTROL: an allowed target delivers, and redirects between allowed targets are followed', () => {
    it('an allowlisted address delivers and the response is read', async () => {
        const res = await guard('127.0.0.1').fetch(`http://127.0.0.1:${port}/ok`, { method: 'POST', body: '{}' }, ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('body of /ok');
        expect(hits).toHaveLength(1);
    });

    it('an allowlisted host name delivers', async () => {
        const res = await guard('hooks.example').fetch(`http://hooks.example:${port}/ok`, {}, ctx);
        expect(await res.text()).toBe('body of /ok');
    });

    it('a redirect to another allowed target is followed to its body', async () => {
        const to = encodeURIComponent(`http://second.example:${port}/landed`);
        const res = await guard('hooks.example,second.example').fetch(`http://hooks.example:${port}/redirect?to=${to}`, {}, ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('body of /landed');
        expect(hits).toEqual([`hooks.example:${port} /redirect?to=${to}`, `second.example:${port} /landed`]);
    });

    it('a policy that allows public addresses lets them through (the stand-in public host)', async () => {
        const g = createEgressGuard({
            policy: { canConnect: () => ({ allow: true }) },
            resolve: resolver(),
        });
        const res = await g.fetch(`http://public.example:${port}/ok`, {}, ctx);
        expect(await res.text()).toBe('body of /ok');
    });
});

describe('judgeUrl answers without sending', () => {
    it('refuses a private target and allows an allowlisted one', async () => {
        expect((await guard().judgeUrl(`http://127.0.0.1:${port}/`, ctx)).allow).toBe(false);
        expect((await guard('127.0.0.1').judgeUrl(`http://127.0.0.1:${port}/`, ctx)).allow).toBe(true);
        expect(hits).toEqual([]);
    });
});

describe('the boot', () => {
    it('prints one boot line naming the guard and the allowlist size', () => {
        const info = vi.fn();
        const policy = createEnvEgressPolicy({ allowedTargets: '127.0.0.1,hooks.internal' });
        installEgressGuard({ policy, logger: { info, warn: vi.fn() } });
        installEgressGuard({ policy, logger: { info, warn: vi.fn() } });
        expect(info).toHaveBeenCalledTimes(1);
        expect(String(info.mock.calls[0]![0])).toMatch(/^\[egress\] outbound guard active: .*2 allowlisted targets from OS_EGRESS_ALLOWED_TARGETS/);
    });

    it('a malformed allowlist refuses the boot', () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '0.0.0.0/0');
        try {
            expect(() => installEgressGuard({ logger: { info: vi.fn(), warn: vi.fn() } })).toThrow(EgressAllowlistError);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
