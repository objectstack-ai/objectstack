// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import {
    IHttpServer,
    IHttpRequest,
    IHttpResponse,
    RouteHandler,
    Middleware,
} from '@objectstack/core';

/**
 * NodeHttpServer — a thin `IHttpServer` implementation on raw `node:http`,
 * with **zero** framework dependencies.
 *
 * This is the second adapter behind the transport port (ADR-0076 D11 /
 * OQ#10, #2462): its purpose is to *prove* that everything registered
 * through `IHttpServer` (the dispatcher bridge, the REST route generator,
 * package routes, …) runs unchanged on a non-Hono server. Anything the
 * framework needs beyond the `IHttpServer` contract is, by definition, a
 * port leak — this adapter deliberately implements the contract and the two
 * documented soft extensions only:
 *
 * - **Streaming** (`res.write` / `res.end`): consumers feature-detect these
 *   for SSE (AI routes); on node:http they map directly onto the native
 *   response stream.
 * - **`getPort()`**: used by boot code/tests to discover the OS-assigned
 *   port after `listen(0)`.
 *
 * Deliberately NOT implemented (each one is a known escape hatch whose
 * consumers feature-detect and degrade):
 * - `getRawApp()` — Hono-specific; metadata HMR, cloud-connection routes and
 *   the hono-plugin's own static/SPA mounts use it and will log-and-skip.
 * - `mount()` — Hono sub-app composition.
 *
 * Route patterns support the same subset the framework registers (see
 * plugin-hono-server/src/route-pattern.ts): `:param` segments and a trailing
 * `*` wildcard. Matching is registration-order first-match-wins, mirroring
 * the documented behavior of the primary adapter (rest-server.ts relies on
 * exactly this).
 */

interface CompiledRoute {
    method: string;
    pattern: string;
    regex: RegExp;
    /** `:param` names, in order of appearance. */
    keys: string[];
    handler: RouteHandler;
}

/** Strip a single trailing slash so `/a/b` and `/a/b/` match the same pattern. */
function normalize(path: string): string {
    if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
    return path;
}

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

/**
 * Compile a route pattern (`:param` + trailing `*` subset) into an anchored
 * regex with capture groups for named params.
 */
export function compileRoute(pattern: string): { regex: RegExp; keys: string[] } {
    const keys: string[] = [];
    const body = normalize(pattern)
        .split('/')
        .map((segment) => {
            if (segment.startsWith(':') && segment.length > 1) {
                keys.push(segment.slice(1));
                return '([^/]+)';
            }
            if (segment === '*') {
                // Trailing wildcard — matches the rest of the path, including '/'.
                return '.*';
            }
            return segment.replace(ESCAPE_REGEX, '\\$&');
        })
        .join('/');
    return { regex: new RegExp(`^${body}$`), keys };
}

/** Body-parsing content types we consume eagerly; everything else stays raw. */
function isEagerlyParsed(contentType: string): boolean {
    return (
        contentType.includes('application/json') ||
        contentType.includes('application/x-www-form-urlencoded') ||
        contentType.startsWith('text/')
    );
}

function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

export class NodeHttpServer implements IHttpServer {
    private routes: CompiledRoute[] = [];
    private middlewares: Middleware[] = [];
    private server: Server | undefined;
    private listeningPort: number | undefined;

    constructor(
        private port: number = 3000,
        /**
         * Max time (ms) to let in-flight requests drain on `close()` before
         * force-closing the remainder. Mirrors the Hono adapter's drain
         * window; kept well under the kernel's 60s shutdownTimeout.
         */
        private drainTimeoutMs: number = 10_000,
    ) {}

    private register(method: string, pattern: string, handler: RouteHandler) {
        const { regex, keys } = compileRoute(pattern);
        this.routes.push({ method, pattern, regex, keys, handler });
    }

    get(path: string, handler: RouteHandler) { this.register('GET', path, handler); }
    post(path: string, handler: RouteHandler) { this.register('POST', path, handler); }
    put(path: string, handler: RouteHandler) { this.register('PUT', path, handler); }
    delete(path: string, handler: RouteHandler) { this.register('DELETE', path, handler); }
    patch(path: string, handler: RouteHandler) { this.register('PATCH', path, handler); }

    use(pathOrHandler: string | Middleware, handler?: Middleware) {
        // Same degenerate semantics as the Hono adapter's wrapper: middleware
        // is invoked as a sequential hook and the chain always continues,
        // whether or not it called next(). The path argument is ignored there
        // too (the wrapper passes empty req/res), so we keep behavior aligned.
        const mw = typeof pathOrHandler === 'function' ? pathOrHandler : handler;
        if (mw) this.middlewares.push(mw);
    }

    /**
     * The HTTP methods registered for a concrete request path, ignoring the
     * request's own method — used to answer `405 Method Not Allowed` with an
     * accurate `Allow` header instead of an opaque 404. `HEAD` is implied by
     * `GET`, matching the primary adapter.
     */
    allowedMethodsForPath(path: string): string[] {
        const normalized = normalize(path);
        const methods = new Set<string>();
        for (const route of this.routes) {
            if (route.regex.test(normalized)) methods.add(route.method);
        }
        if (methods.has('GET')) methods.add('HEAD');
        return Array.from(methods).sort();
    }

    private match(method: string, path: string): { route: CompiledRoute; params: Record<string, string> } | undefined {
        const normalized = normalize(path);
        // HEAD is answered by GET handlers (body suppressed by node core for
        // HEAD automatically when we end without a body; JSON bodies are
        // dropped in the response wrapper below).
        const effective = method === 'HEAD' ? 'GET' : method;
        for (const route of this.routes) {
            if (route.method !== effective) continue;
            const m = route.regex.exec(normalized);
            if (!m) continue;
            // Own-data-property construction for symmetry with `query` — keys
            // come from the registered pattern (developer-controlled), values
            // from the URL.
            const params = Object.fromEntries(
                route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]),
            ) as Record<string, string>;
            return { route, params };
        }
        return undefined;
    }

    private async handleRequest(nodeReq: IncomingMessage, nodeRes: ServerResponse) {
        const method = (nodeReq.method || 'GET').toUpperCase();
        const url = new URL(nodeReq.url || '/', 'http://internal');
        const path = url.pathname;

        const matched = this.match(method, path);
        if (!matched) {
            // Distinguish "path exists under another verb" (405 + Allow) from a
            // genuine 404 — same semantics as the primary adapter's notFound.
            const allowed = this.allowedMethodsForPath(path);
            if (allowed.length > 0 && !allowed.includes(method)) {
                nodeRes.statusCode = 405;
                nodeRes.setHeader('Allow', allowed.join(', '));
                nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                nodeRes.end(JSON.stringify({
                    error: 'Method Not Allowed',
                    code: 'METHOD_NOT_ALLOWED',
                    message: `${method} is not supported for ${path}. Allowed: ${allowed.join(', ')}.`,
                    method,
                    path,
                    allowed,
                }));
                return;
            }
            nodeRes.statusCode = 404;
            nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
            nodeRes.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        // ── Query params (multi-value aware) ────────────────────────────────
        // The property names come straight from the request URL, so this map
        // must never be built via dynamic property writes (`obj[key] = …`) —
        // `?__proto__=…` would walk the prototype chain (CodeQL: remote
        // property injection). `Object.fromEntries` creates own data
        // properties only; the dangerous keys are dropped outright as
        // defense in depth.
        const seen = new Set<string>();
        const queryEntries: Array<[string, string | string[]]> = [];
        for (const key of url.searchParams.keys()) {
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
            if (seen.has(key)) continue;
            seen.add(key);
            const all = url.searchParams.getAll(key);
            queryEntries.push([key, all.length > 1 ? all : all[0]]);
        }
        const query = Object.fromEntries(queryEntries) as Record<string, string | string[]>;

        // ── Body ────────────────────────────────────────────────────────────
        // JSON / urlencoded / text bodies are consumed eagerly (like the
        // primary adapter); anything else (octet-stream, multipart) stays on
        // the socket for the lazy `rawBody()` accessor so binary uploads pay
        // no parsing cost.
        const contentType = String(nodeReq.headers['content-type'] || '');
        let body: any = {};
        let bufferedBody: Buffer | undefined;
        if (method !== 'GET' && method !== 'HEAD' && isEagerlyParsed(contentType)) {
            bufferedBody = await readBody(nodeReq);
            const text = bufferedBody.toString('utf8');
            if (contentType.includes('application/json')) {
                try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
            } else if (contentType.includes('application/x-www-form-urlencoded')) {
                body = Object.fromEntries(new URLSearchParams(text));
            } else {
                body = text;
            }
        }

        // node:http exposes headers as a lowercased record already, Host
        // included — no backfill needed (the Fetch-API Host backfill in the
        // Hono adapter is adapter-local, not a port requirement).
        const req: IHttpRequest = {
            params: matched.params,
            query,
            body,
            headers: nodeReq.headers as Record<string, string | string[]>,
            method,
            path,
            rawBody: async () => bufferedBody ?? (bufferedBody = await readBody(nodeReq)),
        };

        // ── Response wrapper (contract + streaming extension) ───────────────
        const isHead = method === 'HEAD';
        let streaming = false;
        const res: IHttpResponse & { write: (chunk: string | Uint8Array) => void; end: () => void } = {
            status: (code: number) => { nodeRes.statusCode = code; return res; },
            header: (name: string, value: string | string[]) => { nodeRes.setHeader(name, value); return res; },
            json: (data: any) => {
                if (nodeRes.writableEnded) return;
                if (!nodeRes.headersSent) nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                nodeRes.end(isHead ? undefined : JSON.stringify(data));
            },
            send: (data: string | Uint8Array | ArrayBuffer) => {
                if (nodeRes.writableEnded) return;
                if (typeof data === 'string') {
                    if (!nodeRes.headersSent) nodeRes.setHeader('Content-Type', 'text/html; charset=utf-8');
                    nodeRes.end(isHead ? undefined : data);
                } else {
                    if (!nodeRes.headersSent) nodeRes.setHeader('Content-Type', 'application/octet-stream');
                    const buf = data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
                    if (isHead) nodeRes.end();
                    else nodeRes.end(buf);
                }
            },
            // Streaming extension (SSE): map straight onto the native stream.
            write: (chunk: string | Uint8Array) => {
                streaming = true;
                if (!nodeRes.writableEnded) nodeRes.write(chunk);
            },
            end: () => {
                if (!nodeRes.writableEnded) nodeRes.end();
            },
        };

        try {
            for (const mw of this.middlewares) {
                let advanced = false;
                await mw(req, res as IHttpResponse, () => { advanced = true; });
                void advanced; // chain always continues — parity with the primary adapter
            }
            await matched.route.handler(req, res as IHttpResponse);
            // Handler resolved without producing a response and without
            // starting a stream (SSE handlers legitimately resolve while the
            // stream is still open — dispatcher drains it in the background).
            if (!nodeRes.writableEnded && !streaming) {
                nodeRes.statusCode = 500;
                nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                nodeRes.end(JSON.stringify({ error: 'No response from handler' }));
            }
        } catch (err: any) {
            if (!nodeRes.writableEnded) {
                if (!nodeRes.headersSent) {
                    nodeRes.statusCode = typeof err?.statusCode === 'number' ? err.statusCode : 500;
                    nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                }
                nodeRes.end(JSON.stringify({ error: err?.message || 'Internal Server Error' }));
            }
        }
    }

    async listen(port: number) {
        const targetPort = port ?? this.port;
        // Port 0 = OS-assigned; retry only makes sense for concrete ports.
        const maxRetries = targetPort === 0 ? 1 : 20;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.tryListen(targetPort === 0 ? 0 : targetPort + attempt);
                return;
            } catch (err: any) {
                if (err?.code === 'EADDRINUSE' && attempt < maxRetries - 1) continue;
                throw err;
            }
        }
    }

    private tryListen(port: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const server = createServer((req, res) => {
                void this.handleRequest(req, res).catch(() => {
                    if (!res.writableEnded) {
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: 'Internal Server Error' }));
                    }
                });
            });
            const onError = (err: any) => { server.close(); reject(err); };
            server.once('error', onError);
            server.listen(port, () => {
                server.removeListener('error', onError);
                const addr = server.address();
                this.listeningPort = typeof addr === 'object' && addr ? addr.port : port;
                this.server = server;
                resolve();
            });
        });
    }

    getPort(): number {
        return this.listeningPort ?? this.port;
    }

    async close() {
        if (!this.server) return;
        const server = this.server;
        this.server = undefined;
        await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => { if (!settled) { settled = true; resolve(); } };
            server.close(() => finish());
            if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
            const timer = setTimeout(() => {
                if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
                finish();
            }, this.drainTimeoutMs);
            if (typeof timer.unref === 'function') timer.unref();
        });
    }
}
