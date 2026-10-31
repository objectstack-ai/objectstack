// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0143 D2.1 — the MCP authorization flow for a `provider: 'mcp'` instance
 * over an http transport that leaves its OAuth endpoints, or its client, to
 * discovery.
 *
 * Run once per connect, before the authorization request is built:
 *
 * 1. **Protected-resource metadata** (RFC 9728) of the MCP server: the
 *    path-aware well-known URL first, then the root one. Its `resource` must be
 *    the server's own URL, or a prefix of it on the same origin; it is the
 *    `resource` indicator (RFC 8707) every authorization and token request then
 *    carries. Its first `authorization_servers` entry is the issuer.
 * 2. **Authorization-server metadata** (RFC 8414, then OpenID Connect
 *    discovery) of that issuer. Its `issuer` must be the one asked for (RFC 8414
 *    §3.3), it must name both endpoints, and it must list `S256` in
 *    `code_challenge_methods_supported`: PKCE is always on, so a server that
 *    does not say it supports it is refused (MCP authorization, "Authorization
 *    Server Metadata Discovery").
 * 3. **The client.** A declared `clientId` is used as is (the pre-registered
 *    form, e.g. a vendor whose server has no dynamic registration). Otherwise
 *    the client is registered (RFC 7591) at the server's
 *    `registration_endpoint` as a public client (`token_endpoint_auth_method:
 *    none`, PKCE protecting the code) for the deployment's one redirect URI.
 *    A server that issues a client secret anyway is answered with it.
 *
 * Every URL on the way, the MCP server's included, must be `https:` (plain
 * `http:` only to a loopback host): the code, the refresh token and the
 * client secret travel to them. No request follows a redirect, every request
 * has a deadline, and no document text, token or secret is quoted in an
 * error. No answer, a `429` or a `5xx` is operational
 * (`ConnectorUpstreamUnavailableError`, without its cause); a document that
 * does not say what the flow needs is {@link McpAuthorizationRefusedError}.
 */

import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import { isSecureOAuth2Endpoint } from './endpoint-transport.js';
import { DEFAULT_TOKEN_TIMEOUT_MS } from './token-endpoint.js';

/** The OAuth client an MCP instance's connection authorizes with: discovered endpoints, and a declared or registered client. */
export interface McpAuthorizationClient {
    /** The authorization server's `issuer`; a callback's `iss` must equal it (RFC 9207). */
    readonly issuer: string;
    readonly authorizationUrl: string;
    readonly tokenUrl: string;
    /** The resource indicator (RFC 8707): the MCP server's protected-resource identifier. */
    readonly resource: string;
    readonly clientId: string;
    /** Only when the registration answered one; a public client has none. */
    readonly clientSecret?: string;
    /** `true` when the client was registered by this flow (RFC 7591), `false` when it was declared. */
    readonly registered: boolean;
}

/** What the instance declares, beside its transport URL. A declared field wins over a discovered one. */
export interface McpAuthorizationDeclared {
    readonly authorizationUrl?: string;
    readonly tokenUrl?: string;
    readonly clientId?: string;
    /** The resolved client secret of a declared confidential client. */
    readonly clientSecret?: string;
    readonly resource?: string;
}

export interface McpAuthorizationRequest {
    /** The connector instance, named in every refusal. */
    readonly connector: string;
    /** The MCP server's streamable-http endpoint, as `providerConfig.transport.url` declares it. */
    readonly serverUrl: string;
    readonly declared: McpAuthorizationDeclared;
    /** The deployment's fixed redirect URI the registration names. */
    readonly redirectUri: string;
    /** The scopes the instance declares; registered as the client's `scope`. */
    readonly scopes?: readonly string[];
    readonly clientName?: string;
    readonly timeoutMs?: number;
    readonly fetch?: typeof fetch;
}

/** A metadata document or a registration answer that does not give the flow what it needs: configuration, not operation. */
export class McpAuthorizationRefusedError extends Error {
    readonly code = 'VALIDATION_ERROR';
    readonly status = 400;
    readonly statusCode = 400;
    constructor(connector: string, detail: string) {
        super(`the MCP authorization flow of connector instance '${connector}' cannot run: ${detail}`);
        this.name = 'McpAuthorizationRefusedError';
    }
}

/** The RFC 7591 §3.2.2 error codes — the only registration-server text a refusal may name. */
const REGISTERED_REGISTRATION_ERRORS = new Set([
    'invalid_redirect_uri', 'invalid_client_metadata', 'invalid_software_statement', 'unapproved_software_statement',
]);

/** The URL without its fragment and without a trailing slash on a non-root path. */
function canonical(url: URL): string {
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '';
    return `${url.origin}${path}${url.search}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type Fetched = { kind: 'found'; body: Record<string, unknown> } | { kind: 'absent' };

/**
 * Read one JSON document. A `404` (or `400`/`401`/`403`/`405`, which some
 * servers answer an unknown well-known path with) is "not here"; no answer,
 * `429` or `5xx` is operational; anything else that is not a JSON object is
 * the step's refusal.
 */
async function fetchDocument(
    request: McpAuthorizationRequest,
    url: string,
    step: string,
): Promise<Fetched> {
    const fetchImpl = request.fetch ?? fetch;
    let response: Response;
    try {
        response = await fetchImpl(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS),
        });
    } catch {
        throw new ConnectorUpstreamUnavailableError(
            `the ${step} of connector instance '${request.connector}' did not answer`,
        );
    }
    if (response.status === 429 || response.status >= 500) {
        throw new ConnectorUpstreamUnavailableError(
            `the ${step} of connector instance '${request.connector}' answered HTTP ${response.status}`,
        );
    }
    if ([400, 401, 403, 404, 405].includes(response.status)) return { kind: 'absent' };
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        body = undefined;
    }
    if (!response.ok || !isObject(body)) {
        throw new McpAuthorizationRefusedError(request.connector, `its ${step} answered HTTP ${response.status} without a JSON document`);
    }
    return { kind: 'found', body };
}

/** The RFC 9728 well-known URLs of a resource: path-aware first, then the root. */
export function protectedResourceMetadataUrls(serverUrl: URL): string[] {
    const path = serverUrl.pathname.replace(/\/+$/, '');
    const urls = [];
    if (path.length > 0) urls.push(`${serverUrl.origin}/.well-known/oauth-protected-resource${path}`);
    urls.push(`${serverUrl.origin}/.well-known/oauth-protected-resource`);
    return urls;
}

/** The RFC 8414 / OpenID Connect discovery URLs of an issuer, in the order the MCP authorization spec gives. */
export function authorizationServerMetadataUrls(issuer: URL): string[] {
    const path = issuer.pathname.replace(/\/+$/, '');
    if (path.length === 0) {
        return [
            `${issuer.origin}/.well-known/oauth-authorization-server`,
            `${issuer.origin}/.well-known/openid-configuration`,
        ];
    }
    return [
        `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
        `${issuer.origin}/.well-known/openid-configuration${path}`,
        `${issuer.origin}${path}/.well-known/openid-configuration`,
    ];
}

/** A URL member of a metadata document that must be secure; refused by name otherwise. */
function secureUrl(request: McpAuthorizationRequest, doc: Record<string, unknown>, key: string, where: string): string {
    const value = doc[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new McpAuthorizationRefusedError(request.connector, `its ${where} names no \`${key}\``);
    }
    if (!isSecureOAuth2Endpoint(value)) {
        throw new McpAuthorizationRefusedError(
            request.connector,
            `its ${where} names a \`${key}\` that is not https (plain http is accepted only to a loopback host)`,
        );
    }
    return value;
}

/** Step 1: the protected-resource metadata, its resource indicator and the issuer. */
async function discoverProtectedResource(request: McpAuthorizationRequest, serverUrl: URL): Promise<{ resource: string; issuer: string }> {
    for (const url of protectedResourceMetadataUrls(serverUrl)) {
        const found = await fetchDocument(request, url, 'MCP server\'s protected-resource metadata');
        if (found.kind === 'absent') continue;
        const doc = found.body;
        const resource = secureUrl(request, doc, 'resource', 'protected-resource metadata');
        const parsed = new URL(resource);
        const server = canonical(serverUrl);
        const named = canonical(parsed);
        if (parsed.origin !== serverUrl.origin || !(server === named || server.startsWith(`${named}/`))) {
            throw new McpAuthorizationRefusedError(
                request.connector,
                'its protected-resource metadata names a `resource` other than the MCP server the instance declares',
            );
        }
        const servers = doc.authorization_servers;
        if (!Array.isArray(servers) || servers.length === 0 || typeof servers[0] !== 'string') {
            throw new McpAuthorizationRefusedError(request.connector, 'its protected-resource metadata names no `authorization_servers`');
        }
        const issuer = servers[0];
        if (!isSecureOAuth2Endpoint(issuer)) {
            throw new McpAuthorizationRefusedError(
                request.connector,
                'its protected-resource metadata names an authorization server that is not https',
            );
        }
        return { resource: named, issuer };
    }
    throw new McpAuthorizationRefusedError(
        request.connector,
        'the MCP server publishes no protected-resource metadata (RFC 9728), so its authorization server cannot be discovered; '
            + 'declare `authorizationUrl` and `tokenUrl`',
    );
}

/** Step 2: the authorization-server metadata of `issuer`. */
async function discoverAuthorizationServer(
    request: McpAuthorizationRequest,
    issuer: string,
): Promise<Record<string, unknown>> {
    for (const url of authorizationServerMetadataUrls(new URL(issuer))) {
        const found = await fetchDocument(request, url, 'authorization server\'s metadata');
        if (found.kind === 'absent') continue;
        const doc = found.body;
        if (typeof doc.issuer !== 'string' || canonical(new URL(doc.issuer)) !== canonical(new URL(issuer))) {
            throw new McpAuthorizationRefusedError(
                request.connector,
                'its authorization server\'s metadata names an `issuer` other than the one it was fetched for (RFC 8414 §3.3)',
            );
        }
        const methods = doc.code_challenge_methods_supported;
        if (!Array.isArray(methods) || !methods.includes('S256')) {
            throw new McpAuthorizationRefusedError(
                request.connector,
                'its authorization server does not list S256 in `code_challenge_methods_supported`, and PKCE is always on',
            );
        }
        return doc;
    }
    throw new McpAuthorizationRefusedError(
        request.connector,
        'its authorization server publishes no metadata (RFC 8414 or OpenID Connect discovery); declare `authorizationUrl` and `tokenUrl`',
    );
}

/** Step 3, the registration (RFC 7591) of a public client for the deployment's redirect URI. */
async function registerClient(
    request: McpAuthorizationRequest,
    registrationEndpoint: string,
): Promise<{ clientId: string; clientSecret?: string }> {
    const fetchImpl = request.fetch ?? fetch;
    const metadata: Record<string, unknown> = {
        client_name: request.clientName ?? 'ObjectStack',
        redirect_uris: [request.redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
    };
    if (request.scopes && request.scopes.length > 0) metadata.scope = request.scopes.join(' ');
    let response: Response;
    try {
        response = await fetchImpl(registrationEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(metadata),
            redirect: 'error',
            signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS),
        });
    } catch {
        throw new ConnectorUpstreamUnavailableError(
            `the client registration endpoint of connector instance '${request.connector}' did not answer`,
        );
    }
    if (response.status === 429 || response.status >= 500) {
        throw new ConnectorUpstreamUnavailableError(
            `the client registration endpoint of connector instance '${request.connector}' answered HTTP ${response.status}`,
        );
    }
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        body = undefined;
    }
    if (!response.ok) {
        const error = isObject(body) && typeof body.error === 'string' && REGISTERED_REGISTRATION_ERRORS.has(body.error)
            ? body.error
            : `HTTP ${response.status}`;
        throw new McpAuthorizationRefusedError(
            request.connector,
            `its authorization server refused to register the client (${error}); declare a pre-registered \`clientId\``,
        );
    }
    if (!isObject(body) || typeof body.client_id !== 'string' || body.client_id.length === 0) {
        throw new McpAuthorizationRefusedError(request.connector, 'its client registration answered no `client_id`');
    }
    const secret = typeof body.client_secret === 'string' && body.client_secret.length > 0 ? body.client_secret : undefined;
    return { clientId: body.client_id, ...(secret === undefined ? {} : { clientSecret: secret }) };
}

/**
 * Run the flow's discovery and registration for one connect: the client the
 * authorization request, the code exchange and every later refresh use.
 */
export async function discoverMcpAuthorization(request: McpAuthorizationRequest): Promise<McpAuthorizationClient> {
    let serverUrl: URL;
    try {
        serverUrl = new URL(request.serverUrl);
    } catch {
        throw new McpAuthorizationRefusedError(request.connector, 'its http transport `url` is not a URL');
    }
    if (!isSecureOAuth2Endpoint(serverUrl.href)) {
        throw new McpAuthorizationRefusedError(
            request.connector,
            'its http transport `url` is not https (plain http is accepted only to a loopback host): the access token travels to it',
        );
    }
    const { resource, issuer } = await discoverProtectedResource(request, serverUrl);
    const metadata = await discoverAuthorizationServer(request, issuer);
    const authorizationUrl = request.declared.authorizationUrl
        ?? secureUrl(request, metadata, 'authorization_endpoint', 'authorization server\'s metadata');
    const tokenUrl = request.declared.tokenUrl ?? secureUrl(request, metadata, 'token_endpoint', 'authorization server\'s metadata');
    const base = { issuer: metadata.issuer as string, authorizationUrl, tokenUrl, resource: request.declared.resource ?? resource };
    if (request.declared.clientId !== undefined) {
        return {
            ...base,
            clientId: request.declared.clientId,
            ...(request.declared.clientSecret === undefined ? {} : { clientSecret: request.declared.clientSecret }),
            registered: false,
        };
    }
    if (metadata.registration_endpoint === undefined) {
        throw new McpAuthorizationRefusedError(
            request.connector,
            'its authorization server offers no dynamic client registration (`registration_endpoint`); declare a pre-registered '
                + '`clientId`, and the `credentialRef` of its secret when it is a confidential client',
        );
    }
    const registrationEndpoint = secureUrl(request, metadata, 'registration_endpoint', 'authorization server\'s metadata');
    const client = await registerClient(request, registrationEndpoint);
    return { ...base, ...client, registered: true };
}

/** Read a stored client back (the connection's `registered_client`); `undefined` when it is not one. */
export function parseMcpAuthorizationClient(text: string | undefined): McpAuthorizationClient | undefined {
    if (text === undefined) return undefined;
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!isObject(value)) return undefined;
    const str = (k: string) => (typeof value[k] === 'string' && (value[k] as string).length > 0 ? (value[k] as string) : undefined);
    const issuer = str('issuer');
    const authorizationUrl = str('authorizationUrl');
    const tokenUrl = str('tokenUrl');
    const resource = str('resource');
    const clientId = str('clientId');
    if (!issuer || !authorizationUrl || !tokenUrl || !resource || !clientId) return undefined;
    const clientSecret = str('clientSecret');
    return {
        issuer, authorizationUrl, tokenUrl, resource, clientId,
        ...(clientSecret === undefined ? {} : { clientSecret }),
        registered: value.registered === true,
    };
}
