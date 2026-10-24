/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ReportField } from '@object-ui/types';
import { toDisplayDate } from '@object-ui/core';

import { DISPLAY_LOCALE_LAST_RESORT, formatNumberInDisplayLocale } from './displayLocale';

/**
 * Format a cell value based on the field definition.
 * Handles number (with thousand separators), currency, percent, and date formatting.
 *
 * `locale` is the BCP-47 DISPLAY tag the numeric branches below format in —
 * in React, whatever `useDisplayLocale()` returned for the session. It is
 * OPTIONAL, and that is a deliberate contract decision rather than convenience
 * (objectui#10020): this function is a published export of
 * `@object-ui/plugin-report`, so a REQUIRED third parameter would be a breaking
 * change to a public signature. Optional is purely additive — everything that
 * compiled before compiles after.
 *
 * ⚠️ The cost of that choice, named rather than hidden: an OPTIONAL locale
 * leaves a leg that is still wrong when nobody passes one. Closing it is the
 * caller's job, and inside this repo every caller does — `ReportViewer` is a
 * component and resolves `useDisplayLocale()` itself at all three of its call
 * sites, pinned in `__tests__/reportDisplayLocale-10020.test.tsx`. An OPTIONAL
 * parameter nobody passes is the same defect with a longer signature.
 *
 * The default is {@link DISPLAY_LOCALE_LAST_RESORT} — the contract's own last
 * resort, which is neither the `'en-US'` this card removed nor an absent tag.
 */
export function formatValue(
  value: any,
  field?: ReportField,
  locale: string = DISPLAY_LOCALE_LAST_RESORT,
): string {
  if (value == null || value === '') return '';

  const type = field?.type;
  const format = field?.format;

  // Date formatting
  if (type === 'date' || format === 'date' || isISODateString(value)) {
    return formatDate(value);
  }

  // Number-based formatting
  if (type === 'number' || typeof value === 'number') {
    const num = typeof value === 'number' ? value : Number(value);
    if (isNaN(num)) return String(value);

    if (format === 'currency' || format === 'currency_cny') {
      return `¥${formatNumberInDisplayLocale(num, locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    if (format === 'currency_usd') {
      return `$${formatNumberInDisplayLocale(num, locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    if (format === 'percent') {
      return `${formatNumberInDisplayLocale(num, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    }
    // Default: thousand-separated number
    return formatNumberInDisplayLocale(num, locale);
  }

  return String(value);
}

/**
 * Check if a value looks like an ISO date string.
 */
function isISODateString(value: any): boolean {
  if (typeof value !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value);
}

/**
 * Format a date value to a readable yyyy-MM-dd format.
 *
 * The value is parsed by the shared step, `toDisplayDate` (`@object-ui/core`),
 * and read back with LOCAL getters. The engine's own parse read a date-only
 * `2026-09-15` as UTC midnight, so every viewer west of UTC read `2026-09-14`
 * in the report cell (objectui#10844, the objectui#10183 convention). A value
 * the shared step refuses, such as a day its month does not have, renders as
 * the raw stored string, this cell's face for an unparseable value
 * (objectui#10026).
 */
function formatDate(value: any): string {
  try {
    const date = toDisplayDate(value);
    if (isNaN(date.getTime())) return String(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return String(value);
  }
}
