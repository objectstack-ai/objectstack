/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10293 — the `ui:calendar` primitive selects the day an ISO string
 * names, the same day the equivalent `Date` selects.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The renderer handed `schema.value || schema.defaultValue` to `DayPicker`
 * untouched. `DayPicker` compares through date-fns, which parses a string
 * with the engine's own `Date` parse, so a date-only string was UTC midnight
 * read back in local time: `2026-09-15` selected the 14th in
 * `America/Los_Angeles` and the 15th in UTC, while `new Date(2026, 8, 15)`
 * selected the 15th in both. A date-time string already selected its local
 * day. The read site now coerces a string through `toDisplayDate`
 * (`@object-ui/core`, the objectui#10183 convention).
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The UTC cases below run in the normal run too; they
 * cannot tell the repair from its absence, because UTC is the one offset where
 * the two parses agree, and they are here for the `Date` / date-time faces.
 *
 * `Asia/Shanghai` is the control: east of UTC the UTC-midnight parse already
 * landed on the named day, and an hour-offset "repair" would break it.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a hook (objectui#3010).
import '../../../renderers';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in September — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** Frozen inside September 2026, so the calendar opens on the month under test. */
const CLOCK = '2026-09-03T10:35:00.000Z';
const DATE_ONLY = '2026-09-15';
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

/** The `data-day` of every selected cell the calendar paints. */
function selectedDays(extra: Record<string, unknown>): string[] {
  const Calendar = ComponentRegistry.get('ui:calendar')!;
  const { container } = render(<Calendar schema={{ type: 'ui:calendar', mode: 'single', ...extra }} />);
  const days = Array.from(container.querySelectorAll('td[data-selected="true"]'))
    .map((td) => td.getAttribute('data-day') ?? '');
  cleanup();
  return days;
}

describe('ui:calendar selected date, in the suite zone (objectui#10293)', () => {
  it('a local `Date` selects the day it names (the reference face)', () => {
    enter();
    expect(selectedDays({ value: new Date(2026, 8, 15) })).toEqual(['2026-09-15']);
  });

  it('a date-only string selects that same day, through `value` and `defaultValue`', () => {
    enter();
    expect(selectedDays({ value: DATE_ONLY })).toEqual(['2026-09-15']);
    expect(selectedDays({ defaultValue: DATE_ONLY })).toEqual(['2026-09-15']);
  });

  it('an invalid string still selects nothing, as it did before the coercion', () => {
    enter();
    expect(selectedDays({ value: 'not a date' })).toEqual([]);
  });
});

describe.runIf(DRIVEN)('ui:calendar date-only value west of UTC (objectui#10293)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(21);
  });

  it('fixture validity: the engine parse of the string lands on the day before here', () => {
    enter(WEST);
    // Without this the cases below would be green for free.
    expect(new Date(DATE_ONLY).getDate()).toBe(14);
  });

  it('`2026-09-15` selects the 15th, the day `new Date(2026, 8, 15)` selects', () => {
    enter(WEST);
    expect(selectedDays({ value: new Date(2026, 8, 15) })).toEqual(['2026-09-15']);
    expect(selectedDays({ value: DATE_ONLY })).toEqual(['2026-09-15']);
    expect(selectedDays({ defaultValue: DATE_ONLY })).toEqual(['2026-09-15']);
  });

  it('an instant keeps selecting its local day, the 15th here', () => {
    enter(WEST);
    expect(selectedDays({ value: INSTANT })).toEqual(['2026-09-15']);
  });
});

describe.runIf(DRIVEN)('ui:calendar date-only value east of UTC, the control (objectui#10293)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  it('`2026-09-15` selects the 15th, as it already did', () => {
    enter(EAST);
    expect(selectedDays({ value: DATE_ONLY })).toEqual(['2026-09-15']);
  });

  it('an instant keeps selecting its local day, the 16th here', () => {
    enter(EAST);
    expect(selectedDays({ value: INSTANT })).toEqual(['2026-09-16']);
  });
});

/**
 * objectui#10304: `multiple` and `range` read a list and a `{ from, to }` pair,
 * and every day inside them takes the same coercion. In the suite zone the
 * engine parse already lands on the named day, so only a zone west of UTC can
 * tell the element-wise coercion from its absence.
 */
describe.runIf(DRIVEN)('ui:calendar date-only days inside a list or a range, west of UTC (objectui#10304)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(21);
  });

  it('multiple: each date-only day selects the day it names', () => {
    enter(WEST);
    expect(selectedDays({ mode: 'multiple', value: [DATE_ONLY, '2026-09-17'] }))
      .toEqual(['2026-09-15', '2026-09-17']);
  });

  it('range: `{ from, to }` of date-only days selects exactly the days they name', () => {
    enter(WEST);
    expect(selectedDays({ mode: 'range', value: { from: DATE_ONLY, to: '2026-09-17' } }))
      .toEqual(['2026-09-15', '2026-09-16', '2026-09-17']);
  });
});
