// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    createEgressGuard,
    EGRESS_REFUSED,
    EgressGuardUnprovenError,
    egressRefusalText,
    findEgressRefusal,
    installEgressGuard,
    type EgressResolver,
} from './guarded-fetch.js';
import { createEnvEgressPolicy, EgressAllowlistError } from './policy.js';

/**
 * The rule, on the wire: the guard judges the address the socket connects to
 * — a literal IP, every address a host name resolves to, and every redirect
 * hop — and a refused connect never reaches the receiver. Every assertion is
 * made by a REAL loopback receiver counting what arrived.
 */

/**
 * The runtime the guard runs in, switchable per test: `real` is undici's own
 * fetch; `ignore-dispatcher` is a runtime whose fetch drops the dispatcher and
 * sends on a plain connection (the probe's `.invalid` host fails as a lookup
 * would); `ignore-after-probe` honours it for the probe only.
 */
const transport = vi.hoisted(() => ({ mode: 'real' as 'real' | 'ignore-dispatcher' | 'ignore-after-probe', leaked: [] as string[] }));
vi.mock('undici', async (importOriginal) => {
    const actual = await importOriginal<typeof import('undici')>();
    return {
        ...actual,
        fetch: async (input: string, init: Record<string, unknown> = {}) => {
            const url = String(input);
            const probe = url.includes('.invalid');
            const bypass = transport.mode === 'ignore-dispatcher' || (transport.mode === 'ignore-after-probe' && !probe);
            if (!bypass) return actual.fetch(input, init as never);
            transport.leaked.push(url);
            if (probe) throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND') });
            const { dispatcher: _dropped, ...rest } = init;
            return actual.fetch(input, rest as never);
        },
    };
});

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

afterEach(() => {
    transport.mode = 'real';
    transport.leaked.length = 0;
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
    it('prints one boot line naming the guard and the allowlist size', async () => {
        const info = vi.fn();
        const policy = createEnvEgressPolicy({ allowedTargets: '127.0.0.1,hooks.internal' });
        await installEgressGuard({ policy, logger: { info, warn: vi.fn() } });
        await installEgressGuard({ policy, logger: { info, warn: vi.fn() } });
        expect(info).toHaveBeenCalledTimes(1);
        expect(String(info.mock.calls[0]![0])).toMatch(/^\[egress\] outbound guard active: .*2 allowlisted targets from OS_EGRESS_ALLOWED_TARGETS/);
    });

    it('a malformed allowlist refuses the boot', async () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '0.0.0.0/0');
        try {
            await expect(installEgressGuard({ logger: { info: vi.fn(), warn: vi.fn() } })).rejects.toThrow(EgressAllowlistError);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

describe('the judged addresses are dialled in turn', () => {
    it('a target whose first address refuses the connection is reached on its second', async () => {
        // Nothing listens on 127.0.0.2 at this port: the receiver is bound to 127.0.0.1 alone.
        const g = guard('127.0.0.0/8', { 'multi.example': ['127.0.0.2', '127.0.0.1'] });
        const res = await g.fetch(`http://multi.example:${port}/ok`, {}, ctx);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('body of /ok');
        expect(hits).toEqual([`multi.example:${port} /ok`]);
    });

    it('CONTROL: a target none of whose addresses accepts fails as a connect error, not a refusal', async () => {
        const g = guard('127.0.0.0/8', { 'dead.example': ['127.0.0.2', '127.0.0.3'] });
        const err = await g.fetch(`http://dead.example:${port}/ok`, {}, ctx).then(
            () => {
                throw new Error('the request was sent');
            },
            (e: unknown) => e,
        );
        expect(findEgressRefusal(err)).toBeUndefined();
        expect(hits).toEqual([]);
    });

    it('every address is judged before any is dialled: one refused address refuses the target', async () => {
        await refusal(guard('127.0.0.2', { 'multi.example': ['127.0.0.2', '127.0.0.1'] }).fetch(`http://multi.example:${port}/ok`, {}, ctx));
        expect(hits).toEqual([]);
    });
});

describe("the connected socket's own remote address is judged again", () => {
    it('a policy that allows the resolved address but refuses the connected socket stops the request', async () => {
        const seen: string[] = [];
        const g = createEgressGuard({
            policy: {
                canConnect: (target) => {
                    seen.push(target.address);
                    return seen.length === 1 ? { allow: true } : { allow: false, reason: 'refused at the socket' };
                },
            },
            resolve: resolver(),
        });
        const refused = await refusal(g.fetch(`http://hooks.example:${port}/x`, {}, ctx));
        expect(refused.decision.reason).toBe('refused at the socket');
        // Asked twice: once for the resolved address, once for the socket's remote address.
        expect(seen).toEqual(['127.0.0.1', '127.0.0.1']);
        expect(hits).toEqual([]);
    });

    it('CONTROL: a policy that allows both delivers, and was asked about the socket too', async () => {
        const seen: string[] = [];
        const g = createEgressGuard({
            policy: { canConnect: (target) => { seen.push(target.address); return { allow: true }; } },
            resolve: resolver(),
        });
        const res = await g.fetch(`http://hooks.example:${port}/x`, {}, ctx);
        expect(await res.text()).toBe('body of /x');
        expect(seen).toEqual(['127.0.0.1', '127.0.0.1']);
    });
});

describe('the shared default guard logs to the plugin that installed it', () => {
    it("each installer's refusals go to its own logger, not the first installer's", async () => {
        vi.stubEnv('OS_EGRESS_ALLOWED_TARGETS', '');
        try {
            const first = { info: vi.fn(), warn: vi.fn() };
            const second = { info: vi.fn(), warn: vi.fn() };
            await installEgressGuard({ logger: first });
            const g = await installEgressGuard({ logger: second });
            await refusal(g.fetch(`http://127.0.0.1:${port}/x`, {}, ctx));
            expect(second.warn).toHaveBeenCalledTimes(1);
            expect(String(second.warn.mock.calls[0]![0])).toMatch(/^\[egress\] refused an outbound connect to 127\.0\.0\.1/);
            expect(first.warn).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllEnvs();
        }
    });
});

describe('enforcement is proven in the runtime, never assumed', () => {
    const asking = () => {
        const asked: string[] = [];
        const policy = { canConnect: (t: { address: string }) => { asked.push(t.address); return { allow: true }; } };
        return { asked, policy };
    };

    it("where the runtime's fetch does not route through the guard's connector, the install refuses and every send is refused before anything leaves", async () => {
        transport.mode = 'ignore-dispatcher';
        const { asked, policy } = asking();
        const g = createEgressGuard({ policy, resolve: resolver() });
        await expect(g.ready()).rejects.toBeInstanceOf(EgressGuardUnprovenError);
        const refused = await refusal(g.fetch(`http://hooks.example:${port}/x`, {}, ctx));
        expect(refused.message).toBe(egressRefusalText('hooks.example'));
        expect(hits).toEqual([]);
        // Only the probe reached the runtime's fetch, and its host never resolves.
        expect(transport.leaked).toEqual(['http://egress-guard-probe.invalid/']);
        expect(asked).toEqual([]);
        await expect(installEgressGuard({ policy, logger: { info: vi.fn(), warn: vi.fn() } })).rejects.toBeInstanceOf(EgressGuardUnprovenError);
    });

    it('a response that arrives over a connection the policy never judged is refused, never handed back', async () => {
        transport.mode = 'ignore-after-probe';
        const { asked, policy } = asking();
        const g = createEgressGuard({ policy, resolve: resolver() });
        await g.ready();
        // A literal address, so the runtime's own plain connection reaches the receiver.
        const refused = await refusal(g.fetch(`http://127.0.0.1:${port}/x`, {}, ctx));
        expect(refused.decision.reason).toMatch(/never judged/);
        expect(asked).toEqual([]);
        expect(hits).toEqual([`127.0.0.1:${port} /x`]);
    });

    it('CONTROL: in this runtime the proof holds, and a send is judged before it leaves', async () => {
        const { asked, policy } = asking();
        const g = createEgressGuard({ policy, resolve: resolver() });
        await expect(g.ready()).resolves.toBeUndefined();
        const res = await g.fetch(`http://hooks.example:${port}/ok`, {}, ctx);
        expect(await res.text()).toBe('body of /ok');
        expect(asked).toEqual(['127.0.0.1', '127.0.0.1']);
        expect(transport.leaked).toEqual([]);
    });
});

describe('a policy that gives no verdict refuses', () => {
    it('no verdict at the second judgement ends the request as a named refusal, not a pending one', async () => {
        let calls = 0;
        const g = createEgressGuard({
            policy: { canConnect: () => (++calls === 1 ? { allow: true } : (undefined as never)) },
            resolve: resolver(),
        });
        const refused = await refusal(g.fetch(`http://hooks.example:${port}/x`, {}, ctx));
        expect(refused.decision.reason).toMatch(/no verdict/);
        expect(calls).toBe(2);
        expect(hits).toEqual([]);
    });
});

describe('a host name that does not resolve reads the same refusal as a non-public one', () => {
    const g = () =>
        createEgressGuard({
            policy: createEnvEgressPolicy({ allowedTargets: '' }),
            resolve: async (hostname) => {
                if (hostname === 'nowhere.example') throw Object.assign(new Error('getaddrinfo ENOTFOUND nowhere.example'), { code: 'ENOTFOUND' });
                if (hostname === 'empty.example') return [];
                return [{ address: '10.1.2.3' }];
            },
        });

    it('the text is the same; only the privileged reason and the retry mark differ', async () => {
        const unresolved = await refusal(g().fetch(`http://nowhere.example:${port}/x`, {}, ctx));
        const empty = await refusal(g().fetch(`http://empty.example:${port}/x`, {}, ctx));
        const refused = await refusal(g().fetch(`http://inside.example:${port}/x`, {}, ctx));
        expect(unresolved.message).toBe(egressRefusalText('nowhere.example'));
        expect(empty.message).toBe(egressRefusalText('empty.example'));
        expect(refused.message).toBe(egressRefusalText('inside.example'));
        expect([unresolved.unresolved, empty.unresolved, refused.unresolved]).toEqual([true, true, false]);
        expect(unresolved.decision.reason).toContain('did not resolve');
        expect(hits).toEqual([]);
    });
});
