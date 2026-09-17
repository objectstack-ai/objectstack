// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18245] A non-UTC calendar preset under `compareTo` must produce the SAME
 * number of days as the window it compares against.
 *
 * ## What was wrong
 *
 * `DatasetExecutor`'s `compareTo` day math was UTC-calendar throughout: a local
 * `parseUTC` read a bound as UTC midnight and a local `toISODate` emitted a UTC
 * day. The lowered preset window, however, is a pair of INSTANTS — the ten
 * calendar presets open at the reference zone's midnight and close at the next
 * period's midnight in that same zone (`analytics-date-range.ts` renders both
 * bounds through `zonedDateStartToUtcMs`). Projecting those instants onto UTC
 * days therefore moved a boundary whenever the zone's midnight is not UTC's.
 *
 * MEASURED on `e0d05538c`, driven through `DatasetExecutor.execute`,
 * `this_month` + `compareTo: { kind: 'previousYear' }`, frozen at 2026-09-09:
 *
 * | timezone | comparison window | reading |
 * |---|---|---|
 * | `UTC` | `['2025-09-01','2025-09-30']` | 30 days — correct |
 * | `Asia/Shanghai` | `['2025-08-31','2025-09-30']` | 31 days — starts a day early |
 * | `America/New_York` | `['2025-09-01','2025-10-01']` | 31 days — ends a day late |
 *
 * ⭐ **The two failures go in OPPOSITE directions.** That is the signature of a
 * day-boundary projection, ⛔ not an off-by-one constant — and it is why the
 * `UTC` row below is a LIT positive control rather than a comment: a fix that
 * shifted a constant would make one non-UTC row 30 days, break `UTC`, and read
 * as a pass to any suite that measured a single zone.
 *
 * ⛔ Not a regression of #18241. Before it this input was a hard
 * `DATASET_INVALID` / 400 — the preset arm could not produce a window at all.
 * What #18241 changed is REACHABILITY, so a refusal became a slightly-too-wide
 * answer for non-UTC orgs and a correct one for UTC orgs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IAnalyticsService, AnalyticsQuery } from '@objectstack/spec/contracts';
import { DatasetSchema } from '@objectstack/spec/ui';
import { compileDataset } from '../dataset-compiler.js';
import { DatasetExecutor } from '../dataset-executor.js';

/**
 * Noon UTC on the frozen day, so all three zones below read the SAME calendar
 * day (`2026-09-09`) and no row is measuring a "which day is it" difference
 * instead of the projection this file is about.
 */
const FROZEN_NOW = new Date('2026-09-09T12:00:00.000Z');

const pipeline = DatasetSchema.parse({
  name: 'pipeline',
  label: 'Pipeline',
  object: 'opportunity',
  dimensions: [
    { name: 'lead_source', field: 'lead_source', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date' },
  ],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

function recordingService(): { service: IAnalyticsService; seen: AnalyticsQuery[] } {
  const seen: AnalyticsQuery[] = [];
  const service: IAnalyticsService = {
    query: vi.fn(async (q: AnalyticsQuery) => {
      seen.push(q);
      return { rows: [], fields: [] };
    }),
    getMeta: async () => [],
  };
  return { service, seen };
}

/**
 * The `compareTo` window the executor actually shifted to, read off the wire.
 *
 * The primary pass forwards the selection's own `dateRange` — the preset STRING
 * — while `runCompare` replaces it with the shifted explicit `[start, end]`
 * array, so the array arm is an unambiguous discriminator between the two
 * passes and needs no ordering assumption.
 */
async function comparisonWindow(timezone: string): Promise<[string, string]> {
  const { service, seen } = recordingService();
  await new DatasetExecutor(service).execute(compileDataset(pipeline), {
    dimensions: ['lead_source'],
    measures: ['revenue'],
    timeDimensions: [{ dimension: 'close_date', dateRange: 'this_month' }],
    compareTo: { kind: 'previousYear' as const, dimension: 'close_date' },
    timezone,
  });
  const shifted = seen
    .map((q) => (q.timeDimensions ?? []).find((t) => t.dimension === 'close_date')?.dateRange)
    .filter((r): r is [string, string] => Array.isArray(r));
  expect(shifted.length, 'exactly one shifted comparison pass').toBeGreaterThan(0);
  return shifted[0];
}

/** Inclusive length of a `[YYYY-MM-DD, YYYY-MM-DD]` window, in calendar days. */
function inclusiveDays([start, end]: [string, string]): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

describe('compareTo — a calendar preset keeps its length in every reference zone (#18245)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── the positive control, and it stays lit ────────────────────────────────
  it('UTC — September 2026 compares against all 30 days of September 2025', async () => {
    const window = await comparisonWindow('UTC');
    expect(window).toEqual(['2025-09-01', '2025-09-30']);
    expect(inclusiveDays(window)).toBe(30);
  });

  // ── the two defects, failing in OPPOSITE directions ───────────────────────
  it('Asia/Shanghai — does not start a day early (was 2025-08-31, 31 days)', async () => {
    const window = await comparisonWindow('Asia/Shanghai');
    expect(window[0], 'the zone is EAST of UTC, so its midnight is the PREVIOUS UTC day').toBe('2025-09-01');
    expect(window).toEqual(['2025-09-01', '2025-09-30']);
    expect(inclusiveDays(window)).toBe(30);
  });

  it('America/New_York — does not end a day late (was 2025-10-01, 31 days)', async () => {
    const window = await comparisonWindow('America/New_York');
    expect(window[1], 'the zone is WEST of UTC, so its next-month midnight is the NEXT UTC day').toBe('2025-09-30');
    expect(window).toEqual(['2025-09-01', '2025-09-30']);
    expect(inclusiveDays(window)).toBe(30);
  });

  // ── one assertion the three rows share, stated as the invariant ───────────
  it('every reference zone reports the same 30-day window', async () => {
    const zones = ['UTC', 'Asia/Shanghai', 'America/New_York', 'Pacific/Kiritimati', 'Pacific/Niue'];
    const windows = await Promise.all(zones.map(async (tz) => [tz, await comparisonWindow(tz)] as const));
    expect(Object.fromEntries(windows.map(([tz, w]) => [tz, inclusiveDays(w)]))).toEqual(
      Object.fromEntries(zones.map((tz) => [tz, 30])),
    );
    for (const [tz, w] of windows) expect(w, tz).toEqual(['2025-09-01', '2025-09-30']);
  });
});
