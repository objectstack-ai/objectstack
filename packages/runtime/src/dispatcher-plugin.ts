// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer } from '@objectstack/core';
import { looksLikeInternalErrorLeak, INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { DispatcherErrorCode } from '@objectstack/spec/api';
import { HttpDispatcher, HttpDispatcherResult } from './http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from './validation-failure.js';
import { buildApiError } from './error-envelope.js';
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
     * Reject anonymous requests to `auth: true` service routes (AI, etc.), the
     * `/meta` catch-all with HTTP 401, mirroring the
     * REST API's `requireAuth` gate. Must match the REST plugin's
     * `api.requireAuth` so `/ai` and `/meta` stay in lockstep with
     * `/data` — otherwise the AI routes' declared `auth: true` contract is never
     * enforced and anonymous callers reach adapter/model status routes or read
     *
     * Defaults to `true` — secure-by-default, matching the REST plugin's
     * `api.requireAuth` default (ADR-0056 D2). Hosts pass their `api.requireAuth`
     * through (the framework `serve` command and the cloud apps do so from the
     * same stack `api` config the REST plugin reads); a deployment that serves
     * these surfaces publicly sets `requireAuth: false` explicitly.
     */
    requireAuth?: boolean;

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
    /** Whether this route requires authentication (default: true). */
    auth?: boolean;
    /** Required permissions for accessing this route. */
    permissions?: string[];
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
    requireAuth = false,
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
                    /* fall through anonymous — enforced just below */
                }
            }

            // Enforce the route's declared `auth` contract. This used to be
            // assumed to run "separately"/upstream, but nothing did: an
            // anonymous caller reached `auth: true` handlers (e.g.
            // `GET /ai/status`) and got adapter/model config back. Gate here
            // when the deployment requires auth. Off (or `auth: false`) → the
            // handler runs as before.
            if (requireAuth && route.auth !== false && !user) {
                res.status(401);
                if (securityHeaders) {
                    for (const [k, v] of Object.entries(securityHeaders)) res.header(k, v);
                }
                res.json({
                    error: 'UNAUTHENTICATED',
                    message: 'Authentication is required to access this endpoint.',
                });
                return;
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
        error: buildApiError({
            code: DispatcherErrorCode.enum.ROUTE_NOT_FOUND,
            message: 'Not Found',
            httpStatus: 404,
            extra: {
                hint: 'No handler matched this request. Check the API discovery endpoint for available routes.',
            },
        }),
    });
}

/**
 * The single error exit for EVERY dispatcher-plugin route — `/analytics`,
 * `/packages`, `/i18n`, `/storage`, `/automation`, `/auth`, `/notifications`,
 * `/mcp`, … Each handler catches and calls here rather than re-throwing.
 *
 * [#3867] Two things were wrong with it, both invisible until a driver error
 * actually reached this path:
 *
 * 1. **It only honoured `statusCode`.** Domain errors across this codebase
 *    carry their HTTP status as `status` (the protocol layer's
 *    `OBJECT_NOT_FOUND`/`RECORD_NOT_FOUND`/`CLONE_DISABLED`, plugin-sharing's
 *    `FORBIDDEN`, …); `HttpDispatcher.errorFromThrown` already reads `status`
 *    first, `statusCode` second. Here a deliberate 404 was rendered as a
 *    **500** — the wrong code, and it dragged the message through the
 *    sanitiser below for no reason. Now aligned with `errorFromThrown`.
 *
 * 2. **It returned `err.message` verbatim.** `@objectstack/rest` has guarded
 *    its data routes against driver dumps since forever (`mapDataError`), but
 *    this boundary had no equivalent, so `POST /analytics/query` on an
 *    unresolvable cube answered with a real SQL statement in the body. The
 *    shared predicate now applies here too — but ONLY on a 5xx: a 4xx message
 *    is a deliberate business/validation answer and must reach the caller
 *    intact.
 *
 * Sanitising costs no diagnostics: the untouched error is still handed to
 * `errorReporter` through the `__obsRecordedError` side-channel below.
 *
 * [#3918] A third defect, of the same family as (1): a record-level
 * `ValidationError` carries neither `status` nor `statusCode`, so it landed on
 * the 500 fallback — and because the body was only `{message, code}`, its
 * `fields[]` was dropped AND the 5xx sanitiser above replaced the human message
 * with the generic INTERNAL_ERROR_MESSAGE. A user typing a bad email got back a
 * 500 "internal error" with nothing to attach to the offending input.
 * `@objectstack/rest` has mapped this shape to a 400 with `fields[]` since
 * forever (`mapDataError`); this exit now does the same, so a form served by
 * the dispatcher can highlight the field the way a form served by /data can.
 * `details` is only emitted for that shape — everything else keeps the exact
 * two-key body it had.
 */
function errorResponseBase(err: any, res: any, securityHeaders?: Record<string, string>): void {
    const validation = validationFailureDetails(err);
    const httpStatus =
        (typeof err?.status === 'number' ? err.status : undefined) ??
        (typeof err?.statusCode === 'number' ? err.statusCode : undefined) ??
        (validation ? VALIDATION_FAILED_STATUS : 500);
    res.status(httpStatus);
    if (securityHeaders) {
        for (const [k, v] of Object.entries(securityHeaders)) {
            res.header(k, v);
        }
    }
    // Side-channel: remember the original error so the observability
    // wrapper can hand it to errorReporter on 5xx. Handlers catch the
    // error and call us here instead of re-throwing, so this is the
    // only place we still have it.
    if (httpStatus >= 500) {
        try {
            (res as any).__obsRecordedError = err;
        } catch {
            // res is a frozen / proxy object — skip
        }
    }
    const raw = err?.message;
    const message =
        httpStatus >= 500 && looksLikeInternalErrorLeak(raw)
            ? INTERNAL_ERROR_MESSAGE
            : raw || 'Internal Server Error';
    // [#3842] A thrown error's own `.code` finally has somewhere to go. This
    // exit used to drop it outright — `HttpDispatcher.errorFromThrown` at least
    // parked it in `details` — because `error.code` was occupied by the status.
    // Both exits now put it in the declared field, so the same SDK method
    // reports the same code whichever one answered. `validation` last, so
    // `VALIDATION_FAILED` wins for an error matched by `name` alone, exactly as
    // it does in `errorFromThrown`.
    const details =
        err?.code || validation
            ? { ...(err?.code ? { code: err.code } : {}), ...(validation ?? {}) }
            : undefined;
    res.json({
        success: false,
        error: buildApiError({ message, httpStatus, details }),
    });
}

/**
 * Dispatcher Plugin
 *
 * Bridges legacy HttpDispatcher handlers to the IHttpServer route-registration model.
 * Registers routes for domains NOT covered by @objectstack/rest:
 *   - /.well-known/objectstack (discovery)
 *   - /auth      (authentication)
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
            // Secure-by-default alignment with the REST plugin's `requireAuth`.
            // The cloud apps pass the whole stack `api` block as `scoping`
            // (which carries `requireAuth`), so honour it there too; an explicit
            // top-level `requireAuth` wins.
            //
            // Defaults to `true` — matching `rest-server.ts`'s `?? true`
            // (ADR-0056 D2). The dispatcher gates the same object data as REST
            // through sibling surfaces (`/ai`, the `/meta`
            // catch-all, service routes); defaulting it OFF while REST defaults
            // ON is exactly the by-surface inconsistency #2567 closes — a bare
            // host would deny anonymous `/data` yet serve the same rows over
            // A deployment that intentionally serves these surfaces
            // publicly opts out with an explicit `requireAuth: false` (a
            // boot warning is logged, mirroring the REST plugin).
            const requireAuth =
                config.requireAuth ?? (config.scoping as { requireAuth?: boolean } | undefined)?.requireAuth ?? true;
            if (!requireAuth) {
                ctx.logger?.warn?.(
                    '[dispatcher] requireAuth is OFF — /ai and the /meta catch-all serve anonymous callers. ' +
                    'This is a deliberate opt-out; set api.requireAuth=true to deny anonymous access (ADR-0056 D2, #2567).',
                );
            }
            const dispatcher = new HttpDispatcher(kernel, undefined, {
                enforceProjectMembership: enforceMembership,
                requireAuth,
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
                // are live — e.g. `mcp` unless OS_MCP_SERVER_ENABLED=false). It
                // must never be cached by an edge/CDN, or a config change (enable
                // MCP) leaves clients reading a stale payload that still says the
                // route is absent — the Integrations UI then shows "MCP not
                // enabled" against a live server (cloud#152). The body is computed
                // fresh per request; the only staleness is the HTTP cache layer.
                res.header('Cache-Control', 'no-store');
                res.json({ data: await dispatcher.getDiscoveryInfo(prefix) });
            });

            // ── Discovery (versioned API path) ──────────────────────────
            // Single owner (ADR-0076 D11 / OQ#9): when the REST plugin is
            // mounted on the same kernel it registers `${prefix}/discovery`
            // itself (rest-server registerDiscoveryEndpoints), and which
            // payload a client saw used to depend on plugin start order
            // (first-registration-wins on Hono). Cede the route to REST
            // deterministically; this bridge registers it only as the
            // fallback owner in REST-less compositions. `/.well-known/
            // objectstack` above stays dispatcher-owned unconditionally —
            // no other plugin registers it.
            const restRegistered =
                typeof (kernel as { hasPlugin?: (n: string) => boolean }).hasPlugin === 'function' &&
                (kernel as { hasPlugin: (n: string) => boolean }).hasPlugin('com.objectstack.rest.api');
            if (!restRegistered) {
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
            } else {
                ctx.logger.info(`[Dispatcher] ${prefix}/discovery ceded to com.objectstack.rest.api (single owner)`);
            }

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

            // Public SKILL.md download (env-customized portable Agent Skill).
            // Separate registration: `/mcp` above is an exact-path mount, so
            // the sub-path needs its own route to be reachable over HTTP.
            server.get(`${prefix}/mcp/skill`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('GET', '/mcp/skill', req.body, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.post(`${prefix}/keys`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('POST', '/keys', req.body, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── In-app notifications (ADR-0030) ─────────────────────────
            // The inbox list + receipt mark-read surface backed by the
            // messaging service. `handleNotification` + its discovery entry
            // already existed, but only the cloud hosts' @objectstack/hono
            // catch-all reached it — the standalone / `os dev` server mounts
            // ONLY the explicit routes here, so every `/api/v1/notifications*`
            // request 404'd (mark-read had no working endpoint: the console's
            // direct receipt write is rejected by ADR-0103's engine-owned
            // gate, and this REST fallback was unreachable). Mount them
            // explicitly so read-state actually persists in every deployment.
            server.get(`${prefix}/notifications`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('GET', '/notifications', undefined, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.post(`${prefix}/notifications/read`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('POST', '/notifications/read', req.body, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            server.post(`${prefix}/notifications/read/all`, async (req: any, res: any) => {
                try {
                    const result = await dispatcher.dispatch('POST', '/notifications/read/all', req.body, req.query, { request: req });
                    sendResult(result, res);
                } catch (err: any) {
                    errorResponse(err, res);
                }
            });

            // ── Packages ────────────────────────────────────────────────
            // Single pipeline (ADR-0076 D11 / OQ#9): every package route flows
            // through dispatch() — like analytics / i18n / automation / AI —
            // so both HTTP entries into this domain (these explicit mounts and
            // the @objectstack/hono catch-all the cloud hosts mount underneath)
            // run the SAME per-request pipeline: kernel resolution, identity
            // resolution, auth gate. These used to call handlePackages()
            // directly, which skipped that pipeline entirely and dropped
            // req.query on several routes (so the documented `?overwrite=true`
            // install flag never reached the handler).
            const mountPackagesRoute = (
                verb: 'get' | 'post' | 'patch' | 'delete',
                routePath: string,
                toSubPath: (req: any) => string,
            ) => {
                (server as any)[verb](`${prefix}/packages${routePath}`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch(
                            verb.toUpperCase(),
                            `/packages${toSubPath(req)}`,
                            req.body,
                            req.query ?? {},
                            { request: req },
                        );
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });
            };

            mountPackagesRoute('get', '', () => '');
            mountPackagesRoute('post', '', () => '');
            mountPackagesRoute('get', '/:id/export', (req) => `/${req.params.id}/export`);
            mountPackagesRoute('get', '/:id', (req) => `/${req.params.id}`);
            mountPackagesRoute('delete', '/:id', (req) => `/${req.params.id}`);
            // Edit a package's manifest (name / description / version). `/:id`
            // is a single segment, so this does not shadow the
            // `/:id/enable|disable` routes below.
            mountPackagesRoute('patch', '/:id', (req) => `/${req.params.id}`);
            mountPackagesRoute('patch', '/:id/enable', (req) => `/${req.params.id}/enable`);
            mountPackagesRoute('patch', '/:id/disable', (req) => `/${req.params.id}/disable`);
            mountPackagesRoute('post', '/:id/publish', (req) => `/${req.params.id}/publish`);
            // ADR-0033 — publish every pending draft bound to a package ("publish
            // whole app"). Distinct from /publish (which needs the metadata
            // service): this promotes sys_metadata draft rows via the protocol.
            mountPackagesRoute('post', '/:id/publish-drafts', (req) => `/${req.params.id}/publish-drafts`);
            mountPackagesRoute('post', '/:id/revert', (req) => `/${req.params.id}/revert`);
            // duplicate (ADR-0070 D4), adopt-orphans (D5), discard-drafts, and
            // the ADR-0067 commit-history / rollback family.
            mountPackagesRoute('post', '/:id/duplicate', (req) => `/${req.params.id}/duplicate`);
            mountPackagesRoute('post', '/:id/adopt-orphans', (req) => `/${req.params.id}/adopt-orphans`);
            mountPackagesRoute('post', '/:id/discard-drafts', (req) => `/${req.params.id}/discard-drafts`);
            mountPackagesRoute('get', '/:id/commits', (req) => `/${req.params.id}/commits`);
            mountPackagesRoute('post', '/:id/commits/:commitId/revert', (req) => `/${req.params.id}/commits/${req.params.commitId}/revert`);
            mountPackagesRoute('post', '/:id/rollback', (req) => `/${req.params.id}/rollback`);

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
            // Dispatched through `dispatcher.dispatch()` (like automation/AI) so
            // the per-request pipeline resolves the session into `executionContext`
            // and swaps to the per-project kernel BEFORE the action body sandbox
            // runs — otherwise the handler's `ctx.user` sees no session and falls
            // back to `system` (#2701). The scoped-URL `:environmentId` rides on
            // `req.params` and is picked up by `prepareResolverHints`, exactly as
            // the automation routes handle it.
            const registerActionRoutes = (base: string) => {
                // [#3913 follow-up] The OBJECT-LESS shape, with the object
                // segment left empty: `POST /actions//:action`. This is the URL
                // an SDK that has no object to name emits, and it is the exact
                // one #3913 was filed against. `handleActionsRequest` has
                // routed it at the canonical `'global'` key since #3913 — but
                // ONLY when something delivers the path, and nothing did:
                // `:object` does not match an empty segment, so the request
                // fell through to Hono's `notFound` and answered a bare
                // `{error: 'Not found'}` without the domain ever running. The
                // unit tests call `handleActions()` / `dispatch()` directly,
                // which is precisely why they could not catch this — found by
                // dogfooding the real HTTP surface.
                //
                // Registered FIRST and with the empty segment spelled out.
                // Hono matches the literal `//` and does not let this shadow
                // the two-segment route below (verified against the router).
                server!.post(`${base}/actions//:action`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('POST', `/actions//${req.params.action}`, req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });
                server!.post(`${base}/actions/:object/:action`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('POST', `/actions/${req.params.object}/${req.params.action}`, req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });
                server!.post(`${base}/actions/:object/:action/:recordId`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('POST', `/actions/${req.params.object}/${req.params.action}/${req.params.recordId}`, req.body, req.query, { request: req });
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
                        positions: [],
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
                    if (mountRouteOnServer(route, server, toScopedPath(routePath), securityHeaders, resolveRequestUser, requireAuth)) count++;
                } else {
                    if (mountRouteOnServer(route, server, routePath, securityHeaders, resolveRequestUser, requireAuth)) count++;
                    if (enableProjectScoping) {
                        if (mountRouteOnServer(route, server, toScopedPath(routePath), securityHeaders, resolveRequestUser, requireAuth)) count++;
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
