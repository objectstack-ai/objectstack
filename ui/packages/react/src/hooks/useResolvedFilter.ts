/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE hold every data node uses to resolve its OWN authored `filter`
 * (objectui#10666). PR objectui#10656 wrote it for `list-view`
 * (`useResolvedAuthoredFilter`, local to `ListView.tsx`); PR objectui#10705
 * moved it into a module of `plugin-list` for `object-gallery`; the sweep that
 * closed objectui#10666 moved it here, beside `useFilterScope`, so the nine
 * packages whose nodes send their own filter share one copy instead of growing
 * nine. The hold, its key and its comparator moved unchanged; the one addition
 * is that a filter the resolver leaves unchanged is handed out as authored (see
 * `resolveHeldFilter`).
 */

import * as React from 'react';
import { resolveFilterPlaceholders, type FilterTokenScope } from '@object-ui/core';

/** One resolution of the node's own `filter`, remembered with its inputs. */
interface HeldFilter {
  authored: unknown;
  currentUserId: FilterTokenScope['currentUserId'];
  currentOrgId: FilterTokenScope['currentOrgId'];
  recordId: FilterTokenScope['recordId'];
  onUnresolved: FilterTokenScope['onUnresolved'];
  resolved: unknown;
}

function resolveHeldFilter(authored: unknown, scope: FilterTokenScope): HeldFilter {
  const resolved = resolveFilterPlaceholders(authored, scope);
  return {
    authored,
    currentUserId: scope.currentUserId,
    currentOrgId: scope.currentOrgId,
    recordId: scope.recordId,
    onUnresolved: scope.onUnresolved,
    // `resolveFilterPlaceholders` copies every array and plain object it walks,
    // so a filter with nothing to resolve comes back EQUAL but not the same
    // reference. Such a filter is handed out as authored: a node whose filter
    // carries no token sends the very value it was given, as it did before it
    // resolved anything (the `object-kanban` / `object-calendar` / `object-tree`
    // member pins read `$filter` by identity). Only a filter the resolver
    // actually changed is handed out as the resolved copy.
    resolved: isSameAuthoredFilter(resolved, authored) ? authored : resolved,
  };
}

/** Depth past which {@link isSameAuthoredFilter} gives up and answers "changed". */
const AUTHORED_FILTER_MAX_DEPTH = 12;

function isPlainFilterObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Compare two authored filters by structure, never by serialising them.
 *
 * The same rules as `plugin-view`'s `isStructurallyEqual` (objectui#6460):
 * primitives by `Object.is`, a `Date` by its instant, arrays element by
 * element and in order, plain objects by key set and value. Anything else is
 * equal only as the same reference, and a structure deeper than the bound is
 * "changed". Every uncertainty answers "changed", which re-resolves and
 * re-queries; the comparison can drop a redundant query, never a needed one.
 */
function isSameAuthoredFilter(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= AUTHORED_FILTER_MAX_DEPTH) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => isSameAuthoredFilter(item, b[i], depth + 1));
  }
  if (isPlainFilterObject(a) && isPlainFilterObject(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => (
      Object.prototype.hasOwnProperty.call(b, key) && isSameAuthoredFilter(a[key], b[key], depth + 1)
    ));
  }
  return false;
}

/**
 * Resolve a data node's own authored `filter` ONCE, and hold the result.
 *
 * Every context token the spec defines for filters (`{current_user_id}`,
 * `{current_org_id}`, `{record_id}` where a record is in view, and the date
 * macros such as `{today}`) is expanded by `@object-ui/core`'s shared
 * `resolveFilterPlaceholders`, against the scope `useFilterScope()` reads: the
 * session scope the host provides plus the mounted record's id
 * (objectui#7297). Pass `useFilterScope()` as `scope`:
 *
 * ```tsx
 * const filterScope = useFilterScope();
 * const filter = useResolvedFilter(schema.filter, filterScope);
 * // query with `filter`, and key the fetch effect on `filter`, never on schema.filter
 * ```
 *
 * ⛔ Not a second resolver, and no fallback: a token the scope cannot resolve
 * is whatever `resolveFilterPlaceholders` makes of it (left intact, with one
 * warning naming it).
 *
 * The result is HELD against its inputs, the shape `plugin-view`'s
 * `useResolvedFilterSegments` uses. A fetch effect keys on this filter, so a
 * resolved copy minted on every render would refetch on every render; and a
 * date macro such as `{now}` resolves to a new value at every call, so
 * comparing OUTPUTS cannot stop that. The key is the authored filter, compared
 * by structure (a host that rebuilds an equal filter inline must not
 * re-query), plus each scope member read one by one (`recordId` among them,
 * so moving to another record resolves again), never the scope object's
 * identity (AGENTS.md #10). The held pair lives in state, so the
 * value handed out is always the one React committed. A structurally different
 * filter, or a changed scope member, resolves again and hands out a new value.
 *
 * A filter the resolver leaves unchanged (no token, or only tokens the scope
 * cannot resolve) is handed out as the authored value itself, not as the
 * resolver's equal copy, so a token-free filter reaches the query exactly as
 * it did before any resolution.
 */
export function useResolvedFilter<T>(authored: T, scope: FilterTokenScope): T {
  const [held, setHeld] = React.useState(() => resolveHeldFilter(authored, scope));
  if (
    held.currentUserId !== scope.currentUserId
    || held.currentOrgId !== scope.currentOrgId
    || held.recordId !== scope.recordId
    || held.onUnresolved !== scope.onUnresolved
    || !isSameAuthoredFilter(held.authored, authored)
  ) {
    // React's documented "information from previous renders" shape: a set
    // during render re-renders this component at once, before any child sees
    // the discarded pass, and the re-render finds the inputs equal.
    const next = resolveHeldFilter(authored, scope);
    setHeld(next);
    return next.resolved as T;
  }
  return held.resolved as T;
}
