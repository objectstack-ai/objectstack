/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Extract the rows array out of a `DataSource.find()` answer.
 *
 * Accepted shapes, in the order they are tried:
 *
 *   1. a bare array — the live non-envelope shape fakes and `ValueDataSource`
 *      answer with;
 *   2. `{ data: [] }` — the ONE rows member `QueryResult` (`@object-ui/types`)
 *      declares;
 *   3. `{ value: [] }` — the OData spelling, still LIVE at this seam (see
 *      below).
 *
 * ## `records` is NOT read here (objectui#6839, following #5945 / #6726)
 *
 * A `records` arm used to sit AHEAD of `data` — the precedence inversion
 * objectui#5945 was filed about and objectui#6726 repaired by hand in seven
 * modules. `records` is the below-the-adapter spelling: both
 * `ObjectStackAdapter.normalizeQueryResult` (`@object-ui/data-objectstack`)
 * and `ApiDataSource.normalizeQueryResult` (its `['data','items','results',
 * 'records','value']` envelope loop) CONSUME the server/SDK `records` envelope
 * and return `data` before the answer ever reaches this helper. Every consumer
 * below calls it strictly ABOVE that fold, so the arm was unreachable — and an
 * unreachable tolerant arm is exactly where a non-conforming producer keeps
 * working unrejected (AGENTS.md #0.1). Worse, being FIRST, it outranked the
 * contract's own member: a producer emitting both would have had `data`
 * ignored.
 *
 * Measured on this tree, per consumer rather than once for all of them, since
 * this helper is reached from ten call sites in nine packages:
 *
 *   packages/plugin-charts/src/ObjectChart.tsx        (x2: rows, ref labels)
 *   packages/plugin-dashboard/src/ObjectDataTable.tsx
 *   packages/plugin-dashboard/src/ObjectPivotTable.tsx
 *   packages/plugin-gantt/src/ObjectGantt.tsx         (ref option labels)
 *   packages/plugin-kanban/src/ObjectKanban.tsx
 *   packages/plugin-timeline/src/ObjectTimeline.tsx
 *   packages/core/src/utils/non-grid-row-ceiling.ts   (applyNonGridRowCeiling,
 *     itself the seam for ObjectCalendar, ObjectGantt, ObjectMap, ObjectTree;
 *     measured when it lived in `@object-ui/react`, moved here unchanged by
 *     objectui#7508)
 *
 * ZERO of them can be reached by a `records` envelope: no `find()` in any of
 * those packages, nor in the apps and examples that mount them, emits one.
 * CONTROL, so the zero is a reading rather than a miss — the same sweep DOES
 * find `records` envelopes elsewhere: `ViewDataProvider`'s own `ResolvedData`
 * (a different contract, served by that module's own private reader), the raw
 * Cloud HTTP payloads, the client-SDK doubles below `normalizeQueryResult`,
 * the record-visibility batch route stubs, and one live `find()` double at
 * `plugin-list`'s ObjectGallery — a consumer with its OWN unwrap ladder, which
 * does not come through here.
 *
 * ⛔ Do not restore the arm, and ⛔ do not widen `QueryResult` to bless
 * `records` instead — that is a published-type change and the maintainer's
 * call, the same floor objectui#6726 and #6840 respected. A producer that
 * really does speak `records` belongs behind an adapter that folds it into
 * `data`, which is what both adapters above already do.
 *
 * ## `value` STAYS — it is live here, and that is seam-local
 *
 * objectui#6840 / PR #6916 deleted the `value` arm from `ObjectView`'s ladder
 * on a measured zero at THAT seam, and said in as many words that its zero
 * must not be carried here. It does not: five `find()` doubles emit
 * `{ value: [...] }` into this helper today (three in `plugin-kanban`, two in
 * `plugin-calendar`). Deleting it here would break them. Whether `value`
 * should survive at this seam is its own card with its own measurement.
 *
 * Pinned per module by the `*.contractEnvelope-6839.*` suites.
 */
export function extractRecords(results: unknown): any[] {
  if (Array.isArray(results)) {
    return results;
  }
  if (results && typeof results === 'object') {
    if (Array.isArray((results as any).data)) {
      return (results as any).data;
    }
    if (Array.isArray((results as any).value)) {
      return (results as any).value;
    }
  }
  return [];
}
