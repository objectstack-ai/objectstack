/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10183 — `data-table`'s default cell face hands the shared
 * formatters the STRING, so a date-only value renders the day it names west
 * of UTC.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * `formatCellValue` ran `Date.parse` and handed `formatDate` a `new Date(ts)`.
 * The shared parse step (`toDisplayDate`, objectui#10110) rebuilds a
 * date-only STRING at local midnight, but leaves a `Date` alone — it is
 * already an instant — so the table's date-only cells kept the UTC-midnight
 * parse: `2026-08-01` rendered `Jul 31` in `America/Los_Angeles` and `Aug 1`
 * in UTC. `data-table-date-convention-7620.test.tsx` was green throughout: it
 * runs in UTC, the one offset where the two spellings agree.
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
 * landed on the right day, and an hour-offset "repair" breaks it. The instant
 * row is the other control — an instant must keep converting into the
 * viewer's zone, onto another calendar day included.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry, formatDate } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
// Registers the renderers at module scope, NOT inside a hook (objectui#3010).
import '../renderers';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in August — the card's zone. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control, where the UTC-midnight parse was already harmless. */
const EAST = 'Asia/Shanghai';

/** Frozen so `2026` is the current year and `formatDate` drops it. */
const CLOCK = '2026-09-03T10:35:00.000Z';
const DATE_ONLY = '2026-08-01';
/** A fixed instant: 20:00 the day before in the west, 11:00 in the east. */
const INSTANT = '2026-08-01T03:00:00.000Z';

/** Move this forked process into `zone` and freeze the clock. */
function enter(zone: string): void {
  process.env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The table's two cells: the date-only row, then the instant row. */
function cells(): string[] {
  const Table = ComponentRegistry.get('data-table')!;
  const schema = {
    type: 'data-table',
    columns: [{ header: 'When', accessorKey: 'when' }],
    data: [
      { id: 'date-only', when: DATE_ONLY },
      { id: 'instant', when: INSTANT },
    ],
  } as any;
  const { container } = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <Table schema={schema} />
    </I18nProvider>,
  );
  return Array.from(container.querySelectorAll('tbody tr td')).map((td) => td.textContent ?? '');
}

describe.runIf(DRIVEN)('data-table date-only cells west of UTC (objectui#10183)', () => {
  it('rig: the zone really moved', () => {
    enter(WEST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('fixture validity: the pre-parsed spelling lands on the day before here', () => {
    enter(WEST);
    // Without this the case below would be green for free.
    expect(formatDate(new Date(Date.parse(DATE_ONLY)), undefined, { locale: 'en' })).toBe('Jul 31');
  });

  it('renders `2026-08-01` as Aug 1, where it read Jul 31', () => {
    enter(WEST);
    expect(cells()[0]).toBe('Aug 1');
  });

  it('keeps converting an instant into the viewer zone, onto the day before', () => {
    enter(WEST);
    expect(cells()[1]).toBe('Jul 31, 2026, 08:00 PM');
  });
});

describe.runIf(DRIVEN)('data-table date-only cells east of UTC, the control (objectui#10183)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(11);
  });

  it('renders `2026-08-01` as Aug 1, as it already did', () => {
    enter(EAST);
    expect(cells()[0]).toBe('Aug 1');
  });

  it('keeps converting an instant into the viewer zone', () => {
    enter(EAST);
    expect(cells()[1]).toBe('Aug 1, 2026, 11:00 AM');
  });
});
