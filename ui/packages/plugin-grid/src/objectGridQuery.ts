/**
 * The query helpers of `ObjectGrid` (`./ObjectGrid.tsx`): the held resolution
 * of the node's own filter, the record-source ladder and the find-params
 * signature, moved out of that file verbatim (objectstack#25994, slice 1).
 */

import { useState } from 'react';
import type { ObjectGridSchema, ViewData } from '@object-ui/types';
import { isSameAuthoredFilter } from '@object-ui/react';
import { resolveRecordSourceConfig, resolveFilterPlaceholders, type FilterTokenScope } from '@object-ui/core';

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
 * Helper to get data configuration from schema.
 *
 * The ruled three-rung ladder itself (`data`, then `staticData`, then
 * `objectName`) is `resolveRecordSourceConfig` in `@object-ui/core` — ONE
 * implementation of a contract published on both faces (`77cb489b4`), which
 * this file used to hand-copy (`ce2aaefe1`).
 *
 * What used to stay here was the head above it: the bare-array `data`
 * shorthand, which lifted `data: [...]` to `{ provider: 'value', items }`.
 * ⛔ IT IS GONE (objectui#8348, decision batch #83, maintainer verbatim
 * 「8348 以协议为准」 — the contract decides).
 *
 * MEASURED on `@objectstack/spec` 17.4.0:
 * `ComponentPropsMap['object-grid'].data` is the `ViewData` union, and its own
 * description names the refusal — *"Static inline rows live at
 * `{ provider: 'value', items: [...] }`; the bare-array shortcut is refused —
 * see migration `object-grid-data-view-data-converged`"*. This block's own
 * registration publishes the same arm (`{ name: 'data', type: 'object' }` in
 * `index.tsx`), and `gridDataInputContract.test.ts` has pinned that declaration
 * since objectui#5090. The head was the last carrier of a spelling every one of
 * those faces refuses, so `data` is honoured here on the OBJECT arm only and
 * the shared rung is passed `'view-data'`.
 *
 * ⛔ WHAT THIS REACHES, measured per CARRIER — do NOT read it as "the array is
 * gone". An authored `data` array reaches this component TWICE: as
 * `schema.data`, which this function used to lift, and as the `data` PROP,
 * because `SchemaRenderer` spreads every non-metadata node key and
 * `index.tsx` forwards `{...rest}`. That prop is `passedData` below, and it
 * lifts an array to `{ provider: 'value', items }` at HIGHER priority than this
 * ladder — it is the channel a host such as `ListView` uses to hand down rows it
 * already fetched, and it is indistinguishable here from an authored key.
 *
 * ⇒ at the ladder the array is no longer a record source; through
 * `SchemaRenderer` an authored `data: [ …rows… ]` still draws, from the props
 * channel. Both halves are pinned in
 * `__tests__/gridBareArrayDataRefused-8348.test.tsx`, which had to correct its
 * own first draft on exactly this point. Collapsing the two carriers would take
 * the host path with it and is outside objectui#8348's scope — reported on the
 * card, not changed in passing.
 *
 * The declared spelling for inline rows is
 * `data: { provider: 'value', items: [...] }`, and the deprecated `staticData`
 * array still works as before.
 */
export function getDataConfig(schema: ObjectGridSchema): ViewData | null {
  return resolveRecordSourceConfig(schema, 'view-data');
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
