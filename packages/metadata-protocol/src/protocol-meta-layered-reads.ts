// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E2 cut 1b] The layered reads of `ObjectStackProtocolImplementation`:
 * `packagelessLayeredReadRefusal` (the refusal the layered route answers
 * before it reads) and `getMetaItemLayered` (one item's code, overlay and
 * effective layers).
 *
 * A MOVE, not a redesign. Each function below is the body of the class method
 * of the same name as it stood, re-indented one level, with `this.<member>`
 * read as `host.<member>` and nothing else changed
 * (`node scripts/host-split.mjs check <base> <member> protocol-meta-layered-reads.ts`
 * proves it). Each method stays on the class with its docblock and signature,
 * which the published `.d.ts` prints, and hands its body the host
 * (`protocol-host.ts`).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import {
    itemDiscriminator,
    // [#21059] The tenant marker the hydrator writes on every stored row it
    // registers (ADR-0010 `_provenance: 'org'`) — read by
    // {@link ObjectStackProtocolImplementation.getMetaItemLayered}'s code-layer
    // fallback so a hydrated row is never answered as the code layer.
    isTenantAuthored,
} from '@objectstack/metadata-core';
import {
    type MetadataLock,
    type MetadataLockSource,
    type MetadataProvenance,
    customizationPackageId,
} from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '@objectstack/spec/shared';
import {
    type StoredOverlayRow,
    resolveItemLock,
    storedRowDocument,
    withItemLockFamily,
} from './item-lock.js';
import { type MetadataDiagnostics, computeMetadataDiagnostics, withFormLayoutWarnings } from './metadata-diagnostics.js';
import { redactMetadataItem } from './metadata-redaction.js';
import { overlayMemberWhere } from './migrations/overlay-index.js';
import {
    isObjectOfDisabledPackage,
    objectPackageDisabledError,
} from './protocol-authoring-refusals.js';
import {
    bundleMemberDiscriminator,
    memberOption,
    resolveBundleMemberSelector,
} from './protocol-bundle-members.js';
import type { ProtocolHost } from './protocol-host.js';
import { canonicalizeMetaRequestType } from './protocol-meta-type-schema.js';
import { rowMatchesOverlayWhere } from './protocol-overlay-merge.js';
import { boundPackageOf } from './protocol-package-bindings.js';
import type { RowlessExpandedView } from './protocol-stored-overlay-types.js';
import { type ServedOverrideRow, isServedOverrideRowOf } from './served-override.js';
import { packagelessAddressAmbiguityRefusal } from './sys-metadata-repository.js';

/** The body of `ObjectStackProtocolImplementation#packagelessLayeredReadRefusal`; the method's docblock there is its contract. */
export async function packagelessLayeredReadRefusal(host: Pick<ProtocolHost, 'packagelessAddress'>, request: {
        type: string;
        name: string;
        /** The bundle member the layered read addresses ({@link resolveBundleMemberSelector}); omitted, the canonical one. */
        member?: string;
    }): Promise<(Error & { code: 'RESOURCE_CONFLICT'; status: 409 }) | undefined> {
    const { type, name } = canonicalizeMetaRequestType(request);
    const member = resolveBundleMemberSelector(type, request.member);
    const address = await host.packagelessAddress(PLURAL_TO_SINGULAR[type] ?? type, name, member);
    return address.candidates.length > 1
        ? packagelessAddressAmbiguityRefusal('layered read', type, name, address.candidates)
        : undefined;
}

/** The body of `ObjectStackProtocolImplementation#getMetaItemLayered`; the method's docblock there is its contract. */
export async function getMetaItemLayered(host: Pick<ProtocolHost, 'artifactLockLayerAt' | 'convertStoredItem' | 'declinesStoredRow' | 'engine' | 'findPairAddedMemberRow' | 'findServedOverlayRow' | 'foldObjectExtendersFromRegistry' | 'governServedObject' | 'isArtifactBacked' | 'lookupArtifactItem' | 'overlayLockLayerAt' | 'packagelessReadAddress' | 'readItemActiveRows' | 'readItemFromMetadataService' | 'resolveRowlessExpandedView' | 'resolveWritePackageScope' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'servedLockState' | 'strictDraftReadAddress' | 'throwMetadataServiceUnavailable'>, request: {
        type: string;
        name: string;
        packageId?: string;
        /** [#26699] The bundle member whose layers to read — {@link resolveBundleMemberSelector}; omitted, the canonical one. */
        member?: string;
    }, opts: { withDraft?: boolean } = {}): Promise<{
        type: string;
        name: string;
        code: unknown | null;
        overlay: unknown | null;
        overlayScope: 'env' | null;
        effective: unknown | null;
        /**
         * [#29814] The pending draft row as stored — present only when the
         * caller asked for it (`opts.withDraft`); `null` when no draft is
         * pending. See the class method's docblock.
         */
        draft?: unknown | null;
        /**
         * Load-time validation result for the effective payload — same
         * shape attached to getMetaItems/getMetaItem by
         * decorateMetadataItem. Undefined for types without a registered
         * Zod schema (function/service/router). Lets the Studio edit
         * page surface invalid-metadata banners + inline field errors
         * without a second round-trip.
         */
        _diagnostics?: MetadataDiagnostics;
        // ── ADR-0010 protection envelope ──
        lock: MetadataLock;
        lockReason?: string;
        // `MetadataLockSource` (artifact | package | env-forced) — the only
        // producer feeding this field on this path is the item-lock
        // resolution's `lockSource` ([#21738] {@link resolveItemLock}: the
        // binding layer's declared `_lockSource`), typed
        // `MetadataLockSource | undefined`. The `'overlay'` arm this annotation
        // used to carry was dead: the door's `'artifact' | 'overlay'` is the
        // resolution's `layer`, which `getEffectiveLock` reports in its refusal
        // text and which never feeds this response (commit 11b779e0f).
        lockSource?: MetadataLockSource;
        lockDocsUrl?: string;
        provenance?: MetadataProvenance;
        packageId?: string;
        packageVersion?: string;
        editable: boolean;
        deletable: boolean;
        resettable: boolean;
    }> {
    // #4432 — CANONICAL TYPE KEY. See {@link canonicalMetaType}. The
    // three-layer diagnostic must answer for ONE namespace, or `code` and
    // `overlay` can be read from two.
    request = canonicalizeMetaRequestType(request);
    // [#7557, #24097] A by-name API face of its own (`?layers=true`), which
    // reads its layers without going through {@link getMetaItem}, so it
    // refuses a disabled package's object itself: one answer per door.
    if (request.type === 'object' && isObjectOfDisabledPackage(host.engine?.registry, request.name)) {
        throw objectPackageDisabledError(request.name);
    }
    // [#26699] Ruling 6116165299 (Q2 i), extended to this read by the
    // option-A ruling on #26649: ONE member of a bundled type, the
    // selector's or else the canonical one, read exactly as
    // {@link getMetaItem} reads it. Every layer below is that member's or
    // nothing — the code layer's service copy, artifact and registry entry,
    // and the stored row — so a named member nothing holds answers no
    // layer, which the door answers as an absent item, ⛔ never with the
    // canonical member's layers.
    const member = resolveBundleMemberSelector(request.type, request.member);
    const wantedMember = bundleMemberDiscriminator(request.type, member);
    const isWantedMember = (candidate: unknown): boolean =>
        wantedMember === undefined || itemDiscriminator(request.type, candidate) === wantedMember;

    // [ADR-0131 D6] Environment → code: the overlay layer is the
    // environment's stored row; no organization's row is read.

    // ── code layer: MetadataService.get + registry, BYPASSING overlay ──
    let code: unknown | null = null;
    let codeDegraded: { degraded: boolean; errors: string[] } | undefined;
    try {
        // ADR-0048 — package-scope the code layer so a same-name
        // collision resolves to the requested package's artifact.
        const fromService = await host.readItemFromMetadataService(
            request.type,
            request.name,
            request.packageId,
        );
        if (fromService.data !== undefined && fromService.data !== null) {
            // [#26699] …when it is the member this read addresses, as in
            // {@link getMetaItem}: the service keys a type's items by name
            // alone, so for a bundle it holds whichever member it
            // registered last. Another member's copy is no layer of this
            // one; the artifact and registry lookups below ask for it.
            // [#7556] The CODE layer of an object is D9.6's "owner's
            // declaration with its extenders folded on", so the
            // MetadataService copy is its base, not the layer itself.
            // `effective` is `overlay ?? code`, so an object with no
            // overlay row — the ordinary shape — is corrected by this
            // single fold on both layers the diagnostic reports.
            if (isWantedMember(fromService.data)) {
                code = host.foldObjectExtendersFromRegistry(
                    request.type, request.name, fromService.data,
                );
            }
        } else if (fromService.degraded) {
            // [#5840] Kept, not swallowed — acted on after the registry
            // fallback below, which may still produce a real code layer.
            codeDegraded = fromService;
        }
    } catch {
        // ignore
    }
    if (code === null) {
        // Prefer the artifact-only lookup so an overlay row hydrated
        // into the registry's plain key can't masquerade as the "code
        // default" layer; fall back to getItem for runtime-only items.
        //
        // [#21059] …and "runtime-only" is held to what it says. The plain
        // key is one slot for two populations: an item registered at
        // runtime with no package, and a stored row the hydrator put there
        // ({@link hydrateOverlayIntoRegistry}, the boot `object` limb of
        // {@link loadMetaFromDb}). For a name no package ships the
        // artifact lookup misses, so `getItem` answered the hydrated row
        // and the code layer became the stored body — but only once a
        // hydration had run, so the same read answered `code: null` before
        // it. The spec's layer 1 is "`null` when no artifact ships this
        // item (it exists only as an overlay)", and #5707 / #5840 allow a
        // layer only from a read that happened: a stored row is the overlay
        // read below, never an artifact read.
        //
        // The discriminator is the tenant marker the hydrator ALREADY
        // writes on every row it registers — ADR-0010 `_provenance: 'org'`,
        // read through {@link isTenantAuthored}. ⛔ No new marker. A body
        // that carries package-provenance stamps under a name no package
        // ships is the same row: the hydrator restates its authorship over
        // whatever its bytes claim, and a stamp is not an artifact read, so
        // the envelope's provenance fields below read this item's code
        // layer as `null` too (triage's ruling, overturnable by the
        // maintainer); its lock reads no code layer at all ([#21738], the
        // item-lock resolution below). A
        // runtime-registered item with no package carries no tenant marker
        // and keeps its code layer.
        //
        //
        // [#26699] Each lookup is asked for the addressed member, exactly
        // as {@link getMetaItem}'s are: the artifact at the member (the
        // canonical one when none was named), and the registry for the
        // member named. The registry's bare-name read still answers a
        // bundle that ships no canonical member; a registry that does not
        // narrow by member can answer another one for a NAMED member, and
        // that answer is not this member's layer.
        const runtimeOnly = (item: unknown): unknown =>
            item !== undefined && isTenantAuthored(item) ? undefined : item;
        const namedMemberOnly = (item: unknown): unknown =>
            member !== undefined && item !== undefined && !isWantedMember(item) ? undefined : item;
        const artifact = host.lookupArtifactItem(request.type, request.name, request.packageId, wantedMember);
        let regItem = (artifact !== undefined && isWantedMember(artifact) ? artifact : undefined)
            ?? namedMemberOnly(runtimeOnly(host.engine.registry.getItem(request.type, request.name, request.packageId, member)));
        if (regItem === undefined) {
            const alt = PLURAL_TO_SINGULAR[request.type] ?? SINGULAR_TO_PLURAL[request.type];
            if (alt) regItem = namedMemberOnly(runtimeOnly(host.engine.registry.getItem(alt, request.name, request.packageId, member)));
        }
        if (regItem !== undefined) code = regItem;
    }

    // [#5840] The code half of the rule #5707 wrote for the overlay half,
    // eleven lines below. `code: null` is not a shrug — this method states
    // it positively ("no packaged/code-layer definition exists"), and the
    // response then DERIVES from it: `effective` and the envelope's
    // provenance fields. (It used to derive the lock too, from
    // `code ?? overlay`, so an item whose code layer declared `_lock:
    // 'full'` was rendered `editable: true, deletable: true` when the read
    // that would have found that lock failed. [#21738] The lock is now the
    // item-lock resolution's, over the registry's artifact lookup, which
    // this read cannot lose.) An availability failure stated as an
    // authorship fact is precisely what ADR-0110 D3 forbids, and the
    // overlay half of this very method already refuses to do it — the two
    // halves were asymmetric only because the loader failure was invisible
    // on this side.
    //
    // Same narrow shape as the overlay half: the benign "nothing there"
    // still returns `code: null` normally (a clean miss is not degraded),
    // and a registry hit above is a real code layer, so this fires only
    // when the null would otherwise be an unfounded authorship claim.
    if (code === null && codeDegraded?.degraded) {
        host.throwMetadataServiceUnavailable(codeDegraded.errors);
    }

    // ── overlay layer: the environment's sys_metadata row (ADR-0131 D6) ──
    let overlay: unknown | null = null;
    let overlayScope: 'env' | null = null;
    // [#28412] The stored row `overlay` was read from, when the served-row
    // resolution read one: what {@link declinesStoredRow} judges a shipped
    // flow name's declared override on.
    let overlayRow: ServedOverrideRow | undefined;
    // [#21761] The `overlay` layer of the one item-lock resolution below,
    // selected from this read's address as in {@link getMetaItem}: the
    // strictest lock among the item's stored rows in scope, never only the
    // row this layer reports.
    let overlayLockLayer: unknown;
    // [#23291] Naming no package, the overlay comes from the address
    // {@link getMetaItem} serves its content from
    // ({@link packagelessReadAddress}), so `effective` is what that read
    // returns and `/published` serves the same document. Content only: the
    // lock stays at the request's address, as the `_lock` gate judges it.
    // Asked outside the `try` below: its own failed read already answers
    // the #5532 envelope, with the driver's error as `cause`.
    const contentPackageId = request.packageId || await host.packagelessReadAddress(request.type, request.name, member);
    try {
        // ADR-0048 prefer-local. [#21716] The ONE served-row resolution
        // {@link getMetaItem} calls too — see {@link findServedOverlayRow}.
        // [#26699] At the addressed member, as that read asks it.
        // [#28409, ADR-0146 D8 item 2] …with the package's declared
        // override first, as {@link getMetaItem} serves it: `overlay` is
        // then the `.custom` item, `code` the base's document and
        // `effective` the override (the base's document stays reachable
        // here, ADR-0146 "Decided here" item 5).
        let served: { row: any; overrideOf?: string } | undefined = await host.findServedOverlayRow({
            type: request.type,
            name: request.name,
            state: 'active',
            ...(contentPackageId !== undefined ? { packageId: contentPackageId } : {}),
            ...memberOption(member),
            servedOverride: true,
        });
        // [#28830, #28390 ruling A] The pair's own added member is the
        // overlay on the base's address, as the by-name read serves it
        // ({@link findPairAddedMemberRow}); another package's never is.
        if (!served && wantedMember !== undefined && typeof contentPackageId === 'string') {
            const row = await host.findPairAddedMemberRow(request.type, request.name, contentPackageId, member, wantedMember);
            if (row) served = { row };
        }
        overlayLockLayer = await host.overlayLockLayerAt({
            type: request.type,
            name: request.name,
            packageId: request.packageId,
        }, { otherSpelling: true });
        if (served) {
            const rec = served.row;
            overlayRow = rec as ServedOverrideRow;
            overlay = host.convertStoredItem(
                String(rec.type ?? request.type),
                storedRowDocument(rec),
            );
            overlayScope = 'env';
        }
    } catch (error) {
        // [#5707] The same rule as the four overlay reads in
        // `getMetaItems` / `getMetaItem` (#5532), on the one overlay read
        // PR #5705 deliberately did not reach.
        //
        // Swallowing here does not answer 404 — it answers something this
        // method states positively in THREE fields at once: `overlay: null`
        // ("nothing was ever customised"), `overlayScope: null` ("no row
        // is stored"), and `effective = code` ("what runs today is the
        // packaged artifact, verbatim"). The whole point of the layered
        // read is to show an author what they changed; during an outage it
        // told them they had changed nothing, which is the #5532 error —
        // an availability failure reported as an authorship fact — landing
        // in the diff view instead of on a 404.
        //
        // The benign case is unchanged and is why this is not a bare
        // rethrow: an unprovisioned `sys_metadata` genuinely holds no
        // overlay row, so `overlay: null` / `effective = code` IS the truth
        // and first boot still renders the code layer.
        // See {@link rethrowUnlessMetadataStoreUnprovisioned}.
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }

    // ── [#21442] A row-less name a stored view container expands ──
    //
    // No row of this name was read above. When a stored view container in
    // this caller's scope expands the name ({@link resolveRowlessExpandedView},
    // the list read's own selection and expansion), `effective` is the
    // expanded item — what {@link getMetaItem} answers for the name — and
    // the layers say where it came from in the fields that already say it:
    // `overlay` is the container's own stored row, the one stored layer
    // behind this name (its `name` is the container's, its `_packageId` the
    // package its row is bound to), and `overlayScope` `'env'`. `code` keeps its own read: the item a package ships
    // under this name (a tenant overlay of that package's container), else
    // `null`.
    let expandedFrom: RowlessExpandedView | undefined;
    if (overlay === null) {
        expandedFrom = await host.resolveRowlessExpandedView(request);
        if (expandedFrom !== undefined) {
            overlay = expandedFrom.container.data;
            overlayScope = 'env';
        }
    }

    // ── [#28409, ADR-0146 D8; N-09 rider gap 3] An ORPHANED row of the name ──
    //
    // Nothing stored is served at the address of a name its package X
    // ships (`code` is X's document), and yet a row of the name is stored in X's pair
    // (`<X>.custom`) without the override declaration, or in a package
    // that depends on X (X is in its manifest's dependency closure,
    // {@link resolveWritePackageScope}). The shape a base upgrade leaves:
    // the dependent or the pair saved the name before a later version of
    // X shipped it. Since the effective read serves X's document under
    // X's name (D8 item 1), that row is no longer served there, and the
    // env-wide list lists the name once, as X's. It is still the
    // package's own item, under its own address. The layered read of X's
    // name REPORTS it, so it is never silently dropped: `overlay` holds
    // the row as stored, a shadowed layer beside the effective one, as for
    // a shipped flow name's stored row (#21002), and `effective` stays the
    // code layer the by-name read serves. The flags below are the address's
    // as before: the orphan is not this address's row.
    //
    // A row of a package outside X's closure is not an orphan of X's name:
    // it is that package's own item (ADR-0048 §3.3), and not reported here.
    // With several such rows, the pair's is reported, else the first
    // package's in id order.
    let orphaned = false;
    if (overlay === null && code !== null && typeof contentPackageId === 'string' && contentPackageId !== '') {
        const base = contentPackageId;
        let rows: readonly StoredOverlayRow[] = [];
        try {
            rows = await host.readItemActiveRows(request.type, request.name);
        } catch (error) {
            // [#5707] The same rule as the overlay read above: a read that
            // did not happen is not an item with no orphan.
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        }
        const memberWhere = overlayMemberWhere(request.type, member);
        const boundTo = (row: StoredOverlayRow): string | undefined => boundPackageOf(row.package_id);
        const orphan = rows
            .filter((row) => rowMatchesOverlayWhere(row, memberWhere))
            .filter((row) => {
                const owner = boundTo(row);
                if (owner === undefined || owner === base) return false;
                if (isServedOverrideRowOf(row, base)) return false;
                const pair = customizationPackageId(base);
                if (pair.ok && pair.value === owner) return true;
                return host.resolveWritePackageScope(owner)?.dependencies.includes(base) === true;
            })
            .sort((a, b) => {
                const pair = customizationPackageId(base);
                const rank = (row: StoredOverlayRow) => (pair.ok && boundTo(row) === pair.value ? 0 : 1);
                return rank(a) - rank(b) || String(boundTo(a)).localeCompare(String(boundTo(b)));
            })[0];
        if (orphan !== undefined) {
            overlay = host.convertStoredItem(
                String((orphan as { type?: unknown }).type ?? request.type),
                storedRowDocument(orphan),
            );
            overlayScope = 'env';
            orphaned = true;
        }
    }

    // ── [#29814] The pending DRAFT layer, only when the caller asked ──
    //
    // The row the strict `state: 'draft'` read of {@link getMetaItem} serves,
    // at the same address: the requested package's draft when one is named,
    // else the draft {@link strictDraftReadAddress} names (the address the
    // draft save, the per-item publish and the discard naming none act on),
    // with that read's best-effort first match when two or more packages hold
    // drafts and none is package-unbound. Read as the `overlay` layer is read:
    // the stored body through the conversion chain and nothing else. ⛔ Not
    // governed (no injected columns), not translated, no `_packageId` stamp:
    // an edit buffer built from it and saved back writes what the author
    // wrote. The strict read decorates and governs; this layer is the draft
    // as stored, which is the whole reason it exists.
    //
    // Asked for by the DOOR, never by default: a door asks only for a caller
    // its draft-read admission admits (`mayReadPendingDrafts`), so no
    // in-process resolution reader of this method (the security catalog echo,
    // the packaged-permission-set lock gate, `/published`) reads drafts.
    let draft: unknown | null | undefined;
    if (opts.withDraft === true) {
        draft = null;
        const draftAddress = request.packageId
            ? undefined
            : await host.strictDraftReadAddress(request.type, request.name, member);
        try {
            let draftRow = (await host.findServedOverlayRow({
                type: request.type,
                name: request.name,
                state: 'draft',
                ...(request.packageId
                    ? { packageId: request.packageId }
                    : draftAddress ? { packageId: draftAddress.packageId } : {}),
                ...memberOption(member),
            }))?.row;
            if (!draftRow && draftAddress?.bestEffort) {
                draftRow = (await host.findServedOverlayRow({
                    type: request.type,
                    name: request.name,
                    state: 'draft',
                    ...memberOption(member),
                }))?.row;
            }
            if (draftRow) {
                draft = host.convertStoredItem(
                    String(draftRow.type ?? request.type),
                    storedRowDocument(draftRow),
                );
            }
        } catch (error) {
            // [#5707] A read that did not happen is not "no draft pending".
            host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        }
    }

    // [#4513] `effective` is documented above as "what `getMetaItem` would
    // return", and the response's `_diagnostics` is computed from it — so it
    // carries the same audit-family governance that read now applies, or the
    // sentence stops being true the moment the overlay declares a writable
    // `created_at`. `code` and `overlay` are deliberately left RAW: they are
    // the diagnostic's whole point (what the package shipped vs what was
    // customised), and a Studio diff showing `code`'s declaration next to
    // `effective`'s governed value is the platform override made visible,
    // not a defect.
    // [#8027] …and `effective` is "what `getMetaItem` would return", so when
    // the overlay wins it is that read's BASE LAYER, resolved the same way:
    // D9.2's base-plus-extenders. Without this the single `?layers=true`
    // response contradicted itself — `code` carried the extension fields
    // (#7556 folds it) and `effective` did not, with the `overlay` layer
    // showing a customisation that explained none of the difference.
    //
    // ⛔ The fold lands on the EFFECTIVE base only. `overlay` stays the row
    // the tenant actually stored: a code-declared extension is not a tenant
    // customisation, and #7556 drew that boundary deliberately (the same
    // reason `governServedItem` is called here and never on `overlay`).
    //
    // ── [#21002, #20761 ruling rule 1, ADR-0126 §2 / §3] A shipped FLOW name ──
    //
    // `flow` is Regime C: the packaged base is locked, "⛔ Never silent
    // override, never an overlay read path". For a flow name the loader's
    // set holds, the flattened view (#20913) and {@link getMetaItem}
    // (#20946) serve the loader's body, and a stored row of that name is
    // neither merged into the package's slot nor lets it stand in for it.
    // `effective` is "what `getMetaItem` would return", so for such a name
    // it is the CODE layer, decided by the SAME stored-row predicate,
    // {@link isShippedFlowName}, judged by NAME — ⛔ no fourth precedence
    // path of this method's own. Overlay-wins here served the stored body
    // as the effective layer while the lock and provenance flags (resolved
    // from `code` first, below) named the package.
    //
    // The stored row is still REPORTED: `overlay` / `overlayScope` keep the
    // row as stored, a shadowed layer of its own scope beside the effective
    // one, never the effective layer itself. The code layer needs no
    // registry-half call ({@link isStoredFlowEntryOfShippedName}): it reads
    // the loader's set (`lookupArtifactItem`, blind to tenant-authored rows)
    // before the registry's bare slot, and a shipped name is by definition
    // one that set holds. Every other type, and a flow name no managed
    // package ships, keeps overlay-wins. What becomes of the stored rows
    // themselves (keep, refuse, migrate) is not decided here.
    //
    // [#21922] The same holds for a code-defined DATASOURCE name, through
    // the one predicate both name classes share ({@link declinesStoredRow}):
    // `getMetaItem` serves the MetadataService's code definition, so that is
    // `effective` here (the code layer above reads the MetadataService
    // first), and the stored row stays reported in `overlay` — the residue
    // the `/meta` DELETE removes as repair.
    //
    // [#21442] A name a stored container expands (above) takes the expanded
    // item as its effective layer: the container row in `overlay` is the
    // layer it derives from, not the value the by-name read serves.
    // [#28409] …and an orphaned row (above) is a shadowed layer of the
    // same kind: `effective` is the code layer the by-name read serves.
    const effectiveBase: unknown | null = expandedFrom !== undefined
        ? expandedFrom.item
        : overlay !== null && !orphaned && !host.declinesStoredRow(request.type, request.name, overlayRow)
            ? host.foldObjectExtendersFromRegistry(request.type, request.name, overlay)
            : code;
    // [#21738] The lock is the one item-lock resolution's — the
    // `getMetaItem` call over [#21803] every installed package that ships
    // the name ({@link artifactLockLayerAt}) and [#21761] the rows in
    // scope for its address — never `code ?? overlay`, which took the code
    // layer's (absent) lock over a stored row's `_lock`. A row-less name a
    // stored container expands contributes no `overlay` layer: the
    // container's row is not this name's row, and the `_lock` gate does not
    // read it. The provenance fields still come from the layer the
    // response reports first.
    const itemLock = resolveItemLock({
        artifact: host.artifactLockLayerAt({
            type: request.type,
            name: request.name,
            packageId: request.packageId,
        }),
        overlay: overlayLockLayer,
    });
    // [#21761, #21803] `effective` is what {@link getMetaItem} would
    // return, and that read's body carries the resolution's lock family
    // (the binding row's or the binding package's, which need not be the
    // layer `effective` was taken from). So this one does too. `code` and
    // `overlay` stay the layers as shipped and as stored.
    const effective: unknown | null = withItemLockFamily(
        host.governServedObject(request.type, effectiveBase),
        itemLock,
    );

    const schemaDiagnostics =
        effective !== null && effective !== undefined
            ? computeMetadataDiagnostics(request.type, effective)
            : undefined;
    // [#29435] …plus the form-layout warnings `getMetaItem` serves for the
    // same effective body ({@link withFormLayoutWarnings}: `form-field-unknown`
    // and `form-section-group-unknown`, judged against the object the registry
    // serves for each name the view spells). Warnings only, so `valid` stays
    // the schema's answer. This door has no execution face: it is the
    // `?layers=true` authoring read, the one Studio's item editor takes when
    // no draft is pending, so the pass runs unconditionally here.
    const _diagnostics = effective !== null && typeof effective === 'object' && !Array.isArray(effective)
        ? (await withFormLayoutWarnings(
            request.type,
            { ...(effective as Record<string, unknown>), _diagnostics: schemaDiagnostics },
            (name) => host.engine?.registry?.getObject?.(name),
        ))._diagnostics as MetadataDiagnostics | undefined
        : schemaDiagnostics;

    // ADR-0010 — surface lock/provenance flags so the Studio editor
    // can render the correct affordances without a second round trip.
    const artifactBacked = host.isArtifactBacked(request.type, request.name);
    // [#21670] …joined with the locked-packaged-base verdict the write
    // doors answer — the same derivation `getMetaItem` publishes.
    const lockState = host.servedLockState(
        request.type, request.name, code ?? overlay ?? {}, artifactBacked, itemLock,
        overlay !== null && overlay !== undefined && !orphaned,
    );

    // [#8154] The per-type credential redaction, on the ONE read exit
    // `decorateMetadataItem` does not reach — this method never calls it
    // (it computes `_diagnostics` directly, above) and serves its three
    // layers raw. Measured on `origin/main` before this change: a legacy
    // `datasource` row came back with `config.password` in cleartext in
    // BOTH `overlay` and `effective`, so a hook that covered only the
    // decorated exits would have left this door open while the report said
    // "the read path is closed" — the exact shape this card exists to end.
    //
    // ⚠️ ALL THREE LAYERS, `code` and `overlay` included, and that is a
    // reading of ANOTHER lane's ruling rather than an inference from this
    // one. #7556 keeps `code` / `overlay` deliberately RAW — ungoverned,
    // uninjected, unfolded — so that a Studio diff shows what the tenant
    // actually customised and nothing else. That reason does not extend to
    // credentials, and redacting the key on BOTH sides leaves the diff
    // itself unchanged: the key is absent from both layers, so "what was
    // customised" reads exactly as before. Stated here, and in the PR body,
    // so `domain:engine-core` / `domain:spec` reviewers can contest it
    // rather than discover it. ⛔ It is NOT a licence to fold, govern or
    // inject on these layers — redaction subtracts, and only a credential.
    //
    // Placed AFTER `_diagnostics` and AFTER `servedLockState`, both of
    // which must read the raw bodies: the diagnostics ordering is the
    // migration-inventory badge (see `decorateMetadataItem`), and a lock
    // resolved from a redacted body would be a lock resolved from a
    // document this method is not serving.
    const servedCode = redactMetadataItem(request.type, code);
    const servedOverlay = redactMetadataItem(request.type, overlay);
    const servedEffective = redactMetadataItem(request.type, effective);
    // [#29814] …and the draft layer, by the same reasoning: redaction
    // subtracts a credential and nothing else.
    const servedDraft = draft === undefined ? undefined : redactMetadataItem(request.type, draft);

    return {
        type: request.type,
        name: request.name,
        code: servedCode,
        overlay: servedOverlay,
        overlayScope,
        effective: servedEffective,
        ...(servedDraft !== undefined ? { draft: servedDraft } : {}),
        ...(_diagnostics ? { _diagnostics } : {}),
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
    };
}
