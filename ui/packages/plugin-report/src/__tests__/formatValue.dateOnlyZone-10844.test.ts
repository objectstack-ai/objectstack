/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10844 — the report cell's date face names the day a date-only
 * value stores, in every zone.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * `formatValue` is the face `ReportViewer` gives a column with no `type` whose
 * value looks like an ISO date, and an aggregated column (a `min` / `max` over
 * a date). It parsed the value with the engine's own `Date` parse and read it
 * back with LOCAL getters, so a date-only `2026-09-15` (UTC midnight) read
 * `2026-09-14` for every viewer west of UTC. The parse is now the shared step,
 * `toDisplayDate` (`@object-ui/core`, the objectui#10183 convention). Found by
 * the objectui#10844 census of date-only read sites.
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
 */
import { describe, it, expect } from 'vitest';
import type { ReportField } from '@object-ui/types';
import { formatValue } from '../formatValue';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in September — the card's direction. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control. */
const EAST = 'Asia/Shanghai';

const DATE_ONLY = '2026-09-15';
/** A fixed instant: 21:00 on the 15th in the west, 12:00 on the 16th in the east. */
const INSTANT = '2026-09-16T04:00:00.000Z';

/** A typed date column, reached through an aggregation. */
const DATE_FIELD = { name: 'due', label: 'Due', type: 'date', aggregation: 'max' } as ReportField;

/** Move this forked process into `zone`. */
function enter(zone: string): void {
  process.env.TZ = zone;
}

describe('report date cell, in the suite zone (objectui#10844)', () => {
  it('a date-only value reads the day it stores, typed or sniffed', () => {
    expect(formatValue(DATE_ONLY, DATE_FIELD)).toBe(DATE_ONLY);
    expect(formatValue(DATE_ONLY)).toBe(DATE_ONLY);
  });
});

describe.runIf(DRIVEN)('report date cell west of UTC (objectui#10844)', () => {
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

  it('`2026-09-15` reads the 15th, typed or sniffed', () => {
    enter(WEST);
    expect(formatValue(DATE_ONLY, DATE_FIELD)).toBe(DATE_ONLY);
    expect(formatValue(DATE_ONLY)).toBe(DATE_ONLY);
  });

  it('an instant keeps its local day, the 15th here', () => {
    enter(WEST);
    expect(formatValue(INSTANT, DATE_FIELD)).toBe('2026-09-15');
    expect(formatValue(INSTANT)).toBe('2026-09-15');
  });
});

describe.runIf(DRIVEN)('report date cell east of UTC, the control (objectui#10844)', () => {
  it('rig: the zone really moved', () => {
    enter(EAST);
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(12);
  });

  it('`2026-09-15` reads the 15th, as it already did', () => {
    enter(EAST);
    expect(formatValue(DATE_ONLY, DATE_FIELD)).toBe(DATE_ONLY);
    expect(formatValue(DATE_ONLY)).toBe(DATE_ONLY);
  });

  it('an instant keeps its local day, the 16th here', () => {
    enter(EAST);
    expect(formatValue(INSTANT, DATE_FIELD)).toBe('2026-09-16');
  });
});
