// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17124] THE one reading of `dateRange`'s ARRAY arm, for every face in this
 * package.
 *
 * ## What was wrong
 *
 * `AnalyticsDateRangeSchema`'s array arm WAS a bare `z.array(z.string())` with
 * no length constraint, so `['2026-01-01']` was schema-valid, and the four
 * faces in this package that read the arm answered it three different ways —
 * MEASURED on `abc4b83ce`, one authored document over the same four rows:
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
 * was declared long before the Zod type said it; only that type was weaker than
 * the contract the same file states. A one-element array is therefore not an
 * under-specified shape needing a meaning invented for it: it is a shape the
 * contract already excludes, and the kit's rule for a `dateRange` that does not
 * denote a window is *"an unresolvable window is a refusal, never a window"*.
 *
 * ⭐ And the author loses nothing: `['2026-01-01', '2026-01-01']` selects exactly
 * that one day on all four faces today (measured as this change's control), so
 * the refusal costs a second bound and buys a document that means one thing.
 *
 * ## Reachability — why a face-side refusal is STILL needed (#18232)
 *
 * ⚠️ Three sentences this section carried until #18232 were true when written
 * and are false now, because `packages/spec` has since made the call they said
 * it had not made. Re-measured on `origin/main`:
 *
 *   - the array arm is `z.tuple([z.string(), z.string()])`, ⛔ no longer the
 *     bare `z.array(z.string())` the section above describes as history —
 *     maintainer ruling A on #17598 (decision batch #117 item 3), landed by
 *     PR #18230;
 *   - so tightening `AnalyticsDateRangeSchema` is ⛔ not "deliberately NOT done
 *     here" any more: it is done, upstream, where the contract lives;
 *   - and `POST /analytics/dataset/query` is ⛔ no longer a route that never
 *     Zod-parses its selection — PR #17548 doored the selection's shared
 *     members, `timeDimensions` among them, and #17551 widened that parse to
 *     the whole selection against `DatasetSelectionSchema`
 *     (`rest/src/analytics-selection-door.ts`, wired in `rest-server.ts`), so on
 *     THAT route the schema door is AHEAD of these faces, not behind them.
 *
 * ⛔ None of which retires this door. Two reasons, structural rather than
 * historical:
 *
 *   - **The in-process callers never parse.** `AnalyticsService.query`,
 *     `queryDataset` and the dataset executor behind them type their selection
 *     from `AnalyticsQuery` and Zod-parse nothing, so every shape in the table
 *     above still arrives at these faces exactly as it did.
 *   - **The tuple judges ARITY and bound TYPE, never a bound's VALUE.** The
 *     residue it cannot refuse — a two-string window with an empty bound,
 *     `['', '']` — satisfies the arm at every door and is refused here.
 */

import { analyticsDateRangeUnrecognizedError } from '@objectstack/core';

/**
 * The CALLER's explicit window, as the two bounds every face in this package
 * lowers — or the refusal.
 *
 * ## ⭐ ONE condition, ONE wording — envelope AND sentence (#18232)
 *
 * The `code` + `status` pair has always come from the ONE shared constructor,
 * because the cross-package conformance kit reads it and it must have a single
 * origin. The MESSAGE used to be OVERWRITTEN here with a second wording for the
 * same condition, on two stated grounds: that the shared sentence judged a bare
 * STRING against the preset vocabulary, and that it ended with "Refused at the
 * schema" — neither true of an array refused past the schema door by a face.
 * ⛔ PR #18230 removed both grounds. `analyticsDateRangeRefusalMessage` now
 * describes a non-string by what is WRONG with it (`describeRefusedDateRange`)
 * and takes the ORIGIN as a required parameter, so the sentence
 * `analyticsDateRangeUnrecognizedError` builds — origin `'runtime'`, *"Refused
 * past the schema door, by the analytics reader that received it"* — is true of
 * exactly this door. With its two grounds gone, the second wording was what the
 * #5240 convention exists to prevent: one condition with two wordings.
 *
 * ⛔ The reason this package refuses rather than guesses is this module's
 * header, ⛔ not the message — re-stating it in the sentence is how the second
 * wording got here in the first place.
 *
 * ⛔ Bound VALUES are not judged here: a bare `YYYY-MM-DD` versus a full
 * timestamp is a per-face calendar translation (#3777 / #4042) and a
 * `{date-macro}` token is expanded upstream, neither of which this arity rule
 * touches. An unparseable bound keeps its own `DATASET_INVALID` refusal
 * (#5716) — a different condition, and so a different envelope.
 *
 * @param dateRange - the array arm as it reached the face, unparsed.
 * @returns the two bounds, in the order the author wrote them.
 * @throws the ADR-0112 `ANALYTICS_DATE_RANGE_UNRECOGNIZED` / 400 envelope,
 *   carrying the spec's own `'runtime'`-origin wording, when the array is not
 *   exactly two non-empty string bounds.
 */
export function explicitDateRangeWindow(dateRange: readonly unknown[]): [string, string] {
  if (dateRange.length !== 2) {
    throw analyticsDateRangeUnrecognizedError(dateRange);
  }
  const [start, end] = dateRange;
  for (const bound of [start, end]) {
    if (typeof bound !== 'string' || bound.length === 0) {
      throw analyticsDateRangeUnrecognizedError(dateRange);
    }
  }
  return [start as string, end as string];
}
