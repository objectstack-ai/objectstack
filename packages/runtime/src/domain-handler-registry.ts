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
 * Migration discipline (registry first, then extract bodies):
 *   1. PR-1: the dispatcher wraps its existing `handleXxx` methods into
 *      registry entries at construction time — same matching semantics, same
 *      handler bodies, zero behavior change (locked by the http-conformance
 *      cross-adapter suite).
 *   2. PR-2..N: each domain's handler BODY moves to a module under
 *      `./domains/`, depending only on the explicit {@link DomainHandlerDeps}
 *      contract. Registration stays dispatcher-owned on purpose: most service
 *      slots are multi-provider (e.g. `i18n` is served by I18nServicePlugin
 *      OR the AppPlugin in-memory fallback; `analytics` by service-analytics
 *      OR the ObjectQLPlugin fallback), so a route is the bridge to a SLOT,
 *      not the property of any one providing package — moving registration
 *      into one provider would 404 the others. External packages that DO own
 *      a slot exclusively can still self-register via
 *      {@link HttpDispatcher.registerDomainHandler}.
 *
 * Matching semantics are deliberately faithful to the legacy if-chain,
 * INCLUDING its rough edges (`match: 'prefix'` on `/i18n` also matches
 * `/i18nxx`, exactly as `startsWith` did) — fixing those edges is explicitly
 * not this seam's job; behavior preservation is.
 */

import type { HttpProtocolContext, HttpDispatcherResult } from './http-dispatcher.js';
import type { CoreServiceName } from '@objectstack/spec/system';
import type { CoreServiceContract } from '@objectstack/spec/contracts';

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
     * `'segment'` — exact, or followed by `'/'` (the legacy
     * `=== p || startsWith(p + '/')` branch shape; does NOT claim `/i18nxx`).
     */
    match?: 'prefix' | 'exact' | 'segment';
    /** Restrict to these UPPERCASE HTTP methods. Omit = all methods. */
    methods?: string[];
    handler: DomainHandler;
}

/**
 * The dispatcher facilities an extracted domain body is allowed to use — the
 * WHOLE dependency contract, made explicit. Growing this interface is a
 * design decision, not a convenience: every addition couples all domains to
 * more dispatcher surface.
 */
export interface DomainHandlerDeps {
    /** Environment-scoped service resolution (per-request kernel aware). */
    resolveService(name: string, environmentId?: string): any;
    /**
     * Unscoped service lookup on the current kernel, typed by the slot.
     *
     * [#4127] Returned `any`, which is why nothing could tell a domain calling
     * a method its contract declares from one calling a method nobody declared:
     * both typecheck against `any`. #4087 rode that for months (a `/storage`
     * handler passing two arguments no implementation takes), and the four gaps
     * in #4127 were found by sweeping the domains by hand — not repeatable.
     *
     * {@link CoreServiceContract} resolves the slot to its contract, so the
     * compiler asks the question on every call. A slot with no contract written
     * yet resolves to `unknown`, so it must be cast deliberately and the gap
     * stays visible.
     *
     * `undefined` when the slot is empty — the caller MUST narrow before use
     * (`isServiceServeable` does it and also rejects a self-declared
     * non-handler, ADR-0076 D12).
     */
    getService<K extends CoreServiceName>(name: K): Promise<CoreServiceContract<K> | undefined>;
    /**
     * Environment-scoped ObjectQL lookup with a registry-shape check
     * (resolves the `objectql` service and returns it only when it exposes
     * `.registry`; null otherwise). The data-plane domains (/keys today,
     * /data /meta when they migrate) depend on this.
     */
    getObjectQL(environmentId?: string): Promise<any>;
    /**
     * Service lookup on the request's RESOLVED (per-environment) kernel —
     * NOT the default kernel and NOT the scoped-factory path. Domains whose
     * data must live in the same store as their service bindings (e.g.
     * share-links: the token row and the shared record sit next to the
     * `shareLinks` service's engine) read through this and fall back to
     * `resolveService` themselves.
     */
    getRequestKernelService(name: string): Promise<any>;
    /** Standard success envelope. */
    success(data: any, meta?: any): { status: number; body: any };
    /**
     * Standard error envelope: `{ success: false, error: { code, message,
     * httpStatus, details? } }`.
     *
     * The second argument is the HTTP STATUS (#3842 renamed it from `code`,
     * which is what it was misleadingly called while it was also what landed in
     * `error.code`). `error.code` is the semantic string: pass yours as
     * `details.code` and it is promoted into the field, otherwise one is derived
     * from the status. See `./error-envelope.ts`.
     */
    error(message: string, httpStatus?: number, details?: any): { status: number; body: any };
    /** Standard ROUTE_NOT_FOUND envelope (404 + discovery hint). */
    routeNotFound(route: string): { status: number; body: any };
    /**
     * Error envelope derived from a thrown value: honours `.status` /
     * `.statusCode`, carries spec-validation `issues` through as details, and
     * lifts the error's own `.code` into `error.code` (the ADR-0033 publish
     * surface relies on field-anchored 422s).
     */
    errorFromThrown(e: any, fallbackStatus?: number): { status: number; body: any };
    /** Active organization id from the request session (undefined if anonymous / no auth). */
    resolveActiveOrganizationId(context: HttpProtocolContext): Promise<string | undefined>;
    /**
     * Fire a kernel-context event on the request's resolved kernel (no-op
     * when the kernel exposes no trigger). Used by the packages domain to
     * announce `metadata:reloaded` after a publish so boot-cached consumers
     * (the automation engine above all) re-sync without a restart.
     */
    announceKernelEvent(event: string, payload: unknown): Promise<void>;
    /** Host logger when one is attached to the dispatcher; domains fall back to console. */
    logger?: any;
    /** Single-environment default environment id (createSingleEnvironmentPlugin), if registered. */
    getDefaultEnvironmentId(): string | undefined;
    /**
     * Direct-caller kernel swap (ADR-0006 Phase 5): when a host KernelResolver
     * is present and the context names a non-platform environment, resolve and
     * SWAP to the per-project kernel (side effect owned by the dispatcher) and
     * return that kernel's own ObjectQL — bypassing the control-plane scoped
     * factory, which would hand back an instance without the project bundle's
     * actions/hooks. Returns null when no swap happened. Idempotent on
     * dispatch()-routed requests (they already swapped).
     */
    resolveProjectKernelObjectQL(context: HttpProtocolContext): Promise<any | null>;
    /** True when a host KernelResolver is registered (multi-tenant deployment). */
    isMultiTenantHost(): boolean;
    /**
     * The AI route table the AI plugin caches on the request kernel
     * (`__aiRoutes`); undefined until the plugin initializes it.
     */
    getRegisteredAiRoutes(): Array<{ method: string; path: string; handler: (req: any) => Promise<any>; auth?: boolean }> | undefined;
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
            if (DomainHandlerRegistry.matches(route, path)) return route;
        }
        return undefined;
    }

    private static matches(route: DomainRoute, path: string): boolean {
        switch (route.match) {
            case 'exact':
                return path === route.prefix;
            case 'segment':
                return path === route.prefix || path.startsWith(route.prefix + '/');
            default:
                return path.startsWith(route.prefix);
        }
    }

    /** Registered routes, in match order (introspection / tests). */
    list(): readonly DomainRoute[] {
        return this.routes;
    }
}
