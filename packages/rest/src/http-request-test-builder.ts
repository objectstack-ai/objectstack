// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one place this package builds an `IHttpRequest` for a test (#13377).
 *
 * Test layer only — nothing in `src/index.ts` reaches it, so tsup (entry:
 * `src/index.ts`) never emits it into `dist` and it is not published. Same
 * placement, and for the same reason, as `src/xlsx-test-loader.ts`.
 *
 * ## The defect, stated once
 *
 * `IHttpRequest` (`packages/spec/src/contracts/http-server.ts`) declares FIVE
 * required members — `params`, `query`, `headers`, `method`, `path` — and a
 * route handler's first parameter IS that interface. So a test that hands a
 * handler an object literal owes all five. Before this file the package did
 * neither of the two honest things: 151 of its 281 `.handler(` call sites cast
 * the literal with `as any`, and four more sat in `test-typecheck-debt.json` as
 * ledgered `TS2345`:
 *
 * ```
 * src/rest.test.ts(2063,7): error TS2345: Argument of type
 *   '{ params: { environmentId: string; object: string; }; query: {}; }'
 *   is not assignable to parameter of type 'IHttpRequest'.
 * ```
 *
 * ⚠️ No annotation repairs those four. Adding the missing members changes what
 * the handler RECEIVES — the fixture's data, not its typing — so inventing
 * values silently changes what each test measures. That is why this is one
 * builder and not four edits, and it is why the defaults below are argued
 * rather than picked.
 *
 * ## Why each default is the default
 *
 * **`method` and `path` are NOT defaulted — they are read off the route under
 * test.** A constant default here is precisely the hazard #13377 names: a
 * `path` that does not match the route under test makes a passing test measure
 * something other than what it names, and `req.path` is live rather than
 * decorative — `RestServer.enforceAuth` feeds it to `isAuthGateAllowlisted`
 * (`src/rest-server.ts:1254`), where a wrong value decides whether the ADR-0069
 * gate fires at all. Every call site already locates its route
 * (`getRoutes().find(r => r.method === 'GET' && r.path === '…')`); handing that
 * same route object here means the request and the route it is sent to CANNOT
 * disagree, because one is derived from the other.
 *
 * **`path` is materialized from `params`, not copied from the pattern.** A
 * transport hands the handler a CONCRETE path; `/api/v1/data/:object` is a
 * pattern no request ever carries. So the builder substitutes the request's own
 * `params` into the pattern's `:segments` — which also means `path` and
 * `params` cannot drift apart, since one is computed from the other. A
 * `:segment` with no matching param is REFUSED loudly instead of emitted: a
 * path carrying a literal `:` is one no transport could produce, and quietly
 * shipping it is exactly the plausible-looking value this card exists to
 * prevent. A test that wants an unmatched path says so, by overriding `path`.
 *
 * **`headers: {}`** is the one required member with a genuinely neutral
 * default. It means "a request that carried no headers", which is what every
 * one of these fixtures intends, and every header read in this package is
 * either optional-chained or an index access — both yield `undefined` against
 * `{}`, identical to what the fixture meant by omitting it. It is also strictly
 * better-formed than what the ledgered literals produced: they left
 * `req.headers` `undefined`, so the unguarded `req.headers['if-none-match']`
 * (`src/rest-server.ts:5232`) would have THROWN had those tests reached it.
 *
 * **`params: {}` / `query: {}`** — empty is the honest reading of "the fixture
 * supplied none", and both are `Record`s every handler reads defensively.
 *
 * **`remoteAddress` is deliberately ABSENT, and has no default at all.** Its
 * contract note (#4910) is explicit that it is "the TRANSPORT's own peer
 * address … the unforgeable half of caller identification", which a client
 * cannot influence and which the inbound rate limiter keys anonymous traffic
 * off. A builder that supplied a plausible `'127.0.0.1'` would put a forged
 * value in the one member whose entire worth is that it cannot be forged. The
 * interface makes it optional because "not every runtime exposes it", so absent
 * is both legal and true; a test about it states it.
 *
 * **`body` / `rawBody`** are optional and stay absent unless stated: a GET has
 * no body, and the sites that have one pass it.
 */

import type { RouteHandler } from '@objectstack/core';

/**
 * The request type a handler is actually handed, read off the handler's own
 * signature instead of spelled by hand — the discipline `xlsx-test-loader.ts`
 * applies to its dependency, applied here to ours. It resolves to
 * `IHttpRequest`; deriving it means this builder tracks whatever a handler's
 * first parameter becomes, and a change to that contract fails HERE, loudly, in
 * one file, instead of leaving a helper that still compiles and lies.
 */
type HandlerRequest = Parameters<RouteHandler>[0];

/**
 * The half of a mounted route this builder reads. Structurally what
 * `RestServer.getRoutes()` returns, so a `find(…)` result is passed straight
 * in — but declared narrowly on purpose: building a request must not be able to
 * reach the handler it is building the request FOR.
 */
export interface RouteUnderTest {
    /** HTTP verb as registered. */
    readonly method: string;
    /** Full wire path, with `:param` segments — the pattern, not a request. */
    readonly path: string;
}

/**
 * Whatever this call site's assertion is actually about. Every member is the
 * contract's, so a site can state any of them — including `method` and `path`,
 * which override the route's and are then a deliberate, reviewable divergence
 * from the route the request is sent to.
 */
export type HttpRequestOverrides = Partial<HandlerRequest>;

/**
 * Build a complete `IHttpRequest` aimed at `route`, overriding only what this
 * test is about.
 *
 * @param route     the mounted route the request is being sent to; supplies
 *                  `method`, and the pattern `path` is materialized from.
 * @param overrides the members this call site's assertion is about.
 * @throws if the route's pattern has a `:param` that `overrides.params` does
 *         not supply and no explicit `path` was given.
 */
export function httpRequestForRoute(
    route: RouteUnderTest,
    overrides: HttpRequestOverrides = {},
): HandlerRequest {
    const { params = {}, query = {}, headers = {}, method, path, ...optional } = overrides;
    return {
        ...optional,
        params,
        query,
        headers,
        method: method ?? route.method,
        path: path ?? materializeRoutePath(route.path, params),
    };
}

/**
 * Substitute `params` into a route pattern's `:segments`, yielding the concrete
 * path a transport would have produced for this request.
 */
function materializeRoutePath(pattern: string, params: Record<string, string>): string {
    return pattern
        .split('/')
        .map((segment) => {
            if (!segment.startsWith(':')) return segment;
            const name = segment.slice(1);
            if (!Object.prototype.hasOwnProperty.call(params, name)) {
                throw new Error(
                    `httpRequestForRoute: route '${pattern}' has a ':${name}' segment but params supplied no '${name}'. ` +
                    `A path holding a literal ':' is one no transport produces — supply params.${name}, or state ` +
                    `the 'path' override deliberately if the mismatch is what the test is about.`,
                );
            }
            return params[name];
        })
        .join('/');
}
