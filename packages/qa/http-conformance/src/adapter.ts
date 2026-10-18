// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import {
    IHttpServer,
    IHttpRequest,
    IHttpResponse,
    RouteHandler,
    Middleware,
    UNMATCHED_ROUTE_PATTERN,
} from '@objectstack/core';
import type { HttpResponseObserver } from '@objectstack/core';

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
 * Since commit 12298c7d6 it also implements the contract's optional
 * {@link NodeHttpServer.setFallbackHandler} — see the CONTRACT there. That is
 * NOT a third soft extension: the member is part of `IHttpServer` and carries
 * four testable guarantees, and this adapter has to satisfy them before the
 * conformance suite can assert them CROSS-adapter. Asserting them against a
 * single implementor would prove nothing about the port.
 *
 * Since #9835 it implements the optional
 * {@link NodeHttpServer.afterResponse} response-observation seam for the same
 * reason — the conformance suite locks the seam's semantics (pattern-never-
 * path, refused-request reach, observer isolation) across BOTH adapters. It
 * also retires, for this transport, the "zero means not instrumented" hole
 * the #9650 ruling documented as an expectation: a composition that arms a
 * metrics observer through the seam gets `http_requests_total` here too,
 * instead of a counter that stays flat while traffic flows.
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

/*
 * ── The request body: parsed by its declared content type, or REFUSED ────────
 *
 * [#24083] `IHttpRequest.body` (`@objectstack/spec/contracts`) is the parsed
 * JSON document for `application/json`, the parsed fields of a form
 * (`multipart/form-data`, `application/x-www-form-urlencoded`), `{}` when the
 * request carries no body, and otherwise a REFUSAL thrown from the read, never
 * an invented value. This adapter used to read malformed declared JSON as `{}`,
 * a multipart body as `{}`, and a `text/*` body as a string.
 *
 * What follows MIRRORS the standard transport's decision
 * (`readRequestBody` in plugin-hono-server's `src/request-body.ts`, whose
 * module note says why each arm answers what it does), and does not import
 * it: this adapter is the instrument that measures that transport, and a
 * reference that ran the subject's code could not see the subject drift. The
 * two are held equal from outside instead, byte for byte, by
 * `request-body.conformance.test.ts`. So a change to either side's wording or
 * arms is a change to both.
 *
 * - Declared JSON (`application/json`, matched case-insensitively): read as
 *   text and parsed. Empty or whitespace-only is `{}`; anything else that does
 *   not parse is a refusal.
 * - A form: parsed into fields by the Fetch `Response.formData()` that Node
 *   ships (the very parser the standard transport's framework calls), in its
 *   field shape: one value per key, the last one winning, except a key that
 *   ends in `[]`, which collects every value into an array; a file part is a
 *   `File`. A parse failure is a refusal.
 * - Any other media type, or none: nothing is read, so the bytes stay on the
 *   socket for `rawBody()`. A request that carries a body by its framing
 *   headers (RFC 9112 §6.3) is a refusal on read; one that carries none is
 *   `{}`.
 *
 * GET and HEAD carry no body here, as on the standard transport, whose
 * framework hands those methods a request with no body: nothing is read from
 * the socket for them, and the decision above runs on empty bytes.
 */

/**
 * The refusal, as a DECLARED ADR-0112 throw: `status` and a registered `code`
 * (`INVALID_REQUEST` is on the error-code ledger). Module-private.
 */
class RequestBodyRefusal extends Error {
    readonly status = 400;
    readonly code = 'INVALID_REQUEST';

    constructor(message: string) {
        super(message);
        this.name = 'RequestBodyRefusal';
    }
}

type RequestBodyReading =
    | { readonly body: unknown; readonly refusal?: undefined }
    | { readonly refusal: RequestBodyRefusal };

/** The refusal tail every message ends with: what the transport did NOT do. */
const NOT_EMPTY = 'It was refused rather than read as an empty body';

const MALFORMED_JSON_BODY_MESSAGE =
    `The request body could not be parsed as JSON (it was sent as application/json). ${NOT_EMPTY}: `
    + 'send a well-formed JSON document, or no body at all.';

const UNREADABLE_BODY_MESSAGE = `The request body could not be read. ${NOT_EMPTY}.`;

/** A media type as the client spelled it, echoed only when it is a plain token pair. */
function namedMediaType(mediaType: string): string {
    if (mediaType === '') return 'with no Content-Type';
    return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/.test(mediaType)
        ? `as ${mediaType}`
        : 'with an unrecognised Content-Type';
}

function malformedFormMessage(mediaType: string): string {
    return `The request body could not be parsed as form data (it was sent ${namedMediaType(mediaType)}). ${NOT_EMPTY}.`;
}

function unreadMediaTypeMessage(mediaType: string): string {
    return `The request body was sent ${namedMediaType(mediaType)}, which this server does not read into a `
        + `request body. ${NOT_EMPTY}: send it as application/json.`;
}

/** RFC 9112 §6.3: a `Content-Length` that is not `0`, or any `Transfer-Encoding`, is a body. */
function declaresBody(headers: IncomingMessage['headers']): boolean {
    const length = headers['content-length'];
    if (length !== undefined && length.trim() !== '') return Number(length) !== 0;
    return headers['transfer-encoding'] !== undefined;
}

/**
 * A form's fields in the standard transport's shape (see the block above).
 * Built through `Object.fromEntries`, so a field named `__proto__` is an own
 * key and never reaches the prototype chain, and then left with no prototype,
 * as the standard transport's object has none.
 */
function formFields(form: FormData): Record<string, unknown> {
    const fields = new Map<string, unknown>();
    form.forEach((value, key) => {
        if (!key.endsWith('[]')) {
            fields.set(key, value);
            return;
        }
        const values = fields.get(key);
        if (Array.isArray(values)) values.push(value);
        else fields.set(key, [value]);
    });
    return Object.setPrototypeOf(Object.fromEntries(fields), null) as Record<string, unknown>;
}

/**
 * Decide the body (see the block above). `bytes` is the read of the request
 * stream when this decision consumed it, so `rawBody()` hands back those same
 * bytes, or that same failure, instead of reading a drained socket.
 */
async function readRequestBody(
    nodeReq: IncomingMessage,
    method: string,
): Promise<{ reading: RequestBodyReading; bytes?: Promise<Buffer> }> {
    const contentType = String(nodeReq.headers['content-type'] ?? '');
    const lowered = contentType.toLowerCase();
    const readStream = (): Promise<Buffer> =>
        method === 'GET' || method === 'HEAD' ? Promise.resolve(Buffer.alloc(0)) : readBody(nodeReq);

    if (lowered.includes('application/json')) {
        const bytes = readStream();
        let text: string;
        try {
            text = (await bytes).toString('utf8');
        } catch {
            return { reading: { refusal: new RequestBodyRefusal(UNREADABLE_BODY_MESSAGE) }, bytes };
        }
        if (text.trim() === '') return { reading: { body: {} }, bytes };
        try {
            return { reading: { body: JSON.parse(text) }, bytes };
        } catch {
            return { reading: { refusal: new RequestBodyRefusal(MALFORMED_JSON_BODY_MESSAGE) }, bytes };
        }
    }

    const mediaType = lowered.split(';')[0]!.trim();
    if (mediaType === 'multipart/form-data' || mediaType === 'application/x-www-form-urlencoded') {
        const bytes = readStream();
        try {
            const form = await new Response(await bytes, {
                headers: { 'Content-Type': contentType.replace(/^[^;]+/, (type) => type.toLowerCase()) },
            }).formData();
            return { reading: { body: formFields(form) }, bytes };
        } catch {
            return { reading: { refusal: new RequestBodyRefusal(malformedFormMessage(mediaType)) }, bytes };
        }
    }

    return {
        reading: declaresBody(nodeReq.headers)
            ? { refusal: new RequestBodyRefusal(unreadMediaTypeMessage(mediaType)) }
            : { body: {} },
    };
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
    /**
     * The LAST-RESORT handler installed by {@link setFallbackHandler}, or
     * `undefined` when no consumer installed one. Exactly ONE — installing
     * again replaces it, per the contract. A field read per request (rather
     * than a route pushed onto {@link routes}) is what makes the replacement
     * semantics and the zero registration-order dependency structural here.
     */
    private fallbackHandler: RouteHandler | undefined;
    /**
     * Registered {@link HttpResponseObserver}s, in registration order — the
     * `IHttpServer.afterResponse` seam (#9835). Read per request in
     * {@link handleRequest}, so registration works at any moment.
     */
    private responseObservers: HttpResponseObserver[] = [];

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

    /**
     * Install the LAST-RESORT handler — see the CONTRACT on
     * `IHttpServer.setFallbackHandler` in `@objectstack/spec/contracts`
     * (#5040 §1-C). `node:http` ships no not-found hook to map onto, so this
     * adapter builds the equivalent out of its own router (commit 12298c7d6). The four
     * guarantees, and how each is honoured HERE:
     *
     *  1. **Only after every registered route has missed.** The handler is a
     *     FIELD consulted in {@link handleRequest}'s route-miss branch — never
     *     a route pushed onto {@link routes}. A `${prefix}/*` catch-all route
     *     would be decided by this adapter's first-match-wins matching, i.e.
     *     by registration order across plugin `start()` — the ADR-0076 D11
     *     hazard "one route, one owner" exists to prevent. As a field it is
     *     structurally incapable of shadowing a registered route, whenever it
     *     was installed. A METHOD mismatch on an existing path is also a miss,
     *     so the fallback sees those too (the primary adapter routes them into
     *     the same `notFound` sink) — and declining leaves the 405 intact,
     *     guarantee 4.
     *  2. **`req.body` IS readable.** Nothing consumed the request stream — no
     *     route handler ran — so the fallback branch parses it by content-type
     *     through the SAME code a matched route goes through, rather than a
     *     second request-builder that could drift from it. That is the whole
     *     reason this seam exists and `use()` cannot serve: the middleware
     *     contract explicitly does NOT populate `body`.
     *  3. **Replacement, not a chain.** One field, assigned. Installing again
     *     overwrites; nothing accumulates and nothing stacks.
     *  4. **A handler that writes nothing leaves the standard answer.** The
     *     branch falls through to {@link writeUnmatchedResponse} — the 404, or
     *     the 405 + `Allow`, unchanged. Writing nothing is the documented way
     *     to say "not mine". The one exception is a fallback that read a body
     *     this adapter refused: as on the primary adapter, the refusal is then
     *     the answer, whether the fallback threw, answered or wrote nothing.
     *
     * Locked cross-adapter by this package's own
     * `fallback-seam.conformance.test.ts`, which runs the same cases against
     * `HonoHttpServer`.
     */
    setFallbackHandler(handler: RouteHandler): void {
        this.fallbackHandler = handler;
    }

    /**
     * Register a RESPONSE OBSERVER — the `IHttpServer.afterResponse` CONTRACT
     * (#9835); see `@objectstack/spec/contracts` for the full text. Honoured
     * here as follows:
     *
     *  - **Delivery** hangs off the native response's `finish` event, armed in
     *    {@link handleRequest} once the route table has been consulted — so
     *    the observation fires exactly once, after the response was written
     *    (buffered, streamed, fallback and error paths alike), with the
     *    status as sent. A connection that dies before `finish` (client
     *    abort) goes unobserved, as the contract allows.
     *  - **`routePattern` is the registered PATTERN** the router matched
     *    (`route.pattern`, the very string the consumer registered), never
     *    the concrete path; the reserved `UNMATCHED_ROUTE_PATTERN` when no
     *    route matched (404/405/fallback answers).
     *  - **Reach**: everything {@link handleRequest} serves — there is no
     *    raw-app escape hatch on this adapter (`getRawApp` deliberately
     *    absent), so route, fallback and unmatched answers are the whole
     *    surface, and all three are observed. This adapter has no transport
     *    built-ins that answer before the seam, so its boundary is empty.
     *  - **Isolation**: each observer runs in its own try/catch — a throwing
     *    observer affects neither the response nor sibling observers.
     */
    afterResponse(observer: HttpResponseObserver): void {
        this.responseObservers.push(observer);
    }

    /**
     * This adapter's standard answer for a request that matched no route — the
     * `IHttpServer` unmatched-request CONTRACT (#3607 / ADR-0076 OQ#10): 405 +
     * an accurate `Allow` when the path exists under another verb, otherwise
     * the shared 404 body.
     *
     * Extracted from {@link handleRequest} by commit 12298c7d6 because it gained a second
     * call site: the fall-through after an installed fallback declined to
     * answer. Both paths must produce the byte-identical answer — a fallback
     * that writes nothing may not cost a caller the `Allow` header.
     */
    private writeUnmatchedResponse(nodeRes: ServerResponse, method: string, path: string) {
        // Distinguish "path exists under another verb" (405 + Allow) from a
        // genuine 404 — same semantics as the primary adapter's notFound.
        const allowed = this.allowedMethodsForPath(path);
        if (allowed.length > 0 && !allowed.includes(method)) {
            nodeRes.statusCode = 405;
            nodeRes.setHeader('Allow', allowed.join(', '));
            nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
            nodeRes.end(JSON.stringify({
                success: false,
                error: {
                    code: 'METHOD_NOT_ALLOWED',
                    message: `${method} is not supported for ${path}. Allowed: ${allowed.join(', ')}.`,
                    details: { method, path, allowed },
                },
            }));
            return;
        }
        nodeRes.statusCode = 404;
        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
        nodeRes.end(JSON.stringify({
            success: false,
            error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
        }));
    }

    /**
     * [#24083] The answer to a request whose handler (a matched route's, or
     * the fallback's) read a body this adapter refused: `400 INVALID_REQUEST`
     * in the ADR-0112 envelope, the same two keys the primary adapter renders
     * for this throw. The request's body was never readable, so no other
     * answer describes it.
     *
     * One shape cannot be matched on `node:http`: a handler that WROTE before
     * it read has put bytes on the wire, which the primary adapter (it holds
     * the handler's answer until the handler returns) still replaces. Here
     * what was sent stands, and the response is closed.
     */
    private writeBodyRefusal(nodeRes: ServerResponse, refusal: RequestBodyRefusal) {
        if (nodeRes.headersSent) {
            if (!nodeRes.writableEnded) nodeRes.end();
            return;
        }
        nodeRes.statusCode = refusal.status;
        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
        nodeRes.end(JSON.stringify({
            success: false,
            error: { code: refusal.code, message: refusal.message },
        }));
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
        const startedAt = Date.now();
        const method = (nodeReq.method || 'GET').toUpperCase();
        const url = new URL(nodeReq.url || '/', 'http://internal');
        const path = url.pathname;

        const matched = this.match(method, path);

        // ── The `afterResponse` observation seam (#9835) ────────────────────
        // Armed as soon as the router's verdict is known — BEFORE any branch
        // below writes, so the unmatched 404/405, the fallback and the route
        // paths are all observed. `finish` fires once, when the response has
        // been fully written, which is what "after the response exists" means
        // on node:http. Zero cost when no observer is registered.
        if (this.responseObservers.length > 0) {
            nodeRes.once('finish', () => {
                const observation = {
                    method,
                    // The registered PATTERN, never the concrete path — the
                    // contract's hard cardinality requirement. Unrouted
                    // requests carry the contract's reserved label.
                    routePattern: matched?.route.pattern ?? UNMATCHED_ROUTE_PATTERN,
                    status: nodeRes.statusCode,
                    elapsedMs: Date.now() - startedAt,
                };
                // Snapshot so an observer registering mid-delivery cannot
                // mutate the list under the loop.
                for (const observer of [...this.responseObservers]) {
                    try {
                        observer(observation);
                    } catch {
                        // An observer must never break a response or a
                        // sibling observer — the contract's isolation rule.
                    }
                }
            });
        }
        // The LAST-RESORT seam (commit 12298c7d6): consulted ONLY here, i.e. only once
        // every explicitly registered route has missed — see the CONTRACT on
        // {@link setFallbackHandler}. Resolved BEFORE the request body is read
        // so an unmatched request on a server with NO fallback installed still
        // costs exactly what it cost before this seam existed: nothing.
        const fallback = matched ? undefined : this.fallbackHandler;
        if (!matched && !fallback) {
            this.writeUnmatchedResponse(nodeRes, method, path);
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
        // [#24083] Declared JSON and forms are read eagerly, as on the primary
        // adapter; every other media type stays on the socket for the lazy
        // `rawBody()` accessor, so a binary upload pays no parsing cost. What
        // each media type answers is `readRequestBody`'s (above).
        const { reading, bytes } = await readRequestBody(nodeReq, method);
        let bodyReading: RequestBodyReading = reading;
        let bufferedBody: Promise<Buffer> | undefined = bytes;
        /** Set once a READ of `req.body` met the refusal; see the route branch below. */
        let refusedBodyRead: RequestBodyRefusal | undefined;

        // node:http exposes headers as a lowercased record already, Host
        // included — no backfill needed (the Fetch-API Host backfill in the
        // Hono adapter is adapter-local, not a port requirement).
        const req: IHttpRequest = {
            // No matched route means no path params — `{}`, exactly what the
            // primary adapter hands its fallback (its `readRouteParams` guard).
            params: matched?.params ?? {},
            query,
            /**
             * [#24083] An accessor rather than a value, as on the primary
             * adapter: reading a body this adapter refused throws the refusal,
             * which stops the handler at the read. A route that reads
             * `rawBody()` instead never reaches it. Writable as before.
             */
            get body(): any {
                if (bodyReading.refusal) {
                    refusedBodyRead = bodyReading.refusal;
                    throw bodyReading.refusal;
                }
                return bodyReading.body;
            },
            set body(value: any) {
                bodyReading = { body: value };
            },
            headers: nodeReq.headers as Record<string, string | string[]>,
            method,
            path,
            // The bytes of every body, a refused one included.
            rawBody: () => (bufferedBody ??= readBody(nodeReq)),
        };

        /**
         * [#24083] A read of a refused body makes the refusal THE answer,
         * whatever the handler made of the throw, on a matched route and in
         * the fallback alike, as on the primary adapter: anything the handler
         * writes after the read is dropped, and {@link writeBodyRefusal}
         * answers once it returns.
         */
        const refusalStands = (): boolean => refusedBodyRead !== undefined;

        // ── Response wrapper (contract + streaming extension) ───────────────
        const isHead = method === 'HEAD';
        let streaming = false;
        const res: IHttpResponse & { write: (chunk: string | Uint8Array) => void; end: () => void } = {
            status: (code: number) => { nodeRes.statusCode = code; return res; },
            header: (name: string, value: string | string[]) => { nodeRes.setHeader(name, value); return res; },
            json: (data: any) => {
                if (nodeRes.writableEnded || refusalStands()) return;
                if (!nodeRes.headersSent) nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                nodeRes.end(isHead ? undefined : JSON.stringify(data));
            },
            send: (data: string | Uint8Array | ArrayBuffer) => {
                if (nodeRes.writableEnded || refusalStands()) return;
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
                if (refusalStands()) return;
                streaming = true;
                if (!nodeRes.writableEnded) nodeRes.write(chunk);
            },
            end: () => {
                if (refusalStands()) return;
                if (!nodeRes.writableEnded) nodeRes.end();
            },
        };

        if (!matched) {
            // ── The fallback seam ───────────────────────────────────────────
            // Guaranteed installed: the no-fallback case returned above.
            // Middlewares deliberately do NOT run here — they do not run for
            // an unmatched request on this adapter today either, and changing
            // that is a separate decision from installing this seam.
            const handler = fallback as RouteHandler;
            let threw = false;
            try {
                await handler(req, res as IHttpResponse);
            } catch {
                threw = true;
            }
            // [#24083] The fallback read a body this adapter refused: the
            // refusal is the answer on every arm (thrown, caught and answered,
            // caught and silent), as on the primary adapter, whose fallback
            // runs through the same `runHandler` as its routes.
            if (refusedBodyRead) return this.writeBodyRefusal(nodeRes, refusedBodyRead);
            if (threw) {
                // Prefer failing to falling back: a fallback that THREW is a
                // broken consumer, and reporting its failure as this adapter's
                // ordinary 404 would hide it behind the most unremarkable
                // status on the wire. Same body as the primary adapter.
                if (!nodeRes.writableEnded) {
                    if (!nodeRes.headersSent) {
                        nodeRes.statusCode = 500;
                        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                    }
                    nodeRes.end(JSON.stringify({
                        success: false,
                        error: { code: 'INTERNAL_ERROR', message: 'Fallback handler failed' },
                    }));
                }
                return;
            }
            // Answered (buffered or streamed) — that response stands.
            if (nodeRes.writableEnded || streaming) return;
            // Wrote nothing — the documented way to say "not mine". The
            // adapter's own unmatched answer stands, unchanged (guarantee 4).
            this.writeUnmatchedResponse(nodeRes, method, path);
            return;
        }

        try {
            for (const mw of this.middlewares) {
                let advanced = false;
                await mw(req, res as IHttpResponse, () => { advanced = true; });
                void advanced; // chain always continues — parity with the primary adapter
            }
            await matched.route.handler(req, res as IHttpResponse);
            if (refusedBodyRead) {
                this.writeBodyRefusal(nodeRes, refusedBodyRead);
                return;
            }
            // Handler resolved without producing a response and without
            // starting a stream (SSE handlers legitimately resolve while the
            // stream is still open — dispatcher drains it in the background).
            if (!nodeRes.writableEnded && !streaming) {
                nodeRes.statusCode = 500;
                nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
                nodeRes.end(JSON.stringify({
                    success: false,
                    error: { code: 'INTERNAL_ERROR', message: 'No response from handler' },
                }));
            }
        } catch (err: any) {
            if (refusedBodyRead) {
                this.writeBodyRefusal(nodeRes, refusedBodyRead);
                return;
            }
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
