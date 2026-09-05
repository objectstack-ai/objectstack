// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Does better-auth OWN this path? (#15417)
 *
 * ## Why the question exists
 *
 * `registerAuthRoutes` mounts one catch-all over the whole auth namespace —
 * `rawApp.all(`${basePath}/*`)` — and since #4088 that catch-all is NOT
 * terminal: when better-auth answers 404 the handler calls `next()` and lets
 * whatever else matched answer instead. #4088 needed that, and still does:
 * `plugin-hono-server` mounts `/auth/me/permissions` and
 * `/auth/me/localization` from its own `kernel:ready` hook, and before the
 * yield those two were reachable only if HonoServerPlugin happened to register
 * first. The yield made a load-bearing surface independent of `kernel.use()`
 * order.
 *
 * What #4088 could not express is WHICH 404 may be yielded, because it had only
 * the status to go on. So today every 404 is yielded, including the ones that
 * are better-auth's own ANSWER on a path it owns. Measured on this tree
 * (`plugin-auth/src/auth-catchall-yield.test.ts`, and the probe that produced
 * this module) with the shipped handler on a real Hono app: register one broad
 * downstream mount — `app.all('/api/v1/*', c => c.json({}))`, the shape a
 * composition adds — and
 *
 *     POST /api/v1/auth/delete-user   ->  200  {}
 *
 * where better-auth answered 404 because `user.deleteUser` is deliberately
 * unconfigured. That route is not hypothetical: `auth-route-ledger.ts` carries
 * it under the `disabled` disposition precisely because it is published and
 * refused. A 404 that says "this capability is switched off" is a real answer,
 * and it was up for grabs — as is every 404 a routed endpoint produces for a
 * bad token, an unknown id, or an admin family the deployment does mount.
 *
 * ⚠️ MEASURED, and it is the reason this module skips `SERVER_ONLY` rather
 * than trusting `auth.api` wholesale: the nine `/admin/oauth2/*` endpoints are
 * IN `auth.api` on the stock boot and all nine carry `SERVER_ONLY: true`, so
 * better-call never routes them and their 404 is an unrouted one. Those stay
 * yieldable, correctly — "in `auth.api`" is not the same question as "routed",
 * and only the second one is ownership.
 *
 * ## The seam, and why it is this one
 *
 * There is no route table to enumerate by hand — `auth-route-ledger.ts` says so
 * in its own header, and it is the reason that ledger exists: better-auth is a
 * third-party dependency on its own release cadence, its endpoint set varies
 * with `AuthPluginConfig`, and **the live `auth.api` instance IS the route
 * table**. Every endpoint object carries `.path` and `.options.method`. That is
 * the seam `auth-route-ledger.conformance.test.ts` reads, the seam
 * `admin-route-nonadmin-refusal.dogfood.test.ts` derives its sweep from, and so
 * it is the seam this module asks.
 *
 * ⛔ This does NOT narrow the mount. The catch-all still claims exactly
 * `${basePath}/*` and still forwards every request under it to better-auth,
 * unchanged. What narrows is only the YIELD: a 404 from a path better-auth owns
 * is its answer and is returned; a 404 from a path it does not own is a
 * disclaimer of ownership and is yielded, exactly as #4088 wrote it. Neither
 * `/auth/me/permissions` nor `/auth/me/localization` is a better-auth endpoint,
 * so both keep winning in either registration order — the property #4088 exists
 * to hold.
 *
 * ## Matching mirrors better-call's own router construction
 *
 * `createRouter` (better-call 1.4.0 `dist/router.mjs`) walks `Object.values(
 * endpoints)`, skips any endpoint without `options` or `path`, skips
 * `options.metadata.SERVER_ONLY`, and registers one route per declared method.
 * This module does the same walk over the same objects, so the set it calls
 * "owned" is the set better-call routed. Path params are `rou3` syntax:
 * `:name` matches exactly one non-empty segment (`/reset-password/:token`),
 * and a trailing `**` matches the rest.
 *
 * ⚠️ Ownership is about the PATH TABLE, never about the answer. This module
 * reads no bodies, makes no authorization decision, and cannot turn a refusal
 * into an admission or the reverse — it only decides whether the catch-all is
 * still allowed to hand the request to somebody else.
 */

/** The shape of a better-auth endpoint object, as `auth.api` exposes it. */
export interface BetterAuthEndpointLike {
  path?: string;
  options?: {
    method?: string | readonly string[];
    metadata?: { SERVER_ONLY?: boolean } | undefined;
  };
}

/** One routed (method, path-pattern) pair, pre-split for matching. */
interface OwnedRoute {
  /** Upper-case verbs this pattern answers, or `'*'` for any. */
  methods: ReadonlySet<string>;
  /** `/admin/oauth2/resources/:identifier` -> ['admin','oauth2','resources',':identifier'] */
  segments: readonly string[];
  /** True when the pattern ends in `**` and therefore matches a longer path. */
  matchesRest: boolean;
}

/** Answers "does better-auth route this?" for one better-auth instance. */
export interface BetterAuthRouteOwnership {
  /** Number of routed (method, path) pairs — 0 means the table did not resolve. */
  readonly size: number;
  /**
   * `endpointPath` is better-auth's own `ctx.path` spelling (`/admin/set-role`),
   * i.e. what `AuthManager.betterAuthEndpointPath` returns — never the wire path.
   */
  owns(method: string, endpointPath: string): boolean;
}

const splitPath = (p: string): string[] => p.split('/').filter((s) => s.length > 0);

/**
 * Build the ownership table from a live `auth.api`.
 *
 * Returns a table of size 0 for an unusable input rather than throwing: the
 * caller's safe direction is to keep today's behaviour (yield), never to break
 * the #4088 surface because an enumeration failed.
 */
export function buildBetterAuthRouteOwnership(
  api: Record<string, BetterAuthEndpointLike> | undefined | null,
): BetterAuthRouteOwnership {
  const routes: OwnedRoute[] = [];
  for (const endpoint of Object.values(api ?? {})) {
    // Same three skips better-call's `createRouter` performs, in the same order.
    if (!endpoint?.options || typeof endpoint.path !== 'string') continue;
    if (endpoint.options.metadata?.SERVER_ONLY) continue;
    const declared = endpoint.options.method;
    const methods = new Set(
      (Array.isArray(declared) ? declared : [declared ?? 'POST']).map((m) => String(m).toUpperCase()),
    );
    const segments = splitPath(endpoint.path);
    const matchesRest = segments[segments.length - 1] === '**';
    routes.push({
      methods,
      segments: matchesRest ? segments.slice(0, -1) : segments,
      matchesRest,
    });
  }

  return {
    size: routes.length,
    owns(method: string, endpointPath: string): boolean {
      if (routes.length === 0) return false;
      const verb = String(method).toUpperCase();
      const parts = splitPath(endpointPath);
      return routes.some((route) => {
        if (!route.methods.has(verb) && !route.methods.has('*')) return false;
        if (route.matchesRest ? parts.length < route.segments.length : parts.length !== route.segments.length) {
          return false;
        }
        return route.segments.every((seg, i) => (seg.startsWith(':') ? parts[i].length > 0 : seg === parts[i]));
      });
    },
  };
}
