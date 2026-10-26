/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * native-date-value - the ONE adapter set between a stored date / datetime
 * value and the native date/time controls (objectui#3127).
 *
 * ## Why it lives in `core` (objectui#10625)
 *
 * It was written in `@object-ui/fields` (`widgets/nativeDateValue.ts`), and
 * `@object-ui/components`' data table could not import it from there:
 * `fields` depends on `components`, so the reverse import is a package cycle.
 * The table therefore kept private copies with no impossible-day check, and a
 * stored `2026-02-30T10:00:00Z` showed as March 2nd in its inline editor and
 * could be written back as that day. The functions move DOWN into the
 * React-free engine, next to the judgement they share (`isRealCalendarDate`
 * in `date-display.ts`), and `fields` re-exports them unchanged: one home,
 * nothing to drift. `date-display.ts`'s header is the same remedy applied to
 * the display side.
 *
 * ## The defect these close
 *
 * `<input type="date">` accepts exactly `YYYY-MM-DD` and
 * `<input type="datetime-local">` exactly `YYYY-MM-DDTHH:mm[:ss]` — a **local
 * wall clock with no zone suffix**. Anything else is not "coerced" or
 * "warned about": the browser SILENTLY rejects it. The attribute still lands
 * in the DOM, so the value looks present to anyone inspecting markup, while
 * `input.value` reads back `""` and the control paints its empty placeholder:
 *
 * ```js
 * el.getAttribute('value')  // "2026-08-16T00:33:00.000Z"  ← the record's value
 * el.value                  // ""                          ← what the user sees
 * ```
 *
 * Records come back from the API as full ISO-8601 (`…T00:33:00.000Z`) — which
 * is precisely one of those rejected shapes. So EVERY datetime field in an
 * edit dialog rendered blank while holding a real value, and users read that
 * as "the date was lost" and retyped it (which is the only way the display bug
 * could turn into a data change).
 *
 * ## Why a round trip, and not just a formatter
 *
 * Formatting on the way IN without converting on the way OUT would be the
 * worse bug: the control would then be read as UTC but written back as a naive
 * local string, so a user in UTC+8 who picked "08:33" would store 08:33Z and
 * see 16:33 on the detail page. Read basis and write basis must be the same
 * one, so `toDateTimeInputValue` / `fromDateTimeInputValue` are a pair and are
 * used as a pair.
 *
 * ## Shape kept in form state
 *
 * `datetime` round-trips through ISO — the shape the API hands us and the one
 * display/format code already assumes. `date` stays a plain `YYYY-MM-DD`
 * string. Untouched fields are never re-emitted, so a form that opens and
 * closes without an edit still submits nothing for them.
 *
 * ## A stored day that does not exist (objectui#10474)
 *
 * The engine's date parse accepts a day of `01`-`31` for every month and rolls
 * the surplus forward, so `new Date('2026-02-30T10:00:00Z')` is March 2nd. The
 * READ faces refuse such a value through the shared judgement
 * (`isRealCalendarDate`, objectui#10026 / objectui#10301); this pair used to
 * reach the engine first, so the editor showed `2026-03-02T10:00` for it and a
 * save could write that day back. `isImpossibleStoredDay` asks the same
 * judgement of the day AS WRITTEN, before any `new Date(...)`, in every
 * spelling (`Z`, offset, zone-less, date-only).
 *
 * The control cannot show the stored string instead: measured in Chromium, a
 * `datetime-local` (and a `date`) sanitises a nonexistent day to `""`, in the
 * zone-less spelling too. So `toDateTimeInputValue` hands the control `""` and
 * the WIDGET names the stored string beside it with an invalid marker — an
 * empty control alone would be objectui#3127's silent blank again. Nothing is
 * written until the user picks a new value.
 */

import { isRealCalendarDate } from './date-display.js';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Stored value → `<input type="date">` value (`YYYY-MM-DD`).
 *
 * A leading `YYYY-MM-DD` is passed through VERBATIM rather than re-parsed: a
 * date-only string is parsed as UTC midnight by `new Date()`, so reading local
 * calendar components back out of it shifts the day by one everywhere west of
 * Greenwich. `2026-06-17` must stay June 17th in every zone.
 */
export function toDateInputValue(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Stored value → `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`),
 * expressed in the viewer's local wall clock — the same instant the detail
 * page shows, so opening the editor never appears to move the time.
 *
 * A value that is ALREADY a zone-less local datetime is truncated to minutes
 * in place instead of being round-tripped through `Date`, which would
 * reinterpret it and then re-render it, twice risking an off-by-a-zone shift.
 */
export function toDateTimeInputValue(value: unknown): string {
  if (value == null || value === '') return '';
  // Judged before any `new Date(...)`, which would roll it (objectui#10474).
  if (isImpossibleStoredDay(value)) return '';
  if (typeof value === 'string') {
    const local = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    if (local) return `${local[1]}T${local[2]}`;
  }
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/**
 * `<input type="datetime-local">` value → stored value (ISO-8601, UTC).
 *
 * The control hands us a zone-less local wall clock; `new Date()` reads that
 * form as local time, which is the inverse of what `toDateTimeInputValue`
 * wrote — the pair is what keeps read and write on one basis.
 *
 * An unparseable string is returned untouched rather than blanked: dropping a
 * value the user can see in the box would be a data loss dressed up as a fix.
 */
export function fromDateTimeInputValue(value: string): string {
  if (!value) return '';
  // A nonexistent day is returned untouched, like an unparseable string: the
  // engine would re-emit it as the rolled day (objectui#10474).
  if (isImpossibleStoredDay(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

/**
 * True when a stored value is written on a calendar day that does not exist
 * (`2026-02-30`, `2026-02-30T10:00:00Z`, `2026-02-30T10:00+08:00`) — the day
 * read AS WRITTEN from the leading `YYYY-MM-DD`, by the one judgement the read
 * faces use (`isRealCalendarDate`). A parsed `Date` always names a real day,
 * so the check can only be made before any conversion.
 *
 * Anything without a leading `YYYY-MM-DD` (a `Date`, a number, free text) is
 * not this case and answers `false`.
 */
export function isImpossibleStoredDay(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  return m != null && !isRealCalendarDate(m[1]);
}
