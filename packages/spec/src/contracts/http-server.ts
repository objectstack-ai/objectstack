// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IHttpServer - Standard HTTP Server Interface
 * 
 * Abstract interface for HTTP server capabilities.
 * This allows plugins to interact with HTTP servers without knowing
 * the underlying implementation (Express, Fastify, Hono, etc.).
 * 
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete HTTP framework implementations.
 */

/**
 * Generic HTTP Request type
 * Abstraction over framework-specific request objects
 */
export interface IHttpRequest {
    /** Request path parameters */
    params: Record<string, string>;
    /** Request query parameters */
    query: Record<string, string | string[]>;
    /** Request body (parsed — JSON or form data when applicable) */
    body?: any;
    /** Request headers */
    headers: Record<string, string | string[]>;
    /** HTTP method */
    method: string;
    /** Request path */
    path: string;
    /**
     * Raw body accessor for binary uploads (file streams, multipart parts).
     * Implementations should consume the underlying request stream lazily so
     * handlers that only need `body` do not pay the parsing cost. May be
     * undefined when the underlying framework cannot expose the raw stream.
     */
    rawBody?: () => Promise<Buffer>;

    /**
     * The TRANSPORT's own peer address for this request — the socket's remote
     * address, never a header.
     *
     * CONTRACT (#4910): this member is the unforgeable half of caller
     * identification. `X-Forwarded-For` and friends live in {@link headers} and
     * are believable only when the deployment declares `server.trustProxy`;
     * this one a client cannot influence, which is why the inbound rate limiter
     * keys anonymous traffic off it by default.
     *
     * Optional because not every runtime exposes it (an edge/Workers host may
     * have no socket at all). Consumers MUST degrade deliberately when it is
     * absent — never substitute a header for it silently, and never fall open.
     */
    remoteAddress?: string;
}

/**
 * Generic HTTP Response type
 * Abstraction over framework-specific response objects
 */
export interface IHttpResponse {
    /**
     * Send a JSON response
     * @param data - Data to send
     */
    json(data: any): void | Promise<void>;
    
    /**
     * Send a text/html response
     * @param data - Data to send
     */
    send(data: string | Uint8Array | ArrayBuffer): void | Promise<void>;
    
    /**
     * Set HTTP status code
     * @param code - HTTP status code
     */
    status(code: number): IHttpResponse;
    
    /**
     * Set response header
     * @param name - Header name
     * @param value - Header value (string or array of strings for multi-value headers)
     */
    header(name: string, value: string | string[]): IHttpResponse;

    /**
     * Stream a chunk to the client without ending the response (SSE / chunked
     * transfer). CONTRACT (#3607, ADR-0076 OQ#10): consumers that emit
     * streaming results (the dispatcher's `type: 'stream'` result for AI
     * routes, SSE endpoints) feature-detect this member and fall back to
     * buffered `send()` when absent. Implementations that provide `write`
     * MUST also provide `end`, MUST flush headers on first write, and MUST
     * NOT buffer chunks until `end`. Cross-adapter behavior is locked by
     * `@objectstack/http-conformance` (SSE assertions).
     */
    write?(chunk: string | Uint8Array): void | Promise<void>;

    /**
     * End a streaming response started with {@link write}. Required whenever
     * `write` is provided — see the streaming contract on `write`.
     */
    end?(): void | Promise<void>;
}

/**
 * Route handler function
 */
export type RouteHandler = (
    req: IHttpRequest,
    res: IHttpResponse
) => void | Promise<void>;

/**
 * Middleware function.
 *
 * ## Contract (#4910)
 *
 * A middleware either **continues** the chain by calling `next()`, or
 * **short-circuits** it by writing a response (`res.status(…).json(…)` /
 * `.send(…)`) and NOT calling `next()`. Doing neither is pass-through, so a
 * forgotten branch cannot black-hole a request. Implementations MUST honour the
 * short-circuit: the whole point of the seam is that a gate — rate limiting,
 * maintenance mode — can answer instead of the route.
 *
 * Two limits every implementation shares, stated here so consumers do not
 * discover them per adapter:
 *
 *  - `req.body` is NOT populated. Parsing it here would consume the stream
 *    before the route handler that owns it.
 *  - Middleware must be registered BEFORE the routes it should guard. Register
 *    in a plugin's `init()` (kernel Phase 1); every route is mounted in some
 *    plugin's `start()` (Phase 2), so this ordering is automatic.
 */
export type Middleware = (
    req: IHttpRequest,
    res: IHttpResponse,
    next: () => void | Promise<void>
) => void | Promise<void>;

/**
 * IHttpServer - HTTP Server capability interface
 *
 * Defines the contract for HTTP server implementations.
 * Concrete implementations (Express, Fastify, Hono) should implement this interface.
 *
 * ## Unmatched-request semantics (CONTRACT, #3607 / ADR-0076 OQ#10)
 *
 * Validated identically across adapters by `@objectstack/http-conformance`
 * (packages/qa/http-conformance) — new adapters MUST pass that suite:
 *
 * - A request whose PATH matches no registered route answers **404** with the
 *   shared not-found error body (the `errors.zod` envelope), never an
 *   adapter-native error page.
 * - A request whose path matches a route but whose METHOD does not answers
 *   **405** and MUST include an `Allow` header listing the methods registered
 *   for that path.
 */
export interface IHttpServer {
    /**
     * Register a GET route handler
     * @param path - Route path (e.g., '/api/users/:id')
     * @param handler - Route handler function
     */
    get(path: string, handler: RouteHandler): void;
    
    /**
     * Register a POST route handler
     * @param path - Route path
     * @param handler - Route handler function
     */
    post(path: string, handler: RouteHandler): void;
    
    /**
     * Register a PUT route handler
     * @param path - Route path
     * @param handler - Route handler function
     */
    put(path: string, handler: RouteHandler): void;
    
    /**
     * Register a DELETE route handler
     * @param path - Route path
     * @param handler - Route handler function
     */
    delete(path: string, handler: RouteHandler): void;
    
    /**
     * Register a PATCH route handler
     * @param path - Route path
     * @param handler - Route handler function
     */
    patch(path: string, handler: RouteHandler): void;
    
    /**
     * Register middleware
     * @param path - Optional path to apply middleware to (if omitted, applies globally)
     * @param handler - Middleware function
     */
    use(path: string | Middleware, handler?: Middleware): void;
    
    /**
     * Start the HTTP server
     * @param port - Port number to listen on
     * @returns Promise that resolves when server is ready
     */
    listen(port: number): Promise<void>;
    
    /**
     * Stop the HTTP server
     * @returns Promise that resolves when server is stopped
     */
    close?(): Promise<void>;

    /**
     * The port the server is actually bound to. CONTRACT (#3607, ADR-0076
     * OQ#10): after `listen()` resolves, implementations that provide this
     * member MUST return the real bound port — in particular when `listen(0)`
     * requested an ephemeral port (test harnesses and the conformance suite
     * depend on this to address the server). Before `listen()` the return
     * value is unspecified.
     */
    getPort?(): number;

    /**
     * The LIVE mount table: every `(method, pattern)` pair registered on THIS
     * server, in registration order.
     *
     * ## Why this is on the contract (#7526)
     *
     * Four route ledgers in this repo DECLARE what each surface serves, and
     * every guard built on them (#3563 / #3587 / #3636 / #3642) reads the union
     * of those declarations as if it were an OBSERVATION of what is mounted.
     * It is not. `GET /meta/objects/:name/state/:field` sat in
     * `route-ledger.ts` while no registrar mounted it, so the SDK guard passed
     * it and the route 404'd at runtime — and the same build shipped two more
     * of the same defect. A declaration cannot audit itself; something has to
     * report what the server really did. That is this member.
     *
     * ## Contract
     *
     * - Every pattern a consumer registered through {@link get} / {@link post}
     *   / {@link put} / {@link delete} / {@link patch} appears, spelled exactly
     *   as it was passed (adapters must not normalize it into a private
     *   dialect) — a caller compares these strings against its own route table.
     * - The order is REGISTRATION order, which for first-match routers is also
     *   priority order. Do not sort it.
     * - Routes an adapter mounts on its framework-native handle behind
     *   {@link getRawApp} are outside this table by construction, and so are
     *   {@link use} middleware and the {@link setFallbackHandler} seam: this
     *   answers "what routes did I register", not "what paths might respond".
     * - The returned array is the caller's; mutating it must not affect the
     *   server.
     *
     * Optional and feature-detected, like {@link getRawApp} — an adapter that
     * keeps no record simply omits it. A consumer that needs the answer for
     * correctness must FAIL when it is absent, never skip: a parity gate that
     * quietly passes because it could not look is the failure it exists to
     * catch.
     */
    getMountedRoutes?(): ReadonlyArray<{ method: string; pattern: string }>;

    /**
     * Which registered route actually ANSWERS a concrete request — the
     * router's own verdict, not a re-implementation of its matching.
     *
     * ## Why registration is not reachability (#7526)
     *
     * On a first-match router, a literal route registered AFTER a catch-all
     * sibling that also matches its path is mounted and unreachable. Measured
     * against Hono: with `GET /api/v1/meta/:type` registered first, a later
     * `GET /api/v1/meta/types` never runs — `/meta/types` answers from
     * `:type`, with a plausible 200 that no client can tell from an empty
     * result. So {@link getMountedRoutes} containing a pattern is NECESSARY
     * and not SUFFICIENT evidence that the pattern serves; a consumer probes a
     * concrete path through this member and checks it gets back the pattern it
     * expected.
     *
     * ## Contract
     *
     * - `path` is a concrete request path (`/api/v1/meta/types`), not a
     *   pattern. The return value IS a pattern — one of the entries
     *   {@link getMountedRoutes} reports, `===`-comparable to it.
     * - The verdict must come from the same routing machinery that serves
     *   traffic. An adapter that answers from a private copy of the rules can
     *   drift from itself, which is this member's whole subject.
     * - `undefined` means no registered route matches, i.e. the request would
     *   reach the adapter's unmatched-request answer (404/405). It does NOT
     *   mean "unknown": an adapter that cannot ask its router omits the member
     *   rather than returning `undefined`.
     * - Read-only. Resolving a route must not run its handler or any
     *   middleware.
     *
     * Optional and feature-detected, with the same fail-don't-skip rule as
     * {@link getMountedRoutes}.
     */
    resolveMountedRoute?(method: string, path: string): { method: string; pattern: string } | undefined;

    /**
     * The underlying framework's own app object (Hono's `Hono`, Express's
     * `Express`, …) — THE deliberate framework-specific escape hatch on this
     * otherwise framework-agnostic contract.
     *
     * [#4251] Declared here because four independent consumers were each
     * declaring it locally (`IHttpServer & { getRawApp?(): any }` in
     * cloud-connection ×2, metadata's HMR routes, and cloud's serverless
     * node-server) — four copies of one truth, which is the failure mode that
     * produced the false `http.server` lint exemption. The return type is
     * `any` ON PURPOSE and only here: the handle's real type belongs to the
     * framework, and naming it would give this contract a framework
     * dependency. Consumers that mount framework-native routes feature-detect
     * this member and degrade when it is absent — an adapter is NOT required
     * to expose its internals.
     */
    getRawApp?(): any;

    /**
     * Install the LAST-RESORT handler: the one invoked for a request that
     * matched none of the explicitly registered routes.
     *
     * ## Contract (#5040 §1-C)
     *
     * Two guarantees, and they are the whole reason this seam exists rather
     * than a wildcard route:
     *
     *  1. **It runs only after every explicitly registered route has missed.**
     *     Not "usually last", not "last if you register it late" — a fallback
     *     is structurally incapable of shadowing a registered route, so this
     *     member carries ZERO registration-order dependency. That matters
     *     because the alternative (mounting `${prefix}/*` wildcards) is
     *     decided by first-registration-wins across plugin `start()` order,
     *     the exact ADR-0076 D11 hazard "one route, one owner" exists to
     *     prevent. Implementations map this onto their framework's own
     *     not-found hook (Hono's `app.notFound`), never onto a route.
     *  2. **`req.body` IS readable here.** The handler receives a fully
     *     populated {@link IHttpRequest}, body included — unlike the
     *     {@link Middleware} seam installed by {@link use}, whose contract
     *     explicitly does NOT populate `body` (parsing it there would consume
     *     the request stream before the route handler that owns it). This is
     *     the difference that makes `use()` unusable for the dynamic-endpoint
     *     case and this member necessary: a declared endpoint backed by a flow
     *     or a `create` operation must read the request body.
     *
     * Calling this more than once REPLACES the previous handler — there is one
     * fallback, not a chain; a host that needs to compose behaviours composes
     * them inside its own handler. A handler that writes no response leaves the
     * adapter's standard unmatched-request answer in place (the 404/405
     * semantics documented on this interface).
     *
     * Optional, and feature-detected by consumers with
     * `typeof server.setFallbackHandler === 'function'` — an adapter that
     * cannot express a not-found hook simply omits it, and the consumer
     * degrades to the adapter's own unmatched-request answer.
     *
     * @param handler - The handler to invoke for otherwise-unmatched requests
     */
    setFallbackHandler?(handler: RouteHandler): void;
}
