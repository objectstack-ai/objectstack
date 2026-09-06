// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16026] The `/auth` domain claims `/auth` and its slash-separated
 * sub-paths — and NOT every path that merely STARTS WITH the five characters
 * `/auth`.
 *
 * ## The defect this pins
 *
 * `createAuthDomain` returned `{ prefix: '/auth', handler }` with no `match`,
 * and `DomainRoute.match` defaults to `'prefix'` — a bare
 * `path.startsWith('/auth')`. `DomainHandlerRegistry` preserved that rough
 * edge on purpose when the domains were lifted out of the legacy if-chain
 * ("`match: 'prefix'` on `/i18n` also matches `/i18nxx`, exactly as
 * `startsWith` did"), so on this prefix the claim reached SIBLING NAMESPACES.
 *
 * Measured on a real boot before the fix — a real `ObjectKernel` with
 * `AuthPlugin` (a real `AuthManager` over better-auth), `createHonoApp({
 * kernel, prefix: '/api/v1' })`, authenticated as the dev admin, requests
 * injected through the returned app:
 *
 *     GET /api/v1/auth                 -> 200 {}                 claimed
 *     GET /api/v1/auth/                -> 200 {}                 claimed
 *     GET /api/v1/authx                -> 200 {}                 claimed  <- defect
 *     GET /api/v1/authx/foo            -> 200 {}                 claimed  <- defect
 *     GET /api/v1/authentication/foo   -> 200 {}                 claimed  <- defect
 *     GET /api/v1/aut/foo              -> 404 ROUTE_NOT_FOUND    control
 *     GET /api/v1/zzz/foo              -> 404 ROUTE_NOT_FOUND    control
 *
 * `/authentication/foo` is not an auth path by any reading, and `/authx` is a
 * plausible namespace someone mounts later.
 *
 * ## ⭐ Why the CLAIMED rows are cases here and not background
 *
 * A pin that only asserted the three defect rows cannot fail in the direction
 * that matters most: a repair which stopped claiming `/auth` ALTOGETHER would
 * pass every one of them, and would break the surface this card is forbidden
 * to touch. `/auth/me/permissions` and `/auth/me/localization` are not
 * better-auth endpoints, so the adapter's `/auth/*` mount disclaims them and
 * they reach `dispatch()` here (#4088 — objectui's permission layer reads the
 * former). So the claimed rows are the OVERSHOOT control and carry the same
 * weight as the defect rows.
 *
 * The observation that separates the two classes is the auth service's
 * `handleRequest` spy: this domain forwards to it and does nothing else, so
 * "called" means the domain claimed the path and "not called" means the path
 * fell through the registry to the dispatcher's terminal `ROUTE_NOT_FOUND`.
 * `/aut/foo` and `/zzz/foo` are the card's own clean rows, carried so a run
 * where EVERYTHING 404s is distinguishable from the fix.
 *
 * ## ⛔ Not covered here
 *
 * The `200 {}` those rows carried. It is manufactured one layer out, in the
 * `@objectstack/hono` adapter's dispatcher-result rendering — the auth service
 * answers an honest 404 for every row above, and this domain hands that
 * `Response` back untouched (`HttpDispatcherResult.result`, whose declared
 * contract is "direct response objects (Response/NextResponse)"). Nothing in
 * this file asserts a wire status for a claimed path, because at this layer
 * there is not one.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

/** Paths the `/auth` domain must NOT claim — the defect rows. */
const SIBLING_NAMESPACES = ['/authx', '/authx/foo', '/authentication/foo'];

/** The card's own clean rows: never claimed, before or after. */
const CLEAN_CONTROLS = ['/aut/foo', '/zzz/foo'];

/**
 * Paths the `/auth` domain MUST keep claiming. The last two are the #4088
 * boundary the card and its triage both underline.
 */
const STILL_CLAIMED = ['/auth', '/auth/me/permissions', '/auth/me/localization'];

/** better-auth's answer for a path its router does not route: bodyless 404. */
const unrouted404 = () => new Response(null, { status: 404 });

function makeFixture() {
    const handleRequest = vi.fn(async () => unrouted404());
    const services: Record<string, any> = {
        objectql: {
            find: vi.fn().mockResolvedValue([]),
            getObjects: vi.fn().mockReturnValue({}),
            registry: {
                getObject: vi.fn().mockReturnValue(null),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
            },
        },
        // Deliberately WITHOUT `isAuthGateActive`: the ADR-0069 gate is not
        // what these cases are about, and an auth service that does not
        // implement it is the shape the gate itself skips on.
        auth: { handleRequest },
    };
    const kernel: any = {
        getState: () => 'running',
        getService: (name: string) => services[name] ?? null,
        getServiceAsync: async (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    };
    const dispatcher = new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
    return { dispatcher, handleRequest };
}

const dispatchGet = async (path: string) => {
    const { dispatcher, handleRequest } = makeFixture();
    const result = await dispatcher.dispatch('GET', path, undefined, {}, { request: new Request(`http://localhost${path}`) } as any);
    return { result, handleRequest };
};

describe('#16026: the /auth claim stops at a segment boundary', () => {
    describe('sibling namespaces are NOT claimed — they fall through to ROUTE_NOT_FOUND', () => {
        for (const path of SIBLING_NAMESPACES) {
            it(`${path} is refused with the ROUTE_NOT_FOUND envelope and never reaches the auth service`, async () => {
                const { result, handleRequest } = await dispatchGet(path);

                // The domain did not claim it — the observation that would
                // have gone the other way before the fix.
                expect(handleRequest).not.toHaveBeenCalled();

                // Refusal asserts the ENVELOPE (code + status), never a bare
                // "it did not succeed": an unrelated 404 from any other layer
                // would otherwise read as this fix working.
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(404);
                expect(result.response?.body?.error?.code).toBe('ROUTE_NOT_FOUND');
                expect(result.response?.body?.error?.httpStatus).toBe(404);
                expect(result.response?.body?.error?.route).toBe(path);
                expect(result.response?.body?.success).toBe(false);
            });
        }
    });

    describe("the card's clean rows are unchanged — the harness can tell the classes apart", () => {
        for (const path of CLEAN_CONTROLS) {
            it(`${path} still answers ROUTE_NOT_FOUND`, async () => {
                const { result, handleRequest } = await dispatchGet(path);
                expect(handleRequest).not.toHaveBeenCalled();
                expect(result.response?.status).toBe(404);
                expect(result.response?.body?.error?.code).toBe('ROUTE_NOT_FOUND');
            });
        }
    });

    describe('⭐ the fallthrough is NOT removed — /auth and its sub-paths still reach dispatch()', () => {
        for (const path of STILL_CLAIMED) {
            it(`${path} is still claimed and still forwarded to the auth service`, async () => {
                const { result, handleRequest } = await dispatchGet(path);

                expect(handleRequest).toHaveBeenCalledTimes(1);
                expect(result.handled).toBe(true);
                // Forwarded whole: the domain hands back the service's own
                // Response rather than an envelope of its own.
                expect(result.result).toBeInstanceOf(Response);
                expect((result.result as Response).status).toBe(404);
                // …and specifically NOT the dispatcher's terminal refusal.
                expect(result.response?.body?.error?.code).toBeUndefined();
            });
        }
    });

    it('a trailing slash is the same claim — dispatch() strips it before the registry sees it', async () => {
        const { result, handleRequest } = await dispatchGet('/auth/');
        expect(handleRequest).toHaveBeenCalledTimes(1);
        expect(result.result).toBeInstanceOf(Response);
        expect(result.response?.body?.error?.code).toBeUndefined();
    });
});
