/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9452 — `PercentCellRenderer` branched on the field's NAME before it
 * looked at the value, so a percent column whose name happened to contain
 * `progress` or `completion` read its stored FRACTION as percentage POINTS.
 * One stored `0.5` rendered `50%` beside the record H1 and `1%` in the list.
 *
 * ── What this file pins, and why it is rendered rather than computed ───────
 *
 * The renderer has TWO consumers of that one predicate and the card that filed
 * this measured only one of them:
 *
 *   - the NUMBER — `formatPercentBody` (no scaling) vs `formatPercent` (which
 *     applies `percentDisplayValue`);
 *   - the BAR's fill — a LOCAL restatement of `percentDisplayValue`'s own
 *     expression, reached only when the name did not match.
 *
 * So every assertion below reads the rendered cell: the value text, and the
 * `progressbar`'s `aria-valuenow`. ⛔ Never a local variable and ⛔ never the
 * formatter in isolation — a pin on `formatPercent` alone is green on the
 * defect, because the defect was the renderer choosing NOT to call it.
 *
 * ── Directions, predicted in writing BEFORE the run ────────────────────────
 *
 *   stored   field name          pre-fix number / bar    post-fix   verdict
 *   0.5      `progress`          `1%`   / `0.5`          `50%`/`50` RED pre-fix
 *   0.5      `completion`        `1%`   / `0.5`          `50%`/`50` RED pre-fix
 *   0.5      `in_progress_ratio` `1%`   / `0.5`          `50%`/`50` RED pre-fix
 *   12.3     either name         `12%`  / `12.3`         unchanged  CONTROL green
 *   57       either name         `57%`  / `57`           unchanged  CONTROL green
 *
 * The `12.3` and `57` rows are the control the filing card established: every
 * value at or above 1 agrees by construction, so those rows are green on BOTH
 * trees. They are what makes the `0.5` rows a reading rather than a harness
 * that cannot render a percent at all.
 *
 * ⭐ `in_progress_ratio` is here because the pattern was UNANCHORED and tested
 * against the whole lowercased name, so it matched on substring — a column that
 * merely mentions progress took the whole-percent path. After this change no
 * name reaches the scaling decision at all, which is what closes that door.
 *
 * Provider-mounted by construction (objectui#4514).
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { percentDisplayValue } from '@object-ui/core';
import { PercentCellRenderer } from '../index';

/** An explicit `en` session, so the output is the card's own table verbatim. */
function renderCell(value: unknown, field: Record<string, unknown>) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale: undefined }}>
        <PercentCellRenderer
          value={value as any}
          field={{ type: 'percent', ...field } as any}
        />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** The two things a reader of this cell actually sees. */
function readCell(value: unknown, name: string, declared: Record<string, unknown> = {}) {
  const { unmount } = renderCell(value, { name, ...declared });
  const reading = {
    text: document.body.textContent ?? '',
    bar: screen.getByRole('progressbar').getAttribute('aria-valuenow'),
  };
  unmount();
  return reading;
}

/** Names the retired pattern matched: two exact, one by SUBSTRING. */
const MATCHED_NAMES = ['progress', 'completion', 'in_progress_ratio'] as const;
/** A name it never matched — the column the matched ones must now agree with. */
const ORDINARY_NAME = 'win_rate';

afterEach(() => cleanup());

describe('objectui#9452 — a percent cell takes its magnitude from the value, not from the column name', () => {
  /**
   * THE DEFECT. Red on the pre-fix tree on both halves of the cell: the number
   * read `1%` and the bar reported `0.5`, for a value every other percent
   * surface in the repo renders as `50%`.
   */
  it.each(MATCHED_NAMES)(
    'a stored 0.5 in a %s column reads as half, in the number and in the bar',
    (name) => {
      const { text, bar } = readCell(0.5, name);
      expect(text).toContain('50%');
      expect(text).not.toContain('1%');
      expect(bar).toBe('50');
    },
  );

  /**
   * The same statement said as an AGREEMENT rather than as a literal, so the
   * pin keeps meaning what it means if the `en` percent affix ever moves: the
   * only difference between these two cells is the column's name, and a name
   * may not change a magnitude.
   */
  it.each(MATCHED_NAMES)(
    'a %s column and an ordinary percent column answer identically at 0.5',
    (name) => {
      expect(readCell(0.5, name)).toEqual(readCell(0.5, ORDINARY_NAME));
    },
  );

  /**
   * ⭐ The second consumer, on its own. The bar's fill used to be computed from
   * a LOCAL copy of `percentDisplayValue`'s expression on one arm and from the
   * unscaled value on the other, so the bar could disagree with the number
   * printed beside it — pre-fix, this field drew a 0.5%-wide bar next to the
   * text `1%`. Both halves now read the one source of truth.
   */
  it.each(MATCHED_NAMES)('the bar in a %s column reports the display magnitude', (name) => {
    // These fields declare no `max`, so they store a fraction (objectui#11475:
    // the storage is the field's statement, read through `percentScaleOf`).
    expect(readCell(0.5, name).bar).toBe(String(percentDisplayValue(0.5, 'fraction')));
  });

  /**
   * CONTROL — green on BOTH trees, and the reason the rows above are a reading.
   * The filing card established that every value at or above 1 agrees by
   * construction; these are its own `12.3` and `57` rows, driven through the
   * rendered cell on both the matched and the unmatched name.
   *
   * objectui#11475 — the rows are percentage POINTS, and they now say so: they
   * declare `max: 100`, the whole-points storage. Without it a field stores a
   * fraction (the spec's `percentScaleOf`), and the cell no longer guesses
   * points from a value's size. The control's subject is unchanged: the name
   * moves no magnitude.
   */
  it.each([
    [12.3, '12%', '12.3'],
    [57, '57%', '57'],
  ] as const)('a stored %p is unmoved by this change (control)', (stored, text, bar) => {
    for (const name of [...MATCHED_NAMES, ORDINARY_NAME]) {
      const reading = readCell(stored, name, { max: 100 });
      expect(reading.text).toContain(text);
      expect(reading.bar).toBe(bar);
    }
  });
});
