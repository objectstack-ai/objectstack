// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    ObjectKernel, getEnv, evaluateAuthGate, isAuthGateAllowlisted,
} from '@objectstack/core';
import { isMcpServerEnabled, looksLikeInternalErrorLeak, INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { measureServerTiming, allowPerfDisclosure, isPerfDisclosurePrincipal } from '@objectstack/observability';
import { CoreServiceName, serviceUnavailableMessage, inProcessServiceMessage } from '@objectstack/spec/system';
import type { IDataEngine, IObjectQLEngine } from '@objectstack/spec/contracts';
import { readServiceSelfInfo, DispatcherErrorCode, resolveDiscoveryEnvironment } from '@objectstack/spec/api';
import { apiErrorResponse } from './error-envelope.js';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DomainHandlerRegistry, type DomainRoute, type DomainHandlerDeps } from './domain-handler-registry.js';
// `import * as actionExec from './action-execution.js'` was dropped in #4936:
// the dispatcher's own `callData` delegate was its last consumer here, and the
// delegate died with the `handleApiEndpoint` branch. The domain modules import
// `action-execution` for themselves. What came back in #5040 E5b is the TYPE
// only — `actionExecutionDeps` hands the endpoint step the same `deps` object
// every domain already passes to `callData`, without this file calling it.
import type { ActionExecutionDeps } from './action-execution.js';
import { createAnalyticsDomain, handleAnalyticsRequest } from './domains/analytics.js';
import { isServiceServeable } from './service-serveable.js';
import { createI18nDomain, handleI18nRequest } from './domains/i18n.js';
import { createNotificationsDomain, handleNotificationRequest } from './domains/notifications.js';
import { createSecurityDomain, handleSecurityRequest } from './domains/security.js';
import { createKeysDomains, handleKeysRequest } from './domains/keys.js';
import { createUiDomain, handleUiRequest } from './domains/ui.js';
import { createShareLinksDomain, handleShareLinksRequest } from './domains/share-links.js';
import { createPackagesDomain, handlePackagesRequest } from './domains/packages.js';
import { createAutomationDomain, handleAutomationRequest } from './domains/automation.js';
import { createAuthDomain, handleAuthRequest } from './domains/auth.js';
import { createAiDomain, handleAIRequest } from './domains/ai.js';
import { createActionsDomain, handleActionsRequest } from './domains/actions.js';
import { createMcpDomains, handleMcpRequest, handleMcpSkillRequest, buildMcpBridge } from './domains/mcp.js';
import { createMetaDomain, handleMetadataRequest } from './domains/meta.js';
import { createDataDomain, handleDataRequest } from './domains/data.js';

/** Minimal local interface — full EnvironmentScopeManager was removed in Phase R. */
interface EnvironmentScopeManager {
    touch(environmentId: string): void;
}
import {
    resolveExecutionContext,
    isPermissionDeniedError,
} from './security/resolve-execution-context.js';
import {
    permissionDeniedErrorDetails,
    describeDeniedDiagnostics,
} from './security/permission-denied-envelope.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from './validation-failure.js';

// randomUUID moved to ./domains/auth.ts with its only consumer (D11③ PR-7).


// The per-request `Server-Timing` disclosure predicate (#2408) now lives in
// `@objectstack/observability` — the ONE definition shared by every HTTP entry
// point that resolves a principal (this dispatcher, the REST server, the
// standalone Hono CRUD surface), so an admin-serving path can never drift into
// under- or over-disclosing (#3361). Re-exported here for back-compat with the
// dispatcher's existing consumers/tests.
export { isPerfDisclosurePrincipal } from '@objectstack/observability';

export interface HttpProtocolContext {
    request: any;
    response?: any;
    environmentId?: string;   // Resolved environment ID (set by the host's KernelResolver)
    dataDriver?: any; // IDataDriver - Resolved environment-scoped driver (set by the host's KernelResolver)
    /**
     * Dispatcher-provided hint for the host's {@link KernelResolver}: the
     * cleaned route path (API prefix stripped). Lets the resolver apply its
     * own path policy (e.g. skip env resolution for control-plane routes)
     * without re-deriving the dispatcher's URL handling.
     */
    routePath?: string;
    /**
     * Dispatcher-provided hint for the host's {@link KernelResolver}: the
     * UNVALIDATED environment-id candidate parsed from the scoped URL form
     * (`/environments/:id/...`) or the router's `params.environmentId`.
     * URL parsing is the dispatcher's routing convention, so it stays here;
     * validation (registry lookup) is the resolver's job.
     */
    urlEnvironmentId?: string;
    /**
     * Identity envelope resolved by `resolveExecutionContext` and threaded
     * into every ObjectQL call so the SecurityPlugin middleware can apply
     * RBAC/RLS/FLS. Optional — anonymous requests carry an empty context.
     */
    executionContext?: ExecutionContext;
    /**
     * The kernel THIS request is served from (#5155).
     *
     * Written by {@link HttpDispatcher.resolveRequestScope}: the host's
     * {@link KernelResolver} picks it, or it is the dispatcher's own
     * `defaultKernel` when no resolver is registered / the resolver declines.
     * Every service lookup the request makes afterwards — identity
     * resolution, the domain handler, `callData` — resolves off THIS field.
     *
     * It lives on the per-request context and NOT on the dispatcher because
     * one `HttpDispatcher` serves every route of a host: a single mutable
     * `this.kernel` written per request and read across the request's
     * subsequent `await`s let two interleaved requests on a multi-tenant host
     * swap data sources under each other — request A resuming after request B
     * resolved a different environment read B's kernel. Node's single thread
     * only protects code that does NOT hold mutable shared state across an
     * `await`; that code held it across several.
     *
     * Undefined until `resolveRequestScope` has run. Consumers must never
     * default it themselves — `HttpDispatcher.requestKernel()` owns the one
     * "not placed in any environment → the host kernel" answer.
     */
    kernel?: ObjectKernel;
}

export interface HttpDispatcherResult {
    handled: boolean;
    response?: {
        status: number;
        body?: any;
        headers?: Record<string, string>;
    };
    result?: any; // For flexible return types or direct response objects (Response/NextResponse)
}

/**
 * ADR-0006 generic kernel-resolution seam.
 *
 * A host (e.g. ObjectStack Cloud) injects a resolver to own per-request
 * kernel selection. The framework ships NO multi-tenant implementation — all
 * hostname→env strategy, the per-env kernel cache, and the control plane live
 * in the host distribution (`@objectstack/objectos-runtime`). When no resolver
 * is injected the dispatcher serves every request from its single
 * `defaultKernel` (single-environment mode).
 *
 * Returning `undefined` routes the request to `defaultKernel` — resolvers use
 * this for control-plane / unscoped / single-environment requests.
 *
 * As of ADR-0006 Phase 5 the resolver owns the ENTIRE per-request environment
 * resolution, not just kernel selection: the dispatcher no longer performs any
 * hostname / header / session → environment lookup of its own. The dispatcher
 * provides parsing hints on the context (`routePath`, `urlEnvironmentId`) and
 * expects the resolver to SET `context.environmentId` (and optionally
 * `context.dataDriver`) for scoped requests — downstream dispatcher stages
 * (project-membership enforcement, scope TTL touch, scoped service resolution)
 * key off `context.environmentId`.
 */
export interface KernelResolver {
    resolveKernel(
        context: HttpProtocolContext,
        defaultKernel: ObjectKernel,
    ): Promise<ObjectKernel | undefined> | ObjectKernel | undefined;
}

/**
 * Optional configuration passed to the dispatcher constructor. Supports the
 * legacy `enforceProjectMembership` toggle plus the new multi-kernel
 * scheduling hook required by ADR-0003's cloud runtime mode.
 */
export interface HttpDispatcherOptions {
    enforceProjectMembership?: boolean;
    /**
     * Optional generic kernel-resolution seam (ADR-0006). The SOLE
     * multi-tenant hook: the host's resolver owns env resolution + kernel
     * selection per request (see {@link KernelResolver}). Falls back to
     * `resolveService('kernel-resolver')`. Hosts that register none run
     * single-environment on `defaultKernel`. (The legacy `kernelManager`
     * option and the dispatcher's built-in hostname/header/session
     * resolution were removed in ADR-0006 Phase 5 — that strategy lives in
     * the cloud distribution's resolver now.)
     */
    kernelResolver?: KernelResolver;
    /**
     * Optional {@link EnvironmentScopeManager}. When present, `touch(environmentId)` is
     * called on every scoped request so idle projects are evicted after TTL.
     */
    scopeManager?: EnvironmentScopeManager;
}

/**
 * The HTTP dispatch engine — translates an inbound (method, path, body, ctx)
 * request into a kernel response. Used directly by the framework's HTTP adapters
 * (express / fastify / nextjs / nestjs / nuxt / sveltekit / hono) and plugin-msw,
 * which need a *callable* dispatcher.
 *
 * NOTE: `createDispatcherPlugin()` is a different thing — a kernel plugin that
 * registers routes on a kernel-hosted HTTP server. It is NOT a drop-in for
 * adapters. Retiring this public class behind a `createHttpDispatcher()` factory
 * is tracked in #2380 (a deliberate adapter-API change, not yet done) — so this
 * is intentionally NOT marked `@deprecated` while no working replacement exists.
 */
export class HttpDispatcher {
    /**
     * The HOST kernel this dispatcher was constructed with — process-lifetime
     * state, never per-request. Everything that describes the replica rather
     * than a request (`/ready`, the driver-health probe, the single-environment
     * default) reads it directly; a request reads `context.kernel`
     * ({@link HttpProtocolContext.kernel}) instead. There is deliberately no
     * `this.kernel` (#5155).
     */
    private readonly defaultKernel: ObjectKernel;
    private defaultProject?: { environmentId: string; orgId?: string };
    private kernelResolver?: KernelResolver;
    private scopeManager?: EnvironmentScopeManager;
    /**
     * ADR-0076 D11 step ③ decomposition seam — consulted by `dispatch()`
     * before the legacy if-chain. See {@link DomainHandlerRegistry}.
     */
    private readonly domainRegistry = new DomainHandlerRegistry();
    /**
     * Short-TTL memo for `/ready`'s driver probe (framework#3756). Kubernetes
     * polls readiness every few seconds per replica; without this, every poll
     * would be a database round-trip. One second is short enough that the
     * verdict tracks an outage within a single probe interval and long enough
     * that concurrent probes collapse onto one query.
     */
    private driverHealthMemo?: { at: number; unhealthy: string[] };
    private static readonly DRIVER_HEALTH_TTL_MS = 1_000;
    /**
     * When `true`, scoped data-plane routes enforce a
     * `sys_environment_member` lookup and return 403 for non-members.
     * Defaults to `true` when a environmentId is resolvable — legacy callers
     * can opt out via the third constructor argument (see
     * `DispatcherConfig.enforceProjectMembership`).
     */
    private enforceMembership: boolean;
    /**
     * In-memory cache of positive membership checks, keyed by
     * `${environmentId}:${userId}`. Entries expire 60 seconds after insertion
     * — a short TTL is acceptable because a user whose access was just
     * revoked sees stale access for at most one minute.
     */
    private membershipCache: Map<string, number> = new Map();
    private static readonly MEMBERSHIP_CACHE_TTL_MS = 60_000;
    /** Well-known system project id — bypassed for any authenticated user. */
    private static readonly SYSTEM_ENVIRONMENT_ID = '00000000-0000-0000-0000-000000000001';
    /** Well-known platform org id — members bypass project membership. */
    private static readonly PLATFORM_ORG_ID = '00000000-0000-0000-0000-000000000000';

    /**
     * @param _envRegistryIgnored — RETIRED (ADR-0006 Phase 5). Environment
     * resolution moved behind the host's {@link KernelResolver}; the
     * positional parameter is kept so existing 3-arg callers keep compiling,
     * but its value is ignored.
     */
    constructor(kernel: ObjectKernel, _envRegistryIgnored?: unknown, options?: HttpDispatcherOptions) {
        this.defaultKernel = kernel;
        const resolveService = (name: string): any => {
            try { return (kernel as any).getService?.(name); } catch { return undefined; }
        };
        this.enforceMembership = options?.enforceProjectMembership ?? true;
        // ADR-0006 kernel-resolution seam — the host's resolver owns env
        // resolution + kernel selection. Optional service so single-environment
        // hosts that register none are unchanged.
        this.kernelResolver = options?.kernelResolver ?? resolveService('kernel-resolver');
        this.scopeManager = options?.scopeManager ?? resolveService('scope-manager');
        // Single-project default is resolved lazily on first request — the
        // plugin that registers it (`createSingleEnvironmentPlugin`) may run
        // its `init()` after the HttpDispatcher is constructed.
        this.registerBuiltinDomains();
    }

    /**
     * The explicit dispatcher-facility contract extracted domain bodies run
     * against (ADR-0076 D11 step ③ PR-2). One instance per dispatcher;
     * methods bound here are the ONLY dispatcher surface a domain module may
     * touch — see {@link DomainHandlerDeps}.
     */
    private readonly domainDeps: DomainHandlerDeps = {
        // [#4127] Both are slot-typed on the deps contract now (`resolveService`
        // via overloads, since it also takes non-core names like `protocol`).
        // The parameters are annotated because an arrow cannot be contextually
        // typed against an overloaded signature. Resolution below stays
        // name-based and unchanged — the typing lives in what the DOMAINS see.
        //
        // [#5155] Every kernel-reading facility takes the REQUEST as its first
        // parameter. This object is built once and shared by every request the
        // host serves, so it cannot hold "the kernel of the request in flight"
        // — there is no such thing here. The request carries its own.
        resolveService: (context: HttpProtocolContext, name: string, environmentId?: string) =>
            this.resolveService(this.requestKernel(context), name, environmentId),
        getService: (context: HttpProtocolContext, name: string) =>
            this.getService(this.requestKernel(context), name as Parameters<HttpDispatcher['getService']>[1]),
        getObjectQL: (context, environmentId) =>
            this.getObjectQLService(this.requestKernel(context), environmentId),
        // Reads off the request's OWN resolved kernel — never the scoped
        // factory, never the host kernel. See the deps contract note.
        // [#4127 batch 4] Annotated for the same reason as the two above: an
        // arrow cannot be contextually typed against an overloaded signature.
        getRequestKernelService: async (context: HttpProtocolContext, name: string) => {
            const k: any = this.requestKernel(context);
            return typeof k?.getServiceAsync === 'function'
                ? k.getServiceAsync(name)
                : k?.getService?.(name);
        },
        success: (data, meta) => this.success(data, meta),
        error: (message, code, details) => this.error(message, code, details),
        routeNotFound: (route) => this.routeNotFound(route),
        errorFromThrown: (e, fallbackStatus) => this.errorFromThrown(e, fallbackStatus),
        resolveActiveOrganizationId: (context) => this.resolveActiveOrganizationId(context),
        announceKernelEvent: async (context, event, payload) => {
            const k: any = this.requestKernel(context);
            if (k?.context?.trigger) await k.context.trigger(event, payload);
        },
        logger: (this as any).logger,
        getDefaultEnvironmentId: () => this.resolveDefaultProject()?.environmentId,
        isMultiTenantHost: () => !!this.kernelResolver,
        resolveProjectKernelObjectQL: async (context) => {
            if (!this.kernelResolver || !context.environmentId || context.environmentId === 'platform') return null;
            try {
                const projectKernel: any = await this.kernelResolver.resolveKernel(context, this.defaultKernel);
                if (projectKernel) {
                    // The swap this seam owns, written where it belongs: on THIS
                    // request. Its callers keep making `deps.*` lookups
                    // afterwards and must see the swapped kernel — but only they
                    // may (#5155).
                    context.kernel = projectKernel;
                    if (typeof projectKernel.getServiceAsync === 'function') {
                        return await projectKernel.getServiceAsync('objectql').catch(() => null);
                    }
                }
            } catch { /* fall back to defaultKernel resolution downstream */ }
            return null;
        },
        getRegisteredAiRoutes: (context) => (this.requestKernel(context) as any)?.__aiRoutes,
    };

    /**
     * The kernel a given request is served from — the ONE place that answers
     * it (#5155).
     *
     * `resolveRequestScope` writes {@link HttpProtocolContext.kernel} on every
     * request that goes through `dispatch()` or the declarative-endpoint
     * fallback. A context that never went through it has not been placed in
     * any environment, and the honest answer for one of those is the HOST
     * kernel — which is what a single-environment deployment serves from
     * anyway. It is emphatically NOT "whichever tenant resolved most
     * recently", which is what a dispatcher-level field answered before.
     *
     * Domains must never write this fallback themselves: a `??` at a call site
     * is how a second, quieter answer to "which kernel" gets born.
     */
    private requestKernel(context: HttpProtocolContext | undefined): any {
        return context?.kernel ?? this.defaultKernel;
    }

    /**
     * Whether this dispatcher serves a multi-tenant host (a `kernel-resolver`
     * is wired, so each request may resolve to a different per-project
     * kernel). Consulted by the dispatcher plugin's capability-conditional
     * route mounting (#3891 follow-through): on a multi-tenant host, route
     * mounts are host-global while optional services live per project kernel,
     * so "is the capability installed" is a per-request question the domain
     * handler answers — never a mount-time one.
     */
    isMultiTenantHost(): boolean {
        return !!this.kernelResolver;
    }

    /**
     * Resolve the per-request ENVIRONMENT, kernel and identity envelope — the
     * step {@link dispatch} performs before any handler runs, extracted so a
     * caller that serves from OUTSIDE the route pipeline gets the SAME answers
     * rather than a lookalike.
     *
     * It mutates `context` in place, exactly as it always did inside
     * `dispatch()`: the host's resolver writes `environmentId` (+ `dataDriver`),
     * the identity step writes `executionContext`, and `context.kernel` is set
     * to the kernel this request is served from.
     *
     * That last one used to be a dispatcher FIELD (#5155). One dispatcher
     * serves the whole host, so a field could only ever hold "the kernel of
     * the request that resolved most recently" — and every reader of it sat
     * behind at least one `await`. Writing it on the context is what makes two
     * interleaved requests on two environments independent.
     *
     * ## Its one out-of-band caller (#5040 E5b)
     *
     * The declarative-endpoint step runs in the transport's
     * `setFallbackHandler` seam, which `dispatch()` deliberately never sees
     * (#5090 keeps unmatched requests out of the dispatch pipeline). But that
     * step DELEGATES into `callData` and the automation service, so it needs
     * precisely what a `/data` request has: the request's kernel, its
     * environment, its driver, and its `ExecutionContext`. Restating this block
     * there would be a second, weaker identity resolution — and #4936 is the
     * record of what a data call with no `ExecutionContext` does: it reads as
     * the system principal with RLS bypassed.
     *
     * `cleanPath` is the dispatcher's cleaned route path (trailing slash
     * trimmed). It feeds URL parsing hints and the MCP-only OAuth decision
     * below, nothing else.
     */
    async resolveRequestScope(context: HttpProtocolContext, cleanPath: string): Promise<void> {
        // ── Environment Resolution + Multi-Kernel Routing (ADR-0006 Phase 5) ──
        // The host's KernelResolver owns the whole step: it resolves the
        // request to an environment (hostname / header / session / defaults —
        // strategy lives in the cloud distribution), SETS
        // `context.environmentId` (+ `dataDriver`), and returns the kernel to
        // serve from. The dispatcher only contributes parsing hints. No
        // resolver registered → single-environment: every request serves from
        // `defaultKernel` with no environment context.
        this.prepareResolverHints(context, cleanPath);
        // [#5155] The resolved kernel is written on the REQUEST, not on the
        // dispatcher. Two requests interleaving across the awaits below (and
        // across every await their handlers make afterwards) each keep their
        // own; before this, the second resolution silently moved the first
        // request onto the second one's environment.
        if (this.kernelResolver) {
            context.kernel = (await this.kernelResolver.resolveKernel(context, this.defaultKernel)) ?? this.defaultKernel;
        } else {
            context.kernel = this.defaultKernel;
        }

        // Touch scope for TTL/LRU tracking in shared-kernel mode
        if (this.scopeManager && context.environmentId && context.environmentId !== 'platform') {
            this.scopeManager.touch(context.environmentId);
        }

        // ── Identity Resolution (RBAC/RLS/FLS context) ──
        // Resolve once per request; SecurityPlugin middleware reads
        // ctx.userId/roles/permissions/tenantId via opCtx.context.
        try {
            context.executionContext = await this.timedResolveExecutionContext({
                getService: (n: string) => this.resolveService(this.requestKernel(context), n, context.environmentId),
                // Resolve ObjectQL from the per-request kernel DIRECTLY. The scoped
                // `resolveService('objectql', envId)` factory can return a different
                // instance that doesn't see THIS env's rows (the gotcha
                // `handleActions` works around) — which made the api-key lookup miss
                // `sys_api_key` on the MCP path and reject valid keys with 401, while
                // REST accepted them (rest-server resolves identity via
                // `kernel.getServiceAsync('objectql')`). Resolving off THIS REQUEST's
                // kernel keeps REST + MCP identity resolution aligned; falls back to
                // the scoped path when the kernel can't hand back an objectql
                // directly. [#5155] `context.kernel`, not a dispatcher field — this
                // closure runs after several awaits, which is exactly where a shared
                // field used to be rewritten by the next request.
                getQl: async () => {
                    const k: any = this.requestKernel(context);
                    if (k && typeof k.getServiceAsync === 'function') {
                        const ql = await k.getServiceAsync('objectql').catch(() => undefined);
                        if (ql && (ql.registry || typeof ql.find === 'function')) return ql;
                    }
                    return this.getObjectQLService(this.requestKernel(context), context.environmentId);
                },
                request: context.request,
                // OAuth 2.1 access tokens are honoured ONLY on the MCP
                // surface (#2698): their coarse tool-family scopes are
                // enforced at MCP tool dispatch, which other routes don't do.
                // Matches the plain and `/projects/:id`-scoped route forms
                // (the scoped prefix is stripped only by the caller, later).
                acceptOAuthAccessToken: /^(?:\/projects\/[^/]+)?\/mcp(?:[/?]|$)/.test(cleanPath),
            });
        } catch {
            // anonymous request — leave executionContext undefined
        }
    }

    /**
     * The action-execution facilities — the `deps` argument
     * `action-execution.callData(deps, …)` takes — bound to this dispatcher's
     * per-request kernel.
     *
     * Every live data path already calls `callData` with exactly this object;
     * it reaches them as part of {@link DomainHandlerDeps} because they are
     * domain modules. The declarative-endpoint step is not a domain module (it
     * serves from the fallback seam, outside `dispatch()`), so it needs the same
     * object by a name it can ask for. Exposing the NARROW `ActionExecutionDeps`
     * view rather than the whole dispatcher-facility contract is the point: the
     * endpoint executor may look services up and run data calls, and nothing
     * else.
     */
    get actionExecutionDeps(): ActionExecutionDeps {
        return this.domainDeps;
    }

    /**
     * ADR-0076 D11 step ③ — seed the domain registry with the domains lifted
     * out of the `dispatch()` if-chain. Bodies of the four service-backed
     * domains live under `./domains/` (PR-2); `/health` + `/ready` stay
     * inline because their "body" IS dispatcher state (kernel lifecycle).
     * Registration stays dispatcher-owned for multi-provider service slots —
     * see {@link DomainHandlerRegistry} for the rationale.
     */
    private registerBuiltinDomains(): void {
        // GET /health — liveness probe (was branch "0b").
        //
        // Deliberately checks NOTHING beyond "this process is executing code",
        // and must stay that way (framework#3756). A failing liveness probe
        // makes the orchestrator RESTART the pod — which cannot fix an
        // unreachable database, but would put every replica into a restart
        // storm for the duration of the outage and kill in-flight requests
        // that had nothing to do with the data layer. The dependency check
        // belongs on `/ready`, whose failure mode (leave the LB rotation) is
        // the one that actually helps.
        this.domainRegistry.register({
            prefix: '/health', match: 'exact', methods: ['GET'],
            handler: async () => ({
                handled: true,
                response: this.success({
                    status: 'ok',
                    timestamp: new Date().toISOString(),
                    version: '1.0.0',
                    uptime: typeof process !== 'undefined' ? process.uptime() : undefined,
                }),
            }),
        });
        // GET /ready — k8s / load-balancer readiness probe (was branch "0b2").
        // 200 only when the kernel is fully running AND the data drivers can
        // serve a query. 503 while booting (idle/initializing) or shutting down
        // (stopping/stopped) so a load balancer stops routing to this replica
        // BEFORE in-flight requests are drained and the server closes (graceful
        // rolling restart) — and 503 when a driver is down, so a replica that
        // would fail 100% of its requests leaves the rotation instead of
        // absorbing traffic (framework#3756).
        this.domainRegistry.register({
            prefix: '/ready', match: 'exact', methods: ['GET'],
            handler: async () => {
                // [#5155] The HOST kernel, deliberately: readiness is a
                // property of this replica, not of whichever tenant happens to
                // have made the last request.
                const host: any = this.defaultKernel;
                const state: string = typeof host?.getState === 'function'
                    ? host.getState()
                    : 'running';
                if (state !== 'running') {
                    return { handled: true, response: this.error('Service not ready', 503, { state }) };
                }
                const unhealthy = await this.unhealthyDrivers();
                return unhealthy.length === 0
                    ? { handled: true, response: this.success({ status: 'ready', state }) }
                    : {
                        handled: true,
                        response: this.error('Data driver unavailable', 503, {
                            state,
                            drivers: unhealthy,
                        }),
                    };
            },
        });
        this.domainRegistry.register(createAnalyticsDomain(this.domainDeps));
        this.domainRegistry.register(createI18nDomain(this.domainDeps));
        this.domainRegistry.register(createNotificationsDomain(this.domainDeps));
        this.domainRegistry.register(createSecurityDomain(this.domainDeps));
        for (const route of createKeysDomains(this.domainDeps)) this.domainRegistry.register(route);
        // No `/storage` domain (#4087): the dispatcher's two-route bridge was
        // retired. `/api/v1/storage` is service-storage's surface — it mounts
        // the presigned / chunked / signed-URL protocol autonomously on the
        // host http-server. See route-ledger.ts for the disposition.
        this.domainRegistry.register(createUiDomain(this.domainDeps));
        this.domainRegistry.register(createShareLinksDomain(this.domainDeps));
        this.domainRegistry.register(createPackagesDomain(this.domainDeps));
        this.domainRegistry.register(createAutomationDomain(this.domainDeps));
        this.domainRegistry.register(createAuthDomain(this.domainDeps));
        this.domainRegistry.register(createAiDomain(this.domainDeps));
        this.domainRegistry.register(createActionsDomain(this.domainDeps));
        for (const route of createMcpDomains(this.domainDeps)) this.domainRegistry.register(route);
        this.domainRegistry.register(createMetaDomain(this.domainDeps));
        this.domainRegistry.register(createDataDomain(this.domainDeps));
    }

    /**
     * Public registration seam for follow-up D11 domain PRs: an owning
     * service package registers its normalized handler here instead of the
     * dispatcher hard-coding another if-branch. Entries are consulted before
     * the legacy if-chain, first match wins.
     */
    registerDomainHandler(route: DomainRoute): void {
        this.domainRegistry.register(route);
    }

    /**
     * Names of the data drivers that cannot serve a query right now, for
     * `/ready` (framework#3756). Empty means "no reason to leave the LB
     * rotation" — which includes every case where we cannot tell.
     *
     * Fails OPEN by design, and the asymmetry is deliberate: readiness gates
     * whether this replica receives ANY traffic, so an inconclusive probe must
     * not black-hole a working deployment. A kernel with no data engine (lite
     * kernels, edge, metadata-only hosts), an engine predating
     * `checkDriversHealth`, or a probe that itself throws all read as ready —
     * exactly as they did before this check existed. Only a driver that
     * positively reports itself unhealthy takes the replica out.
     */
    private async unhealthyDrivers(): Promise<string[]> {
        const memo = this.driverHealthMemo;
        if (memo && Date.now() - memo.at < HttpDispatcher.DRIVER_HEALTH_TTL_MS) {
            return memo.unhealthy;
        }
        let unhealthy: string[] = [];
        try {
            // [#4251] `checkDriversHealth` is ObjectQL's (IObjectQLEngine), not
            // `IDataEngine`'s — and this lookup resolves the `data` slot, whose
            // ledger entry deliberately stays the narrow view. Partial<Pick<…>>
            // names the one wider member probed; the probe below is what runs
            // when the slot holds an engine without a driver-health surface.
            let engine: (IDataEngine & Partial<Pick<IObjectQLEngine, 'checkDriversHealth'>>) | undefined;
            try {
                // [#5155] Host kernel — see the `/ready` handler.
                engine = (this.defaultKernel as any)?.getService?.('data');
            } catch {
                // 'data' not registered — no data plane to gate readiness on.
            }
            if (typeof engine?.checkDriversHealth === 'function') {
                const results = await engine.checkDriversHealth();
                unhealthy = (Array.isArray(results) ? results : [])
                    .filter((r: any) => r && r.healthy === false)
                    .map((r: any) => String(r.driverName));
            }
        } catch {
            // The probe itself failed — inconclusive, not unhealthy. See above.
            unhealthy = [];
        }
        this.driverHealthMemo = { at: Date.now(), unhealthy };
        return unhealthy;
    }

    private resolveDefaultProject(): { environmentId: string; orgId?: string } | undefined {
        if (this.defaultProject) return this.defaultProject;
        try {
            // [#5155] Host kernel: `createSingleEnvironmentPlugin` registers
            // this slot on the host, and the answer is memoized for the
            // process — reading it off a per-request kernel would freeze one
            // request's environment into dispatcher-lifetime state.
            const v = (this.defaultKernel as any).getService?.('default-project');
            if (v?.environmentId) {
                this.defaultProject = v;
                return v;
            }
        } catch {
            // service not registered — single-environment plugin not in stack
        }
        return undefined;
    }

    /**
     * Resolve the per-request identity/session, timed as the `auth`
     * `Server-Timing` span — the prime suspect for unexplained data-API
     * overhead (session lookup, org-scope resolution). A no-op wrapper when
     * perf-tuning is off, so it costs nothing on the normal path.
     */
    private async timedResolveExecutionContext(
        opts: Parameters<typeof resolveExecutionContext>[0],
    ): Promise<ExecutionContext> {
        const ec = await measureServerTiming('auth', () => resolveExecutionContext(opts), 'Identity/session');
        // Perf-tuning disclosure gate (#2408): when timing was opened
        // per-request via `X-OS-Debug-Timing`, the `Server-Timing` header stays
        // withheld until the request proves an admin/service identity — never
        // leak phase timings to an ordinary caller. A no-op when perf-tuning is
        // off or already global (no gate, or gate already open).
        if (isPerfDisclosurePrincipal(ec)) allowPerfDisclosure();
        return ec;
    }

    private success(data: any, meta?: any) {
        return {
            status: 200,
            body: { success: true, data, meta }
        };
    }

    /**
     * The single construction point for every error response this dispatcher
     * RETURNS. Distinct from `dispatcher-plugin`'s `errorResponseBase`, which
     * covers the errors that are THROWN out of `dispatch()` — a returned
     * `{handled: true, response}` goes to `sendResult`, never through that
     * catch. #3867 sanitised the thrown path; this is the returned one, and it
     * needs the same guard for the same reason.
     *
     * Reachable with a raw driver/engine message today via
     * {@link errorFromThrown} (`/meta` save, `/packages` install) and the MCP
     * transport's `deps.error(err?.message, 500)` — any of which can be
     * carrying a SQL dump naming physical tables and columns.
     *
     * Scoped to 5xx: a 4xx message is a deliberate business/validation answer
     * (`Path must be /actions/:object/:action`, a hook's own `throw`, a
     * `saveMetaItem` field error) and must reach the caller intact. `details`
     * is left alone apart from the code promotion below — it carries structured
     * `issues`/`fields` the UI maps to fields, never free-form driver prose.
     *
     * The unsanitised error is not lost: callers that THREW still hand the
     * original to `errorReporter` via `__obsRecordedError`, and every 5xx is
     * logged server-side.
     *
     * [#3842] The second parameter is the HTTP status and always was — it is now
     * named for what it is, and lands in `error.httpStatus` instead of
     * `error.code`, which goes back to being the semantic string
     * `ApiErrorSchema` declares. Call sites are unchanged: a site that already
     * expressed its real code as `details.code` gets it promoted into
     * `error.code` by the shared builder, and a site that has none gets one
     * derived from the status. See `./error-envelope.ts`.
     */
    private error(message: string, httpStatus: number = 500, details?: any) {
        const safe =
            httpStatus >= 500 && looksLikeInternalErrorLeak(message)
                ? INTERNAL_ERROR_MESSAGE
                : message;
        return apiErrorResponse({ message: safe, httpStatus, details });
    }

    /**
     * Build an error response from a THROWN service/protocol error, preserving
     * the error's own HTTP `status` and — critically — any structured `issues`
     * array (e.g. spec-validation `{ path, message, code }[]` from
     * `protocol.saveMetaItem`). The plain `error(msg, status)` path collapses a
     * validation failure to a single message, so the UI can only show a generic
     * banner; carrying `issues` in `details` lets it map each error back to the
     * offending field. Falls back to `fallbackStatus` and behaves exactly like
     * `error()` for errors that carry neither.
     *
     * [#3842] The error's own `.code` still travels as `details.code` from here,
     * which is the carrier `buildApiError` promotes into `error.code` — so it
     * ends up in the declared field without this method needing to know how the
     * envelope is assembled.
     *
     * [#3918] A record-level `ValidationError` is the third structured shape,
     * and it used to fall through BOTH branches: it carries no `.status` (so a
     * `/meta`-style 400 fallback saved it, but a 500-fallback caller did not)
     * and no `.issues` (so its `.fields[]` — the whole point — was dropped and
     * the UI could only show a banner). It now maps the way
     * `@objectstack/rest`'s `mapDataError` has always mapped it: status 400,
     * `fields[]` passed through in `details`. An explicit `.status` /
     * `.statusCode` still wins, so this only supplies the fallback.
     */
    private errorFromThrown(e: any, fallbackStatus = 500) {
        const validation = validationFailureDetails(e);
        const status =
            typeof e?.status === 'number' ? e.status
            : typeof e?.statusCode === 'number' ? e.statusCode
            : validation ? VALIDATION_FAILED_STATUS
            : fallbackStatus;
        const issues = Array.isArray(e?.issues) ? e.issues : undefined;
        const details =
            issues || e?.code || validation
                ? {
                    ...(e?.code ? { code: e.code } : {}),
                    ...(issues ? { issues } : {}),
                    // Last so `code` is pinned to VALIDATION_FAILED even when the
                    // error was matched by `name` alone and carries no `.code`.
                    ...(validation ?? {}),
                }
                : undefined;
        return this.error(e?.message ?? String(e), status, details);
    }


    /**
     * 404 Route Not Found — no route is registered for this path.
     *
     * [#3842] `ROUTE_NOT_FOUND` used to sit in `error.type` — a THIRD spelling,
     * sibling to a numeric `error.code` — because `code` was taken by the status.
     * It is now the `code`, spelled from the spec's own `DispatcherErrorCode` so
     * the string has exactly one definition. `route` and `hint` stay siblings:
     * `DispatcherErrorResponseSchema` declares them as part of this error, not as
     * `details` context.
     */
    private routeNotFound(route: string) {
        return apiErrorResponse({
            code: DispatcherErrorCode.enum.ROUTE_NOT_FOUND,
            message: `Route Not Found: ${route}`,
            httpStatus: 404,
            extra: {
                route,
                hint: 'No route is registered for this path. Check the API discovery endpoint for available routes.',
            },
        });
    }

    // The private `callData` delegate that stood here was removed with
    // `handleApiEndpoint` in #4936 — that dead branch was its ONLY caller, and
    // `tsc` said so (TS6133) the moment the branch went. Every live data path
    // calls `actionExec.callData(deps, …)` directly from its domain module
    // (`domains/data.ts`, `domains/mcp.ts`, `domains/actions.ts`), which is the
    // D11③ shape anyway; the wrapper was a leftover of the pre-extraction
    // dispatcher.

    /** Thin delegate — body extracted to `./domains/mcp.ts` (D11③ PR-9). */
    async handleMcp(body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleMcpRequest(this.domainDeps, body, context);
    }

    /** Thin delegate — body extracted to `./domains/mcp.ts` (D11③ PR-9); kept for direct callers (tests). */
    buildMcpBridge(context: HttpProtocolContext): any {
        return buildMcpBridge(this.domainDeps, context);
    }

    /**
     * Whether the MCP HTTP surface is on for this single-env runtime.
     * Default-on core capability; `OS_MCP_SERVER_ENABLED=false` opts out
     * (single decision point: `isMcpServerEnabled` in `@objectstack/types`).
     */

    /** Thin delegate — body extracted to `./domains/mcp.ts` (D11③ PR-9). */
    async handleMcpSkill(method: string, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleMcpSkillRequest(this.domainDeps, method, context);
    }



    // ── MCP action bridge helpers ──────────────────────────────────────

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** True when an action is destructive by author signal/heuristic (HITL hint). */
    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Project an action's declarative metadata into a lean MCP summary. */
    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Map an ObjectStack field type to a JSON-Schema primitive (conservative). */
    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Resolve an action's params into LLM-facing summaries (field-backed types resolved). */
    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /**
     * Slim engine facade matching the ActionContext.engine shape handlers expect.
     *
     * ⚠️ TRUSTED (SECURITY-DEFINER-like) BY DESIGN (#2849): these calls carry NO
     * ExecutionContext, so the data engine's security middleware skips RLS / FLS /
     * CRUD / tenant scoping entirely. Action bodies are the app author's own code
     * and legitimately perform cross-object writes the invoking user could not
     * (convert-lead, cascade-close). The boundary is therefore enforced at INVOKE
     * time (`ai.exposed` + ADR-0066 D4 capability gate), and every dispatch is
     * audit-logged. Longer-term direction: an action-level `runAs: 'user'|'system'`
     * mirroring flows (ADR-0049) — tracked in #2849.
     */
    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */

    /** Thin delegate — body (incl. the zero-tolerance security contract) extracted to `./domains/keys.ts` (D11③ PR-3). */
    async handleKeys(method: string, body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleKeysRequest(this.domainDeps, method, body, context);
    }

    /**
     * Parse a project UUID out of a scoped URL path such as
     * `/api/v1/environments/abc-123/data/task` or `/projects/abc-123/meta`.
     * Returns `undefined` when the path does not match the scoped pattern.
     */
    /**
     * Parse an environment UUID out of a scoped URL path such as
     * `/api/v1/environments/abc-123/data/task` or `/environments/abc-123/meta`.
     * Returns `undefined` when the path does not match the scoped pattern.
     */
    private extractEnvironmentIdFromPath(path: string): string | undefined {
        if (!path) return undefined;
        const m = path.match(/\/environments\/([^/?#]+)/);
        if (!m) return undefined;
        const candidate = m[1];
        // Guard against matching control-plane routes like /cloud/environments.
        // `/environments/<id>` directly nested under the API prefix wins;
        // `/cloud/environments/<id>` is a CRUD endpoint on the control plane.
        if (path.includes('/cloud/environments/')) return undefined;
        return candidate;
    }

    /**
     * Attach the dispatcher's parsing hints for the host's
     * {@link KernelResolver} (ADR-0006 Phase 5).
     *
     * Environment RESOLUTION (hostname / x-environment-id / session /
     * org-default / single-env-default → environment + driver) is owned by
     * the host's resolver — the dispatcher no longer touches an environment
     * registry. What stays here is pure URL parsing (the dispatcher's own
     * routing convention): the scoped-path environment-id candidate and the
     * cleaned route path, both UNVALIDATED.
     */
    private prepareResolverHints(context: HttpProtocolContext, path: string): void {
        context.routePath = path;
        const urlEnvironmentId = this.extractEnvironmentIdFromPath(path)
            ?? context.request?.params?.environmentId;
        if (urlEnvironmentId) context.urlEnvironmentId = String(urlEnvironmentId);
    }

    /**
     * Check whether the authenticated user is a member of
     * `context.environmentId`. Runs after {@link resolveEnvironmentContext}
     * and is a no-op when:
     *
     *   - Membership enforcement is disabled via the constructor.
     *   - The route is control-plane (`/auth/*`, `/cloud/*`, `/health`,
     *     `/discovery`) — already skipped upstream.
     *   - No `environmentId` was resolved (e.g. unscoped legacy routes).
     *   - The project is the well-known system project (bypassed so any
     *     authenticated user can read platform metadata).
     *   - The user's active organization is the platform org (staff).
     *
     * Positive results are cached for 60 seconds to avoid hitting the
     * control-plane on every request. A failed check returns a 403
     * response object that callers should surface directly — no further
     * dispatch happens.
     */
    /**
     * ADR-0069 — returns a 403 response when the resolved session is blocked by
     * an auth-policy gate (expired password / required MFA) on a non-allow-listed
     * path, else null. Mirrors the REST `enforceAuth` seam so REST + dispatcher
     * (MCP) enforce consistently. Fails open on any lookup error.
     */
    private async enforceAuthGate(context: any, cleanPath: string): Promise<any | null> {
        try {
            if (isAuthGateAllowlisted(cleanPath)) return null;
            // [#4127 FINDING, batch 5]
            // `auth` IS contracted, so this `any` is not legitimate.
            // `isAuthGateActive` is implemented (auth-manager.ts) and load-bearing
            // — the whole auth gate turns on it — but IAuthService never declared
            // it. `packages/rest` probes it the same way, so two independent
            // callers agree on a member the contract does not mention.
            const authService = await this.resolveService(this.requestKernel(context), 'auth', context.environmentId);
            if (!authService || typeof authService.isAuthGateActive !== 'function' || !authService.isAuthGateActive()) {
                return null;
            }
            let api: any = authService.api;
            if (!api && typeof authService.getApi === 'function') api = await authService.getApi();
            if (!api?.getSession) return null;
            // Normalize headers to a Web Headers instance for getSession.
            const raw: any = context?.request?.headers;
            let headers: any;
            if (raw && typeof raw.get === 'function') {
                headers = raw;
            } else if (raw && typeof raw === 'object') {
                headers = new (globalThis as any).Headers();
                for (const k of Object.keys(raw)) {
                    const v = raw[k];
                    if (v != null) headers.set(String(k), Array.isArray(v) ? v.join(',') : String(v));
                }
            } else {
                return null;
            }
            const session: any = await api.getSession({ headers }).catch(() => undefined);
            const gate = evaluateAuthGate(session?.user, cleanPath);
            if (!gate) return null;
            return this.error(gate.message, 403, { code: gate.code });
        } catch {
            return null; // fail-open — never break dispatch on a gate hiccup
        }
    }

    private async enforceProjectMembership(
        context: HttpProtocolContext,
        path: string,
    ): Promise<{ status: number; body: any } | null> {
        if (!this.enforceMembership) return null;

        // Control-plane paths — never gated by project membership.
        const skipPaths = ['/auth', '/cloud', '/health', '/ready', '/discovery'];
        if (skipPaths.some(p => path.startsWith(p))) return null;

        // Public share-link resolve/messages — the token IS the authorisation,
        // so never gate them on project membership (a signed-in non-member
        // opening a public link must not be 403'd before the token handler runs).
        if (/(^|\/)share-links\/[^/]+\/(resolve|messages)$/.test(path)) return null;

        const environmentId = context.environmentId;
        if (!environmentId) return null; // Unscoped legacy routes fall through.

        // System project is always reachable by any authenticated user.
        if (environmentId === HttpDispatcher.SYSTEM_ENVIRONMENT_ID) return null;

        // Read the session. If auth is not wired up, fail open — tests
        // and single-tenant setups run without auth.
        let userId: string | undefined;
        let activeOrganizationId: string | undefined;
        try {
            // [#4127 batch 4] This read was `authService?.api?.getSession?.(…)`
            // with NO `getApi()` fallback — the only one of the three `.api`
            // readers in the codebase without it (resolve-execution-context and
            // dispatcher-plugin both have it, and their comments explain why:
            // `.api` is the LEGACY direct mount, `getApi()` the lazy-plugin
            // accessor). `plugin-auth` registers `AuthManager` as the `auth`
            // service, and AuthManager has no `.api` at all.
            //
            // So against the shipped auth plugin this resolved to `undefined`,
            // `userId` stayed unset, and the function returned at the
            // "anonymous — upstream auth will decide" line BEFORE ever querying
            // `sys_environment_member`. The project-membership gate did not
            // gate: a signed-in NON-MEMBER passed it, on every deployment with
            // project scoping on, which is where the flag defaults to true.
            // Anonymous callers were still denied elsewhere (#2567/#3963), so
            // this was specifically the signed-in non-member case.
            const authService = await this.resolveService(this.requestKernel(context), CoreServiceName.enum.auth);
            const api = authService?.api ?? (typeof authService?.getApi === 'function' ? await authService.getApi() : undefined);
            const sessionData = await api?.getSession?.({
                headers: context.request?.headers,
            });
            userId = sessionData?.user?.id ?? sessionData?.session?.userId;
            activeOrganizationId = sessionData?.session?.activeOrganizationId;
        } catch {
            // Auth resolution failed — do not block the request on RBAC.
            return null;
        }

        if (!userId) return null; // Anonymous requests — upstream auth will decide.

        // Platform-org members bypass project membership.
        if (activeOrganizationId === HttpDispatcher.PLATFORM_ORG_ID) return null;

        // Check cache.
        const cacheKey = `${environmentId}:${userId}`;
        const cached = this.membershipCache.get(cacheKey);
        const now = Date.now();
        if (cached && now - cached < HttpDispatcher.MEMBERSHIP_CACHE_TTL_MS) {
            return null; // Recently verified as a member.
        }
        if (cached) {
            this.membershipCache.delete(cacheKey); // expired
        }

        // Query sys_environment_member (control plane).
        try {
            const qlService = await this.getObjectQLService(this.requestKernel(context));
            const ql = qlService ?? await this.resolveService(this.requestKernel(context), 'objectql');
            if (!ql) return null; // No QL — cannot enforce; fail open.

            let rows = await ql.find('sys_environment_member', {
                where: { environment_id: environmentId, user_id: userId },
                limit: 1,
            } as any);
            if (rows && (rows as any).value) rows = (rows as any).value;
            const isMember = Array.isArray(rows) && rows.length > 0;

            if (isMember) {
                this.membershipCache.set(cacheKey, now);
                return null;
            }

            // [#3842] `PROJECT_MEMBERSHIP_REQUIRED` was parked in `details.type`
            // — the fourth site, and the only one to use that spelling — because
            // `error.code` held the status. It travels as `details.code` now, the
            // one carrier `buildApiError` promotes into `error.code`; the two
            // genuine context fields stay in `details`.
            return this.error(
                `Forbidden: user ${userId} is not a member of project ${environmentId}`,
                403,
                { code: 'PROJECT_MEMBERSHIP_REQUIRED', environmentId, userId },
            );
        } catch (err) {
            // Control-plane lookup failure — log and fail open rather than
            // break the request. Tightening this is deferred to Phase 4.
            console.debug('[HttpDispatcher] Membership check failed:', err);
            return null;
        }
    }

    /**
     * Generates the discovery JSON response for the API root.
     *
     * Uses the same async `resolveService()` fallback chain that request
     * handlers use, so the reported service status is always consistent
     * with the actual runtime availability.
     */
    async getDiscoveryInfo(prefix: string, context?: HttpProtocolContext) {
        // [#5155] Discovery describes the services of ONE kernel. Served from
        // inside `dispatch()` it describes the request's own environment (the
        // context is threaded through); served straight off the host by an
        // adapter's `/discovery` route or the dispatcher plugin — neither of
        // which resolves a request scope — it describes the HOST. Before this,
        // both cases read a dispatcher field, so a host-level `/discovery`
        // answered with whichever tenant had most recently made a request.
        const kernel = this.requestKernel(context);
        // Resolve all services through the same async fallback chain
        // that request handlers (handleI18n, handleAuth, …) use.
        const [
            authSvc, searchSvc, realtimeSvc, filesSvc,
            analyticsSvc, aiSvc, notificationSvc, i18nSvc,
            protocolSvc, automationSvc, cacheSvc, queueSvc, jobSvc, mcpSvc,
            metadataSvc, dataSvc,
        ] = await Promise.all([
            this.resolveService(kernel, CoreServiceName.enum.auth),
            this.resolveService(kernel, CoreServiceName.enum.search),
            this.resolveService(kernel, CoreServiceName.enum.realtime),
            this.resolveService(kernel, CoreServiceName.enum['file-storage']),
            this.resolveService(kernel, CoreServiceName.enum.analytics),
            this.resolveService(kernel, CoreServiceName.enum.ai),
            this.resolveService(kernel, CoreServiceName.enum.notification),
            this.resolveService(kernel, CoreServiceName.enum.i18n),
            // [#4093] What `/ui` actually reads (domains/ui.ts). The `ui` SLOT
            // is vestigial — nothing in the platform registers it (plugin-dev's
            // shapeless placeholder was its only occupant, now retired), and
            // the domain never consulted it.
            this.resolveService(kernel, 'protocol'),
            this.resolveService(kernel, CoreServiceName.enum.automation),
            this.resolveService(kernel, CoreServiceName.enum.cache),
            this.resolveService(kernel, CoreServiceName.enum.queue),
            this.resolveService(kernel, CoreServiceName.enum.job),
            // Not a CoreServiceName — plugin-mcp registers under the bare
            // 'mcp' key, the same string handleMcpRequest resolves.
            this.resolveService(kernel, 'mcp'),
            // [#4089] Resolved for its self-description alone: the `metadata`
            // slot is reported from what actually fills it, not hardcoded.
            this.resolveService(kernel, CoreServiceName.enum.metadata),
            // [#4130] Same, for the last hardcoded entry in the kernel block.
            this.resolveService(kernel, CoreServiceName.enum.data),
        ]);

        const hasAuth         = !!authSvc;
        const hasSearch       = !!searchSvc;
        // [#4000, #4058] Every service whose HTTP surface is a DISPATCHER DOMAIN
        // mirrors that domain's OWN guard (`isServiceServeable`,
        // service-serveable.ts): a slot filled by a self-declared non-handler
        // takes the same 404/501 an empty slot takes, so advertising the route
        // on mere presence would promise an API that can only fail — the
        // `declared ≠ enforced` failure `hasMcp` below refuses by construction.
        // Same predicate ⇒ same answer. #4000 did this for `analytics` alone;
        // #4058 extended it to the rest of the dispatcher-owned domains.
        //
        // [#4087] `file-storage` is the one slot here whose surface is NOT a
        // dispatcher domain any more — the `/storage` bridge was retired and
        // service-storage mounts `/api/v1/storage` itself. The predicate still
        // holds, for the same reason and one step removed: `handlerReady` is
        // exactly "does an HTTP handler serve this slot", so an occupant that
        // mounts nothing (plugin-dev's in-memory implementation) must not have
        // `${prefix}/storage` advertised on its behalf.
        //
        // A `degraded` implementation keeps its route: `handlerReady` defaults
        // to `true` for it and its domain keeps serving it (that is the whole
        // point of the `stub` / `degraded` split — see plugin-dev's markers).
        //
        // `*Registered` stays presence-only, for the `services` map alone: a
        // registered stub is reported there as `status: 'stub', handlerReady:
        // false` (D12's honest self-report), which says strictly more than
        // collapsing it to `unavailable` / "install a plugin" would.
        const analyticsRegistered    = !!analyticsSvc;
        const filesRegistered        = !!filesSvc;
        const aiRegistered           = !!aiSvc;
        const notificationRegistered = !!notificationSvc;
        const i18nRegistered         = !!i18nSvc;
        const automationRegistered   = !!automationSvc;
        const hasFiles        = isServiceServeable(filesSvc);
        const hasAnalytics    = isServiceServeable(analyticsSvc);
        const hasAi           = isServiceServeable(aiSvc);
        const hasNotification = isServiceServeable(notificationSvc);
        const hasI18n         = isServiceServeable(i18nSvc);
        // Mirrors handleUiRequest's OWN guard byte for byte (domains/ui.ts):
        // it 503s unless a `protocol` service with `getUiView` is resolvable —
        // the `ui` slot never enters that decision. Gating here on slot
        // presence was wrong in both directions: a dev boot with the protocol
        // absent advertised a route that could only 503, and a production boot
        // (nothing fills the vestigial slot) hid a route that serves fine.
        // Same predicate ⇒ same answer (the `hasMcp` pattern below).
        const hasUi           = typeof protocolSvc?.getUiView === 'function';
        const hasAutomation   = isServiceServeable(automationSvc);
        const hasCache        = !!cacheSvc;
        const hasQueue        = !!queueSvc;
        const hasJob          = !!jobSvc;
        // Mirrors handleMcpRequest's OWN guard byte for byte (domains/mcp.ts):
        // it 501s on `!mcp || typeof mcp.handleHttpRequest !== 'function'`, so
        // advertising on mere service presence would still over-promise when a
        // wrong-shaped service is registered. Same predicate ⇒ same answer.
        const hasMcp          = typeof mcpSvc?.handleHttpRequest === 'function';

        // Routes are only exposed when a plugin provides the service
        const routes = {
                data:          `${prefix}/data`,
                metadata:      `${prefix}/meta`,
                packages:      `${prefix}/packages`,
                auth:          hasAuth ? `${prefix}/auth` : undefined,
                ui:            hasUi ? `${prefix}/ui` : undefined,
                // Not a dispatcher domain since #4087 — this advertises
                // service-storage's own mount. Gate unchanged (see above).
                storage:       hasFiles ? `${prefix}/storage` : undefined,
                analytics:     hasAnalytics ? `${prefix}/analytics` : undefined,
                automation:    hasAutomation ? `${prefix}/automation` : undefined,
                // `workflow` removed (#4451, v17): the slot retired — nothing
                // ever registered it and this dispatcher never had a /workflow
                // branch, so the advertisement could never come true.
                // Never advertised (ADR-0076 D12, #2462): service-realtime is an
                // in-process pub/sub bus — the dispatcher has no /realtime branch
                // and no plugin mounts one, so an advertised route would 404.
                // Re-add only when a real HTTP/WS surface exists (and then it must
                // pass through the shouldDenyAnonymous gate, #2567).
                realtime:      undefined,
                notifications: hasNotification ? `${prefix}/notifications` : undefined,
                ai:            hasAi ? `${prefix}/ai` : undefined,
                i18n:          hasI18n ? `${prefix}/i18n` : undefined,
                // MCP (Streamable HTTP) is a default-on core capability — but
                // "enabled" and "serveable" are two different facts and both
                // must hold. The objectui Integrations page reads this.
                //
                // Service-presence gated like every other optional route above
                // (#3369 / #2698), NOT flag-only (#4024). This used to trust a
                // LOCKSTEP instead: `os serve` auto-loads plugin-mcp from the
                // same `isMcpServerEnabled()` flag, so on that path advertised
                // did imply mounted. But the lockstep is a property of the CLI,
                // not of the dispatcher — an embedder that mounts the dispatcher
                // (or `@objectstack/rest`) without plugin-mcp got `/mcp`
                // advertised here and 501 from handleMcpRequest, which is
                // exactly the `declared ≠ enforced` failure #3369 forbids.
                // Gating on the handler's own predicate makes the invariant hold
                // by construction on every host instead of by convention on one.
                mcp:           isMcpServerEnabled() && hasMcp ? `${prefix}/mcp` : undefined,
        };

        // Build per-service status map
        // handlerReady: true means the dispatcher has a real, bound handler for this route.
        // handlerReady: false means the route is present in the discovery table but may not
        // yet have a concrete implementation or may be served by a stub.
        //
        // Honest capabilities (ADR-0076 D12, #2462): a registered service that
        // self-identifies as a stub / dev fake / degraded fallback (via the
        // `__serviceInfo` marker — the one marker left since #4319 retired the
        // legacy `_dev` alias) is reported with its declared status — never as
        // `available` — so consumers (AI agents, the console) don't mistake a
        // fake capability for a real one.
        const svcAvailable = (route?: string, provider?: string, svc?: unknown) => {
            const self = svc ? readServiceSelfInfo(svc) : undefined;
            if (self) {
                return {
                    enabled: true, status: self.status, handlerReady: self.handlerReady ?? false,
                    route, provider, message: self.message,
                };
            }
            return { enabled: true, status: 'available' as const, handlerReady: true, route, provider };
        };
        // [#4093 follow-up] The remedy comes from the shared provider table
        // (`CORE_SERVICE_PROVIDER`), not from the slot name. `Install a ${name}
        // plugin to enable` named a package that does not exist for `ai`,
        // `search` and `workflow` — nothing implements those slots — and got
        // the name wrong wherever the package is not called after its slot
        // (`notification` is filled by service-messaging). A fix a consumer
        // cannot carry out is worse than no fix named.
        const svcUnavailable = (name: string) => ({
            enabled: false, status: 'unavailable' as const, handlerReady: false,
            message: serviceUnavailableMessage(name),
        });
        // [#4318] Kernel-internal slots (cache/queue/job): their providers
        // mount no HTTP routes, so no route is advertised and `handlerReady`
        // is `false` as a fact, not a proxy — `svcAvailable` would claim a
        // handler that does not exist. An unmarked occupant stays `available`:
        // the slot's contract is in-process, so "no HTTP surface" is not
        // reduced capability (contrast `realtime` below, whose advertised
        // capability IS the missing surface). Message written once in
        // `@objectstack/spec/system` so both discovery builders agree.
        const svcInProcess = (name: string, svc: unknown) => {
            const self = svc ? readServiceSelfInfo(svc) : undefined;
            return {
                enabled: true,
                status: self?.status ?? ('available' as const),
                handlerReady: false,
                message: self?.message ?? inProcessServiceMessage(name),
            };
        };

        // Self-description of the registered realtime service, if any (D12).
        const realtimeSelf = realtimeSvc ? readServiceSelfInfo(realtimeSvc) : undefined;

        // Self-description of whatever fills the `metadata` slot (D12, #4089).
        const metadataSelf = metadataSvc ? readServiceSelfInfo(metadataSvc) : undefined;

        // [#5672] Comments/chatter are served by the `sys_comment` object via
        // the generic data API (ADR-0052 §5) — `/data/sys_comment` is a
        // dispatcher domain, so this producer really does deliver the
        // capability and must answer it from what it can measure, not with a
        // blanket `false`. `getObjectQLService` is the same accessor the data
        // domain resolves its engine through, so the advertisement and the
        // service agree by construction. Same derivation as `getDiscovery()`,
        // reached through this producer's own kernel face.
        const objectqlSvc = await this.getObjectQLService(kernel);
        const hasComments = !!(objectqlSvc as { registry?: { getObject?: (n: string) => unknown } } | null)
            ?.registry?.getObject?.('sys_comment');

        // Derive locale info from actual i18n service when available
        let locale = { default: 'en', supported: ['en'], timezone: 'UTC' };
        if (hasI18n && i18nSvc) {
            const defaultLocale = typeof i18nSvc.getDefaultLocale === 'function'
                ? i18nSvc.getDefaultLocale() : 'en';
            const locales = typeof i18nSvc.getLocales === 'function'
                ? i18nSvc.getLocales() : [];
            locale = {
                default: defaultLocale,
                supported: locales.length > 0 ? locales : [defaultLocale],
                timezone: 'UTC',
            };
        }

        return {
            name: 'ObjectOS',
            version: '1.0.0',
            // [#4828] Mapped, not passed through. `DiscoverySchema.environment`
            // is an ENUM (`production|sandbox|development`) and this used to be
            // `getEnv('NODE_ENV', 'development')` raw — so `NODE_ENV=test` (what
            // vitest sets) or `staging` advertised a value outside the declared
            // enum on a machine-readable surface. The mapping table and the
            // reasoning per row live with the enum, in `@objectstack/spec/api`.
            //
            // [#5673] The DEFAULT — what a producer says when the host set no
            // `NODE_ENV` at all — is `production`, per the maintainer's
            // 2026-08-06 ruling, because `environment` is a MACHINE-READABLE
            // field: a client reads it to answer "am I talking to production?"
            // and may skip production warnings or loosen a destructive action's
            // confirmation on the answer. Of the two ways to be wrong, claiming
            // `development` on a real production deployment whose operator
            // forgot the variable is the dangerous one. (Every other reader of
            // that absence already said `production`: `os start` forces
            // `NODE_ENV='production'` when unset, `os serve` resolves its
            // `.env*` cascade for `NODE_ENV || 'production'`, `os doctor`
            // derives the same expression. Discovery was the one surface
            // reading it the other way.)
            //
            // [#5936] That default no longer lives HERE. #5673's ruling put
            // `packages/spec` out of scope, so this producer carried the default
            // at its own call site — and the second producer (`getDiscovery()`
            // in `@objectstack/metadata-protocol`, served by
            // `@objectstack/rest`) went on answering `development` for the unset
            // case, which is the drift the shared mapper was built to prevent
            // (#4828). The 2026-08-07 ruling (direction 1) folded the default
            // into `resolveDiscoveryEnvironment`, so both producers now inherit
            // one decision and the next producer gets it without remembering to
            // copy a line. Pass the operator's value as read; do NOT re-add a
            // local default here or anywhere else.
            //
            // #4828's rule is untouched and is a DIFFERENT rule: a value that IS
            // set but is not a spelling this repo recognises (`qa`, `preview`)
            // still degrades to `development` inside the mapper, so nothing here
            // ever CLAIMS production on a guess. Absence is not a guess — it is
            // the host declining to say, and the conservative answer to that is
            // `production`.
            environment: resolveDiscoveryEnvironment(getEnv('NODE_ENV')),
            routes,
            // [#4828] `endpoints` (a verbatim duplicate of `routes`, commented
            // "Alias for backward compatibility with some clients") and the
            // top-level `features` map are GONE. Neither was ever declared in
            // `DiscoverySchema`; both survived only because the one schema the
            // protocol layer referenced (`GetDiscoveryResponseSchema`) strips
            // unknown keys. Per ADR-0049 enforce-or-remove and the 2026-08-05
            // ruling on #4828:
            //
            // * `endpoints` — REMOVED. A consumer census across `objectstack`,
            //   `objectui` and `cloud` (2026-08-05) found NO reader: this repo's
            //   own SDK resolves routes via `discoveryInfo.routes`
            //   (`packages/client/src/index.ts`), and objectui's only
            //   `.endpoints` reads are its hand-written `SERVICE_ENDPOINT_CATALOG`
            //   (`apps/console/.../useApiDiscovery.ts`), not this payload.
            //   `routes` is the declared, canonical spelling.
            // * `features` — RENAMED to the canonical `capabilities`, which
            //   `DiscoverySchema` has always declared and which this producer
            //   never emitted. That split is the bug: the SDK's
            //   `client.capabilities` getter reads `discoveryInfo.capabilities`,
            //   so against a dispatcher-served host it returned `undefined` for
            //   every flag while the answers sat one key away under `features`.
            //
            // The hierarchical `{ enabled }` shape is what `capabilities`
            // declares (and what the `getDiscovery()` producer already emits),
            // so a client reads ONE shape from either producer.
            //
            // [#5672] …and now the same KEY SET from either producer. #4828
            // stopped at the spelling: both producers emitted `capabilities`,
            // but this one filled `search`/`websockets`/`files`/`analytics`/
            // `ai`/`notifications`/`i18n` while `getDiscovery()` filled
            // `comments`/`automation`/`cron`/`search`/`export`/`chunkedUpload`/
            // `transactionalBatch` — disjoint but for `search`, and legal
            // because `DiscoverySchema.capabilities` was an open record. Ruling
            // A (2026-08-06) closes the vocabulary and requires EVERY key from
            // EVERY producer, with `enabled: false` as the spelling for "this
            // host does not deliver it". The six additions below are the other
            // producer's half, answered from THIS producer's own facts.
            capabilities: {
                search: { enabled: hasSearch },
                // No WS/HTTP realtime surface is mounted anywhere — a mere
                // in-process realtime service must not advertise websockets
                // (ADR-0076 D12, #2462).
                websockets: { enabled: false },
                files: { enabled: hasFiles },
                analytics: { enabled: hasAnalytics },
                ai: { enabled: hasAi },
                notifications: { enabled: hasNotification },
                i18n: { enabled: hasI18n },

                // ── The `getDiscovery()` half (#5672) ─────────────────────────
                // Basis per key, since ruling A's `false` must never be
                // confused with "we did not look":

                // MEASURED: the `sys_comment` object in the registry this
                // dispatcher resolves for its own `/data` domain (see above).
                comments: { enabled: hasComments },
                // MEASURED: the same serveability predicate that gates
                // `routes.automation` — a self-declared stub in the slot
                // advertises neither the route nor the capability.
                automation: { enabled: hasAutomation },
                // MEASURED: the `job` slot. Presence, not serveability, is the
                // right test — job is a kernel-INTERNAL contract with no HTTP
                // surface by design (#4318), so an occupant is the capability.
                cron: { enabled: hasJob },
                // MEASURED: async export is driven by automation or by the
                // queue — the same disjunction `getDiscovery()` uses.
                export: { enabled: hasAutomation || hasQueue },
                // MEASURED: chunked upload rides the file-storage surface, so
                // it is exactly `files` on this host. Two vocabulary keys with
                // one answer is a fact about the host (one storage surface
                // serving both), not a copy-paste.
                chunkedUpload: { enabled: hasFiles },
                // NOT DELIVERED ⇒ false (ruling A point 3), and this is the one
                // key here that is a genuine "this face does not serve it"
                // rather than a measurement. The atomic cross-object `/batch`
                // route is mounted by `@objectstack/rest`
                // (`registerBatchEndpoints`) — this dispatcher has no batch
                // branch at all: `domains/data.ts` routes only `query` as a
                // custom action, and `callData`'s vestigial `action === 'batch'`
                // arm — unreachable from here, and returning `{ results: [] }`
                // without opening a transaction — was REMOVED under ADR-0049
                // enforce-or-remove (#5856), so `batch` now falls to the same
                // `400 Unknown data action` as any other unhandled action.
                // Nothing about this verdict changed with it: the reason was
                // "this face does not serve `/batch`" both before and after.
                // Answering `engine.transaction`
                // instead would advertise atomicity for an endpoint this host
                // does not serve — the `declared ≠ enforced` lie the flag was
                // introduced (#3298/#1604) to remove. A host that mounts REST
                // gets the honest `true` from the REST producer, which ANDs the
                // runtime verdict with its own `api.enableBatch`.
                transactionalBatch: { enabled: false },
            },
            services: {
                // Kernel-provided (always served by the protocol implementation)
                // — but the verdict is NOT hardcoded (#4089). Three different
                // implementations fill this slot: MetadataPlugin's
                // sys_metadata-backed manager, the kernel's in-memory fallback
                // (`createMemoryMetadata`) and plugin-dev's dev registry. Only
                // the implementation knows which it is, so read its D12
                // self-description and report that.
                //
                // The hardcode this replaces (`degraded` + "In-memory registry;
                // DB persistence pending") was the mirror image of
                // metadata-protocol's hardcoded `available`: the two builders
                // gave the same slot opposite answers, and each was wrong for
                // half the stacks — this one understated a persisted registry,
                // that one overstated the in-memory fallback.
                //
                // `handlerReady` stays unconditionally true and is not taken
                // from the self-description: it answers "is /meta mounted?",
                // and `handleMetadata` serves that route from the protocol on
                // every host — a degraded service in this slot does not unmount
                // it. (Contrast `realtime` below, where no surface exists at all.)
                metadata:       {
                                    enabled: true,
                                    status: metadataSelf?.status ?? ('available' as const),
                                    handlerReady: true,
                                    route: routes.metadata,
                                    provider: 'kernel',
                                    ...(metadataSelf?.message ? { message: metadataSelf.message } : {}),
                                },
                // [#4130] The last entry in this block that judged itself. It
                // read `available` / `handlerReady: true` unconditionally, and
                // that was true only by a convention outside this file:
                // ObjectQL is the sole producer of the `data` slot, and
                // plugin-dev — whose `data` stub self-declares `stub` (find()
                // returns [], insert() stores nothing) — always loads
                // ObjectQLPlugin as a child, so the stub never reaches the slot.
                // A convention is not a computation: a second producer, or a
                // trimmed dev config, and the hardcode starts lying. Passing the
                // resolved service lets `svcAvailable` derive both fields, and
                // for a real engine (which carries no marker) the result is
                // byte-identical to the hardcode it replaces.
                //
                // Why `handlerReady` is derived here but pinned `true` for
                // `metadata` above: each says what its route actually does.
                // `/meta` answers from the protocol (and a last-resort default
                // type list) whatever fills the metadata slot, so a degraded
                // implementation there does not unmount it. `/data` has no such
                // floor — `callData` needs the `protocol` service or an
                // objectql-shaped one and throws 503 without them — and the only
                // way a stub occupies this slot is a stack where ObjectQL never
                // registered, i.e. exactly the stack where `/data` cannot serve.
                //
                // Deliberate limit: this reports the slot, it does not re-derive
                // serveability from `protocol`/`objectql`. Mirroring that
                // predicate here would read them UNSCOPED (discovery has no
                // environment context), which on a multi-kernel host risks
                // flipping the required data capability to `handlerReady: false`
                // while per-request scoped resolution serves it fine — a worse
                // lie than the one being fixed. The `data` domain does not gate
                // on this slot either (`isServiceServeable` covers the optional
                // domains, #4058 step 2), so nothing routes off this field.
                data:           svcAvailable(routes.data, 'kernel', dataSvc),
                // Plugin-provided — only available when a plugin registers the service
                auth:           hasAuth ? svcAvailable(routes.auth, undefined, authSvc) : svcUnavailable('auth'),
                // [#4000, #4058] Presence-gated, not serveability-gated: a
                // registered stub self-reports as `stub` / `handlerReady: false`
                // here (and carries no `route`, since the matching `routes.*`
                // entry is undefined for it). Collapsing it to `unavailable` /
                // "install a plugin" would say strictly less.
                automation:     automationRegistered ? svcAvailable(routes.automation, undefined, automationSvc) : svcUnavailable('automation'),
                analytics:      analyticsRegistered ? svcAvailable(routes.analytics, undefined, analyticsSvc) : svcUnavailable('analytics'),
                cache:          hasCache ? svcInProcess('cache', cacheSvc) : svcUnavailable('cache'),
                queue:          hasQueue ? svcInProcess('queue', queueSvc) : svcUnavailable('queue'),
                job:            hasJob ? svcInProcess('job', jobSvc) : svcUnavailable('job'),
                // [#4093] Reported from what serves it, like the route above:
                // `/ui` is a dispatcher domain answered by the `protocol`
                // service, so its self-description (none today — MetadataPlugin
                // registers a real shim) is the honest source. The vestigial
                // `ui` slot is not consulted, matching the domain. The
                // unavailable message names the actual remedy — `svcUnavailable`
                // would say "install a ui plugin", and no such plugin exists.
                ui:             hasUi
                                    ? svcAvailable(routes.ui, 'metadata-protocol', protocolSvc)
                                    : {
                                        enabled: false, status: 'unavailable' as const, handlerReady: false,
                                        message: serviceUnavailableMessage('ui'),
                                    },
                // `workflow` entry removed (#4451, v17) with the slot itself —
                // it could only ever report `unavailable`.
                // Honest entry (ADR-0076 D12, #2462): the registered realtime
                // service is an in-process event bus with NO mounted HTTP/WS
                // surface — report it degraded with handlerReady:false (or as
                // the stub it declares itself to be), never as an available
                // HTTP capability with a route that would 404.
                realtime:       realtimeSvc ? {
                                    enabled: true,
                                    status: realtimeSelf?.status ?? ('degraded' as const),
                                    handlerReady: false,
                                    message: realtimeSelf?.message
                                        ?? 'In-process event bus only — no HTTP/WS realtime surface is mounted',
                                } : svcUnavailable('realtime'),
                // Presence-gated for the same reason `analytics` is (#4058).
                notification:   notificationRegistered ? svcAvailable(routes.notifications, undefined, notificationSvc) : svcUnavailable('notification'),
                ai:             aiRegistered ? svcAvailable(routes.ai, undefined, aiSvc) : svcUnavailable('ai'),
                i18n:           i18nRegistered ? svcAvailable(routes.i18n, undefined, i18nSvc) : svcUnavailable('i18n'),
                'file-storage': filesRegistered ? svcAvailable(routes.storage, undefined, filesSvc) : svcUnavailable('file-storage'),
                search:         hasSearch ? svcAvailable(undefined, undefined, searchSvc) : svcUnavailable('search'),
            },
            locale,
        };
    }



    /** Thin delegate — body extracted to `./domains/auth.ts` (D11③ PR-7). */
    async handleAuth(path: string, method: string, body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleAuthRequest(this.domainDeps, path, method, body, context);
    }


    /** Thin delegate — body extracted to `./domains/meta.ts` (D11③ PR-10). */
    async handleMetadata(path: string, context: HttpProtocolContext, method: string = 'GET', body?: any, query?: any): Promise<HttpDispatcherResult> {
        return handleMetadataRequest(this.domainDeps, path, context, method, body, query);
    }

    /** Thin delegate — body extracted to `./domains/data.ts` (D11③ PR-10). */
    async handleData(path: string, method: string, body: any, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleDataRequest(this.domainDeps, path, method, body, query, _context);
    }

    /**
     * Handles Analytics requests
     * path: sub-path after /analytics/
     */
    /** Thin delegate — body extracted to `./domains/analytics.ts` (D11③ PR-2). */
    async handleAnalytics(path: string, method: string, body: any, context: HttpProtocolContext, query?: any): Promise<HttpDispatcherResult> {
        return handleAnalyticsRequest(this.domainDeps, path, method, body, context, query);
    }

    /**
     * Handles in-app notification requests (ADR-0030) — the
     * `/api/v1/notifications` surface backed by the messaging service's inbox
     * read API. Reads the L5 `sys_inbox_message` + `sys_notification_receipt`
     * join; mark-read upserts the receipt keyed `(notification_id, user_id,
     * channel:'inbox')`. The routes are `auth: true`, so an authenticated user
     * is required.
     *
     * Routes (path is the sub-path after `/notifications`):
     *   GET  ''          → listInbox    (query: read, type, limit)
     *   POST /read       → markRead     (body: { ids: string[] })
     *   POST /read/all   → markAllRead
     */
    /** Thin delegate — body extracted to `./domains/notifications.ts` (D11③ PR-2). */
    async handleNotification(path: string, method: string, body: any, query: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleNotificationRequest(this.domainDeps, path, method, body, query, context);
    }

    /**
     * Handle the security admin surface (`/security/...`) — ADR-0090 D5/D9
     * suggested audience bindings. A package's `isDefault: true` permission
     * set is an install-time SUGGESTION to bind it to the `everyone` position;
     * these routes let an admin see and resolve those suggestions. The
     * `security` service does the real gating (tenant-admin pre-check, and the
     * confirm write runs under the audience-anchor + delegated-admin gates
     * with the caller's execution context — never auto-bound, never system).
     *
     * Routes:
     *   GET  /security/suggested-bindings?status=&packageId=   → list (reconciles first)
     *   POST /security/suggested-bindings/:id/confirm          → create the anchor binding
     *   POST /security/suggested-bindings/:id/dismiss          → decline the suggestion
     */
    /** Thin delegate — body extracted to `./domains/security.ts` (D11③ PR-2). */
    async handleSecurity(path: string, method: string, _body: any, query: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleSecurityRequest(this.domainDeps, path, method, _body, query, context);
    }

    /**
     * Handles i18n requests
     * path: sub-path after /i18n/
     *
     * Routes:
     *   GET /locales                    → getLocales
     *   GET /translations/:locale       → getTranslations (locale from path)
     *   GET /translations?locale=xx     → getTranslations (locale from query)
     *   GET /labels/:object/:locale     → getFieldLabels  (both from path)
     *   GET /labels/:object?locale=xx   → getFieldLabels  (locale from query)
     */
    /** Thin delegate — body extracted to `./domains/i18n.ts` (D11③ PR-2). */
    async handleI18n(path: string, method: string, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleI18nRequest(this.domainDeps, path, method, query, _context);
    }

    /** Thin delegate — body extracted to `./domains/packages.ts` (D11③ PR-5). */
    async handlePackages(path: string, method: string, body: any, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handlePackagesRequest(this.domainDeps, path, method, body, query, _context);
    }


    /**
     * Cloud / Environment Control-Plane routes.
     *
     *  - GET    /cloud/drivers                                 → list registered ObjectQL drivers (for env provisioning)
     *  - GET    /cloud/environments                            → list
     *  - POST   /cloud/environments                            → provision (driver: memory | turso | <any registered driver>)
     *  - GET    /cloud/environments/:id                        → detail (+ db, credential, membership)
     *  - PATCH  /cloud/environments/:id                        → update displayName / plan / status / isDefault / metadata
     *  - DELETE /cloud/environments/:id[?force=1]              → cascade-delete the project (cred/member/package install rows + physical DB)
     *  - DELETE /cloud/organizations/:id                   → cascade-delete every project (and its DB) for the org, then drop the org
     *  - POST   /cloud/environments/:id/retry                  → re-run provisioning for a failed environment
     *  - POST   /cloud/environments/:id/activate               → mark as active for session (stub)
     *  - POST   /cloud/environments/:id/credentials/rotate     → rotate credential
     *  - GET    /cloud/environments/:id/members                → list members
     *  - GET    /cloud/environments/:id/packages               → list installed packages
     *  - POST   /cloud/environments/:id/packages               → install package into env
     *  - GET    /cloud/environments/:id/packages/:pkgId        → get installation detail
     *  - PATCH  /cloud/environments/:id/packages/:pkgId/enable  → enable package
     *  - PATCH  /cloud/environments/:id/packages/:pkgId/disable → disable package
     *  - DELETE /cloud/environments/:id/packages/:pkgId        → uninstall (scope=platform forbidden)
     *  - POST   /cloud/environments/:id/packages/:pkgId/upgrade → upgrade to newer version
     *
     * Driver binding
     * --------------
     * Environments are not tied to any specific driver. At provisioning time the
     * caller passes `driver` (a short name such as `memory`, `turso`, or any
     * future `sql` / `postgres` driver). The dispatcher validates the name
     * against the kernel's registered driver services (`driver.<name>`) and
     * derives an appropriate placeholder `database_url` for the chosen driver.
     * If `driver` is omitted, the dispatcher auto-selects the first available
     * in preference order: turso → memory → any other registered driver.
     *
     * Backed by ObjectQL sys_environment / sys_environment_credential /
     * sys_environment_member tables (registered by
     * `@objectstack/service-tenant`'s `createTenantPlugin`).
     * Physical database addressing (database_url, database_driver, etc.)
     * is stored directly on the sys_environment row.
     */

    /**
     * Resolve the calling user id from the request session, if any.
     * Returns `undefined` for anonymous calls or when auth is not wired up.
     */
    private async resolveActiveOrganizationId(context: HttpProtocolContext): Promise<string | undefined> {
        try {
            // [#4127 FINDING, batch 5]
            // Third `.api` reader on the auth service; see the note above.
            const authService = await this.resolveService(this.requestKernel(context), CoreServiceName.enum.auth);
            const rawHeaders = context.request?.headers;
            let headers: any = rawHeaders;
            if (rawHeaders && typeof rawHeaders === 'object' && typeof (rawHeaders as any).get !== 'function') {
                try {
                    const h = new Headers();
                    for (const [k, v] of Object.entries(rawHeaders as Record<string, any>)) {
                        if (v == null) continue;
                        h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
                    }
                    headers = h;
                } catch {
                    headers = rawHeaders;
                }
            }
            const apiObj = authService?.auth?.api ?? authService?.api;
            const sessionData = await apiObj?.getSession?.call(apiObj, { headers });
            const oid = sessionData?.session?.activeOrganizationId;
            return typeof oid === 'string' && oid.length > 0 ? oid : undefined;
        } catch {
            return undefined;
        }
    }

    /** Thin delegate — body extracted to `./domains/ui.ts` (D11③ PR-3). */
    async handleUi(path: string, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleUiRequest(this.domainDeps, path, query, _context);
    }

    /** Thin delegate — body extracted to `./domains/automation.ts` (D11③ PR-6). */
    async handleAutomation(path: string, method: string, body: any, context: HttpProtocolContext, query?: any): Promise<HttpDispatcherResult> {
        return handleAutomationRequest(this.domainDeps, path, method, body, context, query);
    }

    private getServicesMap(kernel: any): Record<string, any> {
        if (kernel?.services instanceof Map) {
            return Object.fromEntries(kernel.services);
        }
        return kernel?.services || {};
    }

    private async getService(kernel: any, name: CoreServiceName) {
        return this.resolveService(kernel, name);
    }

    /**
     * Resolve any service by name, supporting async factories.
     * Fallback chain: getServiceAsync(scopeId) → getServiceAsync → getService (sync) → context.getService → services map.
     * Only returns when a non-null service is found; otherwise falls through to the next step.
     *
     * When `scopeId` is provided, tries the SCOPED factory on `defaultKernel` first (SharedProjectPlugin
     * mode). Falls back to `kernel` — THE REQUEST'S OWN kernel, passed in by the
     * caller (#5155) — for singleton / legacy services.
     */
    private async resolveService(kernel: any, name: string, scopeId?: string) {
        // Prefer scoped lookup on defaultKernel when scopeId is given (shared-kernel / multi-environment mode)
        if (scopeId && typeof this.defaultKernel.getServiceAsync === 'function') {
            try {
                const svc = await this.defaultKernel.getServiceAsync(name, scopeId);
                if (svc != null) return svc;
            } catch {
                // Not a scoped service — fall through to singleton resolution
            }
        }
        // Prefer async resolution to support factory-based services (e.g. auth, analytics, protocol)
        if (typeof kernel?.getServiceAsync === 'function') {
            try {
                const svc = await kernel.getServiceAsync(name);
                if (svc != null) return svc;
            } catch {
                // Service not registered or async resolution failed — fall through
            }
        }
        if (typeof kernel?.getService === 'function') {
            try {
                const svc = await kernel.getService(name);
                if (svc != null) return svc;
            } catch {
                // Service not registered or sync resolution threw "is async" — fall through
            }
        }
        if (kernel?.context?.getService) {
            try {
                const svc = await kernel.context.getService(name);
                if (svc != null) return svc;
            } catch {
                // Service not registered — fall through
            }
        }
        const services = this.getServicesMap(kernel);
        return services[name];
    }

    /**
     * Get the ObjectQL service which provides access to SchemaRegistry.
     * Tries multiple access patterns since kernel structure varies.
     */
    private async getObjectQLService(kernel: any, scopeId?: string): Promise<IObjectQLEngine | null> {
        // 1. Try via resolveService (handles scoped, async factories, sync, context, and map)
        try {
            const svc = await this.resolveService(kernel, 'objectql', scopeId);
            if (svc?.registry) return svc;
        } catch { /* service not available */ }
        return null;
    }

    /** Thin delegate — body extracted to `./domains/actions.ts` (D11③ PR-9). */
    async handleActions(path: string, method: string, body: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleActionsRequest(this.domainDeps, path, method, body, _context);
    }

    /** Thin delegate — body extracted to `./domains/ai.ts` (D11③ PR-7). */
    async handleAI(subPath: string, method: string, body: any, query: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleAIRequest(this.domainDeps, subPath, method, body, query, context);
    }

    /** Thin delegate — body extracted to `./domains/share-links.ts` (D11③ PR-4). */
    async handleShareLinks(
        subPath: string,
        method: string,
        body: any,
        query: any,
        context: HttpProtocolContext,
    ): Promise<HttpDispatcherResult> {
        return handleShareLinksRequest(this.domainDeps, subPath, method, body, query, context);
    }

    /**
     * Main Dispatcher Entry Point
     * Routes the request to the appropriate handler based on path and precedence
     */
    async dispatch(method: string, path: string, body: any, query: any, context: HttpProtocolContext, prefix?: string): Promise<HttpDispatcherResult> {
        let cleanPath = path.replace(/\/$/, ''); // Remove trailing slash if present, but strict on clean paths

        // ── Gates run BEFORE any domain body (ADR-0076 D11 step ③) ──
        // Scope resolution plus the two gates below are the dispatcher's half of
        // the D11 contract: a body extracted to `./domains/` receives an
        // already-scoped, already-gated request. Domains add their OWN
        // authorization on top (`/ai`'s declared per-route `auth`, `/keys`'
        // identity gate), but NOTHING downstream re-runs these two — so the
        // ordering is not overhead to optimize away: moving the domain-registry
        // resolve (further down) above these lines would un-gate every migrated
        // domain at once and hand handlers a context whose per-request kernel was
        // never resolved (#5155). Anchored in scripts/adr-anchors/.
        await this.resolveRequestScope(context, cleanPath);

        // ── ADR-0069 Authentication-policy gate ──
        // Block a gated session (expired password / required MFA) from
        // protected MCP/data routes, mirroring the REST seam. The core
        // allow-list keeps auth + remediation reachable. Skipped (no session
        // lookup) when no gate feature is active.
        const authGated = await this.enforceAuthGate(context, cleanPath);
        if (authGated) {
            return { handled: true, response: authGated };
        }

        // ── Project Membership Enforcement ──
        // Once the environmentId is known, gate scoped data/meta/AI/automation
        // routes on `sys_environment_member`. Control-plane paths, the system
        // project, and platform-org members bypass this check.
        const forbidden = await this.enforceProjectMembership(context, cleanPath);
        if (forbidden) {
            return { handled: true, response: forbidden };
        }

        // Strip the `/environments/:environmentId` prefix so the protocol dispatchers
        // below (meta, data, ui, automation, …) see the same shape whether
        // the caller used host-based routing, `X-Environment-Id`, or a scoped URL.
        const scopedMatch = cleanPath.match(/^\/projects\/[^/]+(\/.*)?$/);
        if (scopedMatch) {
            cleanPath = scopedMatch[1] ?? '';
        }

        try {
        // ── Domain registry (ADR-0076 D11 step ③) ──
        // Domains lifted out of the if-chain below resolve here first;
        // unmigrated domains fall through to the legacy branches. The four
        // seeded prefixes (/health /ready /analytics /i18n) are disjoint from
        // every remaining branch prefix, so consulting the registry first is
        // order-equivalent to their original chain positions.
        const domainRoute = this.domainRegistry.resolve(cleanPath, method);
        if (domainRoute) {
            // [#7450] `return await`, not `return`. In an async function a bare
            // `return <promise>` settles OUTSIDE the enclosing `try`, so a
            // domain handler's rejection never reached the `catch` at the foot
            // of this method — and every domain that can raise an object-gate
            // denial (`/data` first among them) resolves HERE, which made that
            // catch's `PERMISSION_DENIED` branch unreachable in practice. The
            // denial escaped to the Hono catch-all instead, which answered
            // `{ error: { message, code: 403 } }` — a NUMERIC `code`, i.e. the
            // #3842 shape this package's error envelope exists to prevent, and
            // no `PERMISSION_DENIED` for a client to branch on.
            //
            // Awaiting is what makes the ruled 403 contract actually apply on
            // this transport; it must land together with the details allowlist
            // in the catch below, because awaiting ALONE would start shipping
            // the `positions` / `permissionSets` payload the ruling withholds.
            // Non-denial errors are unaffected: the catch rethrows them, so
            // they reach the adapter exactly as before.
            return await domainRoute.handler({ path: cleanPath, method, body, query }, context);
        }

        // 0. Discovery Endpoint (GET /discovery or GET /)
        // Standard route: /discovery (protocol-compliant)
        // Legacy route: / (empty path, for backward compatibility — MSW strips base URL)
        if ((cleanPath === '/discovery' || cleanPath === '') && method === 'GET') {
             const info = await this.getDiscoveryInfo(prefix ?? '', context);
             return {
                 handled: true,
                 response: this.success(info)
             };
        }

        // 0c. Plan-A diagnostics removed; the seed-replay and oauth2/callback
        // probes were temporary debugging tools used during the SSO rollout.

        // 1. System Protocols (Prefix-based)
        // /auth moved to the domain registry (D11 step ③).
        
        // /meta and /data moved to the domain registry (D11 step ③ — the if-chain is now EMPTY of domains).

        // /mcp and /mcp/skill moved to the domain registry (D11 step ③).

        // /keys moved to the domain registry (D11 step ③).

        // /graphql removed — GraphQL is not in the product plan (#2462 follow-on).

        // /storage and /ui moved to the domain registry (D11 step ③).

        // /automation moved to the domain registry (D11 step ③).

        // /actions moved to the domain registry (D11 step ③).

        // /analytics moved to the domain registry (D11 step ③).

        // /notifications and /security moved to the domain registry (D11 step ③).

        // /packages and /i18n moved to the domain registry (D11 step ③).

        // /ai moved to the domain registry (D11 step ③).

        // /share-links moved to the domain registry (D11 step ③).

        // OpenAPI specification — REMOVED in #5093 (#5078), NOT relocated.
        //
        // A `GET /openapi.json` branch used to sit here. It resolved the
        // metadata service and duck-typed a `generateOpenApi` method that no
        // implementation has ever provided — not `MetadataManager`, not
        // `NodeMetadataManager`, not a plugin, not either sibling repo. The
        // only other repo-wide hits for the name are an unrelated boolean
        // config key (`api/ApiDocumentationConfig.generateOpenApi`) and its
        // tests. So the `if` was constant-false on every request ever served.
        //
        // It was dead a second way too, which is what settles the disposition:
        // a real boot (#5078 — showcase, 47 plugins, RestAPI and Dispatcher
        // co-mounted) showed NOTHING routes `/openapi.json` into `dispatch()`
        // at all. `packages/rest` owns and answers it — `rest-server.ts`
        // returned a 355KB OpenAPI 3.1 document with a Host-injected
        // `servers[0]`, 199 expanded paths and two `x-template` markers, every
        // one of them a rest-server fingerprint.
        //
        // Deleted rather than implemented, per ADR-0076 "one route, one owner":
        // a second implementation of a path another package already serves is
        // code `grep` finds and the runtime never runs — the exact input that
        // makes the next reader reason confidently from dead code. The declared
        // endpoints' `summary`/`description` reach the document through the
        // owner's own enrichment pipeline instead (#5040 E6,
        // `packages/rest/src/openapi-endpoints.ts`). Do not re-add a branch
        // here; the ledger row went with it.

        // 2. Metadata-declared custom endpoints (`apis:`) — REMOVED in #4936.
        //
        // A `handleApiEndpoint` branch used to sit here. It resolved the
        // metadata service and called `matchEndpoint` on it — a method NO
        // implementation in this repo has ever provided (`MetadataManager` /
        // `NodeMetadataManager` and every plugin alike), so the branch was
        // `{ handled: false }` on every request ever served. It could not even
        // be reached: the declared paths were never mounted, so a request for
        // one died at Hono's `notFound` long before `dispatch()` saw it.
        //
        // That is precisely the input ADR-0076 "one route, one owner" warns
        // about — code `grep` finds and the runtime never runs, which an agent
        // (or a human) then reasons confidently from. Deleted rather than
        // repaired so the absence is LOUD: a non-empty `apis:` is now rejected
        // at publish/validate with a prescription (`stack.zod.ts`), instead of
        // parsing clean and 404ing at runtime. The executor is being built
        // under #5040 and will re-mount this surface for real.

        // 3. Fallback — return semantic 404 with diagnostic info
        return {
            handled: true,
            response: this.routeNotFound(cleanPath),
        };
        } catch (e) {
            if (isPermissionDeniedError(e)) {
                // [#7450] The denial's `details` does NOT reach the wire.
                //
                // This used to be `{ code: 'PERMISSION_DENIED', ...(e.details ?? {}) }`,
                // and `buildApiError` puts everything that is not the `code` on
                // the wire as `error.details` — so the security gate's
                // `positions` / `permissionSets` (the caller's authorization
                // topology) and its `object` (on a cascade delete, a CHILD the
                // caller never addressed — `cascadeDeleteRelations` re-authorises
                // each one independently) were answered to the browser, while
                // `@objectstack/rest`'s `mapDataError` shipped none of it.
                //
                // Per the 2026-08-11 ruling on #7450 the two transports agree on
                // REST's shape — message + code + the ROUTE-derived object. The
                // object below therefore comes from `cleanPath`, the dispatcher's
                // equivalent of REST's `req.params.object`, and never from
                // `e.details.object`: those are different values on exactly the
                // cascade path that made this a disclosure. See
                // `./security/permission-denied-envelope.ts`.
                const withheld = describeDeniedDiagnostics(e.details);
                if (withheld) {
                    // Dropped from the response, not from the operator's reach.
                    console.warn(`[HttpDispatcher] PERMISSION_DENIED on ${method} ${cleanPath} — ${withheld}`);
                }
                return {
                    handled: true,
                    response: this.error(e.message, 403, permissionDeniedErrorDetails(cleanPath)),
                };
            }
            throw e;
        }
    }
}
