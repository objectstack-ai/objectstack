/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Module-scoped store for related-list counts displayed in tab badges
 * (e.g. "Contacts (12)" on an Account detail). The store deduplicates
 * concurrent probes for the same key, lets the renderer subscribe with
 * `useSyncExternalStore`, and exposes invalidation hooks so other parts
 * of the runtime (bulk delete, inline create, optimistic update) can
 * keep the badges in sync without a full page refetch.
 *
 * Design notes:
 *  - One global Map keyed by `${objectName}::${relField}::${parentId}` so
 *    a count fetched by one tab strip is reused by every other consumer. A
 *    probe carrying a declared scope filter (objectui#4664) discriminates
 *    inside the relField segment, so a filtered and an unfiltered count over
 *    the same triple are separate entries rather than one wrong number.
 *  - Subscribers receive *all* keyspace changes; coarse-grained but
 *    badges are cheap to re-render and avoids per-key subscription noise.
 *  - We deliberately avoid Zustand here — the surface area is one Map +
 *    an emit() — and the React binding uses the built-in
 *    `useSyncExternalStore` so we don't grow the dependency graph.
 *
 * ## One read for a badge and a rail card over the same list (objectui#13010)
 *
 * A record page can show the same unfiltered related list twice: as a
 * `page:tabs` badge, which needs only the total, and as a
 * `record:reference_rail` card, which needs the total and the first N rows.
 * Both ask the same question of the same relationship, so the store answers
 * both with ONE read, whichever of the two asks first:
 *
 *  - The rail CLAIMS its entries while it renders (`claimRows`), before any
 *    effect on the page has run. A badge probe that finds a claim on its key
 *    asks for the claimed rows (`$top: N`) with the count, rather than
 *    `$top: 1`, and the store holds those rows until the rail takes them.
 *  - The rail reads through `fetchRows`. It takes rows the badge's read already
 *    holds, joins that read while it is in flight, or reads itself and
 *    registers that read in flight, so a badge probe that comes later joins it
 *    for the total.
 *
 * Nothing here depends on which effect, microtask or frame comes first: the
 * claim is made in render, and each side either joins the other's read or
 * makes the read the other joins. Where the claim cannot come first (the
 * badge's read went out before the rail rendered at all), the badge's read
 * asked for one row, the rail cannot use it, and the rail reads for itself:
 * two reads, as before this card, and still the right answer.
 *
 * Held rows are a hand-off, not a cache: the rail takes them once; an
 * invalidation of the child object drops them, and so does the rail's unmount
 * (`releaseRows`), so no rows outlive the record open that read them. The
 * rail's own refresh (a bus invalidation) never comes here: it reads again.
 * A badge whose declared filter differs from the card has a different key, so
 * it never meets the card's claim and keeps its own probe.
 *
 * The cost of claiming in render: a render React discards without committing
 * made its claim and has no cleanup to withdraw it, so the claim stands until
 * a committed rail releases that key or `_reset`. It is bounded by the
 * (object, relField, parentId) keys rendered, and all it does is make a badge
 * probe of that same parent's list ask for a few rows instead of one.
 */

import { useSyncExternalStore } from 'react';
import { subscribeDataChanges } from '@object-ui/react';
import { composeParentScopeFilter, mergeFilterNodes, type FieldContainerLike } from '@object-ui/core';

type Listener = () => void;

interface ProbeFn {
  (
    objectName: string,
    query: {
      /**
       * The parent scope alone (a MongoDB-style object, as it always was), or
       * — once a list declares its own scope — the ObjectQL AST node
       * `mergeFilterNodes` lowers the pair to. Both arms are what the ROW
       * query on the same list already sends, so this union is not a new
       * dialect: it is the same two shapes `RelatedList` puts on the wire.
       */
      $filter?: Record<string, unknown> | unknown[];
      $top?: number;
      $count?: boolean;
    },
  ): Promise<{ total?: number; data?: unknown[] } | unknown[] | { length?: number }>;
}

/** What one read of a related list answered: the server total and its rows. */
interface ReadResult {
  total: number;
  rows: unknown[];
}

/**
 * One read in flight. `top` is the `$top` it asked for, so a rail entry can
 * tell whether it carries the rows it needs; `fromRows` marks a read the rail
 * started itself (`fetchRows`), which only the rail's unmount may drop.
 */
interface InflightRead {
  read: Promise<ReadResult>;
  top: number;
  fromRows: boolean;
}

const counts = new Map<string, number>();
const inflight = new Map<string, InflightRead>();
// objectui#13010 — rail rows claimed per key (the largest claimed row cap), and
// the rows a badge's read fetched for that claim, held until the rail takes
// them. See the file header.
const claims = new Map<string, number>();
const heldRows = new Map<string, ReadResult & { top: number }>();
const listeners = new Set<Listener>();
// Monotonic store version — the `useSyncExternalStore` snapshot. Bumped on
// every change so React actually re-renders subscribers (returning the
// `counts` Map itself never re-rendered: identical reference, Object.is-equal
// snapshots).
let version = 0;

/**
 * A list's own declared scope, as carried on the `record:related_list` node it
 * badges (objectui#4664 / objectstack#7118). Two probes over the SAME
 * (object, relField, parent) triple are different questions when their scopes
 * differ, so it is part of the cache identity below.
 */
export type CountScopeFilter = Record<string, any> | any[];

/**
 * Cache identity for one probe.
 *
 * The scope rides INSIDE the relField segment rather than as a fourth one, so
 * the two structural reads `invalidate` performs on these strings keep working
 * unchanged: `startsWith(`${objectName}::`)` and — for the parentId-scoped
 * form — `endsWith(`::${parentId}`)`. Appending the scope after the parent id
 * would have silently broken the second, and its failure mode is a badge that
 * never refreshes after a write: no error, just a stale number.
 *
 * With no scope the string is BYTE-IDENTICAL to what it was before this
 * parameter existed, so no cache entry moves and no warm badge goes cold.
 *
 * Keyed on CONTENT (`JSON.stringify`) for the reason `RelatedList` keys its own
 * filter memo that way: an inline filter object on a schema node is a new
 * identity every render, and identity-keying would miss the cache every time.
 */
function key(
  objectName: string,
  relField: string | undefined,
  parentId: string | undefined,
  filter?: CountScopeFilter,
): string {
  const scope = filter === undefined ? (relField ?? '') : `${relField ?? ''}#${JSON.stringify(filter)}`;
  return `${objectName}::${scope}::${parentId ?? ''}`;
}

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

function getCount(
  objectName: string,
  relField: string | undefined,
  parentId: string | undefined,
  filter?: CountScopeFilter,
): number | undefined {
  return counts.get(key(objectName, relField, parentId, filter));
}

function setCount(
  objectName: string,
  relField: string | undefined,
  parentId: string | undefined,
  value: number,
  filter?: CountScopeFilter,
): void {
  const k = key(objectName, relField, parentId, filter);
  const prev = counts.get(k);
  if (prev === value) return;
  counts.set(k, value);
  emit();
}

/**
 * Send ONE read of a related list and record its total. Rejects on a failed
 * read; the count is not cached then. Shared by the badge's probe
 * (`fetchCount`) and the rail's read (`fetchRows`), so both put the same
 * `$filter` on the wire.
 */
function startRead(
  probe: ProbeFn,
  objectName: string,
  relField: string | undefined,
  parentId: string | undefined,
  filter: CountScopeFilter | undefined,
  fields: FieldContainerLike | undefined,
  top: number,
  fromRows: boolean,
): InflightRead {
  const k = key(objectName, relField, parentId, filter);
  const entry: InflightRead = { read: Promise.resolve({ total: 0, rows: [] }), top, fromRows };
  entry.read = (async (): Promise<ReadResult> => {
    // The data source convention across this codebase is `$filter` /
    // `$top` (OData-ish). Earlier versions of this file used `where` /
    // `limit` which most adapters silently ignored, so the probe ended
    // up fetching the entire target table and returning its global
    // count — completely wrong for parent-scoped badges.
    // The parent-relationship condition, compiled to match the relationship
    // field's ARITY by the ONE compiler of it — `@object-ui/core`'s
    // `composeParentScopeFilter`, the very call `RelatedList` makes for the
    // ROWS. Without `fields` the seam answers equality, which is the historical
    // wire and the only answer available to a caller that cannot see metadata.
    let parentScope: Record<string, unknown> = {};
    if (relField) {
      if (!parentId) return { total: 0, rows: [] };
      parentScope = composeParentScopeFilter(relField, parentId, fields);
    }
    // objectui#4664 — the parent relationship AND the list's own declared
    // scope, composed exactly as `RelatedList` composes them for the ROWS
    // (`mergeFilterNodes(parentScope, listFilterNode)`). That shared sink is
    // what makes badge/row parity a property of the code rather than of two
    // implementations agreeing by luck: the badge cannot count a set the list
    // does not show, because both sides send the same `$filter`.
    //
    // ⭐ BOTH halves of that `$filter` are now shared, which is what lets the
    // claim above be stated without an exception. The declared scope has gone
    // through `mergeFilterNodes` since objectui#4664; the PARENT condition went
    // through a second compiler until objectui#8882 — `RelatedList` matched the
    // relationship field's ARITY (objectui#7299) while this probe sent bare
    // equality, so a multi-value related list rendered its ROWS and got no
    // badge: the `catch` below swallows the driver's refusal without a
    // `setCount`, leaving the store with no entry and the tab with no count.
    // Both sides now call `composeParentScopeFilter`.
    //
    // ⛔ The claim is not self-enforcing, and an unenforced claim is how the
    // exception above survived being false. What holds it up is a PIN that goes
    // RED, on the page, with both reads on one wire:
    // `app-shell/src/views/RecordDetailView.relatedBadgeArity-8882.test.tsx`
    // renders a real detail page over a backend that REFUSES equality on a
    // multi-value column the way `driver-sql` does, and asserts the badge digits
    // equal the rendered row count at a POSITIVE count. Its sibling
    // `RecordDetailView.relatedListFilter-4664.test.tsx` holds the declared-scope
    // half. Delete either and this comment is a claim again.
    //
    // The parent condition is never negotiable — a declared filter may only
    // NARROW this parent's children — and `mergeFilterNodes` guarantees that
    // by wrapping both sources under one `and` rather than letting either
    // replace the other.
    //
    // With nothing declared the query is the untouched MongoDB-style object it
    // has always been, rather than a freshly lowered AST that means the same
    // thing: same reason `RelatedList` guards its own call this way. The
    // difference is invisible on screen and visible to every caller pinning
    // the wire.
    const $filter =
      filter === undefined ? parentScope : (mergeFilterNodes(parentScope, filter) ?? parentScope);
    try {
      // Request the server-side count instead of relying on the page length.
      // Without `$count: true` most adapters omit `total`, and we'd fall
      // back to `data.length` which is capped to `$top: 1` → badge
      // shows "1" no matter how many rows exist.
      //
      // The count reads `total` — the ONE count member `QueryResult`
      // (`@object-ui/types`) declares — then falls back to the ONE rows member
      // it declares, `data`. Nothing else.
      //
      // Two tolerant arms were removed from this expression, each on its own
      // measurement. `records` FIRST, ahead of `data` (objectui#5945,
      // objectui#6726). Then `count` SECOND, still ahead of `data`
      // (objectui#6840): `count` is the RAW-payload spelling that
      // `ObjectStackAdapter.normalizeQueryResult` and
      // `ApiDataSource.normalizeQueryResult` both fold into `total` BELOW this
      // seam, so no producer emits it here — a sweep of all 452 `find()`
      // definition bodies in the repo found `count` emitted 0 times against
      // controls `total` (85) and `data` (135) drawn from the same cells.
      // `ProbeFn` above never declared either spelling — only the `any` here
      // let them through. Pinned by
      // `related-count-store.contractEnvelope-6726.test.ts` and
      // `related-count-store.contractEnvelope-6840.test.ts`; ⛔ do not re-add a
      // tolerant arm, and ⛔ do not widen `QueryResult` to bless `records` or
      // `count` (a published-type change, maintainer's call).
      //
      // objectui#13010 — `$top` is 1 for a badge alone, and the claimed rail
      // row cap when a rail card lists the same question (see the header).
      const res: any = await probe(objectName, { $filter, $top: top, $count: true });
      const total =
        typeof res?.total === 'number'
          ? res.total
          : Array.isArray(res?.data)
            ? res.data.length
            : Array.isArray(res)
              ? res.length
              : 0;
      const n = typeof total === 'number' ? total : 0;
      const rows = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      // Installed only from the read that is still this key's current one: a
      // read an invalidation overtook answers for data that has changed, and
      // must not overwrite the count a fresh read installs (nor install a stale
      // one into the emptied entry).
      if (inflight.get(k) === entry) setCount(objectName, relField, parentId, n, filter);
      // Rows are held only for a claim that still stands, and only from the
      // read that is still this key's current one: an invalidation or the
      // rail's unmount while this read was out drops the claim or the entry,
      // and its rows with them.
      if (!fromRows && filter === undefined && claims.has(k) && inflight.get(k) === entry) {
        heldRows.set(k, { total: n, rows, top });
      }
      return { total: n, rows };
    } finally {
      if (inflight.get(k) === entry) inflight.delete(k);
    }
  })();
  return entry;
}

/**
 * Probe a count via the supplied finder. Deduplicates concurrent requests
 * for the same key and caches the resulting number until invalidated.
 */
async function fetchCount(
  probe: ProbeFn,
  objectName: string,
  relField: string | undefined,
  parentId: string | undefined,
  filter?: CountScopeFilter,
  fields?: FieldContainerLike,
): Promise<number> {
  const k = key(objectName, relField, parentId, filter);
  const cached = counts.get(k);
  if (cached !== undefined) return cached;
  let pending = inflight.get(k);
  if (!pending) {
    // A rail card claims rows only on the unfiltered key, so a badge with a
    // declared filter never reaches a claim and asks for one row.
    const claimed = filter === undefined ? claims.get(k) : undefined;
    pending = startRead(probe, objectName, relField, parentId, filter, fields, claimed ?? 1, false);
    inflight.set(k, pending);
  }
  try {
    return (await pending.read).total;
  } catch {
    return 0;
  }
}

/**
 * objectui#13010 — the rail card's read: the first `limit` rows of the
 * unfiltered related list and its total. Takes the rows a badge's read holds
 * for this card's claim, joins a read in flight that asked for enough rows, or
 * reads itself and registers that read in flight for a badge to join.
 * Rejects when the read fails, so the card can show its error state.
 *
 * One exception to the registration: when a read with too FEW rows (a badge's
 * one-row probe) is already in flight, this card's own read is NOT registered
 * in flight. The too-small read stays the one a badge joins, and since only the
 * current in-flight read installs a count, the card's own read installs none:
 * the badge's read does.
 *
 * Contract: held rows are a HAND-OFF, not a cache. They are taken once (the
 * first `fetchRows` that finds them removes them; a second call reads again),
 * and they are dropped without being taken when the child object is
 * invalidated (`invalidate` / `invalidateAll`, and the data-change bus that
 * calls them), when the claim is released (`releaseRows`: the card unmounts or
 * moves to a new scope), and when the read that fetched them was overtaken by
 * either. The total is recorded in the store as `fetch` records it. A caller
 * that must see data newer than the record open (a refresh) does not call this.
 */
async function fetchRows(
  probe: ProbeFn,
  objectName: string,
  relField: string,
  parentId: string,
  limit: number,
  fields?: FieldContainerLike,
): Promise<ReadResult> {
  const k = key(objectName, relField, parentId);
  const held = heldRows.get(k);
  if (held && held.top >= limit) {
    heldRows.delete(k);
    return { total: held.total, rows: held.rows.slice(0, limit) };
  }
  const pending = inflight.get(k);
  if (pending && pending.top >= limit) {
    const result = await pending.read;
    heldRows.delete(k);
    return { total: result.total, rows: result.rows.slice(0, limit) };
  }
  const own = startRead(probe, objectName, relField, parentId, undefined, fields, limit, true);
  // A read already out with too few rows stays the one a badge joins.
  if (!pending) inflight.set(k, own);
  return own.read;
}

/**
 * objectui#13010 — a rail card says, while it renders, that it will list the
 * first `limit` rows of this unfiltered related list. Idempotent, so a render
 * React repeats or discards claims nothing new.
 *
 * Contract: a claim reads nothing by itself. While it stands, a `fetch` of the
 * same unfiltered (object, relField, parentId) key asks for the claimed rows
 * (the largest `limit` claimed) with its count and holds them for one
 * `fetchRows` to take. A probe with a declared filter never meets a claim. The
 * claim stands until `releaseRows` (unmount or new scope) or `_reset`; an
 * invalidation drops held rows but leaves the claim.
 */
function claimRows(objectName: string, relField: string, parentId: string, limit: number): void {
  const k = key(objectName, relField, parentId);
  const prev = claims.get(k);
  if (prev === undefined || prev < limit) claims.set(k, limit);
}

/**
 * objectui#13010 — the rail card is gone: its claim, the rows held for it and
 * the read it started itself are dropped, so nothing outlives the record open.
 *
 * Contract: call it with the key a `claimRows` named, when the card unmounts
 * or moves to a new scope (another parent or other entries). Afterwards a
 * `fetch` of that key asks for one row again, untaken held rows are gone, and
 * a later `fetchRows` does not join a read the card started itself. A read a
 * badge started stays in flight for the badges that joined it.
 */
function releaseRows(objectName: string, relField: string, parentId: string): void {
  const k = key(objectName, relField, parentId);
  claims.delete(k);
  heldRows.delete(k);
  if (inflight.get(k)?.fromRows) inflight.delete(k);
}

/**
 * Invalidate every cached count that involves the given object. Called by
 * mutation paths (e.g. ObjectGrid's onBulkDelete callback, drawer save) so
 * the badge updates without forcing a parent re-render.
 *
 * When `parentId` is supplied, only entries whose parentId matches are
 * dropped — useful for "I just created one Contact under Account X".
 */
function invalidate(objectName: string, parentId?: string): void {
  let changed = false;
  const prefix = `${objectName}::`;
  const matches = (k: string) => k.startsWith(prefix) && (parentId === undefined || k.endsWith(`::${parentId}`));
  // objectui#13010 — rows held for a rail card, and reads that went out before
  // the change, answer for data that has changed: neither may be handed to a
  // reader that asks after it.
  for (const k of [...heldRows.keys()]) if (matches(k)) heldRows.delete(k);
  for (const k of [...inflight.keys()]) if (matches(k)) inflight.delete(k);
  for (const k of counts.keys()) {
    if (!matches(k)) continue;
    counts.delete(k);
    changed = true;
  }
  if (changed) emit();
}

function invalidateAll(): void {
  heldRows.clear();
  inflight.clear();
  if (counts.size === 0) return;
  counts.clear();
  emit();
}

function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): number {
  return version;
}

/**
 * Subscribe to the related-count store and read the count for a single
 * (object, relField, parentId) triple. Returns `undefined` while the
 * probe is in flight or before the first request.
 */
export function useRelatedCount(
  objectName: string | undefined,
  relField: string | undefined,
  parentId: string | undefined,
  filter?: CountScopeFilter,
): number | undefined {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!objectName) return undefined;
  return getCount(objectName, relField, parentId, filter);
}

/**
 * Subscribe to the store's monotonic version. Put it in an effect dependency
 * array to RE-RUN count probes after an invalidation (#2269) — invalidate
 * deletes the cached numbers, and this version bump is what makes the probe
 * effect fetch them again (fetchCount returns cached values without emitting,
 * so the loop settles once every probed key is warm again).
 */
export function useRelatedCountVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Imperative store API for non-React callers (mutation handlers, tests).
 * Prefer `useRelatedCount` in components.
 *
 * `fetch`'s last parameter is the CHILD object's field defs. It is optional
 * because a caller that cannot see metadata must still be able to probe — the
 * seam then compiles the historical equality wire — but a caller that CAN see
 * them owes them: that is the difference between a badge and no badge on a
 * multi-value relationship (objectui#8882).
 */
export const RelatedCountStore = {
  get: getCount,
  set: setCount,
  fetch: fetchCount,
  // objectui#13010 — the rail card's half of the shared read (file header).
  fetchRows,
  claimRows,
  releaseRows,
  invalidate,
  invalidateAll,
  // Exposed for test isolation only — production code should never need this.
  _reset: () => {
    counts.clear();
    inflight.clear();
    claims.clear();
    heldRows.clear();
    emit();
  },
};

// #2269 — wire the store to the data-invalidation bus: any change to an
// object (form save, record action, undo, any dataSource write via the
// MutationEvent bridge) invalidates its related-count badges everywhere.
// Module-scope on purpose: the store itself is module-scoped, and this keeps
// the wiring next to the thing it wires (one subscription per bundle).
subscribeDataChanges((change) => {
  if (change.objectName === '*') RelatedCountStore.invalidateAll();
  else RelatedCountStore.invalidate(change.objectName);
});
