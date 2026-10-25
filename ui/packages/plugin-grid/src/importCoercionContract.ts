/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The slice of the server's import-coercion contract (`import-coerce.ts` in
 * the framework) that the Import Wizard's preview step re-checks client-side,
 * so a cell is flagged red here exactly when the server would reject it —
 * and never flagged for a value the server would take (objectui#3017). It
 * also carries the two checks the import meets after coercion, at the engine's
 * write door, that the preview repeats: a `date` / `datetime` value's
 * supported years and an `email` value's shape (objectui#11889). A `time`
 * cell's reading and the user import's stricter email rule joined them in
 * objectui#11913.
 */

import { ClockTimeValueSchema, REFERENCE_VALUE_TYPES } from '@objectstack/spec/data';

/**
 * Truthy tokens the server's boolean coercion accepts (`BOOL_TRUE`), compared
 * after `trim().toLowerCase()` — so every entry must already be lower-case
 * and trimmed (`importCoercionContract.test.ts` enforces both, plus
 * disjointness from the falsy set).
 *
 * The spec does not publish this table yet, so it cannot be derived — the
 * paired inventory in the test is the tripwire that keeps edits deliberate
 * (objectstack#4173 tracks exporting it from the source of truth).
 */
export const BOOLEAN_TRUE_IMPORT_TOKENS: ReadonlySet<string> = new Set([
  'true', 't', 'yes', 'y', '1', 'on', '是', '对', '✓', '√',
]);

/** Falsy tokens the server's boolean coercion accepts (`BOOL_FALSE`). */
export const BOOLEAN_FALSE_IMPORT_TOKENS: ReadonlySet<string> = new Set([
  'false', 'f', 'no', 'n', '0', 'off', '否', '错', '✗', '×',
]);

/** Every boolean token the server accepts (e.g. Chinese 是/否, on/off, ✓/×). */
export const BOOLEAN_IMPORT_TOKENS: ReadonlySet<string> = new Set([
  ...BOOLEAN_TRUE_IMPORT_TOKENS,
  ...BOOLEAN_FALSE_IMPORT_TOKENS,
]);

/**
 * Field types the server resolves from display text to record IDs during
 * `/import`. Derived exactly the way the server derives its
 * `REFERENCE_TYPES` — the spec's reference-shaped value types plus the
 * generic `'reference'` alias — so the two ends share one source instead of
 * two hand lists.
 *
 * The legacy per-row create fallback has no resolution step — raw cell text
 * would be stored verbatim into relation fields — so the fallback must refuse
 * to run when any mapped column targets one of these types.
 */
export const REFERENCE_IMPORT_TYPES: ReadonlySet<string> = new Set([
  ...REFERENCE_VALUE_TYPES,
  'reference',
]);

// ── dates (objectui#11889) ─────────────────────────────────────────────────
//
// The server reads a `date` / `datetime` cell with `parseDateCell` in
// `@objectstack/core`'s `import-coerce.ts`, a package this browser package does
// not import, and the spec publishes neither the grammar nor the years. So
// both are restated here, and the paired inventory in
// `importCoercionContract.test.ts` is the tripwire that keeps edits deliberate.
// `Date.parse` did this job before and took what the server refuses
// (`07/15/2026`, `July 15, 2026`, `1/2/26`).

/**
 * The years a stored `date` / `datetime` may name, first and last inclusive:
 * core's `SUPPORTED_TEMPORAL_YEARS`. The engine's write validation refuses a
 * value outside them with `invalid_date`, so an import cell the server's
 * coercion reads into such a year is refused too.
 */
export const IMPORT_TEMPORAL_YEARS: Readonly<Record<'date' | 'datetime', Readonly<{ first: number; last: number }>>> =
  Object.freeze({
    date: Object.freeze({ first: 1, last: 9999 }),
    datetime: Object.freeze({ first: 1000, last: 9999 }),
  });

/**
 * The server's `ISO_TEMPORAL_CELL`: `YYYY-MM-DD`, then optionally a `T` or one
 * space, `HH:MM`, optional `:SS` and fraction, and a `Z` or `±HH[:]MM` zone.
 */
const ISO_TEMPORAL_CELL =
  /^(\d{4})-(\d{2})-(\d{2})(?:(T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * The server's `YEAR_FIRST_CELL`: `YYYY/M/D` or `YYYY-M-D`, the same separator
 * twice, then optionally one space and a zone-naive `H:MM[:SS]`.
 */
const YEAR_FIRST_CELL = /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** The server's `namesRealCalendarDay`: the day exists, February 29 only in a leap year. */
function namesRealCalendarDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = month === 2 ? (leap ? 29 : 28) : month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  return day <= length;
}

/** A wall clock the server reads: hour 0..23, minute and second 0..59. */
function isWallClock(hour: number, minute: number, second: number): boolean {
  return hour <= 23 && minute <= 59 && second <= 59;
}

/**
 * The UTC year of a zone-bearing ISO cell, or `undefined` where the server's
 * `Date.parse` (V8) reads no instant: hour 0..23, or 24 with zero minutes,
 * seconds and fraction (the next day's midnight); minute and second 0..59; an
 * offset of at most 23 hours and 59 minutes. Computed with the UTC setters, so
 * the answer does not depend on the browser's date parser.
 */
function zonedCellUtcYear(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number; fraction: string },
  zone: string,
): number | undefined {
  const { year, month, day, hour, minute, second, fraction } = parts;
  if (minute > 59 || second > 59) return undefined;
  if (hour > 24 || (hour === 24 && (minute !== 0 || second !== 0 || /[1-9]/.test(fraction)))) return undefined;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMins = Number(zone.slice(-2));
    if (offsetHours > 23 || offsetMins > 59) return undefined;
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (offsetHours * 60 + offsetMins);
  }
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, day);
  t.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3).padEnd(3, '0')));
  return new Date(t.getTime() - offsetMinutes * 60_000).getUTCFullYear();
}

/**
 * The year of the value the server stores for this trimmed cell, or
 * `undefined` where `parseDateCell` refuses the cell (`readIsoTemporalCell`,
 * then `readYearFirstCell`). A bare day and a wall clock keep the year they are
 * written with; a zone-bearing cell is the instant it names, and both kinds
 * store that instant's UTC day or time.
 *
 * One reading is not the server's exactly: a zone-naive `datetime` wall clock
 * is read there in the importing user's business timezone, which the wizard
 * does not know, and here as UTC. The two differ in year only within a day of
 * the first or last supported year.
 */
function importDateCellYear(s: string): number | undefined {
  const iso = ISO_TEMPORAL_CELL.exec(s);
  if (iso) {
    const [, y, mo, d, sep, hh, mi, ss, frac, zone] = iso;
    const year = Number(y);
    if (namesRealCalendarDay(year, Number(mo), Number(d))) {
      if (sep === undefined) return year;
      if (zone !== undefined) {
        if (sep === 'T') {
          return zonedCellUtcYear({
            year, month: Number(mo), day: Number(d),
            hour: Number(hh), minute: Number(mi), second: ss ? Number(ss) : 0, fraction: frac ?? '',
          }, zone);
        }
      } else if (isWallClock(Number(hh), Number(mi), ss ? Number(ss) : 0)) {
        return year;
      }
    }
  }
  return yearFirstCellYear(s);
}

/**
 * The year of a trimmed cell the server's `readYearFirstCell` reads, or
 * `undefined` where it reads none: a real calendar day and, when the cell
 * carries one, a wall clock in range.
 */
function yearFirstCellYear(s: string): number | undefined {
  const yearFirst = YEAR_FIRST_CELL.exec(s);
  if (!yearFirst) return undefined;
  const [, y, , mo, d, hh, mi, ss] = yearFirst;
  const year = Number(y);
  if (!namesRealCalendarDay(year, Number(mo), Number(d))) return undefined;
  if (hh !== undefined && !isWallClock(Number(hh), Number(mi), ss ? Number(ss) : 0)) return undefined;
  return year;
}

/**
 * Whether the server's import takes this `date` / `datetime` cell: its
 * `parseDateCell` reads it, and the value it stores names a year in
 * {@link IMPORT_TEMPORAL_YEARS}. Accept or refuse only; the preview never
 * stores the value.
 *
 * Taken: `2026-07-15`, `2026-07-15T10:00:00Z`, `2026-07-15 10:00`,
 * `2026/7/15`, `2026-7-15 9:00`. Refused: `07/15/2026`, `July 15, 2026`,
 * `1/2/26`, `2026-02-30`, `2026-07-15 24:00`, `2026-07-15 10:00Z`, and a
 * `datetime` in year 0500.
 */
export function isImportableDateCell(cell: string, kind: 'date' | 'datetime'): boolean {
  const year = importDateCellYear(cell.trim());
  if (year === undefined) return false;
  const { first, last } = IMPORT_TEMPORAL_YEARS[kind];
  return year >= first && year <= last;
}

// ── times (objectui#11913) ─────────────────────────────────────────────────
//
// The server reads a `time` cell with the same `parseDateCell`, asking it for a
// time of day: `readTimeOfDayCell` first, then `readYearFirstCell` alone, never
// `readIsoTemporalCell`. `readTimeOfDayCell` asks core's comparand rule
// (`isUninterpretableTemporalComparand`), the rule the engine's write door
// judges a `time` value by too, so a time of day it stores is never refused
// after coercion. That rule takes a wall clock the spec's `ClockTimeValueSchema`
// takes, which is imported rather than restated, because the spec publishes it
// and the server reads that very schema. It also takes an instant in an ISO
// 8601 spelling. It refuses a `{placeholder}` filter token, and none of the
// three readings below can match one.

/**
 * Whether core's `readsAsInstant` and `keepsTimeOfDay` both take this trimmed
 * cell: an ISO 8601 day or date-time (the `T` form with or without a zone, the
 * space form without one) on a real calendar day, whose instant has a four-digit
 * UTC year, because the time of day is read back out of `toISOString`. A
 * zone-naive clock is read as UTC there, and `24:00` as the next day's midnight,
 * the way V8's `Date.parse` reads it.
 */
function isoCellKeepsTimeOfDay(s: string): boolean {
  const iso = ISO_TEMPORAL_CELL.exec(s);
  if (!iso) return false;
  const [, y, mo, d, sep, hh, mi, ss, frac, zone] = iso;
  const year = Number(y);
  if (!namesRealCalendarDay(year, Number(mo), Number(d))) return false;
  if (sep === undefined) return true;
  if (sep === ' ' && zone !== undefined) return false;
  const utcYear = zonedCellUtcYear({
    year, month: Number(mo), day: Number(d),
    hour: Number(hh), minute: Number(mi), second: ss ? Number(ss) : 0, fraction: frac ?? '',
  }, zone ?? 'Z');
  return utcYear !== undefined && utcYear >= 0 && utcYear <= 9999;
}

/**
 * Whether the server's import takes this `time` cell: its `parseDateCell` reads
 * a time of day from it, or the import refuses it with `invalid_time`. Accept or
 * refuse only; the preview never stores the value. No supported years apply,
 * because the engine checks none for a `time`.
 *
 * Taken: `10:00`, `09:30:15`, `23:59:59.5`, `2026-07-15T10:00:00Z`,
 * `2026-07-15 10:00`, `2026-07-15`, `2026/7/15 9:00`. Refused: `25:00`, `abc`,
 * `10:00Z`, `9am`, `9:00`, `24:00`, `2026-07-15 10:00Z`, `2026/7/15 24:00`.
 */
export function isImportableTimeCell(cell: string): boolean {
  const s = cell.trim();
  return ClockTimeValueSchema.safeParse(s).success
    || isoCellKeepsTimeOfDay(s)
    || yearFirstCellYear(s) !== undefined;
}

// ── email (objectui#11889) ─────────────────────────────────────────────────

/**
 * Whether the engine's record validator takes this `email` value: its
 * `EMAIL_RE`, `^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$` — a local part, one `@`, at
 * least two non-empty dot-separated domain labels, and no whitespace anywhere.
 * Non-ASCII is taken (`735431496@柴仟.com`), and there is no length cap but a
 * field's own `maxLength`. The server's import passes an `email` cell through
 * coercion untouched, so this check is the import's verdict on it.
 *
 * Restated as one pass over the string rather than as the pattern, so it cannot
 * backtrack whatever the input. The pattern itself is the oracle the paired
 * test compares this against.
 *
 * The user import's email column is not read by this rule. Its endpoint applies
 * its own, {@link isIdentityEmail}, and the column reaches the wizard flagged
 * `emailRule: 'identity'`, so the preview asks that rule there instead of this
 * one (objectui#11913).
 */
export function isRecordEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const labels = value.slice(at + 1).split('.');
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

/**
 * The domain plugin-auth mints a placeholder address under for a user with no
 * real email (`PLACEHOLDER_EMAIL_DOMAIN`). It is an RFC 2606 reserved name, so
 * no address on it can be delivered.
 */
const PLACEHOLDER_EMAIL_DOMAIN = 'placeholder.invalid';

/**
 * Whether the user import's endpoint (`/api/v1/auth/admin/import-users`) takes
 * this trimmed email cell. Its `resolveRowIdentity` (plugin-auth's
 * `admin-import-users.ts`) refuses the row with `INVALID_EMAIL`, in its dry run
 * too, in two cases:
 *
 * - `isLikelyEmail` refuses the cell. It takes at most 254 characters of
 *   printable ASCII with no whitespace, one `@` that is neither first nor last,
 *   and a domain whose last dot is neither its first nor its last character
 *   (framework#3566).
 * - `isPlaceholderEmail` takes it: an address on {@link PLACEHOLDER_EMAIL_DOMAIN},
 *   in any case.
 *
 * This is not a stricter {@link isRecordEmail}. It takes `a@b..c`, which the
 * record validator refuses, and refuses `735431496@柴仟.com`, which that one
 * takes. So the preview reads an identity email column by this rule instead of
 * the record rule, and never by both.
 */
export function isIdentityEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254 || /\s/.test(value)) return false;
  if (/[^\x20-\x7e]/.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  if (!(dot > 0 && dot < domain.length - 1)) return false;
  return !value.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
