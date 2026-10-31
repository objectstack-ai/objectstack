// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Connector connections — the store behind `sys_connector_connection` (ADR-0143 D3)
 *
 * One row per `(organization, connector instance)` an administrator connected
 * through the `authorization_code` grant (Q1 = A, Q2 = B). The row holds the
 * refresh token (a `Field.secret()`, the #7799 channel `sys_connector_credential`
 * uses), the grant's status, scopes and expiry, and a revision the per-dispatch
 * refresh writes a rotated token over (D2.1, D4).
 *
 * ⛔ A refresh token leaves this module only as the return of
 * {@link ConnectorConnectionStore.resolveRefreshToken}, whose one caller sends
 * it to the instance's token endpoint. Every other read names the
 * organization, the instance, a status and a revision — never a token.
 */

import {
    ConnectorCredentialUnavailableError,
    isSecretProtectionFailure,
    optionalText,
    rowsOf,
    type ConnectorCredentialEngine,
} from './connector-credentials.js';

/** The object a connection lives in (`sys-connector-connection.object.ts`). */
export const CONNECTOR_CONNECTION_OBJECT = 'sys_connector_connection';

/** Its `type: 'secret'` column. */
export const CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD = 'refresh_token';

/** A connection's status (`not connected` is the absence of a row). */
export type ConnectorConnectionRowStatus = 'connected' | 'reconnect_required';

/** System context — the store is plugin-owned; no caller's grants apply to it. */
const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/** One stored row, as far as anything reads it: never the refresh token. */
export interface ConnectorConnectionRecord {
    id: string;
    organizationId: string;
    connectorName: string;
    status: ConnectorConnectionRowStatus;
    statusReason?: string;
    /** The granted scopes, as the authorization server answered them. */
    scopes?: string;
    /** When the last access token obtained for this connection expires. */
    expiresAt?: string;
    revision: number;
    /** Whether a refresh token is stored — never what it is. */
    hasRefreshToken: boolean;
    connectedAt?: string;
    connectedBy?: string;
}

/** The columns a read asks for — `refresh_token` is never among them; its presence is read from the masked value. */
const RECORD_FIELDS = [
    'id', 'organization_id', 'connector_name', 'status', 'status_reason', 'scopes', 'expires_at',
    'revision', 'connected_at', 'connected_by', CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD,
];

function toRecord(row: Record<string, unknown>): ConnectorConnectionRecord | undefined {
    if (typeof row.id !== 'string' && typeof row.id !== 'number') return undefined;
    if (typeof row.organization_id !== 'string' || typeof row.connector_name !== 'string') return undefined;
    const revision = Number(row.revision);
    // The engine masks a `secret` column on every read; a masked value says a
    // token is stored, and an empty one says none is — the value never comes back.
    const masked = row[CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD];
    return {
        id: String(row.id),
        organizationId: row.organization_id,
        connectorName: row.connector_name,
        status: row.status === 'reconnect_required' ? 'reconnect_required' : 'connected',
        statusReason: optionalText(row.status_reason),
        scopes: optionalText(row.scopes),
        expiresAt: optionalText(row.expires_at),
        revision: Number.isFinite(revision) ? revision : 0,
        hasRefreshToken: typeof masked === 'string' && masked.length > 0,
        connectedAt: optionalText(row.connected_at),
        connectedBy: optionalText(row.connected_by),
    };
}

/** What a connect, or a refresh that rotated or renewed the grant, writes. */
export interface ConnectorGrantWrite {
    /** The refresh token to keep; `undefined` keeps the stored one (a server that does not rotate). */
    refreshToken?: string;
    scopes?: string;
    expiresAt?: Date;
}

/**
 * How many rows a predicate write reports it changed. The engine answers a
 * `multi` update with the affected-row count; anything else (a driver that
 * returns no count) is read as "none" — the revision guard fails closed.
 */
function affectedRows(result: unknown): number {
    const count = typeof result === 'number' ? result : Number((result as { count?: unknown } | null)?.count);
    return Number.isFinite(count) ? count : 0;
}

/**
 * The `sys_connector_connection` store. One per automation plugin. It never
 * caches a token: {@link resolveRefreshToken} reads the row at the moment of use.
 */
export class ConnectorConnectionStore {
    constructor(private readonly resolveEngine: () => ConnectorCredentialEngine | undefined) {}

    private engineOrThrow(what: string): ConnectorCredentialEngine {
        const engine = this.resolveEngine();
        if (!engine) {
            throw new ConnectorCredentialUnavailableError(
                `${what}: no data engine is available to the automation service, and a connector connection is kept only `
                    + 'in the encrypted connection store.',
            );
        }
        return engine;
    }

    /**
     * As {@link read}, for the connection door: a store this deployment cannot
     * read — no data engine, or one whose read fails — is a 503
     * `ConnectorCredentialUnavailableError`, never "not connected". The
     * engine's own message is not carried (it may name the row it was handed).
     */
    async readOrRefuse(organizationId: string, connectorName: string): Promise<ConnectorConnectionRecord | undefined> {
        const what = `The connection of connector instance '${connectorName}' cannot be read`;
        this.engineOrThrow(what);
        try {
            return await this.read(organizationId, connectorName);
        } catch {
            throw new ConnectorCredentialUnavailableError(`${what}: the connection store did not answer the read.`);
        }
    }

    /** The row for one instance in one organization, or `undefined` when it is not connected there. */
    async read(organizationId: string, connectorName: string): Promise<ConnectorConnectionRecord | undefined> {
        const engine = this.resolveEngine();
        if (!engine) return undefined;
        const found = await engine.find(CONNECTOR_CONNECTION_OBJECT, {
            where: { organization_id: organizationId, connector_name: connectorName },
            fields: RECORD_FIELDS,
            context: SYSTEM_CONTEXT,
        });
        for (const row of rowsOf(found)) {
            const record = toRecord(row);
            if (record) return record;
        }
        return undefined;
    }

    /**
     * Write `fields` over the row `id` only while it still carries `revision`:
     * one conditional statement, `where: { id, revision }`, so the revision
     * check and the write cannot be split by another writer on any replica.
     * `true` when the row was written; `false`, with nothing written, when the
     * row moved (or is gone) since `revision` was read.
     */
    private async updateAtRevision(
        engine: ConnectorCredentialEngine,
        id: string,
        revision: number,
        fields: Record<string, unknown>,
        context: Record<string, unknown>,
    ): Promise<boolean> {
        const result = await engine.update(CONNECTOR_CONNECTION_OBJECT, fields, {
            where: { id, revision },
            multi: true,
            context,
        });
        return affectedRows(result) > 0;
    }

    /** Every organization's row for one instance. */
    async listFor(connectorName: string): Promise<ConnectorConnectionRecord[]> {
        const engine = this.resolveEngine();
        if (!engine) return [];
        const found = await engine.find(CONNECTOR_CONNECTION_OBJECT, {
            where: { connector_name: connectorName },
            fields: RECORD_FIELDS,
            context: SYSTEM_CONTEXT,
        });
        return rowsOf(found).map(toRecord).filter((r): r is ConnectorConnectionRecord => r !== undefined);
    }

    /**
     * The refresh token of `record`, read now, or `undefined` when the
     * authorization server issued none. Throws
     * {@link ConnectorCredentialUnavailableError} when a stored one cannot be
     * read back (no privileged dereference, no crypto provider) — never read as
     * "no token", which would turn a deployment fault into "reconnect required".
     */
    async resolveRefreshToken(record: ConnectorConnectionRecord): Promise<string | undefined> {
        if (!record.hasRefreshToken) return undefined;
        const engine = this.engineOrThrow(`The connection of connector instance '${record.connectorName}' cannot be read`);
        if (typeof engine.resolveSecretField !== 'function') {
            throw new ConnectorCredentialUnavailableError(
                `The connection of connector instance '${record.connectorName}' is stored encrypted, but this data engine cannot `
                    + 'dereference an encrypted field.',
            );
        }
        let plain: string | null;
        try {
            plain = await engine.resolveSecretField(CONNECTOR_CONNECTION_OBJECT, record.id, CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD);
        } catch {
            throw new ConnectorCredentialUnavailableError(
                `The connection of connector instance '${record.connectorName}' is stored but could not be decrypted. Register the `
                    + 'crypto provider it was written with on the data engine.',
            );
        }
        return typeof plain === 'string' && plain.length > 0 ? plain : undefined;
    }

    /**
     * Store what a completed connect produced for `(organizationId,
     * connectorName)`, replacing any earlier connection there (a reconnect),
     * and raise its revision.
     */
    async connect(args: { organizationId: string; connectorName: string; userId?: string } & ConnectorGrantWrite): Promise<ConnectorConnectionRecord> {
        const engine = this.engineOrThrow(`Connector instance '${args.connectorName}' was not connected`);
        const existing = await this.readOrRefuse(args.organizationId, args.connectorName);
        const context = { ...SYSTEM_CONTEXT, ...(args.userId ? { userId: args.userId } : {}) };
        const row = {
            grant: 'authorization_code',
            [CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD]: args.refreshToken ?? null,
            status: 'connected',
            status_reason: null,
            scopes: args.scopes ?? null,
            expires_at: args.expiresAt ? args.expiresAt.toISOString() : null,
            revision: (existing?.revision ?? 0) + 1,
            connected_at: new Date().toISOString(),
            connected_by: args.userId ?? null,
        };
        let moved = false;
        try {
            if (existing) {
                moved = !(await this.updateAtRevision(engine, existing.id, existing.revision, row, context));
            } else {
                await engine.insert(
                    CONNECTOR_CONNECTION_OBJECT,
                    { organization_id: args.organizationId, connector_name: args.connectorName, ...row },
                    { context },
                );
            }
        } catch (err) {
            if (isSecretProtectionFailure(err)) {
                throw new ConnectorCredentialUnavailableError(
                    `Connector instance '${args.connectorName}' was not connected: the encrypted connection store needs a crypto `
                        + 'provider this deployment has not registered. Nothing was kept.',
                );
            }
            // A foreign message may carry the row it was handed.
            throw new ConnectorCredentialUnavailableError(
                `Connector instance '${args.connectorName}' was not connected: the connection store refused the write. Nothing was kept.`,
            );
        }
        if (moved) {
            throw new ConnectorCredentialUnavailableError(
                `Connector instance '${args.connectorName}' was not connected: its connection changed while this connect was `
                    + 'completing (another connect, a refresh or a revoke landed first). Nothing was kept; begin the connect again.',
            );
        }
        const stored = await this.readOrRefuse(args.organizationId, args.connectorName);
        if (!stored) {
            throw new ConnectorCredentialUnavailableError(
                `Connector instance '${args.connectorName}' was not connected: the connection did not read back after its write.`,
            );
        }
        return stored;
    }

    /**
     * Record what a refresh over `record` produced: a rotated refresh token
     * (D2.1, atomically), the new expiry and scopes. Written only over the
     * revision `record` carries — `false`, with nothing written, when another
     * writer moved the row since (a reconnect, a revoke, a refresh on another
     * replica). The revision is checked by the write itself
     * ({@link updateAtRevision}), not by a read before it; the caller's
     * refresh lock narrows the race, it does not carry the invariant.
     */
    async recordRefresh(record: ConnectorConnectionRecord, write: ConnectorGrantWrite): Promise<boolean> {
        const engine = this.engineOrThrow(`The connection of connector instance '${record.connectorName}' was not renewed`);
        const rotated = write.refreshToken !== undefined;
        return this.updateAtRevision(
            engine,
            record.id,
            record.revision,
            {
                ...(rotated ? { [CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD]: write.refreshToken, revision: record.revision + 1 } : {}),
                ...(write.scopes !== undefined ? { scopes: write.scopes } : {}),
                expires_at: write.expiresAt ? write.expiresAt.toISOString() : null,
            },
            SYSTEM_CONTEXT,
        );
    }

    /**
     * Record that the authorization server refused the grant `record` held
     * (revoked, or expired with no usable refresh). `reason` is the platform's
     * sentence, never the server's text. Left alone when the row moved since
     * — checked by the write itself ({@link updateAtRevision}): a reconnect
     * that landed between the refusal and this write keeps its fresh grant.
     */
    async markReconnectRequired(record: ConnectorConnectionRecord, reason: string): Promise<void> {
        const engine = this.resolveEngine();
        if (!engine) return;
        await this.updateAtRevision(
            engine,
            record.id,
            record.revision,
            { status: 'reconnect_required', status_reason: reason, [CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD]: null },
            SYSTEM_CONTEXT,
        );
    }

    /** Remove the connection of one instance in one organization. `false` when it was not connected there. */
    async revoke(organizationId: string, connectorName: string, userId?: string): Promise<boolean> {
        const engine = this.engineOrThrow(`The connection of connector instance '${connectorName}' was not revoked`);
        const existing = await this.readOrRefuse(organizationId, connectorName);
        if (!existing) return false;
        const context = { ...SYSTEM_CONTEXT, ...(userId ? { userId } : {}) };
        await engine.delete(CONNECTOR_CONNECTION_OBJECT, { where: { id: existing.id }, context });
        return true;
    }
}
