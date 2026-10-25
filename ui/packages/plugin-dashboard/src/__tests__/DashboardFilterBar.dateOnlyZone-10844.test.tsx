/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10844 — the dashboard date filter's custom range highlights, and
 * opens on, the days it stores.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The range popover commits its bounds as LOCAL `yyyy-MM-dd` days and read
 * them back with `new Date(value.from)` / `new Date(value.to)`, the engine's
 * own parse, which reads a date-only string as UTC midnight. West of UTC the
 * calendar therefore highlighted the day before each stored bound: clicking
 * 15 Sep committed `{ from: '2026-09-15', to: '2026-09-15' }` and the calendar
 * then highlighted the 14th, and a range stored from 1 Oct opened on
 * September. The two bounds are now read through `toDisplayDate`
 * (`@object-ui/core`, the objectui#10183 convention).
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases run in the normal run too; they
 * cannot tell the repair from its absence, because UTC is the one offset where
 * the two parses agree.
 *
 * `Asia/Shanghai` is the control: east of UTC the UTC-midnight parse already
 * landed on the named day, and an hour-offset "repair" would break it.
 *
 * ⚠️ The popover is rendered open, as in
 * `DashboardFilterBar.defaultMonth-10799.test.tsx`: with a custom range
 * already stored, the select's "Custom…" item is its current value and picking
 * it again does not reopen the popover (objectui#10843, not this card).
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { resolveDashboardFilterDefs, type DateRangeValue } from '@object-ui/core';

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { ...actual, Popover: Passthrough, PopoverTrigger: Passthrough, PopoverContent: Passthrough };
});

// Imported after the mock is declared (vitest hoists `vi.mock` anyway).
import { DashboardFilterBar } from '../DashboardFilterBar';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in September — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** Frozen inside September 2026, so an empty range opens on the month clicked below. */
const CLOCK = '2026-09-03T10:35:00.000Z';
/** A fixed instant: 21:00 on the 15th in the west, 12:00 on the 16th in the east. */
const INSTANT = '2026-09-16T04:00:00.000Z';

/** Freeze the clock, moving this forked process into `zone` first when given. */
function enter(zone?: string): void {
  if (zone) process.env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const defs = resolveDashboardFilterDefs({ dateRange: { field: 'created_at' } });

interface Face {
  /** The `data-day` of every highlighted cell. */
  selected: string[];
  /** The captions of the two months shown, the first being the one it opens on. */
  months: string[];
}

function face(range: DateRangeValue | undefined): Face {
  render(<DashboardFilterBar defs={defs} values={{ dateRange: range }} onChange={vi.fn()} />);
  const selected = Array.from(document.body.querySelectorAll('td[data-selected="true"]'))
    .map((td) => td.getAttribute('data-day') ?? '');
  const months = Array.from(document.body.querySelectorAll('.rdp-caption_label'))
    .map((el) => (el.textContent ?? '').trim());
  cleanup();
  return { selected, months };
}

/** Click one day on an empty range and hand back what the filter committed. */
function commitByClick(day: string): unknown {
  const onChange = vi.fn();
  render(<DashboardFilterBar defs={defs} values={{ dateRange: undefined }} onChange={onChange} />);
  const button = document.body.querySelector(`td[data-day="${day}"] button`) as HTMLElement | null;
  expect(button, `no day cell for ${day}`).not.toBeNull();
  fireEvent.click(button!);
  cleanup();
  expect(onChange).toHaveBeenCalledTimes(1);
  return onChange.mock.calls[0][1];
}

const SEPT_15: Face = { selected: ['2026-09-15'], months: ['September 2026', 'October 2026'] };
const OCT_1_TO_3: Face = {
  selected: ['2026-10-01', '2026-10-02', '2026-10-03'],
  months: ['October 2026', 'November 2026'],
};

describe('DashboardFilterBar custom range, in the suite zone (objectui#10844)', () => {
  it('a stored range highlights and opens on the days it names', () => {
    enter();
    expect(face({ from: '2026-09-15', to: '2026-09-15' })).toEqual(SEPT_15);
    expect(face({ from: '2026-10-01', to: '2026-10-03' })).toEqual(OCT_1_TO_3);
  });

  it('a bound naming a day its month does not have selects no day, and nothing throws', () => {
    enter();
    // The shared step refuses `2026-02-30` (objectui#10026) where the engine
    // rolled it into March; a refused `from` opens on today, as an
    // unparseable one already did.
    expect(face({ from: '2026-02-30', to: '2026-02-30' })).toEqual({
      selected: [],
      months: ['September 2026', 'October 2026'],
    });
    expect(() => face({ from: '2026-09-15', to: '2026-02-30' })).not.toThrow();
  });
});

describe.runIf(DRIVEN)('DashboardFilterBar custom range west of UTC (objectui#10844)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(21);
  });

  it('fixture validity: the engine parse of a bound lands on the day before here', () => {
    enter(WEST);
    // Without this the cases below would be green for free.
    expect(new Date('2026-09-15').getDate()).toBe(14);
    expect(new Date('2026-10-01').getMonth()).toBe(8);
  });

  it('clicking 15 Sep commits the 15th, and the committed range highlights the 15th', () => {
    enter(WEST);
    const committed = commitByClick('2026-09-15');
    expect(committed).toEqual({ from: '2026-09-15', to: '2026-09-15' });
    expect(face(committed as DateRangeValue)).toEqual(SEPT_15);
  });

  it('a range stored from 1 Oct highlights 1-3 Oct and opens on October', () => {
    enter(WEST);
    expect(face({ from: '2026-10-01', to: '2026-10-03' })).toEqual(OCT_1_TO_3);
  });
});

describe.runIf(DRIVEN)('DashboardFilterBar custom range east of UTC, the control (objectui#10844)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  it('a stored range highlights and opens on the days it names, as it already did', () => {
    enter(EAST);
    expect(face({ from: '2026-09-15', to: '2026-09-15' })).toEqual(SEPT_15);
    expect(face({ from: '2026-10-01', to: '2026-10-03' })).toEqual(OCT_1_TO_3);
  });
});
