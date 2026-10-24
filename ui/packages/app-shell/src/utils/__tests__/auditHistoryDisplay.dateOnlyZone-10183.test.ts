/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10183 — the record History tab renders a date-only value as the
 * day it names west of UTC.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * `formatAuditValue`'s `date` branch formatted `new Date(value)` itself, so a
 * date-only value was UTC midnight read back in the viewer's zone:
 * `2026-08-01` rendered `7/31/2026` (en-US) in `America/Los_Angeles` and
 * `8/1/2026` in UTC. It now takes its `Date` from `toDisplayDate`, the shared
 * parse step (objectui#10110); both faces stay this helper's own.
 *
 * The `datetime` arm shares that one parse, so it follows the shared path's
 * rule too: the split is the VALUE's shape, never the field's type. An
 * instant keeps converting into the viewer's zone; a date-only value stored
 * on a `datetime` field reads as local midnight of its day, exactly as
 * `formatDateTime` renders the same string.
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
 * zone did not move reds instead of going quietly green. `Asia/Shanghai` is
 * the control an hour-offset "repair" breaks.
 */
import { describe, it, expect } from 'vitest';
import { formatAuditValue } from '../auditHistoryDisplay';

const DRIVEN = process.env.OBJECTUI_DATE_ZONE_CHILD === '1';

/** UTC-7 in August — the card's zone. */
const WEST = 'America/Los_Angeles';
/** UTC+8 — the control, where the UTC-midnight parse was already harmless. */
const EAST = 'Asia/Shanghai';

const DATE_ONLY = '2026-08-01';
/** A fixed instant: 20:00 the day before in the west, 11:00 in the east. */
const INSTANT = '2026-08-01T03:00:00.000Z';
const EN = { locale: 'en-US' };

describe.runIf(DRIVEN)('audit history date faces west of UTC (objectui#10183)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = WEST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(WEST);
    expect(new Date(INSTANT).getHours()).toBe(20);
  });

  it('a `date` value `2026-08-01` reads 8/1/2026, where it read 7/31/2026', () => {
    process.env.TZ = WEST;
    expect(formatAuditValue({ type: 'date' }, DATE_ONLY, EN)).toBe('8/1/2026');
  });

  it('a `datetime` instant keeps converting, onto the day before', () => {
    process.env.TZ = WEST;
    expect(formatAuditValue({ type: 'datetime' }, INSTANT, EN)).toBe('Jul 31, 2026, 8:00 PM');
  });

  it('a date-only value on a `datetime` field reads as local midnight of its day', () => {
    process.env.TZ = WEST;
    expect(formatAuditValue({ type: 'datetime' }, DATE_ONLY, EN)).toBe('Aug 1, 2026, 12:00 AM');
  });
});

describe.runIf(DRIVEN)('audit history date faces east of UTC, the control (objectui#10183)', () => {
  it('rig: the zone really moved', () => {
    process.env.TZ = EAST;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(EAST);
    expect(new Date(INSTANT).getHours()).toBe(11);
  });

  it('a `date` value `2026-08-01` reads 8/1/2026, as it already did', () => {
    process.env.TZ = EAST;
    expect(formatAuditValue({ type: 'date' }, DATE_ONLY, EN)).toBe('8/1/2026');
  });

  it('a `datetime` instant keeps converting', () => {
    process.env.TZ = EAST;
    expect(formatAuditValue({ type: 'datetime' }, INSTANT, EN)).toBe('Aug 1, 2026, 11:00 AM');
  });

  it('a date-only value on a `datetime` field reads as local midnight of its day', () => {
    process.env.TZ = EAST;
    expect(formatAuditValue({ type: 'datetime' }, DATE_ONLY, EN)).toBe('Aug 1, 2026, 12:00 AM');
  });
});
