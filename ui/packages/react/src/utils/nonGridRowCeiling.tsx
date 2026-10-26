/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import type { NonGridCeilingResult } from '@object-ui/core';
import { useObjectTranslation, en } from '@object-ui/i18n';

// The non-React half of the non-grid row ceiling — `NON_GRID_ROW_CEILING`,
// `nonGridRowCeilingQuery`, `applyNonGridRowCeiling` and `NonGridCeilingResult`
// — lives in `@object-ui/core` beside the `extractRecords` it wraps
// (objectui#7508, ruling A′). Only the footnote is React, so only the footnote
// is here.

/**
 * The loud footnote a non-grid view shows when it drew only the first
 * `NON_GRID_ROW_CEILING` rows of a larger result set (objectui#7210).
 *
 * Placement and tone follow objectui#7148's chart footnote — a `role="note"`
 * line in muted small type directly under the visualisation, naming BOTH
 * numbers, because the count is the half a reader cannot recover from the
 * picture. A truncated schedule renders as a healthy, confident schedule of a
 * fraction of itself; "some rows are missing" leaves it indistinguishable from
 * a complete one, and `2,000 of 40,000` is the bit that was missing.
 *
 * Two sentences because there are two conditions: a known total states the
 * fact with both numbers; an adapter that reported no `total` still gets a
 * DEFINITE sentence (the probe row proves more rows exist), it simply cannot
 * name how many.
 *
 * ## It takes the RESULT, and nothing else (objectui#7508, ruling A′)
 *
 * The only prop is the `NonGridCeilingResult` that `applyNonGridRowCeiling`
 * returned. Every number the note prints is read off that one object — the
 * drawn count is `result.rows.length`, the total is `result.total`, the
 * verdict is `result.truncated` — so a footnote whose numbers disagree with
 * the rows actually drawn is not something a caller can write. The earlier
 * shape took `drawn` / `total` / `truncated` as three loose props, and every
 * call site hand-wrote `drawn={NON_GRID_ROW_CEILING}` next to a `total` from
 * somewhere else: an incoherent pair was expressible and nothing refused it.
 * ⛔ No deprecated path keeps those props; there were no released consumers.
 *
 * Renders `null` when nothing was truncated, so a caller holding a result can
 * mount it unconditionally and gains no wrapper element on the healthy path.
 */
export function NonGridRowCeilingNote({
  result,
}: {
  /** What `applyNonGridRowCeiling` returned for the rows being drawn. */
  result: NonGridCeilingResult;
}) {
  // ⚠️ A HOOK AT RENDER, never a module-scope `createSafeTranslation(...)`
  // factory, and that is a correctness constraint rather than taste. This
  // module is re-exported from `@object-ui/react`'s entry, so anything at its
  // module scope runs on IMPORT for every consumer that touches the barrel —
  // and a factory call there throws inside any test that partially mocks
  // `@object-ui/i18n` with an object literal instead of `importOriginal`,
  // before a single assertion runs. Two such files went red in CI on exactly
  // that, and the population is repo-wide rather than knowable from here, so
  // the call moved to where it cannot fire at import time. `en` is likewise
  // dereferenced HERE, at render, not in a module-scope constant.
  //
  // `useObjectTranslation` is the one that interpolates on the provider-less
  // path too (objectui#6219), so `{{shown}}` / `{{total}}` are filled whether
  // or not the host mounted an `I18nProvider`. The `defaultValue` is read from
  // the `en` pack rather than retyped: both sit in the same eagerly-loaded
  // chunk, so a hand copy would ship identical bytes twice, and reading the
  // pack makes an inline default that disagrees with `en` unrepresentable
  // instead of merely policed.
  const { t } = useObjectTranslation();
  if (!result.truncated) return null;
  const shown = result.rows.length;
  const text =
    typeof result.total === 'number'
      ? t('common.rowCeilingNote', {
          shown,
          total: result.total,
          defaultValue: en.common.rowCeilingNote,
        })
      : t('common.rowCeilingNoteUnknownTotal', {
          shown,
          defaultValue: en.common.rowCeilingNoteUnknownTotal,
        });
  // `shrink-0` is the note's own, not a caller's: under a `flex-1` view pane in
  // a fixed-height host a plain sibling can be clipped out of view — the
  // construction objectui#7148's `ChartFootnote` measured, and the reason the
  // gantt used to pass this exact class in. Outside a flex container it does
  // nothing, so all four views take it and no caller needs a styling prop.
  return (
    <p
      role="note"
      data-row-ceiling-note="non-grid"
      className="shrink-0 px-1 py-1 text-xs text-muted-foreground"
    >
      {text}
    </p>
  );
}
