/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6781 — a gantt date must BE a date type; the rest is refused.
 *
 * ## The rule, as a rule
 *
 * Maintainer ruling 2026-08-30, option A of three. The accept set is
 *
 *     string  |  FINITE number  |  Date
 *
 * and everything else is refused through #6759 / #6770's existing loud
 * diagnostic — no second channel, no new i18n key. `renderer.tsx`'s
 * `isGanttDateType` carries the rule and the reasoning; this file pins it.
 *
 * ## What was wrong
 *
 * `new Date(x)` runs ToPrimitive on anything, so it turns values that are not
 * dates at all into instants. Measured on this card's base fab4802e3, one row
 * item and a throwaway probe, `startDate: '2024-01-01'` with `endDate` varied:
 *
 *     endDate: false          -> NO diagnostic, axis 649 columns
 *                                (Jan 1970 … Jan 2024), bars
 *                                ["left: 100%; width: -100%;"]
 *     endDate: true           -> NO diagnostic, axis 649 columns, bars
 *                                ["left: 100%; width: -99.99999999994131%;"]
 *     endDate: ['2024-01-01'] -> NO diagnostic, axis ["Jan 2024"], bars
 *                                ["left: 0%; width: 100%;"]
 *     endDate: {toString: () => '2024-01-01'}
 *                             -> NO diagnostic, axis ["Jan 2024"]
 *     endDate: 0n             -> THREW TypeError, uncaught, mid-render
 *     endDate: Symbol('s')    -> THREW TypeError, uncaught, mid-render
 *
 * The `false` reading is byte-identical to the `endDate: 0` symptom the card
 * was filed on — the fifty-four-year axis and the negative-width bar — which
 * is the point: the chart could not tell "the author means the epoch" from
 * "a mapping layer emitted a boolean into a date column".
 *
 * Two of those base readings are CRASHES, not silent renders: `new Date` throws
 * on a `bigint` and on a `symbol`, so the guard itself died while trying to
 * report. Judging the TYPE before parsing is what makes the predicate total.
 *
 * ## `0` is KEPT — the one behaviour this card must NOT change
 *
 * The ruling is explicit. `0` is a finite number, so it is accepted and still
 * draws the epoch: under a `startDate: 1704067200000` encoding, `0` really is a
 * date. Refusing it would take away a real capability to catch a hypothetical
 * input. Pins 3 and 4 below are that control, and they include the card's own
 * filed `endDate: 0` reading, asserted UNCHANGED down to the bar geometry.
 *
 * ## Assertions count BAR ELEMENTS, never styles
 *
 * #6759's rule, inherited through #6770: a bar whose geometry is `NaN` carries
 * NO `style` attribute at all (the CSSOM rejects `left: NaN%`), so an assertion
 * phrased over styles reads identically for "the bar is gone" and "the bar is
 * there and broken". Refusal assertions are positive about the diagnostic and
 * count elements. Styles are read only on the paths that must stay UNCHANGED,
 * where their exact float spelling is the whole point.
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

describe('pin 1 — the REJECT half of the type rule (objectui#6781)', () => {
  /**
   * Every one of these rendered a chart on the base with NO diagnostic at all.
   * They are the accept/reject move this card makes, one row per input class.
   */
  const newlyRefused: [string, unknown][] = [
    ['false — a boolean in a date column, the filed shape', false],
    ['true — the same class, one millisecond later', true],
    ["['2024-01-01'] — an array whose toString happens to parse", ['2024-01-01']],
    ['[0] — an array that parsed as the YEAR 2000', [0]],
    ['{ toString } — any object with a plausible spelling', { toString: () => '2024-01-01' }],
  ];

  for (const [label, value] of newlyRefused) {
    it(`refuses ${label}`, () => {
      const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: value }) });

      const el = screen.getByTestId(TESTID);
      // #6655's shape by way of #6759/#6770: an alert, not a silent panel, and
      // the SAME channel — no second diagnostic was invented for type faults.
      expect(el.getAttribute('role')).toBe('alert');
      expect(el.textContent ?? '', 'the diagnostic did not name the authored path').toContain(
        'items[0].items[0].endDate',
      );
      // The 1970 axis and the bar are both gone. Counted, not read off a style.
      expect(axisOf(container), 'a chart was still drawn from a non-date').toEqual([]);
      expect(barCountOf(container)).toBe(0);
      expect(screen.queryByText('T')).toBeNull();
    });
  }

  it('refuses a non-finite number — the FINITE half, stated rather than inherited', () => {
    // `new Date(Infinity)` is already an invalid date, so this verdict is
    // unchanged from the base. It is pinned because the rule now says "finite"
    // out loud, and a later reader must be able to see that the words and the
    // behaviour agree.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: value }) });
      expect(diagnosticOf(container) ?? '', `${value} was accepted as a gantt date`).toContain(
        'items[0].items[0].endDate',
      );
      expect(barCountOf(container)).toBe(0);
    }
  });

  it('an invalid `Date` OBJECT is still refused — the type gate does not excuse it', () => {
    // `new Date(NaN)` passes `instanceof Date` and is then refused by the parse
    // check, which is exactly where that question belongs. The hazard this pins
    // is a type gate written as an early RETURN instead of an early REJECT.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: new Date(Number.NaN) }),
    });

    expect(diagnosticOf(container) ?? '').toContain('items[0].items[0].endDate');
    expect(barCountOf(container)).toBe(0);
  });
});

describe('pin 2 — the guard no longer CRASHES while reporting (objectui#6781)', () => {
  /**
   * `new Date` throws a `TypeError` on these two rather than returning an
   * invalid date, so on the base the render died inside `findUnusableGanttDate`
   * itself — a blank screen where a named diagnostic belongs. Judging the type
   * first is what makes the predicate total.
   */
  it('a bigint date is named, not thrown', () => {
    // Base: THREW TypeError: Cannot convert a BigInt value to a number.
    const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: 0n }) });

    expect(diagnosticOf(container) ?? '').toContain('items[0].items[0].endDate');
    expect(barCountOf(container)).toBe(0);
  });

  it('a symbol date is named, not thrown — and reaches `spellGanttDateValue`’s symbol branch', () => {
    // Base: THREW TypeError: Cannot convert a Symbol value to a number. That
    // branch was written by #6759 as "total by construction" and documented as
    // unreachable; the type rule is what reaches it.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: Symbol('oops') }),
    });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('items[0].items[0].endDate');
    expect(text, 'the symbol was not spelled as itself').toContain('Symbol(oops)');
    expect(barCountOf(container)).toBe(0);
  });
});

describe('pin 3 — `0` IS KEPT: the control that must stay green (objectui#6781)', () => {
  it('the card’s own `endDate: 0` reading still draws, down to the bar geometry', () => {
    // This is the measurement the card was filed on — axis 649 columns
    // Jan 1970 … Jan 2024, bars ["left: 100%; width: -100%;"] — and the ruling
    // makes it LEGAL. `0` is a finite number and therefore a date. If a future
    // widening of the accept set catches `0` on its way past, this row is the
    // one that goes red, and it is the one that must not.
    const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: 0 }) });

    expect(diagnosticOf(container), '`0` was refused — the ruling keeps it').toBeNull();
    const axis = axisOf(container);
    expect(axis.length).toBe(649);
    expect(axis[0]).toBe('Jan 1970');
    expect(axis[axis.length - 1]).toBe('Jan 2024');
    // Re-derived by objectui#11079: the axis the headers draw runs from
    // January 1st 1970 to the end of January 2024, 19754 days, and the bar
    // runs backwards from day 19723 to day 0. The card's reading was the same
    // bar on the 19723 days up to January 1st 2024: `left: 100%; width: -100%`.
    expect(barStylesOf(container)).toEqual(['left: 99.84306975802369%; width: -99.84306975802369%;']);
  });

  it('`0` as a MEANINGFUL epoch start draws a correct chart', () => {
    // The capability the ruling refused to take away, in the shape an author
    // actually writes it: a `startDate: 1704067200000`-style millisecond
    // encoding whose first row happens to begin at the epoch.
    const { container } = gantt({
      scale: 'month',
      items: rowWith({ startDate: 0, endDate: Date.UTC(1970, 2, 1) }),
    });

    expect(diagnosticOf(container), 'an epoch-anchored chart was refused').toBeNull();
    expect(axisOf(container)).toEqual(['Jan 1970', 'Feb 1970', 'Mar 1970']);
    // Re-derived by objectui#11079: the bar runs January 1st to March 1st
    // 1970, 59 days, on the axis the headers draw, January 1st to the end of
    // March, 90 days.
    expect(barStylesOf(container)).toEqual(['left: 0%; width: 65.55555555555556%;']);
  });
});

describe('pin 4 — the rest of the ACCEPT set still renders (objectui#6781)', () => {
  it('a string date renders', () => {
    const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: '2024-03-01' }) });
    expect(diagnosticOf(container)).toBeNull();
    expect(barCountOf(container)).toBe(1);
  });

  it('a finite millisecond timestamp renders', () => {
    // #6770 pin 3's fixture, re-asserted: the type rule must not narrow it.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: Date.UTC(2024, 2, 1) }),
    });
    expect(diagnosticOf(container)).toBeNull();
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    // Re-derived by objectui#11079: January 1st to March 1st 2024, 60 days, on
    // the axis the headers draw, January 1st to the end of March, 91 days.
    expect(barStylesOf(container)).toEqual(['left: 0%; width: 65.93406593406593%;']);
  });

  it('a `Date` instance renders', () => {
    const { container } = gantt({
      items: rowWith({ startDate: new Date('2024-01-01'), endDate: new Date('2024-03-01') }),
    });
    expect(diagnosticOf(container)).toBeNull();
    expect(barCountOf(container)).toBe(1);
  });

  it('a valid gantt draws the same axis and the same bar geometry as before this card', () => {
    // #6759 pin 6's fixture and its baseline, inherited through #6770: a guard
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

    expect(diagnosticOf(container), 'the type rule fired on a perfectly good gantt').toBeNull();
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
});

describe('pin 5 — `null` / `undefined` are SUBSUMED, and nothing an author sees moves', () => {
  /**
   * The type rule is strictly wider than #6770's `value === null` and #6759's
   * "does it parse", so both now come out of the SAME arm. The hazard that
   * pins: a rewrite that reports them twice, re-routes them to a different
   * message, or spells them alike.
   */
  it('a `null` row date is still refused and still spelled `null` (objectui#6770)', () => {
    const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: null }) });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('null');
    expect(text).toContain('items[0].items[0].endDate');
    expect(barCountOf(container)).toBe(0);
  });

  it('an ABSENT row date is still refused and still spelled `undefined` (objectui#6759)', () => {
    const { container } = gantt({ items: rowWith({ startDate: '2024-01-01' }) });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('undefined');
    expect(text).not.toContain('null');
    expect(text).toContain('items[0].items[0].endDate');
  });

  it('exactly ONE diagnostic is rendered — the wider rule does not double-report', () => {
    const { container } = gantt({ items: rowWith({ startDate: null, endDate: false }) });

    expect(container.querySelectorAll(`[data-testid="${TESTID}"]`).length).toBe(1);
    // Rows before pins, first fault wins: the `null` startDate is reached first.
    expect(diagnosticOf(container) ?? '').toContain('items[0].items[0].startDate');
  });

  it('an unparseable STRING is still named by its quoted value (objectui#6759)', () => {
    const { container } = gantt({ items: rowWith({ startDate: 'not-a-date', endDate: 'also-bad' }) });
    expect(diagnosticOf(container) ?? '').toContain('"not-a-date"');
  });
});

describe('pin 6 — the PINNED path keeps its `||` asymmetry (objectui#6759 boundary)', () => {
  it('a FALSY non-date pin is still discarded, not refused', () => {
    // The caller resolves `schema.minDate || dateRange.minDate`, so `false` and
    // `0` never reach the render at all. Judging a value nothing reads would
    // refuse a chart that draws correctly — #6759's empty-string rule and
    // #6770's null-pin rule, unchanged by the type rule.
    for (const pin of [false, 0, '']) {
      const { container } = gantt({ items: [GOOD_ROW], minDate: pin, maxDate: pin });
      expect(diagnosticOf(container), `a discarded ${String(pin)} pin was refused`).toBeNull();
      expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
      // Re-derived by objectui#11079 and again by objectui#11112: January 1st
      // through March 1st, 61 of the axis's 91 days.
      expect(barStylesOf(container)).toEqual(['left: 0%; width: 67.03296703296702%;']);
    }
  });

  it('a TRUTHY non-date pin is refused and named at its authored path', () => {
    // Base: `minDate: ['2024-01-01']` coerced to a parseable string and drew a
    // chart. It is a pin the author wrote and the render reads, so it is judged.
    const { container } = gantt({ items: [GOOD_ROW], minDate: ['2024-01-01'] });

    expect(diagnosticOf(container) ?? '').toContain('minDate');
    expect(barCountOf(container)).toBe(0);
  });
});

describe('pin 7 — the neighbouring cards are untouched (objectui#6750, objectui#6655)', () => {
  it("#6750's EMPTY gantt still gets its sentinel rather than this card's refusal", () => {
    const { container } = gantt({ items: [] });

    expect(diagnosticOf(container), "the type rule ate #6750's empty state").toBeNull();
    expect(axisOf(container).length, 'the empty gantt lost its one-bucket axis').toBe(1);
    expect(barCountOf(container)).toBe(0);
  });

  it('a non-date on the VERTICAL variant is untouched', () => {
    // The gantt guard stays gantt-only, as #6759 pin 4 and #6770 pin 4 have it:
    // the other variants never build a date range.
    const { container } = render(
      <TimelineRenderer
        schema={{ type: 'timeline', variant: 'vertical', items: [{ title: 'T', time: false }] } as any}
      />,
    );

    expect(diagnosticOf(container), 'the gantt guard fired on a vertical timeline').toBeNull();
    expect(screen.getByText('T')).toBeDefined();
  });

  it('`ObjectTimeline` reaches the same refusal on an authored gantt', () => {
    // `items` authored means `ObjectTimeline` is a pass-through, so #6655's
    // composed-path refusal correctly stays away and the schema reaches
    // `TimelineRenderer`. Both entry points drew the 1970 chart on the base.
    const { container } = render(
      <ObjectTimeline
        schema={
          {
            type: 'timeline',
            variant: 'gantt',
            items: rowWith({ startDate: '2024-01-01', endDate: false }),
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
