/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10844 — the `date-picker` renderer labels and selects the day a
 * date-only `value` names, the same day the equivalent `Date` names.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The renderer handed an authored ISO `value` to date-fns `format` and to the
 * calendar's `selected` / `defaultMonth` untouched. Both parse a string with
 * the engine's own `Date` parse, so a date-only string was UTC midnight read
 * back in local time: `2024-01-15` was labelled "January 14th, 2024" in
 * `America/Los_Angeles`, and the calendar selected the 14th, while
 * `new Date(2024, 0, 15)` read the 15th in every zone. The read site now
 * routes a real date-only day through `toDisplayDate` (`@object-ui/core`, the
 * objectui#10183 convention), and passes everything else unchanged.
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone cases below run in the normal run
 * too; they cannot tell the repair from its absence, because UTC is the one
 * offset where the two parses agree, and they are here for the `Date` and
 * date-time faces and for the value the repair leaves to the engine.
 *
 * `Asia/Shanghai` is the control: east of UTC the UTC-midnight parse already
 * landed on the named day, and an hour-offset "repair" would break it.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a hook (objectui#3010).
import '../../../renderers';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-8 in January — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** Frozen in another year than the value, so the calendar's opening month is the value's. */
const CLOCK = '2026-09-03T10:35:00.000Z';
const DATE_ONLY = '2024-01-15';
/** A fixed instant: 20:00 on the 15th in the west, 12:00 on the 16th in the east. */
const INSTANT = '2024-01-16T04:00:00.000Z';

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

interface Face {
  /** The trigger's label. */
  label: string;
  /** The `data-day` of every selected cell, once the popover is open. */
  selected: string[];
  /** The caption of the month the calendar opens on. */
  month: string;
}

/** Render the picker with `value`, read its label, open it and read the calendar. */
function face(value: unknown): Face {
  const DatePicker = ComponentRegistry.get('date-picker')!;
  render(<DatePicker schema={{ type: 'date-picker', id: 'dp-10844' }} value={value} />);
  const trigger = document.getElementById('dp-10844')!;
  const label = (trigger.textContent ?? '').trim();
  fireEvent.click(trigger);
  const selected = Array.from(document.body.querySelectorAll('td[data-selected="true"]'))
    .map((td) => td.getAttribute('data-day') ?? '');
  const month = (document.body.querySelector('.rdp-caption_label')?.textContent ?? '').trim();
  cleanup();
  return { label, selected, month };
}

const JAN_15: Face = { label: 'January 15th, 2024', selected: ['2024-01-15'], month: 'January 2024' };
const JAN_16: Face = { label: 'January 16th, 2024', selected: ['2024-01-16'], month: 'January 2024' };

describe('date-picker value, in the suite zone (objectui#10844)', () => {
  it('a local `Date` labels and selects the day it names (the reference face)', () => {
    enter();
    expect(face(new Date(2024, 0, 15))).toEqual(JAN_15);
  });

  it('a date-only string labels and selects that same day', () => {
    enter();
    expect(face(DATE_ONLY)).toEqual(JAN_15);
  });

  it('a date-only string naming no real day is left to the engine, and still renders', () => {
    enter();
    // Refusing it would hand the trigger's `format` an Invalid Date, which
    // throws; the repair does not widen what throws.
    expect(() => face('2024-02-30')).not.toThrow();
  });
});

describe.runIf(DRIVEN)('date-picker date-only value west of UTC (objectui#10844)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('fixture validity: the engine parse of the string lands on the day before here', () => {
    enter(WEST);
    // Without this the cases below would be green for free.
    expect(new Date(DATE_ONLY).getDate()).toBe(14);
  });

  it('`2024-01-15` labels, selects and opens on the 15th, as `new Date(2024, 0, 15)` does', () => {
    enter(WEST);
    expect(face(new Date(2024, 0, 15))).toEqual(JAN_15);
    expect(face(DATE_ONLY)).toEqual(JAN_15);
  });

  it('an instant keeps its local day, the 15th here', () => {
    enter(WEST);
    expect(face(INSTANT)).toEqual(JAN_15);
  });
});

describe.runIf(DRIVEN)('date-picker date-only value east of UTC, the control (objectui#10844)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  it('`2024-01-15` labels and selects the 15th, as it already did', () => {
    enter(EAST);
    expect(face(DATE_ONLY)).toEqual(JAN_15);
  });

  it('an instant keeps its local day, the 16th here', () => {
    enter(EAST);
    expect(face(INSTANT)).toEqual(JAN_16);
  });
});
