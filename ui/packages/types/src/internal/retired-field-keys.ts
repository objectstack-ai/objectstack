/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Retired-field-key tombstone registry (objectui#6527)
 *
 * The single place naming each FIELD key a designer once wrote that the
 * installed `FieldSchema` refuses BY NAME, the card that retired it, and its
 * PER-SITE applicability on the designer seam. The three strip sites derive
 * their lists from this registry via {@link retiredFieldKeysFor}; before
 * objectui#6527 each site kept its own literal and the three had drifted.
 *
 * ## Why this is a registry and NOT one shared array
 *
 * The three strip sets are DELIBERATELY not nested, and unioning them would
 * silently decide two adjudicated questions in the wrong direction:
 *
 *   - `formula` is stripped by the two WRITE doors and must NOT be stripped by
 *     the READ door — ruled on objectui#6526 (option B, 2026-08-27):
 *     `ObjectFieldInspector` seeds its linting CEL editor from
 *     `def.expression ?? def.formula` and the author's first edit commits
 *     `expression` and clears the alias, the migration objectui#6043 preserved.
 *     Stripping at the read door destroys that authored source text.
 *   - `sortOrder` applies at ONE site only and is the registry's one
 *     `defensive` entry — see its tombstone.
 *
 * So applicability is per site, recorded here as data, and the per-site pins in
 * `packages/types/src/__tests__/retired-field-key-tombstones.test.ts` are what
 * keep both of those decisions mechanical rather than conventional.
 *
 * ## Membership criterion
 *
 * Every key in this registry is refused by the installed `FieldSchema` with
 * `unrecognized_keys` — measured, and pinned by the registry's own test. That
 * is what makes stripping safe: the server refuses to store these values, so a
 * strip can never lose anything that persisted. A key the schema ACCEPTS must
 * never be added here; stripping an accepted key deletes authored metadata.
 *
 * The strips these tombstones feed are keyed to the registry and are NOT a
 * blanket unknown-key purge (AGENTS.md #0.1): a plugin-registered key the
 * INSTALLED spec does not know is `unrecognized_keys` to the client while the
 * SERVER that sent it accepts it, so filtering by the schema's accept set would
 * drop precisely the keys the carry-overs exist to preserve.
 *
 * `scripts/check-designer-field-key-parity.mjs` (the declared-shape parity
 * gate) does not read this registry yet — pinning it as that gate's single
 * source is the cross-lane follow-up named on objectui#6527.
 */

/**
 * The strip sites on the designer seam, in the order their columns read in the
 * tombstones below.
 *
 * - `metadataAdminFieldsReadDoor` — READ:
 *   `app-shell/src/views/metadata-admin/previews/object-fields-io.ts`
 *   (`readFields`, the single read door for `draft.fields` across the whole
 *   object designer). Strips on load, so an edit-and-save round-trip of a
 *   poisoned draft comes out parseable. This door reads drafts a live editor
 *   also MIGRATES, which neither write door does — that is why its column is
 *   not the union of the other two.
 * - `metadataServiceCarryOver` — WRITE:
 *   `app-shell/src/services/MetadataService.ts` (`carryOver`, objectui#6488).
 *   Bounds the per-field carry-over of `saveFields` / `saveObject` so a stored
 *   document's retired keys do not ride back out to
 *   `PUT /api/v1/meta/object/:name` as a hard 422.
 * - `metadataFieldsPageCarryOver` — WRITE:
 *   `plugin-designer/src/MetadataFieldsPage.tsx` (`carryOver`). Same bound for
 *   the standalone Field Designer's own save path.
 */
export const RETIRED_FIELD_KEY_SITES = [
  'metadataAdminFieldsReadDoor',
  'metadataServiceCarryOver',
  'metadataFieldsPageCarryOver',
] as const;

/** One strip site on the designer seam. See {@link RETIRED_FIELD_KEY_SITES}. */
export type RetiredFieldKeySite = (typeof RETIRED_FIELD_KEY_SITES)[number];

/** One retired field key's tombstone. See {@link RETIRED_FIELD_KEY_TOMBSTONES}. */
export interface RetiredFieldKeyTombstone {
  /** The refused spelling, exactly as `FieldSchema` names it in `unrecognized_keys`. */
  readonly key: string;
  /** The card that retired the key — the home of the full evidence. */
  readonly retiredBy: `objectui#${number}`;
  /**
   * The accepted `FieldSchema` key that carries this CONCEPT today, or `null`
   * when the spec has no field-level equivalent. Documentation for the reader,
   * NEVER an instruction to migrate a value mechanically: objectui#6043 refused
   * exactly that rename for `formula`, because `FieldSchema` validates the key
   * and not the language, so a blind rename launders non-CEL text into a
   * formula that parses green and evaluates to null.
   */
  readonly specEquivalent: string | null;
  /**
   * `true` when NO measurement shows any stored document can carry the key —
   * the strip is insurance rather than a measured fix, and the entry says so
   * instead of reading like a measurement. Kept-with-a-note is a recorded
   * verdict (objectui#6527); a defensive entry must never spread to more sites
   * without evidence.
   */
  readonly defensive: boolean;
  /** Which sites strip this key. Every `false` is deliberate and documented. */
  readonly sites: Readonly<Record<RetiredFieldKeySite, boolean>>;
}

/**
 * The tombstones, in the order the cards retired the keys.
 *
 * Adding an entry: the key must be measured `unrecognized_keys` against the
 * installed `FieldSchema` (the registry test enforces this), and each site
 * column is its own decision — a site that cannot see the key (read door:
 * "no draft can carry it"; a carry-over: "this writer never emitted it") gets
 * `false` and a reason here, not a defensive `true`.
 */
export const RETIRED_FIELD_KEY_TOMBSTONES = [
  {
    /*
     * Never a FieldSchema key at all: the field-level flag built no index
     * (objectstack#2377 removed it) and the object's `indexes[]` is the real
     * surface — hence no `specEquivalent`, the concept moved levels rather
     * than spellings. Shipped in console 17.0.0 GA as the field inspector's
     * `Indexed` checkbox, so stored objects from that era carry it.
     */
    key: 'indexed',
    retiredBy: 'objectui#4644',
    specEquivalent: null,
    defensive: false,
    sites: {
      metadataAdminFieldsReadDoor: true,
      metadataServiceCarryOver: true,
      metadataFieldsPageCarryOver: true,
    },
  },
  {
    /*
     * A rename: the spec spells the lookup target `reference`
     * ("Did you mean `referenceTo` -> `reference`?").
     *
     * ⚠️ "The strip loses nothing" was written here without a qualifier, and
     * objectui#8896 measured it false at two of the three sites. It was only
     * ever true where a READ DOOR had already lifted the target out of the
     * stored document — `fromDesignerField` re-emitting the designer's target
     * under `reference`. The two sites with no read door in front of them
     * (`metadataFieldsPageCarryOver`'s `7dc31bb8d` preserved branch, which
     * re-emits a stored document verbatim, and `metadataAdminFieldsReadDoor`,
     * which IS the read) deleted the only copy of the target, and
     * objectui#7714's guard then refused the whole object's save from a page
     * that renders the field read-only.
     *
     * Each of those two sites now lifts the VALUE onto the spec key before
     * dropping the retired one. The strip itself is unchanged everywhere:
     * `FieldSchema` refuses this spelling BY NAME, so no site emits it.
     *
     * ⚠️ The claim is therefore per site, and is NOT restated as a third
     * unconditional sentence — restating the conclusion without its condition is
     * how this entry went wrong the first time:
     *
     *   - `metadataFieldsPageCarryOver` — nothing is lost. Its designable branch
     *     reads through `storedRelationshipTarget` (`3f4b45886`) and its
     *     preserved branch through `carryPreservedField` (objectui#8896); both
     *     re-emit under `reference`.
     *   - `metadataAdminFieldsReadDoor` — nothing is lost. The door keeps the
     *     value under `reference` as it drops the key (objectui#8896).
     *   - `metadataServiceCarryOver` — ⛔ UNMEASURED, deliberately. That site
     *     strips a stored entry it merges UNDERNEATH an already-built
     *     `DesignerFieldDefinition`, and `toFieldPayload` writes `reference`
     *     from that model unconditionally. Whether a target survives therefore
     *     depends on the CALLER's read door, and `saveFields` has no in-repo
     *     caller to measure (it is a published service API). Whoever measures
     *     one: this is the same class, and the answer belongs here.
     *
     * ⛔ That recovery is written per site and keyed to THIS key. It is NOT
     * driven off `specEquivalent` — see the field's own doc, and objectui#6043,
     * for why a mechanical rename is refused in general. What makes this key
     * different is that its value is a bare object NAME under both spellings.
     */
    key: 'referenceTo',
    retiredBy: 'objectui#6041',
    specEquivalent: 'reference',
    defensive: false,
    sites: {
      metadataAdminFieldsReadDoor: true,
      metadataServiceCarryOver: true,
      metadataFieldsPageCarryOver: true,
    },
  },
  {
    /*
     * The one entry whose strip DROPS a value, and the one whose read-door
     * column is a ruling rather than a symmetry:
     *
     *   - WRITE doors strip it (`true` twice): the server refuses to store the
     *     value, and with the authoring control retired an author has no other
     *     way to clear it, so leaving it would keep the object 422-blocked
     *     forever. objectui#6043 REFUSED the rename to `expression` — see
     *     `specEquivalent` on the interface for why a blind rename is worse
     *     than the drop.
     *   - The READ door must NOT strip it (`false`) — RULED, objectui#6526
     *     option B (2026-08-27, inherited by objectui#6527):
     *     `ObjectFieldInspector` seeds its linting CEL editor from
     *     `def.expression ?? def.formula`; the first edit commits `expression`
     *     and clears the alias (objectui#6043's migration), and the client-side
     *     422 diagnostic names the field and points at that editor (PR #6624).
     *     Stripping here empties the editor and destroys the authored
     *     expression text — measured: the inspector's migration pin renders
     *     `""` and fails. Flipping this `false` is overturning a maintainer
     *     ruling, not tidying an inconsistency.
     */
    key: 'formula',
    retiredBy: 'objectui#6043',
    specEquivalent: 'expression',
    defensive: false,
    sites: {
      metadataAdminFieldsReadDoor: false,
      metadataServiceCarryOver: true,
      metadataFieldsPageCarryOver: true,
    },
  },
  {
    /*
     * A rename with an asymmetric write half: the spec spells it `system`, and
     * `fromDesignerField` / `toFieldPayload` never NAME `isSystem`, so the
     * carry-over strip is the entire write half of the retirement (the spec
     * spelling rides through untouched, which is what lets the designers read
     * the flag back).
     */
    key: 'isSystem',
    retiredBy: 'objectui#6044',
    specEquivalent: 'system',
    defensive: false,
    sites: {
      metadataAdminFieldsReadDoor: true,
      metadataServiceCarryOver: true,
      metadataFieldsPageCarryOver: true,
    },
  },
  {
    /*
     * The registry's one DEFENSIVE entry, and its one single-site column —
     * both facts are pinned, and both were decided on the record rather than
     * unioned in (objectui#6527, re-measured 2026-08-27 on this tree):
     *
     * objectui#6045 retired the key as objectui#4687's zero-readers /
     * zero-writers shape, NOT as a rename: `DesignerFieldDefinition` declared
     * it, `toFieldPayload` copied it, nothing ever populated it, and
     * `JSON.stringify` dropped the `undefined` — "the key never reached the
     * wire". No shipped writer on this tree ever emitted a field-level
     * `sortOrder`, so no stored document written by these designers can carry
     * one. The spec has no field-level ordering key at all: field order is
     * declaration order in the object's `fields` record, and the near-spelling
     * `sortable` is a boolean ("whether field is sortable in list views") — a
     * different concept, not an equivalent.
     *
     *   - `metadataServiceCarryOver: true` — objectui#6488 added the strip
     *     when it built the carry-over, as insurance against a document some
     *     OTHER client stored while an older server accepted the key. Kept,
     *     with the measurement recorded here instead of silently: dropping it
     *     would turn such a document (if one exists — unmeasured either way)
     *     into a 422 that blocks every save with no UI way out, for the price
     *     of one honest entry.
     *   - The other two sites never had it and gain nothing: the read door
     *     strips only what a draft can measurably carry (its own contract:
     *     "add it then, not defensively"), and `MetadataFieldsPage`'s
     *     carry-over has the same unmeasured premise it always had. Widening
     *     either would be the naive union this registry exists to prevent.
     *
     * Evidence of a stored field-level `sortOrder` flips this entry to a
     * measured three-site strip; evidence that none can exist retires it
     * entirely. Either way, update the tombstone and its pins together.
     *
     * Distinct keys, same spelling: the object-level `sortOrder` retired by
     * objectui#6223 (an `ObjectSchema` matter, still declared on
     * `ObjectDefinition` as the Object Manager's display order) and the
     * saved-view `sortOrder` in `app-shell`'s `ObjectView` (per-view display
     * order). Neither is this field-level key.
     */
    key: 'sortOrder',
    retiredBy: 'objectui#6045',
    specEquivalent: null,
    defensive: true,
    sites: {
      metadataAdminFieldsReadDoor: false,
      metadataServiceCarryOver: true,
      metadataFieldsPageCarryOver: false,
    },
  },
] as const satisfies readonly RetiredFieldKeyTombstone[];

/** The union of every retired field key named in the registry. */
export type RetiredFieldKey = (typeof RETIRED_FIELD_KEY_TOMBSTONES)[number]['key'];

/**
 * The retired field keys that apply at `S` — the literal union, derived from
 * the tombstone data so a site's list and its type cannot drift apart.
 */
export type RetiredFieldKeysAt<S extends RetiredFieldKeySite> = Extract<
  (typeof RETIRED_FIELD_KEY_TOMBSTONES)[number],
  { sites: { [K in S]: true } }
>['key'];

/**
 * The strip list for one site, in registry (retirement) order.
 *
 * This is the ONLY supported way for a strip site to obtain its list — a site
 * that inlines a literal is a fourth copy, which is exactly the drift
 * objectui#6527 closed. The cast is sound because the return type is derived
 * from the same tombstone data the filter reads.
 */
export function retiredFieldKeysFor<S extends RetiredFieldKeySite>(
  site: S,
): readonly RetiredFieldKeysAt<S>[] {
  return RETIRED_FIELD_KEY_TOMBSTONES.filter((t) => t.sites[site]).map(
    (t) => t.key,
  ) as RetiredFieldKeysAt<S>[];
}
