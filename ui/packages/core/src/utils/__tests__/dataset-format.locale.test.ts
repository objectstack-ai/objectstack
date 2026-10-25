/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4566 — `formatMeasure` / `formatDimensionValue` follow the DISPLAY
 * locale instead of the machine's.
 *
 * All three formatting sites in `dataset-format.ts` passed a literal
 * `undefined` locale tag to `Intl`, which is neither of the repo's two locale
 * channels — it is whatever locale the machine happens to run in. Both
 * functions are PURE (this package is React-free), so the tag arrives as a new
 * optional LAST parameter and the callers thread `useDisplayLocale()`.
 *
 * ── Why every case pins TWO locales ──────────────────────────────────────────
 * A single de assertion is not falsifiable on its own: on a German runner it
 * would pass before the fix as well, because the machine locale would already
 * be German. Each case therefore pins the same value in de AND in en. Before
 * the fix the threaded tag is ignored, so BOTH render in the machine's locale
 * and at least one of the two assertions must fail on ANY runner. That is the
 * un-fakeable signal, and it is the same property the fix delivers: the machine
 * locale stops being an input.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────────
 * Runner machine locale measured as en-US.
 *   de plain / currency / percent / dimension     RED  (renders en pre-fix)
 *   fr plain (U+202F group separator)             RED
 *   en counterpart of each of the above           GREEN both sides — these are
 *                                                 the byte-identity pins, and
 *                                                 en must NOT move on this card
 *                                                 (grouping already existed
 *                                                 here; contrast objectui#4553,
 *                                                 where moving en WAS the fix)
 *   zh coincidence case                           GREEN both sides — see its own
 *                                                 note; NOT a red-first case
 *   malformed-tag rescue                          GREEN both sides — a guard,
 *                                                 labelled as such, not a pin
 *                                                 of the defect
 *   integer-verbatim cases                        GREEN both sides (must-not-change)
 */

import { describe, it, expect } from 'vitest';
import { formatMeasure, formatDimensionValue } from '../dataset-format';

/** German puts a NO-BREAK SPACE between amount and currency sign. */
const NBSP = '\u00a0';
/** French groups with a NARROW NO-BREAK SPACE (U+202F in current ICU). */
const NNBSP = '\u202f';

describe('formatMeasure follows the display locale (objectui#4566)', () => {
  it('formats a plain measure in the threaded locale, not the machine one', () => {
    expect(formatMeasure(1234.5, '0.0', undefined, undefined, 'de-DE')).toBe('1.234,5');
    expect(formatMeasure(1234.5, '0.0', undefined, undefined, 'en-US')).toBe('1,234.5');
    expect(formatMeasure(1234.5, '0.0', undefined, undefined, 'fr-FR')).toBe(`1${NNBSP}234,5`);
  });

  it('formats a currency measure with the locale-correct symbol PLACEMENT', () => {
    // Not merely the separators: German writes the sign last, English first.
    expect(formatMeasure(1234.5, '0.00', 'EUR', undefined, 'de-DE')).toBe(`1.234,50${NBSP}€`);
    expect(formatMeasure(1234.5, '0.00', 'EUR', undefined, 'en-US')).toBe('€1,234.50');
  });

  it('formats a percent measure in the threaded locale', () => {
    // The decimal COMMA is the whole point: `60.8%` and `60,8%` read as
    // different numbers to the two audiences, not as the same one restyled.
    //
    // PIN MOVED (objectui#4576). The German expectation gained the no-break
    // space before the sign. That is not this case's subject drifting — it is
    // the divergence #4566 recorded and declined to fix here, now closed: a
    // German list cell has written `60,8${NBSP}%` since #4553, and the measure
    // appended a literal '%'. The en-US line beside it is UNMOVED, which is
    // what says this was a convention change and not a numeral one.
    expect(formatMeasure(0.608_333_333, '0.0%', undefined, undefined, 'de-DE')).toBe(`60,8${NBSP}%`);
    expect(formatMeasure(0.608_333_333, '0.0%', undefined, undefined, 'en-US')).toBe('60.8%');
  });

  it('honours a declared percentScale in the threaded locale', () => {
    // PIN MOVED (objectui#4576) — same reason as the case above; the declared
    // `percentScale` behaviour it actually pins is untouched, and en-US is
    // byte-identical.
    expect(formatMeasure(1, '0.0%', undefined, 'fraction', 'de-DE')).toBe(`100,0${NBSP}%`);
    expect(formatMeasure(1, '0.0%', undefined, 'fraction', 'en-US')).toBe('100.0%');
  });

  it('falls back to a plain LOCALIZED number when the currency code is unknown', () => {
    // The fallthrough survives the locale threading: `formatNumberInLocale`
    // retries without the LOCALE, and a bad currency throws out of that retry
    // too, so the outer catch is still reached — and what it reaches must now
    // itself be localized.
    expect(formatMeasure(1234, '0,0', 'NOTACODE', undefined, 'de-DE')).toBe('1.234');
    expect(formatMeasure(1234, '0,0', 'NOTACODE', undefined, 'en-US')).toBe('1,234');
  });

  it('localizes the legacy "$" literal form without moving the literal', () => {
    expect(formatMeasure(1234.5, '$0.00', undefined, undefined, 'de-DE')).toBe('$1.234,50');
    expect(formatMeasure(1234.5, '$0.00', undefined, undefined, 'en-US')).toBe('$1,234.50');
  });
});

describe('formatDimensionValue follows the display locale (objectui#4566)', () => {
  it('formats a fractional dimension value in the threaded locale', () => {
    expect(formatDimensionValue(1234.5, 'de-DE')).toBe('1.234,5');
    expect(formatDimensionValue(1234.5, 'en-US')).toBe('1,234.5');
  });
});

describe('must-not-change: en output and the non-locale forms are byte-identical', () => {
  /**
   * The card's discriminator against objectui#4553. There `formatPercent` had
   * never grouped, so en moved and the move WAS the fix. Here every site
   * already went through `Intl` with default grouping, so en moving would mean
   * the threading changed something it had no business changing.
   */
  it('en output is unchanged at every site', () => {
    expect(formatMeasure(1234, '0,0', undefined, undefined, 'en-US')).toBe('1,234');
    // Whole points, annotated as the server annotates them (objectui#11475: an
    // unannotated `%` pattern reads a fraction).
    expect(formatMeasure(50, '0%', undefined, 'whole', 'en-US')).toBe('50%');
    expect(formatMeasure(0.75, '0%', undefined, undefined, 'en-US')).toBe('75%');
    expect(formatMeasure(12.5, '0.0', undefined, undefined, 'en-US')).toBe('12.5');
    expect(formatMeasure(1000, '$0,0', undefined, undefined, 'en-US')).toBe('$1,000');
    expect(formatMeasure(0.6667, '0.0%', undefined, 'fraction', 'en-US')).toBe('66.7%');
  });

  /**
   * OMITTING the argument must reproduce the previous output byte for byte —
   * the old code passed a literal `undefined` to `Intl`, which is exactly what
   * an omitted optional parameter passes now. This is what makes the parameter
   * safe to add ahead of the consumers that do not thread it yet.
   */
  it('omitting the locale reproduces the machine-locale behaviour', () => {
    expect(formatMeasure(1234, '0,0')).toBe(formatMeasure(1234, '0,0', undefined, undefined, undefined));
    expect(formatMeasure(null)).toBe('—');
    expect(formatMeasure('n/a')).toBe('n/a');
    expect(formatDimensionValue(null)).toBe('—');
    expect(formatDimensionValue('Backlog')).toBe('Backlog');
  });

  /**
   * The integer branch renders no separator and no decimal mark, so there is
   * nothing for a locale to change — and it is deliberately NOT routed through
   * `Intl`, which WOULD change it (a locale with its own numbering system would
   * re-digit it). Green on both sides of the fix, in every locale.
   */
  it('integers stay verbatim in every locale', () => {
    for (const locale of ['en-US', 'de-DE', 'zh-CN', 'fr-FR', 'ar-EG']) {
      expect(formatMeasure(1234, undefined, undefined, undefined, locale)).toBe('1234');
      expect(formatDimensionValue(42, locale)).toBe('42');
    }
  });
});

describe('locale-tag robustness (guards, not defect pins)', () => {
  /**
   * ⚠️ HONEST LABELLING — this case is GREEN on both sides of the fix, because
   * before it the argument was ignored entirely and nothing could throw. It
   * does not pin the #4566 defect; it pins a hazard the fix ITSELF introduces
   * and must not regress. A threaded tag can be malformed (`en_US` with an
   * underscore is the likeliest tenant-config typo), and a bare
   * `Intl.NumberFormat('en_US', …)` throws `RangeError` — un-caught that takes
   * the whole widget down, which would be a worse bug than the one being fixed.
   */
  it('a malformed locale tag degrades to the runtime default instead of throwing', () => {
    for (const bad of ['en_US', '!!', 'e', 'de-DE-u-nu-']) {
      expect(() => formatMeasure(1234.5, '0.0', undefined, undefined, bad)).not.toThrow();
      expect(formatMeasure(1234.5, '0.0', undefined, undefined, bad)).toBe(
        formatMeasure(1234.5, '0.0'),
      );
      expect(() => formatDimensionValue(1234.5, bad)).not.toThrow();
    }
  });

  /**
   * ⚠️ HONEST LABELLING — a COINCIDENCE case, not a red-first one. zh-CN's
   * number conventions are byte-identical to en-US's (measured: group `,`,
   * decimal `.`), so a Chinese session cannot produce the inverted-separator
   * signal the German one does and this case is green before AND after the fix.
   * It is kept because it records WHY zh is absent from the red-first set — a
   * later reader must not add a "zh renders differently" expectation and then
   * conclude the fix is broken when it does not.
   */
  it('zh-CN coincides with en-US and is therefore not a discriminator', () => {
    expect(formatMeasure(1234.5, '0.0', undefined, undefined, 'zh-CN')).toBe(
      formatMeasure(1234.5, '0.0', undefined, undefined, 'en-US'),
    );
  });
});
