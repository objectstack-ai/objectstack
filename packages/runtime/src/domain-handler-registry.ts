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
 * Matching semantics were deliberately faithful to the legacy if-chain,
 * INCLUDING its rough edges, for as long as the migration needed behaviour
 * preservation to be the only promise this seam made. That period is over and
 * the edges are fixed (#16263): a domain claim now stops at a SEGMENT
 * BOUNDARY by default, so `/i18n` no longer claims `/i18nxx`. The legacy
 * `startsWith` shape is still reachable, but only where a route ASKS for it in
 * writing (`match: 'prefix'`) — see {@link DomainRoute.match}.
 */

import type { HttpProtocolContext, HttpDispatcherResult } from './http-dispatcher.js';
import type { CoreServiceName } from '@objectstack/spec/system';
import type { CoreServiceContract, IObjectQLEngine, ServiceSlotContract, ServiceSlotContracts } from '@objectstack/spec/contracts';

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
     * How much of the path space this route claims.
     *
     * `'segment'` — **the default**: the path equals the prefix, or is
     * followed by `'/'`. Claims `/i18n` and everything under `/i18n/`, and
     * does NOT claim `/i18nxx`.
     * `'exact'` — the path must equal the prefix exactly.
     * `'prefix'` — bare `startsWith(prefix)`, NO segment boundary: the legacy
     * if-chain's shape, which also claims `/i18nxx`.
     *
     * ## Why `'segment'` is the default and `'prefix'` must be asked for
     *
     * The reasoning is #16026's, applied to the whole table rather than to one
     * prefix. A bare `startsWith` claim reaches SIBLING NAMESPACES: `/authx`,
     * `/authentication/foo`, `/datax`, `/metaxyz`, `/uifoo` are not paths of
     * the domain that was claiming them by any reading, and each is a
     * plausible namespace someone mounts later — a route registered there is
     * SHADOWED by a domain that never wanted it. `'segment'` claims the prefix
     * exactly and everything under `prefix + '/'`, which is the whole of what
     * a domain owns, so narrowing to it removes only claims a domain does not
     * own and keeps every sub-path fallthrough intact (#4088's
     * `/auth/me/permissions` is the case that pins that half).
     *
     * `'segment'` was already the codebase's own spelling for a
     * boundary-correct claim — `/auth`, `/keys`, `/mcp`, `/mcp/skill`,
     * `/security` and `/share-links` each declared it — so this makes the
     * table's majority spelling its default rather than introducing a
     * convention.
     *
     * ⚠️ `'prefix'` is NOT deprecated, and one shape genuinely needs it: a
     * prefix ending in `'?'` (`'/keys?'`, `'/mcp?'`), which reproduces the
     * legacy branch's query-string form for adapters that pass the query
     * through in `path`. There is no `/` after that `'?'`, so a segment match
     * cannot express it. Those routes declare `match: 'prefix'` in writing.
     *
     * ⛔ Do not reach for `'prefix'` to widen a domain's claim over its
     * lexical neighbours. The default changed because that claim was never
     * anything but a migration artefact.
     */
    match?: 'prefix' | 'exact' | 'segment';
    /** Restrict to these UPPERCASE HTTP methods. Omit = all methods. */
    methods?: string[];
    /**
     * This route is a LIVENESS probe: `dispatch()` runs its handler WITHOUT the
     * per-request identity step or the gates that follow it.
     *
     * Declared here, on the route itself, and nowhere else — that is the whole
     * point of the field. "Which routes are liveness" is a question with exactly
     * one honest source, the table `dispatch()` already routes on, so
     * {@link DomainHandlerRegistry.resolveLiveness} answers it through the SAME
     * matcher that picks the handler. A separate array of liveness paths would
     * be a second list of routes, and this repo has measured what those cost:
     * they drift from the thing they describe and the drift is silent.
     *
     * ⛔ Do not set this on a route whose body reads configuration, credentials
     * or any service. A liveness handler may report process-local facts only
     * (the process is executing code, the server is listening) — anything else
     * puts a configuration fault back on the route whose consumer answers by
     * restarting the pod, and a restart cannot fix a service that cannot build.
     * Readiness is where a dependency check belongs; its failure mode (leave the
     * load-balancer rotation) is the one that helps.
     */
    liveness?: boolean;
    handler: DomainHandler;
}

/**
 * The dispatcher facilities an extracted domain body is allowed to use — the
 * WHOLE dependency contract, made explicit. Growing this interface is a
 * design decision, not a convenience: every addition couples all domains to
 * more dispatcher surface.
 *
 * ## Why every kernel-reading facility takes the request first (#5155)
 *
 * A host constructs exactly ONE `HttpDispatcher` and therefore exactly one of
 * these objects — every route, every tenant, every concurrent request shares
 * it. So it cannot hold "the kernel of the request currently in flight": on a
 * multi-tenant host (a `kernelResolver` is registered) there is no such single
 * value. It used to try, via a `this.kernel` field on the dispatcher written
 * once per request, and the result was that a request resuming after an
 * `await` resolved its services on whichever environment had resolved most
 * recently — one tenant reading another tenant's data source.
 *
 * The per-request kernel therefore travels on the per-request object every
 * handler already receives: {@link HttpProtocolContext.kernel}, written by
 * `HttpDispatcher.resolveRequestScope`. Passing the context is not ceremony —
 * it is what makes the dependency visible at the call site and impossible to
 * forget, because the compiler asks for it. Do NOT add a facility here that
 * reads a kernel without taking the request, and do not cache the resolved
 * kernel anywhere that outlives one request.
 */
export interface DomainHandlerDeps {
    /**
     * Environment-scoped service resolution (per-request kernel aware), typed
     * by the slot when the slot is a core one.
     *
     * [#4127 batch 2] `getService` got this treatment first because every one of
     * its call sites already passed a `CoreServiceName`. This one is mixed, and
     * the overloads split it exactly where the evidence does:
     *
     *  - An **evidenced slot** — however it is written. 17 call sites address a
     *    core slot with a bare literal (`'metadata'` ×10, `'automation'` ×3,
     *    `'auth'` ×3, `'ai'`) rather than `CoreServiceName.enum.*`, so the same
     *    slot was being addressed two ways; both resolve to the contract.
     *  - **Anything else** — `protocol`, `mcp`, `kernel-resolver`,
     *    `scope-manager`. Real services with no written contract, so they keep
     *    today's `any` rather than being given a shape here that nothing
     *    verifies. That `any` is where the ledger honestly ends.
     *
     * [batch 3] The key is `keyof ServiceSlotContracts`, not `CoreServiceName`.
     * `security`, `shareLinks` and `objectql` each had a contract, a provider
     * registering them, and call sites already within the contract — the only
     * missing link was that the slot name was not in the enum, so nothing could
     * connect them. Widening the *enum* to fix that would have paid for a type
     * answer with a change to the boot/criticality vocabulary; the ledger
     * extends past the enum instead. See {@link ServiceSlotContracts}.
     */
    resolveService<K extends keyof ServiceSlotContracts>(context: HttpProtocolContext, name: K, environmentId?: string): Promise<ServiceSlotContract<K> | undefined>;
    resolveService(context: HttpProtocolContext, name: string, environmentId?: string): any;
    /**
     * [#15900 · #13906 decision 1 option A] The CLASSIFIED sibling of
     * `resolveService`, for a domain gate whose input is an authorization FACT
     * rather than an optional capability.
     *
     * Same chain, same registries, same order — only what a REJECTION means
     * differs:
     *
     *  - branded "never registered" (`isServiceNotRegisteredError`, #13905) →
     *    `undefined`, quiet. The supported composition, whose behaviour is
     *    exactly what it was;
     *  - [#16402] a registry that KNOWS the name and produces no instance for
     *    the scope you passed → `undefined`, quiet as well. A factory that
     *    answers `undefined` for a scope has ANSWERED, so this is an absent
     *    fact and not an unread one — ADR-0093 D4/D5 reads a scope with no
     *    service the same way it reads a deployment with none. ⚠️ It is a
     *    DIFFERENT fact from the one above with the same licence, and the
     *    lookup tells the two apart internally (`HttpDispatcher.classifyService`)
     *    — it is collapsed HERE because no door needs to act on the difference,
     *    ⛔ not because they are the same state;
     *  - every other rejection (a factory that threw, a scoped registration
     *    resolved without a scope id, a circular service dependency) →
     *    re-raised, for the gate to answer as an OUTAGE rather than as an
     *    absent fact.
     *
     * ⚠️ `resolveService` above stays the contract for everything else, and
     * that is a boundary rather than an oversight: it is a capability PROBE
     * whose collapsed `undefined` is the right shape for "is this optional
     * service installed", and rerouting a NAME through this method for every
     * domain at once would change every gate that reads it in one stroke —
     * option C on #15900, explicitly NOT ruled, because nobody has enumerated
     * those gates. A gate opts IN, one call site at a time, and says at the
     * call site why its input is not a capability question.
     *
     * ⛔ Do not reach for this because it reads as the stricter one. The
     * classification is only meaningful where "the fact could not be read" and
     * "the fact is absent" license DIFFERENT answers; where they license the
     * same answer it buys an outage in place of a working deployment.
     *
     * ⚠️ PASS THE SCOPE YOU HOLD. `environmentId` is optional in the signature
     * and load bearing in use: a service registered `ServiceLifecycle.SCOPED`
     * and resolved without one rejects UNBRANDED, so this method re-raises it
     * and the caller answers 503 — on a service that is perfectly healthy. Under
     * `resolveService` that same omission was invisible, because the probe
     * absorbed it; opting a call site in without the scope converts a silent
     * fallback into a manufactured outage for every caller of that door. A
     * rejection out of this method should describe the SERVICE, never the call
     * site's own omission.
     *
     * ⭐ [#16402] That last sentence used to be false INSIDE the lookup itself:
     * having taken your scope, it re-resolved on the request's own kernel
     * WITHOUT it, so a scoped factory answering `undefined` for your scope came
     * back as `Scope ID required for scoped service '<name>'` — a rejection
     * describing an omission that never happened, at a call site that passed
     * everything it was asked for. The scope now travels with every leg. ⛔ The
     * `packages/core` wording is untouched, and a caller that really passes no
     * scope still receives it, which is the one caller it is true about.
     *
     * Untyped by slot on purpose, exactly like `resolveService`'s second
     * overload: its callers address `tenancy`, which has no written
     * `ServiceSlotContracts` entry, and inventing one here would be a shape
     * nothing verifies.
     */
    resolveServiceOrLoud(context: HttpProtocolContext, name: string, environmentId?: string): Promise<any>;
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
    getService<K extends CoreServiceName>(context: HttpProtocolContext, name: K): Promise<CoreServiceContract<K> | undefined>;
    /**
     * Environment-scoped ObjectQL lookup with a registry-shape check
     * (resolves the `objectql` service and returns it only when it exposes
     * `.registry`; null otherwise). The data-plane domains (/keys today,
     * /data /meta when they migrate) depend on this.
     *
     * [#4127 batch 4 → #4251 B3] This was **deliberately `any`** for two
     * batches, with the record of why kept right here: ObjectQL is wider than
     * `IDataEngine`, the wider part (`registry`, `executeAction` — exactly
     * what this accessor's callers use) had no written contract, and typing it
     * `IDataEngine` would have been "the more comfortable-looking lie" that
     * buries the gap under casts. That record was the input for
     * {@link IObjectQLEngine}, which now declares the full engine and is
     * checked against the class by `implements` — so the honest type finally
     * exists, and this accessor uses it.
     */
    getObjectQL(context: HttpProtocolContext, environmentId?: string): Promise<IObjectQLEngine | null>;
    /**
     * Service lookup on the request's RESOLVED (per-environment) kernel —
     * NOT the default kernel and NOT the scoped-factory path. Domains whose
     * data must live in the same store as their service bindings (e.g.
     * share-links: the token row and the shared record sit next to the
     * `shareLinks` service's engine) read through this and fall back to
     * `resolveService` themselves.
     *
     * [#4127 batch 4] The third and last lookup path on this contract, split by
     * the same rule as `resolveService`. It resolves the SAME slots off a
     * different kernel, so a slot's contract cannot depend on which path
     * reached it — and its one caller proves the point: `share-links` tries
     * this path and falls back to `resolveService` for the same `'objectql'`
     * slot, so before this the two arms of one expression had different types.
     */
    getRequestKernelService<K extends keyof ServiceSlotContracts>(context: HttpProtocolContext, name: K): Promise<ServiceSlotContract<K> | undefined>;
    getRequestKernelService(context: HttpProtocolContext, name: string): Promise<any>;
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
    announceKernelEvent(context: HttpProtocolContext, event: string, payload: unknown): Promise<void>;
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
    getRegisteredAiRoutes(context: HttpProtocolContext): Array<{ method: string; path: string; handler: (req: any) => Promise<any>; auth?: boolean }> | undefined;
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

    /**
     * The route claiming `path` (+`method`) when — and only when — it declared
     * itself a liveness probe ({@link DomainRoute.liveness}); otherwise
     * `undefined`.
     *
     * DERIVED, not listed: it is {@link resolve} plus one field read, so the
     * liveness set is a projection of the live route table and cannot name a
     * route that is not registered, miss one that is, or disagree with the
     * matcher about which route a path reaches. First-match-wins is inherited
     * too — a non-liveness route registered earlier shadows here exactly as it
     * shadows in `resolve`, because that is the route the request would get.
     */
    resolveLiveness(path: string, method: string): DomainRoute | undefined {
        const route = this.resolve(path, method);
        return route?.liveness ? route : undefined;
    }

    private static matches(route: DomainRoute, path: string): boolean {
        switch (route.match) {
            case 'exact':
                return path === route.prefix;
            case 'prefix':
                // Bare `startsWith`, no segment boundary — the legacy
                // if-chain's shape, now reachable only by asking for it.
                return path.startsWith(route.prefix);
            default:
                return path === route.prefix || path.startsWith(route.prefix + '/');
        }
    }

    /** Registered routes, in match order (introspection / tests). */
    list(): readonly DomainRoute[] {
        return this.routes;
    }
}
