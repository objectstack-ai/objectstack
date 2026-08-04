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

import {
    APP_ENDPOINT_SEGMENT,
    appEndpointMountPrefix,
    isAppEndpointPath,
    runAppEndpointStep,
} from './api-endpoint-step.js';

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
});
