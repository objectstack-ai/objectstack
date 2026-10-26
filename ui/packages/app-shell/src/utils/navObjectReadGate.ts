/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The console's default read gate on what an object opens (objectui#12109):
 * a navigation entry bound to an object, and a list action bound to it, are not
 * drawn for a caller who may not read that object. Before this, both were drawn
 * and each ended on the list's "You don't have access".
 *
 * ## The verdict, and where it comes from
 *
 * {@link mayReadObject}: `can(objectName, 'read')` from `usePermissions()`, the
 * permissions the console already holds (`MePermissionsProvider`, one
 * `/auth/me/permissions` read for the whole shell). Nothing here makes a
 * request. It is the answer the sidebar's permission checker already gives an
 * AUTHORED `requiredPermissions: ['OBJECT:read']`, applied by default; an
 * authored `requiredPermissions` still applies on top, in `@object-ui/layout`'s
 * item guard.
 *
 * An unknown answer is not a refusal. With no permission provider mounted,
 * `can` answers `true`. `MePermissionsProvider` renders its `loadingFallback`,
 * not its children, until it holds an answer, and while it refetches it answers
 * from the map it holds, exactly as it does for an authored
 * `requiredPermissions`. So an entry neither flashes in nor flashes out.
 *
 * ## Which navigation entries are "bound to an object"
 *
 * `type: 'object'` only: the one navigation item whose spec shape names an
 * object in a declared key (`objectName`). A `dashboard`, `report`, `page`,
 * `component` or `action` entry names its own kind of target; which objects
 * that target reads is the target's own question, and no object is guessed
 * from a route string. An object entry's `children` go with it, as a gated
 * node's subtree does in the layout's item guard.
 *
 * ## Why the host prunes, and the layout does not ask
 *
 * The server leaves object visibility to the client by design (objectstack's
 * `filterAppForUserWithReason` docblock). `@object-ui/layout` holds no
 * permissions: it asks its host through callbacks, and none of them asks
 * whether the MEMBER may read an object (`CapabilityChecker` asks whether the
 * RUNTIME has one). So the host hands the layout an already-pruned tree, and
 * every path through the layout reads the same tree: the drawn rows, the
 * derived area election and the Favorites collection. `UnifiedSidebar` and the
 * `nav:menu` block prune through {@link withoutUnreadableObjectEntries}, so the
 * two menus agree.
 *
 * Internal module: not re-exported by the package entry.
 */

import type { NavigationItem } from '@object-ui/types';

/** `usePermissions().can`, narrowed to the one action this gate asks about. */
export type ObjectReadCheck = (object: string, action: 'read') => boolean;

/** The one read verdict an object-bound entry or list action is drawn on. */
export function mayReadObject(can: ObjectReadCheck, objectName: string): boolean {
  return can(objectName, 'read');
}

/**
 * `items` without the `type: 'object'` entries whose object the caller may not
 * read, at every depth. Every other entry is kept as it is.
 *
 * Returns `items` itself when nothing is dropped, and a parent whose children
 * are untouched keeps its identity, so a caller who may read everything hands
 * the layout the very tree it was given.
 */
export function withoutUnreadableObjectEntries(
  items: NavigationItem[],
  can: ObjectReadCheck,
): NavigationItem[] {
  let changed = false;
  const kept: NavigationItem[] = [];
  for (const item of items) {
    if (
      item?.type === 'object'
      && typeof item.objectName === 'string'
      && item.objectName !== ''
      && !mayReadObject(can, item.objectName)
    ) {
      changed = true;
      continue;
    }
    const children = item?.type === 'separator' ? undefined : item?.children;
    if (Array.isArray(children) && children.length > 0) {
      const keptChildren = withoutUnreadableObjectEntries(children, can);
      if (keptChildren !== children) {
        changed = true;
        kept.push({ ...item, children: keptChildren } as NavigationItem);
        continue;
      }
    }
    kept.push(item);
  }
  return changed ? kept : items;
}
