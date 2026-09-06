// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/auth` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-7).
 * Bridges to the `auth` service's contract handler. With no auth service
 * registered the domain answers 501 — it never fabricates a session (#4113).
 * A THROW out of that handler is an unattributable server fault and never
 * ships its own words to the client (#5085 — see the try/catch below).
 */

import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { CoreServiceName } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * The route this domain claims — `/auth` and its slash-separated sub-paths,
 * and NOTHING ELSE (#16026).
 *
 * ## Why `match: 'segment'` is spelled out rather than left to the default
 *
 * `DomainRoute.match` defaults to `'prefix'`, i.e. a bare
 * `path.startsWith('/auth')` with no segment boundary — the legacy if-chain's
 * shape, which `DomainHandlerRegistry` preserved deliberately when the domains
 * were lifted out of it. On this prefix that rough edge claims SIBLING
 * NAMESPACES: `/authx`, `/authx/foo` and `/authentication/foo` are not auth
 * paths by any reading, and `/authx` is a plausible namespace someone mounts
 * later. Measured on a real boot — a real `ObjectKernel` with `AuthPlugin`,
 * `createHonoApp({ kernel, prefix: '/api/v1' })`, authenticated as the dev
 * admin, requests injected through the returned app — all three were claimed
 * here, forwarded to better-auth, and answered `200 {}`:
 *
 *     GET /api/v1/authx              -> 200 {}          (claimed here)
 *     GET /api/v1/authx/foo          -> 200 {}          (claimed here)
 *     GET /api/v1/authentication/foo -> 200 {}          (claimed here)
 *     GET /api/v1/aut/foo            -> 404 ROUTE_NOT_FOUND   (control)
 *     GET /api/v1/zzz/foo            -> 404 ROUTE_NOT_FOUND   (control)
 *
 * The two control rows are what prove the boundary is the `auth` prefix and
 * not the whole catch-all; they are unchanged by this route's `match`.
 *
 * ⛔ This narrows the CLAIM only — it does not remove the fallthrough, and it
 * must not. `/auth/me/permissions` and `/auth/me/localization` are not
 * better-auth endpoints, so the adapter's `/auth/*` mount disclaims them and
 * they arrive HERE (#4088; objectui's permission layer reads the former).
 * `'segment'` claims `'/auth'` exactly and everything under `'/auth/'`, so
 * both keep reaching `dispatch()` — that is the whole point of choosing this
 * mode over anything narrower.
 *
 * `'segment'` is also what the registry's other boundary-correct domains
 * already declare (`/keys`, `/mcp`, `/mcp/skill`), so this is the codebase's
 * own established spelling for the fix, not a new convention.
 *
 * ⚠️ What this does NOT fix, deliberately: the `200 {}` those rows carried.
 * That answer is manufactured one layer OUT, where the adapter renders a
 * dispatcher result — the auth service itself answers an honest 404 for every
 * path above. Tracked separately on #16026; ⛔ do not "fix" it by narrowing
 * this claim further.
 */
export function createAuthDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/auth',
        match: 'segment',
        handler: (req, context) =>
            handleAuthRequest(deps, req.path.substring(5), req.method, req.body, context),
    };
}

/**
 * Handles Auth requests
 * path: sub-path after /auth/
 *
 * `_path` / `_method` / `_body` are unread by design and kept only for
 * positional symmetry with the other domain handlers: since #4113 removed the
 * mock session, this domain does not route on the sub-path at all — it hands
 * `context.request` to the auth service whole, and that service owns the
 * routing. They stay in the signature (rather than being dropped) because
 * every caller passes them positionally, `createAuthDomain` included.
 */
export async function handleAuthRequest(deps: DomainHandlerDeps, _path: string, _method: string, _body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    // 1. Try generic Auth Service.
    //
    // [#4127] This probed `authService.handler(request, response)` — a method
    // no implementation has, taking two arguments the contract's does not.
    // `IAuthService` declares `handleRequest(request): Promise<Response>` and
    // `AuthManager` implements exactly that, so the probe was false on every
    // deployment: #4087's shape, found by the compiler the moment `getService`
    // started returning `IAuthService` instead of `any`. It survived the manual
    // sweep in #4127, which never listed `/auth` in either its gap list or its
    // "clean" list, and it was pinned GREEN by a test mocking `{ handler }` —
    // the fabricated shape, not the declared one (the same test-side hole that
    // kept #4087 green, catalogued in #4127's last section).
    //
    // Reading the contract also made this branch reachable for the first time.
    // The Hono adapter calls `handleRequest` itself and only falls through to
    // this dispatcher when no usable auth service answered, so nothing was
    // silently served by the since-retired mock in that deployment — but a host
    // that reached `handleAuth` directly WITH an auth service registered used to
    // get that mock's `mock_<uuid>` session instead of real authentication. It
    // now gets the auth service; #4113 removed the mock entirely (see below).
    const authService = await deps.getService(context, CoreServiceName.enum.auth);
    if (authService && typeof authService.handleRequest === 'function') {
        // [#5085] The auth service owns the routing, so whatever it THROWS is
        // unattributable here: this domain never inspected the sub-path, never
        // parsed the body, and cannot tell a caller mistake from a handler bug.
        // Until now the thrown message reached the client verbatim, and the
        // measured leak was a plain `TypeError` — `request.headers.get is not a
        // function`, raised inside better-auth's fetch-style handler when a
        // transport handed it a non-Fetch request. Neither dispatcher exit
        // catches that: both sanitise only on `looksLikeInternalErrorLeak`, a
        // SQL/driver-dump heuristic that says nothing about a TypeError, and
        // #5462 already recorded that a negative from a keyword heuristic is
        // not evidence of safety.
        //
        // So the message is withheld UNCONDITIONALLY — the discipline
        // #5437/#5464 established one boundary up, and #5489 wrote down for
        // `mapDataError`'s terminal branch (`UNCLASSIFIED_FAULT`), where a
        // handler `TypeError` is named as the very shape that lands there.
        // The answer is a plain 500 with the catalog's floor code for "500 with
        // no more specific code" (`INTERNAL_ERROR`, derived from the status by
        // `deps.error`) and the original error goes to the server log, which is
        // where an operator reads it.
        //
        // This costs the honest paths nothing: better-auth answers its own
        // failures with a `Response` rather than by throwing (the reason
        // `AuthPlugin`'s wildcard logs >=500 responses proactively), so a real
        // 401/403/404/422 is still returned below with its own body untouched.
        let response: Response;
        try {
            response = await authService.handleRequest(context.request as Request);
        } catch (err) {
            const logger = deps.logger ?? console;
            logger?.error?.(
                '[auth] the auth service threw while handling the request; the client was answered '
                + 'with a sanitised 500 (#5085)',
                err instanceof Error ? err : new Error(String(err)),
            );
            return { handled: true, response: deps.error(INTERNAL_ERROR_MESSAGE, 500) };
        }
        return { handled: true, result: response };
    }

    // 2. No auth service — 501, never a fabricated session (#4113).
    //
    // This used to answer `POST /auth/sign-in/email` (and sign-up, get-session,
    // sign-out) with 200 and a `mock_<uuid>` user + a 24-hour `mock_token_*`
    // session, for ANY email and ANY password — the password was never read.
    // It shipped in `packages/runtime`, not behind a dev-only plugin, and it
    // gated on nothing but "is the slot empty", so `os serve --preset minimal`
    // and any embedder without plugin-auth got it. Not a bypass — no session
    // store backs the token, so `resolve-execution-context.ts` still resolves
    // anonymous and `shouldDenyAnonymous` still denies — but it told the client
    // the one thing a server must never lie about: that it had authenticated
    // someone. Its own justification ("MSW/browser-only environments") had no
    // consumer in this repo or in `objectui`, whose auth tests mock at the HTTP
    // client layer; only two tests pinned it, and they pinned the mock itself.
    //
    // ADR-0115 retired this whole class inside plugin-dev; this was the last
    // member, and the only one that shipped to production. Its lineage — the
    // #3891 analytics shim, #4000's dev stub, #4058/#4086's three, #4126's
    // security trio — was retired the same way: deleted, not flagged.
    //
    // 501, not 404, following `/i18n` — the nearest precedent in shape (a core
    // capability, a dispatcher-owned domain, an optional plugin behind it, and
    // a route discovery already declines to advertise when the slot is empty).
    // The route IS mounted here; what is missing is the implementation behind
    // it, which is what 501 states and 404 would misdescribe. It also keeps
    // faith with the one true observation the mock was built on — that a bare
    // 404 on sign-in sends the operator hunting for a routing bug — without
    // the lie it used to answer that concern.
    return { handled: true, response: deps.error('Auth service not available — register @objectstack/plugin-auth to enable authentication', 501) };
}
