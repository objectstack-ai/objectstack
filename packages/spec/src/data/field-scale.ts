// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # What an ABSENT `scale` means — declared once, per field type
 *
 * `FieldSchema.scale` is `.optional()`, so the commonest numeric field an AI
 * author writes (`Field.percent({ label: 'Win rate' })`) declares no decimal
 * width at all. Every face still has to pick one, and before this module each
 * face picked privately: measured in the sibling checkout, the read-only
 * percent cell and the grid/detail summaries resolved an absent `scale` to `0`
 * while the percent EDIT widget resolved it to `2`, so one stored `0.25`
 * rendered `25%` on one face and `25.00%` on another — two magnitudes for one
 * record, out of a single empty declaration.
 *
 * Maintainer ruling (director seat, summon 25, batch 194 item 1, letter A′,
 * 「同意」 — recorded on objectui issuecomment-5749111840), quoted rather than
 * paraphrased:
 *
 * > `@objectstack/spec` declares the default decimal places for an **absent**
 * > `scale` per field type, and consumers read it from the protocol — ⛔ no
 * > `?? N` in any consumer. **percent ⇒ 0** in this card.
 *
 * ⇒ the absent value is PROTOCOL, answered here once, and a consumer reads it
 * by calling {@link resolveFieldScale}. The ⛔ half is the operative one: a
 * `?? 0` in a renderer is a default no other face can see, which is exactly
 * how two magnitudes for one record came to exist. The consumer-side removal
 * of those fallbacks is objectui#9843, which declares this card its blocker;
 * the question of whether the two percent faces should agree at all was left
 * open by objectui#9568 and this is that ruling executed.
 *
 * ## Why a resolver and not a Zod default — measured, ⛔ not assumed
 *
 * `FieldSchema` is a FLAT `strictObject` (one shape, type applicability
 * expressed by `superRefine`), ⛔ not a per-type union. So a key-level
 * `.default(0)` cannot see `type` and would land on every numeric type at
 * once: that is plain letter A, and the ruling refused it by name, because an
 * undeclared currency would fall from `$25.00` to `$25`.
 *
 * A type-conditional materialization in the schema's `.overwrite()` tail — the
 * instrument `unique` and `deleteBehavior` use, which CAN see `type` — is the
 * wrong one here for a reason outside presentation entirely. `packages/objectql`'s
 * record validator gates the write-time `max_scale` REFUSAL on
 * `def.scale !== undefined`: an absent declaration is what leaves a percent
 * field's stored width unconstrained today. Materializing a `0` would arm that
 * refusal on every percent field whose author declared nothing — turning writes
 * the platform accepts into writes it rejects, a stored-data change bought for a
 * display ruling, and one no author could read off their own metadata. The
 * absent value therefore stays ABSENT on the parsed field and is resolved at the
 * moment of display. `field-scale.test.ts` pins that: a bare `percent` field
 * parses to output carrying no `scale` key.
 *
 * ## Why the table has exactly one row
 *
 * `percent` only. The ruling scoped the other numeric types to a consumer
 * census, and the census came back INCONSISTENT for both candidates — so under
 * the ruling's own instruction each takes its own card with its readings rather
 * than a guessed default here:
 *
 * - `number` — the faces deliberately DISAGREE, and one of them load-bearingly.
 *   The cell renderer resolves absence to "no fixed width" (minimum 0 digits,
 *   maximum 20) while the grid summary footer and the metric widget resolve it
 *   to `0`; and the display-grouping policy keys on the very distinction a
 *   default would erase — a DECLARED `scale: 0` marks a discrete integer (a
 *   year, a fiscal period, an ordinal) and is rendered ungrouped, while an
 *   absent `scale` means "decimals unknown" and keeps its separators. Declaring
 *   `number ⇒ 0` would print every undeclared number field ungrouped: `2026`
 *   where the platform shows `2,026`.
 * - `currency` — the money faces do not read this key at all. They resolve
 *   fraction digits from the currency's own ISO 4217 minor-unit count, with
 *   `CurrencyConfigSchema.precision` (a DIFFERENT surface, with its own
 *   `scale` → `precision` alias) as the authored override. The one `2` that
 *   looks like a currency default belongs to an inline grid COLUMN's rounding
 *   of a computed result, not to a field's display width.
 *
 * ⛔ Neither reading is an argument for `0`, and neither is an argument for
 * the other face's value: they are an argument that nobody has ruled yet.
 *
 * ## Why the table is not exported
 *
 * A consumer that enumerates a table re-decides the absent-value question at
 * its own call site, which is the shape the ruling closes. The resolver is the
 * whole published surface; the per-type rows are held honest from the other end
 * by the pin over the numeric family, which fails in both directions when a
 * type joins that family with no row and when a row names a type that left it.
 */

/**
 * The per-type absent-`scale` table. Keyed by `FieldType`; a type with no row
 * has NO declared width for an absent `scale`, which is a real answer (see the
 * census above) and ⛔ not a hole for a caller to fill.
 */
const ABSENT_SCALE_BY_TYPE: Readonly<Record<string, number>> = Object.freeze({
  // The ruling's one type. A percent field's `scale` counts the decimal places
  // of the PERCENTAGE-POINT value as displayed and entered, so `0` means a
  // stored `0.25` shows as `25%` — the width every read-only percent face
  // already resolved for itself, now the platform's answer for every face.
  percent: 0,
});

/** The subset of field metadata an effective `scale` is resolvable from. */
export interface FieldScaleMeta {
  /** The field's `type` — the key the absent-value table is read by. */
  type?: string;
  /**
   * The declared `scale`, typed `unknown` deliberately: renderers reach this
   * helper with loose metadata that never passed `FieldSchema`, where a
   * `scale: "2"` out of stored JSON is reachable. Inventing a width from a
   * string is consumer-side guessing, so the door below refuses it rather than
   * coercing.
   */
  scale?: unknown;
}

/**
 * The decimal places this field displays: its DECLARED `scale` when it has a
 * well-formed one, otherwise the platform's declared value for an absent
 * `scale` on that field type, otherwise `undefined` — "no fixed width", the
 * value's natural precision.
 *
 * ⛔ Callers must not spell a fallback of their own on the `undefined`: it does
 * not mean "unanswered", it means the platform has declared no fixed width for
 * that type, and a private `?? N` beside this call is the defect this helper
 * exists to remove. A type that needs a declared width gets a row in the table
 * above and every face moves together.
 *
 * The well-formedness door is the same one `packages/objectql`'s record
 * validator applies before it enforces anything (`Number.isInteger(scale) &&
 * scale >= 0`): a malformed declaration has no defined meaning, so the field
 * takes its type's absent value rather than having floor/round semantics
 * invented for it here. `FieldSchema` refuses those declarations at authoring,
 * so this branch is reached only by metadata that never went through it.
 *
 * ⚠️ Deliberately NOT clamped to the platform's renderable ceiling. A declared
 * width past it is returned verbatim — the ceiling is refused at the authoring
 * seam by `FieldSchema.scale` itself, and the one consumer that clamps a stored
 * over-ceiling width does so under its own ruling with its own sunset.
 */
export function resolveFieldScale(field: FieldScaleMeta | undefined): number | undefined {
  const declared = field?.scale;
  if (typeof declared === 'number' && Number.isInteger(declared) && declared >= 0) return declared;
  const type = field?.type;
  if (typeof type !== 'string') return undefined;
  return Object.prototype.hasOwnProperty.call(ABSENT_SCALE_BY_TYPE, type)
    ? ABSENT_SCALE_BY_TYPE[type]
    : undefined;
}
