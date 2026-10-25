/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6759 — a gantt whose date range is UNUSABLE refuses loudly, naming
 * the value that made it unusable, instead of crashing or drawing nonsense.
 *
 * ## The two defects, and why they are one card
 *
 * objectui#6750 taught the gantt branch about the EMPTY list. Two other input
 * classes were left, and they failed in OPPOSITE directions — which is itself
 * the evidence that no policy existed yet, and the reason triage refused to let
 * them be fixed one at a time:
 *
 *   1. A date that does not PARSE crashed the render. `calculateDateRange`
 *      reduced `NaN` into `Math.min`, and `new Date(NaN).toISOString()` throws
 *      `RangeError: Invalid time value` — #6750's crash site and #6750's
 *      signature, on a different input class.
 *   2. An INVERTED author-pinned range drew confident nonsense. The axis guard
 *      in `generateTimeScaleHeaders` refuses an inverted range by emitting no
 *      headers, so the header row had zero cells — but the row loop under it
 *      still ran, and `calculateBarDimensions` divided by a NEGATIVE
 *      `totalDuration`. No error, no diagnostic.
 *
 * Measured on this card's base b98352a15, with a throwaway probe before any
 * change. Five inputs, five different ways to be wrong, one policy:
 *
 *     CASE-1  startDate 'not-a-date'      -> RangeError: Invalid time value
 *     CASE-1b endDate   'also-bad'        -> RangeError: Invalid time value
 *     CASE-1c endDate   absent            -> RangeError: Invalid time value
 *     CASE-2  min 2030-01-01 / max 2026-03-15
 *             -> axis: [] bars: ["left: 157.9250720461095%; width: -4.322766570605188%;"]
 *     CASE-2b minDate   'whenever'        -> axis: [] bars: [null]
 *
 * ## The trap CASE-2b is here to hold
 *
 * #6750's dev measured that `calculateBarDimensions` can fail SILENTLY: `0 / 0`
 * is `NaN`, the CSSOM rejects `left: NaN%`, and React then emits no `style`
 * attribute at all. CASE-2b is that same silence — `bars: [null]` is a bar
 * element with NO `style`. So a pin written as "the bar no longer carries the
 * bad geometry" would have passed on the unfixed code, for the wrong reason.
 * Every assertion below is therefore positive about the diagnostic and counts
 * BAR ELEMENTS, never the presence or absence of a style attribute.
 *
 * ## The policy is copied, not invented
 *
 * Triage (2026-08-29) ruled that only the WORDING was ever a policy question
 * and that it already had a precedent one file away: objectui#6655 refuses the
 * object-bound gantt with a `role="alert"` diagnostic. This is that shape.
 * 「不要崩」 and 「不要自信地画错」 are correctness floors; the sentence the author
 * reads is #6655's, reused.
 *
 * ## What is deliberately NOT here
 *
 * `generateTimeScaleHeaders` is untouched — pin 7 holds its refusal exactly as
 * objectui#6750's pin 5a left it. The fix refuses ABOVE it rather than relaxing
 * it, and #6750's `emptyGanttDateRange` sentinel is NOT widened to swallow
 * these (pin 6): an empty list is an ordinary state, an unparseable value is an
 * author error, and substituting a plausible range for the second is the
 * consumer-side tolerance both cards rejected.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectTimeline } from '../ObjectTimeline';
import { TimelineRenderer, generateTimeScaleHeaders } from '../renderer';
import { TIMELINE_DEFAULT_TRANSLATIONS } from '../useTimelineTranslation';

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
    useObjectLabel: () => ({
      fieldOptionLabel: (_o: string, _f: string, _v: string, fb: string) => fb,
      translateOptions: (_o: string, _f: string, opts: unknown[]) => opts,
      fieldLabel: (_o: string, _f: string, fb: string) => fb,
    }),
  };
});

const TESTID = 'timeline-unusable-date-range';

/** The axis header cells the gantt branch emits, in order. */
const axisOf = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('.border-r.text-xs.font-medium.text-center')).map(
    (n) => n.textContent ?? '',
  );

/**
 * How many bar ELEMENTS exist — not their geometry.
 *
 * The count, deliberately: a bar whose geometry is `NaN` carries no `style`
 * attribute at all, so any assertion phrased over styles reads identically for
 * "the bar is gone" and "the bar is there and broken". See CASE-2b in the
 * header.
 */
const barCountOf = (container: HTMLElement): number =>
  container.querySelectorAll('.absolute.h-8.rounded-md').length;

/** Every bar's inline geometry, in order — for the unchanged-normal-path pin. */
const barStylesOf = (container: HTMLElement): (string | null)[] =>
  Array.from(container.querySelectorAll('.absolute.h-8.rounded-md')).map((n) =>
    (n as HTMLElement).getAttribute('style'),
  );

/** The diagnostic's text, or `null` when the gantt rendered instead. */
const diagnosticOf = (container: HTMLElement): string | null => {
  const el = container.querySelector(`[data-testid="${TESTID}"]`);
  return el ? el.textContent ?? '' : null;
};

const gantt = (schema: Record<string, unknown>) =>
  render(<TimelineRenderer schema={{ type: 'timeline', variant: 'gantt', ...schema } as any} />);

/** One legitimate row — the thing that is NOT at fault in the case-2 inputs. */
const GOOD_ROW = {
  label: 'Backend',
  items: [{ title: 'API Design', startDate: '2024-01-01', endDate: '2024-03-01' }],
};

describe('pin 1 — a malformed row date refuses instead of throwing (objectui#6759 case 1)', () => {
  const MALFORMED = {
    items: [{ label: 'R', items: [{ title: 'T', startDate: 'not-a-date', endDate: 'also-bad' }] }],
  };

  it('renders instead of raising `RangeError: Invalid time value`', () => {
    // The crash itself, in one assertion. On the base this call threw out of
    // `calculateDateRange`.
    expect(() => gantt(MALFORMED)).not.toThrow();
  });

  it('the diagnostic NAMES the offending value and where it was authored', () => {
    gantt(MALFORMED);

    const el = screen.getByTestId(TESTID);
    // #6655's shape, copied: an alert, not a silent panel.
    expect(el.getAttribute('role')).toBe('alert');

    const text = el.textContent ?? '';
    // Naming the VALUE is the whole ruling — a diagnostic that only said "bad
    // date" would satisfy "does not crash" and none of what was asked for.
    expect(text, 'the diagnostic did not name the offending value').toContain('"not-a-date"');
    // …and where the author wrote it.
    expect(text, 'the diagnostic did not name the authored path').toContain(
      'items[0].items[0].startDate',
    );
  });

  it('draws no chart in its place — no axis, no bars', () => {
    const { container } = gantt(MALFORMED);
    expect(axisOf(container)).toEqual([]);
    expect(barCountOf(container), 'a bar was drawn from an unusable range').toBe(0);
  });

  it('names the SECOND date when that is the one at fault', () => {
    // The scan reports the first fault it meets, so a valid `startDate` beside
    // a broken `endDate` must move the report to `endDate` — otherwise the
    // "names the offending value" guarantee is only true for the first field.
    const { container } = gantt({
      items: [{ label: 'R', items: [{ title: 'T', startDate: '2024-01-01', endDate: 'also-bad' }] }],
    });
    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('"also-bad"');
    expect(text).toContain('items[0].items[0].endDate');
  });

  it('an ABSENT date is the same input class and is named as `undefined`', () => {
    // Measured on the base as CASE-1c: `new Date(undefined)` is also an invalid
    // date, so a row item that merely OMITS `endDate` crashed the render too.
    // It is not a widening — any guard phrased as "every date must parse"
    // covers it, and excluding it would mean writing extra code to keep one
    // input class crashing.
    const { container } = gantt({
      items: [{ label: 'R', items: [{ title: 'T', startDate: '2024-01-01' }] }],
    });
    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('items[0].items[0].endDate');
    // Spelled as itself, so a forgotten key reads differently from an empty one.
    expect(text).toContain('undefined');
    expect(barCountOf(container)).toBe(0);
  });

  it('an EMPTY-STRING date is visible in the diagnostic rather than vanishing', () => {
    // The reason values are quoted: unquoted, `endDate: ''` would render as a
    // sentence with a hole in it and the author would learn nothing.
    const { container } = gantt({
      items: [{ label: 'R', items: [{ title: 'T', startDate: '2024-01-01', endDate: '' }] }],
    });
    expect(diagnosticOf(container) ?? '').toContain('""');
  });
});

describe('pin 2 — an inverted pinned range refuses instead of drawing nonsense (objectui#6759 case 2)', () => {
  const INVERTED = { items: [GOOD_ROW], minDate: '2030-01-01', maxDate: '2026-03-15' };

  it('the diagnostic names BOTH ends of the inverted range', () => {
    gantt(INVERTED);

    const el = screen.getByTestId(TESTID);
    expect(el.getAttribute('role')).toBe('alert');

    const text = el.textContent ?? '';
    expect(text).toContain('"2030-01-01"');
    expect(text).toContain('"2026-03-15"');
  });

  it('the negative-width bar is GONE — counted, not read off a style attribute', () => {
    const { container } = gantt(INVERTED);

    // Measured on the base:
    //   CASE-2 axis: [] bars: ["left: 157.9250720461095%; width: -4.322766570605188%;"]
    // The bar ELEMENT count is what this asserts. A style-shaped assertion
    // would also pass on a bar whose geometry became `NaN`, which is a
    // different defect wearing the same clothes (see CASE-2b, pin 3).
    expect(barCountOf(container), 'a bar was still drawn on an inverted range').toBe(0);
    // The zero-column axis the bar used to hang under is gone with it.
    expect(axisOf(container)).toEqual([]);
    expect(screen.queryByText('API Design')).toBeNull();
  });

  it('one pinned end is enough to invert the range', () => {
    // Only a pin can invert it — `calculateDateRange` orders its pair with
    // `Math.min`/`Math.max`. Pinning just `minDate` past the rows' own end is
    // the cheapest way an author gets there.
    const { container } = gantt({ items: [GOOD_ROW], minDate: '2030-01-01' });
    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('"2030-01-01"');
    expect(text).toContain('"2024-03-01"');
    expect(barCountOf(container)).toBe(0);
  });

  it('a DEGENERATE range is not inverted and still renders (objectui#6750 boundary)', () => {
    // `minDate === maxDate` is #6750's one-bucket axis, and the guard is `>`
    // rather than `>=` precisely so it keeps rendering. This is the boundary
    // between the two cards and the assertion that stops this one eating the
    // other's case.
    const { container } = gantt({ items: [GOOD_ROW], minDate: '2024-02-01', maxDate: '2024-02-01' });

    expect(diagnosticOf(container), 'the degenerate range was refused as inverted').toBeNull();
    expect(axisOf(container)).toEqual(['Feb 2024']);
    // Re-derived by objectui#11079: the bar is measured on the axis the header
    // draws, February 2024, 29 days. API Design runs January 1st through March
    // 1st, 61 days now that a date-only end is drawn through its day
    // (objectui#11112), starting 31 days before it, so it overhangs the pinned
    // range on both sides, as any bar wider than a pinned range does.
    expect(barStylesOf(container)).toEqual(['left: -106.89655172413792%; width: 210.3448275862069%;']);
  });
});

describe('pin 3 — an unparseable PINNED date refuses too (objectui#6759, the silent one)', () => {
  it('names the pinned key and its value', () => {
    // Measured on the base as CASE-2b: `axis: [] bars: [null]`. A pinned value
    // never reaches `calculateDateRange` — the caller resolves
    // `schema.minDate || dateRange.minDate` afterwards — so this input did not
    // crash. It failed the other way, silently, which is worse.
    const { container } = gantt({ items: [GOOD_ROW], minDate: 'whenever' });

    const el = screen.getByTestId(TESTID);
    expect(el.getAttribute('role')).toBe('alert');
    const text = el.textContent ?? '';
    expect(text).toContain('"whenever"');
    expect(text).toContain('minDate');

    // The bar that used to be there with no `style` at all.
    expect(barCountOf(container)).toBe(0);
  });

  it('an unparseable `maxDate` is caught on the same scan', () => {
    const { container } = gantt({ items: [GOOD_ROW], maxDate: 'sometime' });
    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('"sometime"');
    expect(text).toContain('maxDate');
  });

  it('an EMPTY pinned date is not a fault — the caller discards it', () => {
    // `schema.minDate || dateRange.minDate`: an empty string is falsy, so the
    // computed range is used and the chart is correct. Judging a value the
    // render never reads would refuse a gantt that draws fine.
    const { container } = gantt({ items: [GOOD_ROW], minDate: '', maxDate: '' });

    expect(diagnosticOf(container), 'an ignored empty pin was refused').toBeNull();
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    expect(barCountOf(container)).toBe(1);
  });
});

describe('pin 4 — the guard is gantt-only (objectui#6759)', () => {
  it('a malformed date on the VERTICAL variant is untouched', () => {
    // The other variants never build a date range; `formatDate` handles their
    // dates on its own terms. Refusing there would be this card reaching past
    // its own defect.
    const { container } = render(
      <TimelineRenderer
        schema={
          { type: 'timeline', variant: 'vertical', items: [{ title: 'T', time: 'not-a-date' }] } as any
        }
      />,
    );

    expect(diagnosticOf(container), 'the gantt guard fired on a vertical timeline').toBeNull();
    expect(screen.getByText('T')).toBeDefined();
  });
});

describe('pin 5 — `ObjectTimeline` reaches the same guard (objectui#6759)', () => {
  it('an AUTHORED gantt with a malformed date refuses through the object-bound entry point', () => {
    // `items` authored means `ObjectTimeline` is a pass-through, so #6655's
    // composed-path refusal correctly does not fire and the schema reaches
    // `TimelineRenderer`. Both entry points crashed identically on the base;
    // both must refuse identically now.
    const schema = {
      type: 'timeline',
      variant: 'gantt',
      items: [{ label: 'R', items: [{ title: 'T', startDate: 'not-a-date', endDate: 'also-bad' }] }],
    };
    const { container } = render(<ObjectTimeline schema={schema as any} />);

    expect(diagnosticOf(container) ?? '').toContain('"not-a-date"');
    // #6655's diagnostic belongs to the COMPOSED path and must stay away.
    expect(
      screen.queryByTestId('timeline-unsupported-variant'),
      "#6655's refusal fired on an authored gantt",
    ).toBeNull();
  });
});

describe('pin 6 — the healthy path and #6750 are untouched (objectui#6759)', () => {
  /** #6750's pin 4 fixture, and its baseline captured on b76ca6764. */
  const GANTT_ROWS = [
    {
      label: 'Backend Development',
      items: [
        { title: 'API Design', startDate: '2024-01-01', endDate: '2024-01-31', variant: 'success' },
        { title: 'Implementation', startDate: '2024-02-01', endDate: '2024-03-31', variant: 'info' },
      ],
    },
    {
      label: 'Frontend Development',
      items: [
        { title: 'UI Design', startDate: '2024-01-15', endDate: '2024-02-15', variant: 'warning' },
      ],
    },
  ];

  it('a valid gantt draws the same axis and the same bar geometry as before this card', () => {
    const { container } = gantt({ scale: 'month', items: GANTT_ROWS });

    expect(diagnosticOf(container), 'the guard fired on a perfectly good gantt').toBeNull();
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    // The full float spelling, same as #6750's pin 4: a guard that rounded,
    // clamped or short-circuited the arithmetic would pass a tolerance
    // assertion and fail this one. Re-derived by objectui#11079 on the one
    // axis, January 1st to the end of March 2024, 91 days, and again by
    // objectui#11112, which draws a date-only end through its day: see
    // #6750's pin 4.
    expect(barStylesOf(container)).toEqual([
      'left: 0%; width: 34.065934065934066%;',
      'left: 34.065934065934066%; width: 65.93406593406593%;',
      'left: 15.384615384615385%; width: 35.16483516483517%;',
    ]);
  });

  it("#6750's EMPTY gantt still gets its sentinel, not this card's refusal", () => {
    // The hazard in both directions: this card's guard swallowing the empty
    // state, or #6750's sentinel being widened to swallow an unparseable value.
    // An empty list has no dates to be unparseable, so it must pass straight
    // through to the sentinel.
    const { container } = gantt({ items: [] });

    expect(diagnosticOf(container), "this card's guard ate #6750's empty state").toBeNull();
    expect(axisOf(container).length, 'the empty gantt lost its one-bucket axis').toBe(1);
    expect(barCountOf(container)).toBe(0);
  });
});

describe('pin 7 — `generateTimeScaleHeaders` was NOT relaxed (objectui#6759)', () => {
  it('still refuses an unparseable or inverted range by drawing nothing', () => {
    // The fix refuses ABOVE this function; the function itself keeps the
    // verdict objectui#6750 recorded in its docstring. Re-pinned here because
    // this card is the one that could have been tempted to relax it instead —
    // and because it is exported and called directly, so it is not dead code.
    expect(generateTimeScaleHeaders('month', '2030-01-01', '2026-03-15')).toEqual([]);
    expect(generateTimeScaleHeaders('month', 'not-a-date', '2026-03-15')).toEqual([]);
    expect(generateTimeScaleHeaders('month', '', '')).toEqual([]);
  });

  it('and the gantt branch can no longer reach that refusal', () => {
    // The invariant the guard buys: every input that used to produce a
    // zero-column axis now produces a diagnostic instead. Both of them, read as
    // one statement.
    for (const schema of [
      { items: [GOOD_ROW], minDate: '2030-01-01', maxDate: '2026-03-15' },
      { items: [GOOD_ROW], minDate: 'whenever' },
      { items: [{ label: 'R', items: [{ title: 'T', startDate: 'not-a-date', endDate: 'x' }] }] },
    ]) {
      const { container, unmount } = gantt(schema);
      expect(diagnosticOf(container), `no diagnostic for ${JSON.stringify(schema)}`).not.toBeNull();
      unmount();
    }
  });
});

describe('pin 8 — the diagnostic strings are translatable (objectui#6759)', () => {
  it('both keys live in the package fallback table with their holes intact', () => {
    // The provider-less last resort — unit tests and embeds render through it,
    // and it is the table `createSafeTranslation` is built from. Holes rather
    // than concatenation, for the word-order reason `timeline.scale.*` states.
    const malformed = TIMELINE_DEFAULT_TRANSLATIONS['timeline.gantt.unusableRange.malformedDate'];
    expect(malformed).toContain('{{path}}');
    expect(malformed).toContain('{{value}}');

    const inverted = TIMELINE_DEFAULT_TRANSLATIONS['timeline.gantt.unusableRange.inverted'];
    expect(inverted).toContain('{{minDate}}');
    expect(inverted).toContain('{{maxDate}}');
  });
});
