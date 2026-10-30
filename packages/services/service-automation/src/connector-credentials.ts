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
 * Under a walled tenancy posture (`group` / `isolated`) the stored arm is not
 * consulted at all (S1 on #27230): the plugin composes the chain without a
 * store, so a reference resolves from the environment or the host's resolver
 * only, as the credential door's refusal there says.
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

/**
 * [#27428] The cluster channel a credential door write fans out on — lane 4
 * of the cluster-invalidation family (`content/docs/kernel/cluster.mdx`
 * §6.2), attached by `MetadataClusterBridgePlugin` in
 * `@objectstack/service-cluster` beside `metadata.changed`,
 * `metadata.mutated` and `datasource.mutated`.
 *
 * The door reconciles the replica that took the request; every other replica
 * holds its own materialized instances, and one whose stored value its
 * upstream refused is held with no retry timer — so before this channel a
 * corrected credential took effect on one replica at once and on the others
 * only after a metadata reload or a restart.
 */
export const CONNECTOR_CREDENTIAL_MUTATION_CLUSTER_CHANNEL = 'connector-credential.mutated';

/**
 * [#27428] Payload for {@link CONNECTOR_CREDENTIAL_MUTATION_CLUSTER_CHANNEL}.
 *
 * ⭐ A SIGNAL, never trusted content — the family's contract: only the
 * reference rides the channel, never a value, a fingerprint or a revision.
 * The receiving replica runs its own reconcile, which re-reads the shared
 * `sys_connector_credential` rows (revision, then fingerprint), so a
 * duplicate or re-ordered delivery converges to the same instances as a
 * single one. Symmetric: a set and a clear publish this one shape.
 */
export interface ClusterConnectorCredentialMutationPayload {
    /** Origin nodeId — used for loopback suppression. */
    originNode?: string;
    /** The reference whose stored row was just written or cleared. */
    ref: string;
}

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
    /** When the value was last set through the door, and by whom — not moved by a status change. */
    updatedAt?: string;
    updatedBy?: string;
}

/** The columns a read asks for — `value` is never among them. */
const RECORD_FIELDS = [
    'id', 'ref', 'revision', 'status', 'status_reason', 'connector_name', 'package_id',
    'last_verified_at', 'set_at', 'set_by',
];

/**
 * The prefix the data engine reads as a handle to a secret it already holds
 * (ObjectQL's `SECRET_REF_PREFIX`): a `secret`-typed value spelled this way is
 * stored as given, unencrypted, and dereferenced as another `sys_secret` row.
 * The credential door refuses a value that starts with it.
 */
export const SECRET_HANDLE_PREFIX = 'secret:';

/**
 * A credential door refusal: an ADR-0112 standard-catalog `code` and its
 * `status` on the thrown error, the shape the `/automation` domain answers a
 * service rejection with. Its message names the reference, never a value.
 */
export function credentialDoorRefusal(message: string, code: string, status: number): Error {
    return Object.assign(new Error(message), { code, status, statusCode: status });
}

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
        updatedAt: optionalText(row.set_at),
        updatedBy: optionalText(row.set_by),
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
     *
     * Read-then-write: the plugin runs every door write on its reconcile
     * queue, so two writes in one process never interleave. Two replicas
     * inserting the first row for one reference at once meet the unique index
     * on `ref`, and the loser answers `409`.
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
            last_verified_at: null,
            set_at: new Date().toISOString(),
            set_by: args.userId ?? null,
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
            if ((err as { code?: unknown })?.code === 'DUPLICATE_RECORD') {
                throw credentialDoorRefusal(
                    `Credential '${args.ref}' was stored by another writer at the same moment. Nothing was written by this `
                        + 'request; read the listing and set it again if it still needs this value.',
                    'RESOURCE_CONFLICT',
                    409,
                );
            }
            // Whatever else refused the write answers without the value it was handed.
            throw withoutCredentialThrown(err, credentialForms(args.value));
        }
        return { created: !existing, revision };
    }

    /** Remove the row for `ref`, under the caller's user id for the audit. `false` when none was stored. */
    async clear(ref: string, userId?: string): Promise<boolean> {
        const engine = this.resolveEngine();
        if (!engine) return false;
        const existing = await this.read(ref);
        if (!existing) return false;
        const context = { ...SYSTEM_CONTEXT, ...(userId ? { userId } : {}) };
        await engine.delete(CONNECTOR_CREDENTIAL_OBJECT, { where: { id: existing.id }, context });
        return true;
    }

    /**
     * Record that a provider PROVED revision `revision` while materializing
     * (`credentialVerified` — the mcp handshake carried it and the upstream
     * answered). The timestamp moves, and a `rejected` row whose same value now
     * works returns to `set`: this and setting the value again are the only
     * ways back. A materialization alone proves nothing (rest and openapi
     * first send the value on a call), so it never calls this. A row rewritten
     * since (another revision) is left alone.
     */
    async markVerified(record: ConnectorCredentialRecord, at: Date = new Date()): Promise<void> {
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
     * Record that a call sent with revision `revision` was answered `2xx`:
     * the timestamp moves on a row still at `set`, and nothing else. A `2xx`
     * proves nothing about a credential the endpoint may not have checked (a
     * public path, an openapi operation with `security: []`), so it never
     * returns a `rejected` row to `set` — {@link markVerified} or a new value
     * does that.
     */
    async markCallAccepted(record: ConnectorCredentialRecord, at: Date = new Date()): Promise<void> {
        const engine = this.resolveEngine();
        if (!engine) return;
        const current = await this.read(record.ref);
        if (!current || current.revision !== record.revision || current.status !== 'set') return;
        await engine.update(
            CONNECTOR_CREDENTIAL_OBJECT,
            { id: current.id, last_verified_at: at.toISOString() },
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

/** What a scrub withholds: one value, or every spelling of it ({@link credentialForms}). */
export type WithheldCredential = string | readonly string[] | undefined;

/** The shortest spelling a scrub withholds — a shorter one would blank ordinary words. */
const MIN_WITHHELD_LENGTH = 4;

function base64Of(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/**
 * Every spelling of `value` an upstream or a client library may echo back:
 * the value itself; URL-encoded, as an api-key sent as a query parameter
 * travels in the request URL; base64; and, given the `basic` `username`,
 * base64(`username:value`), the `Authorization: Basic` header. A base64 form
 * is kept without its `=` padding, so an echo that drops the padding is
 * withheld too. Longest first, so a longer form is replaced before a shorter
 * one inside it.
 */
export function credentialForms(value: string | undefined, username?: string): string[] {
    if (!value) return [];
    const forms = new Set<string>([value, encodeURIComponent(value), base64Of(value).replace(/=+$/, '')]);
    if (username !== undefined) forms.add(base64Of(`${username}:${value}`).replace(/=+$/, ''));
    return [...forms].filter((f) => f.length >= MIN_WITHHELD_LENGTH).sort((a, b) => b.length - a.length);
}

function withheldForms(secret: WithheldCredential): readonly string[] {
    if (secret === undefined) return [];
    if (typeof secret === 'string') return secret.length >= MIN_WITHHELD_LENGTH ? [secret] : [];
    return secret.filter((f) => f.length >= MIN_WITHHELD_LENGTH);
}

/**
 * `message` with every occurrence of `secret` replaced — one value, or every
 * spelling {@link credentialForms} lists. A provider's message is foreign
 * text; an upstream that echoes the credential back, in any of those
 * spellings, must not carry it into a log line, a husk's reason or a stored
 * status.
 */
export function withoutCredential(message: string, secret: WithheldCredential): string {
    let out = message;
    for (const form of withheldForms(secret)) out = out.split(form).join('[credential withheld]');
    return out;
}

/**
 * `err` with `secret` withheld from its message, keeping the structural marks
 * a caller branches on (`code`, `status`, `name`). Returned unchanged when no
 * spelling of the secret appears in its message chain; otherwise rebuilt
 * without its stack and cause, which carry the same text.
 */
export function withoutCredentialThrown(err: unknown, secret: WithheldCredential): unknown {
    const forms = withheldForms(secret);
    if (forms.length === 0 || !(err instanceof Error)) return err;
    let leaks = false;
    let cur: unknown = err;
    for (let depth = 0; depth < 8 && cur instanceof Error; depth++) {
        const text = `${cur.message}\n${cur.stack ?? ''}`;
        if (forms.some((f) => text.includes(f))) leaks = true;
        cur = (cur as { cause?: unknown }).cause;
    }
    if (!leaks) return err;
    const scrubbed = new Error(withoutCredential(err.message, forms));
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
    /** The stored arm. Absent under a walled tenancy posture, where it is not consulted. */
    readonly store?: ConnectorCredentialStore;
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
    if (chain.store) {
        if (rows === undefined) return 'unreadable';
        const row = rows.get(ref);
        if (row) return `object:${row.revision}`;
    }
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
    if (chain.store) {
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
    const record = chain.store ? rows.get(ref) : undefined;
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

/**
 * The HTTP status of a connector call's `{ status }` result when the upstream
 * refused the credential — 401 or 403 (ruling on #27237, comment 6470087293).
 * The rest and openapi providers answer every response as `{ status, ok,
 * body }` rather than throwing, so a refusal is read off the result.
 */
export function credentialRejectionStatusOf(result: unknown): 401 | 403 | undefined {
    if (typeof result !== 'object' || result === null) return undefined;
    const status = (result as { status?: unknown }).status;
    return status === 401 || status === 403 ? status : undefined;
}

/** The bound on an upstream's words kept in a reason or a row. */
export const UPSTREAM_REFUSAL_MESSAGE_MAX_LENGTH = 500;

/**
 * The upstream's own words from a refused call's body — the body itself when
 * it is text, else its usual `message` / `error_description` / `error` /
 * `error.message` / `detail` / `title` key — on one line, bounded, and with
 * `secret` withheld BEFORE the bound is applied, so a cut can never leave part
 * of it behind.
 */
export function upstreamRefusalMessage(body: unknown, secret: WithheldCredential): string | undefined {
    let text: unknown;
    if (typeof body === 'string') {
        text = body;
    } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        const nested = typeof b.error === 'object' && b.error !== null ? (b.error as Record<string, unknown>).message : b.error;
        text = [b.message, b.error_description, nested, b.detail, b.title].find(
            (v): v is string => typeof v === 'string' && v.trim().length > 0,
        );
    }
    if (typeof text !== 'string') return undefined;
    const flat = withoutCredential(text, secret).replace(/\s+/g, ' ').trim();
    if (flat.length === 0) return undefined;
    return flat.length > UPSTREAM_REFUSAL_MESSAGE_MAX_LENGTH ? `${flat.slice(0, UPSTREAM_REFUSAL_MESSAGE_MAX_LENGTH)}…` : flat;
}

/**
 * The degraded reason for an instance whose upstream refused its credential
 * on a call. `held`: the value is a stored one, so the instance waits for it
 * to be set again (or a restart); otherwise (an environment variable, the
 * host's resolver) it is retried on the backoff, since the value can change
 * where this door cannot see it.
 */
export function credentialRejectedOnCallReason(
    name: string,
    ref: string,
    status: number,
    upstream: string | undefined,
    held: boolean,
): string {
    return (
        `connector '${name}' was refused by its upstream (HTTP ${status}) on a call: credential '${ref}' is missing, wrong ` +
        `or not authorized${upstream ? ` (the upstream said: ${upstream})` : ''}. ` +
        (held
            ? `The instance stays degraded, without retrying, until credential '${ref}' is set again or the server restarts.`
            : 'The instance is retried with backoff.')
    );
}

/**
 * A `2xx` result of a connector call. The rest and openapi providers answer
 * `{ status, ok, body }`. Not a proof the credential is valid: the endpoint
 * may not have checked it.
 */
export function isAcceptedCallResult(result: unknown): boolean {
    if (typeof result !== 'object' || result === null) return false;
    const status = (result as { status?: unknown }).status;
    return typeof status === 'number' && status >= 200 && status < 300;
}
