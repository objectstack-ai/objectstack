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

import type { ExecutionContext } from '../kernel/execution-context.zod.js';

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

/**
 * [#23367, ruling A] The API-key lifecycle policy, as the auth service holds
 * it ({@link IAuthService.resolveApiKeyLifecyclePolicy}). Every number is in
 * whole days and already defaulted; the defaults are the ruling's (90, 365,
 * 90).
 */
export interface ApiKeyLifecyclePolicy {
    /** Days a key lives when its signing names no `expires_at`. */
    defaultExpiryDays: number;
    /** The longest life a signing may ask for, in days from the signing; a longer `expires_at` is refused. */
    maxExpiryDays: number;
    /**
     * Days without a recorded use (`sys_api_key.last_used_at`) after which a
     * key is refused as inactive. `0` turns the inactivity expiry off.
     */
    inactivityDays: number;
    /**
     * When this deployment started enforcing the policy (ISO 8601), recorded
     * once and kept in the `auth` settings. A key with no recorded use counts
     * its inactivity from here (or from its own signing, when later), and a
     * key signed with no expiry expires a year after it. Absent when it could
     * not be recorded (no settings service): such keys are then judged on
     * their own row alone.
     */
    startedAt?: string;
}

/**
 * [#23772] The longest life, in seconds, of a session minted by
 * {@link IAuthService.mintPrincipalSession}. A fixed ceiling, not a setting:
 * a caller may ask for less, and an ask for more is refused rather than
 * clamped. Long enough for one headless render (a browser launch, a page
 * load and a print, measured at about 1.3 s on a local executable), short
 * enough that a credential which leaves the process expires on its own.
 */
export const PRINCIPAL_SESSION_MAX_TTL_SECONDS = 120;

/** [#23772] What a caller of {@link IAuthService.mintPrincipalSession} may ask. */
export interface PrincipalSessionMintOptions {
    /**
     * The session's life in whole seconds, from 1 to
     * {@link PRINCIPAL_SESSION_MAX_TTL_SECONDS}; the ceiling when omitted. A
     * value outside that range is refused (`VALIDATION_ERROR` / `400`).
     */
    ttlSeconds?: number;
}

/**
 * [#23772] The session cookie of a minted principal session, under the name
 * and attributes the auth service gives its own session cookie (the
 * deployment's cookie prefix and, on a secure deployment, `__Secure-`).
 */
export interface PrincipalSessionCookie {
    /** The cookie name. */
    name: string;
    /** The signed cookie value, ready to send. */
    value: string;
    /** The cookie path. */
    path: string;
    /** Whether the cookie is `HttpOnly`. */
    httpOnly: boolean;
    /** Whether the cookie is `Secure`. */
    secure: boolean;
    /** The `SameSite` attribute, when the auth service sets one. */
    sameSite?: 'lax' | 'strict' | 'none';
    /** The cookie domain, when the auth service sets one (cross-subdomain cookies). */
    domain?: string;
}

/** [#23772] A short-lived session minted for the requesting user's own principal. */
export interface PrincipalSession {
    /** The session as a bearer credential: send it as `Authorization: Bearer <token>`. */
    token: string;
    /** The same session as the auth service's session cookie. */
    cookie: PrincipalSessionCookie;
    /** When the session ends (ISO 8601). Reading the session never moves it. */
    expiresAt: string;
    /**
     * End the session now. Afterwards neither {@link token} nor
     * {@link cookie} resolves a session. Bound to this session alone, and
     * safe to call more than once; call it in a `finally`.
     */
    revoke(): Promise<void>;
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
     * [ADR-0069 · #23287, ruling C′ item 3] Every authentication-policy posture
     * `userId` holds right now, most urgent first, or `[]` for a user no
     * policy holds. The ONE per-user posture computation: the session gate
     * carries its first entry on `user.authGate`, and the API-key admission
     * seam (`resolveApiKeyAdmission`, `@objectstack/core`) asks it for a key's
     * owner and refuses the key on an `account`-scope entry
     * (`AUTH_GATE_SCOPES`). Keyed by user id, so a caller outside the session
     * and the key seam can ask it too.
     *
     * `organizationId` is the organization the credential operates in (a
     * session's active organization, an API key's own organization): an
     * organization may require MFA above the deployment-wide floor.
     *
     * Cheap when no policy is enabled (no read at all). A lookup that fails
     * answers `[]`, exactly as the session gate fails open on it, so a
     * transient fault never holds a compliant user. A REFUSAL is not a
     * revocation: the answer changes the moment the user remediates, with
     * nothing reissued.
     *
     * @param userId - The user whose standing is asked
     * @param options - The organization the credential operates in, if any
     * @returns The held postures, most urgent first
     */
    resolveUserAuthGates?(
        userId: string,
        options?: { organizationId?: string },
    ): Promise<readonly NonNullable<ExecutionContext['authGate']>[]>;

    /**
     * [#23367, ruling A] The API-key lifecycle policy in force, read from the
     * auth configuration (the `auth` settings keys `api_key_*`, bound into the
     * service). Two readers, one source: the signing door (`POST /keys`,
     * `@objectstack/runtime`) applies the default expiry and refuses a longer
     * one than the ceiling, and the key-admission seam
     * (`resolveApiKeyAdmission`, `@objectstack/core`) judges inactivity and
     * the grace of keys signed with no expiry.
     *
     * Synchronous and cheap: the answer is the configuration already held in
     * memory, so a transport may ask it on every request that carries a key.
     *
     * @returns The policy, every number already defaulted
     */
    resolveApiKeyLifecyclePolicy?(): ApiKeyLifecyclePolicy;

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
    verifyMcpAccessToken?(token: string): Promise<{
        userId: string;
        scopes: string[];
        clientId?: string;
        /**
         * The organization the user's OAuth consent bound (the consenting
         * user's current organization at the moment of consent), read from
         * the access token's `organization_id` claim.
         *
         * Absent when no consent bound one: a token minted before consents
         * bound an organization. Absent means the principal resolves with no
         * organization, so only its global grants apply.
         *
         * A claim, not an authorization. The caller vets it on every request
         * by the rule that vets a session's active organization
         * (`vetOrganizationClaim`, `@objectstack/core`): once no current
         * membership backs it, the principal resolves with no organization
         * (global grants only, so tenant reads come back empty and tenant
         * writes are refused), never in another one. The token acts in this
         * one organization: ⛔ never the union of the user's organizations,
         * and ⛔ never the organization the user's browser session has
         * selected now. Under ADR-0090 D10 it is the organization the
         * delegator's grants are resolved in.
         */
        organizationId?: string;
    } | undefined>;

    /**
     * [#23772] Mint a short-lived session for the requesting user's OWN
     * principal, so an in-process service can act as that user through a
     * door that only accepts a session (a headless browser rendering a page
     * the user may see). In-process only; no HTTP route reaches it.
     *
     * Human principals only. Every refusal is thrown before anything is
     * minted, carrying `code` and `status`: a context with no user, a system
     * context, or a principal that is not `human` answers
     * `PERMISSION_DENIED` / `403`, as does a user row that is not a human
     * (the system user) or is banned; a principal an authentication policy
     * holds (`authGate`, carried or computed now) answers `403` with the
     * posture's own code; a `ttlSeconds` outside its range answers
     * `VALIDATION_ERROR` / `400`.
     *
     * The session lives at most {@link PRINCIPAL_SESSION_MAX_TTL_SECONDS}, is
     * never renewed by a read on either lane (cookie or bearer), carries the
     * context's `tenantId` as its active organization, and ends at
     * {@link PrincipalSession.revoke}.
     *
     * @param context - The requesting user's execution context
     * @param options - The session's life, at most the ceiling
     * @returns The session as a bearer token and a cookie, with its revoke
     */
    mintPrincipalSession?(context: ExecutionContext, options?: PrincipalSessionMintOptions): Promise<PrincipalSession>;
}

/**
 * The slice of the session API the platform actually uses.
 *
 * [#4127 batch 4] Deliberately NOT a re-declaration of better-auth's handle,
 * which is far wider and belongs to that library. What is declared is exactly
 * the input the in-process readers send and exactly the fields below that they
 * read. Widening this is for whoever needs more, with the call site to prove it.
 *
 * [#22384] `getSession`'s input has two read forms, decided by what the
 * request carries:
 *
 * - a request carrying a better-auth session cookie (a browser) reads with
 *   `{ headers, query: { disableRefresh: true } }` — the session then renews
 *   only on the `get-session` route, which re-issues the cookie, so cookie
 *   expiry and session expiry cannot split;
 * - a bearer-only request (the SDK outside a browser, the CLI) reads with
 *   `{ headers }` alone, renewal included.
 *
 * Their one source is `inProcessSessionReadInput(headers)` in
 * `@objectstack/types` (`packages/types/src/in-process-session-read.ts`):
 * read with `api.getSession(inProcessSessionReadInput(headers))`, not with a
 * hand-built input — a hand-built `{ headers }` on a cookie-carrying request
 * renews the session behind a cookie nobody re-issues. `query` is declared
 * because readers send it (#22258): `rest-server.ts` in `@objectstack/rest`
 * (twice); in `@objectstack/runtime`, `http-dispatcher.ts` (twice),
 * `security/resolve-session-principal.ts` and
 * `security/resolve-execution-context.ts`; `current-user-endpoints.ts` in
 * `@objectstack/plugin-hono-server`; and in `@objectstack/cloud-connection`,
 * `cloud-connection-plugin.ts` and `marketplace-install-local-plugin.ts`
 * (twice). `packages/types/src/in-process-session-read.contract.test.ts`
 * holds the helper's return inside this declaration, key for key.
 *
 * [#24196] Each result field beyond `user.id`, `session.userId` and
 * `session.activeOrganizationId` is declared for the reader named on it, typed
 * as that reader takes it. Read undeclared, through `any` or a cast, a field
 * better-auth drops or renames compiles and reads `undefined` — for
 * `impersonatedBy`, an impersonation refusal switched off.
 *
 * [#24222] The other in-process readers read the result as declared here too.
 * None reads a top-level `activeOrganizationId`: the read answers
 * `{ user, session }`, and the active organization is
 * `session.activeOrganizationId`.
 */
export interface AuthSessionApi {
    getSession?(input: { headers: unknown; query?: { disableRefresh?: boolean } }): Promise<{
        user?: {
            id?: string;
            /** Read by `resolveAuthzContext`'s session arm (`@objectstack/core`) onto `ctx.email`. */
            email?: string;
            /**
             * better-auth's projection of `sys_user.name`. Read by `dispatcher-plugin`'s
             * concrete AI-route `req.user` resolver (`@objectstack/runtime`) as the
             * actor's display name.
             */
            name?: string;
            /**
             * The ADR-0069 posture plugin-auth's `customSession` attaches. Read by
             * `normalizeAuthGate` (`@objectstack/core`) from `resolveAuthzContext`'s
             * session arm, which validates it against the closed posture vocabulary,
             * so it is declared as that reader takes it: unvalidated.
             */
            authGate?: unknown;
            /**
             * The ADR-0068 D2 platform-admin posture rung plugin-auth's `customSession`
             * derives (`false` when not held). Read by `judgePlatformAdmin`
             * (`@objectstack/plugin-auth`, through `isPlatformAdminUser`), which admits
             * on `true` alone, so an absent field refuses.
             */
            isPlatformAdmin?: boolean;
            /**
             * better-auth's `admin` plugin role scalar (`type: 'string'`, `required: false`,
             * so a row may hold it as null). Read by `judgePlatformAdmin`
             * (`@objectstack/plugin-auth`, through `isPlatformAdminUser`) as the legacy
             * back-compat signal, which admits on `'admin'` alone, so an absent field refuses.
             */
            role?: string | null;
        };
        session?: {
            userId?: string;
            activeOrganizationId?: string;
            /** The session ROW id. Read by `resolveAuthzContext`'s session arm for its dropped-claim log line. */
            id?: string;
            /** The session credential. Read by `resolveAuthzContext`'s session arm onto `ctx.accessToken`. */
            token?: string;
            /**
             * The administrator who started an impersonation session (better-auth's
             * admin plugin; stored as the nullable `sys_session.impersonated_by`).
             * Read by the print door's `impersonatorOf` (`@objectstack/service-print`),
             * which refuses a print from an impersonation session.
             */
            impersonatedBy?: string | null;
        };
    } | undefined>;
}
