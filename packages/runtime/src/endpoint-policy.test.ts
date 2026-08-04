// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The endpoint policy keys, one key at a time (#5040 E4 / #5091).
 *
 * Three keys, and for each of them the three cases that matter: declared and
 * hit, declared and not hit, and the boundary (`authRequired: false`, a budget
 * that is present but disarmed, `cacheTtl: 0`). A policy key that is only ever
 * tested in its "allow" direction is indistinguishable from a key nobody read.
 *
 * Everything is driven with stubs — a counter store, a principal resolver, a
 * clock. That is not a convenience: the module takes its dependencies
 * explicitly precisely so the decision can be tested without booting a kernel,
 * and so the bucket KEYS (the part a security review cares about) are
 * observable rather than inferred.
 */

import { describe, it, expect } from 'vitest';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import type { CounterStore } from '@objectstack/plugin-auth';

import {
    applyEndpointPolicies,
    computeCacheControl,
    createEndpointRateLimiterRegistry,
    endpointBucketKey,
    ENDPOINT_BUCKET_PREFIX,
    type EndpointPolicyContext,
    type EndpointPolicyVerdict,
} from './endpoint-policy.js';

/** A declared endpoint with defaults materialized, exactly as the matcher hands it over. */
function declare(overrides: Record<string, unknown> = {}): ApiEndpoint {
    return ApiEndpointSchema.parse({
        name: 'showcase_tasks',
        path: '/api/v1/apps/showcase/tasks',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
        ...overrides,
    });
}

/** An observable counter store — the bucket keyspace is the thing under test. */
function fakeCache() {
    const entries = new Map<string, unknown>();
    const store: CounterStore = {
        get: async <T,>(key: string) => entries.get(key) as T | undefined,
        set: async (key: string, value: unknown) => { entries.set(key, value); },
    };
    return { store, entries, keys: () => [...entries.keys()] };
}

interface Harness {
    context: EndpointPolicyContext;
    keys: () => string[];
    tick: (ms: number) => void;
}

function harness(options: { principalId?: string; remoteAddress?: string; headers?: Record<string, string> } = {}): Harness {
    const cache = fakeCache();
    let now = 1_700_000_000_000;
    const limiters = createEndpointRateLimiterRegistry({
        resolveCache: async () => cache.store,
        now: () => now,
    });
    return {
        context: {
            limiters,
            ...(options.headers ? { headers: options.headers } : {}),
            ...(options.remoteAddress ? { remoteAddress: options.remoteAddress } : {}),
            resolvePrincipalId: async () => options.principalId,
        },
        keys: cache.keys,
        tick: (ms: number) => { now += ms; },
    };
}

const run = (endpoint: ApiEndpoint, h: Harness, method = 'GET'): Promise<EndpointPolicyVerdict> =>
    applyEndpointPolicies({ ...h.context, endpoint, method });

// ─────────────────────────────────────────────────────────────────────────────
describe('authRequired — the default is the safe one, and it is materialized', () => {
    it('denies an anonymous caller with the platform 401, when the key is omitted', async () => {
        // Omitted in the source, `true` after parse: the executor never sees an
        // "unspecified" state, so forgetting the key cannot open an endpoint.
        const endpoint = declare();
        expect(endpoint.authRequired).toBe(true);

        const verdict = await run(endpoint, harness({}));
        expect(verdict.verdict).toBe('deny');
        if (verdict.verdict !== 'deny') return;
        expect(verdict.status).toBe(401);
        // The SAME 401 every other seam answers (#2567) — not a second dialect.
        expect(verdict.body.error.code).toBe('UNAUTHENTICATED');
        expect(verdict.body.error.message).toBe('Authentication is required to access this endpoint.');
        expect(verdict.body.error.httpStatus).toBe(401);
        expect(verdict.body.success).toBe(false);
    });

    it('lets an authenticated caller through, and reports who they are', async () => {
        const verdict = await run(declare({ authRequired: true }), harness({ principalId: 'usr_7' }));
        expect(verdict).toEqual({ verdict: 'pass', principalId: 'usr_7', responseHeaders: {} });
    });

    it('lets an anonymous caller through when the endpoint declares `authRequired: false`', async () => {
        const verdict = await run(declare({ authRequired: false }), harness({}));
        expect(verdict).toEqual({ verdict: 'pass', responseHeaders: {} });
    });

    it('treats an auth lookup that throws as anonymous — a hiccup is a 401, never an outage', async () => {
        const h = harness({});
        h.context.resolvePrincipalId = async () => { throw new Error('auth service down'); };
        const verdict = await run(declare(), h);
        expect(verdict.verdict).toBe('deny');
        if (verdict.verdict !== 'deny') return;
        expect(verdict.status).toBe(401);
    });

    it('never lets a declared path exempt itself through the control-plane allowlist', async () => {
        // `isAuthGateAllowlisted` treats any path containing an `/auth/` segment
        // as control plane. If the request path were passed to
        // `shouldDenyAnonymous`, an app could open its own endpoint by NAMING it
        // `.../auth/...` — an authoring-time bypass of the platform default
        // deny. The path is not passed; this pins that it stays that way.
        const endpoint = declare({ name: 'sneaky', path: '/api/v1/apps/showcase/auth/callback' });
        const verdict = await run(endpoint, harness({}));
        expect(verdict.verdict).toBe('deny');
        if (verdict.verdict !== 'deny') return;
        expect(verdict.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('rateLimit — #5006 primitives, an endpoint-scoped keyspace', () => {
    /** Two requests per second, so the boundary is reachable in a test. */
    const limited = (overrides: Record<string, unknown> = {}) => declare({
        authRequired: false,
        rateLimit: { enabled: true, windowMs: 1_000, maxRequests: 2 },
        ...overrides,
    });

    it('does nothing at all when the key is absent', async () => {
        const h = harness({ principalId: 'usr_7' });
        for (let i = 0; i < 20; i++) {
            expect((await run(declare(), h)).verdict).toBe('pass');
        }
        expect(h.keys(), 'an endpoint with no `rateLimit` touched the counter store').toEqual([]);
    });

    it('does nothing when the budget is present but not armed (`enabled` defaults to false)', async () => {
        // The schema default is `enabled: false`, so a block written without it
        // is a DISARMED budget. Honouring that literally is the declared =
        // enforced reading; #5111 carries the publish gate that stops an author
        // from writing one by accident.
        const endpoint = declare({ authRequired: false, rateLimit: { windowMs: 1_000, maxRequests: 1 } });
        expect(endpoint.rateLimit?.enabled).toBe(false);

        const h = harness({});
        for (let i = 0; i < 5; i++) expect((await run(endpoint, h)).verdict).toBe('pass');
        expect(h.keys()).toEqual([]);
    });

    it('admits up to the budget, then answers the 429 with a usable Retry-After', async () => {
        const h = harness({ principalId: 'usr_7' });
        const endpoint = limited();

        expect((await run(endpoint, h)).verdict).toBe('pass');   // 1st — at budget
        expect((await run(endpoint, h)).verdict).toBe('pass');   // 2nd — at budget
        const over = await run(endpoint, h);                     // 3rd — over

        expect(over.verdict).toBe('deny');
        if (over.verdict !== 'deny') return;
        expect(over.status).toBe(429);
        // Byte-identical to the server-level limiter's 429 (#5006): one 429 on
        // this wire surface, whichever budget produced it.
        expect(over.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(over.body.error.message).toBe('Rate limit exceeded. Retry after the interval in the Retry-After header.');
        expect(over.headers?.['Retry-After']).toBe('1');
        expect((over.body.error.details as { retryAfterSeconds: number }).retryAfterSeconds).toBe(1);
        expect(typeof (over.body.error.details as { resetAt: string }).resetAt).toBe('string');

        // And the budget really is a budget: it refills.
        h.tick(1_000);
        expect((await run(endpoint, h)).verdict).toBe('pass');
    });

    it('keys the bucket by endpoint × caller, under its own namespace', async () => {
        const h = harness({ principalId: 'usr_7' });
        await run(limited(), h);
        expect(h.keys()).toEqual([endpointBucketKey('showcase_tasks', 'principal:usr_7')]);
        expect(h.keys()[0]).toBe(`${ENDPOINT_BUCKET_PREFIX}showcase_tasks:principal:usr_7`);
        // NOT the bare `principal:usr_7` the server-level limiter counts in —
        // the two budgets are independent, and sharing a keyspace would make the
        // smaller one silently smaller still.
        expect(h.keys()).not.toContain('principal:usr_7');
    });

    it('gives two endpoints separate budgets', async () => {
        const h = harness({ principalId: 'usr_7' });
        const a = limited();
        const b = limited({ name: 'showcase_reports', path: '/api/v1/apps/showcase/reports' });

        expect((await run(a, h)).verdict).toBe('pass');
        expect((await run(a, h)).verdict).toBe('pass');
        expect((await run(a, h)).verdict).toBe('deny');
        // `b` is untouched by `a` exhausting itself.
        expect((await run(b, h)).verdict).toBe('pass');
        expect((await run(b, h)).verdict).toBe('pass');
        expect((await run(b, h)).verdict).toBe('deny');
        expect(h.keys().sort()).toEqual([
            endpointBucketKey('showcase_reports', 'principal:usr_7'),
            endpointBucketKey('showcase_tasks', 'principal:usr_7'),
        ]);
    });

    it('gives two callers separate budgets, and keys anonymous traffic by peer address', async () => {
        const endpoint = limited();
        const cache = fakeCache();
        let now = 1_700_000_000_000;
        const limiters = createEndpointRateLimiterRegistry({ resolveCache: async () => cache.store, now: () => now });
        const as = (ctx: Partial<EndpointPolicyContext>) =>
            applyEndpointPolicies({ limiters, ...ctx, endpoint, method: 'GET' });

        const alice = { resolvePrincipalId: async () => 'usr_alice' };
        const anon = { remoteAddress: '203.0.113.9' };

        expect((await as(alice)).verdict).toBe('pass');
        expect((await as(alice)).verdict).toBe('pass');
        expect((await as(alice)).verdict).toBe('deny');
        // A different session is not throttled by Alice's spending…
        expect((await as({ resolvePrincipalId: async () => 'usr_bob' })).verdict).toBe('pass');
        // …and neither is an anonymous caller, who keys by address.
        expect((await as(anon)).verdict).toBe('pass');
        expect(cache.keys()).toContain(endpointBucketKey('showcase_tasks', 'ip:203.0.113.9'));
    });

    it('never keys off a forwarded header unless `trustProxy` was declared', async () => {
        // Untrusted, `X-Forwarded-For` is attacker input: honouring it lets
        // anyone mint a fresh bucket per request. Q3=C, inherited whole from
        // `resolveRateLimitKey` rather than re-decided here.
        const endpoint = limited();
        const forged = { 'x-forwarded-for': '198.51.100.1' };

        const untrusted = harness({ headers: forged, remoteAddress: '203.0.113.9' });
        await run(endpoint, untrusted);
        expect(untrusted.keys()).toEqual([endpointBucketKey('showcase_tasks', 'ip:203.0.113.9')]);

        const trusted = harness({ headers: forged, remoteAddress: '203.0.113.9' });
        trusted.context.trustProxy = true;
        await run(endpoint, trusted);
        expect(trusted.keys()).toEqual([endpointBucketKey('showcase_tasks', 'ip:198.51.100.1')]);
    });

    it('meters BEFORE it gates, so a 401 storm still spends the budget (#5040 §3)', async () => {
        // The order that matters most and is easiest to get wrong: credential
        // stuffing is anonymous traffic against an `authRequired` endpoint. If
        // the 401 came first, none of it would ever reach the meter.
        const endpoint = limited({ authRequired: true });
        const h = harness({ remoteAddress: '203.0.113.9' });

        const first = await run(endpoint, h);
        expect(first.verdict).toBe('deny');
        if (first.verdict === 'deny') expect(first.status).toBe(401);
        expect(h.keys()).toEqual([endpointBucketKey('showcase_tasks', 'ip:203.0.113.9')]);

        await run(endpoint, h);
        const third = await run(endpoint, h);
        expect(third.verdict).toBe('deny');
        if (third.verdict !== 'deny') return;
        expect(third.status, 'the anonymous caller was never metered').toBe(429);
    });

    it('serves the request when the counter store itself is broken — bounded fail-open', async () => {
        const limiters = createEndpointRateLimiterRegistry({
            resolveCache: async () => ({
                get: async () => { throw new Error('cache backend down'); },
                set: async () => { throw new Error('cache backend down'); },
            }),
        });
        const verdict = await applyEndpointPolicies({
            limiters, endpoint: limited(), method: 'GET',
        });
        // Same trade #5006 makes: a cache outage is a louder problem than an
        // unmetered request, and it must not take the API down.
        expect(verdict.verdict).toBe('pass');
    });

    it('refuses to serve an armed budget it cannot honour, naming the endpoint', async () => {
        const h = harness({});
        const zeroBudget = declare({ authRequired: false, rateLimit: { enabled: true, maxRequests: 0 } });
        await expect(run(zeroBudget, h)).rejects.toThrow(/showcase_tasks/);
        // Fail CLOSED: the alternative is quietly serving traffic the author
        // asked to be metered. E7's publish gate is where this should be met.
        await expect(run(zeroBudget, h)).rejects.toThrow(/rateLimit/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cacheTtl — response-header semantics only', () => {
    it('says nothing when the key is absent', async () => {
        expect(computeCacheControl(declare(), 'GET')).toBeUndefined();
        const verdict = await run(declare({ authRequired: false }), harness({}));
        expect(verdict).toEqual({ verdict: 'pass', responseHeaders: {} });
    });

    it('sets `private, max-age=<ttl>` for a positive ttl', async () => {
        const verdict = await run(declare({ authRequired: false, cacheTtl: 30 }), harness({}));
        expect(verdict.verdict).toBe('pass');
        if (verdict.verdict !== 'pass') return;
        expect(verdict.responseHeaders).toEqual({ 'Cache-Control': 'private, max-age=30' });
    });

    it('is `private` even on an anonymous endpoint — a shared cache must never hold a per-caller answer', () => {
        expect(computeCacheControl({ name: 'e', cacheTtl: 60 }, 'GET')).toBe('private, max-age=60');
    });

    it('reads 0 as "do not cache" rather than as silence', async () => {
        // The boundary #5091 asks for. `cacheTtl: 0` is a sentence the author
        // wrote; answering it identically to an absent key would make writing it
        // a no-op, which is the failure mode this program exists to remove.
        expect(computeCacheControl({ name: 'e', cacheTtl: 0 }, 'GET')).toBe('no-store');
        const verdict = await run(declare({ authRequired: false, cacheTtl: 0 }), harness({}));
        expect(verdict.verdict).toBe('pass');
        if (verdict.verdict !== 'pass') return;
        expect(verdict.responseHeaders).toEqual({ 'Cache-Control': 'no-store' });
    });

    it('truncates a fractional ttl rather than emitting a fractional max-age', () => {
        expect(computeCacheControl({ name: 'e', cacheTtl: 30.7 }, 'GET')).toBe('private, max-age=30');
    });

    it('refuses to invent a meaning for a negative ttl', () => {
        expect(computeCacheControl({ name: 'e', cacheTtl: -5 }, 'GET')).toBe('no-store');
    });

    it('sends no header on a non-GET endpoint, and says so out loud', () => {
        const warnings: string[] = [];
        const header = computeCacheControl({ name: 'purge', cacheTtl: 30 }, 'POST', {
            warn: (m: string) => { warnings.push(m); },
        });
        expect(header).toBeUndefined();
        expect(warnings.join('\n')).toContain("endpoint 'purge'");
        expect(warnings.join('\n')).toContain('GET-only');
    });

    it('is not computed for a denied request', async () => {
        // Nothing to cache, nothing to say: the denial carries its own headers
        // (`Retry-After`) and no cache directive at all.
        const denied = await run(declare({ cacheTtl: 30 }), harness({}));
        expect(denied.verdict).toBe('deny');
        if (denied.verdict !== 'deny') return;
        expect(denied.headers).toBeUndefined();
        expect(JSON.stringify(denied.body)).not.toContain('max-age');
    });
});
