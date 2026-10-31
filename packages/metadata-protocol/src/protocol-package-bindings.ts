// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: shipping
// packages, hydration options, artifact protection, row package bindings, derived provenance
// and tenant authorship.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.
import {
    resolveItemLock,
    withItemLockFamily,
    type ItemLock,
} from './item-lock.js';
import {
    itemDiscriminator,
} from '@objectstack/metadata-core';
import { canonicalMetaType } from './protocol-meta-type-schema.js';

/**
 * [#21803] The packages that can ship an item of one type, read once from the
 * registry's listings: per name, and the ones probed for every name. See
 * `ObjectStackProtocolImplementation.shippingPackagesOf`.
 */
export type ShippingPackages = {
    readonly byName: ReadonlyMap<string, ReadonlySet<string>>;
    readonly anyName: ReadonlySet<string>;
};

/**
 * [#23198] What a write did to a view container's stored rows, as
 * `ObjectStackProtocolImplementation.reconcileViewExpansions` takes it.
 *
 * - `binding`: one row was hydrated (a publish, a republish, a rollback, a
 *   revert, a replica's convergence, the boot, the list read). `binding` is
 *   the row's package binding, `undefined` for the package-less row, and
 *   `expansion` is everything that row's body expands to now.
 *   `reboundFrom` is set when the write moved the row from another binding
 *   (an orphan adoption): `reboundFrom.binding` is the binding it left,
 *   `undefined` for the package-less row. That binding's record moves to
 *   `binding`, so the row reconciles against what it registered under either.
 * - `removed: 'every-row'`: a row of the name was removed (a reset, a delete,
 *   a revert's removal, a replica's removal). The heal is handed no binding,
 *   so it addresses every row of the name, and the set they imply is empty.
 */
type ViewContainerWrite =
    | {
        readonly container: string;
        readonly binding: string | undefined;
        readonly expansion: ReadonlyArray<Record<string, unknown>>;
        readonly reboundFrom?: { readonly binding: string | undefined };
    }
    | { readonly container: string; readonly removed: 'every-row' };

/**
 * [#23514, ADR-0029 D9.9] The state a refusal of a package's object row beside
 * a package-less owner (the `'sys_metadata'` sentinel) answers, which decides
 * the way out its prescription names
 * (`ObjectStackProtocolImplementation.unboundOwnerPackageRefusal`).
 */
interface UnboundOwnerRefusalState {
    /** The save's mode; a draft save registers nothing. */
    mode?: 'draft' | 'publish';
    /**
     * The packages whose ACTIVE rows of the object are stored beside the
     * package-less one (none, the package the request names, or others):
     * each must be deleted by naming its package, because a delete naming no
     * package resolves to the one binding present, or is refused 409 over two
     * ({@link ObjectStackProtocolImplementation.packagelessAddress}).
     */
    storedPackages?: readonly string[];
    /** The caller named no package, and the save's address resolved to the package's row. */
    namedNoPackage?: boolean;
    /**
     * A publish naming no package of a draft bound to NO package, which the
     * draft doors' address adopts into the one package binding stored
     * (`packagelessDraftAddress`: `key: null`, `into: P`). No publish moves that
     * draft into `P`: with `P`'s row gone it promotes into the package-less
     * definition, and one naming `P` finds no `P` draft (`NO_DRAFT`).
     */
    adoptedDraft?: boolean;
    /**
     * [#23712] A DRAFT save naming no package (with `namedNoPackage`): the
     * packages whose drafts of the object are stored with no package-unbound
     * draft beside them. Once the rows are deleted, the draft address is the
     * one package's draft (`packagelessDraftAddress`), so each is discarded
     * by naming its package before the save writes the package-less draft.
     */
    strandedDrafts?: readonly string[];
    /**
     * Where the refusal is raised: the save door (default), a draft promotion
     * (the per-item publish and `publish-drafts`), or a registration of a
     * stored row (boot, write-through).
     */
    at?: 'save' | 'promote' | 'registry';
}

/**
 * What a hydration of one stored row is told about it:
 * `ObjectStackProtocolImplementation.hydrateOverlayIntoRegistry` and the
 * expansion hydration it hands the row to.
 *
 * - `packageId`: the row's package binding.
 * - `organizationId`: the row's scope, `null` for an environment-wide row
 *   (#6602).
 * - `reboundFrom`: [#23198] set only when the write that is being hydrated
 *   moved the row from another binding (an orphan adoption). `packageId` is
 *   the binding it left, `null` for the package-less row. See
 *   {@link ViewContainerWrite}.
 */
type HydrationOptions = {
    packageId?: string | null;
    organizationId: string | null;
    reboundFrom?: { readonly packageId: string | null };
};

/**
 * ADR-0010 §3.3 — Overlay the artifact's metadata-protection envelope
 * onto a returned item so artifact-level lock/packageId/provenance
 * always wins over whatever was persisted in the `sys_metadata` overlay
 * row. Returns `item` unchanged when no artifact baseline is available.
 *
 * The artifact's `_packageId`, `_packageVersion` and `_provenance` are the
 * source of truth — an overlay copy may pre-date the artifact's protection
 * declaration and would otherwise mask it.
 *
 * [#21738] The lock family (`_lock`, `_lockReason`, `_lockDocsUrl`,
 * `_lockSource`) is NOT decided here: it follows the one item-lock resolution
 * ({@link resolveItemLock}). The artifact's family is copied over the item's
 * only when the artifact's lock is the one that binds, which is exactly the
 * case the sentence above exists for (an overlay never masks a packaged lock).
 * An artifact that declares no lock, or an explicit `'none'`, leaves the
 * item's own family in place. Before this, any declared artifact `_lock` was
 * copied, `'none'` included, so an artifact's explicit `'none'` erased a
 * stored row's `'full'` from the served body and from the read envelope while
 * the write door, which skips `'none'`, still refused the save.
 *
 * [#21761, #21803] A read that resolved the item's lock from its address
 * ({@link resolveArtifactLockLayer} and {@link resolveOverlayLockLayer} into
 * {@link resolveItemLock}) passes that answer as `itemLock`, and the body
 * carries ITS lock family ({@link withItemLockFamily}): the binding row's or
 * the binding package's, which need not be the document the body was served
 * from, and no `_lock*` key at all when nothing binds. `artifactItem` then
 * contributes the provenance fields only: content, and with it provenance,
 * stays prefer-local (ADR-0048). Without `itemLock` the item's own body
 * stands in for the overlay layer over `artifactItem` alone, as before: the
 * registry's hydration and a previewed draft, neither of which is a read's
 * lock answer.
 *
 * [#23074] An artifact lends its envelope only to a body of its OWN identity.
 * For a type whose identity is a pair ({@link ITEM_KEY_DISCRIMINATORS}:
 * `email_template`'s `(name, locale)`), that is the same bundle member, read
 * by {@link bundleMemberOf}, the identity's one declaration; an artifact of
 * another member is treated as no artifact at all. So an environment overlay
 * of a member the package does not ship (a `zh-CN` template beside a shipped
 * `en-US`) keeps the tenant authorship it was registered with, and is never
 * read as packaged code: `isCodeArtifactBody` false, no `_packageId` /
 * `_packageVersion` / `_provenance` stamp, no artifact `_lock*`. Grafted, it
 * read as the bundle's own artifact of that member to the registry's artifact
 * lookup and its overlay-entry retirement, and the read doors served it under
 * the package's provenance. The shipped member's overlay is unchanged: each
 * caller looks the artifact up at the body's own member
 * (`lookupArtifactItem`'s `member`), so it still wears that member's
 * artifact's envelope. A registry that ignores `member` can answer another
 * member's artifact, and this check is what keeps that answer off the body.
 * Every other type has no members, so `bundleMemberOf` is `undefined` on both
 * sides and the merge is exactly what it was. ⛔ The lock family a read
 * resolved (`itemLock`) is applied before this check and is not moved by it:
 * a lock binds the NAME, at the read and at the `_lock` gate alike
 * ({@link resolveItemLock} over every package that ships the name).
 */
function mergeArtifactProtection(
    type: string,
    item: unknown,
    artifactItem: unknown,
    itemLock?: ItemLock,
): unknown {
    if (item === undefined || item === null) return item;
    if (itemLock !== undefined) item = withItemLockFamily(item, itemLock);
    if (artifactItem === undefined || artifactItem === null) return item;
    const a = artifactItem as Record<string, unknown>;
    if (typeof a !== 'object') return item;
    if (bundleMemberOf(type, a) !== bundleMemberOf(type, item)) return item;
    const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    if (itemLock === undefined && resolveItemLock({ artifact: [a], overlay: item }).layer === 'artifact') {
        if (a._lock !== undefined) out._lock = a._lock;
        if (a._lockReason !== undefined) out._lockReason = a._lockReason;
        if (a._lockDocsUrl !== undefined) out._lockDocsUrl = a._lockDocsUrl;
        if (a._lockSource !== undefined) out._lockSource = a._lockSource;
    }
    if (a._packageId !== undefined) out._packageId = a._packageId;
    if (a._packageVersion !== undefined) out._packageVersion = a._packageVersion;
    if (a._provenance !== undefined) out._provenance = a._provenance;
    return out;
}

/**
 * [#23074] The bundle member a body IS, for a type whose identity is a pair
 * ({@link ITEM_KEY_DISCRIMINATORS}): `itemDiscriminator` under the type's
 * canonical spelling, so the canonical member for a body that declares none.
 * `undefined` for every other type, which has no members. The member
 * {@link mergeArtifactProtection} matches an artifact against, and the one
 * each of its callers looks the artifact up at.
 */
function bundleMemberOf(type: string, body: unknown): string | undefined {
    return itemDiscriminator(canonicalMetaType(type), body);
}

/**
 * [#22024, ADR-0048, ADR-0010 §3.3] The package whose artifact envelope
 * ({@link mergeArtifactProtection}: `_packageId`, `_packageVersion`,
 * `_provenance`) a served item wears: the package the read names, else the
 * package the served item itself is bound to, as the step that served it
 * stamped it (a stored row's `package_id`, a container expansion's own
 * package, the MetadataService's or the registry's item's `_packageId`).
 *
 * The one rule both read doors take: the list
 * ({@link ObjectStackProtocolImplementation.readFlattenedMetaItems}) for each
 * item it serves, and the by-name read
 * ({@link ObjectStackProtocolImplementation.getMetaItem}) for the item it
 * serves. So one served body wears one envelope on both doors.
 *
 * A read naming no package used to take the envelope of the first composite
 * the registry holds under the name, which is the first-registered package's.
 * Where two packages ship the name and the body served is another package's
 * (its stored row, or its stored copy of a container they both ship), the
 * answer served that package's body under the first-registered package's
 * `_packageId`. A served item bound to no package (a package-less stored row,
 * a registry entry with no package) names none, so its lookup is the
 * package-less one it always was. ⛔ The lock is not chosen here: it is the
 * one item-lock resolution's ({@link resolveItemLock}), from the read's own
 * address.
 */
function envelopePackageId(requestedPackageId: string | undefined, served: unknown): string | undefined {
    return requestedPackageId ?? (served as { _packageId?: string } | null | undefined)?._packageId;
}

/**
 * [#22057] The package a body is bound to, when it is bound to one: a
 * non-empty id that is not the `'sys_metadata'` sentinel a package-less row
 * carries. `undefined` for a package-less body.
 */
function boundPackageOf(packageId: unknown): string | undefined {
    return typeof packageId === 'string' && packageId !== '' && packageId !== 'sys_metadata' ? packageId : undefined;
}

/**
 * [#16702] ADR-0010 §3.3 — the three protection keys that are READ-SIDE
 * DERIVED, and therefore must never be persisted from a caller's body.
 *
 * {@link mergeArtifactProtection} recomputes all three from the artifact on
 * every read, so a copy stored inside a `sys_metadata` body is never
 * load-bearing: removing it is observable ONLY where that copy was a lie.
 *
 * ⛔ The `_lock*` family is deliberately NOT here, though it shares the
 * underscore spelling and the same ADR-0010 envelope. A lock is
 * AUTHOR-DECLARABLE (`protection.lock`, translated into `_lock*` by
 * `applyProtection`), so dropping one is the FAIL-OPEN direction — cloud PR
 * #2065 drew that line at its own producer and this door follows it.
 *
 * ⛔ Nor is this a second `METADATA_READ_DECORATIONS`. That list is shared
 * with every consumer that re-parses a SERVED document (`spec`'s
 * `metadata-read-decorations.ts`), and its header states on purpose that the
 * protection envelope stays on a served body so provenance survives a
 * re-parse. This strip is scoped to the WRITE door alone.
 */
const DERIVED_PROVENANCE_KEYS = ['_packageId', '_packageVersion', '_provenance'] as const;

/**
 * [#16702] Remove {@link DERIVED_PROVENANCE_KEYS} from a body about to be
 * PERSISTED into `sys_metadata`.
 *
 * A **silent** strip, for the same reason {@link stripReadDecorations} is
 * silent: the standard Studio `GET` → edit → `PUT` round-trip echoes whatever
 * the served document carried, and refusing that round-trip would be hostile
 * for keys the server stamped itself. What it restores is the invariant the
 * `_provenance: 'org'` docblock in {@link
 * ObjectStackProtocolImplementation.applyObjectRegistryMutation} already
 * states: every row this door writes is tenant-authored by definition, so the
 * server states that fact rather than reading it back from the caller.
 *
 * Returns the SAME reference when there is nothing to strip, so the common
 * path allocates nothing. Non-object inputs pass through — the caller's own
 * validation owns those.
 */
function stripDerivedProvenance(item: unknown): unknown {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const dict = item as Record<string, unknown>;
    if (!DERIVED_PROVENANCE_KEYS.some((k) => k in dict)) return item;
    const next = { ...dict };
    for (const k of DERIVED_PROVENANCE_KEYS) delete next[k];
    return next;
}

/**
 * [#16702] State what every `sys_metadata` row IS — tenant-authored, ADR-0010
 * `_provenance: 'org'` — on a COPY of a body about to be REGISTERED.
 *
 * The same sentence {@link
 * ObjectStackProtocolImplementation.applyObjectRegistryMutation} and the boot
 * `object` limb already write, said once for every OTHER type at the one
 * hydration choke point they do not share. Without it the row's own bytes
 * decide: `isCodeArtifactBody` accepts a truthy non-sentinel `_packageId` with
 * non-`org` provenance, `SchemaRegistry.getArtifactItem`'s bare-key fallback
 * returns the overlay AS an artifact, `isArtifactBacked` turns true, and
 * `saveMetaItem`'s overlay gate refuses the tenant's next write to their own
 * item with `NOT_OVERRIDABLE` — permanently, because the next boot re-derives
 * the same verdict from the same row (cloud#970's shape, for non-`object`
 * types).
 *
 * ⚠️ Both callers — the container in `hydrateOverlayIntoRegistry` and, since
 * #21511, each view expansion it registers (`expandRuntimeViewContainer`
 * under `tenantAuthored`) — apply it BEFORE {@link mergeArtifactProtection},
 * and the order is the whole contract: where a real artifact exists the artifact's
 * envelope still overwrites `_provenance` (and `_packageId` /
 * `_packageVersion` / `_lock*`) on the way out, so package protection is
 * untouched — ADR-0010 §3.3 precedence is unchanged in both directions.
 *
 * On a COPY, always: `registerItem` hands the body to `applyProtection`, which
 * mutates in place, and the callers own their `data`.
 */
function stateTenantAuthorship(data: unknown): unknown {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    return { ...(data as Record<string, unknown>), _provenance: 'org' };
}

/**
 * [#23233] A stored row's body with its package binding stated as `_packageId`,
 * the way `getMetaItems` stamps a row from its `package_id` column. The binding
 * is read, never derived: a row bound to no package ({@link boundPackageOf}),
 * or a body that already names a `_packageId`, is returned as it is. A copy,
 * so the caller's body is never written.
 */
function withRowBinding(data: unknown, packageId: unknown): unknown {
    const binding = boundPackageOf(packageId);
    if (binding === undefined || !data || typeof data !== 'object' || Array.isArray(data)) return data;
    if ((data as { _packageId?: unknown })._packageId !== undefined) return data;
    return { ...(data as Record<string, unknown>), _packageId: binding };
}

/**
 * [#21639, #21638] Is this artifact a view ITEM — a view a package ships under
 * its own name, `viewKind` set (the spec's ViewItem) — rather than a container
 * or anything else? The save door's "a view item a package ships" and the
 * package attribution of a container row both ask exactly this, positively:
 * a body that is neither a container nor a view item is not a view item.
 */
function isShippedViewItem(artifact: unknown): boolean {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return false;
    const viewKind = (artifact as { viewKind?: unknown }).viewKind;
    return typeof viewKind === 'string' && viewKind !== '';
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { boundPackageOf, bundleMemberOf, envelopePackageId, isShippedViewItem, mergeArtifactProtection, stateTenantAuthorship, stripDerivedProvenance, withRowBinding };
export type { HydrationOptions, UnboundOwnerRefusalState, ViewContainerWrite };
