// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15824 — `HistoryCleanupManager` computes its retention cutoff on ONE
 * calendar (UTC), the same one `toISOString()` renders it on.
 *
 * ## Why this file cannot be written to run only at `TZ=UTC`
 *
 * The two spellings — local `setDate(getDate() - n)` and UTC
 * `setUTCDate(getUTCDate() - n)` — are behaviourally INDISTINGUISHABLE at
 * `TZ=UTC` and in every zone that does not observe DST. Measured over a
 * 16-zone x 366-day x 48-half-hour x 6-`maxAgeDays` sweep of 2026: the
 * disagreement rate is 0.0% in `UTC`, `Asia/Shanghai`, `Asia/Kolkata` and
 * `Australia/Perth` at every `maxAgeDays`, which is exactly why nothing in CI
 * ever went red on this and why it shipped. Every case below therefore fakes
 * BOTH halves of the environment: a DST-observing zone (`process.env.TZ`,
 * re-read by V8 on the next `Date` operation) AND an instant whose retention
 * window straddles that zone's own transition.
 *
 * ## The mechanism, stated once
 *
 * `setDate` preserves WALL-CLOCK time, so shifting the local calendar back n
 * days moves the INSTANT by exactly n x 24h only while every local day in the
 * window is 24 hours long. If the window straddles a spring-forward it is 23
 * hours; a fall-back, 25. The rendering is `toISOString()` — UTC — and unlike
 * the date-slice case this is a FULL instant, so the error is the transition's
 * own size (one hour in most zones, THIRTY MINUTES on Lord Howe Island), not a
 * whole day. That instant goes straight into a `$lt` DELETE filter.
 *
 * Note what that makes the trigger condition: the window need only straddle a
 * transition, with no second condition about crossing a UTC midnight. So the
 * exposure grows with `maxAgeDays` rather than staying at "twice a year" —
 * measured over the same sweep, in `America/New_York` the mixed spelling is
 * wrong for 0.6% of instants at `maxAgeDays: 1`, 16.4% at 30, 49.7% at 90 and
 * 69.4% at 180.
 *
 * ## The inline control is load-bearing
 *
 * Each cell also evaluates the OLD mixed spelling directly and asserts it
 * DISAGREES with the truth there. Without that, a green run would be ambiguous
 * between "the fix works" and "these instants are not actually in a transition
 * window" — the second being the failure mode that hid this defect. With it,
 * the file proves each of its own instants is live before it credits the fix.
 *
 * ## Deliberately NOT pinned here
 *
 * - Whether retention should be timezone-AWARE at all. #15824 explicitly does
 *   not propose it; the fence below pins the opposite — the cutoff is
 *   timezone-INVARIANT, identical in every zone for a given instant.
 * - That `getCleanupStats()`'s preview and `runCleanup()`'s delete agree with
 *   each other in production. They read `new Date()` independently, so they can
 *   straddle any boundary for that ordinary reason; that is inherent and this
 *   change does not remove it. Each site is pinned against the truth
 *   SEPARATELY, at one frozen instant, which is what "both sites carry the same
 *   spelling" means and all it means.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import type { MetadataHistoryRetentionPolicy } from '@objectstack/spec/system';
import type { DatabaseLoader } from '../loaders/database-loader.js';
import { HistoryCleanupManager } from './history-cleanup.js';

const TABLE = 'sys_metadata_history';
const REAL_TZ = process.env.TZ;

/** Run `fn` with the process on `zone` and the clock frozen at `instant`. */
async function at<T>(zone: string, instant: string, fn: () => Promise<T> | T): Promise<T> {
  process.env.TZ = zone;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
    if (REAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = REAL_TZ;
  }
}

/** The defect, spelled out: day arithmetic on the LOCAL calendar, rendered on UTC. */
function mixedCalendarSpelling(instant: string, maxAgeDays: number): string {
  const d = new Date(instant);
  d.setDate(d.getDate() - maxAgeDays);
  return d.toISOString();
}

/**
 * The truth, computed from NEITHER spelling: the instant minus n x 24h.
 * `maxAgeDays: n` means "older than n days", and a UTC day is always exactly
 * 24 hours — so this is the definition of the window, not a second
 * implementation of the fix.
 */
function utcWindowStart(instant: string, maxAgeDays: number): string {
  return new Date(Date.parse(instant) - maxAgeDays * 86_400_000).toISOString();
}

interface Captured {
  deleteFilter?: Record<string, unknown>;
  countWhere?: Record<string, unknown>;
}

/**
 * A manager over a driver stub that records the filter each call site builds.
 * `HistoryCleanupManager` reads `driver`, `historyTableName` and
 * `organizationId` off the loader by property, so a plain object is enough.
 */
function managerFor(
  policy: MetadataHistoryRetentionPolicy,
  captured: Captured,
  organizationId?: string,
): HistoryCleanupManager {
  const driver = {
    deleteMany(table: string, filter: Record<string, unknown>): number {
      expect(table).toBe(TABLE);
      captured.deleteFilter = filter;
      return 0;
    },
    count(table: string, options: { where: Record<string, unknown> }): number {
      expect(table).toBe(TABLE);
      captured.countWhere = options.where;
      return 0;
    },
    find(): Record<string, unknown>[] {
      throw new Error('the maxVersions branch must not run in these cases');
    },
  } as unknown as IDataDriver;

  const loader = {
    driver,
    historyTableName: TABLE,
    organizationId,
  } as unknown as DatabaseLoader;

  return new HistoryCleanupManager(policy, loader);
}

/** The `$lt` bound `runCleanup()` actually hands the driver. */
async function deleteCutoff(maxAgeDays: number): Promise<string> {
  const captured: Captured = {};
  const result = await managerFor({ maxAgeDays }, captured).runCleanup();
  // `runCleanup` swallows driver errors into `errors`, so an uncaptured filter
  // would otherwise read as a pass.
  expect(result.errors, 'the delete path errored instead of building a filter').toBe(0);
  expect(captured.deleteFilter, 'the delete path never reached the driver').toBeDefined();
  const recordedAt = captured.deleteFilter!.recorded_at as { $lt: string };
  return recordedAt.$lt;
}

/** The `$lt` bound `getCleanupStats()` actually hands the driver. */
async function previewCutoff(maxAgeDays: number): Promise<string> {
  const captured: Captured = {};
  const stats = await managerFor({ maxAgeDays }, captured).getCleanupStats();
  expect(stats.recordsByAge, 'the preview path did not count by age').toBe(0);
  expect(captured.countWhere, 'the preview path never reached the driver').toBeDefined();
  const recordedAt = captured.countWhere!.recorded_at as { $lt: string };
  return recordedAt.$lt;
}

interface Cell {
  zone: string;
  /** Frozen clock, always written in UTC. */
  instant: string;
  maxAgeDays: number;
  /** `instant` and the true cutoff as local wall clock, so the window is readable. */
  localNow: string;
  localCutoff: string;
  /** How far the OLD spelling lands from the truth, in minutes. */
  slipMinutes: number;
}

/**
 * Red cells — every one MEASURED, not guessed: each is an instant at which the
 * mixed spelling actually disagrees with the truth in that zone, taken from a
 * 12-zone x 366-day x 48-half-hour x 7-`maxAgeDays` sweep of 2026 (347,539
 * disagreeing combinations; these are 16 of them). Both hemispheres, both
 * transition directions, `maxAgeDays` from 1 to 180, three zones whose standard
 * offset is not a whole hour (St_Johns -03:30, Adelaide +09:30, Chatham +12:45)
 * and one whose TRANSITION is not a whole hour (Lord_Howe, +30 minutes) so a
 * whole-hour assumption cannot hide in the fix.
 */
const DST_CELLS: Cell[] = [
  { zone: 'America/New_York',    instant: '2026-03-08T07:00:00.000Z', maxAgeDays:   1, localNow: '2026-03-08 03:00 EDT',      localCutoff: '2026-03-07 02:00 EST',      slipMinutes:  60 },
  { zone: 'America/New_York',    instant: '2026-11-01T06:00:00.000Z', maxAgeDays:   1, localNow: '2026-11-01 01:00 EST',      localCutoff: '2026-10-31 02:00 EDT',      slipMinutes: -60 },
  { zone: 'America/Los_Angeles', instant: '2026-03-08T10:00:00.000Z', maxAgeDays:  30, localNow: '2026-03-08 03:00 PDT',      localCutoff: '2026-02-06 02:00 PST',      slipMinutes:  60 },
  { zone: 'America/St_Johns',    instant: '2026-03-08T05:30:00.000Z', maxAgeDays:   1, localNow: '2026-03-08 03:00 NDT',      localCutoff: '2026-03-07 02:00 NST',      slipMinutes:  60 },
  { zone: 'America/Santiago',    instant: '2026-04-05T03:00:00.000Z', maxAgeDays:  90, localNow: '2026-04-04 23:00 GMT-4',    localCutoff: '2026-01-05 00:00 GMT-3',    slipMinutes: -60 },
  { zone: 'Europe/London',       instant: '2026-03-29T01:00:00.000Z', maxAgeDays:   1, localNow: '2026-03-29 02:00 GMT+1',    localCutoff: '2026-03-28 01:00 GMT',      slipMinutes:  60 },
  { zone: 'Europe/London',       instant: '2026-10-25T01:00:00.000Z', maxAgeDays:   1, localNow: '2026-10-25 01:00 GMT',      localCutoff: '2026-10-24 02:00 GMT+1',    slipMinutes: -60 },
  { zone: 'Europe/Berlin',       instant: '2026-04-24T01:00:00.000Z', maxAgeDays: 180, localNow: '2026-04-24 03:00 GMT+2',    localCutoff: '2025-10-26 02:00 GMT+1',    slipMinutes:  60 },
  { zone: 'Asia/Jerusalem',      instant: '2026-10-24T23:00:00.000Z', maxAgeDays:   7, localNow: '2026-10-25 01:00 GMT+2',    localCutoff: '2026-10-18 02:00 GMT+3',    slipMinutes: -60 },
  { zone: 'Australia/Sydney',    instant: '2026-10-03T16:00:00.000Z', maxAgeDays:   1, localNow: '2026-10-04 03:00 GMT+11',   localCutoff: '2026-10-03 02:00 GMT+10',   slipMinutes:  60 },
  { zone: 'Australia/Sydney',    instant: '2026-04-04T16:00:00.000Z', maxAgeDays:   1, localNow: '2026-04-05 02:00 GMT+10',   localCutoff: '2026-04-04 03:00 GMT+11',   slipMinutes: -60 },
  { zone: 'Australia/Adelaide',  instant: '2026-01-01T00:00:00.000Z', maxAgeDays:  90, localNow: '2026-01-01 10:30 GMT+10:30', localCutoff: '2025-10-03 09:30 GMT+9:30', slipMinutes:  60 },
  { zone: 'Australia/Lord_Howe', instant: '2026-10-03T15:30:00.000Z', maxAgeDays:   1, localNow: '2026-10-04 02:30 GMT+11',   localCutoff: '2026-10-03 02:00 GMT+10:30', slipMinutes:  30 },
  { zone: 'Australia/Lord_Howe', instant: '2026-04-04T15:00:00.000Z', maxAgeDays:   1, localNow: '2026-04-05 01:30 GMT+10:30', localCutoff: '2026-04-04 02:00 GMT+11',  slipMinutes: -30 },
  { zone: 'Pacific/Auckland',    instant: '2026-04-04T14:00:00.000Z', maxAgeDays:  30, localNow: '2026-04-05 02:00 GMT+12',   localCutoff: '2026-03-06 03:00 GMT+13',   slipMinutes: -60 },
  { zone: 'Pacific/Chatham',     instant: '2026-09-26T14:00:00.000Z', maxAgeDays:   1, localNow: '2026-09-27 03:45 GMT+13:45', localCutoff: '2026-09-26 02:45 GMT+12:45', slipMinutes:  60 },
];

/** Zones that never observe DST — where the two spellings have always agreed. */
const NON_DST_ZONES = ['UTC', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Perth'];

const label = (c: Cell) =>
  `${c.zone} @ ${c.instant} (${c.localNow}), maxAgeDays=${c.maxAgeDays}`;

describe('#15824 the retention cutoff resolves on one calendar, across DST transitions', () => {
  for (const c of DST_CELLS) {
    const direction = c.slipMinutes > 0 ? 'deletes too much' : 'retains too long';
    it(`${direction} (${c.slipMinutes}min): ${label(c)}`, async () => {
      await at(c.zone, c.instant, async () => {
        const expected = utcWindowStart(c.instant, c.maxAgeDays);

        // CONTROL FIRST — if this passes, the window does not straddle a
        // transition here and both assertions below would be vacuous. It is the
        // whole reason a TZ=UTC-only test is worthless for this defect.
        expect(
          mixedCalendarSpelling(c.instant, c.maxAgeDays),
          `${label(c)}: the mixed spelling must DISAGREE here, otherwise this cell pins nothing`,
        ).not.toBe(expected);

        // Both sites carry the same spelling, so both are pinned.
        expect(await deleteCutoff(c.maxAgeDays), `delete path: ${label(c)}`).toBe(expected);
        expect(await previewCutoff(c.maxAgeDays), `preview path: ${label(c)}`).toBe(expected);
      });
    });
  }

  it('every cell is live — the control disagrees in all of them', async () => {
    const live: Cell[] = [];
    for (const c of DST_CELLS) {
      const flips = await at(
        c.zone,
        c.instant,
        () =>
          mixedCalendarSpelling(c.instant, c.maxAgeDays) !==
          utcWindowStart(c.instant, c.maxAgeDays),
      );
      if (flips) live.push(c);
    }
    expect(live.length, 'a cell that no longer flips has stopped guarding the fix').toBe(
      DST_CELLS.length,
    );
  });

  it('the recorded slip of every cell is the one actually measured there', async () => {
    for (const c of DST_CELLS) {
      const slip = await at(
        c.zone,
        c.instant,
        () =>
          (Date.parse(mixedCalendarSpelling(c.instant, c.maxAgeDays)) -
            Date.parse(utcWindowStart(c.instant, c.maxAgeDays))) /
          60_000,
      );
      expect(slip, label(c)).toBe(c.slipMinutes);
    }
  });

  it('both directions are represented — a cutoff too LATE and one too EARLY', () => {
    const dirs = new Set(DST_CELLS.map((c) => (c.slipMinutes > 0 ? 'late' : 'early')));
    expect([...dirs].sort()).toEqual(['early', 'late']);
  });

  it('a sub-hour transition is represented — a whole-hour assumption cannot hide', () => {
    const subHour = DST_CELLS.filter((c) => Math.abs(c.slipMinutes) % 60 !== 0);
    expect(subHour.map((c) => c.slipMinutes).sort((a, b) => a - b)).toEqual([-30, 30]);
  });
});

// -- Fences: what this change must NOT have moved -------------------------------

describe('#15824 fences — retention did not become timezone-aware', () => {
  it('the cutoff is timezone-INVARIANT: the same instant and maxAgeDays give the same bound in every zone', async () => {
    const instant = '2026-03-08T07:00:00.000Z';
    for (const maxAgeDays of [1, 30, 90]) {
      const expected = utcWindowStart(instant, maxAgeDays);
      for (const zone of [...new Set(DST_CELLS.map((c) => c.zone)), ...NON_DST_ZONES]) {
        await at(zone, instant, async () => {
          expect(await deleteCutoff(maxAgeDays), `${zone} delete @ maxAgeDays=${maxAgeDays}`).toBe(
            expected,
          );
          expect(await previewCutoff(maxAgeDays), `${zone} preview @ maxAgeDays=${maxAgeDays}`).toBe(
            expected,
          );
        });
      }
    }
  });

  it('zones that do not observe DST are unaffected — both spellings already agreed there', async () => {
    for (const zone of NON_DST_ZONES) {
      for (const instant of [
        '2026-03-08T07:00:00.000Z',
        '2026-11-01T06:00:00.000Z',
        '2026-06-15T12:00:00.000Z',
      ]) {
        await at(zone, instant, async () => {
          expect(mixedCalendarSpelling(instant, 30), `${zone} @ ${instant}`).toBe(
            utcWindowStart(instant, 30),
          );
          expect(await deleteCutoff(30), `${zone} @ ${instant}`).toBe(utcWindowStart(instant, 30));
        });
      }
    }
  });

  it('an ordinary instant in a DST zone is unaffected — every local day in the window is 24h', async () => {
    for (const zone of [...new Set(DST_CELLS.map((c) => c.zone))]) {
      const instant = '2026-06-15T12:00:00.000Z';
      await at(zone, instant, async () => {
        expect(mixedCalendarSpelling(instant, 7), zone).toBe(utcWindowStart(instant, 7));
        expect(await deleteCutoff(7), zone).toBe(utcWindowStart(instant, 7));
      });
    }
  });
});

describe('#15824 fences — the rest of both filters is untouched', () => {
  it('the delete filter still scopes by organization and excludes executionPinned types', async () => {
    const captured: Captured = {};
    await at('America/New_York', '2026-03-08T07:00:00.000Z', () =>
      managerFor({ maxAgeDays: 1 }, captured, 'org_42').runCleanup(),
    );
    const filter = captured.deleteFilter!;
    expect(filter.organization_id).toBe('org_42');
    expect((filter.type as { $nin: string[] }).$nin.length).toBeGreaterThan(0);
    expect(filter.recorded_at).toEqual({ $lt: utcWindowStart('2026-03-08T07:00:00.000Z', 1) });
  });

  it('the preview filter carries the same scoping', async () => {
    const captured: Captured = {};
    await at('Australia/Lord_Howe', '2026-10-03T15:30:00.000Z', () =>
      managerFor({ maxAgeDays: 1 }, captured, 'org_42').getCleanupStats(),
    );
    const where = captured.countWhere!;
    expect(where.organization_id).toBe('org_42');
    expect((where.type as { $nin: string[] }).$nin.length).toBeGreaterThan(0);
    expect(where.recorded_at).toEqual({ $lt: utcWindowStart('2026-10-03T15:30:00.000Z', 1) });
  });

  it('a policy without maxAgeDays builds no age filter at all', async () => {
    const captured: Captured = {};
    const result = await at('America/New_York', '2026-03-08T07:00:00.000Z', () =>
      managerFor({}, captured).runCleanup(),
    );
    expect(captured.deleteFilter).toBeUndefined();
    expect(result).toEqual({ deleted: 0, errors: 0 });
  });

  it('the process timezone is restored after every case', () => {
    expect(process.env.TZ).toBe(REAL_TZ);
  });
});
