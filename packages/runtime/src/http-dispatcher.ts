// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import {
    ObjectKernel, getEnv, evaluateAuthGate, isAuthGateAllowlisted,
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import { isMcpServerEnabled } from '@objectstack/types';
import { measureServerTiming, allowPerfDisclosure, isPerfDisclosurePrincipal } from '@objectstack/observability';
import { CoreServiceName } from '@objectstack/spec/system';
import { readServiceSelfInfo } from '@objectstack/spec/api';
import { MCP_OAUTH_SCOPES } from '@objectstack/spec/ai';
import { pluralToSingular } from '@objectstack/spec/shared';
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

/** Minimal local interface — full EnvironmentScopeManager was removed in Phase R. */
interface EnvironmentScopeManager {
    touch(environmentId: string): void;
}
import {
    resolveExecutionContext,
    isPermissionDeniedError,
} from './security/resolve-execution-context.js';

// randomUUID moved to ./domains/auth.ts with its only consumer (D11③ PR-7).

/** A `sys_`-prefixed object is a system table — off-limits to external MCP agents. */
function isSystemObjectName(name: string): boolean {
    return /^sys_/i.test(name);
}

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
     * ADR-0046: `doc` list responses omit `content` by default — manuals
     * are the one metadata payload that grows unbounded, and the list
     * surface only needs `name` + `label`. `?include=content` opts back in
     * (single-item GET /metadata/doc/:name always returns the full body).
     */
    private slimDocList(type: string, data: any, query?: Record<string, string>): any {
        if (type !== 'doc' || query?.include === 'content') return data;
        const strip = (items: any[]) =>
            items.map((i) => {
                if (!i || typeof i !== 'object') return i;
                const { content: _content, ...rest } = i as Record<string, unknown>;
                return rest;
            });
        if (Array.isArray(data)) return strip(data);
        if (data && Array.isArray(data.items)) return { ...data, items: strip(data.items) };
        return data;
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

    /**
     * Handle an MCP request over the Streamable HTTP transport (`/mcp`).
     *
     * Gating + auth (fail-closed):
     *  - **default-on**: served unless `OS_MCP_SERVER_ENABLED=false` (single-env
     *    runtime; MCP is a core platform capability). Multi-tenant cloud
     *    overrides this gate per env. When opted out we return 404 so the
     *    surface isn't advertised.
     *  - **auth**: requires a principal already resolved by
     *    `resolveExecutionContext` (the `sys_api_key` Bearer/header path or a
     *    session). Anonymous → 401.
     *
     * Execution: the MCP runtime builds a stateless per-request server whose
     * object-CRUD tools run through {@link callData} bound to THIS request's
     * ExecutionContext — i.e. the exact permission + RLS path the REST API
     * uses. An external agent can never exceed the key's authority.
     */
    async handleMcp(body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        if (!HttpDispatcher.isMcpEnabled()) {
            return { handled: true, response: this.error('MCP server is not enabled for this environment', 404) };
        }

        const mcp: any = await this.resolveService('mcp', context.environmentId);
        if (!mcp || typeof mcp.handleHttpRequest !== 'function') {
            return { handled: true, response: this.error('MCP server is not available', 501) };
        }

        const ec = context.executionContext;
        if (!ec || (!ec.userId && !ec.isSystem)) {
            // Per the MCP authorization spec (RFC 9728 §5.1), a 401 from the
            // protected resource advertises where its metadata lives so an
            // OAuth-capable client can bootstrap discovery → DCR → PKCE.
            // Only advertised when the OAuth track is actually live (AS on +
            // TLS rule satisfied); API-key-only deployments return a plain 401.
            const resourceMetadataUrl = await this.getMcpResourceMetadataUrl(context);
            const response = this.error(
                resourceMetadataUrl
                    ? 'Unauthorized: a valid OAuth access token or API key is required'
                    : 'Unauthorized: a valid API key is required',
                401,
            ) as { status: number; body: any; headers?: Record<string, string> };
            if (resourceMetadataUrl) {
                response.headers = {
                    'WWW-Authenticate':
                        `Bearer realm="ObjectStack MCP", resource_metadata="${resourceMetadataUrl}"`,
                };
            }
            return { handled: true, response };
        }

        // ── OAuth scope → tool-family enforcement (fail-closed, #2698) ──
        // `oauthScopes` is set ONLY for OAuth-token provenance. A token that
        // grants none of the MCP tool families gets 403 insufficient_scope
        // up front; a partial grant narrows the tool set at registration
        // time inside the MCP runtime. API-key / session principals
        // (`oauthScopes` undefined) keep the full principal-bound surface.
        const grantedScopes = Array.isArray((ec as any).oauthScopes)
            ? ((ec as any).oauthScopes as string[])
            : undefined;
        if (grantedScopes && !grantedScopes.some((s) => (MCP_OAUTH_SCOPES as readonly string[]).includes(s))) {
            const resourceMetadataUrl = await this.getMcpResourceMetadataUrl(context);
            const response = this.error(
                `Forbidden: the access token grants none of the MCP scopes (${MCP_OAUTH_SCOPES.join(', ')})`,
                403,
            ) as { status: number; body: any; headers?: Record<string, string> };
            response.headers = {
                'WWW-Authenticate':
                    'Bearer error="insufficient_scope"' +
                    `, scope="${MCP_OAUTH_SCOPES.join(' ')}"` +
                    (resourceMetadataUrl ? `, resource_metadata="${resourceMetadataUrl}"` : ''),
            };
            return { handled: true, response };
        }

        // The MCP transport needs a Web-standard Request. The runtime HTTP
        // adapter may hand us a node/Hono-style req (plain `headers` object,
        // path-only `url`), so normalise it.
        const webRequest = this.toMcpWebRequest(context.request, body);
        if (!webRequest) {
            return { handled: true, response: this.error('MCP transport requires a standard HTTP request', 400) };
        }

        const bridge = this.buildMcpBridge(context);
        let webRes: Response;
        try {
            webRes = await mcp.handleHttpRequest(webRequest, {
                bridge,
                parsedBody: body,
                // undefined = not scope-limited (API key / session); an array
                // narrows the registered tool families inside the MCP runtime.
                ...(grantedScopes ? { toolOptions: { grantedScopes } } : {}),
            });
        } catch (err: any) {
            return { handled: true, response: this.error(err?.message ?? 'MCP request failed', 500) };
        }

        // Convert the transport's buffered Web Response into the dispatcher's
        // `{ status, headers, body }` shape (JSON-response mode → fully buffered).
        const headers: Record<string, string> = {};
        try { webRes.headers.forEach((v, k) => { headers[k] = v; }); } catch { /* no headers */ }
        const text = await webRes.text().catch(() => '');
        let responseBody: any = null;
        if (text) {
            const ct = headers['content-type'] ?? '';
            if (ct.includes('application/json')) {
                try { responseBody = JSON.parse(text); } catch { responseBody = text; }
            } else {
                responseBody = text;
            }
        }
        return { handled: true, response: { status: webRes.status, headers, body: responseBody } };
    }

    /**
     * Whether the MCP HTTP surface is on for this single-env runtime.
     * Default-on core capability; `OS_MCP_SERVER_ENABLED=false` opts out
     * (single decision point: `isMcpServerEnabled` in `@objectstack/types`).
     */
    private static isMcpEnabled(): boolean {
        return isMcpServerEnabled();
    }

    /**
     * Absolute URL of the RFC 9728 protected-resource metadata for the MCP
     * endpoint, advertised via `WWW-Authenticate` (#2698). `null` when the
     * OAuth track is off — the auth service owns the decision (AS enabled +
     * OAuth 2.1 TLS rule), the dispatcher only relays it. Never throws.
     */
    private async getMcpResourceMetadataUrl(context: HttpProtocolContext): Promise<string | null> {
        try {
            const authService: any = await this.resolveService('auth', context.environmentId);
            const url = authService?.getMcpResourceMetadataUrl?.();
            return typeof url === 'string' && url ? url : null;
        } catch {
            return null;
        }
    }

    /**
     * `GET /mcp/skill` — the environment-customized portable Agent Skill
     * (`SKILL.md`), rendered by the MCP service (ADR-0036 Amendment C: ONE
     * generic skill; only the connection URL is environment-specific).
     *
     * Served PUBLIC like `/discovery`: the content is generic agent
     * instructions plus a URL the caller already knows — no schema, no
     * tenant data. Gated on the same default-on switch as the `/mcp` route
     * (404 when opted out, so the surface isn't advertised) and 501 when the
     * MCP plugin isn't loaded, mirroring `handleMcp`.
     */
    async handleMcpSkill(method: string, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        if (!HttpDispatcher.isMcpEnabled()) {
            return { handled: true, response: this.error('MCP server is not enabled for this environment', 404) };
        }
        if (method !== 'GET') {
            return {
                handled: true,
                response: {
                    status: 405,
                    headers: { Allow: 'GET' },
                    body: { success: false, error: { message: 'Method not allowed — use GET', code: 405 } },
                },
            };
        }

        const mcp: any = await this.resolveService('mcp', context.environmentId);
        if (!mcp || typeof mcp.renderSkill !== 'function') {
            return { handled: true, response: this.error('MCP server is not available', 501) };
        }

        // Resolve this environment's MCP URL for the skill's Connect section:
        // the auth service owns the canonical value (base URL config); fall
        // back to deriving from the request host so the endpoint still works
        // when the auth plugin isn't loaded.
        let mcpUrl: string | undefined;
        try {
            const authService: any = await this.resolveService('auth', context.environmentId);
            const url = authService?.getMcpResourceUrl?.();
            if (typeof url === 'string' && url) mcpUrl = url;
        } catch { /* fall through to host derivation */ }
        if (!mcpUrl) {
            try {
                const webReq = this.toMcpWebRequest(context.request, undefined);
                const host = webReq?.headers.get('host');
                if (host) {
                    const proto = webReq?.headers.get('x-forwarded-proto') || 'http';
                    mcpUrl = `${proto}://${host}/api/v1/mcp`;
                }
            } catch { /* leave the documented placeholder in place */ }
        }

        const markdown: string = mcp.renderSkill({ mcpUrl });
        // Raw text must NOT ride the `response` channel — `sendResult` JSON-
        // encodes those bodies unconditionally. The `result` stream channel is
        // the one raw pipe through every adapter (string events are written
        // verbatim, custom headers honored), so serve the markdown as a
        // single-chunk "stream".
        return {
            handled: true,
            result: {
                type: 'stream',
                status: 200,
                contentType: 'text/markdown; charset=utf-8',
                headers: {
                    'content-type': 'text/markdown; charset=utf-8',
                    'content-disposition': 'inline; filename="SKILL.md"',
                    // Same reasoning as /discovery (cloud#152): reflects mutable
                    // runtime config (base URL), must never be edge-cached stale.
                    'cache-control': 'no-store',
                },
                events: (async function* () {
                    yield markdown;
                })(),
            },
        } as any;
    }

    /**
     * Normalise the inbound request into a Web-standard `Request` for the MCP
     * transport. Accepts an already-Web `Request`, or a node/Hono-style req
     * (plain `headers` object, path-only `url`). Returns undefined only if the
     * shape is unusable. The body is carried separately via `parsedBody`, so a
     * GET/DELETE (no body) and a POST (JSON-RPC) both normalise cleanly.
     */
    private toMcpWebRequest(raw: any, parsedBody: any): Request | undefined {
        if (!raw) return undefined;
        // Already a Web Request.
        if (typeof raw.headers?.get === 'function' && typeof raw.url === 'string' && typeof raw.method === 'string') {
            return raw as Request;
        }
        try {
            const method = String(raw.method ?? 'POST').toUpperCase();

            // Normalise headers (plain object or Headers-like).
            const headers = new Headers();
            const h = raw.headers;
            if (h) {
                if (typeof h.forEach === 'function') {
                    h.forEach((v: any, k: any) => { if (v != null) headers.set(String(k), String(v)); });
                } else {
                    for (const k of Object.keys(h)) {
                        const v = (h as any)[k];
                        if (v != null) headers.set(k, Array.isArray(v) ? v.join(',') : String(v));
                    }
                }
            }

            // Build an absolute URL (node req.url is path-only).
            let url: string;
            try {
                url = new URL(String(raw.url)).toString();
            } catch {
                const host = headers.get('host') || 'mcp.local';
                const path = typeof raw.url === 'string' && raw.url ? raw.url : '/api/v1/mcp';
                url = `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
            }

            const init: { method: string; headers: Headers; body?: string } = { method, headers };
            if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
                init.body = typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody ?? {});
            }
            return new Request(url, init);
        } catch {
            return undefined;
        }
    }

    /**
     * Build a principal-bound {@link McpDataBridge}: every method runs AS the
     * request's ExecutionContext through {@link callData} (RLS/permissions) and
     * the per-env metadata service. Keeps the MCP tool layer free of any direct
     * engine access.
     */
    private buildMcpBridge(context: HttpProtocolContext): any {
        const ec = context.executionContext;
        const envId = context.environmentId;
        const driver = (context as any).dataDriver;
        const callData = this.callData.bind(this);
        const getMeta = () => this.resolveService('metadata', envId);

        return {
            listObjects: async () => {
                const meta: any = await getMeta();
                const objs: any[] = (await meta?.listObjects?.()) ?? [];
                return objs.map((o) => ({
                    name: o.name,
                    label: o.label ?? o.name,
                    fieldCount: o.fields ? Object.keys(o.fields).length : undefined,
                }));
            },
            describeObject: async (name: string) => {
                const meta: any = await getMeta();
                const def: any = await meta?.getObject?.(name);
                if (!def) return null;
                const fields = def.fields ?? {};
                return {
                    name: def.name,
                    label: def.label ?? def.name,
                    fields: Object.entries(fields).map(([k, f]: [string, any]) => ({
                        name: k,
                        type: f?.type,
                        label: f?.label ?? k,
                        required: f?.required ?? false,
                    })),
                    enableFeatures: def.enable ?? {},
                };
            },
            query: async (object: string, o: any) => {
                const query: any = {};
                if (o?.where) query.where = o.where;
                if (o?.fields) query.fields = o.fields;
                if (typeof o?.limit === 'number') query.limit = o.limit;
                if (typeof o?.offset === 'number') query.offset = o.offset;
                if (o?.orderBy) query.orderBy = o.orderBy;
                return await callData('query', { object, query }, driver, envId, ec);
            },
            get: async (object: string, id: string) => {
                const res: any = await callData('get', { object, id }, driver, envId, ec);
                return res?.record ?? res ?? null;
            },
            aggregate: async (object: string, o: any) => {
                // NOTE: `driver` (the raw per-env db driver) is deliberately NOT
                // passed — callData's aggregate branch resolves the ObjectQL
                // engine itself so the security middleware (RLS + FLS aggregate
                // gate) always runs. See the branch comment in callData.
                const res: any = await callData(
                    'aggregate',
                    {
                        object,
                        where: o?.where,
                        groupBy: o?.groupBy,
                        aggregations: o?.aggregations,
                        timezone: o?.timezone,
                    },
                    undefined,
                    envId,
                    ec,
                );
                return res?.rows ?? [];
            },
            create: async (object: string, data: any) =>
                await callData('create', { object, data }, driver, envId, ec),
            update: async (object: string, id: string, data: any) =>
                await callData('update', { object, id, data }, driver, envId, ec),
            remove: async (object: string, id: string) =>
                await callData('delete', { object, id }, driver, envId, ec),

            // ── Business-action surface (McpActionBridge) ──────────────
            // Resolution + dispatch flow through the framework's own action
            // mechanism (engine.executeAction / automation flow runner). All
            // gating is at INVOKE time — `ai.exposed` (author opt-in, #2849) +
            // the ADR-0066 D4 capability gate + record load under the caller's
            // RLS. Script/body handlers then run TRUSTED (see
            // buildActionEngineFacade); flows honour `runAs` with the caller's
            // identity forwarded. No `@objectstack/service-ai`.
            listActions: async () => {
                const meta: any = await getMeta();
                const hasAutomation = Boolean(
                    await this.resolveService('automation', envId).catch(() => null),
                );
                const out: any[] = [];
                for (const { action, objectName, obj } of await actionExec.collectActionDeclarations(this.domainDeps, meta)) {
                    if (!objectName || isSystemObjectName(objectName)) continue; // fail-closed on sys_*
                    if (!actionExec.isHeadlessInvokableAction(this.domainDeps, action, hasAutomation)) continue;
                    // [#2849 / ADR-0011] MCP is an AI surface: only actions the
                    // author explicitly opted in via `ai.exposed` are listed.
                    // Fail-closed — bodies run as trusted code (see
                    // buildActionEngineFacade), so author opt-in is the boundary.
                    if (actionExec.actionAiExposureError(this.domainDeps, action)) continue;
                    // Hide actions the caller is not permitted to run.
                    if (this.actionPermissionError(action, ec)) continue;
                    out.push(actionExec.summarizeAction(this.domainDeps, action, obj, objectName));
                }
                return out;
            },
            runAction: async (
                name: string,
                input: { objectName?: string; recordId?: string; params?: Record<string, unknown> },
            ) => actionExec.invokeBusinessAction(this.domainDeps, name, input ?? {}, { driver, envId, ec, getMeta, callData }),
        };
    }

    // ── MCP action bridge helpers ──────────────────────────────────────

    /** Thin delegate — body extracted to `./action-execution.ts` (D11③ PR-8). */
    private actionPermissionError(actionDef: any, ec: any, objectName?: string): string | null {
        return actionExec.actionPermissionError(this.domainDeps, actionDef, ec, objectName);
    }

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
    private enforceActionParams(
        action: any,
        obj: any,
        bag: Record<string, unknown>,
        where: { objectName?: string; actionName?: string },
    ): string | null {
        return actionExec.enforceActionParams(this.domainDeps, action, obj, bag, where);
    }

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
    private buildActionSession(ec: any): any | undefined {
        return actionExec.buildActionSession(this.domainDeps, ec);
    }

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
                mcp:           HttpDispatcher.isMcpEnabled() ? `${prefix}/mcp` : undefined,
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


    /**
     * Handles Metadata requests
     * Standard: /metadata/:type/:name
     * Fallback for backward compat: /metadata (all objects), /metadata/:objectName (get object)
     */
    async handleMetadata(path: string, _context: HttpProtocolContext, method?: string, body?: any, query?: any): Promise<HttpDispatcherResult> {
        // Defense-in-depth: the metadata catch-all must honour the same
        // `requireAuth` gate as the REST `/meta` routes (which serve `/meta` on
        // the cloud runtime). Object/field schemas — SYSTEM-object schemas on a
        // tenant-less host — must not be readable by anonymous callers when the
        // deployment requires auth. No-op when `requireAuth` is off.
        {
            const ec: any = _context.executionContext;
            if (shouldDenyAnonymous({ requireAuth: this.requireAuth, userId: ec?.userId, isSystem: ec?.isSystem })) {
                return {
                    handled: true,
                    response: this.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
                };
            }
        }
        const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

        // GET /metadata/types
        if (parts[0] === 'types') {
            // PRIORITY 1: Try protocol service — it returns BOTH legacy
            // `types: string[]` AND the richer `entries` array (with
            // JSON Schemas, allowOrgOverride flags, domain, etc) needed by
            // the metadata admin UI. It internally also merges
            // MetadataService runtime types, so this path is strictly richer.
            const protocol = await this.resolveService('protocol');
            if (protocol && typeof protocol.getMetaTypes === 'function') {
                try {
                    const result = await protocol.getMetaTypes({});
                    return { handled: true, response: this.success(result) };
                } catch (e: any) {
                    console.warn('[HttpDispatcher] protocol.getMetaTypes() failed:', e?.message);
                }
            }
            // PRIORITY 2: MetadataService fallback (types only, no entries)
            const metadataService = await this.resolveService('metadata', _context.environmentId);
            if (metadataService && typeof (metadataService as any).getRegisteredTypes === 'function') {
                try {
                    const types = await (metadataService as any).getRegisteredTypes();
                    return { handled: true, response: this.success({ types }) };
                } catch (e: any) {
                    console.warn('[HttpDispatcher] MetadataService.getRegisteredTypes() failed:', e.message);
                }
            }
            // Last resort: hardcoded defaults
            return { handled: true, response: this.success({ types: ['object', 'app', 'plugin'] }) };
        }

        // GET /metadata/objects/:name/state/:field?from=:state
        // ADR-0020 D3.3 introspection: the legal next states declared by the
        // object's `state_machine` validation rule for `:field`. Lets UIs /
        // AI authors ask "from here, where can this record go?" instead of
        // hard-coding the transition table. Returns `next: null` when no FSM
        // governs the field, `next: []` for a declared dead-end state.
        if (parts.length === 4 && (parts[0] === 'objects' || parts[0] === 'object') && parts[2] === 'state' && (!method || method === 'GET')) {
            const name = parts[1];
            const field = parts[3];
            const from = query?.from !== undefined ? String(query.from) : undefined;
            const qlService = await this.getObjectQLService();
            const schema = qlService?.registry?.getObject(name);
            if (!schema) return { handled: true, response: this.error('Object not found', 404) };
            // Dynamic import (matches the runtime convention for @objectstack/objectql)
            // so the dispatcher module graph doesn't statically pull in the objectql barrel.
            const { legalNextStates } = await import('@objectstack/objectql');
            const next = from === undefined ? null : legalNextStates(schema, field, from);
            return { handled: true, response: this.success({ object: name, field, from: from ?? null, next }) };
        }

        // GET /metadata/:type/:name(/:subname...)/published → get published version
        // Supports compound names like `lead/views/all_leads/published`.
        if (parts.length >= 3 && parts[parts.length - 1] === 'published' && (!method || method === 'GET')) {
            const type = parts[0];
            const name = parts.slice(1, -1).join('/');
            const metadataService = await this.getService(CoreServiceName.enum.metadata);
            if (metadataService && typeof (metadataService as any).getPublished === 'function') {
                const data = await (metadataService as any).getPublished(type, name);
                if (data === undefined) return { handled: true, response: this.error('Not found', 404) };
                return { handled: true, response: this.success(data) };
            }
            // Fallback — try MetadataService via resolveService
            const metaSvc = await this.resolveService('metadata', _context.environmentId);
            if (metaSvc && typeof (metaSvc as any).getPublished === 'function') {
                try {
                    const fallbackData = await (metaSvc as any).getPublished(type, name);
                    if (fallbackData !== undefined) return { handled: true, response: this.success(fallbackData) };
                } catch { /* fall through */ }
            }
            return { handled: true, response: this.error('Not found', 404) };
        }

        // /metadata/:type/:name where :name may itself contain slashes
        // (e.g. /metadata/lead/views/all_leads → type='lead', name='views/all_leads').
        // Compound names are how the client expresses sub-resources of a type
        // (a view of an object, a flow under an automation, etc.) and the
        // metadata service treats the full string as the lookup key.
        if (parts.length >= 2) {
            const type = parts[0];
            const name = parts.slice(1).join('/');
            // Extract optional package filter from query string
            const packageId = query?.package || undefined;

            // PUT /metadata/:type/:name (Save)
            if (method === 'PUT' && body) {
                // Try to get the protocol service directly
                const protocol = await this.resolveService('protocol');

                if (protocol && typeof protocol.saveMetaItem === 'function') {
                    try {
                        const organizationId = await this.resolveActiveOrganizationId(_context);
                        const result = await protocol.saveMetaItem({ type, name, item: body, organizationId, ...(packageId ? { packageId } : {}) });
                        return { handled: true, response: this.success(result) };
                    } catch (e: any) {
                        // Preserve the 422 + structured spec-validation `issues` so
                        // the Studio can point at the offending field, not just a
                        // generic banner (the old path hardcoded 400 + dropped them).
                        return { handled: true, response: this.errorFromThrown(e, 400) };
                    }
                }

                // Fallback: try MetadataService directly
                const metaSvc = await this.resolveService('metadata', _context.environmentId);
                if (metaSvc && typeof (metaSvc as any).saveItem === 'function') {
                    try {
                        const data = await (metaSvc as any).saveItem(type, name, body);
                        return { handled: true, response: this.success(data) };
                    } catch (e: any) {
                        return { handled: true, response: this.error(e.message || 'Save not supported', 501) };
                    }
                }
                return { handled: true, response: this.error('Save not supported', 501) };
            }

            try {
                // Try specific calls based on type
                if (type === 'objects' || type === 'object') {
                    // Check whether the kernel is project-scoped. When it is,
                    // the process-wide SchemaRegistry is unsafe to query
                    // directly — it would return objects that other projects
                    // wrote in this same process. Route through the Protocol
                    // service (which filters sys_metadata by environment_id) in that
                    // case, and fall back to the registry only for the
                    // unscoped (single-kernel / control-plane) path.
                    const protocol = await this.resolveService('protocol') as any;
                    const scopedEnv = typeof protocol?.getProjectId === 'function'
                        ? protocol.getProjectId()
                        : protocol?.environmentId;
                    const scoped = scopedEnv !== undefined;

                    if (scoped && typeof protocol.getMetaItem === 'function') {
                        try {
                            const organizationId = await this.resolveActiveOrganizationId(_context);
                            const data = await protocol.getMetaItem({ type: 'object', name, organizationId });
                            // Protocol returns `{ type, name, item }` — only
                            // treat the lookup as a hit when item is present.
                            if (data && (data.item ?? data)) {
                                return { handled: true, response: this.success(data) };
                            }
                        } catch { /* fall through to registry / 404 */ }
                    }

                    const qlService = await this.getObjectQLService();
                    if (qlService?.registry) {
                        const data = qlService.registry.getObject(name);
                        if (data) return { handled: true, response: this.success(data) };
                    }

                    // Last-ditch protocol attempt for unscoped kernels whose
                    // registry missed (e.g. object persisted to DB but not
                    // yet hydrated). Skip when we already tried above.
                    if (!scoped && protocol && typeof protocol.getMetaItem === 'function') {
                        try {
                            const organizationId = await this.resolveActiveOrganizationId(_context);
                            const data = await protocol.getMetaItem({ type: 'object', name, organizationId });
                            if (data && (data.item ?? data)) {
                                return { handled: true, response: this.success(data) };
                            }
                        } catch { /* fall through to 404 */ }
                    }
                    return { handled: true, response: this.error('Not found', 404) };
                }

                // Normalize plural URL paths to singular registry type names
                const singularType = pluralToSingular(type);

                // Try Protocol Service First (Preferred)
                const protocol = await this.resolveService('protocol');
                if (protocol && typeof protocol.getMetaItem === 'function') {
                     try {
                        const organizationId = await this.resolveActiveOrganizationId(_context);
                        // ADR-0033 draft-overlay preview: `?preview=draft` makes the
                        // detail read prefer a pending draft (falling back to active).
                        // Admin gating is layered on top in a follow-up (step 2).
                        const previewDrafts = query?.preview === 'draft';
                        const data = await protocol.getMetaItem({ type: singularType, name, packageId, organizationId, previewDrafts });
                        return { handled: true, response: this.success(data) };
                     } catch (e: any) {
                        // Protocol might throw if not found or not supported
                     }
                }

                // Try MetadataService for runtime-registered types
                const metaSvc = await this.resolveService('metadata', _context.environmentId);
                if (metaSvc && typeof (metaSvc as any).getItem === 'function') {
                    try {
                        // ADR-0048 — thread `?package=` so single-item resolution is
                        // package-scoped (prefer-local), matching list resolution.
                        const data = await (metaSvc as any).getItem(singularType, name, packageId);
                        if (data) return { handled: true, response: this.success(data) };
                    } catch { /* not found */ }
                }
                return { handled: true, response: this.error('Not found', 404) };
            } catch (e: any) {
                // Fallback: treat first part as object name if only 1 part (handled below)
                // But here we are deep in 2 parts. Must be an error.
                return { handled: true, response: this.error(e.message, 404) };
            }
        }
        
        // GET /metadata/_drafts?packageId=&type=  (ADR-0033 pending-changes list)
        // Surfaces draft-state metadata the active-only `getMetaItems` list hides,
        // so the console can show what an AI authored but nobody published yet.
        // `_drafts` is intercepted before the generic `:type` handler below so it
        // is never mistaken for a metadata type name.
        if (parts.length === 1 && parts[0] === '_drafts' && (!method || method.toUpperCase() === 'GET')) {
            const protocol = await this.resolveService('protocol');
            if (protocol && typeof protocol.listDrafts === 'function') {
                try {
                    const organizationId = await this.resolveActiveOrganizationId(_context);
                    const data = await protocol.listDrafts({
                        packageId: query?.packageId || undefined,
                        type: query?.type || undefined,
                        organizationId,
                    });
                    return { handled: true, response: this.success(data) };
                } catch (e: any) {
                    return { handled: true, response: this.error(e.message, 500) };
                }
            }
            return { handled: true, response: this.error('Draft listing not supported', 501) };
        }

        // GET /metadata/:type (List items of type) OR /metadata/:objectName (Legacy)
        if (parts.length === 1) {
            const typeOrName = parts[0];
            // Extract optional package filter from query string
            const packageId = query?.package || undefined;

            // Try protocol service first for any type
            const protocol = await this.resolveService('protocol');
            if (protocol && typeof protocol.getMetaItems === 'function') {
                try {
                    const organizationId = await this.resolveActiveOrganizationId(_context);
                    // ADR-0033 draft-overlay preview: `?preview=draft` overlays
                    // pending drafts on the active list so an (admin) reviewer can
                    // render the console off drafts before publishing.
                    const previewDrafts = query?.preview === 'draft';
                    const data = await protocol.getMetaItems({ type: typeOrName, packageId, organizationId, previewDrafts });
                    // Return any valid response from protocol (including empty items arrays)
                    if (data && (data.items !== undefined || Array.isArray(data))) {
                        return { handled: true, response: this.success(this.slimDocList(typeOrName, data, query)) };
                    }
                } catch {
                    // Protocol doesn't know this type, fall through
                }
            }

            // Try MetadataService directly for runtime-registered metadata (agents, tools, etc.)
            const metadataService = await this.getService(CoreServiceName.enum.metadata);
            if (metadataService && typeof (metadataService as any).list === 'function') {
                try {
                    let items = await (metadataService as any).list(typeOrName);
                    // Respect package filter: MetadataService.list() returns ALL items,
                    // so filter by _packageId when a specific package is requested.
                    if (packageId && items && items.length > 0) {
                        items = items.filter((item: any) => item?._packageId === packageId);
                    }
                    if (items && items.length > 0) {
                        return { handled: true, response: this.success({ type: typeOrName, items: this.slimDocList(typeOrName, items, query) }) };
                    }
                } catch (e: any) {
                    // MetadataService doesn't know this type or failed, continue to other fallbacks
                    // Sanitize typeOrName to prevent log injection (CodeQL warning)
                    const sanitizedType = String(typeOrName).replace(/[\r\n\t]/g, '');
                    console.debug(`[HttpDispatcher] MetadataService.list() failed for type:`, sanitizedType, 'error:', e.message);
                }
            }

            // Try ObjectQL registry directly for object/type lookups
            const qlService = await this.getObjectQLService();
            if (qlService?.registry) {
                if (typeOrName === 'objects') {
                    const objs = qlService.registry.getAllObjects(packageId);
                    return { handled: true, response: this.success({ type: 'object', items: objs }) };
                }
                // Try listing items of the given type
                const items = qlService.registry.listItems?.(typeOrName, packageId);
                if (items && items.length > 0) {
                    return { handled: true, response: this.success({ type: typeOrName, items }) };
                }
                // Legacy: treat as object name
                const obj = qlService.registry.getObject(typeOrName);
                if (obj) return { handled: true, response: this.success(obj) };
            }
            return { handled: true, response: this.error('Not found', 404) };
        }

        // GET /metadata — return available metadata types
        if (parts.length === 0) {
            // Prefer protocol service for the rich `entries` array (with
            // JSON Schemas etc); fall back to MetadataService types-only.
            const protocol = await this.resolveService('protocol');
            if (protocol && typeof protocol.getMetaTypes === 'function') {
                try {
                    const result = await protocol.getMetaTypes({});
                    return { handled: true, response: this.success(result) };
                } catch { /* fall through */ }
            }
            const metadataService = await this.resolveService('metadata', _context.environmentId);
            if (metadataService && typeof (metadataService as any).getRegisteredTypes === 'function') {
                try {
                    const types = await (metadataService as any).getRegisteredTypes();
                    return { handled: true, response: this.success({ types }) };
                } catch { /* fall through */ }
            }
            return { handled: true, response: this.success({ types: ['object', 'app', 'plugin'] }) };
        }
        
        return { handled: false };
    }

    /**
     * Handles Data requests
     * path: sub-path after /data/ (e.g. "contacts", "contacts/123", "contacts/query")
     */
    async handleData(path: string, method: string, body: any, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        const parts = path.replace(/^\/+/, '').split('/');
        const objectName = parts[0];

        if (!objectName) {
            return { handled: true, response: this.error('Object name required', 400) };
        }

        // Check if environment is resolved for data-plane requests. A
        // registered KernelResolver marks this host as multi-tenant (ADR-0006
        // Phase 5 — previously signalled by the env-registry service): a
        // data-plane request that the resolver did not attach to an
        // environment must not silently fall through to the host kernel.
        if (!_context.dataDriver && this.kernelResolver) {
            return {
                handled: true,
                response: this.error('Project not resolved. Please specify X-Environment-Id header or ensure hostname maps to a project.', 428)
            };
        }

        const m = method.toUpperCase();

        // 1. Custom Actions (query, batch)
        if (parts.length > 1) {
            const action = parts[1];

            // POST /data/:object/query
            if (action === 'query' && m === 'POST') {
                // Spec: returns FindDataResponse = { object, records, total?, hasMore? }
                const result = await this.callData('query', { object: objectName, ...body }, _context.dataDriver, _context.environmentId, _context.executionContext);
                return { handled: true, response: this.success(result) };
            }

            // GET /data/:object/:id
            if (parts.length === 2 && m === 'GET') {
                const id = parts[1];
                // Spec: Only select/expand are allowlisted query params for GET by ID.
                // All other query parameters are discarded to prevent parameter pollution.
                const { select, expand } = query || {};
                const allowedParams: Record<string, unknown> = {};
                if (select != null) allowedParams.select = select;
                if (expand != null) allowedParams.expand = expand;
                // Spec: returns GetDataResponse = { object, id, record }
                const result = await this.callData('get', { object: objectName, id, ...allowedParams }, _context.dataDriver, _context.environmentId, _context.executionContext);
                return { handled: true, response: this.success(result) };
            }

            // PATCH /data/:object/:id
            if (parts.length === 2 && m === 'PATCH') {
                const id = parts[1];
                // Spec: returns UpdateDataResponse = { object, id, record }
                const result = await this.callData('update', { object: objectName, id, data: body }, _context.dataDriver, _context.environmentId, _context.executionContext);
                return { handled: true, response: this.success(result) };
            }

            // DELETE /data/:object/:id
            if (parts.length === 2 && m === 'DELETE') {
                const id = parts[1];
                // Spec: returns DeleteDataResponse = { object, id, deleted }
                const result = await this.callData('delete', { object: objectName, id }, _context.dataDriver, _context.environmentId, _context.executionContext);
                return { handled: true, response: this.success(result) };
            }
        } else {
            // GET /data/:object (List)
            if (m === 'GET') {
                // ── Normalize HTTP transport params → Spec canonical (QueryAST) ──
                // HTTP GET query params use transport-level names (filter, sort, top,
                // skip, select, expand) which are normalized here to canonical
                // QueryAST field names (where, orderBy, limit, offset, fields,
                // expand) before forwarding to the data service layer.
                // The protocol.ts findData() method performs a deeper normalization
                // pass, but pre-normalizing here ensures the data service always receives
                // Spec-canonical keys.
                const normalized: Record<string, unknown> = { ...query };

                // filter/filters → where
                // Note: `filter` is the canonical HTTP *transport* parameter name
                // (see HttpFindQueryParamsSchema). It is normalized here to the
                // canonical *QueryAST* field name `where` before data dispatch.
                // `filters` (plural) is a deprecated alias for `filter`.
                if (normalized.filter != null || normalized.filters != null) {
                    normalized.where = normalized.where ?? normalized.filter ?? normalized.filters;
                    delete normalized.filter;
                    delete normalized.filters;
                }
                // select → fields
                if (normalized.select != null && normalized.fields == null) {
                    normalized.fields = normalized.select;
                    delete normalized.select;
                }
                // sort → orderBy
                if (normalized.sort != null && normalized.orderBy == null) {
                    normalized.orderBy = normalized.sort;
                    delete normalized.sort;
                }
                // top → limit
                if (normalized.top != null && normalized.limit == null) {
                    normalized.limit = normalized.top;
                    delete normalized.top;
                }
                // skip → offset
                if (normalized.skip != null && normalized.offset == null) {
                    normalized.offset = normalized.skip;
                    delete normalized.skip;
                }

                // Spec: returns FindDataResponse = { object, records, total?, hasMore? }
                const result = await this.callData('query', { object: objectName, query: normalized }, _context.dataDriver, _context.environmentId, _context.executionContext);
                return { handled: true, response: this.success(result) };
            }

            // POST /data/:object (Create)
            if (m === 'POST') {
                // Spec: returns CreateDataResponse = { object, id, record }
                const result = await this.callData('create', { object: objectName, data: body }, _context.dataDriver, _context.environmentId, _context.executionContext);
                const res = this.success(result);
                res.status = 201;
                return { handled: true, response: res };
            }
        }

        return { handled: false };
    }

    /**
     * Handles Analytics requests
     * path: sub-path after /analytics/
     */
    /** Thin delegate — body extracted to `./domains/analytics.ts` (D11③ PR-2). */
    async handleAnalytics(path: string, method: string, body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        return handleAnalyticsRequest(this.domainDeps, path, method, body, context);
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

    /**
     * Handle action invocation routes (`/actions/...`).
     *
     * Dispatches a named, server-registered action handler (registered via
     * `engine.registerAction(objectName, actionName, handler)`) over HTTP.
     * Three URL shapes are accepted to keep the client contract flexible:
     *
     *  - `POST /actions/:object/:action`              — record-scoped action
     *  - `POST /actions/:object/:action/:recordId`    — record-scoped action with id in URL
     *  - `POST /actions/global/:action`               — wildcard ("*") action
     *
     * Body shape: `{ recordId?: string, params?: Record<string, unknown> }`.
     * The handler is invoked with an `ActionContext` of:
     *   `{ record, user, engine, params }`
     * where `engine` exposes the slimmed CRUD surface used by CRM handlers
     * (`insert`, `update`, `delete`, `find`).
     */
    async handleActions(path: string, method: string, body: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        if (method.toUpperCase() !== 'POST') {
            return { handled: true, response: this.error('Method not allowed', 405) };
        }
        const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
        if (parts.length < 2) {
            return { handled: true, response: this.error('Path must be /actions/:object/:action', 400) };
        }
        const objectName = parts[0];
        const actionName = parts[1];
        const recordIdFromPath = parts[2];

        // Resolve project scope so the right project kernel's ObjectQL is
        // used. For bare URLs the URL prefix already stripped any `/projects/:id`
        // segment, so fall back to the single-environment default if unset.
        if (!_context.environmentId) {
            const def = this.resolveDefaultProject();
            if (def?.environmentId) _context.environmentId = def.environmentId;
        }

        // Kernel-resolution fallback for the per-project kernel. HTTP action
        // routes now flow through `dispatcher.dispatch()` (like data/meta/
        // automation), which already swapped to the project kernel and resolved
        // `executionContext` before reaching here — so on that path this block
        // re-resolves idempotently (a no-op in single-kernel mode). Kept for
        // DIRECT `handleActions` callers (unit tests / internal dispatch) so the
        // call still lands on the kernel where the bundle's actions are
        // registered, not the control-plane kernel (ADR-0006 Phase 5).
        let projectQl: any = null;
        if (this.kernelResolver && _context.environmentId && _context.environmentId !== 'platform') {
            try {
                const projectKernel: any = await this.kernelResolver.resolveKernel(_context, this.defaultKernel);
                if (projectKernel) {
                    this.kernel = projectKernel;
                    // Resolve the project kernel's own ObjectQL DIRECTLY so we
                    // bypass the control-plane's scoped factory (which would
                    // hand back a different instance with no registered
                    // actions/hooks for this project's bundle).
                    if (typeof projectKernel.getServiceAsync === 'function') {
                        projectQl = await projectKernel.getServiceAsync('objectql').catch(() => null);
                    }
                }
            } catch {
                // fall back to defaultKernel — getObjectQLService will report
                // "Data engine not available" if no engine is reachable.
            }
        }

        const ql: any = projectQl ?? await this.getObjectQLService(_context?.environmentId);
        if (!ql || typeof ql.executeAction !== 'function') {
            return { handled: true, response: this.error('Data engine not available', 503) };
        }

        // [ADR-0066 D4] Dual-surface action gate — the server is the source of
        // truth. Resolve the action's declared `requiredPermissions` from the
        // object schema and reject (403) when the caller's systemPermissions
        // don't cover them. The objectui ActionRunner hides/disables the same
        // action from the identical declaration, so a UI-hidden action is also
        // server-closed (and the inverse footgun is removed). System/engine
        // self-invocation (isSystem) bypasses; an unauthenticated caller holds
        // no capabilities and is therefore denied for a gated action.
        // Resolve the object schema + this action's declaration once — both the
        // permission gate (ADR-0066 D4) and the param contract (ADR-0104 D2)
        // read it.
        let actionSchema: any;
        let actionDef: any;
        try {
            actionSchema =
                (typeof ql.getSchema === 'function' ? ql.getSchema(objectName) : undefined) ??
                ql.registry?.getObject?.(objectName);
            actionDef = Array.isArray(actionSchema?.actions)
                ? actionSchema.actions.find((a: any) => a?.name === actionName)
                : undefined;
            const gateError = this.actionPermissionError(actionDef, _context?.executionContext, objectName);
            if (gateError) {
                return { handled: true, response: this.error(gateError, 403) };
            }
        } catch {
            /* schema unresolved → no declared gate to enforce (handler-only action) */
        }

        // Resolve the handler — fall back to wildcard '*' if the object-specific key is missing.
        // Since engine.executeAction throws when the key is unknown, we probe via the internal
        // map by attempting the call inside a try/catch and rotating to '*'.
        const tryExecute = async (obj: string) => {
            return ql.executeAction(obj, actionName, actionContext);
        };

        const reqBody = body && typeof body === 'object' ? body : {};
        const recordId = recordIdFromPath ?? reqBody.recordId;
        const reqParams = (reqBody.params && typeof reqBody.params === 'object') ? reqBody.params : {};

        // [ADR-0104 D2] Enforce the declared param contract before the handler
        // runs — required/option/multiple/reference-id shape + unknown keys.
        // Warn-first unless OS_ACTION_PARAMS_STRICT_ENABLED=1 (then a 400).
        const paramError = this.enforceActionParams(actionDef, actionSchema, reqParams, { objectName, actionName });
        if (paramError) {
            return { handled: true, response: this.error(paramError, 400) };
        }

        // Load the record (best-effort) so handlers can rely on `ctx.record`.
        let record: Record<string, unknown> = {};
        if (recordId && objectName !== 'global') {
            try {
                const got = await this.callData('get', { object: objectName, id: recordId }, _context.dataDriver, _context.environmentId, _context.executionContext);
                if (got?.record) record = got.record;
            } catch { /* record may not exist for new-record actions; pass empty */ }
        }
        if (record && (record as any).id == null && recordId) (record as any).id = recordId;

        // Slim engine facade matching the ActionContext.engine shape used by CRM
        // handlers. ⚠️ TRUSTED — context-less, RLS/FLS-bypassing by design; see
        // buildActionEngineFacade for the full security-model rationale (#2849).
        const engineFacade = {
            async insert(object: string, data: Record<string, unknown>): Promise<{ id: string }> {
                const res = await ql.insert(object, data);
                const id = (res && (res as any).id) ?? (data as any).id;
                return { id };
            },
            async update(object: string, id: string, data: Record<string, unknown>): Promise<void> {
                await ql.update(object, data, { where: { id } });
            },
            async delete(object: string, id: string): Promise<void> {
                await ql.delete(object, { where: { id } });
            },
            async find(object: string, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
                const opts = query && Object.keys(query).length ? { where: query } : undefined;
                const rows = await ql.find(object, opts as any);
                return Array.isArray(rows) ? rows : ((rows as any)?.value ?? []);
            },
        };

        // Resolve the caller identity from the request's ExecutionContext — the
        // single source `dispatch()` populates via `resolveExecutionContext`,
        // the same envelope the MCP `runAction` and record-change trigger paths
        // read. The action body sandbox receives the operator's id and business
        // roles (ADR-0090 `positions`, formerly `roles`) so a handler can branch
        // on identity and enforce ownership. Falls back to a `system` principal
        // only for a genuinely anonymous / self-invoked call (#2701).
        const ec: any = _context?.executionContext;
        const userFromAuth = ec?.userId
            ? {
                id: ec.userId,
                name: ec.userId,
                email: ec.email,
                roles: Array.isArray(ec.positions) ? ec.positions : [],
                positions: Array.isArray(ec.positions) ? ec.positions : [],
                permissions: Array.isArray(ec.permissions) ? ec.permissions : [],
                // `organizationId` is the blessed developer-facing name for the
                // caller's active org (matches columns + `current_user.organizationId`).
                // The deprecated `tenantId` alias (#3280) was removed in v11 (#3290).
                organizationId: ec.tenantId,
              }
            : { id: 'system', name: 'system', roles: [], positions: [], permissions: [] };

        const actionContext: any = {
            record,
            user: userFromAuth,
            session: this.buildActionSession(ec),
            engine: engineFacade,
            params: { ...reqParams, recordId, objectName },
        };

        // [#2849] Same trusted-mode elevation as the MCP path — keep it audible.
        console.info(
            `[action-audit] REST action '${objectName}/${actionName}' — body executes TRUSTED ` +
            `(context-less engine, RLS/FLS-bypassing) for user '${userFromAuth.id}'`,
        );

        try {
            // Try object-specific first; on "not found" error, fall back to wildcard.
            let result: any;
            try {
                result = await tryExecute(objectName);
            } catch (err: any) {
                const msg = String(err?.message ?? err ?? '');
                if (/not found/i.test(msg) && objectName !== '*') {
                    result = await tryExecute('*');
                } else {
                    throw err;
                }
            }
            return { handled: true, response: this.success({ success: true, data: result }) };
        } catch (err: any) {
            const full = err?.message ?? String(err);
            // The sandbox wraps a user throw as `<kind> '<name>' threw: <msg>` for
            // server logs; surface only the business `<msg>` (SandboxError.innerMessage)
            // to the client so an action's error toast reads as plain text instead of
            // leaking the debug prefix. Keep the full wrapper in the log for debugging.
            const inner: unknown = err?.innerMessage;
            const clientMsg = (typeof inner === 'string' && inner) ? inner : full;
            if (clientMsg !== full) console.error(`[action ${objectName}/${actionName}] ${full}`);
            return { handled: true, response: this.success({ success: false, error: clientMsg }) };
        }
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
        
        if (cleanPath.startsWith('/meta')) {
             return this.handleMetadata(cleanPath.substring(5), context, method, body, query);
        }

        if (cleanPath.startsWith('/data')) {
            return this.handleData(cleanPath.substring(5), method, body, query, context);
        }

        // `/mcp/skill` is the one sub-path NOT owned by the MCP transport:
        // the public, environment-customized SKILL.md download. Matched
        // before the transport branch below, which claims everything else
        // under `/mcp`.
        if (cleanPath === '/mcp/skill' || cleanPath.startsWith('/mcp/skill?')) {
            return this.handleMcpSkill(method, context);
        }

        if (cleanPath === '/mcp' || cleanPath.startsWith('/mcp/') || cleanPath.startsWith('/mcp?')) {
            return this.handleMcp(body, context);
        }

        // /keys moved to the domain registry (D11 step ③).

        // /graphql removed — GraphQL is not in the product plan (#2462 follow-on).

        // /storage and /ui moved to the domain registry (D11 step ③).

        // /automation moved to the domain registry (D11 step ③).

        if (cleanPath.startsWith('/actions')) {
             return this.handleActions(cleanPath.substring(8), method, body, context);
        }

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
