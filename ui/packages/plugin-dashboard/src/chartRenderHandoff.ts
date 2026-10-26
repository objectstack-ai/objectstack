/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The shape a dashboard surface BUILDS its static-data `chart` node as — wider
 * than the shape an author may WRITE, on purpose (objectui#11598, N1).
 *
 * The seat ruled this on objectui#8347 (Q1 = B), reusing the maintainer's
 * objectui#6356 ruling (2026-09-27, Q1 = A), whose pattern and reasons live in
 * `plugin-timeline`'s `renderHandoff.ts`: keys that only host code writes, with
 * zero authored instances, are typed where their producer lives, and never in
 * `@object-ui/types`.
 *
 * `@object-ui/types` declares the authored `chart` node, `ChartSchema`, and
 * neither of its faces declares `colors` or `isAnimationActive`. Both dashboard
 * surfaces, `DashboardRenderer` and `DashboardGridLayout`, compose the two onto
 * the `chart` node they build for a series widget bound to inline rows: the
 * dashboard palette (`CHART_COLORS`), and `isAnimationActive: false` for a
 * deterministic first paint inside the grid (#2756). The chart renderer reads
 * both: `ChartRenderer` (`@object-ui/plugin-charts`) declares them on its own
 * props type and reads them with no cast. Nobody authors them on a `chart`
 * node: the census behind the ruling found them written by host code only.
 *
 * Each producer checks its literal against this type where it builds it, then
 * hands the node to `SchemaRenderer` with no cast: the type extends
 * `ChartSchema`, so the node is the declared `chart` node plus these two keys.
 * The `object-chart` node the same surfaces build needs none of this, because
 * `ObjectChartSchema` declares both keys itself.
 *
 * ⛔ Deliberately NOT exported from this package's index, and ⛔ never to be
 * added to `@object-ui/types`: the strict authoring face refuses both keys on
 * an authored `chart` node, and a public type naming them would invite the
 * spelling that face refuses. The renderer stays more lenient than validation
 * — it reads them off this hand-off — which is the house posture.
 */

import type { ChartSchema } from '@object-ui/types';

/** A `chart` node as a dashboard surface hands it to the chart renderer. */
export interface DashboardChartRenderSchema extends ChartSchema {
  /** The positional palette the dashboard paints the series with. */
  colors?: string[];
  /** `false` for a deterministic first paint with no entrance animation (#2756). */
  isAnimationActive?: boolean;
}
