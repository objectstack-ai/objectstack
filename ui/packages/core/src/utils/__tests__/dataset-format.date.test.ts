// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7178 — a dataset measure over a date field renders as a date.
 *
 * `formatMeasure` opened with `if (typeof v !== 'number') return String(v)`,
 * placed BEFORE `format` was read. So a `min` / `max` over a date or datetime
 * field printed its stored value verbatim — a 24-character ISO string in the
 * KPI tile's `text-2xl font-semibold`, wrapped over two lines — and the
 * `format` that `DatasetMeasureSchema` accepts was unreachable for it.
 *
 * ── What these cases pin, and what they deliberately do NOT ─────────────────
 * The fix is a ROUTE, not a formatter: every byte of date rendering comes from
 * `../date-display.ts`, which is where `@object-ui/fields`' `formatDate` /
 * `formatDateTime` now live and what the `date` cell renderer, `ObjectGrid`'s
 * date cells and `ObjectGantt`'s tooltips call. So the cases below assert
 * AGREEMENT WITH THAT PATH rather than literal strings wherever the path's own
 * output is the contract — a literal would pin this file's opinion of a date,
 * which is exactly the second convention objectui#4576 says not to create.
 * (`DatasetWidget.dateMeasure.test.tsx` closes the loop on the rendered
 * surfaces, and `@object-ui/fields`' `date-display.reexport-identity.test.ts`
 * pins that the cell's `formatDate` and this one are the same function.)
 *
 * ── Directions, predicted in writing BEFORE the run ─────────────────────────
 *   the two date cases            RED pre-fix — they render the raw ISO string
 *   the `format`-as-style cases   RED pre-fix — `format` was never read here
 *   ⭐ every must-not-move case    GREEN on both sides. These are the guard,
 *                                 not the fix: the new branch runs ahead of
 *                                 the `String(v)` short-circuit, so it has to
 *                                 be shown NOT to capture numbers, numeric
 *                                 strings, the nullish em dash, or prose.
 *
 * The full before/after sweep is recorded in the PR: 33,696 argument forms
 * (value x format x currency x percentScale x locale) compared against a
 * verbatim copy of the pre-fix function, 4 distinct values moved — every one
 * of them ISO-shaped and parseable — and 0 expected movers missed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { formatMeasure } from '../dataset-format.js';
import {
  formatDate,
  formatDateTime,
  formatDateTimeCompactParts,
  formatRelativeDate,
} from '../date-display.js';

/** A NON-current year, so `formatDate`'s "drop the year" branch is not in play. */
const ISO_DATE = '2024-07-04';
const ISO_DATETIME = '2024-07-04T07:00:00.000Z';
const EN = 'en-US';

describe('formatMeasure routes a date-shaped measure through the shared date path (objectui#7178)', () => {
  it('renders a datetime measure as a datetime, not as its raw ISO string', () => {
    const out = formatMeasure(ISO_DATETIME, undefined, undefined, undefined, EN);
    expect(out).not.toBe(ISO_DATETIME);
    expect(out).toBe(formatDateTime(ISO_DATETIME, { locale: EN }));
  });

  it('renders a date-only measure as a date, not as its raw ISO string', () => {
    const out = formatMeasure(ISO_DATE, undefined, undefined, undefined, EN);
    expect(out).not.toBe(ISO_DATE);
    expect(out).toBe(formatDate(ISO_DATE, undefined, { locale: EN }));
  });

  it('accepts the space-separated ISO spelling a backend may send', () => {
    const spaced = '2024-07-04 07:00:00';
    expect(formatMeasure(spaced, undefined, undefined, undefined, EN)).toBe(
      formatDateTime(spaced, { locale: EN }),
    );
  });

  it('follows the display locale, like every other measure', () => {
    const de = formatMeasure(ISO_DATETIME, undefined, undefined, undefined, 'de-DE');
    const en = formatMeasure(ISO_DATETIME, undefined, undefined, undefined, EN);
    expect(de).not.toBe(en);
    expect(de).toBe(formatDateTime(ISO_DATETIME, { locale: 'de-DE' }));
  });
});

/**
 * The finding's reusable half: `DatasetMeasureSchema.format` is an open string
 * that parses and, on this path, could never be read. It is read now — as the
 * shared path's STYLE vocabulary, which is what that path actually accepts.
 * A date PATTERN is not part of that vocabulary, and these cases say so out
 * loud rather than leaving it silent, because "silent" is the whole card.
 */
describe('what `format` can and cannot say for a date measure (objectui#7178)', () => {
  it('honours `short` — the same word `DateCellRenderer` honours from `field.format`', () => {
    expect(formatMeasure(ISO_DATE, 'short', undefined, undefined, EN)).toBe(
      formatDate(ISO_DATE, 'short', { locale: EN }),
    );
    expect(formatMeasure(ISO_DATE, 'short', undefined, undefined, EN)).not.toBe(
      formatMeasure(ISO_DATE, undefined, undefined, undefined, EN),
    );
  });

  it('honours `relative`', () => {
    expect(formatMeasure(ISO_DATE, 'relative', undefined, undefined, EN)).toBe(
      formatDate(ISO_DATE, 'relative', { locale: EN }),
    );
  });

  it('⚠️ does NOT interpret a date PATTERN — `YYYY-MM-DD` renders the locale default', () => {
    // Measured, not assumed, and stated in the PR body: the shared date path
    // takes a named style, not a pattern. This case exists so the limit is
    // pinned rather than rediscovered — and so that teaching the shared path a
    // pattern grammar later has a test that must be updated deliberately.
    const patterned = formatMeasure(ISO_DATE, 'YYYY-MM-DD', undefined, undefined, EN);
    expect(patterned).not.toBe('2024-07-04');
    expect(patterned).toBe(formatMeasure(ISO_DATE, undefined, undefined, undefined, EN));
  });
});

/**
 * ⭐ The regression guard. The date branch runs ahead of the `String(v)`
 * short-circuit, so every one of these has to be shown NOT to reach it.
 */
describe('formatMeasure leaves every non-date value exactly where it was (objectui#7178)', () => {
  it('formats numbers through the numeral path, untouched', () => {
    expect(formatMeasure(1234.5, '0.0', undefined, undefined, EN)).toBe('1,234.5');
    expect(formatMeasure(1234.5, '0.00', 'EUR', undefined, EN)).toBe('€1,234.50');
    expect(formatMeasure(0.75, '0.0%', undefined, 'fraction', EN)).toBe('75.0%');
    expect(formatMeasure(42, undefined, undefined, undefined, EN)).toBe('42');
    expect(formatMeasure(2026, undefined, undefined, undefined, EN)).toBe('2026');
  });

  it('⭐ never reads a NUMERIC STRING as a date', () => {
    // `1751612400000` is epoch milliseconds for a real instant, and `2026` is a
    // year. Both are what a count or an id looks like coming back from a
    // measure, and `Date.parse` would take either if it were asked.
    for (const v of ['0', '42', '1234.5', '-1234.5', '1751612400000', '2026', '1e21']) {
      expect(formatMeasure(v, undefined, undefined, undefined, EN)).toBe(v);
      expect(formatMeasure(v, 'YYYY-MM-DD', undefined, undefined, EN)).toBe(v);
    }
  });

  it('keeps the nullish em dash', () => {
    expect(formatMeasure(null)).toBe('—');
    expect(formatMeasure(undefined)).toBe('—');
    expect(formatMeasure(null, 'YYYY-MM-DD', undefined, undefined, EN)).toBe('—');
  });

  it('falls through to `String(v)` for an arbitrary non-numeric, non-date value', () => {
    for (const v of ['Acme Corp', 'N/A', '', 'March 5, 2026', '2026-07', '2026/07/04', '04-07-2026']) {
      expect(formatMeasure(v, undefined, undefined, undefined, EN)).toBe(String(v));
    }
    expect(formatMeasure(true, undefined, undefined, undefined, EN)).toBe('true');
  });

  it('leaves an ISO-SHAPED but unparseable value alone rather than showing an em dash', () => {
    // `formatDate` answers `—` for an unparseable value. Routing one there
    // would REPLACE a raw string the author can still debug with a dash that
    // says nothing, so the parse guard keeps these on the old path.
    for (const v of ['2026-13-45', '2024-07-04T99:99']) {
      expect(formatMeasure(v, undefined, undefined, undefined, EN)).toBe(v);
    }
  });

  it('agrees with the list cell on an impossible calendar day — on the refusal', () => {
    // Rewritten, not deleted, by objectui#10026. This case used to be named
    // "agrees with the list cell on a rolled-over date instead of
    // second-guessing it", and it pinned the list cell and the measure
    // agreeing on a ROLL: `2024-02-30` rendered as March 1st in both. It was
    // pinned "because it is the one place agreement looks like a bug", and
    // the maintainer's ruling on #10026 kept exactly that half — AGREEMENT —
    // while moving what they agree on. The shared date path now refuses a
    // day its month does not have, with the dash it renders for any
    // unparsable value, and the measure renders that same dash.
    //
    // Why the measure must NOT refuse on its own: its guard still lets this
    // value through, because `Date.parse` accepts it (asserted first, so a
    // runtime that ever starts rejecting it reds here rather than turning the
    // rest into a statement about nothing). Were the measure to refuse by
    // itself — falling through to `String(v)`, as it does for `2026-13-45`
    // above — it would print `2024-02-30` beside a list cell's dash: the
    // objectui#4576 split this pin exists to prevent. One judgement, made in
    // the shared path; the measure inherits it.
    const impossible = '2024-02-30';
    expect(Number.isNaN(Date.parse(impossible))).toBe(false);
    const listCell = formatDate(impossible, undefined, { locale: EN });
    expect(listCell).toBe(formatDate('not-a-date', undefined, { locale: EN }));
    expect(formatMeasure(impossible, undefined, undefined, undefined, EN)).toBe(listCell);
    // The pair still agrees under a `format` style, which the date arm threads.
    expect(formatMeasure(impossible, 'short', undefined, undefined, EN)).toBe(
      formatDate(impossible, 'short', { locale: EN }),
    );
  });
});

/**
 * objectui#8352 — the DATETIME arm honours `format` too.
 *
 * Everything in the describe above exercises `ISO_DATE` only. That was the
 * blind spot: `formatMeasureDate` has two arms, `format` was threaded into the
 * date one and DROPPED on the datetime one, and a suite that never passed a
 * datetime through the `format` cases could not see it. A `Field.date` yields
 * `2026-09-08` and takes the first arm; a `Field.datetime` yields
 * `2026-09-01T00:00:00.000Z` and takes the second.
 *
 * ── ⚠️ Why the clock is pinned, and why these values are not the file's ─────
 * `formatRelativeDate` falls back to the absolute form beyond a ±7-day window,
 * so an OUT-OF-WINDOW value renders identically whether `format` is honoured
 * or dropped. Both readings that missed this defect were taken that way —
 * objectstack#15768's datum (`2026-07-04`) and the first dev probe
 * (`2026-07-28`) were 40–60 days old, so neither could fail in either
 * direction. `ISO_DATE` / `ISO_DATETIME` above are 2024 values and are
 * out-of-window by construction: they are the WRONG instrument for this card
 * and are deliberately not reused here.
 *
 * The window is relative to "now", so the cases below need a fixed "now" —
 * `vi.setSystemTime` with `toFake: ['Date']`, the convention already used in
 * `plugin-timeline` / `plugin-map`. The suite also pins `TZ=UTC`
 * (`vitest.config.mts`, objectui#8366), so a `Z`-suffixed instant and the
 * local calendar day `formatRelativeDate` computes from it cannot disagree.
 *
 * ── Directions, MEASURED by ablating the fix four ways ──────────────────────
 * Predicted first, then run; two predictions were wrong and these are the
 * observed columns, not the predicted ones. A = the pre-#8352 arm (`format`
 * dropped); B1 = wire the arm to `formatRelativeDate` unconditionally; B2 =
 * hand-roll the relative phrase, skipping the ±7-day window; C = thread
 * `format` into `formatDateTime`'s `options.style`.
 *
 *                                    A     B1    B2    C
 *   leg 1  in-window datetime       RED   RED   RED   RED
 *   leg 2  date-only control       green green green green   ← the rig check:
 *                                    no ablation of the DATETIME arm can move
 *                                    it, which is what makes it a control
 *   leg 3  out-of-window datetime   RED  green   RED   RED
 *   decisive pair                   RED  green   RED   RED
 *   `short` parity                  RED   RED   green  RED
 *   vocabulary equality             RED   RED   green  RED
 *   pass-through anti-pin          green green green  RED
 *   unstyled default guard         green  RED   green green
 *
 * ⭐ What each row adds, read off those columns. Leg 1 moves for all four, so
 * it DETECTS every ablation — but it does not distinguish them, and each fake
 * fix leaves something green that a trimmed suite would have relied on: B1
 * leaves leg 3 and the decisive pair green (its relative face is correct
 * inside the window), B2 leaves the `short` and vocabulary cases green (it
 * only touches the relative branch). The two must-not-move guards are where
 * the fake fixes separate from each other: B1 is the ONLY column that reddens
 * the unstyled-default guard, C the ONLY one that reddens the pass-through
 * anti-pin. Neither fake fix is hypothetical shape-fitting — both are what
 * "just make it relative" looks like when written quickly, and C is the
 * one-line change the signature invites.
 *
 * ⚠️ Leg 3 was predicted green-on-both-sides and measured RED under A. The
 * prediction assumed the pre-fix arm rendered the same absolute face this one
 * does; it does not — out of the window the honoured reading renders the
 * absolute DATE face (`formatRelativeDate`'s own fallback) while the pre-fix
 * arm rendered the absolute DATETIME face. The card's "indistinguishable out
 * of window" trap is about the BROWSER comparison it was measured in —
 * `format` absent beside `format: 'relative'`, which pre-fix were the same
 * bytes — and that reading is pinned on its own in leg 3's second assertion.
 */
describe('the DATETIME arm honours `format`, like the date arm (objectui#8352)', () => {
  /** Noon UTC, so the pinned day is unambiguous under the suite's `TZ=UTC`. */
  const NOW = new Date('2026-09-09T12:00:00Z');

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => vi.useRealTimers());

  /** `days` from the pinned now, as the wire spells each field type. */
  const at = (days: number, withTime: boolean) => {
    const d = new Date(NOW);
    d.setUTCDate(d.getUTCDate() + days);
    const day = d.toISOString().slice(0, 10);
    return withTime ? `${day}T09:30:00.000Z` : day;
  };

  /** +2 days: inside the ±7-day window, so the relative face is REACHABLE. */
  const IN_WINDOW_DATETIME = at(2, true); //  2026-09-11T09:30:00.000Z
  const IN_WINDOW_DATE = at(2, false); //     2026-09-11
  /** +40 days: outside it, so the relative style renders the absolute face. */
  const OUT_OF_WINDOW_DATETIME = at(40, true); // 2026-10-19T09:30:00.000Z

  const measure = (v: string, format?: string) => formatMeasure(v, format, undefined, undefined, EN);

  // ── Leg 1 ────────────────────────────────────────────────────────────────
  it('⭐ leg 1 — an IN-WINDOW datetime with `relative` renders the RELATIVE face', () => {
    // This is the assertion the card's driven browser run made by hand, and
    // the one line of this file that was red before the fix: the value used to
    // render `Sep 11, 2026, 09:30 AM` no matter what `format` said.
    const relative = measure(IN_WINDOW_DATETIME, 'relative');

    expect(relative).toBe(formatRelativeDate(IN_WINDOW_DATETIME, { locale: EN }));
    // It MOVED. Equality with the shared path alone would also hold for an arm
    // that ignored `format`, if the path happened to agree — this does not.
    expect(relative).not.toBe(measure(IN_WINDOW_DATETIME));
  });

  // ── Leg 2 ────────────────────────────────────────────────────────────────
  it('⭐ leg 2 — the date-only positive control renders the relative face', () => {
    // The RIG check, and only that: same run, same entry point, same window.
    // It is green on BOTH sides of the fix by design — the date arm always
    // honoured `relative`, and that asymmetry IS the defect — so it fails only
    // if the harness itself is disconnected, in which case legs 1 and 3 say
    // nothing. Deliberately carries no cross-arm assertion: mixing one in
    // costs this leg the one property that makes it a control, which is that
    // the defect cannot move it. (Measured: it did carry one, and ablating the
    // fix turned it red — the diagnostic separation the three legs exist for,
    // lost. The cross-arm pair is its own case below.)
    const dateOnly = measure(IN_WINDOW_DATE, 'relative');
    expect(dateOnly).toBe(formatDate(IN_WINDOW_DATE, 'relative', { locale: EN }));
    expect(dateOnly).not.toBe(measure(IN_WINDOW_DATE));
  });

  it('⭐ the decisive pair — the same day reads the same on either field type', () => {
    // The card's measured symptom, as one assertion: `min(created_at)` (a
    // `Field.datetime`) and `min(due_date)` (a `Field.date`) five days apart
    // from the same page load, one reading `后天` and the other an absolute
    // datetime. Both arms now reach the same phrase for the same calendar day.
    expect(measure(IN_WINDOW_DATETIME, 'relative')).toBe(measure(IN_WINDOW_DATE, 'relative'));
  });

  // ── Leg 3 ────────────────────────────────────────────────────────────────
  it('⭐ leg 3 — an OUT-OF-WINDOW datetime with `relative` renders the ABSOLUTE face', () => {
    // The falsifier. A fix that produces a relative phrase itself — rather
    // than routing to `formatRelativeDate` and inheriting its ±7-day window —
    // passes legs 1 and 2 and fails exactly here. `formatDate(v, undefined,…)`
    // IS the absolute face by definition, so this compares against the shared
    // path rather than pinning a literal.
    const out = measure(OUT_OF_WINDOW_DATETIME, 'relative');
    expect(out).toBe(formatDate(OUT_OF_WINDOW_DATETIME, undefined, { locale: EN }));
    expect(out).toBe(formatRelativeDate(OUT_OF_WINDOW_DATETIME, { locale: EN }));

    // ⚠️ And the trap stated out loud: out of the window the honoured and the
    // dropped readings of `format` are INDISTINGUISHABLE on the date arm. A
    // suite that only ever measured here would go green over the defect.
    expect(measure(at(40, false), 'relative')).toBe(measure(at(40, false)));
  });

  // ── Ruling: the honoured set must EQUAL the date arm's, no more, no less ──
  it('honours `short` — the dense face of its OWN type, keeping the time', () => {
    const short = measure(IN_WINDOW_DATETIME, 'short');
    expect(short).toBe(formatDateTime(IN_WINDOW_DATETIME, { locale: EN, style: 'compact' }));
    expect(short).not.toBe(measure(IN_WINDOW_DATETIME));
    // Byte-identical to what a `datetime` CELL paints for the same instant, so
    // a measure tile and a grid cell cannot drift (objectui#4576).
    const parts = formatDateTimeCompactParts(new Date(IN_WINDOW_DATETIME), { locale: EN });
    expect(short).toBe(`${parts!.date} ${parts!.time}`);
  });

  it('⭐ honours EXACTLY the two words the date arm honours — measured, both arms', () => {
    // Ruling ② of the dispatch, as an assertion rather than a claim: the two
    // arms must accept the SAME vocabulary. `'compact'` is the interesting
    // entry — it is `formatDateTime`'s own style key, so the tempting
    // one-line "fix" (thread `format` into `options.style`) would honour it
    // HERE and nowhere on the date arm. That would be the defect inverted:
    // the one word the date arm ignores, honoured; both words it honours,
    // still dropped.
    const VOCABULARY = [undefined, 'short', 'relative', 'compact', 'YYYY-MM-DD', ''];
    const movedOn = (v: string) =>
      VOCABULARY.filter((f) => f !== undefined && measure(v, f) !== measure(v));

    expect(movedOn(IN_WINDOW_DATE)).toEqual(['short', 'relative']);
    expect(movedOn(IN_WINDOW_DATETIME)).toEqual(['short', 'relative']);
    expect(movedOn(IN_WINDOW_DATETIME)).toEqual(movedOn(IN_WINDOW_DATE));
  });

  it('⭐ does NOT thread `format` into the `style` key of `formatDateTime`', () => {
    // The anti-pin for the inverted fix above, stated on the value that would
    // expose it. `'compact'` must reach the DEFAULT face here, not the compact
    // one — otherwise this path speaks a vocabulary no list cell speaks.
    expect(measure(IN_WINDOW_DATETIME, 'compact')).toBe(measure(IN_WINDOW_DATETIME));
    expect(measure(IN_WINDOW_DATETIME, 'compact')).not.toBe(
      formatDateTime(IN_WINDOW_DATETIME, { locale: EN, style: 'compact' }),
    );
  });

  it('⚠️ does NOT interpret a date PATTERN on this arm either', () => {
    expect(measure(IN_WINDOW_DATETIME, 'YYYY-MM-DD')).toBe(measure(IN_WINDOW_DATETIME));
  });

  // ── The guard against the other fake fix ──────────────────────────────────
  it('⭐ leaves an UNSTYLED datetime on the verbose default face', () => {
    // Wiring the arm to `formatRelativeDate` unconditionally passes legs 1 and
    // 2 as well. It fails here: with no `format`, an in-window datetime must
    // still render the full absolute face, time included.
    expect(measure(IN_WINDOW_DATETIME)).toBe(formatDateTime(IN_WINDOW_DATETIME, { locale: EN }));
    expect(measure(IN_WINDOW_DATETIME)).not.toBe(
      formatRelativeDate(IN_WINDOW_DATETIME, { locale: EN }),
    );
  });

  it('follows the display locale on every honoured style', () => {
    for (const style of ['short', 'relative', undefined]) {
      expect(measure(IN_WINDOW_DATETIME, style)).not.toBe(
        formatMeasure(IN_WINDOW_DATETIME, style, undefined, undefined, 'de-DE'),
      );
    }
  });
});
