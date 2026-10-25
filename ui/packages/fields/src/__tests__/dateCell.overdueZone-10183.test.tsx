/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10183 — the `date` cell's overdue colouring takes its DAY from the
 * shared parse step, so a deadline falling today is not red west of UTC.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * The text half was already right: `DateCellRenderer` hands the raw value to
 * `formatDate`, which goes through `toDisplayDate` (objectui#10110). The red
 * half was not: `isOverdueInstant` was fed `new Date(safe)`, which for a
 * date-only value is UTC midnight, and compared it with the LOCAL start of
 * today. A due-type `2026-09-03` on the clock `2026-09-03T10:35Z` read `Today`
 * in every zone, and was `text-red-600` in `America/Los_Angeles` only.
 *
 * ── ⚠️ This file runs ONLY when driven, in a FORKS child ───────────────────
 * Every case below is skipped in the normal run. The zone is an input here,
 * and `process.env.TZ` written inside a test of the normal run does NOT move
 * it: the root config runs `pool: 'threads'`, a worker thread's `process.env`
 * is a plain copy with no native setter, and `Intl` keeps reading UTC — every
 * case would pass for the wrong reason. A forked worker is a real process's
 * MAIN thread, where Node's `TZ` setter does reset the zone.
 * `scripts/__tests__/date-only-zone-pins-10183.test.ts` spawns one vitest on
 * the forks pool over this file and its three siblings, and fails unless
 * every case here ran and passed. Each zone opens with a rig case — the zone
 * `Intl` resolved, and the local hour of a fixed INSTANT — so a child whose
 * zone did not move reds instead of going quietly green.
 *
 * `Asia/Shanghai` is the control: east of UTC the UTC-midnight parse already
 * landed on or after local midnight, and an hour-offset "repair" breaks it.
 * Yesterday's deadline is the second control: it must stay red in both zones,
 * so a repair that simply stopped colouring cannot pass either.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DateCellRenderer } from '../index';

/**
 * `process.env`, reached without Node's types: this package's test program
 * does not load them, and the two keys below are all this file needs.
 */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const DRIVEN = env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 on the card's clock — where the deadline turned red a day early. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control, where the UTC-midnight parse was already harmless. */
const EAST = 'Asia/Shanghai';

/** The card's clock: `Thu Sep 3` in both zones (03:35 PDT, 18:35 CST). */
const CARD_CLOCK = '2026-09-03T10:35:00.000Z';
const DUE_TODAY = '2026-09-03';
const DUE_YESTERDAY = '2026-09-02';
/** A fixed instant: 20:00 the day before in the west, 11:00 in the east. */
const INSTANT = '2026-08-01T03:00:00.000Z';

/** Move this forked process into `zone` and freeze the card's clock. */
function enter(zone: string): void {
  env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CARD_CLOCK));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function cellAt(value: string): { text: string; red: boolean } {
  const { container } = render(
    // Declared (objectui#11815): overdue is declared-only, the name guesses nothing.
    <DateCellRenderer value={value} field={{ name: 'due_date', type: 'date', dueLike: true } as any} />,
  );
  const span = container.querySelector('span');
  return { text: span?.textContent ?? '', red: (span?.className ?? '').includes('text-red-600') };
}

describe.runIf(DRIVEN)('the date cell overdue colouring west of UTC (objectui#10183)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('fixture validity: the UTC-midnight parse of today lands before local midnight here', () => {
    enter(WEST);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    // Without this the case below would be green for free.
    expect(new Date(DUE_TODAY) < startOfToday).toBe(true);
  });

  it('a deadline falling today reads Today and is NOT red', () => {
    enter(WEST);
    expect(cellAt(DUE_TODAY)).toEqual({ text: 'Today', red: false });
  });

  it("yesterday's deadline stays red", () => {
    enter(WEST);
    expect(cellAt(DUE_YESTERDAY)).toEqual({ text: 'Yesterday', red: true });
  });
});

describe.runIf(DRIVEN)('the date cell overdue colouring east of UTC, the control (objectui#10183)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(11);
  });

  it('a deadline falling today reads Today and is not red, as it already was', () => {
    enter(EAST);
    expect(cellAt(DUE_TODAY)).toEqual({ text: 'Today', red: false });
  });

  it("yesterday's deadline stays red", () => {
    enter(EAST);
    expect(cellAt(DUE_YESTERDAY)).toEqual({ text: 'Yesterday', red: true });
  });
});
