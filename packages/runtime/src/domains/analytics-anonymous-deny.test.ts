// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21061 — the analytics dispatcher domain stands on the anonymous-deny floor
 * (ADR-0056 D2), and the floor is the handler's FIRST statement.
 *
 * ## What is pinned, per face
 *
 * `handleAnalyticsRequest` is the one handler body behind all three analytics
 * faces — the cube read, the SQL echo and the meta listing. For each face, an
 * anonymous caller (both shapes the dispatcher produces: an unresolved
 * context, and the guest envelope `assembleExecutionContextOrGuest` builds for
 * an unauthenticated request) is answered the dispatcher-wrapper
 * `401 UNAUTHENTICATED`, and:
 *
 *  - the analytics service is NEVER consulted — neither the slot lookup nor
 *    any method on the service. The gate decides before anything about the
 *    deployment is read;
 *  - a malformed body is STILL a 401, never the 400 the body validator would
 *    answer: an anonymous caller does not get to learn the body contract;
 *  - an empty slot is STILL a 401, never the `handled: false` 404: an
 *    anonymous caller does not get to learn whether the capability is there.
 *
 * ## What must NOT change, pinned just as hard
 *
 * A gate that refused everyone would satisfy every case above and still be a
 * regression, so the signed-in half is the control: a member is served by the
 * real service with THEIR execution context, a malformed member body still
 * gets the validator's 400, an empty slot still answers a member the 404, and
 * an internal SYSTEM context still passes. Those are what show the 401s are
 * the floor's answer and not a broken door.
 *
 * ⛔ The envelope builder is the REAL one the dispatcher wires in
 * (`apiErrorResponse`), so `error.code` is read where the wire carries it —
 * a stub that dropped the third argument would make every code assertion
 * here vacuous.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';

import { handleAnalyticsRequest } from './analytics.js';
import { apiErrorResponse } from '../error-envelope.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

// ── contexts ────────────────────────────────────────────────────────────────

const anonUnresolved = () => ({ request: { headers: {} } }) as unknown as HttpProtocolContext;
/** What the dispatcher builds for an unauthenticated request: a guest, no user id. */
const guestEnvelope = () => ({
    request: { headers: {} },
    executionContext: {
        isSystem: false, principalKind: 'guest', positions: ['guest'], permissions: [], systemPermissions: [],
    },
}) as unknown as HttpProtocolContext;
const MEMBER_EC = { userId: 'usr_member', isSystem: false, positions: [], permissions: [], systemPermissions: [] };
const member = () => ({ request: { headers: {} }, executionContext: { ...MEMBER_EC } }) as unknown as HttpProtocolContext;
const system = () => ({ request: { headers: {} }, executionContext: { isSystem: true } }) as unknown as HttpProtocolContext;

const ANONYMOUS_CONTEXTS: ReadonlyArray<readonly [string, () => HttpProtocolContext]> = [
    ['an unresolved context', anonUnresolved],
    ['the guest envelope', guestEnvelope],
];

// ── the three faces ─────────────────────────────────────────────────────────

const VALID_BODY = { cube: 'orders', measures: ['count'] };

interface Face {
    readonly face: string;
    readonly subPath: string;
    readonly method: string;
    readonly body?: unknown;
    readonly query?: Record<string, unknown>;
    /** Bodies the entry validator refuses with a 400 for a signed-in caller. */
    readonly malformed: readonly unknown[];
    /** The service method this face serves from. */
    readonly serves: 'query' | 'generateSql' | 'getMeta';
}

const FACES: readonly Face[] = [
    {
        face: 'the cube-read face', subPath: '/query', method: 'POST', body: VALID_BODY,
        malformed: [{ filters: { status: 'open' } }, { measures: 42 }], serves: 'query',
    },
    {
        face: 'the SQL face', subPath: '/sql', method: 'POST', body: VALID_BODY,
        malformed: [{ filters: { status: 'open' } }, { measures: 42 }], serves: 'generateSql',
    },
    {
        // A GET with no body; its only input is the optional cube filter, so the
        // "malformed" axis here is an input naming nothing that exists.
        face: 'the meta face', subPath: '/meta', method: 'GET', query: { cube: 'orders' },
        malformed: [], serves: 'getMeta',
    },
];

// ── deps ────────────────────────────────────────────────────────────────────

function makeService() {
    return {
        query: vi.fn(async () => ({ rows: [{ count: 3 }], fields: [] })),
        generateSql: vi.fn(async () => ({ sql: 'select 1', params: [] })),
        getMeta: vi.fn(async () => [{ name: 'orders' }]),
    };
}

function makeDeps(service: ReturnType<typeof makeService> | undefined) {
    const getService = vi.fn(async () => service);
    const resolveService = vi.fn(async () => service);
    const deps = {
        getService,
        resolveService,
        success: (data: any) => ({ status: 200, body: { success: true, data } }),
        error: (message: string, httpStatus = 500, details?: any) =>
            apiErrorResponse({ message, httpStatus, details }),
    } as unknown as DomainHandlerDeps;
    return { deps, getService, resolveService };
}

function call(deps: DomainHandlerDeps, face: Face, context: HttpProtocolContext, body: unknown = face.body) {
    return handleAnalyticsRequest(deps, face.subPath, face.method, body, context, face.query);
}

/** The ADR-0112 refusal envelope, dispatcher-wrapper family: status AND code, never one alone. */
function expectAnonymousDenied(result: any) {
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(result.response.status).toBe(401);
    expect(result.response.body.success).toBe(false);
    expect(result.response.body.error.code).toBe(ANONYMOUS_DENY_CODE);
    expect(result.response.body.error.code).toBe('UNAUTHENTICATED');
    expect(result.response.body.error.httpStatus).toBe(401);
    expect(result.response.body.error.message).toBe(ANONYMOUS_DENY_MESSAGE);
    expect(result.response.body.data).toBeUndefined();
}

function expectNeverConsulted(
    service: ReturnType<typeof makeService>,
    seams: { getService: ReturnType<typeof vi.fn>; resolveService: ReturnType<typeof vi.fn> },
) {
    expect(seams.getService).not.toHaveBeenCalled();
    expect(seams.resolveService).not.toHaveBeenCalled();
    expect(service.query).not.toHaveBeenCalled();
    expect(service.generateSql).not.toHaveBeenCalled();
    expect(service.getMeta).not.toHaveBeenCalled();
}

// ── A: the floor, per face ──────────────────────────────────────────────────

describe.each(FACES)('#21061 A — $face refuses an anonymous caller before anything else runs', (face) => {
    it.each(ANONYMOUS_CONTEXTS)('%s gets 401 UNAUTHENTICATED and the service is never consulted', async (_label, ctx) => {
        const service = makeService();
        const { deps, getService, resolveService } = makeDeps(service);
        expectAnonymousDenied(await call(deps, face, ctx()));
        expectNeverConsulted(service, { getService, resolveService });
    });

    it.each(ANONYMOUS_CONTEXTS)('%s with a malformed input still gets 401, never the validator\'s 400', async (_label, ctx) => {
        const inputs = face.malformed.length > 0 ? face.malformed : [face.body];
        for (const input of inputs) {
            const service = makeService();
            const { deps, getService, resolveService } = makeDeps(service);
            expectAnonymousDenied(await call(deps, face, ctx(), input));
            expectNeverConsulted(service, { getService, resolveService });
        }
    });

    it.each(ANONYMOUS_CONTEXTS)('%s against an empty slot still gets 401, never the capability 404', async (_label, ctx) => {
        const { deps, getService } = makeDeps(undefined);
        const result: any = await call(deps, face, ctx());
        expectAnonymousDenied(result);
        expect(getService).not.toHaveBeenCalled();
    });
});

// ── B: the signed-in control, per face ──────────────────────────────────────

describe.each(FACES)('#21061 B — $face still serves a signed-in caller exactly as before', (face) => {
    it('a member is served 200 by the service, with the member\'s own execution context', async () => {
        const service = makeService();
        const { deps, getService } = makeDeps(service);
        const result: any = await call(deps, face, member());
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(200);
        expect(result.response.body.success).toBe(true);
        expect(getService).toHaveBeenCalledTimes(1);
        expect(service[face.serves]).toHaveBeenCalledTimes(1);
        if (face.serves === 'getMeta') {
            expect(service.getMeta).toHaveBeenCalledWith('orders');
        } else {
            const [forwardedBody, forwardedContext] = (service[face.serves] as any).mock.calls[0];
            // The ORIGINAL body is forwarded untouched, and the scope carrier is
            // the caller's own context — the gate changed neither.
            expect(forwardedBody).toBe(face.body);
            expect(forwardedContext).toMatchObject(MEMBER_EC);
        }
    });

    it('an internal SYSTEM context passes the floor too', async () => {
        const service = makeService();
        const { deps } = makeDeps(service);
        const result: any = await call(deps, face, system());
        expect(result.response.status).toBe(200);
        expect(service[face.serves]).toHaveBeenCalledTimes(1);
    });

    it('an empty slot still answers a member the capability 404 (handled: false)', async () => {
        const { deps, getService } = makeDeps(undefined);
        const result: any = await call(deps, face, member());
        expect(result).toEqual({ handled: false });
        expect(getService).toHaveBeenCalledTimes(1);
    });
});

// The two body-carrying faces only: the meta face takes no body to validate.
describe.each(FACES.filter((f) => f.malformed.length > 0))('#21061 B — $face still validates a signed-in caller\'s body', (face) => {
    it('a malformed member input still reaches the validator\'s 400', async () => {
        for (const input of face.malformed) {
            const service = makeService();
            const { deps } = makeDeps(service);
            // The validator throws its duck-typed failure, which both dispatcher
            // error exits map to `400 VALIDATION_FAILED` — read through the SAME
            // recogniser they use, so this is the 400 class and not a 401.
            const thrown: any = await call(deps, face, member(), input).then(
                () => undefined,
                (e: unknown) => e,
            );
            expect(thrown, 'the entry validator must still run for a signed-in caller').toBeDefined();
            expect(validationFailureDetails(thrown)?.code).toBe('VALIDATION_FAILED');
            expect(VALIDATION_FAILED_STATUS).toBe(400);
            expect(service[face.serves]).not.toHaveBeenCalled();
        }
    });
});
