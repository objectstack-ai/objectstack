// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2 and D6, amended; ADR-0067 D2] A batch that makes object rows
 * live judges their registration as ONE unit, after its own registrations —
 * never row by row, and never only in a log line.
 *
 * A batch writer (a package duplicate, an unmanaged import, a package publish,
 * the stored-metadata migration pass) writes its rows in an order a later
 * sibling can still complete (#29673), so its per-row pre-flight asks the
 * registry about the body alone (`registry-question.ts`). The write-through's
 * registration refusal of a row whose pair the registry refuses was then only
 * `console.warn`ed: the row stayed stored and unregistered (ADR-0144 D6's
 * roll-up door), or stored and registered with a currency pair no single save
 * admits (the follow door, which `registerObject` never asks), and the batch
 * answered it copied, imported or published (#32369).
 *
 * {@link judgeBatchObjectRegistrations} asks the question the batch could not
 * ask row by row: registered together, in an order the unit admits, which rows
 * does the registry refuse — at registration, or asked against the registry
 * once the whole unit is in (`againstRegistry`: the doors that read the
 * registry's other objects, D6's roll-up half and the follow door)? It asks
 * inside `SchemaRegistry.restoringOnRefusal` and always ends that run by
 * throwing, so the registry is put back exactly as it was: the judgement
 * registers nothing. It is synchronous, so no other caller can read the unit
 * half-registered.
 *
 * What a face does with the verdict is the face's own result shape:
 *  - an all-or-nothing face (`importUnmanagedPackage`, `publishPackageDrafts`)
 *    refuses the batch with a refused row as its cause and rolls it back;
 *  - a face that reports per row (`duplicatePackage`, `migrateStoredMetadata`)
 *    undoes each refused row's write ({@link undoBatchRowWrite}), reports it
 *    in its own failure shape, and judges the rest again — an undone row can
 *    leave a sibling's pair incomplete — until the unit is admitted
 *    ({@link settleBatchObjectRows}).
 * Either way no row the registry refuses is left stored by the batch, and every
 * admitted row is registered in an order the unit admits
 * ({@link registerAdmittedBatchRows}), so a pair a later sibling completes
 * registers whole (the #29673 case).
 *
 * ⛔ Called from asynchronous protocol code only, never from inside another
 * `restoringOnRefusal` run: a nested run joins the open one, and the throw that
 * ends this judgement would put back that run's writes too.
 */

import { storedRowDocument } from './item-lock.js';
import { OBJECT_EXTENSION_TYPE, registrableObjectExtension } from './protocol-object-extension-item.js';
import type { ProtocolHost } from './protocol-host.js';
import type { SysMetadataRepository } from './sys-metadata-repository.js';

/** One row a batch made live, as the registry registers it. */
export interface BatchObjectRow {
    /** `'object'` or `'object_extension'`; a row of any other type is not judged. */
    readonly type: string;
    readonly name: string;
    /** The body the store holds for the row. */
    readonly body: unknown;
    /** The row's package binding; `null` for the unbound row. */
    readonly packageId: string | null;
}

/** The registry's verdict on a batch's rows, by index into the rows judged. */
export interface BatchRegistrationVerdict {
    /** Each refused row, with the refusal the registry answered for it. */
    readonly refused: ReadonlyMap<number, Error>;
    /** The admitted rows, in an order in which each registers without a refusal. */
    readonly order: readonly number[];
}

/** A row a batch wrote, and how to put its address back as it was before. */
export interface WrittenBatchRow extends BatchObjectRow {
    readonly undo: () => Promise<void>;
}

/** A row {@link settleBatchObjectRows} took back out of the batch. */
export interface RefusedBatchRow<R extends WrittenBatchRow = WrittenBatchRow> {
    readonly row: R;
    readonly refusal: Error;
    /** Present when the undo itself failed: the row may still be stored. */
    readonly undoError?: unknown;
}

/** Does a row of this (canonical) type register into the object registry? */
export function isBatchObjectType(type: string): boolean {
    return type === 'object' || type === OBJECT_EXTENSION_TYPE;
}

type JudgeHost = Pick<ProtocolHost, 'classifyObjectContribution' | 'engine' | 'objectRegistrationRefusal' | 'overlayPackageMismatchError'>;

/** The registry verbs the judgement drives — every one a `SchemaRegistry` member. */
interface JudgingRegistry {
    restoringOnRefusal<T>(register: () => T): T;
    registerItem(type: string, item: unknown, keyField: string): void;
    registerObject(schema: unknown, packageId?: string, namespace?: string, ownership?: string): string;
    registerObjectExtension(extension: { extend: string; priority?: number } & Record<string, unknown>, packageId: string): string;
    objectRegistrationRefusal(schema: unknown, packageId: string | undefined, ownership: string, options: { againstRegistry?: boolean }): Error | null;
}

function judgingRegistryOf(host: Pick<ProtocolHost, 'engine'>): JudgingRegistry | undefined {
    const registry = host.engine?.registry as Partial<JudgingRegistry> | undefined;
    return typeof registry?.restoringOnRefusal === 'function'
        && typeof registry.registerItem === 'function'
        && typeof registry.registerObject === 'function'
        && typeof registry.registerObjectExtension === 'function'
        && typeof registry.objectRegistrationRefusal === 'function'
        ? registry as JudgingRegistry
        : undefined;
}

/**
 * Can this runtime's registry judge a batch's objects? A face reads its rows
 * back for the judgement (and for an undo) only when it can: on a registry
 * that cannot be asked (a partial double) the judgement refuses nothing, so
 * those reads would only add a failure mode to the batch.
 */
export function canJudgeBatchObjects(host: Pick<ProtocolHost, 'engine'>): boolean {
    return judgingRegistryOf(host) !== undefined;
}

function asError(thrown: unknown): Error {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Register `rows` as one unit, retrying each refused row once another row has
 * registered (a sibling can complete its pair), then ask every registered row
 * against the registry the unit leaves. The registry is put back before this
 * returns. On a registry that cannot be asked (a partial double) nothing is
 * refused, and nothing is answered to register again: there is no registry
 * the batch's own registrations could have left short.
 */
export function judgeBatchObjectRegistrations(host: JudgeHost, rows: readonly BatchObjectRow[]): BatchRegistrationVerdict {
    const judged = rows.map((_, i) => i).filter((i) => isBatchObjectType(rows[i].type));
    const registry = judgingRegistryOf(host);
    if (judged.length === 0 || registry === undefined) return { refused: new Map(), order: [] };

    type Layer = ReturnType<JudgeHost['classifyObjectContribution']>;
    const layers = new Map<number, Layer>();
    /** Register one row as the write-through does; its refusal, or `undefined`. */
    const register = (i: number): Error | undefined => {
        const row = rows[i];
        try {
            if (row.type === OBJECT_EXTENSION_TYPE) {
                // `registerStoredObjectExtension`'s registration: a row bound to
                // no package contributes nothing, so it is not refused either.
                if (row.packageId === null || row.packageId === '') return undefined;
                registry.registerObjectExtension(registrableObjectExtension(row.body), row.packageId);
                return undefined;
            }
            // `applyObjectRegistryMutation`'s registration, verb for verb.
            const layer = host.classifyObjectContribution(row.name, row.packageId);
            layers.set(i, layer);
            if (layer.kind === 'mismatch') return host.overlayPackageMismatchError(row.name, layer.packageId, layer.ownerPackageId);
            registry.registerItem('object', row.body, 'name');
            registry.registerObject({ ...(row.body as Record<string, unknown>), _provenance: 'org' }, layer.packageId, undefined, layer.kind);
            return undefined;
        } catch (thrown) {
            return asError(thrown);
        }
    };
    /** The doors that read the registry's other objects, asked of a registered row. */
    const againstRegistry = (i: number): Error | null => {
        const row = rows[i];
        try {
            if (row.type === OBJECT_EXTENSION_TYPE) {
                if (row.packageId === null || row.packageId === '') return null;
                const { extend, priority: _priority, ...contribution } = registrableObjectExtension(row.body);
                return registry.objectRegistrationRefusal({ ...contribution, name: extend }, row.packageId, 'extend', { againstRegistry: true });
            }
            const layer = layers.get(i);
            return layer === undefined ? null : host.objectRegistrationRefusal(row.body, layer, { againstRegistry: true });
        } catch (thrown) {
            return asError(thrown);
        }
    };

    /** The object each row registers as: its own name, or the object an extension extends. */
    const objectNameOf = (i: number): string | undefined => {
        const row = rows[i];
        if (row.type !== OBJECT_EXTENSION_TYPE) return row.name;
        try {
            return registrableObjectExtension(row.body).extend;
        } catch {
            return undefined;
        }
    };
    const refused = new Map<number, Error>();
    /**
     * Charge a refusal to the row whose declaration it refuses. A currency door
     * asked of one end of a pair names the object declaring the refused field
     * (`objectName`: the child for a following amount, the parent for a
     * roll-up), which can be ANOTHER row of the unit — asked of an innocent
     * parent, the follow door refuses the child that follows a field the parent
     * holds as text. That row is the one refused; the asked row is refused
     * only when the declaration is its own, or an object outside the unit (a
     * live object the row would break).
     */
    const charge = (i: number, refusal: Error): void => {
        const declaring = (refusal as { objectName?: unknown }).objectName;
        let at = i;
        if (typeof declaring === 'string' && declaring !== objectNameOf(i)) {
            const other = judged.find((j) => j !== i && objectNameOf(j) === declaring);
            if (other !== undefined) at = other;
        }
        if (!refused.has(at)) refused.set(at, refusal);
    };
    const order: number[] = [];
    const judgementEnds = new Error('[batch-object-registration] the unit is judged; the registry is put back');
    try {
        registry.restoringOnRefusal(() => {
            const lastRefusal = new Map<number, Error>();
            let left = judged;
            while (left.length > 0) {
                const still: number[] = [];
                for (const i of left) {
                    const refusal = register(i);
                    if (refusal === undefined) {
                        order.push(i);
                        lastRefusal.delete(i);
                    } else {
                        lastRefusal.set(i, refusal);
                        still.push(i);
                    }
                }
                // No row registered in this pass: nothing left can complete a pair.
                if (still.length === left.length) break;
                left = still;
            }
            for (const i of order) {
                const refusal = againstRegistry(i);
                if (refusal) charge(i, refusal);
            }
            for (const [i, refusal] of lastRefusal) charge(i, refusal);
            throw judgementEnds;
        });
    } catch (thrown) {
        if (thrown !== judgementEnds) throw thrown;
    }
    return { refused, order: order.filter((i) => !refused.has(i)) };
}

/**
 * Register the admitted rows for real, in the order the unit admits them: the
 * in-batch write-through of a row whose pair a later sibling completed was
 * refused (and logged). Re-registering a row that registered already is a
 * no-op.
 */
export async function registerAdmittedBatchRows(
    host: Pick<ProtocolHost, 'applyRegistryWriteThrough'>,
    rows: readonly BatchObjectRow[],
    order: readonly number[],
): Promise<void> {
    for (const i of order) {
        const row = rows[i];
        await host.applyRegistryWriteThrough({ type: row.type, name: row.name, item: row.body, packageId: row.packageId, organizationId: null });
    }
}

/**
 * Sync the admitted rows' storage once they are registered: a row whose
 * in-batch registration was refused left its table unsynced. A face whose own
 * side effects sync storage after the batch (a package publish) skips this.
 */
export async function syncAdmittedBatchStorage(
    host: Pick<ProtocolHost, 'ensureObjectStorage'>,
    rows: readonly BatchObjectRow[],
    order: readonly number[],
): Promise<void> {
    for (const i of order) await host.ensureObjectStorage(rows[i].type, rows[i].name);
}

/**
 * For a face that reports per row: judge the rows, undo every refused row's
 * write and take it out of the unit, and judge the rest again until the unit
 * is admitted; then register the admitted rows. Answers the rows taken out,
 * in the order they were refused.
 */
export async function settleBatchObjectRows<R extends WrittenBatchRow>(
    host: JudgeHost & Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'ensureObjectStorage'>,
    rows: readonly R[],
): Promise<Array<RefusedBatchRow<R>>> {
    const takenOut: Array<RefusedBatchRow<R>> = [];
    let live = rows.filter((row) => isBatchObjectType(row.type));
    for (;;) {
        const verdict = judgeBatchObjectRegistrations(host, live);
        if (verdict.refused.size === 0) {
            await registerAdmittedBatchRows(host, live, verdict.order);
            await syncAdmittedBatchStorage(host, live, verdict.order);
            return takenOut;
        }
        for (const [i, refusal] of verdict.refused) {
            try {
                await live[i].undo();
                takenOut.push({ row: live[i], refusal });
            } catch (undoError) {
                takenOut.push({ row: live[i], refusal, undoError });
            }
        }
        live = live.filter((_, i) => !verdict.refused.has(i));
    }
}

/**
 * The active row stored at `(type, name, packageId)`: its version (what an
 * undo restores), its stored stamp (what an undo of a row the batch created
 * locks on) and its body (what the registry registers), or `null` when there
 * is none.
 */
export async function readActiveBatchRow(
    host: Pick<ProtocolHost, 'findEnvironmentRow'>,
    address: { type: string; name: string; packageId: string | null },
): Promise<{ version: number | null; hash: string | null; body: unknown } | null> {
    // [#21911] The explicit system opt-in, as the publish's pre-publish capture reads it.
    const row = (await host.findEnvironmentRow('sys_metadata', {
        where: { type: address.type, name: address.name, state: 'active', package_id: address.packageId },
        context: { isSystem: true },
    })) as Record<string, unknown> | null;
    if (!row) return null;
    return {
        version: typeof row.version === 'number' ? row.version : null,
        hash: typeof row.checksum === 'string' ? row.checksum : null,
        body: storedRowDocument(row),
    };
}

/**
 * Put one row a batch wrote back as it was: restored to `prevVersion` when the
 * row existed before the batch, removed when the batch created it — the two
 * moves an ADR-0067 D3 revert makes — and the registry healed to the active
 * rows the store then serves. Each step appends its own history event, as a
 * revert does. The table a removed object's write created is left in place,
 * as a delete leaves it (`dropStorage` is a delete's own opt-in).
 *
 * A row the batch created is removed under the lock of the stamp the batch
 * itself wrote (`writtenHash`, read right after its write), as
 * `undoLandedPromotions` locks on the version it promoted: a row another
 * writer saved to the address since is not the batch's to remove, so the
 * delete's conflict is thrown, and the face reports the undo as failed.
 */
export async function undoBatchRowWrite(
    host: Pick<ProtocolHost, 'getOverlayRepo' | 'isArtifactBacked' | 'restoreArtifactRegistryView'>,
    row: { type: string; name: string; packageId: string | null; prevVersion: number | null; writtenHash?: string | null },
    trail: { actor?: string; source: string; message: string },
): Promise<void> {
    const repo: SysMetadataRepository = host.getOverlayRepo();
    const ref = { type: row.type, name: row.name, org: 'env' } as unknown as Parameters<SysMetadataRepository['get']>[0];
    const intent: 'override-artifact' | 'runtime-only' =
        host.isArtifactBacked(row.type, row.name) ? 'override-artifact' : 'runtime-only';
    const options = { actor: trail.actor ?? null, source: trail.source, message: trail.message, intent, packageId: row.packageId };
    if (row.prevVersion !== null) {
        await repo.restoreVersion(ref, row.prevVersion, options);
    } else {
        if (typeof row.writtenHash !== 'string') {
            throw new Error(`the stamp the batch wrote for ${row.type}/${row.name} is unknown, so it cannot be removed under its own lock`);
        }
        await repo.delete(ref, { ...options, parentVersion: row.writtenHash, state: 'active' });
    }
    try {
        await host.restoreArtifactRegistryView(row.type, row.name, null);
    } catch (healError) {
        throw new BatchRowHealError(healError);
    }
}

/**
 * An undo whose store move landed and whose registry heal then failed: the
 * store holds the row as it was, and the registry may still serve what the
 * batch registered until the next boot registers the stored rows. A face
 * words it apart from an undo that left the batch's write stored.
 */
export class BatchRowHealError extends Error {
    readonly storeRestored = true;
    constructor(readonly healError: unknown) {
        super(`the registry could not be put back to the stored row: ${healError instanceof Error ? healError.message : String(healError)}`);
        this.name = 'BatchRowHealError';
    }
}

/** How an undo ended, for a face's server-log line. */
export function undoOutcomeForLog(undoError: unknown): string {
    if (undoError === undefined) return 'taken back';
    if (undoError instanceof BatchRowHealError) return `taken back in the store, but ${undoError.message}`;
    return `could NOT be taken back (${undoError instanceof Error ? undoError.message : String(undoError)})`;
}
