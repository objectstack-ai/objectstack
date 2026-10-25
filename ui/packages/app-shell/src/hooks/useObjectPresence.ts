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
import { useMetadata, type MetadataTypeStatus } from '@object-ui/react';
import { useExpressionContext } from '../providers/ExpressionProvider.js';

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
  // name this hook is asked about is the whole set it needs. Outside an app
  // (no app name: the home page) it reads the whole registry, as before.
  const { app } = useExpressionContext();
  const packageId = typeof app?._packageId === 'string' && app._packageId ? app._packageId : undefined;
  const inApp = typeof app?.name === 'string' && app.name !== '';
  if ((packageId || inApp) && readObjectScope && getTypeStatus?.('object') === 'idle') {
    const scope = readObjectScope(packageId ? { packageId, names: [name] } : { names: [name] });
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
