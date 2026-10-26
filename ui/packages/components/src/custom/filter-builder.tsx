/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

import * as React from "react"
import { X, Plus, Trash2, Search, Loader2, ChevronDown } from "lucide-react"
import {
  VIEW_FILTER_LIST_VALUE_OPERATORS,
  VIEW_FILTER_PAIR_VALUE_OPERATORS,
  normalizeFilterOperator,
} from "@objectstack/spec/ui"
import { expandEmptyOperator } from "@objectstack/spec/data"
import { SchemaRendererContext } from "@object-ui/react"
import type {
  FilterBuilderCondition as AuthoredFilterBuilderCondition,
  FilterGroup as AuthoredFilterGroup,
} from "@object-ui/types"
// The retirement gate (objectui#4914, ruling B). Read from
// `@object-ui/core` rather than from `@object-ui/fields` — which is where
// the maintainer's ruling names it — for the one reason that cannot be
// argued with: `@object-ui/fields` DEPENDS on this package, so importing it
// here is a cycle. `core` re-homes the table and `fields` re-exports it, so
// both spellings resolve to the SAME function and the SAME dedupe set.
import {
  ComponentRegistry,
  isRealCalendarDate,
  isRetiredFieldType,
  reportRetiredFieldType,
  toDateTimeInputValue,
} from "@object-ui/core"
import { createSafeTranslation } from "@object-ui/i18n"

import { cn } from "../lib/utils"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Checkbox } from "../ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { Input } from "../ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"

/**
 * One row of the FilterBuilder UI.
 *
 * Deliberately NOT `FilterCondition` (objectstack#4115): the spec owns that
 * name for the RECURSIVE ObjectQL predicate AST — `{ [field]: FieldOperators }`
 * with `$and` / `$or` / `$not` branches — which is a query, not a row. This is
 * one flat `{ field, operator, value }` line plus the React key the list needs,
 * and `operator` here is the builder's own dropdown vocabulary
 * (`FILTER_BUILDER_OPERATORS`), not the spec's `$`-tokens.
 *
 * DERIVED from `@object-ui/types`' `FilterBuilderCondition` (objectui#9306).
 * That declaration is the one name authority for the row; this one takes every
 * member from it (`id`, required since objectui#8415, and `field`) and restates
 * exactly two, each a named extension:
 *
 *   - `operator` — {@link FilterBuilderOperator}: the protocol's ids, which is
 *     what the authority declares, plus the opt-in `exists` / `notExists` the
 *     protocol has no member for (objectui#9559 ruling B keeps them opt-in and
 *     unfolded). It was `string`, which let a caller hand the builder an id no
 *     dropdown entry can hold.
 *   - `value` — REQUIRED and narrowed to the scalar-or-list union this builder
 *     edits, where the authority declares `value?: any`. Every exported helper
 *     below that takes a row's value (`reshapeFilterValue`, `retypeFilterValue`,
 *     `narrowFilterValueToOptions`, …) is typed on this member, so `any` here
 *     would switch their checking off in silence.
 *
 * Its own NAME, not the authority's (objectui#6349, batch 12). Under the
 * authority's name this was a second declaration of `FilterBuilderCondition`
 * with a different shape: the two are assignable in neither direction (the
 * operator blocks one way, the value's requiredness the other), so an
 * auto-import picked one of two rows by package. `FilterBuilderCondition` now
 * means the authored row in `@object-ui/types` only, and this specialisation
 * is named for the builder that edits it.
 */
export interface FilterBuilderRow
  extends Omit<AuthoredFilterBuilderCondition, "operator" | "value"> {
  operator: FilterBuilderOperator
  value: string | number | boolean | (string | number | boolean)[]
}

/**
 * The group the FilterBuilder edits: one `logic` over FLAT rows.
 *
 * DERIVED from `@object-ui/types`' `FilterGroup` like the row above
 * (objectui#9306), and named apart from it for the same reason
 * (objectui#6349, batch 12): `FilterGroup` means the authored group only. Only
 * `conditions` is restated, to hold THIS package's row; `id` and `logic` are
 * the authority's own. So `id` is OPTIONAL here, as it is there: nothing in
 * this builder reads a group's `id`, `onChange` hands back whatever group the
 * host passed (an id-less group comes back id-less), and only `EMPTY_GROUP`
 * invents one. The `id: string` this package used to declare described a
 * group the builder never guaranteed.
 *
 * `conditions` is flat because the builder is: it draws each entry as one row
 * and has no control that creates a group. The authority retired nested
 * sub-groups in the same change and its zod mirror refuses one by name.
 */
export interface FilterBuilderRowGroup extends Omit<AuthoredFilterGroup, "conditions"> {
  conditions: FilterBuilderRow[]
}

export interface FilterBuilderProps {
  fields?: Array<{ 
    value: string
    label: string
    type?: string
    options?: Array<{ value: string; label: string }> // For select fields
    /** For lookup/master_detail/user fields — referenced object name */
    referenceTo?: string
    /** Display field on the referenced object (defaults to "name") */
    displayField?: string
    /** ID field on the referenced object (defaults to "id") */
    idField?: string
  }>
  value?: FilterBuilderRowGroup
  onChange?: (value: FilterBuilderRowGroup) => void
  className?: string
  showClearAll?: boolean
  /**
   * Opt-in operator ids ({@link OPT_IN_OPERATORS}) this instance may offer, on
   * top of the ones every FilterBuilder draws.
   *
   * The dropdown is shared by consumers that persist a filter into DIFFERENT
   * dialects, and an operator one dialect can carry is not automatically
   * storable in another — so whether an opt-in operator is offered is the
   * consumer's answer, not this component's. See {@link OPT_IN_OPERATORS} for
   * the measurement that made this a prop instead of one global list.
   */
  extraOperators?: readonly string[]
}

// `label` is the English fallback; the actual rendered text comes from
// `filterBuilder.operators.<value>` so operators are translated like the rest
// of the builder. Keep the two in sync when adding operators.
//
// The ids ARE the protocol's operator ids (objectui#9306): every one of the
// twenty members of `@objectstack/spec`'s `VIEW_FILTER_OPERATORS`, spelled as
// the spec spells them, plus the two opt-in existence ids the protocol has no
// member for (`exists` / `notExists`, see `OPT_IN_OPERATORS`). The camelCase
// spellings this list used to carry (`notEquals`, `greaterOrEqual`, …) are the
// spec's DEPRECATED alias form (objectui#7993): a stored filter carrying one is
// still read — {@link normalizeFilterBuilderOperator} folds it onto the id below
// — and the next write the author makes stores the canonical id instead.
// `filter-builder-protocol-ids-9306.test.tsx` pins the twenty against the spec
// itself, so this list cannot drift behind the protocol again.
const defaultOperators = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "contains", label: "Contains" },
  // Case-insensitive `contains` — the spec's `$icontains` (objectui#4023), and
  // its own member of the protocol set: `contains` and `icontains` are two
  // operators, never one with a flag (objectui#7379).
  { value: "icontains", label: "Contains (ignore case)" },
  { value: "not_contains", label: "Does not contain" },
  { value: "is_empty", label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
  { value: "greater_than_or_equal", label: "Greater than or equal" },
  { value: "less_than_or_equal", label: "Less than or equal" },
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "between", label: "Between" },
  { value: "in", label: "In" },
  { value: "not_in", label: "Not in" },
  // String-specific spec operators ($startsWith / $endsWith) — they validated
  // at the data layer but were unreachable from this dropdown (#2942).
  { value: "starts_with", label: "Starts with" },
  { value: "ends_with", label: "Ends with" },
  // Null / existence spec operators ($null / $exists). Distinct from
  // is_empty/is_not_empty, which also treat '' as empty.
  { value: "is_null", label: "Is null" },
  { value: "is_not_null", label: "Is not null" },
  { value: "exists", label: "Is set" },
  { value: "notExists", label: "Is not set" },
] as const

/**
 * Operator ids the dropdown draws ONLY when the consumer names them in
 * `extraOperators`. Every other id in `defaultOperators` is offered to every
 * consumer.
 *
 * ## Why an operator would ever be opt-in (objectui#4023, objectui#4736)
 *
 * This one dropdown feeds three different at-rest dialects, and they do not
 * accept the same operators:
 *
 *   - **MongoDB-style `FieldOperatorsSchema` criteria** — what
 *     `FilterConditionField` writes into a sharing rule's `criteria_json`,
 *     evaluated by the server's engine. Its vocabulary is the spec's
 *     `FILTER_OPERATORS`, the widest of the three.
 *   - **`ViewFilterRule[]`** — what `viewFilterFold` persists for a saved view,
 *     and what the Studio inspector's `FilterBuilderField` writes. Its
 *     vocabulary is the spec's `VIEW_FILTER_OPERATORS`; a rule outside that
 *     enum is refused by `ViewFilterRuleSchema`.
 *   - **The array/triplet filter AST** — what `ListView` sends for the live
 *     grid, via `mapOperator`. Its vocabulary is the spec's
 *     `VALID_AST_OPERATORS`; an unmapped operator is emitted verbatim and the
 *     query comes back broken (see
 *     `packages/data-objectstack/src/filter-operator-ast-parity.test.ts` for
 *     what "broken" costs — an unfiltered read or a 400, either way not the
 *     filter the user asked for).
 *
 * So an operator only one dialect can carry is offered only by the consumer
 * that speaks that dialect. Mapping it onto a near-equivalent in the others is
 * NOT the alternative: that is a different question silently answered — the
 * same reason `view-operator-builder-parity.test.ts` refuses to map `is_null`
 * onto `is_empty`.
 *
 * Which side of the line an id falls on is not left to this comment.
 * `plugin-list`'s `list-offered-operator-expressible-parity.test.ts` forces the
 * set the list toolbar offers to EQUAL the set its two dialects can express, in
 * both directions: an unexpressible id that stays offered fails, and an id that
 * becomes expressible while still withheld fails too.
 *
 * ### `icontains` — opt-in no longer (objectui#4023, objectui#9306)
 *
 * It was opt-in under its old id `containsCaseInsensitive`, on the ground that
 * only the Mongo criteria dialect could carry a case-insensitive contains. That
 * ground is gone, and it went before this entry did: `VIEW_FILTER_OPERATORS`
 * has declared `icontains` since `@objectstack/spec` 17.1.0 (objectui#5328),
 * `VALID_AST_OPERATORS` carries it, and `ListView`'s `mapOperator` has its own
 * arm for it. The parity test above could not see that while the dropdown's id
 * was `containsCaseInsensitive` — a spelling the spec's alias table does not
 * fold, so it read as unexpressible on both dialects. Once the dropdown spoke
 * the protocol's id, the same test measured it expressible on both and withheld,
 * which is exactly the "delete the entry" event the last paragraph of this
 * docblock describes. So it is an ordinary operator now, offered on the text
 * bucket to every consumer; `app-shell`'s dataset bridge maps it to the spec's
 * `$icontains`, the token `FilterConditionField` has always written for it.
 *
 * ### `exists` / `notExists` — the spec's `$exists` (objectui#4736)
 *
 * Added by objectui#2942 to make `$exists` reachable from
 * `FilterConditionField`, but offered to every consumer, including the two that
 * cannot store them. Measured on `@objectstack/spec` 17.0.0-rc.6: neither
 * `VIEW_FILTER_OPERATORS` nor `VALID_AST_OPERATORS` contains an existence
 * operator — not under this spelling, not under any other; both sets have ZERO
 * members matching `/exist/`. So there was nothing to map onto and the id went
 * out verbatim.
 *
 * Collapsing them onto `is_not_null` / `is_null` would be a semantic claim, not
 * a bridge, and it is refused on three counts (and ruled so again for
 * objectui#9306, by objectui#9559's ruling B: they stay opt-in, unfolded):
 *
 *   1. The builder already offers `is_null` / `is_not_null` as their own rows,
 *      so the collapse would draw two labels for one wire predicate.
 *   2. The round trip is lossy: a saved `exists` reads back through
 *      `specToBuilderOperator('is_not_null')` as `is_not_null`, silently
 *      rewriting the author's choice on reopen.
 *   3. The equivalence is not this repo's to declare. `@objectstack/spec`'s own
 *      `data/index.d.ts` records `$exists` = has-value (`!= null`) as settled
 *      and shipped on `formula` and `driver-memory`'s reference matcher, while
 *      `driver-memory`'s live mingo path and `driver-mongodb` still read
 *      KEY-PRESENCE, both frozen by objectstack#5499 — which is why upstream
 *      cannot enrol a `$exists` conformance row yet either.
 *
 * The lasting fix is upstream — the view and AST vocabularies gaining the
 * operator — at which point the entry below is deleted, the parity test flips
 * it back on by itself, and the operator becomes ordinary.
 */
const OPT_IN_OPERATORS = new Set<string>([
  "exists",
  "notExists",
])

/**
 * The FilterBuilder's own operator vocabulary — every id its dropdown can
 * hold, derived from the operators it actually renders. Includes the opt-in
 * ids: they are drawable, just not offered unconditionally.
 *
 * Since objectui#9306 these ARE the protocol's ids — the twenty members of the
 * spec's `VIEW_FILTER_OPERATORS`, plus the opt-in `exists` / `notExists` the
 * protocol has no member for — so a table that maps the spec's vocabulary onto
 * this one is an identity over the twenty. It is still exported because those
 * tables, and the parity pins over them, assert against this list rather than
 * restating it: a value that is not in it produces a condition row whose
 * operator select has nothing to select.
 */
export const FILTER_BUILDER_OPERATORS = defaultOperators.map(o => o.value)

/**
 * An operator id the FilterBuilder can render: the spec's `ViewFilterOperator`
 * plus the two opt-in existence ids (objectui#9306). A type-level pin in
 * `filter-builder-protocol-ids-9306.test.tsx` holds it EQUAL to that union, so
 * a protocol member added upstream fails to compile there until the dropdown
 * offers it.
 */
export type FilterBuilderOperator = (typeof defaultOperators)[number]['value']

const FILTER_BUILDER_OPERATOR_IDS: ReadonlySet<string> = new Set(FILTER_BUILDER_OPERATORS)

/**
 * Is this spelling one of the builder's own ids — a value a row's `operator`
 * may hold (objectui#9306)?
 *
 * The narrowing a `string` needs before it can be written into a
 * {@link FilterBuilderRow}: the operator Select hands back a `string`, and
 * {@link normalizeFilterBuilderOperator} answers one. Membership is read from
 * the list the dropdown renders, never restated.
 */
function isFilterBuilderOperator(operator: string): operator is FilterBuilderOperator {
  return FILTER_BUILDER_OPERATOR_IDS.has(operator)
}

/**
 * The one stored spelling the builder reads that the spec's alias table does
 * NOT fold (objectui#9306).
 *
 * Every other camelCase id this dropdown used to write — `notEquals`,
 * `greaterOrEqual`, `isNull`, … — is a row of `VIEW_FILTER_OPERATOR_ALIASES`,
 * so `normalizeFilterOperator` already folds it onto the protocol id and this
 * file does not restate it. `containsCaseInsensitive` is the exception,
 * measured: `normalizeFilterOperator('containsCaseInsensitive')` returns its
 * input unchanged, because the spec's table has no row for it. A filter the
 * builder saved under that id (a sharing rule's `FilterConditionField`, the one
 * consumer it was offered to) must still load as the operator it is, so this
 * row is the builder's own — the ONE local alias, not a second vocabulary. The
 * spec-side row is objectstack-ai/objectstack#20092; when the spec's table
 * gains it, this map is deleted and the fold below is the spec's alone.
 */
const UNFOLDED_LEGACY_OPERATOR_IDS: ReadonlyMap<string, FilterBuilderOperator> = new Map<string, FilterBuilderOperator>([
  ["containsCaseInsensitive", "icontains"],
])

/**
 * The spelling a stored operator is READ as — the protocol id for every
 * spelling the spec or this builder ever wrote (objectui#9306).
 *
 * The ruling this executes: camelCase is the deprecated alias form
 * (objectui#7993), accepted on read and rewritten on write. So a filter stored
 * as `{ operator: 'greaterOrEqual' }` keeps loading — it is folded here, through
 * the spec's own `normalizeFilterOperator`, onto `greater_than_or_equal` — and
 * the builder holds and emits that canonical id from then on, so the next write
 * the author makes stores it. A lossless conversion on the read side, ⛔ not a
 * second vocabulary: nothing this builder EMITS is ever a camelCase id.
 *
 * An id nothing folds (`exists`, `notExists`, a spelling from no vocabulary)
 * comes back unchanged, exactly as the spec's normalizer returns it: inventing
 * a mapping for a word the protocol does not contain would be a claim, not a
 * repair.
 *
 * ⚠️ One guard on the spec's answer, and only because the builder now STORES
 * what this returns (before objectui#9306 the fold was used for comparison
 * only). `normalizeFilterOperator` is declared to return a string, but it
 * looks the spelling up on a plain object, so an `Object.prototype` key comes
 * back as whatever the prototype holds — `'constructor'` returns the `Object`
 * function, measured on `@objectstack/spec` 17.4.0. Held in a row and written
 * back, that would drop the row's operator on serialisation. A non-string
 * answer is therefore treated as "nothing folds" and the spelling is kept;
 * the defect itself belongs to the spec and is reported there, not patched
 * around here in any other way.
 */
export function normalizeFilterBuilderOperator(operator: string): string {
  const local = UNFOLDED_LEGACY_OPERATOR_IDS.get(operator)
  if (local !== undefined) return local
  const folded: unknown = normalizeFilterOperator(operator)
  return typeof folded === "string" ? folded : operator
}

/**
 * A group with every row's operator read through
 * {@link normalizeFilterBuilderOperator} — the builder's read boundary.
 *
 * Returns the SAME object when no row's spelling moved, so a group that is
 * already canonical (every group this builder emitted itself) is not re-created
 * on each prop pass.
 */
function normalizeGroupOperators(group: FilterBuilderRowGroup): FilterBuilderRowGroup {
  let moved = false
  const conditions = group.conditions.map((c) => {
    if (!c || typeof c.operator !== "string") return c
    const operator = normalizeFilterBuilderOperator(c.operator)
    // A spelling the fold leaves outside this builder's ids is kept as the row
    // carried it, exactly as a spelling the fold leaves UNCHANGED is: every
    // answer the fold gives for a spelling it knows is one of the ids below.
    if (operator === c.operator || !isFilterBuilderOperator(operator)) return c
    moved = true
    return { ...c, operator }
  })
  return moved ? { ...group, conditions } : group
}

/**
 * Operator ids — this dropdown's own ids, which are the protocol's canonical
 * spellings since objectui#9306 — for which this builder renders no value
 * input, so "no value" is the row's FINISHED state, not an unfinished one
 * (objectui#4744).
 *
 * This is the source of truth for that distinction, and it lives here because
 * this component is the thing that decides it. But membership here is not the
 * whole question: `needsValueInput` below asks it of the row's spelling AFTER
 * {@link normalizeFilterBuilderOperator} (objectui#9302), so the gate answers
 * "no value" for spellings that are NOT members — the deprecated camelCase ids
 * a stored filter may still carry, and the alias rows the spec publishes for
 * those same operators. A consumer holding a spelling that did not come from
 * this dropdown must therefore fold it before asking, and fold this set's own
 * members through the same normalizer too — the spec's `normalizeFilterOperator`
 * is the identity on them, so that fold costs nothing and keeps the consumer
 * correct whichever vocabulary this set is written in. How much wider the
 * gate's preimage is is NOT restated here: the pin
 * `filter-builder-valueless-canonical-spelling-9302.test.tsx` walks the
 * spec's two published tables and names every row it measures, which is the
 * only form of that answer that moves when those tables do (AGENTS.md #9).
 *
 * Every consumer that has to tell a complete value-less row from a half-filled
 * one reads the membership FROM here rather than restating it:
 *
 *   - `plugin-list`'s `convertFilterGroupToAST` — what the live grid QUERIES;
 *   - `app-shell`'s `foldFilterGroupToSpecRules` — what a saved view PERSISTS.
 *
 * Placement is forced by the dependency graph — `app-shell` depends on
 * `plugin-list` depends on this package, so this is the only module all three
 * can reach — and it is also where the set belongs on the merits: the fact it
 * states is a fact about what this dropdown draws.
 *
 * Why it exists at all: each consumer used to keep its own copy, and the
 * live-grid copy listed only the two empty-string operators. A fresh row is
 * seeded `{ operator: 'equals', value: '' }` and the operator dropdown
 * preserves `value`, so picking **Is null** as the first action left
 * `value: ''` — the grid read that as an unfinished row, dropped it, and
 * applied NO filter at all while the panel showed one. Silent, and every
 * record came back.
 *
 * `exists` / `notExists` stay listed even though `OPT_IN_OPERATORS` withholds
 * them from most consumers (objectui#4736): the builder still draws them
 * value-less for `FilterConditionField`, which is exactly what this set
 * describes. Whether a consumer can EXPRESS an operator is a separate
 * question, answered by `OPT_IN_OPERATORS` and by each consumer's parity test.
 */
export const VALUELESS_FILTER_BUILDER_OPERATORS: ReadonlySet<string> = new Set([
  "is_empty",
  "is_not_empty",
  "is_null",
  "is_not_null",
  "exists",
  "notExists",
])

/**
 * The SHAPE an operator's `value` must have — the question
 * `ViewFilterRuleSchema` asks, asked here in the one place that decides what
 * input the user is given (objectui#3958).
 *
 *   - `list` — membership over any arity, `[]` included (`in` / `not_in`).
 *   - `pair` — exactly two bounds, in order (`between`).
 *   - `scalar` — everything else, including the value-less operators above
 *     (they draw no input at all, so their shape never reaches storage).
 */
export type FilterValueArity = "scalar" | "list" | "pair"

/**
 * The two families are IMPORTED from `@objectstack/spec`, never restated
 * (objectstack#6227 exports them for exactly this).
 *
 * This component used to decide the same fact from a local
 * `["in", "notIn"]` literal, and that literal was already one spelling adrift:
 * `notIn` is an ALIAS, the canonical member is `not_in`. Any path that hands
 * this builder a canonical operator — a stored view read back through a reader
 * that does not camelCase it — matched neither entry, so a SET operator got
 * the single-value input and the user typed a scalar into it.
 * `ViewFilterRuleSchema` then refused the row at save time, on a shape this
 * builder's own UI led them into building.
 */
const LIST_VALUE_OPERATORS: ReadonlySet<string> = new Set(VIEW_FILTER_LIST_VALUE_OPERATORS)
const PAIR_VALUE_OPERATORS: ReadonlySet<string> = new Set(VIEW_FILTER_PAIR_VALUE_OPERATORS)

/**
 * Which value shape `operator` takes, whichever spelling it arrives in.
 *
 * The argument is folded through {@link normalizeFilterBuilderOperator} — the
 * spec's own `normalizeFilterOperator` plus the builder's one unfolded legacy
 * id — first, so the canonical id this dropdown emits (`not_in`) and the
 * deprecated alias a stored filter may still carry (`notIn`) land on the same
 * answer. That fold is the whole point: one vocabulary, declared upstream,
 * consulted here — not a second local dialect kept in sync by hand.
 *
 * @internal exported for tests
 */
export function filterValueArity(operator: string): FilterValueArity {
  const canonical = normalizeFilterBuilderOperator(operator)
  if (LIST_VALUE_OPERATORS.has(canonical)) return "list"
  if (PAIR_VALUE_OPERATORS.has(canonical)) return "pair"
  return "scalar"
}

/**
 * Re-shape a row's `value` for the operator it is being changed TO.
 *
 * Switching the operator dropdown used to update `operator` alone, so the
 * value the previous family had produced simply survived the switch — a scalar
 * `"acme"` (or the seed `""`) still sitting there under `in`, which is
 * precisely the shape `ViewFilterRuleSchema` refuses. Re-shaping rather than
 * blanking keeps what the user typed wherever it still means something:
 *
 *   - to `list`: a scalar becomes a one-element list (`"acme"` → `["acme"]`),
 *     an empty scalar becomes `[]` — a real, spec-valid predicate;
 *   - to `pair`: the first two entries become `[min, max]`, padded with `""`;
 *     with nothing to carry it collapses to `[]`, which the write path reads
 *     as "row not filled in yet" and drops, exactly as it drops an empty
 *     scalar today;
 *   - to `scalar`: the first entry of a list survives; the rest cannot, and
 *     dropping them is the honest answer — `equals` compares against one value.
 *
 * @internal exported for tests
 */
export function reshapeFilterValue(
  value: FilterBuilderRow["value"],
  nextOperator: string,
): FilterBuilderRow["value"] {
  switch (filterValueArity(nextOperator)) {
    case "list":
      return Array.isArray(value) ? value : normalizeToArray(value)
    case "pair": {
      const [min = "", max = ""] = normalizeToArray(value)
      return min === "" && max === "" ? [] : [min, max]
    }
    default:
      return Array.isArray(value) ? (value[0] ?? "") : value
  }
}

/**
 * The operator a row keeps after its FIELD is changed, given the operators the
 * NEW field offers (objectui#4768).
 *
 * Each field type has its own operator bucket, and the buckets are not nested:
 * a `select` column offers `in` / `not_in`, a `text` column does not. Changing
 * the field used to write `{ field }` alone, so the row's operator survived
 * into a bucket that no longer contains it — `in` on a text column. The Radix
 * trigger then had nothing to render (its `SelectValue` matches against the
 * `SelectItem`s actually mounted) and went BLANK, while the row went on
 * filtering by an operator the user could no longer see or reach.
 *
 * So the two edits are one edit, exactly as `changeOperator` made the operator
 * and its value shape one edit: an operator the new bucket still offers is the
 * user's choice and is KEPT; one it does not is replaced by the bucket's first
 * entry (`equals` for every bucket this builder draws), and the caller then
 * re-shapes the value for that operator's family.
 *
 * Membership is decided CANONICALLY, through
 * {@link normalizeFilterBuilderOperator} — the same fold `filterValueArity`
 * uses. A caller can hand this helper a row spelled with the deprecated alias
 * `notIn` while the dropdown lists the protocol id `not_in`; those are one
 * operator, so a select→lookup switch must not silently rewrite the author's
 * operator to `equals` just because the two spellings differ. The fold is safe
 * to compare through because it is INJECTIVE over this builder's vocabulary —
 * all 22 ids in `defaultOperators` normalize to 22 distinct canonical
 * operators, pinned in `filter-builder-field-switch-operator.test.tsx` — so no
 * two OFFERED operators can ever collapse onto one another.
 *
 * @internal exported for tests
 */
export function reconcileOperatorForField(
  operator: string,
  offeredOperators: ReadonlyArray<{ value: string }>,
): string {
  const canonical = normalizeFilterBuilderOperator(operator)
  const stillOffered = offeredOperators.some(
    (op) => normalizeFilterBuilderOperator(op.value) === canonical,
  )
  // Kept in the row's OWN spelling: a field switch is not a spelling migration.
  if (stillOffered) return operator
  return offeredOperators[0]?.value ?? operator
}

/**
 * The offered id the operator trigger COMPARES against — the last site in this
 * component that read the operator literally instead of through the spec's
 * fold (objectui#7561).
 *
 * Radix matches `SelectValue` against the `SelectItem`s actually MOUNTED, and
 * the mounted ids are this builder's own vocabulary — the protocol's canonical
 * ids since objectui#9306 (they were camelCase when this helper was written). A
 * row can hold the operator under another spelling of the SAME operator and
 * still be perfectly valid:
 *
 *   - a deprecated camelCase alias such as `greaterThan`, which a filter saved
 *     before objectui#9306 still carries;
 *   - the spec's alias table `gt` / `lt` / `eq`, which three schema-catalog
 *     entries author today.
 *
 * When this helper was written the mounted id was `greaterThan` and the stored
 * spelling `greater_than`; neither matched the other literally, so the trigger
 * drew BLANK over a row that filtered correctly — the user's own operator,
 * invisible and unreachable.
 * Everywhere the operator's MEANING matters this component already folds first
 * ({@link filterValueArity}, {@link reconcileOperatorForField}); this was the
 * one place it did not, and that omission — not the vocabulary divergence — is
 * what produced the blank.
 *
 * So the comparison is made canonically and the MOUNTED spelling is handed to
 * the trigger. Three things this deliberately does NOT do, each of them a
 * separate ruling (objectui#7561):
 *
 *   1. it does not rewrite `condition.operator` — the row keeps the spelling it
 *      arrived with, exactly as {@link reconcileOperatorForField} keeps it, and
 *      nothing is written back on render. (Since objectui#9306 the BUILDER
 *      folds a row's spelling once, at its read boundary — see
 *      {@link normalizeFilterBuilderOperator} — so the rows it renders already
 *      hold protocol ids. This helper still folds both sides, because it is
 *      exported and its caller's rows need not have come through that
 *      boundary.)
 *   2. it does not mount a new `SelectItem`, so the vocabulary the dropdown
 *      EMITS is byte-identical — contrast the value select above, where
 *      objectui#4874 ruling C mounts the outside-options value as its own
 *      option. That answer is right there and wrong here: the value's domain is
 *      the author's data, while the operator's domain is a declared vocabulary,
 *      and mounting a foreign spelling would admit a second one;
 *   3. it does not widen what any schema ACCEPTS.
 *
 * Safe to compare through because the fold is INJECTIVE over this builder's
 * vocabulary — all 22 ids in `defaultOperators` normalize to 22 distinct
 * canonical operators, pinned in `filter-builder-field-switch-operator.test.tsx`
 * — so no two OFFERED operators can collapse onto one another and the match is
 * unambiguous. An operator no offered id folds onto falls through to the row's
 * own spelling and still draws blank: inventing a label for a word this
 * vocabulary does not contain would be a claim, not a repair.
 *
 * @internal exported for tests
 */
export function mountedOperatorValue(
  operator: string,
  offeredOperators: ReadonlyArray<{ value: string }>,
): string {
  const canonical = normalizeFilterBuilderOperator(operator)
  const mounted = offeredOperators.find(
    (op) => normalizeFilterBuilderOperator(op.value) === canonical,
  )
  return mounted?.value ?? operator
}

/**
 * The value FAMILY a field type edits in — the same six branches
 * {@link getInputType} draws its `<input type>` from, named once so the type a
 * value is CONVERTED to and the input it is EDITED in cannot disagree
 * (objectui#4781).
 *
 * `boolean` is its own family even though it renders no `<input>` at all (a
 * two-item Select): what it can hold is a distinct question from what a text
 * box can hold, and that is what this answers.
 */
type FilterValueFamily = "text" | "number" | "boolean" | "date" | "datetime" | "time"

function valueFamilyForFieldType(fieldType: string | undefined): FilterValueFamily {
  const type = fieldType || "text"
  if (numberLikeTypes.includes(type)) return "number"
  if (type === "boolean") return "boolean"
  if (type === "date") return "date"
  if (type === "datetime") return "datetime"
  if (type === "time") return "time"
  // select / status / lookup / master_detail / user / text / unknown — and a
  // RETIRED spelling, which the gate has already refused upstream but whose
  // VALUE must still survive a field switch (objectui#4914): all edited as free
  // text or as a list of option ids, all string-shaped. Deliberately NOT gated:
  // this function answers "what shape can this column hold", and answering
  // "none" for a retired column would EAT a stored filter value on the way to
  // showing the author their prescription.
  return "text"
}

/**
 * The `<input type>` each family is edited with.
 *
 * Module-private on purpose: what a column DRAWS is observable from the
 * rendered input, and that is where the tests pin it, so publishing this table
 * would widen the package's API for nothing.
 */
const FILTER_INPUT_TYPE_BY_FAMILY: Readonly<Record<FilterValueFamily, string>> = {
  text: "text",
  number: "number",
  date: "date",
  datetime: "datetime-local",
  time: "time",
  // Never reached today — a boolean column's bucket offers only
  // `equals`/`notEquals`, both of which take the two-item Select above. Mapped
  // to the harmless default rather than left absent, so the record stays total.
  boolean: "text",
}

/** `YYYY-MM-DDTHH:mm[:ss[.sss]]` with NO zone — what `datetime-local` emits. */
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/
/** `HH:mm[:ss]`, the form `<input type="time">` both renders and emits. */
const CLOCK_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

// "A date that exists" is `isRealCalendarDate`, imported from
// `@object-ui/core`: it moved there so the shared date DISPLAY path refuses
// the same nonexistent day this authoring boundary refuses (objectui#10026).

/** A clock reading that exists — the pattern alone would accept `29:71`. */
function isRealClockTime(hours: string, minutes: string, seconds?: string): boolean {
  return (
    Number(hours) <= 23 &&
    Number(minutes) <= 59 &&
    (seconds === undefined || Number(seconds) <= 59)
  )
}

/**
 * ONE scalar, converted into `family`, or `undefined` when that family cannot
 * hold it — the single convertibility judgement this component makes
 * (objectui#4781, ruled there as option B: convert when convertible, clear
 * otherwise).
 *
 * The bar is a CLEAN, unambiguous reading, never a lenient one:
 *
 *   - **number** — `Number()` over the trimmed string, kept only if finite.
 *     `"42"` → `42`; `"42abc"`, `"1,000"` and `"acme"` convert to nothing and
 *     the caller clears them. `parseFloat` is what this refuses to be: it reads
 *     `"42abc"` as `42` and `"acme"` as `NaN`, and the `|| 0` that used to
 *     follow it buried both as `0` — a filter the user never wrote, which is
 *     precisely what objectui#4781 ruled against.
 *
 *     Since objectui#4875 the three KEYED paths in this file read through here
 *     too — `MultiValueInput`'s `commit`, the range's `setBound`, and the
 *     single input's `handleValueChange` — so the file holds ONE answer to "is
 *     this string a number" instead of a strict one for field switches beside a
 *     lenient one for typing. What each does with an unreadable string is still
 *     its own question, and they answer it differently on purpose (clear, clear,
 *     decline-and-keep-the-draft); what none of them may do is invent a number.
 *     That convergence is drift insurance rather than a live repair: all three
 *     sit behind `<input type="number">`, which hands back `""` for anything
 *     non-numeric, so the lenient branch was unreachable while it existed. The
 *     day one of them becomes a text box — formulas, variables, a paste path —
 *     the strict reading is already the one in force.
 *   - **boolean** — only the two words the row can round-trip back out of a
 *     boolean column (`"true"` / `"false"`, trimmed, case-insensitively).
 *     `1` / `0` / `"yes"` are conventions, not readings, so they clear.
 *   - **date / datetime / time** — only a value the target's own input can
 *     render as-is, plus the one truncation that loses nothing that input could
 *     have shown anyway (a zoneless timestamp → its date). Everything else
 *     clears, which is the ruling's default:
 *       - `date` ← `"2024-03-05"` as-is, `"2024-03-05T14:30"` → `"2024-03-05"`;
 *       - `datetime` ← a zoneless `YYYY-MM-DDTHH:mm[:ss]` as-is. A bare date
 *         does NOT convert: appending midnight would invent the half of the
 *         value the user never gave, and `equals 2024-03-05T00:00` is a filter
 *         that silently matches almost nothing — worse than an empty input;
 *       - `time` ← `HH:mm[:ss]` as-is. A timestamp does NOT convert: a
 *         time-of-day column asks a different question than an instant does.
 *     A zone-carrying string (`…Z`, `…+08:00`) clears everywhere: no input here
 *     can render it, and truncating it by hand is exactly the ambiguity the
 *     ruling says to refuse.
 *   - **text** — holds everything, so nothing clears; a non-string is written
 *     out with `String()` so the row's value is typed for the column it now
 *     filters (`42` → `"42"`, `true` → `"true"`).
 *
 * The empty scalar `""` is returned unchanged by every family: an unfilled row
 * is already in the family's empty shape, and "clearing" it would be a no-op
 * dressed as a decision.
 */
function convertScalarToFamily(
  value: string | number | boolean,
  family: FilterValueFamily,
): string | number | boolean | undefined {
  if (value === "") return ""

  switch (family) {
    case "text":
      return typeof value === "string" ? value : String(value)

    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined
      if (typeof value === "boolean") return undefined
      const trimmed = value.trim()
      if (trimmed === "") return ""
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    case "boolean": {
      if (typeof value === "boolean") return value
      if (typeof value === "number") return undefined
      const token = value.trim().toLowerCase()
      return token === "true" ? true : token === "false" ? false : undefined
    }

    case "date": {
      if (typeof value !== "string") return undefined
      const trimmed = value.trim()
      const local = LOCAL_DATE_TIME_PATTERN.exec(trimmed)
      if (local) {
        return isRealCalendarDate(local[1]) && isRealClockTime(local[2], local[3], local[4])
          ? local[1]
          : undefined
      }
      return isRealCalendarDate(trimmed) ? trimmed : undefined
    }

    case "datetime": {
      if (typeof value !== "string") return undefined
      const trimmed = value.trim()
      const local = LOCAL_DATE_TIME_PATTERN.exec(trimmed)
      if (!local) return undefined
      return isRealCalendarDate(local[1]) && isRealClockTime(local[2], local[3], local[4])
        ? trimmed
        : undefined
    }

    case "time": {
      if (typeof value !== "string") return undefined
      const trimmed = value.trim()
      const clock = CLOCK_TIME_PATTERN.exec(trimmed)
      if (!clock) return undefined
      return isRealClockTime(clock[1], clock[2], clock[3]) ? trimmed : undefined
    }
  }
}

/**
 * Re-TYPE a row's `value` for the field it is being changed TO — the type
 * question, standing beside {@link reshapeFilterValue}'s shape question
 * (objectui#4781).
 *
 * Changing a row's field used to carry the value through untouched whenever the
 * shape did not have to change, which is right about the shape and wrong about
 * the type: the value input is re-drawn from the NEW field's type, and an
 * `<input type="number">` renders a non-numeric value as BLANK. So a `text`
 * row filtered `equals "acme"`, pointed at a number column, showed an empty box
 * while the row went on carrying `"acme"` — `foldFilterGroupToSpecRules`
 * persisted it and the live grid queried `amount equals "acme"`. The same
 * invisible-value shape objectui#4768 closed on the operator, one column over.
 *
 * Carry-if-possible, exactly as `reshapeFilterValue` carries what it can across
 * a family change: `"42"` moved to a number column becomes `42` and survives;
 * `"acme"` cannot be read as a number by any clean reading, so it clears to the
 * family's empty shape — scalar `""`, list `[]`, pair `[]`. What a value can
 * become is decided in one place, {@link convertScalarToFamily}.
 *
 * The arity is read from the operator through the same `filterValueArity` fold
 * the rest of this component uses, because each shape clears differently:
 *
 *   - `scalar` — converted, or `""`.
 *   - `list` — converted ENTRY BY ENTRY, keeping the ones that carry:
 *     `["42", "acme"]` → `[42]`, and `[]` when none do. Reachable today only
 *     between the two buckets that offer `in`/`not_in` (`select` ↔ `lookup`),
 *     which are both text-family, so the conversion is the identity there; it
 *     is written for the family the operator lands in rather than for today's
 *     buckets, and pinned directly on this helper.
 *   - `pair` — both bounds converted independently, an unconvertible bound
 *     becoming `""` so the range keeps its two slots; both empty collapses to
 *     `[]`, the "not filled in yet" shape `reshapeFilterValue` also produces
 *     and the write path drops.
 *
 * @internal exported for tests
 */
export function retypeFilterValue(
  value: FilterBuilderRow["value"],
  fieldType: string | undefined,
  operator: string,
): FilterBuilderRow["value"] {
  const family = valueFamilyForFieldType(fieldType)

  switch (filterValueArity(operator)) {
    case "list": {
      const carried: (string | number | boolean)[] = []
      for (const entry of normalizeToArray(value)) {
        const converted = convertScalarToFamily(entry, family)
        if (converted !== undefined && converted !== "") carried.push(converted)
      }
      return carried
    }
    case "pair": {
      const [min = "", max = ""] = normalizeToArray(value)
      const lower = convertScalarToFamily(min, family) ?? ""
      const upper = convertScalarToFamily(max, family) ?? ""
      return lower === "" && upper === "" ? [] : [lower, upper]
    }
    default: {
      const scalar = Array.isArray(value) ? (value[0] ?? "") : value
      return convertScalarToFamily(scalar, family) ?? ""
    }
  }
}

/** The shape of a `fields` entry that the option-domain helpers below read. */
type OptionBearingField = {
  type?: string
  options?: ReadonlyArray<{ value: string; label: string }>
}

/**
 * How a value control compares a row's value against an option — `String()` on
 * both sides, which is what the rendered controls themselves do (the checkbox
 * list's `selectedValues.map(String).includes(String(opt.value))`, and Radix's
 * match of `SelectValue` against each mounted `SelectItem value`).
 *
 * Membership has to be decided the same way the control decides VISIBILITY, or
 * the two answers drift and we are back to a value the row keeps and the
 * control cannot show — the defect itself (objectui#4874).
 */
function optionKeysOf(field: OptionBearingField | undefined): string[] {
  return (field?.options ?? []).map((opt) => String(opt.value))
}

/**
 * Does this column carry a static option set that is actually IN PLACE — the
 * ONE mechanical criterion that splits the two halves of objectui#4874's ruling
 * (2026-08-17, A + C combined).
 *
 * `true` (a **static** column): the option set is the column's whole value
 * domain — nothing else can ever be picked in it and nothing else will arrive
 * later — so a value outside it is locally decidable as unholdable, and a field
 * switch clears it exactly as objectui#4781 clears a value the new column's
 * TYPE cannot hold.
 *
 * `false` (a **remote/async** column): the domain lives on the server. Three
 * ways to land here, all meaning "the local option set cannot vouch for this
 * value":
 *
 *   - `options` **absent** — the shape a lookup with `referenceTo` arrives in;
 *   - `options: []` — **present but not yet loaded**. Not hypothetical:
 *     `deriveFilterFields` in `@object-ui/fields` maps `Array.isArray(f.options)`
 *     through as-is, so an object whose picklist values have not arrived yields
 *     exactly this. A membership test against it would clear every value on
 *     earth;
 *   - not an array at all — a malformed `fields` entry decides nothing.
 *
 * This is also the criterion `renderValueInput`'s remote-picker branch reads
 * (objectui#5031), so the two questions a column raises — "which control is
 * drawn for it" and "may a value be cleared against it" — are answered from one
 * place. They used to disagree: that branch spelled the test `!field?.options`,
 * which is `false` for `options: []`, so a lookup whose options had not arrived
 * was handed the static Select (empty, no search box) by one answer while this
 * one called it remote and kept its value.
 *
 * For those, the ruling is the other half: never clear on a local non-membership
 * guess (a valid lookup id is not the local page's to delete), and never leave
 * the value invisible — which the render path answers unconditionally by
 * mounting the value as a temporary option.
 */
function hasStaticOptionDomain(field: OptionBearingField | undefined): boolean {
  const options = field?.options
  return Array.isArray(options) && options.length > 0
}

/**
 * Is this row's value control DRIVEN by the column's option set — i.e. can it
 * only ever display a value that is one of the options?
 *
 * Mirrors `renderValueInput`'s branch order, because "which control is drawn"
 * and "which values that control can show" are one question:
 *
 *   - `list` — the checkbox list over `field.options`; an entry matching no
 *     option is checked nowhere.
 *   - `pair` — `between` draws two plain range inputs and never consults the
 *     options, so any value is visible and none is out of domain. (`between`
 *     is not in the select/lookup buckets today; answered structurally rather
 *     than by that coincidence.)
 *   - `scalar` — the Radix Select, drawn only for the select/lookup-like types.
 *     A `text` column that happens to carry `options` keeps its plain input,
 *     which shows anything, so it is NOT option-driven.
 */
function isOptionDrivenValueControl(
  field: OptionBearingField | undefined,
  operator: string,
): boolean {
  if (!field?.options) return false
  const type = field.type || ""
  switch (filterValueArity(operator)) {
    case "list":
      return true
    case "pair":
      return false
    default:
      return selectLikeTypes.includes(type) || lookupLikeTypes.includes(type)
  }
}

/**
 * Narrow a row's `value` to the option DOMAIN of the field it is being changed
 * TO — the value-domain question, standing beside {@link retypeFilterValue}'s
 * type question and {@link reshapeFilterValue}'s shape question
 * (objectui#4874).
 *
 * objectui#4781 settled the TYPE half and deliberately stopped there: `select`
 * and `lookup` are text-family, so `"acme"` is a value those columns can
 * perfectly well HOLD. What it cannot be is one of the column's options — and
 * the control drawn for those columns is a Radix Select, whose trigger renders
 * only what one of its mounted `SelectItem`s carries. So a text row filtered
 * `equals "acme"`, pointed at a picklist column of `won`/`lost`, showed a BLANK
 * trigger while the row went on carrying `"acme"`:
 * `foldFilterGroupToSpecRules` persisted it and the live grid queried
 * `stage equals "acme"`. The third face of the same invisible value —
 * objectui#4768 on the operator, objectui#4781 on the value's type, this one on
 * its domain.
 *
 * Ruled 2026-08-17 as **A + C combined**, and the A half is this function:
 * clear on non-membership, but ONLY where the option set is the column's whole
 * domain ({@link hasStaticOptionDomain}). A remote/async column's value is
 * returned untouched — clearing it would delete a perfectly valid lookup id on
 * the strength of a local page that never claimed to be complete, and the C
 * half (the render path's temporary option) is what keeps it visible instead.
 * Option B — keep the value and tolerate it being invisible — stays rejected,
 * as it was on objectui#4781.
 *
 * The empty shape a cleared value falls to is objectui#4781's, unchanged and
 * read from the same `filterValueArity` fold:
 *
 *   - `scalar` — `""`.
 *   - `list` — filtered ENTRY BY ENTRY, keeping the members: `["acme", "won"]`
 *     → `["won"]`, and `[]` when none survive. Per-entry rather than
 *     all-or-nothing because each entry is its own filter term, and one bad
 *     term is no reason to throw away the user's good ones.
 *   - `pair` — untouched; `between` is not option-driven.
 *
 * @internal exported for tests
 */
export function narrowFilterValueToOptions(
  value: FilterBuilderRow["value"],
  field: OptionBearingField | undefined,
  operator: string,
): FilterBuilderRow["value"] {
  if (!hasStaticOptionDomain(field)) return value
  if (!isOptionDrivenValueControl(field, operator)) return value

  const allowed = new Set(optionKeysOf(field))

  if (filterValueArity(operator) === "list") {
    return normalizeToArray(value).filter((entry) => allowed.has(String(entry)))
  }

  const scalar = Array.isArray(value) ? (value[0] ?? "") : value
  if (isValueUnset(scalar)) return ""
  return allowed.has(String(scalar)) ? scalar : ""
}

/**
 * Is this row's value FINISHED for the operator it carries — the arity-aware
 * reading of "the user has filled this in" (objectstack#8815).
 *
 * Both write paths used to ask this with one shape-blind predicate:
 *
 * ```ts
 * value == null || value === '' || (Array.isArray(value) && value.length === 0)
 * ```
 *
 * which is right for `scalar` and `list` and WRONG for `pair`. A `between` row
 * with one bound typed is `["2024-01-01", ""]` — an array of length 2, so it
 * read as complete, and both consumers carried it through. The live grid then
 * queried a range with an empty upper bound and the server refused the whole
 * view (`400 INVALID_FILTER`), which is the "该视图的查询被拒绝" the reporter
 * hit; the saved-view path persisted the same half-range, so the refusal came
 * back on every later read of that view.
 *
 * The spec cannot catch this on the way past — measured against
 * `ViewFilterRuleSchema` on `@objectstack/spec` 17.0.0: `["2024-01-01", ""]` is
 * ACCEPTED (it counts the two slots, not what is in them), while a scalar or a
 * one-element array is refused. So the empty bound sails through authoring
 * validation and only dies at query time, one layer too late to be actionable.
 * That makes it the PRODUCER's job to not emit it — this component is what
 * decides when a row is finished, exactly as it already decides which operators
 * finish with no value at all ({@link VALUELESS_FILTER_BUILDER_OPERATORS}), and
 * for the same reason: each consumer keeping its own copy is how the two came to
 * disagree in the first place.
 *
 * The arity is read through the same `filterValueArity` fold the rest of this
 * file uses, so a stored rule spelled canonically gets the same answer as the
 * dropdown's own id.
 *
 * What each shape needs:
 *
 *   - `pair` — BOTH bounds present. A range missing an end is not a narrower
 *     range, it is a query the server refuses.
 *   - `list` — at least one entry; `[]` is the "nothing chosen yet" shape.
 *   - `scalar` — anything that is not the unfilled shape.
 *
 * "Present" is {@link isValueUnset}, never `!bound` (objectui#4873): `0` is a
 * real bound on a number column and `false` is a real value, and reading either
 * as unfilled would drop a filter the user can see on screen.
 *
 * This answers the VALUE question only. Whether an operator wants a value at all
 * stays with each caller, because the two layers see different vocabularies:
 * `app-shell` also has to recognise the canonical spellings (`is_null`) that
 * never reach this dropdown.
 *
 * @internal exported for tests
 */
export function isFilterValueComplete(
  operator: string,
  value: FilterBuilderRow["value"] | undefined | null,
): boolean {
  if (filterValueArity(operator) === "pair") {
    const bounds = normalizeToArray(value ?? "")
    return bounds.length === 2 && !isValueUnset(bounds[0]) && !isValueUnset(bounds[1])
  }
  return !(
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
}

/** The two bounds a `pair` row edits, with the gaps filled in for rendering. */
function toPairBounds(
  value: FilterBuilderRow["value"],
): [string | number | boolean, string | number | boolean] {
  const [min = "", max = ""] = normalizeToArray(value)
  return [min, max]
}

const useSafeFilterTranslation = createSafeTranslation(
  {
    'filterBuilder.where': 'Where',
    'filterBuilder.and': 'AND',
    'filterBuilder.or': 'OR',
    'filterBuilder.clearAll': 'Clear all',
    'filterBuilder.selectField': 'Select field',
    'filterBuilder.operator': 'Operator',
    'filterBuilder.selectValue': 'Select value',
    'filterBuilder.value': 'Value',
    'filterBuilder.addFilter': 'Add filter',
    'filterBuilder.removeCondition': 'Remove condition',
    'filterBuilder.trueLabel': 'True',
    'filterBuilder.falseLabel': 'False',
    'filterBuilder.noResults': 'No results',
    'filterBuilder.searchField': 'Search {{label}}…',
    'filterBuilder.enterId': 'Enter {{label}} id',
    'filterBuilder.addValue': 'Type a value, press Enter',
    'filterBuilder.removeValue': 'Remove {{value}}',
    'filterBuilder.rangeStart': 'From',
    'filterBuilder.rangeEnd': 'To',
    'filterBuilder.operators.equals': 'Equals',
    'filterBuilder.operators.not_equals': 'Does not equal',
    'filterBuilder.operators.contains': 'Contains',
    'filterBuilder.operators.icontains': 'Contains (ignore case)',
    'filterBuilder.operators.not_contains': 'Does not contain',
    'filterBuilder.operators.is_empty': 'Is empty',
    'filterBuilder.operators.is_not_empty': 'Is not empty',
    'filterBuilder.operators.greater_than': 'Greater than',
    'filterBuilder.operators.less_than': 'Less than',
    'filterBuilder.operators.greater_than_or_equal': 'Greater than or equal',
    'filterBuilder.operators.less_than_or_equal': 'Less than or equal',
    'filterBuilder.operators.before': 'Before',
    'filterBuilder.operators.after': 'After',
    'filterBuilder.operators.between': 'Between',
    'filterBuilder.operators.in': 'In',
    'filterBuilder.operators.not_in': 'Not in',
    'filterBuilder.operators.starts_with': 'Starts with',
    'filterBuilder.operators.ends_with': 'Ends with',
    'filterBuilder.operators.is_null': 'Is null',
    'filterBuilder.operators.is_not_null': 'Is not null',
    'filterBuilder.operators.exists': 'Is set',
    'filterBuilder.operators.notExists': 'Is not set',
    // How the two empty checks differ, on the columns that keep both pairs
    // (objectui#11810). The operator labels are interpolated rather than
    // restated, so the hint names them exactly as the dropdown above it does.
    'filterBuilder.emptyCheckHint.text': '"{{isEmpty}}" also matches blank text; "{{isNull}}" matches only a missing value.',
    'filterBuilder.emptyCheckHint.list': '"{{isEmpty}}" also matches an empty list; "{{isNull}}" matches only a missing value.',
    // The half-filled range's description, read from the SHARED `validation`
    // namespace rather than declared as a new `filterBuilder.*` key
    // (objectui#10061). `{{field}} is required` already exists in all ten packs
    // and `packages/components`' own `form.tsx` defaults table already mirrors
    // this exact row — a second spelling of the same sentence under a private
    // key would be a new string for ten translators to carry and a second
    // authority on wording. The value is copied VERBATIM from the `en` pack
    // because `pnpm check:i18n-keys` compares this row against it
    // (objectui#7567), and the hole is filled with the bound's own label
    // (`filterBuilder.rangeStart` / `rangeEnd`), which is what names the
    // missing side.
    'validation.required': '{{field}} is required',
  },
  'filterBuilder.where',
)

// Typed as the dropdown's own id union, so a bucket naming an id the dropdown
// does not draw — a stale camelCase spelling, say — fails to compile instead of
// silently offering nothing (objectui#9306).
const NULLNESS_OPERATORS: readonly FilterBuilderOperator[] = ["is_null", "is_not_null", "exists", "notExists"]
const textOperators: readonly FilterBuilderOperator[] = ["equals", "not_equals", "contains", "icontains", "not_contains", "starts_with", "ends_with", "is_empty", "is_not_empty", ...NULLNESS_OPERATORS]
const numberOperators: readonly FilterBuilderOperator[] = ["equals", "not_equals", "greater_than", "less_than", "greater_than_or_equal", "less_than_or_equal", "is_empty", "is_not_empty", ...NULLNESS_OPERATORS]
const booleanOperators: readonly FilterBuilderOperator[] = ["equals", "not_equals"]
const dateOperators: readonly FilterBuilderOperator[] = ["equals", "not_equals", "before", "after", "between", "is_empty", "is_not_empty", ...NULLNESS_OPERATORS]
const selectOperators: readonly FilterBuilderOperator[] = ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty", ...NULLNESS_OPERATORS]
const lookupOperators: readonly FilterBuilderOperator[] = ["equals", "not_equals", "in", "not_in", "is_empty", "is_not_empty", ...NULLNESS_OPERATORS]

/** Field types that share the same operator/input behavior as number (numeric comparison operators, number input) */
const numberLikeTypes = ["number", "currency", "percent", "rating"]
/** Field types that share the same operator/input behavior as date (before/after operators, date/datetime/time input) */
const dateLikeTypes = ["date", "datetime", "time"]
/** Field types that use select operators (equals/in/not_in) and render dropdown or checkbox list when options provided */
const selectLikeTypes = ["select", "status"]
/**
 * Relational/reference field types that use lookup operators (equals/in/not_in)
 * and render dropdown or checkbox list when options provided.
 *
 * `owner` left this list with objectui#4914: it is a RETIRED spelling, and
 * the gate below answers for it before this membership test is ever reached.
 * The deletion is lockstep hygiene rather than the behavioural half — a list
 * that still named a retired spelling would be a second, contradicting
 * authority on what is live — and it is exactly the shape PR #4932 used when
 * it retired the same word from `INLINE_ROUTED_FIELD_TYPES`.
 */
const lookupLikeTypes = ["lookup", "master_detail", "user"]

/**
 * The operators a row on a field of `fieldType` can HOLD, given the opt-in ids
 * this instance was granted — every operator the dropdown can draw for it.
 *
 * What the dropdown OFFERS a fresh choice is this set minus the nullness pair
 * on a type that cannot tell "empty" from "null" (objectui#11810, see
 * {@link offeredOperatorsForRow}). That narrowing is deliberately NOT applied
 * here: callers outside this file (`app-shell`'s dataset read-back,
 * `plugin-list`'s parity pin) ask "can the builder hold this row", and a
 * stored `is_null` on a `select` column still can.
 *
 * A pure function rather than a closure so the selection rule — and above all
 * the {@link OPT_IN_OPERATORS} gate, whose whole job is to keep an operator OFF
 * the surfaces that cannot store it — is assertable without driving a Radix
 * popover open in jsdom.
 *
 * @internal exported for tests
 */
export function operatorsForFieldType(
  fieldType: string | undefined,
  extraOperators: readonly string[] = [],
): ReadonlyArray<{ value: string; label: string }> {
  const type = fieldType || "text"
  // THE GATE (objectui#4914, ruling B), ahead of every bucket test.
  //
  // Measured before the ruling (comment 5324769751): `operatorsForFieldType`
  // answered a retired `owner` column with the LOOKUP bucket, item for item
  // identical to `user` — a first-class relational offering for a spelling this
  // renderer refuses to render. The gate refuses it here instead, LOUDLY: the
  // author gets the migration prescription on the console, once per spelling,
  // and the column falls to the bucket an unrecognised spelling gets.
  //
  // Falling to `textOperators` rather than to an EMPTY list is deliberate. An
  // empty bucket draws a blank operator trigger — objectui#4768's defect
  // verbatim — which is a broken control, not a refusal anyone can read, and it
  // would leave a stored filter row unremovable. The refusal is the console
  // prescription plus the loss of the relational offering.
  const retired = isRetiredFieldType(type)
  if (retired) reportRetiredFieldType(type)
  const bucket = retired
    ? textOperators
    : numberLikeTypes.includes(type)
      ? numberOperators
      : type === "boolean"
        ? booleanOperators
        : dateLikeTypes.includes(type)
          ? dateOperators
          : selectLikeTypes.includes(type)
            ? selectOperators
            : lookupLikeTypes.includes(type)
              ? lookupOperators
              : textOperators

  const granted = new Set(extraOperators)
  return defaultOperators.filter(
    (op) => bucket.includes(op.value) && (!OPT_IN_OPERATORS.has(op.value) || granted.has(op.value)),
  )
}

/**
 * The nullness pair a column offers only when its type can hold an empty
 * value that is not null (objectui#11810).
 */
const NULLNESS_PAIR: ReadonlySet<string> = new Set(["is_null", "is_not_null"])

/**
 * Which row of the spec's ruled 「is empty」 table a column of `fieldType`
 * takes — read from `@objectstack/spec`'s `expandEmptyOperator`, the one
 * function every server face expands `$empty` with, never from a local type
 * list (objectui#11810):
 *
 *   - `text` — text-like types: `is_empty` matches null OR `''`;
 *   - `multi_value` — list-valued types: `is_empty` matches null OR `[]`;
 *   - `null_only` — every other type: `is_empty` matches null only, which is
 *     exactly what `is_null` matches.
 *
 * Keyed on the TYPE alone because that is all a field descriptor here carries:
 * a `lookup` / `user` / `select` declared `multiple: true` is `multi_value` on
 * the server and is judged `null_only` here. The pair it is then offered,
 * `is_empty` / `is_not_empty`, is the one whose server expansion counts `[]`.
 */
function emptyCheckArm(fieldType: string | undefined) {
  return expandEmptyOperator({ type: fieldType || "text" }).arm
}

/**
 * The operators the dropdown MOUNTS for one row (objectui#11810).
 *
 * {@link operatorsForFieldType}, minus `is_null` / `is_not_null` on a column
 * whose type cannot tell empty from null (`null_only`, see
 * {@link emptyCheckArm}). There the two pairs are one predicate under two
 * labels — every dialect this builder writes expands `is_empty` on such a
 * column to "is null" — so an end user was asked to choose between two words
 * for the same records. `is_empty` / `is_not_empty` is the pair that stays: it
 * is offered on every bucket that has an empty check, so one label means one
 * thing across columns.
 *
 * The row's OWN operator is always mounted. A stored filter that already
 * reads `is_null` on a `select` column (a sharing rule's `$null`, a saved
 * view's `is_null` rule) must still load as what it is: an unmounted operator
 * draws a BLANK trigger (objectui#4768 / #7561), and nothing here rewrites a
 * stored spelling (objectui#9306 folds spellings, never predicates).
 */
function offeredOperatorsForRow(
  fieldType: string | undefined,
  extraOperators: readonly string[] | undefined,
  rowOperator: string,
): ReadonlyArray<{ value: string; label: string }> {
  const drawable = operatorsForFieldType(fieldType, extraOperators)
  if (emptyCheckArm(fieldType) !== "null_only") return drawable
  const held = normalizeFilterBuilderOperator(rowOperator)
  return drawable.filter((op) => !NULLNESS_PAIR.has(op.value) || op.value === held)
}

/**
 * Does this row have NO value — the ONE reading of "empty" this component makes
 * (objectui#4873).
 *
 * There are exactly three ways a row is unfilled: the seed `addCondition`
 * writes (`""`), a key an external `FilterBuilderRowGroup` never set (`undefined` /
 * `null`), and the empty shape `retypeFilterValue` clears to (`""`).
 * EVERYTHING else is a value the user chose — including the two falsy ones,
 * `false` and `0`.
 *
 * Spelled out rather than left to `!value`, and that is not a style preference:
 * `!value` answers a different question, and answering it here was the defect.
 * A boolean row filtered `equals false` showed the "Select value" placeholder
 * and a number row filtered `equals 0` showed an empty box, while both rows
 * went on carrying that value, persisting it through
 * `foldFilterGroupToSpecRules` and filtering by it in the live grid. Typing `0`
 * into a number column looked like the keystroke had not landed at all. The
 * same invisible-value shape objectui#4768 closed on the operator and
 * objectui#4781 on the value's type, this time on the value itself.
 *
 * `normalizeToArray` and `LookupValuePicker`'s `selectedIds` each used to spell
 * this out for themselves — correctly, as it happens; it was the DISPLAY path
 * that took the short spelling. One definition the three of them read is how
 * they stay agreed.
 */
function isValueUnset(
  value: FilterBuilderRow["value"] | undefined | null,
): boolean {
  return value === undefined || value === null || value === ""
}

/**
 * The string a value CONTROL shows for a row's current value — `""` if and only
 * if {@link isValueUnset} says the row has none (objectui#4873).
 *
 * `""` is precisely what makes a `<Select>` fall back to its placeholder and an
 * `<input>` render blank, so this is the only place allowed to produce it. A
 * value that IS there is stringified as it stands: `false` → `"false"`, which
 * is the boolean Select's own item value so the trigger reads "False"; `0` →
 * `"0"`, which a number input shows as `0`.
 */
function displayScalarValue(value: FilterBuilderRow["value"]): string {
  return isValueUnset(value) ? "" : String(value)
}

/** Normalize a filter value into an array for multi-select scenarios */
function normalizeToArray(value: FilterBuilderRow["value"]): (string | number | boolean)[] {
  if (Array.isArray(value)) return value
  if (!isValueUnset(value)) return [value as string | number | boolean]
  return []
}

/**
 * Defensive guard — only accept an external `value` that matches the
 * `FilterBuilderRowGroup` shape. Reports/Views may persist filters in protocol-native
 * shapes (e.g. MongoDB-style `{field: value}` from `@objectstack/spec`)
 * which would otherwise crash the renderer once it reaches
 * `filterGroup.conditions.length`.
 */
function isValidGroup(v: unknown): v is FilterBuilderRowGroup {
  return (
    !!v &&
    typeof v === "object" &&
    Array.isArray((v as FilterBuilderRowGroup).conditions) &&
    ((v as FilterBuilderRowGroup).logic === "and" || (v as FilterBuilderRowGroup).logic === "or")
  )
}

const EMPTY_GROUP: FilterBuilderRowGroup = { id: "root", logic: "and", conditions: [] }

function FilterBuilder({
  fields = [],
  value,
  onChange,
  className,
  showClearAll = true,
  extraOperators,
}: FilterBuilderProps) {
  const { t } = useSafeFilterTranslation()
  // THE READ BOUNDARY (objectui#9306). A group arriving from the host is held
  // with every row's operator folded onto its protocol id, so a filter stored
  // under a deprecated camelCase id loads as the operator it is — and since
  // every emit below spreads this state, the host's NEXT write carries the
  // canonical id. Nothing is emitted here on read: opening a stored filter
  // must not dirty the form that holds it, so the rewrite rides the author's
  // own next edit, exactly as the ruling orders ("accepted on read and
  // rewritten on write").
  const [filterGroup, setFilterGroup] = React.useState<FilterBuilderRowGroup>(
    isValidGroup(value) ? normalizeGroupOperators(value) : EMPTY_GROUP,
  )

  React.useEffect(() => {
    if (!isValidGroup(value)) return
    const next = normalizeGroupOperators(value)
    if (JSON.stringify(next) !== JSON.stringify(filterGroup)) {
      setFilterGroup(next)
    }
  }, [value])

  const handleChange = (newGroup: FilterBuilderRowGroup) => {
    setFilterGroup(newGroup)
    onChange?.(newGroup)
  }

  const addCondition = () => {
    const newCondition: FilterBuilderRow = {
      id: crypto.randomUUID(),
      field: fields[0]?.value || "",
      operator: "equals",
      value: "",
    }
    handleChange({
      ...filterGroup,
      conditions: [...filterGroup.conditions, newCondition],
    })
  }

  const removeCondition = (conditionId: string) => {
    handleChange({
      ...filterGroup,
      conditions: filterGroup.conditions.filter((c) => c.id !== conditionId),
    })
  }

  const clearAllConditions = () => {
    handleChange({
      ...filterGroup,
      conditions: [],
    })
  }

  const updateCondition = (conditionId: string, updates: Partial<FilterBuilderRow>) => {
    handleChange({
      ...filterGroup,
      conditions: filterGroup.conditions.map((c) =>
        c.id === conditionId ? { ...c, ...updates } : c
      ),
    })
  }

  /**
   * Change a row's operator AND bring its value into the shape the new
   * operator's family takes (objectui#3958).
   *
   * Deliberately not `updateCondition(id, { operator })`: that update carried
   * the previous family's value through untouched, which is how a scalar ended
   * up under `in`. The two edits are one edit — a row's operator and the shape
   * of its value are not independently settable — so they are made together
   * here rather than left for each caller to remember.
   */
  const changeOperator = (conditionId: string, nextOperator: FilterBuilderOperator) => {
    handleChange({
      ...filterGroup,
      conditions: filterGroup.conditions.map((c) =>
        c.id === conditionId
          ? { ...c, operator: nextOperator, value: reshapeFilterValue(c.value, nextOperator) }
          : c,
      ),
    })
  }

  const toggleLogic = () => {
    handleChange({
      ...filterGroup,
      logic: filterGroup.logic === "and" ? "or" : "and",
    })
  }

  const getOperatorsForField = (fieldValue: string) => {
    const field = fields.find((f) => f.value === fieldValue)
    return operatorsForFieldType(field?.type, extraOperators)
  }

  // What the row's operator dropdown mounts — see `offeredOperatorsForRow`.
  const getOperatorsForRow = (condition: FilterBuilderRow) => {
    const field = fields.find((f) => f.value === condition.field)
    return offeredOperatorsForRow(field?.type, extraOperators, condition.operator)
  }

  /**
   * The line under the operator list that says how "Is empty" and "Is null"
   * differ, for a dropdown that offers both (objectui#11810). Only a column
   * whose type can hold an empty value that is not null keeps both pairs, and
   * the hint names which empty value the extra pair counts. Nothing at all
   * when the dropdown offers at most one of them.
   */
  const renderEmptyCheckHint = (condition: FilterBuilderRow): React.ReactNode => {
    const ids = new Set(getOperatorsForRow(condition).map((op) => op.value))
    if (!ids.has("is_empty") || !ids.has("is_null")) return null
    const field = fields.find((f) => f.value === condition.field)
    const labels = {
      isEmpty: t("filterBuilder.operators.is_empty"),
      isNull: t("filterBuilder.operators.is_null"),
    }
    const arm = emptyCheckArm(field?.type)
    // A stored `is_null` held on a `null_only` column mounts both, and on that
    // column they match the same records: there is no difference to explain.
    if (arm === "null_only") return null
    return (
      <p
        className="mt-1 border-t px-2 pb-1 pt-1.5 text-xs text-muted-foreground"
        data-testid="filter-empty-check-hint"
      >
        {arm === "text"
          ? t("filterBuilder.emptyCheckHint.text", labels)
          : t("filterBuilder.emptyCheckHint.list", labels)}
      </p>
    )
  }

  /**
   * Change a row's field AND, when the new field's bucket no longer offers the
   * row's operator, reset that operator — re-shaping the value for the family
   * it lands in (objectui#4768).
   *
   * Deliberately not `updateCondition(id, { field })`: the operator buckets are
   * per field type and do not nest, so that update could leave `in` on a text
   * column — an operator the dropdown no longer lists, which rendered as a
   * BLANK trigger. The same shape as `changeOperator` above and for the same
   * reason: a row's field, its operator and its value shape are not
   * independently settable, so they are settled together here rather than left
   * for each caller to remember.
   *
   * An operator the new bucket DOES offer is left alone — resetting it would
   * throw away a choice that is still valid (switching `contains` from one text
   * column to another must not silently become `equals`).
   *
   * The value is settled in the same edit, in three steps that answer three
   * different questions and are all needed (objectui#4781, objectui#4874):
   *
   *   1. `reshapeFilterValue` — the SHAPE the new OPERATOR takes, and only when
   *      the operator actually changed;
   *   2. `retypeFilterValue` — the TYPE the new FIELD takes, always. A field
   *      switch redraws the value input from the new field's type, so a value
   *      that type cannot hold is a value the user can no longer see or edit
   *      while the row keeps filtering by it. Convertible values are carried
   *      (`"42"` → `42`); the rest clear.
   *   3. `narrowFilterValueToOptions` — the DOMAIN the new field offers, for the
   *      columns whose whole domain is local. Step 2 stops at the type, and
   *      `select`/`lookup` are text-family: `"acme"` is a string a picklist
   *      column can HOLD but not one of its options, and its Select shows only
   *      what an option carries. Remote/async columns are left alone here on
   *      purpose — see `hasStaticOptionDomain`.
   */
  const changeField = (conditionId: string, nextField: string) => {
    const offered = getOperatorsForField(nextField)
    const nextFieldDef = fields.find((f) => f.value === nextField)
    const nextType = nextFieldDef?.type
    handleChange({
      ...filterGroup,
      conditions: filterGroup.conditions.map((c) => {
        if (c.id !== conditionId) return c
        // `reconcileOperatorForField` answers either the row's own operator or
        // an id the new field offers — builder ids both — so this narrows the
        // helper's `string` answer to the row's type; it never picks a
        // different operator (objectui#9306).
        const reconciled = reconcileOperatorForField(c.operator, offered)
        const nextOperator = isFilterBuilderOperator(reconciled) ? reconciled : c.operator
        const reshaped =
          nextOperator === c.operator ? c.value : reshapeFilterValue(c.value, nextOperator)
        const retyped = retypeFilterValue(reshaped, nextType, nextOperator)
        return {
          ...c,
          field: nextField,
          operator: nextOperator,
          value: narrowFilterValueToOptions(retyped, nextFieldDef, nextOperator),
        }
      }),
    })
  }

  // The complement of the exported set, never a second literal beside it:
  // that set's whole job is to let other layers know which rows this builder
  // leaves value-less, and a hand-kept copy here is how they drifted apart.
  //
  // The row's spelling is folded through `normalizeFilterBuilderOperator`
  // before the lookup — the same fold `filterValueArity` and
  // `reconcileOperatorForField` perform — and the set's members are already
  // the folded (protocol) ids, so one spelling of an operator can never get a
  // different answer from another. The gate used to do a raw `has()` on
  // whatever spelling the row carried while the set held the dropdown's then
  // camelCase ids: a stored rule spelled `is_null` missed the set and was
  // treated as value-taking, drawing a box to type a value into beside a
  // trigger reading `Is null` (objectui#9302). One operator, two spellings,
  // two different rows — which the fold rules out in either direction.
  const needsValueInput = (operator: string) => {
    return !VALUELESS_FILTER_BUILDER_OPERATORS.has(normalizeFilterBuilderOperator(operator))
  }

  // Derived from the value FAMILY rather than from a second branch ladder over
  // the same type lists: the input a value is edited in and the type a value is
  // converted to on a field switch are the same question, and answering it
  // twice is how the two could come to disagree (objectui#4781) — the disagreement
  // being exactly the defect, a value the row keeps and its input cannot show.
  const getInputType = (fieldValue: string) => {
    const field = fields.find((f) => f.value === fieldValue)
    return FILTER_INPUT_TYPE_BY_FAMILY[valueFamilyForFieldType(field?.type)]
  }

  const renderValueInput = (condition: FilterBuilderRow) => {
    const field = fields.find((f) => f.value === condition.field)
    // The spec's vocabulary, not a local literal — and folded through
    // `normalizeFilterBuilderOperator`, so the deprecated alias `notIn` gets
    // the multi-value input the protocol id `not_in` gets.
    const arity = filterValueArity(condition.operator)
    const isMultiOperator = arity === "list"
    // THE GATE (objectui#4914, ruling B), ahead of the control choice.
    //
    // A RETIRED spelling never reaches the remote person picker, and is told so
    // out loud. Before the ruling an `owner` column rode this branch through
    // its own `type === "owner"` conjunct — the picker even defaulted its
    // `referenceTo` to "users" for it (see {@link LookupValuePicker}) — so the
    // one word this renderer refuses to render still got the richest control
    // the filter row has.
    //
    // The column then draws whatever an unrecognised spelling draws (an
    // option-driven Select when it carries `options`, a plain input otherwise)
    // — the same degradation `mapFieldTypeToFormType`'s `field:text` tail would
    // have given, EXCEPT that it is no longer silent. That distinction is the
    // whole ruling: the measurement that killed the "just delete the members"
    // plan (comment 5324769751) objected to the SILENCE, not to the fallback.
    const retiredColumn = isRetiredFieldType(field?.type)
    if (retiredColumn) reportRetiredFieldType(field!.type as string)
    const isLookupLike = !retiredColumn && lookupLikeTypes.includes(field?.type || "")

    // Lookup-like fields without a static option domain → remote search picker.
    //
    // `hasStaticOptionDomain`, never `!field?.options` (objectui#5031): `[]` is
    // truthy, so the old spelling answered "is the static domain in place?" with
    // YES for a column whose picklist values have not arrived — and drew the
    // option-driven Select over an option set of zero. The user got a control
    // with no search box and no candidates, on a column that would have had full
    // remote search had the `options` key simply been absent. The value-domain
    // side (`narrowFilterValueToOptions`) already reads `options: []` as
    // remote/not-yet-in-place; this branch now reads the SAME criterion, so
    // "which control is drawn" and "may this value be cleared" cannot give
    // opposite answers about one column. A column with NON-EMPTY `options` is
    // unaffected — it owns its domain and keeps the static Select.
    if (isLookupLike && !hasStaticOptionDomain(field) && (field?.referenceTo || field?.type === "user")) {
      return (
        <LookupValuePicker
          field={field!}
          value={condition.value}
          multiple={isMultiOperator}
          onChange={(value) => updateCondition(condition.id, { value })}
        />
      )
    }

    // For select/lookup fields with options and multi-select operator (in/not_in)
    if (field?.options && isMultiOperator) {
      const selectedValues = normalizeToArray(condition.value)
      // The list face of the same invisible value (objectui#4874). A selected
      // entry matching no option is checked NOWHERE — the checkbox list can only
      // ever show the options it draws — so the row went on filtering by a term
      // the panel never displayed. Each such entry gets its own row, already
      // checked, so it is both visible and removable; they lead the list because
      // they are the ones the user cannot otherwise find.
      const allowed = optionKeysOf(field)
      // De-duplicated: an externally supplied `["acme", "acme"]` would otherwise
      // draw two rows under one React key, and unchecking either removes both
      // (the handler filters by value, not by position) — so one row is also the
      // honest count of what unchecking does.
      const outsideOptions = [
        ...new Set(selectedValues.map(String).filter((entry) => !allowed.includes(entry))),
      ]
      return (
        <div className="max-h-40 overflow-y-auto space-y-0.5 border rounded-md p-2">
          {outsideOptions.map((entry) => (
            <label
              key={`outside-${entry}`}
              className="flex items-center gap-2 text-sm py-1 px-1.5 rounded cursor-pointer bg-primary/5 text-primary"
              data-testid={`filter-value-outside-options-${condition.field}`}
            >
              <Checkbox
                checked
                onCheckedChange={() =>
                  updateCondition(condition.id, {
                    value: selectedValues.filter((v) => String(v) !== entry),
                  })
                }
              />
              <span className="truncate">{entry}</span>
            </label>
          ))}
          {field.options.map((opt) => {
            const isChecked = selectedValues.map(String).includes(String(opt.value))
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex items-center gap-2 text-sm py-1 px-1.5 rounded cursor-pointer",
                  isChecked ? "bg-primary/5 text-primary" : "hover:bg-muted",
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...selectedValues, opt.value]
                      : selectedValues.filter((v) => String(v) !== String(opt.value))
                    updateCondition(condition.id, { value: next })
                  }}
                />
                <span className="truncate">{opt.label}</span>
              </label>
            )
          })}
        </div>
      )
    }

    // A LIST operator on a field with no static options and no remote picker —
    // a plain text or number column (objectui#3958). This used to fall all the
    // way through to the single-value input below, so `in` on such a field
    // could only ever produce a scalar: refused by `ViewFilterRuleSchema` at
    // save time, and read as an unfiltered query by the live grid before that.
    // A token input is the input that matches the shape, so the row the user
    // builds is a row the spec accepts.
    if (isMultiOperator) {
      return (
        <MultiValueInput
          values={normalizeToArray(condition.value)}
          inputType={getInputType(condition.field)}
          numeric={numberLikeTypes.includes(field?.type || "")}
          testId={`filter-multi-value-${condition.field}`}
          onChange={(next) => updateCondition(condition.id, { value: next })}
        />
      )
    }

    // The platform date picker on a `date` / `datetime` column (objectui#12743),
    // when the host registered one; see {@link registeredTemporalWidget}.
    const valueFamily = valueFamilyForFieldType(field?.type)
    const temporalWidget = registeredTemporalWidget(valueFamily)
    const temporalFamily: TemporalValueFamily | undefined =
      valueFamily === "date" || valueFamily === "datetime" ? valueFamily : undefined

    // A PAIR operator (`between`) — two bounds, in order. One input could only
    // ever produce one of them, and the spec refuses an incomplete range as
    // firmly as it refuses a scalar for `in`.
    if (arity === "pair") {
      const bounds = toPairBounds(condition.value)
      const inputType = getInputType(condition.field)
      const numeric = numberLikeTypes.includes(field?.type || "")
      /**
       * WHICH bound is missing on a half-filled pair — `0`, `1`, or `null` when
       * the row is not half-filled at all (objectui#10061, executing ruling
       * batch #146 item 5 letter A, which objectstack `176b03582` executed upstream).
       *
       * The ruling's two halves are 「not emitted」 and 「shown as incomplete」.
       * The first has been true since objectui#5025: every write path asks
       * {@link isFilterValueComplete}, so a range with one blank bound is
       * dropped before it can reach a query or a stored view. That drop was
       * SILENT — the author typed a bound, can see it on screen, and nothing
       * ever told them the row counts for nothing. This is the second half, and
       * it is a DIAGNOSTIC, never a refusal: no save gate reads it, the
       * completeness rule is untouched, and the other rows keep applying.
       *
       * ⚠️ Exactly one blank bound, never zero and never two:
       *
       *   - BOTH blank is a row nobody has started. `Add filter` on a `date`
       *     column draws it that way, its value is the same `[]` 「nothing
       *     filled in yet」 shape a `scalar` row starts from as `""`, and no
       *     other operator marks its own untouched row. Marking a row the
       *     instant it appears is the 「invalid while the user is still typing」
       *     anti-pattern, and it would make the marker mean 「a range exists」
       *     rather than 「this range is half-written」.
       *   - BOTH filled is a complete range and carries nothing.
       *
       * ⛔ `isValueUnset`, never `!bound` (objectui#4873, and the reason this
       * fix goes wrong): `0` is a real lower bound on a number column and
       * `false` is a real value, so `[0, '']` is half-filled with its MAX
       * missing — not an empty row — and `[0, 10]` is complete. A truthiness
       * reading would mark the `0` bound as the missing one and tell the author
       * to fill in a bound they can see they already filled.
       */
      const missingBound: 0 | 1 | null =
        isValueUnset(bounds[0]) === isValueUnset(bounds[1])
          ? null
          : isValueUnset(bounds[0])
            ? 0
            : 1
      // Referenced by the blank bound's `aria-describedby`, so the sentence is
      // announced as that input's description rather than floating unattached
      // — the association `character-count.tsx` documents for this tree.
      const incompleteId = `filter-range-incomplete-${condition.id}`
      const incompleteLabel = t(
        missingBound === 0 ? 'filterBuilder.rangeStart' : 'filterBuilder.rangeEnd',
      )
      // `aria-invalid` is this tree's one structural spelling for 「the editor
      // will not take what is in this control」 — pinned that way in
      // `CelPredicateField`, `ConditionWidget`, `ConditionalFormattingEditor`
      // and `ConditionBuilder`, and computed by the widget itself (rather than
      // handed down by a host) exactly as `LocationField` computes its own
      // refusal. `|| undefined` so a complete pair carries NO attribute at all.
      const boundInvalid = (index: 0 | 1) => (missingBound === index ? true : undefined)
      const setBound = (index: 0 | 1, raw: string) => {
        const next: [string | number | boolean, string | number | boolean] = [bounds[0], bounds[1]]
        // The same one reading as the field-switch path (objectui#4875), in
        // place of `parseFloat(raw) || 0`: a bound is a clean number or it is
        // not filled in (`""`). A half-read bound (`"42abc"` → 42) or an
        // invented `0` is worse here than anywhere else in this file — it
        // silently narrows a RANGE, and `0` is a plausible-looking bound.
        // `convertScalarToFamily("", "number")` is `""`, so the old
        // `raw !== ""` guard is subsumed rather than dropped.
        next[index] = numeric ? (convertScalarToFamily(raw, "number") ?? "") : raw
        // Both bounds cleared → back to the "nothing filled in yet" shape the
        // write path drops, rather than persisting an empty range.
        updateCondition(condition.id, {
          value: next[0] === "" && next[1] === "" ? [] : next,
        })
      }
      const renderBound = (index: 0 | 1) => {
        const boundLabel = t(index === 0 ? 'filterBuilder.rangeStart' : 'filterBuilder.rangeEnd')
        // A `date` / `datetime` bound is the host's registered date widget
        // (objectui#12743). Its placeholder is the display locale's pattern,
        // so the bound's name rides on a hidden label instead. The incomplete
        // marker reaches it as `error`, which is what drives `aria-invalid`
        // on a field widget.
        if (temporalWidget && temporalFamily) {
          return (
            <TemporalValueEditor
              widget={temporalWidget}
              family={temporalFamily}
              field={field!}
              value={bounds[index]}
              onChange={(next) => setBound(index, next)}
              label={boundLabel}
              error={missingBound === index ? t('validation.required', { field: incompleteLabel }) : undefined}
              className={missingBound === index ? "border-destructive" : undefined}
              testId={`filter-range-${condition.field}-${index === 0 ? 'start' : 'end'}`}
            />
          )
        }
        return (
          <Input
            type={inputType}
            className={cn("h-9 text-sm", missingBound === index && "border-destructive")}
            placeholder={boundLabel}
            aria-label={boundLabel}
            aria-invalid={boundInvalid(index)}
            aria-describedby={missingBound === index ? incompleteId : undefined}
            value={displayScalarValue(bounds[index])}
            onChange={(e) => setBound(index, e.target.value)}
          />
        )
      }
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5" data-testid={`filter-range-${condition.field}`}>
            {renderBound(0)}
            <span className="text-xs text-muted-foreground shrink-0">-</span>
            {renderBound(1)}
          </div>
          {missingBound !== null && (
            // Visible, not `sr-only`: the drop this announces is invisible to a
            // sighted author too, and the shadcn `Input` this file renders
            // carries no `aria-invalid` styling of its own, so the attribute
            // alone would show nobody anything.
            <p id={incompleteId} className="text-xs text-destructive">
              {t('validation.required', { field: incompleteLabel })}
            </p>
          )}
        </div>
      )
    }

    // For select/lookup fields with options (single select)
    if (field?.options && (selectLikeTypes.includes(field.type || "") || lookupLikeTypes.includes(field.type || ""))) {
      // `displayScalarValue`, never `value || ""` (objectui#4873): an option
      // whose id is `0` — a status code, a level — is a real selection, and
      // `0 || ""` handed the trigger the same `""` an unfilled row gives it, so
      // the row filtered by an option the placeholder said was not picked.
      const shown = displayScalarValue(condition.value)
      // The C half of objectui#4874's ruling. Radix matches `SelectValue`
      // against the `SelectItem`s actually MOUNTED, so a value no option
      // carries leaves the trigger blank while the row keeps filtering by it —
      // the same mechanism objectui#4768 hit on the operator trigger. Mounting
      // the value as its own option is what makes it visible, and it is done
      // UNCONDITIONALLY rather than only for remote columns: the invariant this
      // control owes is "the trigger shows whatever the row holds", and that
      // holds no matter HOW the value got here (a switch, a persisted view, an
      // option set that loaded late). Which values may be CLEARED is the other
      // half and lives in one place, `narrowFilterValueToOptions`.
      const isOutsideOptions = shown !== "" && !optionKeysOf(field).includes(shown)
      return (
        <Select
          value={shown}
          onValueChange={(value) =>
            updateCondition(condition.id, { value })
          }
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder={t('filterBuilder.selectValue')} />
          </SelectTrigger>
          <SelectContent>
            {isOutsideOptions && (
              // Labelled with the value itself — the same answer
              // `LookupValuePicker`'s trigger gives an id it has no label for
              // (`resolved[id] || id`), because that IS what is known about it.
              <SelectItem value={shown} data-testid={`filter-value-outside-options-${condition.field}`}>
                {shown}
              </SelectItem>
            )}
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    // For boolean fields
    if (field?.type === "boolean") {
      return (
        <Select
          // The reported repro (objectui#4873). `String(false || "")` is `""`,
          // so picking **False** bounced the trigger straight back to the
          // "Select value" placeholder while the row saved, persisted and
          // filtered by `value: false`. `displayScalarValue` gives `"false"` —
          // this Select's own item value — so "not picked yet" (`""`, the
          // placeholder) and "picked False" stay two distinguishable states,
          // which is the part a shorter rewrite would have moved rather than
          // fixed.
          value={displayScalarValue(condition.value)}
          onValueChange={(value) =>
            updateCondition(condition.id, { value: value === "true" })
          }
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder={t('filterBuilder.selectValue')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">{t('filterBuilder.trueLabel')}</SelectItem>
            <SelectItem value="false">{t('filterBuilder.falseLabel')}</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    if (temporalWidget && temporalFamily) {
      return (
        <TemporalValueEditor
          widget={temporalWidget}
          family={temporalFamily}
          field={field!}
          value={condition.value}
          onChange={(next) => updateCondition(condition.id, { value: next })}
          label={t('filterBuilder.value')}
          testId={`filter-value-${condition.field}`}
        />
      )
    }

    // Default input for text, number, date
    const inputType = getInputType(condition.field)
    
    // Format value based on field type
    const formatValue = () => {
      // `isValueUnset`, never `!condition.value` (objectui#4873): `0` is a
      // number the user typed, not an empty box. Under the old guard, typing
      // `0` into a number column wrote `value: 0` and the very next render
      // blanked the input — the keystroke looked like it had never landed,
      // while the row filtered `amount equals 0` for good.
      if (isValueUnset(condition.value)) return ""
      if (inputType === "date" && typeof condition.value === "string") {
        // Ensure date is in YYYY-MM-DD format
        return condition.value.split('T')[0]
      }
      return displayScalarValue(condition.value)
    }

    // Handle value change with proper type conversion
    const handleValueChange = (newValue: string) => {
      let convertedValue: string | number | boolean = newValue

      if (numberLikeTypes.includes(field?.type || "")) {
        // ONE reading of "is this string a number", shared with the field-switch
        // path (objectui#4875). `parseFloat(newValue) || 0` read `"42abc"` as
        // 42 and `"acme"` as `NaN`, then buried both as `0` — a filter the user
        // never wrote. Unreadable now means UNFILLED (`""`), the same empty
        // shape a fresh row starts in; `""` in also gives `""` out, so the old
        // `newValue !== ""` guard is subsumed rather than dropped.
        convertedValue = convertScalarToFamily(newValue, "number") ?? ""
      } else if (dateLikeTypes.includes(field?.type || "")) {
        convertedValue = newValue // Keep as ISO string
      }

      updateCondition(condition.id, { value: convertedValue })
    }
    
    return (
      <Input
        type={inputType}
        className="h-9 text-sm"
        placeholder={t('filterBuilder.value')}
        value={formatValue()}
        onChange={(e) => handleValueChange(e.target.value)}
      />
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('filterBuilder.where')}</span>
          {filterGroup.conditions.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleLogic}
              className="h-7 text-xs"
            >
              {filterGroup.logic === "or" ? t('filterBuilder.or') : t('filterBuilder.and')}
            </Button>
          )}
        </div>
        {showClearAll && filterGroup.conditions.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAllConditions}
            className="h-7 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3 mr-1" />
            {t('filterBuilder.clearAll')}
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {filterGroup.conditions.map((condition) => (
          <div key={condition.id} className="flex items-start gap-2">
            <div className="flex-1 grid grid-cols-12 gap-2">
              <div className="col-span-4">
                <Select
                  value={condition.field}
                  onValueChange={(value) => changeField(condition.id, value)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder={t('filterBuilder.selectField')} />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((field) => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-4">
                <Select
                  // The row's operator, resolved to the id actually MOUNTED
                  // below — see {@link mountedOperatorValue}. The row itself
                  // keeps its own spelling; only this comparison is folded.
                  value={mountedOperatorValue(
                    condition.operator,
                    getOperatorsForRow(condition),
                  )}
                  // Radix hands back the `value` of a mounted `SelectItem`,
                  // and every one mounted below is a builder id; the guard is
                  // what tells the compiler so (objectui#9306).
                  onValueChange={(value) => {
                    if (isFilterBuilderOperator(value)) changeOperator(condition.id, value)
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder={t('filterBuilder.operator')} />
                  </SelectTrigger>
                  <SelectContent>
                    {getOperatorsForRow(condition).map((op) => (
                      <SelectItem key={op.value} value={op.value}>
                        {t(`filterBuilder.operators.${op.value}`)}
                      </SelectItem>
                    ))}
                    {renderEmptyCheckHint(condition)}
                  </SelectContent>
                </Select>
              </div>

              {needsValueInput(condition.operator) && (
                <div className="col-span-4">
                  {renderValueInput(condition)}
                </div>
              )}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => removeCondition(condition.id)}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">{t('filterBuilder.removeCondition')}</span>
            </Button>
          </div>
        ))}
      </div>

      {/* Every control here is `type="button"` on purpose: a bare <button> inside
          a <form> defaults to type="submit", and FilterBuilder is embedded in one
          (the sharing-rule dialog's criteria field). Adding a condition used to
          submit the dialog — firing validation, and saving outright once the form
          was valid (objectstack#3821). */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addCondition}
        className="h-8"
        disabled={fields.length === 0}
      >
        <Plus className="h-3 w-3" />
        {t('filterBuilder.addFilter')}
      </Button>
    </div>
  )
}

FilterBuilder.displayName = "FilterBuilder"

// ============================================================================
// TemporalValueEditor — the platform date picker on a `date` / `datetime` row
// ============================================================================

/** The value families whose rows draw the host's registered date widget. */
type TemporalValueFamily = Extract<FilterValueFamily, "date" | "datetime">

/**
 * The field widget the HOST registered for a `date` / `datetime` value
 * (objectui#12743), or `undefined` when none is registered.
 *
 * Read from `ComponentRegistry` under the `field` namespace at render time,
 * exactly as the form renderer in this package resolves `field:<type>`
 * (`renderFieldComponent` in `renderers/form/form.tsx`). `@object-ui/fields`
 * registers the platform picker there (`DatePickerField` /
 * `DateTimePickerField`, behind a `React.lazy` loader, so it stays in its own
 * `fields-date-picker` chunk), and it depends on THIS package, so importing it
 * here would be a cycle. The registry is the seam: this package stays
 * fields-free and the host fills it.
 *
 * With nothing registered (a host that does not load `@object-ui/fields`)
 * the row keeps the native input, as the form does.
 */
function registeredTemporalWidget(
  family: FilterValueFamily,
): React.ComponentType<Record<string, unknown>> | undefined {
  if (family !== "date" && family !== "datetime") return undefined
  return ComponentRegistry.get(family, "field") as React.ComponentType<Record<string, unknown>> | undefined
}

interface TemporalValueEditorProps {
  widget: React.ComponentType<Record<string, unknown>>
  family: TemporalValueFamily
  /** The column the row filters on: the widget's `field` carrier. */
  field: { value: string; label: string }
  value: FilterBuilderRow["value"] | undefined
  /** Receives the value in the row's own shape (see the component's doc). */
  onChange: (next: string) => void
  /** The accessible name of the text box, on a visually hidden `<label>`. */
  label: string
  /** Set when the row refuses what this control holds; drives `aria-invalid`. */
  error?: string
  className?: string
  testId?: string
}

/**
 * Renders the host's registered date widget as a filter row's value editor
 * (objectui#12743).
 *
 * ## The value written is the row's, unchanged
 *
 * - `date`: the widget writes `YYYY-MM-DD`, the value `<input type="date">`
 *   wrote.
 * - `datetime`: the widget writes an ISO instant (a field's stored shape);
 *   the row has always held the zoneless local wall clock
 *   `<input type="datetime-local">` emits (`YYYY-MM-DDTHH:mm`). The instant is
 *   read back onto that local clock with `toDateTimeInputValue`, the adapter
 *   the widget itself reads with, so the filter keeps the shape every reader
 *   of it already handles.
 *
 * ## It commits what was typed
 *
 * The picker reads its typed text on blur and on Enter, not per keystroke.
 * A pointer press outside the editor while it holds focus blurs it FIRST
 * (a capture listener, the seam `DataTable` uses for its injected cell
 * editors since objectui#12664), so the text is read before a popover that
 * hosts this row closes and unmounts it. Escape does not blur: it discards.
 *
 * `Suspense` is this editor's own: the widget arrives lazily, and the
 * placeholder holds no input, so nothing typed during the load can be lost.
 */
function TemporalValueEditor({
  widget: Widget,
  family,
  field,
  value,
  onChange,
  label,
  error,
  className,
  testId,
}: TemporalValueEditorProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const inputId = React.useId()

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      const focused = document.activeElement
      if (!(focused instanceof HTMLElement) || !root.contains(focused)) return
      if (event.target instanceof Node && root.contains(event.target)) return
      focused.blur()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [])

  const handleChange = (next: unknown) => {
    const text = typeof next === "string" ? next : ""
    onChange(family === "datetime" ? toDateTimeInputValue(text) : text)
  }

  return (
    <div ref={rootRef} className="min-w-0 flex-1" data-testid={testId}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <React.Suspense
        fallback={
          <div
            aria-busy="true"
            data-testid="filter-value-loading"
            className="h-9 w-full rounded-md border border-input bg-muted/40"
          />
        }
      >
        <Widget
          id={inputId}
          field={{ name: field.value, label: field.label, type: family }}
          value={value === undefined ? "" : displayScalarValue(value)}
          onChange={handleChange}
          error={error}
          className={cn("h-9 text-sm", className)}
        />
      </React.Suspense>
    </div>
  )
}

// ============================================================================
// MultiValueInput — token input for the LIST operators on an optionless field
// ============================================================================

interface MultiValueInputProps {
  values: (string | number | boolean)[]
  /** The `<input type>` the field's own type asks for (`text` / `number` / …). */
  inputType: string
  /** Numeric field → committed tokens are numbers, so the wire carries numbers. */
  numeric: boolean
  testId: string
  onChange: (next: (string | number | boolean)[]) => void
}

/**
 * A list of committed tokens plus a draft input — the same interaction
 * `@object-ui/fields`' `TagsField` uses (type, Enter or comma commits, `×` or
 * Backspace removes), rebuilt here because `fields` depends on this package and
 * not the other way round.
 *
 * It exists so that `in` / `not_in` have a value input AT ALL on a field with
 * no static options. Its only contract with the outside is the shape it emits:
 * always an array, `[]` when empty — never the scalar
 * {@link https://github.com/objectstack-ai/objectstack/issues/6227 |
 * ViewFilterRuleSchema} refuses for a membership operator.
 */
function MultiValueInput({ values, inputType, numeric, testId, onChange }: MultiValueInputProps) {
  const { t } = useSafeFilterTranslation()
  const [draft, setDraft] = React.useState("")

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === "") return
    // The same one reading as the field-switch path (objectui#4875), in place
    // of `parseFloat(trimmed) || 0` — which committed `"42abc"` as the token 42
    // and `"acme"` as the token 0, both values the user never typed and both
    // indistinguishable, once committed, from a token they did.
    const next = numeric ? convertScalarToFamily(trimmed, "number") : trimmed
    // Unreadable → NOT committed, and the draft is deliberately left standing:
    // this is the one of the three keyed paths where clearing to "unfilled"
    // would destroy the text instead of just declining it. The user sees what
    // they typed, still in the box, and can fix it. (`""` cannot arrive here —
    // an empty draft returned above — so the check is only about `undefined`.)
    if (next === undefined || next === "") return
    setDraft("")
    if (values.some((v) => String(v) === String(next))) return
    onChange([...values, next])
  }

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      // Enter inside a <form> would submit it (objectstack#3821, the same
      // hazard every control here is `type="button"` for).
      e.preventDefault()
      commit(draft)
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      removeAt(values.length - 1)
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5"
      data-testid={testId}
    >
      {values.map((v, index) => (
        <Badge key={`${String(v)}-${index}`} variant="secondary" className="gap-1">
          <span className="truncate max-w-[12ch]">{String(v)}</span>
          <button
            type="button"
            onClick={() => removeAt(index)}
            className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={t('filterBuilder.removeValue', { value: String(v) })}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <Input
        type={inputType}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder={values.length === 0 ? t('filterBuilder.addValue') : ""}
        aria-label={t('filterBuilder.addValue')}
        // `min-w-[6ch]`, not the `8ch` its `TagsField` twin uses: that utility
        // is produced ONLY by `@object-ui/fields`, and its CSS build subtracts
        // the components sheet from its own — emitting it here would delete it
        // from the fields bundle, which `build-css.mjs` refuses as
        // over-subtraction (objectui#4059).
        className="h-7 flex-1 border-0 bg-transparent p-0 px-1 shadow-none focus-visible:ring-0 min-w-[6ch] text-sm"
      />
    </div>
  )
}

MultiValueInput.displayName = "MultiValueInput"

// ============================================================================
// LookupValuePicker — remote-search picker for lookup/master_detail/user
// ============================================================================

interface LookupOption {
  value: string | number
  label: string
}

interface LookupValuePickerProps {
  field: {
    value: string
    label: string
    type?: string
    referenceTo?: string
    displayField?: string
    idField?: string
  }
  value: FilterBuilderRow["value"]
  multiple: boolean
  onChange: (value: FilterBuilderRow["value"]) => void
}

function LookupValuePicker({ field, value, multiple, onChange }: LookupValuePickerProps) {
  const { t } = useSafeFilterTranslation()
  const ctx = React.useContext(SchemaRendererContext)
  const dataSource: any = ctx?.dataSource ?? null

  // Default `referenceTo` for the `user` field type when not explicitly set.
  //
  // `owner` was a second spelling here until objectui#4914. It is unreachable
  // now — the gate in `renderValueInput` refuses a retired spelling before this
  // component is ever chosen — so the member is removed rather than left as a
  // list that disagrees with the gate about what is live.
  const referenceTo =
    field.referenceTo || (field.type === "user" ? "users" : undefined)
  const displayField = field.displayField || "name"
  const idField = field.idField || "id"

  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [options, setOptions] = React.useState<LookupOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // Resolved labels for currently selected ids (so we can render chips even
  // when the selection isn't part of the latest fetched page).
  const [resolved, setResolved] = React.useState<Record<string, string>>({})
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedIds: string[] = React.useMemo(() => {
    if (multiple) {
      return normalizeToArray(value).map((v) => String(v))
    }
    if (isValueUnset(value)) return []
    return [String(value)]
  }, [value, multiple])

  const hasDataSource =
    dataSource != null && typeof dataSource.find === "function" && !!referenceTo

  const recordToOption = React.useCallback(
    (r: any): LookupOption => {
      const id = r?.[idField] ?? r?.id ?? r?._id
      const label = r?.[displayField] ?? r?.label ?? r?.name ?? String(id)
      return { value: id, label: String(label) }
    },
    [displayField, idField],
  )

  const fetchData = React.useCallback(
    async (search?: string) => {
      if (!hasDataSource) return
      setLoading(true)
      setError(null)
      try {
        const params: any = { $top: 50 }
        if (search && search.trim()) params.$search = search.trim()
        const result = await dataSource.find(referenceTo, params)
        const records: any[] = result?.data ?? result ?? []
        const mapped = records.map(recordToOption)
        setOptions(mapped)
        // Cache resolved labels for any matching selected ids
        if (mapped.length > 0) {
          setResolved((prev) => {
            const next = { ...prev }
            for (const opt of mapped) next[String(opt.value)] = opt.label
            return next
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setOptions([])
      } finally {
        setLoading(false)
      }
    },
    [dataSource, referenceTo, hasDataSource, recordToOption],
  )

  // Resolve labels for already-selected ids that we haven't seen yet
  React.useEffect(() => {
    if (!hasDataSource || selectedIds.length === 0) return
    const missing = selectedIds.filter((id) => !(id in resolved))
    if (missing.length === 0) return
    let cancelled = false
    ;(async () => {
      try {
        const result = await dataSource.find(referenceTo, {
          $top: missing.length,
          $filter: { [idField]: { $in: missing } },
        })
        const records: any[] = result?.data ?? result ?? []
        if (cancelled) return
        setResolved((prev) => {
          const next = { ...prev }
          for (const r of records) {
            const opt = recordToOption(r)
            next[String(opt.value)] = opt.label
          }
          return next
        })
      } catch {
        // Best-effort label resolution; ignore failures
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedIds, hasDataSource, dataSource, referenceTo, idField, recordToOption, resolved])

  // Fetch initial data when popover opens
  React.useEffect(() => {
    if (open && hasDataSource && options.length === 0) {
      fetchData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    if (!hasDataSource) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchData(q || undefined), 300)
  }

  const toggleId = (id: string | number) => {
    if (multiple) {
      const arr = normalizeToArray(value)
      const exists = arr.map(String).includes(String(id))
      const next = exists
        ? arr.filter((v) => String(v) !== String(id))
        : [...arr, id]
      onChange(next)
    } else {
      onChange(id)
      setOpen(false)
    }
  }

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(multiple ? [] : "")
  }

  // The `||` fallbacks below are the OTHER answer objectui#4873's sweep found,
  // and they are kept: `resolved[id]` is a LABEL, and the two falsy strings it
  // can be — `undefined` (not fetched yet) and `""` (a record whose display
  // field is blank) — both mean "no label to show", for which the id is the
  // better chip than an empty one. Emptiness really is unset here, unlike the
  // value controls above where `false` and `0` are the user's own answer.
  const renderTrigger = () => {
    if (selectedIds.length === 0) {
      return (
        <span className="text-muted-foreground truncate">
          {t('filterBuilder.searchField', { label: field.label })}
        </span>
      )
    }
    if (multiple) {
      return (
        <span className="truncate">
          {selectedIds.length === 1
            ? resolved[selectedIds[0]] || selectedIds[0]
            : `${selectedIds.length} selected`}
        </span>
      )
    }
    return (
      <span className="truncate">
        {resolved[selectedIds[0]] || selectedIds[0]}
      </span>
    )
  }

  if (!hasDataSource) {
    // Fallback when no DataSource is available: ids are typed in by hand.
    // A MULTIPLE picker still has to emit a LIST here (objectui#3958) — this
    // branch used to hand back `e.target.value`, a scalar, which is the shape
    // `ViewFilterRuleSchema` refuses for `in` / `not_in`. The single case keeps
    // the plain input it always had.
    if (multiple) {
      return (
        <MultiValueInput
          values={normalizeToArray(value)}
          inputType="text"
          numeric={false}
          testId={`lookup-ids-${field.value}`}
          onChange={onChange}
        />
      )
    }
    return (
      <Input
        className="h-9 text-sm"
        placeholder={t('filterBuilder.enterId', { label: field.label })}
        value={selectedIds[0] ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm",
            "hover:bg-accent hover:text-accent-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
          )}
          data-testid={`lookup-picker-${field.value}`}
        >
          {renderTrigger()}
          <span className="flex items-center gap-1 shrink-0">
            {selectedIds.length > 0 && (
              <X
                className="h-3.5 w-3.5 opacity-60 hover:opacity-100"
                onClick={clearAll}
              />
            )}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center border-b px-3">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t('filterBuilder.searchField', { label: field.label })}
            className="flex h-9 w-full bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
            data-testid={`lookup-search-${field.value}`}
          />
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="max-h-64 overflow-y-auto p-1" data-testid={`lookup-options-${field.value}`}>
          {error && (
            <div className="px-3 py-2 text-xs text-destructive">{error}</div>
          )}
          {!error && !loading && options.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t('filterBuilder.noResults')}
            </div>
          )}
          {options.map((opt) => {
            const isSelected = selectedIds.includes(String(opt.value))
            return (
              <label
                key={String(opt.value)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer",
                  isSelected ? "bg-primary/5 text-primary" : "hover:bg-muted",
                )}
              >
                {multiple ? (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleId(opt.value)}
                  />
                ) : (
                  <input
                    type="radio"
                    checked={isSelected}
                    onChange={() => toggleId(opt.value)}
                    className="rounded-full border-input"
                  />
                )}
                <span className="truncate flex-1">{opt.label}</span>
              </label>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { FilterBuilder, LookupValuePicker }
