/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6770 — a `null` gantt date is refused, not silently drawn at 1970.
 *
 * ## What was wrong
 *
 * `new Date(null).getTime()` is `0`, not `NaN`. That is the Unix epoch, not an
 * invalid date, so a `null` date passed objectui#6759's parse guard untouched
 * and reached the arithmetic as `1970-01-01`. Measured on this card's base
 * c6732825d — i.e. WITH #6759's guards already in the tree — with a throwaway
 * probe, since no pin covered this input:
 *
 *     CASE-NULL-END   endDate: null   -> alert: null, axis 649 columns
 *                     (Jan 1970 … Jan 2024), bars ["left: 100%; width: -100%;"]
 *     CASE-NULL-START startDate: null -> alert: null, axis 651 columns,
 *                     bars ["left: 0%; width: 100%;"]
 *     CASE-NULL-BOTH  both null       -> alert: null, axis ["Jan 1970"],
 *                     bars ["left: 0%; width: 100%;"]
 *     CASE-PIN-NULL   minDate/maxDate null -> the rows' own range, correct
 *
 * The filed case is the first: a fifty-four-year axis and a bar with NEGATIVE
 * width, hanging off the right-hand edge, with no diagnostic. The other two are
 * the reason the answer is a refusal rather than a repair — they do not even
 * look broken. A full-width bar under a one-bucket `Jan 1970` axis is a chart a
 * reader would believe.
 *
 * ## The arm taken, and the pin that decided it
 *
 * Three readings were defensible on paper — refuse, treat as open-ended, treat
 * as absent — and the card refused to let a fixer pick one silently. It did not
 * need a fresh ruling: #6759 ALREADY refuses this input class one spelling
 * over. `new Date(undefined)` is `NaN`, so a row item that merely omits
 * `endDate` is refused and named, pinned next door as "an ABSENT date is the
 * same input class and is named as `undefined`"
 * (`timeline-gantt-unusable-date-range.test.tsx`, pin 1). `null` is that same
 * absence with a different spelling: a record mapping that omits the key and
 * one that emits `null` describe the same unset field upstream. Rendering them
 * differently would make the chart depend on how a mapping layer spells "no
 * value", which no author writes and none can predict — so the refusal is
 * consistency with an existing pin, not a new policy.
 *
 * The other two arms fail the test both neighbouring cards already applied:
 * "open-ended" is a new rendering behaviour that would need a spec key of its
 * own rather than a meaning smuggled into `null`, and "fall back to
 * `startDate`" substitutes a plausible value for one the document does not
 * carry — the consumer-side tolerance #6750 and #6759 both rejected.
 *
 * ## The wording is reused, deliberately
 *
 * The diagnostic is #6759's `timeline.gantt.unusableRange.malformedDate`, whose
 * `{{value}}` hole `spellGanttDateValue` already fills as `null` — a branch
 * #6759 wrote for "one they wrote as empty" and that nothing could reach until
 * this card. A `null`-specific sentence would be a new key in all ten locale
 * packs (`packages/i18n`), which is another card's file surface.
 *
 * ## Assertions count BAR ELEMENTS, never styles
 *
 * #6759's rule, inherited: a bar whose geometry is `NaN` carries NO `style`
 * attribute at all (the CSSOM rejects `left: NaN%`), so an assertion phrased
 * over styles reads identically for "the bar is gone" and "the bar is there and
 * broken". Every refusal assertion below is positive about the diagnostic and
 * counts elements. Styles are read only on the paths that must stay UNCHANGED,
 * where their exact float spelling is the point.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectTimeline } from '../ObjectTimeline';
import { TimelineRenderer } from '../renderer';

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

/** How many bar ELEMENTS exist — not their geometry. See the header. */
const barCountOf = (container: HTMLElement): number =>
  container.querySelectorAll('.absolute.h-8.rounded-md').length;

/** Every bar's inline geometry, in order — for the unchanged-path pins only. */
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

/** One row carrying one item, so a case only has to say what is wrong with it. */
const rowWith = (item: Record<string, unknown>) => [{ label: 'R', items: [{ title: 'T', ...item }] }];

/** One legitimate row — the thing that is NOT at fault in the pinned-range cases. */
const GOOD_ROW = {
  label: 'Backend',
  items: [{ title: 'API Design', startDate: '2024-01-01', endDate: '2024-03-01' }],
};

describe('pin 1 — a `null` row date refuses and names itself (objectui#6770)', () => {
  it('a null `endDate` is refused, spelled as `null`, at the path the author wrote it', () => {
    const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: null }) });

    const el = screen.getByTestId(TESTID);
    // #6655's shape by way of #6759: an alert, not a silent panel.
    expect(el.getAttribute('role')).toBe('alert');

    const text = el.textContent ?? '';
    // Spelled as itself. `undefined` and `null` read differently to an author —
    // a key they forgot versus one they wrote as empty — and #6759's
    // `spellGanttDateValue` already keeps them apart.
    expect(text, 'the diagnostic did not name the offending value').toContain('null');
    expect(text, 'the diagnostic did not name the authored path').toContain(
      'items[0].items[0].endDate',
    );
  });

  it('the 649-column 1970 axis and the negative-width bar are BOTH gone', () => {
    // Base reading: axis 649 columns Jan 1970 … Jan 2024, bars
    // ["left: 100%; width: -100%;"]. Counted, not read off a style attribute.
    const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: null }) });

    expect(axisOf(container), 'the 1970 axis survived the refusal').toEqual([]);
    expect(barCountOf(container), 'a bar was drawn from a null date').toBe(0);
    expect(screen.queryByText('T')).toBeNull();
  });

  it('a null `startDate` is refused too — the case that LOOKED fine', () => {
    // Base reading: 651 columns and bars ["left: 0%; width: 100%;"] — a bar
    // with entirely plausible geometry on an axis starting in 1970. Nothing
    // about that render says it is wrong, which is why it is here.
    const { container } = gantt({ items: rowWith({ startDate: null, endDate: '2024-03-01' }) });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('items[0].items[0].startDate');
    expect(text).toContain('null');
    expect(barCountOf(container)).toBe(0);
  });

  it('both dates null names the first one and draws nothing', () => {
    // Base reading: a single `Jan 1970` bucket with a full-width bar — the most
    // believable of the three, and the least true.
    const { container } = gantt({ items: rowWith({ startDate: null, endDate: null }) });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('items[0].items[0].startDate');
    expect(axisOf(container)).toEqual([]);
    expect(barCountOf(container)).toBe(0);
  });

  it('the path is the one the null actually sits at, not a hardcoded first row', () => {
    // The scan reports the first fault it meets. A null on the second item of
    // the second row must be reported THERE — otherwise "names where you wrote
    // it" is only true for a one-row document.
    const { container } = gantt({
      items: [
        { label: 'A', items: [{ title: 'T', startDate: '2024-01-01', endDate: '2024-02-01' }] },
        {
          label: 'B',
          items: [
            { title: 'U', startDate: '2024-01-01', endDate: '2024-02-01' },
            { title: 'V', startDate: '2024-01-01', endDate: null },
          ],
        },
      ],
    });

    expect(diagnosticOf(container) ?? '').toContain('items[1].items[1].endDate');
  });

  it('`ObjectTimeline` reaches the same refusal on an authored gantt', () => {
    // `items` authored means `ObjectTimeline` is a pass-through, so #6655's
    // composed-path refusal correctly stays away and the schema reaches
    // `TimelineRenderer`. Both entry points drew the 1970 chart on the base;
    // both must refuse now.
    const { container } = render(
      <ObjectTimeline
        schema={
          {
            type: 'timeline',
            variant: 'gantt',
            items: rowWith({ startDate: '2024-01-01', endDate: null }),
          } as any
        }
      />,
    );

    expect(diagnosticOf(container) ?? '').toContain('items[0].items[0].endDate');
    expect(
      screen.queryByTestId('timeline-unsupported-variant'),
      "#6655's refusal fired on an authored gantt",
    ).toBeNull();
  });
});

describe('pin 2 — a PINNED null is not judged (objectui#6770 boundary)', () => {
  it('`minDate: null` / `maxDate: null` draw the rows’ own range, with no diagnostic', () => {
    // The caller resolves `schema.minDate || dateRange.minDate`, so a null pin
    // is discarded before anything reads it — exactly like #6759's empty-string
    // pin. Judging a value the render never reads would refuse a chart that
    // draws correctly. Measured on the base and unchanged by this card.
    const { container } = gantt({ items: [GOOD_ROW], minDate: null, maxDate: null });

    expect(diagnosticOf(container), 'a discarded null pin was refused').toBeNull();
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    // Re-derived by objectui#11079: the bar is measured on the axis the headers
    // draw, January 1st to the end of March, 91 days. Re-derived again by
    // objectui#11112: its date-only end is drawn through March 1st, so it runs
    // 61 days and ends one day into the March column.
    expect(barStylesOf(container)).toEqual(['left: 0%; width: 67.03296703296702%;']);
  });
});

describe('pin 3 — the line is `null`, not "coerces to the epoch" (objectui#6770)', () => {
  it('a numeric millisecond timestamp still renders', () => {
    // The reason the test is `value === null` and nothing wider: a number IS a
    // date in this encoding. Refusing numbers to catch `0` would break input
    // that draws correctly today.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: Date.UTC(2024, 2, 1) }),
    });

    expect(diagnosticOf(container), 'a valid numeric timestamp was refused').toBeNull();
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    // Re-derived by objectui#11079: 60 of the axis's 91 days, as pin 2.
    expect(barStylesOf(container)).toEqual(['left: 0%; width: 65.93406593406593%;']);
  });

  it('a `Date` instance still renders', () => {
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: new Date('2024-03-01') }),
    });

    expect(diagnosticOf(container), 'a Date instance was refused').toBeNull();
    expect(barCountOf(container)).toBe(1);
  });
});

describe('pin 4 — the neighbouring cards are untouched (objectui#6759, objectui#6750)', () => {
  it('an ABSENT date is still spelled `undefined`, not `null`', () => {
    // The two spellings are refused for the same reason and must keep reading
    // differently: this card widened WHICH values are refused, not how any of
    // them is named.
    const { container } = gantt({ items: rowWith({ startDate: '2024-01-01' }) });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('undefined');
    expect(text).toContain('items[0].items[0].endDate');
  });

  it('an unparseable date is still named by its quoted value', () => {
    const { container } = gantt({ items: rowWith({ startDate: 'not-a-date', endDate: 'also-bad' }) });

    expect(diagnosticOf(container) ?? '').toContain('"not-a-date"');
  });

  it("#6750's EMPTY gantt still gets its sentinel rather than this card's refusal", () => {
    // An empty list has no dates to be null, so it must pass straight through
    // to the one-bucket sentinel. The hazard in both directions: this guard
    // eating the empty state, or the sentinel being widened to swallow a null.
    const { container } = gantt({ items: [] });

    expect(diagnosticOf(container), "this card's guard ate #6750's empty state").toBeNull();
    expect(axisOf(container).length, 'the empty gantt lost its one-bucket axis').toBe(1);
    expect(barCountOf(container)).toBe(0);
  });

  it('a valid gantt draws the same axis and the same bar geometry as before this card', () => {
    // #6759 pin 6's fixture and its baseline, re-asserted here because a guard
    // that rounded, clamped or short-circuited the arithmetic would pass a
    // tolerance assertion and fail this one.
    const { container } = gantt({
      scale: 'month',
      items: [
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
      ],
    });

    expect(diagnosticOf(container), 'the guard fired on a perfectly good gantt').toBeNull();
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    // Re-derived by objectui#11079 on the one axis, January 1st to the end of
    // March 2024, 91 days, and again by objectui#11112, which draws a
    // date-only end through its day: see #6750's pin 4.
    expect(barStylesOf(container)).toEqual([
      'left: 0%; width: 34.065934065934066%;',
      'left: 34.065934065934066%; width: 65.93406593406593%;',
      'left: 15.384615384615385%; width: 35.16483516483517%;',
    ]);
  });

  it('a `null` date on the VERTICAL variant is untouched', () => {
    // The gantt guard stays gantt-only, as #6759's pin 4 has it: the other
    // variants never build a date range.
    const { container } = render(
      <TimelineRenderer
        schema={{ type: 'timeline', variant: 'vertical', items: [{ title: 'T', time: null }] } as any}
      />,
    );

    expect(diagnosticOf(container), 'the gantt guard fired on a vertical timeline').toBeNull();
    expect(screen.getByText('T')).toBeDefined();
  });
});
