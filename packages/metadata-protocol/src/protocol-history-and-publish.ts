// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "History, publish, drafts, publish backfill" facet of
 * `ObjectStackProtocolImplementation`: the bodies of `historyMetaItem`,
 * `publishMetaItem`, `publishMetaItemUnaudited`, `promoteDraftForPublish`,
 * `runPublishSideEffects`, `publishPackageDrafts`, `discardPackageDrafts` moved
 * out of `protocol.ts` whole by `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. `ProtocolHistoryAndPublishFacet` is a stateless facet over the host
 * (ruling 6624345766): each static method below is the body of the class
 * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`
 * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`
 * and nothing else changed. The facet holds no state: the fields stay on the
 * class, and a body reaches them through the host (`protocol-host.ts`).
 *
 * The class keeps every member as a one-line delegation. A public member
 * keeps its docblock there, which the published `.d.ts` prints; a private
 * member's docblock moved here with its body (docblock ownership).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { stampHtmlPageRequires } from './runtime-authoring-gate.js';
import type { RuntimeAuthoringIssue, RuntimePendingDeclarations } from './runtime-authoring-gate.js';
import { DraftConflictError, packagelessAddressAmbiguityRefusal } from './sys-metadata-repository.js';
import { ConflictError } from '@objectstack/metadata-core';
import type { MetadataItem } from '@objectstack/metadata-core';
import { savedItemNameRefusal } from '@objectstack/metadata/view-container-name';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { serveStoredHashTokens, servedContentHash } from './metadata-redaction.js';
import { overrideWriteRefusalError } from './protocol-packaged-base-refusal.js';
import type { OverrideWriteVerdict } from './protocol-packaged-base-refusal.js';
import { objectBodyExtensionFieldSuffixRefusal } from './protocol-extension-field-suffix.js';
import { storedFlowVerdictBody } from './protocol-flow-save-replay.js';
import { datasourceCredentialsRefSaveRefusal } from './protocol-datasource-credentials-ref.js';
import { canonicalMetaType, canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import { packagelessPublishNoDraftRefusal, permissionSetOwnerBindingRefusal } from './protocol-authoring-refusals.js';
import { memberOption, mutationEventMemberOfBody, resolveBundleMemberSelector } from './protocol-bundle-members.js';
import { clientFacingFailureCode, clientFacingFailureText } from './protocol-client-failures.js';
import type { PublishMaterializeResult } from './protocol-package-lifecycle-types.js';
import type { MutationProjectionOutcome } from './protocol-mutation-events.js';
import { PREFLIGHT_AUDIT_CODE, withPendingAudit } from './protocol-audit-entry.js';
import type { PublishMetaItemRequest } from './protocol-door-requests.js';
import { withRefusalAudit } from './protocol-refusal-audit.js';
import { overlayMemberWhere } from './migrations/overlay-index.js';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { readPublishBackfillRequest } from './protocol-publish-backfill-request.js';
import type { PublishBackfillReceipt } from './protocol-publish-backfill-request.js';
import { commitPlanKey } from './protocol-bundle-members.js';
import type { CommitPlanItem } from './protocol-bundle-members.js';
import type { PreflightViolationCode } from './protocol-audit-entry.js';
import { isNonCanonicalStoredType } from './protocol-stored-overlay-types.js';
import type { ProtocolHost } from './protocol-host.js';
import type { SeedAppliedLandedParsed } from '@objectstack/spec/api';
// [#29985 codemod] `ObjectStackProtocolImplementation` here is `ObjectStackProtocolImplementationStatics` (imported AS the class): forwarders to its statics (#30147).
import { ObjectStackProtocolImplementationStatics as ObjectStackProtocolImplementation } from './protocol.js';
import { PROMOTION_REGISTRY_QUESTION, type RegistryQuestion } from './registry-question.js';
import { isBatchObjectType, judgeBatchObjectRegistrations, registerAdmittedBatchRows, type BatchObjectRow } from './batch-object-registration.js';
import { engineCanRollBack } from '@objectstack/core';
import type { SysMetadataRepository } from './sys-metadata-repository.js';

/**
 * [#32396] A promotion a package publish wrote: what {@link undoLandedPromotions}
 * needs to put it back.
 */
type LandedPromotion = {
    /** The draft row as `listDrafts` listed it (stored type spelling, its package binding, its member). */
    d: { type: string; name: string; member?: string; packageId?: string | null };
    /** The folded type the promotion addressed. */
    singularType: string;
    /** The package the ACTIVE row was written under. */
    packageId: string | null;
    /** The active row's stamp, as `repo.promoteDraft` answered it. */
    version: string;
    /** The draft row the promotion consumed. */
    promotedDraft?: { body: unknown; hash: string };
};

/**
 * [#32396] `promoteDraftForPublish` answers no `result` only to a call that
 * stated `judgeOnly`. A caller that did not, and still received none, is told
 * so by name rather than reading `undefined` as a version.
 */
function unwrittenPromotionError(type: string, name: string): Error {
    return new Error(
        `The promotion of ${type}/${name} answered no write although it was not asked to only judge the draft; `
        + 'nothing about this item is known to have been published.',
    );
}

/**
 * [#32396, ADR-0067 D2] Undo every promotion a refused package publish made,
 * on a runtime whose engine could not roll the batch's transaction back
 * (`engineCanRollBack` false). Newest first; for each item, the active row goes
 * back to what it was before the publish — removed when the publish created
 * it, restored to its prior version when the publish edited it (the same two
 * moves an ADR-0067 D3 revert makes, read off the same pre-publish capture) —
 * and the draft row the promotion consumed is put back as the pending draft,
 * byte for byte, so its hash and its version token are the ones the author
 * holds.
 *
 * Each undo step appends its own history event, as a revert does: history is
 * append-only (D3), so the log records that the publish happened and was
 * undone rather than pretending it never ran. Phase 2 never ran for a refused
 * batch, so there is no event, materialization or audit row to undo, and the
 * registry still serves the pre-publish state; each undo write still takes the
 * registry route every stored-row write takes, the heal
 * (`restoreArtifactRegistryView`), which re-derives the item's entry from the
 * active rows the store serves and so re-asserts that state.
 *
 * Returns the promotions it could NOT undo, each with its failure; empty means
 * the store is back to its pre-publish state. Never throws: one item's failure
 * does not stop the others from being undone.
 *
 * Not covered: a causal promotion the store itself left half-written (its
 * active row stored, its history append then failed) is not in `landed` — the
 * promotion threw — and is the store's own non-atomicity on such a runtime.
 */
async function undoLandedPromotions(host: Pick<ProtocolHost, 'isArtifactBacked' | 'restoreArtifactRegistryView'>, args: {
    repo: SysMetadataRepository;
    landed: ReadonlyArray<LandedPromotion>;
    /** The pre-publish capture (`existedBefore` / `prevVersion` per item). */
    plan: ReadonlyArray<CommitPlanItem>;
    packageId: string;
    actor?: string;
}): Promise<Array<{ item: LandedPromotion; error: unknown }>> {
    const notUndone: Array<{ item: LandedPromotion; error: unknown }> = [];
    const actor = args.actor ?? null;
    const source = 'protocol.publishPackageDrafts';
    const message = `undo the promotion: the batch publish of package '${args.packageId}' was refused (ADR-0067 D2)`;
    for (const item of [...args.landed].reverse()) {
        const ref = { type: item.singularType, name: item.d.name, org: 'env' } as unknown as Parameters<SysMetadataRepository['get']>[0];
        // Per item, as the revert derives it: a runtime item is not refused by
        // the artifact-override gate on its way back out.
        const intent: 'override-artifact' | 'runtime-only' =
            host.isArtifactBacked(item.singularType, item.d.name) ? 'override-artifact' : 'runtime-only';
        try {
            if (!item.promotedDraft) {
                throw new Error(`the draft ${item.d.type}/${item.d.name} consumed was not captured, so it cannot be put back`);
            }
            const before = args.plan.find((it) => commitPlanKey(it) === commitPlanKey(item.d));
            if (before?.existedBefore) {
                if (before.prevVersion === null) {
                    throw new Error(`${item.d.type}/${item.d.name} was live before the publish, at no recorded version to restore`);
                }
                await args.repo.restoreVersion(ref, before.prevVersion, {
                    actor, source, message, intent, packageId: item.packageId, ...memberOption(item.d.member),
                });
                // The registry route every stored-row write takes. Phase 2 never
                // ran, so the registry still serves this body; the heal
                // re-registers the active row the store now serves, the one just
                // restored, without opening another write-through caller.
                // [#32366] For the package the restored row is bound to.
                await host.restoreArtifactRegistryView(item.singularType, item.d.name, null, item.packageId, item.d.member);
            } else {
                await args.repo.delete(ref, {
                    parentVersion: item.version, actor, source, message, intent,
                    state: 'active', packageId: item.packageId, ...memberOption(item.d.member),
                });
                // …and a removed row's heal, as `revertCommit`'s removal takes
                // it: the registry never registered this row, so it is left
                // serving what it served before the publish.
                // [#32366] For the package of the row it deleted.
                await host.restoreArtifactRegistryView(item.singularType, item.d.name, null, item.packageId, item.d.member);
            }
            // A drain that failed left the draft row in place (#4981): it is
            // still pending, and putting it back again would conflict with it.
            const draftKey = item.d.packageId ?? null;
            const pending = await args.repo.get(ref, { state: 'draft', packageId: draftKey, ...memberOption(item.d.member) });
            if (!pending) {
                await args.repo.put(ref, item.promotedDraft.body, {
                    parentVersion: null, actor, source, message, intent, state: 'draft', packageId: draftKey,
                });
                // No registry entry serves a draft row: the heal re-derives this
                // item's entry from the active rows the store now serves, the
                // state the undo above just restored — the route the stored-row
                // census asks of every write.
                // [#32366] For the package of the active row the undo left.
                await host.restoreArtifactRegistryView(item.singularType, item.d.name, null, item.packageId, item.d.member);
            }
        } catch (error) {
            notUndone.push({ item, error });
        }
    }
    return notUndone;
}

export class ProtocolHistoryAndPublishFacet {
    /** The body of `ObjectStackProtocolImplementation#historyMetaItem`; the method's docblock there is its contract. */
    static async historyMetaItem(host: Pick<ProtocolHost, 'getOverlayRepo' | 'historyMetaItem' | 'isOverlayAllowed' | 'isRuntimeCreateAllowed' | 'resolveRowlessExpandedView' | 'storedHashDigest'>, request: {
            type: string;
            name: string;
            sinceSeq?: number;
            limit?: number;
            /** [#22877] The bundle member whose lineage to read — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
            member?: string;
        }): Promise<{ events: import('@objectstack/metadata-core').MetadataEvent[] }> {
        // [#9157] #4432 / #7894 — CANONICAL TYPE KEY. See {@link canonicalMetaType}
        // and the twin comment on {@link auditMetaItem}; #9180 step ① routes all
        // three read verbs, and this one is where the manifest map was doing the
        // most damage.
        //
        // `historyMetaItem` serves `GET /api/v1/meta/:type/:name/history`
        // (`rest-route-ledger.ts:178`). The plural was not merely a wrong key
        // here — it was a door AROUND the gate immediately below, measured on
        // `origin/main`:
        //
        //   `translation` declares `allowEnvironmentOverlay: true`, so the singular
        //   passes `isOverlayAllowed` and reads real `sys_metadata_history`
        //   rows. `translations` is MANIFEST-ABSENT, so the old line left it
        //   plural; `isOverlayAllowed('translations')` is false, and
        //   `isRuntimeCreateAllowed('translations')` then returns TRUE through
        //   its no-static-registry-entry arm — the PLUGIN path, which every
        //   gate is permissive toward by construction. So the plural sailed
        //   past the gate and asked the repository for `type='translations'`,
        //   which no row carries, and the endpoint answered `{ events: [] }`
        //   about an item with a full change log.
        //
        //   `fields` inverts the same asymmetry: singular `field` declares
        //   neither flag and is REFUSED by the gate (early `{ events: [] }`,
        //   zero engine calls), while the plural passed it and issued a real
        //   `sys_metadata_history` read keyed `'fields'`. Same body, opposite
        //   path — which is why the pins assert the KEY the repository was
        //   asked for and not only the body.
        //
        // The fold is placed ABOVE the gate deliberately: a misspelling
        // (`viewes`) must be refused 400 naming `view` / `views`, not silently
        // absorbed by the early return.
        request = canonicalizeMetaRequestType(request);
        // [#22877] Ruling 6116165299 (Q2 i) and the seat's answer 6118224899:
        // the bundle shares ONE lineage counter per name, and this read serves
        // one member's events of it — the selector's, else the canonical one.
        // Checked before the gate below, so a selector on a type with no
        // members is refused, never absorbed by the early empty answer.
        const member = resolveBundleMemberSelector(request.type, request.member);
        // Canonical by construction from the fold above — NOT a second fold.
        const singularType = request.type;
        if (!host.isOverlayAllowed(singularType)
            && !host.isRuntimeCreateAllowed(singularType)) {
            return { events: [] };
        }
        // [#21442] A view name with no stored row of its own that a stored
        // view container in this caller's scope expands — a name the by-name
        // read answers with the container's expansion — was never stored, so
        // it has no change log of its own and none is synthesized for it. Its
        // history is the container's own row's, read exactly as this method
        // reads it under the container's own name, and the answer says so:
        // every event's `ref.name` names the container.
        const expandedFrom = await host.resolveRowlessExpandedView(
            { type: singularType, name: request.name },
        );
        if (expandedFrom !== undefined) {
            return host.historyMetaItem({ ...request, name: expandedFrom.container.name });
        }
        // [ADR-0131 D6] The environment's change log; a legacy
        // organization-scoped history row is not read.
        const repo = host.getOverlayRepo();
        const ref = {
            type: singularType,
            name: request.name,
            org: 'env',
        } as Parameters<typeof repo.history>[0];

        const events: import('@objectstack/metadata-core').MetadataEvent[] = [];
        const opts: { sinceSeq?: number; limit?: number; member?: string } = { ...memberOption(member) };
        if (request.sinceSeq !== undefined) opts.sinceSeq = request.sinceSeq;
        if (request.limit !== undefined) opts.limit = request.limit;
        // [#21207] Each event's hash and parent hash are served in keyed form —
        // the same value the write receipts hand out, so an event still names
        // the token a caller holds; a delete event's own `null` is kept.
        // The event's message is the row's change note, which can QUOTE a stored
        // hash (`publish draft (hash …)` on rows written before the publish door
        // stated its own message) — each quote is served the same way.
        const digest = host.storedHashDigest();
        for await (const ev of repo.history(ref, opts)) {
            events.push({
                ...ev,
                hash: (await servedContentHash(ev.hash, digest)) ?? null,
                parentHash: (await servedContentHash(ev.parentHash, digest)) ?? null,
                ...(typeof ev.message === 'string' ? { message: await serveStoredHashTokens(ev.message, digest) } : {}),
            });
        }
        return { events };
    }

    /** The body of `ObjectStackProtocolImplementation#publishMetaItem`; the method's docblock there is its contract. */
    static async publishMetaItem(host: Pick<ProtocolHost, 'publishMetaItemUnaudited' | 'recordMetadataAudit'>, request: PublishMetaItemRequest): Promise<{
            success: boolean;
            version: string;
            seq: number;
            message?: string;
            /**
             * Present when a `seed` draft was published: the result of materializing
             * its rows. Publishing the metadata ALWAYS succeeds independently — a
             * seed-load problem is surfaced here, never thrown, so callers (and UIs)
             * must check `seedApplied.success` instead of assuming data went live.
             */
            seedApplied?: {
                success: boolean;
                inserted: number;
                updated: number;
                error?: string;
                errors?: unknown[];
                /** [#30348] Per object, the rows created vs matched — `SeedAppliedLandedSchema`. */
                landed?: SeedAppliedLandedParsed[];
            };
            /**
             * Present when a publish-time materializer is registered for this type
             * (ADR-0086 P2 — e.g. `flow`): the result of projecting the published
             * body into its data-plane representation. Best-effort,
             * same contract as `seedApplied` — surfaced, never thrown.
             */
            materializeApplied?: PublishMaterializeResult;
            /**
             * Present when an ADR-0094 mutation projector is registered for this
             * type: the outcome of the awaited post-persist projection. The
             * draft→active promotion runs the projector exactly as a direct active
             * save does, so this is the same receipt `saveMetaItem` returns.
             *
             * [#7294] It was ASSIGNED below and missing from this annotation, so
             * the method's declared type denied a key the wire body carried — the
             * same declared-≠-returned gap one layer down from the one #7294
             * closed on the spec side.
             */
            projectionApplied?: MutationProjectionOutcome;
            /**
             * [#9176] Present ONLY when the #4463 runtime authoring gate raised at
             * least one non-blocking finding against the draft body this promotion
             * carried to `active` — an empty array is never emitted, so a clean
             * publish's response bytes are unchanged (the #4717 discipline, one
             * door over). Every entry is `warning`/`info` by construction: an
             * `error` finding refuses the promotion as the 422 instead.
             */
            advisories?: RuntimeAuthoringIssue[];
        }> {
        // [#28355] A refusal that carries no row of its own leaves its `denied` row here.
        return withRefusalAudit((entry) => host.recordMetadataAudit(entry), {
            operation: 'publish', type: request.type, name: request.name, actor: request.actor,
            source: 'protocol.publishMetaItem',
        }, () => host.publishMetaItemUnaudited(request));
    }

    /** [#28355] The body of {@link publishMetaItem} before its refusal audit; that method's docblock is the contract. */
    static async publishMetaItemUnaudited(host: Pick<ProtocolHost, 'emitMetaItemPublished' | 'packagelessOverlayWriteRefusal' | 'promoteDraftForPublish' | 'receiptVersion' | 'recordMetadataAudit' | 'recordPendingDenialAudit' | 'refuseOrganizationScopedWrite' | 'refuseUngrammaticalMetaItemName' | 'runPublishSideEffects'>, request: PublishMetaItemRequest): Promise<{
            success: boolean;
            version: string;
            seq: number;
            message?: string;
            /**
             * Present when a `seed` draft was published: the result of materializing
             * its rows. Publishing the metadata ALWAYS succeeds independently — a
             * seed-load problem is surfaced here, never thrown, so callers (and UIs)
             * must check `seedApplied.success` instead of assuming data went live.
             */
            seedApplied?: {
                success: boolean;
                inserted: number;
                updated: number;
                error?: string;
                errors?: unknown[];
                /** [#30348] Per object, the rows created vs matched — `SeedAppliedLandedSchema`. */
                landed?: SeedAppliedLandedParsed[];
            };
            /**
             * Present when a publish-time materializer is registered for this type
             * (ADR-0086 P2 — e.g. `flow`): the result of projecting the published
             * body into its data-plane representation. Best-effort,
             * same contract as `seedApplied` — surfaced, never thrown.
             */
            materializeApplied?: PublishMaterializeResult;
            /**
             * Present when an ADR-0094 mutation projector is registered for this
             * type: the outcome of the awaited post-persist projection. The
             * draft→active promotion runs the projector exactly as a direct active
             * save does, so this is the same receipt `saveMetaItem` returns.
             *
             * [#7294] It was ASSIGNED below and missing from this annotation, so
             * the method's declared type denied a key the wire body carried — the
             * same declared-≠-returned gap one layer down from the one #7294
             * closed on the spec side.
             */
            projectionApplied?: MutationProjectionOutcome;
            /**
             * [#9176] Present ONLY when the #4463 runtime authoring gate raised at
             * least one non-blocking finding against the draft body this promotion
             * carried to `active` — an empty array is never emitted, so a clean
             * publish's response bytes are unchanged (the #4717 discipline, one
             * door over). Every entry is `warning`/`info` by construction: an
             * `error` finding refuses the promotion as the 422 instead.
             */
            advisories?: RuntimeAuthoringIssue[];
        }> {
        // [ADR-0131 D6] FIRST: an organization-scoped promotion is refused.
        // See {@link organizationScopedWriteRefusal}.
        host.refuseOrganizationScopedWrite(
            `Metadata item '${request.type}/${request.name}'`, request,
        );
        // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. This is the
        // SEVENTH `/meta` entry point, and until #8769 it was the only one that
        // did not funnel through the boundary fold — so the URL family
        // `/meta/:type/:name/publish` accepted a spelling that `PUT` folds and
        // `publish` did not resolve. Two dialects of one contract, decided by
        // which verb you used (Prime Directive #12).
        //
        // What the fold reaches here that `promoteDraftForPublish`'s own
        // `PLURAL_TO_SINGULAR` line does NOT — measured, not assumed:
        //
        //  • the four types the MANIFEST map legitimately omits (`field`,
        //    `seed`, `external_catalog`, `translation` — they are not stack
        //    collections). Unfolded, they arrive at the draftability check as
        //    unrecognised and take the permissive PLUGIN branch of
        //    `isRuntimeCreateAllowed` instead of their real registry entry: a
        //    publish addressed `/meta/fields/...` passed a gate that
        //    `/meta/field/...` answers 403 NOT_OVERRIDABLE. The #7894 shape,
        //    one verb over.
        //  • `getEffectiveLock`'s OVERLAY limb, which queried `sys_metadata`
        //    with the raw `type`. Its artifact limb folded; the overlay limb
        //    did not, so an ADR-0010 `_lock` carried by the stored active row
        //    was not found when the publish was addressed with a plural — while
        //    the promotion below DID find the row, because it reads the folded
        //    `singularType`. That asymmetry is the one thing here that was not
        //    fail-closed. [#9009] It is no longer this fold that covers it:
        //    the gate folds its own key now, so this bullet records what the
        //    boundary fold used to be the ONLY defence for.
        //  • the ADR-0010 audit row and the receipt sentence, which both read
        //    `request.type` and so recorded the CALLER's spelling for a row
        //    written under the canonical one — a compliance query on
        //    `type = 'view'` missed a publish addressed `/meta/views/…`.
        //
        // ⚠️ `ensureObjectStorage` is NOT in that list, because it answered both
        // spellings identically before this fold and after it: it used to open
        // `if (type !== 'object' && type !== 'objects')`, a spelling-tolerant
        // lookup one layer down — the shape {@link canonicalMetaType}'s header
        // rejects.
        //
        // [#8862] That tolerant limb is now GONE — the guard reads
        // `if (type !== 'object')`. The paragraph is kept in the past tense
        // rather than deleted because the reasoning below is what LICENSED the
        // removal, and a reader arriving at the fold still needs to know why
        // the helper was never a second line of defence.
        //
        // [#8820] This paragraph used to justify that with "both of its call
        // sites stand behind a fold". That reason was FALSE. Counting the
        // helper's own two call sites is not the reachability question: the
        // second one lives inside {@link runPublishSideEffects}, which has TWO
        // callers — this method (folded) and `publishPackageDrafts`, which is
        // NOT folded, since `listDrafts` hands back the draft row's stored
        // `type` verbatim.
        //
        // The conclusion survived the correction, for a reason nothing here had
        // stated: a draft row stored under a plural `type` cannot be promoted
        // at all. `promoteDraftForPublish` addresses it by the folded singular
        // and `SysMetadataRepository.whereFor` emits that spelling with no
        // at-rest fallback, so the promote raises `NO_DRAFT` and the
        // all-or-nothing batch (ADR-0067 D2) aborts before Phase 2 ever runs.
        // Measured in `protocol.publish-side-effects-canonical-type.test.ts`,
        // which had no predecessor — the batch path's DDL step had NO coverage,
        // so deleting the tolerant limb was green across the whole package
        // either way, and "the suite still passes" could not have told anyone
        // which of these two stories was true.
        //
        // The lesson worth keeping: a reachability claim has to be traced to
        // each caller's PRODUCER, not to the immediate call sites, and an
        // invariant that load-bears across three frames belongs in the type,
        // not in a comment. #8820 did that — `runPublishSideEffects` now takes
        // only the folded `singularType`, so the unfolded value is gone from
        // its parameter list and no future consumer can reach for it.
        //
        // ⛔ This does NOT make `promoteDraftForPublish`'s fold redundant — that
        // helper's other caller is `publishPackageDrafts`, which feeds it stored
        // row types (data at rest, where a legacy plural row is real and nothing
        // rewrites it on upgrade). Different input class, different map; see
        // {@link canonicalMetaType}'s header for why the two are not one fold.
        request = canonicalizeMetaRequestType(request);
        // [#22877] Ruling 6116165299 (Q2 i): the promotion addresses ONE
        // member's draft of a bundled type, the selector's, else the canonical
        // one. Read once here and handed down trimmed.
        const member = resolveBundleMemberSelector(request.type, request.member);
        // [commit 311433f6b] The item-name grammar verdict, same as `saveMetaItem`'s:
        // the promotion door writes an `active` row under this name, so an
        // off-grammar name is refused here too rather than promoted. With the
        // save door closed no such draft can exist any more; for pre-grammar
        // residue drafts the refusal (rather than a promotion) is the ruled
        // direction, and `deleteMetaItem` stays open to clear them.
        host.refuseUngrammaticalMetaItemName(request);
        // [ADR-0146 D11] A publish naming no package of a packaged item of an
        // overlay type writes the active row a package-less save writes, and
        // is closed with it ({@link packagelessOverlayWriteRefusal}): publish
        // the draft by naming its package (`?package=<base>.custom`).
        {
            const closed = await host.packagelessOverlayWriteRefusal({
                type: request.type,
                name: request.name,
                packageId: request.packageId,
                state: 'draft',
                ...memberOption(member),
            }, 'publish');
            if (closed) throw closed;
        }
        // [#8594] The refusal's own row is written HERE, by the route that owns
        // the (absent) transaction — see `promoteDraftForPublish`'s header. This
        // site has no transaction of its own, so recording it in the `catch` is
        // where it always effectively landed; what changed is that the helper no
        // longer assumes that on behalf of the batch route too.
        const { singularType, advisories, result } = await host.promoteDraftForPublish({ ...request, member, registryQuestion: PROMOTION_REGISTRY_QUESTION['item-publish'] })
            .catch(async (err: unknown) => {
                await host.recordPendingDenialAudit(err);
                throw err;
            });
        // [#32396] This call states no `judgeOnly`, so the promotion was written.
        if (!result) throw unwrittenPromotionError(request.type, request.name);
        // [#7748] ADR-0010 — success audit (best-effort), the same shape
        // `saveMetaItem` and `deleteMetaItem` write on their allowed paths.
        //
        // Until this landed, the ONLY route from a publish to `recordMetadataAudit`
        // was `assertLockAllowsWrite`, which records on the DENY path and returns
        // before any write on allow. So a REFUSED publish was audited and a
        // SUCCESSFUL one was not — the inverse of what an audit trail is for.
        //
        // Written here, after `promoteDraftForPublish` has committed the
        // draft→active promotion and before the side effects: the same position
        // the other two allowed-outcome sites take (persistence durable,
        // projections not yet run). Deliberately NOT inside
        // `promoteDraftForPublish` — `publishPackageDrafts` calls that inside ONE
        // `engine.transaction()`, and an audit row that rolls back with the batch
        // is a different contract from the two existing sites, which write after
        // their repository transaction has closed. [#8400] The batch path now
        // writes its own rows in ITS Phase 2, driven off `promoted[]`, for that
        // reason — a separate edit at a separate site, which is why it never
        // belonged in here.
        await host.recordMetadataAudit({
            type: request.type,
            name: request.name,
            organizationId: null,
            operation: 'publish',
            outcome: 'allowed',
            code: 'ok',
            ...(request.actor ? { actor: request.actor } : {}),
            source: 'protocol.publishMetaItem',
            note: 'active',
        });
        const response: {
            success: boolean;
            version: string;
            seq: number;
            message?: string;
            seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[]; landed?: SeedAppliedLandedParsed[] };
            materializeApplied?: PublishMaterializeResult;
            projectionApplied?: MutationProjectionOutcome;
            advisories?: RuntimeAuthoringIssue[];
        } = {
            success: true,
            // [#21207] Keyed, never the stored content hash (`receiptVersion`).
            version: await host.receiptVersion(result.version),
            seq: result.seq,
            message: `Published draft — type=${request.type}, name=${request.name} [seq=${result.seq}]`,
            // [#9176] Omitted-when-empty, never `advisories: []` — a clean
            // publish's response bytes are unchanged, and absence means
            // "nothing to report", never "the gate did not run" (#4717's
            // ruling, point 2, carried to this door).
            ...(advisories.length > 0 ? { advisories } : {}),
        };
        const effects = await host.runPublishSideEffects({
            singularType,
            name: request.name,
            body: result.item.body,
            packageId: result.packageId,
            ...(request.actor ? { actor: request.actor } : {}),
            skipSeedApply: !!request._skipSeedApply,
        });
        if (effects.seedApplied) response.seedApplied = effects.seedApplied;
        if (effects.materializeApplied) response.materializeApplied = effects.materializeApplied;
        if (effects.projectionApplied) response.projectionApplied = effects.projectionApplied;
        // [#30635] A refused storage sync rides the same omitted-when-empty
        // `advisories`, after the gate's findings; the publish is not failed.
        if (effects.storageRefused) response.advisories = [...(response.advisories ?? []), effects.storageRefused];
        // [#10219] LAST, and awaited: tell the host that ONE item went live, so
        // it can announce `metadata:reloaded` and boot-cached consumers re-sync
        // without a restart — the parity the batch door has had since #2576.
        // After the side effects because a subscriber re-reads the protocol
        // (`resyncFlowsFromProtocol` pulls `getMetaItems({type:'flow'})`), and
        // it must see the finished state: the active row, its table, and any
        // materialized rows. Before the return so the caller's 2xx means the
        // re-bind was attempted, not merely queued.
        await host.emitMetaItemPublished({
            type: singularType,
            name: request.name,
            organizationId: null,
        });
        return response;
    }

    /**
     * Phase 1 of a publish (ADR-0067 D2) — guards + draft promotion,
     * METADATA WRITES ONLY: the draftable gate, the ADR-0010 lock check, and
     * `repo.promoteDraft` (active-row put + draft delete), with
     * optimistic-lock conflicts translated to `metadata_conflict`. Contains
     * NO side effects, so a batch caller (`publishPackageDrafts`) can run
     * many promotions inside ONE `engine.transaction()` and roll them ALL
     * back together — the "a commit cannot half-land" invariant.
     * `publishMetaItem` composes it with {@link runPublishSideEffects} for
     * the single-item path.
     *
     * ## [#8594] …and NO AUDIT WRITES either — refusals carry their row out
     *
     * Both denials this method can raise — the ADR-0010 lock refusal and the
     * optimistic-lock 409 — used to write their `sys_metadata_audit` row right
     * here. Which is durable on one of its two routes and destroyed on the
     * other: `publishMetaItem` calls this outside any transaction, while
     * `publishPackageDrafts` calls it inside the batch's, so the row describing
     * the refusal was rolled back BY THAT REFUSAL — the trail ended up with
     * nothing about a publish refused by a lock, which is the exact defect
     * #7748 exists to close. `batch_aborted` (#8400) gave the batch route *a*
     * trail but not the inner verdict's vocabulary: a compliance query on
     * `code = 'item_locked'` still found nothing.
     *
     * So the row leaves as data on the thrown error ({@link withPendingAudit}),
     * and each caller records it with {@link recordPendingDenialAudit} from a
     * position a rollback cannot reach. This helper does not know whose
     * transaction it is inside — it cannot, and guessing is what broke — so the
     * placement decision moves to the only two places that do know.
     *
     * ⚠️ A NEW CALLER INHERITS THAT OBLIGATION: catch, call
     * `recordPendingDenialAudit`, rethrow. Skip it and the refusal is silent
     * again — the pre-#7748 state, not merely a worse one.
     */
    static async promoteDraftForPublish(host: Pick<ProtocolHost, 'anonymousElevatedFlowRefusal' | 'assertRuntimeAuthoringRules' | 'classifyObjectContribution' | 'credentialChannelFor' | 'defaultRecordPageSaveRefusal' | 'ensureOverlayIndex' | 'externalBindingSaveRefusal' | 'getOverlayRepo' | 'isArtifactBacked' | 'isOverlayAllowed' | 'isRuntimeCreateAllowed' | 'isSealedManagedItem' | 'lockWriteRefusal' | 'metadataConflictRefusal' | 'namedBaseOverlayWriteRefusal' | 'objectExtensionItemRefusal' | 'objectNamespaceObjectNameClash' | 'objectNamespacePrefixViolation' | 'objectRegistrationRefusal' | 'optimisticConflictAuditEntry' | 'overlayPackageMismatchError' | 'overrideWriteVerdict' | 'packagelessAddress' | 'packagelessDraftAddress' | 'permissionSetNameCollisionRefusal' | 'resolveSduiManifest' | 'seedExternalIdSaveRefusal' | 'uninstalledNamedBaseRefusal' | 'unknownDatasourceSaveRefusal' | 'unknownGrantObjectSaveRefusal' | 'unknownPicklistBindingSaveRefusal'>, request: {
            type: string; name: string; actor?: string; message?: string;
            /**
             * [#8907] ADR-0048 — the package binding of the draft being promoted,
             * when the caller listed it under one. Threaded straight into
             * `repo.promoteDraft` so the promotion resolves the draft under the
             * SAME key it was listed by.
             *
             * `undefined` (any caller with no binding to state) names no package:
             * [#23495] the draft the draft save naming no package writes
             * ({@link packagelessDraftAddress}), never the first draft row a
             * package-agnostic read meets. `null` pins the lookup to
             * the unbound row — so the field is passed through only when the caller
             * actually has a binding to state. [commit 490879ad0] That parenthetical used to
             * read "the `publishMetaItem` path, which names no package"; since
             * commit 9e04c3e35 the per-item door names one whenever its HTTP caller does, so
             * `undefined` is now about the ABSENCE of a binding, never about which
             * caller is on the other end.
             */
            packageId?: string | null;
            /**
             * [#10377] The OTHER drafts this promotion is part of a batch with,
             * projected into the gate's context collections. Forwarded verbatim to
             * {@link assertRuntimeAuthoringRules} — this method computes nothing
             * from it and holds no opinion about its contents.
             *
             * Stated by `publishPackageDrafts` (a package publishes as a unit);
             * absent on the `publishMetaItem` path, whose batch is one item, so a
             * "same-batch" closure would be the item itself and change nothing.
             */
            pending?: RuntimePendingDeclarations;
            /**
             * [#26724] The names of the datasource drafts this promotion's batch
             * publishes with it, for {@link unknownDatasourceSaveRefusal}: an
             * object draft may name one. Stated by `publishPackageDrafts`; absent
             * on the `publishMetaItem` path, where the datasource must be live.
             */
            batchDatasources?: ReadonlySet<string>;
            /**
             * [#28990] The names of the object drafts this promotion's batch
             * publishes with it, for {@link unknownGrantObjectSaveRefusal}: a
             * permission-set draft may grant on one. Stated by
             * `publishPackageDrafts`; absent on the `publishMetaItem` path, where
             * the object must exist already.
             */
            batchObjects?: ReadonlySet<string>;
            /**
             * [#22877] The bundle member whose draft to promote; omitted, the
             * canonical one. The draft read, the gate's read and the promotion
             * all address it, so the body judged is the body that goes live.
             */
            member?: string;
            /**
             * [ADR-0144 D2 and D6, amended] The registry question this
             * promotion asks before the row goes live, stated by every producer
             * ({@link PROMOTION_REGISTRY_QUESTION}, `registry-question.ts`): the
             * per-item publish asks against the registry, a package publish
             * body-only.
             */
            registryQuestion: RegistryQuestion;
            /**
             * [#32396, ADR-0067 D2] Judge, do not write: every refusal this
             * method can raise is raised exactly as it would be, and the method
             * returns just before `repo.promoteDraft`, so nothing is written
             * and the answer carries no `result`. Stated by
             * `publishPackageDrafts` on a runtime that cannot roll back, which
             * judges its whole batch this way before promoting any of it: a
             * refused draft then refuses the batch with nothing promoted,
             * rather than after the drafts before it are already live.
             */
            judgeOnly?: boolean;
        }): Promise<{
            singularType: string;
            /**
             * [#9176] The #4463 gate's advisory half for this promotion — the
             * non-blocking findings `assertRuntimeAuthoringRules` RETURNS (its
             * gating half throws before this method resolves). Empty when the
             * gate raised nothing or did not run (no draft, package-author
             * channel); `publishMetaItem` attaches it to its response only when
             * non-empty, exactly as `saveMetaItem` does one door over. [#9343]
             * The batch caller (`publishPackageDrafts`) reads it too and attaches
             * it to the matching `published[]` element, same omitted-when-empty
             * discipline — per the maintainer's ruling, no parallel top-level map.
             */
            advisories: RuntimeAuthoringIssue[];
            /** What `repo.promoteDraft` wrote. Absent exactly when `judgeOnly` was stated. */
            result?: { version: string; seq: number; item: MetadataItem; packageId: string | null };
            /**
             * [#32369] What a judge-only call judged: the draft body the
             * promotion would make active and the package it would write it
             * under, for `publishPackageDrafts`' Phase 0 to judge the batch's
             * objects as one unit. Present only on a judge-only call that read
             * a draft.
             */
            judged?: { body: unknown; packageId: string | null };
            /**
             * [#32396] The draft row this promotion consumed — the body and
             * hash it judged and `repo.promoteDraft` promoted (`expectedDraftHash`
             * holds the two to one row). `publishPackageDrafts` puts it back
             * when it undoes the promotion on a runtime that cannot roll back.
             * Absent when nothing was written.
             */
            promotedDraft?: { body: unknown; hash: string };
        }> {
        const singularType = PLURAL_TO_SINGULAR[request.type] ?? request.type;
        if (!host.isOverlayAllowed(singularType)
            && !host.isRuntimeCreateAllowed(singularType)) {
            const err: any = new Error(
                `Metadata type '${request.type}' is not draftable — no overlay/runtime-create permission.`,
            );
            err.code = 'NOT_OVERRIDABLE';
            err.status = 403;
            throw err;
        }
        await host.ensureOverlayIndex();
        // [ADR-0131 D6] Environment-wide: every caller refused an
        // organization-scoped request before reaching here.
        const repo = host.getOverlayRepo();

        // #4463 D1 — the OTHER way a body reaches `active`. `saveMetaItem`
        // gates a direct active save and deliberately lets every draft through;
        // that permission is only sound if the draft→active promotion gates.
        // Without this the gate would be trivially bypassable by anyone who
        // saves `?mode=draft` and then POSTs `/publish` — which is exactly what
        // Studio's designer surface does on every edit.
        //
        // The draft is read under ONE package key, and `repo.promoteDraft`
        // below promotes under that same key, so the body judged here is the
        // body that becomes active. ADR-0048 keys a draft by
        // `(org, type, name, package_id)`: two packages can each hold a draft
        // of the same name in one org, and a read without the package
        // dimension picks either. The key is the caller's stated binding
        // (spelled exactly as `repo.promoteDraft` receives it); with none
        // stated, the key of the draft this promotion resolves, read once and
        // then stated to the lock lookup, the read and the promotion.
        //
        // [#23495, ADR-0048, ADR-0070 TL;DR 1] With none stated, the draft the
        // draft save naming no package writes ({@link packagelessDraftAddress}).
        // It used to be the binding of whichever draft row a package-agnostic
        // `findOne` met first, so over an item bound to package `P` the publish
        // promoted the package-unbound draft beside `P`'s, into a package-less
        // active row no read naming no package serves, or another package's
        // draft, into a second package's active row, while the read, the save
        // and the token named `P`'s draft. `promoteInto` is the package the
        // active row is written under: the key, or for an unbound draft of an
        // item bound to `P`, `P` (the adoption the draft save performs).
        let draftKey: string | null;
        let promoteInto: string | null;
        // Answered below the `_lock` gate, which judges the item rather than
        // its row, as the save and the delete order their address refusals.
        let addressRefusal: Error | undefined;
        if ('packageId' in request) {
            draftKey = request.packageId ?? null;
            promoteInto = draftKey;
        } else {
            // [#21934] Read ahead of the lock check, so a store that cannot be
            // read is answered here as the lock read answers it (#5706): an
            // unprovisioned `sys_metadata` holds no draft, and any other failure
            // is the 503 the lock read raised before this read moved above it
            // ({@link packagelessAddress} discriminates both).
            const address = await host.packagelessDraftAddress(singularType, request.name, request.member);
            if (address.kind === 'ambiguous') {
                draftKey = null;
                promoteInto = null;
                addressRefusal = packagelessAddressAmbiguityRefusal('publish', request.type, request.name, address.candidates);
            } else {
                draftKey = address.key;
                promoteInto = address.into;
                // No draft at the address while another package's draft is
                // stored: the promotion's `NO_DRAFT`, naming the drafts that
                // remain and the request that reaches them.
                const others = address.drafts.candidates.filter((id) => id !== address.key);
                if (address.kind === 'none' && address.into !== null && others.length > 0) {
                    addressRefusal = packagelessPublishNoDraftRefusal(request.type, request.name, address.into, others);
                }
            }
        }
        // ADR-0010 L3 — lock blocks publish too (publishing is a write).
        //
        // [#8594] `lockWriteRefusal`, not `assertLockAllowsWrite`: the row rides
        // OUT on the error and each caller records it on its own side of its own
        // transaction. See this method's header for why it cannot be written here.
        const _publishLockRefusal = await host.lockWriteRefusal({
            type: request.type,
            name: request.name,
            // [#21761] The promotion's address carries its package, as the read's does.
            // [#21934] It is the key resolved above, the one the gate reads the
            // draft under and the promotion writes under: the caller's stated
            // binding, else the resolved draft's. [#23495] The package the
            // promotion writes under, which for an adopted unbound draft is the
            // item's package.
            ...(promoteInto ? { packageId: promoteInto } : {}),
            operation: 'publish',
            ...(request.actor ? { actor: request.actor } : {}),
            source: 'protocol.publishMetaItem',
        });
        if (_publishLockRefusal) {
            throw withPendingAudit(_publishLockRefusal.err, _publishLockRefusal.audit);
        }
        if (addressRefusal) throw addressRefusal;
        // [#26921] THE NAMED-BASE RULE at the promotion: the package the
        // draft goes live in — named by the caller, or given by the item's
        // rows when it names none — must be installed. A draft bound to an id
        // no installed package has was stored before the save door refused
        // naming one, and promoting it served it live, owned by nothing (no
        // manifest, so no namespace, uninstall or export). `publish-drafts`
        // refuses such an id at its door before it gets here; this is the
        // per-item publish, and it is refused before the draft is read.
        // Nothing is migrated or deleted. See {@link uninstalledNamedBaseRefusal}.
        const unboundBase = host.uninstalledNamedBaseRefusal(
            { type: singularType, name: request.name, packageId: promoteInto },
            { verb: 'publish' },
        );
        if (unboundBase) throw unboundBase;
        const draftForGate = await repo.get(
            { type: singularType, name: request.name, org: 'env' } as Parameters<typeof repo.get>[0],
            { state: 'draft', packageId: draftKey, ...memberOption(request.member) },
        );
        // [ADR-0029 D9.9, #23630] …and the save door's representability
        // refusal, asked of the row this promotion writes: an `object` row
        // bound to a package that does not own the object. A draft save is
        // judged against the owner of its own moment, so package `Q`'s draft
        // of an object no row held yet was stored, correctly; when package
        // `P`'s runtime-authored row of that object was saved after it, `P`
        // owned the object, and promoting `Q`'s draft wrote `Q`'s active row
        // beside `P`'s and answered success, while the registry write-through
        // refused it into a `console.warn` and kept serving `P` — the
        // disagreement {@link overlayPackageMismatchError} exists to prevent.
        //
        // Judged on `promoteInto`, the package the active row is written
        // under (the stated binding, or for an unbound draft adopted into the
        // item's package, that package), exactly as the save door judges the
        // address it resolved; with the save door's judge and envelope, and
        // before `repo.promoteDraft` writes, so a batch publish aborts on it
        // as on the refusals below (ADR-0067 D2). Both doors reach it: the
        // per-item publish and `publishPackageDrafts` promote through here.
        //
        // ⛔ Not asked of SEALED managed content ({@link isSealedManagedItem}):
        // an object a code package ships. The save door answers that row's
        // package door first ({@link refusePackagedBaseOverride},
        // `NOT_OVERRIDABLE` / 403, ahead of its D9.9 call), and the promotion
        // reaches the same refusal at the store (`repo.promoteDraft` →
        // `assertAllowed`). Asking `classifyObjectContribution` there would
        // answer its packaged `mismatch` arm instead — a second dialect for
        // one row, whose prescription ("bind to the owner") the sealed rule
        // refuses. One row, one refusal: the save door's.
        if (draftForGate && singularType === 'object' && !host.isSealedManagedItem(singularType, request.name)) {
            const layer = host.classifyObjectContribution(request.name, promoteInto);
            if (layer.kind === 'mismatch') {
                // [#23514] A package-less owner (the `'sys_metadata'` sentinel):
                // the way out is a promotion, after a delete of each row bound to
                // a package (any package) stored beside it.
                const storedPackages = layer.ownerPackageId === 'sys_metadata'
                    ? (await host.packagelessAddress(singularType, request.name)).candidates
                    : [];
                throw host.overlayPackageMismatchError(
                    request.name, layer.packageId, layer.ownerPackageId,
                    {
                        at: 'promote',
                        storedPackages,
                        // The package-unbound draft the address adopted into the one binding.
                        adoptedDraft: !('packageId' in request) && draftKey === null && promoteInto !== null,
                    },
                );
            }
            // [#29673] …and the registry's refusal of the body this promotion
            // makes live, on the same row and for the D9.9 refusal's reason:
            // the write-through runs after the row is active, where a refusal
            // is only a `console.warn`, so a publish answered `published` for
            // an object that never registered (a zh-CN Studio's echoed `queue`
            // column, measured). Asked here, before `repo.promoteDraft`
            // writes, the per-item publish answers the registry's own envelope
            // and a batch publish aborts on it into `failed[]` as on the
            // refusals below (ADR-0067 D2). See {@link objectRegistrationRefusal}.
            //
            // [ADR-0144 D2 and D6, amended] The per-item publish has no
            // sibling, so it also asks the doors that read the registry's
            // other objects (#29673's batch reason does not reach it); a
            // package publish keeps the body-only question
            // (`registry-question.ts`).
            const registration = host.objectRegistrationRefusal(draftForGate.body, layer, {
                againstRegistry: request.registryQuestion === 'against-registry',
            });
            if (registration) throw registration;
        }

        // [#24547 · ADR-0129 D2] …and the namespace-prefix rule, the third
        // door's turn: the per-item publish (`POST /meta/object/:name/publish`)
        // made an object `active` under a namespaced package although its name
        // lacks the `${namespace}_` prefix — the name the direct save and the
        // publish pre-flight refuse. Asked with their judge
        // ({@link objectNamespacePrefixViolation}) and their envelope
        // (`NAMESPACE_PREFIX` / 422, the judge's sentence), on `promoteInto` —
        // the package the active row is written under, as the D9.9 refusal
        // above is — and before `repo.promoteDraft` writes, so nothing is
        // promoted and the draft stays a draft. A promotion into no package,
        // or into a package that declares no namespace, is not judged; nor is
        // sealed managed content, for the D9.9 block's reason (its store
        // refusal is that row's one answer). `publishPackageDrafts` also
        // promotes through here, but its pre-flight has refused the same name
        // with the same judge before any promotion runs, so this answers the
        // per-item publish alone.
        if (draftForGate && singularType === 'object' && !host.isSealedManagedItem(singularType, request.name)) {
            const prefixViolation = host.objectNamespacePrefixViolation(request.name, promoteInto);
            if (prefixViolation) {
                const err: any = new Error(prefixViolation);
                err.code = 'NAMESPACE_PREFIX';
                err.status = 422;
                throw err;
            }
            // [ADR-0150 D6, child K] …and the namespace/object-name rule, with
            // the save door's judge and envelope (`NAMESPACE_CONFLICT` / 422).
            const nameClash = host.objectNamespaceObjectNameClash(request.name, promoteInto);
            if (nameClash) {
                const err: any = new Error(nameClash);
                err.code = 'NAMESPACE_CONFLICT';
                err.status = 422;
                throw err;
            }
        }
        // [#21470] …and the divergent `name` refusal, on the same body and for
        // the same reason: a draft stored before `saveMetaItem` judged every
        // type can carry a `name` that is not its row's, and promoting it
        // registers the row under that `name`. Refused here, with the save
        // door's judge and envelope, before `repo.promoteDraft` writes —
        // exactly as the authoring gate below refuses, so a batch publish
        // aborts on it as it aborts on that gate.
        if (draftForGate) {
            const nameRefusal = savedItemNameRefusal(singularType, draftForGate.body, request.name, 'publish');
            if (nameRefusal) throw nameRefusal;
        }
        // [ADR-0086 D3] …and a permission-set draft whose body `packageId`
        // disagrees with the package it is promoted into: the package resolved
        // above, the one `repo.promoteDraft` writes under ([#23495] the item's
        // package for an adopted unbound draft). A draft stored
        // before the save door judged the key can carry one, and promoting it
        // would make it active with an owner nobody reads. Refused with the
        // save door's judge and envelope, so a batch publish aborts on it as
        // on the name refusal. See {@link permissionSetOwnerBindingRefusal}.
        if (draftForGate) {
            const ownerRefusal = permissionSetOwnerBindingRefusal(
                singularType, draftForGate.body, request.name, promoteInto, 'publish',
            );
            if (ownerRefusal) throw ownerRefusal;
        }
        // [ADR-0146 D10, #28564] …and an object draft's fields against the
        // `__c` reservation, judged against the package promoted into, with the
        // save door's judge and envelope, before `repo.promoteDraft` writes. See
        // {@link objectBodyExtensionFieldSuffixRefusal}. [#28735] ⛔ Not asked
        // of SEALED managed content, for the D9.9 block's reason: the store's
        // `NOT_OVERRIDABLE` is that row's one answer, not "rename the field".
        if (draftForGate && singularType === 'object' && !host.isSealedManagedItem(singularType, request.name)) {
            const suffixRefusal = objectBodyExtensionFieldSuffixRefusal(
                singularType, draftForGate.body, request.name, promoteInto,
            );
            if (suffixRefusal) throw suffixRefusal;
        }
        // [#28574] …and an `object_extension` draft against its address, judged
        // against the package promoted into: the target may have left the
        // registry or the closure since the draft was saved. See
        // {@link objectExtensionItemRefusal}.
        if (draftForGate) {
            const extensionRefusal = host.objectExtensionItemRefusal(
                singularType, draftForGate.body, request.name, promoteInto,
            );
            if (extensionRefusal) throw extensionRefusal;
        }
        // [harden] …and a permission-set draft whose name a DIFFERENT owner
        // already holds by the time it is published: a draft save judged the
        // holders of its moment, and another owner may have taken that name
        // since (or the draft was addressed to a second package in the first
        // place). Judged again here, with the save door's own predicate and
        // envelope, against the package promoted into (`promoteInto`, the
        // binding the active row is written under), before `repo.promoteDraft`
        // writes — so a batch publish aborts on it as it aborts on the owner
        // refusal above. See {@link permissionSetNameCollisionRefusal}.
        // Asked only when a draft was read, like its siblings: with none at
        // the address the caller is told `repo.promoteDraft`'s `NO_DRAFT`
        // first, the fact about its own state, rather than another owner's.
        if (draftForGate) {
            const nameCollision = await host.permissionSetNameCollisionRefusal(
                singularType, request.name, promoteInto, 'publish',
            );
            if (nameCollision) throw nameCollision;
        }
        // [#28905, ADR-0146 D1, D11] …and the promotion INTO the read-only
        // base itself, of an item of one of the five overlay types it ships:
        // the active row it writes is bound to the base, outside the pair D1
        // puts every customization in, as the save naming the base would be,
        // and is refused with that save's sentence
        // ({@link namedBaseOverlayWriteRefusal}) before `repo.promoteDraft`
        // writes, so a batch publish aborts on it as on the refusals above.
        // Judged on `promoteInto`, the package the active row is written
        // under; the draft stays a draft, for a delete to discard.
        if (draftForGate) {
            const namedBase = host.namedBaseOverlayWriteRefusal({
                type: singularType, name: request.name, packageId: promoteInto,
                item: draftForGate.body, ...memberOption(request.member),
            }, 'publish');
            if (namedBase) throw namedBase;
        }
        // [ADR-0146 D2] …and the override write gate, on the draft's body and
        // the package it is promoted into, with the save door's judge and
        // envelope: a draft stored before the gate (or under a package whose
        // closure has since gained the name) is refused here, before
        // `repo.promoteDraft` writes, so a batch publish aborts on it as on the
        // refusals above. An admitted declaration is promoted as the pair's own
        // row (the runtime-only intent below).
        // Judged here and thrown just before the store promotes (below), so no
        // refusal this door already answered changes its code. (The save door
        // judged this draft when it was stored; a refusal here is a draft
        // stored before the gate, or one whose closure has since gained the
        // name.)
        const overrideVerdict: OverrideWriteVerdict = draftForGate
            ? host.overrideWriteVerdict({
                type: singularType, name: request.name, packageId: promoteInto, item: draftForGate.body,
            })
            : { verdict: 'not_concerned' };
        const declaredOverride = overrideVerdict.verdict === 'admit';
        // [#23015] …and one default record page per object per deployment: a
        // draft saved while no other page held its object's default can meet
        // one by the time it is published, since the save door judged only the
        // ACTIVE pages of that moment. Judged again here, on the draft body and
        // with the save door's own predicate and envelope, before
        // `repo.promoteDraft` writes — so a batch publish aborts on it too.
        if (draftForGate) {
            const defaultPageRefusal = await host.defaultRecordPageSaveRefusal(singularType, draftForGate.body, request.name, 'published');
            if (defaultPageRefusal) throw defaultPageRefusal;
        }
        // [ADR-0015 §4.2 · #25211] …and an object draft bound `external` to a
        // datasource that is managed by the time it is published, or a
        // datasource draft that would go `active` as managed under objects that
        // bind it with `external`: the draft save judged the other half as it
        // stood then. Judged again here, on the draft body and with the save
        // door's predicate and envelope, before `repo.promoteDraft` writes, so a
        // batch publish aborts on it too. See {@link externalBindingSaveRefusal}.
        if (draftForGate) {
            const bindingRefusal = await host.externalBindingSaveRefusal(singularType, draftForGate.body, request.name);
            if (bindingRefusal) throw bindingRefusal;
        }
        // [#26724] …and an object draft whose `datasource` names no datasource
        // by the time it is published, or never did: a draft save accepts a
        // datasource that is itself a draft, and that draft may not be
        // published with it. Judged on the draft body, before
        // `repo.promoteDraft` writes, so a batch publish aborts on it too; a
        // datasource draft of the same batch counts. See
        // {@link unknownDatasourceSaveRefusal}.
        if (draftForGate) {
            const datasourceRefusal = await host.unknownDatasourceSaveRefusal(
                singularType, draftForGate.body, request.name, request.batchDatasources,
            );
            if (datasourceRefusal) throw datasourceRefusal;
        }
        // [#28990] …and a permission-set draft granting on an object that does
        // not exist by the time it is published, or never did: a draft save
        // accepts an object that is itself a draft, and that draft may not be
        // published with it. Judged on the draft body, before
        // `repo.promoteDraft` writes, so a batch publish aborts on it too; an
        // object draft of the same batch counts. See
        // {@link unknownGrantObjectSaveRefusal}.
        if (draftForGate) {
            const grantRefusal = await host.unknownGrantObjectSaveRefusal(
                singularType, draftForGate.body, request.name, request.batchObjects, undefined, 'publish',
                undefined, promoteInto,
            );
            if (grantRefusal) throw grantRefusal;
        }
        // [#29898] …and an object (or object-extension) draft whose field is
        // bound to a picklist no loaded package declares by the time it is
        // published: a draft stored before this refusal, or one whose list
        // went between its save and its publish. Judged on the draft body,
        // before `repo.promoteDraft` writes, so a batch publish aborts on it
        // too. See {@link unknownPicklistBindingSaveRefusal}.
        if (draftForGate) {
            const picklistRefusal = await host.unknownPicklistBindingSaveRefusal(singularType, draftForGate.body, request.name);
            if (picklistRefusal) throw picklistRefusal;
        }
        // [#28952] …and a seed draft whose `externalId` names no field of its
        // object by the time it is published: a draft saved before this
        // refusal, one whose object was still a draft at its save, or one whose
        // object has since lost the field. Judged on the draft body, before
        // `repo.promoteDraft` writes and before any seed row is loaded, so a
        // batch publish aborts on it too; an object draft of the same batch is
        // judged as it will be published. See {@link seedExternalIdSaveRefusal}.
        if (draftForGate) {
            const seedKeyRefusal = await host.seedExternalIdSaveRefusal(
                singularType, draftForGate.body, request.name, request.pending?.objects,
            );
            if (seedKeyRefusal) throw seedKeyRefusal;
        }
        // [#27818] …and a datasource draft whose `external.credentialsRef` the active row it is promoted into
        // (`promoteInto`) does not hold now: refused before `repo.promoteDraft` writes. See {@link datasourceCredentialsRefSaveRefusal}.
        if (draftForGate) {
            const credentialsRefRefusal = await datasourceCredentialsRefSaveRefusal({
                headAt: (...a) => repo.headAt(...a), type: singularType, name: request.name, item: draftForGate.body,
                mode: 'publish', packageId: promoteInto, source: undefined, door: 'publish',
            });
            if (credentialsRefRefusal) throw credentialsRefRefusal;
        }
        // [ADR-0138 D2b] …and a flow draft that would go `active` with
        // `runAs: 'system'` while an anonymous endpoint of `type: 'flow'` names
        // it: the draft save let it through (a draft does not execute), so its
        // publish is where the pair is judged — on the draft body, with the
        // save door's predicate and envelope, before `repo.promoteDraft` writes,
        // so a batch publish aborts on it too. See
        // {@link anonymousElevatedFlowRefusal}.
        if (draftForGate) {
            const elevatedRefusal = await host.anonymousElevatedFlowRefusal(singularType, draftForGate.body, request.name);
            if (elevatedRefusal) throw elevatedRefusal;
        }
        // [#9176] The gate's return is its advisory half (#4717): captured and
        // handed out so `publishMetaItem` can attach it to the 2xx this
        // promotion is about to earn, exactly as `saveMetaItem` attaches its
        // own. Held in a local, never on `this` — the gate is per-write and
        // two concurrent publishes must not read each other's findings.
        const runtimeAdvisories: RuntimeAuthoringIssue[] = draftForGate
            ? await host.assertRuntimeAuthoringRules({
                type: singularType,
                name: request.name,
                state: 'active',
                // [#29557] The save door's verdict body: a flow draft is judged
                // in its D2-converted spelling (the save door stored it raw after
                // judging it so, #21982), and promoted, stored and served as
                // stored; the credential read below reads the stored draft.
                body: storedFlowVerdictBody(singularType, draftForGate.body),
                // [#9612] The package binding the CALLER stated for this
                // promotion — the same value threaded into `repo.promoteDraft`
                // below, so the gate and the write resolve the draft under one
                // key rather than two. BOTH callers can state it:
                // `publishPackageDrafts` always does (a package publish, which
                // is exactly the write #9612 was about), and [commit 490879ad0] since
                // commit 9e04c3e35 `publishMetaItem` does too — whenever the HTTP caller
                // named one on `POST /meta/:type/:name/publish?package=PKG_ID`.
                // An UNSTATED package still narrows nothing, and that remains
                // the correct answer rather than a gap — a promotion whose
                // package is unstated has no declared dependency set to bound
                // it. (This comment used to say the per-item door names no
                // package at all, which stopped being true at commit 9e04c3e35 and would
                // read the REST door's forwarding as dead code.)
                //
                // ⚠️ Deliberately NOT read off `draftForGate`: `rowToItem`
                // projects `sys_metadata` into a `MetadataItem`, which carries
                // no package id at all, so a read from there would be
                // silently `undefined` on every path — narrowing that never
                // fires while looking like it does. Filed rather than widened
                // here, because `MetadataItem` is a `packages/spec` contract.
                ...(request.packageId !== undefined ? { packageId: request.packageId } : {}),
                // [#10377] The batch's own pending drafts, when this promotion
                // is part of one. The package closure above says WHICH packages
                // this write may resolve against; this says which of its own
                // package's declarations are in flight beside it — two
                // different narrowings, both needed for a package to be
                // judged as a self-consistent unit.
                ...(request.pending !== undefined ? { pending: request.pending } : {}),
                // [#20790] The publish gate's restored-credential read. The
                // stored draft holds no credential the write-only channel
                // holds — the draft's own save moved it there — so the gate is
                // told where one is held (the draft's row, or the live one the
                // promotion keeps) and reads it as present.
                ...(host.credentialChannelFor(singularType)
                    ? {
                        restoredCredentialPaths: () => host.credentialChannelFor(singularType)!.heldPaths({
                            name: request.name,
                            state: 'draft',
                            item: draftForGate.body,
                        }),
                    }
                    : {}),
            })
            : [];

        // [ADR-0146 D2] The override write gate's refusal, the last before the store.
        if (overrideVerdict.verdict === 'refuse') throw overrideWriteRefusalError(overrideVerdict);
        // [#32396] Every refusal above has had its turn; a judge-only call stops
        // here, before the one write this method makes.
        if (request.judgeOnly) {
            return {
                singularType,
                advisories: runtimeAdvisories,
                ...(draftForGate ? { judged: { body: draftForGate.body, packageId: promoteInto } } : {}),
            };
        }
        const artifactBacked = host.isArtifactBacked(singularType, request.name);
        const intent: 'override-artifact' | 'runtime-only' = artifactBacked && !declaredOverride
            ? 'override-artifact' : 'runtime-only';
        const ref = {
            type: singularType,
            name: request.name,
            org: 'env',
        } as Parameters<typeof repo.promoteDraft>[0];
        // [#20312] ADR-0080 §5: `requires` is derived from the source at save,
        // and this promotion is the second way a body reaches `active`. The
        // draft's own `requires` was computed against whatever manifest the
        // host had at the DRAFT's save — none at all for a draft saved before
        // the host registered one — so carrying it forward would let a stale
        // stamp, or no stamp, become the active row. The promoted body is
        // re-stamped with the save door's own computation instead, against the
        // manifest read now, through the same key. The gate above already
        // refused a draft whose source does not compile or whose `requires`
        // disagrees with it (exactly as an active save refuses them), so what
        // reaches the stamp is a body it either fills in or re-spells. A host
        // with no manifest promotes the draft as written, as it saves it.
        const sduiManifest = host.resolveSduiManifest();
        try {
            const result = await repo.promoteDraft(ref, {
                deriveActiveBody: (draftBody) => stampHtmlPageRequires(singularType, draftBody, sduiManifest),
                // #4556 — NULL, not 'system', for an actor-less publish.
                actor: request.actor ?? null,
                source: 'protocol.publishMetaItem',
                // [#21207] Always a message of the caller's or this door's own:
                // left unstated, the repository records `publish draft (hash …)`,
                // quoting the draft's stored content hash into the history row's
                // change note — served to every history reader and copied by the
                // audit writer. This door's default says what happened without it.
                message: request.message || 'publish draft',
                intent,
                // [#8907] `null` is a meaningful scope (the unbound row). The
                // key the gated draft was read under (see `draftForGate`): the
                // stated binding, or the resolved draft's when none was stated,
                // so the promotion cannot pick a different package's draft than
                // the one judged above. [#23495] Always stated now: with no
                // draft at the resolved address the promotion answers
                // `NO_DRAFT` at that address, never another package's draft.
                packageId: draftKey,
                // [#23495] …and an unbound draft of an item bound to a package
                // is promoted into that package, as its draft save adopts it.
                ...(draftKey === null && promoteInto !== null ? { adoptInto: promoteInto } : {}),
                // [#21934] …and the promotion writes only the draft the gate
                // judged: the judged draft's hash (`null` when the gate found
                // none), so a draft saved after the gate's read is refused as a
                // conflict instead of being promoted unjudged.
                expectedDraftHash: draftForGate ? draftForGate.hash : null,
                // [#22877] …of the member that was judged.
                ...memberOption(request.member),
            });
            return {
                singularType,
                advisories: runtimeAdvisories,
                result,
                ...(draftForGate ? { promotedDraft: { body: draftForGate.body, hash: draftForGate.hash } } : {}),
            };
        } catch (err: any) {
            if (err instanceof ConflictError) {
                // [#21207] Keyed values or none in the text and attributes.
                const conflict = await host.metadataConflictRefusal(
                    err,
                    `${request.type}/${request.name}`,
                    err instanceof DraftConflictError
                        ? `${request.type}/${request.name} draft changed after this publish judged it, so nothing was `
                            + `published. Publish again to judge and promote the current draft.`
                        : `${request.type}/${request.name} published row advanced while you held the draft.`,
                );
                // [#8594] Attached, not written — same reason as the lock gate
                // above. The repository's own transaction has already unwound by
                // the time this `catch` runs, but the BATCH caller's has not.
                throw withPendingAudit(
                    conflict,
                    host.optimisticConflictAuditEntry({
                        type: request.type,
                        name: request.name,
                        operation: 'publish',
                        ...(request.actor ? { actor: request.actor } : {}),
                        source: 'protocol.publishMetaItem',
                        expectedParent: err.expectedParent,
                        actualHead: err.actualHead,
                    }),
                );
            }
            throw err;
        }
    }

    /**
     * Phase 2 of a publish (ADR-0067 D2) — the post-promotion side effects:
     * runtime object-registry refresh, table DDL, single-item seed apply,
     * the ADR-0086 P2 publish materializer, the ADR-0094 awaited projector,
     * and the mutation event. Everything here is (a) non-transactional by
     * nature (DDL cannot run inside the driver transaction; the registry is
     * in-memory; projections are best-effort) and (b) healed by boot
     * reconciliation when it fails — which is why a batch publish runs it
     * AFTER the metadata transaction commits: side effects can self-heal, a
     * half-landed metadata batch cannot (the ADR-0094 lesson).
     */
    static async runPublishSideEffects(host: Pick<ProtocolHost, 'applyRegistryWriteThrough' | 'applySeedBodies' | 'emitMetadataMutation' | 'ensureObjectStorage' | 'publishMaterializers' | 'runMutationProjector'>, args: {
            singularType: string;
            name: string;
            body: unknown;
            packageId: string | null;
            actor?: string;
            skipSeedApply?: boolean;
        }): Promise<{
            seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[]; landed?: SeedAppliedLandedParsed[] };
            materializeApplied?: PublishMaterializeResult;
            projectionApplied?: MutationProjectionOutcome;
            storageRefused?: RuntimeAuthoringIssue;
        }> {
        const out: {
            seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[]; landed?: SeedAppliedLandedParsed[] };
            materializeApplied?: PublishMaterializeResult;
            projectionApplied?: MutationProjectionOutcome;
            storageRefused?: RuntimeAuthoringIssue;
        } = {};
        // Drafts skipped the registry mutation; on publish we now refresh the
        // runtime registry so live behaviour catches up immediately (matches
        // saveMetaItem's post-persistence registry update path — #4521 makes
        // that path cover every overlay type, so promoting a drafted action
        // makes it dispatchable at once instead of at the next listing).
        await host.applyRegistryWriteThrough({
            type: args.singularType,
            name: args.name,
            item: args.body,
            packageId: args.packageId,
            // [#6602] The promoted draft is environment-wide (ADR-0131 D6).
            organizationId: null,
        });
        // Create the object's table now so it's CRUD-able without a restart.
        //
        // [#8820] Reads the FOLDED `singularType`, like every other consumer in
        // this helper. It used to read a separate, UNFOLDED `requestType`, and
        // it was that parameter's only consumer.
        //
        // Behaviour is identical either way — `type` is read only by
        // `ensureObjectStorage`'s guard and never reaches `syncObjectSchema`,
        // which takes `name` alone — so this is a refactor, not a fix. What it
        // removes is a structural hazard: `publishPackageDrafts` passes the
        // draft row's STORED `type` (`listDrafts` applies no fold), so the
        // parameter's contract said a plural could arrive here, and the only
        // thing that actually stopped one was an unstated invariant three
        // frames away — `promoteDraftForPublish` addresses the row by its
        // folded singular and `SysMetadataRepository.whereFor` emits that
        // spelling verbatim with no at-rest fallback, so a plural row raises
        // `NO_DRAFT` and the all-or-nothing batch aborts before Phase 2. That
        // is measured, in `protocol.publish-side-effects-canonical-type.test.ts`
        // — but it is a fact about a repository read, load-bearing for a guard
        // two files away, and nothing said so at either end. Folding at the
        // producer retires the question instead of restating the invariant.
        //
        // [#30635] A refused sync comes back as the advisory the caller is
        // told; set only when it was refused, so a clean result is unchanged.
        const storageRefused = await host.ensureObjectStorage(args.singularType, args.name);
        if (storageRefused) out.storageRefused = storageRefused;
        // Publishing a `seed` is what makes its rows live — materialize them
        // NOW (best-effort, never fails the publish) so every publish path
        // (per-ref REST publish, the home banner, package publish-drafts)
        // lands data, not just metadata. The body is already in hand from
        // the promote — no read-back, so no org-scope resolution pitfalls.
        if (args.singularType === 'seed' && !args.skipSeedApply) {
            out.seedApplied = await host.applySeedBodies([args.body]);
        }
        // Publish-time materializer (ADR-0086 P2): project the published body
        // into its data-plane representation (e.g. `flow`). Unlike seeds this
        // needs no batch ordering, so it runs on every publish path,
        // package-draft batch included. The
        // owning `package_id` rides on the draft's binding, so a package-door
        // set materializes under the right owner.
        const materializer = host.publishMaterializers.get(args.singularType);
        if (materializer) {
            try {
                out.materializeApplied = await materializer({
                    body: args.body,
                    packageId: args.packageId,
                    organizationId: null,
                    actor: args.actor ?? 'system',
                });
            } catch (e: any) {
                // [#8333 · P8] A materializer is arbitrary PLUGIN code going
                // straight at the engine, so a driver failure lands here
                // verbatim — and this string is copied onto
                // `materializeApplied.failures[].error` of a **200** publish
                // response, where no boundary withhold can reach it.
                //
                // ⚠️ Checked before converting, and it is the reason this site
                // is safe: the real materializer reports its AUTHORED refusals
                // by RETURNING `{ success: false, error }` ("permission set
                // name is owned by another package"), which never enters this
                // catch at all — it is forwarded by the collector below. So the
                // rule here judges only what THREW, and blanks no authoring
                // feedback. A third-party materializer that throws a declared
                // 4xx still keeps its sentence.
                out.materializeApplied = {
                    success: false, inserted: 0, updated: 0,
                    error: clientFacingFailureText(e, 'materialize failed'),
                };
                console.warn(
                    `[protocol.runPublishSideEffects] materializer failed for `
                    + `${args.singularType}/${args.name}: ${e?.message ?? e}`,
                );
            }
        }
        // [ADR-0094] Awaited projection: runs AFTER any materializer
        // registered for the type, so the projector sees final record state;
        // refuses/no-ops per its own rules. (No `permission` materializer is
        // registered since ADR-0131 C3 stage 6b-2.)
        const publishProjection = await host.runMutationProjector({
            type: args.singularType,
            name: args.name,
            state: 'active',
            organizationId: null,
            body: args.body,
        });
        if (publishProjection) out.projectionApplied = publishProjection;
        host.emitMetadataMutation({
            type: args.singularType,
            name: args.name,
            state: 'active',
            organizationId: null,
            // [#22877] The promoted body's member — the row the promotion wrote.
            ...mutationEventMemberOfBody(args.singularType, args.body),
        });
        return out;
    }

    /** The body of `ObjectStackProtocolImplementation#publishPackageDrafts`; the method's docblock there is its contract. */
    static async publishPackageDrafts(this: Pick<ProtocolHost, 'applyPublishBackfill' | 'applyRegistryWriteThrough' | 'applySeedBodies' | 'classifyObjectContribution' | 'collectBatchPendingDeclarations' | 'engine' | 'ensureOverlayIndex' | 'facade' | 'findEnvironmentRow' | 'getOverlayRepo' | 'getServicesRegistry' | 'isArtifactBacked' | 'objectNamespaceObjectNameClash' | 'objectNamespacePrefixViolation' | 'objectRegistrationRefusal' | 'overlayPackageMismatchError' | 'planPublishBackfill' | 'promoteDraftForPublish' | 'receiptVersion' | 'recordMetadataAudit' | 'recordPackageCommit' | 'recordPendingDenialAudit' | 'restoreArtifactRegistryView' | 'runPublishSideEffects'>, request: {
        packageId: string;
        actor?: string;
        /**
         * ADR-0067 — commit message (for AI turns: the user's instruction).
         * [ADR-0146 D1] Also the change note of every item this publish
         * promotes: each `sys_metadata_history` row it writes records it as
         * `change_note`. Absent or empty, those rows keep the sentence naming
         * the package.
         */
        message?: string;
        /** ADR-0067 — AI model that authored the turn (absent for human/CLI). */
        aiModel?: string;
        /**
         * [#24253] Opt-in: fields THIS publish adds whose literal
         * `defaultValue` is written into the object's existing rows once the
         * drafts are live. Absent or empty, no row is touched. Every entry is
         * judged before anything is promoted ({@link planPublishBackfill}), and
         * one that cannot be honoured refuses the whole request.
         */
        backfill?: ReadonlyArray<{ object: string; field: string }>;
        /**
         * [#24253] The caller's execution context: the principal the
         * `backfill` writes run as, so object permissions, RLS/FLS and record
         * hooks apply exactly as they do to that caller's own edit. Required
         * when `backfill` names anything. [#25484] The build probes read as it
         * too: a dashboard widget is probed through `queryDataset` as this
         * caller, the renderer's path, never as the system.
         */
        context?: unknown;
    }): Promise<{
        success: boolean;
        /**
         * [#10462] First-class discriminant for WHICH exit answered — the fact
         * `success` alone cannot carry: a publish with nothing to promote and
         * a genuine refusal both answer `success: false` (cloud#1488 graded
         * the former as a rollback and burned two repair rounds on artifacts
         * that were already correct). Producer invariants, pinned in the
         * conformance suites: `outcome === 'refused'` if and only if
         * `failed.length > 0`; `outcome === 'nothing_to_publish'` if and only
         * if `published.length === 0 && failed.length === 0`; and
         * `success === (outcome === 'published')` — `success` keeps its exact
         * pre-#10462 value and is now derivable. Values are lowercase snake,
         * matching the `sys_metadata_audit` outcome vocabulary.
         */
        outcome: 'published' | 'refused' | 'nothing_to_publish';
        publishedCount: number;
        failedCount: number;
        published: Array<{
            type: string;
            name: string;
            version: string;
            /**
             * [#9343] The #4463 runtime authoring gate's non-blocking findings
             * for THIS draft's promotion — the same element shape and the same
             * omitted-when-empty discipline as
             * `PublishMetaItemResponseSchema.advisories` on the single-item
             * door (#9176), riding each `published[]` element per the
             * maintainer's ruling (no parallel top-level map). Present ONLY
             * when the gate raised at least one finding against this draft —
             * an empty array is never emitted, so an advisory-free batch's
             * response bytes are unchanged. Advisory by construction: every
             * entry is `warning`/`info`, because an `error` finding refuses
             * the promotion and — the batch being all-or-nothing (ADR-0067
             * D2) — aborts the whole batch as `failed[]` instead;
             * `failed[]` elements never carry this key.
             */
            advisories?: RuntimeAuthoringIssue[];
        }>;
        failed: Array<{ type: string; name: string; error: string; code?: string }>;
        /** Aggregate result of materializing every published `seed` (absent when no seeds). */
        seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[]; landed?: SeedAppliedLandedParsed[] };
        /**
         * ADR-0086 P2 — aggregate result of publish-time materializers across the
         * batch (e.g. `flow`). Absent when no published item had a registered
         * materializer. `failures` names each item whose projection did NOT
         * land, so the caller surfaces it instead of reporting a clean publish
         * over an item that never went live.
         */
        materializeApplied?: {
            success: boolean;
            inserted: number;
            updated: number;
            failures: Array<{ type: string; name: string; error: string }>;
        };
        /**
         * ADR-0038 L3 — post-publish runtime probe report (absent when nothing
         * was publishable). One real read per published artifact: seeded
         * objects must have rows, views must be readable, dashboard widgets'
         * dataset selections must execute and return data. `issues` carries
         * BuildIssue-shaped findings (layer 'runtime') for the agent / chat
         * health surfaces; probes never fail the publish itself.
         */
        probes?: import('./build-probes.js').BuildProbeReport;
        /** ADR-0067 — id of the commit this publish recorded (absent if nothing published). */
        commitId?: string;
        /**
         * [#24253] What the requested `backfill` wrote, per field — present
         * only when the request named at least one field and the batch
         * published. See {@link applyPublishBackfill}.
         */
        backfillApplied?: PublishBackfillReceipt;
    }> {
        // [ADR-0131 D6] FIRST: an organization-scoped package publish is
        // refused. See {@link organizationScopedWriteRefusal}.
        ObjectStackProtocolImplementation.refuseOrganizationScopedWrite(
            `Package '${request.packageId}'`, request,
        );
        // [#24253] The request's own shape is judged before any server state
        // is read; what it names is judged against the drafts below.
        const backfillRequest = readPublishBackfillRequest(request.packageId, request.backfill, request.context);
        await this.ensureOverlayIndex();
        // Environment-wide drafts only: the environment repository lists the
        // environment's rows (a legacy organization's is left out off the
        // physical column), so a legacy organization-scoped draft
        // is never promoted here (it waits for the promotion ceremony,
        // ADR-0131 C7).
        const repo = this.getOverlayRepo();
        const drafts = await repo.listDrafts({ packageId: request.packageId });
        // [#24253] Before anything is promoted: a backfill entry that cannot be
        // honoured refuses the request whole, so a publish never lands with
        // half of what its caller asked for.
        const backfillPlan = backfillRequest.length > 0
            ? await this.planPublishBackfill(request.packageId, backfillRequest, drafts)
            : [];

        // Runtime enforcement of the package namespace-prefix rule (ADR-0028
        // current-state contract). `defineStack` enforces this at compile time,
        // but Studio-authored packages never take that path — so a bare,
        // collision-prone object name (`ticket` instead of `leave_ticket`)
        // could publish unchecked. Read the package's DECLARED namespace and
        // reject any object draft missing the `<ns>_` prefix BEFORE promoting
        // anything — the publish is atomic, so one bad name fails the whole
        // batch with an actionable message. Like `defineStack`, we do NOT
        // invent a prefix here when the package declares no namespace (legacy
        // packages are grandfathered); the default is derived+persisted once at
        // install time (`installPackage`), so real Studio packages always have
        // one by the time they publish.
        //
        // [#24547] The verdict is {@link objectNamespacePrefixViolation}'s, the
        // judge the direct save in {@link saveMetaItem} and the per-item
        // publish ({@link promoteDraftForPublish}) ask too, so the three doors
        // give one verdict and one sentence for one name in one package.
        /**
         * Every PRE-FLIGHT refusal of this batch, in one report.
         *
         * The namespace-prefix rule established the posture and the
         * ADR-0121 endpoint gates below join it: a violation is found BEFORE
         * anything is promoted, and it fails the WHOLE batch
         * (`publishedCount: 0`, `published: []`) rather than publishing the
         * healthy siblings around it. That is not a choice made here — it is
         * ADR-0067 D2's turn-atomicity ("a commit cannot half-land") read
         * backwards onto the pre-flight, and it is what `MetadataManager.
         * publishPackage` does with the same gates on the other path (#5189):
         * one `validationErrors` list, `itemsPublished: 0`.
         *
         * Both gates run before the report is returned, so an author fixing a
         * package sees the object-name violations AND the endpoint violations
         * in one round trip instead of one class per publish attempt.
         */
        const preflightViolations: Array<{
            type: string;
            name: string;
            error: string;
            code: PreflightViolationCode;
        }> = [];
        for (const d of drafts) {
            if (d.type !== 'object') continue;
            const err = this.objectNamespacePrefixViolation(d.name, request.packageId);
            if (err) {
                preflightViolations.push({
                    type: d.type,
                    name: d.name,
                    error: err,
                    code: 'NAMESPACE_PREFIX',
                });
            }
            // [ADR-0150 D6, child K] …and the namespace/object-name rule, the
            // save door's and the per-item publish's judge, so the batch is
            // refused before anything is promoted.
            const clash = this.objectNamespaceObjectNameClash(d.name, request.packageId);
            if (clash) {
                preflightViolations.push({
                    type: d.type,
                    name: d.name,
                    error: clash,
                    code: 'NAMESPACE_CONFLICT',
                });
            }
        }

        // ═══ [#8908] The AT-REST spelling gate ════════════════════════════════
        //
        // The second pre-flight rule, and the one route by which the namespace
        // #7894 retired could still mint ACTIVE rows. See
        // {@link isNonCanonicalStoredType} for the class and for why the
        // manifest-PRESENT plurals are deliberately NOT in it.
        //
        // Refused here, at the pre-flight, rather than by folding the stored
        // spelling at the promote — that alternative was weighed and ruled
        // against on #8908 (auto-adjudicated 2026-08-15, option (a)). Folding
        // would make these rows behave like `objects`: unpromotable, batch
        // aborted on `NO_DRAFT`, which is fail-closed but strands the operator
        // with a verdict that describes a missing draft rather than the residue
        // they actually have. The refusal below names the row, names the
        // canonical spelling, and says what to do about it — the shape the
        // namespace-prefix gate above already established, and batch-atomic for
        // the same ADR-0067 D2 reason.
        //
        // ⛔ What this deliberately does NOT do: migrate the row. A
        // `_migrate-stored` / boot-reconciliation conversion was the other
        // option on the card and is explicitly NOT ruled — it stays available as
        // a follow-up with its own appetite. Do not grow one here.
        //
        // ⚠️ The reason the message does not just say "run the stored
        // migration", and STILL does not: `migrateStoredMetadata` canonicalizes
        // BODIES, and rewriting a stored type spelling is an identity move, so
        // that door cannot fix this residue either. What changed under #8957 is
        // only what it SAYS about it. When this comment was written it scanned
        // with `PLURAL_TO_SINGULAR[rawType] ?? rawType` — the same manifest map
        // — so for exactly these spellings it converted bodies under the plural
        // key, found nothing to change, and reported the row `canonical`:
        // "nothing to do" about the row this gate had just refused, from the
        // door an operator naturally reaches for next. It now scans with the
        // canonical fold and reports the row `skipped`, carrying this same
        // reason. The two doors agree; neither migrates it, and the actionable
        // instruction is still the re-author path, stated in full.
        for (const d of drafts) {
            if (!isNonCanonicalStoredType(d.type)) continue;
            const canonical = canonicalMetaType(d.type);
            preflightViolations.push({
                type: d.type,
                name: d.name,
                error: `Draft '${d.type}/${d.name}' is stored under the non-canonical metadata type `
                    + `'${d.type}'; the canonical type for this item is '${canonical}'. Publishing it would `
                    + `mint an ACTIVE row in a second namespace that no registry read and no compliance `
                    + `query on '${canonical}' can see (the '/meta' URL door now folds a type to its canonical spelling before it writes; `
                    + `this row predates that). Re-author the item under '${canonical}' `
                    + `(PUT /meta/${canonical}/${d.name}) and drop the '${d.type}' row. Note that `
                    + `POST /meta/_migrate-stored does NOT rewrite a stored type spelling — it canonicalizes `
                    + `bodies, and reports rows of this class as 'skipped' with that same reason.`,
                code: 'STORED_TYPE_NOT_CANONICAL',
            });
        }

        // [#5488 — RETIRED GATE, recorded overturn of PR #5279]
        //
        // `gateApiDraftsForPublish` stood here (#5206 step 2, #5040 E7 /
        // ADR-0121) and ran the endpoint publish gates over this batch's `api`
        // drafts. It is deliberately REMOVED, two days after it landed, by the
        // maintainer ruling of 2026-08-07T16:59Z implemented in #5488 — not
        // deleted as dead weight and not lost in a refactor.
        //
        // Why it can go: the gate judged whether an `api` draft was fit to be
        // PROMOTED TO ACTIVE in `sys_metadata`. No such row is ever served. The
        // serving criterion belongs to `IMetadataService.matchEndpoint` →
        // `EndpointMatcher` → `MetadataManager.listForIndex('api')`, which
        // reads the manager's registry plus its filesystem/memory loaders;
        // `sys_metadata` is in neither, so a promoted endpoint 404s forever
        // (real boot, #5488 — no `EXCLUDED` line, because it was never in the
        // index to be excluded from). The gate was a correct verdict about a
        // state with no consumer.
        //
        // Why it MUST go rather than sit unreached: `api` is now code-only
        // (`allowRuntimeCreate: false` + `allowEnvironmentOverlay: false`), and the
        // #5086 inlet refuses the write BEFORE persistence and BEFORE the
        // draft/publish branch — it does not look at `mode`. So no `api` draft
        // row can be created any more, and this gate could never again see one.
        // Leaving it would leave unreachable code asserting a rule about a row
        // that cannot exist, which is the shape of a phantom check.
        //
        // What still judges endpoints, unchanged: `validateApiEndpointDeclarations`
        // / `identityFreeEndpointGateFailure` (`api/endpoint-publish-gate.ts`)
        // on the route that actually serves — the stack schema, `publishPackage`
        // (#5189), and again at load in `buildEndpointIndex` (PR #5203). ADR-0121
        // keeps its "publish REJECTS" ruling in full on that route; only the
        // runtime-authored-draft door it used to also cover is gone, because
        // that door opened onto nothing.
        //
        // Re-entry, as the ruling recorded it: if #2657 Part B promotes `apis`
        // to a registered type WITH A REAL CONSUMPTION PATH, this gate comes
        // back with it — implementation first, declaration second.

        if (preflightViolations.length > 0) {
            // ═══ [#8595] The PRE-FLIGHT refusal's own audit rows ═══════════════
            //
            // Without these, this `return` left `sys_metadata_audit` completely
            // empty: a package refused for a bad object name was indistinguish-
            // able in the trail from a package nobody ever pressed Publish on —
            // the #7748 defect, at the one refusal site neither #8400 nor #8594
            // could reach. Both of those write from BELOW: #8400's rows are
            // driven off the post-commit state and its `batch_aborted` row from
            // the transaction's `catch`, and #8594's inner verdicts ride out on
            // an error thrown inside the promotion loop. This `return` is ABOVE
            // `engine.transaction()`, so no error is ever thrown and no
            // promotion is ever attempted — control never reaches either site.
            //
            // ── Shape: ONE ROW PER VIOLATION, keyed on its own (type, name) ───
            //
            // Not one row for the batch. A pre-flight refusal is not "one causal
            // item aborted the batch" — it is N violations, each naming a
            // different draft, so there is no single causal item to key a batch
            // row on. `batch_aborted`'s own note records why that matters: the
            // audit row is keyed on `(type, name)`, and minting an identity for
            // an unattributable failure "would put a fictional item in a
            // compliance ledger" — which is exactly what a single batch-level
            // row would need here. Every violation, by contrast, already HAS an
            // honest identity: the draft that broke the rule.
            //
            // Measured against the reader rather than assumed: `auditMetaItem`
            // (the door `GET /api/v1/meta/:type/:name/audit` serves Studio's
            // audit-log tab from) queries `where { type, name }` ordered by
            // `occurred_at desc`. One row per violation is therefore readable
            // per item; a synthetic batch row would be readable under no real
            // item at all.
            //
            // ── Durability ────────────────────────────────────────────────────
            //
            // Written outside any transaction because there is not one here yet
            // — the pre-flight is the code above `engine.transaction()`. So
            // unlike every other denial on this route there is nothing to
            // survive: the row lands when it is written. `publishPackageDrafts`
            // audits its refusals from a position a rollback cannot reach at
            // every site, and this one gets it by construction.
            for (const v of preflightViolations) {
                await this.recordMetadataAudit({
                    // [#8908] THE BOUNDARY FOLD, on the route that reads rows at
                    // rest. `v.type` is the STORED spelling, which for a
                    // `STORED_TYPE_NOT_CANONICAL` violation is by definition not
                    // the canonical one — and `recordMetadataAudit` now refuses a
                    // non-canonical `type` outright rather than folding it
                    // silently (see its header). Folding here is not merely what
                    // makes the writer's assert satisfiable: it is what makes the
                    // row READABLE. `auditMetaItem` serves
                    // `GET /meta/:type/:name/audit`, whose own `:type` segment is
                    // folded at the `/meta` boundary, so a row filed under the
                    // plural spelling is a row no operator can query for. The
                    // stored spelling is not lost — it is named in `note` and in
                    // `failed[].error`, where it is the actionable fact.
                    type: canonicalMetaType(v.type),
                    name: v.name,
                    organizationId: null,
                    operation: 'publish',
                    outcome: 'denied',
                    // The violation's own verdict, in the audit column's
                    // lowercase vocabulary — the value a compliance query
                    // filters on. See `PREFLIGHT_AUDIT_CODE` for why this one
                    // carries the specific rule while `batch_aborted` carries a
                    // fixed value.
                    code: PREFLIGHT_AUDIT_CODE[v.code],
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: 'protocol.publishPackageDrafts',
                    // `note` is WIRE-VISIBLE (`auditMetaItem` maps it straight
                    // onto the `/audit` response). Safe here: this text is
                    // `validateObjectNamespacePrefix`'s own authored, actionable
                    // message — no driver dialect to withhold, unlike the
                    // `batch_aborted` note's `clientFacingFailureText`.
                    note: `refused before publish — package '${request.packageId}': ${v.error}`,
                });
            }
            return {
                success: false,
                // [#10462] Guarded by `preflightViolations.length > 0`, so
                // `failed[]` is non-empty by construction — this exit is
                // always a refusal.
                outcome: 'refused',
                publishedCount: 0,
                failedCount: preflightViolations.length,
                published: [],
                // Projected explicitly: `organizationId` is internal bookkeeping
                // for the audit rows above and must not widen this response.
                failed: preflightViolations.map((v) => ({
                    type: v.type, name: v.name, error: v.error, code: v.code,
                })),
            };
        }

        const published: Array<{ type: string; name: string; version: string; advisories?: RuntimeAuthoringIssue[] }> = [];
        const failed: Array<{ type: string; name: string; error: string; code?: string; issues?: Array<{ path: string; message: string; code?: string }> }> = [];

        // Structure first, seeds LAST — a seed's rows can only land after its
        // object's table exists (publishMetaItem creates it). Within the seeds we
        // batch-apply every body in ONE loader pass below (multi-pass reference
        // resolution across the whole set), so per-item apply is suppressed.
        const ordered = [
            ...drafts.filter((d) => d.type !== 'seed'),
            ...drafts.filter((d) => d.type === 'seed'),
        ];
        const seedBodies: unknown[] = [];

        // [#10377] The closure this batch is judged against, read ONCE and
        // BEFORE any promotion (a promote deletes the draft row it reads).
        // Every member of the batch is then gated against the same complete
        // set, which is what makes a dashboard-plus-its-dataset package
        // publishable in either order — see
        // {@link collectBatchPendingDeclarations}.
        const pendingDeclarations = await this.collectBatchPendingDeclarations(drafts);
        const batchDatasources: ReadonlySet<string> = new Set(
            drafts.filter((d) => canonicalMetaType(d.type) === 'datasource').map((d) => d.name),
        );
        const batchObjects: ReadonlySet<string> = new Set(
            drafts.filter((d) => canonicalMetaType(d.type) === 'object').map((d) => d.name),
        );

        // ADR-0067 — capture each artifact's PRE-publish state so this turn can
        // be recorded as ONE revertible commit. existedBefore=false → the commit
        // creates it (revert = soft-remove); true → it edits an existing artifact
        // (revert = restoreVersion(prevVersion)).
        //
        // [#8896] This paragraph used to end "Best-effort: a capture failure
        // just omits that item from the revert plan, never blocks the publish."
        // Both halves were wrong, and they were wrong in different directions —
        // the comment described the code inaccurately, AND the behaviour it
        // described would not have been correct either:
        //
        //   * The code never omitted. It pushed a FABRICATED entry —
        //     `existedBefore: false, prevVersion: null` — i.e. the literal
        //     opposite of the healthy branch's `existedBefore: !!activeRow` for
        //     any artifact that did exist. `existedBefore: false` means "revert
        //     = soft-remove", so reverting this commit DELETES an artifact
        //     whose previous version was supposed to be restored. A read that
        //     failed was answered with a value, and the value chosen was the
        //     destructive one.
        //   * Omitting would not have been the fix. An item missing from the
        //     plan is simply not reverted, so the revert silently leaves the
        //     newly published version live while reporting the turn undone.
        //
        // Both are the same defect underneath: a revert plan derived from a
        // read that did not happen. So the capture is discriminated by error
        // TYPE instead, per the maintainer's ruling for this family —
        // unprovisioned is truthful emptiness, everything else surfaces. See
        // the `catch` below for why the benign branch keeps exactly the push
        // that was wrong unconditionally.
        const commitItems: CommitPlanItem[] = [];
        for (const d of ordered) {
            try {
                // Read the pre-publish active row in the draft's scope, the
                // environment's (ADR-0131 D6), so an env-wide edit is not
                // mis-recorded as a create in the revert plan (#3115).
                // [#21911] The explicit system opt-in — see findServedOverlayRow.
                // [#22877] …and the draft's own bundle member: another
                // member's active row is not this member's pre-publish state,
                // and the revert plan records the member it describes.
                // [#29414] …and the publishing package's own row: every draft
                // listed here is bound to `request.packageId` and is promoted
                // into that package's row, so another package's active row of
                // the same name (a row bound to the read-only base beside its
                // `.custom` pair) is not this item's pre-publish state. Read
                // package-agnostically, the pair's first publish was recorded
                // as an edit of the base row's version, and its revert
                // addressed the base row instead of removing the pair's.
                const activeRow = (await this.findEnvironmentRow('sys_metadata', {
                    where: {
                        type: d.type, name: d.name, state: 'active', package_id: request.packageId,
                        ...overlayMemberWhere(d.type, d.member),
                    },
                    context: { isSystem: true },
                })) as { version?: number } | null;
                commitItems.push({
                    type: d.type,
                    name: d.name,
                    existedBefore: !!activeRow,
                    prevVersion: activeRow && typeof activeRow.version === 'number' ? activeRow.version : null,
                    ...(d.member !== undefined ? { member: d.member } : {}),
                });
            } catch (error) {
                // [#8896] Benign: `sys_metadata` has not been provisioned yet.
                // There is then genuinely no active row for anything, so
                // `existedBefore: false, prevVersion: null` IS this artifact's
                // pre-publish state and the revert plan it produces (revert =
                // soft-remove) is correct. That is the ONE case in which the
                // unconditional push above was ever right, and it is kept
                // byte-for-byte. Asked through the shared `isMissingTableError`
                // predicate (`@objectstack/metadata/errors`, #4825).
                //
                // Everything else — a connection drop, a timeout, a query
                // error — means an active row may well exist and simply was not
                // seen, so no honest `existedBefore` can be computed. It
                // propagates, and the position of this loop is what makes that
                // safe: the capture pass runs BEFORE Phase 1's transaction, so
                // nothing has been written yet and the publish fails having
                // changed nothing. Refusing to publish beats publishing with a
                // revert plan that would delete an artifact on the way back.
                //
                // No new error code and no new response field: the caller
                // receives the read's own failure, envelope intact.
                if (!isMissingTableError(error, 'sys_metadata')) throw error;
                commitItems.push({
                    type: d.type, name: d.name, existedBefore: false, prevVersion: null,
                    ...(d.member !== undefined ? { member: d.member } : {}),
                });
            }
        }
        const publishedSeqs: number[] = [];
        // ADR-0086 P2 — accumulate each item's publish-time materialization so a
        // batch package publish surfaces a permission set that failed to go live
        // (owned by the env door / another package), not just a clean count.
        const materialize = { any: false, inserted: 0, updated: 0, failures: [] as Array<{ type: string; name: string; error: string }> };

        // ═══ Phase 1 — ATOMIC metadata writes (ADR-0067 D2) ═══
        // Every draft promotion AND the sys_metadata_commit record run inside
        // ONE engine transaction: any failure rolls ALL of them back — "a
        // commit cannot half-land". Nested repository writes JOIN this
        // transaction via the engine's ambient-tx join (a nested begin would
        // deadlock single-connection pools), and side effects are deliberately
        // deferred to Phase 2: DDL cannot run inside the driver transaction,
        // in-memory registry mutations cannot roll back, and projections /
        // probes are healed by boot reconciliation — side effects can
        // self-heal, a half-landed metadata batch cannot (the ADR-0094
        // lesson).
        //
        // [#32396] …and on a runtime that CANNOT roll back, the same promise
        // is kept without the transaction. `engine.transaction()` exists on
        // every real engine, but ObjectQL runs its callback with no
        // transaction and no rollback when the default driver declares none
        // (the ADR-0119 D1 degrade — the remote Turso transport is one), and
        // an engine with no `transaction()` at all runs the loop bare. The
        // probe this door used, `typeof engine.transaction === 'function'`,
        // answered "atomic" for both, so a draft refused at item 9 of 11 left
        // items 1-8 live under a response that said nothing landed. Asked
        // with `engineCanRollBack` instead — the predicate `batchData`'s
        // atomic gate and `/discovery`'s `transactionalBatch` already share,
        // which reads the driver's declaration as well — and where it answers
        // no:
        //
        //   1. Phase 0 judges EVERY draft before any is promoted
        //      (`promoteDraftForPublish` with `judgeOnly`), so a refusal — the
        //      class the reported publish hit — refuses the batch with nothing
        //      written. Phase 1 still judges each draft again as it promotes
        //      it, against the store as the earlier promotions left it, so it
        //      refuses everything it refused before.
        //   2. A failure Phase 0 could not see (a refusal that only the
        //      earlier promotions provoke, a draft saved in between, a store
        //      fault) undoes every promotion already made, newest first, before
        //      the refusal is answered: see {@link undoLandedPromotions}.
        const canRollBack = engineCanRollBack(this.engine);
        type PromotedDraft = LandedPromotion & {
            body: unknown;
            seq: number;
            /**
             * [#9343] The #4463 gate's advisory half for this promotion,
             * captured from `promoteDraftForPublish`'s return inside Phase 1
             * so Phase 2 can attach it to this draft's `published[]` element.
             * Empty = the gate raised nothing (or did not run) — the element
             * then carries no `advisories` key at all.
             */
            advisories: RuntimeAuthoringIssue[];
        };
        const promoted: PromotedDraft[] = [];
        // [#32369] The promoted objects as the registry registers them, and the
        // order the unit admits them in (assigned inside the transaction).
        let promotedObjects: BatchObjectRow[] = [];
        let admittedOrder: readonly number[] = [];
        // (assigned inside the transaction closure — keep the wide type)
        let commit = null as { commitId: string } | null;
        // ADR-0119 D1 — `transaction` is contract-declared, so this reaches it
        // by name instead of through a structural cast. Bound once up front:
        // the probe and the call must agree on one resolved function.
        const engineTx = typeof this.engine?.transaction === 'function'
            ? this.engine.transaction.bind(this.engine)
            : undefined;
        const inTxn: <T>(cb: () => Promise<T>) => Promise<T> =
            engineTx ? (cb) => engineTx(() => cb()) : (cb) => cb();
        /** The promotion request for one draft: Phase 0 judges it, Phase 1 writes it. */
        const promotionRequest = (d: (typeof ordered)[number]) => ({
            registryQuestion: PROMOTION_REGISTRY_QUESTION['package-publish'],
            // [#8908] The stored spelling, FOLDED — this route's
            // boundary, the analogue of `canonicalizeMetaRequestType`
            // on the six `/meta` entry points. Every row that
            // reaches here has passed the at-rest spelling gate
            // above, so the only non-canonical spellings left are
            // the manifest-PRESENT plurals, for which this fold and
            // the manifest fold `promoteDraftForPublish` already
            // applies agree exactly — the promote resolves the same
            // row it always did, and `d.type` (unfolded) still
            // populates `failed[]` / `published[]`, which are wire
            // shapes reporting what the operator actually stored.
            //
            // What it changes for those rows is the two things
            // downstream of `request.type` that had NOT folded:
            // `getEffectiveLock`'s overlay limb (queried the plural,
            // found no row, answered `'none'` — "the author declared
            // no protection" — for an item whose canonical row may
            // carry `_lock`; the single-item twin of that hole is
            // #8769 group C), and the `type` on the pending audit
            // rows those two gates hand back, which the writer now
            // refuses if it is not canonical.
            type: canonicalMetaType(d.type),
            name: d.name,
            // [#8907] Promote each draft under the PACKAGE
            // `listDrafts` surfaced it from: ADR-0048 keys
            // overlay rows by `(org, type, name, package_id)`,
            // so with two packages holding drafts for one
            // `(type, name)` a promote that omits the package
            // dimension cannot tell them apart — publishing A
            // promoted and drained B's row, left A's own edit
            // pending, and still answered `success: true`.
            // `d.packageId` is the row's own binding, so this
            // is the listed key restated, never a new one.
            packageId: d.packageId,
            // [#22877] …and as the bundle member `listDrafts`
            // surfaced it as: two members' drafts of one name
            // are two drafts, and promoting the canonical one
            // for each promoted it twice (`NO_DRAFT` the
            // second time, aborting the batch) and left the
            // other member's draft pending.
            ...memberOption(d.member),
            // [#10377] The whole batch's own declarations, so
            // this member is judged against the package it is
            // being published AS PART OF and not against the
            // universe as it stood before the publish started.
            ...(pendingDeclarations !== undefined
                ? { pending: pendingDeclarations } : {}),
            // [#26724] …and the datasources it drafts, which
            // an object draft beside them may name.
            batchDatasources,
            // [#28990] …and the objects it drafts, which a
            // permission-set draft beside them may grant on.
            batchObjects,
            ...(request.actor ? { actor: request.actor } : {}),
            // [ADR-0146 D1] The author's change note, when the
            // publish carries one, is what every history row
            // this batch writes records as its `change_note`
            // (the same note the package commit below keeps),
            // so the item history says why the item changed.
            // With none, the sentence naming the package.
            message: request.message
                ? request.message
                : `publish app package '${request.packageId}'`,
        });
        /** Tag the causal item on the error that aborts the batch (the `catch` below reads it). */
        const tagCausal = (e: unknown, d: Pick<(typeof ordered)[number], 'type' | 'name' | 'member'>): Error => {
            const err = e instanceof Error ? e : new Error(String(e));
            (err as { __batchItem?: unknown }).__batchItem = d;
            return err;
        };
        try {
            // ═══ [#32396] Phase 0 — judge the whole batch, write nothing ═══
            if (!canRollBack) {
                const judgedObjects: BatchObjectRow[] = [];
                const judgedDrafts: Array<(typeof ordered)[number]> = [];
                for (const d of ordered) {
                    try {
                        const { singularType, judged } = await this.promoteDraftForPublish({ ...promotionRequest(d), judgeOnly: true });
                        if (judged && isBatchObjectType(singularType)) {
                            judgedObjects.push({ type: singularType, name: d.name, body: judged.body, packageId: judged.packageId });
                            judgedDrafts.push(d);
                        }
                    } catch (e: unknown) {
                        throw tagCausal(e, d);
                    }
                }
                // [#32369, ADR-0144 D2 and D6] …and the drafts' objects as ONE
                // unit, the question Phase 1 asks once every draft is promoted
                // (below): asked here too, so a pair the registry refuses
                // refuses the batch with nothing promoted, rather than after
                // every promotion and an undo of each.
                const [firstRefused] = judgeBatchObjectRegistrations(this, judgedObjects).refused;
                if (firstRefused) throw tagCausal(firstRefused[1], judgedDrafts[firstRefused[0]]!);
            }
            await inTxn(async () => {
                for (const d of ordered) {
                    try {
                        if (d.type === 'seed') {
                            // Capture the body BEFORE promote (the draft row is
                            // deleted by the promote, and reading the draft is
                            // unambiguous).
                            const ref = { type: d.type, name: d.name, org: 'env' } as unknown as Parameters<typeof repo.get>[0];
                            const draft = await repo.get(ref, { state: 'draft', ...memberOption(d.member) });
                            if (draft?.body) seedBodies.push(draft.body);
                        }
                        const { singularType, advisories, result, promotedDraft } = await this.promoteDraftForPublish(promotionRequest(d));
                        // [#32396] This call states no `judgeOnly`, so the promotion was written.
                        if (!result) throw unwrittenPromotionError(d.type, d.name);
                        promoted.push({
                            d, singularType,
                            body: result.item.body,
                            packageId: result.packageId,
                            version: result.version,
                            seq: result.seq,
                            advisories,
                            ...(promotedDraft ? { promotedDraft } : {}),
                        });
                        if (typeof result.seq === 'number') publishedSeqs.push(result.seq);
                    } catch (e: unknown) {
                        // Tag the causal item and abort — the surrounding
                        // transaction rolls back every promotion made so far,
                        // or, on a runtime that cannot roll back, the `catch`
                        // below undoes them.
                        throw tagCausal(e, d);
                    }
                }
                // [#32369, ADR-0144 D2 and D6] The promoted objects as ONE unit,
                // now that every draft is promoted: each promotion asked the
                // registry about its body alone (`'package-publish'` is
                // `'body-only'`, so a later draft can complete a pair, #29673),
                // and nothing asked the pair once the package was whole. A row
                // the registry refuses — at registration (D6's roll-up door) or
                // against the unit (the follow door) — refuses the batch with
                // that row as its cause, before the commit is recorded: the
                // transaction rolls the promotions back, and the refusal is
                // answered in `failed[]`. A runtime that cannot roll back asked
                // the same question in Phase 0, before any promotion; asked
                // again here, as Phase 1 judges each draft again, a refusal
                // only the promoted bodies provoke is undone by the `catch`
                // below.
                promotedObjects = promoted.map((p) => ({
                    type: p.singularType, name: p.d.name, body: p.body, packageId: p.packageId,
                }));
                const unitVerdict = judgeBatchObjectRegistrations(this, promotedObjects);
                const [firstRefused] = unitVerdict.refused;
                if (firstRefused) throw tagCausal(firstRefused[1], promoted[firstRefused[0]]!.d);
                admittedOrder = unitVerdict.order;
                // ADR-0067 — record this turn as ONE commit, INSIDE the same
                // transaction as the promotions it describes: the commit row and
                // the published state land or roll back together, so a recorded
                // commit can never describe a partial publish.
                if (promoted.length > 0) {
                    // [#22877] Keyed by member too: two members of one name
                    // are two plan items.
                    const promotedKeys = new Set(promoted.map((p) => commitPlanKey(p.d)));
                    commit = await this.recordPackageCommit({
                        packageId: request.packageId,
                        operation: 'apply',
                        ...(request.message ? { message: request.message } : {}),
                        ...(request.actor ? { actor: request.actor } : {}),
                        ...(request.aiModel ? { aiModel: request.aiModel } : {}),
                        items: commitItems.filter((it) => promotedKeys.has(commitPlanKey(it))),
                        ...(publishedSeqs.length
                            ? { eventSeqStart: Math.min(...publishedSeqs), eventSeqEnd: Math.max(...publishedSeqs) }
                            : {}),
                    });
                }
            });
        } catch (e: any) {
            // The batch rolled back — NOTHING landed (ADR-0067 D2). Report the
            // causal item with its real error; every other draft is marked
            // BATCH_ABORTED so the caller sees the all-or-nothing semantics
            // instead of inferring them from publishedCount 0.
            const causal = e?.__batchItem as
                { type: string; name: string; organizationId?: string | null; member?: string } | undefined;
            // [#32396] On a runtime that cannot roll back, "nothing landed" is
            // made true here rather than assumed: every promotion Phase 1 made
            // before the failure is undone, newest first, before anything below
            // reports the refusal. With a rollback the engine has already undone
            // them, and `promoted[]` describes writes that no longer exist.
            const stillLive = !canRollBack && promoted.length > 0
                ? await undoLandedPromotions(this, {
                    repo,
                    landed: promoted,
                    plan: commitItems,
                    packageId: request.packageId,
                    ...(request.actor ? { actor: request.actor } : {}),
                })
                : [];
            const stillLiveKeys = new Set(stillLive.map((s) => commitPlanKey(s.item.d)));
            const undone = !canRollBack && promoted.length > 0;
            if (stillLive.length > 0) {
                // AGENTS.md "Degradation log levels": the refusal below reads as
                // a clean all-or-nothing answer while these items ARE live.
                console.error(
                    `[protocol.publishPackageDrafts] batch publish of '${request.packageId}' was refused at `
                    + `${causal ? `${causal.type}/${causal.name}` : 'an unidentified item'}, and this runtime cannot roll back `
                    + `a transaction, so the ${promoted.length} promotion(s) made before the refusal were undone by hand — `
                    + `but ${stillLive.length} could not be: ${stillLive.map((s) => `${s.item.d.type}/${s.item.d.name}`).join(', ')} `
                    + `ARE LIVE although the publish reports the batch refused, and nothing retries the undo. Fix: resolve the `
                    + `cause below, then either correct the refused item and publish the package again, or remove or revert `
                    + `each live item named here. Cause: ${stillLive.map((s) => clientFacingFailureText(s.error, String((s.error as { message?: unknown })?.message ?? s.error))).join(' | ')}`,
                );
            }
            // [#8333 · P6] `failed[].error` is RESPONSE DATA, not a message, so
            // no HTTP boundary's withhold reaches it. Measured on `origin/main`
            // by failing the `sys_metadata` write under the promote: the batch
            // answered `failed[0].error = "SQLITE_ERROR: no such table:
            // sys_metadata"`.
            //
            // ⚠️ This is the site the card warned about, and the measurement is
            // why it could be converted rather than escalated. Its authored
            // population — the one #4277 exists for — is `assertRuntimeAuthoringRules`'
            // author-time rejection, and it DECLARES `422 INVALID_METADATA`
            // with structured `issues`. Reproduced end to end with a real
            // broken-CEL approval flow: after this change the caller still
            // receives `flows[0].nodes[1].config.approvers[0].value:
            // [approval-expression-invalid] …`, plus `code` and `issues`. Every
            // other refusal reaching here declares 4xx too (`NOT_OVERRIDABLE`
            // 403, `METADATA_CONFLICT` 409, the repository's 403/404/409/422).
            // So the rule withholds the driver text and nothing else.
            //
            // [#8441] `code` was left as it was by #8333 — a different field
            // with a different rule (a closed union) — and measured afterwards
            // it still carried the driver's own dialect: `SQLITE_ERROR` beside
            // the withheld sentence. It is now filtered by CATALOG MEMBERSHIP,
            // not by the 4xx question, so `INVALID_METADATA` / `NOT_OVERRIDABLE`
            // and every other declared code reach the caller untouched. See
            // {@link clientFacingFailureCode}. `issues` stays as it was: it is
            // structured authoring feedback, which no driver error carries.
            console.warn(
                `[protocol.publishPackageDrafts] batch publish of '${request.packageId}' rolled back at `
                + `${causal ? `${causal.type}/${causal.name}` : 'an unidentified item'}: ${e?.message ?? e}`,
            );
            // One error drives the whole map — the batch is all-or-nothing — so
            // the filter runs once rather than per row.
            const causalCode = clientFacingFailureCode(e);
            // ═══ [#8400] The refusal audit — OUTSIDE the transaction ═══
            //
            // This is the row whose PLACEMENT is the whole point of the card.
            // `engine.transaction()` has already unwound by the time control
            // reaches this `catch`, so the insert below lands in no transaction
            // and survives the rollback that provoked it. Written INSIDE the
            // Phase-1 closure it would roll back with the batch, and the trail
            // would once again record nothing at all about a refused publish —
            // the exact defect #7748 exists to close, reintroduced on the batch
            // route.
            //
            // ⚠️ [#8594 — the sibling above is now FIXED, one line below.] The
            // note that stood here said the inner denial rows were written from
            // inside this transaction and rolled back with it, so this row could
            // be unconditional: there was never anything of theirs to duplicate.
            // That is no longer true — `promoteDraftForPublish` hands its refusal
            // row out instead of writing it, and the line below lands it here,
            // outside the transaction, in the INNER verdict's own vocabulary
            // (`item_locked` / `metadata_conflict`, with its `lock_state`).
            //
            // The row below stays unconditional anyway, for a different reason:
            // it records a DIFFERENT fact. `item_locked` says why THIS item was
            // refused; `batch_aborted` says the whole batch rolled back and
            // nothing landed — the ADR-0067 D2 consequence, which is what the
            // other drafts' authors need to read, and the only row there is when
            // the cause carries no inner verdict at all (a driver fault,
            // `NOT_OVERRIDABLE`, `INVALID_METADATA`). Two facts, two rows, same
            // causal item.
            //
            // ⚠️ `note` is WIRE-VISIBLE — `auditMetaItem` maps it straight onto
            // the `GET /api/v1/meta/:type/:name/audit` response — so it carries
            // {@link clientFacingFailureText}, not `e.message`. Putting the raw
            // sentence here would route the driver dialect #8333 withheld from
            // `failed[].error` around that rule through a second door. The full
            // untruncated text is already in the `console.warn` above, which is
            // where an operator reads it.
            // ═══ [#8594] The INNER verdict's own row — also outside the txn ═══
            //
            // `promoteDraftForPublish` refused this batch and handed its denial
            // row out on the error rather than writing it inside the closure
            // that has since unwound. Recording it here gives a package publish
            // refused by a lock the same `code = 'item_locked'` + `lock_state`
            // row a single-item publish has always left — the vocabulary a
            // compliance query actually filters on, which `batch_aborted` alone
            // could not supply. No-op when the cause carries no inner verdict.
            //
            // `source` is re-stamped: the shared Phase-1 helper passes
            // `protocol.publishMetaItem` for both of its routes, and this row
            // was written by the batch route.
            await this.recordPendingDenialAudit(e, { source: 'protocol.publishPackageDrafts' });
            if (causal) {
                await this.recordMetadataAudit({
                    // [#8908] Folded for the same two reasons as the pre-flight
                    // rows above — readability through `auditMetaItem`, and the
                    // writer's assert. `causal` is the draft row itself
                    // (`__batchItem`), so its `type` is the STORED spelling.
                    type: canonicalMetaType(causal.type),
                    name: causal.name,
                    organizationId: null,
                    operation: 'publish',
                    outcome: 'denied',
                    // adr0112-ok: D6b — persisted audit column, its own
                    // vocabulary. ONE fixed value for this site rather than the
                    // lower-cased causal code: the causal code is whatever the
                    // catalog can produce, and lower-casing it would turn this
                    // column's documented closed set into an open one that
                    // drifts with every new error code. The cause is in `note`.
                    code: 'batch_aborted',
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: 'protocol.publishPackageDrafts',
                    // [#32396] "nothing landed" only while it is true: an undo
                    // that left items live says which instead.
                    note: `batch publish of package '${request.packageId}' rolled back (ADR-0067 D2); `
                        + (stillLive.length > 0
                            ? `${stillLive.length} promotion(s) could not be undone and are live `
                                + `(${stillLive.map((s) => `${s.item.d.type}/${s.item.d.name}`).join(', ')})`
                            : 'nothing landed')
                        + `${causalCode ? ` [${causalCode}]` : ''}: `
                        + clientFacingFailureText(e, 'publish failed'),
                });
            }
            // No row when the causal item is unidentifiable (a failure in the
            // transaction machinery itself rather than in any one promotion):
            // the audit row is keyed on `(type, name)`, and minting an identity
            // for a failure nobody can attribute would put a fictional item in
            // a compliance ledger. `console.warn` above stays the record there.
            // [#32396] How the batch came to have landed nothing — said as it
            // happened: the engine's rollback, the undo of the promotions this
            // runtime could not roll back, or a refusal before any promotion.
            const howNothingLanded = canRollBack
                ? 'the transaction rolled back'
                : undone
                    ? 'every draft promoted before it was put back as a pending draft'
                    : 'nothing was promoted';
            const causalName = causal ? `${causal.type}/${causal.name}` : 'another item';
            const failedOut = ordered.map((d) =>
                causal && commitPlanKey(d) === commitPlanKey(causal)
                    ? {
                        type: d.type, name: d.name,
                        error: clientFacingFailureText(e, 'publish failed'),
                        ...(causalCode ? { code: causalCode } : {}),
                        // Carry structured spec-validation issues so the publish
                        // surface can point at the offending field.
                        ...(Array.isArray(e?.issues) ? { issues: e.issues } : {}),
                    }
                    : stillLiveKeys.has(commitPlanKey(d))
                        // [#32396] Not `BATCH_ABORTED`: that code says "not
                        // published", and this item is live.
                        ? {
                            type: d.type, name: d.name,
                            error: `LIVE although the batch was refused — it was promoted before ${causalName} failed, `
                                + `and this runtime cannot roll back, so it was put back by hand and that failed; `
                                + 'remove or revert it, or publish the package again once the refused item is corrected',
                        }
                        : {
                            type: d.type, name: d.name,
                            error: `not published — the batch is all-or-nothing (ADR-0067 D2) and `
                                + `${causalName} failed; ${howNothingLanded}`,
                            code: 'BATCH_ABORTED',
                        });
            return {
                success: false,
                // [#10462] `failedOut` mirrors `ordered` one-to-one, so it is
                // empty ONLY when the batch had zero drafts — a failure in the
                // transaction machinery itself over nothing pending. Deriving
                // the outcome (rather than hard-coding 'refused') keeps the
                // producer invariant `outcome === 'refused' iff
                // failed.length > 0` true on every return site; on that edge
                // "nothing to publish" stays the truthful answer (nothing was
                // pending, nothing was refused) and the `console.warn` above
                // remains the record of the machinery failure.
                outcome: failedOut.length > 0 ? 'refused' : 'nothing_to_publish',
                publishedCount: 0,
                failedCount: failedOut.length,
                published: [],
                failed: failedOut,
            };
        }

        // ═══ Phase 2 — side effects, after the metadata committed ═══
        // Registry refresh, DDL, materializers, projections, events — per item
        // in publish order. Best-effort at the batch level: the metadata IS
        // live at this point, so a side-effect failure must be surfaced (via
        // materialize.failures / probes), never turned into a fake unpublish.

        // ─── [#8400] ADR-0010 — one `publish`/`allowed` row per promoted item ──
        //
        // Studio's "publish whole app" wrote NO audit rows at all: this route
        // calls `promoteDraftForPublish` directly, so #7748's row in
        // `publishMetaItem` never ran for it, and the trail showed a batch
        // publish of twenty artifacts as nothing whatsoever.
        //
        // PLACEMENT — Phase 2, driven off `promoted[]`, and deliberately not
        // inside the Phase-1 closure. An audit row written in there rolls back
        // with the batch; for an allowed publish that is arguably right, but the
        // same placement applied to the refusal (see the `catch` above) is
        // exactly wrong, and one route must not audit its two outcomes under two
        // different durability rules. Driving both off the post-commit state
        // gives the row the same meaning at both sites: it exists iff the
        // decision is durable. This also matches the position `saveMetaItem`,
        // `deleteMetaItem` and `publishMetaItem` all take — persistence
        // committed, side effects not yet run.
        //
        // Before the side-effect loop rather than interleaved with it: every
        // promoted item's metadata is already live, so its row must not depend
        // on whether a later item's DDL happened to throw.
        for (const p of promoted) {
            await this.recordMetadataAudit({
                // [#8908] Folded — the third and last site on this route that
                // builds an audit row out of a stored `type`. Deliberately
                // `canonicalMetaType(p.d.type)` and not `p.singularType`: the
                // latter is the MANIFEST fold, which is a no-op for exactly the
                // spellings this card is about, so it would have looked like a
                // canonicalization while changing nothing (measured and closed on
                // #8858 as a provable no-op).
                type: canonicalMetaType(p.d.type),
                name: p.d.name,
                organizationId: null,
                operation: 'publish',
                outcome: 'allowed',
                code: 'ok',
                ...(request.actor ? { actor: request.actor } : {}),
                source: 'protocol.publishPackageDrafts',
                note: `active — package '${request.packageId}'`
                    + (commit ? `, commit ${commit.commitId}` : ''),
            });
        }

        // [#32369] The promoted objects registered in the order the unit admits
        // them, before the per-item side effects below register each again in
        // publish order: a draft whose pair a later draft completes is then
        // registered after its sibling, not refused (and only logged) at its
        // own write-through ahead of it.
        await registerAdmittedBatchRows(this, promotedObjects, admittedOrder);
        for (const p of promoted) {
            // [#9343] Omitted-when-empty, never `advisories: []` — the #4717
            // discipline every advisory-carrying door follows: an advisory-free
            // element's bytes are unchanged, and absence means "nothing to
            // report", never "the gate did not run".
            const element: (typeof published)[number] = {
                // [#21207] Each element's version token is keyed, like the
                // single-item doors' (`receiptVersion`); `p.version` stays the
                // stored hash for everything internal.
                type: p.d.type, name: p.d.name, version: await this.receiptVersion(p.version),
                ...(p.advisories.length > 0 ? { advisories: [...p.advisories] } : {}),
            };
            published.push(element);
            try {
                const eff = await this.runPublishSideEffects({
                    singularType: p.singularType,
                    name: p.d.name,
                    body: p.body,
                    packageId: p.packageId,
                    ...(request.actor ? { actor: request.actor } : {}),
                    skipSeedApply: true,
                });
                // [#30693] A refused object-storage sync rides THIS element's
                // `advisories`, the same `object-storage-sync-refused` warning
                // `publishMetaItem` and a publish-mode save answer (#30635).
                // The metadata is live and the element stays published; before
                // this, only the server log said the table was not created or
                // altered. Appended after the gate's findings, still
                // omitted-when-empty: a clean sync adds no key.
                if (eff.storageRefused) {
                    element.advisories = [...(element.advisories ?? []), eff.storageRefused];
                }
                if (eff.materializeApplied) {
                    materialize.any = true;
                    materialize.inserted += eff.materializeApplied.inserted;
                    materialize.updated += eff.materializeApplied.updated;
                    if (!eff.materializeApplied.success) {
                        materialize.failures.push({
                            type: p.d.type, name: p.d.name,
                            error: eff.materializeApplied.error ?? 'materialize failed',
                        });
                    }
                }
            } catch (e: any) {
                // Boot reconciliation heals registry/DDL/projection drift; the
                // published metadata is authoritative. Surface, don't lie.
                console.warn(
                    `[Protocol] publish side effects failed for ${p.d.type}/${p.d.name}: ${e?.message ?? e}`,
                );
                materialize.any = true;
                // [#8333 · P7] The PREFIX is unchanged byte for byte — it is
                // the operational fact a caller needs (the metadata IS live;
                // boot reconciliation heals the drift), and pins read it. Only
                // the interpolation changes: measured on `origin/main`, a
                // driver failure inside the side effects put `SQLITE_ERROR: no
                // such table: sys_metadata` on the tail of this sentence, on a
                // 200 response.
                //
                // Everything this `try` wraps is infrastructure — registry
                // write-through, table DDL, the projector, the event — so no
                // authored refusal was measured arriving here at all; the
                // materializer's authored refusal takes P8's RETURN path
                // instead. The rule is applied uniformly anyway rather than
                // special-cased: a declared 4xx from any of them is still
                // quoted.
                materialize.failures.push({
                    type: p.d.type, name: p.d.name,
                    error: 'side effects failed (metadata is live; boot reconciliation heals): '
                        + clientFacingFailureText(e, 'the reason is in the server log'),
                });
            }
        }

        const seedApplied = seedBodies.length > 0 ? await this.applySeedBodies(seedBodies) : undefined;

        // [#24253] AFTER every promoted item's side effects, never before: the
        // registry write-through is what makes the engine serve the new field
        // (a write naming a field the registry lacks is stripped), and
        // `ensureObjectStorage` is what adds its column. A sync that was
        // refused there leaves no column, so the write below fails and is
        // reported per field, never skipped.
        const backfillApplied = backfillPlan.length > 0 && published.length > 0
            ? await this.applyPublishBackfill(request.packageId, backfillPlan, request.context)
            : undefined;

        // ADR-0038 L3: exercise what was just published — one real read per
        // artifact — so "Published!" can never again mean "and silently
        // broken". Best-effort by design: a probe crash is swallowed (the
        // publish already happened and must report as such), and findings ride
        // the response for the agent / chat health card to act on.
        let probes: import('./build-probes.js').BuildProbeReport | undefined;
        if (published.length > 0) {
            try {
                const { publishedItemReader, runBuildProbes } = await import('./build-probes.js');
                const analytics = this.getServicesRegistry?.().get('analytics');
                probes = await runBuildProbes({
                    engine: this.engine as any,
                    // [ADR-0150 D3, #31700] A widget's dataset is resolved FROM
                    // the publishing package, so each namespace's publish
                    // probes its own dataset of a name two namespaces hold.
                    getItem: publishedItemReader(this.facade as any, request.packageId),
                    published,
                    ...(analytics && typeof analytics.queryDataset === 'function' ? { analytics } : {}),
                    organizationId: null,
                    ...(request.context !== undefined ? { context: request.context } : {}),
                });
            } catch {
                probes = undefined;
            }
        }

        // ADR-0067 D2 — the commit record was written INSIDE the Phase-1
        // transaction above, together with the promotions it describes.

        // [#10462] The no-op exit — a publish with nothing to promote — used
        // to be the ONLY exit that left no trace at all: no audit row (right:
        // `sys_metadata_audit` rows are keyed on `(type, name)`, and a batch
        // with zero items has no honest identity to mint — the limiting case
        // of the rule both refusal sites already follow) and no log line
        // (wrong: an operator who reads `success: false` as a refusal goes
        // looking for a rollback that never happened). `info`, not `warn`:
        // nothing was claimed persisted and nothing was lost, so this is
        // neither a durability nor a functional degradation.
        if (published.length === 0 && failed.length === 0) {
            console.info(
                `[Protocol] publishPackageDrafts: nothing to publish for package `
                + `'${request.packageId}' — no pending drafts were found, and nothing was refused.`,
            );
        }

        return {
            success: failed.length === 0 && published.length > 0,
            // [#10462] Derived, never stored: 'refused' the moment anything is
            // in `failed[]` (defensive — every failure on this route unwinds
            // through the Phase-1 catch above today), else 'published' iff
            // something landed, else the no-op. Exactly the three-way fact
            // `success` compresses into one boolean.
            outcome: failed.length > 0
                ? 'refused'
                : published.length > 0 ? 'published' : 'nothing_to_publish',
            publishedCount: published.length,
            failedCount: failed.length,
            published,
            failed,
            ...(seedApplied ? { seedApplied } : {}),
            ...(materialize.any
                ? { materializeApplied: {
                    success: materialize.failures.length === 0,
                    inserted: materialize.inserted,
                    updated: materialize.updated,
                    failures: materialize.failures,
                } }
                : {}),
            ...(probes ? { probes } : {}),
            ...(commit ? { commitId: commit.commitId } : {}),
            ...(backfillApplied ? { backfillApplied } : {}),
        };
    }

    /** The body of `ObjectStackProtocolImplementation#discardPackageDrafts`; the method's docblock there is its contract. */
    static async discardPackageDrafts(host: Pick<ProtocolHost, 'discardDraftInItsScope' | 'ensureOverlayIndex' | 'getOverlayRepo' | 'refuseOrganizationScopedWrite'>, request: {
            packageId: string;
            actor?: string;
        }): Promise<{
            success: boolean;
            discardedCount: number;
            failedCount: number;
            discarded: Array<{ type: string; name: string }>;
            failed: Array<{ type: string; name: string; error: string; code?: string }>;
        }> {
        // [ADR-0131 D6] FIRST: an organization-scoped discard is refused.
        host.refuseOrganizationScopedWrite(
            `Package '${request.packageId}'`, request,
        );
        await host.ensureOverlayIndex();
        const repo = host.getOverlayRepo();
        const drafts = await repo.listDrafts({ packageId: request.packageId });

        const discarded: Array<{ type: string; name: string }> = [];
        const failed: Array<{ type: string; name: string; error: string; code?: string }> = [];

        for (const d of drafts) {
            try {
                await host.discardDraftInItsScope(d, request.actor);
                discarded.push({ type: d.type, name: d.name });
            } catch (e: any) {
                // [#8136] Same source, same reasoning as `deletePackage`'s
                // `failed[]` collector below: this `try` wraps only
                // `deleteMetaItem` (through `discardDraftInItsScope`), whose
                // exits all now either declare a refusal or withhold at the
                // source. Clean derivatively; no filter of its own.
                failed.push({
                    type: d.type,
                    name: d.name,
                    error: e?.message ?? 'discard failed',
                    ...(e?.code ? { code: e.code } : {}),
                });
            }
        }

        return {
            success: failed.length === 0 && discarded.length > 0,
            discardedCount: discarded.length,
            failedCount: failed.length,
            discarded,
            failed,
        };
    }
}
