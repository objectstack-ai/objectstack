/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Combine two `FilterCondition` objects via `$and`, dropping empty ones.
 *
 * The scope-filter combinator shared by the dataset report path and the
 * dashboard filter broadcast: a widget's own `runtimeFilter`/`filter` is
 * intersected with a host-supplied runtime filter. Returns `undefined` when
 * nothing meaningful remains so callers can omit the key entirely.
 */
export function mergeFilters(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const hasA = a && Object.keys(a).length > 0;
  const hasB = b && Object.keys(b).length > 0;
  if (hasA && hasB) return { $and: [a, b] };
  if (hasA) return a;
  if (hasB) return b;
  return undefined;
}
