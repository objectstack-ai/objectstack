/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * date-bucket-label — the display face of a month bucket key.
 *
 * The analytics executor answers a `month`-granularity date dimension with a
 * sort-stable bucket KEY, `YYYY-MM` (`2025-10`). The key is the row's identity:
 * a drill-through filters by it and the chart orders by it, so it stays as the
 * executor wrote it. What a reader sees on an axis is this face instead,
 * `Oct 2025` in the display locale.
 *
 * Only the key shape is recognised: four digits, a dash, a month 01..12, and
 * nothing else. A day (`YYYY-MM-DD`) is the date-display path's, and a quarter
 * (`2025-Q4`) or a year (`2025`) already reads as written.
 *
 * The month is formatted in UTC from a UTC date, so no display or browser
 * time zone can move it to the neighbouring month.
 */

const MONTH_BUCKET_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Whether `value` is a month bucket key (`YYYY-MM`). */
export function isMonthBucketKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_BUCKET_KEY_RE.test(value);
}

/**
 * `Oct 2025` for the month bucket key `2025-10`, in `locale`; `undefined` for
 * any other value, or when `Intl` refuses the locale, so the caller keeps the
 * key as written.
 */
export function formatMonthBucketLabel(value: unknown, locale?: string): string | undefined {
  if (!isMonthBucketKey(value)) return undefined;
  const [year, month] = value.split('-').map(Number);
  const date = new Date(0);
  // `setUTCFullYear`, not `Date.UTC(year, …)`: the latter maps years 0-99 onto 1900+y.
  date.setUTCFullYear(year, month - 1, 1);
  try {
    return date.toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return undefined;
  }
}
