// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The per-dispatch credential of an `oauth2` instance (ADR-0143 D4)
 *
 * Implements the {@link ConnectorCredentialHandle} seam S0 typed on
 * `ConnectorProviderContext.credentialHandle` (#28137): a provider asks it on
 * every upstream request, and `callWithBorrowedCredential` (`@objectstack/types`)
 * is the call rule — refresh before an expired token is sent (skew margin),
 * refresh once on a `401` and retry once.
 *
 * Two grants, one shape each:
 *
 *   - **`client_credentials`** — no connection record (D3): the token is
 *     exchanged from the client's own secret and re-derived whenever it
 *     expires. It belongs to the instance, so a run's organization does not
 *     select anything.
 *   - **`authorization_code`** — the connection of the run's organization
 *     (Q1 = A) in `sys_connector_connection`. A run with no organization uses
 *     the instance's only connection, or is refused naming the missing
 *     organization — never an arbitrary one (D4, last bullet).
 *
 * **Single flight** (D4): concurrent requests that need a new token share
 * one token request — per instance for `client_credentials`, per organization
 * for `authorization_code`. A refresh additionally runs under the cluster
 * lock when the deployment has one, so two replicas never spend one rotating
 * refresh token (an authorization server that detects reuse would revoke the
 * whole grant). Inside the lock the row is read again, so a replica that waited
 * refreshes with the token the first one stored.
 *
 * **Failure** follows D4's split: an unreachable or `5xx` token endpoint is
 * `CONNECTOR_UPSTREAM_UNAVAILABLE` (thrown by `requestOAuth2Token`); a refused
 * grant marks the connection `reconnect_required`, tells the plugin (which
 * re-judges the instance's state), and refuses the dispatch "reconnect
 * required".
 *
 * ⛔ Access tokens live in this handle's memory only. A value leaves it only as
 * the return of `get` / `refresh`; every refusal names the instance and the
 * organization, never a token.
 */

import {
    BORROWED_CREDENTIAL_SKEW_MS,
    connectorCredentialRefusal,
    type BorrowedConnectorCredential,
    type ConnectorCredentialHandle,
    type ConnectorCredentialRequest,
} from '@objectstack/types';
import { ConnectorUpstreamUnavailableError } from '@objectstack/spec/integration';
import type { ILock } from '@objectstack/spec/contracts';
import type { ConnectorConnectionRecord, ConnectorConnectionStore } from '../connector-connections.js';
import { OAuth2GrantRefusedError, requestOAuth2Token, type OAuth2Client, type OAuth2TokenResponse } from './token-endpoint.js';
import { parseKeptConnectionClient } from './installer-client.js';

/**
 * What an `oauth2` instance's handle needs from its declaration, already
 * judged servable. An `authorization_code` instance whose endpoints or client
 * the MCP authorization flow discovers (ADR-0143 D2.1) declares neither
 * `tokenUrl` nor `clientId`: each connection then keeps its own client
 * (`registered_client`), which its refreshes use. So does an instance that
 * declares `clientSource: 'installer'` (the 2026-11-02 amendment): the
 * administrator entered each connection's client, and it declares none.
 */
export interface OAuth2GrantConfig {
    readonly grant: 'authorization_code' | 'client_credentials';
    readonly tokenUrl?: string;
    readonly clientId?: string;
    /**
     * `'installer'`: every connection authorizes with the client its
     * administrator entered, and with nothing else — never a client a
     * connection kept from a discovery or registration under an earlier
     * declaration. Without it, a kept installer's client is never used either.
     */
    readonly clientSource?: 'installer';
    /** The resolved client secret; absent for a public `authorization_code` client. */
    readonly clientSecret?: string;
    readonly scopes?: readonly string[];
    readonly resource?: string;
}

export interface OAuth2GrantHandleDeps {
    /** The connector instance — named in every refusal. */
    readonly connector: string;
    readonly config: OAuth2GrantConfig;
    /** The connection store (`authorization_code` only). */
    readonly connections: ConnectorConnectionStore;
    /** The cluster lock, when the deployment has a cluster service. Read at refresh time. */
    readonly lock?: () => ILock | undefined;
    /**
     * Told when a refresh marked an organization's connection
     * `reconnect_required`, with the `reason` it stored (whose cause is the
     * one that happened on that path), so the plugin logs it and re-judges
     * the instance. A throw here is the listener's own.
     */
    readonly onGrantRefused?: (organizationId: string, reason: string) => void;
    readonly timeoutMs?: number;
    readonly fetch?: typeof fetch;
    readonly now?: () => number;
}

/** The handle, plus what the connect door needs to hand it a token it just obtained. */
export interface OAuth2GrantHandle extends ConnectorCredentialHandle {
    /** Keep the access token a completed connect obtained for `organizationId`, under the connection's `revision`. */
    seed(organizationId: string, revision: number, token: OAuth2TokenResponse): void;
    /** Drop every cached access token (a revoke, a reconnect, the instance torn down). */
    forget(organizationId?: string): void;
}

/** How long a refresh may hold the connection's cluster lock, and how long another replica waits for it. */
export const OAUTH2_REFRESH_LOCK_TTL_MS = 30_000;

interface CachedToken {
    readonly revision: number;
    readonly accessToken: string;
    readonly expiresAt?: number;
}

const toCredential = (token: CachedToken): BorrowedConnectorCredential => ({
    auth: { type: 'bearer', token: token.accessToken },
    ...(token.expiresAt === undefined ? {} : { expiresAt: token.expiresAt }),
});

const unavailable = (message: string): Error => connectorCredentialRefusal(message, 'SERVICE_UNAVAILABLE', 503);

/** The dispatch refusal of an organization whose connection does not exist. */
export function notConnectedReason(connector: string, organizationId?: string): string {
    return `connector instance '${connector}' is not connected${organizationId ? ` for organization '${organizationId}'` : ''}: `
        + 'an administrator connects it (POST /api/v1/automation/connectors/' + connector + '/connection), and the next '
        + 'dispatch uses that connection (ADR-0143 D4)';
}

/**
 * [#28863] Why a refresh left a connection `reconnect_required`, as
 * {@link reconnectRequiredReason} words it: the authorization server refused
 * the grant (`invalid_grant`); it issued no refresh token; or the connection
 * keeps no client to refresh with. The last two never ask the server. (The
 * fourth way a connection is marked, the upstream refusing its token at MCP
 * tool discovery, words its own reason in `plugin.ts`.)
 */
export type ReconnectRequiredCause = 'refused' | 'no_refresh_token' | 'no_client';

const RECONNECT_REQUIRED_CAUSES: Readonly<Record<ReconnectRequiredCause, string>> = {
    refused: 'its authorization server refused the grant (revoked, or expired with no usable refresh)',
    // Not "expired": a refresh also runs on a cache miss (a fresh replica, a
    // revision another replica moved) and on a dispatch's 401, while the
    // access token may still be valid.
    no_refresh_token: 'its authorization server issued no refresh token, so an access token the connection has to renew '
        + 'cannot be renewed',
    no_client: 'its connection keeps no client to refresh with, so an access token it has to renew cannot be renewed',
};

/**
 * The dispatch refusal, and the stored `status_reason`, of an organization
 * whose connection needs to be reconnected. `cause` names what happened on
 * the path that marked it; with none, the authorization server's refusal, as
 * before.
 */
export function reconnectRequiredReason(
    connector: string,
    organizationId: string,
    cause: ReconnectRequiredCause = 'refused',
): string {
    return `connector instance '${connector}' needs to be reconnected for organization '${organizationId}': `
        + `${RECONNECT_REQUIRED_CAUSES[cause]}. Reconnect required: an administrator connects it again, and the next dispatch `
        + 'uses the new connection (ADR-0143 D4)';
}

/**
 * The dispatch refusal of a connection already marked `reconnect_required`:
 * the reason the row stores, whose cause is the one that marked it, and the
 * authorization server's refusal only for a row that stores none.
 */
function markedReason(connector: string, record: ConnectorConnectionRecord): string {
    return record.statusReason ?? reconnectRequiredReason(connector, record.organizationId);
}

/** Create the handle of one `oauth2` instance. */
export function createOAuth2GrantHandle(deps: OAuth2GrantHandleDeps): OAuth2GrantHandle {
    const { connector, config } = deps;
    const now = deps.now ?? Date.now;
    const fresh = (token: CachedToken | undefined): token is CachedToken =>
        token !== undefined && (token.expiresAt === undefined || token.expiresAt - BORROWED_CREDENTIAL_SKEW_MS > now());
    const declaredClient = config.clientId === undefined
        ? undefined
        : { clientId: config.clientId, ...(config.clientSecret === undefined ? {} : { clientSecret: config.clientSecret }) };
    const tokenRequest = (params: Record<string, string>, endpoint: { tokenUrl: string; client: OAuth2Client }) => requestOAuth2Token({
        connector,
        tokenUrl: endpoint.tokenUrl,
        client: endpoint.client,
        params,
        ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
        now,
    });

    if (config.grant === 'client_credentials') {
        if (config.tokenUrl === undefined || declaredClient === undefined) {
            throw new Error(`connector instance '${connector}': a client_credentials grant needs its declared tokenUrl and clientId`);
        }
        const endpoint = { tokenUrl: config.tokenUrl, client: declaredClient };
        let held: CachedToken | undefined;
        let inflight: Promise<CachedToken> | undefined;
        const fill = (): Promise<CachedToken> => {
            inflight ??= (async () => {
                const params: Record<string, string> = { grant_type: 'client_credentials' };
                if (config.scopes && config.scopes.length > 0) params.scope = config.scopes.join(' ');
                if (config.resource) params.resource = config.resource;
                const token = await tokenRequest(params, endpoint);
                held = { revision: 0, accessToken: token.accessToken, ...(token.expiresAt === undefined ? {} : { expiresAt: token.expiresAt }) };
                return held;
            })().finally(() => { inflight = undefined; });
            return inflight;
        };
        return {
            connector,
            async get() {
                return toCredential(fresh(held) ? held : await fill());
            },
            async refresh() {
                held = undefined;
                return toCredential(await fill());
            },
            seed() { /* a client_credentials instance is never connected */ },
            forget() { held = undefined; },
        };
    }

    // authorization_code
    const cache = new Map<string, CachedToken>();
    const inflight = new Map<string, Promise<CachedToken>>();

    /** The connection a request dispatches with (D4, Q1 = A). */
    const select = async (request?: ConnectorCredentialRequest): Promise<ConnectorConnectionRecord> => {
        const organizationId = request?.organizationId;
        let record: ConnectorConnectionRecord | undefined;
        try {
            if (organizationId !== undefined) {
                record = await deps.connections.read(organizationId, connector);
            } else {
                const all = await deps.connections.listFor(connector);
                if (all.length > 1) {
                    throw connectorCredentialRefusal(
                        `connector instance '${connector}' is connected for ${all.length} organizations, and this dispatch carries `
                            + 'no organization to choose one by: run it in the organization whose connection it should use. A '
                            + 'connection is never chosen for a run (ADR-0143 D4)',
                        'VALIDATION_ERROR',
                        422,
                    );
                }
                record = all[0];
            }
        } catch (err) {
            if ((err as { status?: unknown })?.status === 422) throw err;
            throw unavailable(`the connection of connector instance '${connector}' could not be read now; the next dispatch retries`);
        }
        if (!record) throw unavailable(notConnectedReason(connector, organizationId));
        if (record.status === 'reconnect_required') throw unavailable(markedReason(connector, record));
        return record;
    };

    /** Mark the grant gone, tell the plugin, and answer the dispatch's refusal. */
    const grantRefused = async (record: ConnectorConnectionRecord, reason: string): Promise<Error> => {
        cache.delete(record.organizationId);
        try {
            await deps.connections.markReconnectRequired(record, reason);
        } catch {
            /* the refusal stands either way; the row is re-judged on the next dispatch */
        }
        try {
            deps.onGrantRefused?.(record.organizationId, reason);
        } catch {
            /* the listener's throw is its own */
        }
        return unavailable(reason);
    };

    /**
     * Where `record`'s refresh is sent, and as which client: the declared ones,
     * else the client the connection keeps (an MCP instance's discovered or
     * registered one, or the installer's); `undefined` when it keeps none it
     * can be read back as, or one of the other kind than the declaration says
     * (an installer's client under a declaration that no longer takes one,
     * or the reverse).
     */
    const endpointOf = async (
        record: ConnectorConnectionRecord,
    ): Promise<{ tokenUrl: string; client: OAuth2Client; resource?: string } | undefined> => {
        if (config.tokenUrl !== undefined && declaredClient !== undefined) {
            return { tokenUrl: config.tokenUrl, client: declaredClient, ...(config.resource ? { resource: config.resource } : {}) };
        }
        let text: string | undefined;
        try {
            text = await deps.connections.resolveRegisteredClient(record);
        } catch {
            throw unavailable(`the connection of connector instance '${connector}' for organization '${record.organizationId}' could `
                + 'not be read back now; the next dispatch retries');
        }
        const kept = parseKeptConnectionClient(text);
        if (!kept || kept.installer !== (config.clientSource === 'installer')) return undefined;
        const tokenUrl = config.tokenUrl ?? kept.tokenUrl;
        if (tokenUrl === undefined) return undefined;
        const resource = config.resource ?? kept.resource;
        return {
            tokenUrl,
            client: declaredClient ?? { clientId: kept.clientId, ...(kept.clientSecret === undefined ? {} : { clientSecret: kept.clientSecret }) },
            ...(resource === undefined ? {} : { resource }),
        };
    };

    /** One refresh of `organizationId`'s connection, read again under the lock. */
    const refreshOnce = async (organizationId: string): Promise<CachedToken> => {
        const current = await deps.connections.read(organizationId, connector);
        if (!current) throw unavailable(notConnectedReason(connector, organizationId));
        if (current.status === 'reconnect_required') throw unavailable(markedReason(connector, current));
        let refreshToken: string | undefined;
        try {
            refreshToken = await deps.connections.resolveRefreshToken(current);
        } catch {
            throw unavailable(`the connection of connector instance '${connector}' for organization '${organizationId}' could not be `
                + 'read back now; the next dispatch retries');
        }
        if (refreshToken === undefined) {
            throw await grantRefused(current, reconnectRequiredReason(connector, organizationId, 'no_refresh_token'));
        }
        const endpoint = await endpointOf(current);
        if (endpoint === undefined) {
            throw await grantRefused(current, reconnectRequiredReason(connector, organizationId, 'no_client'));
        }
        const params: Record<string, string> = { grant_type: 'refresh_token', refresh_token: refreshToken };
        if (endpoint.resource) params.resource = endpoint.resource;
        let token: OAuth2TokenResponse;
        try {
            token = await tokenRequest(params, endpoint);
        } catch (err) {
            if (err instanceof OAuth2GrantRefusedError) {
                throw await grantRefused(current, reconnectRequiredReason(connector, organizationId, 'refused'));
            }
            throw err;
        }
        const written = await deps.connections.recordRefresh(current, {
            ...(token.refreshToken === undefined ? {} : { refreshToken: token.refreshToken }),
            ...(token.scope === undefined ? {} : { scopes: token.scope }),
            ...(token.expiresAt === undefined ? {} : { expiresAt: new Date(token.expiresAt) }),
        });
        if (!written) {
            // A reconnect or revoke moved the row while the request was out:
            // what came back belongs to a grant that is no longer this one.
            throw new ConnectorUpstreamUnavailableError(
                `the connection of connector instance '${connector}' for organization '${organizationId}' changed while it was `
                    + 'being refreshed; the next dispatch uses the new one',
            );
        }
        const cached: CachedToken = {
            revision: token.refreshToken === undefined ? current.revision : current.revision + 1,
            accessToken: token.accessToken,
            ...(token.expiresAt === undefined ? {} : { expiresAt: token.expiresAt }),
        };
        cache.set(organizationId, cached);
        return cached;
    };

    const refreshFor = (organizationId: string): Promise<CachedToken> => {
        let flight = inflight.get(organizationId);
        if (!flight) {
            flight = (async () => {
                const lock = deps.lock?.();
                if (!lock) return refreshOnce(organizationId);
                const result = await lock.withLock(
                    `connector-connection:${connector}:${organizationId}:refresh`,
                    () => refreshOnce(organizationId),
                    { ttlMs: OAUTH2_REFRESH_LOCK_TTL_MS, waitMs: OAUTH2_REFRESH_LOCK_TTL_MS },
                );
                if (result === null) {
                    throw new ConnectorUpstreamUnavailableError(
                        `the connection of connector instance '${connector}' for organization '${organizationId}' is being refreshed `
                            + 'by another replica; the next dispatch retries',
                    );
                }
                return result;
            })().finally(() => { inflight.delete(organizationId); });
            inflight.set(organizationId, flight);
        }
        return flight;
    };

    return {
        connector,
        async get(request) {
            const record = await select(request);
            const held = cache.get(record.organizationId);
            if (fresh(held) && held.revision === record.revision) return toCredential(held);
            return toCredential(await refreshFor(record.organizationId));
        },
        async refresh(request) {
            const record = await select(request);
            cache.delete(record.organizationId);
            return toCredential(await refreshFor(record.organizationId));
        },
        seed(organizationId, revision, token) {
            cache.set(organizationId, {
                revision,
                accessToken: token.accessToken,
                ...(token.expiresAt === undefined ? {} : { expiresAt: token.expiresAt }),
            });
        },
        forget(organizationId) {
            if (organizationId === undefined) cache.clear();
            else cache.delete(organizationId);
        },
    };
}
