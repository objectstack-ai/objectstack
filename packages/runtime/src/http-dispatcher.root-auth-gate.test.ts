// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17625, the runtime half of #7898's ruling A] The API root reaches the
 * discovery payload for a GATED session.
 *
 * ## What moved, and why this file exists at all
 *
 * `dispatch()` strips one trailing slash, so BOTH root spellings the
 * dispatcher accepts — `${prefix}/` (arriving as `'/'`) and `${prefix}`
 * (arriving as `''`, the MSW/base-URL-stripped form) — used to travel on as
 * `''`. Only the discovery branch at the foot of the method knew that meant
 * the API root; the ADR-0069 gate, which runs far above it, did not. While
 * `isAuthGateAllowlisted` answered `true` for a falsy path that disagreement
 * was invisible. #7898 made the predicate fail-closed, and the bare-root
 * discovery request started answering 403.
 *
 * ⚠️ The obvious repair is measured WRONG upstream and must not be re-tried
 * here: normalising `'' → '/'` relocates the 403 instead of removing it.
 * `isAuthGateAllowlisted('/')` is `false` (a segment-less path matches no
 * `ALLOW_ROUTES` entry) and the discovery branch tests `'/discovery'` or `''`,
 * which `'/'` satisfies neither. Both legs are pinned in
 * `packages/core/src/security/auth-gate.test.ts` → "does not exempt the
 * dispatcher bare-root `cleanPath` — step 2 is #17625".
 *
 * The delivered repair canonicalises the root to `'/discovery'` — the route it
 * has always served — so the gate and the branch read one spelling. ⛔ Core is
 * untouched and `ALLOW_ROUTES` is unchanged: the root gains exactly the
 * exemption `/discovery` already carried, and gains it by BEING that route.
 *
 * ## The genuinely-absent-path leg is NOT restated here
 *
 * "A caller that reaches the gate with no path at all is still refused" is
 * `packages/core`'s pin, delivered by #7898's own round
 * (`auth-gate.test.ts` → "[#7898] a falsy path is not exempt (fail-closed)",
 * which drives `isAuthGateAllowlisted` over `undefined`, `null` and `''`).
 * ⛔ Restating it against `HttpDispatcher` would measure nothing new: this
 * transport has no pathless call shape — `dispatch()` takes `path: string` and
 * the root canonicalisation below is reached only from the two ROOT spellings.
 * Referenced, not duplicated.
 *
 * ## Why every case runs on a fixture whose gate is provably ON
 *
 * `enforceAuthGate` fails open in a great many ways — no `auth` service, no
 * `isAuthGateActive`, no `getSession`, an unreadable header bag, any thrown
 * error — and under every one of them a 200 on the root is indistinguishable
 * from the repair working. So the gated fixture below is paired with a
 * POSITIVE CONTROL on a protected path in the same `describe`: if the control
 * stops answering 403 with the gate's own code, every other case in this file
 * is measuring a gate that is simply off, and the file says so by going red.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';

/** A session user carrying an ADR-0069 gate posture (`normalizeAuthGate`'s shape). */
const GATED_USER = {
    id: 'u_gated',
    authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
};

/** The same user with no gate — the negative-direction control. */
const UNGATED_USER = { id: 'u_clear' };

/** A path nothing allow-lists, used as the gate's positive control. */
const PROTECTED_PATH = '/data/task';

function makeDispatcher(sessionUser: unknown, gateActive = true) {
    const services: Record<string, any> = {
        objectql: {
            find: vi.fn().mockResolvedValue([]),
            getObjects: vi.fn().mockReturnValue({}),
            registry: {
                getObject: vi.fn().mockReturnValue(null),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
            },
        },
        auth: {
            isAuthGateActive: () => gateActive,
            getApi: async () => ({ getSession: async () => ({ user: sessionUser }) }),
        },
    };
    const kernel: any = {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
    return new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
}

/**
 * Drive one request and hand back the result plus the context the dispatcher
 * wrote through. `routePath` is the value `prepareResolverHints` recorded, and
 * therefore the spelling every stage below it — the gate included — was handed.
 */
async function dispatch(sessionUser: unknown, method: string, path: string, gateActive = true) {
    const dispatcher = makeDispatcher(sessionUser, gateActive);
    const context: any = { request: new Request(`http://localhost/api/v1${path}`) };
    const result = await dispatcher.dispatch(method, path, undefined, {}, context, '/api/v1');
    return { result, context };
}

/** The gate's 403 carries its `code` in the envelope's `details` (`error(msg, 403, { code })`). */
const gateCodeOf = (result: any) =>
    result.response?.body?.error?.details?.code ?? result.response?.body?.error?.code;

describe('[#17625] the API root resolves to the discovery route for a gated session', () => {
    it('⭐ POSITIVE CONTROL — this fixture really does gate: a protected path answers 403 with the gate code', async () => {
        // ⛔ Do not delete or weaken this. `enforceAuthGate` fails open on any
        // hiccup, so without a request that the SAME fixture refuses, every
        // 200 below is compatible with "the gate never ran".
        const { result } = await dispatch(GATED_USER, 'GET', PROTECTED_PATH);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(403);
        expect(gateCodeOf(result)).toBe('PASSWORD_EXPIRED');
    });

    it('PIN 1 — `GET ${prefix}/` returns the discovery payload (was 403 after #7898)', async () => {
        const { result } = await dispatch(GATED_USER, 'GET', '/');
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(200);
        // The discovery document itself, not merely "not a 403".
        expect(result.response?.body?.data?.name).toBe('ObjectOS');
        expect(result.response?.body?.data?.routes).toBeDefined();
    });

    it('PIN 2 — `GET ${prefix}` (no trailing slash) is unchanged: still the discovery payload', async () => {
        const { result } = await dispatch(GATED_USER, 'GET', '');
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.name).toBe('ObjectOS');
        expect(result.response?.body?.data?.routes).toBeDefined();
    });

    it('serves the SAME document for both root spellings and for the named route', async () => {
        // One route, three spellings — the property the canonicalisation buys.
        const [slash, bare, named] = await Promise.all([
            dispatch(GATED_USER, 'GET', '/'),
            dispatch(GATED_USER, 'GET', ''),
            dispatch(GATED_USER, 'GET', '/discovery'),
        ]);
        for (const r of [slash, bare, named]) expect(r.result.response?.status).toBe(200);
        expect(slash.result.response?.body?.data).toEqual(named.result.response?.body?.data);
        expect(bare.result.response?.body?.data).toEqual(named.result.response?.body?.data);
    });

    it('⭐ THE MECHANISM — the gate is handed the allow-listed route NAME, never `""` or `"/"`', async () => {
        // This is the assertion that makes the repair the RULED one rather than
        // a coincidence: both root spellings are canonicalised BEFORE the gate,
        // so what the gate evaluates is `/discovery` — a name `ALLOW_ROUTES`
        // already carries. ⛔ If this ever reads `'/'`, the fix has regressed to
        // the shape upstream measured insufficient, and PIN 1 would only still
        // pass because something else started exempting the root.
        for (const path of ['/', '']) {
            const { context } = await dispatch(GATED_USER, 'GET', path);
            expect(context.routePath, path).toBe('/discovery');
        }
        // …and a path that is NOT the root is not rewritten.
        const { context } = await dispatch(GATED_USER, 'GET', PROTECTED_PATH);
        expect(context.routePath).toBe(PROTECTED_PATH);
    });

    it('⭐ NEGATIVE-DIRECTION CONTROL — the repair narrows nothing: an UNGATED session still reads the root', async () => {
        for (const path of ['/', '', '/discovery']) {
            const { result } = await dispatch(UNGATED_USER, 'GET', path);
            expect(result.response?.status, path).toBe(200);
            expect(result.response?.body?.data?.name, path).toBe('ObjectOS');
        }
    });

    it('the named `/discovery` route keeps answering for a gated session', async () => {
        const { result } = await dispatch(GATED_USER, 'GET', '/discovery');
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.name).toBe('ObjectOS');
    });
});

describe('[#17625] the boundary — what the canonicalisation deliberately does NOT move', () => {
    it('the ENVIRONMENT-SCOPED root keeps its own answer: `${prefix}/environments/<id>` is still gated', async () => {
        // ⚠️ A different input class, and deliberately untouched. The gate runs
        // BEFORE the scoped-URL strip, so this request is judged on
        // `/environments/<id>` — which matched no `ALLOW_ROUTES` entry before
        // #7898 either, so its answer did not move in that card and must not
        // move in this one. The `''` the strip produces afterwards is why the
        // discovery branch keeps its `''` arm.
        const { result } = await dispatch(GATED_USER, 'GET', '/environments/env-1');
        expect(result.response?.status).toBe(403);
        expect(gateCodeOf(result)).toBe('PASSWORD_EXPIRED');
    });

    it('a non-root path that merely LOOKS empty after the strip is not the root', async () => {
        // `//` strips to `'/'`, not to `''`, so it is not canonicalised and is
        // not exempt — recorded so a later reader does not widen the rule into
        // "any number of trailing slashes is the root".
        const { result, context } = await dispatch(GATED_USER, 'GET', '//');
        expect(context.routePath).toBe('/');
        expect(result.response?.status).toBe(403);
    });
});
