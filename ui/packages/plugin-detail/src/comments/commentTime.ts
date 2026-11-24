/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * When a comment was written, as its header line says it: 「刚刚」, minutes,
 * hours or days ago within a week, the date in the display locale after that.
 */
export function formatCommentTime(
  timestamp: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
  now: Date = new Date(),
): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMins < 1) return t('detail.justNow');
  if (diffMins < 60) return t('detail.minutesAgo', { count: diffMins });
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t('detail.hoursAgo', { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return t('detail.daysAgo', { count: diffDays });
  return date.toLocaleDateString(locale);
}
