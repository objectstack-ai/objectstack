/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The month bucket key's display face (objectstack#27520 row 15): a
 * `month`-granularity date dimension answers `2025-10`, and an axis reads
 * `Oct 2025`.
 */

import { describe, it, expect } from 'vitest';
import { formatMonthBucketLabel } from '../date-bucket-label';

describe('formatMonthBucketLabel', () => {
  it('reads a month bucket key as the short month and the year, in the locale', () => {
    expect(formatMonthBucketLabel('2025-10', 'en-US')).toBe('Oct 2025');
    expect(formatMonthBucketLabel('2026-01', 'en-US')).toBe('Jan 2026');
    expect(formatMonthBucketLabel('2025-10', 'zh-CN')).toBe(new Date(Date.UTC(2025, 9, 1)).toLocaleDateString('zh-CN', { month: 'short', year: 'numeric', timeZone: 'UTC' }));
  });

  it('names the month the key names whatever the time zone (formatted in UTC)', () => {
    // The first of the month at UTC midnight is the previous day west of UTC;
    // a local-zone face would print September for `2025-10` there.
    expect(formatMonthBucketLabel('2025-10', 'en-US')).not.toMatch(/Sep/);
    expect(formatMonthBucketLabel('2025-12', 'en-US')).toBe('Dec 2025');
  });

  it('keeps a year below 100 as written', () => {
    expect(formatMonthBucketLabel('0050-06', 'en-US')).toMatch(/50/);
    expect(formatMonthBucketLabel('0050-06', 'en-US')).not.toMatch(/1950/);
  });

  it('answers undefined for every other shape, so the caller keeps the value as written', () => {
    for (const v of ['2025-10-01', '2025-Q4', '2025', '2025-13', '2025-00', '2025-1', 'In Progress', '', null, undefined, 202510]) {
      expect(formatMonthBucketLabel(v, 'en-US'), String(v)).toBeUndefined();
    }
  });

  it('answers undefined for a locale Intl refuses', () => {
    expect(formatMonthBucketLabel('2025-10', 'not a locale!')).toBeUndefined();
  });
});
