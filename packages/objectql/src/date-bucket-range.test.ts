// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Round-trip parity: `bucketKeyToCalendarRange` (@objectstack/core) is the
// INVERSE of `bucketDateValue` (this package). A drill on a date-bucketed
// report cell turns the bucket KEY back into the half-open `[start, end)` span
// of records that fall in it, so the two MUST agree on every boundary — any
// drift silently mis-scopes the drilled record list. This test pins them
// together (mirrors the driver-sql `buildDateBucketExpr` parity harness).

import { describe, it, expect } from 'vitest';
import { bucketKeyToCalendarRange, type BucketGranularity } from '@objectstack/core';
import { bucketDateValue } from './in-memory-aggregation.js';

const DAY_MS = 86_400_000;
const utcMidnight = (ymd: string) => Date.parse(`${ymd}T00:00:00.000Z`);

// Instants chosen to hit cross-year / cross-quarter / cross-month and the ISO
// week boundary (2024-12-30 is ISO week 2025-W01). Same spirit as the driver
// parity fixture.
const INSTANTS = [
  '2024-01-15T10:00:00Z',
  '2024-04-01T00:00:00Z',
  '2024-06-30T23:59:59Z',
  '2024-07-01T00:00:00Z',
  '2024-12-30T12:00:00Z', // ISO 2025-W01
  '2025-01-01T00:00:00Z',
  '2025-05-19T09:00:00Z',
  '2026-02-15T00:00:00Z',
  '2026-12-31T23:00:00Z',
];
const GRANULARITIES: BucketGranularity[] = ['day', 'week', 'month', 'quarter', 'year'];

describe('bucketKeyToCalendarRange ↔ bucketDateValue round-trip (UTC)', () => {
  for (const iso of INSTANTS) {
    for (const g of GRANULARITIES) {
      it(`${iso} @ ${g}`, () => {
        const d = new Date(iso);
        const key = bucketDateValue(d, g); // no tz → UTC key
        const range = bucketKeyToCalendarRange(key, g);
        expect(range, `range for key ${key}`).not.toBeNull();
        const startMs = utcMidnight(range!.start);
        const endMs = utcMidnight(range!.end);

        // the instant lies inside the half-open span
        expect(startMs).toBeLessThanOrEqual(d.getTime());
        expect(d.getTime()).toBeLessThan(endMs);

        // start is the FIRST day of this bucket; end is the next bucket's start
        expect(bucketDateValue(new Date(startMs), g)).toBe(key);
        expect(bucketDateValue(new Date(endMs - 1), g)).toBe(key); // last instant still in bucket
        expect(bucketDateValue(new Date(endMs), g)).not.toBe(key); // boundary belongs to next bucket

        // half-open width sanity for fixed-width granularities
        if (g === 'day') expect(endMs - startMs).toBe(DAY_MS);
        if (g === 'week') expect(endMs - startMs).toBe(7 * DAY_MS);
      });
    }
  }
});

describe('bucketKeyToCalendarRange exact boundaries', () => {
  it('year / quarter / month / day / week', () => {
    expect(bucketKeyToCalendarRange('2026', 'year')).toEqual({ start: '2026-01-01', end: '2027-01-01' });
    expect(bucketKeyToCalendarRange('2026-Q1', 'quarter')).toEqual({ start: '2026-01-01', end: '2026-04-01' });
    expect(bucketKeyToCalendarRange('2026-Q2', 'quarter')).toEqual({ start: '2026-04-01', end: '2026-07-01' });
    expect(bucketKeyToCalendarRange('2026-Q4', 'quarter')).toEqual({ start: '2026-10-01', end: '2027-01-01' });
    expect(bucketKeyToCalendarRange('2026-12', 'month')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(bucketKeyToCalendarRange('2024-02', 'month')).toEqual({ start: '2024-02-01', end: '2024-03-01' });
    expect(bucketKeyToCalendarRange('2024-02-29', 'day')).toEqual({ start: '2024-02-29', end: '2024-03-01' });
    expect(bucketKeyToCalendarRange('2025-W01', 'week')).toEqual({ start: '2024-12-30', end: '2025-01-06' });
  });
});

describe('bucketKeyToCalendarRange rejects unbucketable / out-of-range keys → null (superset fallback)', () => {
  it('null and empty buckets', () => {
    expect(bucketKeyToCalendarRange('(null)', 'month')).toBeNull();
    expect(bucketKeyToCalendarRange('', 'day')).toBeNull();
  });
  it('shape mismatch vs. granularity', () => {
    expect(bucketKeyToCalendarRange('2026', 'month')).toBeNull();
    expect(bucketKeyToCalendarRange('2026-06', 'day')).toBeNull();
    expect(bucketKeyToCalendarRange('2026-Q2', 'month')).toBeNull();
  });
  it('out-of-range fields', () => {
    expect(bucketKeyToCalendarRange('2026-13', 'month')).toBeNull(); // month 13
    expect(bucketKeyToCalendarRange('2026-02-30', 'day')).toBeNull(); // impossible day
    expect(bucketKeyToCalendarRange('2025-W53', 'week')).toBeNull(); // 2025 has 52 ISO weeks
  });
});
