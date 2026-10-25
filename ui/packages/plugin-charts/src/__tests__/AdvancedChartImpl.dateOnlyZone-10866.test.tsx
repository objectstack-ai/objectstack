/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866 — a chart's x-axis tick names the day a date-only category
 * stores, in every zone.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * `AdvancedChartImpl`'s `formatTick` parsed an ISO-looking category with the
 * engine's own `Date` parse, which reads a date-only `2026-09-01` as UTC
 * midnight, and printed it with `toLocaleDateString`: every viewer west of
 * UTC read `Aug 31` on the axis, and `Aug 2026` on a month-grained one. Its
 * fallback for a locale `Intl` refuses printed `toISOString()`, which was
 * right for a date-only value only because the parse was UTC too: once the
 * parse is local midnight, the same print names the day before EAST of UTC.
 * So the fallback rows below are green on the base as well, on purpose: they
 * are the half a parse-only repair would break.
 *
 * The parse is now the shared step, `toDisplayDate` (`@object-ui/core`, the
 * objectui#10183 convention). A date-only category prints its day from local
 * getters on the fallback; a category with a time part keeps its instant, and
 * its fallback keeps the instant's UTC day.
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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { LocalizationProvider } from '@object-ui/i18n';

// A fixed size, so the axis lays out and draws its ticks in the test DOM.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      React.cloneElement(children, { width: 480, height: 320 }),
  };
});

import AdvancedChartImpl from '../AdvancedChartImpl';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in September — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** Two date-only days: a span under the 62-day bound, so the ticks are `MMM D`. */
const DAYS = ['2026-09-01', '2026-09-02'];
/** Two date-only month starts a quarter apart, so the ticks are `MMM YYYY`. */
const MONTHS = ['2026-09-01', '2026-12-01'];
/** Two instants: 20:00 on the 1st and 2nd in the west, 11:00 on the 2nd and 3rd in the east. */
const INSTANTS = ['2026-09-02T03:00:00.000Z', '2026-09-03T03:00:00.000Z'];

/** A tag `Intl` refuses, which sends `formatTick` to its fallback. */
const REFUSED_LOCALE = 'not a tag!';

/** Move this forked process into `zone`. */
function enter(zone: string): void {
  process.env.TZ = zone;
}

afterEach(() => cleanup());

/** The x-axis tick labels a bar chart over `categories` draws. */
function ticks(categories: string[], locale = 'en-US'): string[] {
  const data = categories.map((day, i) => ({ day, count: i + 1 }));
  const { container } = render(
    <LocalizationProvider value={{ locale }}>
      <AdvancedChartImpl
        chartType="bar"
        data={data}
        xAxisKey="day"
        series={[{ dataKey: 'count', label: 'Count' }]}
      />
    </LocalizationProvider>,
  );
  const out = Array.from(
    container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'),
  ).map((el) => el.textContent ?? '');
  cleanup();
  return out;
}

describe('chart date ticks, in the suite zone (objectui#10866)', () => {
  it('a date-only category reads the day it stores, on each face', () => {
    expect(ticks(DAYS)).toEqual(['Sep 1', 'Sep 2']);
    expect(ticks(MONTHS)).toEqual(['Sep 2026', 'Dec 2026']);
    expect(ticks(DAYS, REFUSED_LOCALE)).toEqual(DAYS);
  });

  it('a day its month does not have is not rolled into March: it prints as written', () => {
    expect(ticks(['2026-02-28', '2026-02-30'])).toEqual(['Feb 28', '2026-02-30']);
  });
});

describe.runIf(DRIVEN)('chart date ticks west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANTS[0]).getHours()).toBe(20);
  });

  it('fixture validity: the engine parse of the string lands on the day before here', () => {
    enter(WEST);
    // Without this the cases below would be green for free.
    expect(new Date(DAYS[0]).getDate()).toBe(31);
  });

  it('`2026-09-01` reads `Sep 1`, and a month axis reads `Sep 2026`', () => {
    enter(WEST);
    expect(ticks(DAYS)).toEqual(['Sep 1', 'Sep 2']);
    expect(ticks(MONTHS)).toEqual(['Sep 2026', 'Dec 2026']);
  });

  it('the fallback prints the day it stores', () => {
    enter(WEST);
    expect(ticks(DAYS, REFUSED_LOCALE)).toEqual(DAYS);
  });

  it('control: an instant keeps its local day here, and its fallback keeps its UTC day', () => {
    enter(WEST);
    expect(ticks(INSTANTS)).toEqual(['Sep 1', 'Sep 2']);
    expect(ticks(INSTANTS, REFUSED_LOCALE)).toEqual(['2026-09-02', '2026-09-03']);
  });
});

describe.runIf(DRIVEN)('chart date ticks east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANTS[0]).getHours()).toBe(11);
  });

  it('`2026-09-01` reads `Sep 1`, as it already did', () => {
    enter(EAST);
    expect(ticks(DAYS)).toEqual(['Sep 1', 'Sep 2']);
    expect(ticks(MONTHS)).toEqual(['Sep 2026', 'Dec 2026']);
  });

  it('the fallback prints the day it stores, not the day before', () => {
    enter(EAST);
    expect(ticks(DAYS, REFUSED_LOCALE)).toEqual(DAYS);
  });

  it('control: an instant keeps its local day here, and its fallback keeps its UTC day', () => {
    enter(EAST);
    expect(ticks(INSTANTS)).toEqual(['Sep 2', 'Sep 3']);
    expect(ticks(INSTANTS, REFUSED_LOCALE)).toEqual(['2026-09-02', '2026-09-03']);
  });
});
