/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { RelatedCountStore, useRelatedCountVersion } from '@object-ui/components';
import { resolveFilterPlaceholders, type FieldContainerLike, type FilterTokenScope } from '@object-ui/core';
import { useFilterScope } from '@object-ui/react';
import { relatedCardId, type RelatedCardId } from './synth/relatedArrangement';

/**
 * The related column's counts, first (objectstack#27056, Target 1: 「关联都放在
 * 右侧，记录打开时是不是会很慢，因为需要加载所有的关联子表」 — the related column
 * loads counts first, rows on demand, and never blocks the details).
 *
 * ONE request set per parent: every related list of the column is counted at
 * once, in one `Promise.all`, and the cards draw their headers when the whole
 * set has answered — one loading state, not N cards settling one by one. The
 * data source has no batched read door (`/batch` is the atomic WRITE), so the
 * set is one count read per list, all in the same round trip.
 *
 * The counts live in `RelatedCountStore` (`@object-ui/components`), the store
 * the tab strip's badges already read: the same `$count` probe, the same cache
 * key, the same invalidation from the data-change bus. So a badge and a card
 * over the same list ask one question once, a write to a child re-counts it,
 * and a prefetch ({@link prefetchRelatedCounts}) warms what the next record's
 * page reads, whichever face that page draws.
 *
 * The shape is the counts, never the card: the related column's compact cards
 * read it today, and a later face (a panel stack folding its empty panels)
 * reads the same answer.
 */

/** A list's declared scope, as the count store keys it. */
type CountScopeFilter = Record<string, any> | any[];

/** One related list to count: a `record:related_list` node's relationship and declared scope. */
export interface RelatedCountTarget {
  /** The relationship id, `CHILD_OBJECT.FK_FIELD`. */
  id: RelatedCardId;
  objectName: string;
  relationshipField: string;
  /** The list's own declared scope (`filter` on the node), as authored. */
  filter?: CountScopeFilter;
}

type PageNode = Record<string, any>;

const asNode = (value: unknown): PageNode | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as PageNode) : null;

/**
 * The count target of a `record:related_list` node, or `null` for a node that
 * is not one or whose count cannot be asked up front.
 *
 * Up front means from the page alone: the parent is the record in context and
 * the child is named on the node. A node bound elsewhere — an element
 * `dataSource` binding (resolved by its gate, possibly to another object), a
 * `parentDataSource` binding (another parent record), or a parent link through
 * a field other than `id` (read off the record body) — keeps reading for
 * itself, exactly as before.
 */
export function relatedCountTargetOf(node: unknown): RelatedCountTarget | null {
  const raw = asNode(node);
  if (!raw || raw.type !== 'record:related_list') return null;
  const p: PageNode = { ...raw, ...(asNode(raw.properties) ?? {}) };
  if (typeof p.objectName !== 'string' || !p.objectName) return null;
  if (typeof p.relationshipField !== 'string' || !p.relationshipField) return null;
  if (p.dataSource !== undefined || p.parentDataSource !== undefined) return null;
  if (p.relationshipValueField !== undefined && p.relationshipValueField !== 'id') return null;
  return {
    id: relatedCardId(p.objectName, p.relationshipField),
    objectName: p.objectName,
    relationshipField: p.relationshipField,
    ...(p.filter === undefined || p.filter === null ? {} : { filter: p.filter as CountScopeFilter }),
  };
}

/**
 * The count targets of every `record:related_list` a page places, in document
 * order, each relationship once — what {@link prefetchRelatedCounts} warms for
 * the next record a drawer steps to. A node under a `visibleWhen` gate (on
 * itself or on a tab item that holds it) is left out: whether it shows is the
 * next record's own answer, and counting it could spend a read on a list that
 * never draws.
 */
export function relatedCountTargetsIn(page: unknown): RelatedCountTarget[] {
  const out: RelatedCountTarget[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const node = asNode(value);
    if (!node) return;
    if (node.visibleWhen !== undefined && node.visibleWhen !== null) return;
    const target = relatedCountTargetOf(node);
    if (target) {
      if (!seen.has(target.id)) {
        seen.add(target.id);
        out.push(target);
      }
      return;
    }
    const props = asNode(node.properties);
    for (const slot of [node.regions, node.components, node.children, props?.children, props?.items, node.items]) {
      if (slot) walk(slot);
    }
  };
  walk(page);
  return out;
}

/** Where the counts are read from: the parent record and its data source. */
export interface RelatedCountsSource {
  /** The parent record's id — the record the lists hang off. */
  parentId: string | number | null | undefined;
  /** The data source the lists read through (`find`, and `getObjectSchema` for the arity). */
  dataSource: unknown;
  /**
   * The CHILD object's field definitions when the host already holds them
   * (its metadata list). They decide the relationship's ARITY, which the count
   * must ask the way the rows do (`composeParentScopeFilter`, objectui#8882).
   * A child this answers `undefined` for is read through `getObjectSchema`
   * first, the tab strip's route.
   */
  fieldsOf?: (objectName: string) => FieldContainerLike;
}

interface CountingDataSource {
  find: (objectName: string, query: any) => Promise<any>;
  getObjectSchema?: (objectName: string) => Promise<any>;
}

const asCountingSource = (dataSource: unknown): CountingDataSource | null =>
  dataSource && typeof (dataSource as CountingDataSource).find === 'function'
    ? (dataSource as CountingDataSource)
    : null;

const parentKeyOf = (parentId: RelatedCountsSource['parentId']): string =>
  parentId === null || parentId === undefined || parentId === '' ? '' : String(parentId);

/** A target whose declared scope has had its context tokens resolved. */
type ResolvedTarget = RelatedCountTarget;

function resolveTargets(targets: readonly RelatedCountTarget[], scope: FilterTokenScope): ResolvedTarget[] {
  return targets.map((target) =>
    target.filter === undefined
      ? target
      : { ...target, filter: resolveFilterPlaceholders(target.filter, scope) as CountScopeFilter },
  );
}

/**
 * Count `targets` for one parent: one `Promise.all` over the store's `$count`
 * probe. Resolves when every count has answered; a failed read leaves its
 * count unset (the store caches successes only), never a made-up `0`.
 *
 * With `warmSchemas`, each child's definition is read beside its count, so the
 * card's row read that follows finds it in the adapter's cache instead of
 * spending a round trip of its own on it.
 */
async function countTargets(
  targets: readonly ResolvedTarget[],
  source: RelatedCountsSource,
  warmSchemas: boolean,
): Promise<void> {
  const ds = asCountingSource(source.dataSource);
  const parentKey = parentKeyOf(source.parentId);
  if (!ds || !parentKey || targets.length === 0) return;
  // The store's own probe asks one row (`$top` 1) and reads only the total,
  // so that row carries its id alone. A larger `$top` is a rail's claim on
  // the rows it draws, which keeps the whole row.
  const probe = (objectName: string, query: any) =>
    ds.find(objectName, query?.$top === 1 ? { ...query, $select: ['id'] } : query);
  const schemaFields = (objectName: string): Promise<FieldContainerLike> =>
    typeof ds.getObjectSchema === 'function'
      ? ds.getObjectSchema(objectName).then(
          (schema) => schema?.fields as FieldContainerLike,
          () => undefined,
        )
      : Promise.resolve(undefined);
  await Promise.all(
    targets.map(async (target) => {
      const held = source.fieldsOf?.(target.objectName);
      const read = held === undefined || warmSchemas ? schemaFields(target.objectName) : undefined;
      // Fields the host holds need no read before the count; without them the
      // arity is read first, as the tab strip does — never probed and
      // corrected afterwards, since the store keeps the first answer it gets.
      const fields = held !== undefined ? held : await read;
      await RelatedCountStore.fetch(probe, target.objectName, target.relationshipField, parentKey, target.filter, fields);
    }),
  );
}

/**
 * Warm the counts of `targets` for another parent — the record a drawer's ↑ ↓
 * steps to next (objectstack#27056, Target 4) — so its page draws its counts
 * from the store instead of waiting a round trip for them. `scope` is the
 * session scope the lists' declared filters resolve in; the record token
 * resolves to `parentId`, the record that page will show.
 */
export function prefetchRelatedCounts(
  targets: readonly RelatedCountTarget[],
  source: RelatedCountsSource,
  scope: FilterTokenScope = {},
): Promise<void> {
  const parentKey = parentKeyOf(source.parentId);
  if (!parentKey) return Promise.resolve();
  const resolved = resolveTargets(targets, { ...scope, recordId: parentKey, onUnresolved: null });
  return countTargets(resolved, source, false).catch(() => undefined);
}

/** What {@link useRelatedCounts} answers for one card. */
export type RelatedCountState =
  /** The set this card belongs to is still being counted: draw its skeleton. */
  | { kind: 'pending' }
  /** Counted: draw the header from `count`, and read rows only when it is above 0. */
  | { kind: 'counted'; count: number }
  /** Not counted up front (no source, or the read failed): the card reads for itself. */
  | { kind: 'uncounted' };

export interface RelatedCounts {
  /** The state of the card for relationship `id`; `uncounted` for an id that is not a target. */
  stateOf: (id: RelatedCardId) => RelatedCountState;
}

const PENDING: RelatedCountState = { kind: 'pending' };
const UNCOUNTED: RelatedCountState = { kind: 'uncounted' };

/** Content key of a target set: its ids and resolved scopes, in order. */
const targetsKeyOf = (targets: readonly ResolvedTarget[]): string =>
  JSON.stringify(targets.map((t) => [t.id, t.filter ?? null]));

/**
 * The counts of `targets` for the record in context, counted together.
 *
 * Until the set has answered, every card of it is `pending` (one loading
 * state). Afterwards a card is `counted`, or `uncounted` when its read failed.
 * A card that joins the set later (the reader shows a hidden one) is `pending`
 * on its own until its count lands; the cards already drawn keep theirs. A
 * write to a child (the data-change bus invalidates the store) re-counts it,
 * and the card keeps its last count while the new one is out.
 *
 * The declared scopes are resolved once per content and scope, held by value
 * (a `{now}` macro does not move them every render), in the record's filter
 * scope — the scope `RelatedList` resolves the rows' filter in.
 */
export function useRelatedCounts(
  targets: readonly RelatedCountTarget[],
  source: RelatedCountsSource,
): RelatedCounts {
  const scope = useFilterScope();
  // Re-render on every store change; the effect below re-counts what an
  // invalidation dropped.
  const storeVersion = useRelatedCountVersion();
  const parentKey = parentKeyOf(source.parentId);
  const ds = asCountingSource(source.dataSource);
  const authoredKey = JSON.stringify(targets.map((t) => [t.id, t.objectName, t.relationshipField, t.filter ?? null]));
  const scopeKey = `${scope.currentUserId ?? ''}|${scope.currentOrgId ?? ''}|${scope.recordId ?? ''}`;

  // The resolved targets, held by value: recomputed only when the authored
  // content or the scope's ids move (React's "information from previous
  // renders" shape — the set during render re-renders at once).
  const [held, setHeld] = React.useState(() => ({ authoredKey, scopeKey, targets: resolveTargets(targets, scope) }));
  let resolved = held.targets;
  if (held.authoredKey !== authoredKey || held.scopeKey !== scopeKey) {
    resolved = resolveTargets(targets, scope);
    setHeld({ authoredKey, scopeKey, targets: resolved });
  }
  const targetsKey = targetsKeyOf(resolved);

  // The parent whose first set has answered, and the counts last seen per
  // store key (so a re-count after a write keeps the number on screen). The
  // reads out now and the reads that failed are per parent too; they live in
  // refs because the effect, not the render, owns them.
  const [settledParent, setSettledParent] = React.useState('');
  const [lastKnown, setLastKnown] = React.useState<ReadonlyMap<string, number>>(() => new Map());
  const outRef = React.useRef(new Set<string>());
  const failedRef = React.useRef({ parentKey: '', keys: new Set<string>() });
  const liveParentRef = React.useRef(parentKey);
  liveParentRef.current = parentKey;
  const fieldsOfRef = React.useRef(source.fieldsOf);
  fieldsOfRef.current = source.fieldsOf;

  const storeKeyOf = (t: ResolvedTarget) => JSON.stringify([t.objectName, t.relationshipField, parentKey, t.filter ?? null]);
  const cachedOf = (t: ResolvedTarget): number | undefined =>
    RelatedCountStore.get(t.objectName, t.relationshipField, parentKey, t.filter);
  const countOf = (t: ResolvedTarget): number | undefined => cachedOf(t) ?? lastKnown.get(storeKeyOf(t));
  const failed = (t: ResolvedTarget): boolean =>
    failedRef.current.parentKey === parentKey && failedRef.current.keys.has(storeKeyOf(t));

  React.useEffect(() => {
    if (!ds || !parentKey) return;
    if (failedRef.current.parentKey !== parentKey) failedRef.current = { parentKey, keys: new Set() };
    const missing = resolved.filter((t) => cachedOf(t) === undefined && !outRef.current.has(storeKeyOf(t)) && !failed(t));
    if (missing.length === 0) {
      // Nothing left to ask (every count cached — a prefetch, a badge — or
      // answered): the parent's first set is settled once nothing is out.
      if (!resolved.some((t) => outRef.current.has(storeKeyOf(t)))) setSettledParent(parentKey);
      return;
    }
    for (const t of missing) outRef.current.add(storeKeyOf(t));
    void countTargets(missing, { parentId: parentKey, dataSource: ds, fieldsOf: fieldsOfRef.current }, true).then(() => {
      const seen = new Map<string, number>();
      for (const t of missing) {
        const k = storeKeyOf(t);
        outRef.current.delete(k);
        const n = cachedOf(t);
        if (n === undefined) failedRef.current.keys.add(k);
        else seen.set(k, n);
      }
      // A drawer that stepped on while this set was out keeps its new
      // parent's state; this parent's numbers stay in the store.
      if (liveParentRef.current !== parentKey) return;
      if (seen.size > 0) {
        setLastKnown((prev) => {
          const next = new Map(prev);
          for (const [k, n] of seen) next.set(k, n);
          return next;
        });
      }
      setSettledParent(parentKey);
    });
    // `targetsKey` is the content of `resolved` (AGENTS.md #10: never a memo's
    // identity); `storeVersion` re-runs the effect after an invalidation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, parentKey, targetsKey, storeVersion]);

  const stateOf = (id: RelatedCardId): RelatedCountState => {
    const target = resolved.find((t) => t.id === id);
    if (!target || !ds || !parentKey) return UNCOUNTED;
    // A parent's first set draws together: no card leaves its skeleton until
    // every card of the set has answered (or was already in the store).
    if (settledParent !== parentKey && resolved.some((t) => countOf(t) === undefined && !failed(t))) return PENDING;
    const count = countOf(target);
    if (count !== undefined) return { kind: 'counted', count };
    return failed(target) ? UNCOUNTED : PENDING;
  };

  return { stateOf };
}
