/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { extractRecords } from './extract-records.js';

/**
 * The platform's hard row ceiling for a NON-GRID visualisation — calendar,
 * map and tree (objectui#7210, maintainer ruling a′, 2026-09-02). The gantt
 * applies {@link GANTT_ROW_CEILING} instead, through the same mechanism.
 *
 * ## Why this lives in `@object-ui/core` (objectui#7508, ruling A′)
 *
 * The four views live in four packages, so whatever they share is public by
 * construction: every package here has a single entry and no subpath export.
 * The non-React half of the mechanism — this constant, the query it sends and
 * {@link applyNonGridRowCeiling} — wraps this package's own
 * `extractRecords`, and every one of the four already imports core helpers,
 * so this is its home. `@object-ui/react` re-exports the three names it
 * carried before, and keeps only the React half (`NonGridRowCeilingNote`).
 *
 * ## What was ruled, and what was rejected
 *
 * A non-grid visualisation may fetch the whole FILTERED result set, because a
 * truthful range or layout needs all of it: a gantt cannot compute
 * `min(start) → max(end)` from one page, and a map cannot fit a camera to
 * markers it never received. What it may not do is fetch it UNBOUNDED — at
 * 100k scheduled rows that is the whole table into the browser, with no knob
 * reachable from view metadata, since these four requests never carried a
 * `$top` for `pagination.pageSize` to set.
 *
 * So the fetch carries a ceiling, and the ceiling is a NAMED CONSTANT IN THE
 * RENDERER — not an authorable view key. Three alternatives were considered
 * and are not what landed:
 *
 *   - a documentation note only — still the whole table into the browser;
 *   - truncate at `pagination.pageSize` — SILENT truncation, and it caps a
 *     complete schedule at one page;
 *   - an authorable `maxRows` key — a new permanent key every author must set.
 *
 * ⛔ The direction the ruling names as dangerous is SILENT truncation: a
 * cut-off schedule still looks like a schedule, a cut-off map still looks like
 * a map. Nothing on screen distinguishes "these are all the records" from
 * "these are the first 2,000 of 40,000" unless the view says so. That is why
 * `NonGridRowCeilingNote` (`@object-ui/react`) is not decoration — crossing
 * this ceiling quietly is the defect, and the note is the fix.
 *
 * ## Why 2,000, measured
 *
 * The ruling sets ONE constant across the four views, chosen after measuring
 * them, so the binding view decides it. (The gantt has since left it for
 * {@link GANTT_ROW_CEILING}; calendar, map and tree still share this one.) Measured in this repo's jsdom lane
 * (`@testing-library/react`, real child views, inline `value` provider, mount
 * to settled paint), DOM elements materialised and mount duration:
 *
 * | rows  | gantt      | calendar  | map            | tree            |
 * |------:|-----------:|----------:|---------------:|----------------:|
 * |   250 |  726 · 314ms |  415 · 231ms |   478 · 152ms |   1,306 ·  326ms |
 * | 1,000 |  726 · 226ms |  415 · 235ms | 1,512 · 299ms |   5,206 · 1,025ms |
 * | 2,000 |  726 · 484ms |  415 · 237ms | 2,770 · 1,250ms | 10,406 · 2,720ms |
 * | 4,000 |  726 · 420ms |  415 · 211ms | 3,020 · 648ms |  20,806 · 3,105ms |
 * | 8,000 |         —    |        —    |          —    |  41,606 · 7,597ms |
 *
 * Three of the four hold their DOM flat as rows grow, and for structural
 * reasons that will not change: the gantt VIRTUALISES its task list and
 * timeline window, the calendar month grid draws at most four events per day
 * cell, and the map auto-clusters above 100 markers. Their cost in rows is the
 * O(n) transform, not the DOM.
 *
 * `ObjectTree` is the outlier and therefore the constraint: it flattens every
 * expanded node into the document, measured at a strictly linear **5.2 DOM
 * elements per record**, with no virtualisation anywhere on that path.
 *
 * The budget applied to that: keep the WORST of the four inside ~10,000 DOM
 * elements — an order of magnitude above Lighthouse's ~1,400-element
 * "excessive DOM size" warning, and the last point at which the tree's mount
 * stays under ~3s in an environment that does no layout and no paint at all.
 * 2,000 rows is where that lands, measured rather than interpolated: 10,406
 * elements. It is also ~10x the real application result set this card was
 * filed from (186 rows of `duly_task`), so a genuine working view is nowhere
 * near it, which is the property that keeps the note meaningful when it does
 * appear.
 *
 * ⚠️ These are SHARED-BOX jsdom seconds, not browser wall clock, and jsdom
 * does no layout or paint. The DOM-element counts are the environment-
 * independent half and the reason the ratio between the four views is the
 * load-bearing part of the reading, not the milliseconds. This table is a
 * reading taken once, when objectui#7210 landed; nothing re-derives it.
 */
export const NON_GRID_ROW_CEILING = 2000;

/**
 * The gantt's OWN row ceiling (objectstack#32421, maintainer ruling B): the
 * one view of the four that leaves {@link NON_GRID_ROW_CEILING}.
 *
 * The shared 2,000 is priced by the binding view, `ObjectTree`, and the table
 * above shows the gantt paying the tree's limit without the tree's cost: it
 * virtualises its task list and its timeline window, so its DOM is flat in
 * rows. Everything else about ruling a′ holds unchanged for it: a NAMED
 * CONSTANT IN THE RENDERER, ⛔ not an authorable key (`pagination.pageSize`
 * and `limit` stay unread), ⛔ not read from a datasource's `external.rowCap`,
 * and above it the same probe row and the same `NonGridRowCeilingNote`.
 *
 * ## Why 10,000, measured
 *
 * The target is the platform maximum of a datasource's `external.rowCap`
 * (`EXTERNAL_ROW_CAP_CEILING` in `@objectstack/spec`), so a gantt over a
 * capped external object never draws fewer rows than the server will serve.
 * The value is a literal, not an import of that constant: raising the spec's
 * cap must not raise this one unmeasured.
 *
 * Measured the same way as the table above (this repo's DOM test lane,
 * `@testing-library/react`, `ObjectGantt` over the real `GanttView`, mount to
 * settled paint), the gantt alone, on one box in one sitting. "adapter" is
 * the same mount through a `find()` that parses the rows from a JSON wire
 * string, the fetch's deserialisation half; "Chromium" is headless Chromium
 * on the Console's Vite dev server, mount to the first frame after the rows
 * reach the DOM:
 *
 * | rows   | DOM lane, inline | DOM lane, adapter          | Chromium      |
 * |-------:|-----------------:|---------------------------:|--------------:|
 * |  2,000 |    726 · 137ms   | 732 · 111ms (0.2 MB, 3ms)  | 623 · 396ms   |
 * |  4,000 |    726 · 146ms   | 732 · 132ms (0.4 MB, 4ms)  | 623 · 466ms   |
 * | 10,000 |    726 · 197ms   | 732 · 235ms (1.0 MB, 20ms) | 623 · 436ms   |
 *
 * The DOM stays flat (the task list and the timeline both window), and the
 * cost in rows is the O(n) transform: 10,000 gantt rows mount in a tenth of
 * the time 2,000 tree rows take in the table above. Ruling a′'s budget
 * applied to the gantt — DOM elements far inside ~10,000, mount inside the
 * ~3s the tree is held to — holds at 10,000 with room, so the target is the
 * value. Past it (10,500 rows) the probe row cuts at 10,000 and
 * `NonGridRowCeilingNote` shows, as below the shared ceiling.
 *
 * ⚠️ As with the table above: SHARED-BOX seconds and a reading taken once,
 * when objectstack#32421 landed; nothing re-derives it. The DOM counts are
 * the environment-independent half.
 */
export const GANTT_ROW_CEILING = 10000;

/**
 * The ceilings a non-grid view may apply — the closed set of named renderer
 * constants above, never an arbitrary number. A literal-typed union rather
 * than `number`, so a view-metadata value (`pagination.pageSize`, `limit`)
 * cannot be handed to {@link nonGridRowCeilingQuery} or
 * {@link applyNonGridRowCeiling} without a cast the reviewer sees: the
 * ceiling is not authorable (ruling a′).
 */
export type NonGridRowCeiling = typeof NON_GRID_ROW_CEILING | typeof GANTT_ROW_CEILING;

/**
 * The query keys a non-grid view sends to honour {@link NON_GRID_ROW_CEILING}:
 * `$top` is the ceiling plus ONE probe row.
 *
 * This is the ONE place the `+ 1` is written (objectui#7508, ruling A′). It
 * used to be a published constant beside the ceiling, which left the
 * mechanism split in two — `$top` at each call site, the slice in
 * {@link applyNonGridRowCeiling} — and gave every caller a number to get
 * wrong. A caller now spreads this into its `find()` query and never spells
 * the probe row itself.
 *
 * The `+ 1` is what makes truncation DETECTABLE, and a site that lost it would
 * look correct and report nothing: with exactly `$top: NON_GRID_ROW_CEILING`,
 * a result set of exactly 2,000 and one of 200,000 both come back as 2,000
 * rows, and the only thing separating them is a `total` the adapter is not
 * obliged to send (`QueryResult.total` is optional, and an adapter answering
 * with a bare array carries none at all). One extra row makes the distinction
 * a fact about the rows in hand.
 *
 * A fresh object per call, so a caller that mutates the query it built cannot
 * change what the next caller sends.
 *
 * `ceiling` defaults to the shared {@link NON_GRID_ROW_CEILING}; only the
 * gantt passes {@link GANTT_ROW_CEILING}. A caller passes the SAME ceiling to
 * {@link applyNonGridRowCeiling}, or the probe row is sliced at the wrong
 * place.
 */
export function nonGridRowCeilingQuery(
  ceiling: NonGridRowCeiling = NON_GRID_ROW_CEILING,
): { $top: number } {
  return { $top: ceiling + 1 };
}

/** What {@link applyNonGridRowCeiling} tells a caller about its result set. */
export interface NonGridCeilingResult<T = any> {
  /** The rows to draw — never more than the ceiling the caller applied. */
  rows: T[];
  /**
   * The size of the whole filtered result set when the adapter reported one
   * (`QueryResult.total`), otherwise `undefined`. `undefined` is NOT "not
   * truncated" — see {@link NonGridCeilingResult.truncated}, which is decided
   * by the rows in hand and never by this.
   */
  total?: number;
  /** `true` when the source had more rows than the ceiling allows drawn. */
  truncated: boolean;
}

/**
 * Cap a non-grid view's result set at `ceiling` ({@link NON_GRID_ROW_CEILING}
 * unless the caller is the gantt) and report whether it had to.
 *
 * Truncation is decided by the PROBE ROW (`rows.length > ceiling`
 * against a query built by {@link nonGridRowCeilingQuery}), never by comparing
 * against `total`: `total` is optional on `QueryResult` and absent entirely
 * from a bare-array response, so a `total`-based test would silently stop
 * reporting on exactly the adapters least likely to be paging correctly.
 *
 * The rows are read by `extractRecords`, so this sink accepts exactly the
 * envelopes that helper does (objectui#6839) — pinned in
 * `non-grid-row-ceiling.contractEnvelope-6839.test.ts`.
 */
export function applyNonGridRowCeiling<T = any>(
  result: unknown,
  ceiling: NonGridRowCeiling = NON_GRID_ROW_CEILING,
): NonGridCeilingResult<T> {
  const all = extractRecords(result) as T[];
  const rawTotal =
    result && typeof result === 'object' && typeof (result as any).total === 'number'
      ? ((result as any).total as number)
      : undefined;
  const truncated = all.length > ceiling;
  return {
    rows: truncated ? all.slice(0, ceiling) : all,
    total: rawTotal,
    truncated,
  };
}
