/**
 * ObjectUI — value-fallback label prettifier
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * humanize-label — the ONE home for the VALUE fallback: a stored value becomes
 * a display string when nothing else resolves it (objectui#5444).
 *
 * Two byte-identical copies preceded this module: `@object-ui/fields` (read by
 * `plugin-grid`, `plugin-gantt`, `plugin-detail`, and by the field renderers in
 * that package itself) and a deliberate local copy in `plugin-charts`'
 * `ObjectChart.tsx`, whose comment said it existed "to avoid a dependency on
 * `@object-ui/fields`". `@object-ui/core` is the shared ancestor both packages
 * already depend on, so the convention gets a single home without a new
 * dependency edge and without React reaching core — objectui#4389's ruling for
 * this family: core-canonical logic, plugins consume; never core importing
 * react. Both former sites now re-export THIS function, so there is one
 * implementation and two doorways.
 *
 * ## Why this is NOT `humanizeFieldKey`, and why the two are kept apart
 *
 * The renderer carries a second prettifier — `humanizeFieldKey` in
 * `@object-ui/plugin-dashboard`, the single home for the KEY fallback (a field
 * key becomes a column header). It is a DIFFERENT convention, not a stale copy
 * of this one: it additionally splits camelCase.
 *
 *   input                humanizeFieldKey     humanizeLabel (here)
 *   ──────────────────   ──────────────────   ──────────────────
 *   needs_analysis       Needs Analysis       Needs Analysis
 *   NeedsAnalysis        Needs Analysis       NeedsAnalysis        <- differ
 *   unitPrice            Unit Price           UnitPrice            <- differ
 *   BestCase             Best Case            BestCase             <- differ
 *   lost-to-competitor   Lost-To-Competitor   Lost To Competitor   <- differ
 *
 * They are fed different inputs, which is why their outputs may differ. A field
 * KEY is authored in the codebase and is expected to carry a machine spelling,
 * so splitting camelCase recovers words its author meant. A stored VALUE is
 * arbitrary tenant data — a picklist member, an object name, a code from
 * another system — where a mid-token capital is not reliably a word boundary,
 * and splitting it rewrites what the tenant wrote (`McDonald` -> `Mc Donald`).
 * Note also that the two conventions do not nest: on the last row above each
 * leaves alone the separator the other rewrites, so "converge" would have to
 * pick a winner per input class rather than adopt one side wholesale.
 *
 * Kept distinct DELIBERATELY, and this paragraph is the write-down whose
 * absence made the split read as drift. Converging them is a decision, not a
 * refactor: this function is read by grid, gantt, detail and charts, so any
 * change to what it RETURNS moves rendered output in four packages at once.
 * That change is explicitly out of scope for the convergence that created this
 * module; it needs its own card.
 *
 * Examples:
 *   "in_progress"   -> "In Progress"
 *   "high-priority" -> "High Priority"
 *   "active"        -> "Active"
 */
export function humanizeLabel(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
