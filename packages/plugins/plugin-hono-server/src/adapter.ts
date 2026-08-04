// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Export IHttpServer from core
export * from '@objectstack/core';

import {
    IHttpServer,
    RouteHandler,
    Middleware
} from '@objectstack/core';
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
                params: c.req.param(),
                query: c.req.query(),
                body,
                headers: rawHeaders,
                method: c.req.method,
                path: c.req.path,
                rawBody: async () => {
                    const ab = await c.req.arrayBuffer();
                    return Buffer.from(ab);
                },
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
            const streamPromise = new Promise<Response | null>((resolve) => {
                const stream = new ReadableStream({
                    start(controller) {
                        streamController = controller;
                        streamEncoder = new TextEncoder();
                    },
                });

                // Run the handler; once it's done, check if streaming was used
                const _endHandler = _perf?.start('handler', 'Route handler');
                const result = handler(req as any, res as any);
                const done = result instanceof Promise ? result : Promise.resolve(result);
                done.then(() => {
                    _endHandler?.();
                    if (isStreaming) {
                        resolve(new Response(stream, {
                            status: 200,
                            headers: streamHeaders,
                        }));
                    } else {
                        // Not streaming — close the unused stream and return null
                        closeStream();
                        resolve(null);
                    }
                }).catch((err) => {
                    _endHandler?.();
                    closeStream();
                    resolve(null);
                });
            });

            const streamResponse = await streamPromise;
            return streamResponse ?? capturedResponse ?? c.json({ error: 'No response from handler' }, 500);
        };
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
                query: c.req.query(),
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
