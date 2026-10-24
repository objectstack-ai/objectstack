/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Dashboard widget layout completion (objectui#11388)
 *
 * A dashboard widget's `layout` is the spec's four-number box: `x`, `y`, `w`
 * and `h` are each required once the box is present, and the spec refuses one
 * that carries fewer. The box itself is optional — a widget with no `layout` is
 * auto-placed by the grid.
 *
 * The width / height editors (the Studio widget inspector in
 * `@object-ui/app-shell`, `DashboardWithConfig` in `@object-ui/plugin-dashboard`
 * and `DashboardEditor` in `@object-ui/plugin-designer`) each edit ONE
 * dimension. On a widget with no `layout` they used to spread that one number
 * onto an absent box and cast the result past {@link DashboardWidgetLayout},
 * storing `{ w }` or `{ h }`, which the spec refuses at `layout.x`, `layout.y`
 * and the other dimension. They now all call {@link completeWidgetLayout}, so
 * each writes the whole box and the compiler judges it with no cast.
 *
 * Deliberately zod-free and React-free, like the other runtime helpers on this
 * package's main entry: all three editors already import from
 * `@object-ui/types`, so one copy here serves them with no new dependency.
 *
 * @module dashboard-widget-layout
 * @packageDocumentation
 */

import type { DashboardWidgetLayout } from './complex.js';

/**
 * The box the dashboard grid auto-places the widget at position `index` of
 * `widgets[]` in, when that widget has no `layout`.
 *
 * This is the fallback `@objectstack/spec` states in the doc comment of its
 * widget `layout` member ("DashboardGridLayout falls back to `x: (i % 4) * 3,
 * y: Math.floor(i/4) * 4, w: 3, h: 4`"): four quarter-width widgets per row of
 * a 12-column grid, four rows tall. `DashboardGridLayout` in
 * `@object-ui/plugin-dashboard` places a layout-less widget through this
 * function, so the grid and the editors that seed from it cannot disagree.
 */
export function defaultWidgetPlacement(index: number): DashboardWidgetLayout {
  return {
    x: (index % 4) * 3,
    y: Math.floor(index / 4) * 4,
    w: 3,
    h: 4,
  };
}

/**
 * A widget's complete `layout` after `patch` is applied: each of `x`, `y`, `w`
 * and `h` comes from `patch`, else from the widget's stored `layout`, else
 * from `placement`.
 *
 * `placement` is the box the grid currently shows the widget in. A writer that
 * can see the grid's placement passes it; one that cannot passes
 * {@link defaultWidgetPlacement} for the widget's index, which is where the grid
 * auto-places a widget with no `layout`.
 *
 * - A widget with a `layout` keeps every coordinate the patch does not name, so
 *   editing its width keeps its `x`, `y` and `h`.
 * - A widget with no `layout` gets its untouched coordinates from `placement`,
 *   so editing its width stores four numbers the spec parses rather than `{ w }`.
 *
 * `layout` is read per coordinate, so a box that is missing a coordinate is
 * completed rather than spread back as it was.
 */
export function completeWidgetLayout(
  layout: Partial<DashboardWidgetLayout> | undefined,
  patch: Partial<DashboardWidgetLayout>,
  placement: DashboardWidgetLayout,
): DashboardWidgetLayout {
  return {
    x: patch.x ?? layout?.x ?? placement.x,
    y: patch.y ?? layout?.y ?? placement.y,
    w: patch.w ?? layout?.w ?? placement.w,
    h: patch.h ?? layout?.h ?? placement.h,
  };
}
