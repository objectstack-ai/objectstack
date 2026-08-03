// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit coverage for the inbound rate-limit seam (#4910) — the derivation, the
 * key shape, the shared counter, and the 429 the middleware writes.
 *
 * The end-to-end proof (a declared budget producing a real 429 over a real
 * socket) lives in `../dispatcher-plugin.rate-limit.integration.test.ts`. Both
 * are needed and neither substitutes for the other: #4937 happened because a
 * bucket with excellent unit tests had no call site, and #4686 because a schema
 * with excellent parse tests had no reader.
 */

import { describe, it, expect, vi } from 'vitest';

import {
    createInboundRateLimitMiddleware,
    deriveBucketConfig,
    resolveRateLimitKey,
    SharedTokenBucketLimiter,
} from './inbound-rate-limit.js';
import type { CounterStore } from '@objectstack/plugin-auth';

/** An in-test counter store that also records whether it was ever consulted. */
function memoryStore() {
    const entries = new Map<string, unknown>();
    return {
        entries,
        store: {
            async get<T>(key: string) { return entries.get(key) as T | undefined; },
            async set<T>(key: string, value: T) { entries.set(key, value); },
        } satisfies CounterStore,
    };
}

describe('deriveBucketConfig — authored budget → token bucket', () => {
    it('maps maxRequests to capacity and derives the refill rate from the window', () => {
        expect(deriveBucketConfig({ enabled: true, maxRequests: 60, windowMs: 60_000 }))
            .toEqual({ capacity: 60, refillPerSec: 1 });
        expect(deriveBucketConfig({ enabled: true, maxRequests: 10, windowMs: 1_000 }))
            .toEqual({ capacity: 10, refillPerSec: 10 });
    });

    it('consumes every key the authoring surface exposes', () => {
        // Per-key liveness, asserted rather than asserted-about: `enabled` arms
        // it, and BOTH numeric keys move the derived bucket. A key that changed
        // nothing here would be a silent rider — the defect #4686 opened on.
        expect(deriveBucketConfig({ enabled: false, maxRequests: 60, windowMs: 60_000 })).toBeNull();
        expect(deriveBucketConfig(undefined)).toBeNull();

        const base = deriveBucketConfig({ enabled: true, maxRequests: 60, windowMs: 60_000 })!;
        expect(deriveBucketConfig({ enabled: true, maxRequests: 120, windowMs: 60_000 })!.capacity)
            .not.toBe(base.capacity);
        expect(deriveBucketConfig({ enabled: true, maxRequests: 60, windowMs: 30_000 })!.refillPerSec)
            .not.toBe(base.refillPerSec);
    });

    it('applies the schema defaults when only `enabled` reaches the runtime', () => {
        expect(deriveBucketConfig({ enabled: true })).toEqual({ capacity: 100, refillPerSec: 100 / 60 });
    });

    it('refuses a budget that can never admit a request, prescriptively', () => {
        expect(() => deriveBucketConfig({ enabled: true, maxRequests: 0 }))
            .toThrow(/set `enabled: false`/);
        expect(() => deriveBucketConfig({ enabled: true, windowMs: 0 }))
            .toThrow(/MILLISECONDS/);
    });
});

describe('resolveRateLimitKey — Q3=C, principal first, IP only as a fallback', () => {
    it('keys an authenticated caller by principal, ignoring their address entirely', () => {
        expect(resolveRateLimitKey({
            principalId: 'usr_1',
            remoteAddress: '10.0.0.5',
            headers: { 'x-forwarded-for': '9.9.9.9' },
            trustProxy: true,
        })).toEqual({ key: 'principal:usr_1', kind: 'principal' });
    });

    it('gives two principals behind ONE address two buckets', () => {
        const a = resolveRateLimitKey({ principalId: 'usr_a', remoteAddress: '10.0.0.5', trustProxy: false });
        const b = resolveRateLimitKey({ principalId: 'usr_b', remoteAddress: '10.0.0.5', trustProxy: false });
        expect(a.key).not.toBe(b.key);
    });

    it('falls back to the transport peer address for anonymous traffic', () => {
        expect(resolveRateLimitKey({ remoteAddress: '10.0.0.5', trustProxy: false }))
            .toEqual({ key: 'ip:10.0.0.5', kind: 'ip' });
    });

    it('IGNORES X-Forwarded-For when trustProxy was not declared', () => {
        // The security property this key exists to protect: an undeclared proxy
        // means the header is attacker input. Believing it would hand every
        // caller an unlimited supply of fresh buckets AND let them spend a
        // chosen victim's.
        expect(resolveRateLimitKey({
            remoteAddress: '10.0.0.5',
            headers: { 'x-forwarded-for': '203.0.113.9' },
            trustProxy: false,
        })).toEqual({ key: 'ip:10.0.0.5', kind: 'ip' });
    });

    it('honours X-Forwarded-For once trustProxy IS declared', () => {
        expect(resolveRateLimitKey({
            remoteAddress: '10.0.0.5',
            headers: { 'x-forwarded-for': '203.0.113.9' },
            trustProxy: true,
        })).toEqual({ key: 'ip:203.0.113.9', kind: 'ip' });
    });

    it('takes the LEFTMOST forwarded entry — the original client, not the last hop', () => {
        expect(resolveRateLimitKey({
            headers: { 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' },
            trustProxy: true,
        }).key).toBe('ip:203.0.113.9');
    });

    it('accepts X-Real-IP as the fallback forwarded header', () => {
        expect(resolveRateLimitKey({ headers: { 'x-real-ip': '198.51.100.7' }, trustProxy: true }).key)
            .toBe('ip:198.51.100.7');
    });

    it('over-throttles rather than failing open when nothing identifies the caller', () => {
        expect(resolveRateLimitKey({ trustProxy: false }))
            .toEqual({ key: 'ip:unknown', kind: 'unknown' });
    });
});

describe('SharedTokenBucketLimiter — counters live in the shared store (ADR-0069 D2)', () => {
    it('spends the bucket down and then denies with a real retry hint', async () => {
        const { store } = memoryStore();
        let clock = 1_000_000;
        const limiter = new SharedTokenBucketLimiter(
            { capacity: 2, refillPerSec: 1 },
            async () => store,
            () => clock,
        );

        expect((await limiter.consume('k')).allowed).toBe(true);
        expect((await limiter.consume('k')).allowed).toBe(true);

        const denied = await limiter.consume('k');
        expect(denied.allowed).toBe(false);
        expect(denied.retryAfterMs).toBe(1000);
        expect(denied.resetAt).toBe(clock + 1000);
    });

    it('refills over time, so a denied caller recovers without intervention', async () => {
        const { store } = memoryStore();
        let clock = 1_000_000;
        const limiter = new SharedTokenBucketLimiter({ capacity: 1, refillPerSec: 1 }, async () => store, () => clock);

        expect((await limiter.consume('k')).allowed).toBe(true);
        expect((await limiter.consume('k')).allowed).toBe(false);
        clock += 1000;
        expect((await limiter.consume('k')).allowed).toBe(true);
    });

    it('counts two nodes sharing a store against ONE budget', async () => {
        // The #4772 lesson, as an assertion: with a shared store the effective
        // limit is the declared limit; with per-process stores it silently
        // becomes `declared × nodes` and nothing looks wrong.
        const { store } = memoryStore();
        const clock = () => 1_000_000;
        const nodeA = new SharedTokenBucketLimiter({ capacity: 2, refillPerSec: 1 }, async () => store, clock);
        const nodeB = new SharedTokenBucketLimiter({ capacity: 2, refillPerSec: 1 }, async () => store, clock);

        expect((await nodeA.consume('principal:u')).allowed).toBe(true);
        expect((await nodeB.consume('principal:u')).allowed).toBe(true);
        expect((await nodeB.consume('principal:u')).allowed).toBe(false);
    });

    it('treats a foreign value under the key as absent instead of throwing on a live request', async () => {
        const { store, entries } = memoryStore();
        entries.set('k', 'not json');
        const limiter = new SharedTokenBucketLimiter({ capacity: 1, refillPerSec: 1 }, async () => store);
        expect((await limiter.consume('k')).allowed).toBe(true);
    });
});

/** A request/response pair shaped like the `IHttpServer` middleware contract. */
function fakeExchange(req: Record<string, unknown> = {}) {
    const captured: { status: number; headers: Record<string, string>; body?: unknown } = {
        status: 200,
        headers: {},
    };
    let nexted = false;
    const res: any = {
        status(code: number) { captured.status = code; return res; },
        header(name: string, value: string) { captured.headers[name] = value; return res; },
        json(data: unknown) { captured.body = data; },
        send(data: unknown) { captured.body = data; },
    };
    return {
        req: { method: 'GET', path: '/api/v1/health', headers: {}, query: {}, params: {}, ...req } as any,
        res,
        captured,
        next: async () => { nexted = true; },
        get nexted() { return nexted; },
    };
}

describe('createInboundRateLimitMiddleware', () => {
    it('registers NOTHING when the stack declared no budget', () => {
        expect(createInboundRateLimitMiddleware({ resolveCache: async () => undefined })).toBeNull();
        expect(createInboundRateLimitMiddleware({
            budget: { enabled: false, maxRequests: 1 },
            resolveCache: async () => undefined,
        })).toBeNull();
    });

    it('answers 429 with Retry-After once the bucket is empty', async () => {
        const { store } = memoryStore();
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: 1, windowMs: 10_000 },
            resolveCache: async () => store,
        })!;

        const first = fakeExchange({ remoteAddress: '10.0.0.1' });
        await middleware(first.req, first.res, first.next);
        expect(first.nexted).toBe(true);
        expect(first.captured.body).toBeUndefined();

        const second = fakeExchange({ remoteAddress: '10.0.0.1' });
        await middleware(second.req, second.res, second.next);
        expect(second.nexted).toBe(false);
        expect(second.captured.status).toBe(429);
        expect(Number(second.captured.headers['Retry-After'])).toBeGreaterThanOrEqual(1);

        const body = second.captured.body as { success: boolean; error: Record<string, unknown> };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(body.error.httpStatus).toBe(429);
    });

    it('meters an authenticated caller separately from an anonymous one on the same address', async () => {
        const { store } = memoryStore();
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: 1, windowMs: 10_000 },
            resolvePrincipalId: async (headers) => (headers['x-test-user'] as string | undefined),
            resolveCache: async () => store,
        })!;

        const anon = fakeExchange({ remoteAddress: '10.0.0.1' });
        await middleware(anon.req, anon.res, anon.next);
        expect(anon.nexted).toBe(true);

        // Same address, but a principal — its own bucket, so it is not already
        // spent by the anonymous request above.
        const authed = fakeExchange({ remoteAddress: '10.0.0.1', headers: { 'x-test-user': 'usr_1' } });
        await middleware(authed.req, authed.res, authed.next);
        expect(authed.nexted).toBe(true);

        const anonAgain = fakeExchange({ remoteAddress: '10.0.0.1' });
        await middleware(anonAgain.req, anonAgain.res, anonAgain.next);
        expect(anonAgain.captured.status).toBe(429);
    });

    it('never meters a CORS preflight', async () => {
        const { store, entries } = memoryStore();
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: 1, windowMs: 10_000 },
            resolveCache: async () => store,
        })!;

        for (let i = 0; i < 5; i++) {
            const exchange = fakeExchange({ method: 'OPTIONS', remoteAddress: '10.0.0.1' });
            await middleware(exchange.req, exchange.res, exchange.next);
            expect(exchange.nexted).toBe(true);
        }
        // Not merely allowed — never counted, so preflights cannot exhaust the
        // budget a real request needs.
        expect(entries.size).toBe(0);
    });

    it('treats an auth service that throws as anonymous, not as an outage', async () => {
        const { store } = memoryStore();
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: 5, windowMs: 10_000 },
            resolvePrincipalId: async () => { throw new Error('auth is down'); },
            resolveCache: async () => store,
        })!;

        const exchange = fakeExchange({ remoteAddress: '10.0.0.1' });
        await middleware(exchange.req, exchange.res, exchange.next);
        expect(exchange.nexted).toBe(true);
        await expect(store.get('ip:10.0.0.1')).resolves.toBeDefined();
    });
});

describe('degradation is announced once, with consequence and remedy (ADR-0069 D2)', () => {
    it('warns exactly once when there is no cache service to count in', async () => {
        const warn = vi.fn();
        const info = vi.fn();
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: 10, windowMs: 10_000 },
            resolveCache: async () => undefined,
            logger: { warn, info },
        })!;

        for (let i = 0; i < 3; i++) {
            const exchange = fakeExchange({ remoteAddress: '10.0.0.1' });
            await middleware(exchange.req, exchange.res, exchange.next);
        }

        expect(warn).toHaveBeenCalledTimes(1);
        const message = String(warn.mock.calls[0]![0]);
        // Names the subsystem that degraded (not `[auth]` — the resolution
        // helper is shared with plugin-auth and used to hardcode that prefix),
        // the consequence, and the remedy.
        expect(message).toMatch(/^\[dispatcher\]/);
        expect(message).toMatch(/inbound rate-limit buckets/);
        expect(message).toMatch(/MULTIPLIED BY the number of nodes/);
        expect(message).toMatch(/Redis via @objectstack\/service-cache/);
    });

    it('announces the healthy bind once instead of staying silent about it', async () => {
        const { store } = memoryStore();
        const info = vi.fn();
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: 10, windowMs: 10_000 },
            resolveCache: async () => store,
            logger: { info, warn: vi.fn() },
        })!;

        const exchange = fakeExchange({ remoteAddress: '10.0.0.1' });
        await middleware(exchange.req, exchange.res, exchange.next);
        await middleware(exchange.req, exchange.res, exchange.next);

        expect(info).toHaveBeenCalledTimes(1);
        expect(String(info.mock.calls[0]![0])).toMatch(/bound to the kernel cache service/);
    });

    it('resolves the cache LAZILY, so a cache plugin that registers later still counts (#4772)', async () => {
        const { store, entries } = memoryStore();
        let cacheAvailable = false;
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: 10, windowMs: 10_000 },
            resolveCache: async () => (cacheAvailable ? store : undefined),
            logger: { warn: vi.fn(), info: vi.fn() },
        })!;

        // Boot-time request: no cache yet, counted in the per-process fallback.
        const early = fakeExchange({ remoteAddress: '10.0.0.1' });
        await middleware(early.req, early.res, early.next);
        expect(entries.size).toBe(0);

        // The cache service comes up …
        cacheAvailable = true;
        const later = fakeExchange({ remoteAddress: '10.0.0.1' });
        await middleware(later.req, later.res, later.next);
        // … and the very next count lands in it, with no restart.
        await expect(store.get('ip:10.0.0.1')).resolves.toBeDefined();
    });

    it('warns once when the transport cannot identify anonymous callers at all', async () => {
        const { store } = memoryStore();
        const warn = vi.fn();
        const middleware = createInboundRateLimitMiddleware({
            budget: { enabled: true, maxRequests: 10, windowMs: 10_000 },
            resolveCache: async () => store,
            logger: { warn, info: vi.fn() },
        })!;

        for (let i = 0; i < 3; i++) {
            const exchange = fakeExchange({});
            await middleware(exchange.req, exchange.res, exchange.next);
        }

        const unknownWarnings = warn.mock.calls
            .map((c) => String(c[0]))
            .filter((m) => m.includes('cannot identify anonymous callers'));
        expect(unknownWarnings).toHaveLength(1);
        expect(unknownWarnings[0]).toMatch(/trustProxy/);
    });
});
