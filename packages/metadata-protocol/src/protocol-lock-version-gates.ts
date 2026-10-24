// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 5] The lock gate and the optimistic-concurrency write addresses
 * of `ObjectStackProtocolImplementation` — the effective-lock read and the
 * write/delete lock gates with their audit rows (`getEffectiveLock`,
 * `readLockGateOverlayLayer`, `recordMetadataAudit`, `lockWriteRefusal`,
 * `assertLockAllowsWrite`, `assertLockAllowsDelete`), and the version-token
 * reads and row addresses the conflict check runs on (`storedHashDigest`,
 * `receiptVersion`, `storedHeadAt`, `readVersionToken`, the packageless read,
 * draft and strict-draft addresses, `storedParentForToken`,
 * `metadataConflictRefusal`, `recordPendingDenialAudit`) — moved out of
 * `protocol.ts` whole. `packagelessAddress`, the packageless write address
 * between them, stays in the class: `check-durability-degradation-log-level`'s
 * read-seam rule follows its environment-row read and the four callers that
 * guard it inside `protocol.ts`, and a moved body would drop out of that census.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, made as the
 * same principal, refusing exactly where they did with the same codes and
 * messages. The module-level declarations only these bodies read
 * (`ErrorWithPendingAudit`, `InboundVersionConflictError`) moved with them,
 * also unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link LockVersionGateHost} members that method reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the protocol
 * at call time, so a test double or spy set on the instance is still the one
 * the body reaches, and the moved bodies that call one another do so through
 * the protocol, exactly as before.
 *
 * The field the bodies read, `engine`, goes as a GETTER, so each read happens
 * when the body makes it: tests replace it on a constructed protocol.
 *
 * The other module-level declarations the bodies read stay in `protocol.ts`,
 * where code that did not move reads them too, and are imported from there:
 * the module cycle is evaluation-safe because every one of them is read only
 * inside a function body, never while the two modules are first evaluated.
 * `index.ts` names what it publishes from `protocol.ts` one by one, so the
 * `export` they gained for this keeps them off the published surface, and
 * nothing re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation, MetadataAuditEntry } from './protocol.js';
import { canonicalMetaType } from './protocol.js';
import { SysMetadataRepository, unboundItemDraftAddress } from './sys-metadata-repository.js';
import { resolveItemLockLazily } from './item-lock.js';
import { ConflictError } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { evaluateLockForDelete, evaluateLockForWrite } from '@objectstack/spec/kernel';
import type { MetadataLock } from '@objectstack/spec/kernel';
import { ephemeralStoredHashDigest, servedContentHash } from './metadata-redaction.js';
import type { StoredHashDigest } from './metadata-redaction.js';

/**
 * An `Error` carrying the denial row it still owes (see {@link MetadataAuditEntry}).
 *
 * The property is name-mangled like `__batchItem` beside it: it is an internal
 * hand-off between one private helper and its callers inside this file, never a
 * wire field. `clientFacingFailureText` / `clientFacingFailureCode` read
 * `message` / `code`, so nothing here reaches a response body.
 */
type ErrorWithPendingAudit = Error & { __pendingAudit?: MetadataAuditEntry };

/**
 * [#21207] A caller's version token that names no current stored head, found by
 * the protocol's own KEYED comparison before the repository is asked (see
 * {@link ObjectStackProtocolImplementation.storedParentForToken}).
 *
 * A `ConflictError`, so each door's existing conflict branch — the 409
 * `METADATA_CONFLICT` and its decision-audit row — handles it unchanged; told
 * apart from the repository's own race conflict because its `expectedParent`
 * is the CALLER's token rather than a stored hash. The message is replaced:
 * the base class prints both values, and one of them is the stored hash.
 */
class InboundVersionConflictError extends ConflictError {
    constructor(
        ref: { org: string; type: string; name: string },
        token: string,
        currentStored: string | null,
    ) {
        super(ref as ConstructorParameters<typeof ConflictError>[0], token, currentStored);
        this.message = `Conflict on ${ref.type}/${ref.name}: the version token sent is not the current version`;
    }
}

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface LockVersionGateHost {
    artifactLockLayerAt: ObjectStackProtocolImplementation['artifactLockLayerAt'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    getEffectiveLock: ObjectStackProtocolImplementation['getEffectiveLock'];
    getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    lockWriteRefusal: ObjectStackProtocolImplementation['lockWriteRefusal'];
    overlayLockLayerAt: ObjectStackProtocolImplementation['overlayLockLayerAt'];
    packagelessAddress: ObjectStackProtocolImplementation['packagelessAddress'];
    packagelessDraftAddress: ObjectStackProtocolImplementation['packagelessDraftAddress'];
    readLockGateOverlayLayer: ObjectStackProtocolImplementation['readLockGateOverlayLayer'];
    receiptVersion: ObjectStackProtocolImplementation['receiptVersion'];
    recordMetadataAudit: ObjectStackProtocolImplementation['recordMetadataAudit'];
    rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
    storedHashDigest: ObjectStackProtocolImplementation['storedHashDigest'];
    storedHeadAt: ObjectStackProtocolImplementation['storedHeadAt'];
}

/** The body of `ObjectStackProtocolImplementation#getEffectiveLock`; the method's docblock there is its contract. */
export async function getEffectiveLock(
    this: Pick<LockVersionGateHost, 'artifactLockLayerAt' | 'readLockGateOverlayLayer'>,
    type: string,
    name: string,
    packageId?: string,
): Promise<{
    lock: MetadataLock;
    lockReason: string | undefined;
    lockSource: 'artifact' | 'overlay' | undefined;
}> {
    // [#9009] ONE key for BOTH limbs — see this method's header.
    const canonicalType = canonicalMetaType(type);
    // [#21738] The one item-lock resolution decides; the two readers below
    // only gather its layers, the second only when it can bind.
    const resolved = await resolveItemLockLazily({
        // 1. Artifact. `lookupArtifactItem` is shadow-immune: a
        //    sys_metadata overlay row hydrated into the registry's plain
        //    key cannot mask the packaged artifact's `_lock` envelope.
        //    [#21803] Every installed package that ships the name, through
        //    the reads' own selection, from the same address — see this
        //    method's header.
        artifact: () => this.artifactLockLayerAt({
            type: canonicalType,
            name,
            packageId,
        }),
        overlay: () => this.readLockGateOverlayLayer(canonicalType, name, packageId),
    });
    return { lock: resolved.lock, lockReason: resolved.lockReason, lockSource: resolved.layer };
}

/** The body of `ObjectStackProtocolImplementation#readLockGateOverlayLayer`; the method's docblock there is its contract. */
export async function readLockGateOverlayLayer(
    this: Pick<LockVersionGateHost, 'overlayLockLayerAt' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    canonicalType: string,
    name: string,
    packageId: string | undefined,
): Promise<unknown> {
    // 2. Overlay rows — addressed by the SAME canonical key the repository
    //    stores them under (`SysMetadataRepository.whereFor`), which is
    //    what makes this limb read the rows the artifact limb already
    //    folded to. [#21761] Through the reads' own selection, from the
    //    same address —
    //    see {@link getEffectiveLock}'s header. Canonical spelling only
    //    (#4432), the one declared difference — see
    //    {@link overlayLockLayerAt}.
    try {
        return await this.overlayLockLayerAt({
            type: canonicalType,
            name,
            packageId,
        }, { otherSpelling: false });
    } catch (error) {
        // #5706 — A LOCK GATE MUST NOT FAIL OPEN. This `catch` used to
        // swallow every read failure and fall through to `'none'`, and
        // `'none'` is not a neutral value here: it is the verdict "the
        // author declared no protection", which `evaluateLockForWrite` /
        // `evaluateLockForDelete` turn straight into "allow". So an
        // unreadable `sys_metadata` silently converted a write that had to
        // be refused into a write that was performed — measured on
        // `origin/main`: with the overlay row declaring `_lock:
        // 'no-overlay'` and only the read above failing, `saveMetaItem`
        // returned `success: true` after an `update` on `sys_metadata`
        // (and `deleteMetaItem` the same, on `_lock: 'no-delete'`).
        //
        // Note what that also costs the audit trail: the allowed path
        // writes its ordinary `outcome: 'allowed'` row, so nothing
        // afterwards records that this write should have been denied.
        //
        // The window is not "the metadata store is down" — a fully dead
        // store fails the write too. It is "the READ failed and the write
        // still succeeded": a transient error, a single timed-out query, a
        // read-replica fault, partial pool exhaustion. Narrow, but the
        // shape is wrong at any width, and it is the inverse of ADR-0049's
        // fail-closed direction.
        //
        // The discrimination is the same one #5532 / PR #5705 installed for
        // the overlay READS in this file, reused verbatim rather than
        // reinvented: an unprovisioned `sys_metadata` genuinely has no
        // overlay row, so `'none'` IS the truth and first boot must not
        // explode; every other error is an outage and becomes a 503, whose
        // `cause` carries the driver error. ADR-0010 §3.3 is the decision
        // this defends; ADR-0110 D3 is the rule it was breaking — a miss
        // and an outage are different facts, and here reading one as the
        // other disarmed a protection gate.
        //
        // Consequence, deliberate and wire-visible: `save` / `publish` /
        // `rollback` / `delete` now fail with 503 when the lock state
        // cannot be read, instead of proceeding as if unlocked. Refusing
        // one uncertain write beats performing one that had to be refused.
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    return undefined;
}

/** The body of `ObjectStackProtocolImplementation#recordMetadataAudit`; the method's docblock there is its contract. */
export async function recordMetadataAudit(
    this: Pick<LockVersionGateHost, 'engine'>,
    entry: MetadataAuditEntry): Promise<void> {
    const canonical = canonicalMetaType(entry.type);
    if (canonical !== entry.type) {
        const err: any = new Error(
            `Refusing to write a sys_metadata_audit row under the `
            + `non-canonical metadata type '${entry.type}' (canonical: '${canonical}') for `
            + `'${entry.name}'. ADR-0010's trail is keyed on (type, name) and read back through `
            + `the '/meta' boundary, which folds — a row filed under '${entry.type}' is a row no `
            + `compliance query can reach. Fold the type at the call site (canonicalMetaType) `
            + `rather than here; see this method's header for why the writer no longer does it.`,
        );
        err.code = 'AUDIT_TYPE_NOT_CANONICAL';
        err.status = 500;
        throw err;
    }
    try {
        await this.engine.insert('sys_metadata_audit', {
            occurred_at: new Date().toISOString(),
            actor: entry.actor ?? 'system',
            source: entry.source ?? 'protocol',
            // [#8908] Verbatim — the assert above is what makes this
            // canonical, and a fold here would make the assert unfalsifiable.
            type: entry.type,
            name: entry.name,
            operation: entry.operation,
            outcome: entry.outcome,
            code: entry.code,
            lock_state: entry.lockState ?? 'none',
            lock_overridden: entry.lockOverridden ?? false,
            request_id: entry.requestId ?? null,
            note: entry.note ?? null,
        } as any, {
            // [#21911] The explicit system opt-in: the platform writes its
            // own trail row; the `actor` column above names who acted.
            context: { isSystem: true },
        });
    } catch (err: any) {
        // Don't promote audit-table failures to API errors. Log so
        // operators can spot a misconfigured deployment.
        console.warn(
            `[Protocol] sys_metadata_audit write failed for ${entry.type}/${entry.name}: ${err?.message ?? err}`,
        );
    }
}

/** The body of `ObjectStackProtocolImplementation#lockWriteRefusal`; the method's docblock there is its contract. */
export async function lockWriteRefusal(
    this: Pick<LockVersionGateHost, 'getEffectiveLock'>,
    args: {
    type: string;
    name: string;
    /**
     * [#21761] The package the write names (ADR-0048 `?package=`), part of
     * the item's address the gate selects the rows in scope from. It never
     * narrows those rows; it picks whose prose a refusal carries when
     * several rows declare the strictest lock, as it does on the reads.
     */
    packageId?: string;
    operation: 'save' | 'publish' | 'rollback';
    actor?: string;
    source?: string;
    requestId?: string;
}): Promise<{ err: Error; audit: MetadataAuditEntry } | null> {
    const state = await this.getEffectiveLock(args.type, args.name, args.packageId);
    const refusal = evaluateLockForWrite(state.lock);
    if (!refusal) return null;
    const reason = state.lockReason ?? refusal.reason;
    const err = new Error(
        `${args.type}/${args.name} is locked (_lock=${state.lock}${state.lockSource ? `, source=${state.lockSource}` : ''}). `
        + `${reason} — See ADR-0010 §3.3.`,
    );
    (err as any).code = 'ITEM_LOCKED';
    (err as any).status = 403;
    (err as any).lock = state.lock;
    (err as any).lockReason = reason;
    return {
        err,
        audit: {
            type: args.type,
            name: args.name,
            organizationId: null,
            operation: args.operation,
            outcome: 'denied',
            // adr0112-ok: D6b — persisted audit column, its own vocabulary
            code: 'item_locked',
            lockState: state.lock,
            actor: args.actor,
            source: args.source ?? `protocol.${args.operation}MetaItem`,
            requestId: args.requestId,
            note: reason,
        },
    };
}

/** The body of `ObjectStackProtocolImplementation#assertLockAllowsWrite`; the method's docblock there is its contract. */
export async function assertLockAllowsWrite(
    this: Pick<LockVersionGateHost, 'lockWriteRefusal' | 'recordMetadataAudit'>,
    args: {
    type: string;
    name: string;
    /** [#21761] See {@link lockWriteRefusal}. */
    packageId?: string;
    operation: 'save' | 'publish' | 'rollback';
    actor?: string;
    source?: string;
    requestId?: string;
}): Promise<Error | null> {
    const refusal = await this.lockWriteRefusal(args);
    if (!refusal) return null;
    await this.recordMetadataAudit(refusal.audit);
    return refusal.err;
}

/** The body of `ObjectStackProtocolImplementation#assertLockAllowsDelete`; the method's docblock there is its contract. */
export async function assertLockAllowsDelete(
    this: Pick<LockVersionGateHost, 'getEffectiveLock' | 'recordMetadataAudit'>,
    args: {
    type: string;
    name: string;
    /**
     * [#23297] The package the delete names (ADR-0048 `?package=`), handed
     * to the gate as the save's is ({@link lockWriteRefusal}): part of the
     * item's address. It never narrows the rows or the shipping packages
     * the lock is resolved over (#21761, #21803: the strictest of them
     * binds, so a delete naming a package is refused whenever the save
     * naming it is); it picks whose prose the refusal carries.
     */
    packageId?: string;
    actor?: string;
    source?: string;
    requestId?: string;
}): Promise<Error | null> {
    const state = await this.getEffectiveLock(args.type, args.name, args.packageId);
    const refusal = evaluateLockForDelete(state.lock);
    if (!refusal) return null;
    const reason = state.lockReason ?? refusal.reason;
    const err = new Error(
        `${args.type}/${args.name} is locked (_lock=${state.lock}${state.lockSource ? `, source=${state.lockSource}` : ''}). `
        + `${reason} — See ADR-0010 §3.3.`,
    );
    (err as any).code = 'ITEM_LOCKED';
    (err as any).status = 403;
    (err as any).lock = state.lock;
    (err as any).lockReason = reason;
    await this.recordMetadataAudit({
        type: args.type,
        name: args.name,
        organizationId: null,
        operation: 'delete',
        outcome: 'denied',
        // adr0112-ok: D6b — persisted audit column, its own vocabulary
        code: 'item_locked',
        lockState: state.lock,
        actor: args.actor,
        source: args.source ?? 'protocol.deleteMetaItem',
        requestId: args.requestId,
        note: reason,
    });
    return err;
}

/** The body of `ObjectStackProtocolImplementation#storedHashDigest`; the method's docblock there is its contract. */
export function storedHashDigest(
    this: Pick<LockVersionGateHost, 'engine'>,
    ): StoredHashDigest {
    const accessor = this.engine?.getKeyedDigest;
    const provider: StoredHashDigest | undefined =
        typeof accessor === 'function' ? accessor.call(this.engine) : undefined;
    return provider ?? ephemeralStoredHashDigest;
}

/** The body of `ObjectStackProtocolImplementation#receiptVersion`; the method's docblock there is its contract. */
export async function receiptVersion(
    this: Pick<LockVersionGateHost, 'storedHashDigest'>,
    stored: string): Promise<string> {
    return this.storedHashDigest()(stored);
}

/** The body of `ObjectStackProtocolImplementation#storedHeadAt`; the method's docblock there is its contract. */
export async function storedHeadAt(
    repo: SysMetadataRepository,
    ref: Parameters<SysMetadataRepository['headAt']>[0],
    state: 'active' | 'draft',
    packageId: string | null,
    /**
     * [#22877] The bundle member the save addresses (its body's); omitted,
     * the canonical member — what a by-name read addresses today.
     */
    member?: string,
): Promise<string | null> {
    return (await repo.headAt(ref, { state, packageId, member })).head?.hash ?? null;
}

/** The body of `ObjectStackProtocolImplementation#readVersionToken`; the method's docblock there is its contract. */
export async function readVersionToken(
    this: Pick<LockVersionGateHost, 'getOverlayRepo' | 'packagelessAddress' | 'receiptVersion' | 'storedHeadAt'>,
    /** [#22877] `member` — the bundle member the read addressed; omitted, the canonical one. */
    request: { type: string; name: string; packageId?: string; member?: string },
    state: 'active' | 'draft',
    /**
     * [#24371] The item's package-less binding ({@link packagelessAddress}
     * at `active`) when the caller has already resolved it; omitted, it is
     * read here.
     */
    packagelessPackageId?: string | null,
): Promise<string | null> {
    const repo = this.getOverlayRepo();
    const ref = {
        type: PLURAL_TO_SINGULAR[request.type] ?? request.type,
        name: request.name,
        org: 'env',
    } as Parameters<typeof repo.headAt>[0];
    const packageId = request.packageId == null && state === 'active'
        ? packagelessPackageId !== undefined
            ? packagelessPackageId
            : (await this.packagelessAddress(ref.type, ref.name, request.member)).packageId
        : request.packageId ?? null;
    const stored = await this.storedHeadAt(repo, ref, state, packageId, request.member);
    return stored === null ? null : this.receiptVersion(stored);
}

/** The body of `ObjectStackProtocolImplementation#packagelessReadAddress`; the method's docblock there is its contract. */
export async function packagelessReadAddress(
    this: Pick<LockVersionGateHost, 'packagelessAddress'>,
    type: string, name: string, member?: string): Promise<string | undefined> {
    return (await this.packagelessAddress(PLURAL_TO_SINGULAR[type] ?? type, name, member)).packageId ?? undefined;
}

/** The body of `ObjectStackProtocolImplementation#strictDraftReadAddress`; the method's docblock there is its contract. */
export async function strictDraftReadAddress(
    this: Pick<LockVersionGateHost, 'packagelessDraftAddress'>,
    type: string,
    name: string,
    member?: string,
): Promise<{ packageId: string | null; bestEffort: boolean }> {
    const address = await this.packagelessDraftAddress(PLURAL_TO_SINGULAR[type] ?? type, name, member);
    if (address.kind === 'ambiguous') return { packageId: null, bestEffort: true };
    return { packageId: address.key, bestEffort: false };
}

/** The body of `ObjectStackProtocolImplementation#packagelessDraftAddress`; the method's docblock there is its contract. */
export async function packagelessDraftAddress(
    this: Pick<LockVersionGateHost, 'packagelessAddress'>,
    type: string,
    name: string,
    /** [#22877] The bundle member the door addresses; omitted, the canonical one. */
    member?: string,
): Promise<
    | { kind: 'ambiguous'; candidates: readonly string[] }
    | {
        kind: 'draft' | 'none';
        key: string | null;
        into: string | null;
        drafts: { packageId: string | null; candidates: readonly string[]; unbound: boolean };
    }
> {
    const active = await this.packagelessAddress(type, name, member, 'active');
    if (active.candidates.length > 1) return { kind: 'ambiguous', candidates: active.candidates };
    const drafts = await this.packagelessAddress(type, name, member, 'draft');
    const own = active.packageId;
    if (own !== null) {
        if (drafts.candidates.includes(own)) return { kind: 'draft', key: own, into: own, drafts };
        if (drafts.unbound) return { kind: 'draft', key: null, into: own, drafts };
        return { kind: 'none', key: own, into: own, drafts };
    }
    // [#23657] Bound to none: the rule the draft save's address takes too
    // ({@link unboundItemDraftAddress}, in `resolveWriteHead`).
    const address = unboundItemDraftAddress(drafts);
    if (address.kind === 'ambiguous') return address;
    return { kind: address.kind, key: address.key, into: address.key, drafts };
}

/** The body of `ObjectStackProtocolImplementation#storedParentForToken`; the method's docblock there is its contract. */
export async function storedParentForToken(
    this: Pick<LockVersionGateHost, 'storedHashDigest'>,
    ref: { org: string; type: string; name: string },
    token: string | null,
    currentStored: string | null,
): Promise<string | null> {
    if (token === null) return null;
    if (currentStored !== null && token !== '' && (await this.storedHashDigest()(currentStored)) === token) {
        return currentStored;
    }
    throw new InboundVersionConflictError(ref, token, currentStored);
}

/** The body of `ObjectStackProtocolImplementation#metadataConflictRefusal`; the method's docblock there is its contract. */
export async function metadataConflictRefusal(
    this: Pick<LockVersionGateHost, 'storedHashDigest'>,
    err: ConflictError,
    subject: string,
    prefix: string,
    firstWritePin?: 'draft' | 'active',
): Promise<Error> {
    const conflict: any = new Error(subject);
    conflict.code = 'METADATA_CONFLICT';
    conflict.status = 409;
    const digest = this.storedHashDigest();
    const show = (served: string | null | undefined) => (served === undefined ? '(withheld)' : served ?? 'null');
    const current = await servedContentHash(err.actualHead, digest);
    if (current !== undefined) {
        conflict.actualHead = current;
        conflict.currentVersion = current;
    }
    if (err instanceof InboundVersionConflictError) {
        conflict.message = `${prefix} The version token sent is not the current version (current is ${show(current)}).`;
        return conflict;
    }
    const expected = await servedContentHash(err.expectedParent, digest);
    if (expected !== undefined) conflict.expectedParent = expected;
    conflict.message = firstWritePin !== undefined && expected === null
        ? `${subject}: this save asserted that no ${firstWritePin} row exists (the first-write pin, `
            + `If-None-Match: * on the REST door), but one does (current is ${show(current)}). Send that `
            + `version as If-Match to save over it, or re-read the item to merge first.`
        : `${prefix} Expected parent ${show(expected)} but current is ${show(current)}.`;
    return conflict;
}

/** The body of `ObjectStackProtocolImplementation#recordPendingDenialAudit`; the method's docblock there is its contract. */
export async function recordPendingDenialAudit(
    this: Pick<LockVersionGateHost, 'recordMetadataAudit'>,
    err: unknown,
    overrides?: { source?: string },
): Promise<void> {
    const pending = (err as ErrorWithPendingAudit | null | undefined)?.__pendingAudit;
    if (!pending) return;
    await this.recordMetadataAudit({
        ...pending,
        ...(overrides?.source ? { source: overrides.source } : {}),
    });
}
