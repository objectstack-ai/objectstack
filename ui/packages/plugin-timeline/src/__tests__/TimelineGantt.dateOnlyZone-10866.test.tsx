/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866, slice 3 — the timeline renderer's gantt variant draws a
 * stored date-only day on that day, in every zone.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * Every read on the gantt branch used the engine's own `Date` parse, which
 * reads a date-only `2026-10-05` as UTC midnight:
 *
 *  - the axis headers (`generateTimeScaleHeaders`) walked that instant with
 *    LOCAL setters and printed it with LOCAL getters, so west of UTC a day
 *    axis over October 5th to 7th read Oct 4, Oct 5, Oct 6, and the schema
 *    catalog's `gantt-style-timeline.json` read Dec 2023 over a plan that
 *    starts on January 1st;
 *  - the computed extent (`calculateDateRange`) printed the UTC day of each
 *    end, and the empty plan's axis (`emptyGanttDateRange`) took the UTC day
 *    as "today";
 *  - the bar geometry (`calculateBarDimensions`), the validity gate
 *    (`findUnusableGanttDate`) and the min-over-max guard read the same
 *    UTC midnight.
 *
 * Slice 2 moved the bar TOOLTIP to the shared step, `toDisplayDate`
 * (`@object-ui/core`, the objectui#10183 convention), so west of UTC the
 * tooltip named the stored day under a header that read the day before. Every
 * read above now takes the same step: a date-only value is local midnight of
 * the day it names, and a value with a time part keeps its instant, which the
 * axis places in the viewer's own day. The extent prints the day from local
 * getters, because a local midnight's `toISOString()` names the day before
 * EAST of UTC — so the Shanghai extent row is green on the base and is the
 * half a parse-only repair would break.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too.
 *
 * `Asia/Shanghai` is the control: east of UTC the UTC-midnight parse already
 * landed on the named day, and an hour-offset "repair" would break it.
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';
import { TimelineRenderer } from '../renderer';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in October — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** A fixed instant: 21:00 on the 5th in the west, 12:00 on the 6th in the east. */
const INSTANT = '2026-10-06T04:00:00.000Z';

/** The named producer: the schema catalog's gantt, which authors date-only rows. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PRODUCER = path.join(
  REPO_ROOT,
  'examples/schema-catalog/src/schemas/plugin-timeline/gantt-style-timeline.json',
);

/** Move this forked process into `zone`. */
function enter(zone: string): void {
  process.env.TZ = zone;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Drawn {
  /** The axis header cells, in order. */
  axis: string[];
  /** Each axis header cell's inline width, in order (objectui#11079). */
  columns: string[];
  /** Each bar's `left` / `width`, in order. */
  bars: Array<{ left: string; width: string }>;
  /** Each bar's tooltip, in order. */
  titles: string[];
  /** The refusal the gantt branch rendered instead, if any. */
  refusal: string | null;
}

/** What the gantt branch draws for `schema`, in `en-US`. */
function draw(schema: Record<string, unknown>): Drawn {
  const { container } = render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <TimelineRenderer schema={{ type: 'timeline', variant: 'gantt', ...schema } as never} />
    </LocalizationProvider>,
  );
  const bars = Array.from(container.querySelectorAll<HTMLElement>('.absolute.h-8.rounded-md'));
  const drawn: Drawn = {
    axis: Array.from(container.querySelectorAll('.border-r.text-xs.font-medium.text-center')).map(
      (n) => n.textContent ?? '',
    ),
    columns: Array.from(
      container.querySelectorAll<HTMLElement>('.border-r.text-xs.font-medium.text-center'),
    ).map((n) => n.style.width),
    bars: bars.map((b) => ({ left: b.style.left, width: b.style.width })),
    titles: bars.map((b) => b.getAttribute('title') ?? ''),
    refusal: container.querySelector('[data-testid="timeline-unusable-date-range"]')?.textContent ?? null,
  };
  cleanup();
  return drawn;
}

/** The producer's document, read from disk rather than copied. */
function producer(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(PRODUCER, 'utf8')) as Record<string, unknown>;
}

/**
 * The producer's inclusive ends land on their month columns' edges
 * (objectui#11112): API Design (January 1st to 31st) ends where the February
 * column begins, and QA Phase (March 1st to April 30th) at the axis's end.
 */
function expectProducerBarsFillTheirMonths(drawn: Drawn): void {
  const pct = (value: string) => Number.parseFloat(value);
  const right = (bar: { left: string; width: string }) => pct(bar.left) + pct(bar.width);
  expect(drawn.bars).toHaveLength(5);
  expect(right(drawn.bars[0])).toBeCloseTo(pct(drawn.columns[0]), 10);
  expect(right(drawn.bars[4])).toBeCloseTo(100, 10);
}

/** Two date-only bars, the axis computed from them: October 5th to 7th. */
const COMPUTED = {
  scale: 'day',
  items: [
    {
      label: 'Build',
      items: [
        { title: 'First', startDate: '2026-10-05', endDate: '2026-10-06' },
        { title: 'Second', startDate: '2026-10-06', endDate: '2026-10-07' },
      ],
    },
  ],
};

/** The same span pinned by the author, with one date-only bar and one instant bar. */
const PINNED_MIXED = {
  scale: 'day',
  minDate: '2026-10-05',
  maxDate: '2026-10-07',
  items: [
    {
      label: 'Mixed',
      items: [
        { title: 'Day', startDate: '2026-10-06', endDate: '2026-10-07' },
        { title: 'Instant', startDate: INSTANT, endDate: '2026-10-06T10:00:00.000Z' },
      ],
    },
  ],
};

/**
 * A pinned date-only start and a pinned instant end on the same UTC day. West
 * of UTC the instant is the evening BEFORE that day, so the axis the headers
 * would walk is inverted there; east of UTC it is not.
 */
const PINNED_EDGE = {
  scale: 'day',
  minDate: '2026-10-06',
  maxDate: '2026-10-06T03:00:00.000Z',
  items: [{ label: 'Edge', items: [{ title: 'Bar', startDate: '2026-10-06', endDate: '2026-10-06' }] }],
};

/** The clock for the empty plan: 13:00 on the 5th in the west, 04:00 on the 6th in the east. */
const EMPTY_CLOCK = '2026-10-05T20:00:00.000Z';

function emptyPlanAxis(): string[] {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(EMPTY_CLOCK));
  return draw({ scale: 'day', items: [] }).axis;
}

describe('timeline gantt, in the suite zone (objectui#10866)', () => {
  it('the producer fixture this pin reads is on disk, and is the gantt it was written for', () => {
    expect(fs.existsSync(PRODUCER), `fixture not found at ${PRODUCER}`).toBe(true);
    const doc = producer();
    expect(doc.variant).toBe('gantt');
    expect(doc.scale).toBe('month');
  });

  it('the producer draws a month axis from January to April, and its first tooltip names January 1st', () => {
    const drawn = draw(producer());
    expect(drawn.axis).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024', 'Apr 2024']);
    expect(drawn.titles[0]).toBe('API Design\n1/1/2024 - 1/31/2024');
  });

  it('a computed day axis over date-only bars reads their days', () => {
    const drawn = draw(COMPUTED);
    expect(drawn.axis).toEqual(['Oct 5', 'Oct 6', 'Oct 7']);
    // objectui#11079: the bars are measured on the axis the headers draw,
    // October 5th to the end of October 7th, three days — not on the two days
    // from the first midnight to the last, which put the second bar at 50%.
    // objectui#11112: each date-only end is drawn through its day, so each bar
    // is two days wide and the second ends at the axis's end.
    expect(drawn.bars).toEqual([
      { left: '0%', width: `${(2 / 3) * 100}%` },
      { left: `${(1 / 3) * 100}%`, width: `${(2 / 3) * 100}%` },
    ]);
  });

  it('a day its month does not have is refused by the validity gate, as the shared step refuses it, not drawn on March 2nd', () => {
    const drawn = draw({
      scale: 'day',
      items: [{ label: 'Row', items: [{ title: 'Bar', startDate: '2026-02-30', endDate: '2026-03-04' }] }],
    });
    expect(drawn.bars, 'the rolled day was drawn').toEqual([]);
    expect(drawn.refusal ?? '').toContain('items[0].items[0].startDate');
  });

  it('control: a day its month has still draws', () => {
    const drawn = draw({
      scale: 'day',
      items: [{ label: 'Row', items: [{ title: 'Bar', startDate: '2026-02-28', endDate: '2026-03-02' }] }],
    });
    expect(drawn.refusal).toBeNull();
    expect(drawn.axis).toEqual(['Feb 28', 'Mar 1', 'Mar 2']);
  });
});

describe.runIf(DRIVEN)('timeline gantt west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(21);
  });

  it('fixture validity: the engine parse of a date-only string lands on the day before here', () => {
    enter(WEST);
    // Without this the cases below would be green for free.
    expect(new Date('2026-10-05').getDate()).toBe(4);
    expect(new Date('2024-01-01').getFullYear()).toBe(2023);
  });

  it('the producer draws January to April, the months its rows name', () => {
    enter(WEST);
    const drawn = draw(producer());
    expect(drawn.axis).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024', 'Apr 2024']);
    expect(drawn.titles[0]).toBe('API Design\n1/1/2024 - 1/31/2024');
  });

  it('the producer\'s API Design bar, January 1st to 31st, ends where the February column begins (objectui#11112)', () => {
    enter(WEST);
    expectProducerBarsFillTheirMonths(draw(producer()));
  });

  it('a computed day axis reads October 5th to 7th, the days its bars store', () => {
    enter(WEST);
    const drawn = draw(COMPUTED);
    expect(drawn.axis).toEqual(['Oct 5', 'Oct 6', 'Oct 7']);
    // objectui#11079: the bars are measured on the axis the headers draw,
    // October 5th to the end of October 7th, three days — not on the two days
    // from the first midnight to the last, which put the second bar at 50%.
    // objectui#11112: each date-only end is drawn through its day, so each bar
    // is two days wide and the second ends at the axis's end.
    expect(drawn.bars).toEqual([
      { left: '0%', width: `${(2 / 3) * 100}%` },
      { left: `${(1 / 3) * 100}%`, width: `${(2 / 3) * 100}%` },
    ]);
  });

  it('a pinned day axis reads its days; a date-only bar sits on its day and an instant bar at its local hour, 21:00 on the 5th', () => {
    enter(WEST);
    const drawn = draw(PINNED_MIXED);
    expect(drawn.axis).toEqual(['Oct 5', 'Oct 6', 'Oct 7']);
    // objectui#11079: on the 72-hour axis the headers draw, October 5th to the
    // end of the 7th. The day bar starts on the second day, 24 hours from the
    // start, and runs through its date-only end, the 7th (objectui#11112); the
    // instant bar starts 21 hours in and is 6 hours long, its end unchanged.
    expect(drawn.bars).toEqual([
      { left: `${(24 / 72) * 100}%`, width: `${(48 / 72) * 100}%` },
      { left: `${(21 / 72) * 100}%`, width: `${(6 / 72) * 100}%` },
    ]);
    expect(drawn.bars[0].left).toBe(drawn.columns[0]);
  });

  it('the min-over-max guard reads what the axis reads: a pinned end that is the evening before the pinned start here is refused', () => {
    enter(WEST);
    const drawn = draw(PINNED_EDGE);
    expect(drawn.refusal).not.toBeNull();
    expect(drawn.axis).toEqual([]);
    expect(drawn.bars).toEqual([]);
  });

  it('a day axis across the spring DST change draws the 23-hour day as a narrower column, and a bar on that day fills it (objectui#11079, objectui#11112)', () => {
    enter(WEST);
    // March 8th 2026 is 23 hours long here: the clocks go forward at 02:00.
    // The bar starts and ends on March 8th: a date-only end runs through its
    // day, which is the 23 hours of that column (objectui#11112).
    const drawn = draw({
      scale: 'day',
      minDate: '2026-03-07',
      maxDate: '2026-03-09',
      items: [{ label: 'Row', items: [{ title: 'Bar', startDate: '2026-03-08', endDate: '2026-03-08' }] }],
    });
    expect(drawn.axis).toEqual(['Mar 7', 'Mar 8', 'Mar 9']);
    expect(drawn.columns).toEqual([
      `${(24 / 71) * 100}%`,
      `${(23 / 71) * 100}%`,
      `${(24 / 71) * 100}%`,
    ]);
    expect(drawn.bars).toEqual([{ left: drawn.columns[0], width: drawn.columns[1] }]);
  });

  it("the empty plan's axis is the viewer's today, October 5th, not the UTC day", () => {
    enter(WEST);
    expect(emptyPlanAxis()).toEqual(['Oct 5']);
  });
});

describe.runIf(DRIVEN)('timeline gantt east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  it('the producer draws January to April, as it already did', () => {
    enter(EAST);
    const drawn = draw(producer());
    expect(drawn.axis).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024', 'Apr 2024']);
    expect(drawn.titles[0]).toBe('API Design\n1/1/2024 - 1/31/2024');
  });

  it('the producer\'s API Design bar, January 1st to 31st, ends where the February column begins (objectui#11112)', () => {
    enter(EAST);
    expectProducerBarsFillTheirMonths(draw(producer()));
  });

  it('a computed day axis reads October 5th to 7th, not from the day before (the extent is printed from local getters)', () => {
    enter(EAST);
    const drawn = draw(COMPUTED);
    expect(drawn.axis).toEqual(['Oct 5', 'Oct 6', 'Oct 7']);
    // objectui#11079: the bars are measured on the axis the headers draw,
    // October 5th to the end of October 7th, three days — not on the two days
    // from the first midnight to the last, which put the second bar at 50%.
    // objectui#11112: each date-only end is drawn through its day, so each bar
    // is two days wide and the second ends at the axis's end.
    expect(drawn.bars).toEqual([
      { left: '0%', width: `${(2 / 3) * 100}%` },
      { left: `${(1 / 3) * 100}%`, width: `${(2 / 3) * 100}%` },
    ]);
  });

  it('a pinned day axis reads its days; a date-only bar sits on its day and an instant bar at its local hour, 12:00 on the 6th', () => {
    enter(EAST);
    const drawn = draw(PINNED_MIXED);
    expect(drawn.axis).toEqual(['Oct 5', 'Oct 6', 'Oct 7']);
    // objectui#11079: on the 72-hour axis the headers draw, October 5th to the
    // end of the 7th. The day bar starts on the second day, 24 hours from the
    // start, and runs through its date-only end, the 7th (objectui#11112); the
    // instant bar starts 36 hours in and is 6 hours long, its end unchanged.
    expect(drawn.bars).toEqual([
      { left: `${(24 / 72) * 100}%`, width: `${(48 / 72) * 100}%` },
      { left: `${(36 / 72) * 100}%`, width: `${(6 / 72) * 100}%` },
    ]);
    expect(drawn.bars[0].left).toBe(drawn.columns[0]);
  });

  it('the min-over-max guard: the same pinned pair is in order here, and draws', () => {
    enter(EAST);
    const drawn = draw(PINNED_EDGE);
    expect(drawn.refusal).toBeNull();
    expect(drawn.axis).toEqual(['Oct 6']);
  });

  it("the empty plan's axis is the viewer's today, October 6th, not the UTC day", () => {
    enter(EAST);
    expect(emptyPlanAxis()).toEqual(['Oct 6']);
  });
});
