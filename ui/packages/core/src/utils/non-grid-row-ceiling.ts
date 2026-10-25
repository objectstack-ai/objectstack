/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { extractRecords } from './extract-records.js';

/**
 * The platform's hard row ceiling for a NON-GRID visualisation — gantt,
 * calendar, map and tree (objectui#7210, maintainer ruling a′, 2026-09-02).
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
 * them, so the binding view decides it. Measured in this repo's jsdom lane
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
 */
export function nonGridRowCeilingQuery(): { $top: number } {
  return { $top: NON_GRID_ROW_CEILING + 1 };
}

/** What {@link applyNonGridRowCeiling} tells a caller about its result set. */
export interface NonGridCeilingResult<T = any> {
  /** The rows to draw — never more than {@link NON_GRID_ROW_CEILING}. */
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
 * Cap a non-grid view's result set at {@link NON_GRID_ROW_CEILING} and report
 * whether it had to.
 *
 * Truncation is decided by the PROBE ROW (`rows.length > NON_GRID_ROW_CEILING`
 * against a query built by {@link nonGridRowCeilingQuery}), never by comparing
 * against `total`: `total` is optional on `QueryResult` and absent entirely
 * from a bare-array response, so a `total`-based test would silently stop
 * reporting on exactly the adapters least likely to be paging correctly.
 *
 * The rows are read by `extractRecords`, so this sink accepts exactly the
 * envelopes that helper does (objectui#6839) — pinned in
 * `non-grid-row-ceiling.contractEnvelope-6839.test.ts`.
 */
export function applyNonGridRowCeiling<T = any>(result: unknown): NonGridCeilingResult<T> {
  const all = extractRecords(result) as T[];
  const rawTotal =
    result && typeof result === 'object' && typeof (result as any).total === 'number'
      ? ((result as any).total as number)
      : undefined;
  const truncated = all.length > NON_GRID_ROW_CEILING;
  return {
    rows: truncated ? all.slice(0, NON_GRID_ROW_CEILING) : all,
    total: rawTotal,
    truncated,
  };
}
