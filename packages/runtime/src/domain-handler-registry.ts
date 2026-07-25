// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Domain handler registry — the thin routing seam of ADR-0076 D11 step ③
 * (#2462).
 *
 * The HTTP dispatcher historically routed every domain through one hand-written
 * `if (cleanPath.startsWith('/xxx'))` chain inside `dispatch()`, and every
 * domain's handler lived as a method on the dispatcher class — the "god
 * implementation on a clean port" shape ADR-0076 D11 calls out. This registry
 * is the decomposition seam: `dispatch()` consults it FIRST, and domains are
 * migrated out of the if-chain one PR at a time.
 *
 * Migration discipline (registry first, code moves later, ownership last):
 *   1. This PR: the dispatcher wraps its existing `handleXxx` methods into
 *      registry entries at construction time — same matching semantics, same
 *      handler bodies, zero behavior change (locked by the http-conformance
 *      cross-adapter suite).
 *   2. Follow-up PRs: a domain's handler body moves into its owning service
 *      package, which registers the entry itself (via
 *      {@link HttpDispatcher.registerDomainHandler}). Service-absence
 *      semantics (today's in-handler 501 vs route-not-mounted 404) are decided
 *      per-domain at THAT point, together with the D12 honest-capabilities
 *      discovery contract.
 *
 * Matching semantics are deliberately faithful to the legacy if-chain,
 * INCLUDING its rough edges (`match: 'prefix'` on `/i18n` also matches
 * `/i18nxx`, exactly as `startsWith` did) — fixing those edges is explicitly
 * not this seam's job; behavior preservation is.
 */

import type { HttpProtocolContext, HttpDispatcherResult } from './http-dispatcher.js';

/**
 * The normalized request slice a domain handler receives. `path` is the
 * dispatcher's `cleanPath` — API prefix and `/environments/:id` scope already
 * stripped, NO domain-prefix stripping (each handler keeps its historical
 * substring convention until its domain PR normalizes it).
 */
export interface DomainRequest {
    path: string;
    method: string;
    body: any;
    query: any;
}

/** Normalized per-domain handler — the dispatcher-independent handler shape. */
export type DomainHandler = (
    req: DomainRequest,
    context: HttpProtocolContext,
) => Promise<HttpDispatcherResult>;

export interface DomainRoute {
    /** Path prefix the domain claims, e.g. `'/i18n'`. */
    prefix: string;
    /**
     * `'prefix'` — legacy `startsWith(prefix)` semantics (default).
     * `'exact'` — the path must equal the prefix exactly.
     */
    match?: 'prefix' | 'exact';
    /** Restrict to these UPPERCASE HTTP methods. Omit = all methods. */
    methods?: string[];
    handler: DomainHandler;
}

/**
 * First-match-wins routing table, in registration order. Kept deliberately
 * minimal — no wildcards, no params, no middleware: those belong to the real
 * HTTP adapters. This seam only decides "which domain owns this path".
 */
export class DomainHandlerRegistry {
    private readonly routes: DomainRoute[] = [];

    register(route: DomainRoute): void {
        if (!route.prefix.startsWith('/')) {
            throw new Error(`DomainHandlerRegistry: prefix must start with '/', got '${route.prefix}'`);
        }
        this.routes.push(route);
    }

    /** Resolve the first route claiming `path` (+`method`), else undefined. */
    resolve(path: string, method: string): DomainRoute | undefined {
        const m = method.toUpperCase();
        for (const route of this.routes) {
            if (route.methods && !route.methods.includes(m)) continue;
            if (route.match === 'exact' ? path === route.prefix : path.startsWith(route.prefix)) {
                return route;
            }
        }
        return undefined;
    }

    /** Registered routes, in match order (introspection / tests). */
    list(): readonly DomainRoute[] {
        return this.routes;
    }
}
