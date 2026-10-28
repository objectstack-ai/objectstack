// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Connector credentials — the open-tier resolver chain and its store (#27237)
 *
 * A provider-bound declarative connector names its secret (`auth.credentialRef`,
 * ADR-0097 §3). Ruling A on #27230 gives the name three places to resolve
 * from, in order:
 *
 *   1. an environment variable of the same name — a self-hosted operator keeps
 *      today's path, and it wins, so a listing reports `source: 'env'` and the
 *      credential door refuses to shadow it;
 *   2. a `sys_connector_credential` row an administrator set
 *      (`sys-connector-credential.object.ts`) — the `Field.secret()` channel,
 *      dereferenced only through the data engine's `resolveSecretField()`;
 *   3. the resolver the host injected (`AutomationServicePluginOptions.credentialResolver`)
 *      — the enterprise vault arm, if one is wired.
 *
 * ⛔ A value leaves this module only as the return of {@link resolveConnectorCredential},
 * whose one caller hands it to a provider factory. Everything else here —
 * fingerprints, listings, the store's rows — carries the reference, a source,
 * a status and a revision, never the value.
 */

import { defaultEnvCredentialResolver, type CredentialResolver } from './credential-resolver.js';

/** The object a connector credential lives in (`sys-connector-credential.object.ts`). */
export const CONNECTOR_CREDENTIAL_OBJECT = 'sys_connector_credential';

/** Its `type: 'secret'` column. */
export const CONNECTOR_CREDENTIAL_VALUE_FIELD = 'value';

/** The bound on a reference — the object's `ref.maxLength`, which its unique index needs. */
export const CONNECTOR_CREDENTIAL_REF_MAX_LENGTH = 255;

/** The bound on a value the door accepts. A PEM key or a service-account JSON fits several times over. */
export const CONNECTOR_CREDENTIAL_VALUE_MAX_LENGTH = 16_384;

/** Where a reference resolved from — never what it resolved to. */
export type ConnectorCredentialSource = 'env' | 'object' | 'vault';

/** A stored row's status (`missing` is a listing verdict and has no row). */
export type ConnectorCredentialRowStatus = 'set' | 'rejected';

/** System context — the store is plugin-owned; no caller's grants apply to it. */
const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The slice of the data engine the store uses — ObjectQL's, declared
 * structurally so this package keeps no build dependency on it.
 */
export interface ConnectorCredentialEngine {
    find(object: string, query?: Record<string, unknown>): Promise<unknown>;
    insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    delete(object: string, options?: Record<string, unknown>): Promise<unknown>;
    /** The privileged dereference of one row's `secret`-typed field (ObjectQL ≥ #7799). */
    resolveSecretField?(object: string, recordId: string, field: string): Promise<string | null>;
}

/** One stored row, as far as anything reads it: the reference and its bookkeeping, never the value. */
export interface ConnectorCredentialRecord {
    id: string;
    ref: string;
    revision: number;
    status: ConnectorCredentialRowStatus;
    statusReason?: string;
    connectorName?: string;
    packageId?: string;
    lastVerifiedAt?: string;
    updatedAt?: string;
    updatedBy?: string;
}

/** The columns a read asks for — `value` is never among them. */
const RECORD_FIELDS = [
    'id', 'ref', 'revision', 'status', 'status_reason', 'connector_name', 'package_id',
    'last_verified_at', 'updated_at', 'updated_by',
];

/**
 * ADR-0112 pair for a credential the deployment cannot handle safely right now:
 * no data engine, no crypto provider, a stored row that does not decrypt. A
 * standard-catalog member; `503` because the condition belongs to the
 * deployment and clears when it is fixed.
 */
export const CONNECTOR_CREDENTIAL_UNAVAILABLE_CODE = 'SERVICE_UNAVAILABLE';
export const CONNECTOR_CREDENTIAL_UNAVAILABLE_STATUS = 503;

/** The store cannot write or read a credential safely. Its message names the reference, never the value. */
export class ConnectorCredentialUnavailableError extends Error {
    readonly code = CONNECTOR_CREDENTIAL_UNAVAILABLE_CODE;
    readonly status = CONNECTOR_CREDENTIAL_UNAVAILABLE_STATUS;
    readonly statusCode = CONNECTOR_CREDENTIAL_UNAVAILABLE_STATUS;
    constructor(message: string) {
        super(message);
        this.name = 'ConnectorCredentialUnavailableError';
    }
}

/** True when `err` is the engine's fail-closed refusal to persist a `secret` field. */
function isSecretProtectionFailure(err: unknown): boolean {
    return /Cannot persist secret field/i.test(String((err as Error)?.message ?? err ?? ''));
}

function rowsOf(found: unknown): Record<string, unknown>[] {
    if (Array.isArray(found)) return found as Record<string, unknown>[];
    const env = found as { data?: unknown; records?: unknown; value?: unknown } | null | undefined;
    for (const candidate of [env?.data, env?.records, env?.value]) {
        if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
    }
    return [];
}

function optionalText(v: unknown): string | undefined {
    if (typeof v === 'string' && v.length > 0) return v;
    if (v instanceof Date) return v.toISOString();
    return undefined;
}

function toRecord(row: Record<string, unknown>): ConnectorCredentialRecord | undefined {
    if (typeof row.ref !== 'string' || row.ref.length === 0) return undefined;
    if (typeof row.id !== 'string' && typeof row.id !== 'number') return undefined;
    const revision = Number(row.revision);
    return {
        id: String(row.id),
        ref: row.ref,
        revision: Number.isFinite(revision) ? revision : 0,
        status: row.status === 'rejected' ? 'rejected' : 'set',
        statusReason: optionalText(row.status_reason),
        connectorName: optionalText(row.connector_name),
        packageId: optionalText(row.package_id),
        lastVerifiedAt: optionalText(row.last_verified_at),
        updatedAt: optionalText(row.updated_at),
        updatedBy: optionalText(row.updated_by),
    };
}

/**
 * The `sys_connector_credential` store. One per automation plugin. It never
 * caches a value: {@link resolve} reads the row at the moment of use.
 */
export class ConnectorCredentialStore {
    constructor(private readonly resolveEngine: () => ConnectorCredentialEngine | undefined) {}

    /** Whether a data engine is composed at all — without one nothing is stored and every row read is empty. */
    hasEngine(): boolean {
        return this.resolveEngine() !== undefined;
    }

    /**
     * Every stored row, keyed by reference. Throws when the read fails — the
     * caller decides how loud that is; a store that silently read as empty
     * would degrade every connector whose credential it holds.
     */
    async list(): Promise<Map<string, ConnectorCredentialRecord>> {
        const engine = this.resolveEngine();
        const out = new Map<string, ConnectorCredentialRecord>();
        if (!engine) return out;
        const found = await engine.find(CONNECTOR_CREDENTIAL_OBJECT, { fields: RECORD_FIELDS, context: SYSTEM_CONTEXT });
        for (const row of rowsOf(found)) {
            const record = toRecord(row);
            if (record) out.set(record.ref, record);
        }
        return out;
    }

    /** The row for one reference, or `undefined` when none is stored. */
    async read(ref: string): Promise<ConnectorCredentialRecord | undefined> {
        const engine = this.resolveEngine();
        if (!engine) return undefined;
        const found = await engine.find(CONNECTOR_CREDENTIAL_OBJECT, {
            where: { ref },
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
     * The plaintext of one stored row, read now. Throws
     * {@link ConnectorCredentialUnavailableError} when the row does not come
     * back: no data engine, an engine without the privileged dereference, no
     * crypto provider, or a ciphertext row that is gone. Never read as "no
     * credential" — the caller degrades the instance and says why.
     */
    async resolve(record: ConnectorCredentialRecord): Promise<string> {
        const engine = this.resolveEngine();
        if (!engine) {
            throw new ConnectorCredentialUnavailableError(
                `Connector credential '${record.ref}' is stored but cannot be read: no data engine is available to the automation service.`,
            );
        }
        if (typeof engine.resolveSecretField !== 'function') {
            throw new ConnectorCredentialUnavailableError(
                `Connector credential '${record.ref}' is stored encrypted, but this data engine cannot dereference an encrypted field.`,
            );
        }
        let plain: string | null;
        try {
            plain = await engine.resolveSecretField(CONNECTOR_CREDENTIAL_OBJECT, record.id, CONNECTOR_CREDENTIAL_VALUE_FIELD);
        } catch {
            // The engine's own message is not interpolated: this text reaches
            // `GET /connectors` as the husk's reason, and a foreign message is
            // not ours to vouch for.
            throw new ConnectorCredentialUnavailableError(
                `Connector credential '${record.ref}' is stored but could not be decrypted. Register the crypto provider it was `
                    + 'written with on the data engine; the instance retries on its own.',
            );
        }
        if (typeof plain === 'string' && plain.length > 0) return plain;
        throw new ConnectorCredentialUnavailableError(
            `Connector credential '${record.ref}' is stored but resolved to nothing — its ciphertext row is missing. Set it again.`,
        );
    }

    /**
     * Store a value for `ref`, replacing what the row held and raising its
     * revision. The engine encrypts it; with no crypto provider the engine
     * refuses before anything is written, and so does this.
     */
    async set(args: {
        ref: string;
        value: string;
        userId?: string;
        connectorNames: readonly string[];
        packageIds: readonly string[];
    }): Promise<{ created: boolean; revision: number }> {
        const engine = this.resolveEngine();
        if (!engine) {
            throw new ConnectorCredentialUnavailableError(
                `Connector credential '${args.ref}' was not stored: no data engine is available to the automation service, `
                    + 'and a connector credential is kept only in the encrypted credential store. Nothing was written.',
            );
        }
        const existing = await this.read(args.ref);
        const context = { ...SYSTEM_CONTEXT, ...(args.userId ? { userId: args.userId } : {}) };
        const revision = (existing?.revision ?? 0) + 1;
        const bookkeeping = {
            revision,
            status: 'set',
            status_reason: null,
            connector_name: args.connectorNames.length > 0 ? args.connectorNames.join(', ') : null,
            package_id: args.packageIds.length > 0 ? args.packageIds.join(', ') : null,
        };
        try {
            if (existing) {
                await engine.update(
                    CONNECTOR_CREDENTIAL_OBJECT,
                    { id: existing.id, [CONNECTOR_CREDENTIAL_VALUE_FIELD]: args.value, ...bookkeeping },
                    { context },
                );
            } else {
                await engine.insert(
                    CONNECTOR_CREDENTIAL_OBJECT,
                    { ref: args.ref, [CONNECTOR_CREDENTIAL_VALUE_FIELD]: args.value, ...bookkeeping },
                    { context },
                );
            }
        } catch (err) {
            if (isSecretProtectionFailure(err)) {
                throw new ConnectorCredentialUnavailableError(
                    `Connector credential '${args.ref}' was not stored: the encrypted credential store needs a crypto provider `
                        + 'this deployment has not registered. Nothing was written. Register one on the data engine '
                        + '(setCryptoProvider — LocalCryptoProvider in development, a KMS-backed provider in production) and set it again.',
                );
            }
            throw err;
        }
        return { created: !existing, revision };
    }

    /** Remove the row for `ref`. `false` when none was stored. */
    async clear(ref: string): Promise<boolean> {
        const engine = this.resolveEngine();
        if (!engine) return false;
        const existing = await this.read(ref);
        if (!existing) return false;
        await engine.delete(CONNECTOR_CREDENTIAL_OBJECT, { where: { id: existing.id }, context: SYSTEM_CONTEXT });
        return true;
    }

    /**
     * Record that an instance materialized with revision `revision`: the
     * timestamp moves, and a `rejected` row whose same value now works returns
     * to `set`. A row rewritten since (another revision) is left alone.
     */
    async markMaterialized(record: ConnectorCredentialRecord, at: Date = new Date()): Promise<void> {
        const engine = this.resolveEngine();
        if (!engine) return;
        const current = await this.read(record.ref);
        if (!current || current.revision !== record.revision) return;
        await engine.update(
            CONNECTOR_CREDENTIAL_OBJECT,
            { id: current.id, last_verified_at: at.toISOString(), status: 'set', status_reason: null },
            { context: SYSTEM_CONTEXT },
        );
    }

    /**
     * Record that an upstream refused revision `revision`. `reason` is the
     * connector's message, already scrubbed of the value by the caller
     * ({@link withoutCredential}).
     */
    async markRejected(record: ConnectorCredentialRecord, reason: string): Promise<void> {
        const engine = this.resolveEngine();
        if (!engine) return;
        const current = await this.read(record.ref);
        if (!current || current.revision !== record.revision) return;
        await engine.update(
            CONNECTOR_CREDENTIAL_OBJECT,
            { id: current.id, status: 'rejected', status_reason: reason },
            { context: SYSTEM_CONTEXT },
        );
    }
}

/**
 * `message` with every occurrence of `secret` replaced. A provider's message
 * is foreign text; an upstream that echoes the credential back must not carry
 * it into a log line, a husk's reason or a stored status.
 */
export function withoutCredential(message: string, secret: string | undefined): string {
    if (!secret || secret.length < 4) return message;
    return message.split(secret).join('[credential withheld]');
}

/**
 * `err` with `secret` withheld from its message, keeping the structural marks
 * a caller branches on (`code`, `status`, `name`). Returned unchanged when the
 * secret appears nowhere in its message chain; otherwise rebuilt without its
 * stack and cause, which carry the same text.
 */
export function withoutCredentialThrown(err: unknown, secret: string | undefined): unknown {
    if (!secret || secret.length < 4 || !(err instanceof Error)) return err;
    let leaks = false;
    let cur: unknown = err;
    for (let depth = 0; depth < 8 && cur instanceof Error; depth++) {
        if (cur.message.includes(secret) || (cur.stack ?? '').includes(secret)) leaks = true;
        cur = (cur as { cause?: unknown }).cause;
    }
    if (!leaks) return err;
    const scrubbed = new Error(withoutCredential(err.message, secret));
    scrubbed.name = err.name;
    scrubbed.stack = undefined;
    const marks = err as { code?: unknown; status?: unknown };
    if (marks.code !== undefined) (scrubbed as { code?: unknown }).code = marks.code;
    if (marks.status !== undefined) (scrubbed as { status?: unknown }).status = marks.status;
    return scrubbed;
}

/** The three arms of the chain, as the plugin composes them. */
export interface ConnectorCredentialChain {
    /** The environment arm. Defaults to {@link defaultEnvCredentialResolver}. */
    readonly env?: (ref: string) => string | undefined;
    readonly store: ConnectorCredentialStore;
    /** The host's injected resolver, if any — the vault arm. */
    readonly vault?: CredentialResolver;
}

function envValue(chain: ConnectorCredentialChain, ref: string): string | undefined {
    const read = chain.env ?? ((r: string) => defaultEnvCredentialResolver(r) as string | undefined);
    const value = read(ref);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Whether an environment variable supplies `ref` — it wins, so a stored value would never be read. */
export function isSuppliedByEnv(chain: ConnectorCredentialChain, ref: string): boolean {
    return envValue(chain, ref) !== undefined;
}

/**
 * The degraded reason of an instance whose `credentialRef` no arm answers
 * for: the reference, and the places it can be set. Names the reference,
 * never a value — there is none.
 */
export function missingCredentialReason(ref: string, vaultWired: boolean): string {
    return `credential '${ref}' is not set. Set it under Setup → Connector credentials `
        + `(PUT /api/v1/automation/connectors/credential-refs/${encodeURIComponent(ref)}) or as the environment variable `
        + `'${ref}'${vaultWired ? ", or in the host's credential resolver" : ''}; the instance materializes once it is set, `
        + 'with no restart';
}

/**
 * A stable mark of where `ref` would resolve from right now, for the
 * reconcile's signature — `env`, `object:<revision>`, `vault`, `missing`, or
 * `unreadable` when the rows could not be read. Never derived from a value: a
 * row's revision is what moves when its value is rewritten.
 */
export function connectorCredentialFingerprint(
    chain: ConnectorCredentialChain,
    ref: string,
    rows: ReadonlyMap<string, ConnectorCredentialRecord> | undefined,
): string {
    if (envValue(chain, ref) !== undefined) return 'env';
    if (rows === undefined) return 'unreadable';
    const row = rows.get(ref);
    if (row) return `object:${row.revision}`;
    return chain.vault ? 'vault' : 'missing';
}

/** The outcome of resolving one reference through the chain. */
export type ConnectorCredentialResolution =
    | { kind: 'resolved'; source: ConnectorCredentialSource; value: string; record?: ConnectorCredentialRecord }
    | { kind: 'missing' }
    | { kind: 'unavailable'; reason: string };

/**
 * Resolve `ref` through env → stored row → vault. `rows` is the reconcile's
 * one snapshot of the store (`undefined` when it could not be read). A stored
 * row that does not come back is `unavailable`, never `missing`: the value
 * exists, the deployment cannot read it now. A vault that throws propagates —
 * the host's resolver keeps the contract it has always had.
 */
export async function resolveConnectorCredential(
    chain: ConnectorCredentialChain,
    ref: string,
    rows: ReadonlyMap<string, ConnectorCredentialRecord> | undefined,
): Promise<ConnectorCredentialResolution> {
    const fromEnv = envValue(chain, ref);
    if (fromEnv !== undefined) return { kind: 'resolved', source: 'env', value: fromEnv };
    if (rows === undefined) {
        return {
            kind: 'unavailable',
            reason: `the connector credential store could not be read, so credential '${ref}' cannot be resolved now; the instance retries on its own.`,
        };
    }
    const record = rows.get(ref);
    if (record) {
        try {
            return { kind: 'resolved', source: 'object', value: await chain.store.resolve(record), record };
        } catch (err) {
            return { kind: 'unavailable', reason: (err as Error).message };
        }
    }
    if (chain.vault) {
        const fromVault = await chain.vault(ref);
        if (typeof fromVault === 'string' && fromVault.length > 0) return { kind: 'resolved', source: 'vault', value: fromVault };
    }
    return { kind: 'missing' };
}

/**
 * Where `ref` resolves from and whether it is set, for a listing — the value
 * is read only where presence cannot be told otherwise (the vault arm) and is
 * dropped on the spot.
 */
export async function probeConnectorCredential(
    chain: ConnectorCredentialChain,
    ref: string,
    rows: ReadonlyMap<string, ConnectorCredentialRecord>,
): Promise<{ source: ConnectorCredentialSource | null; status: 'set' | 'missing' | 'rejected'; record?: ConnectorCredentialRecord }> {
    if (envValue(chain, ref) !== undefined) return { source: 'env', status: 'set' };
    const record = rows.get(ref);
    if (record) return { source: 'object', status: record.status, record };
    if (chain.vault) {
        let present = false;
        try {
            const v = await chain.vault(ref);
            present = typeof v === 'string' && v.length > 0;
        } catch {
            present = false;
        }
        if (present) return { source: 'vault', status: 'set' };
    }
    return { source: null, status: 'missing' };
}
