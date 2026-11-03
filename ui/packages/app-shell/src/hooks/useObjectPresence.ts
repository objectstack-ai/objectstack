/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "Does this deployment HAVE that object?", answered from the metadata registry
 * the shell already loads — so a surface that reads an OPTIONAL system object
 * can decline to ask rather than asking and being told no.
 *
 * ## Why (objectui#7476)
 *
 * A tenant environment has no `sys_activity` (no plugin-audit), so the home
 * page's activity card and the bell's Activity tab issued
 * `GET /api/v1/data/sys_activity` on every page load and got a 404. Everything
 * DOWNSTREAM of that 404 is already correct and stays correct: the adapter
 * memoizes the missing collection so no second request goes out, its quiet
 * logger demotes the failure to `debug`, `sharedUserFeeds` retires the feed as
 * an ANSWER (`ready`, not `error`), and the panel renders its earned
 * 「暂无最近动态」 empty state. What was left is one doomed request per load —
 * and `data-objectstack`'s own rule for exactly this case says how to read
 * that: *"The cure for doomed requests is not issuing them, never hiding them
 * once issued."*
 *
 * ## The predicate, and why every uncertainty reads as `unknown`
 *
 * The cost of a wrong `absent` is not one extra request, it is a feed that
 * never loads on a deployment that DOES have the object — so absence has to be
 * evidence, never the default:
 *
 *  - the registry has not answered (`idle` / `loading` / `error`) → `unknown`;
 *  - the registry is `ready` but lists ZERO objects → `unknown`. This is the
 *    load-bearing clause. `useMetadata()` outside a `<MetadataProvider>`
 *    returns a frozen no-op whose `getTypeStatus` answers `'ready'` and whose
 *    `getItemsByType` answers `[]` — a shape that reads as "ready, and the
 *    object is not there" while meaning "nobody is answering". An empty
 *    registry is not evidence of anything;
 *  - `ready`, non-empty, and the name is in it → `present`;
 *  - `ready`, non-empty, and the name is not → `absent`. Only here.
 *
 * `sys_*` objects ARE in this list where they exist — `AppHeader` filters them
 * out of the app-object picker by name (`!o.name.startsWith('sys_')`), which
 * it would not need to do if they were absent, and the console resolves
 * `/apps/{any app}/sys_activity` as an ordinary object route (objectui#4074).
 *
 * ## Cost
 *
 * None: `getItemsByType('object')` reads the same cache the nav, the object
 * views and `AppHeader` already populate, and kicks the fetch itself when the
 * type is still `idle` (`MetadataProvider`'s `readType`). No consumer of this
 * hook adds a request; the point is to remove one.
 */
import { useCallback, useRef, useState } from 'react';
import { useMetadata, type MetadataContextValue, type MetadataTypeStatus } from '@object-ui/react';
import { useExpressionContext } from '../providers/ExpressionProvider.js';
import { preferLocal } from '../utils/preferLocal.js';

type ReadObjectScope = NonNullable<MetadataContextValue['readObjectScope']>;

/**
 * `readObjectScope` with the provider's package-local `views: false` hand-off
 * (`MetadataProvider`): a reader that asks which objects there are, or what one
 * is called, composes no views, so it never reads the `/meta/view` list.
 */
export type ReadNamesWithoutViews = (scope: Parameters<ReadObjectScope>[0] & { views: false }) => ReturnType<ReadObjectScope>;

const NO_OBJECTS: readonly unknown[] = Object.freeze([]);

/**
 * The definitions of `names`, without the whole object registry
 * (objectstack#29121): while nothing has asked for the whole list, each name is
 * asked by name through the names-only scope (objectui#12980), and the answer
 * is the names that have landed so far; once the whole list is loaded, or on
 * its way, it is that list, and nothing more is asked. A provider without
 * scope reads (a hand-rolled context) answers with its `objects`, as before.
 *
 * The definitions come without views, unless `views: true`: a reader of a
 * list view's label needs the object's `listViews`, so its object is composed
 * with its views (outside an app that reads the `/meta/view` list, never the
 * object registry).
 *
 * Asking for no name asks for nothing: a names-only scope with no names would
 * be the whole registry.
 */
export function readObjectsByName(
  metadata: Pick<MetadataContextValue, 'objects' | 'readObjectScope' | 'getTypeStatus'>,
  names: readonly string[],
  options: { views?: boolean } = {},
): readonly unknown[] {
  const { readObjectScope, getTypeStatus } = metadata;
  if (readObjectScope && getTypeStatus?.('object') === 'idle') {
    const asked = names.filter((name) => typeof name === 'string' && name !== '');
    if (asked.length === 0) return NO_OBJECTS;
    if (options.views) return readObjectScope({ names: asked }).objects;
    return (readObjectScope as ReadNamesWithoutViews)({ names: asked, views: false }).objects;
  }
  return metadata.objects ?? NO_OBJECTS;
}

/**
 * {@link readObjectsByName} for a type the cache keeps no names-only scope for
 * (a dashboard, a page, a report): `read(type, names, list)`.
 */
export type ReadItemsByName = (
  type: string,
  names: readonly string[],
  list: () => readonly unknown[] | undefined,
  /** Called with each asked name whose by-name read has not answered yet (objectstack#29416). */
  pending?: (name: string) => void,
) => readonly unknown[];

const NO_ANSWERS: ReadonlyMap<string, unknown> = new Map();

/**
 * The definitions of `names` of one metadata type, without that type's whole
 * list (objectstack#29235): what {@link readObjectsByName} is to objects, for
 * a reader that labels a few rows (a recent dashboard, page or report). While
 * nothing has asked for the type's list, each name is asked once through the
 * provider's by-name read (`getItem`, which the app bundle answers for an item
 * it holds), and the answer is the names that have landed so far; the reader
 * re-renders as each lands. Once the list is loaded, or on its way, it is
 * `list()`, and nothing more is asked. A provider without a status or a
 * by-name read (a hand-rolled context) answers with `list()`, as before.
 *
 * A name that answered an item is asked again once the provider's metadata
 * changes (a refresh, an invalidation): the provider's by-name cache answers it
 * at once, without a request, unless that change dropped it, so a renamed item
 * shows its new label. A name that answered none (absent, or a failed read) is
 * not asked again while the reader is mounted.
 *
 * Asking for no name asks for nothing.
 */
export function useReadItemsByName(
  metadata: Pick<MetadataContextValue, 'getItem' | 'getTypeStatus'>,
): ReadItemsByName {
  const { getItem, getTypeStatus } = metadata;
  const [answers, setAnswers] = useState(NO_ANSWERS);
  // What this reader asked of which provider value: a new value (its
  // `getTypeStatus` is rebuilt with it) starts a new set.
  const askedRef = useRef<{ of: unknown; keys: Set<string> }>({ of: undefined, keys: new Set() });
  return useCallback<ReadItemsByName>(
    (type, names, list, pending) => {
      if (typeof getItem !== 'function' || getTypeStatus?.(type) !== 'idle') return list() ?? NO_OBJECTS;
      if (askedRef.current.of !== getTypeStatus) askedRef.current = { of: getTypeStatus, keys: new Set() };
      const asked = askedRef.current.keys;
      const found: unknown[] = [];
      for (const name of names) {
        if (typeof name !== 'string' || name === '') continue;
        const key = `${type}/${name}`;
        if (!asked.has(key) && answers.get(key) !== null) {
          asked.add(key);
          const settle = (item: unknown) =>
            setAnswers((prev) => (prev.has(key) && prev.get(key) === item ? prev : new Map(prev).set(key, item)));
          void getItem(type, name).then((item) => settle(item ?? null), () => settle(null));
        }
        const item = answers.get(key);
        if (item) found.push(item);
        else if (!answers.has(key)) pending?.(name);
      }
      return found;
    },
    [getItem, getTypeStatus, answers],
  );
}

/** One item a route resolves by name, and whether its read has settled. */
export interface ItemByNameRead {
  item: any;
  settled: boolean;
}

/**
 * The `type` item named `name` as the prefer-local pick over the type's list
 * resolves it (`preferLocal`, ADR-0048), without reading that list while the
 * by-name read can answer it (objectstack#29416): a route that names one item
 * (a page the app bundle does not hold) asked the whole `/meta/<type>` list.
 *
 * The by-name read (`GET /meta/<type>/<name>`) takes no package and answers
 * the first match (ADR-0048 §3.3), so its answer is the pick only when it
 * cannot differ from it: in an app with no package (`ownerPackageId` unset,
 * where the pick is the first match too), or when it is the app's own
 * package's item, which the pick prefers. Otherwise, another package's item
 * while the app's own may exist, or no item at all (absent, or a failed read),
 * the list is read and picked from, as before. Once the list is loaded, or on
 * its way, the pick reads it and nothing is asked by name.
 */
export function readItemPreferLocal(
  readItemsByName: ReadItemsByName,
  type: string,
  name: string,
  ownerPackageId: unknown,
  list: () => readonly unknown[] | undefined,
  status: MetadataTypeStatus | undefined,
): ItemByNameRead {
  const fromList = (): ItemByNameRead => {
    const listed = list();
    const now = status === 'idle' ? 'loading' : status;
    return { item: preferLocal(listed as any[] | undefined, name, ownerPackageId), settled: metadataTypeSettled(now) };
  };
  if (status !== 'idle') return fromList();
  let waiting = false;
  const [answer] = readItemsByName(type, [name], () => undefined, () => {
    waiting = true;
  }) as Array<{ _packageId?: unknown } | undefined>;
  if (waiting) return { item: undefined, settled: false };
  if (answer && (!ownerPackageId || answer._packageId === ownerPackageId)) return { item: answer, settled: true };
  return fromList();
}

/** What the metadata registry can say about one object name. */
export type ObjectPresence = 'present' | 'absent' | 'unknown';

/** A presence reading plus whether it is worth waiting for a better one. */
export interface ObjectPresenceReading {
  presence: ObjectPresence;
  /**
   * The registry has said its piece — `ready`, or `error` (which will not
   * improve by waiting), or there is no provider to wait on. A caller that
   * gates a read on presence should hold off until this is true, then act on
   * `presence`: `absent` skips the read, anything else performs it.
   */
  settled: boolean;
}

/** @see ObjectPresenceReading.settled */
export function metadataTypeSettled(status: MetadataTypeStatus | undefined): boolean {
  // `undefined` is the documented "always ready" of a hand-rolled context value.
  return status === undefined || status === 'ready' || status === 'error';
}

/**
 * The pure predicate — exported so the decision can be pinned without a
 * provider tree. See the module comment for why absence must be earned.
 */
export function objectPresence(
  name: string,
  status: MetadataTypeStatus | undefined,
  objects: readonly unknown[],
): ObjectPresence {
  if (status !== undefined && status !== 'ready') return 'unknown';
  if (objects.length === 0) return 'unknown';
  const found = objects.some((o) => (o as { name?: unknown } | null | undefined)?.name === name);
  return found ? 'present' : 'absent';
}

/** {@link objectPresence} bound to the shell's metadata registry. */
export function useObjectPresence(name: string): ObjectPresenceReading {
  const { getItemsByType, getTypeStatus, readObjectScope } = useMetadata();
  // objectui#12811 — inside an app whose served item names its package, and
  // while nothing has asked for the whole registry, the object is asked for by
  // name through the app's object scope, rather than by loading every object.
  //
  // objectui#12980 — inside an app whose served item names NO package (an app
  // created in the console is stored bound to none), on the same condition,
  // the object is asked for by name through the names-only scope: the one
  // name this hook is asked about is the whole set it needs.
  //
  // objectstack#29121 — outside an app (no app name: the home page, whose
  // activity feeds ask about `sys_activity`) it is asked by name the same way.
  // It used to read the whole registry there, which the home page then loaded
  // on every visit for this one question.
  const { app } = useExpressionContext();
  const packageId = typeof app?._packageId === 'string' && app._packageId ? app._packageId : undefined;
  //
  // objectstack#28645 — it asks with `views: false` (the provider's hand-off,
  // `MetadataProvider`): whether an object is there reads no views, so this
  // question never reads the `/meta/view` list.
  if (readObjectScope && getTypeStatus?.('object') === 'idle') {
    const readNames = readObjectScope as ReadNamesWithoutViews;
    const scope = readNames(packageId ? { packageId, names: [name], views: false } : { names: [name], views: false });
    const presence: ObjectPresence = !scope.settled
      ? 'unknown'
      : scope.objects.some((o) => (o as { name?: unknown } | null | undefined)?.name === name)
        ? 'present'
        : 'absent';
    return { presence, settled: scope.settled };
  }
  // Reading the items is also what ENSURES the type is fetched (MetadataProvider
  // `readType`), so a surface that only ever asks this question still gets an
  // answer instead of waiting on somebody else to populate the cache.
  const objects = getItemsByType('object');
  const status = getTypeStatus?.('object');
  return { presence: objectPresence(name, status, objects), settled: metadataTypeSettled(status) };
}
