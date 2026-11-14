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

import type { PackageScopedResolution } from '@objectstack/objectql';

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

/**
 * The encrypted field holding the client a connection authorizes with when the
 * instance declares none (ADR-0143 D2.1): the one an MCP authorization flow
 * discovered or registered, or the one the administrator entered for an
 * instance declaring `clientSource: 'installer'` (2026-11-02 amendment).
 */
export const CONNECTOR_CONNECTION_REGISTERED_CLIENT_FIELD = 'registered_client';

/** The installer's client id, in plain text beside the encrypted client: what a read shows. Never a secret. */
export const CONNECTOR_CONNECTION_CLIENT_ID_FIELD = 'client_id';

/** Whether the installer's client came with a secret (kept only inside the encrypted client). */
export const CONNECTOR_CONNECTION_CLIENT_HAS_SECRET_FIELD = 'client_has_secret';

/** Its package column: the package of the instance the row connects (ADR-0150 D4, D8 row R11). */
export const CONNECTOR_CONNECTION_PACKAGE_FIELD = 'connector_package';

/**
 * [ADR-0150 D4, #31699] Which instance of a connector name a store call is
 * about: a package id, `null` for an instance the environment authored or a
 * plugin registers in code, or `undefined` for a caller that knows only the
 * name (every row of the name in the organization answers it, and two
 * refuse).
 */
export type ConnectorInstancePackage = string | null | undefined;

/**
 * [#31699] How many holders the connector name has: its durable resolution
 * for a caller with no package (disabled packages counted), the question the
 * boot backfill asks before it binds a row naming no package. While it
 * answers one holder, every row of the name is the one instance's; when it
 * refuses (two holders), each package's rows are its own. `undefined` when
 * the composition has no registry to ask.
 */
export type ConnectorNullRowHolder = (connectorName: string) => PackageScopedResolution | undefined;

/**
 * [#31699] Two rows answer one instance in one organization, or a row of a
 * name two packages hold names none of them: answered `409`, never one of them
 * picked.
 */
export class ConnectorConnectionConflictError extends Error {
    readonly code = 'RESOURCE_CONFLICT';
    readonly status = 409;
    readonly statusCode = 409;
    constructor(message: string) {
        super(message);
        this.name = 'ConnectorConnectionConflictError';
    }
}

/** A connection's status (`not connected` is the absence of a row). */
export type ConnectorConnectionRowStatus = 'connected' | 'reconnect_required';

/** System context — the store is plugin-owned; no caller's grants apply to it. */
const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/** One stored row, as far as anything reads it: never the refresh token. */
export interface ConnectorConnectionRecord {
    id: string;
    organizationId: string;
    connectorName: string;
    /** [#31699] The package the row names, `null` when it names none. */
    packageId: string | null;
    status: ConnectorConnectionRowStatus;
    statusReason?: string;
    /** The granted scopes, as the authorization server answered them. */
    scopes?: string;
    /** When the last access token obtained for this connection expires. */
    expiresAt?: string;
    revision: number;
    /** Whether a refresh token is stored — never what it is. */
    hasRefreshToken: boolean;
    /** Whether the row keeps a client of its own: discovered or registered (an MCP instance's connection), or the installer's. */
    hasRegisteredClient: boolean;
    /**
     * The id of the client the administrator entered (`clientSource:
     * 'installer'`, ADR-0143 D2.1), from the plain column; absent for any
     * other connection. The client itself is read only through
     * {@link ConnectorConnectionStore.resolveRegisteredClient}.
     */
    installerClientId?: string;
    /** Whether that client came with a secret — never what it is. */
    installerClientHasSecret: boolean;
    connectedAt?: string;
    connectedBy?: string;
    /**
     * [#31699] Set only on a {@link ConnectorConnectionStore.listFor} entry:
     * the refusal a read of this organization's connection answers (two rows
     * answering the instance, or a row of a name two packages hold that
     * names none of them). The entry stands for the organization, never as its connection.
     */
    conflict?: string;
}

/** The columns a read asks for — `refresh_token` is never among them; its presence is read from the masked value. */
const RECORD_FIELDS = [
    'id', 'organization_id', 'connector_name', CONNECTOR_CONNECTION_PACKAGE_FIELD, 'status', 'status_reason', 'scopes', 'expires_at',
    'revision', 'connected_at', 'connected_by', CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD,
    CONNECTOR_CONNECTION_REGISTERED_CLIENT_FIELD, CONNECTOR_CONNECTION_CLIENT_ID_FIELD,
    CONNECTOR_CONNECTION_CLIENT_HAS_SECRET_FIELD,
];

function toRecord(row: Record<string, unknown>): ConnectorConnectionRecord | undefined {
    if (typeof row.id !== 'string' && typeof row.id !== 'number') return undefined;
    if (typeof row.organization_id !== 'string' || typeof row.connector_name !== 'string') return undefined;
    const revision = Number(row.revision);
    // The engine masks a `secret` column on every read; a masked value says a
    // token is stored, and an empty one says none is — the value never comes back.
    const masked = row[CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD];
    const maskedClient = row[CONNECTOR_CONNECTION_REGISTERED_CLIENT_FIELD];
    return {
        id: String(row.id),
        organizationId: row.organization_id,
        connectorName: row.connector_name,
        packageId: rowPackage(row),
        status: row.status === 'reconnect_required' ? 'reconnect_required' : 'connected',
        statusReason: optionalText(row.status_reason),
        scopes: optionalText(row.scopes),
        expiresAt: optionalText(row.expires_at),
        revision: Number.isFinite(revision) ? revision : 0,
        hasRefreshToken: typeof masked === 'string' && masked.length > 0,
        hasRegisteredClient: typeof maskedClient === 'string' && maskedClient.length > 0,
        ...(optionalText(row[CONNECTOR_CONNECTION_CLIENT_ID_FIELD]) === undefined
            ? {}
            : { installerClientId: optionalText(row[CONNECTOR_CONNECTION_CLIENT_ID_FIELD]) }),
        installerClientHasSecret: row[CONNECTOR_CONNECTION_CLIENT_HAS_SECRET_FIELD] === true
            || row[CONNECTOR_CONNECTION_CLIENT_HAS_SECRET_FIELD] === 1,
        connectedAt: optionalText(row.connected_at),
        connectedBy: optionalText(row.connected_by),
    };
}

/** The package a row names, `null` when it names none (NULL, absent or empty). */
function rowPackage(row: Record<string, unknown>): string | null {
    const value = row[CONNECTOR_CONNECTION_PACKAGE_FIELD];
    return typeof value === 'string' && value.length > 0 ? value : null;
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

/** [#31699] The refusal of two rows answering one instance in one organization. */
function twoConnections(connectorName: string, count: number): ConnectorConnectionConflictError {
    return new ConnectorConnectionConflictError(
        `Connector instance '${connectorName}' has ${count} connections in this organization, and one `
            + 'instance keeps one. Revoke the connection, which removes every one of them, then connect again.',
    );
}

/**
 * The `sys_connector_connection` store. One per automation plugin. It never
 * caches a token: {@link resolveRefreshToken} reads the row at the moment of use.
 */
export class ConnectorConnectionStore {
    constructor(
        private readonly resolveEngine: () => ConnectorCredentialEngine | undefined,
        private readonly nullRowHolderOf: ConnectorNullRowHolder = () => undefined,
    ) {}

    /**
     * [ADR-0150 D4, #31699] The rows of one organization's connections of
     * `connectorName` that answer the instance of `packageId`, by one rule:
     *
     * - while the name has one holder (its durable resolution, disabled
     *   packages included, answers one), or no registry can judge it: every
     *   row of the name, whatever package it names, as the read by name
     *   answered before the key carried a package. A connection follows its
     *   name across a move of the declaration (another package, the
     *   environment), and a connect adopts the row and stamps it with the
     *   instance's package in place ({@link connect}), so a one-holder
     *   answer never moves (ADR-0150 red line 3, epic ruling R2-C);
     * - while two packages hold the name: the rows naming that package
     *   (`null`: the rows naming none). A row naming no package, or a package
     *   that is not one of the holders, is no package's: when it is all a
     *   package has, the read is refused, naming the bind that settles it,
     *   never handed to one of them (ADR-0150 red line 2). It is not the R9
     *   rule (#31696), where such a row beside the package's own row wins and
     *   is refused: here the package's own row is its connection, and the
     *   backfill reports the stray row;
     * - for a caller that knows only the name, every row.
     */
    private answering(
        rows: readonly Record<string, unknown>[],
        connectorName: string,
        packageId: ConnectorInstancePackage,
    ): Record<string, unknown>[] {
        if (packageId === undefined) return [...rows];
        const own = rows.filter((r) => rowPackage(r) === packageId);
        if (own.length === rows.length) return own;
        const holder = this.nullRowHolderOf(connectorName);
        if (holder?.status !== 'refused') return [...rows];
        if (packageId === null || own.length > 0) return own;
        const holders = new Set(holder.candidates.flatMap((c) => (c.kind === 'package' ? [c.packageId] : [])));
        const unclaimed = rows.filter((r) => {
            const named = rowPackage(r);
            return named === null || !holders.has(named);
        });
        if (unclaimed.length === 0) return own;
        throw new ConnectorConnectionConflictError(
            `The connection of connector instance '${connectorName}' in this organization names no package that holds `
                + `that name, and ${holder.candidates.length} packages hold it, so it is no one package's connection. Bind it to `
                + 'its package with `os migrate stored-references bind --table sys_connector_connection`, or uninstall one of '
                + 'the packages, then read it again.',
        );
    }

    /** The one row answering the instance, refusing two (see {@link answering}). */
    private chosen(
        rows: readonly Record<string, unknown>[],
        connectorName: string,
        packageId: ConnectorInstancePackage,
    ): Record<string, unknown> | undefined {
        const answering = this.answering(rows, connectorName, packageId);
        if (answering.length > 1) throw twoConnections(connectorName, answering.length);
        return answering[0];
    }

    private async rowsOfInstance(
        engine: ConnectorCredentialEngine,
        organizationId: string,
        connectorName: string,
        fields: readonly string[] = RECORD_FIELDS,
    ): Promise<Record<string, unknown>[]> {
        const found = await engine.find(CONNECTOR_CONNECTION_OBJECT, {
            where: { organization_id: organizationId, connector_name: connectorName },
            fields: [...fields],
            context: SYSTEM_CONTEXT,
        });
        return rowsOf(found);
    }

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
    async readOrRefuse(
        organizationId: string,
        connectorName: string,
        packageId?: ConnectorInstancePackage,
    ): Promise<ConnectorConnectionRecord | undefined> {
        const what = `The connection of connector instance '${connectorName}' cannot be read`;
        this.engineOrThrow(what);
        try {
            return await this.read(organizationId, connectorName, packageId);
        } catch (err) {
            if (err instanceof ConnectorConnectionConflictError) throw err;
            throw new ConnectorCredentialUnavailableError(`${what}: the connection store did not answer the read.`);
        }
    }

    /**
     * The row for one instance in one organization, or `undefined` when it is
     * not connected there. `packageId` names the instance (see
     * {@link ConnectorInstancePackage}); two rows answering it are refused
     * ({@link ConnectorConnectionConflictError}).
     */
    async read(
        organizationId: string,
        connectorName: string,
        packageId?: ConnectorInstancePackage,
    ): Promise<ConnectorConnectionRecord | undefined> {
        const engine = this.resolveEngine();
        if (!engine) return undefined;
        const rows = (await this.rowsOfInstance(engine, organizationId, connectorName)).filter((r) => toRecord(r) !== undefined);
        const row = this.chosen(rows, connectorName, packageId);
        return row ? toRecord(row) : undefined;
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

    /**
     * How many rows answer one instance in one organization: one at most, but
     * for a connect that raced the backfill. A row of a name two packages
     * hold that names none of them counts as none.
     */
    private async rowCount(
        engine: ConnectorCredentialEngine,
        organizationId: string,
        connectorName: string,
        packageId: ConnectorInstancePackage,
    ): Promise<number> {
        const rows = await this.rowsOfInstance(engine, organizationId, connectorName, ['id', CONNECTOR_CONNECTION_PACKAGE_FIELD]);
        try {
            return this.answering(rows, connectorName, packageId).length;
        } catch (err) {
            if (err instanceof ConnectorConnectionConflictError) return 0;
            throw err;
        }
    }

    /**
     * Every organization's connection of one instance, one per organization
     * (`packageId` names the instance, as {@link read}). An organization whose
     * read is refused (two rows answering, or a row of a name two packages
     * hold that names none of them) is still listed, once, carrying that refusal in
     * `conflict`: the list counts organizations as the read would, and a
     * caller never takes such an entry for the organization's connection.
     */
    async listFor(connectorName: string, packageId: ConnectorInstancePackage): Promise<ConnectorConnectionRecord[]> {
        const engine = this.resolveEngine();
        if (!engine) return [];
        const found = await engine.find(CONNECTOR_CONNECTION_OBJECT, {
            where: { connector_name: connectorName },
            fields: RECORD_FIELDS,
            context: SYSTEM_CONTEXT,
        });
        const byOrganization = new Map<string, Record<string, unknown>[]>();
        for (const row of rowsOf(found)) {
            if (toRecord(row) === undefined) continue;
            const organizationId = String(row.organization_id);
            byOrganization.set(organizationId, [...(byOrganization.get(organizationId) ?? []), row]);
        }
        const out: ConnectorConnectionRecord[] = [];
        for (const rows of byOrganization.values()) {
            let answering: Record<string, unknown>[];
            try {
                answering = this.answering(rows, connectorName, packageId);
                if (answering.length > 1) throw twoConnections(connectorName, answering.length);
            } catch (err) {
                if (!(err instanceof ConnectorConnectionConflictError)) throw err;
                out.push({ ...toRecord(rows[0])!, conflict: err.message });
                continue;
            }
            if (answering.length > 0) out.push(toRecord(answering[0])!);
        }
        return out;
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
        return this.resolveSecret(record, CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD);
    }

    /**
     * The discovered or registered client of `record` (ADR-0143 D2.1), read
     * now as the text it was stored as, or `undefined` when the row keeps none.
     * Throws as {@link resolveRefreshToken} does.
     */
    async resolveRegisteredClient(record: ConnectorConnectionRecord): Promise<string | undefined> {
        if (!record.hasRegisteredClient) return undefined;
        return this.resolveSecret(record, CONNECTOR_CONNECTION_REGISTERED_CLIENT_FIELD);
    }

    private async resolveSecret(record: ConnectorConnectionRecord, field: string): Promise<string | undefined> {
        const engine = this.engineOrThrow(`The connection of connector instance '${record.connectorName}' cannot be read`);
        if (typeof engine.resolveSecretField !== 'function') {
            throw new ConnectorCredentialUnavailableError(
                `The connection of connector instance '${record.connectorName}' is stored encrypted, but this data engine cannot `
                    + 'dereference an encrypted field.',
            );
        }
        let plain: string | null;
        try {
            plain = await engine.resolveSecretField(CONNECTOR_CONNECTION_OBJECT, record.id, field);
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
     * and raise its revision. `registeredClient` is the serialized client the
     * connection authorizes with (one an MCP authorization flow discovered or
     * registered, or the installer's), kept encrypted beside the refresh token
     * it authorizes. `installerClient` repeats the installer's client id, and
     * whether it has a secret, in the plain columns a read shows — never the
     * secret, which is only inside `registeredClient`.
     */
    async connect(
        args: {
            organizationId: string;
            connectorName: string;
            /**
             * [#31699] The instance's package (`null`: the environment's or
             * the platform's instance; absent: a caller that knows only the
             * name, whose row names no package, as before).
             */
            packageId?: ConnectorInstancePackage;
            userId?: string;
            registeredClient?: string;
            installerClient?: { clientId: string; hasSecret: boolean };
        } & ConnectorGrantWrite,
    ): Promise<ConnectorConnectionRecord> {
        const engine = this.engineOrThrow(`Connector instance '${args.connectorName}' was not connected`);
        const existing = await this.readOrRefuse(args.organizationId, args.connectorName, args.packageId);
        const context = { ...SYSTEM_CONTEXT, ...(args.userId ? { userId: args.userId } : {}) };
        // [#31699] The row names the instance's package. A row the instance
        // adopts (`answering`: one naming no package, or another package, while
        // the name has one holder) is stamped by this same write, so the
        // instance's connection is one row (design review M2). `null` (the
        // environment's or the platform's instance) clears another package's
        // stamp; an absent package (a caller that knows only the name) leaves
        // the row as it is.
        const stamp = args.packageId === undefined ? {} : { [CONNECTOR_CONNECTION_PACKAGE_FIELD]: args.packageId };
        const row = {
            grant: 'authorization_code',
            [CONNECTOR_CONNECTION_REFRESH_TOKEN_FIELD]: args.refreshToken ?? null,
            [CONNECTOR_CONNECTION_REGISTERED_CLIENT_FIELD]: args.registeredClient ?? null,
            [CONNECTOR_CONNECTION_CLIENT_ID_FIELD]: args.installerClient?.clientId ?? null,
            [CONNECTOR_CONNECTION_CLIENT_HAS_SECRET_FIELD]: args.installerClient?.hasSecret ?? false,
            status: 'connected',
            status_reason: null,
            scopes: args.scopes ?? null,
            expires_at: args.expiresAt ? args.expiresAt.toISOString() : null,
            revision: (existing?.revision ?? 0) + 1,
            connected_at: new Date().toISOString(),
            connected_by: args.userId ?? null,
        };
        let moved = false;
        let insertedId: string | undefined;
        try {
            if (existing) {
                moved = !(await this.updateAtRevision(engine, existing.id, existing.revision, { ...row, ...stamp }, context));
            } else {
                const created = await engine.insert(
                    CONNECTOR_CONNECTION_OBJECT,
                    { organization_id: args.organizationId, connector_name: args.connectorName, ...stamp, ...row },
                    { context },
                );
                const id = (created as { id?: unknown } | null | undefined)?.id;
                insertedId = typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
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
        // [#31699] The key is `(organization_id, connector_package,
        // connector_name)`, so a row the boot backfill stamped with its package
        // between this connect's read and its insert no longer refuses the
        // insert, as the old `(organization_id, connector_name)` key did. Two
        // rows of one instance in one organization would leave `read` answering
        // either and `revoke` deleting one. So the insert that made the second
        // row takes itself back and is refused, as the old key refused it.
        // Counted for this instance (`answering`). A foreign message is never
        // quoted, as above.
        if (!existing && !moved) {
            const twice = new ConnectorCredentialUnavailableError(
                `Connector instance '${args.connectorName}' was connected twice in this organization: another connect `
                    + 'landed while this one was completing. Revoke the connection until it reads as not connected, then connect again.',
            );
            let rows: number;
            try {
                rows = await this.rowCount(engine, args.organizationId, args.connectorName, args.packageId);
            } catch {
                throw new ConnectorCredentialUnavailableError(
                    `Connector instance '${args.connectorName}' was connected, but the connection store did not answer the `
                        + 'read that checks it is the only connection of this instance here. Read the connection before using it.',
                );
            }
            if (rows > 1) {
                // An engine that does not answer the created row's id: the row cannot be told apart, so say so.
                if (insertedId === undefined) throw twice;
                try {
                    await engine.delete(CONNECTOR_CONNECTION_OBJECT, { where: { id: insertedId }, context: SYSTEM_CONTEXT });
                } catch {
                    throw twice;
                }
                moved = true;
            }
        }
        if (moved) {
            throw new ConnectorCredentialUnavailableError(
                `Connector instance '${args.connectorName}' was not connected: its connection changed while this connect was `
                    + 'completing (another connect, a refresh or a revoke landed first). Nothing was kept; begin the connect again.',
            );
        }
        const stored = await this.readOrRefuse(args.organizationId, args.connectorName, args.packageId);
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
     * Record that the grant `record` held stopped working: the authorization
     * server refused it on refresh, the connection keeps nothing to renew an
     * access token it has to renew with (no refresh token was issued, or no
     * client to refresh with), or the upstream refused the connection's token
     * while an `mcp` instance discovered its tools. `reason` is the platform's
     * sentence naming which, never the server's text. Left alone when the row
     * moved since — checked by the write itself ({@link updateAtRevision}): a
     * reconnect that landed between the mark and this write keeps its fresh
     * grant.
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

    /**
     * Remove the connection of one instance in one organization: every row
     * answering it ({@link answering}), so a revoke also clears the second row
     * a read refuses, and, while the name has one holder, a row its moved
     * declaration left under another package. Under two holders a row that
     * names none of them is no package's, so a package's revoke leaves it (the
     * bind settles it), and where it is all that package has, the revoke is
     * refused as the read is ({@link ConnectorConnectionConflictError}), never
     * answered "not connected". `false` when it was not connected there.
     */
    async revoke(
        organizationId: string,
        connectorName: string,
        userId: string | undefined,
        packageId: string | null,
    ): Promise<boolean> {
        const what = `The connection of connector instance '${connectorName}' was not revoked`;
        const engine = this.engineOrThrow(what);
        let rows: Record<string, unknown>[];
        try {
            rows = await this.rowsOfInstance(engine, organizationId, connectorName, ['id', CONNECTOR_CONNECTION_PACKAGE_FIELD]);
        } catch {
            throw new ConnectorCredentialUnavailableError(`${what}: the connection store did not answer the read.`);
        }
        const answering = this.answering(rows, connectorName, packageId);
        const ids = answering.flatMap((r) => (typeof r.id === 'string' || typeof r.id === 'number' ? [String(r.id)] : []));
        if (ids.length === 0) return false;
        const context = { ...SYSTEM_CONTEXT, ...(userId ? { userId } : {}) };
        for (const id of ids) await engine.delete(CONNECTOR_CONNECTION_OBJECT, { where: { id }, context });
        return true;
    }
}
