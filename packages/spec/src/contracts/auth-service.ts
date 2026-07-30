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
}
