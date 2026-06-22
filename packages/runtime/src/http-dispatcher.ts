// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectKernel, getEnv, resolveLocale } from '@objectstack/core';
import { CoreServiceName } from '@objectstack/spec/system';
import { pluralToSingular, PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { setPackageDisabled } from './package-state-store.js';
import { checkApiExposure } from './api-exposure.js';

/** Minimal local interface — full EnvironmentScopeManager was removed in Phase R. */
interface EnvironmentScopeManager {
    touch(environmentId: string): void;
}
import {
    resolveExecutionContext,
    isPermissionDeniedError,
} from './security/resolve-execution-context.js';
import { generateApiKey } from './security/api-key.js';

/** Browser-safe UUID generator — prefers Web Crypto, falls back to RFC 4122 v4 */
function randomUUID(): string {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

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
}

/**
 * @deprecated Use `createDispatcherPlugin()` from `@objectstack/runtime` instead.
 * This class will be removed in v2. Prefer the plugin-based approach:
 * ```ts
 * import { createDispatcherPlugin } from '@objectstack/runtime';
 * kernel.use(createDispatcherPlugin({ prefix: '/api/v1' }));
 * ```
 */
export class HttpDispatcher {
    private kernel: any; // Casting to any to access dynamic props like services, graphql
    private defaultKernel: ObjectKernel;
    private defaultProject?: { environmentId: string; orgId?: string };
    private kernelResolver?: KernelResolver;
    private scopeManager?: EnvironmentScopeManager;
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
        this.kernel = kernel;
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

    /**
     * Direct data service dispatch — replaces broker.call('data.*').
     * Tries protocol service first (supports expand/populate), falls back to ObjectQL.
     *
     * @param dataDriver - Optional environment-scoped driver to use instead of kernel default
     * @param scopeId - Optional project ID for scoped service resolution (SharedProjectPlugin mode)
     */
    private async callData(
        action: string,
        params: any,
        dataDriver?: any,
        scopeId?: string,
        executionContext?: ExecutionContext,
    ): Promise<any> {
        // ── Object-level API exposure gate (ADR-0049, #1889) ─────
        // Honour the object's `apiEnabled` / `apiMethods` declarations for
        // external traffic. System/internal contexts bypass — these flags
        // govern API *exposure*, not internal engine self-writes.
        if (!executionContext?.isSystem && params?.object) {
            let def: any;
            try {
                const meta = await this.resolveService('metadata', scopeId);
                def = await (meta as any)?.getObject?.(params.object);
            } catch {
                def = undefined; // fall open to schema defaults (apiEnabled=true)
            }
            const gate = checkApiExposure(def, action);
            if (!gate.allowed) {
                throw { statusCode: gate.status ?? 403, message: gate.reason ?? 'API access denied' };
            }
        }

        const protocol = await this.resolveService('protocol', scopeId);
        const qlService = dataDriver ?? await this.getObjectQLService(scopeId);
        const ql = qlService ?? await this.resolveService('objectql', scopeId);
        const qlOpts = executionContext ? { context: executionContext } : undefined;
        const findOpts = (extra?: any) => {
            const base = qlOpts ? { ...qlOpts } : {};
            return extra ? { ...base, ...extra } : (qlOpts ? base : undefined);
        };

        if (action === 'create') {
            if (ql) {
                const res = await ql.insert(params.object, params.data, qlOpts);
                const record = { ...params.data, ...res };
                return { object: params.object, id: record.id, record };
            }
            throw { statusCode: 503, message: 'Data service not available' };
        }

        if (action === 'get') {
            if (protocol && typeof protocol.getData === 'function') {
                return await protocol.getData({ object: params.object, id: params.id, expand: params.expand, select: params.select, context: executionContext });
            }
            if (ql) {
                let all = await ql.find(params.object, findOpts({ where: { id: params.id }, limit: 1 }));
                if (all && (all as any).value) all = (all as any).value;
                if (!all) all = [];
                const match = (all as any[]).find((i: any) => i.id === params.id);
                return match ? { object: params.object, id: params.id, record: match } : null;
            }
            throw { statusCode: 503, message: 'Data service not available' };
        }

        if (action === 'update') {
            if (ql && params.id) {
                let all = await ql.find(params.object, findOpts({ where: { id: params.id }, limit: 1 }));
                if (all && (all as any).value) all = (all as any).value;
                if (!all) all = [];
                const existing = (all as any[]).find((i: any) => i.id === params.id);
                if (!existing) throw new Error('[ObjectStack] Not Found');
                await ql.update(params.object, params.data, findOpts({ where: { id: params.id } }));
                return { object: params.object, id: params.id, record: { ...existing, ...params.data } };
            }
            throw { statusCode: 503, message: 'Data service not available' };
        }

        if (action === 'delete') {
            if (ql) {
                await ql.delete(params.object, findOpts({ where: { id: params.id } }));
                return { object: params.object, id: params.id, deleted: true };
            }
            throw { statusCode: 503, message: 'Data service not available' };
        }

        if (action === 'query' || action === 'find') {
            if (protocol && typeof protocol.findData === 'function') {
                // Build query: use explicit params.query if provided, otherwise extract query fields from params
                const query = params.query || (() => {
                    const { object, ...rest } = params;
                    return rest;
                })();
                return await protocol.findData({ object: params.object, query, context: executionContext });
            }
            if (ql) {
                let all = await ql.find(params.object, qlOpts);
                if (!Array.isArray(all) && all && (all as any).value) all = (all as any).value;
                if (!all) all = [];
                return { object: params.object, records: all, total: all.length };
            }
            throw { statusCode: 503, message: 'Data service not available' };
        }

        if (action === 'batch') {
            // Batch operations — not yet supported via direct service dispatch
            return { object: params.object, results: [] };
        }

        throw { statusCode: 400, message: `Unknown data action: ${action}` };
    }

    /**
     * Handle an MCP request over the Streamable HTTP transport (`/mcp`).
     *
     * Gating + auth (fail-closed):
     *  - **opt-in**: only served when `OS_MCP_SERVER_ENABLED=true` (single-env
     *    runtime). Multi-tenant cloud overrides this gate per env. When off we
     *    return 404 so the surface isn't advertised.
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
            return { handled: true, response: this.error('Unauthorized: a valid API key is required', 401) };
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
            webRes = await mcp.handleHttpRequest(webRequest, { bridge, parsedBody: body });
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

    /** Whether the MCP HTTP surface is opted in for this single-env runtime. */
    private static isMcpEnabled(): boolean {
        return typeof process !== 'undefined' && process.env?.OS_MCP_SERVER_ENABLED === 'true';
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
            create: async (object: string, data: any) =>
                await callData('create', { object, data }, driver, envId, ec),
            update: async (object: string, id: string, data: any) =>
                await callData('update', { object, id, data }, driver, envId, ec),
            remove: async (object: string, id: string) =>
                await callData('delete', { object, id }, driver, envId, ec),
        };
    }

    /**
     * Generate a `sys_api_key` and return the raw secret EXACTLY ONCE
     * (`POST /keys`). This is the only mint path — the raw key is never stored
     * (only its sha256 hash) and never re-displayable.
     *
     * Security (zero-tolerance):
     *  - Requires an authenticated principal; `user_id` is PINNED to that
     *    caller and is NEVER read from the request body (no impersonation).
     *  - Body is whitelisted to `name` (+ optional `expires_at`); any
     *    `key` / `id` / `user_id` / `revoked` in the body is ignored, so a
     *    caller cannot forge a known-secret or escalate.
     *  - `scopes` are intentionally NOT accepted from the body in v1: the
     *    verify path ADDS scopes to the principal's permissions, so honouring
     *    arbitrary body scopes would be an escalation vector. A generated key
     *    therefore acts exactly AS the caller (via `user_id` resolution).
     *    Narrowing/scoped keys need subset-enforcement — deferred.
     *  - The raw key and its hash never enter logs or error messages.
     *  - The row is written with an elevated `{ isSystem: true }` context
     *    because `sys_api_key` is protection-locked; safe because the row's
     *    contents are fully server-controlled (user_id pinned to caller).
     */
    async handleKeys(method: string, body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        if (method !== 'POST') {
            return { handled: true, response: this.error('Method not allowed', 405) };
        }

        const ec = context.executionContext;
        if (!ec || !ec.userId) {
            return { handled: true, response: this.error('Unauthorized: sign in to generate an API key', 401) };
        }

        // ── Whitelist the body. Only `name` and optional `expires_at`. ──
        const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
        const name = rawName || 'API Key';

        let expiresAt: string | undefined;
        if (body?.expires_at != null && body.expires_at !== '') {
            const ms = typeof body.expires_at === 'number'
                ? (body.expires_at < 1e12 ? body.expires_at * 1000 : body.expires_at)
                : Date.parse(String(body.expires_at));
            if (Number.isNaN(ms)) {
                return { handled: true, response: this.error('Invalid expires_at: must be a parseable date', 400) };
            }
            if (ms <= Date.now()) {
                return { handled: true, response: this.error('Invalid expires_at: must be in the future', 400) };
            }
            expiresAt = new Date(ms).toISOString();
        }

        const ql = (await this.getObjectQLService(context.environmentId))
            ?? (await this.resolveService('objectql', context.environmentId));
        if (!ql || typeof ql.insert !== 'function') {
            return { handled: true, response: this.error('Data service not available', 503) };
        }

        // Generate AFTER validation so we never mint on a rejected request.
        const generated = generateApiKey();

        // Server-controlled row. user_id is pinned to the caller; only the hash
        // is persisted. NOTHING from the body can set key/id/user_id/revoked.
        const row: Record<string, unknown> = {
            name,
            key: generated.hash,
            prefix: generated.prefix,
            user_id: ec.userId,
            revoked: false,
        };
        if (expiresAt) row.expires_at = expiresAt;

        let inserted: any;
        try {
            inserted = await ql.insert('sys_api_key', row, { context: { isSystem: true } });
        } catch {
            // Never surface the underlying error (could echo row contents).
            return { handled: true, response: this.error('Failed to create API key', 500) };
        }
        const id = inserted?.id ?? (Array.isArray(inserted) ? inserted[0]?.id : undefined);

        // Raw key returned ONCE. Do not log it.
        return {
            handled: true,
            response: {
                status: 201,
                body: {
                    success: true,
                    data: {
                        id,
                        name,
                        prefix: generated.prefix,
                        key: generated.raw,
                        ...(expiresAt ? { expires_at: expiresAt } : {}),
                    },
                },
            },
        };
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
            authSvc, graphqlSvc, searchSvc, realtimeSvc, filesSvc,
            analyticsSvc, workflowSvc, aiSvc, notificationSvc, i18nSvc,
            uiSvc, automationSvc, cacheSvc, queueSvc, jobSvc,
        ] = await Promise.all([
            this.resolveService(CoreServiceName.enum.auth),
            this.resolveService(CoreServiceName.enum.graphql),
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
        const hasGraphQL      = !!(graphqlSvc || this.kernel.graphql);
        const hasSearch       = !!searchSvc;
        const hasWebSockets   = !!realtimeSvc;
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
                graphql:       hasGraphQL ? `${prefix}/graphql` : undefined,
                storage:       hasFiles ? `${prefix}/storage` : undefined,
                analytics:     hasAnalytics ? `${prefix}/analytics` : undefined,
                automation:    hasAutomation ? `${prefix}/automation` : undefined,
                workflow:      hasWorkflow ? `${prefix}/workflow` : undefined,
                realtime:      hasWebSockets ? `${prefix}/realtime` : undefined,
                notifications: hasNotification ? `${prefix}/notifications` : undefined,
                ai:            hasAi ? `${prefix}/ai` : undefined,
                i18n:          hasI18n ? `${prefix}/i18n` : undefined,
                // MCP (Streamable HTTP) is opt-in per env — only advertised
                // when OS_MCP_SERVER_ENABLED=true so the surface isn't exposed
                // by default. The objectui Integrations page reads this.
                mcp:           HttpDispatcher.isMcpEnabled() ? `${prefix}/mcp` : undefined,
        };

        // Build per-service status map
        // handlerReady: true means the dispatcher has a real, bound handler for this route.
        // handlerReady: false means the route is present in the discovery table but may not
        // yet have a concrete implementation or may be served by a stub.
        const svcAvailable = (route?: string, provider?: string) => ({
            enabled: true, status: 'available' as const, handlerReady: true, route, provider,
        });
        const svcUnavailable = (name: string) => ({
            enabled: false, status: 'unavailable' as const, handlerReady: false,
            message: `Install a ${name} plugin to enable`,
        });

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
                graphql: hasGraphQL,
                search: hasSearch,
                websockets: hasWebSockets,
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
                auth:           hasAuth ? svcAvailable(routes.auth) : svcUnavailable('auth'),
                automation:     hasAutomation ? svcAvailable(routes.automation) : svcUnavailable('automation'),
                analytics:      hasAnalytics ? svcAvailable(routes.analytics) : svcUnavailable('analytics'),
                cache:          hasCache ? svcAvailable() : svcUnavailable('cache'),
                queue:          hasQueue ? svcAvailable() : svcUnavailable('queue'),
                job:            hasJob ? svcAvailable() : svcUnavailable('job'),
                ui:             hasUi ? svcAvailable(routes.ui) : svcUnavailable('ui'),
                workflow:       hasWorkflow ? svcAvailable(routes.workflow) : svcUnavailable('workflow'),
                realtime:       hasWebSockets ? svcAvailable(routes.realtime) : svcUnavailable('realtime'),
                notification:   hasNotification ? svcAvailable(routes.notifications) : svcUnavailable('notification'),
                ai:             hasAi ? svcAvailable(routes.ai) : svcUnavailable('ai'),
                i18n:           hasI18n ? svcAvailable(routes.i18n) : svcUnavailable('i18n'),
                graphql:        hasGraphQL ? svcAvailable(routes.graphql) : svcUnavailable('graphql'),
                'file-storage': hasFiles ? svcAvailable(routes.storage) : svcUnavailable('file-storage'),
                search:         hasSearch ? svcAvailable() : svcUnavailable('search'),
            },
            locale,
        };
    }

    /**
     * Handles GraphQL requests
     */
    async handleGraphQL(body: { query: string; variables?: any }, context: HttpProtocolContext) {
        if (!body || !body.query) {
             throw { statusCode: 400, message: 'Missing query in request body' };
        }
        
        if (typeof this.kernel.graphql !== 'function') {
            throw { statusCode: 501, message: 'GraphQL service not available' };
        }

        return this.kernel.graphql(body.query, body.variables, { 
            request: context.request 
        });
    }

    /**
     * Handles Auth requests
     * path: sub-path after /auth/
     */
    async handleAuth(path: string, method: string, body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        // 1. Try generic Auth Service
        const authService = await this.getService(CoreServiceName.enum.auth);
        if (authService && typeof authService.handler === 'function') {
            const response = await authService.handler(context.request, context.response);
            return { handled: true, result: response };
        }

        // 2. Mock fallback for MSW/test environments when no auth service is registered
        const normalizedPath = path.replace(/^\/+/, '');
        return this.mockAuthFallback(normalizedPath, method, body);
    }

    /**
     * Provides mock auth responses for core better-auth endpoints when
     * AuthPlugin is not loaded (e.g. MSW/browser-only environments).
     * This ensures registration/sign-in flows do not 404 in mock mode.
     */
    private mockAuthFallback(path: string, method: string, body: any): HttpDispatcherResult {
        const m = method.toUpperCase();
        const MOCK_SESSION_EXPIRY_MS = 86_400_000; // 24 hours

        // POST sign-up/email
        if ((path === 'sign-up/email' || path === 'register') && m === 'POST') {
            const id = `mock_${randomUUID()}`;
            return {
                handled: true,
                response: {
                    status: 200,
                    body: {
                        user: { id, name: body?.name || 'Mock User', email: body?.email || 'mock@test.local', emailVerified: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
                        session: { id: `session_${id}`, userId: id, token: `mock_token_${id}`, expiresAt: new Date(Date.now() + MOCK_SESSION_EXPIRY_MS).toISOString() },
                    },
                },
            };
        }

        // POST sign-in/email or login
        if ((path === 'sign-in/email' || path === 'login') && m === 'POST') {
            const id = `mock_${randomUUID()}`;
            return {
                handled: true,
                response: {
                    status: 200,
                    body: {
                        user: { id, name: 'Mock User', email: body?.email || 'mock@test.local', emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
                        session: { id: `session_${id}`, userId: id, token: `mock_token_${id}`, expiresAt: new Date(Date.now() + MOCK_SESSION_EXPIRY_MS).toISOString() },
                    },
                },
            };
        }

        // GET get-session
        if (path === 'get-session' && m === 'GET') {
            return {
                handled: true,
                response: { status: 200, body: { session: null, user: null } },
            };
        }

        // POST sign-out
        if (path === 'sign-out' && m === 'POST') {
            return {
                handled: true,
                response: { status: 200, body: { success: true } },
            };
        }

        return { handled: false };
    }

    /**
     * Handles Metadata requests
     * Standard: /metadata/:type/:name
     * Fallback for backward compat: /metadata (all objects), /metadata/:objectName (get object)
     */
    async handleMetadata(path: string, _context: HttpProtocolContext, method?: string, body?: any, query?: any): Promise<HttpDispatcherResult> {
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
                        return { handled: true, response: this.error(e.message, 400) };
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
    async handleAnalytics(path: string, method: string, body: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        const analyticsService = await this.getService(CoreServiceName.enum.analytics);
        if (!analyticsService) return { handled: false }; // 404 handled by caller if unhandled

        const m = method.toUpperCase();
        const subPath = path.replace(/^\/+/, '');

        // POST /analytics/query
        if (subPath === 'query' && m === 'POST') {
            const result = await analyticsService.query(body);
            return { handled: true, response: this.success(result) };
        }

        // GET /analytics/meta
        if (subPath === 'meta' && m === 'GET') {
            const result = await analyticsService.getMeta();
             return { handled: true, response: this.success(result) };
        }

        // POST /analytics/sql (Dry-run or debug)
        if (subPath === 'sql' && m === 'POST') {
             // Assuming service has generateSql method
             const result = await analyticsService.generateSql(body);
             return { handled: true, response: this.success(result) };
        }

        return { handled: false };
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
    async handleNotification(path: string, method: string, body: any, query: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        const service = await this.resolveService(CoreServiceName.enum.notification, context.environmentId) as any;
        if (!service || typeof service.listInbox !== 'function') return { handled: false };

        const userId: string | undefined = context.executionContext?.userId;
        if (!userId) {
            return { handled: true, response: this.error('Authentication required', 401) };
        }

        const m = method.toUpperCase();
        const subPath = path.replace(/^\/+/, '').replace(/\/+$/, '');

        // GET /notifications — list the user's inbox joined with read-state.
        if (subPath === '' && m === 'GET') {
            const read = query?.read === undefined ? undefined : String(query.read) === 'true';
            const limit = query?.limit ? Number(query.limit) : undefined;
            const type = query?.type ? String(query.type) : undefined;
            const result = await service.listInbox(userId, { read, type, limit });
            return { handled: true, response: this.success(result) };
        }

        // POST /notifications/read — mark specific notifications read.
        if (subPath === 'read' && m === 'POST') {
            const ids: string[] = Array.isArray(body?.ids) ? body.ids.map((x: unknown) => String(x)) : [];
            const result = await service.markRead(userId, ids);
            return { handled: true, response: this.success(result) };
        }

        // POST /notifications/read/all — mark all of the user's inbox read.
        if (subPath === 'read/all' && m === 'POST') {
            const result = await service.markAllRead(userId);
            return { handled: true, response: this.success(result) };
        }

        return { handled: false };
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
    async handleI18n(path: string, method: string, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        const i18nService = await this.getService(CoreServiceName.enum.i18n);
        if (!i18nService) return { handled: true, response: this.error('i18n service not available', 501) };

        const m = method.toUpperCase();
        const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

        if (m !== 'GET') return { handled: false };

        // GET /i18n/locales
        if (parts[0] === 'locales' && parts.length === 1) {
            const locales = i18nService.getLocales();
            return { handled: true, response: this.success({ locales }) };
        }

        // GET /i18n/translations/:locale  OR  /i18n/translations?locale=xx
        if (parts[0] === 'translations') {
            const locale = parts[1] ? decodeURIComponent(parts[1]) : query?.locale;
            if (!locale) return { handled: true, response: this.error('Missing locale parameter', 400) };

            let translations = i18nService.getTranslations(locale);

            // Locale fallback: try resolving to an available locale when
            // the exact code yields empty translations (e.g. zh → zh-CN).
            if (Object.keys(translations).length === 0) {
                const availableLocales = typeof i18nService.getLocales === 'function'
                    ? i18nService.getLocales() : [];
                const resolved = resolveLocale(locale, availableLocales);
                if (resolved && resolved !== locale) {
                    translations = i18nService.getTranslations(resolved);
                    return { handled: true, response: this.success({ locale: resolved, requestedLocale: locale, translations }) };
                }
            }

            return { handled: true, response: this.success({ locale, translations }) };
        }

        // GET /i18n/labels/:object/:locale  OR  /i18n/labels/:object?locale=xx
        if (parts[0] === 'labels' && parts.length >= 2) {
            const objectName = decodeURIComponent(parts[1]);
            let locale = parts[2] ? decodeURIComponent(parts[2]) : query?.locale;
            if (!locale) return { handled: true, response: this.error('Missing locale parameter', 400) };

            // Locale fallback for labels endpoint
            const availableLocales = typeof i18nService.getLocales === 'function'
                ? i18nService.getLocales() : [];
            const resolved = resolveLocale(locale, availableLocales);
            if (resolved) locale = resolved;

            if (typeof i18nService.getFieldLabels === 'function') {
                const labels = i18nService.getFieldLabels(objectName, locale);
                return { handled: true, response: this.success({ object: objectName, locale, labels }) };
            }
            // Fallback: derive field labels from full translation bundle
            const translations = i18nService.getTranslations(locale);
            const prefix = `o.${objectName}.fields.`;
            const labels: Record<string, string> = {};
            for (const [key, value] of Object.entries(translations)) {
                if (key.startsWith(prefix)) {
                    labels[key.substring(prefix.length)] = value as string;
                }
            }
            return { handled: true, response: this.success({ object: objectName, locale, labels }) };
        }

        return { handled: false };
    }

    /**
     * Handles Package Management requests
     * 
     * REST Endpoints:
     * - GET    /packages          → list all installed packages
     * - GET    /packages/:id      → get a specific package
     * - POST   /packages          → install a new package
     * - DELETE  /packages/:id      → uninstall a package
     * - PATCH  /packages/:id/enable  → enable a package
     * - PATCH  /packages/:id/disable → disable a package
     * - POST   /packages/:id/publish → publish a package (metadata snapshot)
     * - POST   /packages/:id/revert  → revert a package to last published state
     * 
     * Uses ObjectQL SchemaRegistry directly (via the 'objectql' service).
     */
    async handlePackages(path: string, method: string, body: any, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        const m = method.toUpperCase();
        const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

        // Try to get SchemaRegistry from the ObjectQL service
        const qlService = await this.getObjectQLService();
        const registry = qlService?.registry;

        // If no registry available, return 503
        if (!registry) {
            return { handled: true, response: this.error('Package service not available', 503) };
        }

        try {
            // GET /packages → list packages
            if (parts.length === 0 && m === 'GET') {
                let packages = registry.getAllPackages();
                // Apply optional filters
                if (query?.status) {
                    packages = packages.filter((p: any) => p.status === query.status);
                }
                if (query?.type) {
                    packages = packages.filter((p: any) => p.manifest?.type === query.type);
                }
                return { handled: true, response: this.success({ packages, total: packages.length }) };
            }

            // POST /packages → install package.
            // Route through the canonical `protocol.installPackage` primitive so
            // the install lands in BOTH the in-memory registry (what this list/detail
            // reads) AND the durable `sys_packages` table. Fall back to the bare
            // registry write only when the protocol service/method is unavailable.
            if (parts.length === 0 && m === 'POST') {
                const manifest = body.manifest || body;
                let pkg: any;
                const protocolSvc: any = await this.resolveService('protocol').catch(() => null);
                if (protocolSvc && typeof protocolSvc.installPackage === 'function') {
                    const out = await protocolSvc.installPackage({ manifest, settings: body.settings });
                    pkg = out?.package ?? out;
                } else {
                    pkg = registry.installPackage(manifest, body.settings);
                }
                const res = this.success(pkg);
                res.status = 201;
                return { handled: true, response: res };
            }

            // PATCH /packages/:id/enable
            if (parts.length === 2 && parts[1] === 'enable' && m === 'PATCH') {
                const id = decodeURIComponent(parts[0]);
                const pkg = registry.enablePackage(id);
                if (!pkg) return { handled: true, response: this.error(`Package '${id}' not found`, 404) };
                try {
                    setPackageDisabled(_context?.environmentId, id, false);
                } catch (err) {
                    console.warn('[handlePackages] failed to persist enable state', { id, error: (err as Error)?.message });
                }
                return { handled: true, response: this.success(pkg) };
            }

            // PATCH /packages/:id/disable
            if (parts.length === 2 && parts[1] === 'disable' && m === 'PATCH') {
                const id = decodeURIComponent(parts[0]);
                const pkg = registry.disablePackage(id);
                if (!pkg) return { handled: true, response: this.error(`Package '${id}' not found`, 404) };
                try {
                    setPackageDisabled(_context?.environmentId, id, true);
                } catch (err) {
                    console.warn('[handlePackages] failed to persist disable state', { id, error: (err as Error)?.message });
                }
                return { handled: true, response: this.success(pkg) };
            }

            // POST /packages/:id/publish → publish package metadata
            if (parts.length === 2 && parts[1] === 'publish' && m === 'POST') {
                const id = decodeURIComponent(parts[0]);
                const metadataService = await this.getService(CoreServiceName.enum.metadata);
                if (metadataService && typeof (metadataService as any).publishPackage === 'function') {
                    const result = await (metadataService as any).publishPackage(id, body || {});
                    return { handled: true, response: this.success(result) };
                }
                return { handled: true, response: this.error('Metadata service not available', 503) };
            }

            // POST /packages/:id/publish-drafts → promote every pending DRAFT
            // bound to the package to active in one shot ("publish whole app",
            // ADR-0033). Routes through protocol.publishPackageDrafts (which
            // reuses the per-item publish primitive) — no metadata service
            // dependency, unlike /publish above.
            if (parts.length === 2 && parts[1] === 'publish-drafts' && m === 'POST') {
                const id = decodeURIComponent(parts[0]);
                const protocol = await this.resolveService('protocol');
                if (protocol && typeof (protocol as any).publishPackageDrafts === 'function') {
                    try {
                        const organizationId = await this.resolveActiveOrganizationId(_context);
                        const result = await (protocol as any).publishPackageDrafts({
                            packageId: id,
                            ...(organizationId ? { organizationId } : {}),
                            ...(body?.actor ? { actor: body.actor } : {}),
                        });
                        // Publishing a `seed` draft is what actually loads its
                        // rows. The objectql protocol now batch-applies seeds
                        // inside `publishPackageDrafts` itself (so EVERY publish
                        // path — incl. the per-ref REST publish — materializes
                        // data) and reports under `seedApplied`. Only fall back
                        // to the route-level apply for custom protocols that
                        // don't self-apply — never run both, or an externalId-less
                        // seed would double-insert.
                        if ((result as any)?.seedApplied === undefined) {
                            try {
                                const seedNames = ((result as any)?.published ?? [])
                                    .filter((p: any) => p?.type === 'seed')
                                    .map((p: any) => p.name as string);
                                if (seedNames.length > 0) {
                                    (result as any).seedApplied = await this.applyPublishedSeeds(
                                        seedNames,
                                        organizationId,
                                        _context,
                                    );
                                }
                            } catch (e: any) {
                                (result as any).seedApplied = { success: false, error: e?.message ?? 'seed apply failed' };
                            }
                        }
                        // ADR-0045: "Publish" makes the package live AND visible.
                        // A materialized (additive) build has no drafts left to
                        // promote — its app sits at `hidden: true` awaiting the
                        // visibility flip. Unhide every hidden app bound to this
                        // package so ONE publish verb serves both regimes (the
                        // caller never needs to know how the package was built).
                        // Best-effort: a custom protocol without the meta
                        // primitives keeps plain draft-publish semantics.
                        try {
                            if (
                                typeof (protocol as any).getMetaItems === 'function' &&
                                typeof (protocol as any).saveMetaItem === 'function'
                            ) {
                                const appsRes = await (protocol as any).getMetaItems({
                                    type: 'app',
                                    packageId: id,
                                    ...(organizationId ? { organizationId } : {}),
                                });
                                const apps: any[] = Array.isArray(appsRes)
                                    ? appsRes
                                    : Array.isArray((appsRes as any)?.items) ? (appsRes as any).items : [];
                                const unhidden: string[] = [];
                                for (const app of apps) {
                                    if (app && typeof app === 'object' && app.hidden === true && typeof app.name === 'string') {
                                        await (protocol as any).saveMetaItem({
                                            type: 'app',
                                            name: app.name,
                                            item: { ...app, hidden: false },
                                            packageId: id,
                                            ...(organizationId ? { organizationId } : {}),
                                            ...(body?.actor ? { actor: body.actor } : {}),
                                        });
                                        unhidden.push(app.name);
                                    }
                                }
                                if (unhidden.length > 0) (result as any).unhiddenApps = unhidden;
                            }
                        } catch (e: any) {
                            (result as any).unhideError = e?.message ?? 'visibility flip failed';
                        }
                        return { handled: true, response: this.success(result) };
                    } catch (e: any) {
                        return { handled: true, response: this.error(e.message, e.statusCode || 500) };
                    }
                }
                return { handled: true, response: this.error('Draft publishing not supported', 501) };
            }

            // POST /packages/:id/discard-drafts → drop every pending DRAFT bound
            // to the package, reverting it to its last published baseline
            // ("abandon all my changes"). NON-destructive: active metadata and
            // physical tables are untouched. Routes through the sys_metadata
            // path (no metadata-service dependency, unlike /revert below).
            if (parts.length === 2 && parts[1] === 'discard-drafts' && m === 'POST') {
                const id = decodeURIComponent(parts[0]);
                const protocol = await this.resolveService('protocol');
                if (protocol && typeof (protocol as any).discardPackageDrafts === 'function') {
                    try {
                        const organizationId = await this.resolveActiveOrganizationId(_context);
                        const result = await (protocol as any).discardPackageDrafts({
                            packageId: id,
                            ...(organizationId ? { organizationId } : {}),
                            ...(body?.actor ? { actor: body.actor } : {}),
                        });
                        return { handled: true, response: this.success(result) };
                    } catch (e: any) {
                        return { handled: true, response: this.error(e.message, e.statusCode || 500) };
                    }
                }
                return { handled: true, response: this.error('Draft discarding not supported', 501) };
            }

            // POST /packages/:id/revert → revert package to last published state
            if (parts.length === 2 && parts[1] === 'revert' && m === 'POST') {
                const id = decodeURIComponent(parts[0]);
                const metadataService = await this.getService(CoreServiceName.enum.metadata);
                if (metadataService && typeof (metadataService as any).revertPackage === 'function') {
                    await (metadataService as any).revertPackage(id);
                    return { handled: true, response: this.success({ success: true }) };
                }
                return { handled: true, response: this.error('Metadata service not available', 503) };
            }

            // GET /packages/:id/export → assemble a portable manifest from
            // sys_metadata overlay rows bound to this package (offline export).
            if (parts.length === 2 && parts[1] === 'export' && m === 'GET') {
                const id = decodeURIComponent(parts[0]);
                const manifest = await this.assemblePackageManifest(id, registry, _context);
                if (!manifest) {
                    return { handled: true, response: this.error(`Package '${id}' not found`, 404) };
                }
                return { handled: true, response: this.success(manifest) };
            }

            // GET /packages/:id → get package
            if (parts.length === 1 && m === 'GET') {
                const id = decodeURIComponent(parts[0]);
                const pkg = registry.getPackage(id);
                if (!pkg) return { handled: true, response: this.error(`Package '${id}' not found`, 404) };
                return { handled: true, response: this.success(pkg) };
            }

            // DELETE /packages/:id → delete the package. Unregisters it from the
            // in-memory registry AND removes its persisted sys_metadata rows
            // (active + draft), tearing down each object's physical table by
            // default. `?keepData=true` preserves object tables (metadata-only
            // delete). Use case: "I don't want this package anymore."
            if (parts.length === 1 && m === 'DELETE') {
                const id = decodeURIComponent(parts[0]);
                const registryRemoved = registry.uninstallPackage(id);

                // Persisted removal (AI/runtime packages live in sys_metadata, not
                // just the in-memory registry — the registry uninstall alone would
                // leave the rows and tables behind).
                let persisted: unknown = undefined;
                const protocol = await this.resolveService('protocol');
                if (protocol && typeof (protocol as any).deletePackage === 'function') {
                    try {
                        const organizationId = await this.resolveActiveOrganizationId(_context);
                        const keepData = query?.keepData === 'true' || query?.keepData === '1';
                        persisted = await (protocol as any).deletePackage({
                            packageId: id,
                            ...(organizationId ? { organizationId } : {}),
                            ...(keepData ? { keepData: true } : {}),
                        });
                    } catch (e: any) {
                        return { handled: true, response: this.error(e.message, e.statusCode || 500) };
                    }
                }

                const deletedCount = (persisted as any)?.deletedCount ?? 0;
                if (!registryRemoved && deletedCount === 0) {
                    return { handled: true, response: this.error(`Package '${id}' not found`, 404) };
                }
                return { handled: true, response: this.success({ success: true, registryRemoved, persisted }) };
            }
        } catch (e: any) {
            return { handled: true, response: this.error(e.message, e.statusCode || 500) };
        }

        return { handled: false };
    }

    /**
     * Assemble a portable, offline-installable package manifest from the
     * `sys_metadata` overlay rows bound to `packageId`.
     *
     * The resulting shape mirrors what `marketplace-install-local` →
     * `manifestService.register()` → `engine.registerApp()` consumes:
     *   `{ id, name, version, objects:[…], views:[…], flows:[…], … }`
     * where each category key is the PLURAL manifest name and its value is
     * an array of clean metadata bodies (provenance decorations stripped).
     *
     * Only the metadata categories that `registerApp` can actually consume
     * are exported. `datasources` and `emailTemplates` are intentionally
     * excluded (not registered by the import path). `tools` / `skills` ARE
     * round-tripped: they are registered by `registerApp` on import and
     * surfaced by `getMetaItems('tool' | 'skill')` on export.
     *
     * @returns the manifest object, or `null` if the package id is unknown
     *          AND has no overlay-authored metadata.
     */
    private async assemblePackageManifest(
        packageId: string,
        registry: any,
        context: HttpProtocolContext,
    ): Promise<Record<string, any> | null> {
        const protocol = await this.resolveService('protocol');
        if (!protocol || typeof protocol.getMetaItems !== 'function') return null;

        const organizationId = await this.resolveActiveOrganizationId(context);

        // Provenance / overlay-bookkeeping keys that must never leak into a
        // portable manifest. Stripped at top level only — nested field bodies
        // are left untouched.
        const PROVENANCE_KEYS = new Set([
            '_packageId', '_packageVersionId', '_provenance', '_state',
            '_version', '_organizationId', '_source', '_id', '_rowId',
        ]);
        const clean = (item: any) => {
            if (!item || typeof item !== 'object') return item;
            const out: Record<string, any> = {};
            for (const [k, v] of Object.entries(item)) {
                if (k.startsWith('_') || PROVENANCE_KEYS.has(k)) continue;
                out[k] = v;
            }
            return out;
        };

        // Categories the local-install register path understands. Excludes
        // datasources / emailTemplates (not consumed by registerApp).
        const exportPluralKeys = Object.keys(PLURAL_TO_SINGULAR).filter(
            (k) => k !== 'datasources' && k !== 'emailTemplates',
        );

        const manifest: Record<string, any> = {};
        let total = 0;
        for (const plural of exportPluralKeys) {
            const singular = PLURAL_TO_SINGULAR[plural];
            let items: any[] = [];
            try {
                // getMetaItems applies the packageId filter at the
                // registry/overlay query level, so the returned items are
                // already scoped to this package — no client-side re-filter.
                const res = await protocol.getMetaItems({ type: singular, packageId, organizationId });
                items = Array.isArray(res?.items) ? res.items : [];
            } catch {
                // Unknown/unsupported type for this runtime — skip.
                continue;
            }
            if (items.length === 0) continue;
            manifest[plural] = items.map(clean);
            total += items.length;
        }

        const pkg = (() => {
            try { return registry?.getPackage?.(packageId); } catch { return undefined; }
        })();

        if (total === 0 && !pkg) return null;

        manifest.id = packageId;
        manifest.name = pkg?.manifest?.name ?? pkg?.name ?? packageId;
        manifest.version = pkg?.manifest?.version ?? pkg?.version ?? '1.0.0';
        if (pkg?.manifest?.label ?? pkg?.label) {
            manifest.label = pkg?.manifest?.label ?? pkg?.label;
        }
        return manifest;
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
     * Apply just-published `seed` metadata: load each seed's rows into its
     * target object so publishing a seed draft makes the data live (the runtime
     * counterpart to staging it). Reads each seed body via the protocol, then
     * runs the {@link SeedLoaderService} for the active org. Best-effort and
     * idempotent (upsert) — callers must never let this fail the publish.
     *
     * Lives at the runtime layer (not in the objectql publish primitive)
     * because the seed loader needs the data engine + metadata service, which
     * objectql cannot depend on without a layering cycle.
     */
    private async applyPublishedSeeds(
        names: string[],
        organizationId: string | undefined,
        _context: HttpProtocolContext,
    ): Promise<{ success: boolean; inserted?: number; updated?: number; errors?: unknown[]; error?: string }> {
        const protocol: any = await this.resolveService('protocol');
        const metadata: any = await this.getService(CoreServiceName.enum.metadata);
        const ql: any = await this.resolveService('objectql');
        if (!protocol || typeof protocol.getMetaItem !== 'function' || !ql || !metadata) {
            return { success: false, error: 'seed apply: required services unavailable' };
        }
        const datasets: any[] = [];
        const readErrors: string[] = [];
        for (const name of names) {
            // Read the just-published seed body. Try the active org first, then
            // fall back to an env-wide read — a workspace seed is often stored
            // org-wide (organization_id IS NULL), and resolving the wrong scope
            // here is what silently produced "0 rows loaded".
            const attempts = organizationId
                ? [{ type: 'seed', name, organizationId }, { type: 'seed', name }]
                : [{ type: 'seed', name }];
            let item: any;
            for (const args of attempts) {
                try {
                    item = await protocol.getMetaItem(args);
                    if (item) break;
                } catch (e) {
                    readErrors.push(`read ${name}: ${(e as Error)?.message ?? String(e)}`);
                }
            }
            // protocol.getMetaItem (called directly, unlike the HTTP endpoint
            // which unwraps) returns a WRAPPER: `{ type, name, item, lock,
            // editable, … }` — the seed body (object/records) lives under
            // `.item`. Tolerate the wrapper (`.item`) plus the body-direct and
            // `.metadata`/`.body` shapes other protocols may return.
            const seed = item?.object && Array.isArray(item?.records)
                ? item
                : (item?.item ?? item?.metadata ?? item?.body);
            if (seed?.object && Array.isArray(seed?.records)) {
                datasets.push(seed);
            } else {
                readErrors.push(`seed "${name}" body unreadable (keys: ${item ? Object.keys(item).join(',') : 'none'})`);
            }
        }
        // Seeds were published but none could be read back → surface it (do NOT
        // report success with 0 rows, which hides the failure).
        if (datasets.length === 0) {
            return { success: false, inserted: 0, updated: 0, error: 'seed apply: no readable seed bodies', errors: readErrors };
        }

        const { SeedLoaderService } = await import('./seed-loader.js');
        const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
        const loader = new SeedLoaderService(ql, metadata, (this as any).logger ?? console);
        const request = SeedLoaderRequestSchema.parse({
            seeds: datasets,
            config: {
                defaultMode: 'upsert',
                multiPass: true,
                ...(organizationId ? { organizationId } : {}),
            },
        });
        const r = await loader.load(request);
        return {
            success: r.success,
            inserted: r.summary.totalInserted,
            updated: r.summary.totalUpdated,
            errors: [...readErrors, ...(r.errors ?? [])],
        };
    }

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

    /**
     * Handles Storage requests
     * path: sub-path after /storage/
     */
    async handleStorage(path: string, method: string, file: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        const storageService = await this.getService(CoreServiceName.enum['file-storage']) || this.kernel.services?.['file-storage'];
        if (!storageService) {
             return { handled: true, response: this.error('File storage not configured', 501) };
        }
        
        const m = method.toUpperCase();
        const parts = path.replace(/^\/+/, '').split('/');
        
        // POST /storage/upload
        if (parts[0] === 'upload' && m === 'POST') {
            if (!file) {
                 return { handled: true, response: this.error('No file provided', 400) };
            }
            const result = await storageService.upload(file, { request: context.request });
            return { handled: true, response: this.success(result) };
        }
        
        // GET /storage/file/:id
        if (parts[0] === 'file' && parts[1] && m === 'GET') {
            const id = parts[1];
            const result = await storageService.download(id, { request: context.request });
            
            // Result can be URL (redirect), Stream/Blob, or metadata
            if (result.url && result.redirect) {
                // Must be handled by adapter to do actual redirect
                return { handled: true, result: { type: 'redirect', url: result.url } };
            }
            
            if (result.stream) {
                 // Must be handled by adapter to pipe stream
                 return { 
                     handled: true, 
                     result: { 
                         type: 'stream', 
                         stream: result.stream, 
                         headers: {
                             'Content-Type': result.mimeType || 'application/octet-stream',
                             'Content-Length': result.size
                         }
                     } 
                 };
            }
            
            return { handled: true, response: this.success(result) };
        }
        
        return { handled: false };
    }

    /**
     * Handles UI requests
     * path: sub-path after /ui/
     */
    async handleUi(path: string, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
        
        // GET /ui/view/:object (with optional type param)
        if (parts[0] === 'view' && parts[1]) {
            const objectName = parts[1];
            // Support both path param /view/obj/list AND query param /view/obj?type=list
            const type = parts[2] || query?.type || 'list';

            const protocol = await this.resolveService('protocol');
            
            if (protocol && typeof protocol.getUiView === 'function') {
                try {
                    const result = await protocol.getUiView({ object: objectName, type });
                    return { handled: true, response: this.success(result) };
                } catch (e: any) {
                    return { handled: true, response: this.error(e.message, 500) };
                }
            } else {
                 return { handled: true, response: this.error('Protocol service not available', 503) };
            }
        }

        return { handled: false };
    }

    /**
     * Handles Automation requests
     * path: sub-path after /automation/
     *
     * Routes:
     *   GET    /                     → listFlows
     *   GET    /actions              → getActionDescriptors (ADR-0018; ?paradigm/?source/?category filters)
     *   GET    /connectors           → getConnectorDescriptors (ADR-0022; ?type filter)
     *   GET    /:name                → getFlow
     *   POST   /                     → createFlow (registerFlow)
     *   PUT    /:name                → updateFlow
     *   DELETE /:name                → deleteFlow (unregisterFlow)
     *   POST   /:name/trigger        → execute (legacy: trigger/:name also supported)
     *   POST   /:name/toggle         → toggleFlow
     *   GET    /:name/runs           → listRuns
     *   GET    /:name/runs/:runId    → getRun
     *   POST   /:name/runs/:runId/resume → resume a paused run (screen input / ADR-0019)
     *   GET    /:name/runs/:runId/screen → the screen a paused run awaits
     */
    async handleAutomation(path: string, method: string, body: any, context: HttpProtocolContext, query?: any): Promise<HttpDispatcherResult> {
        const automationService = await this.getService(CoreServiceName.enum.automation);
        if (!automationService) return { handled: false };

        const m = method.toUpperCase();
        const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

        // Legacy: POST /automation/trigger/:name
        if (parts[0] === 'trigger' && parts[1] && m === 'POST') {
             const triggerName = parts[1];
             if (typeof automationService.trigger === 'function') {
                 const result = await automationService.trigger(triggerName, body, { request: context.request });
                 return { handled: true, response: this.success(result) };
             }
             // Fallback to execute
             if (typeof automationService.execute === 'function') {
                 const result = await automationService.execute(triggerName, body);
                 return { handled: true, response: this.success(result) };
             }
        }

        // GET / → listFlows
        if (parts.length === 0 && m === 'GET') {
            if (typeof automationService.listFlows === 'function') {
                const names = await automationService.listFlows();
                return { handled: true, response: this.success({ flows: names, total: names.length, hasMore: false }) };
            }
        }

        // POST / → createFlow
        if (parts.length === 0 && m === 'POST') {
            if (typeof automationService.registerFlow === 'function') {
                automationService.registerFlow(body?.name, body);
                return { handled: true, response: this.success(body) };
            }
        }

        // GET /actions → list registered action descriptors (ADR-0018).
        // MUST precede the `/:name → getFlow` catch-all below, otherwise a
        // flow lookup for a flow literally named "actions" would shadow it.
        // Backs the designer palette + flow validation; the registry is open
        // and marketplace-extensible (built-in + plugin-contributed actions).
        if (parts[0] === 'actions' && parts.length === 1 && m === 'GET') {
            if (typeof automationService.getActionDescriptors === 'function') {
                let actions = automationService.getActionDescriptors() ?? [];
                // Optional filters mirror descriptor fields.
                if (query?.paradigm) {
                    actions = actions.filter((a: any) => Array.isArray(a?.paradigms) && a.paradigms.includes(query.paradigm));
                }
                if (query?.source) {
                    actions = actions.filter((a: any) => a?.source === query.source);
                }
                if (query?.category) {
                    actions = actions.filter((a: any) => a?.category === query.category);
                }
                return { handled: true, response: this.success({ actions, total: actions.length }) };
            }
            // Service present but does not implement the optional method:
            // report an empty (but valid) registry rather than a 404.
            return { handled: true, response: this.success({ actions: [], total: 0 }) };
        }

        // GET /connectors → list registered connector descriptors (ADR-0022).
        // Like /actions, MUST precede the `/:name → getFlow` catch-all so a flow
        // named "connectors" cannot shadow it. Backs the designer's
        // `connector_action` connector/action/input pickers; the registry is
        // empty in baseline and populated by connector plugins (e.g.
        // @objectstack/connector-rest, @objectstack/connector-slack).
        if (parts[0] === 'connectors' && parts.length === 1 && m === 'GET') {
            if (typeof automationService.getConnectorDescriptors === 'function') {
                let connectors = automationService.getConnectorDescriptors() ?? [];
                // Optional filter mirrors the descriptor's connector type.
                if (query?.type) {
                    connectors = connectors.filter((c: any) => c?.type === query.type);
                }
                return { handled: true, response: this.success({ connectors, total: connectors.length }) };
            }
            // Service present but does not implement the optional method:
            // report an empty (but valid) registry rather than a 404.
            return { handled: true, response: this.success({ connectors: [], total: 0 }) };
        }

        // Routes with :name
        if (parts.length >= 1) {
            const name = parts[0];

            // POST /:name/trigger → execute
            if (parts[1] === 'trigger' && m === 'POST') {
                if (typeof automationService.execute === 'function') {
                    const ctxBody = body && typeof body === 'object' ? body : {};
                    // Translate UI/SDK request shape `{recordId, objectName, params}`
                    // into the canonical AutomationContext shape expected by the engine.
                    // Key transformations:
                    //  - `recordId` is exposed in `params.recordId` AND aliased to
                    //    `<objectName>Id` (camelCase) so flow variables like `leadId`,
                    //    `caseId`, `opportunityId` resolve from a single REST contract.
                    //  - `objectName` is mapped to the canonical `object` field.
                    //  - The user identity from the auth context (if any) is forwarded
                    //    as `userId` so node executors / template interpolation can
                    //    expand `{$User.Id}`.
                    const recordId = ctxBody.recordId;
                    const objectName = ctxBody.objectName ?? ctxBody.object;
                    const baseParams = (ctxBody.params && typeof ctxBody.params === 'object') ? { ...ctxBody.params } : {};
                    // Back-compat: when callers POST a flat body (no `params` wrapper),
                    // forward unknown top-level keys as flow params so the original
                    // `{ foo: 'bar' }` payload is not silently dropped.
                    if (!ctxBody.params) {
                        const reserved = new Set(['recordId', 'objectName', 'object', 'event', 'params']);
                        for (const [k, v] of Object.entries(ctxBody)) {
                            if (reserved.has(k)) continue;
                            if (baseParams[k] === undefined) baseParams[k] = v;
                        }
                    }
                    if (recordId !== undefined && baseParams.recordId === undefined) {
                        baseParams.recordId = recordId;
                    }
                    if (recordId !== undefined && objectName) {
                        const alias = `${String(objectName).replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())}Id`;
                        if (baseParams[alias] === undefined) baseParams[alias] = recordId;
                    }
                    const automationContext: any = {
                        params: baseParams,
                        object: objectName,
                        event: ctxBody.event ?? 'manual',
                    };
                    const userIdFromAuth = (context as any)?.user?.id ?? (context as any)?.userId;
                    if (userIdFromAuth) automationContext.userId = userIdFromAuth;
                    const result = await automationService.execute(name, automationContext);
                    return { handled: true, response: this.success(result) };
                }
            }

            // POST /:name/toggle → toggleFlow
            if (parts[1] === 'toggle' && m === 'POST') {
                if (typeof automationService.toggleFlow === 'function') {
                    await automationService.toggleFlow(name, body?.enabled ?? true);
                    return { handled: true, response: this.success({ name, enabled: body?.enabled ?? true }) };
                }
            }

            // POST /:name/runs/:runId/resume → resume a paused run (screen-flow
            // runtime / ADR-0019). Body `{ inputs }` = a screen node's collected
            // values, applied as bare flow variables; `output`/`branchLabel` also
            // forwarded for approval-style resumes. Returns the next paused
            // `{ screen }` (multi-screen) or the completed result.
            if (parts[1] === 'runs' && parts[2] && parts[3] === 'resume' && m === 'POST') {
                if (typeof automationService.resume === 'function') {
                    const b = (body && typeof body === 'object') ? body : {};
                    const inputs = (b.inputs ?? b.variables);
                    const signal: any = {};
                    if (inputs && typeof inputs === 'object') signal.variables = inputs;
                    if (b.output && typeof b.output === 'object') signal.output = b.output;
                    if (typeof b.branchLabel === 'string') signal.branchLabel = b.branchLabel;
                    const result = await automationService.resume(parts[2], signal);
                    return { handled: true, response: this.success(result) };
                }
                return { handled: true, response: this.error('Resume not supported', 501) };
            }

            // GET /:name/runs/:runId/screen → the screen a paused run awaits
            // (refresh-safe re-fetch for the UI flow-runner).
            if (parts[1] === 'runs' && parts[2] && parts[3] === 'screen' && m === 'GET') {
                if (typeof automationService.getSuspendedScreen === 'function') {
                    const screen = automationService.getSuspendedScreen(parts[2]);
                    if (!screen) return { handled: true, response: this.error('No pending screen for run', 404) };
                    return { handled: true, response: this.success({ runId: parts[2], screen }) };
                }
                return { handled: true, response: this.error('Screen lookup not supported', 501) };
            }

            // GET /:name/runs/:runId → getRun
            if (parts[1] === 'runs' && parts[2] && !parts[3] && m === 'GET') {
                if (typeof automationService.getRun === 'function') {
                    const run = await automationService.getRun(parts[2]);
                    if (!run) return { handled: true, response: this.error('Execution not found', 404) };
                    return { handled: true, response: this.success(run) };
                }
            }

            // GET /:name/runs → listRuns
            if (parts[1] === 'runs' && !parts[2] && m === 'GET') {
                if (typeof automationService.listRuns === 'function') {
                    const options = query ? { limit: query.limit ? Number(query.limit) : undefined, cursor: query.cursor } : undefined;
                    const runs = await automationService.listRuns(name, options);
                    return { handled: true, response: this.success({ runs, hasMore: false }) };
                }
            }

            // GET /:name → getFlow (no sub-path)
            if (parts.length === 1 && m === 'GET') {
                if (typeof automationService.getFlow === 'function') {
                    const flow = await automationService.getFlow(name);
                    if (!flow) return { handled: true, response: this.error('Flow not found', 404) };
                    return { handled: true, response: this.success(flow) };
                }
            }

            // PUT /:name → updateFlow
            if (parts.length === 1 && m === 'PUT') {
                if (typeof automationService.registerFlow === 'function') {
                    automationService.registerFlow(name, body?.definition ?? body);
                    return { handled: true, response: this.success(body?.definition ?? body) };
                }
            }

            // DELETE /:name → deleteFlow
            if (parts.length === 1 && m === 'DELETE') {
                if (typeof automationService.unregisterFlow === 'function') {
                    automationService.unregisterFlow(name);
                    return { handled: true, response: this.success({ name, deleted: true }) };
                }
            }
        }
        
        return { handled: false };
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

        // Replicate the kernel swap that `dispatcher.handle()` does for
        // data/meta/automation routes. Action routes are registered on the
        // raw HTTP server and skip the `handle()` chain, so without this
        // swap `getObjectQLService` would resolve the control-plane kernel
        // (where the CRM bundle's actions are NOT registered). Routed via the
        // host's KernelResolver (ADR-0006 Phase 5) — same seam as handle().
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

        // Resolve the handler — fall back to wildcard '*' if the object-specific key is missing.
        // Since engine.executeAction throws when the key is unknown, we probe via the internal
        // map by attempting the call inside a try/catch and rotating to '*'.
        const tryExecute = async (obj: string) => {
            return ql.executeAction(obj, actionName, actionContext);
        };

        const reqBody = body && typeof body === 'object' ? body : {};
        const recordId = recordIdFromPath ?? reqBody.recordId;
        const reqParams = (reqBody.params && typeof reqBody.params === 'object') ? reqBody.params : {};

        // Load the record (best-effort) so handlers can rely on `ctx.record`.
        let record: Record<string, unknown> = {};
        if (recordId && objectName !== 'global') {
            try {
                const got = await this.callData('get', { object: objectName, id: recordId }, _context.dataDriver, _context.environmentId, _context.executionContext);
                if (got?.record) record = got.record;
            } catch { /* record may not exist for new-record actions; pass empty */ }
        }
        if (record && (record as any).id == null && recordId) (record as any).id = recordId;

        // Slim engine facade matching the ActionContext.engine shape used by CRM handlers.
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

        const userIdFromAuth = (_context as any)?.user?.id ?? (_context as any)?.userId ?? 'system';
        const userFromAuth = (_context as any)?.user ?? { id: userIdFromAuth, name: userIdFromAuth };

        const actionContext: any = {
            record,
            user: userFromAuth,
            engine: engineFacade,
            params: { ...reqParams, recordId, objectName },
        };

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
            const msg = err?.message ?? String(err);
            return { handled: true, response: this.success({ success: false, error: msg }) };
        }
    }

    /**
     * Handle AI service routes (/ai/chat, /ai/models, /ai/conversations, etc.)
     * Resolves the AI service and its built-in route handlers, then dispatches.
     */
    async handleAI(subPath: string, method: string, body: any, query: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
        let aiService: any;
        try {
            aiService = await this.resolveService('ai');
        } catch {
            // AI service not registered
        }

        if (!aiService) {
            return {
                handled: true,
                response: {
                    status: 404,
                    body: { success: false, error: { message: 'AI service is not configured', code: 404 } },
                },
            };
        }

        // The AI service exposes route definitions via buildAIRoutes.
        // We match the request path against known AI route patterns.
        const fullPath = `/api/v1${subPath}`;

        // Build a simple param-extracting matcher for route patterns like /api/v1/ai/conversations/:id
        const matchRoute = (pattern: string, path: string): Record<string, string> | null => {
            const patternParts = pattern.split('/');
            const pathParts = path.split('/');
            if (patternParts.length !== pathParts.length) return null;
            const params: Record<string, string> = {};
            for (let i = 0; i < patternParts.length; i++) {
                if (patternParts[i].startsWith(':')) {
                    params[patternParts[i].substring(1)] = pathParts[i];
                } else if (patternParts[i] !== pathParts[i]) {
                    return null;
                }
            }
            return params;
        };

        // Try to get route definitions from the AI service's cached routes
        const routes = (this.kernel as any).__aiRoutes as Array<{
            method: string; path: string; handler: (req: any) => Promise<any>;
        }> | undefined;

        if (!routes) {
            return {
                handled: true,
                response: {
                    status: 503,
                    body: { success: false, error: { message: 'AI service routes not yet initialized', code: 503 } },
                },
            };
        }

        for (const route of routes) {
            if (route.method !== method) continue;
            const params = matchRoute(route.path, fullPath);
            if (params === null) continue;

            // Resolve `req.user` from the already-resolved ExecutionContext so
            // AI route handlers can attribute the call to the authenticated
            // actor (drives auto-titled conversations, permission-aware
            // tools, HITL conversation linkage, …). Falls back to undefined
            // for anonymous requests — the route's own `auth: true` guard
            // is enforced by upstream middleware.
            const ec: any = context.executionContext;
            const user = ec?.userId
                ? {
                    userId: ec.userId,
                    id: ec.userId,
                    displayName: ec.userDisplayName ?? ec.userName ?? ec.userId,
                    email: ec.userEmail,
                    roles: Array.isArray(ec.roles) ? ec.roles : [],
                    permissions: Array.isArray(ec.permissions) ? ec.permissions : [],
                    organizationId: ec.tenantId,
                }
                : undefined;

            const result = await route.handler({
                body,
                params,
                query,
                headers: context.request?.headers,
                user,
            });

            if (result.stream && result.events) {
                // Return a streaming result for the adapter to handle
                return {
                    handled: true,
                    result: {
                        type: 'stream',
                        contentType: result.vercelDataStream
                            ? 'text/plain; charset=utf-8'
                            : 'text/event-stream',
                        events: result.events,
                        vercelDataStream: result.vercelDataStream,
                        headers: {
                            'Content-Type': result.vercelDataStream
                                ? 'text/plain; charset=utf-8'
                                : 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive',
                        },
                    },
                };
            }

            return {
                handled: true,
                response: {
                    status: result.status,
                    body: result.body,
                },
            };
        }

        return {
            handled: true,
            response: this.routeNotFound(subPath),
        };
    }

    /**
     * Share-link capability tokens — "anyone with the link" publication of a
     * single record (ADR-0047). Mirrors the per-env service-dispatch pattern
     * used by {@link handleI18n} / {@link handleAI}: the `shareLinks` service
     * is resolved from the request's environment kernel, so links live in (and
     * resolve against) the same per-environment database that owns the record.
     * This branch owns URL parsing and the auth/public split.
     *
     *   POST   /share-links                   → create a link (authenticated)
     *   GET    /share-links?object&recordId    → list the caller's links (authenticated)
     *   DELETE /share-links/:idOrToken         → revoke (authenticated)
     *   GET    /share-links/:token/resolve     → resolve token → record (PUBLIC)
     *   GET    /share-links/:token/messages    → ai_conversations messages (PUBLIC)
     *
     * The resolve / messages routes are intentionally public — the token IS
     * the authorisation. The underlying record is fetched with a SYSTEM
     * context (per-env RLS is bypassed because the token gates access), and
     * `redactFields` are stripped before the record leaves the server.
     */
    async handleShareLinks(
        subPath: string,
        method: string,
        body: any,
        query: any,
        context: HttpProtocolContext,
    ): Promise<HttpDispatcherResult> {
        const svc: any = await this.resolveService('shareLinks', context.environmentId);
        if (!svc) {
            return { handled: true, response: this.error('Sharing is not configured for this environment', 501) };
        }

        const SYSTEM_CTX = { isSystem: true, roles: [], permissions: [] } as const;
        const m = method.toUpperCase();
        const parts = subPath.replace(/^\/+/, '').split('/').filter(Boolean);
        const ec: any = context.executionContext;
        const callerCtx = { userId: ec?.userId as string | undefined, tenantId: ec?.tenantId as string | undefined };

        const headerOf = (name: string): string | undefined => {
            const h = context.request?.headers;
            if (!h) return undefined;
            const v = typeof h.get === 'function' ? h.get(name) : (h[name] ?? h[name.toLowerCase()]);
            return Array.isArray(v) ? v[0] : (v ?? undefined);
        };
        const sendErr = (status: number, code: string, msg: string): HttpDispatcherResult => ({
            handled: true,
            response: this.error(msg, status, { code }),
        });
        // Engine for fetching the shared record + token probes — the same
        // per-env ObjectQL the shareLinks service is bound to.
        const getEngine = async (): Promise<any> => {
            // Read objectql from the request's RESOLVED (per-env) kernel — the
            // same engine SharingServicePlugin bound the shareLinks service to,
            // so the shared record + messages live in the SAME store as
            // sys_share_link. `resolveService('objectql', env)` can hand back a
            // different (host/scoped) engine that lacks the per-env rows.
            try {
                const k: any = this.kernel;
                const e = typeof k?.getServiceAsync === 'function'
                    ? await k.getServiceAsync('objectql')
                    : k?.getService?.('objectql');
                if (e) return e;
            } catch { /* fall through to scoped resolution */ }
            return this.resolveService('objectql', context.environmentId);
        };
        const asArray = (rows: any): any[] => (Array.isArray(rows) ? rows : Array.isArray(rows?.value) ? rows.value : []);
        const applyRedaction = (record: any, redactFields: string[]): any => {
            if (!record || typeof record !== 'object' || redactFields.length === 0) return record;
            const out: any = {};
            for (const [k, v] of Object.entries(record)) {
                if (redactFields.includes(k)) continue;
                out[k] = v;
            }
            return out;
        };

        try {
            // ── PUBLIC: resolve a token → record ──────────────────────────
            if (parts.length === 2 && parts[1] === 'resolve' && m === 'GET') {
                const token = decodeURIComponent(parts[0]);
                const signedInUserId = ec?.userId;
                const recipientEmail = typeof query?.email === 'string' ? query.email : undefined;
                const providedPassword =
                    typeof query?.password === 'string' ? (query.password as string) : headerOf('x-share-password');

                const resolved = await svc.resolveToken(token, { signedInUserId, recipientEmail, providedPassword });
                if (!resolved) {
                    // Probe the row to return a more useful status (401 vs 410 vs 404).
                    const engine = await getEngine();
                    const probe = engine
                        ? asArray(await engine.find('sys_share_link', { where: { token }, limit: 1, context: SYSTEM_CTX } as any))
                        : [];
                    const row = probe[0] ?? null;
                    const live = row && !row.revoked_at && (!row.expires_at || Date.parse(row.expires_at) > Date.now());
                    if (live && row.password_hash) {
                        return sendErr(401, providedPassword ? 'WRONG_PASSWORD' : 'NEEDS_PASSWORD',
                            providedPassword ? 'Incorrect password' : 'This link requires a password');
                    }
                    if (live && row.audience === 'signed_in' && !signedInUserId) {
                        return sendErr(401, 'SIGN_IN_REQUIRED', 'Please sign in to view this link');
                    }
                    if (row && (row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now()))) {
                        return sendErr(410, 'EXPIRED_OR_REVOKED', 'Share link has expired or been revoked');
                    }
                    return sendErr(404, 'INVALID_OR_EXPIRED', 'Share link is invalid, expired, or revoked');
                }

                const engine = await getEngine();
                const rows = engine
                    ? asArray(await engine.find(resolved.link.object_name, { where: { id: resolved.link.record_id }, limit: 1, context: SYSTEM_CTX } as any))
                    : [];
                const record = rows[0] ?? null;
                if (!record) return sendErr(410, 'RECORD_GONE', 'The shared record no longer exists');

                return {
                    handled: true,
                    response: this.success({
                        record: applyRedaction(record, resolved.redactFields),
                        link: {
                            id: resolved.link.id,
                            token: resolved.link.token,
                            object_name: resolved.link.object_name,
                            record_id: resolved.link.record_id,
                            permission: resolved.link.permission,
                            audience: resolved.link.audience,
                            expires_at: resolved.link.expires_at,
                            label: resolved.link.label,
                            created_at: resolved.link.created_at,
                        },
                        redactFields: resolved.redactFields,
                    }),
                };
            }

            // ── PUBLIC: ai_conversations messages for a resolved token ────
            if (parts.length === 2 && parts[1] === 'messages' && m === 'GET') {
                const token = decodeURIComponent(parts[0]);
                const providedPassword =
                    typeof query?.password === 'string' ? (query.password as string) : headerOf('x-share-password');
                const resolved = await svc.resolveToken(token, { signedInUserId: ec?.userId, providedPassword });
                if (!resolved) return sendErr(404, 'NOT_FOUND', 'Share link not found');
                if (resolved.link.object_name !== 'ai_conversations') {
                    return sendErr(400, 'UNSUPPORTED', 'This share link does not expose messages');
                }
                const engine = await getEngine();
                const rows = engine
                    ? asArray(await engine.find('ai_messages', {
                        where: { conversation_id: resolved.link.record_id },
                        sort: [{ field: 'created_at', order: 'asc' }],
                        limit: 500,
                        context: SYSTEM_CTX,
                    } as any))
                    : [];
                return { handled: true, response: this.success(rows) };
            }

            // ── AUTHENTICATED: create / list / revoke ─────────────────────
            if (!callerCtx.userId) return sendErr(401, 'UNAUTHENTICATED', 'Sign in to manage share links');

            // POST /share-links → create
            if (parts.length === 0 && m === 'POST') {
                const b: any = body ?? {};
                if (!b.object || !b.recordId) return sendErr(400, 'VALIDATION_FAILED', 'object and recordId are required');
                const link = await svc.createLink(
                    {
                        object: b.object,
                        recordId: b.recordId,
                        permission: b.permission,
                        audience: b.audience,
                        expiresAt: b.expiresAt ?? null,
                        emailAllowlist: b.emailAllowlist,
                        password: b.password,
                        redactFields: b.redactFields,
                        label: b.label,
                    },
                    callerCtx,
                );
                return { handled: true, response: { status: 201, body: { success: true, data: link, link } } };
            }

            // GET /share-links?object&recordId → list the caller's own links
            if (parts.length === 0 && m === 'GET') {
                const links = await svc.listLinks(
                    {
                        object: typeof query?.object === 'string' ? query.object : undefined,
                        recordId: typeof query?.recordId === 'string' ? query.recordId : undefined,
                        // Constrain to links the caller created so a guessed
                        // recordId can never enumerate another user's tokens.
                        createdBy: callerCtx.userId,
                        includeRevoked: query?.includeRevoked === 'true' || query?.includeRevoked === '1',
                    },
                    callerCtx,
                );
                return { handled: true, response: { status: 200, body: { success: true, data: links, links } } };
            }

            // DELETE /share-links/:idOrToken → revoke
            if (parts.length === 1 && m === 'DELETE') {
                await svc.revokeLink(decodeURIComponent(parts[0]), callerCtx);
                return { handled: true, response: this.success({ ok: true }) };
            }

            return { handled: true, response: this.routeNotFound(`/share-links${subPath}`) };
        } catch (err: any) {
            return sendErr(err?.status ?? 500, err?.code ?? 'INTERNAL', err?.message ?? 'Share link request failed');
        }
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
            context.executionContext = await resolveExecutionContext({
                getService: (n: string) => this.resolveService(n, context.environmentId),
                getQl: () => Promise.resolve(this.getObjectQLService(context.environmentId)),
                request: context.request,
            });
        } catch {
            // anonymous request — leave executionContext undefined
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

        // 0. Discovery Endpoint (GET /discovery or GET /)
        // Standard route: /discovery (protocol-compliant)
        // Legacy route: / (empty path, for backward compatibility — MSW strips base URL)
        try {
        if ((cleanPath === '/discovery' || cleanPath === '') && method === 'GET') {
             const info = await this.getDiscoveryInfo(prefix ?? '');
             return { 
                 handled: true, 
                 response: this.success(info) 
             };
        }

        // 0b. Health Endpoint (GET /health)
        if (cleanPath === '/health' && method === 'GET') {
            return {
                handled: true,
                response: this.success({
                    status: 'ok',
                    timestamp: new Date().toISOString(),
                    version: '1.0.0',
                    uptime: typeof process !== 'undefined' ? process.uptime() : undefined,
                }),
            };
        }

        // 0b2. Readiness Endpoint (GET /ready) — k8s / load-balancer readiness probe.
        // 200 only when the kernel is fully running; 503 while booting
        // (idle/initializing) or shutting down (stopping/stopped) so a load
        // balancer stops routing to this replica BEFORE in-flight requests are
        // drained and the server closes (graceful rolling restart).
        if (cleanPath === '/ready' && method === 'GET') {
            const state: string = typeof (this.kernel as any)?.getState === 'function'
                ? (this.kernel as any).getState()
                : 'running';
            return state === 'running'
                ? { handled: true, response: this.success({ status: 'ready', state }) }
                : { handled: true, response: this.error('Service not ready', 503, { state }) };
        }

        // 0c. Plan-A diagnostics removed; the seed-replay and oauth2/callback
        // probes were temporary debugging tools used during the SSO rollout.

        // 1. System Protocols (Prefix-based)
        if (cleanPath.startsWith('/auth')) {
            return this.handleAuth(cleanPath.substring(5), method, body, context);
        }
        
        if (cleanPath.startsWith('/meta')) {
             return this.handleMetadata(cleanPath.substring(5), context, method, body, query);
        }

        if (cleanPath.startsWith('/data')) {
            return this.handleData(cleanPath.substring(5), method, body, query, context);
        }

        if (cleanPath === '/mcp' || cleanPath.startsWith('/mcp/') || cleanPath.startsWith('/mcp?')) {
            return this.handleMcp(body, context);
        }

        if (cleanPath === '/keys' || cleanPath.startsWith('/keys/') || cleanPath.startsWith('/keys?')) {
            return this.handleKeys(method, body, context);
        }

        if (cleanPath.startsWith('/graphql')) {
             if (method === 'POST') return this.handleGraphQL(body, context);
             // GraphQL usually GET for Playground is handled by middleware but we can return 405 or handle it
        }

        if (cleanPath.startsWith('/storage')) {
             return this.handleStorage(cleanPath.substring(8), method, body, context); // body here is file/stream for upload
        }
        
        if (cleanPath.startsWith('/ui')) {
             return this.handleUi(cleanPath.substring(3), query, context);
        }

        if (cleanPath.startsWith('/automation')) {
             return this.handleAutomation(cleanPath.substring(11), method, body, context, query);
        }

        if (cleanPath.startsWith('/actions')) {
             return this.handleActions(cleanPath.substring(8), method, body, context);
        }
        
        if (cleanPath.startsWith('/analytics')) {
             return this.handleAnalytics(cleanPath.substring(10), method, body, context);
        }

        // In-app notifications (ADR-0030) — inbox list + receipt mark-read,
        // backed by the messaging service registered under the `notification` slot.
        if (cleanPath.startsWith('/notifications')) {
             return this.handleNotification(cleanPath.substring(14), method, body, query, context);
        }

        if (cleanPath.startsWith('/packages')) {
             return this.handlePackages(cleanPath.substring(9), method, body, query, context);
        }

        if (cleanPath.startsWith('/i18n')) {
             return this.handleI18n(cleanPath.substring(5), method, query, context);
        }

        // AI Service — delegate to the registered AI route handlers
        if (cleanPath.startsWith('/ai')) {
             return this.handleAI(cleanPath, method, body, query, context);
        }

        // Share links — capability-token record sharing, dispatched to the
        // per-env `shareLinks` service (links + record live in the same kernel).
        if (cleanPath === '/share-links' || cleanPath.startsWith('/share-links/')) {
             return this.handleShareLinks(cleanPath.substring('/share-links'.length), method, body, query, context);
        }

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
