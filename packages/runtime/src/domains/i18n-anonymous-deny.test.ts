// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22432 — the `/i18n` dispatcher domain stands on the anonymous-deny floor
 * (ADR-0056 D2), and the floor is the handler's FIRST statement.
 *
 * ## What is pinned, per face
 *
 * `handleI18nRequest` is the one handler body behind every `/i18n` face — the
 * locale list, the translation bundle and the field labels, each in both the
 * path and the query spelling the body accepts. For each face, an anonymous
 * caller (both shapes the dispatcher produces: an unresolved context, and the
 * guest envelope `assembleExecutionContextOrGuest` builds for an
 * unauthenticated request) is answered the dispatcher-wrapper
 * `401 UNAUTHENTICATED`, and:
 *
 *  - the i18n service is NEVER consulted — neither the slot lookup nor any
 *    method on the service. The gate decides before anything about the
 *    deployment is read, and nothing of the bundle is served;
 *  - a malformed input (no locale) is STILL a 401, never the 400 the route
 *    would answer: an anonymous caller does not get to learn what a route
 *    reads;
 *  - an empty slot is STILL a 401, never the 501 the domain answers when no
 *    provider is mounted: an anonymous caller does not get to learn whether
 *    the deployment carries one.
 *
 * ## What must NOT change, pinned just as hard
 *
 * A gate that refused everyone would satisfy every case above and still be a
 * regression, so the signed-in half is the control: a member is served by the
 * real handler body exactly as before (the locale list, the bundle, the
 * labels), a member's malformed input still gets the route's 400, an empty
 * slot still answers a member the 501, and an internal SYSTEM context still
 * passes. Those are what show the 401s are the floor's answer and not a
 * broken door. The CORS preflight (`OPTIONS`) stays outside the floor, as it
 * is on every door that shares the predicate.
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

import { handleI18nRequest } from './i18n.js';
import { apiErrorResponse } from '../error-envelope.js';
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

// ── the bundle the fake provider serves ─────────────────────────────────────

const BUNDLE = {
    objects: { lead: { label: 'Lead (fr)', fields: { company: { label: 'Société' } } } },
};

// ── the faces ───────────────────────────────────────────────────────────────

interface Face {
    readonly face: string;
    readonly subPath: string;
    readonly query?: Record<string, unknown>;
    /** The same face with its locale left out — the route's own 400 for a member. */
    readonly malformed?: { readonly subPath: string; readonly query?: Record<string, unknown> };
    /** What a signed-in caller is served in `data`. */
    readonly served: Record<string, unknown>;
    /** The service method the face reads from. */
    readonly reads: 'getLocales' | 'getTranslations';
}

const FACES: readonly Face[] = [
    {
        face: 'the locale list',
        subPath: '/locales',
        served: { locales: [{ code: 'en', label: 'en', isDefault: true }, { code: 'fr', label: 'fr', isDefault: false }] },
        reads: 'getLocales',
    },
    {
        face: 'the translation bundle (path spelling)',
        subPath: '/translations/fr',
        malformed: { subPath: '/translations' },
        served: { locale: 'fr', translations: BUNDLE },
        reads: 'getTranslations',
    },
    {
        face: 'the translation bundle (query spelling)',
        subPath: '/translations', query: { locale: 'fr' },
        malformed: { subPath: '/translations', query: {} },
        served: { locale: 'fr', translations: BUNDLE },
        reads: 'getTranslations',
    },
    {
        face: 'the field labels (path spelling)',
        subPath: '/labels/lead/fr',
        malformed: { subPath: '/labels/lead' },
        served: { object: 'lead', locale: 'fr', labels: { company: { label: 'Société' } } },
        reads: 'getTranslations',
    },
    {
        face: 'the field labels (query spelling)',
        subPath: '/labels/lead', query: { locale: 'fr' },
        malformed: { subPath: '/labels/lead', query: {} },
        served: { object: 'lead', locale: 'fr', labels: { company: { label: 'Société' } } },
        reads: 'getTranslations',
    },
];

// ── deps ────────────────────────────────────────────────────────────────────

function makeService() {
    return {
        getLocales: vi.fn(() => ['en', 'fr']),
        getDefaultLocale: vi.fn(() => 'en'),
        getTranslations: vi.fn((locale: string) => (locale === 'fr' ? BUNDLE : {})),
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

function call(
    deps: DomainHandlerDeps,
    input: { subPath: string; query?: Record<string, unknown> },
    context: HttpProtocolContext,
    method = 'GET',
) {
    return handleI18nRequest(deps, input.subPath, method, input.query ?? {}, context);
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
    // Nothing of the bundle is served: no `data`, and no bundle key anywhere in the body.
    expect(result.response.body.data).toBeUndefined();
    const wire = JSON.stringify(result.response.body);
    for (const leaked of ['translations', 'locales', 'labels', 'Société', 'Lead (fr)']) {
        expect(wire, `the refusal must not carry ${leaked}`).not.toContain(leaked);
    }
}

function expectNeverConsulted(
    service: ReturnType<typeof makeService>,
    seams: { getService: ReturnType<typeof vi.fn>; resolveService: ReturnType<typeof vi.fn> },
) {
    expect(seams.getService).not.toHaveBeenCalled();
    expect(seams.resolveService).not.toHaveBeenCalled();
    expect(service.getLocales).not.toHaveBeenCalled();
    expect(service.getDefaultLocale).not.toHaveBeenCalled();
    expect(service.getTranslations).not.toHaveBeenCalled();
}

// ── A: the floor, per face ──────────────────────────────────────────────────

describe.each(FACES)('#22432 A — $face refuses an anonymous caller before anything else runs', (face) => {
    it.each(ANONYMOUS_CONTEXTS)('%s gets 401 UNAUTHENTICATED and the service is never consulted', async (_label, ctx) => {
        const service = makeService();
        const { deps, getService, resolveService } = makeDeps(service);
        expectAnonymousDenied(await call(deps, face, ctx()));
        expectNeverConsulted(service, { getService, resolveService });
    });

    it.each(ANONYMOUS_CONTEXTS)('%s with the locale left out still gets 401, never the route\'s 400', async (_label, ctx) => {
        const service = makeService();
        const { deps, getService, resolveService } = makeDeps(service);
        expectAnonymousDenied(await call(deps, face.malformed ?? face, ctx()));
        expectNeverConsulted(service, { getService, resolveService });
    });

    it.each(ANONYMOUS_CONTEXTS)('%s against an empty slot still gets 401, never the provider 501', async (_label, ctx) => {
        const { deps, getService } = makeDeps(undefined);
        expectAnonymousDenied(await call(deps, face, ctx()));
        expect(getService).not.toHaveBeenCalled();
    });
});

describe('#22432 A — the floor is domain-wide, not per route', () => {
    it.each(ANONYMOUS_CONTEXTS)('%s gets 401 on a sub-path no route serves, and on a non-GET verb', async (_label, ctx) => {
        // A face added later converges on the same body, so it arrives behind
        // the floor: an unknown sub-path and a write verb are refused the same
        // way, before the route table is read.
        for (const [subPath, method] of [['/no-such-face', 'GET'], ['/translations/fr', 'POST']] as const) {
            const service = makeService();
            const { deps, getService, resolveService } = makeDeps(service);
            expectAnonymousDenied(await call(deps, { subPath }, ctx(), method));
            expectNeverConsulted(service, { getService, resolveService });
        }
    });

    it('a CORS preflight stays outside the floor, as on every door that shares the predicate', async () => {
        const service = makeService();
        const { deps } = makeDeps(service);
        // `OPTIONS` is not a route here, so the body answers `handled: false`
        // and the transport owns the preflight — the 401 would break CORS.
        expect(await call(deps, { subPath: '/locales' }, anonUnresolved(), 'OPTIONS')).toEqual({ handled: false });
    });
});

// ── B: the signed-in control, per face ──────────────────────────────────────

describe.each(FACES)('#22432 B — $face still serves a signed-in caller exactly as before', (face) => {
    it('a member is served 200 by the provider', async () => {
        const service = makeService();
        const { deps, getService } = makeDeps(service);
        const result: any = await call(deps, face, member());
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(200);
        expect(result.response.body).toEqual({ success: true, data: face.served });
        expect(getService).toHaveBeenCalledTimes(1);
        expect(service[face.reads]).toHaveBeenCalled();
    });

    it('an internal SYSTEM context passes the floor too', async () => {
        const service = makeService();
        const { deps } = makeDeps(service);
        const result: any = await call(deps, face, system());
        expect(result.response.status).toBe(200);
        expect(result.response.body.data).toEqual(face.served);
    });

    it('an empty slot still answers a member the provider 501', async () => {
        const { deps, getService } = makeDeps(undefined);
        const result: any = await call(deps, face, member());
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(501);
        expect(getService).toHaveBeenCalledTimes(1);
    });
});

describe.each(FACES.filter((f) => f.malformed))('#22432 B — $face still answers a member\'s missing locale with the route\'s 400', (face) => {
    it('a member who leaves the locale out gets 400, and the bundle is not read', async () => {
        const service = makeService();
        const { deps } = makeDeps(service);
        const result: any = await call(deps, face.malformed!, member());
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(400);
        expect(result.response.body.success).toBe(false);
        expect(service.getTranslations).not.toHaveBeenCalled();
    });
});
