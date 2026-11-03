// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E2 cut 1b] The item reads of `ObjectStackProtocolImplementation`:
 * `getMetaItem` and `getMetaItemForExecution` (one item, as the `/meta` item
 * route and the runtime read it) and `readMetaItem`, the private read both
 * share.
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as it stood, re-indented one level, with `this.<member>`
 * read as `host.<member>` and nothing else changed
 * (`node scripts/host-split.mjs check <base> <member> protocol-meta-item-reads.ts`
 * proves it). Each method stays on the class with its docblock and signature,
 * which the published `.d.ts` prints, and hands its body the host
 * (`protocol-host.ts`).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { itemDiscriminator } from '@objectstack/metadata-core';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
// [#24395] The draft row's per-key provenance, read back for the strict draft read.
import { storedDraftChanges } from './draft-changes.js';
import { type StoredOverlayRow, resolveItemLock, storedRowDocument } from './item-lock.js';
import {
    type MetadataDiagnostics,
    computeViewReferenceDiagnostics,
    decorateMetadataItem,
    withFormLayoutWarnings,
    withPublishVerdict,
} from './metadata-diagnostics.js';
import { noPendingDraftError } from './protocol-authoring-refusals.js';
import {
    bundleMemberDiscriminator,
    memberOption,
    resolveBundleMemberSelector,
} from './protocol-bundle-members.js';
import { packagelessContentPackage } from './protocol-environment-rows.js';
import type { ProtocolHost } from './protocol-host.js';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import {
    bundleMemberOf,
    envelopePackageId,
    mergeArtifactProtection,
    withRowBinding,
} from './protocol-package-bindings.js';
import type { ServedOverrideRow } from './served-override.js';

/** The body of `ObjectStackProtocolImplementation#getMetaItem`; the method's docblock there is its contract. */
export async function getMetaItem(host: Pick<ProtocolHost, 'readMetaItemFace'>, request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        /** [#22877] The bundle member to read — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
        member?: string,
    }) {
    // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. Folded
    // HERE, at each face's boundary, as {@link getMetaItems} folds.
    return host.readMetaItemFace(canonicalizeMetaRequestType(request), 'served');
}

/** The body of `ObjectStackProtocolImplementation#getMetaItemForExecution`; the method's docblock there is its contract. */
export async function getMetaItemForExecution(host: Pick<ProtocolHost, 'readMetaItemFace'>, request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        /** [#22877] The bundle member to read — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
        member?: string,
    }) {
    // The same #4432 fold {@link getMetaItem} applies, for the same reason.
    return host.readMetaItemFace(canonicalizeMetaRequestType(request), 'execution');
}

/** The body of `ObjectStackProtocolImplementation#readMetaItem`; the method's docblock there is its contract. */
export async function readMetaItem(host: Pick<ProtocolHost, 'artifactLockLayerAt' | 'convertStoredItem' | 'declinesStoredRow' | 'draftPublishVerdict' | 'engine' | 'findPairAddedMemberRow' | 'findServedOverlayRow' | 'foldObjectExtendersFromRegistry' | 'governServedObject' | 'isArtifactBacked' | 'isStoredFlowEntryOfShippedName' | 'lookupArtifactItem' | 'overlayLockLayerAt' | 'packagelessAddress' | 'readItemActiveRows' | 'readItemFromMetadataService' | 'readVersionToken' | 'registryMemberServedAt' | 'resolveAppPackageIdKey' | 'resolveCascadeDeleteObjects' | 'resolveDisabledActionsReader' | 'resolveFlowRegistrationReader' | 'resolveRowlessExpandedView' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'servedLockState' | 'shippedArtifactsOf' | 'strictDraftReadAddress' | 'throwMetadataServiceUnavailable'>, request: {
        type: string, name: string, packageId?: string, state?: 'active' | 'draft', previewDrafts?: boolean,
        member?: string,
    }, opts: { face?: 'served' | 'execution' } = {}) {
    // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}.
    request = canonicalizeMetaRequestType(request);
    // [#23183] ADR-0048 §3.1: the app read keyed by PACKAGE ID, resolved
    // ONCE, here, to the package's one app read by its own name in that
    // package, so every step below (the stored row, the lock, the version
    // token) reads the app exactly as its by-name read does. See
    // {@link resolveAppPackageIdKey}.
    request = await host.resolveAppPackageIdKey(request);
    // [#22877] Ruling 6116165299 (Q2 i): ONE member of a bundled type is
    // addressed by name, the selector's or else the canonical one. Every
    // layer below answers that member or nothing — the stored row, the
    // code layer's member and the registry's.
    const member = resolveBundleMemberSelector(request.type, request.member);
    const wantedMember = bundleMemberDiscriminator(request.type, member);
    const isWantedMember = (candidate: unknown): boolean =>
        wantedMember === undefined || itemDiscriminator(request.type, candidate) === wantedMember;
    let item: unknown;
    // [ADR-0131 D6] Environment → code: the environment's stored row,
    // else the code packages' definition. No organization's row is read —
    // a legacy organization-scoped row is refused at boot
    // (the v18 boot refusal, ADR-0131 D10 item 5) and never served.
    // Studio's editor opens a draft buffer with `state: 'draft'`;
    // runtime loaders omit it and get the live published row.
    const readState: 'active' | 'draft' = request.state === 'draft' ? 'draft' : 'active';
    // [#24535] The serving decorations at this read's exits are the ONE
    // thing the two API faces do not share. The served face (and an
    // authoring caller) decorates as before; the execution face hands the
    // governed item back as resolved ({@link getMetaItemForExecution}).
    // Every read of `execution` below is one of those exits.
    const execution = opts.face === 'execution';
    const serveItem = <T>(resolved: T): T => (execution ? resolved : decorateMetadataItem(request.type, resolved));
    // [#29196] A served VIEW's `_diagnostics` also carries the lint's
    // `form-field-unknown` warnings ({@link withFormLayoutWarnings}), judged
    // against the object the registry serves for each name the view spells.
    // Applied at every served exit of this read, the draft ones included; a
    // warning, so `valid` is left as the schema answered it. The execution
    // face serves no `_diagnostics`.
    const serveFormLayout = <T>(served: T): Promise<T> => (execution
        ? Promise.resolve(served)
        : withFormLayoutWarnings(request.type, served, (name) => host.engine?.registry?.getObject?.(name)));
    // [#26707] A served DRAFT is decorated as above and then told what its
    // publish would refuse: the runtime gate's verdict on the stored draft
    // body ({@link draftPublishVerdict}), folded into `_diagnostics`
    // ({@link withPublishVerdict}). Handed the row as stored — the body the
    // promotion reads, and [#29557] converts for its verdict exactly as the
    // promotion does — never the governed, converted or redacted copy this
    // read serves. The execution face serves no `_diagnostics`.
    const serveDraft = async <T>(resolved: T, row: { metadata?: unknown; package_id?: string | null }): Promise<T> => {
        const served = await serveFormLayout(serveItem(resolved));
        if (execution || !served || typeof served !== 'object') return served;
        const issues = await host.draftPublishVerdict({
            type: request.type,
            name: request.name,
            body: storedRowDocument(row),
            packageId: row.package_id ?? null,
        });
        const before = (served as { _diagnostics?: MetadataDiagnostics })._diagnostics;
        const after = withPublishVerdict(request.type, request.name, before, issues);
        return after === before ? served : { ...served, _diagnostics: after };
    };
    // ── [#20946, #20761 ruling rule 1, ADR-0126 §2 / §3] A shipped FLOW name ──
    //
    // `flow` is Regime C: the packaged base is locked, "⛔ Never silent
    // override, never an overlay read path". Since #20913 the flattened view
    // ({@link readFlattenedMetaItems}, both faces) serves a flow name the
    // loader's set holds from the loader's own entries alone, with two
    // predicates. This read applies the SAME two, and ⛔ no third precedence
    // path of its own:
    //  • the stored-row half, {@link isShippedFlowName}, judged by NAME —
    //    step 1 below does not adopt the stored row of such a name, whatever
    //    its package binding or the stamps its own body carries;
    //  • the registry half, {@link isStoredFlowEntryOfShippedName} — step 3
    //    does not serve the registry's bare copy of that row (the hydrated
    //    tenant row `getItem` answers first); the loader's entry is served.
    // Adopted, the row was served with the artifact's protection envelope
    // grafted over it (the merge at the end of this method): a stored body
    // answered as the package's definition by name, while the list answered
    // the loader's body for the same name.
    //
    // Scoped to the ACTIVE read. A draft is answered as a draft (the strict
    // `state: 'draft'` read and the `previewDrafts` arm), never under the
    // artifact's envelope, and the list's own preview arm is equally
    // unfiltered. Organization-scoped rows never reach this read
    // (ADR-0131 D6). What becomes of the stored rows themselves (keep, refuse, migrate) is
    // not decided here.
    //
    // ── [#21922, ADR-0062 D4, ADR-0126 §3] A code-defined DATASOURCE name ──
    //
    // The stored-row half covers a second name class, through the same
    // predicate ({@link declinesStoredRow}): a datasource name the host
    // registers from code ({@link isDeclaredCodeDatasource}). "Code wins on
    // collision": its code definition is the MetadataService's in-memory
    // registration, which step 2 serves, and a stored row under the name is
    // residue, never a layer of it. Adopted, the row was served here while
    // the list, the admin door and the boot restore all served the code
    // definition. This read needs no registry half for it: step 2 answers
    // before step 3's bare registry slot, which is where a hydrated copy of
    // the row sits. The row is still FOUND (`storedRowServed` below), so the
    // `/meta` DELETE that removes it as repair stays `deletable`. A draft
    // is answered as a draft, as above.
    const storedRowDeclined = readState === 'active' && host.declinesStoredRow(request.type, request.name);

    // [#23291, ADR-0048 §3.3, ADR-0070 TL;DR 1] The package whose stored
    // content a read that names no package serves: the address a save or
    // a delete naming none writes ({@link packagelessAddress}), read from
    // the item's ACTIVE rows at both states, as the draft save inherits
    // its package from them (#11087). For an item bound to exactly one
    // package, the read then serves what the read naming that package
    // serves (its own row, else the package-less one); otherwise any row,
    // the best-effort first match ADR-0048 §3.3 states.
    //
    // Before, it took the first row of any package. A save naming the
    // package beside the item's package-unbound row mints the package's
    // row and leaves the unbound one stored first, so this read kept
    // serving the unbound body while the package-less save wrote the
    // package's row, the package-less delete removed it, the list served
    // it, and this read's own `version` named it (#23165). The package-less
    // row is not converted or removed: ADR-0070 keeps it as a read-side
    // detail and a migration source, and it still stands in for every
    // package with no row of its own (ADR-0048 prefer-local).
    //
    // Content only: the lock is selected from the item's rows at the
    // address the `_lock` gate judges a package-less save at, below.
    //
    // [#23715, ADR-0048, ADR-0070 TL;DR 1] The strict draft read that names
    // no package takes its content from the draft its `version` names
    // ({@link strictDraftReadAddress}), the address the draft save, the
    // per-item publish and the draft discard naming none act on. The
    // active rows above say nothing about an item never published into a
    // package, so with drafts `[package-unbound, Q]` this read served the
    // first draft row the store returned under the package-unbound
    // draft's token, and a save pinned to that token wrote a row other
    // than the one read (#8907). The draft-overlay preview below shares
    // the address: it serves the draft the strict read serves.
    const draftContentAddress = !request.packageId && (readState === 'draft' || request.previewDrafts)
        ? await host.strictDraftReadAddress(request.type, request.name, member)
        : undefined;
    // [#24371] The item's ACTIVE rows, both spellings, read ONCE
    // ({@link readItemActiveRows}): the package-less binding, the served
    // row and the lock below each select from them by the `where` it would
    // have sent the store. They were five serial reads of the same rows,
    // on every `/data` request. [#10757 leg 6] On the API faces (served and,
    // [#24535], execution) the read goes through the overlay cache; an
    // authoring read is never kept.
    let activeRows: StoredOverlayRow[] | undefined;
    if (readState === 'active') {
        try {
            activeRows = await host.readItemActiveRows(request.type, request.name, opts.face !== undefined);
        } catch (error) {
            // [#5532] Only an unprovisioned store holds no row; any other
            // failure is a read that did not happen, never "no row".
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
            activeRows = [];
        }
    }
    // The package-less binding ({@link packagelessReadAddress}'s), selected
    // from those rows; the `version` below ({@link readVersionToken})
    // takes the same binding instead of reading it again.
    const packagelessAddressed = readState === 'active' && !request.packageId
        ? await host.packagelessAddress(
            PLURAL_TO_SINGULAR[request.type] ?? request.type, request.name, member, 'active', activeRows,
        )
        : undefined;
    const packagelessBinding = packagelessAddressed?.packageId;
    // [#28238] The content, though, is {@link packagelessContentPackage}'s:
    // the code package that ships the name is a candidate too, so a row
    // another package stored under the name is not served for it.
    const contentPackageId = request.packageId || (packagelessAddressed
        ? packagelessContentPackage(packagelessAddressed, host.shippedArtifactsOf(request.type, request.name))
        : undefined);

    // ADR-0033 draft-overlay preview (non-strict): when the caller opts in
    // (admin-gated upstream), prefer a `state='draft'` row if one exists, else
    // fall back to the active read below. This differs from the strict
    // `state:'draft'` mode, which 404s (`no_draft`) when no draft exists — the
    // render path must degrade to the published value, not error. The draft
    // item is tagged `_draft:true` so the UI can badge it.
    if (request.previewDrafts && readState !== 'draft') {
        try {
            // [#21716] The served-row resolution, on the draft partition
            // (ADR-0048 prefer-local, parity with the row read below) — see
            // {@link findServedOverlayRow}.
            // [#28409] A preview serves the package's name, so the
            // pending edit of its declared override is a candidate
            // ({@link servedOverlayRowCandidates}' `servedOverride`), as
            // in the list's draft-preview merge.
            const servedDraft = await host.findServedOverlayRow({
                type: request.type,
                name: request.name,
                state: 'draft',
                ...(draftContentAddress
                    ? { packageId: draftContentAddress.packageId }
                    : contentPackageId !== undefined ? { packageId: contentPackageId } : {}),
                ...memberOption(member),
                servedOverride: true,
            });
            let draftRec = servedDraft?.row;
            // [#23715] Two or more packages and no package-unbound draft:
            // the best-effort first match, as the strict read below.
            if (!draftRec && draftContentAddress?.bestEffort) {
                draftRec = (await host.findServedOverlayRow({
                    type: request.type, name: request.name, state: 'draft', ...memberOption(member),
                }))?.row;
            }
            if (draftRec) {
                const draftItem = host.convertStoredItem(
                    String(draftRec.type ?? request.type),
                    typeof draftRec.metadata === 'string'
                        ? JSON.parse(draftRec.metadata)
                        : draftRec.metadata,
                ) as any;
                let previewed = draftItem;
                if (previewed && typeof previewed === 'object') {
                    const recPkg = (draftRec as { package_id?: string | null }).package_id ?? undefined;
                    // [#28409] A declared override's draft previews as the
                    // overridden package's item, as its active row serves.
                    if (servedDraft?.overrideOf !== undefined && servedDraft.row === draftRec) {
                        previewed = { ...previewed, _packageId: servedDraft.overrideOf };
                    } else previewed = withRowBinding(previewed, recPkg); // [#28673] the column's package
                    (previewed as any)._draft = true;
                }
                return {
                    type: request.type,
                    name: request.name,
                    item: await serveDraft(host.governServedObject(request.type, previewed), draftRec),
                };
            }
        } catch (error) {
            // [#5532] Falling through to the active read here would answer
            // "there is no draft for this item" from a read that never
            // reached the table the drafts live in.
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        }
    }

    // 1. Customization overlay lookup (sys_metadata): the environment's
    //    row (ADR-0131 D6/D7: {@link findEnvironmentRow}) before falling
    //    through to the in-memory registry / MetadataService.
    //    ADR-0048 prefer-local (a package id prefers that
    //    package's row, then the package-less one, mirroring
    //    `SchemaRegistry.getItem(type, name, pkg)`). [#21716] The ONE
    //    served-row resolution — see {@link findServedOverlayRow}. It
    //    decides the CONTENT only; the lock is selected below from this
    //    read's address ([#21761]).
    // [#21899] Whether a stored row was found — the fact the origin-gated
    // repair's `deletable` reads ({@link servedLockState}).
    let storedRowServed = false;
    // [#24395] The served draft row's per-key provenance — read off the
    // row this read serves, so it can never describe another body.
    let draftChanges: ReturnType<typeof storedDraftChanges>;
    // [#26707] The draft row this read serves, for its publish verdict.
    let servedDraftRow: { metadata?: unknown; package_id?: string | null } | undefined;
    try {
        // [#28409, ADR-0146 D8 item 2] The active read serves the
        // package's name, so its declared override is the first candidate
        // ({@link servedOverlayRowCandidates}' `servedOverride`). The
        // strict draft read answers the address a draft save writes, never
        // the pair's: it asks without it.
        const served = await host.findServedOverlayRow({
            type: request.type,
            name: request.name,
            state: readState,
            ...(readState === 'draft' && draftContentAddress
                ? { packageId: draftContentAddress.packageId }
                : contentPackageId !== undefined ? { packageId: contentPackageId } : {}),
            ...memberOption(member),
            ...(readState === 'active' ? { servedOverride: true } : {}),
        }, activeRows);
        let record = served?.row;
        // [#28802, #28390 ruling A] A member of a bundle the address's
        // package ships and does not ship at that member: the pair's own
        // added member is the address's, served from the pair's row under
        // the pair's binding (a dependent's member never is).
        if (!record && readState === 'active' && wantedMember !== undefined && typeof contentPackageId === 'string') {
            record = await host.findPairAddedMemberRow(request.type, request.name, contentPackageId, member, wantedMember, activeRows);
        }
        // [#23715] Two or more packages and no package-unbound draft: the
        // best-effort first match ADR-0048 §3.3 states, as before, served
        // with `version: null` (no row at the address the save naming none
        // resolves, and that save is refused there).
        if (!record && readState === 'draft' && draftContentAddress?.bestEffort) {
            record = (await host.findServedOverlayRow({
                type: request.type,
                name: request.name,
                state: readState,
                ...memberOption(member),
            }))?.row;
        }
        storedRowServed = record !== undefined && record !== null;
        // [#20946, #21922] The stored-row half — see `storedRowDeclined` above.
        // [#28412, ADR-0146 D9 item 1] Judged again on the row itself when
        // the name declines: a shipped flow name's declared override, the
        // row {@link findServedOverlayRow} serves first, is the packaged
        // flow, served as the list's slot serves it ({@link declinesStoredRow}).
        if (record && !(storedRowDeclined && host.declinesStoredRow(request.type, request.name, record as ServedOverrideRow))) {
            item = host.convertStoredItem(
                String(record.type ?? request.type),
                storedRowDocument(record),
            );
            // Surface the persisted software-package binding (parity with
            // the list path in getMetaItems) so provenance/UI can read it.
            const recPkg = (record as { package_id?: string | null }).package_id ?? undefined;
            if (served?.overrideOf !== undefined && served.row === record && item && typeof item === 'object') {
                // [#28409] A declared override is served as the package's
                // item it overrides, as the list's slot serves it: under
                // that package's provenance, so the envelope below is the
                // overridden package's artifact's ({@link envelopePackageId}).
                item = { ...(item as Record<string, unknown>), _packageId: served.overrideOf };
            } else {
                // [#28673] The column's package, and only the column's ({@link withRowBinding}).
                item = withRowBinding(item, recPkg);
            }
            if (readState === 'draft') {
                draftChanges = storedDraftChanges((record as { draft_changes?: unknown }).draft_changes);
                servedDraftRow = record as { metadata?: unknown; package_id?: string | null };
            }
        }
    } catch (error) {
        // [#5532] THE site this issue was raised on. Falling through to the
        // registry / MetadataService with `item` still `undefined` is what
        // let a storage outage arrive at the client as `not found` (active
        // read) or `NO_DRAFT` (draft read) — both of them claims about
        // authorship, made from a read that never happened.
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }

    // Draft reads stop here — they intentionally do NOT fall through
    // to the runtime registry / MetadataService (which only know
    // about published values). When the draft row is missing we
    // throw `no_draft` (HTTP 404) so the REST contract is identical
    // to `POST /publish` on an empty slot: clients use a single
    // status code to decide "no pending edit" without sniffing
    // envelope shape. See ADR-0005 §draft-lifecycle.
    if (readState === 'draft') {
        if (item === undefined) throw noPendingDraftError(request.type, request.name);
        const governedDraft = host.governServedObject(request.type, item);
        return {
            type: request.type,
            name: request.name,
            item: servedDraftRow ? await serveDraft(governedDraft, servedDraftRow) : await serveFormLayout(serveItem(governedDraft)),
            // [#22114] The draft row's version token — the one a draft save
            // (`?mode=draft`) at this address accepts as `If-Match`.
            // [#22877] The member's own row's, as a save of that member's
            // body addresses it.
            version: await host.readVersionToken({ ...request, member }, 'draft'),
            // [#24395] `GetMetaItemResponseSchema.draftChanges`: present
            // only when the draft row's saves recorded at least one entry
            // — ⛔ never `[]` for a row that recorded none.
            ...(draftChanges ? { draftChanges } : {}),
        };
    }

    // [#21761] The item-lock resolution's `overlay` layer, selected from
    // this read's ADDRESS ({@link overlayLockLayerAt}) by the selection
    // the `_lock` gate makes: the strictest lock among the item's stored
    // rows in scope, whichever package each is bound to. Not the row served
    // above, which is the address's preferred CONTENT (ADR-0048), and read
    // whether or not that row is adopted (a shipped flow name, #20946, and a
    // code-defined datasource name, #21922, do not serve their stored row,
    // and the gate binds it all the same).
    let overlayLockLayer: unknown;
    try {
        overlayLockLayer = await host.overlayLockLayerAt({
            type: request.type,
            name: request.name,
            packageId: request.packageId,
        }, { otherSpelling: true }, activeRows);
    } catch (error) {
        // [#5532] The same rule as the row read above: a lock read that did
        // not happen is not an unlocked item.
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }

    // [#8027] An OBJECT's overlay row is a BASE LAYER, not a resolved
    // schema. ADR-0029 D9.2 defines the resolution as `overlay ?? own` with
    // the `extend` contributors folded ON — which is what
    // `SchemaRegistry.resolveObject` does for an overlay it knows about, and
    // what step 2 below already does (#7556) for the MetadataService copy.
    // Step 1 was the one adopter that served its layer verbatim, so a single
    // customisation row — an admin renaming the object's label in Studio —
    // silently dropped every extension-contributed field from this read, and
    // therefore from every writable form derived from it, while the data API
    // kept accepting and persisting those same fields.
    //
    // Placed AFTER the draft return on purpose: a draft is a pending edit of
    // the base layer, and folding it would show an author extension fields
    // inside the document they are editing and about to PUT back. Drafts were
    // never folded (before #7556 nothing was), so this leaves that asymmetry
    // exactly where it already was rather than widening this fix into it.
    //
    // No-op for every type but `object`, for an object nothing extends, and
    // for an item with no overlay row (`item` is still undefined here, and
    // step 2 / step 3 fold their own sources).
    if (item !== undefined) {
        item = host.foldObjectExtendersFromRegistry(request.type, request.name, item);
    }

    // 1b. [#21442] A view name with no stored row of its own that a stored
    //     view container in this caller's scope EXPANDS — the item the
    //     object door (`GET /meta/view?object=`) lists under this name,
    //     resolved by {@link resolveRowlessExpandedView} through the list
    //     read's own selection and expansion. Placed before steps 2 and 3
    //     because the list read's expansion wins over the MetadataService
    //     and registry items of the same name too; there, a name a package
    //     ships (`<object>.default` under a tenant overlay of that package's
    //     container) answered the packaged row while the list served the
    //     expansion, and on an unscoped kernel a hydrated registry copy
    //     answered only for an environment-wide container. ⛔ No
    //     kernel-specific branch: every kernel answers here.
    if (item === undefined) {
        const expanded = await host.resolveRowlessExpandedView(request);
        if (expanded !== undefined) item = expanded.item;
    }

    // 2. MetadataService (runtime-registered items: HMR-updated view/page/
    //    dashboard/agent/tool, plus FilesystemLoader-sourced items). This
    //    is consulted BEFORE the in-memory SchemaRegistry because the
    //    registry is a boot-time cache populated by `loadMetadataFromService`
    //    and is NOT invalidated on `MetadataManager.register()` (which is
    //    how the CLI dev watcher pushes recompiled metadata into the
    //    running server). Without this ordering, edits to `*.view.ts`
    //    source files appear to take effect (MetadataManager learns the
    //    new value) but reads continue to return the stale registry copy.
    // [#5840] `serviceDegraded` survives past the registry step below on
    // purpose — see the branch that reads it after step 3 for why the
    // verdict cannot be acted on here.
    let serviceDegraded: { degraded: boolean; errors: string[] } | undefined;
    if (item === undefined) {
        try {
            // Threads the caller's package id (ADR-0048) so a single-item
            // fetch is package-scoped: when two installed packages ship the
            // same type/name, the facade prefers the requester's own item.
            const fromService = await host.readItemFromMetadataService(
                request.type,
                request.name,
                request.packageId,
            );
            if (fromService.data !== undefined && fromService.data !== null) {
                // [#22877] …when it is the member this read addresses. The
                // service keys a type's items by name alone, so for a
                // bundle it holds whichever member it registered last, and
                // that one answered every member's read.
                // [#7556] A layer, not a resolved schema — see
                // {@link foldObjectExtendersFromRegistry}. No-op for every
                // type but `object`, and for an object nothing extends.
                if (isWantedMember(fromService.data)) {
                    item = host.foldObjectExtendersFromRegistry(
                        request.type, request.name, fromService.data,
                    );
                }
            } else if (fromService.degraded) {
                serviceDegraded = fromService;
            }
        } catch {
            // MetadataService not available — fall through
        }
    }

    // 3. In-memory SchemaRegistry (artifact-loaded out-of-box values, and
    //    items that bypass MetadataService — e.g. some object-schema
    //    extension chains registered by AppPlugin directly).
    //    Both control-plane (unscoped) and project kernels consult the
    //    registry. The previous guard that skipped the registry for
    //    project kernels was meant to prevent cross-project leakage at
    //    the LIST level — but for a single-item lookup the kernel's own
    //    `engine.registry` is project-local (each ObjectQL instance has
    //    its own SchemaRegistry), so reading from it is safe and
    //    necessary. Without this, project-kernel callers of
    //    `GET /api/v1/meta/object/<name>` 404 even though the object is
    //    registered and visible via the list endpoint.
    // [#22877] A bundled type's name addresses ONE member (ruling A, Q2 i):
    // the selector's, else the CANONICAL one. Step 1 read only that
    // member's stored row; when there is none, the member is the code
    // layer's — the artifact that ships it — and then the registry's, asked
    // for that member. The registry's bare-name read answers the canonical
    // member wherever it sits (its own [#22877] note), and still answers a
    // bundle that ships no canonical member at all; a named member that no
    // layer holds answers nothing, so the door answers it as absent.
    if (item === undefined && wantedMember !== undefined) {
        const artifact = host.lookupArtifactItem(request.type, request.name, request.packageId, wantedMember);
        if (artifact !== undefined && isWantedMember(artifact)) item = artifact;
    }
    if (item === undefined) {
        item = host.engine.registry.getItem(request.type, request.name, request.packageId, member);
        if (item === undefined) {
            const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
            if (alt) item = host.engine.registry.getItem(alt, request.name, request.packageId, member);
        }
        // [#22877] A registry that does not narrow by member (a host
        // double, an older registry) can answer another member of the
        // bundle for a named one; that answer is not this member.
        if (member !== undefined && item !== undefined && !isWantedMember(item)) item = undefined;
        // [#20946] The registry half — see `storedRowDeclined` above.
        // `getItem` answers the bare slot first, and for a shipped flow name
        // that slot holds the hydrated stored row, which is not one of the
        // loader's entries; the loader's entry is the one the list serves.
        // [#21922] Flow-only: a code-defined datasource's definition is not
        // in the registry, and step 2 has already served it.
        if (host.isStoredFlowEntryOfShippedName(request.type, item)) {
            item = host.lookupArtifactItem(request.type, request.name, request.packageId);
        }
        // [#28802, #28390 ruling A] A bundle member on a base's address
        // (the package named, else the one whose content a read naming
        // none serves) is one that address serves: the registry's last
        // tier, the first composite match across packages (ADR-0048 §3.3),
        // no longer answers a dependent's member under the base's name.
        const memberAddress = request.packageId || (typeof contentPackageId === 'string' ? contentPackageId : undefined);
        if (item !== undefined && wantedMember !== undefined && memberAddress !== undefined) {
            item = host.registryMemberServedAt(request.type, request.name, memberAddress, item, member);
        }
    }

    // [#5840] The MetadataService half of the #5532 rule, and the last
    // moment it can be applied. The cached-read wrapper below this method
    // documents its 404 as "reaching here now means a real miss —
    // `getMetaItem` throws 503 rather than answering `undefined` when the
    // store could not be read". That was true of the overlay read only: a
    // metadata database the LOADERS could not reach was warn-logged inside
    // `MetadataManager` and arrived at step 2 as a plain `undefined`, so
    // the outage was served as `404 RESOURCE_NOT_FOUND` — a claim about
    // what the author declared, made from a read that never happened.
    //
    // Deliberately narrow, and deliberately after step 3: a registry hit is
    // a real declaration, so the answer contains no false claim and is
    // served exactly as before (possibly staler than the service copy — the
    // pre-existing ordering trade-off, not this issue's). Only when the
    // WHOLE chain resolved nothing does the degraded read change anything,
    // because only then would this method answer "no such item".
    if (item === undefined && serviceDegraded?.degraded) {
        host.throwMetadataServiceUnavailable(serviceDegraded.errors);
    }

    // Merge registered navigation contributions into a served app
    // (ADR-0029 D7) — parity with the getMetaItems list path so a
    // single-app fetch (GET /meta/app/<name>) also sees the contributed
    // menu entries, not just the empty group-anchor shell.
    if ((request.type === 'app' || request.type === 'apps') && item) {
        item = host.engine.registry.applyNavContributions(item);
    }

    // ADR-0010 §3.3 — artifact-level protection (lock/packageId) always
    // wins over any overlay row. The metadata service may return a
    // persisted overlay copy that pre-dates the artifact's `_lock`
    // declaration; we must consult the in-memory artifact registry
    // directly and let its protection envelope override.
    // ADR-0048 — scope the artifact lookup to the requested package so a
    // same-name collision grafts the OWNING package's provenance envelope
    // (`_packageId`), not whichever package registered first.
    // [#22024] …and, naming no package, to the package of the item served
    // above ({@link envelopePackageId}, the list's own rule), so the answer
    // wears the envelope of the package whose row, expansion or item it
    // serves. Before, a read naming no package took the first-registered
    // package's envelope, so a name two packages ship answered one
    // package's stored copy under the other package's `_packageId`.
    // [#23074] …and at the served item's own bundle member, whose artifact
    // alone may lend it an envelope ({@link mergeArtifactProtection}): a
    // member the package does not ship is served as the environment's own.
    const artifactItem = host.lookupArtifactItem(
        request.type, request.name, envelopePackageId(request.packageId, item), bundleMemberOf(request.type, item),
    );
    // [#21738] The lock is the one item-lock resolution's, over the layers
    // this read resolved from its address: [#21803] every installed
    // package that ships the name ({@link artifactLockLayerAt}), never the
    // one artifact the content above came from, and [#21761] the rows in
    // scope.
    const itemLock = resolveItemLock({
        artifact: host.artifactLockLayerAt({
            type: request.type,
            name: request.name,
            packageId: request.packageId,
        }),
        overlay: overlayLockLayer,
    });
    // [#21761, #21803] …and the body carries that answer's lock family, so
    // it states the lock the envelope below reports. [#24535] On the
    // execution face `decorated` is that governed body undecorated.
    let decorated = serveItem(
        host.governServedObject(
            request.type,
            mergeArtifactProtection(request.type, item, artifactItem, itemLock),
        ),
    );
    // ADR-0047 — list views additionally get reference-integrity
    // diagnostics (userFilters/tabs fields must exist on the source
    // object, kanban groupBy must be select-like). Zod cannot see
    // across documents; merge the cross-document errors into the
    // same `_diagnostics` envelope. Defensive: a failed lookup must
    // never break a read. [#24535] Served only: a serving decoration.
    if (!execution && (request.type === 'view' || request.type === 'views') && decorated && typeof decorated === 'object') {
        try {
            const viewDoc = decorated as Record<string, any>;
            const sourceObject = viewDoc?.object
                ?? viewDoc?.data?.object
                ?? viewDoc?.objectName
                ?? viewDoc?.list?.data?.object;
            const objectDef = typeof sourceObject === 'string'
                ? host.engine.registry.getObject(sourceObject)
                : undefined;
            if (objectDef) {
                const refs = computeViewReferenceDiagnostics(viewDoc, objectDef as any);
                if (!refs.valid) {
                    const prior = viewDoc._diagnostics;
                    decorated = {
                        ...viewDoc,
                        _diagnostics: {
                            valid: false,
                            errors: [
                                ...(prior && prior.valid === false && Array.isArray(prior.errors) ? prior.errors : []),
                                ...(refs.errors ?? []),
                            ],
                        },
                    } as typeof decorated;
                }
            }
        } catch { /* reference diagnostics are best-effort */ }
    }
    // [#29196] …and the lint's form-layout warnings, after the reference
    // merge above (which rebuilds `_diagnostics` from its errors alone).
    decorated = await serveFormLayout(decorated);
    // ADR-0010 — surface lock/provenance flags so Studio can render
    // the correct affordances without a second round trip. [#21670] They
    // report the write doors' verdicts — see {@link servedLockState}.
    // [#21738] The lock is the one item-lock resolution's (above), over the
    // layers this read resolved — never the served document's `_lock`.
    const artifactBacked = host.isArtifactBacked(request.type, request.name);
    const lockState = host.servedLockState(
        request.type, request.name, decorated, artifactBacked, itemLock, storedRowServed,
    );
    // [#23316] Beside `lock`, never inside `item`: the automation engine's
    // verdict on this flow ({@link resolveFlowRegistrationReader}), for an
    // item this read serves. The draft returns above carry none — a
    // pending body is not what the engine holds. [#24535] Served only, as
    // the list's `registrations` are: the execution face carries none.
    const readRegistration = !execution && decorated !== undefined && decorated !== null
        ? host.resolveFlowRegistrationReader(request.type)
        : undefined;
    // [#27842] …and, on an `object` read, the names in `item.actions` the
    // activation ledger switches off ({@link resolveDisabledActionsReader}),
    // beside the item on the same terms: served face only, none on the
    // draft returns above, `item` untouched.
    const readDisabledActions = !execution && decorated !== undefined && decorated !== null
        ? host.resolveDisabledActionsReader(request.type)
        : undefined;
    // [#28001] …and the objects a delete of one of its records can cascade
    // into ({@link resolveCascadeDeleteObjects}), on the same terms.
    const cascadeDeleteObjects = !execution && decorated !== undefined && decorated !== null
        ? host.resolveCascadeDeleteObjects(request.type, request.name)
        : undefined;
    return {
        type: request.type,
        name: request.name,
        item: decorated,
        lock: lockState.lock,
        ...(lockState.lockReason !== undefined ? { lockReason: lockState.lockReason } : {}),
        ...(lockState.lockSource !== undefined ? { lockSource: lockState.lockSource } : {}),
        ...(lockState.lockDocsUrl !== undefined ? { lockDocsUrl: lockState.lockDocsUrl } : {}),
        ...(lockState.provenance !== undefined ? { provenance: lockState.provenance } : {}),
        ...(lockState.packageId !== undefined ? { packageId: lockState.packageId } : {}),
        ...(lockState.packageVersion !== undefined ? { packageVersion: lockState.packageVersion } : {}),
        editable: lockState.editable,
        deletable: lockState.deletable,
        resettable: lockState.resettable,
        // [#22114] The active row's version token ({@link readVersionToken}).
        // No row was found at any candidate this read consults — which
        // include the save's own address — so `null` needs no second read.
        // ABSENT on a `previewDrafts` read: it serves a pending draft where
        // one exists and the active item where none does, so no single
        // lifecycle's token describes it, and it is a render path — an
        // editor reads `state: 'draft'` or the plain read.
        ...(request.previewDrafts
            ? {}
            : {
                version: storedRowServed
                    ? await host.readVersionToken({ ...request, member }, 'active', packagelessBinding)
                    : null,
            }),
        ...(readRegistration ? { registration: readRegistration(request.name) } : {}),
        ...(readDisabledActions ? { disabledActions: readDisabledActions(decorated) } : {}),
        ...(cascadeDeleteObjects !== undefined ? { cascadeDeleteObjects } : {}),
    };
}
