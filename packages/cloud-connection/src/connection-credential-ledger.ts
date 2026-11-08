// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where this runtime's cloud binding credential lives, as one surface the
 * plugin writes and every reader reads (cloud ADR-0008 consumption side).
 *
 * Two homes, chosen once per boot by `CloudConnectionPlugin.init()`:
 *
 *   - **A single node** keeps the credential in its local file,
 *     `<cwd>/.objectstack/cloud-connection.json`, through
 *     {@link ConnectionCredentialStore}, exactly as before this module existed:
 *     {@link fileCredentialLedger} is a pass-through, so the path, the bytes
 *     and the 0600 mode do not move.
 *   - **Several replicas** — declared (`OS_CLUSTER_REPLICAS` > 1 or
 *     `OS_EXPECT_MULTI_NODE=true`) AND served by the Redis cluster driver — keep
 *     it in the one `sys_cloud_binding_credential` row of the database every
 *     replica shares ({@link SharedConnectionCredentialLedger}). A bind on any
 *     replica is read by all of them; an unbind clears it for all of them. Both
 *     conditions, never one (the rule every multi-replica card follows:
 *     {@link sharesCloudBindingCredential}): a declaration over the in-process
 *     driver is the split-brain guard's to refuse, a declaration over any other
 *     driver is not a topology these cards serve, and Redis with nothing
 *     declared is a single node.
 *
 * Before the kernel, the host's config reads the same row once through
 * `readCloudBindingCredentialBeforeBoot` (`connection-credential-preboot.ts`)
 * for the multi-node licence gate.
 *
 * Why the database row and not the cluster key-value store, and how the row
 * is sealed: `sys-cloud-binding-credential.object.ts`.
 *
 * ## Freshness on a replica that did not take the write
 *
 * The plugin's doors re-read the row at the moment they run ({@link
 * ConnectionCredentialLedger.load}), so every door on every replica acts on the
 * binding as it stands. The `cloud-binding` service answers synchronously
 * (`ICloudBindingService.credential()`), so it reads the copy the last load
 * left ({@link ConnectionCredentialLedger.read}); the plugin loads it at
 * `kernel:ready`, before any door is mounted, and again every
 * {@link SHARED_CREDENTIAL_REFRESH_MS} while it runs. That interval is the
 * bound on how stale a synchronous read on a peer can be — no cluster message
 * is relied on to shorten it. A caller that must not act on a stale copy (the
 * online licence check) awaits `load()` through
 * {@link CLOUD_BINDING_CREDENTIAL_SERVICE} instead.
 *
 * ⛔ The credential never appears in a log line, an error message or a thrown
 * error this module raises: a failure names the store and the remedy.
 */

import { ConnectionCredentialStore, type StoredConnectionCredential } from './connection-credential-store.js';
import { declaresMultiNode } from '@objectstack/service-cluster';

/**
 * The one cluster driver whose replicas share the binding credential. The
 * multi-replica cards take effect only over Redis (cloud#3814 R2/R3); the
 * entitlement half gates on the same driver.
 */
export const CLOUD_BINDING_SHARED_CLUSTER_DRIVER = 'redis';

/**
 * Does this deployment keep the binding credential in the shared row? Exactly
 * when replicas are declared (`declaresMultiNode`, the predicate the
 * entitlement half reads, so the two licence halves cannot drift) AND the
 * cluster driver is {@link CLOUD_BINDING_SHARED_CLUSTER_DRIVER}. The plugin
 * asks it with the cluster service's driver; the pre-boot read asks it with
 * `OS_CLUSTER_DRIVER`.
 */
export function sharesCloudBindingCredential(
    env: Readonly<Record<string, string | undefined>>,
    clusterDriver: string | undefined,
): boolean {
    return declaresMultiNode(env) && clusterDriver?.trim() === CLOUD_BINDING_SHARED_CLUSTER_DRIVER;
}

/** The object a shared binding credential lives in (`sys-cloud-binding-credential.object.ts`). */
export const CLOUD_BINDING_CREDENTIAL_OBJECT = 'sys_cloud_binding_credential';

/** Its `type: 'secret'` column. */
export const CLOUD_BINDING_CREDENTIAL_TOKEN_FIELD = 'runtime_token';

/** The key of the one row a deployment holds. */
export const CLOUD_BINDING_CREDENTIAL_SLOT = 'runtime';

/**
 * The kernel service `CloudConnectionPlugin` registers the READ half of its
 * ledger under ({@link CloudBindingCredentialReader}), on every path. A reader
 * outside the plugin that needs the stored binding — its runtime id, its
 * control-plane URL, or a bearer it must not read stale — asks this service,
 * never the file: with replicas declared, the file is not where the binding is.
 */
export const CLOUD_BINDING_CREDENTIAL_SERVICE = 'cloud-binding-credential';

/** How often a replica re-reads the shared row for its synchronous readers, in ms. */
export const SHARED_CREDENTIAL_REFRESH_MS = 30_000;

/** The one surface the plugin writes the binding through and its readers read it from. */
export interface ConnectionCredentialLedger {
    /**
     * `true` when the credential lives in the shared database row (replicas
     * declared over the Redis cluster driver); `false` on a single node, where
     * it lives in the local file.
     */
    readonly shared: boolean;
    /**
     * The credential, synchronously: a file read on a single node; on shared
     * replicas, the copy the last {@link load} left. `null` when none is stored.
     * Never throws.
     */
    read(): StoredConnectionCredential | null;
    /**
     * The credential as the store holds it now. On shared replicas this reads
     * the row and refreshes the copy {@link read} answers. Throws when the
     * shared row cannot be read or decrypted, and leaves that copy as it was —
     * an unreadable store is never reported as "not bound".
     */
    load(): Promise<StoredConnectionCredential | null>;
    /** Persist (replace) the credential. */
    write(credential: StoredConnectionCredential): Promise<void>;
    /** Remove the credential (unbind). `false` when nothing was stored. */
    clear(): Promise<boolean>;
}

/** What {@link CLOUD_BINDING_CREDENTIAL_SERVICE} answers: the ledger's read half. Writes stay with the plugin's doors. */
export type CloudBindingCredentialReader = Pick<ConnectionCredentialLedger, 'shared' | 'read' | 'load'>;

/**
 * The single-node ledger: {@link ConnectionCredentialStore}, unchanged, behind
 * the ledger's surface. Every call is the file call it wraps.
 */
export function fileCredentialLedger(store: ConnectionCredentialStore): ConnectionCredentialLedger {
    return {
        shared: false,
        read: () => store.read(),
        load: async () => store.read(),
        write: async (credential) => { store.write(credential); },
        clear: async () => store.clear(),
    };
}

/**
 * The slice of the data engine the shared ledger uses — ObjectQL's, declared
 * structurally, as `sys_connector_credential`'s store declares it.
 */
export interface BindingCredentialEngine {
    find(object: string, query?: Record<string, unknown>): Promise<unknown>;
    insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    delete(object: string, options?: Record<string, unknown>): Promise<unknown>;
    /** The privileged dereference of one row's `secret`-typed field. */
    resolveSecretField?(object: string, recordId: string, field: string): Promise<string | null>;
}

/** System context — the row is plugin-owned; no caller's grants apply to it. */
const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/** The columns a read asks for. The token comes back masked; {@link SharedConnectionCredentialLedger.load} dereferences it. */
const ROW_FIELDS = [
    'id', 'slot', CLOUD_BINDING_CREDENTIAL_TOKEN_FIELD, 'runtime_id', 'environment_id',
    'control_plane_url', 'cloud_organization_id', 'account_email', 'bound_at',
];

/**
 * The shared ledger cannot read or write the credential safely right now: no
 * data engine, no crypto provider, a row that does not decrypt. Its message
 * names the store and the remedy, never a value.
 */
export class SharedCredentialUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SharedCredentialUnavailableError';
    }
}

/** The rows of a data engine `find` answer, whichever envelope it came in. */
function rowsOf(found: unknown): Record<string, unknown>[] {
    if (Array.isArray(found)) return found as Record<string, unknown>[];
    const env = found as { data?: unknown; records?: unknown; value?: unknown } | null | undefined;
    for (const candidate of [env?.data, env?.records, env?.value]) {
        if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
    }
    return [];
}

/** A non-empty text column, or `undefined`. */
function text(v: unknown): string | undefined {
    if (typeof v === 'string' && v.length > 0) return v;
    if (v instanceof Date) return v.toISOString();
    return undefined;
}

/** True when `err` is the engine's fail-closed refusal to persist a `secret` field. */
function isSecretProtectionFailure(err: unknown): boolean {
    return /Cannot persist secret field/i.test(String((err as Error)?.message ?? err ?? ''));
}

/**
 * `err` with every occurrence of `token` removed from its message — what this
 * module rethrows when a write fails, so a driver or provider that echoed its
 * input cannot carry the bearer into a log line.
 */
function withoutToken(err: unknown, token: string): unknown {
    if (!token || !(err instanceof Error) || !err.message.includes(token)) return err;
    const scrubbed = new Error(err.message.split(token).join('[redacted]'));
    scrubbed.name = err.name;
    const code = (err as { code?: unknown }).code;
    if (code !== undefined) Object.assign(scrubbed, { code });
    return scrubbed;
}

/** A credential spelled with only the keys it carries — the shape the file read answers. */
function normalized(credential: StoredConnectionCredential): StoredConnectionCredential {
    const out: StoredConnectionCredential = { runtimeToken: credential.runtimeToken };
    if (credential.runtimeId) out.runtimeId = credential.runtimeId;
    if (credential.environmentId) out.environmentId = credential.environmentId;
    if (credential.controlPlaneUrl) out.controlPlaneUrl = credential.controlPlaneUrl;
    if (credential.organizationId) out.organizationId = credential.organizationId;
    if (credential.accountEmail) out.accountEmail = credential.accountEmail;
    if (credential.boundAt) out.boundAt = credential.boundAt;
    return out;
}

/**
 * The binding credential in the one `sys_cloud_binding_credential` row every
 * replica shares. Construct it only when replicas are declared over the Redis
 * cluster driver, and only after the object is registered.
 */
export class SharedConnectionCredentialLedger implements ConnectionCredentialLedger {
    readonly shared = true;
    /** What the last successful load or write left — the answer {@link read} gives. */
    private snapshot: StoredConnectionCredential | null = null;

    constructor(private readonly resolveEngine: () => BindingCredentialEngine | undefined) {}

    read(): StoredConnectionCredential | null {
        return this.snapshot;
    }

    async load(): Promise<StoredConnectionCredential | null> {
        const engine = this.engine('read');
        const row = await this.findRow(engine);
        const credential = row ? await this.credentialOf(engine, row) : null;
        this.snapshot = credential;
        return credential;
    }

    async write(credential: StoredConnectionCredential): Promise<void> {
        const engine = this.engine('stored');
        const token = credential.runtimeToken || '';
        const columns: Record<string, unknown> = {
            // `null` clears the sealed value (an unbind that keeps the identity);
            // the engine refuses `''` in a secret column, and so does this.
            [CLOUD_BINDING_CREDENTIAL_TOKEN_FIELD]: token || null,
            runtime_id: credential.runtimeId || null,
            environment_id: credential.environmentId || null,
            control_plane_url: credential.controlPlaneUrl || null,
            cloud_organization_id: credential.organizationId || null,
            account_email: credential.accountEmail || null,
            bound_at: credential.boundAt || null,
        };
        try {
            const existing = await this.findRow(engine);
            if (existing) {
                await engine.update(CLOUD_BINDING_CREDENTIAL_OBJECT, { id: existing.id, ...columns }, { context: SYSTEM_CONTEXT });
            } else {
                try {
                    await engine.insert(
                        CLOUD_BINDING_CREDENTIAL_OBJECT,
                        { slot: CLOUD_BINDING_CREDENTIAL_SLOT, ...columns },
                        { context: SYSTEM_CONTEXT },
                    );
                } catch (err) {
                    // Another replica inserted the row between this read and this
                    // insert (the unique index on `slot` refused the second). A
                    // write replaces whatever is stored, so this one lands on the
                    // row that replica made, as it would have a moment later.
                    if ((err as { code?: unknown })?.code !== 'DUPLICATE_RECORD') throw err;
                    const raced = await this.findRow(engine);
                    if (!raced) throw err;
                    await engine.update(CLOUD_BINDING_CREDENTIAL_OBJECT, { id: raced.id, ...columns }, { context: SYSTEM_CONTEXT });
                }
            }
        } catch (err) {
            if (isSecretProtectionFailure(err)) {
                throw new SharedCredentialUnavailableError(
                    'The cloud binding credential was not stored: the shared credential store encrypts it with the host crypto '
                        + 'provider, and this runtime has none registered. Nothing was written. Register one on the data engine '
                        + '(OS_SECRET_KEY for the local provider, the same key on every replica) and bind again.',
                );
            }
            throw withoutToken(err, token);
        }
        this.snapshot = normalized({ ...credential, runtimeToken: token });
    }

    async clear(): Promise<boolean> {
        const engine = this.engine('cleared');
        const existing = await this.findRow(engine);
        if (!existing) {
            this.snapshot = null;
            return false;
        }
        await engine.delete(CLOUD_BINDING_CREDENTIAL_OBJECT, { where: { id: existing.id }, context: SYSTEM_CONTEXT });
        this.snapshot = null;
        return true;
    }

    /**
     * Move a credential a single node left in its local file into the shared
     * row — once, when the row is still empty. This is how a deployment that
     * was bound on one node keeps its binding when it is scaled out: the
     * replica that holds the file writes it here, and every replica reads it.
     *
     * The file is left in place and is not read again while replicas are
     * declared. Answers whether a credential was moved.
     */
    async adoptFrom(file: ConnectionCredentialStore): Promise<boolean> {
        const local = file.read();
        if (!local) return false;
        if (await this.load()) return false;
        await this.write(local);
        return true;
    }

    private engine(verb: 'read' | 'stored' | 'cleared'): BindingCredentialEngine {
        const engine = this.resolveEngine();
        if (engine) return engine;
        throw new SharedCredentialUnavailableError(
            `The cloud binding credential could not be ${verb}: no data engine is available to this runtime, and with several `
                + 'replicas declared the credential is kept only in the shared database, never in a local file.',
        );
    }

    private async findRow(engine: BindingCredentialEngine): Promise<Record<string, unknown> | undefined> {
        const found = await engine.find(CLOUD_BINDING_CREDENTIAL_OBJECT, {
            where: { slot: CLOUD_BINDING_CREDENTIAL_SLOT },
            fields: ROW_FIELDS,
            context: SYSTEM_CONTEXT,
        });
        for (const row of rowsOf(found)) {
            if (typeof row.id === 'string' || typeof row.id === 'number') return row;
        }
        return undefined;
    }

    /** The row as a stored credential: the token dereferenced, the identity residual kept. */
    private async credentialOf(
        engine: BindingCredentialEngine,
        row: Record<string, unknown>,
    ): Promise<StoredConnectionCredential | null> {
        let runtimeToken = '';
        const sealed = row[CLOUD_BINDING_CREDENTIAL_TOKEN_FIELD];
        if (sealed !== null && sealed !== undefined && sealed !== '') {
            if (typeof engine.resolveSecretField !== 'function') {
                throw new SharedCredentialUnavailableError(
                    'The cloud binding credential is stored encrypted, but this data engine cannot dereference an encrypted field.',
                );
            }
            let plain: string | null;
            try {
                plain = await engine.resolveSecretField(CLOUD_BINDING_CREDENTIAL_OBJECT, String(row.id), CLOUD_BINDING_CREDENTIAL_TOKEN_FIELD);
            } catch {
                // The engine's own message is not interpolated: it is not ours
                // to vouch for, and this text reaches a log line.
                throw new SharedCredentialUnavailableError(
                    'The cloud binding credential is stored but could not be decrypted on this replica. Every replica must run '
                        + 'with the crypto provider key it was written with (OS_SECRET_KEY for the local provider).',
                );
            }
            if (typeof plain !== 'string' || plain.length === 0) {
                throw new SharedCredentialUnavailableError(
                    'The cloud binding credential is stored but resolved to nothing: its encrypted value is missing. Bind again.',
                );
            }
            runtimeToken = plain;
        }
        const runtimeId = text(row.runtime_id);
        // A row with neither a bearer nor an identity holds nothing — the file
        // read gives the same answer for the same record.
        if (!runtimeToken && !runtimeId) return null;
        return normalized({
            runtimeToken,
            runtimeId,
            environmentId: text(row.environment_id),
            controlPlaneUrl: text(row.control_plane_url),
            organizationId: text(row.cloud_organization_id),
            accountEmail: text(row.account_email),
            boundAt: text(row.bound_at),
        });
    }
}
