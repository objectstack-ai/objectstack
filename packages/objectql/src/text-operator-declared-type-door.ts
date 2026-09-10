// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15661] The TEXT-OPERATOR DECLARED-TYPE door, at the engine's single filter
 * collection point — the fourth gate on the seam that already carries the
 * #5869 comparand-shape gate, the #8296 unmaterializable-field gate and the
 * #8690 temporal-comparand gate, answering a fourth question about the same
 * predicate: *can the field this operator is aimed at ever hold a string.*
 *
 * ## The ruling this implements
 *
 * Maintainer ruling, 2026-09-05, recorded on #15661 (decision batch #43,
 * option C-deny), quoted verbatim:
 *
 * > **C-deny, now**: a text operator (`$contains` / `$notContains` /
 * > `$startsWith` / `$endsWith` / `$icontains` / `$like` / `$ilike`) over a
 * > field whose DECLARED type can never store a string — `NUMERIC_VALUE_TYPES`
 * > ∪ `BOOLEAN_VALUE_TYPES` ∪ `CALENDAR_DATE_TYPES` ∪ `INSTANT_TYPES` ∪
 * > `CLOCK_TIME_TYPES` ∪ `STRUCTURED_JSON_TYPES`, all existing sets in
 * > `field-value.zod.ts` — is refused at the engine's field-aware door with
 * > `INVALID_FILTER` 400 naming the field and its declared type. No new
 * > vocabulary is minted. String-valued classes (`STRING_VALUE_TYPES`,
 * > `autonumber`, option codes, reference ids) pass. `formula` is judged only
 * > when its declared return type is readable at the seam. #14079's option-A
 * > row stays beneath the door for every evaluator no door fronts.
 *
 * Execution lane (2) of that ruling is this file; lane (1) is the CONTRACT it
 * consults — `@objectstack/spec/data`'s `filter-text-operator-declared-type.ts`
 * (PR #15804), which owns the sets, the pure verdict
 * ({@link textOperatorDoorVerdict}), the fixture and the case table. ⛔ Nothing
 * here re-lists a class: a type added to `NUMERIC_VALUE_TYPES` tomorrow is
 * refused by this door without a change in this package, which is what "⛔ no
 * new set" means at the consuming end.
 *
 * ## What ran before this door existed, measured on `origin/main` 59db8a02cb
 *
 * A real {@link ObjectQL}, the lane-1 fixture object registered, a recording
 * driver beneath — the filter reached the driver verbatim, every time:
 *
 * ```
 * find(o, { where: { f_number:  { $contains:   '5'    } } })  -> driver read, where passed through
 * find(o, { where: { f_summary: { $contains:   '5'    } } })  -> driver read, where passed through
 * find(o, { where: { f_json:    { $contains:   'a'    } } })  -> driver read, where passed through
 * find(o, { where: { f_date:    { $startsWith: '2026' } } })  -> INVALID_FILTER, but from the
 *                                                               #8690 TEMPORAL door, about the
 *                                                               COMPARAND ("not a date value")
 * ```
 *
 * What the driver then answers is #14079's option-A row (`FILTER_TEXT_CASES`):
 * no row for a positive operator, EVERY row for `$notContains`. Neither answer
 * is wrong beneath the door — it is the declared answer — and neither carries
 * any signal that the field can never hold a string. That silent cell is what
 * the ruling closes here, above the evaluators rather than inside them.
 *
 * ## Where it sits in the ladder, and why exactly there
 *
 * Between the #8296 field gate and the #8690 comparand gate:
 *
 * 1. `assertListComparandShapes` — can this comparand run at all (#5869).
 * 2. `assertFilterIsMaterializable` — is there a column to run it against
 *    (#8296 / #8371).
 * 3. **this door** — can that column's DECLARED type ever hold a string.
 * 4. `assertTemporalComparandsInterpretable` — can that column's storage rule
 *    read this VALUE (#8690).
 *
 * The declaration question precedes the value question because a text operator
 * aimed at a `date` column is not a comparand mistake: measured above,
 * `$startsWith: '2026'` over a `date` field was already refused — by the
 * temporal door, with `INVALID_FILTER` 400 and a message reporting that
 * `"2026"` is not a date value the platform can interpret. That is true and
 * beside the point: no comparand would have made the filter runnable, and an
 * author who "fixes" it to `$startsWith: '2026-01-01'` gets the silent cell
 * back. Running BEFORE it keeps the wire envelope identical (`INVALID_FILTER` /
 * 400 either way — no caller's error handling moves) and replaces the message
 * with the one the ruling asked for: the field, its declared type, and the
 * operator that cannot be aimed at it.
 *
 * ## `formula` is judged one door EARLIER, and this door never sees it
 *
 * The ruling judges a `formula` "only when its declared return type is readable
 * at the seam", and lane (1) encodes that (`returnType: number|boolean|date` ⇒
 * refused, `text` ⇒ passes, absent ⇒ deferred). At THIS seam the question never
 * arrives: `assertFilterIsMaterializable` (#8296) refuses EVERY filter over a
 * `formula` field one step above, with `INVALID_FIELD` / 400, for the broader
 * reason that no driver materialises a column for it — measured on the same
 * tree, for all three return-type shapes:
 *
 * ```
 * find(o, { where: { f_formula_number:  { $contains: '5' } } })  -> INVALID_FIELD 400 (#8296)
 * find(o, { where: { f_formula_text:    { $contains: '5' } } })  -> INVALID_FIELD 400 (#8296)
 * find(o, { where: { f_formula_untyped: { $contains: '5' } } })  -> INVALID_FIELD 400 (#8296)
 * ```
 *
 * Deliberately NOT reordered around: overtaking that door would answer ONE
 * condition ("a formula field cannot be filtered") with TWO wire codes decided
 * by the formula's `returnType` — `INVALID_FILTER` for one returning `number`
 * and `INVALID_FIELD` for one returning `text` — which is the split every door
 * on this seam records its reasoning against. #8296's own note argues the code
 * assignment (the verdict is about the NAME's type), and re-deciding it is not
 * this card's. The formula rows of `TEXT_OPERATOR_DOOR_CASES` are therefore
 * pinned in this package as a NAMED DIVERGENCE against the neighbouring door's
 * envelope, not silently dropped — `engine-text-operator-declared-type-door.test.ts`.
 *
 * The verdict function is still consulted through its `formula` branch (this
 * module hands it `returnType`), so the day that field class becomes filterable
 * the door already answers it correctly.
 *
 * ## Scope — three boundaries
 *
 * - **UNDOTTED keys only.** A dotted key (`f_address.city`) is
 *   `filter-dotted-head`'s subject, and its structured-JSON heads are
 *   deliberately unjudged there (live on two of three backends, #8371).
 *   Reading the head's declared type here would re-close that carve-out, so a
 *   dotted key is stepped over — lane (1) declares the same `deferred`.
 * - **A field the map does not declare is not judged.** The engine keeps its
 *   registry-less tolerance for unknown filter keys (the ingress door's first
 *   verdict, #7534); this door adds no second opinion about a name.
 * - **The CALLER's own `where` only.** Like its two neighbours it runs before
 *   the middleware chain composes RLS / sharing / tenant predicates onto the
 *   AST: an injected read filter is the platform's own, not a declaration the
 *   caller can fix.
 *
 * @see textOperatorDoorVerdict — the pure verdict (lane 1, `@objectstack/spec`).
 * @see FILTER_TEXT_CASES — #14079's row, which stays BENEATH this door.
 * @see assertTemporalComparandsInterpretable — the value-half gate beside it.
 * @see https://github.com/objectstack-ai/objectstack/issues/15661 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/15773 (this lane)
 */

import {
  isTextFilterOperator,
  textOperatorDoorVerdict,
  type TextFilterOperator,
} from '@objectstack/spec/data';
import { invalidFilterError } from './filter-comparand-shape.js';

/** What the door found — the field, its declaration, and the operator aimed at it. */
export interface TextOperatorOverNonTextField {
  /** The filter key, which names a declared field of this object. */
  field: string;
  /** Its declared `type` — a `FieldType` member. */
  declaredType: string;
  /** `formula` only: its declared `returnType`, when the seam could read one. */
  returnType?: string;
  /** The text operator aimed at it. */
  operator: TextFilterOperator;
  /** The `where.…` key path the offending operator sits at. */
  path: string;
}

/**
 * A plain object — filter STRUCTURE rather than a comparand. The same
 * classification the three sibling gates make: a `Date` is a comparand even
 * though `typeof` calls it an object.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
  );
}

/** The slice of a field declaration the verdict reads. */
function fieldMetaOf(def: unknown): { type: string; returnType?: string } | null {
  if (!isFilterNode(def)) return null;
  const type = (def as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  const returnType = (def as { returnType?: unknown }).returnType;
  return typeof returnType === 'string' ? { type, returnType } : { type };
}

/**
 * Walk one `FilterCondition` and return the FIRST text operator aimed at a
 * field whose declared type can never hold a string, or `null`.
 *
 * Exported for the same reason the temporal walk is: a consumer that needs to
 * ask "would the engine door refuse this?" without provoking the refusal.
 *
 * Structure is discarded the same three conservative ways the sibling gates
 * discard it: `$and` / `$or` / `$not` are descended, any OTHER `$` key at node
 * level is skipped WITHOUT descending (an unrecognised combinator leaves the
 * fields beneath it ungated — a hole, not a false 400, the right failure
 * direction for a gate that exists to stop wrong answers), and a dotted key
 * names a path this door does not judge (see the module note).
 */
export function findTextOperatorOverNonTextField(
  schema: unknown,
  where: unknown,
  path = 'where',
  depth = 0,
): TextOperatorOverNonTextField | null {
  // A registry-less host must not invent a verdict about a field map it cannot
  // see — the same early return both neighbours make.
  const fields = (schema as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return null;
  if (depth > 32) return null;
  if (!isFilterNode(where)) return null;

  for (const [key, value] of Object.entries(where)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (Array.isArray(value)) {
        for (const [index, arm] of value.entries()) {
          const hit = findTextOperatorOverNonTextField(schema, arm, `${here}[${index}]`, depth + 1);
          if (hit) return hit;
        }
      }
      continue;
    }
    if (key === '$not') {
      const hit = findTextOperatorOverNonTextField(schema, value, here, depth + 1);
      if (hit) return hit;
      continue;
    }
    if (key.startsWith('$')) continue;
    if (key.includes('.')) continue;
    const meta = fieldMetaOf(fields[key]);
    // A field whose `type` is unreadable is not judged: unresolvable is not
    // wrong (ADR-0072 D1), the same rule `isVirtualSearchField` records.
    if (!meta) continue;
    // The verdict is the spec's, over the DECLARED type — never a list here.
    if (textOperatorDoorVerdict(meta) !== 'door-refusal') continue;
    // Only an operator bag can aim a text operator; an implicit-equality
    // comparand (`{ f_number: 5 }`) names no operator and is not this door's.
    if (!isFilterNode(value)) continue;
    for (const op of Object.keys(value)) {
      if (!isTextFilterOperator(op)) continue;
      return {
        field: key,
        declaredType: meta.type,
        ...(meta.returnType === undefined ? {} : { returnType: meta.returnType }),
        operator: op,
        path: `${here}.${op}`,
      };
    }
  }
  return null;
}

/**
 * Refuse every text operator aimed at a field whose DECLARED type can never
 * hold a string — `INVALID_FILTER` / 400, this package's existing filter
 * envelope (#5869 / #7047), naming the field and its declared type as the
 * ruling requires. No code is minted: `INVALID_FILTER` already exists
 * (`StandardErrorCode`, `packages/spec/src/api/errors.zod.ts`).
 */
export function assertTextOperatorTargetsAreStringCapable(
  object: string,
  operation: string,
  schema: unknown,
  where: unknown,
): void {
  const hit = findTextOperatorOverNonTextField(schema, where);
  if (!hit) return;
  const declared = hit.returnType === undefined
    ? `${hit.declaredType} field`
    : `${hit.declaredType} field returning ${hit.returnType}`;
  throw invalidFilterError(
    `${operation}('${object}'): filter on '${hit.field}' aims the text operator `
    + `${hit.operator} at a declared ${declared} at ${hit.path}. A ${hit.declaredType} value is `
    + 'never a string on any backend, so no record can be matched by reading one as text — the '
    + 'operator can only be aimed at this field by mistake. The filter was NOT applied: beneath '
    // The stored-value row is #14079's; the id stays in this comment rather than in
    // the message, which reaches authors and operators who cannot resolve a tracker id.
    + 'this door the predicate is answered by the declared no-match rule — a positive '
    + 'text operator matches NO row and $notContains matches EVERY row — an answer no caller can '
    + `tell apart from a real result set. Compare '${hit.field}' with an operator its declared `
    + 'type can answer ($eq / $ne / $in / $gt / $gte / $lt / $lte, a range for a temporal or '
    + 'numeric field), or aim the text operator at a text-valued field.',
  );
}
