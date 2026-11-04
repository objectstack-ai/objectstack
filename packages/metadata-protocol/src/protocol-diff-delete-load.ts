// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Diff, deleteMetaItem, loadMetaFromDb, load reports,
 * findReferencesToMeta" section of `ObjectStackProtocolImplementation`: the
 * bodies of `diffMetaItem`, `deleteMetaItem`, `deleteMetaItemUnaudited`,
 * `loadMetaFromDb`, `findReferencesToMeta` moved out of `protocol.ts` whole by
 * `scripts/codemod-split-protocol.mjs`.
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as `packages/metadata-protocol/scripts/host-split.mjs` moves
 * one (ruling E, item E1): re-indented one level, with `this.<member>` read as
 * `host.<member>` and nothing else changed. Each method stays on the class
 * with its docblock and signature, which the published `.d.ts` prints, and
 * hands its body the host (`protocol-host.ts`); the docblock there is the
 * contract.
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { overlayMemberWhere } from './migrations/overlay-index.js';
import {
    historyRowsOfMember,
    packagelessAddressAmbiguityRefusal,
    versionNotFoundError,
} from './sys-metadata-repository.js';
import {
    ConflictError,
    findUndeclarableFieldType,
    isObjectFieldTypeRefused,
    readLegacyOrganizationRows,
} from '@objectstack/metadata-core';
import { isMissingTableError } from '@objectstack/metadata/errors';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { isServedOverrideRowOf } from './served-override.js';
import type { ServedOverrideRow } from './served-override.js';
import { REFERENCE_SITES } from './reference-sites.js';
import { computeMetadataDiagnostics } from './metadata-diagnostics.js';
import { hasMetadataRedactor, redactMetadataItem } from './metadata-redaction.js';
import { isPairRowRemoval } from './protocol-packaged-base-refusal.js';
import { withRefusalAudit } from './protocol-refusal-audit.js';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import { remainingRowsPhrase } from './protocol-authoring-refusals.js';
import { memberOption, mutationEventMember, resolveBundleMemberSelector } from './protocol-bundle-members.js';
import {
    carryCatalogedErrorCode,
    carryDeclaredUserMessage,
    overlayDeleteFailureMessage,
} from './protocol-client-failures.js';
import { collectCompositeKeyHeadHits, collectReferenceHits } from './protocol-reference-hits.js';
import { diffShallow } from './protocol-write-face.js';
import type { MutationProjectionOutcome } from './protocol-mutation-events.js';
import type { DeleteMetaItemRequest } from './protocol-door-requests.js';
import type { ProtocolHost } from './protocol-host.js';

/** The body of `ObjectStackProtocolImplementation#diffMetaItem`; the method's docblock there is its contract. */
export async function diffMetaItem(host: Pick<ProtocolHost, 'diffMetaItem' | 'findEnvironmentRow' | 'findEnvironmentRows' | 'resolveRowlessExpandedView' | 'rethrowUnlessMetadataStoreUnprovisioned'>, request: {
        type: string;
        name: string;
        fromVersion?: number;
        toVersion?: number;
    }): Promise<{
        type: string;
        name: string;
        fromVersion: number | null;
        toVersion: number | null;
        added: Array<{ path: string; value: unknown }>;
        removed: Array<{ path: string; value: unknown }>;
        changed: Array<{ path: string; from: unknown; to: unknown }>;
    }> {
    // [#8868] #4432 / #7894 — CANONICAL TYPE KEY. See {@link canonicalMetaType}.
    // `diffMetaItem` is the NINTH `/meta` entry point on this URL family
    // (`GET /api/v1/meta/:type/:name/diff`, caller-supplied `:type`, registered
    // at `rest-route-ledger.ts:184`) and was the last one still deriving its type
    // key from `PLURAL_TO_SINGULAR` — the MANIFEST-COLLECTION map #7894 moved this
    // boundary off. The same one-line replacement #8769 (`publishMetaItem`) and
    // #8819 (`rollbackMetaItem`) made, for the same reason.
    //
    // What the fold reaches here, measured rather than assumed:
    //
    //  • the history read below, which queries `sys_metadata_history` by `type`.
    //    For the four MANIFEST-ABSENT types (`field`, `seed`, `external_catalog`,
    //    `translation` — legitimately absent from the manifest map because they
    //    are not stack collections) a plural stayed plural all the way into that
    //    `where`, matched no row, and this function answered a well-formed EMPTY
    //    diff for an item that DOES have history. Not a refusal and not an error:
    //    a silent "nothing changed" on a routed live endpoint, which is why this
    //    is a wrong-answer defect rather than #8819's protection-bypass class.
    //    Manifest-PRESENT types (`views` → `view`) folded already and were never
    //    affected — that asymmetry is what makes `fields` the discriminating
    //    fixture in the pins and `views` a fold that proves nothing.
    //  • the #7894 boundary REFUSAL, which never ran on this verb at all: an
    //    unrecognised spelling of a declared type (`viewes`) was forwarded to the
    //    plugin path instead of refused `400 INVALID_REQUEST`.
    //  • the echoed `type` in the response below. Reassigning `request` is what
    //    makes that echo report the CANONICAL spelling, and that is the precedent
    //    this family already set rather than a new answer: `saveMetaItem` and
    //    `deleteMetaItem` both `return { type: request.type }` AFTER their fold,
    //    and #8819's own header calls reporting the CALLER's spelling for a row
    //    addressed under the canonical one the defect it was fixing. The echo now
    //    names the spelling the read actually used.
    request = canonicalizeMetaRequestType(request);
    // Canonical by construction from the fold above. NOT a second fold: the
    // `PLURAL_TO_SINGULAR` lookup that used to stand here is exactly what #7894
    // removed from this boundary. The binding survives under its own name because
    // the read below reads it as "the key the row is stored under" — the same
    // shape {@link rollbackMetaItem} keeps.
    const singularType = request.type;
    // [#21442] A view name with no stored row of its own that a stored
    // view container in this caller's scope expands — a name the by-name
    // read answers with the container's expansion — has no versions of its
    // own, and none are synthesized for it. The comparison is the
    // container's own row's, made exactly as this method makes it under the
    // container's own name, and the answer says so: its `name` is the
    // container's — the item actually diffed, the same rule the echoed
    // `type` follows above.
    const expandedFrom = await host.resolveRowlessExpandedView(
        { type: singularType, name: request.name },
    );
    if (expandedFrom !== undefined) {
        return host.diffMetaItem({ ...request, name: expandedFrom.container.name });
    }
    // [#8798] Read the history rows DIRECTLY, once. `historyMetaItem`
    // cannot serve this function: its `MetadataEvent` shape doesn't carry
    // the per-(type,name) `version` a diff selects versions by, so its
    // result was computed into a `versions` array and then discarded
    // (`const _used = versions; void _used;`) while the real read happened
    // below — a second, unused round trip over `sys_metadata_history` on
    // every request to a routed, live endpoint.
    //
    // ⛔ Do not reinstate a `historyMetaItem` call here "for the
    // authorization check". It never performed one for this path, measured
    // both ways: its early return (`isOverlayAllowed` / `isRuntimeCreateAllowed`)
    // answers `{ events: [] }` WITHOUT throwing and without touching the
    // engine, so the five types that take it (`field`, `job`, `api`,
    // `capability`, `agent`) had their diff served by the read below
    // regardless — the gate never reached this function's output. What the
    // discarded call did change was failure behaviour, and only by accident:
    // being unguarded, it made a `sys_metadata_history` outage FATAL for
    // gated-open types while the `try` below answered an empty diff for the
    // five gated-shut ones. One outage, two answers, decided by type. The
    // `catch` below is this function's only stated intent for that failure,
    // so removing the call makes every type take it. Pinned in
    // `protocol.diff-dead-history-read.test.ts`.
    const histRows: Array<{ version: number; body: Record<string, unknown> | null }> = [];
    try {
        // [#21908, ADR-0096 D5] The explicit system opt-in: the history
        // lineage is a platform store the diff door already authorized.
        // Principal-less,
        // the engine refuses it, and the `catch` below would have answered
        // an empty diff for an item that has history.
        // [#22877] The canonical member's lineage only — a by-name diff of a
        // bundled type compares the member a by-name read serves, never a
        // second locale's snapshot as its "earlier version".
        const rows: any[] = historyRowsOfMember<any>(singularType, await host.findEnvironmentRows('sys_metadata_history', {
            where: {
                type: singularType,
                name: request.name,
            },
            context: { isSystem: true },
        }));
        rows.sort((a: any, b: any) => (a.version ?? 0) - (b.version ?? 0));
        for (const r of rows) {
            const body = r.metadata == null
                ? null
                : (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata);
            histRows.push({ version: r.version ?? 0, body });
        }
    } catch (error) {
        // [#8833] ADR-0110 D3 — a miss and an outage are different facts, and a
        // consumer must never read one as the other.
        //
        // This `catch` used to be EMPTY and fall through, leaving `histRows` at
        // `[]`. The invention then happened below, where that never-filled
        // accumulator is read as though it were a real answer: a
        // `sys_metadata_history` outage was served as a well-formed 200 with
        // `added`/`removed`/`changed` all empty — byte-identical to "these two
        // versions are the same". An operator comparing versions before a
        // rollback, and any SDK or agent reading this endpoint, acted on
        // "unchanged" with full confidence, and no log line was emitted either.
        // (That fall-through shape is also why `check-durability-degradation-log-
        // level`'s read-seam-invention rule cannot see this seam despite scanning
        // this package: it keys on `ts.isReturnStatement` and this `catch`
        // returned nothing. Extending that gate is #8845 in the devx lane.)
        //
        // Maintainer ruling (2026-08-15, #8833 comment 5302933802): route the
        // failure through the platform's EXISTING discrimination rather than
        // adding a response field. The genuinely-absent-table case — a minimal
        // deployment that never provisioned history — keeps its benign empty
        // answer, because there really are no rows and a first boot must not
        // explode. EVERY other read failure (connection drop, timeout, permission
        // denial, query error) propagates the 503.
        // {@link rethrowUnlessMetadataStoreUnprovisioned} is that single
        // discriminator — the same guard #5532 restored for `getMetaItems` and
        // #8855 carries for `getMetaDiagnostics` — and it is conservative in the
        // safe direction: an UNRECOGNISED error is loud, never benign.
        //
        // ⚠️ This ADDS loudness where there is now none, uniformly for every
        // type. Before PR #8841 the outage threw for gated-open types (`view`)
        // and was swallowed for gated-shut ones (`field`, `job`, `api`,
        // `capability`, `agent`); #8841 deleted the discarded `historyMetaItem`
        // round trip that caused that split, so it had become silent everywhere.
        // The ruling was made against that post-#8841 state.
        //
        // ⛔ A `historyUnavailable: true` response key (the card's option B) was
        // DECLINED in the same ruling — a new published key with no consumer, on
        // the manual floor. Do not reintroduce it as "more informative".
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata_history');
    }
    const byVersion = new Map<number, Record<string, unknown> | null>();
    for (const r of histRows) byVersion.set(r.version, r.body);

    let fromBody: Record<string, unknown> | null = null;
    let toBody: Record<string, unknown> | null = null;
    let fromVersion: number | null = null;
    let toVersion: number | null = null;

    if (request.toVersion !== undefined) {
        toVersion = request.toVersion;
        // [#26462] ADR-0110 D3 — a named version with no row is a MISS,
        // never an empty side: compared as `{}` it answered "no change"
        // (both missing, or an item with no history at all) or
        // "everything removed" with a 200. Refused as the rollback door
        // refuses the same number. The read is keyed by (type, name), so
        // another item's version is this item's miss too. A delete
        // tombstone HAS a row (a `null` body, not `undefined`) and stays
        // served.
        const named = byVersion.get(request.toVersion);
        if (named === undefined) {
            throw versionNotFoundError({ type: singularType, name: request.name }, request.toVersion);
        }
        toBody = named;
    } else {
        // [#20397] The default `to` side is the CURRENT ACTIVE ROW, and ONE
        // read of that row supplies both of its facts: the body compared and
        // the `version` it is labelled with. `SysMetadataRepository.put`
        // stamps that column in the same transaction that appends the history
        // row carrying the same body, so it names the version this body is.
        //
        // The label used to come from the NEWEST `sys_metadata_history` row
        // instead, which is a draft save whenever a draft is pending (every
        // draft save appends a row too). Body and label then named different
        // rows: on the real REST stack an app answered `2 → 3` over its
        // version-1 body, and a view answered "no changes" labelled `1 → 2`
        // while version 2 differs.
        //
        // Read here, not through `SysMetadataRepository.get`: its
        // `MetadataItem` projection carries the row's content hash but not
        // its lineage `version`. Same predicate as that read (active state, no
        // package scope), and VERBATIM like the history bodies it is compared
        // against: no ADR-0087 conversion on either side.
        //
        // No active row (a draft-only item, a deleted one) ⇒ that side is
        // absent and so is its label: `null`, as `DiffMetaItemResponseSchema`
        // declares, never the number of a row whose body is not the one
        // compared. ⛔ Do not recover a number by matching bodies or hashes
        // against history: a publish and a revert both write rows whose
        // bodies repeat earlier ones.
        // [#21908, ADR-0096 D5] The explicit system opt-in, as the history
        // read above.
        const current = (await host.findEnvironmentRow('sys_metadata', {
            where: {
                type: singularType, name: request.name, state: 'active',
                // [#22877] The canonical member, as the by-name read serves.
                ...overlayMemberWhere(singularType),
            },
            context: { isSystem: true },
        })) as { metadata?: unknown; version?: unknown } | null;
        toBody = current?.metadata == null
            ? null
            : (typeof current.metadata === 'string'
                ? JSON.parse(current.metadata)
                : current.metadata as Record<string, unknown>);
        toVersion = current && typeof current.version === 'number' ? current.version : null;
    }
    if (request.fromVersion !== undefined) {
        fromVersion = request.fromVersion;
        // [#26462] The same miss on the from side — see the to side above.
        const named = byVersion.get(request.fromVersion);
        if (named === undefined) {
            throw versionNotFoundError({ type: singularType, name: request.name }, request.fromVersion);
        }
        fromBody = named;
    } else if (toVersion !== null) {
        // [#20451] The default from side is the NEAREST EARLIER history row
        // whose body DIFFERS from the to side's, not the row immediately
        // before it. Every draft save appends a history row and a publish
        // appends the promoted body again as the next one, so the row
        // immediately before a published version is usually the draft save
        // it came from, with the same body: the default answered "no
        // changes" right after every publish, and the change the publish
        // carried was one explicit range away.
        //
        // "Differs" is this diff's OWN equality — `diffShallow`'s three
        // buckets not all empty, with an absent body compared as `{}`
        // exactly as the comparison below compares it — never a second
        // notion of which rows count. So a body-less row (a delete's
        // tombstone) differs from any non-empty to side and the walk stops
        // on it, naming the deletion: the item did not exist there.
        // ⛔ Do not branch on `operation_type` or add a lifecycle column to
        // tell drafts from publishes: the #20378 ruling (comment
        // 5865708652) declined the state column, and the retriage answer
        // on #20451 (comment 5875579209) is this equality over every row.
        //
        // The walk reads only `histRows`, already the item's whole history
        // from the one `find` above, sorted by version; it adds no read and
        // no cap. No earlier row differs ⇒ the from side is absent (`null`,
        // everything added), the answer for an item with no earlier version.
        const earlier = histRows.map((r) => r.version).filter((v) => v < toVersion!);
        const rawTarget = toBody ?? {};
        for (let i = earlier.length - 1; i >= 0; i--) {
            const candidate = byVersion.get(earlier[i]!) ?? null;
            const d = diffShallow(candidate ?? {}, rawTarget);
            if (d.added.length || d.removed.length || d.changed.length) {
                fromVersion = earlier[i]!;
                fromBody = candidate;
                break;
            }
        }
    }
    // [commit 75e66fc8e] Diff RAW, then redact the EMITTED values — maintainer ruling
    // (recorded in that commit's message), Option B. The comparison runs on the stored
    // bodies untouched, so a credential ROTATION still registers as a
    // changed path; only the values leaving this function are taken from
    // the type's redacted projection of those same bodies.
    //
    // ⛔ Redacting the bodies BEFORE `diffShallow` (Option A) was ruled out
    // and must not be reintroduced as a simplification: two redacted bodies
    // are equal at a redacted path, so the rotation would vanish into a
    // no-diff — destroying the one fact this endpoint exists to serve.
    //
    // WHY SUBSTITUTION RATHER THAN PATH-MATCHING against `redactedKeys`:
    // the two namings live on different planes. `diffShallow` is TOP-LEVEL
    // (a nested change collapses to one entry at the top-level key, whose
    // value is the whole sub-object), while `redactedKeys` is nested and
    // dotted (`config.password`). So `redactedKeys.includes(entry.path)`
    // would match NOTHING on the real leak — the leaking entry's path is
    // `config`. Reading each emitted value out of the already-redacted body
    // gets the nested case right for free and mints no second rule set:
    // the redactor stays the single source of what a credential is.
    const rawFrom = fromBody ?? {};
    const rawTo = toBody ?? {};
    const diff = diffShallow(rawFrom, rawTo);
    let served = diff;
    // Skipped entirely for the overwhelming majority of types, which register
    // no redactor — `hasMetadataRedactor` is the seam that answers that
    // without this call site having to know which types hold a secret.
    if (hasMetadataRedactor(singularType)) {
        const servedFrom = redactMetadataItem(singularType, rawFrom) as Record<string, unknown>;
        const servedTo = redactMetadataItem(singularType, rawTo) as Record<string, unknown>;
        // Both sides, and all three buckets: leaking either the old or the
        // new value defeats the point (the ruling's second binding note).
        served = {
            added: diff.added.map((e) => ({ path: e.path, value: servedTo[e.path] })),
            removed: diff.removed.map((e) => ({ path: e.path, value: servedFrom[e.path] })),
            changed: diff.changed.map((e) => ({ path: e.path, from: servedFrom[e.path], to: servedTo[e.path] })),
        };
    }
    return {
        type: request.type,
        name: request.name,
        fromVersion,
        toVersion,
        ...served,
    };
}

/** The body of `ObjectStackProtocolImplementation#deleteMetaItem`; the method's docblock there is its contract. */
export async function deleteMetaItem(host: Pick<ProtocolHost, 'deleteMetaItemUnaudited' | 'recordMetadataAudit'>, request: DeleteMetaItemRequest) {
    // [#28355] A refusal that carries no row of its own leaves its `denied` row here.
    return withRefusalAudit((entry) => host.recordMetadataAudit(entry), {
        operation: 'delete', type: request.type, name: request.name, actor: request.actor,
        source: 'protocol.deleteMetaItem',
    }, () => host.deleteMetaItemUnaudited(request));
}

/** The body of `ObjectStackProtocolImplementation#deleteMetaItemUnaudited`; the method's docblock there is its contract. */
export async function deleteMetaItemUnaudited(host: Pick<ProtocolHost, 'assertLockAllowsDelete' | 'dropObjectStorage' | 'dropStorageRemainingRowsRefusal' | 'emitMetadataMutation' | 'engine' | 'environmentId' | 'findEnvironmentRow' | 'getOverlayRepo' | 'isArtifactBacked' | 'isOverlayAllowed' | 'isRuntimeCreateAllowed' | 'metadataConflictRefusal' | 'originGatedRemovalRefusal' | 'packagedArtifactOwner' | 'packagedBaseRefusal' | 'packagelessAddress' | 'packagelessDraftAddress' | 'packagelessOverlayWriteRefusal' | 'recordMetadataAudit' | 'recordOptimisticConflictAudit' | 'refuseOrganizationScopedWrite' | 'refusePackagedBaseRemoval' | 'registryAllowsOverlay' | 'restoreArtifactRegistryView' | 'runMutationProjector' | 'shouldDropStorage' | 'storedParentForToken'>, request: DeleteMetaItemRequest): Promise<{
        success: boolean;
        message?: string;
        reset?: boolean;
        seq?: number;
        /** [ADR-0094] Outcome of the awaited mutation projector, when one is registered. */
        projectionApplied?: MutationProjectionOutcome;
    }> {
    // [ADR-0131 D6] FIRST: an organization-scoped delete is refused.
    // See {@link organizationScopedWriteRefusal}.
    host.refuseOrganizationScopedWrite(
        `Metadata item '${request.type}/${request.name}'`, request,
    );
    // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. Without it
    // the authorization tier (`isOverlayAllowed` / `isArtifactBacked`) and
    // the registry heal (`restoreArtifactRegistryView`) read the caller's
    // spelling while the repository deletes under the singular — so a
    // DELETE could remove the row and leave the shadow it was meant to lift.
    request = canonicalizeMetaRequestType(request);
    // [#22877] Ruling 6116165299 (Q2 i): a reset by name removes ONE
    // member's row of a bundled type — the selector's, else the canonical
    // one — and heals the registry for that member alone.
    const member = resolveBundleMemberSelector(request.type, request.member);
    // [#21899] The removal verdict on an ORIGIN-GATED code-defined item
    // (ADR-0126 §3: `datasource` — code-defined read-only, runtime-created
    // free), held back until the row probe below. See
    // {@link originGatedRemovalRefusal}: the item itself is never removed
    // here, but a stored row under its name is, as repair.
    const originGatedRefusal = host.originGatedRemovalRefusal(request.type, request.name);
    // [#28412, ADR-0146 D9 item 1] A removal naming the shipping package's
    // pair, of a type whose D9 conditions are delivered (`flow` only —
    // every other open type keeps main's verdict): it removes
    // the row the override is stored in, and the code package's item is
    // served — and armed — again. Admitted past the sealed-removal refusal
    // and told to the store as a runtime-only removal, as the declared
    // save is ({@link isPairRowRemoval}).
    const pairRowRemoval = isPairRowRemoval(
        request.type, host.packagedArtifactOwner({ type: request.type, name: request.name }), request.packageId,
    );
    // Two-tier authorization for delete (mirrors saveMetaItem).
    //  • Artifact-backed item → delete becomes a tombstone overlay,
    //    requires `allowEnvironmentOverlay`…
    //  • …EXCEPT when the type's entry carries `supportsOverlay: true` —
    //    the removal carve-out: removing the row removes no managed
    //    definition (and changes what is served for `permission` alone),
    //    so it is repair and is allowed without it. The flag opens no save
    //    and decides no read. [#6960, delete-only; see below.]
    //  • DB-only item → hard delete of a user-created row,
    //    requires `allowRuntimeCreate` (or `allowEnvironmentOverlay`).
    if (host.environmentId !== undefined) {
        const overlayAllowed = host.isOverlayAllowed(request.type);
        const runtimeCreateAllowed = host.isRuntimeCreateAllowed(request.type);
        const artifactBacked = host.isArtifactBacked(request.type, request.name);
        // [#6960] …and the ONE removal the refusal above must not swallow.
        //
        // MAINTAINER RULING, 2026-08-10 (#6960): removing a legacy env
        // overlay on a type whose per-org override channel was rolled back
        // is allowed through the ordinary delete path. Deleting an overlay
        // restores the code-declared state — it is the NARROWING direction
        // and cannot widen anything — so refusing it serves no security
        // purpose while trapping the repair behind `OS_METADATA_WRITABLE`.
        //
        // ⛔ DELETE ONLY, AND IT IS NOT AN OVERSIGHT. Create and update on
        // the same item stay refused exactly as before (`saveMetaItem`'s
        // sibling gate is untouched); a future tidy-up that "restores
        // symmetry" here re-opens the write door the rollback in commit ee58392e1 closed.
        // The asymmetry is the ruling.
        //
        // THE TIER BOUNDARY, which is what makes this narrow enough to be
        // safe: {@link mergesOverlayAtRead} is `supportsOverlay`, NOT
        // `allowEnvironmentOverlay`.
        //
        //  • `supportsOverlay: true` + `allowEnvironmentOverlay: false` — the
        //    ROLLED-BACK OVERLAYABLE tier (`permission` / `position` /
        //    `page` / `app` / `dataset` / `book`, and any type that lands
        //    in this shape later). Commit ee58392e1 closed the write door
        //    and, until ADR-0131 D6's seal, left the read path merging
        //    overlay-wins, so a row authored before the rollback shaped the
        //    effective body and the ordinary "Reset to package default" flow
        //    answered 403 with the item still customized. The seal now
        //    withholds such a row from the served read (`permission`
        //    excepted, {@link isUnservedSealedOverlay}); the row stays stored,
        //    and this branch is how the operator removes it.
        //  • `supportsOverlay: false` — `object` above all, whose overlay
        //    is a CONTRIBUTOR LAYER (ADR-0029 D9) rather than a merge, and
        //    whose reset refusal is D9.6's declared and maintainer-approved
        //    cost. This branch does not reach it and must not: pinned by
        //    `protocol-object-overlay-layer.test.ts` on both topologies.
        //
        // The same carve-out is mirrored — deliberately, not by accident —
        // in `SysMetadataRepository`'s delete gate, because that one is
        // TOPOLOGY-INDEPENDENT: a control-plane kernel skips this whole
        // block (`environmentId === undefined`) and would otherwise be
        // refused there instead, leaving the fix half-done. See
        // {@link SysMetadataRepository.assertDeleteAllowed}.
        //
        // [#20679] The verdict — the artifact-backed refusal AND the
        // carve-out above — was lifted, unchanged, into
        // {@link refusePackagedBaseRemoval}, so a second removal door onto
        // the same packaged artifact asks this one through
        // {@link packagedBaseRefusal} instead of carrying a copy.
        //
        // [#21899] An origin-gated code-defined item's verdict is that same
        // refusal, answered at the row probe instead of here: thrown when
        // no stored row exists, and lifted for the repair that deletes one.
        if (originGatedRefusal === null && !pairRowRemoval) host.refusePackagedBaseRemoval(request);
        if (!artifactBacked && !overlayAllowed && !runtimeCreateAllowed) {
            const err = new Error(
                `Metadata type '${request.type}' does not allow runtime creation or deletion.`
            );
            (err as any).code = 'NOT_CREATABLE';
            (err as any).status = 403;
            throw err;
        }
    }

    // [ADR-0146 D11] The package-less removal of a packaged item's active
    // row, closed with the package-less write
    // ({@link packagelessOverlayWriteRefusal}): a delete naming no package,
    // of an item a code package ships, on one of the five overlay types,
    // whose row the ceremony would move (Setup's "Reset overlay"). Its
    // customization lives in the base's paired `.custom` once moved, and
    // `?package=<base>.custom` removes it there. On every topology, as
    // the save door's is, and ahead of the `_lock` gate's store read.
    //
    // ⛔ Not a draft discard: it changes nothing any read serves, and it is
    // how a package-less draft stored before the close is cleared (the
    // draft cannot be published package-less any more), including by the
    // discard-all walk, which names the package each draft is listed under.
    if (request.state !== 'draft') {
        const closed = await host.packagelessOverlayWriteRefusal({
            type: request.type,
            name: request.name,
            packageId: request.packageId,
            state: 'active',
            ...memberOption(member),
        }, 'delete');
        if (closed) throw closed;
    }

    // ADR-0010 L3 — lock blocks delete. [#21694] On EVERY topology, ranked
    // below the package removal door exactly as `saveMetaItem` ranks the
    // save gate below its package door (see the note there): on an
    // environment kernel that door has thrown above whenever it refuses;
    // on a host-config kernel a packaged base it refuses keeps the answer
    // that kernel already gave it — the repository's delete gate when an
    // overlay row exists, a no-op that leaves the artifact standing when
    // none does (see {@link packagedBaseRefusal}). [#21899] The
    // origin-gated repair is a removal the doors allow, so the `_lock`
    // gate asks about it as it asks about every other allowed removal.
    if (
        originGatedRefusal !== null
        || pairRowRemoval
        || host.packagedBaseRefusal({ type: request.type, name: request.name, operation: 'delete' }) === null
    ) {
        const lockErr = await host.assertLockAllowsDelete({
            type: request.type,
            name: request.name,
            // [#23297] The delete's address carries its package, as the save's does.
            ...(request.packageId ? { packageId: request.packageId } : {}),
            ...(request.actor ? { actor: request.actor } : {}),
            source: 'protocol.deleteMetaItem',
        });
        if (lockErr) throw lockErr;
    }

    const singularTypeForRepo = PLURAL_TO_SINGULAR[request.type] ?? request.type;
    // #5927 — the fact the four delete receipts below have to tell the
    // truth about, hoisted to method scope because it is read by BOTH
    // delete paths (repository and legacy raw-engine) and by `intent`.
    //
    // It is the SAME fact the repo path already computed inline for
    // `intent: 'override-artifact' | 'runtime-only'` — this binding
    // replaces that call rather than adding one, so the receipt split
    // costs zero new registry reads. (The two-tier authorization block
    // above computes it a second time under `request.type`; that one is
    // block-scoped to `environmentId !== undefined` and cannot be reused
    // here. Both spellings agree: `canonicalizeMetaRequestType` already
    // folded `request.type` to singular at the top of this method, which
    // makes `singularTypeForRepo` a no-op re-fold — see #4432.)
    const artifactBacked = host.isArtifactBacked(singularTypeForRepo, request.name);
    // [ADR-0131 D6] For an item a managed package ships the hatch decides
    // nothing, the route included: the item takes the route it takes with
    // `OS_METADATA_WRITABLE` shut. Read through the hatch, a code-only
    // managed item's stored residue was routed onto the repository, which
    // refuses it as sealed, away from the raw-engine repair below that
    // removes it with the hatch shut — so setting the hatch would have
    // blocked a repair the deployment otherwise has.
    const overlayAllowedForRepoDel = artifactBacked
        ? host.registryAllowsOverlay(singularTypeForRepo)
        : host.isOverlayAllowed(singularTypeForRepo);
    const runtimeCreateAllowedForRepoDel = host.isRuntimeCreateAllowed(singularTypeForRepo);
    const useRepoPath = overlayAllowedForRepoDel || runtimeCreateAllowedForRepoDel;

    // ADR-0008 — overlay-allowed types route through SysMetadataRepository
    // so the delete (a) is wrapped in engine.transaction(), (b) appends a
    // tombstone row to sys_metadata_history, and (c) emits a watch event
    // with a monotonic `seq` for HMR. Non-overlay-allowed types (only
    // reachable in control-plane bootstrap mode where environmentId is
    // undefined) take the legacy raw-engine path below — the repository's
    // `assertAllowed()` whitelist would 403 those deletes.
    if (useRepoPath) {
        // [ADR-0131 D6] Environment-wide: refused above otherwise.
        const repo = host.getOverlayRepo();
        const ref = {
            type: singularTypeForRepo,
            name: request.name,
            org: 'env',
        } as Parameters<typeof repo.delete>[0];
        // [#23165] The refusal of a package-less delete of an item two or
        // more packages hold: the door's own verdict, rethrown as it is by
        // the `catch` below, never re-wrapped as a delete that failed.
        let addressRefusal: Error | undefined;
        // [#23415] The refusal of a table drop another stored row of the
        // object still needs: rethrown as it is, as `addressRefusal` is.
        let dropRefusal: Error | undefined;

        try {
            const targetState: 'active' | 'draft' = request.state === 'draft' ? 'draft' : 'active';
            // [#23165, ADR-0048] THE ADDRESS of the row this delete removes.
            // It used to be no address at all: `repo.get` and `repo.delete`
            // were handed no package, so each took the first row a
            // package-agnostic `findOne` met — one package's row of an item
            // two packages hold (the other package's row then served, and
            // the receipt said "it no longer exists"), or the package's row
            // when a package-less row sat beside it.
            //
            // Named, the delete removes that package's row and no other.
            // Naming none, it takes the save door's resolution
            // ({@link packagelessAddress}), read from the rows at the state
            // it removes: the one package those rows are bound to, the
            // package-unbound row when they are bound to none, and a
            // refusal when they are bound to two or more. A draft discard
            // reads the draft rows, so it removes the draft that exists,
            // wherever the draft save put it (#11087).
            //
            // [#23495] …except that is not where the draft save puts it: a
            // draft save naming no package writes the draft of the package
            // the item's ACTIVE rows are bound to, so over an item bound to
            // `P` whose only draft is another package's, the discard
            // removed that draft while the save, the read and the token
            // named `P`'s. A draft discard naming no package takes the
            // draft address instead ({@link packagelessDraftAddress}), the
            // one the per-item publish takes: refused when the item's
            // active rows are bound to two or more packages, as the draft
            // save is.
            //
            // Resolved here, below every door that judges the item rather
            // than its row (the organization refusal, the packaged-base
            // door, the creatable check and the `_lock` gate), as the save
            // door orders it. The rows read here are also what the receipt
            // below tells the truth about: what is still stored, and so
            // still served, once this row is gone.
            const draftAddress = request.packageId == null && targetState === 'draft'
                ? await host.packagelessDraftAddress(singularTypeForRepo, request.name, member)
                : undefined;
            if (draftAddress?.kind === 'ambiguous') {
                addressRefusal = packagelessAddressAmbiguityRefusal(
                    'delete', request.type, request.name, draftAddress.candidates,
                );
                throw addressRefusal;
            }
            const rowsAtAddress = draftAddress?.drafts ?? await host.packagelessAddress(
                singularTypeForRepo, request.name, member, targetState,
            );
            if (request.packageId == null && draftAddress === undefined && rowsAtAddress.candidates.length > 1) {
                addressRefusal = packagelessAddressAmbiguityRefusal(
                    'delete', request.type, request.name, rowsAtAddress.candidates,
                );
                throw addressRefusal;
            }
            const packageId: string | null = request.packageId
                ?? (draftAddress !== undefined ? draftAddress.key : rowsAtAddress.packageId);
            // Probe first — "no overlay exists" is a success/no-op, not
            // a conflict. The repo would otherwise throw ConflictError.
            const current = await repo.get(ref, { state: targetState, packageId, ...memberOption(member) });
            // [#21899] An origin-gated code-defined item with NO stored row:
            // the delete would remove nothing, and the item itself is not
            // removable at runtime — refused with the package door's own
            // verdict, the one its save gets. Rethrown as it is by the
            // `catch` below.
            if (!current && originGatedRefusal !== null) throw originGatedRefusal;
            // [#23165] A delete NAMING a package that holds no row here, of
            // an item whose other rows are stored: nothing is removed and
            // those rows are still served, so neither the registry heal
            // below nor its "already at artifact default" / "nothing to
            // delete" claim holds. A delete naming none never lands here:
            // it addresses a row the read above found.
            if (!current && request.packageId != null && (rowsAtAddress.candidates.length > 0 || rowsAtAddress.unbound)) {
                return {
                    success: true,
                    reset: false,
                    message: targetState === 'draft'
                        ? `No pending draft of ${request.type}/${request.name} is bound to package '${request.packageId}', so nothing was discarded: ${remainingRowsPhrase(rowsAtAddress.candidates, rowsAtAddress.unbound, 'draft')}.`
                        : `No row of ${request.type}/${request.name} is bound to package '${request.packageId}', so nothing was deleted: ${remainingRowsPhrase(rowsAtAddress.candidates, rowsAtAddress.unbound, 'row')}.`,
                };
            }
            // [#23495] …and a draft discard naming no package, of an item
            // bound to a package that holds no draft at that package's
            // address while other packages' drafts are stored: nothing is
            // discarded, and the receipt names what remains rather than
            // claiming no draft exists.
            if (!current && draftAddress?.kind === 'none' && draftAddress.into !== null && rowsAtAddress.candidates.length > 0) {
                return {
                    success: true,
                    reset: false,
                    message: `No pending draft of ${request.type}/${request.name} is bound to package '${draftAddress.into}', the package its published rows are bound to and the draft a discard that names no package removes, so nothing was discarded: ${remainingRowsPhrase(rowsAtAddress.candidates, rowsAtAddress.unbound, 'draft')}.`,
                };
            }
            if (!current) {
                // Self-heal: even with no overlay row, a stale runtime
                // shadow may linger in the registry (e.g. pollution from
                // before this fix shipped) — drop it so the artifact
                // view really IS the default we claim below.
                //
                // [#6780] The organization is passed, and this branch is where it
                // matters MOST: with no row to delete, an org that never
                // customized anything at all could evict the env-wide
                // plain-key entry with a single no-op DELETE. Measured on
                // `origin/main`: receipt `{reset: false, "nothing to
                // delete"}` and `registry.getItem('view','shared_grid')`
                // → `undefined`, the env-wide row untouched in
                // `sys_metadata`. A gate applied only to the delete-ful
                // branch below would have left this door standing open.
                if (targetState === 'active') {
                    await host.restoreArtifactRegistryView(request.type, request.name, null, member);
                }
                return {
                    success: true,
                    reset: false,
                    // #5927 — "already at artifact default" presumes an
                    // artifact default EXISTS to be at. When nothing is
                    // shipped under this (type, name), the absent overlay
                    // row is the absence of the whole item, and the miss
                    // says that instead of naming a baseline that was
                    // never there. The draft leg claimed neither and is
                    // unchanged, verbatim.
                    message: targetState === 'draft'
                        ? `No pending draft for ${request.type}/${request.name}.`
                        : artifactBacked
                            ? `No customization overlay found for ${request.type}/${request.name} — already at artifact default.`
                            : `No ${singularTypeForRepo} '${request.name}' found — nothing to delete.`,
                };
            }

            // [#23165] What is still stored at this address once this row
            // is gone, from the rows the address read already holds. Read
            // by the table drop's verdict just below and by the receipt.
            const remainingPackages = rowsAtAddress.candidates.filter((id) => id !== packageId);
            const unboundRemains = rowsAtAddress.unbound && packageId !== null;
            const remains = remainingPackages.length > 0 || unboundRemains;
            // [#23415] The table drop, decided ONCE, before anything is
            // written: an object's table goes only with its last stored
            // row. A `dropStorage` delete that would leave another row of
            // the object stored, and served over this table, is refused
            // whole — see {@link dropStorageRemainingRowsRefusal}.
            const dropsStorage = host.shouldDropStorage(request.type, request.name, request.dropStorage, targetState);
            if (dropsStorage && remains) {
                dropRefusal = host.dropStorageRemainingRowsRefusal(
                    singularTypeForRepo, request.name, packageId, remainingPackages, unboundRemains,
                );
                throw dropRefusal;
            }

            // Last-write-wins parent resolution unless the caller pinned
            // an explicit version (Studio's "Reset" button is unpinned;
            // a future "delete vN" flow can pass parentVersion).
            // [#21207] A pinned version is a caller's token, compared in
            // keyed form against the current stored head
            // (`storedParentForToken`); the repository's lock then runs on
            // the stored value. A token naming no current head throws a
            // `ConflictError`, answered by the conflict branch below.
            const parentVersion: string = typeof request.parentVersion === 'string'
                ? ((await host.storedParentForToken(ref, request.parentVersion, current.hash)) ?? current.hash)
                : current.hash;

            const result = await repo.delete(ref, {
                parentVersion,
                // #4556 — NULL, not 'system', for an actor-less delete.
                actor: request.actor ?? null,
                source: 'protocol.deleteMetaItem',
                // #5927 — was an inline `this.isArtifactBacked(...)` call
                // with these exact arguments; now reads the method-scoped
                // binding the receipts share. Same fact, one call fewer.
                // [#28412] The pair's row of a type whose D9 conditions
                // are delivered (`flow` only, {@link isPairRowRemoval})
                // is removed as the declared save wrote it: runtime-only.
                // Every other type keeps the intent main gave it.
                intent: artifactBacked && !pairRowRemoval
                    ? 'override-artifact'
                    : 'runtime-only',
                state: targetState,
                // [#23165] The row the probe read, by its key — never the
                // repository's "any package" match, which takes the first
                // row it meets.
                packageId,
                ...memberOption(member),
            });

            // Heal the registry: drop the overlay's runtime shadow so the
            // packaged artifact is visible again (all kernels), and on
            // control-plane kernels also refresh from MetadataService —
            // see {@link restoreArtifactRegistryView}. Draft discards
            // skip this: drafts never hydrate into the registry, and the
            // still-active overlay (if any) must keep its shadow.
            //
            // [#6780] SCOPED by the same organization the row was deleted with,
            // so the registry's view cannot disagree with the row's scope
            // — the sibling rule the write side states in
            // {@link applyRegistryWriteThrough}. Org A resetting ITS OWN
            // overlay used to retire the plain-key entry belonging to the
            // ENV-WIDE row, i.e. one tenant's "reset to default" blanked
            // the item for every other tenant and the control plane.
            if (targetState === 'active') {
                await host.restoreArtifactRegistryView(request.type, request.name, null, member);
            }

            // Storage teardown (opt-in): drop the now-orphaned physical table
            // for a discarded object so a publish-to-preview leaves no residue.
            // [#23415] Decided above; reached only when this was the
            // object's last stored row.
            if (dropsStorage) {
                await host.dropObjectStorage(singularTypeForRepo, request.name);
            }

            // ADR-0010 — success audit (best-effort).
            await host.recordMetadataAudit({
                type: request.type,
                name: request.name,
                organizationId: null,
                operation: 'delete',
                outcome: 'allowed',
                code: 'ok',
                ...(request.actor ? { actor: request.actor } : {}),
                source: 'protocol.deleteMetaItem',
                note: targetState,
            });

            // [ADR-0094] Awaited projection: a delete may retire the
            // derived record OR reset it to the artifact baseline — the
            // projector re-reads the layered state and decides.
            const deleteProjection = await host.runMutationProjector({
                type: singularTypeForRepo,
                name: request.name,
                state: 'deleted',
                organizationId: null,
            });
            host.emitMetadataMutation({
                type: singularTypeForRepo,
                name: request.name,
                state: 'deleted',
                organizationId: null,
                ...mutationEventMember(singularTypeForRepo, member),
            });
            const deletedPackage = packageId !== null ? ` (package=${packageId})` : '';
            return {
                success: true,
                reset: true,
                seq: result.seq,
                ...(deleteProjection ? { projectionApplied: deleteProjection } : {}),
                // #5927 — the same split #5265/PR #5926 made on the save
                // side, on the reset path. `artifactBacked` is exactly the
                // difference between the two things a delete can be:
                //
                //   • override-artifact — a code-shipped artifact sits
                //     under this (type, name). Removing the row really
                //     does lift a customization layer and really does
                //     leave the packaged default in force; the sentence is
                //     literally true and is unchanged, byte for byte.
                //   • runtime-only — nothing is underneath. The row WAS
                //     the item, and after this delete it does not exist in
                //     any layer. Telling an admin who just deleted an
                //     `object`/`flow`/`hook` they created that it was
                //     "reset to artifact default" points them at a
                //     baseline that has never existed.
                //
                // The draft leg discards a pending draft and never claimed
                // a reset, so it is unchanged. `[seq=…]` stays on every
                // branch — HMR cursors read it.
                //
                // [#23165] Both active sentences claim what is left once
                // this row is gone, and that is true only when no other row
                // of the item is stored at this address: a delete of one
                // package's row leaves another package's row, or the
                // package-less row beside it, stored and served. Then the
                // receipt names what remains instead. A delete of a
                // package's row names the package, as the save receipt
                // does; a delete of the package-unbound row with nothing
                // left reads byte for byte as before.
                //
                // [#23657] The draft discard names the package of the
                // draft it removed too, as the draft save's receipt names
                // the package it wrote into; a package-unbound draft's
                // discard reads byte for byte as before.
                message: (request.state === 'draft')
                    ? `Draft discarded${deletedPackage} — ${request.type}/${request.name}. [seq=${result.seq}]`
                    : artifactBacked
                        ? (remains
                            ? `Customization overlay deleted${deletedPackage} — ${request.type}/${request.name} still carries another overlay: ${remainingRowsPhrase(remainingPackages, unboundRemains, 'row')}. [seq=${result.seq}]`
                            : `Customization overlay deleted${deletedPackage} — ${request.type}/${request.name} reset to artifact default. [seq=${result.seq}]`)
                        : (remains
                            ? `Deleted ${singularTypeForRepo} '${request.name}'${deletedPackage}, and it still exists: ${remainingRowsPhrase(remainingPackages, unboundRemains, 'row')}. [seq=${result.seq}]`
                            : `Deleted ${singularTypeForRepo} '${request.name}'${deletedPackage} — it no longer exists. [seq=${result.seq}]`),
            };
        } catch (err: any) {
            // [#21899] The door's own verdict, not a store failure: it
            // leaves with its envelope and sentence, never re-wrapped as an
            // overlay delete that failed.
            if (
                err === originGatedRefusal
                || (addressRefusal !== undefined && err === addressRefusal)
                || (dropRefusal !== undefined && err === dropRefusal)
            ) throw err;
            if (err instanceof ConflictError) {
                // [#21207] Keyed values or none in the text and attributes.
                const conflict = await host.metadataConflictRefusal(
                    err,
                    `${request.type}/${request.name}`,
                    `${request.type}/${request.name} has been modified since you loaded it.`,
                );
                await host.recordOptimisticConflictAudit({
                    type: request.type,
                    name: request.name,
                    operation: 'delete',
                    ...(request.actor ? { actor: request.actor } : {}),
                    source: 'protocol.deleteMetaItem',
                    expectedParent: err.expectedParent,
                    actualHead: err.actualHead,
                });
                throw conflict;
            }
            // [#8136] The message quotes `err` only when `err` DECLARED
            // itself a caller-facing refusal — see {@link
            // declaresClientRefusal}. Every engine touch in the `try` above
            // (`repo.get`, `repo.delete`, `restoreArtifactRegistryView`,
            // `dropObjectStorage`, `recordMetadataAudit`, the projector)
            // can land a bare driver `Error` in this catch, and this exit
            // used to interpolate it whole.
            const e = new Error(overlayDeleteFailureMessage(err, request.type, request.name));
            (e as any).status = err?.status ?? 500;
            // The withheld text is not lost, it is relocated: `cause` is
            // what `handleRouteError` / `logWithheldServerFault` print, the
            // same posture {@link metadataStoreUnavailableError} takes.
            (e as any).cause = err;
            // [#7426] …and the SAME treatment for `code`, gated on the
            // declared vocabulary. This is the exit a control-plane
            // kernel's repository refusal leaves by — `NOT_OVERRIDABLE` /
            // 403 for a `supportsOverlay: false` type — and until now only
            // its `status` made it out. See {@link carryCatalogedErrorCode}
            // for why an unconditional copy is the wrong shape here.
            carryCatalogedErrorCode(e, err);
            // [#12536] …and the same for the mark (commit 79c46da90). A hook that
            // refused this delete in its own words wrote that text for the
            // END USER; dropping it here destroys the channel exactly the
            // way the store-unavailable wrapper used to, one exit over.
            // Only the marked field is copied — the sentence selection
            // above stays #8136's, unchanged.
            carryDeclaredUserMessage(e, err);
            throw e;
        }
    }

    // ── Legacy raw-engine path: reachable in control-plane bootstrap
    // (`environmentId === undefined`) for a code-only type — one whose
    // registry entry sets BOTH `allowEnvironmentOverlay: false` and
    // `allowRuntimeCreate: false` (today `job` and `agent`). No history
    // row, no watch event — these types don't participate in the
    // change-log model, and `SysMetadataRepository.assertAllowed()` would
    // 403 the delete outright.
    //
    // #5264 — THIS ONE IS ALIVE. `saveMetaItem` used to carry a branch of
    // the same shape; that one was deleted because #5086 (PR #5263) put an
    // unconditional code-only refusal in front of it, on every kernel.
    // The delete side was left ungated ON PURPOSE by that same PR, and the
    // asymmetry is the point: refusing to CREATE a code-only row is a new
    // guarantee, while REMOVING a code-only row that predates the refusal
    // is the repair action the guarantee depends on. Note where the gate
    // above stops — the two-tier delete authorization runs only when
    // `environmentId !== undefined`, so on a control-plane kernel a
    // code-only delete arrives here with `useRepoPath === false` and this
    // is the only code that can serve it.
    //
    // So: do not "clean up the symmetry" by deleting this the way #5264
    // deleted its twin, and do not gate it to match `saveMetaItem` —
    // either would strand the very rows #5263 made unwritable. If it ever
    // does become unreachable, the proof has to come from the delete
    // side's own gates, not from the save side's.
    const scopedWhere: Record<string, unknown> = {
        type: request.type,
        name: request.name,
    };

    try {
        // [#21908, ADR-0096 D5] The explicit system opt-in on the read and
        // the delete: a platform store row the delete door already
        // authorized the caller to remove, addressed by the protocol's own
        // `scopedWhere` and then by id. Principal-less, the engine refuses
        // both.
        const existing = await host.findEnvironmentRow('sys_metadata', { where: scopedWhere, context: { isSystem: true } });
        if (!existing) {
            return {
                success: true,
                reset: false,
                // #5927 — same split as the repository path's miss above.
                message: artifactBacked
                    ? `No customization overlay found for ${request.type}/${request.name} — already at artifact default.`
                    : `No ${singularTypeForRepo} '${request.name}' found — nothing to delete.`,
            };
        }
        await host.engine.delete('sys_metadata', { where: { id: existing.id }, context: { isSystem: true } });

        // Storage teardown (opt-in) — see the repo-path branch above.
        {
            const targetState: 'active' | 'draft' = request.state === 'draft' ? 'draft' : 'active';
            if (host.shouldDropStorage(request.type, request.name, request.dropStorage, targetState)) {
                await host.dropObjectStorage(PLURAL_TO_SINGULAR[request.type] ?? request.type, request.name);
            }
        }

        // [#6780] The legacy path deletes under the SAME org predicate it
        // built into `scopedWhere` above, so the heal reads its scope from
        // the same place. Reachable only on a control-plane kernel for a
        // code-only type, which is exactly the kernel whose registry every
        // org shares — the narrowest path and the widest blast radius.
        if (request.state !== 'draft') {
            await host.restoreArtifactRegistryView(
                request.type,
                request.name,
                null,
            );
        }

        // [ADR-0094] Awaited projection — the SAME call {@link
        // deleteMetaItem}'s repository branch already makes above
        // (`state: 'deleted'`), now made from the legacy exit too: a
        // delete may retire the derived record or reset it to the
        // artifact baseline, and the projector re-reads the layered
        // state to decide either way. Awaited BEFORE the emit below, the
        // order `saveMetaItem`'s comment establishes.
        const legacyDeleteProjection = await host.runMutationProjector({
            type: singularTypeForRepo,
            name: request.name,
            state: 'deleted',
            organizationId: null,
        });

        // [#14179] A real deletion announces itself on the ONE choke
        // point, {@link emitMetadataMutation} — the repository path's
        // row-deleted exit does, and this one performs the same removal
        // (the row goes, the storage may go, the registry view is healed)
        // for the code-only types that path cannot serve. Mirrors that
        // sibling exactly: same `state: 'deleted'`, same singular key,
        // same org scope this branch deleted under. Only the exit that
        // really removed a row emits; the row-absent miss above returns
        // before this line and stays silent, as its repository twin does.
        host.emitMetadataMutation({
            type: singularTypeForRepo,
            name: request.name,
            state: 'deleted',
            organizationId: null,
        });

        return {
            success: true,
            reset: true,
            // #5927 — same split as the repository path's success above.
            // This branch carries no `[seq=…]`: it writes no history row
            // and emits no watch event (see the block comment opening this
            // path), so there is no cursor to report. That asymmetry is
            // pre-existing and deliberate — the split does not touch it.
            ...(legacyDeleteProjection ? { projectionApplied: legacyDeleteProjection } : {}),
            message: artifactBacked
                ? `Customization overlay deleted — ${request.type}/${request.name} reset to artifact default.`
                : `Deleted ${singularTypeForRepo} '${request.name}' — it no longer exists.`,
        };
    } catch (err: any) {
        // [#8136] Same rule as the repository path's exit above — one
        // sentence-selection rule for both, so the envelope does not vary
        // by which path served the delete. This path is deliberately
        // ungated (#5264), so in practice everything reaching here is a
        // fault and nothing is quoted; the shared helper is what keeps that
        // true if a declared refusal ever does arrive.
        const e = new Error(overlayDeleteFailureMessage(err, request.type, request.name));
        (e as any).status = 500;
        (e as any).cause = err;
        // [#7426] The SECOND re-wrap exit, and it gets the same `code` rule
        // — otherwise the verb would answer an envelope that varies by
        // which path served the delete, which is harder to reason about
        // than the gap it replaced. Only refusals cannot arrive here (this
        // path is deliberately ungated, #5264), so in practice what it
        // carries is an engine code the ledger registered; the literal 500
        // stays as it is, for the reason {@link carryCatalogedErrorCode}
        // gives.
        carryCatalogedErrorCode(e, err);
        // [#12536] The second exit gets the mark carry too, for the reason
        // the `code` carry gives: the envelope must not vary by which path
        // served the delete.
        carryDeclaredUserMessage(e, err);
        throw e;
    }
}

/** The body of `ObjectStackProtocolImplementation#loadMetaFromDb`; the method's docblock there is its contract. */
export async function loadMetaFromDb(host: Pick<ProtocolHost, 'classifyObjectContribution' | 'convertStoredItem' | 'engine' | 'ensureOverlayMembersBackfilled' | 'findEnvironmentRows' | 'hydrateOverlayIntoRegistry' | 'isHostCodeDatasource' | 'isUnservedSealedOverlay' | 'overlayPackageMismatchError' | 'packagedArtifactOwner' | 'packagelessAddress' | 'reportPageRequiresAbsentAtLoad' | 'reportSealedOverlayRows' | 'resolveSduiManifest' | 'storeHydratedIntoRegistry'>): Promise<{ loaded: number; errors: number; invalid: number; storeUnavailable: boolean }> {
    let loaded = 0;
    let errors = 0;
    let invalid = 0;
    /** #5897 — see the TSDoc: set only on the non-benign outer-catch branch. */
    let storeUnavailable = false;
    // [#23298] From here on the registry takes this kernel's stored rows,
    // so a write registers its live body as this load registers each row
    // ({@link registryTakesStoredRows}). Set on the call, not on the read's
    // outcome: a store this load could not read is still the store whose
    // rows this registry takes.
    host.storeHydratedIntoRegistry = true;
    try {
        // [ADR-0131 D6/D7] The environment's rows only. The family declares
        // no organization column, so the predicate cannot name it; on a
        // database the ceremony has not migrated (an `os migrate` boot, the
        // ceremony's own among them — `os serve` refuses one) a legacy
        // organization's rows are left out off the physical column, never
        // registered as the environment's ({@link findEnvironmentRows}).
        const where: Record<string, unknown> = {
            state: 'active',
        };
        const records = await host.findEnvironmentRows('sys_metadata', { where });
        // Asked even when no row came back: the verdict on a migrated or
        // fresh store ("no column") is remembered for the process, so the
        // reads and writes after boot — some inside a transaction — never
        // need the raw seam there.
        if (records.length === 0) {
            await readLegacyOrganizationRows(
                (host.engine as { getDriverForObject?: (objectName: string) => unknown }).getDriverForObject?.('sys_metadata'),
            );
        }
        // [#22877] The table answered, so it is provisioned: give rows stored
        // before `bundle_member` existed their body's member now, before any
        // by-name read or write can address them. Hydration below reads the
        // bodies, not the column, so the order between the two is free.
        await host.ensureOverlayMembersBackfilled();
        // [#20312] ADR-0080 §5 — a page's `requires` is validated at save
        // AND at load. The deployment's manifest, read once for this load
        // through the key the save door reads per publish (one channel,
        // never a second reader), and only when a stored page is in hand.
        // It is readable here on the host that registers it: `os serve`
        // registers it before any plugin inits, and this hydration runs in
        // `ObjectQLPlugin.start()`, after every init. A host that registers
        // nothing gets `undefined` and no page is judged — the save door's
        // posture on that host, announced by the host at boot.
        const sduiManifest = (records as Array<{ type?: unknown }>).some(
            (r) => (PLURAL_TO_SINGULAR[String(r.type)] ?? r.type) === 'page',
        ) ? host.resolveSduiManifest() : undefined;
        /** [ADR-0131 D6] Overlays of sealed managed content, reported. */
        const sealedOverlays: Array<{ type: string; name: string }> = [];
        for (const record of records) {
            try {
                // Normalize DB type to singular (DB may store legacy plural forms)
                const normalizedType = PLURAL_TO_SINGULAR[record.type] ?? record.type;
                if (host.isUnservedSealedOverlay(normalizedType, String(record.name))) {
                    // [#15206] A row under a datasource name the host
                    // defines in code is named once, by the
                    // datasource-admin boot restore's warning, which
                    // carries its own remedy — not here as well.
                    //
                    // [#28771, ADR-0146 D2] …nor a row the served-override
                    // rule serves: the shipping package's declared `.custom`
                    // override IS served (and, for a flow, armed), so a line
                    // saying "no read serves them … delete the stored row"
                    // would prescribe deleting the live customization. The
                    // one predicate, on the row's `package_id` column. The
                    // census only: what this loop loads is unchanged.
                    if (
                        !host.isHostCodeDatasource(normalizedType, String(record.name))
                        && !isServedOverrideRowOf(
                            record as ServedOverrideRow,
                            host.packagedArtifactOwner({ type: normalizedType, name: String(record.name) }),
                        )
                    ) {
                        sealedOverlays.push({ type: normalizedType, name: String(record.name) });
                    }
                    if (normalizedType === 'object') continue;
                }
                const data = host.convertStoredItem(
                    String(record.type),
                    typeof record.metadata === 'string'
                        ? JSON.parse(record.metadata)
                        : record.metadata,
                );
                const verdict = computeMetadataDiagnostics(normalizedType, data);
                if (verdict && !verdict.valid) {
                    invalid++;
                    // [#16319] ⭐ THE ONE CLASS THIS POLICY NO LONGER COVERS.
                    //
                    // MAINTAINER RULING 2026-09-10 (director seat batch #111
                    // item 2): a field whose `type` is absent or is not a
                    // `FieldType` member 「应该禁止加载」, so the row does NOT
                    // register and 「Registered anyway so it stays serveable and
                    // fixable」 would be a false receipt for it. `registerObject`
                    // below throws for exactly this class and the per-record
                    // catch prints the `error`-level line naming the object, the
                    // field, the reason and the remedy — one loud statement, not
                    // this reassuring one followed by a contradiction.
                    //
                    // ⛔ The question is asked through the DOOR's own predicate,
                    // never re-derived here: a boot log with its own opinion
                    // about what the registry admits is the same two-answers
                    // defect one layer up. And ⛔ the row is not skipped here
                    // either — the refusal stays the registry's single act, so
                    // ablating the door's check makes this row register again.
                    const willRefuseFieldType =
                        normalizedType === 'object' && findUndeclarableFieldType(data) !== null;
                    if (!willRefuseFieldType) {
                        const first = verdict.errors?.[0];
                        console.warn(
                            `[Protocol] [metadata_spec_invalid] stored ${normalizedType}/${record.name} fails the ` +
                            `current spec schema even after conversion` +
                            (first ? ` (${first.path || '<root>'}: ${first.message})` : '') +
                            `. Registered anyway so it stays serveable and fixable — correct it in Studio ` +
                            `(the read carries the full _diagnostics), or delete the sys_metadata row.`,
                        );
                    }
                }
                if (normalizedType === 'object') {
                    // Every row here came from `sys_metadata` — a TENANT-authored
                    // overlay, whatever package it is bound to. Say so (ADR-0010
                    // `_provenance: 'org'`), because the package id alone reads as
                    // code provenance: registering under the real `app.<slug>`
                    // made the registry's artifact lookup claim the row was
                    // code-shipped, and `saveMetaItem`'s overlay gate then refused
                    // the very next write with `not_overridable`. An app the user
                    // had just built became un-editable at the first kernel
                    // rebuild (cloud#970).
                    //
                    // The ownership key is the row's REAL package binding
                    // (#4636 PR2). These rows come off `engine.find`, so
                    // their columns are snake_case — `package_id`, never
                    // `packageId`, exactly as `getMetaItems` and the
                    // sibling branch below already read them. Reading the
                    // camelCase key made the expression `undefined ||
                    // 'sys_metadata'`, so every boot registered even a
                    // package-bound object under the sentinel and the
                    // sidebar's `getAllObjects(packageId)` filter lost it
                    // across a restart. `||` and not `??`, symmetric with
                    // the write path's `request.packageId || 'sys_metadata'`:
                    // an empty binding is "no package", and the sentinel
                    // marks exactly that one thing.
                    //
                    // [ADR-0029 D9.8] …and the KIND is chosen, not
                    // defaulted. Registering every row as `'own'` is what
                    // made this seam replay a destruction of the packaged
                    // definition on EVERY boot, silently and with a clean
                    // `{loaded:1,errors:0,invalid:0}` receipt (#6853 P6).
                    // [D9.9] A row bound to a package that does NOT own the
                    // object throws here on purpose: the per-record catch
                    // below counts it in `errors` with its reason, which is
                    // the boot-side half of the write-path refusal.
                    const layer = host.classifyObjectContribution(
                        String(record.name),
                        (record as { package_id?: string | null }).package_id,
                    );
                    if (layer.kind === 'mismatch') {
                        throw host.overlayPackageMismatchError(
                            String(record.name), layer.packageId, layer.ownerPackageId,
                            // [#23514] The row this hydrates is stored, and so is
                            // every other package's row the way out deletes.
                            {
                                at: 'registry',
                                storedPackages: layer.ownerPackageId === 'sys_metadata'
                                    ? (await host.packagelessAddress('object', String(record.name))).candidates
                                    : [],
                            },
                        );
                    }
                    host.engine.registry.registerObject(
                        { ...(data as Record<string, unknown>), _provenance: 'org' } as any,
                        layer.packageId,
                        undefined,
                        layer.kind,
                    );
                } else {
                    // Same rule as the getMetaItems read-side hydration and
                    // the #4521 write-through — the ONE shared
                    // {@link hydrateOverlayIntoRegistry}: graft the
                    // artifact's protection envelope (ADR-0010 §3.3) with
                    // the artifact lookup scoped to the row's OWN package
                    // (ADR-0048 / #1828 / #4624). Pre-fix this branch kept
                    // a third inline copy that looked the artifact up
                    // UNSCOPED, so a name-colliding overlay grafted the
                    // first-registered package's `_lock`/`_packageId`/
                    // `_provenance` onto another package's row at boot.
                    // When artifacts load after this hydration the merge
                    // finds nothing and the row registers unchanged — same
                    // as before, scoped or not.
                    //
                    // [#6602] The org argument states what the WHERE
                    // clause above already selected for. It is a no-op
                    // today by construction — and that is the point: the
                    // rule this branch's comment states ("hydrate only
                    // env-wide rows") stops depending on a query filter
                    // staying correct, because the hydrator refuses an
                    // org-scoped row whatever selected it.
                    const hydrated = await host.hydrateOverlayIntoRegistry(
                        normalizedType,
                        data,
                        {
                            packageId: (record as { package_id?: string | null }).package_id ?? undefined,
                            // [ADR-0131 D6/D7] Filtered at the read: every row here is the environment's.
                            organizationId: null,
                        },
                    );
                    // [#20312] Reported AFTER the page has loaded, and only
                    // when it did: the report never decides whether the
                    // page loads — a page is refused at save and reported
                    // at load, never refused at load.
                    if (hydrated && normalizedType === 'page') {
                        host.reportPageRequiresAbsentAtLoad(String(record.name), data, sduiManifest);
                    }
                }
                loaded++;
            } catch (e) {
                errors++;
                if (isObjectFieldTypeRefused(e)) {
                    // [#16319] `error`, not `warn` — the AGENTS.md
                    // "Degradation log levels" question answers YES here:
                    // after this line the system looks entirely normal
                    // (boot completes, every other object is served) while a
                    // row the operator can see in `sys_metadata` is simply
                    // not part of the runtime. It owes the two things an
                    // `error` owes, in this first line: the CONSEQUENCE —
                    // the object is absent, so its table is never created or
                    // updated and every API for it answers as unknown — and
                    // the FIX, which is the ruling's own precondition that
                    // the row stay reachable: it is still readable, still
                    // writable and still deletable through the metadata
                    // API's raw-row path (`GET`/`PUT`/`DELETE
                    // /api/v1/metadata/object/<name>`), because that path
                    // reads `sys_metadata` directly and never asks the
                    // registry whether the row registered.
                    console.error(
                        `[Protocol] [metadata_field_type_refused] stored ${record.type}/${record.name} is NOT ` +
                        `registered. ${e.message} Until the row is corrected this object is absent from the ` +
                        `runtime — its table is never created or updated, and every API for it answers as ` +
                        `unknown — while the boot completes and everything else looks healthy. The row itself ` +
                        `is untouched and still reachable: correct it in Studio or with ` +
                        `PUT /api/v1/metadata/object/${record.name}, or remove it with ` +
                        `DELETE /api/v1/metadata/object/${record.name}.`,
                    );
                } else {
                    // The declared `code` is printed, not left to the prose.
                    // A LOG LINE has no envelope beside it — the `code`
                    // axis a caller reads does not exist here — so the one
                    // machine-readable token an operator can grep for has
                    // to be IN the line. Until the refusal messages stopped
                    // restating their own code, this line inherited the
                    // token by accident from the message it interpolates;
                    // now it names it deliberately, which is also what the
                    // sibling branch above already does.
                    const hydrateCode = (e as any)?.code;
                    console.warn(`[Protocol] Failed to hydrate ${record.type}/${record.name}: ${e instanceof Error ? e.message : String(e)}${typeof hydrateCode === 'string' && hydrateCode.length > 0 ? ` (code=${hydrateCode})` : ''}`);
                }
            }
        }
        // [ADR-0131 D6] Say out loud which rows this load walked past: the
        // sealed overlays above. (A legacy organization-scoped row cannot
        // be here: since C7b the column is gone, and a database still
        // holding one is refused at boot until the v18 ceremony has run.)
        host.reportSealedOverlayRows(sealedOverlays);
    } catch (e: unknown) {
        // #5841 — the ONE benign reason this whole read can fail is
        // `sys_metadata` not being provisioned yet: on a first boot, before
        // migrations execute, there genuinely are no overlay rows, so
        // `loaded: 0` IS the truth and a warning would be noise.
        //
        // Classification is by error TYPE through {@link isMissingTableError}
        // — the same predicate {@link rethrowUnlessMetadataStoreUnprovisioned}
        // asks a few thousand lines up, that `SysMetadataRepository` asks in
        // this package (#4867) and that `DatabaseLoader` asks in
        // `@objectstack/metadata` (#5108). This seam used to run its own
        // `/no such table/i` over `e.message`: a second, hand-copied
        // vocabulary of "which driver errors are benign", wrong in both
        // directions the moment the driver changes. Postgres phrases the very
        // same first boot as `relation "sys_metadata" does not exist` (and
        // sets SQLSTATE 42P01), so the regex mis-read a benign first boot as
        // an anomaly and printed a warning nobody could act on; conversely any
        // driver that says "no such table" for a different failure got read as
        // benign. One driver quirk, taught to the platform once.
        //
        // #5897 (was #5841 fact 2, closed here): every OTHER failure is a
        // read that did not happen, and it now SAYS so in the return value
        // instead of only in a console line. Before this, the shape could
        // not tell "the store had no overlay rows" from "the store could
        // not be read" — ADR-0110 D3's rule, on the boot side — so the one
        // consumer (`ObjectQLPlugin.restoreMetadataFromDb`) reported an
        // outage as `debug` "No persisted metadata found in database" and
        // the kernel went on to report ready.
        //
        // The two lines this branch and that consumer print are one event
        // at two altitudes, not a repetition: this one names the DRIVER
        // error (the detail an operator debugs with), the consumer's
        // `error` names what the outage COSTS and how to fix it. Keeping
        // the technical line here at `warn` is what lets the consumer's
        // line stay the single loud statement of consequence.
        if (!isMissingTableError(e, 'sys_metadata')) {
            storeUnavailable = true;
            console.warn(
                `[Protocol] DB hydration skipped: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }
    return { loaded, errors, invalid, storeUnavailable };
}

/** The body of `ObjectStackProtocolImplementation#findReferencesToMeta`; the method's docblock there is its contract. */
export async function findReferencesToMeta(host: Pick<ProtocolHost, 'getMetaItems'>, request: {
        type: string;
        name: string;
    }): Promise<{
        references: Array<{
            type: string;
            name: string;
            label?: string;
            path: string;
            kind: string;
        }>;
    }> {
    // [#9157] #4432 / #7894 — CANONICAL TYPE KEY. See {@link canonicalMetaType}
    // and the twin comments on {@link auditMetaItem} / {@link historyMetaItem}.
    // Third and last of the read verbs #9180 step ① routes.
    //
    // `findReferencesToMeta` serves `GET /api/v1/meta/:type/:name/references`
    // (`rest-route-ledger.ts:151`). ⚠️ What this fold buys HERE is narrower
    // than on the two verbs above, and the difference is stated rather than
    // implied because a future reader will otherwise assume symmetry:
    //
    //  • The REFUSAL is the whole wire-visible change #9157 made. `viewes`
    //    used to miss the lookup and answer 200 `{ references: [] }` — read by an
    //    operator as "nothing depends on this", immediately before the
    //    rename or delete this panel exists to gate (ADR-0110 D3). It is now
    //    400, naming `view` / `views`.
    //  • The manifest-ABSENT class changed NOTHING here at the time, and
    //    #9157 pinned that residue rather than implying it: every curated
    //    key was manifest-PRESENT, so `translations` folded to
    //    `translation` answered `{ references: [] }` exactly as
    //    `translations` had. [#9190] That residue is now CLOSED by
    //    derivation rather than by folding — `translation` has real
    //    reference sites (`doc.translations`, `book.groups[].translations`)
    //    because the walk reads the schemas that declare them. The spelling
    //    contract below is untouched; what changed is what the lookup finds.
    //
    // ⛔ Do not "improve" this by teaching the site index a plural key.
    // That is the spelling-tolerant lookup one layer down which
    // {@link canonicalMetaType} has rejected since #4432.
    request = canonicalizeMetaRequestType(request);
    // Canonical by construction from the fold above — NOT a second fold.
    const singularTarget = request.type;
    const targetName = request.name;

    // [#9327] REFUSE a target type whose addressing key no reference site
    // can hold. This is the TARGET-side sibling of #9190's
    // `unwalkableSourceTypes`, and it needed to be a sibling rather than a
    // widening: that set records a source shape that could not be READ,
    // while `field` reads perfectly, is walked as a source, and is named as
    // a target by twelve derived sites — every one of which holds a BARE
    // field name (`owner`) while this endpoint is addressed by the
    // composite key (`account.owner`). Disjoint vocabularies, so the answer
    // was `{ references: [] }` for every field, always, regardless of real
    // usage.
    //
    // ⚠️ Why this refuses on the wire instead of being recorded at build
    // time like its sibling. #9190 could move its discriminator OFF the
    // response because the gap it records is BOUNDED — some answers get
    // shorter. This gap is TOTAL: every answer for the type is empty, and
    // the admin "Used by" panel renders that, verbatim, as "Nothing in the
    // metadata graph points at this item. Safe to delete." A constant in a
    // build does not reach the operator standing in front of that sentence,
    // so recording it would leave the destructive clearance exactly where
    // #8896 and ADR-0110 D3 say it must not be.
    //
    // ⛔ NOT the response-shape discriminator #9190 fenced to the spec seat.
    // Nothing is added to the 200 body; this reuses the ADR-0112 nested
    // envelope and the SAME `501 NOT_IMPLEMENTED` code the sibling refusal
    // on this exact route already returns when the protocol cannot compute
    // the graph at all (#9326). One route, one dialect for "the question
    // was never asked".
    //
    // The message is prescriptive per ADR-0110 D3: it names the answerable
    // question, because a field's dependents ARE reachable — through the
    // object that owns it, which is where a field is authored and where the
    // reference graph has real edges.
    //
    // [#17584] ⛔ And the prescription comes FIRST, before the explanation
    // of why the question is unanswerable. That order is load-bearing, not
    // style. Since #16146 this refusal crosses the REST boundary through
    // `boundedDeclaredRefusalMessage`, which applies #5423's shared
    // `CLIENT_MESSAGE_MAX` (500) by TRUNCATING THE TAIL — and that helper's
    // own docblock declares the assumption it rests on: "These messages
    // front-load the main clause … and back-load attribution and issue
    // numbers, which belong in the log rather than the response."
    //
    // This sentence interpolates the object name twice (inside `targetName`
    // and again as `owner`) and the field name once, so it grows ~3
    // characters per character of name. Back-loaded, it broke that
    // assumption at reachable lengths: measured through the real route, a
    // 37/37 object/field pair composed 502 characters and was delivered as
    // `…/api/v1/meta/object/<obj>/referenc…` — the opener still readable and
    // the URL cut mid-path, which is an instruction that 404s if the
    // operator follows it. `crm_opportunity_line_item_snapshot_v2` is 37
    // characters, and nothing in `packages/spec` caps a metadata name at
    // all (commit 3a04b0125: the ceiling is the storing column's `maxLength`, and the
    // widest is `sys_metadata.name` at 255).
    //
    // Front-loaded, truncation costs the EXPLANATION instead — the half an
    // operator can still act without. ⛔ Do not reorder this back, and ⛔ do
    // not repair a future overflow by raising the bound or exempting this
    // door: the bound is the security floor under the refusal channel
    // (#5423) and the #16146 ruling put this door explicitly under it. The
    // invariant is pinned at the WIRE, where the bound actually applies, by
    // `rest-server-meta-references-refusal-envelope.test.ts` — and the
    // producer-side ORDER by `protocol.reference-target-unanswerable.test.ts`.
    //
    // ⛔ And it opens with NO bracketed tag — as no refusal this file raises
    // does any more. The lowercase `[item_locked]`-style openers this producer
    // once wrote were restatements of the throw's OWN declared `code`, so the
    // wire already carried the same token on the `code` axis; they are gone,
    // and `protocol.bracketed-refusal-opener-absence.test.ts` pins their
    // absence across the whole family. #12975 (2026-08-29) rules that `error` is HUMAN
    // LANGUAGE while `code` is the MACHINE TOKEN, and since #15685 this prose
    // reaches the operator VERBATIM — so an opener is the first thing they
    // read. What separates this refusal from the route's other 501 is the
    // sentence itself, not a tag. Its absence is pinned here too, by
    // `protocol.reference-target-unanswerable.test.ts`.
    if (REFERENCE_SITES.unanswerableTargetTypes.includes(singularTarget)) {
        const owner = targetName.includes('.') ? targetName.slice(0, targetName.indexOf('.')) : '<object>';
        const err = new Error(
            `Ask the owning object instead: GET /api/v1/meta/object/${owner}/references. `
            + `References to a '${singularTarget}' item cannot be computed, because `
            + `a '${singularTarget}' is addressed by the composite key '<object>.<field>' `
            + `(here '${targetName}'), while every metadata property that names a field holds the `
            + `BARE field name — so no reference site can ever match this key and an empty answer `
            + `would mean "not computable", not "nothing depends on it".`,
        );
        (err as any).code = 'NOT_IMPLEMENTED';
        (err as any).status = 501;
        // [#16146] The producer-side declaration ruled by decision batch #58
        // (2026-09-06, option C): `ApiErrorSchema.refusal` says "the 5xx I
        // declared is a deliberate REFUSAL whose `message` is authored for
        // the caller", so the boundary keeps that message instead of
        // withholding it as a fault. THIS is the throw the ruling names —
        // the sentence three lines up is prescriptive per ADR-0110 D3 and
        // reached the wire as "Internal server error" until a route-local
        // patch caught it one route down. Setting it here is what retires
        // that patch's refusal/fault opinion: the transport now reads what
        // the protocol DECLARED instead of matching this route's literals.
        //
        // ⛔ Platform and driver code never sets this on a fault, and no
        // rewrap in this file carries it — a refusal crossing the
        // overlay-delete rewraps is withheld as a fault, deliberately.
        (err as any).refusal = true;
        throw err;
    }

    const sites = REFERENCE_SITES.byTarget.get(singularTarget) ?? [];
    // [#23539] Sites that name the target in the HEAD of a composite record
    // key — a permission set's `fields`, keyed `<object>.<field>`, for target
    // `object` and nothing else. They live in their own map, never in
    // `byTarget`, because `duplicatePackage` reads `byTarget.get('object')` as
    // a flat set of object-naming property names (see
    // COMPOSITE_KEY_REFERENCE_SITES in `./reference-sites.ts`). Without them a
    // set whose only rule for an object was a field rule was missing here,
    // and the "Used by" panel could clear that object for deletion.
    const compositeSites = REFERENCE_SITES.compositeKeyByTarget.get(singularTarget) ?? [];
    if (sites.length === 0 && compositeSites.length === 0) {
        return { references: [] };
    }

    // One read per source type, not one per site: several properties of the
    // same source type routinely name the same target, and the previous
    // shape re-read the store once per matcher row.
    const propertiesByFromType = new Map<string, Map<string, string>>();
    for (const site of sites) {
        let properties = propertiesByFromType.get(site.fromType);
        if (!properties) {
            properties = new Map<string, string>();
            propertiesByFromType.set(site.fromType, properties);
        }
        properties.set(site.property, site.target);
    }
    // Composite-key sites share that one read: property → separator, per
    // source type, and a source type they alone name still gets its matcher.
    const separatorsByFromType = new Map<string, Map<string, string>>();
    for (const site of compositeSites) {
        let separators = separatorsByFromType.get(site.fromType);
        if (!separators) {
            separators = new Map<string, string>();
            separatorsByFromType.set(site.fromType, separators);
        }
        separators.set(site.property, site.separator);
        if (!propertiesByFromType.has(site.fromType)) propertiesByFromType.set(site.fromType, new Map());
    }
    const matchers = [...propertiesByFromType].map(([fromType, properties]) => ({
        fromType,
        properties,
        separators: separatorsByFromType.get(fromType),
    }));

    const seen = new Set<string>(); // dedup key: `${fromType}|${itemName}|${path}`
    const out: Array<{ type: string; name: string; label?: string; path: string; kind: string }> = [];

    // Walk distinct source types in parallel.
    await Promise.all(
        matchers.map(async (matcher) => {
            // [#8896] NO `catch` here, deliberately — the discrimination
            // this seam owes already happened one layer down, and the
            // `catch { return; }` that used to sit here threw it away.
            //
            // `getMetaItems` classifies its own read failures through
            // {@link rethrowUnlessMetadataStoreUnprovisioned}: the one
            // benign reason (`sys_metadata` not provisioned yet) returns
            // normally with whatever the registry holds, and every other
            // failure becomes a 503 `SERVICE_UNAVAILABLE` carrying the
            // driver error as `cause` (#5532). A source type absent from
            // this deployment is not an error at all — `listItems` answers
            // `[]`. So the only thing the old `catch` could swallow was the
            // 503 raised on purpose immediately below it, and swallowing it
            // silently shrank `out[]`.
            //
            // That is the worst place in this file to shrink an accumulator
            // quietly: this answer drives "what would break if I delete
            // this", rendered as the admin UI's "Used by" panel before a
            // rename / delete / type-narrowing. An empty or short list is
            // read as "nothing depends on it — safe to remove", so a source
            // type whose read failed turned an unanswerable question into a
            // green light for a destructive action (ADR-0110 D3).
            //
            // `Promise.all` is what makes propagation right-shaped here: the
            // first rejection rejects the whole scan, so no half-scanned
            // `references` array can reach a caller. No new response field
            // and no new error code — the 503 the store read already raised
            // is what surfaces.
            const result = await host.getMetaItems({
                type: matcher.fromType,
            });
            const items = (result?.items ?? []) as unknown[];
            for (const raw of items) {
                if (!raw || typeof raw !== 'object') continue;
                const sourceName = (raw as any).name as string | undefined;
                if (!sourceName) continue;
                // Don't list an item as a reference to itself unless the
                // self-reference is meaningful (e.g. object→field path).
                const isSelfReference = matcher.fromType === singularTarget && sourceName === targetName;
                const hits = collectReferenceHits(raw, matcher.properties, targetName);
                if (matcher.separators) hits.push(...collectCompositeKeyHeadHits(raw, matcher.separators, targetName));
                for (const { path, property } of hits) {
                    // An item naming ITSELF through a scalar property is
                    // the item, not a dependent. Collection-valued paths
                    // are kept, because an item that lists itself among
                    // many (an object's own field pointing back at it) is
                    // a real edge an admin needs to see before a delete.
                    if (isSelfReference && !path.includes('[]') && !path.includes('{}')) continue;
                    const key = `${matcher.fromType}|${sourceName}|${path}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const label = (raw as any).label as string | undefined;
                    // `kind` is a human label for the edge, derived from the
                    // property that produced it rather than hand-written per
                    // row — a curated label is the same maintenance debt as
                    // a curated path, one field over.
                    out.push({
                        type: matcher.fromType,
                        name: sourceName,
                        ...(label ? { label } : {}),
                        path,
                        kind: `${matcher.fromType} ${property}`,
                    });
                }
            }
        }),
    );

    // Stable sort: by type, then by name.
    out.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

    return { references: out };
}
