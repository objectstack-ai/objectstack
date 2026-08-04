// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The endpoint dispatch step in isolation (#5040 E3 / #5090).
 *
 * Every case here is about ONE question: when does this step answer, and when
 * does it write nothing so the transport's existing unmatched answer stands?
 * Getting that wrong in either direction is a live behavior change on a surface
 * that is supposed to be inert until the #5040 E7 flip.
 *
 * `matchEndpoint` is driven by a stub implementing the contract in
 * `@objectstack/spec/contracts` — deliberately, not by the real matcher: that
 * implementation is #5089, developed in parallel, and this seam must not depend
 * on its landing order (nor its absence be untested — probe-absent is the
 * passthrough case below).
 */

import { describe, it, expect } from 'vitest';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch } from '@objectstack/spec/contracts';
import type { CounterStore } from '@objectstack/plugin-auth';

import {
    APP_ENDPOINT_SEGMENT,
    appEndpointMountPrefix,
    isAppEndpointPath,
    runAppEndpointStep,
} from './api-endpoint-step.js';
import {
    createEndpointRateLimiterRegistry,
    endpointBucketKey,
    type EndpointPolicyContext,
} from './endpoint-policy.js';

/** A declared endpoint in the ADR-0121 D1 shape, defaults materialized. */
const TASKS: ApiEndpoint = ApiEndpointSchema.parse({
    name: 'showcase_tasks',
    path: '/api/v1/apps/showcase/tasks',
    method: 'GET',
    type: 'object_operation',
    target: 'showcase_task',
    objectParams: { object: 'showcase_task', operation: 'find' },
});

/** A metadata service that owns exactly the endpoints it is given. */
function matcherFor(endpoints: ApiEndpoint[]) {
    const calls: Array<{ path: string; method: string }> = [];
    return {
        calls,
        service: {
            matchEndpoint: async (query: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> => {
                calls.push(query);
                const hit = endpoints.find(
                    (e) => e.path === query.path.replace(/\/$/, '') && e.method === query.method.toUpperCase(),
                );
                return hit ? { endpoint: hit, params: {} } : undefined;
            },
        },
    };
}

const step = (path: string, method = 'GET', service?: unknown) =>
    runAppEndpointStep({ method, path, prefix: '/api/v1', metadataService: service as never });

describe('the mount prefix is spelled once (ADR-0121 D1)', () => {
    it('is `<prefix>/apps/`, trailing slash included', () => {
        expect(APP_ENDPOINT_SEGMENT).toBe('apps');
        expect(appEndpointMountPrefix('/api/v1')).toBe('/api/v1/apps/');
        expect(appEndpointMountPrefix('/api/v1/')).toBe('/api/v1/apps/');
        expect(appEndpointMountPrefix('/custom')).toBe('/custom/apps/');
    });

    it('scopes by segment, not by string prefix', () => {
        expect(isAppEndpointPath('/api/v1/apps/showcase/tasks', '/api/v1')).toBe(true);
        expect(isAppEndpointPath('/api/v1/apps/a', '/api/v1')).toBe(true);
        // The bare mount itself declares nothing — and `appsx` is a different
        // word, which a `startsWith('/api/v1/apps')` test would have missed.
        expect(isAppEndpointPath('/api/v1/apps/', '/api/v1')).toBe(false);
        expect(isAppEndpointPath('/api/v1/apps', '/api/v1')).toBe(false);
        expect(isAppEndpointPath('/api/v1/appsx/thing', '/api/v1')).toBe(false);
        expect(isAppEndpointPath('/api/v1/data/showcase_task', '/api/v1')).toBe(false);
        // A deployment on a non-default prefix scopes to ITS prefix only.
        expect(isAppEndpointPath('/api/v1/apps/showcase/tasks', '/custom')).toBe(false);
    });
});

describe('the step writes nothing unless a declaration owns the request', () => {
    it('never asks about a path outside the mount', async () => {
        const { service, calls } = matcherFor([TASKS]);
        expect(await step('/api/v1/data/showcase_task', 'GET', service)).toBeUndefined();
        expect(await step('/api/v1/health', 'GET', service)).toBeUndefined();
        expect(await step('/nope', 'GET', service)).toBeUndefined();
        expect(calls, 'the metadata service was consulted for a non-endpoint path').toEqual([]);
    });

    it('passes through when the kernel has no metadata service', async () => {
        expect(await step('/api/v1/apps/showcase/tasks', 'GET', undefined)).toBeUndefined();
    });

    it('passes through when the metadata service carries no matchEndpoint (#5089 not landed)', async () => {
        // The contract's own probe convention: an occupant of the slot with no
        // endpoint index simply omits the member. That must be a fully working
        // passthrough, not a crash and not a 501.
        const withoutMatcher = { get: async () => undefined, list: async () => [] };
        expect(await step('/api/v1/apps/showcase/tasks', 'GET', withoutMatcher)).toBeUndefined();
    });

    it('passes through on a miss', async () => {
        const { service, calls } = matcherFor([TASKS]);
        expect(await step('/api/v1/apps/showcase/unknown', 'GET', service)).toBeUndefined();
        // Method is part of the identity: the same path under another verb is a
        // different endpoint, and a miss.
        expect(await step('/api/v1/apps/showcase/tasks', 'DELETE', service)).toBeUndefined();
        expect(calls).toEqual([
            { path: '/api/v1/apps/showcase/unknown', method: 'GET' },
            { path: '/api/v1/apps/showcase/tasks', method: 'DELETE' },
        ]);
    });

    it('lets a matcher failure propagate — an outage must not read as a 404', async () => {
        const broken = { matchEndpoint: async () => { throw new Error('metadata store unreachable'); } };
        await expect(step('/api/v1/apps/showcase/tasks', 'GET', broken)).rejects.toThrow('metadata store unreachable');
    });
});

describe('a match answers 501 until the executor lands (#5040 E5)', () => {
    it('reports NOT_IMPLEMENTED in the declared error envelope', async () => {
        const { service } = matcherFor([TASKS]);
        const answer = await step('/api/v1/apps/showcase/tasks', 'GET', service);

        expect(answer?.status).toBe(501);
        const body = answer!.body as { success: boolean; error: Record<string, unknown> };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_IMPLEMENTED');
        expect(body.error.httpStatus).toBe(501);
        // Names the endpoint it matched and says plainly that nothing ran —
        // "matched but not executed" must never read as "executed and empty".
        expect(body.error.message).toContain('showcase_tasks');
        expect(body.error.message).toContain('not enabled');
        expect(String(body.error.hint)).toContain('#5040');
    });

    it('passes the request coordinates through untouched', async () => {
        const { service, calls } = matcherFor([TASKS]);
        await step('/api/v1/apps/showcase/tasks', 'GET', service);
        // No normalization here: `matchEndpoint`'s contract owns trailing-slash
        // trimming and case folding, and a second, weaker copy in the consumer
        // is how two spellings of "the same path" start to disagree.
        expect(calls).toEqual([{ path: '/api/v1/apps/showcase/tasks', method: 'GET' }]);
    });

    it('names the keys it did NOT evaluate when no policy context was threaded', async () => {
        // Truthfulness of the report is the point: this seam's whole job today
        // is telling an operator what did and did not happen.
        const { service } = matcherFor([TASKS]);
        const answer = await step('/api/v1/apps/showcase/tasks', 'GET', service);
        const hint = String((answer!.body as { error: { hint: unknown } }).error.hint);
        expect(hint).toContain('not evaluated');
        expect(hint).toContain('authRequired');
        expect(answer!.headers).toBeUndefined();
    });
});

/**
 * The policy chain, seen from the step (#5040 E4 / #5091).
 *
 * The module-level cases live in `endpoint-policy.test.ts`; what is asserted
 * here is the WIRING — that the chain runs between the match and the answer,
 * that a denial short-circuits (no 501, no execution slot reached), and that a
 * pass still ends in the 501 until E5 lands.
 */
describe('the policy chain runs between the match and the answer', () => {
    /** An endpoint that is open to anonymous callers unless a case says otherwise. */
    const OPEN: ApiEndpoint = ApiEndpointSchema.parse({
        ...TASKS, name: 'showcase_open', authRequired: false,
    });

    function policyContext(overrides: Partial<EndpointPolicyContext> = {}): EndpointPolicyContext {
        const entries = new Map<string, unknown>();
        const store: CounterStore = {
            get: async <T,>(key: string) => entries.get(key) as T | undefined,
            set: async (key: string, value: unknown) => { entries.set(key, value); },
        };
        return {
            limiters: createEndpointRateLimiterRegistry({ resolveCache: async () => store }),
            ...overrides,
        };
    }

    const policedStep = (endpoints: ApiEndpoint[], policy: EndpointPolicyContext, method = 'GET') =>
        runAppEndpointStep({
            method,
            path: endpoints[0]!.path,
            prefix: '/api/v1',
            metadataService: matcherFor(endpoints).service as never,
            policy,
        });

    it('answers 401 instead of 501 when the endpoint requires auth and the caller has none', async () => {
        const answer = await policedStep([TASKS], policyContext());
        expect(answer?.status).toBe(401);
        const body = answer!.body as { success: boolean; error: Record<string, unknown> };
        expect(body.error.code).toBe('UNAUTHENTICATED');
        // The 501 is NOT also emitted: a denial is the answer, not a stage.
        expect(JSON.stringify(body)).not.toContain('NOT_IMPLEMENTED');
    });

    it('answers 429 with the Retry-After header once the endpoint budget is spent', async () => {
        const limited = ApiEndpointSchema.parse({
            ...OPEN, name: 'showcase_limited', rateLimit: { enabled: true, windowMs: 1_000, maxRequests: 1 },
        });
        const policy = policyContext();

        expect((await policedStep([limited], policy))?.status).toBe(501);   // within budget
        const over = await policedStep([limited], policy);

        expect(over?.status).toBe(429);
        // The header rides on the ANSWER, so the transport writes it with the
        // body — a 429 whose Retry-After got lost tells a client nothing.
        expect(over?.headers).toEqual({ 'Retry-After': '1' });
        expect((over!.body as { error: { code: string } }).error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('reaches the 501 only after the chain passed, and says so', async () => {
        const answer = await policedStep([OPEN], policyContext());
        expect(answer?.status).toBe(501);
        const hint = String((answer!.body as { error: { hint: unknown } }).error.hint);
        expect(hint).toContain('enforced');
        expect(hint).toContain('#5040');
    });

    it('never puts the cacheTtl header on the 501 — but the verdict still carries it', async () => {
        // Exposure, not application: `Cache-Control` describes a successful body
        // that does not exist yet (execution is E5), and telling a client to
        // cache a 501 for 30s would be worse than saying nothing. The header
        // lives on the policy verdict, which is what the executor will read —
        // asserted directly in `endpoint-policy.test.ts`.
        const cached = ApiEndpointSchema.parse({ ...OPEN, name: 'showcase_cached', cacheTtl: 30 });
        const answer = await policedStep([cached], policyContext());
        expect(answer?.status).toBe(501);
        expect(answer?.headers).toBeUndefined();
    });

    it('resolves the caller once and keys the endpoint bucket with it', async () => {
        const seen: Array<Record<string, unknown>> = [];
        const entries = new Map<string, unknown>();
        const store: CounterStore = {
            get: async <T,>(k: string) => entries.get(k) as T | undefined,
            set: async (k: string, v: unknown) => { entries.set(k, v); },
        };
        const limited = ApiEndpointSchema.parse({
            ...TASKS, name: 'showcase_tasks', rateLimit: { enabled: true, windowMs: 1_000, maxRequests: 5 },
        });

        const answer = await policedStep([limited], {
            limiters: createEndpointRateLimiterRegistry({ resolveCache: async () => store }),
            headers: { cookie: 'session=abc' },
            remoteAddress: '203.0.113.9',
            resolvePrincipalId: async (headers) => { seen.push(headers); return 'usr_7'; },
        });

        // Authenticated, so the 401 gate passes and the bucket keys by principal
        // rather than by address — one lookup serving both.
        expect(answer?.status).toBe(501);
        expect(seen).toEqual([{ cookie: 'session=abc' }]);
        expect([...entries.keys()]).toEqual([endpointBucketKey('showcase_tasks', 'principal:usr_7')]);
    });
});
