/**
 * @object-ui/i18n - Date and currency formatting utilities
 *
 * Uses the native Intl API for locale-aware formatting.
 *
 * Every date helper below reads a string through `toDisplayDate`
 * (`@object-ui/core`), the one parse step behind the date faces
 * (objectui#10110, objectui#10183). The engine's own parse reads a date-only
 * `2026-09-01` as UTC midnight, so each helper named August 31st for every
 * viewer west of UTC (objectui#10866). The shared step tells the two shapes
 * apart by the value: a date-only string is rebuilt at local midnight of the
 * day it names, and a value with a time part keeps its instant. It also
 * refuses a day its month does not have (`2026-02-30`, objectui#10026), which
 * each helper then renders as the raw string, its face for any unparsable
 * value.
 */

import { toDisplayDate } from '@object-ui/core';

export interface DateFormatOptions {
  locale?: string;
  style?: 'short' | 'medium' | 'long' | 'full';
  dateStyle?: Intl.DateTimeFormatOptions['dateStyle'];
  timeStyle?: Intl.DateTimeFormatOptions['timeStyle'];
}

export interface CurrencyFormatOptions {
  locale?: string;
  currency?: string;
  style?: 'currency' | 'decimal' | 'percent';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export interface NumberFormatOptions {
  locale?: string;
  style?: 'decimal' | 'percent' | 'unit';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  notation?: 'standard' | 'scientific' | 'engineering' | 'compact';
}

/**
 * Format a date according to locale conventions
 */
export function formatDate(
  date: Date | string | number,
  options: DateFormatOptions = {},
): string {
  const { locale = 'en', style = 'medium' } = options;
  const d = toDisplayDate(date);

  if (isNaN(d.getTime())) {
    return String(date);
  }

  const styleMap: Record<string, Intl.DateTimeFormatOptions> = {
    short: { year: '2-digit', month: 'numeric', day: 'numeric' },
    medium: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { year: 'numeric', month: 'long', day: 'numeric' },
    full: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' },
  };

  const formatOptions = options.dateStyle
    ? { dateStyle: options.dateStyle, timeStyle: options.timeStyle }
    : styleMap[style] || styleMap.medium;

  return new Intl.DateTimeFormat(locale, formatOptions).format(d);
}

/**
 * Format a date and time according to locale conventions
 */
export function formatDateTime(
  date: Date | string | number,
  options: DateFormatOptions = {},
): string {
  const { locale = 'en', style = 'medium' } = options;
  const d = toDisplayDate(date);

  if (isNaN(d.getTime())) {
    return String(date);
  }

  const styleMap: Record<string, Intl.DateTimeFormatOptions> = {
    short: { year: '2-digit', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' },
    medium: { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' },
    long: { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' },
    full: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', timeZoneName: 'short' },
  };

  return new Intl.DateTimeFormat(locale, styleMap[style] || styleMap.medium).format(d);
}

/**
 * Format a relative time (e.g., "2 days ago", "in 3 hours")
 *
 * A date-only value counts from now to the START of the day it names (local
 * midnight), the same distance in every zone at the same wall-clock time.
 * An unparsable value comes back as its string, as it does from
 * {@link formatDate}; `Intl.RelativeTimeFormat` would throw on it.
 *
 * `options` are `Intl.RelativeTimeFormat`'s own `style` and `numeric`, passed
 * through unchanged; omitted, the result is what it always was (`long`,
 * `auto`: "yesterday", "2 days ago"). A surface with little room asks for a
 * compact form, e.g. `{ style: 'short', numeric: 'always' }` ("1 day ago",
 * "3 hr. ago").
 */
export function formatRelativeTime(
  date: Date | string | number,
  locale = 'en',
  options: Pick<Intl.RelativeTimeFormatOptions, 'style' | 'numeric'> = {},
): string {
  const d = toDisplayDate(date);
  if (isNaN(d.getTime())) {
    return String(date);
  }
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: options.numeric ?? 'auto',
    style: options.style ?? 'long',
  });

  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour');
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, 'day');

  const diffMonth = Math.round(diffDay / 30);
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, 'month');

  return rtf.format(Math.round(diffDay / 365), 'year');
}

/**
 * Format a currency value according to locale conventions. When `currency`
 * is omitted, falls back to a plain locale-formatted number (no symbol)
 * rather than silently assuming USD.
 */
export function formatCurrency(
  value: number,
  options: CurrencyFormatOptions = {},
): string {
  const { locale = 'en', currency, minimumFractionDigits, maximumFractionDigits } = options;

  if (!currency) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/**
 * Format a number according to locale conventions
 */
export function formatNumber(
  value: number,
  options: NumberFormatOptions = {},
): string {
  const { locale = 'en', ...rest } = options;
  return new Intl.NumberFormat(locale, rest).format(value);
}
