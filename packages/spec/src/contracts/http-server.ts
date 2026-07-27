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
 * Middleware function
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
}
