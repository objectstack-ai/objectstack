// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer } from '@objectstack/core';
import { HttpDispatcher, HttpDispatcherResult } from './http-dispatcher.js';
import {
    buildSecurityHeaders,
    type SecurityHeadersOptions,
} from './security/index.js';
import {
    NoopMetricsRegistry,
    NoopErrorReporter,
    instrumentRouteHandler,
    type MetricsRegistry,
    type ErrorReporter,
} from './observability/index.js';

export interface DispatcherPluginConfig {
    /**
     * API path prefix for all endpoints.
     * @default '/api/v1'
     */
    prefix?: string;

    /**
     * Project-scoping configuration. Must match the REST API
     * `enableProjectScoping` / `projectResolution` fields so AI / automation
     * routes stay in lockstep with /data and /meta.
     *
     * When `enableProjectScoping` is true and `projectResolution` is:
     *   - `required` — only `/environments/:environmentId/...` variants are registered.
     *   - `optional` / `auto` — both unscoped and scoped variants are registered
     *     (the scoped handler forwards `req.params.environmentId` into context).
     */
    scoping?: {
        enableProjectScoping?: boolean;
        projectResolution?: 'required' | 'optional' | 'auto';
    };

    /**
     * Enforce per-project membership (`sys_environment_member`) on scoped
     * data-plane routes. Returns 403 for non-members unless they are
     * staff (platform org) or the project is the well-known system
     * project.
     *
     * Defaults to `true` when `scoping.enableProjectScoping` is enabled;
     * explicitly set to `false` for tests and single-tenant deployments
     * where membership has not been seeded.
     */
    enforceProjectMembership?: boolean;

    /**
     * Security response headers. When provided, every response routed
     * through this plugin gets the headers merged in (route-specific
     * headers still win on conflict).
     *
     * Pass `false` to disable. Pass `true` (or omit) to enable with
     * conservative API-server defaults (CSP=deny-all, XCTO=nosniff,
     * X-Frame-Options=DENY, etc.). Pass an object to customize — see
     * {@link SecurityHeadersOptions}.
     *
     * @default true
     */
    securityHeaders?: boolean | SecurityHeadersOptions;

    /**
     * Observability wiring. All fields optional; defaults are noop
     * (zero overhead, no behavior change).
     *
     *   - `metrics`: registry receiving `http_requests_total`,
     *     `http_request_duration_ms`, `http_request_errors_total` for
     *     every route this plugin mounts. Plug in `prom-client` /
     *     `@opentelemetry/api-metrics` / your own adapter.
     *
     *   - `errorReporter`: invoked on 5xx responses with the thrown
     *     error and `{ requestId, method, route }`. Plug in Sentry /
     *     Datadog / Rollbar.
     *
     *   - `generateRequestId`: customize the format of minted request
     *     ids (default: `req_<uuid>` via `crypto.randomUUID`). The
     *     incoming `X-Request-Id` header is honored when present and
     *     well-formed, regardless of this setting.
     *
     *   - `requestIdHeader`: response header name to echo the id back
     *     on. Defaults to `X-Request-Id`.
     */
    observability?: {
        metrics?: MetricsRegistry;
        errorReporter?: ErrorReporter;
        generateRequestId?: () => string;
        requestIdHeader?: string;
    };
}

/**
 * Route definition emitted by service plugins (e.g. AIServicePlugin) via hooks.
 * Minimal interface — matches the shape produced by `buildAIRoutes()`.
 */
interface RouteDefinition {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    description: string;
    handler: (req: any) => Promise<any>;
}

/**
 * Register a single RouteDefinition on the HTTP server.
 * Returns true if the route was successfully registered.
 */
function mountRouteOnServer(
    route: RouteDefinition,
    server: IHttpServer,
    routePath: string,
    securityHeaders?: Record<string, string>,
    resolveUser?: (headers: Record<string, any>) => Promise<any | undefined>,
): boolean {
    const handler = async (req: any, res: any) => {
        try {
            // Resolve the authenticated user from request headers (cookie /
            // bearer) so route handlers can attribute the request to an
            // actor — wires up `req.user` for AI routes, action endpoints,
            // anything that needs identity-aware execution.
            let user: any;
            if (resolveUser) {
                try {
                    user = await resolveUser(req.headers ?? {});
                } catch {
                    /* fall through anonymous — route's `auth: true` guard runs separately */
                }
            }

            const result = await route.handler({
                body: req.body,
                params: req.params,
                query: req.query,
                headers: req.headers,
                user,
            });

            if (result.stream && result.events) {
                // SSE streaming response
                res.status(result.status);

                if (securityHeaders) {
                    for (const [k, v] of Object.entries(securityHeaders)) {
                        res.header(k, v);
                    }
                }

                // Apply headers from the route result if available
                if (result.headers) {
                    for (const [k, v] of Object.entries(result.headers)) {
                        res.header(k, String(v));
                    }
                } else {
                    res.header('Content-Type', 'text/event-stream');
                    res.header('Cache-Control', 'no-cache');
                    res.header('Connection', 'keep-alive');
                }

                // Write the stream — events are pre-encoded SSE strings
                if (typeof res.write === 'function' && typeof res.end === 'function') {
                    for await (const event of result.events) {
                        res.write(typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`);
                    }
                    res.end();
                } else {
                    // Fallback: collect events into array
                    const events = [];
                    for await (const event of result.events) {
                        events.push(event);
                    }
                    res.json({ events });
                }
            } else {
                res.status(result.status);
                if (securityHeaders) {
                    for (const [k, v] of Object.entries(securityHeaders)) {
                        res.header(k, v);
                    }
                }
                if (result.body !== undefined) {
                    res.json(result.body);
                } else {
                    res.end();
                }
            }
        } catch (err: any) {
            errorResponseBase(err, res, securityHeaders);
        }
    };

    const m = route.method.toLowerCase();
    if (m === 'get' && typeof server.get === 'function') {
        server.get(routePath, handler);
        return true;
    } else if (m === 'post' && typeof server.post === 'function') {
        server.post(routePath, handler);
        return true;
    } else if (m === 'delete' && typeof server.delete === 'function') {
        server.delete(routePath, handler);
        return true;
    } else if (m === 'patch' && typeof server.patch === 'function') {
        server.patch(routePath, handler);
        return true;
    }
    return false;
}

/**
 * Send an HttpDispatcherResult through IHttpResponse.
 * Differentiates between handled, unhandled (404), and special results.
 *
 * @param securityHeaders headers to merge into every response (under
 * the route-specific headers so the dispatcher can override on a
 * per-route basis when truly needed).
 */
function sendResultBase(
    result: HttpDispatcherResult,
    res: any,
    securityHeaders?: Record<string, string>,
): void {
    const applySecurityHeaders = () => {
        if (!securityHeaders) return;
        for (const [k, v] of Object.entries(securityHeaders)) {
            // Don't clobber route-set headers — `res.header` semantics
            // vary by adapter, so we set unconditionally and rely on the
            // call ordering (security headers first, route headers
            // overwrite below).
            res.header(k, v);
        }
    };

    if (result.handled) {
        if (result.response) {
            res.status(result.response.status);
            applySecurityHeaders();
            if (result.response.headers) {
                for (const [k, v] of Object.entries(result.response.headers)) {
                    res.header(k, v);
                }
            }
            res.json(result.response.body);
            return;
        }
        if (result.result) {
            // Special results from the dispatcher's `result.result` channel.
            // Currently the only shape we handle here is the SSE/streaming
            // descriptor returned by AI routes:
            //   { status, stream: true, events: AsyncIterable<string>,
            //     headers?: Record<string, string>, contentType?: string }
            // Anything else falls through to JSON so older callers keep
            // working.
            const r = result.result as any;
            const isStream = r && typeof r === 'object' && (r.type === 'stream' || r.stream === true) && r.events;
            if (isStream && typeof res.write === 'function' && typeof res.end === 'function') {
                res.status(typeof r.status === 'number' ? r.status : 200);
                applySecurityHeaders();
                if (r.headers && typeof r.headers === 'object') {
                    for (const [k, v] of Object.entries(r.headers)) {
                        res.header(k, String(v));
                    }
                } else {
                    res.header('Content-Type', r.contentType || 'text/event-stream');
                    res.header('Cache-Control', 'no-cache');
                    res.header('Connection', 'keep-alive');
                }
                // Flip the adapter's `isStreaming` flag synchronously so the
                // outer handler can return before the AsyncIterable is fully
                // drained. Without this empty write, the Hono adapter would
                // see no streaming activity by the time the route handler
                // resolves and would close the body, truncating the SSE.
                res.write('');
                // Drain the events in the background; the adapter's
                // ReadableStream stays open until res.end() fires.
                (async () => {
                    try {
                        for await (const event of r.events as AsyncIterable<unknown>) {
                            if (event == null) continue;
                            res.write(typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`);
                        }
                    } catch (streamErr) {
                        try {
                            res.write(`event: error\ndata: ${JSON.stringify({ message: streamErr instanceof Error ? streamErr.message : String(streamErr) })}\n\n`);
                        } catch { /* connection already gone */ }
                    } finally {
                        try { res.end(); } catch { /* idem */ }
                    }
                })();
                return;
            }
            res.status(200);
            applySecurityHeaders();
            res.json(result.result);
            return;
        }
    }
    // Semantic 404: no route matched — include diagnostic info
    res.status(404);
    applySecurityHeaders();
    res.json({
        success: false,
        error: {
            message: 'Not Found',
            code: 404,
            type: 'ROUTE_NOT_FOUND',
            hint: 'No handler matched this request. Check the API discovery endpoint for available routes.',
        },
    });
}

function errorResponseBase(err: any, res: any, securityHeaders?: Record<string, string>): void {
    const code = err.statusCode || 500;
    res.status(code);
    if (securityHeaders) {
        for (const [k, v] of Object.entries(securityHeaders)) {
            res.header(k, v);
        }
    }
    // Side-channel: remember the original error so the observability
    // wrapper can hand it to errorReporter on 5xx. Handlers catch the
    // error and call us here instead of re-throwing, so this is the
    // only place we still have it.
    if (code >= 500) {
        try {
            (res as any).__obsRecordedError = err;
        } catch {
            // res is a frozen / proxy object — skip
        }
    }
    res.json({
        success: false,
        error: { message: err.message || 'Internal Server Error', code },
    });
}

/**
 * Dispatcher Plugin
 *
 * Bridges legacy HttpDispatcher handlers to the IHttpServer route-registration model.
 * Registers routes for domains NOT covered by @objectstack/rest:
 *   - /.well-known/objectstack (discovery)
 *   - /auth      (authentication)
 *   - /graphql   (GraphQL)
 *   - /analytics (BI queries)
 *   - /packages  (package management)
 *   - /i18n      (internationalization — locales, translations, field labels)
 *   - /storage   (file storage)
 *   - /automation (CRUD + triggers + runs)
 *
 * Usage:
 * ```ts
 * import { createDispatcherPlugin } from '@objectstack/runtime';
 * runtime.use(createDispatcherPlugin({ prefix: '/api/v1' }));
 * ```
 */
export function createDispatcherPlugin(config: DispatcherPluginConfig = {}): Plugin {
    return {
        name: 'com.objectstack.runtime.dispatcher',
        version: '1.0.0',

        init: async (_ctx: PluginContext) => {
            // Consumer-only plugin — no services registered
        },

        start: async (ctx: PluginContext) => {
            let server: IHttpServer | undefined;
            try {
                server = ctx.getService<IHttpServer>('http.server');
            } catch {
                // No HTTP server available — skip silently
                return;
            }
            if (!server) return;

            const kernel = ctx.getKernel();
            // Default: enable membership enforcement iff environment-scoping is on.
            // Tests / single-tenant deploys can opt out via the explicit flag.
            const enforceMembership =
                config.enforceProjectMembership ?? (config.scoping?.enableProjectScoping ?? false);
            const dispatcher = new HttpDispatcher(kernel, undefined, {
                enforceProjectMembership: enforceMembership,
            });
            const prefix = config.prefix || '/api/v1';

            // ── Security: resolve once at startup; applied on every response.
            // Defaults to ON because every production API server should be
            // sending these headers. Opt out with `securityHeaders: false`
            // (only sensible for tests or when an upstream reverse proxy is
            // already setting them).
            const securityHeaders: Record<string, string> | undefined =
                config.securityHeaders === false
                    ? undefined
                    : buildSecurityHeaders(
                          typeof config.securityHeaders === 'object'
                              ? config.securityHeaders
                              : {},
                      );

            // Locally-shadowed wrappers — every `sendResult(...)` /
            // `errorResponse(...)` call below picks these up via lexical
            // scope, so the 50+ route handlers don't need to thread the
            // security headers through manually.
            const sendResult = (result: HttpDispatcherResult, res: any) =>
                sendResultBase(result, res, securityHeaders);
            const errorResponse = (err: any, res: any) =>
                errorResponseBase(err, res, securityHeaders);

            // ── Observability ──────────────────────────────────────────
            // Noop defaults; production hosts inject real adapters.
            const metrics: MetricsRegistry =
                config.observability?.metrics ?? new NoopMetricsRegistry();
            const errorReporter: ErrorReporter =
                config.observability?.errorReporter ?? new NoopErrorReporter();
            const generateRequestId = config.observability?.generateRequestId;
            const requestIdHeader =
                config.observability?.requestIdHeader ?? 'X-Request-Id';

            /**
             * Wrap the IHttpServer so every route registration is
             * automatically instrumented. We only override the three
             * verb methods the dispatcher uses; everything else passes
             * through unchanged.
             */
            const rawServer = server;
            server = new Proxy(rawServer, {
                get(target, prop, receiver) {
                    if (prop === 'get' || prop === 'post' || prop === 'delete') {
                        const method = String(prop).toUpperCase();
                        const original = (target as any)[prop];
                        if (typeof original !== 'function') return original;
                        return (route: string, handler: any) => {
                            return original.call(
                                target,
                                route,
                                instrumentRouteHandler(method, route, handler, {
                                    metrics,
                                    errorReporter,
                                    generateRequestId,
                                    requestIdHeader,
                                }),
                            );
                        };
                    }
                    return Reflect.get(target, prop, receiver);
                },
            }) as IHttpServer;

            // ── Discovery (.well-known) ─────────────────────────────────
            server.get('/.well-known/objectstack', async (_req: any, res: any) => {
                if (securityHeaders) {
                    for (const [k, v] of Object.entries(securityHeaders)) {
                        res.header(k, v);
                    }
                }
                // Discovery reflects MUTABLE runtime config (which routes/services
                // are live — e.g. `mcp` only when OS_MCP_SERVER_ENABLED=true). It
                // must never be cached by an edge/CDN, or a config change (enable
                // MCP) leaves clients reading a stale payload that still says the
                // route is absent — the Integrations UI then shows "MCP not
                // enabled" against a live server (cloud#152). The body is computed
                // fresh per request; the only staleness is the HTTP cache layer.
                res.header('Cache-Control', 'no-store');
                res.json({ data: await dispatcher.getDiscoveryInfo(prefix) });
            });

            // ── Discovery (versioned API path) ──────────────────────────
            server.get(`${prefix}/discovery`, async (_req: any, res: any) => {
                if (securityHeaders) {
                    for (const [k, v] of Object.entries(securityHeaders)) {
                        res.header(k, v);
                    }
                }
                // See the .well-known handler above: discovery must not be cached
                // (mutable runtime config; cloud#152 stale `routes.mcp`).
                res.header('Cache-Control', 'no-store');
                res.json({ data: await dispatcher.getDiscoveryInfo(prefix) });
            });

            // ── Health ──────────────────────────────────────────────────
            server.get(`${prefix}/health`, async (_req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('GET', '/health', undefined, {}, { request: _req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── Readiness ───────────────────────────────────────────────
            // Like /health, the dispatcher owns the /ready branch but it is
            // only reachable over HTTP once mounted EXPLICITLY here (there is
            // no catch-all). 200 while the kernel is `running`, 503 while it is
            // booting or shutting down — the contract the EE multi-node
            // rolling-restart drain gate polls (cloud ADR-0018) so a load
            // balancer stops routing to a replica before it closes.
            server.get(`${prefix}/ready`, async (_req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('GET', '/ready', undefined, {}, { request: _req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── Auth ────────────────────────────────────────────────────
            // NOTE: /auth/* wildcard is mounted by AuthProxyPlugin (cloud)
            // or AuthPlugin (single-tenant) directly on the raw Hono app —
            // those handlers can return native Web `Response` objects which
            // is what better-auth produces. The dispatcher cannot represent
            // a streaming Response cleanly through `IHttpServer.send`, so
            // we deliberately do NOT register a dispatcher wildcard here.
            //
            // Legacy explicit /auth/login retained for self-hosted clients
            // that still POST there; superseded by the wildcard above for
            // the better-auth surface (sign-up/email, sign-in/email, …).
            server.post(`${prefix}/auth/login`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handleAuth('login', 'POST', req.body, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── GraphQL ─────────────────────────────────────────────────
            server.post(`${prefix}/graphql`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handleGraphQL(req.body, { request: req });
                    if (securityHeaders) {
                        for (const [k, v] of Object.entries(securityHeaders)) {
                            res.header(k, v);
                        }
                    }
                    res.json(result);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── Analytics ───────────────────────────────────────────────
            // Route via dispatch() (not handleAnalytics directly) so the host
            // dispatcher's project-aware kernel swap runs first — the per-project
            // kernel owns the `analytics` service (registered by ObjectQLPlugin).
            server.post(`${prefix}/analytics/query`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('POST', '/analytics/query', req.body, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.get(`${prefix}/analytics/meta`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('GET', '/analytics/meta', undefined, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.post(`${prefix}/analytics/sql`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('POST', '/analytics/sql', req.body, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── MCP (Streamable HTTP) + API keys (ADR-0036) ─────────────
            // Mounted explicitly (there is no catch-all) and routed through
            // dispatch() so the host's project-aware kernel swap + execution
            // context resolution run first. /mcp accepts POST (JSON-RPC), GET
            // (SSE) and DELETE (session end) — the transport reads the method
            // from the request, the dispatcher gates on OS_MCP_SERVER_ENABLED
            // and the resolved principal. NOTE: the dispatch() branches alone
            // are unreachable over HTTP without these registrations.
            const mountMcp = (method: 'GET' | 'POST' | 'DELETE') => {
                const register = method === 'GET' ? server.get : method === 'DELETE' ? server.delete : server.post;
                register.call(server, `${prefix}/mcp`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch(method, '/mcp', req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });
            };
            mountMcp('POST');
            mountMcp('GET');
            mountMcp('DELETE');

            server.post(`${prefix}/keys`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('POST', '/keys', req.body, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── Packages ────────────────────────────────────────────────
            server.get(`${prefix}/packages`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages('', 'GET', {}, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.post(`${prefix}/packages`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages('', 'POST', req.body, {}, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.get(`${prefix}/packages/:id/export`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages(`/${req.params.id}/export`, 'GET', {}, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.get(`${prefix}/packages/:id`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages(`/${req.params.id}`, 'GET', {}, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.delete(`${prefix}/packages/:id`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages(`/${req.params.id}`, 'DELETE', {}, {}, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.patch(`${prefix}/packages/:id/enable`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages(`/${req.params.id}/enable`, 'PATCH', {}, {}, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.patch(`${prefix}/packages/:id/disable`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages(`/${req.params.id}/disable`, 'PATCH', {}, {}, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.post(`${prefix}/packages/:id/publish`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages(`/${req.params.id}/publish`, 'POST', req.body, {}, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ADR-0033 — publish every pending draft bound to a package ("publish
            // whole app"). Distinct from /publish (which needs the metadata
            // service): this promotes sys_metadata draft rows via the protocol.
            server.post(`${prefix}/packages/:id/publish-drafts`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages(`/${req.params.id}/publish-drafts`, 'POST', req.body, {}, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.post(`${prefix}/packages/:id/revert`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handlePackages(`/${req.params.id}/revert`, 'POST', req.body, {}, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── Storage ─────────────────────────────────────────────────
            server.post(`${prefix}/storage/upload`, async (req: any, res: any) => {
                try {
                    // For file uploads the body *is* the file (parsed by adapter)
                    const result = await dispatcher.handleStorage('upload', 'POST', req.body, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.get(`${prefix}/storage/file/:id`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.handleStorage(`file/${req.params.id}`, 'GET', undefined, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── i18n ────────────────────────────────────────────────────
            // Route via dispatch() (not handleI18n directly) so the host
            // dispatcher's project-aware kernel swap runs first. Without this,
            // i18n requests hit the host kernel's in-memory fallback (which
            // is always empty) instead of the per-project I18nServicePlugin
            // populated by ArtifactKernelFactory with the artifact's
            // translation bundles.
            server.get(`${prefix}/i18n/locales`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('GET', '/i18n/locales', undefined, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.get(`${prefix}/i18n/translations/:locale`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('GET', `/i18n/translations/${req.params.locale}`, undefined, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.get(`${prefix}/i18n/labels/:object/:locale`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('GET', `/i18n/labels/${req.params.object}/${req.params.locale}`, undefined, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── Automation ──────────────────────────────────────────────
            // Registered at both `${prefix}/automation/...` and
            // `${prefix}/environments/:environmentId/automation/...` when project
            // scoping is enabled. Always dispatched through
            // `dispatcher.dispatch()` so the multi-kernel host can swap
            // to the per-project kernel before resolving the
            // `automation` service (which lives on the project kernel,
            // not the host kernel, in ObjectOS multi-tenant mode).
            const registerAutomationRoutes = (base: string) => {
                server!.get(`${base}/automation`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('GET', '/automation', undefined, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.post(`${base}/automation`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('POST', '/automation', req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.get(`${base}/automation/:name`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('GET', `/automation/${req.params.name}`, undefined, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.put(`${base}/automation/:name`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('PUT', `/automation/${req.params.name}`, req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.delete(`${base}/automation/:name`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('DELETE', `/automation/${req.params.name}`, undefined, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.post(`${base}/automation/trigger/:name`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('POST', `/automation/trigger/${req.params.name}`, req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.post(`${base}/automation/:name/trigger`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('POST', `/automation/${req.params.name}/trigger`, req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.post(`${base}/automation/:name/toggle`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('POST', `/automation/${req.params.name}/toggle`, req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.get(`${base}/automation/:name/runs`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('GET', `/automation/${req.params.name}/runs`, undefined, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.get(`${base}/automation/:name/runs/:runId`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('GET', `/automation/${req.params.name}/runs/${req.params.runId}`, undefined, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                // Screen-flow runtime (ADR-0019): resume a paused run with a
                // screen node's collected input, and re-fetch its pending screen.
                server!.post(`${base}/automation/:name/runs/:runId/resume`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('POST', `/automation/${req.params.name}/runs/${req.params.runId}/resume`, req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.get(`${base}/automation/:name/runs/:runId/screen`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('GET', `/automation/${req.params.name}/runs/${req.params.runId}/screen`, undefined, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });
            };

            // ── AI / Assistants ─────────────────────────────────────────
            // The AI service plugin registers a large, dynamic surface
            // (chat, models, conversations, tools, agents, assistants)
            // whose exact routes are built at start() time from the
            // service's tool / agent registries. To support multi-tenant
            // hosts where the AI service lives on per-project kernels,
            // mount a method-wildcard catch-all that always dispatches
            // through `dispatcher.dispatch()` — that triggers the kernel
            // swap and then routes via `handleAI`, which looks up the
            // AI service on the current (project) kernel.
            const registerAIRoutes = (base: string) => {
                const wildcards: Array<['get'|'post'|'delete'|'put', string]> = [
                    ['get', `${base}/ai/*`],
                    ['post', `${base}/ai/*`],
                    ['delete', `${base}/ai/*`],
                    ['put', `${base}/ai/*`],
                ];
                for (const [method, pattern] of wildcards) {
                    (server as any)![method](pattern, async (req: any, res: any) => {
                        try {
                            // Reconstruct the AI subpath without the prefix
                            // so dispatch() routes via the /ai branch.
                            const fullPath: string = req.path ?? '';
                            const idx = fullPath.lastIndexOf('/ai');
                            const aiSubPath = idx >= 0 ? fullPath.slice(idx) : '/ai';
                            const result = await dispatcher.dispatch(method.toUpperCase(), aiSubPath, req.body, req.query, { request: req });
                            sendResult(result, res);
                        } catch (err: any) {
                            errorResponse(err, res);
                        }
                    });
                }
            };

            // ── Actions (server-registered handlers, e.g. CRM convertLead) ───
            // Bridges UI `script` / `modal` actions to ObjectQL handlers
            // registered via `engine.registerAction(object, action, fn)`.
            const registerActionRoutes = (base: string) => {
                server!.post(`${base}/actions/:object/:action`, async (req: any, res: any) => {
                    try {
                        const ctx: any = { request: req };
                        if (req.params?.environmentId) ctx.environmentId = req.params.environmentId;
                        const result = await dispatcher.handleActions(`/${req.params.object}/${req.params.action}`, 'POST', req.body, ctx);
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });
                server!.post(`${base}/actions/:object/:action/:recordId`, async (req: any, res: any) => {
                    try {
                        const ctx: any = { request: req };
                        if (req.params?.environmentId) ctx.environmentId = req.params.environmentId;
                        const result = await dispatcher.handleActions(`/${req.params.object}/${req.params.action}/${req.params.recordId}`, 'POST', req.body, ctx);
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });
            };

            const enableProjectScoping = config.scoping?.enableProjectScoping ?? false;
            const projectResolution = config.scoping?.projectResolution ?? 'auto';

            if (enableProjectScoping && projectResolution === 'required') {
                registerAutomationRoutes(`${prefix}/environments/:environmentId`);
                registerActionRoutes(`${prefix}/environments/:environmentId`);
                registerAIRoutes(`${prefix}/environments/:environmentId`);
            } else {
                registerAutomationRoutes(prefix);
                registerActionRoutes(prefix);
                registerAIRoutes(prefix);
                if (enableProjectScoping) {
                    registerAutomationRoutes(`${prefix}/environments/:environmentId`);
                    registerActionRoutes(`${prefix}/environments/:environmentId`);
                    registerAIRoutes(`${prefix}/environments/:environmentId`);
                }
            }

            ctx.logger.info('Dispatcher bridge routes registered', { prefix, enableProjectScoping, projectResolution });

            // Resolve the authenticated user from a request's headers by
            // delegating to the AuthService's `getSession` API (better-auth
            // compatible). Returns a slim user shape that route handlers
            // can rely on without touching the underlying auth provider.
            //
            // Defensive: any failure → undefined (anonymous). The route's
            // `auth: true` guard still runs separately so unauthenticated
            // hits to protected routes are rejected upstream.
            const resolveRequestUser = async (headers: Record<string, any>): Promise<any | undefined> => {
                try {
                    const authService: any = ctx.getService('auth');
                    if (!authService) return undefined;
                    let api: any = authService.api;
                    if (!api && typeof authService.getApi === 'function') {
                        api = await authService.getApi();
                    }
                    if (!api?.getSession) return undefined;
                    const headersInstance = headers instanceof Headers
                        ? headers
                        : new Headers(headers as Record<string, string>);
                    const sessionData = await api.getSession({ headers: headersInstance });
                    const userId: string | undefined = sessionData?.user?.id ?? sessionData?.session?.userId;
                    if (!userId) return undefined;
                    // AI-route req.user permissions (incl. the synthesized `ai_seat`) are
                    // populated from the ExecutionContext by the /ai/* dispatch path
                    // (http-dispatcher → resolveExecutionContext, the single scope-correct
                    // source). This concrete-route resolver returns an empty set.
                    return {
                        userId,
                        id: userId,
                        displayName: sessionData?.user?.name ?? sessionData?.user?.email ?? userId,
                        email: sessionData?.user?.email,
                        roles: [],
                        permissions: [],
                        organizationId: sessionData?.session?.activeOrganizationId,
                    };
                } catch {
                    return undefined;
                }
            };

            // ── Dynamic service routes (AI, etc.) ───────────────────
            // Listen for route definitions emitted by service plugins.
            // The AIServicePlugin emits 'ai:routes' with RouteDefinition[].
            //
            // When environment-scoping is enabled, each AI route is mounted on
            // BOTH `${prefix}${path}` and `${prefix}/environments/:environmentId${path}`
            // (or only the scoped variant when `projectResolution === 'required'`).
            const toScopedPath = (routePath: string): string => {
                // routePath may already include /api/v1; splice /environments/:environmentId
                // after the `${prefix}` portion to produce the scoped variant.
                if (routePath.startsWith(prefix)) {
                    const tail = routePath.slice(prefix.length);
                    return `${prefix}/environments/:environmentId${tail}`;
                }
                return `/environments/:environmentId${routePath}`;
            };

            const mountAiRoute = (route: RouteDefinition) => {
                if (!server) return 0;
                const routePath = route.path.startsWith('/api/v1')
                    ? route.path
                    : `${prefix}${route.path}`;

                let count = 0;
                if (enableProjectScoping && projectResolution === 'required') {
                    if (mountRouteOnServer(route, server, toScopedPath(routePath), securityHeaders, resolveRequestUser)) count++;
                } else {
                    if (mountRouteOnServer(route, server, routePath, securityHeaders, resolveRequestUser)) count++;
                    if (enableProjectScoping) {
                        if (mountRouteOnServer(route, server, toScopedPath(routePath), securityHeaders, resolveRequestUser)) count++;
                    }
                }
                return count;
            };

            ctx.hook('ai:routes', async (routes: RouteDefinition[]) => {
                if (!server) return;
                let total = 0;
                for (const route of routes) {
                    total += mountAiRoute(route);
                }
                ctx.logger.info(`[Dispatcher] Registered ${total} AI route mount(s) from ${routes.length} definition(s)`);
            });

            // ── Fallback: recover routes cached before hook was registered ──
            // If AIServicePlugin.start() ran before DispatcherPlugin.start()
            // (possible when plugin start order differs from registration order),
            // the 'ai:routes' trigger fires with no listener. The AIServicePlugin
            // caches the routes on the kernel as __aiRoutes (see AIServicePlugin.start())
            // as an internal cross-plugin protocol so we can recover them here.
            // TODO: replace with a formal kernel.getCachedRoutes('ai') API in a future release.
            const cachedRoutes = (kernel as any).__aiRoutes as RouteDefinition[] | undefined;
            if (cachedRoutes && Array.isArray(cachedRoutes) && cachedRoutes.length > 0) {
                let registered = 0;
                for (const route of cachedRoutes) {
                    registered += mountAiRoute(route);
                }
                if (registered > 0) {
                    ctx.logger.info(`[Dispatcher] Recovered ${registered} cached AI route mount(s) (hook timing fallback)`);
                }
            }
        },
    };
}
