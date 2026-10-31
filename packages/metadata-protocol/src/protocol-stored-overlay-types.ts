// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the non-canonical stored type predicate, the stored overlay entry and the rowless expanded view.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { canonicalMetaType } from './protocol-meta-type-schema.js';

/**
 * [#8908] Is this AT-REST `type` a spelling the batch publish must refuse?
 *
 * ## The class, stated as a predicate rather than a list of four
 *
 * `publishPackageDrafts` reads `sys_metadata` rows, so its input is a stored
 * `type` — not a URL segment, which is why #7894's boundary fold
 * ({@link canonicalizeMetaRequestType}) never reaches it. `promoteDraftForPublish`
 * folds the stored spelling through `PLURAL_TO_SINGULAR`, the MANIFEST-collection
 * map, and that map legitimately omits types which are not stack collections.
 * For those, the fold is a NO-OP: the lookup key equals the stored spelling, the
 * draft resolves, and the publish mints an ACTIVE row in the very namespace
 * `PUT /meta/field/…` answers 403 NOT_OVERRIDABLE for — every registry read and
 * every compliance query on `field` missing an item the platform just reported
 * as published.
 *
 * The two limbs below are that sentence, mechanically:
 *
 *  1. `canonicalMetaType(type) !== type` — the platform's own URL/registry map
 *     says this spelling names a DIFFERENT type than the one it is stored as, so
 *     the row lives in a second namespace for an item that has a canonical home.
 *     A canonical type fails this limb by construction (no canonical spelling
 *     folds elsewhere — 33 of 33, measured), and so does a plugin-registered or
 *     unrecognised kind (identity fold), which is what keeps the gate off
 *     everything that is not this defect.
 *  2. the MANIFEST fold leaves it unchanged — i.e. `promoteDraftForPublish`
 *     would look the row up under its stored spelling and FIND it.
 *
 * ⛔ Limb 2 is not decoration and must not be dropped for "one simpler rule".
 * A manifest-PRESENT plural (`objects`) is already fail-closed: the promote
 * addresses the row by the folded singular, `whereFor` emits that spelling with
 * no at-rest fallback, and the batch aborts on `NO_DRAFT` — pinned, with its
 * reasoning, in `protocol.publish-side-effects-canonical-type.test.ts`. Widening
 * this gate over that class would change a wire-visible `failed[].code` for rows
 * that are NOT this defect. #8908's ruling names one class; this predicate is it.
 *
 * ## Why a predicate and not the four names the card lists
 *
 * The card names `fields`, `seeds`, `external_catalogs`, `translations`. Measured
 * against the real maps, the class is SIX spellings: those four plus
 * `externalCatalogs` (the camelCase limb of the same type) and `email_templates`
 * (a registry type whose snake_case plural the manifest map also omits, while
 * carrying `emailTemplates`). A hand-written list would have shipped with two
 * members missing and no way to notice; this derivation cannot drift from the
 * maps it reads, and a newly declared type that never reaches the manifest map
 * is covered on the day it is declared.
 */
function isNonCanonicalStoredType(type: string): boolean {
    return canonicalMetaType(type) !== type && (PLURAL_TO_SINGULAR[type] ?? type) === type;
}

/**
 * [#21442] A stored `sys_metadata` row as the list read parses it: its own
 * name, its body (stored-row conversions replayed), and the package and
 * organization it is bound to (`organizationId: null` for an environment-wide
 * row). [#21804] `type` is the spelling the row is stored under (its own
 * `type` column), which the served-row resolution reads.
 */
export interface StoredOverlayEntry {
    name: string;
    data: any;
    packageId: string | undefined;
    organizationId: string | null;
    type: string;
}

/**
 * [#21442] A row-less view name a stored view container expands: the item the
 * list read serves under the name, and the stored container row it derives
 * from.
 */
export interface RowlessExpandedView {
    item: Record<string, unknown>;
    container: StoredOverlayEntry;
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { isNonCanonicalStoredType };
