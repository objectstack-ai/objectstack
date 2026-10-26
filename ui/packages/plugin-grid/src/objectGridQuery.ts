/**
 * The query helpers of `ObjectGrid` (`./ObjectGrid.tsx`): the held resolution
 * of the node's own filter and the find-params signature, moved out of that
 * file verbatim (objectstack#25994, slice 1).
 */

import { useState } from 'react';
import type { ObjectGridSchema } from '@object-ui/types';
import { isSameAuthoredFilter } from '@object-ui/react';
import { resolveFilterPlaceholders, type FilterTokenScope } from '@object-ui/core';

/**
 * The node's own authored filter: the canonical `filter`. Its deprecated alias
 * `defaultFilters` is not read: `@objectstack/spec` 18 retired it as a
 * tombstone that refuses by name (objectstack#11509), and the alias read went
 * with it (objectui#12030).
 */
interface AuthoredGridFilters {
  filter: ObjectGridSchema['filter'];
}

/** One resolution, remembered with the inputs it was computed from. */
interface HeldGridFilters {
  authored: AuthoredGridFilters;
  currentUserId: FilterTokenScope['currentUserId'];
  currentOrgId: FilterTokenScope['currentOrgId'];
  recordId: FilterTokenScope['recordId'];
  onUnresolved: FilterTokenScope['onUnresolved'];
  resolved: AuthoredGridFilters;
}

function resolveGridFilters(authored: AuthoredGridFilters, scope: FilterTokenScope): HeldGridFilters {
  return {
    authored,
    currentUserId: scope.currentUserId,
    currentOrgId: scope.currentOrgId,
    recordId: scope.recordId,
    onUnresolved: scope.onUnresolved,
    resolved: resolveFilterPlaceholders(authored, scope),
  };
}

/**
 * objectui#10607 — resolve the node's own filter ONCE, through
 * `@object-ui/core`'s shared `resolveFilterPlaceholders`, against the session
 * scope the host provides (`useFilterScope`). Before this, a directly authored
 * `object-grid` with `filter: [['owner', '=', '{current_user_id}']]` sent the
 * literal token on `$filter`. `object-view` already resolves the filters it
 * hands this grid (objectui#10506); resolving that value again changes
 * nothing, because a resolved id no longer matches the whole-token pattern.
 *
 * ⛔ Not a second resolver, and no fallback: a token the scope cannot resolve
 * is whatever `resolveFilterPlaceholders` makes of it (left intact, with one
 * warning naming it).
 *
 * The result is HELD against its inputs, the shape `plugin-view`'s
 * `useResolvedFilterSegments` uses. The load effect keys on the filter this
 * grid lowers, so a resolved copy minted on every render would refetch on
 * every render; and a date macro such as `{now}` resolves to a new value at
 * every call, so comparing OUTPUTS cannot stop that. The key is the authored
 * filters, compared by structure (a host that rebuilds an equal filter inline
 * must not re-query), plus each scope member read one by one (`recordId`
 * among them, objectui#7297), never the scope object's identity (AGENTS.md
 * #10). The held pair lives in state,
 * so the value handed out is always the one React committed.
 */
export function useResolvedGridFilters(authored: AuthoredGridFilters, scope: FilterTokenScope): AuthoredGridFilters {
  const [held, setHeld] = useState(() => resolveGridFilters(authored, scope));
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
    const next = resolveGridFilters(authored, scope);
    setHeld(next);
    return next.resolved;
  }
  return held.resolved;
}

/**
 * Content signature of a host's find-params, used as the query-change signal for
 * the cross-page escalation (objectui#4501 clause 2).
 *
 * CONTENT and not identity: a host re-render that rebuilds an equal params
 * object must not drop an escalation the user just made, and identity is the
 * one thing a host cannot be relied on to keep stable. Top-level keys are
 * sorted so key ORDER — which differs between the host's literal and this
 * grid's own loader — never reads as a query change.
 */
export function findParamsSignature(params: Record<string, unknown> | null | undefined): string | null {
  if (!params) return null;
  return JSON.stringify(
    Object.keys(params).sort().map((k) => [k, params[k] ?? null]),
  );
}
