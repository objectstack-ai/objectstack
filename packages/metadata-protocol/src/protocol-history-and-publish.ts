// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "History, publish, drafts, publish backfill" facet of
 * `ObjectStackProtocolImplementation`: the bodies of `historyMetaItem`,
 * `publishMetaItemUnaudited`, `promoteDraftForPublish`,
 * `runPublishSideEffects`, `discardPackageDrafts` moved out of `protocol.ts`
 * whole by `scripts/codemod-split-protocol.mjs`.
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
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import { packagelessPublishNoDraftRefusal, permissionSetOwnerBindingRefusal } from './protocol-authoring-refusals.js';
import { memberOption, mutationEventMemberOfBody, resolveBundleMemberSelector } from './protocol-bundle-members.js';
import { clientFacingFailureText } from './protocol-client-failures.js';
import type { PublishMaterializeResult } from './protocol-package-lifecycle-types.js';
import type { MutationProjectionOutcome } from './protocol-mutation-events.js';
import { withPendingAudit } from './protocol-audit-entry.js';
import type { PublishMetaItemRequest } from './protocol-door-requests.js';
import type { ProtocolHost } from './protocol-host.js';

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
        const { singularType, advisories, result } = await host.promoteDraftForPublish({ ...request, member })
            .catch(async (err: unknown) => {
                await host.recordPendingDenialAudit(err);
                throw err;
            });
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
            seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[] };
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
    static async promoteDraftForPublish(host: Pick<ProtocolHost, 'anonymousElevatedFlowRefusal' | 'assertRuntimeAuthoringRules' | 'classifyObjectContribution' | 'credentialChannelFor' | 'defaultRecordPageSaveRefusal' | 'ensureOverlayIndex' | 'externalBindingSaveRefusal' | 'getOverlayRepo' | 'isArtifactBacked' | 'isOverlayAllowed' | 'isRuntimeCreateAllowed' | 'isSealedManagedItem' | 'lockWriteRefusal' | 'metadataConflictRefusal' | 'namedBaseOverlayWriteRefusal' | 'objectExtensionItemRefusal' | 'objectNamespacePrefixViolation' | 'objectRegistrationRefusal' | 'optimisticConflictAuditEntry' | 'overlayPackageMismatchError' | 'overrideWriteVerdict' | 'packagelessAddress' | 'packagelessDraftAddress' | 'permissionSetNameCollisionRefusal' | 'resolveSduiManifest' | 'seedExternalIdSaveRefusal' | 'uninstalledNamedBaseRefusal' | 'unknownDatasourceSaveRefusal' | 'unknownGrantObjectSaveRefusal' | 'unknownPicklistBindingSaveRefusal'>, request: {
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
            result: { version: string; seq: number; item: MetadataItem; packageId: string | null };
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
            const registration = host.objectRegistrationRefusal(draftForGate.body, layer);
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
            return { singularType, advisories: runtimeAdvisories, result };
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
            seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[] };
            materializeApplied?: PublishMaterializeResult;
            projectionApplied?: MutationProjectionOutcome;
        }> {
        const out: {
            seedApplied?: { success: boolean; inserted: number; updated: number; error?: string; errors?: unknown[] };
            materializeApplied?: PublishMaterializeResult;
            projectionApplied?: MutationProjectionOutcome;
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
        await host.ensureObjectStorage(args.singularType, args.name);
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
