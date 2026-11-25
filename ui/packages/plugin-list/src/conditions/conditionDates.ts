/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * How a date condition's value reads on a condition row (objectstack#37034).
 *
 * A row holds the value the query compares, written on the wire the way the
 * field's type stores it: a `date` field's bound is a calendar day
 * (`2026-10-01`), and a `datetime` field's bound is an ISO instant
 * (`2026-10-01T00:00:00.000Z`; a dataset bucket's drill writes its month's
 * bounds that way on a `created_at`). The row printed the value as written, so
 * a zh-CN chip read 「创建时间：≥ 2026-10-01T00:00:00.000Z」. It reads as a
 * date now, in the viewer's display locale, through the console's ONE date
 * display path (`formatDate` / `formatDateTime` in `@object-ui/core`'s
 * `date-display`): ⛔ no second formatter is written here.
 *
 * The field's type decides the face:
 *
 * - `date` names a calendar day, so the day is shown, with its year (a
 *   condition's bounds are read side by side). A `YYYY-MM-DD` value is that
 *   day in every zone. A date field compared with an instant at UTC midnight
 *   (an authored filter may write one) names the same day, so its leading
 *   `YYYY-MM-DD` is what is shown: read as an instant it would name the
 *   previous day west of UTC.
 * - `datetime` is an instant: the date and the time in the display zone
 *   (`setDisplayTimeZone`, else the viewer's own).
 * - `time` and anything else are shown as written.
 *
 * A value the display path cannot read (it answers `—`) is shown as written,
 * so a row never hides what it compares.
 */

import { formatDate, formatDateTime } from '@object-ui/core';

/** An instant at UTC midnight, captured as its calendar day. */
const UTC_MIDNIGHT = /^(\d{4}-\d{2}-\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)$/;

/** A date condition value as the row shows it: see the file header. */
export function formatConditionDate(value: unknown, fieldType: string | undefined, locale: string | undefined): string {
  if (typeof value !== 'string' && typeof value !== 'number') return String(value);
  if (value === '') return value;
  let shown: string;
  if (fieldType === 'date') {
    const day = typeof value === 'string' ? UTC_MIDNIGHT.exec(value)?.[1] ?? value : value;
    shown = formatDate(day, undefined, { locale, alwaysShowYear: true });
  } else if (fieldType === 'datetime') {
    shown = formatDateTime(value, { locale });
  } else {
    return String(value);
  }
  return shown === '—' ? String(value) : shown;
}
