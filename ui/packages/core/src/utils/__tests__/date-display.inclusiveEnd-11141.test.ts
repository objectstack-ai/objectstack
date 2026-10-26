/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11141 — the ONE end read, `toDisplayEndDate`, and its exact inverse,
 * `toInclusiveEndDay`.
 *
 * ── Why they live here ──────────────────────────────────────────────────────
 * objectui#11112 ruled that a date-only end is INCLUSIVE, and the timeline's
 * gantt read it so, stepping the day itself, while `plugin-gantt` read an end
 * as that day's start: one authored plan drew one day apart on the two gantt
 * surfaces. Both now read an end through `toDisplayEndDate`, and `plugin-gantt`
 * writes a dragged date-only end back through `toInclusiveEndDay`, so the step
 * has one home and a read and a write cannot disagree.
 *
 * ── What these pins hold ────────────────────────────────────────────────────
 *  - a date-only end reads as the NEXT day's start, across a month, a year and
 *    a leap day, and a two-digit year stays out of the 1900s;
 *  - an instant (a time part, a number, a `Date`) is handed back as
 *    `toDisplayDate` hands it back, never stepped; an impossible day is
 *    refused as `toDisplayDate` refuses it;
 *  - `toInclusiveEndDay` of the read is the day the value names, for every day
 *    tried, and an end inside a day names that day;
 *  - in real zones, read from child processes: a day is one CALENDAR day long,
 *    23 or 25 hours across a DST change, and a day whose next midnight does
 *    not exist (`America/Santiago` on September 5th, 2026) ends at the next
 *    day's first hour and still names itself back.
 *
 * ── Why the zones are read from child processes ─────────────────────────────
 * `process.env.TZ` written inside a test of the normal run does not move the
 * zone (the root config runs `pool: 'threads'`; `date-display.dateOnlyZone-10110`
 * records the measurement). So each zone is read from a Node child started
 * WITH `TZ`, which imports this module's source directly (Node strips the
 * types), and the first zone case asserts the child resolved the zone it was
 * given, so a rig that stopped working reds instead of passing quietly.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toDisplayDate, toDisplayEndDate, toInclusiveEndDay } from '../date-display.js';

/** Local calendar parts of a `Date`: year, month (1-based), day, hour. */
const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];

describe('toDisplayEndDate reads a date-only end through its day (objectui#11141)', () => {
  it('reads `2024-01-15` as the 16th\'s local midnight', () => {
    expect(parts(toDisplayEndDate('2024-01-15'))).toEqual([2024, 1, 16, 0]);
  });

  it('steps a calendar day across a month, a leap day and a year', () => {
    expect(parts(toDisplayEndDate('2024-01-31'))).toEqual([2024, 2, 1, 0]);
    expect(parts(toDisplayEndDate('2024-02-28'))).toEqual([2024, 2, 29, 0]);
    expect(parts(toDisplayEndDate('2024-02-29'))).toEqual([2024, 3, 1, 0]);
    expect(parts(toDisplayEndDate('2024-12-31'))).toEqual([2025, 1, 1, 0]);
  });

  it('keeps a two-digit year out of the 1900s, as `toDisplayDate` does', () => {
    expect(parts(toDisplayEndDate('0026-08-01'))).toEqual([26, 8, 2, 0]);
  });

  it('makes a span whose start and end name one day exactly that day long', () => {
    const day = '2024-01-15';
    expect(toDisplayEndDate(day).getTime() - toDisplayDate(day).getTime()).toBe(86_400_000);
  });

  it('control: an instant is handed back as `toDisplayDate` hands it back, never stepped', () => {
    for (const iso of ['2024-01-15T10:00:00.000Z', '2024-01-16T00:00:00.000Z', '2024-01-15 09:30']) {
      expect(toDisplayEndDate(iso).getTime(), iso).toBe(toDisplayDate(iso).getTime());
    }
    const ms = Date.parse('2024-01-15T10:00:00.000Z');
    expect(toDisplayEndDate(ms).getTime()).toBe(ms);
    const date = new Date(ms);
    expect(toDisplayEndDate(date).getTime()).toBe(ms);
  });

  it('control: refuses a day its month does not have, as `toDisplayDate` does', () => {
    expect(Number.isNaN(toDisplayEndDate('2024-02-30').getTime())).toBe(true);
    expect(Number.isNaN(toDisplayEndDate('not-a-date').getTime())).toBe(true);
  });
});

describe('toInclusiveEndDay is its exact inverse (objectui#11141)', () => {
  const DAYS = ['2024-01-15', '2024-01-31', '2024-02-28', '2024-02-29', '2024-12-31', '0026-08-01'];

  it.each(DAYS)('names `%s` back from the end it is read as', (day) => {
    expect(parts(toInclusiveEndDay(toDisplayEndDate(day)))).toEqual(parts(toDisplayDate(day)));
  });

  it('names the day BEFORE a local midnight, and the day of an end inside a day', () => {
    expect(parts(toInclusiveEndDay(new Date(2024, 0, 16)))).toEqual([2024, 1, 15, 0]);
    expect(parts(toInclusiveEndDay(new Date(2024, 0, 15, 17)))).toEqual([2024, 1, 15, 0]);
    expect(parts(toInclusiveEndDay(new Date(2024, 0, 16, 0, 0, 0, 1)))).toEqual([2024, 1, 16, 0]);
  });

  it('hands a new `Date` back and leaves an invalid one invalid', () => {
    const end = new Date(2024, 0, 16);
    expect(toInclusiveEndDay(end)).not.toBe(end);
    expect(end.getTime()).toBe(new Date(2024, 0, 16).getTime());
    expect(Number.isNaN(toInclusiveEndDay(new Date(NaN)).getTime())).toBe(true);
  });
});

/* ── In real zones ─────────────────────────────────────────────────────────── */

/** UTC-7/-8, and March 8th and November 1st, 2026 are its DST changes. */
const WEST = 'America/Los_Angeles';
/** UTC+8, no DST — the control. */
const EAST = 'Asia/Shanghai';
/** Its clock steps from 00:00 to 01:00 on September 6th, 2026. */
const SKIPS = 'America/Santiago';

/** This module's source, resolved from THIS FILE and never from the cwd. */
const MODULE_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'date-display.ts'),
).href;

/** The days every zone reads: a plain day, both of Los Angeles's DST days, and the two either side of Santiago's. */
const ZONE_DAYS = ['2026-10-05', '2026-03-08', '2026-11-01', '2026-09-05', '2026-09-06'];

const PROBE = `
const m = await import(process.env.OS_PROBE_MODULE);
const parts = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];
const days = {};
for (const day of JSON.parse(process.env.OS_PROBE_DAYS)) {
  const start = m.toDisplayDate(day);
  const end = m.toDisplayEndDate(day);
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  days[day] = {
    start: parts(start),
    end: parts(end),
    nextStart: parts(m.toDisplayDate(next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0') + '-' + String(next.getDate()).padStart(2, '0'))),
    back: parts(m.toInclusiveEndDay(end)),
    hours: (end.getTime() - start.getTime()) / 3600000,
  };
}
process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, days }));
`;

interface DayReading {
  start: number[];
  end: number[];
  nextStart: number[];
  back: number[];
  hours: number;
}

const readings = new Map<string, { zone: string; days: Record<string, DayReading> }>();

function readIn(tz: string) {
  const cached = readings.get(tz);
  if (cached) return cached;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, TZ: tz, OS_PROBE_MODULE: MODULE_URL, OS_PROBE_DAYS: JSON.stringify(ZONE_DAYS) },
  });
  const reading = JSON.parse(stdout) as { zone: string; days: Record<string, DayReading> };
  readings.set(tz, reading);
  return reading;
}

describe('the end read and its inverse in real zones (objectui#11141)', () => {
  it('rig: each child resolved the zone it was given', () => {
    for (const tz of [WEST, EAST, SKIPS]) expect(readIn(tz).zone).toBe(tz);
  });

  it.each([WEST, EAST, SKIPS])('in %s every end is the next day\'s start and names its own day back', (tz) => {
    for (const day of ZONE_DAYS) {
      const r = readIn(tz).days[day];
      expect(r.end, `${tz} ${day}`).toEqual(r.nextStart);
      expect(r.back, `${tz} ${day}`).toEqual(r.start);
    }
  });

  it('a day is one calendar day long across a DST change: 23 and 25 hours in Los Angeles', () => {
    const west = readIn(WEST).days;
    expect(west['2026-10-05'].hours).toBe(24);
    expect(west['2026-03-08'].hours).toBe(23);
    expect(west['2026-11-01'].hours).toBe(25);
    for (const day of ZONE_DAYS) expect(readIn(EAST).days[day].hours, day).toBe(24);
  });

  it('a day whose next midnight does not exist ends at the next day\'s first hour, and still names itself', () => {
    const santiago = readIn(SKIPS).days;
    expect(santiago['2026-09-05'].end).toEqual([2026, 9, 6, 1]);
    expect(santiago['2026-09-05'].back).toEqual([2026, 9, 5, 0]);
    // The day with no midnight itself starts at its first hour and names itself.
    expect(santiago['2026-09-06'].start).toEqual([2026, 9, 6, 1]);
    expect(santiago['2026-09-06'].back).toEqual([2026, 9, 6, 1]);
    expect(santiago['2026-09-06'].end).toEqual([2026, 9, 7, 0]);
  });
});
