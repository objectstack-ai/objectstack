/**
 * ObjectUI — unmaterialized-fields utility
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { SEARCH_VIRTUAL_TYPES } from '@objectstack/spec/data';

/**
 * Field types no driver materialises a stored column for — the value is
 * computed on read (objectui#3950).
 *
 * A STORAGE fact, not a taste judgement, and it decides what the SERVER can be
 * asked to do with such a field. All three query axes have now closed on it:
 *
 *  - SORT — refused since objectstack#6994 (`400 INVALID_SORT`). Before that it
 *    degraded in silence: the response carried the very values it was asked to
 *    order by, out of order, under a `200`, with ascending and descending
 *    byte-identical (measured on a real SQL driver).
 *  - FILTER — refused since objectstack#8296 (`400 INVALID_FIELD`); previously
 *    `200` with zero rows whichever way the predicate pointed.
 *  - SEARCH — refused by name since objectstack#6674.
 *
 * The membership is bound to `@objectstack/spec` instead of being written out
 * here, on the reasoning the platform's own filter door applies to itself: a
 * layer that re-decided "which types have a column" drifts from the drivers,
 * and then either withholds an affordance that works or offers one that 400s.
 * The spec pins the set to `formula` alone.
 *
 * Deliberately NOT `COMPUTED_VALUE_TYPES` (`formula` / `summary` /
 * `autonumber`) — that is the WRITE contract ("never client-written"). A
 * `summary` and an `autonumber` each get a real maintained column and order,
 * filter and search correctly, so widening to that set would withhold
 * affordances from two types that work. The platform's own conformance suite
 * pins that trap by name.
 *
 * SCOPE on the sort axis: this rules out a sort the SERVER performs. A
 * client-side sort keys off the value the cell renders — which the server
 * hydrates on read — so it orders by exactly what the user sees and stays
 * honest. Consumers therefore apply this where they already apply the
 * relational carve-out (see {@link EXPANDABLE_FIELD_TYPES}): under server
 * sorting only.
 */
export const UNMATERIALIZED_FIELD_TYPES: ReadonlySet<string> = SEARCH_VIRTUAL_TYPES;

/**
 * Whether a field definition's type materialises no stored column.
 *
 * Shaped like {@link isExpandableFieldType}: only `type` is read, so it answers
 * for any field-metadata shape an object schema resolves to, and an unreadable
 * definition is not a verdict — `null` / `undefined` / a bare type string all
 * answer `false`.
 */
export function isUnmaterializedFieldType(fieldDef: unknown): boolean {
  return (
    !!fieldDef &&
    typeof fieldDef === 'object' &&
    UNMATERIALIZED_FIELD_TYPES.has((fieldDef as { type?: unknown }).type as string)
  );
}
