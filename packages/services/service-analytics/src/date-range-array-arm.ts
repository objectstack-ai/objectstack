// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17124] THE one reading of `dateRange`'s ARRAY arm, for every face in this
 * package.
 *
 * ## What was wrong
 *
 * `AnalyticsDateRangeSchema`'s array arm is a bare `z.array(z.string())` with no
 * length constraint, so `['2026-01-01']` is schema-valid, and the four faces in
 * this package that read the arm answered it three different ways — MEASURED on
 * `abc4b83ce`, one authored document over the same four rows:
 *
 * | face | `['2026-01-01']` meant |
 * |---|---|
 * | `ObjectQLStrategy.dateRangeBounds` | the POINT window `{$gte, $lte}` on that day |
 * | `NativeSQLStrategy` | nothing at all — `range.length === 2` was false, so NO time clause was emitted and the query read ALL of history |
 * | `lowerPreviewDateRange` | an upper bound of the string `"undefined"`, which every ISO date sorts below (`0x30`-`0x39` before `0x75`) ⇒ unbounded above |
 * | `DatasetExecutor.runCompare` | the point window, shifted — a comparison pass against a window the primary pass may not have used |
 *
 * ⇒ For a dashboard that is one day's number, the whole dataset, and everything
 * from that day onward, from one document, decided by which backend answered.
 * The same three-way split covers `[]` and `[a, b, c]`: the arity, not the one
 * element, is what the faces disagreed about.
 *
 * ## Why a REFUSAL and not an alignment
 *
 * ⛔ Teaching all four faces the same guess would be "align them independently",
 * which is what the standing criterion forbids — and all three readings are
 * ungoverned. What IS governed is the CONTRACT, stated by the spec's own refusal
 * wording (`analyticsDateRangeRefusalMessage`, the one sentence the schema door
 * answers with) and quoted verbatim:
 *
 * > an explicit window is the two-element array [start, end] of ISO dates or
 * > {date-macro} tokens
 *
 * and by the shipped #16322 migration table, which tells an author to write a
 * single day as `['2026-01-20', '2026-01-20']` — TWO bounds. So the arm's arity
 * is declared; only the Zod type is weaker than the contract the same file
 * states. A one-element array is therefore not an under-specified shape needing
 * a meaning invented for it: it is a shape the contract already excludes, and
 * the kit's rule for a `dateRange` that does not denote a window is
 * *"an unresolvable window is a refusal, never a window"*.
 *
 * ⭐ And the author loses nothing: `['2026-01-01', '2026-01-01']` selects exactly
 * that one day on all four faces today (measured as this change's control), so
 * the refusal costs a second bound and buys a document that means one thing.
 *
 * ## Reachability — why a face-side refusal exists at all
 *
 * `POST /analytics/dataset/query` types its selection from `AnalyticsQuery` and
 * never Zod-parses it, so the schema door is BEHIND these faces. ⛔ Tightening
 * `AnalyticsDateRangeSchema` itself is `packages/spec`'s call and is deliberately
 * NOT done here; this is the in-process door past that one, the same seam an
 * unrecognised `compareTo.kind` is refused at.
 */

import { analyticsDateRangeUnrecognizedError } from '@objectstack/core';

/**
 * Build the ADR-0112 refusal for an array arm that does not denote a window.
 *
 * ⭐ The ENVELOPE comes from the ONE shared constructor — the `code` + `status`
 * pair is what the cross-package conformance kit reads, and it must have a
 * single origin. Only the SENTENCE is this condition's own: the shared wording
 * judges a bare STRING against the preset vocabulary and ends with
 * "Refused at the schema", and neither is true of an array refused past the
 * schema door by a face. ⛔ A message stating two falsehoods is not reuse.
 */
function arrayArmRefusal(dateRange: readonly unknown[], received: string): Error {
  const err = analyticsDateRangeUnrecognizedError(dateRange);
  err.message =
    `[service-analytics] dateRange ${JSON.stringify(dateRange)} ${received}. An explicit `
    + 'window is the TWO-element array [start, end] of ISO dates or {date-macro} tokens — '
    + 'e.g. ["2026-01-01", "2026-01-31"] or ["{7_days_ago}", "{today}"]; for a single day '
    + 'write both bounds, ["2026-01-01", "2026-01-01"]. Refused '
    + '(ANALYTICS_DATE_RANGE_UNRECOGNIZED / 400) rather than guessed: this package\'s four '
    + 'analytics faces read an odd-sized array three different ways — a point window, a '
    + 'window dropped to all of history, and an upper bound left unwritten — so any number '
    + 'computed from one would depend on which backend answered.';
  return err;
}

/**
 * The CALLER's explicit window, as the two bounds every face in this package
 * lowers — or the refusal.
 *
 * ⛔ Bound VALUES are not judged here: a bare `YYYY-MM-DD` versus a full
 * timestamp is a per-face calendar translation (#3777 / #4042) and a
 * `{date-macro}` token is expanded upstream, neither of which this arity rule
 * touches. An unparseable bound keeps its own `DATASET_INVALID` refusal
 * (#5716) — a different condition, and so a different envelope.
 *
 * @param dateRange - the array arm as it reached the face, unparsed.
 * @returns the two bounds, in the order the author wrote them.
 * @throws the ADR-0112 `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400 envelope when
 *   the array is not exactly two string bounds.
 */
export function explicitDateRangeWindow(dateRange: readonly unknown[]): [string, string] {
  if (dateRange.length !== 2) {
    throw arrayArmRefusal(dateRange, `is a ${dateRange.length}-element array, not a window`);
  }
  const [start, end] = dateRange;
  for (const bound of [start, end]) {
    if (typeof bound !== 'string' || bound.length === 0) {
      throw arrayArmRefusal(
        dateRange,
        `has a bound that is not a date string (${bound === null ? 'null' : typeof bound})`,
      );
    }
  }
  return [start as string, end as string];
}
