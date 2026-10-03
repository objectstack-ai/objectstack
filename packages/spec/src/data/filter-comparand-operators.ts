// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declared field-operator vocabulary, split by what the comparand IS: ONE
 * literal, or a LIST. One split, read by every face that judges a comparand by
 * its operator:
 *
 * - the comparand-TYPE face (`./filter-comparand-type.ts`, #7872) judges a
 *   scalar operator's comparand as one literal, and each member of a list
 *   operator's array as a literal in its own right;
 * - [#21448] the comparand-SHAPE face (`./filter-comparand-shape.ts`) refuses a
 *   LIST at a scalar operator, whatever the column type, because one value
 *   belongs there;
 * - the save door (`./filter-save-door-refusals.ts`) words that refusal.
 *
 * The split lived in the type face alone until the shape face needed it too.
 * It moved here so the faces read ONE split rather than two copies of it.
 * `filter-comparand-type.test.ts` reconciles the union of the two sets against
 * `FieldOperatorsSchema`'s own keys, so an operator added to the schema cannot
 * silently skip either face. `filter-comparand-shape.test.ts` holds the scalar
 * set to the schema's other half: every declared operator whose enforced slot
 * refuses an array.
 *
 * ## Why it is NOT in the `data` barrel
 *
 * Nothing here is a contract a consumer calls; the faces are, and they are
 * already published (`normalizeFilterComparandTypes`,
 * `assertListComparandShapes`). Exporting the split would widen
 * `@objectstack/spec/data` for no reader, so this file stays out of
 * `./index.ts`, as `./filter-comparand-refusal-text.ts` does. It imports
 * nothing, so no face can reach a cycle through it.
 */

/** The operators whose declared comparand is ONE literal. */
export const SCALAR_COMPARAND_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
  '$like', '$ilike',
  '$null', '$exists', '$empty',
]);

/** The operators whose declared comparand is a LIST. */
export const LIST_COMPARAND_OPERATORS: ReadonlySet<string> = new Set([
  '$in', '$nin', '$between',
]);
