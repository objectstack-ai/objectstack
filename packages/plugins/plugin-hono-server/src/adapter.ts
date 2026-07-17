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

export interface HonoCorsOptions {
    enabled?: boolean;
    origins?: string | string[];
    methods?: string[];
    /**
     * Request headers allowed on preflight (`Access-Control-Allow-Headers`).
     *
     * Defaults to `['Content-Type', 'Authorization', 'X-Requested-With']`,
     * which is sufficient for cookie and bearer-token auth.
     */
    allowHeaders?: string[];
    /**
     * Response headers exposed to JS (`Access-Control-Expose-Headers`).
     *
     * Defaults to `['set-auth-token']` so that better-auth's `bearer()` plugin
     * can hand rotated session tokens to cross-origin clients. User-supplied
     * values are merged with this default — `set-auth-token` is always
     * exposed unless CORS is disabled entirely.
     */
    exposeHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
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

    use(pathOrHandler: string | Middleware, handler?: Middleware) {
        if (typeof pathOrHandler === 'string' && handler) {
             this.app.use(pathOrHandler, async (c, next) => {
                 let nextCalled = false;
                 const wrappedNext = () => { nextCalled = true; return next(); };
                 await handler({} as any, {} as any, wrappedNext);
                 if (!nextCalled) await next();
             });
        } else if (typeof pathOrHandler === 'function') {
             this.app.use('*', async (c, next) => {
                 let nextCalled = false;
                 const wrappedNext = () => { nextCalled = true; return next(); };
                 await pathOrHandler({} as any, {} as any, wrappedNext);
                 if (!nextCalled) await next();
             });
        }
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
