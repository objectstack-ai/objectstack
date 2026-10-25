/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one order rule for navigation entries (objectui#11395).
 *
 * ⛔ INTERNAL: `index.ts` does not re-export this module, and it must not. The
 * package's `exports` map has only `"."`, so a module the barrel does not name
 * is not part of the published API. Re-exporting it, or re-exporting
 * `byNavOrder` through `NavigationRenderer.tsx` (which the barrel re-exports
 * whole), would widen the published entry point.
 *
 * @module navOrder
 */

import type { NavigationItem } from '@object-ui/types';

/**
 * Compare two navigation entries of the same level by `order` — the spec's
 * "Sort order within the same level (lower = first)".
 *
 * The three sites that order a level import this one comparator, so the
 * sidebar and the mobile tab bar cannot disagree about which entry comes first:
 * `NavigationRenderer`'s top level, each group's children in
 * `NavigationItemRenderer`, and the tab bar's flattening in
 * `AppSchemaRenderer`, which sorts each level before it flattens. ⛔ Do not
 * write the sort out again at a fourth site; import this.
 *
 * An entry with no `order` sorts as `0`, and entries that compare equal keep
 * their authored order (`Array.prototype.sort` is stable). Both are the
 * sidebar's behaviour from before this comparator was extracted, kept as they
 * were.
 */
export function byNavOrder(a: NavigationItem, b: NavigationItem): number {
  return (a.order ?? 0) - (b.order ?? 0);
}
