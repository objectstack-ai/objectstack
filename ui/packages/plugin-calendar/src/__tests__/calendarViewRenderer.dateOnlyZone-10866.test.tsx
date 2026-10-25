/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10866 — the `calendar-view` node reads its authored date-only
 * values as the days they name.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The renderer built each event with `start: new Date(record[startField])`
 * and resolved the authored `currentDate` with `new Date(raw)`: the engine's
 * own parse, which reads a date-only string as UTC midnight. West of UTC an
 * event dated `2026-11-05` sat in the November 4th cell, and an authored
 * `currentDate: '2026-11-01'` opened the calendar on OCTOBER. Both reads now go
 * through `toDisplayDate` (`@object-ui/core`, the objectui#10183 convention).
 *
 * ── ⚠️ The zone cases run ONLY when driven, in a FORKS child ────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`), so the zone cases are
 * skipped there and `scripts/__tests__/date-only-zone-pins-10183.test.ts`
 * runs them on the forks pool and fails unless every one ran and passed. Each
 * zone opens with a rig case, so a child whose zone did not move reds instead
 * of going quietly green. The suite-zone case runs in the normal run too; it
 * cannot tell the repair from its absence, because UTC is the one offset where
 * the two parses agree.
 *
 * `Asia/Shanghai` is the control: east of UTC the UTC-midnight parse already
 * landed on the named day, and an hour-offset "repair" would break it.
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import { LocalizationProvider } from '@object-ui/i18n';
// Module scope: the registration side effect this file renders through
// (AGENTS.md 测试纪律 — never inside a hook).
import '../index';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-8 in November — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

/** A fixed instant: 20:00 on the 5th in the west, 12:00 on the 6th in the east. */
const INSTANT = '2026-11-06T04:00:00.000Z';

afterEach(() => {
  cleanup();
});

function enter(zone: string): void {
  process.env.TZ = zone;
}

/** `November 5, 2026` out of a month cell's accessible name. */
function dayOf(cell: Element): string {
  const m = (cell.getAttribute('aria-label') ?? '').match(/[A-Z][a-z]+ \d{1,2}, \d{4}/);
  return m ? m[0] : '';
}

interface Face {
  /** The days whose month cell holds the event. */
  eventDays: string[];
  /** Whether the grid shows November — its mid-month cell exists only then. */
  showsNovember: boolean;
}

function face(start: string): Face {
  render(
    <LocalizationProvider value={{ locale: 'en-US' }}>
      <SchemaRenderer
        schema={{
          type: 'calendar-view',
          currentDate: '2026-11-01',
          data: [{ id: 'e1', title: 'Launch', start }],
        } as never}
      />
    </LocalizationProvider>,
  );
  const cells = screen.getAllByRole('gridcell');
  const result = {
    eventDays: cells
      .filter((c) => within(c as HTMLElement).queryAllByLabelText('Launch').length > 0)
      .map(dayOf),
    showsNovember: cells.some((c) => dayOf(c) === 'November 15, 2026'),
  };
  cleanup();
  return result;
}

describe('calendar-view date-only reads, in the suite zone (objectui#10866)', () => {
  it('an authored date-only `currentDate` and event read the days they name', () => {
    expect(face('2026-11-05')).toEqual({ eventDays: ['November 5, 2026'], showsNovember: true });
  });
});

describe.runIf(DRIVEN)('calendar-view date-only reads west of UTC (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('fixture validity: the engine parse of the strings lands on the day before here', () => {
    enter(WEST);
    expect(new Date('2026-11-05').getDate()).toBe(4);
    expect(new Date('2026-11-01').getMonth()).toBe(9);
  });

  it('`currentDate: 2026-11-01` opens on November, and `2026-11-05` sits on the 5th', () => {
    enter(WEST);
    expect(face('2026-11-05')).toEqual({ eventDays: ['November 5, 2026'], showsNovember: true });
  });

  it('control: an instant sits on its local day, the 5th here', () => {
    enter(WEST);
    expect(face(INSTANT).eventDays).toEqual(['November 5, 2026']);
  });
});

describe.runIf(DRIVEN)('calendar-view date-only reads east of UTC, the control (objectui#10866)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  it('`currentDate: 2026-11-01` opens on November, and `2026-11-05` sits on the 5th, as they already did', () => {
    enter(EAST);
    expect(face('2026-11-05')).toEqual({ eventDays: ['November 5, 2026'], showsNovember: true });
  });

  it('control: an instant sits on its local day, the 6th here', () => {
    enter(EAST);
    expect(face(INSTANT).eventDays).toEqual(['November 6, 2026']);
  });
});
