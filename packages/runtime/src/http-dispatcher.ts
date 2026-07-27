// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    ObjectKernel, getEnv, evaluateAuthGate, isAuthGateAllowlisted,
} from '@objectstack/core';
import { isMcpServerEnabled } from '@objectstack/types';
import { measureServerTiming, allowPerfDisclosure, isPerfDisclosurePrincipal } from '@objectstack/observability';
import { CoreServiceName } from '@objectstack/spec/system';
import { readServiceSelfInfo } from '@objectstack/spec/api';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DomainHandlerRegistry, type DomainRoute, type DomainHandlerDeps } from './domain-handler-registry.js';
import * as actionExec from './action-execution.js';
import { createAnalyticsDomain, handleAnalyticsRequest } from './domains/analytics.js';
import { createI18nDomain, handleI18nRequest } from './domains/i18n.js';
import { createNotificationsDomain, handleNotificationRequest } from './domains/notifications.js';
import { createSecurityDomain, handleSecurityRequest } from './domains/security.js';
import { createKeysDomains, handleKeysRequest } from './domains/keys.js';
import { createStorageDomain, handleStorageRequest } from './domains/storage.js';
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
    /**
     * Reject anonymous requests to `auth: true` service routes (AI) and to the
     * metadata catch-all with HTTP 401, mirroring the REST API's `requireAuth`
     * gate. Matches {@link DispatcherPluginConfig.requireAuth}; the dispatcher
     * plugin threads the host's `api.requireAuth` here. Defaults to `false`
     * (backward-compatible — nothing enforced `RouteDefinition.auth` before).
     */
    requireAuth?: boolean;
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
    private kernel: any; // Casting to any to access dynamic props like services
    private defaultKernel: ObjectKernel;
    private defaultProject?: { environmentId: string; orgId?: string };
    private kernelResolver?: KernelResolver;
    private scopeManager?: EnvironmentScopeManager;
    /**
     * ADR-0076 D11 step ③ decomposition seam — consulted by `dispatch()`
     * before the legacy if-chain. See {@link DomainHandlerRegistry}.
     */
    private readonly domainRegistry = new DomainHandlerRegistry();
    /**
     * When `true`, scoped data-plane routes enforce a
     * `sys_environment_member` lookup and return 403 for non-members.
     * Defaults to `true` when a environmentId is resolvable — legacy callers
     * can opt out via the third constructor argument (see
     * `DispatcherConfig.enforceProjectMembership`).
     */
    private enforceMembership: boolean;
    /**
     * When `true`, `auth: true` AI routes and the metadata catch-all reject
     * anonymous callers with 401 (mirrors the REST `requireAuth` gate). Set
     * from {@link HttpDispatcherOptions.requireAuth}. Defaults to `false`.
     */
    private requireAuth: boolean;
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
        this.kernel = kernel;
        this.defaultKernel = kernel;
        const resolveService = (name: string): any => {
            try { return (kernel as any).getService?.(name); } catch { return undefined; }
        };
        this.enforceMembership = options?.enforceProjectMembership ?? true;
        this.requireAuth = options?.requireAuth ?? false;
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
        resolveService: (name, environmentId) => this.resolveService(name, environmentId),
        // Deps take plain strings (domain modules pass CoreServiceName enum
        // values anyway); the dispatcher method's parameter is the enum type.
        getService: (name) => this.getService(name as Parameters<HttpDispatcher['getService']>[0]),
        getObjectQL: (environmentId) => this.getObjectQLService(environmentId),
        // Reads off the per-request RESOLVED kernel (`this.kernel` is set by
        // dispatch() before any handler runs) — see the deps contract note.
        getRequestKernelService: async (name) => {
            const k: any = this.kernel;
            return typeof k?.getServiceAsync === 'function'
                ? k.getServiceAsync(name)
                : k?.getService?.(name);
        },
        success: (data, meta) => this.success(data, meta),
        error: (message, code, details) => this.error(message, code, details),
        routeNotFound: (route) => this.routeNotFound(route),
        errorFromThrown: (e, fallbackStatus) => this.errorFromThrown(e, fallbackStatus),
        resolveActiveOrganizationId: (context) => this.resolveActiveOrganizationId(context),
        announceKernelEvent: async (event, payload) => {
            const k: any = this.kernel;
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
                    this.kernel = projectKernel;
                    if (typeof projectKernel.getServiceAsync === 'function') {
                        return await projectKernel.getServiceAsync('objectql').catch(() => null);
                    }
                }
            } catch { /* fall back to defaultKernel resolution downstream */ }
            return null;
        },
        isAuthRequired: () => this.requireAuth,
        getRegisteredAiRoutes: () => (this.kernel as any)?.__aiRoutes,
    };

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
        // 200 only when the kernel is fully running; 503 while booting
        // (idle/initializing) or shutting down (stopping/stopped) so a load
        // balancer stops routing to this replica BEFORE in-flight requests
        // are drained and the server closes (graceful rolling restart).
        this.domainRegistry.register({
            prefix: '/ready', match: 'exact', methods: ['GET'],
            handler: async () => {
                const state: string = typeof (this.kernel as any)?.getState === 'function'
                    ? (this.kernel as any).getState()
                    : 'running';
                return state === 'running'
                    ? { handled: true, response: this.success({ status: 'ready', state }) }
                    : { handled: true, response: this.error('Service not ready', 503, { state }) };
            },
        });
        this.domainRegistry.register(createAnalyticsDomain(this.domainDeps));
        this.domainRegistry.register(createI18nDomain(this.domainDeps));
        this.domainRegistry.register(createNotificationsDomain(this.domainDeps));
        this.domainRegistry.register(createSecurityDomain(this.domainDeps));
        for (const route of createKeysDomains(this.domainDeps)) this.domainRegistry.register(route);
        this.domainRegistry.register(createStorageDomain(this.domainDeps));
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

    private resolveDefaultProject(): { environmentId: string; orgId?: string } | undefined {
        if (this.defaultProject) return this.defaultProject;
        try {
            const v = (this.kernel as any).getService?.('default-project');
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

    private error(message: string, code: number = 500, details?: any) {
        return {
            status: code,
            body: { success: false, error: { message, code, details } }
        };
    }

    /**
     * Build an error response from a THROWN service/protocol error, preserving
     * the error's own HTTP `status` and — critically — any structured `issues`
     * array (e.g. spec-validation `{ path, message, code }[]` from
     * `protocol.saveMetaItem`). The plain `error(msg, code)` path collapses a
     * validation failure to a single message, so the UI can only show a generic
     * banner; carrying `issues` (and the semantic `code`) in `details` lets it
     * map each error back to the offending field. Falls back to `fallbackStatus`
     * and behaves exactly like `error()` for errors that carry neither.
     */
    private errorFromThrown(e: any, fallbackStatus = 500) {
        const status =
            typeof e?.status === 'number' ? e.status
            : typeof e?.statusCode === 'number' ? e.statusCode
            : fallbackStatus;
        const issues = Array.isArray(e?.issues) ? e.issues : undefined;
        const details =
            issues || e?.code
                ? { ...(e?.code ? { code: e.code } : {}), ...(issues ? { issues } : {}) }
                : undefined;
        return this.error(e?.message ?? String(e), status, details);
    }


    /**
     * 404 Route Not Found — no route is registered for this path.
     */
    private routeNotFound(route: string) {
        return {
            status: 404,
            body: {
                success: false,
                error: {
                    code: 404,
                    message: `Route Not Found: ${route}`,
                    type: 'ROUTE_NOT_FOUND' as const,
                    route,
                    hint: 'No route is registered for this path. Check the API discovery endpoint for available routes.',
                },
            },
        };
    }

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */
    private async callData(
        action: string,
        params: any,
        dataDriver?: any,
        scopeId?: string,
        executionContext?: ExecutionContext,
    ): Promise<any> {
        return actionExec.callData(this.domainDeps, action, params, dataDriver, scopeId, executionContext);
    }

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
            const authService: any = await this.resolveService('auth', context.environmentId);
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
            const authService: any = await this.resolveService(CoreServiceName.enum.auth);
            const sessionData = await authService?.api?.getSession?.({
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
            const qlService = await this.getObjectQLService();
            const ql = qlService ?? await this.resolveService('objectql');
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

            return this.error(
                `Forbidden: user ${userId} is not a member of project ${environmentId}`,
                403,
                { environmentId, userId, type: 'PROJECT_MEMBERSHIP_REQUIRED' },
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
    async getDiscoveryInfo(prefix: string) {
        // Resolve all services through the same async fallback chain
        // that request handlers (handleI18n, handleAuth, …) use.
        const [
            authSvc, searchSvc, realtimeSvc, filesSvc,
            analyticsSvc, workflowSvc, aiSvc, notificationSvc, i18nSvc,
            uiSvc, automationSvc, cacheSvc, queueSvc, jobSvc,
        ] = await Promise.all([
            this.resolveService(CoreServiceName.enum.auth),
            this.resolveService(CoreServiceName.enum.search),
            this.resolveService(CoreServiceName.enum.realtime),
            this.resolveService(CoreServiceName.enum['file-storage']),
            this.resolveService(CoreServiceName.enum.analytics),
            this.resolveService(CoreServiceName.enum.workflow),
            this.resolveService(CoreServiceName.enum.ai),
            this.resolveService(CoreServiceName.enum.notification),
            this.resolveService(CoreServiceName.enum.i18n),
            this.resolveService(CoreServiceName.enum.ui),
            this.resolveService(CoreServiceName.enum.automation),
            this.resolveService(CoreServiceName.enum.cache),
            this.resolveService(CoreServiceName.enum.queue),
            this.resolveService(CoreServiceName.enum.job),
        ]);

        const hasAuth         = !!authSvc;
        const hasSearch       = !!searchSvc;
        const hasFiles        = !!filesSvc;
        const hasAnalytics    = !!analyticsSvc;
        const hasWorkflow     = !!workflowSvc;
        const hasAi           = !!aiSvc;
        const hasNotification = !!notificationSvc;
        const hasI18n         = !!i18nSvc;
        const hasUi           = !!uiSvc;
        const hasAutomation   = !!automationSvc;
        const hasCache        = !!cacheSvc;
        const hasQueue        = !!queueSvc;
        const hasJob          = !!jobSvc;

        // Routes are only exposed when a plugin provides the service
        const routes = {
                data:          `${prefix}/data`,
                metadata:      `${prefix}/meta`,
                packages:      `${prefix}/packages`,
                auth:          hasAuth ? `${prefix}/auth` : undefined,
                ui:            hasUi ? `${prefix}/ui` : undefined,
                storage:       hasFiles ? `${prefix}/storage` : undefined,
                analytics:     hasAnalytics ? `${prefix}/analytics` : undefined,
                automation:    hasAutomation ? `${prefix}/automation` : undefined,
                workflow:      hasWorkflow ? `${prefix}/workflow` : undefined,
                // Never advertised (ADR-0076 D12, #2462): service-realtime is an
                // in-process pub/sub bus — the dispatcher has no /realtime branch
                // and no plugin mounts one, so an advertised route would 404.
                // Re-add only when a real HTTP/WS surface exists (and then it must
                // pass through the shouldDenyAnonymous gate, #2567).
                realtime:      undefined,
                notifications: hasNotification ? `${prefix}/notifications` : undefined,
                ai:            hasAi ? `${prefix}/ai` : undefined,
                i18n:          hasI18n ? `${prefix}/i18n` : undefined,
                // MCP (Streamable HTTP) is a default-on core capability —
                // advertised unless OS_MCP_SERVER_ENABLED=false opts the env
                // out. The objectui Integrations page reads this.
                //
                // `declared === enforced` here is guaranteed by a LOCKSTEP, not
                // by service-presence gating like the routes above (#3369 /
                // #2698): `os serve` auto-loads plugin-mcp from the SAME
                // `isMcpServerEnabled()` flag that gates this advertisement, so
                // whenever `/mcp` is advertised the handler is mounted (a key /
                // token yields 401, never a 404/501). Kept flag-based on purpose
                // — `@objectstack/rest` advertises `mcp` from the identical
                // single source (rest-server.ts), so the two discovery producers
                // stay symmetric. The route-parity gate asserts the lockstep
                // holds (advertised ⇒ reachable, never 501).
                mcp:           isMcpServerEnabled() ? `${prefix}/mcp` : undefined,
        };

        // Build per-service status map
        // handlerReady: true means the dispatcher has a real, bound handler for this route.
        // handlerReady: false means the route is present in the discovery table but may not
        // yet have a concrete implementation or may be served by a stub.
        //
        // Honest capabilities (ADR-0076 D12, #2462): a registered service that
        // self-identifies as a stub / dev fake / degraded fallback (via the
        // `__serviceInfo` marker or plugin-dev's legacy `_dev: true`) is
        // reported with its declared status — never as `available` — so
        // consumers (AI agents, the console) don't mistake a fake capability
        // for a real one.
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
        const svcUnavailable = (name: string) => ({
            enabled: false, status: 'unavailable' as const, handlerReady: false,
            message: `Install a ${name} plugin to enable`,
        });

        // Self-description of the registered realtime service, if any (D12).
        const realtimeSelf = realtimeSvc ? readServiceSelfInfo(realtimeSvc) : undefined;

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
            environment: getEnv('NODE_ENV', 'development'),
            routes,
            endpoints: routes, // Alias for backward compatibility with some clients
            features: {
                search: hasSearch,
                // No WS/HTTP realtime surface is mounted anywhere — a mere
                // in-process realtime service must not advertise websockets
                // (ADR-0076 D12, #2462).
                websockets: false,
                files: hasFiles,
                analytics: hasAnalytics,
                ai: hasAi,
                workflow: hasWorkflow,
                notifications: hasNotification,
                i18n: hasI18n,
            },
            services: {
                // Kernel-provided (always available via protocol implementation)
                metadata:       { enabled: true, status: 'degraded' as const, handlerReady: true, route: routes.metadata, provider: 'kernel', message: 'In-memory registry; DB persistence pending' },
                data:           svcAvailable(routes.data, 'kernel'),
                // Plugin-provided — only available when a plugin registers the service
                auth:           hasAuth ? svcAvailable(routes.auth, undefined, authSvc) : svcUnavailable('auth'),
                automation:     hasAutomation ? svcAvailable(routes.automation, undefined, automationSvc) : svcUnavailable('automation'),
                analytics:      hasAnalytics ? svcAvailable(routes.analytics, undefined, analyticsSvc) : svcUnavailable('analytics'),
                cache:          hasCache ? svcAvailable(undefined, undefined, cacheSvc) : svcUnavailable('cache'),
                queue:          hasQueue ? svcAvailable(undefined, undefined, queueSvc) : svcUnavailable('queue'),
                job:            hasJob ? svcAvailable(undefined, undefined, jobSvc) : svcUnavailable('job'),
                ui:             hasUi ? svcAvailable(routes.ui, undefined, uiSvc) : svcUnavailable('ui'),
                workflow:       hasWorkflow ? svcAvailable(routes.workflow, undefined, workflowSvc) : svcUnavailable('workflow'),
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
                notification:   hasNotification ? svcAvailable(routes.notifications, undefined, notificationSvc) : svcUnavailable('notification'),
                ai:             hasAi ? svcAvailable(routes.ai, undefined, aiSvc) : svcUnavailable('ai'),
                i18n:           hasI18n ? svcAvailable(routes.i18n, undefined, i18nSvc) : svcUnavailable('i18n'),
                'file-storage': hasFiles ? svcAvailable(routes.storage, undefined, filesSvc) : svcUnavailable('file-storage'),
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
            const authService: any = await this.resolveService(CoreServiceName.enum.auth);
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

    /** Thin delegate — body extracted to `./domains/storage.ts` (D11③ PR-3). */
    async handleStorage(path: string, method: string, file: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleStorageRequest(this.domainDeps, path, method, file, context);
    }

    /** Thin delegate — body extracted to `./domains/ui.ts` (D11③ PR-3). */
    async handleUi(path: string, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleUiRequest(this.domainDeps, path, query, _context);
    }

    /** Thin delegate — body extracted to `./domains/automation.ts` (D11③ PR-6). */
    async handleAutomation(path: string, method: string, body: any, context: HttpProtocolContext, query?: any): Promise<HttpDispatcherResult> {
        return handleAutomationRequest(this.domainDeps, path, method, body, context, query);
    }

    private getServicesMap(): Record<string, any> {
        if (this.kernel.services instanceof Map) {
            return Object.fromEntries(this.kernel.services);
        }
        return this.kernel.services || {};
    }

    private async getService(name: CoreServiceName) {
        return this.resolveService(name);
    }

    /**
     * Resolve any service by name, supporting async factories.
     * Fallback chain: getServiceAsync(scopeId) → getServiceAsync → getService (sync) → context.getService → services map.
     * Only returns when a non-null service is found; otherwise falls through to the next step.
     *
     * When `scopeId` is provided, tries the SCOPED factory on `defaultKernel` first (SharedProjectPlugin
     * mode). Falls back to the current `kernel` for singleton / legacy services.
     */
    private async resolveService(name: string, scopeId?: string) {
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
        if (typeof this.kernel.getServiceAsync === 'function') {
            try {
                const svc = await this.kernel.getServiceAsync(name);
                if (svc != null) return svc;
            } catch {
                // Service not registered or async resolution failed — fall through
            }
        }
        if (typeof this.kernel.getService === 'function') {
            try {
                const svc = await this.kernel.getService(name);
                if (svc != null) return svc;
            } catch {
                // Service not registered or sync resolution threw "is async" — fall through
            }
        }
        if (this.kernel?.context?.getService) {
            try {
                const svc = await this.kernel.context.getService(name);
                if (svc != null) return svc;
            } catch {
                // Service not registered — fall through
            }
        }
        const services = this.getServicesMap();
        return services[name];
    }

    /**
     * Get the ObjectQL service which provides access to SchemaRegistry.
     * Tries multiple access patterns since kernel structure varies.
     */
    private async getObjectQLService(scopeId?: string): Promise<any> {
        // 1. Try via resolveService (handles scoped, async factories, sync, context, and map)
        try {
            const svc = await this.resolveService('objectql', scopeId);
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

        // ── Environment Resolution + Multi-Kernel Routing (ADR-0006 Phase 5) ──
        // The host's KernelResolver owns the whole step: it resolves the
        // request to an environment (hostname / header / session / defaults —
        // strategy lives in the cloud distribution), SETS
        // `context.environmentId` (+ `dataDriver`), and returns the kernel to
        // serve from. The dispatcher only contributes parsing hints. No
        // resolver registered → single-environment: every request serves from
        // `defaultKernel` with no environment context.
        this.prepareResolverHints(context, cleanPath);
        if (this.kernelResolver) {
            this.kernel = (await this.kernelResolver.resolveKernel(context, this.defaultKernel)) ?? this.defaultKernel;
        } else {
            this.kernel = this.defaultKernel;
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
                getService: (n: string) => this.resolveService(n, context.environmentId),
                // Resolve ObjectQL from the per-request kernel DIRECTLY. The scoped
                // `resolveService('objectql', envId)` factory can return a different
                // instance that doesn't see THIS env's rows (the gotcha
                // `handleActions` works around) — which made the api-key lookup miss
                // `sys_api_key` on the MCP path and reject valid keys with 401, while
                // REST accepted them (rest-server resolves identity via
                // `kernel.getServiceAsync('objectql')`). Resolving off `this.kernel`
                // keeps REST + MCP identity resolution aligned; falls back to the
                // scoped path when the kernel can't hand back an objectql directly.
                getQl: async () => {
                    const k: any = this.kernel;
                    if (k && typeof k.getServiceAsync === 'function') {
                        const ql = await k.getServiceAsync('objectql').catch(() => undefined);
                        if (ql && (ql.registry || typeof ql.find === 'function')) return ql;
                    }
                    return this.getObjectQLService(context.environmentId);
                },
                request: context.request,
                // OAuth 2.1 access tokens are honoured ONLY on the MCP
                // surface (#2698): their coarse tool-family scopes are
                // enforced at MCP tool dispatch, which other routes don't do.
                // Matches the plain and `/projects/:id`-scoped route forms
                // (the scoped prefix is stripped only later, below).
                acceptOAuthAccessToken: /^(?:\/projects\/[^/]+)?\/mcp(?:[/?]|$)/.test(cleanPath),
            });
        } catch {
            // anonymous request — leave executionContext undefined
        }

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
            return domainRoute.handler({ path: cleanPath, method, body, query }, context);
        }

        // 0. Discovery Endpoint (GET /discovery or GET /)
        // Standard route: /discovery (protocol-compliant)
        // Legacy route: / (empty path, for backward compatibility — MSW strips base URL)
        if ((cleanPath === '/discovery' || cleanPath === '') && method === 'GET') {
             const info = await this.getDiscoveryInfo(prefix ?? '');
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

        // OpenAPI Specification
        if (cleanPath === '/openapi.json' && method === 'GET') {
             try {
                const metaSvc = await this.resolveService('metadata', context.environmentId);
                if (metaSvc && typeof (metaSvc as any).generateOpenApi === 'function') {
                    const result = await (metaSvc as any).generateOpenApi({});
                    return { handled: true, response: this.success(result) };
                }
             } catch (e) {
                // If not implemented, fall through or return 404
             }
        }

        // 2. Custom API Endpoints (Registry lookup)
        // Check if there is a custom endpoint defined for this path
        const result = await this.handleApiEndpoint(cleanPath, method, body, query, context);
        if (result.handled) return result;

        // 3. Fallback — return semantic 404 with diagnostic info
        return {
            handled: true,
            response: this.routeNotFound(cleanPath),
        };
        } catch (e) {
            if (isPermissionDeniedError(e)) {
                return {
                    handled: true,
                    response: this.error(e.message, 403, { code: 'PERMISSION_DENIED', ...(e.details ?? {}) }),
                };
            }
            throw e;
        }
    }

    /**
     * Handles Custom API Endpoints defined in metadata
     */
    async handleApiEndpoint(path: string, method: string, body: any, query: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        try {
            // Attempt to find a matching endpoint in the registry
            const metaSvc = await this.resolveService('metadata', context.environmentId);
            if (!metaSvc || typeof (metaSvc as any).matchEndpoint !== 'function') {
                return { handled: false };
            }
            const endpoint = await (metaSvc as any).matchEndpoint({ path, method });
            
            if (endpoint) {
                // Execute the endpoint target logic
                if (endpoint.type === 'flow') {
                    const automationSvc = await this.resolveService('automation');
                    if (!automationSvc || typeof (automationSvc as any).runFlow !== 'function') {
                        return { handled: true, response: this.error('Automation service not available', 503) };
                    }
                    const result = await (automationSvc as any).runFlow({ 
                        flowId: endpoint.target, 
                        inputs: { ...query, ...body, _request: context.request } 
                    });
                     return { handled: true, response: this.success(result) };
                }
                
                if (endpoint.type === 'script') {
                    const automationSvc = await this.resolveService('automation');
                    if (!automationSvc || typeof (automationSvc as any).runScript !== 'function') {
                        return { handled: true, response: this.error('Automation service not available', 503) };
                    }
                     const result = await (automationSvc as any).runScript({ 
                        scriptName: endpoint.target, 
                        context: { ...query, ...body, request: context.request } 
                    });
                     return { handled: true, response: this.success(result) };
                }

                if (endpoint.type === 'object_operation') {
                    // e.g. Proxy to an object action
                    if (endpoint.objectParams) {
                        const { object, operation } = endpoint.objectParams;
                        // Map standard CRUD operations
                        if (operation === 'find') {
                             const result = await this.callData('query', { object, query });
                             // Spec: FindDataResponse = { object, records, total?, hasMore? }
                             return { handled: true, response: this.success(result.records, { total: result.total }) };
                        }
                        if (operation === 'get' && query.id) {
                             const result = await this.callData('get', { object, id: query.id });
                             return { handled: true, response: this.success(result) };
                        }
                         if (operation === 'create') {
                             const result = await this.callData('create', { object, data: body });
                             return { handled: true, response: this.success(result) };
                        }
                    }
                }

                if (endpoint.type === 'proxy') {
                     return { 
                         handled: true, 
                         response: { 
                             status: 200, 
                             body: { proxy: true, target: endpoint.target, note: 'Proxy execution requires http-client service' } 
                         } 
                     };
                }
            }
        } catch (e) {
            // If matchEndpoint fails (e.g. not found), we just return not handled
            // so we can fallback to 404 or other handlers
        }

        return { handled: false };
    }
}
