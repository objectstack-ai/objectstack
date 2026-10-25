/**
 * ObjectUI — the shared emptiness floor
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * THE floor under "is this value empty" (objectui#8496 — director seat,
 * decision batch #86, 2026-09-08, option B).
 *
 * Exactly four members, and it never grows past them:
 *
 *   `null` · `undefined` · the empty string · the empty array
 *
 * ## What a floor IS, and what it is not
 *
 * It is the WEAKEST claim the surfaces below it can all make — not the answer
 * any one of them gives. A caller does one of two things with it, and both are
 * legitimate:
 *
 *  - **extends** it — `isEmptyValue(v) || <its own clause>` — when its surface
 *    calls MORE things empty (a grid trims whitespace; a boolean column calls
 *    every non-boolean empty);
 *  - **declines a member** in the open — `isEmptyValue(v) && !Array.isArray(v)`
 *    — when its surface has MEASURED that member to be a value there (a `json`
 *    cell draws the two-character literal `[]` on purpose, objectui#8474).
 *
 * What is NOT legitimate is a sixth private re-spelling of these four members.
 * That is the defect this function exists to close: `plugin-detail`'s
 * `hasCellValue`, `RelatedList`'s `isValueEmpty`, `ObjectGallery`'s and
 * `ObjectKanban`'s inline guards and the guard idioms across
 * `@object-ui/fields`' cell renderers each grew their own copy, and
 * objectui#8481 was the THIRD rediscovery of the same hole — objectui#8474 and
 * objectui#8459 had each closed it at their own door first. A copy that agrees
 * today stops agreeing; one definition cannot.
 *
 * ## ⛔ The floor never grows past those four members
 *
 * The ruling fixed the member list, and every candidate fifth member is a
 * measured disagreement rather than an oversight:
 *
 *  - **whitespace-only strings.** `'   '` is EMPTY on `record:details` and in
 *    `RelatedList` (objectui#8350 measured the damage a blank cell does there)
 *    and a VALUE on the gallery, the kanban and the shared renderers. Both are
 *    right for their surface, so the trim is an EXTENSION, not a member.
 *  - **`{}`.** Measured as a VALUE and pinned (objectui#8474): a populated or
 *    empty object literal is handed to a type-aware renderer that draws it, and
 *    the shape that would sweep it in — `Object.keys(v).length === 0` — is also
 *    true of `new Date(0)`, of a populated `Map`, of a populated `Set` and of
 *    any class instance whose state sits behind getters.
 *  - **`0` / `false`.** Values everywhere. `BooleanCellRenderer` keeping
 *    `false` a value is the pinned case (objectui#8582).
 *
 * ## Why `@object-ui/core` and not `@object-ui/types`
 *
 * It is a runtime predicate, not a protocol type, so it belongs in the engine.
 * The ruling made that conditional on a measurement — `@object-ui/fields` is
 * the lowest consumer, and if it did not already depend on `core` the floor
 * would have had to fall back to `types`. Measured on the implementing branch:
 * `@object-ui/fields`' `package.json` lists `@object-ui/core` in
 * `dependencies`, and its barrel already imports from it. No new dependency
 * edge is created by this file, in either direction — `core` reaches no
 * consumer, which is why exporting the helper from `@object-ui/fields` instead
 * (option C) was refused: the gallery and the kanban would then import a
 * `fields` helper to decide whether to call a `fields` renderer.
 *
 * ## "Empty" is two questions; this floor answers the half both share
 *
 * objectui#8496's later evidence (comment 5603203484) measured that the word
 * has split in two on this codebase: SCALAR-MISSING (`EmptyValue`, the em-dash
 * affordance whose accessible name is fixed) and COLLECTION-EMPTY
 * (`EmptyDescription`, an author's own sentence). The floor serves both and
 * does not have to choose: its four members ARE two scalar-missing members,
 * one blank scalar and one empty collection, and no call site asks a boolean to
 * tell those apart — each one knows statically which affordance it is drawing.
 * ⛔ So this function is deliberately NOT the place to grow a second axis. Which
 * COMPONENT states the emptiness is a different question, carried by
 * objectui#8570 / objectui#8526 / objectui#8507.
 *
 * ## Readers
 *
 * `isOptionGroupGated` / `isValueStillOffered` here in `core` (this function's
 * origin: it was written privately in `evaluator/optionRules.ts`, byte-for-byte
 * these four members, before the ruling promoted it); `hasCellValue` and
 * `RelatedList.isValueEmpty` in `@object-ui/plugin-detail`; `ObjectGallery`'s
 * card-field row filter; `ObjectKanban`'s card-field loop; and the cell-renderer
 * guards in `@object-ui/fields`.
 *
 * The extensions and the declensions are pinned — the assertion that each
 * surface still answers DIFFERENTLY from the floor, not merely that the floor
 * works — in `__tests__/emptiness-floor-8496.test.ts` here and in
 * `emptinessFloorExtensions-8496.test.tsx` in `@object-ui/fields` and
 * `@object-ui/plugin-detail`.
 */
export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}
