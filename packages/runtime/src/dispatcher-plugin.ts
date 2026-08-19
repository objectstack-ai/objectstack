// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext, IHttpServer, ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS } from '@objectstack/core';
import { looksLikeInternalErrorLeak, declaresServerFault, INTERNAL_ERROR_MESSAGE, resolveThrownHttpError, demotedDeclaredCode } from '@objectstack/types';
import { DispatcherErrorCode } from '@objectstack/spec/api';
import type { IAuthService, IMetadataService } from '@objectstack/spec/contracts';
import type { CounterStore } from '@objectstack/plugin-auth/rate-limit-storage';
import { HttpDispatcher, HttpDispatcherResult, type HttpProtocolContext } from './http-dispatcher.js';
import { isServiceServeable } from './service-serveable.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from './validation-failure.js';
import { buildApiError } from './error-envelope.js';
import { appEndpointMountPrefix, isAppEndpointPath, runAppEndpointStep } from './api-endpoint-step.js';
import { callData } from './action-execution.js';
import { createEndpointRateLimiterRegistry } from './endpoint-policy.js';
import {
    buildSecurityHeaders,
    createInboundRateLimitMiddleware,
    type InboundRateLimitBudget,
    type SecurityHeadersOptions,
} from './security/index.js';
import { resolveSessionData, resolveSessionPrincipalId } from './security/resolve-session-principal.js';
import { buildActorUser } from './security/actor-user.js';
import {
    NoopMetricsRegistry,
    NoopErrorReporter,
    instrumentRouteHandler,
    armHttpRequestCounter,
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

    /**
     * Inbound rate limiting, forwarded from the stack's authored
     * `server:` block by `objectstack serve` (#4910).
     *
     * This field is the one `security/rate-limit.ts` used to name in the
     * present tense while it did not exist (#4937) — it exists now, and it is
     * the only way the limiter is armed: omit it, or leave
     * `budget.enabled` false, and no middleware is registered at all
     * (zero per-request cost, not a disabled check).
     *
     * When armed, the plugin installs the limiter as GLOBAL middleware on the
     * `http.server` service. Global is load-bearing:
     * `server.security.rateLimit` is a SERVER-level budget, and a limiter
     * covering only this plugin's own routes while `/data` ran unmetered would
     * be the same declared-≠-enforced half-truth the key was introduced to end.
     *
     * It goes in `start()` rather than `init()` so that "this kernel has no
     * `http.server`" is a settled fact when it is reported, not a Phase-1 guess
     * a later-initializing transport could contradict (#4771). That is only safe
     * because the transport mounts the middleware SEAM at the end of its own
     * `init()` — a `use()` at any later point still gates every route, so the
     * gate does not have to win a race with route registration to be complete.
     *
     * Endpoint-level `ApiEndpointSchema.rateLimit` is NOT read here. It remains
     * KNOWN-UNWIRED and is now tracked by #5040, the endpoint-executor build.
     * (`ApiEndpointRegistrationSchema.rateLimit`, the second spelling this note
     * used to name, no longer exists — that whole registry family was retired
     * in #4939.) #4936 settled the fate this note called undecided: the
     * `ApiEndpoint` vocabulary is KEPT, a non-empty `apis:` is rejected at
     * publish/validate until the executor exists, and every endpoint-level key
     * — this one included — gets wired there, reusing the server-level seam
     * below as its pattern.
     */
    rateLimit?: {
        /** The authored `server.security.rateLimit` budget. */
        budget?: InboundRateLimitBudget;
        /** The authored `server.trustProxy`. */
        trustProxy?: boolean;
    };
}

/**
 * `ctx.getService(name)` without the throw.
 *
 * The kernel's accessor raises for an unregistered name, and every consumer
 * here treats absence as a legitimate composition ("no auth in this stack", "no
 * cache service yet"). Spelled once so no branch quietly turns a missing
 * OPTIONAL service into a boot failure.
 */
function safeGetService<T>(ctx: PluginContext, name: string): T | undefined {
    try {
        return ctx.getService<T>(name) ?? undefined;
    } catch {
        return undefined;
    }
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
            // `GET /ai/status`) and got adapter/model config back. [#3963] The
            // gate is unconditional now — the deployment-wide `requireAuth`
            // opt-out is retired, so only a route declaring `auth: false` opens
            // itself, and it does so by declaration.
            if (route.auth !== false && !user) {
                res.status(ANONYMOUS_DENY_STATUS);
                if (securityHeaders) {
                    for (const [k, v] of Object.entries(securityHeaders)) res.header(k, v);
                }
                // [#9823] The shared flat deny body from @objectstack/core —
                // this used to be an inline `{ error, message }` copy, which is
                // exactly why #9487's additive `code` key never reached it.
                // Writing the constant keeps this seam from drifting again;
                // the wrapper question (flat vs nested, ADR-0112 D5) is not
                // settled here.
                res.json(ANONYMOUS_DENY_BODY);
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
                    // [#9936] Buffered fallback — the IHttpResponse contract's
                    // own prescription (#3607, ADR-0076 OQ#10; the JSDoc on
                    // `write` in packages/spec/src/contracts/http-server.ts):
                    // a transport that omits the OPTIONAL `write`/`end`
                    // streaming surface receives the SAME SSE bytes, buffered
                    // and delivered through `send()` under the streaming
                    // headers already set above. A caller that asked for a
                    // stream parses this body with the same `data:`-line
                    // reader, frame for frame — the encoding ternary below is
                    // deliberately identical to the streamed branch's.
                    //
                    // This used to answer a bare `res.json({ events })`: a
                    // JSON dialect of the same frames that no SSE reader could
                    // decode (both shipped readers split raw bytes on
                    // newlines, and a JSON body contains none), off
                    // BaseResponseSchema besides. No shipped transport lacks
                    // `write`/`end`, so this branch is live only for an
                    // external `Runtime({ server })` transport — exactly the
                    // composition the contract note anticipates.
                    let buffered = '';
                    for await (const event of result.events) {
                        buffered += typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`;
                    }
                    res.send(buffered);
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
            if (isStream) {
                // [#9961] Buffered fallback for a transport whose `res` cannot
                // stream — the same #3607 / ADR-0076 OQ#10 contract
                // prescription the route-wrapper branch applies (see
                // `mountRouteOnServer`): drain the descriptor's AsyncIterable
                // and deliver the identical SSE bytes through `send()` under
                // the streaming headers. Frame encoding, the `null` skip and
                // the trailing `event: error` frame all mirror the streamed
                // branch above so the buffered body is byte-identical to what
                // a streaming transport would have received.
                //
                // This used to fall through to `res.json(result.result)`,
                // which serialized the descriptor itself: `JSON.stringify`
                // collapses the `events` AsyncIterable to `{}`, so the caller
                // got HTTP 200 with the payload gone and the iterable was
                // never drained — silent total event loss.
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
                // Drained in the same detached shape as the streaming path —
                // this function is synchronous by signature, and the response
                // is delivered when the iterable settles.
                (async () => {
                    let buffered = '';
                    try {
                        for await (const event of r.events as AsyncIterable<unknown>) {
                            if (event == null) continue;
                            buffered += typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`;
                        }
                    } catch (streamErr) {
                        buffered += `event: error\ndata: ${JSON.stringify({ message: streamErr instanceof Error ? streamErr.message : String(streamErr) })}\n\n`;
                    } finally {
                        try { res.send(buffered); } catch { /* connection already gone */ }
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
 * `/packages`, `/i18n`, `/automation`, `/auth`, `/notifications`,
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
 *
 * [#5811] A fourth, and the reason (2)'s "shared predicate" is now two of them.
 * `looksLikeInternalErrorLeak` is a heuristic over SQL/driver PHRASING, so it
 * closes this exit only against faults that *sound* like a driver. It never saw
 * `service-analytics`' fail-closed read-scope refusals — measured, all eleven
 * shapes return FALSE — and those messages name the field names and comparands of
 * the RLS POLICY the tenant is being filtered by:
 *
 * ```
 * ⚠️ PAST TENSE — the leak this entry CLOSED, not what this exit answers today.
 *    For the current body see the corrected shape at the end of this block.
 * POST /analytics/query      (tenant caller, object with a broken sharing rule)
 * → 500 {"success":false,"error":{"message":"[read-scope-sql] unsafe field
 *        identifier \"secret_policy_field\" — refusing to build read scope
 *        (fail-closed).","code":"READ_SCOPE_COMPILE_FAILED"}}
 * ```
 *
 * The sibling face — `/analytics/dataset/query` in `@objectstack/rest` — closed
 * this in #5367/#5808 by keying on the DECLARATION rather than the prose, but the
 * rule was written in-line there because one consumer does not justify a shared
 * surface. This exit is the second consumer, so it was promoted:
 * {@link declaresServerFault}, next to the heuristic it complements, read by both
 * boundaries. ⛔ It is NOT "withhold every 5xx" — #5667 kept UNDECLARED 5xx
 * legible on purpose, and a bare `Error` still goes through the heuristic alone.
 *
 * The code still travels, and `READ_SCOPE_COMPILE_FAILED` reaches the client
 * untouched — so what a machine reads is unchanged and only the prose is withheld,
 * into `errorReporter` and the log.
 *
 * ⚠️ It reaches the client at `error.code` — NOT `error.details.code`, which is
 * where this note pointed until #6270 corrected it (#6123 corrected the same
 * sentence at three sibling sites). The `details` assembly below (#3842) only
 * STAGES the code in a local object; `buildApiError` then runs
 * `splitSemanticCode` (`./error-envelope.ts`), which PROMOTES it into the declared
 * `ApiErrorSchema` field and returns the now-empty `details` as `undefined` — so
 * the key is omitted from the body and `error.details.code` is never present to
 * read. Do not mistake the local variable name for the wire contract. The measured
 * 500 body is exactly:
 *
 * ```json
 * {"success":false,"error":{"code":"READ_SCOPE_COMPILE_FAILED",
 *  "message":"Internal server error","httpStatus":500}}
 * ```
 *
 * Pinned end-to-end in `analytics-query-read-scope-withhold.test.ts`, which
 * asserts the code at `error.code` against a real `AnalyticsService` on a real
 * mounted route.
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
    // [#5811] Two independent reasons to withhold, both 5xx-only. The
    // declaration comes first because it needs no guess about the text:
    // `declaresServerFault` already implies `status >= 500`, so it can never
    // reach a 4xx answer the caller is entitled to read.
    const message =
        declaresServerFault(err) || (httpStatus >= 500 && looksLikeInternalErrorLeak(raw))
            ? INTERNAL_ERROR_MESSAGE
            : raw || 'Internal Server Error';
    // [#3842] A thrown error's own `.code` finally has somewhere to go — the
    // declared field, so the same SDK method reports the same code whichever
    // exit answered. [#9106] WHICH spelling goes there is the shared resolver's
    // answer, not this exit's: `error.code` is a closed vocabulary at every
    // door (maintainer ruling 2026-08-16), so the resolver's narrowed `code` is
    // passed explicitly — for a registered code that IS the producer's own
    // spelling, for a validation shape it is `VALIDATION_FAILED`, exactly the
    // answers this exit's details-promotion used to produce — and an
    // unregistered spelling rides the wire's `declaredCode` sibling instead
    // (presence means demotion; the tenant-authored limb #9106 measured). The
    // resolver's status chain is byte-identical to `httpStatus` above (status →
    // statusCode → validation 400 → 500), so the two reads cannot disagree. A
    // non-string `.code` (a driver errno) stays in `details`, as context.
    const thrown = resolveThrownHttpError(err, 500);
    const declaredCode = demotedDeclaredCode(thrown);
    const details =
        (err?.code && typeof err.code !== 'string') || validation
            ? { ...(err?.code && typeof err.code !== 'string' ? { code: err.code } : {}), ...(validation ?? {}) }
            : undefined;
    res.json({
        success: false,
        error: buildApiError({
            message,
            httpStatus,
            code: thrown.code,
            details,
            ...(declaredCode !== undefined ? { extra: { declaredCode } } : {}),
        }),
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
 *   - /automation (CRUD + triggers + runs)
 *
 * NOT /storage — `@objectstack/service-storage` owns that surface and mounts
 * it on this same http-server (#4087).
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
            // Consumer-only plugin — no services registered.
        },

        start: async (ctx: PluginContext) => {
            let server: IHttpServer | undefined;
            try {
                server = ctx.getService<IHttpServer>('http.server');
            } catch {
                // No HTTP server available — skip silently
                server = undefined;
            }

            // ── Inbound rate limit (#4910) ──────────────────────────────
            // Installed in `start()`, deliberately. Phase 1 is over, so "no
            // `http.server`" is a FACT rather than a mid-boot guess a later
            // plugin could contradict — the #4771 class of defect, which is
            // exactly what makes the warning below safe to emit. The gate still
            // precedes every route because the transport mounts the middleware
            // SEAM at the end of its own `init()`; `use()` appends to a chain
            // that seam reads per request, so registration order stops mattering
            // (see `HonoHttpServer.installMiddlewareSeam`).
            const rateLimitMiddleware = createInboundRateLimitMiddleware({
                ...(config.rateLimit?.budget ? { budget: config.rateLimit.budget } : {}),
                trustProxy: config.rateLimit?.trustProxy === true,
                resolvePrincipalId: (headers) =>
                    resolveSessionPrincipalId(
                        safeGetService<IAuthService>(ctx, 'auth'),
                        headers as Record<string, unknown>,
                    ),
                resolveCache: async () => safeGetService<CounterStore>(ctx, 'cache'),
                logger: ctx.logger,
            });
            // `null` = no budget declared, or declared disabled. Nothing is
            // registered at all, so an unmetered deployment pays zero
            // per-request cost — not a disabled check, no check.
            if (rateLimitMiddleware) {
                if (server) {
                    server.use(rateLimitMiddleware);
                    const budget = config.rateLimit?.budget;
                    ctx.logger.info('Inbound rate limit armed', {
                        maxRequests: budget?.maxRequests ?? 100,
                        windowMs: budget?.windowMs ?? 60_000,
                        // NOT `key:` — the logger redacts that field name, and
                        // `key: ***REDACTED***` tells an operator nothing about
                        // what the limit is actually keyed on.
                        keyedBy: 'principal, falling back to caller IP',
                        trustProxy: config.rateLimit?.trustProxy === true,
                    });
                } else {
                    // Absence must be loud (route-ownership rule 3): a stack
                    // that ASKED to be rate limited and is not must never find
                    // out from a load test.
                    ctx.logger.warn(
                        '[dispatcher] `server.security.rateLimit` is enabled but this kernel has no `http.server` '
                        + 'service, so no request can be metered. Mount a transport plugin (e.g. '
                        + '@objectstack/plugin-hono-server), or remove the rate-limit declaration.',
                    );
                }
            }

            if (!server) return;

            const kernel = ctx.getKernel();
            // Default: enable membership enforcement iff environment-scoping is on.
            // Tests / single-tenant deploys can opt out via the explicit flag.
            const enforceMembership =
                config.enforceProjectMembership ?? (config.scoping?.enableProjectScoping ?? false);
            // [#3963] Anonymous callers are denied unconditionally on every
            // surface that reaches object data — the deployment-wide opt-out is
            // retired, so there is nothing to resolve or warn about here. The
            // dispatcher gates the same data as REST through sibling surfaces
            // (`/ai`, the `/meta` catch-all, service routes), and by-surface
            // consistency is exactly what #2567 established.
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
            // ── `http_requests_total` on the transport seam (#9835) ────
            // A transport implementing `IHttpServer.afterResponse` OWNS the
            // request counter for every inbound request on it (the 2026-08-18
            // ruling on #9650 put the counter at the transport; the contract
            // JSDoc records the ownership rule). Two consequences here, both
            // feature-detected runtime-real per the contract:
            //
            //  1. When the host wired a registry to THIS plugin, offer it to
            //     the transport seam. `armHttpRequestCounter` latches
            //     per-server, first caller wins — a transport plugin that
            //     already armed its own registry in Phase 1 keeps ownership
            //     and this call is a no-op, so one registry handed to both
            //     layers (the ordinary wiring) can never double-count. A host
            //     that wired ONLY the dispatcher — the wiring the docs
            //     demonstrate — now gets every inbound surface counted, not
            //     just the dispatcher's own routes.
            //  2. The per-route wrapper below stops emitting its copy of the
            //     counter (`emitHttpRequestsTotal: false`): the seam already
            //     counts these routes, and the duplicate would land on the
            //     same series under the same labels — the measured #9833
            //     distortion, counting ONLY the dispatcher's routes twice.
            //
            // On a transport WITHOUT the seam both revert to the legacy
            // behavior: the wrapper counts the dispatcher's own routes, and
            // (documented expectation, #9650 ruling) every other surface on
            // that transport reports no HTTP metrics — zero there is "not
            // instrumented", never "no traffic".
            const transportCountsRequests =
                typeof (rawServer as IHttpServer).afterResponse === 'function';
            if (transportCountsRequests && config.observability?.metrics) {
                armHttpRequestCounter(rawServer as IHttpServer, config.observability.metrics);
            }
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
                                    emitHttpRequestsTotal: !transportCountsRequests,
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
                // Enveloped (`{ success: true, data }`) under the #9436 maintainer
                // ruling (2026-08-18, option A), inherited by #9813 — machine-read
                // discovery bodies are the envelope's core constituency and the
                // migration is one additive key. Deliberately NOT #9389's pre-auth
                // exemption: that is a closed list of SPA-read surfaces, and this
                // body is read by SDKs (`connect()`'s fallback probe), codegen and
                // AI clients. Every measured reader tolerates the added key.
                res.json({ success: true, data: await dispatcher.getDiscoveryInfo(prefix) });
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
                    // (mutable runtime config; cloud#152 stale `routes.mcp`), and the
                    // body is enveloped under the same #9436 ruling (via #9813).
                    res.header('Cache-Control', 'no-store');
                    res.json({ success: true, data: await dispatcher.getDiscoveryInfo(prefix) });
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

            // ── Auth: DELIBERATELY NOT MOUNTED ──────────────────────────
            // The /auth/* wildcard is mounted by AuthProxyPlugin (cloud) or
            // AuthPlugin (single-tenant) directly on the raw Hono app —
            // those handlers can return native Web `Response` objects which
            // is what better-auth produces. The dispatcher cannot represent
            // a streaming Response cleanly through `IHttpServer.send`, so
            // this plugin registers NO auth route at all.
            //
            // [#5085] It used to register exactly one — a "legacy explicit
            // `POST ${prefix}/auth/login` retained for self-hosted clients"
            // — and that single mount was the only producer in this repo that
            // handed better-auth a NON-Fetch request. `IHttpServer` gives a
            // handler the adapter's internal `IHttpRequest`, whose `headers`
            // is a PLAIN OBJECT (`HonoHttpServer.runHandler` builds it from
            // `c.req.header()`); `handleAuthRequest` forwards
            // `context.request` whole to `IAuthService.handleRequest(request:
            // Request)`, and better-auth's fetch-style handler opens with
            // `request.headers.get(…)`. Measured on a real showcase boot:
            // `POST /api/v1/auth/login` → HTTP 500 with the raw
            // `request.headers.get is not a function` in the response body,
            // while `POST /api/v1/auth/sign-in/email` — the same forwarding
            // layer, reached through the raw-app wildcard with `c.req.raw` —
            // answered 200.
            //
            // The route could not work for any caller: `/login` is not a
            // better-auth endpoint (it is absent from `plugin-auth`'s
            // `auth-route-ledger.ts`, and `content/docs/api/
            // plugin-endpoints.mdx` says in as many words "There is no
            // `/auth/login` route"), and `handleAuthRequest` does not route on
            // the sub-path at all (#4113) — so the ONLY thing this mount ever
            // added over the wildcard was a 500 where the wildcard yields
            // better-auth's own clean 404. Converting the internal request
            // into a Fetch `Request` here would be the consumer-side
            // accommodation Prime Directive #12 rejects, and would buy nothing
            // but a more expensive 404. So it is deleted, and every unknown
            // auth sub-path now falls to the namespace owner exactly like
            // every other one.

            // ── Analytics ───────────────────────────────────────────────
            // [#3891 follow-through / ADR-0076 D11] The /analytics wire
            // surface exists only when the capability does. Phase-1 init has
            // completed by the time this start() runs, so in single-kernel
            // mode "is the `analytics` service registered" is authoritative:
            // absent ⇒ the routes are NOT mounted and the path answers the
            // adapter's shared not-found contract — no route-table entry, no
            // 405 Allow hint for an API that isn't there. A multi-tenant host
            // (kernel-resolver wired) mounts unconditionally: mounts are
            // host-global while the analytics service lives in the per-project
            // kernel, so presence is a per-request question — answered by the
            // analytics domain's existing `handled:false` → 404.
            //
            // Route via dispatch() (not handleAnalytics directly) so the host
            // dispatcher's project-aware kernel swap runs first — the
            // per-project kernel owns the `analytics` service.
            //
            // [#4000] "Registered" is not the test — `handlerReady` is. A
            // service that self-declares as a stub (ADR-0076 D12) occupies the
            // slot without being the capability, and the domain answers it with
            // the same `handled:false` 404 an empty slot gets; mounting routes
            // that can only 404 would re-advertise a capability that isn't
            // there. Same predicate on both, so the wire surface and the
            // handler can't disagree.
            const analyticsInstalled = dispatcher.isMultiTenantHost() || await (async () => {
                const k: any = kernel;
                try {
                    let svc: unknown;
                    if (k && typeof k.getServiceAsync === 'function') {
                        svc = await k.getServiceAsync('analytics').catch(() => undefined);
                    }
                    if (!svc) svc = k?.getService?.('analytics');
                    return isServiceServeable(svc);
                } catch {
                    return false;
                }
            })();

            if (analyticsInstalled) {
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
            } else {
                ctx.logger?.info?.(
                    '[dispatcher] /analytics not mounted — no `analytics` service is registered ' +
                    '(or the registered one self-declares as a stub). ' +
                    'Install @objectstack/service-analytics to enable the analytics API.',
                );
            }

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
            //
            // [#7649] Mounted for the SAME method set as `/mcp` above rather
            // than GET alone, even though GET is the only method this route
            // SERVES. The domain owns a 405 branch for the rest
            // (`handleMcpSkillRequest`: "Method not allowed — use GET", body
            // built through `buildApiError` per #3842) — but a branch can only
            // answer a mismatch that REACHES the dispatcher. With GET as the
            // sole registration, Hono routed `POST /api/v1/mcp/skill` to
            // `notFound`, where the adapter's `unmatchedResponse()` answered
            // with its own `{error, code, message, method, path, allowed}`
            // shape: a second, non-standard 405 envelope on the wire, and the
            // domain branch dead code on this adapter. Registering the verbs
            // hands the mismatch to the branch that already exists.
            //
            // The method set tracks `/mcp`'s deliberately: `server.get/post/
            // delete` are also the three verbs the observability Proxy above
            // instruments, so a PUT/PATCH mount here would be both wider than
            // the sibling route and silently un-instrumented.
            const mountMcpSkill = (method: 'GET' | 'POST' | 'DELETE') => {
                const register = method === 'GET' ? server.get : method === 'DELETE' ? server.delete : server.post;
                register.call(server, `${prefix}/mcp/skill`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch(method, '/mcp/skill', req.body, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });
            };
            mountMcpSkill('GET');
            mountMcpSkill('POST');
            mountMcpSkill('DELETE');

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
            // Nothing mounted here on purpose (#4087). The dispatcher used to
            // bridge `POST /storage/upload` and `GET /storage/file/:id` to the
            // `file-storage` service, off the contract both ends actually
            // speak: `upload(key, data, options?)` was called as
            // `upload(file, { request })` — a guaranteed TypeError against
            // every implementation in the repo — and the download branch
            // switched on a `{ url | stream | mimeType }` result no
            // implementation has ever returned (`download(key)` resolves a
            // Buffer). What kept that invisible is not that something shadowed
            // these paths — service-storage mounts `/storage/upload/...`, not
            // `/storage/upload`, so both stayed mounted and reachable — but
            // that nothing speaks their dialect: no SDK method, no console
            // call. They were reachable and broken, and the only thing that
            // ever routed a request to them was a reader of the old docs.
            //
            // `/api/v1/storage` is service-storage's surface: it registers the
            // presigned / chunked / signed-URL protocol on this same
            // http-server (`storage-routes.ts`), and that protocol is what
            // `@objectstack/client` speaks. Without that package the path
            // simply has no handler — the honest answer, and the one an empty
            // capability slot gives everywhere else.

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

                // [#7526] `/actions`, `/connectors`, `/_status` — REGISTERED
                // BEFORE `/automation/:name`, which is the whole point.
                //
                // `domains/automation.ts` has always ordered these three ahead
                // of its `/:name → getFlow` catch-all, and its module doc says
                // in as many words that the order is load-bearing. That care
                // was spent inside `dispatch()`, on a path no request took:
                // this bridge is the only thing that mounts `/automation`, and
                // it mounted `/:name` and never these — so `GET
                // /api/v1/automation/actions` resolved to `getFlow('actions')`
                // and answered a flow-not-found where the ledger promises the
                // action-descriptor palette. Found by the live-mount parity
                // gate this issue added, as three more instances of the class
                // it was built for.
                server!.get(`${base}/automation/actions`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('GET', '/automation/actions', undefined, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.get(`${base}/automation/connectors`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('GET', '/automation/connectors', undefined, req.query, { request: req });
                        sendResult(result, res);
                    } catch (err: any) {
                        errorResponse(err, res);
                    }
                });

                server!.get(`${base}/automation/_status`, async (req: any, res: any) => {
                    try {
                        const result = await dispatcher.dispatch('GET', '/automation/_status', undefined, req.query, { request: req });
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

            // ── Declarative endpoint mount seam (#5040 E3) ───────────────
            // The ONE path by which a metadata-declared `apis:` endpoint can
            // ever reach a handler. It is installed as the server's LAST-RESORT
            // handler, not as a `${prefix}/apps/*` wildcard route, and the
            // difference is structural rather than stylistic: a wildcard route
            // competes with every route registered after it and Hono resolves
            // that by first-registration-wins across plugin `start()` order —
            // the exact ADR-0076 D11 hazard. A fallback runs only once every
            // explicitly registered route has missed, so it CANNOT shadow one,
            // whatever order the plugins started in.
            //
            // Feature-detected: the member is optional on `IHttpServer`, and an
            // adapter that cannot express a not-found hook simply omits it (see
            // the contract in `@objectstack/spec/contracts`). Installed on the
            // RAW server rather than the observability Proxy above, which wraps
            // route registration only.
            //
            // A miss writes NOTHING. That is load-bearing: the transport's
            // existing unmatched answer (404, or 405 + `Allow` for a method
            // mismatch) then stands unchanged, so this seam costs today's
            // callers nothing. Folding those bare 404s into the dispatcher's
            // semantic `ROUTE_NOT_FOUND` envelope is a separate decision and
            // deliberately NOT taken here (#5090).
            if (typeof rawServer.setFallbackHandler === 'function') {
                // ── The endpoint rate-limit registry: built ONCE ─────────────
                // Per-endpoint token buckets over one shared counter store.
                // Building it per request would rebuild the lazy store handle
                // every time, which re-emits the "no shared cache, so the
                // effective limit is budget × nodes" warning on every request AND
                // throws away the bucket cache the limiter keys its budget on —
                // an endpoint budget that resets on every call is not a budget.
                // Same `resolveCache` the server-level limiter uses, so one
                // deployment has one counter backend, not two.
                const endpointLimiters = createEndpointRateLimiterRegistry({
                    resolveCache: async () => safeGetService<CounterStore>(ctx, 'cache'),
                    logger: ctx.logger,
                });

                rawServer.setFallbackHandler(async (req: any, res: any) => {
                    try {
                        const path: string = req.path ?? '';
                        // ── Scoping test FIRST, before any resolution ────────
                        // Everything below costs something (a kernel resolve, a
                        // session lookup), and an unmatched request that is not
                        // under the endpoint carve-out must keep costing exactly
                        // what it costs today: nothing. The same predicate the
                        // step itself applies — spelled once, in the step.
                        if (!isAppEndpointPath(path, prefix)) return;

                        // ── Per-request environment + identity ───────────────
                        // The SAME resolution `dispatch()` performs, through the
                        // same method (#5040 E5b). It must run BEFORE the match:
                        // on a multi-tenant host `matchEndpoint` has to be asked
                        // on the request's own kernel, or one tenant's
                        // declarations decide another tenant's URLs. It also
                        // yields the `executionContext` / `dataDriver` /
                        // `environmentId` the delegated call needs to run as the
                        // caller instead of as the system principal (#4936).
                        const protocolContext: HttpProtocolContext = { request: req };
                        await dispatcher.resolveRequestScope(protocolContext, path.replace(/\/$/, ''));

                        // A multi-tenant host that could not place this request
                        // in an environment DECLINES — writes nothing, so the
                        // transport's own 404 stands. Serving it from the default
                        // kernel would answer one tenant's URL out of another
                        // tenant's data, which is worse than not answering.
                        if (dispatcher.isMultiTenantHost() && !protocolContext.environmentId) {
                            ctx.logger.warn(
                                '[dispatcher] a declarative-endpoint path reached the fallback on a multi-tenant '
                                + 'host but resolved to no environment; declining rather than serving it from the '
                                + 'default kernel.',
                                { path },
                            );
                            return;
                        }

                        // Both slots are resolved PER REQUEST and never cached:
                        // during `start()` a slot may still be filling, and
                        // recording "absent" as a verdict that outlives the
                        // moment is the #4771 defect class.
                        //
                        // `metadata` is resolved WITH the environment id — the
                        // same lookup `callData` performs for this very request's
                        // ADR-0049 exposure gate. `automation` is resolved
                        // WITHOUT one, which is what `POST /automation/:name/
                        // trigger` does (`domains/automation.ts` reads it off the
                        // request kernel): a declared endpoint must reach the same
                        // occupant the built-in route reaches, or "same operation,
                        // same answer" (#5040 §4) stops being true.
                        // [#5155] Every lookup names the request it belongs
                        // to. `execDeps` is the ONE object the host built at
                        // start(); it cannot know which of the requests in
                        // flight is asking, and on a multi-tenant host guessing
                        // means answering out of another tenant's kernel.
                        const execDeps = dispatcher.actionExecutionDeps;
                        const metadataService = await execDeps
                            .resolveService(protocolContext, 'metadata', protocolContext.environmentId)
                            .catch(() => undefined) as IMetadataService | undefined;
                        const automationService = await execDeps
                            .resolveService(protocolContext, 'automation')
                            .catch(() => undefined);

                        const answer = await runAppEndpointStep({
                            method: req.method,
                            path,
                            prefix,
                            metadataService,
                            policy: {
                                headers: req.headers ?? {},
                                ...(req.remoteAddress ? { remoteAddress: req.remoteAddress } : {}),
                                // The SAME session query the server-level limiter
                                // and the dispatcher's route mounts make (#4910).
                                // Two answers to "who is calling" eventually
                                // disagree about what counts as authenticated.
                                resolvePrincipalId: (headers) =>
                                    resolveSessionPrincipalId(
                                        safeGetService<IAuthService>(ctx, 'auth'),
                                        headers as Record<string, unknown>,
                                    ),
                                limiters: endpointLimiters,
                                // The authored `server.trustProxy`, read from the
                                // same declaration the server-level limiter reads.
                                // A second trust switch is a second answer to
                                // "may I believe X-Forwarded-For".
                                trustProxy: config.rateLimit?.trustProxy === true,
                                logger: ctx.logger,
                            },
                            execution: {
                                request: {
                                    method: req.method,
                                    path,
                                    query: req.query ?? {},
                                    headers: req.headers ?? {},
                                    body: req.body,
                                    ...(req.remoteAddress ? { remoteAddress: req.remoteAddress } : {}),
                                },
                                deps: {
                                    // `callData` with its `deps` bound — the same
                                    // object, and therefore the same pipeline,
                                    // `/data` calls (`domains/data.ts`).
                                    callData: (action, params, driver, scope, ec) =>
                                        callData(execDeps, protocolContext, action, params, driver, scope, ec),
                                    ...(automationService !== undefined ? { automationService } : {}),
                                },
                                ...(protocolContext.executionContext !== undefined
                                    ? { executionContext: protocolContext.executionContext }
                                    : {}),
                                ...(protocolContext.environmentId !== undefined
                                    ? { environmentId: protocolContext.environmentId }
                                    : {}),
                                ...(protocolContext.dataDriver !== undefined
                                    ? { dataDriver: protocolContext.dataDriver }
                                    : {}),
                            },
                        });
                        // `undefined` = no matcher, or no declaration owns it.
                        // Writing nothing is how this handler says "not mine"
                        // (contract on setFallbackHandler).
                        if (!answer) return;
                        res.status(answer.status);
                        if (securityHeaders) {
                            for (const [k, v] of Object.entries(securityHeaders)) res.header(k, v);
                        }
                        // The answer's OWN headers — `Retry-After` on a 429,
                        // `Cache-Control` on a success. Written after the security
                        // headers so an answer-specific value wins, and written at
                        // all because a 429 that loses its `Retry-After` has told
                        // the client nothing it can act on.
                        if (answer.headers) {
                            for (const [k, v] of Object.entries(answer.headers)) res.header(k, v);
                        }
                        res.json(answer.body);
                    } catch (err: any) {
                        // `matchEndpoint` throws when it cannot read its store —
                        // its contract says so explicitly, so that an outage
                        // cannot masquerade as a 404. Answer 5xx like any other
                        // dispatcher exit rather than degrading to not-found.
                        errorResponse(err, res);
                    }
                });
                ctx.logger.info('Declarative endpoint dispatch step armed', {
                    mount: appEndpointMountPrefix(prefix),
                    // True as of #5040 E5b: policy chain + target execution are
                    // wired. And reachable as of the E7 publish flip — a
                    // non-empty `apis:` publishes, so this describes a surface
                    // deployments actually serve.
                    executes: true,
                });
            } else {
                // ── Absence must be loud (AGENTS.md, Route & surface ownership
                // §3) ────────────────────────────────────────────────────────
                // `warn` since #5400. This was `debug`, on a reason that has
                // since expired: it read "no stack can declare an endpoint yet",
                // true only while a non-empty `apis:` was rejected WHOLESALE at
                // publish. The #5040 E7 flip ended that — declarations publish
                // now and stacks ship them — so on an adapter without this seam
                // they are legitimately, permanently unservable. At `debug` that
                // was not a signal at all: the default `level: 'info'` does not
                // print it (`isEnabled`, `packages/core/src/logger.ts`), leaving
                // a bare 404 as the only evidence — precisely the "leave a bare
                // 404 to be diagnosed" outcome the rule names.
                //
                // `warn`, NOT `error`, deliberately. AGENTS.md's "Degradation log
                // levels" question — does the system look normal from outside
                // while something it claims is PERSISTED did not land? — answers
                // no: nothing here claims durability. This is a functional
                // degradation (a capability is not mounted, and the next caller
                // of it finds out), the same shape as the reference text
                // "scheduled flows will not run until a job service is
                // registered". `dispatcher-plugin.fallback-absence-warn.test.ts`
                // welds the level so a quiet slide back to `debug` fails.
                //
                // The line owes both halves the rule demands, and carries them
                // in the first (and only) thing it prints:
                //   consequence — every metadata-declared `apis:` endpoint is
                //     unreachable on this transport, answering a bare 404;
                //   remedy — compose an adapter that implements the seam.
                ctx.logger.warn(
                    '[dispatcher] http.server exposes no `setFallbackHandler`: every metadata-declared '
                    + '`apis:` endpoint is UNREACHABLE on this transport and will answer a bare 404. '
                    + 'Fix: compose an HTTP adapter that implements `setFallbackHandler` '
                    + '(e.g. `@objectstack/plugin-hono-server`).',
                    { mount: appEndpointMountPrefix(prefix), declarativeEndpoints: 'unreachable' },
                );
            }

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
                    // [#4127 batch 4] The KERNEL's `ctx.getService` is a
                    // different, still-untyped surface — typing it is its own
                    // change. Naming the contract in the cast is the point: the
                    // claim being made is the ledger's (`auth` -> IAuthService),
                    // written where a reader can check it, instead of `any`,
                    // which claims the same thing while saying nothing.
                    const authService = ctx.getService('auth') as IAuthService | undefined;
                    if (!authService) return undefined;
                    // [#4910] The session lookup itself lives in
                    // `security/resolve-session-principal.ts` — the inbound rate
                    // limiter asks the same question one kernel phase earlier,
                    // and two copies of "who is calling" would eventually
                    // disagree about what counts as authenticated.
                    const sessionData = await resolveSessionData(authService, headers);
                    const userId: string | undefined = sessionData?.user?.id ?? sessionData?.session?.userId;
                    if (!userId) return undefined;
                    // AI-route req.user permissions (incl. the synthesized `ai_seat`) are
                    // populated from the ExecutionContext by the /ai/* dispatch path
                    // (http-dispatcher → resolveExecutionContext, the single scope-correct
                    // source). This concrete-route resolver returns an empty set.
                    //
                    // [#4705] `systemPermissions` — the CAPABILITY channel
                    // (`manage_metadata`, `studio.access`, …) that domains/ai.ts
                    // now carries across from the ExecutionContext — is spelled
                    // out here as an empty array for the same reason
                    // `permissions` is: this resolver has no ExecutionContext to
                    // read, and inventing a capability source for it would hand
                    // out authority the platform never granted. Written
                    // explicitly rather than omitted so the two producers of an
                    // AI-route `req.user` agree on the SHAPE: a consumer sees
                    // "holds no capabilities", never `undefined`, so it never
                    // needs a `?? []` of its own to tell the two apart.
                    //
                    // Reachability, for the record: these concrete mounts are
                    // shadowed in practice — `registerAIRoutes` mounts the
                    // `${prefix}/ai/*` method-wildcards through
                    // `dispatcher.dispatch()` EARLIER in this same `start()`, so
                    // the ExecutionContext-backed path is the one that answers a
                    // real `/api/v1/ai/...` request.
                    //
                    // [#5372] Built by the shared producer so the two AI-route
                    // `req.user` producers agree on the key set by
                    // CONSTRUCTION rather than by two literals being kept in
                    // sync by hand — that is exactly how the three dispatch
                    // paths drifted. The display name is the session's own
                    // `user.name` (better-auth's projection of `sys_user.name`,
                    // the same authority the ExecutionContext-backed producer
                    // reads), so no extra lookup happens here. Its former
                    // `?? user.email` middle arm is gone: `name === id` now
                    // means "no display name" on EVERY path, and the address
                    // is still served under its own `email` key.
                    return buildActorUser({
                        id: userId,
                        displayName: sessionData?.user?.name,
                        email: sessionData?.user?.email,
                        organizationId: sessionData?.session?.activeOrganizationId,
                    });
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
