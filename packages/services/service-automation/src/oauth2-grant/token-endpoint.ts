// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The OAuth2 token endpoint call (RFC 6749 §3.2, ADR-0143 D4)
 *
 * The one place a grant-bearing instance's token request is sent: a
 * `client_credentials` exchange (§4.4), an authorization code exchange
 * (§4.1.3, with the PKCE verifier, RFC 7636 §4.5) and a refresh (§6).
 *
 * **Client authentication** (S0 left the method to this slice; #28137): a
 * confidential client authenticates with HTTP Basic (`client_secret_basic`,
 * §2.3.1 — the method every authorization server MUST support), its id and
 * secret form-encoded first as §2.3.1 requires. A public client has no secret
 * and sends its `client_id` in the body (§3.2.1).
 *
 * **How a failure reads** — ADR-0143 D4's split between operation and grant:
 *   - no answer, a timeout, `429` or a `5xx` → {@link ConnectorUpstreamUnavailableError}
 *     (`CONNECTOR_UPSTREAM_UNAVAILABLE`), retried on the existing backoff;
 *   - `invalid_grant` (§5.2: the code or refresh token is invalid, expired or
 *     revoked) → {@link OAuth2GrantRefusedError}, which never leaves the
 *     service: the grant handle and the connect door turn it into their own
 *     refusal ("reconnect required", "the code was refused");
 *   - `invalid_client` / `unauthorized_client` → {@link OAuth2ClientRefusedError}:
 *     the client id or secret is wrong, which the instance's configuration fixes;
 *   - a redirect (`3xx`), anything else, or a `2xx` without a bearer
 *     `access_token` → {@link OAuth2TokenResponseError}.
 *
 * **A redirect is never followed.** The request carries the client secret
 * and, on a refresh, the refresh token; a `307`/`308` would replay that body
 * to wherever `Location` names — another host, or plain `http:` past the
 * https-only check the instance's `tokenUrl` passed. RFC 6749 §3.2 gives a
 * token endpoint no redirect to answer, so one is refused as a wrong answer
 * (the `tokenUrl` is not the endpoint itself), not retried as an outage.
 *
 * The last two carry the connector seam's `503 SERVICE_UNAVAILABLE` (the
 * shape `connectorCredentialRefusal` stamps), a standard code: no code of
 * this module's own reaches a dispatch.
 *
 * ⛔ The authorization server's own text is never carried: a token endpoint
 * that echoes a secret or token back would carry it into a degraded reason, a
 * log line or a refusal. A refusal names the instance and, at most, the
 * registered `error` code of §5.2.
 */

import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';

/** A token endpoint answer, reduced to what the grant keeps. */
export interface OAuth2TokenResponse {
    /** The access token — cached in process, never persisted (D3). */
    readonly accessToken: string;
    /** When it expires, in epoch ms; absent when the server did not say (§5.1 `expires_in` is optional). */
    readonly expiresAt?: number;
    /** A refresh token, when the server issued or rotated one. */
    readonly refreshToken?: string;
    /** The granted scope, when the server said (§5.1). */
    readonly scope?: string;
}

/** The client that authenticates at the token endpoint. */
export interface OAuth2Client {
    readonly clientId: string;
    /** Absent for a public client. */
    readonly clientSecret?: string;
}

/** One token request. */
export interface OAuth2TokenRequest {
    /** The connector instance, named in every refusal. */
    readonly connector: string;
    readonly tokenUrl: string;
    readonly client: OAuth2Client;
    /** The grant's own parameters (`grant_type` and the rest), form-encoded as given. */
    readonly params: Readonly<Record<string, string>>;
    /** Per-request deadline in ms (the instance's `requestTimeoutMs`, else {@link DEFAULT_TOKEN_TIMEOUT_MS}). */
    readonly timeoutMs?: number;
    /** The transport, for tests. Default the global `fetch`. */
    readonly fetch?: typeof fetch;
    /** The clock, for tests. Default `Date.now`. */
    readonly now?: () => number;
}

/** The token request deadline when the instance declares none. */
export const DEFAULT_TOKEN_TIMEOUT_MS = 15_000;

/** The `error` codes RFC 6749 §5.2 registers — the only server text a refusal may name. */
const REGISTERED_TOKEN_ERRORS = new Set([
    'invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope',
]);

/** The authorization server refused the grant itself: revoked, expired, or a code already spent (§5.2 `invalid_grant`). */
export class OAuth2GrantRefusedError extends Error {
    constructor(connector: string) {
        super(
            `the authorization server of connector instance '${connector}' refused its grant (invalid_grant): it was revoked, `
                + 'or expired with no usable refresh',
        );
        this.name = 'OAuth2GrantRefusedError';
    }
}

/**
 * The authorization server refused the client (§5.2 `invalid_client` /
 * `unauthorized_client`). A dispatch it ends reads as the connector seam's
 * `503 SERVICE_UNAVAILABLE`: the instance's configuration is wrong, which the
 * caller cannot change.
 */
export class OAuth2ClientRefusedError extends Error {
    readonly code = 'SERVICE_UNAVAILABLE';
    readonly status = 503;
    readonly statusCode = 503;
    constructor(connector: string, error: string) {
        super(
            `the authorization server of connector instance '${connector}' refused its client (${error}): check the instance's `
                + 'clientId and the client secret its credentialRef names',
        );
        this.name = 'OAuth2ClientRefusedError';
    }
}

/** Any other refusal, or an answer that is not a usable bearer token. A dispatch reads it as `503 SERVICE_UNAVAILABLE`, like the client's refusal. */
export class OAuth2TokenResponseError extends Error {
    readonly code = 'SERVICE_UNAVAILABLE';
    readonly status = 503;
    readonly statusCode = 503;
    constructor(message: string) {
        super(message);
        this.name = 'OAuth2TokenResponseError';
    }
}

/** RFC 6749 §2.3.1 / Appendix B: each half form-encoded before the Basic pair is built. */
function basicClientAuthorization(client: OAuth2Client & { clientSecret: string }): string {
    const encode = (v: string) => new URLSearchParams({ v }).toString().slice(2);
    return `Basic ${Buffer.from(`${encode(client.clientId)}:${encode(client.clientSecret)}`, 'utf8').toString('base64')}`;
}

/** The §5.2 `error` member, when it is a registered code. */
function registeredError(body: unknown): string | undefined {
    const error = (body as { error?: unknown } | null)?.error;
    return typeof error === 'string' && REGISTERED_TOKEN_ERRORS.has(error) ? error : undefined;
}

/**
 * Send one token request and read its answer. Throws one of the four errors
 * the module header names; never returns a partial answer.
 */
export async function requestOAuth2Token(request: OAuth2TokenRequest): Promise<OAuth2TokenResponse> {
    const fetchImpl = request.fetch ?? fetch;
    const now = request.now ?? Date.now;
    const { connector, client } = request;
    const body = new URLSearchParams(request.params);
    const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
    };
    if (client.clientSecret !== undefined && client.clientSecret.length > 0) {
        headers.authorization = basicClientAuthorization({ clientId: client.clientId, clientSecret: client.clientSecret });
    } else {
        body.set('client_id', client.clientId);
    }

    const sentAt = now();
    let response: Response;
    try {
        response = await fetchImpl(request.tokenUrl, {
            method: 'POST',
            headers,
            body: body.toString(),
            // Answered, never followed: see the module header.
            redirect: 'manual',
            signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS),
        });
    } catch (err) {
        throw new ConnectorUpstreamUnavailableError(
            `the token endpoint of connector instance '${connector}' did not answer`,
            { cause: err },
        );
    }

    // `manual` answers the 3xx itself (status 0 / `opaqueredirect` where the
    // runtime hides it); either way nothing was sent past the first hop.
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new OAuth2TokenResponseError(
            `the token endpoint of connector instance '${connector}' answered a redirect, which is not followed: the client `
                + 'secret and refresh token are sent only to the declared tokenUrl. Declare the endpoint the redirect names',
        );
    }

    let parsed: unknown;
    try {
        parsed = await response.json();
    } catch {
        parsed = undefined;
    }

    if (response.status === 429 || response.status >= 500) {
        throw new ConnectorUpstreamUnavailableError(
            `the token endpoint of connector instance '${connector}' answered HTTP ${response.status}`,
        );
    }
    if (!response.ok) {
        const error = registeredError(parsed);
        if (error === 'invalid_grant') throw new OAuth2GrantRefusedError(connector);
        if (error === 'invalid_client' || error === 'unauthorized_client' || response.status === 401) {
            throw new OAuth2ClientRefusedError(connector, error ?? `HTTP ${response.status}`);
        }
        throw new OAuth2TokenResponseError(
            `the token endpoint of connector instance '${connector}' refused the token request `
                + `(${error ?? `HTTP ${response.status}`})`,
        );
    }

    const answer = (parsed ?? {}) as {
        access_token?: unknown;
        token_type?: unknown;
        expires_in?: unknown;
        refresh_token?: unknown;
        scope?: unknown;
    };
    if (typeof answer.access_token !== 'string' || answer.access_token.length === 0) {
        throw new OAuth2TokenResponseError(
            `the token endpoint of connector instance '${connector}' answered without an access_token`,
        );
    }
    // §7.1: the type decides how the token is presented. Only a bearer token
    // (RFC 6750) is one a provider can send; the comparison is case-insensitive.
    if (typeof answer.token_type !== 'string' || answer.token_type.toLowerCase() !== 'bearer') {
        throw new OAuth2TokenResponseError(
            `the token endpoint of connector instance '${connector}' answered a token that is not a bearer token`,
        );
    }
    const expiresIn = typeof answer.expires_in === 'string' ? Number(answer.expires_in) : answer.expires_in;
    return {
        accessToken: answer.access_token,
        ...(typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
            // Measured from when the request was SENT, so the network time
            // shortens the token's life rather than lengthening it.
            ? { expiresAt: sentAt + expiresIn * 1000 }
            : {}),
        ...(typeof answer.refresh_token === 'string' && answer.refresh_token.length > 0 ? { refreshToken: answer.refresh_token } : {}),
        ...(typeof answer.scope === 'string' && answer.scope.length > 0 ? { scope: answer.scope } : {}),
    };
}
