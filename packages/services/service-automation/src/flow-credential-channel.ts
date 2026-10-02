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
 *    its kind changed) → removed: a credential never outlives its position.
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
    /** flow name → the ACTIVE positions the channel holds. */
    private readonly activeIndex = new Map<string, Set<string>>();

    constructor(private readonly resolveEngine: () => FlowCredentialEngine | undefined) {}

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
            fields: ['id', 'flow_name', 'node_id', 'credential_key'],
            context: SYSTEM_CONTEXT,
        });
        this.activeIndex.clear();
        for (const row of rowsOf(found)) {
            const flow = row.flow_name;
            if (typeof flow !== 'string' || typeof row.node_id !== 'string' || typeof row.credential_key !== 'string') continue;
            this.indexOf(flow).add(positionKey(row.node_id, row.credential_key));
        }
        return true;
    }

    private indexOf(flowName: string): Set<string> {
        let set = this.activeIndex.get(flowName);
        if (!set) {
            set = new Set();
            this.activeIndex.set(flowName, set);
        }
        return set;
    }

    private setIndexed(flowName: string, keys: Iterable<string>): void {
        const set = new Set(keys);
        if (set.size === 0) this.activeIndex.delete(flowName);
        else this.activeIndex.set(flowName, set);
    }

    /** {@link FlowCredentialSource.holds}: does the channel hold this ACTIVE position? */
    holds(flowName: string, nodeId: string, key: string): boolean {
        return this.activeIndex.get(flowName)?.has(positionKey(nodeId, key)) ?? false;
    }

    /** {@link FlowCredentialSource.held}: every ACTIVE position the channel holds for a flow. */
    held(flowName: string): Array<{ nodeId: string; key: string }> {
        return [...(this.activeIndex.get(flowName) ?? [])].map((k) => {
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
    ): Promise<Map<string, ChannelRow>> {
        const found = await engine.find(FLOW_CREDENTIAL_OBJECT, {
            where: { flow_name: flowName, state },
            fields: ['id', 'node_id', 'credential_key', 'state'],
            context: SYSTEM_CONTEXT,
        });
        const out = new Map<string, ChannelRow>();
        for (const row of rowsOf(found)) {
            if (typeof row.node_id !== 'string' || typeof row.credential_key !== 'string') continue;
            if (typeof row.id !== 'string' && typeof row.id !== 'number') continue;
            out.set(positionKey(row.node_id, row.credential_key), {
                id: String(row.id),
                node_id: row.node_id,
                credential_key: row.credential_key,
                state,
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
    async resolve(flowName: string, nodeId: string, key: string): Promise<string | undefined> {
        const engine = this.resolveEngine();
        if (!engine) {
            throw new FlowCredentialUnresolvableError(
                `Flow '${flowName}': ${flowCredentialClassList([key])} cannot be read — no data engine is available.`,
            );
        }
        const rows = await this.readRows(engine, flowName, 'active');
        const k = positionKey(nodeId, key);
        const row = rows.get(k);
        // Keep the index honest with what the store says right now.
        this.setIndexed(flowName, rows.keys());
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
     */
    async store(args: { name: string; state: FlowCredentialState; body: unknown }): Promise<unknown> {
        const positions = flowCredentialPositions(args.body);
        const explicit = positions.filter((p) => p.form === 'value');
        const engine = this.resolveEngine();
        if (!engine) {
            // Nothing to write and nothing held: a body with no credential keeps
            // the composition's old behaviour; one WITH a credential is refused.
            if (explicit.length > 0) this.requireEngine(args.name);
            return stripFlowCredentialValues(args.body);
        }
        const rows = await this.readRows(engine, args.name, args.state);

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
            const held = new Set(rows.keys());
            for (const p of explicit) held.add(positionKey(p.nodeId, p.key));
            this.setIndexed(args.name, held);
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
     */
    async promote(args: { name: string; body: unknown }): Promise<{ promoted: number; removed: number }> {
        const engine = this.requireEngine(args.name);
        const positions = flowCredentialPositions(args.body);
        const draft = await this.readRows(engine, args.name, 'draft');
        const active = await this.readRows(engine, args.name, 'active');
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
        this.setIndexed(args.name, active.keys());
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
