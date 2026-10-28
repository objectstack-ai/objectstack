// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27172] The draft preview counts a preset `dateRange` on a `date` field by
 * the reference zone's calendar days, as the published faces do
 * (`dateRangeWindowBounds`); a `datetime` field keeps comparing instants.
 *
 * MEASURED on `origin/main` `4d3a077f`, before the change: Shanghai's
 * `this_quarter` on the `date` field selected Jun 30 and dropped Sep 30 — the
 * preset's Shanghai-midnight instants read by their leading UTC day. The
 * published-face half (both strategies, count and drill on one window) is
 * `dataset-drill-window.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Cube } from '@objectstack/spec/data';
import { evaluateAnalyticsQueryOverRows } from '../preview-evaluator.js';

/** Frozen: Wednesday 2026-09-09 in UTC, Shanghai and Los Angeles, inside Q3. */
const NOW = new Date('2026-09-09T12:34:56.789Z');

const CUBE = {
  name: 'deals_ds',
  sql: 'deal',
  dimensions: {
    id: { type: 'string', sql: 'id' },
    close_on: { type: 'time', sql: 'close_on' },
    closed_at: { type: 'time', sql: 'closed_at' },
  },
  measures: { count: { type: 'count', sql: '*' } },
} as unknown as Cube;

const DECLARED = (field: string): string | undefined =>
  field === 'close_on' ? 'date' : field === 'closed_at' ? 'datetime' : undefined;

/** Either side of each edge of Q3 2026. */
const ROWS = [
  { id: 'jun30', close_on: '2026-06-30', closed_at: '2026-06-30T15:59:59.000Z' }, // Shanghai Jun 30 23:59
  { id: 'jul01', close_on: '2026-07-01', closed_at: '2026-06-30T16:00:00.000Z' }, // Shanghai Jul 1 00:00
  { id: 'sep30', close_on: '2026-09-30', closed_at: '2026-09-30T15:59:59.000Z' }, // Shanghai Sep 30 23:59
  { id: 'oct01', close_on: '2026-10-01', closed_at: '2026-09-30T16:00:00.000Z' }, // Shanghai Oct 1 00:00
];

function idsIn(dimension: 'close_on' | 'closed_at', timezone: string): string[] {
  const result = evaluateAnalyticsQueryOverRows(
    {
      cube: 'deals_ds',
      measures: ['count'],
      dimensions: ['id'],
      timeDimensions: [{ dimension, dateRange: 'this_quarter' }],
      timezone,
    },
    CUBE,
    ROWS,
    DECLARED,
  );
  return result.rows.map((r) => String(r.id)).sort();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('#27172 — the draft preview counts a preset on a date field by the zone\'s calendar days', () => {
  it('a date field selects Jul 1 through Sep 30, east and west of UTC', () => {
    for (const timezone of ['Asia/Shanghai', 'America/Los_Angeles', 'UTC']) {
      expect(idsIn('close_on', timezone), timezone).toEqual(['jul01', 'sep30']);
    }
  });

  it('a datetime field keeps comparing the zone\'s midnight instants', () => {
    expect(idsIn('closed_at', 'Asia/Shanghai')).toEqual(['jul01', 'sep30']);
    // Los Angeles' Q3 opens at 2026-07-01T07:00Z, after both June instants,
    // and both September instants are still its Sep 30.
    expect(idsIn('closed_at', 'America/Los_Angeles')).toEqual(['oct01', 'sep30']);
  });
});
