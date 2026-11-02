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
 * ## What the `data` barrel publishes from here: one predicate
 *
 * The faces are the contract most consumers call, and they are published on
 * their own (`normalizeFilterComparandTypes`, `assertListComparandShapes`).
 * A consumer that judges a comparand by its operator without running a face
 * (a flow's record nodes take an evaluated list only at a list operator's
 * comparand) reads {@link isListComparandOperator}, so it holds no copy of
 * the split to drift. The barrel names that predicate alone: the two sets
 * stay module-private, because a published `ReadonlySet` is still a live
 * `Set` at run time, and a caller that cast and mutated it would change what
 * every face here judges. This file imports nothing, so no face can reach a
 * cycle through it.
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

/**
 * Whether `op` (a `$`-spelled field operator) declares a LIST comparand
 * (`$in`, `$nin`, `$between`); `false` for every other spelling.
 */
export function isListComparandOperator(op: string): boolean {
  return LIST_COMPARAND_OPERATORS.has(op);
}
