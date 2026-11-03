// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0143 D2.1 (2026-11-02 amendment) — the OAuth client an administrator
 * supplies for an `authorization_code` instance that declares
 * `clientSource: 'installer'`.
 *
 * The administrator registers their own client with the vendor, against this
 * deployment's redirect URI, and hands its id (and secret, when the vendor
 * issued one) to the connect door. The begun connect carries it in its sealed
 * pending authorization; the completed connect keeps it in the connection
 * record's encrypted client column (`registered_client`), the same
 * per-connection client record that keeps a dynamically registered client,
 * and repeats only the id in plain text for reads. Every authorization, code
 * exchange and refresh of that connection then uses it.
 *
 * ⛔ The secret leaves this module only inside the serialized client the
 * connection store encrypts, and as the client a token request authenticates
 * with. No refusal, log line or read answer carries it.
 */

import { parseMcpAuthorizationClient, type McpAuthorizationClient } from './mcp-authorization.js';

/** The longest client id a connect accepts: the width of the connection's plain `client_id` column. */
export const INSTALLER_CLIENT_ID_MAX_LENGTH = 512;

/** The client the administrator entered. */
export interface InstallerClient {
    readonly clientId: string;
    /** Absent for a public client (PKCE alone protects the code). */
    readonly clientSecret?: string;
}

/** Whether an instance's `oauth2` auth takes its client from the installer. */
export function takesInstallerClient(auth: object | undefined): boolean {
    return (auth as { clientSource?: unknown } | undefined)?.clientSource === 'installer';
}

/**
 * What the connection keeps for an installer's client: the client, marked
 * `source: 'installer'`, and — on `provider: 'mcp'` over http, where the
 * endpoints are discovered — the discovered endpoints, in the shape
 * {@link parseMcpAuthorizationClient} reads (`registered: false`).
 */
export function serializeInstallerClient(client: InstallerClient, discovered?: McpAuthorizationClient): string {
    return JSON.stringify({
        source: 'installer',
        ...(discovered
            ? {
                issuer: discovered.issuer,
                authorizationUrl: discovered.authorizationUrl,
                tokenUrl: discovered.tokenUrl,
                resource: discovered.resource,
                registered: false,
            }
            : {}),
        clientId: client.clientId,
        ...(client.clientSecret === undefined ? {} : { clientSecret: client.clientSecret }),
    });
}

/** The client a connection keeps, as a refresh reads it back. */
export interface KeptConnectionClient {
    /** `true` for the administrator's client, `false` for a discovered or registered one. */
    readonly installer: boolean;
    readonly clientId: string;
    readonly clientSecret?: string;
    /** Only when the endpoints were discovered. */
    readonly tokenUrl?: string;
    readonly resource?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read a connection's kept client (`registered_client`) back: an MCP flow's
 * discovered or registered client, or the installer's (with or without
 * discovered endpoints). `undefined` when the text is neither.
 */
export function parseKeptConnectionClient(text: string | undefined): KeptConnectionClient | undefined {
    if (text === undefined) return undefined;
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return undefined;
    }
    if (!isObject(value)) return undefined;
    const installer = value.source === 'installer';
    const mcp = parseMcpAuthorizationClient(text);
    if (mcp) {
        return {
            installer,
            clientId: mcp.clientId,
            ...(mcp.clientSecret === undefined ? {} : { clientSecret: mcp.clientSecret }),
            tokenUrl: mcp.tokenUrl,
            resource: mcp.resource,
        };
    }
    if (!installer) return undefined;
    const clientId = typeof value.clientId === 'string' && value.clientId.length > 0 ? value.clientId : undefined;
    if (clientId === undefined) return undefined;
    const clientSecret = typeof value.clientSecret === 'string' && value.clientSecret.length > 0 ? value.clientSecret : undefined;
    return { installer: true, clientId, ...(clientSecret === undefined ? {} : { clientSecret }) };
}
