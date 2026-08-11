// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Export IHttpServer from core
export * from '@objectstack/core';

import {
    IHttpServer,
    RouteHandler,
    Middleware,
    createLogger,
} from '@objectstack/core';
import type { Logger } from '@objectstack/spec/contracts';
import type { Context } from 'hono';
import { currentPerfTiming } from '@objectstack/observability';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { matchesRoutePattern } from './route-pattern';

/**
 * Request headers allowed on preflight, by default.
 *
 * **The** default — three Hono-based CORS sites apply it (this package's
 * `hono-plugin.ts` and the `@objectstack/hono` adapter, which depends on this
 * package), and they used to each carry their own copy under "keep in sync"
 * comments. The copies happened to agree; the TSDoc on {@link
 * HonoCorsOptions.allowHeaders} did not — it had been three headers behind for
 * long enough to predate multi-tenant routing, so the one description a caller
 * actually reads was the one that drifted (#3786).
 *
 * `X-Tenant-ID` / `X-Environment-Id` route a request to its environment.
 * `If-Match` carries the OCC token on record PATCHes (objectui's inline edit,
 * REST `update` with `ifMatch`) — without it in the preflight allow-list every
 * cross-origin save fails in the browser with "Failed to fetch" (objectui#2572).
 */
export const DEFAULT_CORS_ALLOW_HEADERS: readonly string[] = Object.freeze([
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Tenant-ID',
    'X-Environment-Id',
    'If-Match',
]);

/**
 * Response headers exposed to cross-origin JS, by default. Same three sites,
 * same reason as {@link DEFAULT_CORS_ALLOW_HEADERS}.
 *
 * `set-auth-token` lets better-auth's `bearer()` plugin hand rotated session
 * tokens to cross-origin clients (see plugin-auth). `x-objectstack-dropped-fields`
 * (#3455) exposes the single-write drop warning (#3431); the body `droppedFields`
 * channel remains the primary, cross-origin-safe surface.
 */
export const DEFAULT_CORS_EXPOSE_HEADERS: readonly string[] = Object.freeze([
    'set-auth-token',
    'x-objectstack-dropped-fields',
]);

export interface HonoCorsOptions {
    enabled?: boolean;
    origins?: string | string[];
    methods?: string[];
    /**
     * Request headers allowed on preflight (`Access-Control-Allow-Headers`).
     *
     * Defaults to {@link DEFAULT_CORS_ALLOW_HEADERS} — deliberately a link and
     * not a restatement. Supplying this REPLACES the default rather than
     * extending it, so spread the constant if you only mean to add:
     * `allowHeaders: [...DEFAULT_CORS_ALLOW_HEADERS, 'X-My-Header']`.
     */
    allowHeaders?: string[];
    /**
     * Response headers exposed to JS (`Access-Control-Expose-Headers`).
     *
     * Defaults to {@link DEFAULT_CORS_EXPOSE_HEADERS}. Unlike `allowHeaders`,
     * user-supplied values are MERGED with the default — those are always
     * exposed unless CORS is disabled entirely.
     */
    exposeHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
}

/**
 * The transport's peer address for a Hono context, when the runtime exposes one.
 *
 * `@hono/node-server` puts the Node `IncomingMessage` on `c.env.incoming`, so
 * the socket's `remoteAddress` is reachable without adding a dependency on
 * `hono/conninfo` (which resolves differently per runtime). Every access is
 * guarded: on a runtime that exposes nothing, callers get `undefined` and must
 * degrade deliberately rather than key security decisions off a fabricated
 * value.
 */
function readRemoteAddress(c: any): string | undefined {
    try {
        const incoming = c?.env?.incoming;
        const address = incoming?.socket?.remoteAddress ?? incoming?.connection?.remoteAddress;
        return typeof address === 'string' && address.length > 0 ? address : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Any thrown value, as a real `Error` whose `message` and `stack` survive
 * structured logging.
 *
 * ## The trap this exists for
 *
 * `Error.prototype.message` and `.stack` are **non-enumerable**. A rejection
 * handed straight to a structured logger's *meta* slot — `{ err }`,
 * `{ ...err }`, `JSON.stringify(err)` — therefore serializes to `{}`: the
 * record is emitted, the reader sees a log line, and the one thing they needed
 * is not in it. That is strictly worse than no log at all, because it reports
 * success. (cloud's `objectos-runtime/src/safe-log.ts` header documents the
 * same hazard from the other side of the wire.)
 *
 * The `Logger` contract's `error(message, error?: Error, meta?)` has a
 * dedicated `Error` slot precisely so implementations can lift those two
 * fields out by name, and all three in-repo implementations do
 * (`ObjectLogger`, `ConsoleLogger`, `JsonLogger`). So the adapter's job is
 * only to make sure what reaches that slot really is an `Error`:
 *
 *  - a genuine `Error` passes through untouched — original stack preserved;
 *  - an **error-like** object that fails `instanceof` (a cross-realm `Error`
 *    from a `vm` context or a worker, the shape a bare spread would flatten to
 *    `{}`) is rebuilt, carrying its own `name`/`message`/`stack` across;
 *  - anything else (`throw 'boom'`, `throw { code: 1 }`, `throw undefined`) is
 *    described in the message rather than dropped, and labelled as a non-Error
 *    throw so the synthesized stack is not mistaken for the thrower's.
 */
function toLoggableError(thrown: unknown): Error {
    if (thrown instanceof Error) return thrown;

    if (thrown !== null && typeof thrown === 'object') {
        const like = thrown as { name?: unknown; message?: unknown; stack?: unknown };
        if (typeof like.message === 'string') {
            const rebuilt = new Error(like.message);
            if (typeof like.name === 'string') rebuilt.name = like.name;
            if (typeof like.stack === 'string') rebuilt.stack = like.stack;
            return rebuilt;
        }
    }

    let described: string;
    try {
        described = typeof thrown === 'string' ? thrown : JSON.stringify(thrown) ?? String(thrown);
    } catch {
        // Circular / throwing `toJSON` — `String()` still yields something.
        described = String(thrown);
    }
    return new Error(`Non-Error value thrown: ${described}`);
}

/**
 * The matched route's path parameters, or `{}` when there is no matched route.
 *
 * `c.req.param()` reads the router's match result, and in the `notFound` hook
 * there ISN'T one — Hono throws `Cannot read properties of undefined` rather
 * than returning empty (verified against hono 4.12, `HonoRequest.param` →
 * `#getAllDecodedParams`). The fallback seam (#5090) runs handlers in exactly
 * that context, so the read is guarded here rather than at one call site: an
 * unmatched request HAS no path params, which is `{}`, not a crash.
 */
function readRouteParams(c: any): Record<string, string> {
    try {
        return c?.req?.param?.() ?? {};
    } catch {
        return {};
    }
}

/**
 * The request's query parameters, with a REPEATED key surfacing as an array
 * and a single-valued key as a plain string (#6878, route 2).
 *
 * `c.req.query()` — what both construction sites used before — returns only the
 * FIRST value per key, so `?version=1.0.0&version=2.0.0` reached a handler as
 * `'1.0.0'` and the ambiguity was gone before anyone could refuse it. The
 * reference `NodeHttpServer` in `packages/qa/http-conformance` never collapsed:
 * it reads `url.searchParams.getAll(key)` and keeps the array. One request
 * therefore had two answers depending on which server booted, which is what
 * #6878 measured and what the cli-lane seat ruled (2026-08-10) to resolve in
 * this direction — the handler must be able to SEE the ambiguity in order to
 * reject it, per #6307's landed `readSingleQueryValue` direction.
 *
 * ⚠️ The normalisation is NOT optional. `c.req.queries()` returns an array for
 * EVERY key, single-valued ones included (measured on hono@4.12.x:
 * `{ version: ['1.0.0','2.0.0'], single: ['9'] }`), so a bare swap would have
 * silently turned every existing single-value read point on this adapter into
 * an array. PR #6941 left a control case in
 * `packages/qa/http-conformance/src/query-multiplicity.conformance.test.ts`
 * that fails on exactly that mistake — keep it green.
 *
 * Built with `Object.fromEntries` rather than dynamic property writes
 * (`obj[key] = …`): the keys come straight off the wire, and `?__proto__=…`
 * through a dynamic write is remote property injection. `fromEntries` creates
 * own data properties only. Same reasoning, same shape, as the reference
 * adapter's query block.
 */
function readQuery(c: any): Record<string, string | string[]> {
    const all: Record<string, string[]> = c.req.queries() ?? {};
    return Object.fromEntries(
        Object.entries(all).map(([key, values]) => [
            key,
            values.length > 1 ? values : values[0],
        ]),
    ) as Record<string, string | string[]>;
}

/**
 * Hono Implementation of IHttpServer
 */
export class HonoHttpServer implements IHttpServer {
    private app: Hono;
    private server: any;
    private listeningPort: number | undefined;
    /**
     * Every `(method, pattern)` pair registered through this server, kept so
     * the `notFound` handler can answer "the path exists but the method is
     * wrong" with a `405` + `Allow` instead of an opaque `404`. Populated by
     * the verb methods below; static/SPA catch-alls registered straight on the
     * raw Hono app are intentionally NOT tracked, so they never produce a 405.
     */
    private registeredRoutes: Array<{ method: string; pattern: string }> = [];
    /** Registered {@link Middleware}s, in registration order. See `use()`. */
    private middlewares: Array<{ path?: string; handler: Middleware }> = [];
    /** Whether the Hono middleware that runs {@link middlewares} is mounted. */
    private middlewareSeamInstalled = false;
    /**
     * The LAST-RESORT handler installed by {@link setFallbackHandler}, or
     * `undefined` when no consumer installed one. Exactly one — installing
     * again REPLACES, per the contract.
     */
    private fallbackHandler: RouteHandler | undefined;
    /** Whether the Hono `notFound` hook that runs {@link unmatchedResponse} is mounted. */
    private notFoundSeamInstalled = false;
    /**
     * Where {@link reportHandlerFailure} writes. See {@link setLogger} for why
     * the default is a REAL logger and not a no-op.
     */
    private logger: Logger = createLogger({ name: 'hono' });

    constructor(
        private port: number = 3000,
        private staticRoot?: string,
        /**
         * Max time (ms) to let in-flight requests drain on `close()` before
         * force-closing the remainder. Kept well under the kernel's 60s
         * `shutdownTimeout` so a slow request can't hang the whole shutdown.
         */
        private drainTimeoutMs: number = 10_000,
    ) {
        this.app = new Hono();
    }

    // internal helper to convert standard handler to Hono handler
    private wrap(handler: RouteHandler) {
        return async (c: any) => {
            const { response } = await this.runHandler(c, handler);
            return response ?? c.json({ error: 'No response from handler' }, 500);
        };
    }

    /**
     * Run ONE {@link RouteHandler} against a Hono context and report what it
     * produced: a `Response` when it answered (buffered or streamed), `null`
     * when it wrote nothing, plus whether it threw.
     *
     * ## Why this is its own method (#5090)
     *
     * Two call sites now drive a `RouteHandler`: {@link wrap} (a registered
     * route) and the `notFound` seam ({@link installNotFoundSeam}, for the
     * handler installed by {@link setFallbackHandler}). The contract on
     * `IHttpServer.setFallbackHandler` promises the fallback a FULLY POPULATED
     * `IHttpRequest` — `req.body` included, parsed by content-type exactly as a
     * route handler gets it — and the only way to promise that credibly is for
     * both paths to build the request with the same code. A second, parallel
     * request-builder for the fallback is how the two would drift into
     * disagreeing about, say, `application/octet-stream`.
     *
     * The two callers differ only in what they make of "wrote nothing":
     * a route handler that answers nothing is a bug (500), while a FALLBACK
     * that answers nothing is the documented way to say "not mine" and leaves
     * the adapter's standard unmatched answer in place.
     */
    private async runHandler(
        c: any,
        handler: RouteHandler,
    ): Promise<{ response: Response | null; failed: boolean }> {
        let body: any = {};

        // Ambient per-request timing collector — present only when the
        // Server-Timing / perf-tuning middleware established one for this
        // request. All marks below are no-ops otherwise (zero overhead).
        const _perf = currentPerfTiming();
        const _endParse = _perf?.start('parse', 'Body parse');

        const contentType = c.req.header('content-type') ?? '';
        const isOctetStream = contentType.includes('application/octet-stream');

        // Try to parse JSON body first if content-type is JSON
        if (contentType.includes('application/json')) {
            try {
                body = await c.req.json();
            } catch(e) {
                // If JSON parsing fails, try parseBody
                try {
                    body = await c.req.parseBody();
                } catch(e2) {}
            }
        } else if (!isOctetStream) {
            // For non-JSON / non-binary content types, use parseBody
            // (Skipping for octet-stream so the raw stream stays consumable
            //  via `req.rawBody()` for binary uploads.)
            try {
                body = await c.req.parseBody();
            } catch(e) {}
        }

        _endParse?.();

        const rawHeaders = c.req.header();
        // Fetch API `Request` objects don't expose the `Host` header
        // (it's a forbidden header — derived from the URL by the
        // transport). Hostname-based routing in REST/dispatcher
        // depends on it, so we backfill from `c.req.url`.
        if (!rawHeaders.host) {
            try {
                const u = new URL(c.req.url);
                if (u.host) rawHeaders.host = u.host;
            } catch { /* non-URL request, leave headers as-is */ }
        }

        const req = {
            params: readRouteParams(c),
            query: readQuery(c),
            body,
            headers: rawHeaders,
            method: c.req.method,
            path: c.req.path,
            rawBody: async () => {
                const ab = await c.req.arrayBuffer();
                return Buffer.from(ab);
            },
            /**
             * The transport's own peer address (`IHttpRequest.remoteAddress`)
             * — the unforgeable half of caller identification, never a
             * header. The middleware seam has always populated it; handlers
             * did not, so the one contract had two shapes depending on which
             * seam you entered through. Filled here (#5090) so every
             * `IHttpRequest` this adapter builds carries the same members,
             * which is what lets `setFallbackHandler`'s contract promise a
             * FULLY populated request without qualification. `undefined` on
             * a runtime that exposes no socket — consumers must degrade
             * deliberately, never substitute a header.
             */
            remoteAddress: readRemoteAddress(c),
        };

        let capturedResponse: any;
        let streamController: ReadableStreamDefaultController | null = null;
        let streamEncoder: TextEncoder | null = null;
        let streamHeaders: Record<string, string> = {};
        let isStreaming = false;
        let streamClosed = false;

        // The unused stream is always created (see below) and may be closed
        // from two places — `res.end()` and the post-handler cleanup — so
        // guard against the double-close that crashes the event loop with
        // `ERR_INVALID_STATE: Controller is already closed`.
        const closeStream = () => {
            if (streamController && !streamClosed) {
                streamClosed = true;
                try { streamController.close(); } catch { /* already closed */ }
            }
        };

        const res = {
            json: (data: any) => {
                // `serialize` Server-Timing span — JSON-encoding the body is
                // the one adapter-owned cost between "handler done" and
                // "bytes on the wire". No-op when perf-tuning is off.
                const endSerialize = _perf?.start('serialize', 'Response serialize');
                capturedResponse = c.json(data);
                endSerialize?.();
            },
            send: (data: string | Uint8Array | ArrayBuffer | Buffer) => {
                if (data instanceof Uint8Array || data instanceof ArrayBuffer || (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(data))) {
                    const body = data instanceof ArrayBuffer ? data : (data as Uint8Array).buffer.slice((data as Uint8Array).byteOffset, (data as Uint8Array).byteOffset + (data as Uint8Array).byteLength);
                    capturedResponse = c.body(body as ArrayBuffer);
                } else {
                    capturedResponse = c.html(data as string);
                }
            },
            status: (code: number) => { c.status(code); return res; },
            header: (name: string, value: string) => {
                c.header(name, value);
                streamHeaders[name] = value;
                return res;
            },
            write: (chunk: string | Uint8Array) => {
                isStreaming = true;
                if (streamController && streamEncoder) {
                    const data = typeof chunk === 'string' ? streamEncoder.encode(chunk) : chunk;
                    streamController.enqueue(data);
                }
            },
            end: () => {
                // Body-less response (e.g. 204 No Content) honoring any
                // status already set via `res.status()`. A null body avoids
                // the undici "Invalid response status code 204" thrown when
                // an empty *string* body is paired with a null-body status.
                if (!isStreaming && capturedResponse === undefined) {
                    capturedResponse = c.body(null);
                }
                closeStream();
            },
        };

        // Create a streaming response wrapper — if handler calls res.write(),
        // we return a ReadableStream; otherwise fall back to capturedResponse.
        const streamPromise = new Promise<{ response: Response | null; failed: boolean }>((resolve) => {
            const stream = new ReadableStream({
                start(controller) {
                    streamController = controller;
                    streamEncoder = new TextEncoder();
                },
            });

            // Run the handler; once it's done, check if streaming was used.
            //
            // `Promise.try`-shaped on purpose: invoking the handler inside
            // this executor means a SYNCHRONOUS throw would reject the
            // promise instead of resolving it, while an async rejection
            // lands in `.catch` below — the same failure reported two
            // different ways depending on whether the handler happened to
            // be `async`. That asymmetry was survivable while the only
            // consumer was `wrap` (both ended as a 500, with different
            // bodies); it is not survivable for the `notFound` seam, whose
            // hook MUST return a Response — Hono answers a rejected
            // notFound with its own opaque error page, so a throwing
            // fallback could neither be reported nor declined (#5090).
            const _endHandler = _perf?.start('handler', 'Route handler');
            const done = (async () => handler(req as any, res as any))();
            done.then(() => {
                _endHandler?.();
                if (isStreaming) {
                    resolve({
                        response: new Response(stream, {
                            status: 200,
                            headers: streamHeaders,
                        }),
                        failed: false,
                    });
                } else {
                    // Not streaming — close the unused stream and return null
                    closeStream();
                    resolve({ response: null, failed: false });
                }
            }).catch((err) => {
                _endHandler?.();
                closeStream();
                // The ONE place an escaping throw is reported (#5848). Both
                // callers turn `failed: true` into a 500 that says nothing
                // about the cause — `wrap`'s `No response from handler` and
                // the `notFound` seam's `Fallback handler failed` — so if the
                // diagnosis is not emitted here it does not exist anywhere.
                this.reportHandlerFailure(c, err);
                resolve({ response: null, failed: true });
            });
        });

        const outcome = await streamPromise;
        return {
            response: outcome.response ?? capturedResponse ?? null,
            failed: outcome.failed,
        };
    }

    /**
     * Point this adapter's diagnostics at the host's logger. Called by
     * `HonoServerPlugin.init()` with `ctx.logger`; a host that embeds
     * `HonoHttpServer` directly (cloud's serverless entrypoints, tests) may
     * call it itself, at any time.
     *
     * ## Why the default is a real logger, not a no-op (#5848)
     *
     * The failure this reports is one nobody can see any other way: a throw
     * that escapes a route handler produces a 500 carrying no cause, so a
     * silent default reproduces exactly the bug — bare 5xx, zero log — for
     * every host that forgets to wire this. That is not hypothetical: the
     * production report behind #5848 came from a control plane built on the
     * BARE adapter, i.e. the path that never sees `ctx.logger`, and its only
     * remedy was to re-wrap every route in its own try/catch (cloud#1144) —
     * paying off this seam's debt one route at a time, which is the tax
     * #4264 already described and did not remove.
     *
     * So the default is `createLogger()`: level `info` (an `error` always
     * passes), secrets redacted by field name, and `message`/`stack` lifted
     * out of the `Error` slot by name. Wiring a host logger REPLACES it;
     * silencing is a deliberate act (pass a `NoopLogger`), never the default.
     */
    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Report a throw that escaped a {@link RouteHandler} — the diagnostic exit
     * that did not exist before #5848.
     *
     * Deliberately at `error`, not `warn`: per AGENTS.md "Degradation log
     * levels", the third legal answer — "the failure was handed to the CALLER"
     * — does NOT apply here. What the caller gets is a bare 500 whose body
     * names no cause, no code and no message; they were told that something
     * broke, not what, and nothing downstream can reconstruct it. Nor is this
     * a validation path that could fire once per malformed keystroke: an
     * unhandled throw out of a handler is a server-side defect, and one
     * `error` per occurrence is the correct volume.
     *
     * Method and path only. The request body is NOT logged — it is the most
     * likely place for credentials and PII to sit, and `message` + `stack`
     * already locate the failure in the code.
     */
    private reportHandlerFailure(c: any, thrown: unknown): void {
        try {
            const method = typeof c?.req?.method === 'string' ? c.req.method : undefined;
            const path = typeof c?.req?.path === 'string' ? c.req.path : undefined;
            this.logger.error(
                '[hono] route handler threw — request answered 500 with no cause in the body',
                toLoggableError(thrown),
                { method, path },
            );
        } catch {
            // Reporting the failure must never become a second failure: a
            // host logger that throws (or a partial one missing `error`)
            // would otherwise reject `runHandler`'s own promise and turn a
            // clean 500 into Hono's opaque error page.
        }
    }

    get(path: string, handler: RouteHandler) {
        this.registeredRoutes.push({ method: 'GET', pattern: path });
        this.app.get(path, this.wrap(handler));
    }
    post(path: string, handler: RouteHandler) {
        this.registeredRoutes.push({ method: 'POST', pattern: path });
        this.app.post(path, this.wrap(handler));
    }
    put(path: string, handler: RouteHandler) {
        this.registeredRoutes.push({ method: 'PUT', pattern: path });
        this.app.put(path, this.wrap(handler));
    }
    delete(path: string, handler: RouteHandler) {
        this.registeredRoutes.push({ method: 'DELETE', pattern: path });
        this.app.delete(path, this.wrap(handler));
    }
    patch(path: string, handler: RouteHandler) {
        this.registeredRoutes.push({ method: 'PATCH', pattern: path });
        this.app.patch(path, this.wrap(handler));
    }

    /**
     * The LIVE mount table — every `(method, pattern)` this server registered,
     * in registration order. See `IHttpServer.getMountedRoutes` for the
     * contract; the ordering guarantee is load-bearing and honoured here
     * because {@link registeredRoutes} is appended to inside the verb methods,
     * on the same call that reaches `this.app`.
     *
     * A COPY, not the live array: a consumer of an OBSERVATION must not be able
     * to edit the thing observed.
     */
    getMountedRoutes(): ReadonlyArray<{ method: string; pattern: string }> {
        return this.registeredRoutes.map((r) => ({ ...r }));
    }

    /**
     * Ask the LIVE Hono router which registered route actually answers a
     * concrete request — see `IHttpServer.resolveMountedRoute` for why
     * "is it in the table" is not the same question.
     *
     * Implemented against `app.router.match()`, i.e. the very router object
     * that serves production traffic, so the answer is Hono's own and cannot
     * drift from it. `match()` returns the matched handlers in the order Hono
     * would run them — middleware included — so this walks that list and takes
     * the first entry whose `RouterRoute` corresponds to a route THIS adapter
     * registered. Middleware and the raw-app catch-alls (static / SPA) are
     * absent from {@link registeredRoutes} by construction, so they are skipped
     * rather than mistaken for the answer.
     *
     * `undefined` means the router matched no registered route at all — the
     * request would reach the `notFound` sink (404, or 405 via
     * {@link allowedMethodsForPath}).
     */
    resolveMountedRoute(method: string, path: string): { method: string; pattern: string } | undefined {
        const router: any = (this.app as any)?.router;
        if (!router || typeof router.match !== 'function') return undefined;
        const verb = method.toUpperCase();
        let matched: any;
        try {
            matched = router.match(verb, path);
        } catch {
            // A router that cannot answer is not evidence that nothing is
            // mounted — say "unknown" rather than invent a verdict.
            return undefined;
        }
        const handlers = Array.isArray(matched) ? matched[0] : undefined;
        if (!Array.isArray(handlers)) return undefined;
        for (const entry of handlers) {
            // Each entry is `[[handler, RouterRoute], paramIndexMap]`; the
            // RouterRoute carries the very `path` / `method` strings Hono was
            // registered with.
            const route = Array.isArray(entry) && Array.isArray(entry[0]) ? entry[0][1] : undefined;
            const pattern = typeof route?.path === 'string' ? route.path : undefined;
            const routeMethod = typeof route?.method === 'string' ? route.method.toUpperCase() : undefined;
            if (!pattern || !routeMethod) continue;
            const own = this.registeredRoutes.find(
                (r) => r.pattern === pattern && r.method === routeMethod,
            );
            if (own) return { ...own };
        }
        return undefined;
    }

    /**
     * The HTTP methods registered for a concrete request `path`, ignoring the
     * request's own method. Empty when no registered route matches the path at
     * all (a genuine 404). Used by the `notFound` handler to build a `405`
     * response with an accurate `Allow` header. `HEAD` is implied by `GET`
     * (Hono answers HEAD from GET routes automatically).
     */
    allowedMethodsForPath(path: string): string[] {
        const methods = new Set<string>();
        for (const route of this.registeredRoutes) {
            if (matchesRoutePattern(route.pattern, path)) methods.add(route.method);
        }
        if (methods.has('GET')) methods.add('HEAD');
        return Array.from(methods).sort();
    }

    /**
     * Install the LAST-RESORT handler — see the CONTRACT on
     * `IHttpServer.setFallbackHandler` in `@objectstack/spec/contracts`
     * (#5040 §1-C). This implementation honours it as follows:
     *
     *  1. **Only after every registered route has missed.** It is mounted on
     *     Hono's `app.notFound` hook — NEVER as a `/*` route. Hono runs
     *     `notFound` only when its router matched no handler, so a fallback is
     *     structurally incapable of shadowing a registered route and carries
     *     ZERO registration-order dependency (ADR-0076 D11: one route, one
     *     owner, by construction rather than by convention). Empirically
     *     confirmed against this Hono version in `fallback-seam.test.ts`,
     *     including the case the design flagged as a risk (#5040 §7-1): a
     *     METHOD mismatch on an existing path routes to the same `notFound`
     *     sink, so the fallback sees those too — and declining to answer leaves
     *     the 405 below intact.
     *  2. **`req.body` IS readable.** Nothing consumed the request stream —
     *     no route handler ran — so {@link runHandler} parses it by
     *     content-type exactly as it does for a route. That is the whole
     *     reason this seam exists and `use()` middleware cannot serve: the
     *     middleware contract explicitly does NOT populate `body`.
     *  3. **Replacement, not a chain.** One handler; calling again replaces it.
     *     The Hono hook is mounted once (idempotent) and reads the field per
     *     request, so replacing never re-mounts and can never stack.
     *  4. **A handler that writes nothing leaves the standard answer.** See
     *     {@link unmatchedResponse} — the 404/405 semantics this interface
     *     documents are produced there, after the fallback declines.
     */
    setFallbackHandler(handler: RouteHandler): void {
        this.fallbackHandler = handler;
        this.installNotFoundSeam();
    }

    /**
     * Mount the single Hono `notFound` hook that produces this adapter's
     * unmatched-request answer, running {@link fallbackHandler} first when one
     * is installed. Idempotent.
     *
     * WHY THE ADAPTER OWNS THIS (#5090). The 405/404 answer used to be written
     * by `HonoServerPlugin.start()` calling `getRawApp().notFound(...)` itself.
     * `app.notFound` is LAST-CALL-WINS (verified, not assumed), so with the
     * fallback seam added there would have been two writers of one hook and the
     * survivor would depend on plugin start order — the loser silently losing
     * either the fallback or the 405. One hook, one owner: the plugin now calls
     * this method instead, the two behaviours COMPOSE inside it, and
     * `setFallbackHandler` may be called at any moment, before or after.
     *
     * A bare `HonoHttpServer` (no plugin, e.g. cloud's serverless entrypoints)
     * still gets Hono's own 404 unless it calls this — or installs a fallback,
     * which mounts the seam for it.
     */
    installNotFoundSeam(): void {
        if (this.notFoundSeamInstalled) return;
        const app = this.app as unknown as { notFound?: (h: (c: Context) => unknown) => void };
        // Feature-detected rather than assumed: `getRawApp()` is an escape
        // hatch and a host may hand back something Hono-shaped but not Hono.
        if (typeof app.notFound !== 'function') return;
        this.notFoundSeamInstalled = true;

        app.notFound(async (c: any) => {
            const handler = this.fallbackHandler;
            if (handler) {
                const { response, failed } = await this.runHandler(c, handler);
                if (response) return response;
                if (failed) {
                    // Prefer failing to falling back: a fallback that THREW is
                    // a broken consumer, and reporting its failure as this
                    // adapter's ordinary 404 would hide it behind the most
                    // unremarkable status on the wire.
                    return c.json({ error: 'Fallback handler failed' }, 500);
                }
                // Wrote nothing — the documented way to say "not mine". Fall
                // through to the standard answer, unchanged.
            }
            return this.unmatchedResponse(c);
        });
    }

    /**
     * This adapter's standard answer for a request that matched no route —
     * the `IHttpServer` unmatched-request CONTRACT (#3607 / ADR-0076 OQ#10),
     * validated across adapters by `@objectstack/http-conformance`.
     *
     * Hono routes a method mismatch to the SAME `notFound` sink as a genuinely
     * missing path, so a `POST` to a `PUT`-only route (e.g. the metadata save
     * endpoint, see #2684) would otherwise return an opaque
     * `{ error: 'Not found' }` 404 with no hint that the path exists under
     * another verb. We re-match the request path against the registered route
     * patterns: if it lines up with routes under other methods, answer `405
     * Method Not Allowed` with an accurate `Allow` header so callers can
     * self-correct. A path that matches nothing stays a 404. This is
     * framework-wide — every registered endpoint benefits, not just metadata.
     */
    private unmatchedResponse(c: any) {
        const allowed = this.allowedMethodsForPath(c.req.path);
        if (allowed.length > 0 && !allowed.includes(c.req.method)) {
            c.header('Allow', allowed.join(', '));
            return c.json({
                error: 'Method Not Allowed',
                code: 'METHOD_NOT_ALLOWED',
                message: `${c.req.method} is not supported for ${c.req.path}. Allowed: ${allowed.join(', ')}.`,
                method: c.req.method,
                path: c.req.path,
                allowed,
            }, 405);
        }
        return c.json({ error: 'Not found' }, 404);
    }

    /**
     * Register middleware — see the CONTRACT on `IHttpServer.use` in
     * `@objectstack/spec/contracts`.
     *
     * ## What this used to be, and why it matters (#4910)
     *
     * Until #4910 both branches here handed the middleware `{} as any` for BOTH
     * `req` and `res`, and then ran `if (!nextCalled) await next()` — so a
     * middleware could not read the request, could not write a response, and
     * could not decline to continue. Every registered middleware was, in
     * practice, an `await`ed no-op with a `next()` bolted on. `IHttpServer.use`
     * was a declared seam with no execution behind it: exactly the
     * declared-≠-enforced shape Prime Directive #10 names, one layer below the
     * spec keys #4686 opened on. Nothing production caught it because nothing
     * production called it — the inbound rate limiter is the first consumer, and
     * building it is what surfaced this.
     *
     * ## Semantics now
     *
     * Middlewares run in registration order, before any route handler, and each
     * one either:
     *
     *  - calls `next()` — the chain continues; or
     *  - writes a response (`res.status(...).json(...)` / `.send(...)`) without
     *    calling `next()` — the chain SHORT-CIRCUITS and that response is
     *    returned. This is the branch that makes a 429 (or a 401, or a
     *    maintenance 503) possible at all.
     *
     * A middleware that does neither is treated as pass-through, so an
     * early-return on some condition cannot silently black-hole a request.
     *
     * ## Two deliberate limits, stated so they are not discovered
     *
     *  - **`req.body` is not populated.** Reading the body here would consume
     *    the request stream before the route handler that owns it, so a
     *    middleware sees headers/method/path/query only. Body-dependent policy
     *    belongs in a route handler or a dispatcher gate stage.
     *  - **The seam must be mounted before routes, but `use()` need not be
     *    called before them.** Hono composes the handlers that matched, in
     *    registration order, so a middleware Hono learns about after a route
     *    runs after that route's handler — useless for short-circuiting. This
     *    class therefore mounts ONE Hono middleware (the chain runner) and lets
     *    `use()` append to the chain it reads per request. {@link
     *    installMiddlewareSeam} places that runner; `HonoServerPlugin` calls it
     *    at the end of `init()`, after the transport's own built-ins and before
     *    any route exists, so every later `use()` — from any plugin, in either
     *    boot phase — gates everything. A standalone `HonoHttpServer` that never
     *    calls it gets the runner mounted on its first `use()` instead, and only
     *    that path carries the register-before-routes requirement.
     */
    use(pathOrHandler: string | Middleware, handler?: Middleware) {
        if (typeof pathOrHandler === 'string' && handler) {
            this.middlewares.push({ path: pathOrHandler, handler });
        } else if (typeof pathOrHandler === 'function') {
            this.middlewares.push({ handler: pathOrHandler });
        } else {
            return;
        }
        this.installMiddlewareSeam();
    }

    /**
     * Mount the single Hono middleware that runs the registered
     * {@link Middleware} chain. Idempotent.
     *
     * WHERE this is called decides what the seam can gate, and the two callers
     * are deliberate:
     *
     *  - **`HonoServerPlugin.init()`, at the end** — after the transport's own
     *    built-ins (Server-Timing, CORS) so a 429 short-circuit still carries
     *    CORS headers (otherwise a browser reports an opaque network error
     *    instead of the status), and before any route exists, since every route
     *    in the platform is mounted in some plugin's `start()`. From there a
     *    `use()` at ANY later moment gates the whole server, which is what lets
     *    the dispatcher install the rate limiter in `start()` — where "no
     *    http.server" is a settled fact rather than a mid-Phase-1 guess that a
     *    later plugin could contradict.
     *  - **the first `use()`** — for a bare `HonoHttpServer` composed without
     *    the plugin, so the seam is never silently absent.
     */
    installMiddlewareSeam(): void {
        if (this.middlewareSeamInstalled) return;
        this.middlewareSeamInstalled = true;

        this.app.use('*', async (c, next) => {
            const chain = this.middlewares
                .filter((m) => m.path === undefined || matchesRoutePattern(m.path, c.req.path))
                .map((m) => m.handler);
            if (chain.length === 0) return next();

            const headers = c.req.header() as Record<string, string>;
            const req = {
                params: {},
                query: readQuery(c),
                // Deliberately absent — see the `use()` contract above.
                body: undefined,
                headers,
                method: c.req.method,
                path: c.req.path,
                /**
                 * The transport's own peer address. This is the value a client
                 * CANNOT forge, which is what makes it the safe default for
                 * identifying an anonymous caller when no proxy is trusted
                 * (`server.trustProxy`). `@hono/node-server` exposes the Node
                 * request as `c.env.incoming`; other Hono runtimes may not, and
                 * consumers must treat it as optional.
                 */
                remoteAddress: readRemoteAddress(c),
            } as any;

            let responded = false;
            let status = 200;
            const outHeaders = new Headers();
            let bodyJson: unknown;
            let bodyRaw: string | Uint8Array | ArrayBuffer | undefined;

            const res: any = {
                status(code: number) { status = code; return res; },
                header(name: string, value: string | string[]) {
                    for (const v of Array.isArray(value) ? value : [value]) outHeaders.append(name, v);
                    return res;
                },
                json(data: unknown) { responded = true; bodyJson = data; },
                send(data: string | Uint8Array | ArrayBuffer) { responded = true; bodyRaw = data; },
            };

            let index = 0;
            let continued = false;
            const run = async (): Promise<void> => {
                if (index >= chain.length) { continued = true; return; }
                const middleware = chain[index++];
                let nextCalled = false;
                await middleware(req, res, async () => { nextCalled = true; await run(); });
                // Neither continued nor answered → treat as pass-through, so a
                // middleware cannot black-hole a request by accident.
                if (!nextCalled && !responded) await run();
            };
            await run();

            if (responded && !continued) {
                if (bodyJson !== undefined) {
                    outHeaders.set('Content-Type', 'application/json');
                    return new Response(JSON.stringify(bodyJson), { status, headers: outHeaders });
                }
                return new Response((bodyRaw ?? '') as any, { status, headers: outHeaders });
            }
            return next();
        });
    }

    /**
     * Mount a sub-application or router
     */
    mount(path: string, subApp: Hono) {
        this.app.route(path, subApp);
    }


    async listen(port: number) {
        if (this.staticRoot) {
            this.app.get('/*', serveStatic({ root: this.staticRoot }));
        }

        const targetPort = port || this.port;
        const maxRetries = 20;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const tryPort = targetPort + attempt;
            try {
                await this.tryListen(tryPort);
                return;
            } catch (err: any) {
                if (err.code === 'EADDRINUSE' && attempt < maxRetries - 1) {
                    if (this.server && typeof this.server.close === 'function') {
                        this.server.close();
                    }
                    continue;
                }
                throw err;
            }
        }
    }

    private tryListen(port: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const server = serve({
                fetch: this.app.fetch,
                port
            }, (info) => {
                this.listeningPort = info.port;
                resolve();
            });
            this.server = server;
            server.on('error', (err: any) => {
                reject(err);
            });
        });
    }

    getPort() {
        return this.listeningPort || this.port;
    }

    // Expose raw app for scenarios where standard interface is not enough
    getRawApp() {
        return this.app;
    }

    async close() {
        if (!this.server) return;
        const server = this.server;
        // Graceful drain (P1-3): stop accepting new connections and let in-flight
        // requests finish rather than force-killing them mid-response.
        // `closeIdleConnections()` releases idle keep-alive sockets so the process
        // can exit promptly; active requests keep running until they complete or
        // the drain window elapses.
        await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => { if (!settled) { settled = true; resolve(); } };

            // Fires once every connection has ended (drained).
            server.close(() => finish());
            if (typeof server.closeIdleConnections === 'function') {
                server.closeIdleConnections();
            }

            // Safety net: if requests outlast the drain window, force-close the
            // remainder so shutdown can't hang past the kernel's shutdownTimeout.
            const timer = setTimeout(() => {
                if (typeof server.closeAllConnections === 'function') {
                    server.closeAllConnections();
                }
                finish();
            }, this.drainTimeoutMs);
            if (typeof timer.unref === 'function') timer.unref();
        });
        this.server = undefined;
    }
}
