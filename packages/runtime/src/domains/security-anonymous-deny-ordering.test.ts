// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7911 — the anonymous-deny gate is consulted BEFORE `/security`'s
 * capability answer, not after it.
 *
 * ## The defect
 *
 * `handleSecurityRequest` resolved the `security` service and returned a
 * capability answer — 503 "Security service not available" — for an empty or
 * non-duck-typing slot BEFORE it reached the `!ec || shouldDenyAnonymous(...)`
 * gate ~20 lines below. So on any deployment where the `security` slot is
 * empty or stubbed, an unauthenticated caller to
 * `/api/v1/security/suggested-bindings` got a 503 capability disclosure
 * instead of the 401 refusal this admin surface's own comment calls
 * UNCONDITIONAL (#2567, #3963). `/security` stands on the same anonymous-deny
 * floor as `/data`, `/meta`, `/actions` and `/automation` (ADR-0056 D2 →
 * #3963) — the sibling inversion on `/ai/**` was #7653, fixed in PR #7910;
 * this was the last of the six dispatcher domains still ordered the wrong way.
 *
 * ## What must NOT change, and why the authenticated half is pinned just as
 * hard
 *
 * A fix that 401s every caller unconditionally would satisfy Group A and
 * still be a regression: an AUTHENTICATED caller against an empty/stubbed
 * slot must still see the 503 "Security service not available" answer,
 * unchanged. That negative pin is what proves this is a hoist (WHEN the gate
 * decides) and not a deletion (WHAT it decides) — see `domains/security.ts`'s
 * `[#4127 batch 3]` comment on the `!ec` arm, preserved verbatim across the
 * move.
 *
 * No route-level `auth: false` opt-out exists on this domain (unlike `/ai`),
 * so there is exactly one consult site and no per-route loop to re-enter.
 */

import { describe, it, expect } from 'vitest';
import {
    ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';

import { handleSecurityRequest } from './security.js';
import { apiErrorResponse } from '../error-envelope.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

// ── contexts ────────────────────────────────────────────────────────────────
// Two anonymous shapes, both of which occur in the wild: `resolveExecutionContext`
// leaves `executionContext` UNDEFINED when identity resolution throws, and
// writes a `userId`-less record for a resolved-but-sessionless caller.
const anonUnresolved = () => ({ request: { headers: {} } }) as unknown as HttpProtocolContext;
const anonResolved = () => ({
    request: { headers: {} },
    executionContext: { isSystem: false, positions: [], permissions: [], systemPermissions: [] },
}) as unknown as HttpProtocolContext;
const authed = () => ({
    request: { headers: {} },
    executionContext: { userId: 'usr_1', isSystem: false, positions: [], permissions: [], systemPermissions: [] },
}) as unknown as HttpProtocolContext;
const system = () => ({
    request: { headers: {} },
    executionContext: { isSystem: true },
}) as unknown as HttpProtocolContext;

// ── deps ────────────────────────────────────────────────────────────────────

/**
 * `error` is the REAL envelope builder the dispatcher wires in
 * (`http-dispatcher.ts` → `apiErrorResponse`), not a stub that drops the third
 * argument. Without it `details.code` would never be promoted into
 * `error.code` and every `code` assertion below would be vacuous — the exact
 * way an ADR-0112 envelope test can pass while asserting nothing.
 */
function makeDeps(opts: {
    /** `undefined` → the slot is empty; a truthy value with no duck-typed
     * methods reproduces the "stubbed occupant" arm of the same `if`. */
    securityService?: any;
} = {}): DomainHandlerDeps {
    return {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) =>
            (name === 'security' ? opts.securityService : undefined)) as any,
        success: (data: any) => ({ status: 200, body: { success: true, data } }),
        error: (message: string, httpStatus = 500, details?: any) =>
            apiErrorResponse({ message, httpStatus, details }),
        errorFromThrown: (e: any, fallbackStatus = 500) =>
            apiErrorResponse({ message: e?.message ?? 'Unexpected error', httpStatus: e?.status ?? e?.statusCode ?? fallbackStatus }),
    } as unknown as DomainHandlerDeps;
}

function dispatch(deps: DomainHandlerDeps, context: HttpProtocolContext, path: string, method = 'GET') {
    return handleSecurityRequest(deps, path, method, {}, {}, context);
}

/** Assert the ADR-0112 refusal envelope: status AND code, never one alone. */
function expectAnonymousDenied(result: any) {
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(result.response.status).toBe(401);
    expect(result.response.body.success).toBe(false);
    expect(result.response.body.error.code).toBe(ANONYMOUS_DENY_CODE);
    expect(result.response.body.error.code).toBe('UNAUTHENTICATED');
    expect(result.response.body.error.httpStatus).toBe(401);
    expect(result.response.body.error.message).toBe(ANONYMOUS_DENY_MESSAGE);
}

// ── Group A: the defect ─────────────────────────────────────────────────────

describe('#7911 A — an empty/stubbed security slot still denies anonymous callers first', () => {
    it('GET /security/suggested-bindings, empty slot → 401, not the 503 capability answer', async () => {
        const result: any = await dispatch(makeDeps(), anonUnresolved(), '/suggested-bindings');
        expectAnonymousDenied(result);
        expect(result.response.status).not.toBe(503);
        expect(JSON.stringify(result.response.body)).not.toContain('Security service not available');
    });

    it('GET /security/suggested-bindings, stubbed occupant (no duck-typed methods) → 401', async () => {
        // A truthy occupant with none of the contract's methods takes the same
        // `!service || typeof … !== 'function'` exit an empty slot takes.
        const result: any = await dispatch(makeDeps({ securityService: {} }), anonUnresolved(), '/suggested-bindings');
        expectAnonymousDenied(result);
    });

    it('denies the resolved-but-sessionless anonymous shape identically', async () => {
        expectAnonymousDenied(await dispatch(makeDeps(), anonResolved(), '/suggested-bindings'));
    });

    it('covers the write routes too, not just the list', async () => {
        const cases: Array<[string, string]> = [
            ['/suggested-bindings/sug_1/confirm', 'POST'],
            ['/suggested-bindings/sug_1/dismiss', 'POST'],
        ];
        for (const [path, method] of cases) {
            expectAnonymousDenied(await dispatch(makeDeps(), anonUnresolved(), path, method));
        }
    });
});

// ── Group B: the honest degradation — LOAD-BEARING, must stay green ─────────

describe('#7911 B — the 503 capability answer is untouched for an authenticated caller', () => {
    it('still 503s an empty slot for an authenticated caller', async () => {
        const result: any = await dispatch(makeDeps(), authed(), '/suggested-bindings');
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(503);
        expect(result.response.body.error.message).toBe('Security service not available');
    });

    it('still 503s a stubbed (non-duck-typing) occupant for an authenticated caller', async () => {
        const result: any = await dispatch(makeDeps({ securityService: {} }), authed(), '/suggested-bindings');
        expect(result.response.status).toBe(503);
        expect(result.response.body.error.message).toBe('Security service not available');
    });

    it('lets an internal SYSTEM context through to the same 503 degradation', async () => {
        // `isSystem` is never settable from the wire; a host dispatching
        // internally must not be caught by a caller-facing gate.
        const result: any = await dispatch(makeDeps(), system(), '/suggested-bindings');
        expect(result.response.status).toBe(503);
        expect(result.response.body.error.message).toBe('Security service not available');
    });
});

// ── Group C: the control — hoisted, not made blanket or left inert ──────────

describe('#7911 C — a serveable service still works for an authenticated caller and still denies anonymous', () => {
    const suggestions = [{ id: 'sug_1', status: 'pending' }];
    const served = {
        listAudienceBindingSuggestions: async () => suggestions,
        confirmAudienceBindingSuggestion: async (_ec: any, id: string) => ({ id, status: 'confirmed' }),
        dismissAudienceBindingSuggestion: async (_ec: any, id: string) => ({ id, status: 'dismissed' }),
    };

    it('still denies anonymous even with a fully serveable service', async () => {
        const deps = makeDeps({ securityService: served });
        expectAnonymousDenied(await dispatch(deps, anonUnresolved(), '/suggested-bindings'));
    });

    it('serves an authenticated caller the list', async () => {
        const deps = makeDeps({ securityService: served });
        const result: any = await dispatch(deps, authed(), '/suggested-bindings');
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(200);
        expect(result.response.body).toEqual({ success: true, data: suggestions });
    });

    it('serves an authenticated confirm/dismiss', async () => {
        const deps = makeDeps({ securityService: served });
        const confirm: any = await dispatch(deps, authed(), '/suggested-bindings/sug_1/confirm', 'POST');
        expect(confirm.response.status).toBe(200);
        expect(confirm.response.body.data).toEqual({ id: 'sug_1', status: 'confirmed' });

        const dismiss: any = await dispatch(deps, authed(), '/suggested-bindings/sug_1/dismiss', 'POST');
        expect(dismiss.response.status).toBe(200);
        expect(dismiss.response.body.data).toEqual({ id: 'sug_1', status: 'dismissed' });
    });
});
