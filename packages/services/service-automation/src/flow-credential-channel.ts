// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The flow credential channel — write-only, on the #7799 seam (#20790)
 *
 * A flow's two credentials — the inbound hook's secret on its start node and
 * an `http` node's signing secret — used to live in the flow DEFINITION, so
 * the stored metadata row, every version-history row and the row's content
 * hash carried them in cleartext, and every read exit had to withhold them one
 * door at a time. This module moves them out:
 *
 *   authored literal  →  the metadata save door (`store`, registered on the
 *                        protocol as the `flow` credential channel)
 *                     →  `sys_flow_credential.value` (`type: 'secret'`)
 *                     →  the engine encrypts it → `sys_secret` ciphertext row
 *   stored definition →  the same definition WITHOUT it — exactly the form a
 *                        read serves (`stripFlowCredentialValues`)
 *
 * and the engine recovers the plaintext server-side, only at verification
 * (an inbound post) and execution (an `http` node signing), through
 * `engine.resolveSecretField()`. ⛔ No second secret mechanism: the cipher,
 * the masking and the fail-closed posture are the engine's own.
 *
 * ## The write rule, per position (`flowCredentialPositions`)
 *
 *  - an explicit value → written to the channel (replacing what it held) and
 *    removed from the definition — the only way a credential rotates;
 *  - absent (the withheld form a read serves) → the channel keeps what it
 *    holds — #20552's round-trip rule, unchanged;
 *  - the cleared form `''` → the channel's row is removed and `''` is stored,
 *    so "cleared" stays distinguishable from "withheld";
 *  - a row whose position the definition no longer has (the node removed, or
 *    its kind changed) → removed: a credential never outlives its position;
 *  - the start node's secret NAMED instead (`config.secretRef`, no `secret`)
 *    → removed too: the deployment fills that name and the engine resolves it
 *    per post, so a stored literal would only be a stale credential at rest.
 *
 * Every write of a VALUE comes first: with no crypto provider the engine
 * refuses the first one before anything — channel row or stored row — is
 * written, and the save is refused with {@link FlowCredentialChannelRefusal}.
 *
 * ## Lifecycle state
 *
 * A row belongs to one lifecycle state of the stored row: a DRAFT save writes
 * `state: 'draft'` rows, so it never rotates the live hook; publishing the
 * draft promotes them (`promote`). A restore (rollback / revert) writes
 * nothing here: the channel keeps its current credential (`strip`).
 *
 * ## The presence index
 *
 * The engine's registration check and binding decisions are synchronous, so
 * which ACTIVE positions the channel holds is kept in memory, loaded at boot
 * and kept current by every write this process makes. The value itself is
 * never cached: `resolve` reads the row at the moment of use, so a rotation
 * takes effect on the next post.
 */

import { createHash } from 'node:crypto';
import { PackageScopedNameRefusedError, type PackageScopedRefusal } from '@objectstack/core';
import type { FlowCredentialSource } from './engine.js';
import {
    FLOW_METADATA_TYPE,
    flowCredentialClassList,
    flowCredentialPositions,
    stripFlowCredentialValues,
    type FlowCredentialPosition,
} from './flow-credential-projection.js';

/** The object a flow's credentials live in (`sys-flow-credential.object.ts`). */
export const FLOW_CREDENTIAL_OBJECT = 'sys_flow_credential';

/** Its `type: 'secret'` column. */
export const FLOW_CREDENTIAL_VALUE_FIELD = 'value';

/** The lifecycle states a row belongs to — those of the stored flow row. */
export type FlowCredentialState = 'draft' | 'active';

/**
 * ADR-0112 pair for a refusal this channel raises: the deployment cannot hold
 * a credential safely right now (no crypto provider, no data engine, a stored
 * credential that does not resolve). A standard-catalog member, so a consumer
 * branches on `code`; `503` because the condition belongs to the deployment,
 * not to the request, and clears when the deployment is fixed.
 */
export const FLOW_CREDENTIAL_UNAVAILABLE_CODE = 'SERVICE_UNAVAILABLE';
export const FLOW_CREDENTIAL_UNAVAILABLE_STATUS = 503;

/** System context — the channel is engine-owned; no caller's grants apply to it. */
const SYSTEM_CONTEXT = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The slice of the data engine the channel uses — ObjectQL's, declared
 * structurally so this package keeps no build dependency on it.
 */
export interface FlowCredentialEngine {
    find(object: string, query?: Record<string, unknown>): Promise<unknown>;
    insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
    delete(object: string, options?: Record<string, unknown>): Promise<unknown>;
    /** The privileged dereference of one row's `secret`-typed field (ObjectQL ≥ #7799). */
    resolveSecretField?(object: string, recordId: string, field: string): Promise<string | null>;
}


/**
 * The save door's refusal: a credential cannot be stored safely, so the save
 * is refused and NOTHING is written — not the channel row, not the stored
 * definition. Carries the ADR-0112 pair as fields.
 */
export class FlowCredentialChannelRefusal extends Error {
    readonly code = FLOW_CREDENTIAL_UNAVAILABLE_CODE;
    readonly status = FLOW_CREDENTIAL_UNAVAILABLE_STATUS;
    readonly statusCode = FLOW_CREDENTIAL_UNAVAILABLE_STATUS;
    constructor(message: string) {
        super(message);
        this.name = 'FlowCredentialChannelRefusal';
    }
}

/**
 * A credential the channel HOLDS did not come back. Never read as "no
 * credential": an inbound post is then answered as unavailable rather than
 * verified against nothing, and an `http` node is refused rather than sent
 * unsigned.
 */
export class FlowCredentialUnresolvableError extends Error {
    readonly code = FLOW_CREDENTIAL_UNAVAILABLE_CODE;
    readonly status = FLOW_CREDENTIAL_UNAVAILABLE_STATUS;
    constructor(message: string) {
        super(message);
        this.name = 'FlowCredentialUnresolvableError';
    }
}

/** True when `err` is the engine's fail-closed refusal to persist a `secret` field. */
function isSecretProtectionFailure(err: unknown): boolean {
    return /Cannot persist secret field/i.test(String((err as Error)?.message ?? err ?? ''));
}

/** One stored channel row, as far as the channel reads it (never the value). */
interface ChannelRow {
    id: string;
    node_id: string;
    credential_key: string;
    state: FlowCredentialState;
    /** [ADR-0150 D8 row R9] The row's `flow_package`; `''` for a row naming none. */
    flow_package: string;
}

/** A row's `flow_package`, `''` for one naming no package. */
function rowPackage(row: Record<string, unknown>): string {
    return typeof row.flow_package === 'string' ? row.flow_package : '';
}

/** The identity of a position within one flow and state. */
function positionKey(nodeId: string, key: string): string {
    return JSON.stringify([nodeId, key]);
}

/** The bounded column the unique index keys on: SHA-256 hex of {@link positionKey}. */
function positionDigest(nodeId: string, key: string): string {
    return createHash('sha256').update(positionKey(nodeId, key), 'utf8').digest('hex');
}

function rowsOf(found: unknown): Record<string, unknown>[] {
    if (Array.isArray(found)) return found as Record<string, unknown>[];
    const env = found as { data?: unknown; records?: unknown; value?: unknown } | null | undefined;
    for (const candidate of [env?.data, env?.records, env?.value]) {
        if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
    }
    return [];
}

/**
 * The flow credential channel. One per automation plugin; it implements the
 * engine's {@link FlowCredentialSource} and backs the protocol's `flow`
 * credential channel, the publish promotion and the delete projection.
 */
export class FlowCredentialChannel implements FlowCredentialSource {
    /** [ADR-0150 D8 row R9, #31696] Given `flowPackage`, only that package's rows answer. */
    readonly readsByPackage = true;

    /**
     * flow name → row package (`''` for none) → the ACTIVE positions the
     * channel holds. [ADR-0150 D8 row R9, #31696] Keyed by package too, so a
     * flow of a name two packages hold reads only its own package's rows.
     */
    private readonly activeIndex = new Map<string, Map<string, Set<string>>>();

    /**
     * @param sharedRefusalOf [ADR-0150 D8 row R9, #31696] The refusal of `name` for a writer with no package
     *   when two or more packages hold it (the engine's `flowHolder`), else `undefined`. The save door names
     *   no package, so under such a name a write reads, updates and deletes only the rows naming no package,
     *   never a holder's, and a save that sets a credential, or clears one where a row stands, is refused ({@link store}).
     * @param holderOf [ADR-0150 D8 row R9, #31696] The one package holding the flow a write names (the
     *   engine's `flowHolderPackage`), stamped on every row the write door writes as `flow_package`. `null`
     *   (an environment-authored flow, a shared name, no reader) stamps none: such a row answers only a read
     *   naming no package, so under two holders it serves neither.
     */
    constructor(
        private readonly resolveEngine: () => FlowCredentialEngine | undefined,
        private readonly sharedRefusalOf?: (name: string) => PackageScopedRefusal | undefined,
        private readonly holderOf?: (name: string) => string | null,
    ) {}

    /** The package a write of the flow `name` stamps, `''` for none. */
    private writePackage(name: string): string {
        return this.holderOf?.(name) ?? '';
    }

    // ── the presence index ─────────────────────────────────────────────────

    /**
     * (Re)load which active positions the channel holds. Throws when the read
     * fails — the caller decides how loud that is; an index that silently read
     * as empty would refuse every flow whose credential is held here.
     * Returns `false` when there is no data engine to read.
     */
    async loadIndex(): Promise<boolean> {
        const engine = this.resolveEngine();
        if (!engine) return false;
        const found = await engine.find(FLOW_CREDENTIAL_OBJECT, {
            where: { state: 'active' },
            fields: ['id', 'flow_name', 'flow_package', 'node_id', 'credential_key'],
            context: SYSTEM_CONTEXT,
        });
        this.activeIndex.clear();
        for (const row of rowsOf(found)) {
            const flow = row.flow_name;
            if (typeof flow !== 'string' || typeof row.node_id !== 'string' || typeof row.credential_key !== 'string') continue;
            this.indexOf(flow, rowPackage(row)).add(positionKey(row.node_id, row.credential_key));
        }
        return true;
    }

    private indexOf(flowName: string, flowPackage: string): Set<string> {
        let packages = this.activeIndex.get(flowName);
        if (!packages) {
            packages = new Map();
            this.activeIndex.set(flowName, packages);
        }
        let set = packages.get(flowPackage);
        if (!set) {
            set = new Set();
            packages.set(flowPackage, set);
        }
        return set;
    }

    /**
     * Index the ACTIVE positions of `flowName`: `rows` read with no package
     * replace every package's positions of the name; read for one package
     * (`flowPackage`), only that package's.
     */
    private setIndexed(flowName: string, rows: Iterable<{ key: string; flowPackage: string }>, flowPackage?: string): void {
        const packages: Map<string, Set<string>> = flowPackage === undefined ? new Map<string, Set<string>>() : new Map(this.activeIndex.get(flowName) ?? []);
        if (flowPackage !== undefined) packages.delete(flowPackage);
        for (const row of rows) {
            const set = packages.get(row.flowPackage) ?? new Set<string>();
            set.add(row.key);
            packages.set(row.flowPackage, set);
        }
        if (packages.size === 0) this.activeIndex.delete(flowName);
        else this.activeIndex.set(flowName, packages);
    }

    /** The positions of `flowName` that answer `flowPackage` — every package's when it is not given. */
    private indexedPositions(flowName: string, flowPackage: string | undefined): Set<string> {
        const packages = this.activeIndex.get(flowName);
        if (!packages) return new Set();
        if (flowPackage !== undefined) return new Set(packages.get(flowPackage) ?? []);
        const all = new Set<string>();
        for (const set of packages.values()) for (const k of set) all.add(k);
        return all;
    }

    /** {@link FlowCredentialSource.holds}: does the channel hold this ACTIVE position? */
    holds(flowName: string, nodeId: string, key: string, flowPackage?: string): boolean {
        return this.indexedPositions(flowName, flowPackage).has(positionKey(nodeId, key));
    }

    /** {@link FlowCredentialSource.held}: every ACTIVE position the channel holds for a flow. */
    held(flowName: string, flowPackage?: string): Array<{ nodeId: string; key: string }> {
        return [...this.indexedPositions(flowName, flowPackage)].map((k) => {
            const [nodeId, key] = JSON.parse(k) as [string, string];
            return { nodeId, key };
        });
    }

    // ── reads ──────────────────────────────────────────────────────────────

    private requireEngine(flowName: string): FlowCredentialEngine {
        const engine = this.resolveEngine();
        if (engine) return engine;
        throw new FlowCredentialChannelRefusal(
            `Flow '${flowName}' cannot have its credentials stored: no data engine is available to the automation `
                + 'service, and a flow credential is kept only in the encrypted flow credential store. Nothing was '
                + 'written. Compose the ObjectQL engine with the automation service.',
        );
    }

    private async readRows(
        engine: FlowCredentialEngine,
        flowName: string,
        state: FlowCredentialState,
        flowPackage?: string,
    ): Promise<Map<string, ChannelRow>> {
        const found = await engine.find(FLOW_CREDENTIAL_OBJECT, {
            where: { flow_name: flowName, state },
            fields: ['id', 'node_id', 'credential_key', 'state', 'flow_package'],
            context: SYSTEM_CONTEXT,
        });
        const out = new Map<string, ChannelRow>();
        for (const row of rowsOf(found)) {
            if (typeof row.node_id !== 'string' || typeof row.credential_key !== 'string') continue;
            if (typeof row.id !== 'string' && typeof row.id !== 'number') continue;
            // [#31696] Read for one package: only that package's rows.
            if (flowPackage !== undefined && rowPackage(row) !== flowPackage) continue;
            out.set(positionKey(row.node_id, row.credential_key), {
                id: String(row.id),
                node_id: row.node_id,
                credential_key: row.credential_key,
                state,
                flow_package: rowPackage(row),
            });
        }
        return out;
    }

    /**
     * {@link FlowCredentialSource.resolve}: the plaintext of one ACTIVE
     * position, read at the moment of use. `undefined` for exactly one fact —
     * the channel holds no row there. Throws {@link FlowCredentialUnresolvableError}
     * when a row exists and does not come back (no crypto provider, a missing
     * ciphertext row, an engine without the privileged dereference).
     */
    async resolve(flowName: string, nodeId: string, key: string, flowPackage?: string): Promise<string | undefined> {
        const engine = this.resolveEngine();
        if (!engine) {
            throw new FlowCredentialUnresolvableError(
                `Flow '${flowName}': ${flowCredentialClassList([key])} cannot be read — no data engine is available.`,
            );
        }
        const rows = await this.readRows(engine, flowName, 'active', flowPackage);
        const k = positionKey(nodeId, key);
        const row = rows.get(k);
        // Keep the index honest with what the store says right now.
        this.setIndexed(flowName, indexedRows(rows), flowPackage);
        if (!row) return undefined;
        if (typeof engine.resolveSecretField !== 'function') {
            throw new FlowCredentialUnresolvableError(
                `Flow '${flowName}': ${flowCredentialClassList([key])} is stored encrypted, but this data engine `
                    + 'cannot dereference an encrypted field, so it cannot be read.',
            );
        }
        let plain: string | null;
        try {
            plain = await engine.resolveSecretField(FLOW_CREDENTIAL_OBJECT, row.id, FLOW_CREDENTIAL_VALUE_FIELD);
        } catch (err) {
            throw new FlowCredentialUnresolvableError(
                `Flow '${flowName}': ${flowCredentialClassList([key])} is stored but could not be decrypted `
                    + `(${(err as Error)?.message ?? String(err)}). Register the crypto provider it was written with.`,
            );
        }
        if (typeof plain === 'string' && plain.length > 0) return plain;
        throw new FlowCredentialUnresolvableError(
            `Flow '${flowName}': ${flowCredentialClassList([key])} is stored but resolved to nothing — its `
                + 'ciphertext row is missing. Set a new one by saving the flow with an explicit value.',
        );
    }

    // ── the write door ─────────────────────────────────────────────────────

    /**
     * The metadata save door's channel step, run immediately before the put:
     * move every explicit credential of `body` into the channel for
     * `(name, state)`, reconcile the rows the body no longer positions, and
     * return the body WITHOUT any credential — what is stored.
     *
     * Throws {@link FlowCredentialChannelRefusal} (503) when a value cannot be
     * stored safely; nothing is written in that case.
     *
     * [ADR-0150 D8 row R9, #31696] Under a name two or more packages hold, the
     * save is no holder's write (the door names no package): it reads,
     * updates and deletes only the rows naming no package, so a save never
     * rewrites or removes another package's credential. A save that sets a
     * credential there, or clears one where a row of any package stands, is refused with {@link
     * PackageScopedNameRefusedError} (409), naming every holder, before
     * anything is written: a row it wrote would collide with a holder's row at
     * the same position (one row per position and state), or serve neither
     * holder, and a clear would leave the holder's credential in force.
     */
    async store(args: { name: string; state: FlowCredentialState; body: unknown }): Promise<unknown> {
        const positions = flowCredentialPositions(args.body);
        const explicit = positions.filter((p) => p.form === 'value');
        const shared = this.sharedRefusalOf?.(args.name);
        if (shared && explicit.length > 0) throw sharedNameWriteRefusal(args.name, shared);
        // The rows this write may touch: every row of the name, or under a
        // shared name only the rows naming no package.
        const scope = shared ? '' : undefined;
        const engine = this.resolveEngine();
        if (!engine) {
            // Nothing to write and nothing held: a body with no credential keeps
            // the composition's old behaviour; one WITH a credential is refused.
            if (explicit.length > 0) this.requireEngine(args.name);
            return stripFlowCredentialValues(args.body);
        }
        // A clear where some package's row stands would leave that credential in force: refused. A clear where
        // no row stands touches nothing, so it saves.
        const cleared = positions.filter((p) => p.form === 'cleared').map((p) => positionKey(p.nodeId, p.key));
        if (shared && cleared.length > 0) {
            const standing = await this.readRows(engine, args.name, args.state);
            if (cleared.some((k) => standing.has(k))) throw sharedNameWriteRefusal(args.name, shared);
        }
        const rows = await this.readRows(engine, args.name, args.state, scope);

        // 1. Every explicit value FIRST. With no crypto provider the engine
        //    refuses the first write before any row exists, so a refused save
        //    leaves the channel exactly as it was.
        for (const position of explicit) {
            const existing = rows.get(positionKey(position.nodeId, position.key));
            try {
                if (existing) {
                    await engine.update(
                        FLOW_CREDENTIAL_OBJECT,
                        { id: existing.id, [FLOW_CREDENTIAL_VALUE_FIELD]: position.value },
                        { context: SYSTEM_CONTEXT },
                    );
                } else {
                    await engine.insert(
                        FLOW_CREDENTIAL_OBJECT,
                        {
                            flow_name: args.name,
                            // [ADR-0150 D8 row R9, #31696] The flow's one holder, beside its name.
                            ...(this.writePackage(args.name) ? { flow_package: this.writePackage(args.name) } : {}),
                            state: args.state,
                            node_id: position.nodeId,
                            credential_key: position.key,
                            position: positionDigest(position.nodeId, position.key),
                            [FLOW_CREDENTIAL_VALUE_FIELD]: position.value,
                        },
                        { context: SYSTEM_CONTEXT },
                    );
                }
            } catch (err) {
                if (isSecretProtectionFailure(err)) {
                    throw new FlowCredentialChannelRefusal(
                        `Flow '${args.name}' was not saved: it carries ${flowCredentialClassList(explicit.map((p) => p.key))}, `
                            + 'and a flow credential is kept only in the encrypted flow credential store, which needs a '
                            + 'crypto provider this deployment has not registered. Nothing was written. Register one '
                            + "on the data engine (setCryptoProvider — LocalCryptoProvider in development, a KMS-backed "
                            + 'provider in production) and save the flow again.',
                    );
                }
                throw err;
            }
        }

        // 2. Rows whose position no longer holds a credential the channel
        //    keeps: cleared on purpose, replaced by something unusable, or gone.
        const live = new Set(
            positions
                .filter((p) => p.form === 'absent' || p.form === 'value')
                .map((p) => positionKey(p.nodeId, p.key)),
        );
        for (const [k, row] of rows) {
            if (live.has(k)) continue;
            await engine.delete(FLOW_CREDENTIAL_OBJECT, { where: { id: row.id }, context: SYSTEM_CONTEXT });
            rows.delete(k);
        }

        if (args.state === 'active') {
            const held = new Map(indexedRows(rows).map((row) => [row.key, row] as const));
            const written = this.writePackage(args.name);
            for (const p of explicit) {
                const k = positionKey(p.nodeId, p.key);
                if (!held.has(k)) held.set(k, { key: k, flowPackage: written });
            }
            this.setIndexed(args.name, held.values(), scope);
        }
        return stripFlowCredentialValues(args.body);
    }

    /**
     * The runtime authoring gate's half: the positions of `item` whose
     * credential is withheld (absent) and HELD by the channel — read as present,
     * exactly as the carry-forward's restored positions are. For a draft being
     * published (`state: 'draft'`) a draft row or the active row it would keep
     * both count. Path spelling: `redactedKeys`' (`nodes.0.config.secret`).
     */
    async heldPaths(args: { name: string; state: FlowCredentialState; item: unknown }): Promise<string[]> {
        const absent = flowCredentialPositions(args.item).filter((p) => p.form === 'absent');
        if (absent.length === 0) return [];
        const engine = this.resolveEngine();
        if (!engine) return [];
        const active = await this.readRows(engine, args.name, 'active');
        const draft = args.state === 'draft' ? await this.readRows(engine, args.name, 'draft') : undefined;
        return absent
            .filter((p) => {
                const k = positionKey(p.nodeId, p.key);
                return active.has(k) || (draft?.has(k) ?? false);
            })
            .map((p) => p.path);
    }

    /**
     * R2 — the body a restore (rollback, revert) stores: every credential
     * removed, and NOTHING written here. The channel keeps its current
     * credential, so a restore never puts an exposed value back at rest and
     * never appends a history copy of one.
     */
    strip(body: unknown): unknown {
        return stripFlowCredentialValues(body);
    }

    /**
     * Publish: promote the draft's rows into the live ones, for the body just
     * promoted to active. Per position: a draft row replaces the active one; an
     * absent position with no draft row keeps the active one; a cleared,
     * unusable or vanished position loses its active row. The draft rows are
     * consumed either way.
     *
     * [ADR-0150 D8 row R9, #31696] Under a name two or more packages hold, a
     * publish is no holder's: it promotes, removes and consumes only the rows
     * naming no package, as {@link store} writes them, and never touches a
     * holder's row.
     */
    async promote(args: { name: string; body: unknown }): Promise<{ promoted: number; removed: number }> {
        const engine = this.requireEngine(args.name);
        const positions = flowCredentialPositions(args.body);
        const scope = this.sharedRefusalOf?.(args.name) ? '' : undefined;
        const draft = await this.readRows(engine, args.name, 'draft', scope);
        const active = await this.readRows(engine, args.name, 'active', scope);
        let promoted = 0;
        let removed = 0;
        for (const position of positions) {
            if (position.form !== 'absent') continue;
            const k = positionKey(position.nodeId, position.key);
            const pending = draft.get(k);
            if (!pending) continue;
            const live = active.get(k);
            if (live) await engine.delete(FLOW_CREDENTIAL_OBJECT, { where: { id: live.id }, context: SYSTEM_CONTEXT });
            await engine.update(FLOW_CREDENTIAL_OBJECT, { id: pending.id, state: 'active' }, { context: SYSTEM_CONTEXT });
            draft.delete(k);
            active.set(k, { ...pending, state: 'active' });
            promoted++;
        }
        const kept = new Set(
            positions
                .filter((p) => p.form === 'absent' || p.form === 'value')
                .map((p) => positionKey(p.nodeId, p.key)),
        );
        for (const [k, row] of active) {
            if (kept.has(k)) continue;
            await engine.delete(FLOW_CREDENTIAL_OBJECT, { where: { id: row.id }, context: SYSTEM_CONTEXT });
            active.delete(k);
            removed++;
        }
        for (const row of draft.values()) {
            await engine.delete(FLOW_CREDENTIAL_OBJECT, { where: { id: row.id }, context: SYSTEM_CONTEXT });
        }
        this.setIndexed(args.name, indexedRows(active), scope);
        return { promoted, removed };
    }

    /**
     * A stored row was deleted: drop the channel rows of every state whose
     * stored row no longer exists, so a credential never outlives the flow it
     * belonged to — and a later flow of the same name never inherits it.
     */
    async prune(args: { name: string; liveStates: ReadonlySet<FlowCredentialState> }): Promise<number> {
        const engine = this.resolveEngine();
        if (!engine) return 0;
        let removed = 0;
        for (const state of ['draft', 'active'] as const) {
            if (args.liveStates.has(state)) continue;
            const rows = await this.readRows(engine, args.name, state);
            for (const row of rows.values()) {
                await engine.delete(FLOW_CREDENTIAL_OBJECT, { where: { id: row.id }, context: SYSTEM_CONTEXT });
                removed++;
            }
            if (state === 'active') this.setIndexed(args.name, []);
        }
        return removed;
    }
}

/**
 * [ADR-0150 D8 row R9, #31696] The save door's refusal of a credential write
 * under a flow name two or more packages hold: the ADR-0150 refusal (409
 * `RESOURCE_CONFLICT`), every holder named, prefixed with what was refused.
 */
function sharedNameWriteRefusal(name: string, refusal: PackageScopedRefusal): PackageScopedNameRefusedError {
    return new PackageScopedNameRefusedError({
        ...refusal,
        message: `Flow '${name}' was not saved: it sets or clears a flow credential, and a flow credential belongs to `
            + 'one package\'s flow, but this save names no package. Nothing was written. ' + refusal.message,
    });
}

/** The index entries of a read's rows: each position with its row's package. */
function indexedRows(rows: ReadonlyMap<string, ChannelRow>): Array<{ key: string; flowPackage: string }> {
    return [...rows].map(([key, row]) => ({ key, flowPackage: row.flow_package }));
}

/**
 * Which lifecycle states of the flow `name` still have a stored row — read
 * after a delete, so {@link FlowCredentialChannel.prune} drops only the rows
 * whose stored row is gone. Reads the state column alone, never a body.
 */
export async function storedFlowStates(
    engine: Pick<FlowCredentialEngine, 'find'>,
    name: string,
): Promise<Set<FlowCredentialState>> {
    const found = await engine.find('sys_metadata', {
        where: { type: FLOW_METADATA_TYPE, name },
        fields: ['state'],
        context: SYSTEM_CONTEXT,
    });
    const out = new Set<FlowCredentialState>();
    for (const row of rowsOf(found)) {
        if (row.state === 'draft' || row.state === 'active') out.add(row.state);
    }
    return out;
}

/** The positions of a definition that hold an explicit credential — what a migration moves. */
export function explicitFlowCredentials(definition: unknown): FlowCredentialPosition[] {
    return flowCredentialPositions(definition).filter((p) => p.form === 'value');
}

/** Re-exported so a caller reaches the channel's metadata type through one import. */
export { FLOW_METADATA_TYPE };
