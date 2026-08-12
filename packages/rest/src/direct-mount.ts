// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DIRECT-MOUNT ROUTES — the ones a registrar puts straight on the host
 * `IHttpServer`, and the seam that lets the server which owns the surface know
 * they are there (#5822).
 *
 * ## What was wrong
 *
 * `packages/rest` mounts routes two ways. Most go through `RouteManager`, whose
 * table is what `RestServer.getRoutes()` reports and what
 * `openapi-builtin-paths.ts` turns into the published built-in section. Two
 * registrars bypass it and call `server.get/post/...` directly
 * (`package-routes.ts`, `external-datasource-routes.ts`) — nine routes, eight of
 * them `disposition: 'sdk'` capabilities in `rest-route-ledger.ts`.
 *
 * They bypass it for a reason that is structural rather than deliberate, and
 * worth recording because the ledger noted the question as unanswered: both are
 * free functions over `IHttpServer`, composed by the PLUGIN
 * (`rest-api-plugin.ts`) after `RestServer` has already registered its own
 * routes, and each is service-gated at that composition step. `RouteManager` is
 * a private field of `RestServer`; at the plugin's call site there was simply
 * no manager in scope to register with — the `RestServer` instance itself was
 * declared inside the `try` block that builds it. Nothing about these routes
 * needs to avoid the manager, and nothing about the manager rejects them.
 *
 * The consequence surfaced when #5588 (PR #5821) made the OpenAPI built-in
 * section a projection of the server's own route table: those nine could not be
 * documented, because the server held no fact about whether they were mounted
 * for this boot — and inventing one is exactly the phantom-row defect #5588 was
 * repairing. Honest, but incomplete.
 *
 * ## The rule this module encodes
 *
 * A registrar declares its routes ONCE, as data, and hands that array to
 * {@link mountDirectRoutes}, which mounts each row and returns the same array.
 * What a caller records is therefore the very list that was iterated to mount —
 * never a parallel table kept in sync by hand, which is the second source of
 * truth #5822 rejected up front. `RestServer.recordDirectMountedRoutes` then
 * folds those facts into `getRoutes()`, so one enumeration answers "what is
 * mounted" for introspection, for the OpenAPI document, and for the route-ledger
 * conformance guard.
 *
 * Both directions hold by construction, and both are pinned
 * (`direct-mount-introspection.test.ts`):
 *
 *  - **mounted ⇒ enumerable.** The array that mounted the routes is the array
 *    that is returned; a registrar cannot mount a route it does not describe.
 *  - **not mounted ⇒ not enumerable.** A route the registrar leaves out is not
 *    in the array it returns, so a boot without `packageService` reports the
 *    three `package`-service-backed `packages.*` routes nowhere and publishes
 *    none of them. The service gate stays where it was and the record follows
 *    it. Since #7563 the gate covers three of the four rather than all four:
 *    `POST /packages/publish` mounts unconditionally (it has no dispatcher twin
 *    to fall back to, so leaving it unowned produced another route's 405 rather
 *    than a 404) — see `package-routes.ts`.
 *
 * One deliberate asymmetry: if the host server throws part-way through mounting,
 * the exception propagates and the caller records NOTHING, even though some rows
 * did mount. That under-claims rather than over-claims, the same direction
 * `openapi-builtin-paths.ts` chose for per-operation `security` — absence is
 * visible, fiction is not.
 */

import type { IHttpServer, RouteHandler } from '@objectstack/core';
import type { RouteHandlerMetadata } from '@objectstack/spec/system';
import type { HttpMethod } from '@objectstack/spec/shared';

/**
 * How a route reached the host server.
 *
 * Same vocabulary as `rest-route-ledger.ts`'s `source` column, restated here
 * because that file is deliberately import-free (the client-side guard reads it
 * as a relative source file). The ledger records the AUDITED disposition of a
 * route; this records how a LIVE one got mounted. The conformance test is what
 * holds the two spellings together.
 */
export type MountedRouteSource = 'route-manager' | 'direct-mount';

/**
 * One route a registrar mounts straight on the host `IHttpServer`.
 *
 * Structurally the `RouteEntry` `RouteManager` keeps, so both kinds of route
 * flow through the same introspection and the same OpenAPI projection without
 * a translation step.
 */
export interface DirectMountedRoute {
    /** HTTP verb as registered — `PATCH` is `PATCH`, never normalised to `PUT`. */
    method: HttpMethod;
    /** Full wire path, with `:param` segments, under the base it was mounted at. */
    path: string;
    handler: RouteHandler;
    /** Carried into the OpenAPI document exactly like a RouteManager registration's. */
    metadata?: RouteHandlerMetadata['metadata'];
}

/**
 * What a direct-mount registrar's routes are reported to — implemented by
 * `RestServer`, and narrow on purpose so a registrar's composition step depends
 * on the recording seam rather than on the whole server.
 */
export interface DirectMountRecorder {
    recordDirectMountedRoutes(routes: readonly DirectMountedRoute[]): void;
}

/**
 * Mount every route in `routes` on `server`, and return that same array.
 *
 * The identity of the returned value is the point: the caller's description of
 * what is mounted cannot drift from what was mounted, because it IS what was
 * mounted.
 */
export function mountDirectRoutes<T extends readonly DirectMountedRoute[]>(
    server: IHttpServer,
    routes: T,
): T {
    for (const route of routes) {
        switch (route.method) {
            case 'GET':
                server.get(route.path, route.handler);
                break;
            case 'POST':
                server.post(route.path, route.handler);
                break;
            case 'PUT':
                server.put(route.path, route.handler);
                break;
            case 'PATCH':
                server.patch(route.path, route.handler);
                break;
            case 'DELETE':
                server.delete(route.path, route.handler);
                break;
            default:
                // Same refusal as RouteManager.registerWithServer: a verb the
                // host cannot mount must not be silently dropped into a
                // description of what is mounted.
                throw new Error(`Unsupported HTTP method: ${route.method}`);
        }
    }
    return routes;
}
