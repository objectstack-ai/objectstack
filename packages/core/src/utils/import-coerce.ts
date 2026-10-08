/**
 * Type-aware value *coercion* for the bulk-import route
 * (`POST /data/:object/import`).
 *
 * This is the inverse of `export-format.ts`. A spreadsheet / CSV cell arrives as
 * a raw string (or, for JSON payloads, an arbitrary primitive); the storage
 * layer, on the other hand, expects *storage* values — booleans as real
 * booleans, numbers as numbers, dates as ISO strings, select fields as their
 * option **code** (not the human label), and lookup / user fields as the
 * referenced record **id** (not its name). The engine deliberately does not
 * coerce for storage (see `record-validator.ts`, which coerces only to *check*
 * a value and then discards the coerced form), so import has to do it here.
 *
 * The accepted storage shapes below are dictated by what
 * `validateFieldValue` in `packages/objectql` will accept:
 *   - number / currency / percent / rating / slider → a finite `number`
 *   - boolean / toggle                              → a real `boolean`
 *   - date / datetime                               → an ISO-8601 string
 *   - time                                          → `HH:MM:SS`, `.fff` when non-zero
 *   - select / radio                                → an option *value*
 *   - multiselect / checkboxes / tags               → an array of option values
 *   - lookup / master_detail / user / reference     → a record id (resolved async)
 *   - file / image                                  → a file id / url (as-is)
 *
 * Any of the last four whose field is flagged `multiple: true` (per the spec,
 * `multiple` applies to select / lookup / file / image; `radio`/`user` share
 * their branch) instead store an **array** — the cell is split on the export
 * separator and each token coerced individually. See `isMultiValueField`.
 *
 * Contract: when a field carries no usable metadata the value passes through
 * untouched, so an import stays byte-identical to the pre-coercion behaviour.
 */

import {
  SUPPORTED_TEMPORAL_YEARS,
  isOutsideTemporalYearRange,
  temporalStorageForm,
} from './temporal-storage-form.js';
import { isUninterpretableTemporalComparand } from './temporal-comparand.js';
import { zonedWallClockToUtcMs, type WallClockParts } from './datetime.js';
import type { ExportFieldMeta } from './import-field-meta.js';
import {
  SINGLE_OPTION_TYPES as OPTION_TYPES,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES as NUMBER_TYPES,
  BOOLEAN_VALUE_TYPES as BOOL_TYPES,
  FILE_REFERENCE_TYPES as FILE_TYPES,
  isMultiValueField as specIsMultiValueField,
  IMPORT_BOOLEAN_TRUE_TOKENS,
  IMPORT_BOOLEAN_FALSE_TOKENS,
  IMPORT_REFERENCE_TYPES,
  classifyFilterToken,
} from '@objectstack/spec/data';
import type { FieldErrorCode } from '@objectstack/spec/api';
import {
  renderValidationMessage,
  type ValidationMessageTranslator,
} from '@objectstack/spec/system';

/**
 * Field types whose stored value points at another record (id). The spec's
 * reference class (ADR-0104 D1) plus `reference` — a legacy external-object
 * alias that is not an authorable `FieldType` and so stays a local extra.
 */
// The spec now publishes the completed set (reference value types plus the
// legacy 'reference' spelling), so the `+ 'reference'` literal is retired on
// both ends (#4173).
const REFERENCE_TYPES = IMPORT_REFERENCE_TYPES;

/**
 * Whether a field's stored value is an array. Delegates to the spec's
 * `isMultiValueField` (ADR-0104 D1) — the shared definition the engine's
 * record-validator uses — so a coerced cell has the SAME shape the engine
 * will accept on insert.
 */
function isMultiValueField(meta: ExportFieldMeta | undefined): boolean {
  return meta?.type ? specIsMultiValueField(meta as { type: string; multiple?: boolean }) : false;
}

/**
 * Structured outcome of a reference lookup. `id` set → a single record matched.
 * `ambiguous` → the display value matched more than one record, so linking any
 * one of them would be a guess the importer refuses to make. `matchedField`
 * names the field the match came from (for diagnostics). An empty object means
 * nothing matched. A bare `string | undefined` is still accepted from legacy
 * resolvers and normalised to this shape.
 */
export interface RefMatch {
  id?: string;
  ambiguous?: boolean;
  matchedField?: string;
}

/**
 * Resolve a reference field's display value (a name / email / id typed by the
 * user) to the referenced record's id. Return `undefined` / `{}` when nothing
 * matches (caller surfaces "not found"), a bare id string / `{ id }` on a unique
 * hit, or `{ ambiguous: true }` when several records share the value. Legacy
 * resolvers that return `string | undefined` keep working. Implementations are
 * expected to cache — the same name shows up on many rows.
 */
export type RefResolver = (
  referenceObject: string,
  displayValue: string,
  meta: ExportFieldMeta,
) => Promise<string | undefined | RefMatch>;

/** Normalise a resolver result (legacy string or structured) to a RefMatch. */
function normalizeRefMatch(result: string | undefined | RefMatch): RefMatch {
  if (result == null) return {};
  if (typeof result === 'string') return result ? { id: result } : {};
  return result;
}

export interface CoerceContext {
  /** Trim leading/trailing whitespace from string-ish cells (default true). */
  trimWhitespace?: boolean;
  /** Extra strings (besides `''`) treated as null, e.g. `['N/A', 'null']`. */
  nullValues?: string[];
  /**
   * When a select/multiselect cell matches no known option, keep the raw value
   * (trimmed; each unmatched item of a multi-value cell) instead of failing.
   * The kept values are reported on the result (`keptOptionValues`), and the
   * import runner hands exactly those to the engine write as
   * `ExecutionContext.keptOptionValues`, whose option check admits them on that
   * write only (#22183). The field's option list is never changed.
   */
  createMissingOptions?: boolean;
  /** Async reference resolver (name/email/id → record id). Optional. */
  resolveRef?: RefResolver;
  /**
   * Locale of the importing principal (`ExecutionContext.locale`). Cell-coercion
   * failures land in the same row report as the engine's validation errors, so
   * they are localized from the same catalog (#3957). Absent → `en`.
   */
  locale?: string;
  /** `II18nService.t`-compatible lookup for message overrides (#3957). */
  translate?: ValidationMessageTranslator;
  /**
   * Business timezone of the importing principal (`ExecutionContext.timezone`,
   * the platform-default → global → tenant cascade). The clock an offset-free
   * datetime cell is read in (#8485) — see {@link parseDateCell}. Absent → the
   * cell is read as UTC, matching what the export writes when no zone resolves.
   */
  timezone?: string;
}

/** A per-field coercion failure, shaped like the engine's validation errors. */
export interface FieldCoerceError {
  field: string;
  /**
   * Which constraint the value violated — the spec's field-level catalog
   * (ADR-0114). Was a bare `string`, so a typo here reached the wire and the
   * "shaped like the engine's validation errors" claim above was a comment rather
   * than a type.
   */
  code: FieldErrorCode;
  message: string;
}

/**
 * Build a coercion failure whose message names the column by its (localized)
 * label and quotes the offending cell — never the API field name (#3957).
 *
 * `code` stays the machine identity the importer's row report and its tests key
 * off; `messageKey` selects the sentence from the shared catalog, and `params`
 * fills its words beyond the cell (#20846: a kind's supported years).
 */
function coerceError(
  meta: ExportFieldMeta | undefined,
  field: string,
  code: FieldErrorCode,
  messageKey: string,
  value: unknown,
  ctx: CoerceContext,
  params?: Record<string, unknown>,
): { error: FieldCoerceError } {
  const label = meta?.label?.trim() || field;
  return {
    error: {
      field,
      code,
      message: renderValidationMessage(
        { messageKey, label, field, params: { ...(params ?? {}), value: String(value) } },
        { locale: ctx.locale, translate: ctx.translate },
      ),
    },
  };
}

// ── blank / null handling ──────────────────────────────────────────

/**
 * Whether a cell is blank: absent, empty or whitespace, or one of the
 * request's `nullValues`. Exported for the named mapping's compound-part
 * assembly (#20149), which drops a blank part by this same rule.
 */
export function isBlank(value: unknown, nullValues?: string[]): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') return true;
    if (nullValues && nullValues.some((nv) => nv === value || nv === s)) return true;
  }
  return false;
}

// ── boolean ────────────────────────────────────────────────────────

// DERIVED from the spec's import-coercion vocabulary (#4173): objectui's
// Import Wizard preview re-checks these same tables client-side, so both ends
// reading one export is what keeps a cell flagged red here exactly when the
// server rejects it. The literals used to live in this file alone.
const BOOL_TRUE = IMPORT_BOOLEAN_TRUE_TOKENS;
const BOOL_FALSE = IMPORT_BOOLEAN_FALSE_TOKENS;

/** Parse a spreadsheet cell into a boolean, or `undefined` if unrecognised. */
export function parseBooleanCell(raw: unknown): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
    return undefined;
  }
  const s = String(raw).trim().toLowerCase();
  if (BOOL_TRUE.has(s)) return true;
  if (BOOL_FALSE.has(s)) return false;
  return undefined;
}

// ── numbers ────────────────────────────────────────────────────────

/**
 * The one comma placement a numeric cell may carry: a thousands grouping of the
 * integer part — an optional sign, 1 to 3 leading digits, then one or more
 * groups of exactly three digits, ending the integer part (end of cell, `.` or
 * the exponent marker follows) — and no comma anywhere after it. `1,000`,
 * `12,345.67`, `-1,234,567` match; `3,14`, `1,5`, `1.000,5`, `1,2,3`,
 * `1234,567`, `1,0000` and `12,345.6,7` do not.
 */
const THOUSANDS_GROUPED_INTEGER = /^[+-]?\d{1,3}(?:,\d{3})+(?![\d,])[^,]*$/;

/**
 * Parse a numeric cell, tolerating the punctuation spreadsheets add: thousands
 * separators (`1,234`), a leading currency symbol (`$` `¥` `€` `£` `￥`), a
 * trailing percent sign (`25%` → `25`), and accounting-style parenthesised
 * negatives (`(1,234)` → `-1234`). Returns `undefined` when the residue is not
 * a finite number.
 *
 * A comma is a thousands separator and nothing else, and only where it groups
 * thousands (#20497): 1 to 3 leading digits, then groups of exactly three,
 * and only before any `.` (`1,000`, `12,345.67`) — see
 * {@link THOUSANDS_GROUPED_INTEGER}. Any other comma makes the cell
 * unparseable (`undefined`, so the row's `invalid_number` error), never a
 * different number: a decimal-comma spelling (`3,14`, `1,5`, `1.000,5`) or a
 * stray comma (`1,2,3`) used to have every comma stripped and was stored as
 * `314`, `15`, `1.0005`, `123`. No locale is guessed — `1,500` is always one
 * thousand five hundred, never 1.5 — so a file written with a decimal comma is
 * refused cell by cell rather than read as some other value.
 */
export function parseNumberCell(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  let s = String(raw).trim();
  if (s === '') return undefined;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^[$¥€£￥]\s*/, '');   // leading currency symbol
  s = s.replace(/%$/, '').trim();       // trailing percent
  if (s.includes(',')) {
    if (!THOUSANDS_GROUPED_INTEGER.test(s)) return undefined;
    s = s.replace(/,/g, '');            // a well-formed thousands grouping
  }
  if (s === '' || !/^[+-]?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

// ── dates ──────────────────────────────────────────────────────────

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * [#20722] A `time` cell read by `@objectstack/core`'s one `time` rule, or
 * `undefined` when that rule refuses it. It is the rule the write door asks of
 * a written `time` (#20671) and the comparand door asks of a filter value, so a
 * cell is admitted here exactly when the same value is admitted there, and is
 * stored as the same wall clock:
 *
 * - the verdict is `isUninterpretableTemporalComparand('time', …)`: a bare
 *   `HH:MM[:SS[.f…]]` in range, or an instant in an ISO 8601 spelling a
 *   `datetime` is written in, on a day that exists, whose UTC year has four
 *   digits. A time of day with a `Z` or an offset (`10:00Z`) is refused: a
 *   `time` carries no zone (ADR-0053 D-C1);
 * - the value is `temporalStorageForm(…, 'time')`: `HH:MM:SS`, `.fff` kept
 *   when non-zero (a fraction past milliseconds truncated), and an instant's
 *   UTC time of day, fraction included.
 *
 * The storage form is not a verdict on its own: it hands a string it cannot
 * read back unchanged, and it reads `07/15/2026 10:00` through `Date.parse`
 * in the host's zone and rolls `2026-02-30T10:00:00Z` over to March 2, both of
 * which the verdict refuses. A `{placeholder}` is filter vocabulary, which the
 * verdict steps around rather than judges, so it is refused here, as the write
 * door refuses it.
 *
 * This replaced a private pattern with no fractional part, which refused the
 * `10:00:00.250` that `/export` writes for a `time` with milliseconds, so such
 * a row did not re-import.
 */
function readTimeOfDayCell(s: string): string | undefined {
  if (classifyFilterToken(s) !== null || isUninterpretableTemporalComparand('time', s)) return undefined;
  const form = temporalStorageForm(s, 'time');
  return typeof form === 'string' ? form : undefined;
}

/**
 * [#20534] The text shapes a `date` / `datetime` / `time` cell is read in,
 * after trimming — ISO 8601's extended calendar date and date-time, and the
 * platform's own export shape:
 *
 * - `YYYY-MM-DD` — a calendar day;
 * - `YYYY-MM-DDTHH:MM[:SS[.f…]]`, then `Z`, a `±HH:MM` / `±HHMM` offset, or
 *   nothing (a zone-naive wall clock);
 * - `YYYY-MM-DD HH:MM[:SS[.f…]]`, zone-naive only — the `YYYY-MM-DD HH:mm:ss`
 *   the export writes for a `datetime` cell and an xlsx date cell is read as.
 *
 * A four-digit year, two-digit month, day, hour, minute and second, an
 * upper-case `T` and `Z`: the spellings the write door admits for a `datetime`
 * string (`@objectstack/objectql`'s `record-validator.ts`, #20525), each of
 * which names one day and one clock whatever host reads it. Every other
 * spelling is refused, never guessed: `07/15/2026` and `15 July 2026` went to
 * `new Date(s)`, which reads them in the SERVER PROCESS's zone (the same cell
 * stored as `2026-07-15T14:00Z` on a New York host and `…T02:00Z` on a
 * Shanghai one, a `date` a day apart) and reads `07/08/2026` month-first. A
 * space before a zone (`2026-07-15 10:00Z`) is refused as the write door
 * refuses it. The one other text shape read at all is the year-first date,
 * {@link YEAR_FIRST_CELL}.
 */
const ISO_TEMPORAL_CELL =
  /^(\d{4})-(\d{2})-(\d{2})(?:(T| )(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * [#20534] Does `year-month-day` name a calendar day that exists — month
 * 01..12, day 01 to that month's length, February 29 only in a leap year?
 * Arithmetic, never a `Date` round trip: `Date.UTC` and `Date.parse` ROLL an
 * impossible day over (`2026-02-30` is March 2), which is the defect this
 * refuses, and `Date.UTC` reads a year 0..99 as 1900..1999. The same rule as
 * the write door's `namesRealCalendarDay` (#20525), which is private there.
 */
function namesRealCalendarDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const length = month === 2 ? (leap ? 29 : 28) : month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
  return day <= length;
}

/**
 * A cell in one of the {@link ISO_TEMPORAL_CELL} shapes, on a day that exists.
 * `day` is the cell's own `YYYY-MM-DD` text — the year keeps the four digits it
 * was written with, so `0500-01-01` is never re-spelled `500-01-01`. Exactly
 * one reading follows it: none (a bare day), `wall` (a zone-naive clock) or
 * `instantMs` (the instant a zone-bearing cell names).
 */
interface IsoTemporalCell {
  day: string;
  wall?: WallClockParts & { hour: number; minute: number; second: number; millisecond: number };
  instantMs?: number;
}

/**
 * Read a trimmed cell as an {@link ISO_TEMPORAL_CELL} shape, or `undefined`.
 * An impossible day, an out-of-range clock (`24:00` zone-naive, `10:60`) and a
 * zone after a space are `undefined` too — refused, never rolled over and
 * never handed to `new Date(s)`. A zone-bearing cell is read by `Date.parse`,
 * which reads each of these ISO spellings as the same instant on every host
 * (`T24:00Z` is the next day's midnight, as ISO 8601 has it).
 */
function readIsoTemporalCell(s: string): IsoTemporalCell | undefined {
  const m = ISO_TEMPORAL_CELL.exec(s);
  if (!m) return undefined;
  const [, y, mo, d, sep, hh, mi, ss, frac, zone] = m;
  if (!namesRealCalendarDay(Number(y), Number(mo), Number(d))) return undefined;
  const day = `${y}-${mo}-${d}`;
  if (sep === undefined) return { day };
  if (zone !== undefined) {
    if (sep !== 'T') return undefined;
    const instantMs = Date.parse(s);
    return Number.isNaN(instantMs) ? undefined : { day, instantMs };
  }
  const wall = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(hh),
    minute: Number(mi),
    second: ss ? Number(ss) : 0,
    millisecond: frac ? Number(frac.slice(0, 3).padEnd(3, '0')) : 0,
  };
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) return undefined;
  return { day, wall };
}

/**
 * [#20534, maintainer ruling] The year-first date a spreadsheet writes, after
 * trimming: `YYYY/M/D` or `YYYY-M-D` — a four-digit year, a one- or two-digit
 * month and day, the SAME separator in both places — optionally followed by
 * one space and a zone-naive `H:MM` or `H:MM:SS` with a one- or two-digit hour.
 * `2026/7/15`, `2026/07/15`, `2026-7-15`, `2026/7/15 9:00`,
 * `2026/08/01 06:00:00`, `2026-07-15 9:00`.
 *
 * It is Excel's default short date in zh-CN and ja-JP, and a CSV saved from
 * Excel writes the text it displays. The year comes first, so there is no
 * field order to guess and no zone to read: it names one day and one wall
 * clock on every host. No zone, no fraction and no `T` separator are read in
 * this form, and a mixed separator (`2026/7-15`) is not this form. A
 * month-first or day-first date (`07/15/2026`, `15/07/2026`) and a two-digit
 * year (`26/7/15`) stay refused.
 */
const YEAR_FIRST_CELL = /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Read a trimmed cell as a {@link YEAR_FIRST_CELL} shape, or `undefined`. The
 * rules every other admitted cell keeps: the day must exist
 * ({@link namesRealCalendarDay}, never rolled over), the hour runs 0..23 and
 * the minute and second 00..59 (`24:00` is refused), and the day is the padded
 * ISO `YYYY-MM-DD` (`2026/7/15` → `2026-07-15`). A clock is a wall clock, read
 * exactly as the export shape's is.
 */
function readYearFirstCell(s: string): IsoTemporalCell | undefined {
  const m = YEAR_FIRST_CELL.exec(s);
  if (!m) return undefined;
  const [, y, , mo, d, hh, mi, ss] = m;
  const month = Number(mo);
  const date = Number(d);
  if (!namesRealCalendarDay(Number(y), month, date)) return undefined;
  const day = `${y}-${pad2(month)}-${pad2(date)}`;
  if (hh === undefined) return { day };
  const wall = {
    year: Number(y),
    month,
    day: date,
    hour: Number(hh),
    minute: Number(mi),
    second: ss ? Number(ss) : 0,
    millisecond: 0,
  };
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) return undefined;
  return { day, wall };
}

/** The `HH:MM:SS` UTC clock of an instant. */
function utcClock(t: Date): string {
  return `${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`;
}

/**
 * Coerce a cell into the string shape the engine accepts for a date-ish field:
 *   - `date`     → `YYYY-MM-DD`
 *   - `datetime` → full ISO-8601 (`toISOString`)
 *   - `time`     → `HH:MM:SS`, `.fff` when non-zero ({@link readTimeOfDayCell})
 * Returns `undefined` when the cell is not a recognisable date/time, and the
 * caller fails the row with the write door's code for the same cell:
 * `invalid_date` for a `date` / `datetime` (`import_invalid_date` /
 * `import_invalid_datetime`, or [#20846] the write door's range sentence for a
 * cell in a year outside the kind's supported years — {@link outsideYears}),
 * `invalid_time` for a `time` (`import_invalid_time`).
 *
 * ## Which text is read at all (#20534)
 *
 * A text cell is read only in an {@link ISO_TEMPORAL_CELL} shape — ISO 8601,
 * or the export's own `YYYY-MM-DD HH:mm:ss` — or as a year-first date
 * ({@link YEAR_FIRST_CELL}: `2026/7/15`, `2026/7/15 9:00`, stored padded, the
 * clock read exactly as the export shape's), and only on a calendar day that
 * exists. A `time` cell is read by core's one `time` rule instead
 * ({@link readTimeOfDayCell}, #20722): a bare `HH:MM[:SS[.f…]]` or an ISO
 * 8601 instant, as the write door reads it, and otherwise in the year-first
 * form. Every other cell is refused on every branch; nothing reaches
 * `new Date(s)`:
 *
 *  - **an impossible day** (`2026-02-30`, `2026-02-29`, `2026-04-31`,
 *    `2026/2/30`, in any of the shapes) — `Date.UTC` and `Date.parse` rolled it
 *    into the next month, so a `datetime` was stored as March 2 and a `date`
 *    given in the `T…Z` spelling likewise; never rolled over now;
 *  - **a locale or prose spelling** (`07/15/2026 10:00`, `07/08/2026`,
 *    `15 July 2026`) — `new Date(s)` read it in the server process's zone and
 *    month-first, so the stored instant, and a `date`'s day, were properties
 *    of the deployment host; no zone and no field order is guessed now;
 *  - **a number** (`2026`, an Excel serial) — `new Date(String(n))` read it
 *    as a year, in the process zone.
 *
 * An xlsx date cell is unaffected: `import-prepare.ts` renders it as the
 * export shape before it gets here. A `Date` (a programmatic caller's) names
 * an instant and is read as before, save that a `date`'s year is padded.
 *
 * The year is padded to four digits on every `date` branch: a text cell keeps
 * the four digits it was written with, and an instant takes core's
 * `temporalStorageForm` `date` rule, which pads 0001..0999. `0500-01-01` used
 * to leave here as `500-01-01`, which the write door refuses, so the import
 * refused a day the write door takes. A bare day read into a `datetime` is
 * midnight UTC spelled from the day itself, never `Date.UTC(y, …)`, which read
 * `0050-01-01` as 1950.
 *
 * ## Which clock an offset-free cell is read in (#8485)
 *
 * A spreadsheet cell like `2026-08-01 06:00:00` carries no offset, so it is a
 * **wall clock**, not an instant — and `new Date(s)` resolved it against the
 * **process** `TZ`. That made the stored instant a property of the deployment
 * host: the same file, same tenant, same cell landed eight hours apart on two
 * hosts, decided by a setting nobody authoring the spreadsheet can see. Since
 * export renders `datetime` cells in the business timezone (#8373), the
 * advertised export → edit → re-import round trip was lossless only where the
 * host `TZ` happened to equal that zone.
 *
 * So a naive **datetime** cell is read in `timezone` — the caller's
 * `ExecutionContext.timezone`, the same value the export renders in — through
 * `@objectstack/core`'s `zonedWallClockToUtcMs` (DST-safe via the platform tz
 * database, and the primitive the date-bucket drill path already used in its
 * date-only form). Three things deliberately do NOT change:
 *
 *  - **an offset-bearing cell** (`…Z`, `…+08:00`) already names one instant and
 *    is honoured exactly as written;
 *  - **a bare day** stays UTC midnight for a `datetime` (a `date` is a
 *    timezone-naive calendar day under ADR-0053 — moving it would re-time every
 *    date-only import to fix nothing);
 *  - **no resolved timezone ⇒ UTC**, never the process clock. That is the
 *    fallback the export cell path takes when no zone resolves, so the round
 *    trip stays exact for deployments that configure none — and a process-`TZ`
 *    fallback would preserve the defect for exactly the deployments that cannot
 *    see it.
 *
 * For a naive cell landing in a `date` or `time` field the typed components are
 * taken verbatim (`2026-08-01 06:00:00` → `2026-08-01` / `06:00:00`, a `time`
 * keeping a non-zero fraction), which is both zone-free and host-`TZ`-free. An
 * offset-bearing cell landing in either takes the UTC calendar day or UTC
 * clock of the instant it names.
 */
export function parseDateCell(
  raw: unknown,
  kind: 'date' | 'datetime' | 'time',
  timezone?: string,
): string | undefined {
  if (raw instanceof Date) {
    // Already an instant (a JSON/programmatic caller's `Date`) — no wall clock
    // to re-interpret, so no zone question to answer.
    if (Number.isNaN(raw.getTime())) return undefined;
    if (kind === 'datetime') return raw.toISOString();
    // [#20534] Core's `date` storage rule: the UTC calendar day, the year padded.
    if (kind === 'date') return String(temporalStorageForm(raw, 'date'));
    return utcClock(raw);
  }
  const s = String(raw).trim();
  if (s === '') return undefined;

  if (kind === 'time') {
    const clock = readTimeOfDayCell(s);
    if (clock !== undefined) return clock;
  }

  // [#20722] Core's rule is the whole verdict on an ISO 8601 `time` cell, so a
  // `time` cell it refuses is read in the year-first form alone — the one
  // reading the import has beyond the write door (#20534, maintainer ruling).
  const cell = (kind === 'time' ? undefined : readIsoTemporalCell(s)) ?? readYearFirstCell(s);
  if (!cell) return undefined;

  if (cell.wall) {
    if (kind === 'date') return cell.day;
    if (kind === 'time') return `${pad2(cell.wall.hour)}:${pad2(cell.wall.minute)}:${pad2(cell.wall.second)}`;
    const ms = zonedWallClockToUtcMs(cell.wall, timezone);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }

  // A bare day is midnight UTC; a zone-bearing cell is the instant it names.
  const instant = new Date(cell.instantMs ?? Date.parse(`${cell.day}T00:00:00.000Z`));
  if (kind === 'datetime') return instant.toISOString();
  if (kind === 'date') return cell.instantMs === undefined ? cell.day : String(temporalStorageForm(instant, 'date'));
  return utcClock(instant);
}

/**
 * [#20846] The years a refused `date` / `datetime` cell's range sentence names,
 * or `undefined` when the cell gets the import's own "is not a valid date"
 * sentence. A cell whose year falls outside the kind's supported years — the
 * one range, `@objectstack/core`'s `isOutsideTemporalYearRange`, asked of what
 * `Date.parse` reads, as the write door asks it — is refused for its year,
 * whatever its spelling: `10000-01-01` and `+010000-01-01` are no shape this
 * reader takes, and "is not a valid date" sent their author to re-spell a
 * value no spelling of year 10000 makes admissible. A cell this reader DOES
 * take in such a year (`0500-07-15T10:00:00Z` for a `datetime`, `0000-06-15`)
 * passes here and meets the write door, which names the same years in the same
 * words: one sentence per kind for both doors of one import.
 *
 * The years are core's `SUPPORTED_TEMPORAL_YEARS`, spelled with four digits,
 * never a copy of the numbers. A number (an Excel serial, epoch
 * milliseconds) is never a temporal cell, whatever year it names, and keeps
 * the plain sentence, as the write door keeps it for a number.
 */
function outsideYears(raw: unknown, kind: 'date' | 'datetime'): { firstYear: string; lastYear: string } | undefined {
  const value = typeof raw === 'string' ? raw.trim() : raw;
  const readable = value instanceof Date || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
  if (!readable || !isOutsideTemporalYearRange(value, kind)) return undefined;
  const { first, last } = SUPPORTED_TEMPORAL_YEARS[kind];
  return { firstYear: String(first).padStart(4, '0'), lastYear: String(last).padStart(4, '0') };
}

// ── options (select / multiselect) ─────────────────────────────────

/**
 * Match a cell against a field's options, accepting **either** the option value
 * (code) or its human label (case-insensitive). Returns the canonical option
 * value to store, or `undefined` on no match.
 */
export function matchOption(
  raw: unknown,
  options?: Array<{ label?: string; value?: unknown }>,
): unknown | undefined {
  const s = String(raw).trim();
  if (!options || options.length === 0) return s; // no option list → accept as-is
  // Exact value match first (preserves the option's original value type).
  for (const o of options) {
    if (o && o.value !== undefined && String(o.value) === s) return o.value;
  }
  // Case-insensitive label match.
  const lower = s.toLowerCase();
  for (const o of options) {
    if (o && typeof o.label === 'string' && o.label.trim().toLowerCase() === lower) return o.value;
  }
  return undefined;
}

/** Split a multi-value cell on commas / semicolons / Chinese comma / newlines. */
export function splitMulti(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter((v) => v !== '');
  return String(raw)
    .split(/[,;、\n]/)
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

// ── per-field orchestration ────────────────────────────────────────

/**
 * Coerce one raw cell to its storage value using the field metadata. On success
 * returns `{ value }` (value may be `undefined`, meaning "drop this key"); on a
 * hard coercion failure returns `{ error }`.
 */
export async function coerceFieldValue(
  raw: unknown,
  meta: ExportFieldMeta | undefined,
  ctx: CoerceContext,
): Promise<{ value?: unknown; keptOptionValues?: string[] } | { error: FieldCoerceError }> {
  const trim = ctx.trimWhitespace !== false;
  const field = meta?.name ?? '';

  // Blank → leave the field unset so schema defaults / existing values win.
  if (isBlank(raw, ctx.nullValues)) return { value: undefined };

  const t = meta?.type;
  if (!t) return { value: trim && typeof raw === 'string' ? raw.trim() : raw };

  if (BOOL_TYPES.has(t)) {
    const b = parseBooleanCell(raw);
    if (b === undefined) return coerceError(meta, field, 'invalid_boolean', 'import_invalid_boolean', raw, ctx);
    return { value: b };
  }

  if (NUMBER_TYPES.has(t)) {
    const n = parseNumberCell(raw);
    if (n === undefined) return coerceError(meta, field, 'invalid_number', 'import_invalid_number', raw, ctx);
    return { value: n };
  }

  if (t === 'date' || t === 'datetime' || t === 'time') {
    // The business timezone an offset-free datetime cell is read in (#8485).
    const d = parseDateCell(raw, t, ctx.timezone);
    if (d === undefined) {
      // [#20722] The write door's code for the same cell — `invalid_time` for a
      // `time`, `invalid_date` for a `date` / `datetime` — and three sentences.
      // [#20846] Five: a cell in a year outside a `date`'s or a `datetime`'s
      // supported years takes the write door's range sentence for its kind.
      const code = t === 'time' ? 'invalid_time' : 'invalid_date';
      const years = t === 'time' ? undefined : outsideYears(raw, t);
      const key = years
        ? (t === 'datetime' ? 'invalid_datetime_range' : 'invalid_date_range')
        : t === 'datetime' ? 'import_invalid_datetime' : t === 'time' ? 'import_invalid_time' : 'import_invalid_date';
      return coerceError(meta, field, code, key, raw, ctx, years);
    }
    return { value: d };
  }

  // select / radio / multiselect / checkboxes / tags — match the cell against
  // the field's option list. Multi-valued when the type is inherently multi
  // (multiselect/…) OR a select/radio is flagged `multiple: true`; split then
  // and match each token, else match the whole cell as one option.
  if (OPTION_TYPES.has(t) || MULTI_OPTION_TYPES.has(t)) {
    // [#22183] A kept cell is reported as well as stored: the engine's option
    // check refuses a value outside the options unless the write names it in
    // `ExecutionContext.keptOptionValues`, and only coercion knows which values
    // it kept rather than matched.
    if (isMultiValueField(meta)) {
      const parts = splitMulti(raw);
      const out: unknown[] = [];
      const kept: string[] = [];
      for (const part of parts) {
        const v = matchOption(part, meta?.options);
        if (v === undefined) {
          if (ctx.createMissingOptions) { out.push(part); kept.push(part); continue; }
          return coerceError(meta, field, 'invalid_option', 'import_unknown_option', part, ctx);
        }
        out.push(v);
      }
      return kept.length > 0 ? { value: out, keptOptionValues: kept } : { value: out };
    }
    const v = matchOption(raw, meta?.options);
    if (v === undefined) {
      if (ctx.createMissingOptions) {
        const keptValue = String(raw).trim();
        return { value: keptValue, keptOptionValues: [keptValue] };
      }
      return coerceError(meta, field, 'invalid_option', 'import_unknown_option', raw, ctx);
    }
    return { value: v };
  }

  if (REFERENCE_TYPES.has(t)) {
    // Multi-value reference (a `multiple: true` lookup / user): the cell holds
    // several display names joined by the export separator (`, ` / `;`). Split
    // first, then resolve each token; store an array of ids. Mirrors the
    // multi-option branch above and the export path's `formatReference` join.
    if (isMultiValueField(meta)) {
      const tokens = splitMulti(raw);
      // If we have no resolver / no target object, store the raw tokens and let
      // referential integrity be enforced downstream.
      if (!ctx.resolveRef || !meta.reference) return { value: tokens };
      const out: unknown[] = [];
      for (const token of tokens) {
        const m = normalizeRefMatch(await ctx.resolveRef(meta.reference, token, meta));
        if (m.ambiguous) {
          return coerceError(meta, field, 'reference_ambiguous', 'import_reference_ambiguous', token, ctx);
        }
        if (m.id === undefined) {
          return coerceError(meta, field, 'reference_not_found', 'import_reference_not_found', token, ctx);
        }
        out.push(m.id);
      }
      return { value: out };
    }
    const display = String(raw).trim();
    // If it already looks resolved (an id was pasted) or we have no resolver /
    // no target object, store the raw value and let referential integrity be
    // enforced downstream.
    if (!ctx.resolveRef || !meta?.reference) return { value: display };
    const match = normalizeRefMatch(await ctx.resolveRef(meta.reference, display, meta));
    if (match.ambiguous) {
      return coerceError(meta, field, 'reference_ambiguous', 'import_reference_ambiguous', display, ctx);
    }
    if (match.id === undefined) {
      return coerceError(meta, field, 'reference_not_found', 'import_reference_not_found', display, ctx);
    }
    return { value: match.id };
  }

  // Attachment fields (file / image): the value is a file id / url the importer
  // does not resolve. When `multiple: true` the cell holds several joined by the
  // export separator — split into an array so the stored shape matches what the
  // engine expects; a single-value attachment passes through untouched below.
  if (FILE_TYPES.has(t) && isMultiValueField(meta)) {
    return { value: splitMulti(raw) };
  }

  // Everything else (text, email, phone, json, html, single file, …): pass
  // through, trimming string cells so stray spreadsheet padding doesn't leak
  // into storage.
  return { value: trim && typeof raw === 'string' ? raw.trim() : raw };
}

// ── the retired pre-check mirror ───────────────────────────────────
//
// `firstMissingRequiredField` and `firstConstraintViolation` used to live here
// (framework#3956): hand-copied re-implementations of the engine's required
// check and its numeric-range / string-length rules, kept in step with
// `record-validator.ts` by hand so the import's dry run could PREDICT the
// verdict the real write produces.
//
// A copy cannot structurally keep up with the family it mirrors, and the gap
// was measured (#4633): a CSV cell aimed at a `Field.address` passed the dry
// run — `coerceFieldValue` routes structured value shapes through its
// pass-through catch-all, so no verdict was formed at all — and the write then
// rejected it with `VALIDATION_FAILED`. The same hole covered `format` checks,
// object-level `validations`, and the state machine.
//
// Ruling D (maintainer, 2026-08-06) retired the mirror rather than growing it:
// the dry run now ASKS for the verdict through `DataProtocol.validateData`
// (commit 18189983d), which runs the same `validateRecord` / `evaluateValidationRules`
// `insert()` runs, under the deployment's own ADR-0104 posture. See
// `import-runner.ts`'s dry-run branch. Every verdict these two produced is
// re-asserted through that route in `import-dryrun-parity.test.ts` — retiring
// the mirror must not silently retire its coverage.

/**
 * Coerce a whole raw row into a storage-ready record. Unknown columns (no
 * matching field metadata) pass through untouched so ad-hoc / schemaless
 * objects still import. Collects every field error rather than stopping at the
 * first, so a UI can show all problems in a row at once.
 */
export async function coerceRow(
  rawRow: Record<string, unknown>,
  metaMap: Map<string, ExportFieldMeta>,
  ctx: CoerceContext,
): Promise<{
  data: Record<string, unknown>;
  errors: FieldCoerceError[];
  /**
   * [#22183] Per field, the option values `createMissingOptions` kept on this
   * row — empty unless that option is on and a cell matched no option. The
   * import runner hands it to the row's write as
   * `ExecutionContext.keptOptionValues`.
   */
  keptOptionValues: Record<string, string[]>;
}> {
  const data: Record<string, unknown> = {};
  const errors: FieldCoerceError[] = [];
  const keptOptionValues: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(rawRow)) {
    const meta = metaMap.get(key);
    const res = await coerceFieldValue(raw, meta ? meta : undefined, ctx);
    if ('error' in res) {
      // Attribute the error to the column even when metadata was missing.
      errors.push({ ...res.error, field: res.error.field || key });
      continue;
    }
    if (res.value !== undefined) data[key] = res.value;
    if (res.keptOptionValues && res.keptOptionValues.length > 0) keptOptionValues[key] = res.keptOptionValues;
  }
  return { data, errors, keptOptionValues };
}
