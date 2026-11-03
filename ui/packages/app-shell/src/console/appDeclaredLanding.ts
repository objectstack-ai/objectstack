/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The app's declared per-audience landing, `@objectstack/spec`'s
 * `AppSchema.landing` (objectstack-ai/objectstack#28022, ruling record
 * 6545223246, letter A): `[{ item, visible }]`, asked in order, and the first
 * entry whose `visible` holds for the reader names the navigation entry the app
 * opens on.
 *
 * ## The scope a landing predicate is asked in
 *
 * The evaluator is the one the app's navigation `visible` is asked with: the
 * `evaluateVisibility` of `useNavMemberGates`, called with no navigation entry,
 * so the predicate sees exactly the roots `buildExpressionScope`
 * (`providers/ExpressionProvider.tsx`) binds for the shell, and nothing else.
 * A landing entry declares no `dataSource`, so no `data` is bound for it (the
 * spec refuses a `data` read at parse, `checkAppLandingItems`). A predicate
 * that names a root that scope does not bind faults in the engine, and so does
 * any other predicate the engine cannot answer.
 *
 * ## What a fault does
 *
 * A faulting predicate is passed over, and reported once, by the navigation
 * evaluator's own fault report (`evaluateNavigationVisibility`, which
 * withholds on a fault). The landing only decides where a reader opens, never
 * what they may reach: every navigation entry keeps its own gates.
 *
 * ## Which entries can be landed on
 *
 * The entry `item` names is looked up, by `id` and at any depth, in the trees
 * as this member is SHOWN them (the app's `navigation` first, then each of its
 * `areas[].navigation`): an entry the member's own navigation gates hide is
 * passed over, as the spec's `AppSchema.landing` docblock states. An entry
 * whose route the console cannot open inside the app (`routeOf` answers `''`)
 * is passed over too: the spec refuses such a target at parse (a `group`,
 * `separator`, `action` or `url` entry), so for a parsed app this pass-over is
 * defence only. A `doc` entry lands: it opens the in-app docs portal, and which
 * docs a reader may open is the server's audience gate (objectstack#19790).
 * When no entry lands, the caller keeps today's rule: the first navigation
 * entry by `order`.
 *
 * Internal module: not re-exported by the package entry.
 */

import type { NavigationItem } from '@object-ui/types';

/** The `visible` evaluator of `useNavMemberGates`, asked here with no entry. */
export type LandingVisibilityEvaluator = (expression: NavigationItem['visible']) => boolean;

/** One entry of `AppSchema.landing`, as the served app carries it. */
interface LandingEntry {
  item: string;
  visible: NavigationItem['visible'];
}

/** The first entry with `id` in `items`, at any depth through `children`. */
function findEntryById(items: readonly NavigationItem[], id: string): NavigationItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const children = (item as { children?: unknown }).children;
    if (Array.isArray(children)) {
      const found = findEntryById(children as NavigationItem[], id);
      if (found) return found;
    }
  }
  return undefined;
}

function isLandingEntry(value: unknown): value is LandingEntry {
  return !!value && typeof value === 'object' && typeof (value as { item?: unknown }).item === 'string';
}

/**
 * The route of the first declared landing entry that holds for this member,
 * or `''` when the app declares none, or none of its entries lands.
 *
 * `shownTrees` are the app's navigation trees as the member is shown them,
 * `navigation` first; `routeOf` is the in-app route of one entry, `''` when it
 * opens nothing inside the app.
 */
export function resolveDeclaredLandingRoute(
  landing: unknown,
  shownTrees: readonly (readonly NavigationItem[])[],
  evaluateVisibility: LandingVisibilityEvaluator,
  routeOf: (item: NavigationItem) => string,
): string {
  if (!Array.isArray(landing)) return '';
  for (const entry of landing) {
    if (!isLandingEntry(entry)) continue;
    if (!evaluateVisibility(entry.visible)) continue;
    for (const tree of shownTrees) {
      const target = findEntryById(tree, entry.item);
      if (!target) continue;
      const route = routeOf(target);
      if (route) return route;
      break;
    }
  }
  return '';
}
