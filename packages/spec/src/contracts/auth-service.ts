// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IAuthService - Authentication Service Contract
 *
 * Defines the interface for authentication and session management in ObjectStack.
 * Concrete implementations (better-auth, custom, LDAP, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete auth provider implementations.
 *
 * Aligned with CoreServiceName 'auth' in core-services.zod.ts.
 */

/**
 * Authenticated session user information
 */
export interface AuthUser {
    /** User identifier */
    id: string;
    /** Email address */
    email: string;
    /** Display name */
    name: string;
    /** Assigned position identifiers */
    positions?: string[];
    /** Current tenant identifier (multi-tenant) */
    tenantId?: string;
}

/**
 * Active session information
 */
export interface AuthSession {
    /** Session identifier */
    id: string;
    /** Associated user identifier */
    userId: string;
    /** Session expiry (ISO 8601) */
    expiresAt: string;
    /** Bearer token (if not using cookies) */
    token?: string;
}

/**
 * Authentication result returned by login/verify operations
 */
export interface AuthResult {
    /** Whether authentication succeeded */
    success: boolean;
    /** Authenticated user (if success) */
    user?: AuthUser;
    /** Active session (if success) */
    session?: AuthSession;
    /** Error message (if failure) */
    error?: string;
}

export interface IAuthService {
    /**
     * Handle an incoming HTTP authentication request
     * @param request - Standard Request object
     * @returns Standard Response object
     */
    handleRequest(request: Request): Promise<Response>;

    /**
     * Verify a session token or cookie and return the user
     * @param token - Bearer token or session identifier
     * @returns Auth result with user and session if valid
     */
    verify(token: string): Promise<AuthResult>;

    /**
     * Invalidate a session (logout)
     * @param sessionId - Session identifier to invalidate
     */
    logout?(sessionId: string): Promise<void>;

    /**
     * Get the current user from a request
     * @param request - Standard Request object
     * @returns Authenticated user or undefined
     */
    getCurrentUser?(request: Request): Promise<AuthUser | undefined>;

    /**
     * The MCP resource identifier (RFC 8707 `resource` / token `aud`) —
     * `<origin><apiPrefix>/mcp`.
     *
     * [#4127] Declared because `/mcp` already called it. The dispatcher's skill
     * route needs the canonical value the auth service derives from its own
     * `basePath`, precisely so the two cannot disagree about the API prefix;
     * its own comment says "the auth service owns the canonical value". It was
     * reached through `const authService: any` + `?.()`, which made the call
     * invisible to the type system AND accidentally safe — an absent method
     * returned `undefined` and the route silently fell back to deriving a URL
     * from the request host, so a real disagreement would have looked like
     * normal operation.
     *
     * @returns The absolute MCP resource URL
     */
    getMcpResourceUrl?(): string;

    /**
     * Absolute URL of the RFC 9728 protected-resource metadata document,
     * advertised in `WWW-Authenticate` on 401s from the MCP endpoint so clients
     * can bootstrap the OAuth flow. `null` when the OAuth track is off for this
     * deployment (the embedded AS disabled, or the origin fails the OAuth 2.1
     * transport rule) — API keys remain and nothing is advertised, fail-closed.
     *
     * [#4127] Same story as {@link getMcpResourceUrl}: called by `/mcp`,
     * implemented by the auth manager, declared by nobody.
     *
     * @returns The metadata URL, or `null` when the OAuth track is off
     */
    getMcpResourceMetadataUrl?(): string | null;

    /**
     * The underlying session API, when the provider mounts it DIRECTLY on
     * itself (the legacy shape). Prefer {@link getApi} — the shipped
     * `plugin-auth` registers an `AuthManager`, which has no `api` member at
     * all, so a caller that reads only this one gets `undefined` on every
     * current deployment.
     *
     * [#4127 batch 4] Declared because reading it without the `getApi()`
     * fallback silently disabled the project-membership gate: the read yielded
     * `undefined`, the caller treated that as "anonymous", and
     * `sys_environment_member` was never queried. Both shapes are on the
     * contract now so the two-step read is a checked expression rather than a
     * pair of guesses.
     */
    api?: AuthSessionApi;

    /**
     * Resolve the session API, creating the underlying auth instance on first
     * use (the lazy-plugin shape `AuthManager` implements). This is the
     * accessor callers should reach for; {@link api} is its legacy twin.
     */
    getApi?(): Promise<AuthSessionApi | undefined>;

    /**
     * Whether the deployment's auth gate is live, i.e. whether unauthenticated
     * requests should be challenged at all. Synchronous and cheap by contract —
     * the implementation keeps a TTL-refreshed snapshot precisely so every
     * request can ask.
     *
     * [#4127 batch 4] Implemented by `AuthManager` and probed identically by
     * the dispatcher and `packages/rest` — two independent callers agreeing on
     * a member the contract never mentioned.
     */
    isAuthGateActive?(): boolean;

    /**
     * Verify an OAuth 2.1 access token issued by this deployment's embedded
     * authorization server, for the MCP surface (#2698). Resolves to the
     * token's principal, or a falsy value when the token is
     * unknown/expired/revoked or carries the wrong audience — callers fail
     * CLOSED on anything but a verified result.
     *
     * [#4127 batch 4] Implemented by `AuthManager`; the execution-context
     * resolver has always called it through `any`.
     */
    verifyMcpAccessToken?(token: string): Promise<{ userId: string; scopes: string[]; clientId?: string } | undefined>;
}

/**
 * The slice of the session API the platform actually uses.
 *
 * [#4127 batch 4] Deliberately NOT a re-declaration of better-auth's handle,
 * which is far wider and belongs to that library. Every dispatcher-side reader
 * calls exactly `getSession({ headers })` and reads exactly the fields below,
 * so that is what is declared. Widening this is for whoever needs more, with
 * the call site to prove it.
 */
export interface AuthSessionApi {
    getSession?(input: { headers: unknown }): Promise<{
        user?: { id?: string };
        session?: { userId?: string; activeOrganizationId?: string };
    } | undefined>;
}
