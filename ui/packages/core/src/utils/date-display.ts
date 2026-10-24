/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * date-display - the ONE date/datetime display path behind every field cell,
 * grid card, gantt tooltip and dataset measure in the console.
 *
 * These functions are unchanged; what changed is where they live. They were
 * written in `@object-ui/fields`' barrel (`packages/fields/src/index.tsx`),
 * which is a React package, so `@object-ui/core` could not reach them - and
 * `core`'s `utils/dataset-format.ts` is exactly the caller that needed them:
 * `formatMeasure` returned `String(v)` for any non-numeric value, so a `min` /
 * `max` measure over a date field rendered its raw 24-character ISO string on
 * the metric tile, in chart values, in dataset table cells and in the
 * metadata-admin dataset preview (objectui#7178).
 *
 * The fix is the move, NOT a second formatter here. That choice is the whole
 * point, and it is the lesson of objectui#4576: when the percent convention
 * was duplicated across this same package boundary, a list cell and a
 * dashboard measure drifted apart (`1.234,5 %` beside `1.234,5%` in a German
 * session) while both were "correct". `dataset-format.ts`'s own header records
 * that history, and `number-display.ts` next door is the same remedy applied
 * to numbers: the pure function moves DOWN into the React-free engine and the
 * upper package re-exports it, so there is one home and nothing to drift.
 *
 * `@object-ui/fields` re-exports the formatting symbols below under their
 * original names, so `formatDate` / `formatDateTime` /
 * `formatDateTimeCompactParts` / `formatRelativeDate` / `DateDisplayOptions`
 * keep working unchanged for `ObjectGrid`, `ObjectGantt`,
 * `plugin-dashboard`'s `recordFields` and the `date` cell renderer.
 * `toDisplayDate` is exported from `@object-ui/core` alone (objectui#10183),
 * and so are `toDisplayEndDate` / `toInclusiveEndDay`, the end read and its
 * inverse both gantt surfaces share (objectui#11141).
 *
 * The `datetime` CELL face joined this file in objectui#7443. It used to be a
 * second convention inlined in `DateTimeCellRenderer`: two `Intl` option bags
 * for one field type, kept in step by nothing, while `date` had exactly one.
 * It is `formatDateTime`'s `'compact'` style now, byte-identical to what the
 * cell rendered before.
 *
 * No React, no i18n: the ambient inputs are `Intl`, the clock and the display
 * zone below, and the one phrase `Intl` cannot produce ("Overdue Nd") comes
 * in through the INJECTED `options.t`, the same way `buildDatasetFieldHelpers`
 * in `dataset-format.ts` takes `fieldLabel`.
 *
 * ⚠️ There is a third ambient input, and it is the one this module has to
 * decide about rather than pass on: the zone an instant renders in. A value
 * carrying a time is an instant and renders in the DISPLAY ZONE — the zone the
 * host declared through {@link setDisplayTimeZone} (objectui#11693), else the
 * viewer's own; a DATE-ONLY value names a calendar day, carries no instant,
 * and must render as that day everywhere, whatever the display zone.
 * `toDisplayDate` below is the single parse step that tells the two apart —
 * every function here goes through it (objectui#10110), and so does every
 * caller elsewhere that needs a face or a day comparison none of these
 * functions produce (objectui#10183).
 */

// ── The display zone (objectui#11693) ──────────────────────────────────────

/**
 * The zone every instant face below renders in, when the host has declared
 * one; `undefined` means the viewer's own zone (the runtime default), which is
 * what every face rendered in before objectui#11693.
 */
let displayTimeZone: string | undefined;
const displayTimeZoneListeners = new Set<() => void>();

/** `true` when this runtime's `Intl` knows `timeZone`. */
function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Declare the zone instants render in — the host's half of objectui#11693.
 *
 * ## Why the zone enters HERE and nowhere else
 *
 * Every date and datetime face in the console is a function of this module
 * (see the header), and each caller threads only its `locale`. The zone the
 * signed-in workspace configures (`localization.timezone`, served by
 * `GET /api/v1/auth/me/localization`) is the same for every face on the
 * page, so it is set once, here, and every face reads it — rather than
 * threaded through each call site, where one forgotten caller renders the
 * same instant in a second zone beside the first (objectui#4272 is that
 * defect for the locale). `LocalizationProvider` (`@object-ui/i18n`) is the
 * host that calls this; a renderer never does.
 *
 * `undefined` (or an empty string) clears it: instants render in the
 * viewer's zone again. A name this runtime's `Intl` does not know — a zone
 * newer than the browser's time-zone data, say — clears it too, with a
 * warning, rather than make every face throw the `RangeError` `Intl` raises
 * for it.
 *
 * ⛔ A date-only value never takes the zone; see {@link toDisplayDate}.
 */
export function setDisplayTimeZone(timeZone: string | undefined): void {
  let next: string | undefined;
  if (timeZone) {
    if (isKnownTimeZone(timeZone)) next = timeZone;
    else console.warn(`[date-display] unknown time zone "${timeZone}"; instants render in the viewer's zone`);
  }
  if (next === displayTimeZone) return;
  displayTimeZone = next;
  for (const listener of [...displayTimeZoneListeners]) listener();
}

/** The zone {@link setDisplayTimeZone} declared, or `undefined` for the viewer's own. */
export function getDisplayTimeZone(): string | undefined {
  return displayTimeZone;
}

/**
 * Be told when the display zone changes; returns the unsubscribe. The shape is
 * React's `useSyncExternalStore` contract, which is how `LocalizationProvider`
 * re-renders its consumers once the zone they format in has moved.
 */
export function subscribeDisplayTimeZone(listener: () => void): () => void {
  displayTimeZoneListeners.add(listener);
  return () => {
    displayTimeZoneListeners.delete(listener);
  };
}

/**
 * The `Date`s this module built to NAME A CALENDAR DAY — {@link toDisplayDate}'s
 * local midnight for a date-only value, and {@link toInclusiveEndDay}'s day.
 *
 * The faces below must read such a `Date` in the local zone (its own docblock
 * says so), never in the display zone: west of the viewer it would name the
 * day before. A string still says what it is, but callers hand these `Date`s
 * on — `GridField`'s date cell formats the one `toDisplayDate` returned, and
 * the functions here hand theirs to each other — so the fact travels with the
 * object rather than with the string it came from.
 */
const calendarDays = new WeakSet<Date>();

/** The zone a parsed value renders in: the display zone for an instant, the viewer's for a calendar day. */
function zoneFor(date: Date): string | undefined {
  return calendarDays.has(date) ? undefined : displayTimeZone;
}

/** `Intl` options naming `timeZone`, or none, so a face with no zone keeps its exact options bag. */
function inZone(timeZone: string | undefined): Intl.DateTimeFormatOptions {
  return timeZone ? { timeZone } : {};
}

const dayPartsFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day `date` falls on in `timeZone` (the viewer's when `undefined`); `month` is 0-based. */
function dayIn(date: Date, timeZone: string | undefined): { year: number; month: number; day: number } {
  if (!timeZone) return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
  let format = dayPartsFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    dayPartsFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month') - 1, day: part('day') };
}

/** A day as a whole number of days, so two days subtract to their distance with no DST hour in it. */
function dayNumber({ year, month, day }: { year: number; month: number; day: number }): number {
  const probe = new Date(0);
  probe.setUTCFullYear(year, month, day);
  return Math.round(probe.getTime() / 86_400_000);
}

/**
 * Options shared by {@link formatDate} / {@link formatRelativeDate} /
 * {@link formatDateTime}. One bag, and each function reads the keys it needs:
 * `dueLike` and `t` only matter on the relative path, `style` is read by
 * `formatDateTime` and by `formatDate` (see below).
 */
export interface DateDisplayOptions {
  dueLike?: boolean;
  /** BCP-47 display locale (ADR-0053 tenant default); falls back to the runtime locale. */
  locale?: string;
  /** i18n translate fn for phrases `Intl` can't produce (the "Overdue Nd" wording). */
  t?: (key: string, params?: Record<string, unknown>) => string;
  /**
   * Named face, read by {@link formatDateTime} and {@link formatDate}. Each
   * reads its own vocabulary: `'compact'` is `formatDateTime`'s dense grid
   * cell face (objectui#7443), `'short'` and `'relative'` are `formatDate`'s;
   * anything else, or absent, is that function's default face.
   *
   * It rides here rather than in a second positional parameter because
   * `formatDateTime(value, options?)` is a PUBLISHED signature with `options`
   * in position two (objectui#4272). A positional `style` would have displaced
   * it: TypeScript would reject the old call, but a JavaScript caller would
   * silently hand its options bag to the style slot and lose its locale —
   * the #4272 defect again.
   *
   * ⚠️ On {@link formatDate} this key COLLIDES with a positional parameter of
   * the same name, so the precedence is PINNED, not left to implementation
   * order: **the positional argument wins**, and this key is consulted only
   * when the positional slot is `undefined` (objectui#7745). See
   * {@link formatDate}'s own note for why that direction and not the other.
   *
   * ⚠️ {@link formatRelativeDate} still does NOT read this key — the
   * maintainer's long-run ruling on objectui#7443 names `formatDate` only, and
   * whether the relative path's out-of-window fallback should honour it is a
   * separate, deliberate call (objectui#7745's report).
   */
  style?: string;
  /**
   * Keep the year on {@link formatDate}'s default face even when the date
   * falls in the current year (objectui#13331). Opt-in, absent means `false`:
   * the default face drops the current year on purpose (see the note in
   * {@link formatDate}'s default branch), and that stays the rule for every
   * caller that does not ask.
   *
   * The surface that asks is the record header's highlights strip. Its
   * chips sit side by side, so a past-year date beside a current-year one
   * read "Start Date Sep 15, 2025 | End Date Sep 15", and a contract that
   * ended last month looked like it ended next month.
   *
   * It reaches the default face on every path into it, because
   * {@link formatRelativeDate}'s out-of-window fallback strips only `style`
   * from the bag it hands on. The `'short'` face already writes the year and
   * the relative phrases inside the ±7-day window name no calendar date, so
   * neither reads it.
   */
  alwaysShowYear?: boolean;
}

/**
 * The date-only ISO spelling — `2026-08-01`, and nothing else.
 *
 * Spelled exactly as `dataset-format.ts`'s `ISO_DATE_ONLY_RE`, which sniffs
 * the same shape one file over to decide which arm a measure takes. Two
 * spellings of one convention is what this module exists to prevent, so the
 * two regexes are kept identical on purpose.
 */
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An ISO date carrying a time part — `2026-08-01T09:30:00Z`, the same with a
 * space separator, with or without seconds or an offset. Matched only as far
 * as `HH:mm`, so its first ten characters are the `YYYY-MM-DD` the value was
 * written on.
 *
 * Spelled exactly as `dataset-format.ts`'s `ISO_DATETIME_RE`, which sniffs the
 * same shape to route a measure to its datetime arm, for the same reason as
 * {@link ISO_DATE_ONLY_RE} above: one convention, one spelling.
 */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * A date that exists — the pattern alone would accept `2024-02-31`.
 *
 * `true` only for a date-only ISO string (`YYYY-MM-DD`, the shape
 * {@link ISO_DATE_ONLY_RE} names) whose year, month and day read back
 * unchanged from the calendar. Anything else — another shape, a time part, an
 * out-of-range month, or a day its month does not have — is `false`.
 *
 * ## Why this lives here (objectui#10026)
 *
 * It used to be module-private in `@object-ui/components`' filter builder,
 * which refused `2026-02-30` at the AUTHORING boundary, while this module — a
 * package below it, unable to import it — ROLLED the same value into March 2nd
 * on every display face. One concept, two answers. It moved down, exactly as
 * `formatDate` itself moved into this package (see the header), so the filter
 * builder and {@link toDisplayDate} now ask the one function. ⛔ A move, not a
 * copy: `@object-ui/components` imports it from here.
 *
 * ## Why the engine cannot answer this on its own
 *
 * ECMAScript's date-string parse accepts a DAY of `01`-`31` for every month
 * and rolls the surplus forward: `Date.parse('2026-02-30')` is March 2nd, not
 * `NaN`. It rejects an out-of-range MONTH (`2026-13-01`), which is why a
 * bad month was always a dash on the display path and a bad day never was.
 * So the day is read back instead: build the date in UTC (no zone, so no DST
 * gap can move it) and require all three parts to survive.
 *
 * `setUTCFullYear` rather than `Date.UTC(year, …)`: the latter maps years
 * 0-99 onto 1900+y, so it answered `false` for `0026-08-01` — a real day,
 * and one {@link toDisplayDate} renders (it undoes the same legacy mapping for
 * the same reason). The move had to fix that, or refusing through this
 * function would have dashed every year below 100.
 */
export function isRealCalendarDate(dateOnly: string): boolean {
  if (!ISO_DATE_ONLY_RE.test(dateOnly)) return false;
  const [year, month, day] = dateOnly.split('-').map(Number);
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * The ONE `value -> Date` step behind every function below.
 *
 * ## The defect (objectui#10110)
 *
 * ECMAScript parses the two ISO shapes into two different zones: a DATE-ONLY
 * form is UTC, while a date-TIME form without an offset is local. So
 * `new Date('2026-08-01')` is UTC midnight, and every getter this module then
 * uses — `getFullYear`, `getMonth`, `getDate`, and `toLocaleDateString`'s own
 * internal ones — reads it back in the VIEWER's zone. West of UTC that lands
 * on the previous calendar day: `2026-08-01` rendered `Jul 31` for a UTC-7
 * viewer while the stored value, the API response and a UTC+8 viewer all said
 * August 1st. The relative branch shifted with it, one day per day
 * (`2026-08-31` read `4 days ago` on the 3rd instead of `3 days ago`),
 * because it compares two LOCAL start-of-days.
 *
 * ## The repair, and why it is not an offset
 *
 * A date-only value names a CALENDAR DAY and carries no instant, so there is
 * no conversion to perform: this rebuilds it at LOCAL midnight of the day it
 * names, and every local getter downstream then reports that same day in
 * every zone. ⛔ Nothing here adds or subtracts hours. An offset that
 * cancels the shift would be wrong again at the next DST boundary and wrong
 * in the opposite direction for a viewer EAST of UTC, where the UTC-midnight
 * parse already lands on the right day — the co-located suite drives both.
 * `GridField`'s sub-grid cell already parsed its own date-only values this
 * way before reaching `formatDate`; this is that treatment, moved to the one
 * place every caller passes through (the sub-grid reads it from here since
 * objectui#10301).
 *
 * A value with a time part is not rebuilt, in both spellings: it HAS an
 * instant, and rendering an instant in the viewer's zone is the whole point
 * of a `datetime`. The regex is what separates them, so the split is the
 * VALUE's shape and never the field's declared type, which this module (pure,
 * no schema) cannot see.
 *
 * ## What it refuses (objectui#10026)
 *
 * The engine's own parse still decides what is a date at all (`2026-13-01`
 * is an Invalid Date, and so every face below renders `—`), with ONE
 * addition: a date-only value naming a day its month does not have. The
 * engine accepts `2026-02-30` and rolls it into March 2nd, so before this
 * card every date face showed a real day nobody wrote, with nothing to say
 * so. This step hands back an Invalid Date for it instead — the same answer
 * the engine gives a bad month — so every caller renders the face it already
 * renders for an unparsable value: `—` from the functions below, `EmptyValue`
 * from the field carriers that read validity here, the raw stored string from
 * a caller whose unparsable face is the raw string. ⛔ No new marker.
 *
 * The maintainer's ruling on objectui#10026 (option A) placed the refusal on
 * the SHARED path, in this step and not in any one consumer: refusing in a
 * single face would re-create the list-cell-versus-measure split
 * objectui#4576 recorded. {@link isRealCalendarDate} is the one judgement,
 * shared with the filter builder's authoring boundary.
 *
 * A value that carries a TIME is refused the same way when the day it is
 * written on does not exist (objectui#10301): `2026-02-30T10:00:00Z` parses
 * too, and rendered `Mar 2, 2026, 10:00 AM` on every datetime face. Triage
 * graded that an inherited branch of the same ruling. The judgement reads the
 * value's leading `YYYY-MM-DD` AS WRITTEN, never the day its instant lands on
 * in some zone: a parsed `Date` always names a real day, so a check made after
 * any conversion could only miss the refusal, and a real day written with an
 * offset (`2026-02-28T23:30:00-05:00`, March 1st in UTC) is kept. A real
 * date-time is otherwise untouched — no rebuild, the engine's instant.
 *
 * ## Why it is exported (objectui#10183)
 *
 * A caller that formats with its own `Intl` options — a face none of the
 * functions below produce, such as the record summary chip's
 * `dateStyle: 'medium'` — or that compares a value against "today" needs the
 * `Date` itself, not a string. Such callers used to parse the value on their
 * own (`new Date(value)`, or `Date.parse` and then a `Date` handed to
 * `formatDate`, which this step then leaves alone), so the objectui#10110
 * repair never reached them and each still read a date-only value one day
 * early west of UTC. They take the `Date` from here instead.
 *
 * ⛔ Read the result with LOCAL getters or local-zone `Intl` formatting only.
 * For a date-only value it is local midnight of the named day, so its
 * `toISOString()` / UTC getters name the previous day east of UTC — hand
 * those the stored value, never this. The faces in this module know such a
 * `Date` when they are handed one and keep it out of the display zone
 * (objectui#11693, see `calendarDays`).
 */
export function toDisplayDate(value: string | Date | number): Date {
  const parsed = value instanceof Date ? value : new Date(value as any);
  // The engine rolls a date-time written on a nonexistent day forward too;
  // judge the day as written and refuse it (objectui#10301).
  if (typeof value === 'string' && ISO_DATETIME_RE.test(value) && !isRealCalendarDate(value.slice(0, 10))) {
    return new Date(NaN);
  }
  if (typeof value !== 'string' || !ISO_DATE_ONLY_RE.test(value) || isNaN(parsed.getTime())) {
    return parsed;
  }
  // The engine rolled a nonexistent day forward; refuse it (objectui#10026).
  if (!isRealCalendarDate(value)) return new Date(NaN);
  const [year, month, day] = value.split('-').map(Number);
  const local = new Date(year, month - 1, day);
  // Years 0-99 only: the multi-argument constructor maps them onto 1900+y, so
  // `0026-08-01` would render as 1926 where the string parse read year 26.
  // Setting the year back is co-extensive with that legacy mapping and a
  // no-op on every other year.
  local.setFullYear(year);
  calendarDays.add(local);
  return local;
}

/**
 * THE ONE READ of a stored END, where a bar or span is drawn to
 * (objectui#11141): {@link toDisplayDate}'s read, and then, for a date-only
 * value only, the next day's local midnight.
 *
 * ## The rule (objectui#11112's ruling, one home since objectui#11141)
 *
 * A date-only end is INCLUSIVE: `2024-01-01` to `2024-01-15` runs through
 * January 15th, so the span is drawn to the start of the 16th, and a
 * successor starting `2024-01-16` begins exactly where it ends. A span whose
 * date-only start and end name the same day is one day long, across a DST
 * change too: the step is a calendar day (`setDate`), never 24 hours, so it
 * lands on the next local midnight, or on that day's first hour where its
 * midnight does not exist. That is how a project plan and the schema
 * catalog's gantt plans author an end.
 *
 * The result is the EXCLUSIVE end instant of a half-open span `[start, end)`,
 * the form every gantt surface draws and schedules with. Date-only is decided
 * by the value's own shape, with {@link isRealCalendarDate}, exactly as
 * {@link toDisplayDate} decides it, so an end reads its day as a start does and
 * then runs to that day's end. A value with a time part, a number or a `Date`
 * is an instant: the span ends at it, and it is handed back as
 * {@link toDisplayDate} hands it back.
 *
 * {@link toInclusiveEndDay} is the exact inverse: it names the day a span
 * ending here runs through, so a read and a write of a date-only end agree.
 *
 * ⛔ One rule, one place: `plugin-timeline`'s gantt variant and
 * `plugin-gantt` both read their ends here. A second copy of the step in a
 * consumer is how the two gantt surfaces came to draw one plan a day apart.
 * ⛔ Read the result with LOCAL getters only, as {@link toDisplayDate}'s is.
 */
export function toDisplayEndDate(value: string | Date | number): Date {
  const end = toDisplayDate(value);
  if (typeof value !== 'string' || !isRealCalendarDate(value)) return end;
  end.setDate(end.getDate() + 1);
  // Back to the start of that day. A day whose own midnight does not exist is
  // read at its first hour, and the step keeps the hour, so without this the
  // day after it would start an hour late and name itself back.
  end.setHours(0, 0, 0, 0);
  return end;
}

/**
 * The day a span ending at `end` runs through: local midnight of the day that
 * holds the last instant before `end` (objectui#11141).
 *
 * This is the exact inverse of {@link toDisplayEndDate} on a date-only end:
 * the instant it reads `2024-01-15` as, local midnight of the 16th, names the
 * 15th here, so a read, a drag and a write of a stored date-only end leave it
 * the day it was, and a bar dragged to end at a day's local midnight names the
 * day BEFORE it. An end inside a day (a `datetime` end, or a shift band's
 * edge) names that day, the last one the span reaches into.
 *
 * It names a day for display and for a date-only write. ⛔ It is not a read of
 * a stored value, and a `datetime` end still keeps its own instant: hand this
 * only to a face that names a day, or to a field that stores one. Read the
 * result with LOCAL getters only; an Invalid Date stays invalid.
 */
export function toInclusiveEndDay(end: Date): Date {
  const day = new Date(end.getTime() - 1);
  day.setHours(0, 0, 0, 0);
  calendarDays.add(day);
  return day;
}

/**
 * Localized day-granularity relative phrase ("Tomorrow", "3 days ago", "明天",
 * "3天前"), sentence-cased for locales whose `Intl` output starts lowercase.
 */
function formatRelativeDays(diffDays: number, locale?: string): string {
  try {
    const phrase = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diffDays, 'day');
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  } catch {
    // Invalid locale tag — degrade to English rather than crash the cell.
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    return diffDays > 0 ? `In ${diffDays} days` : `${Math.abs(diffDays)} days ago`;
  }
}

/**
 * The options bag {@link formatRelativeDate} hands to {@link formatDate} for
 * its out-of-window ABSOLUTE fallback, with `style` neutralised.
 *
 * Two reasons, both load-bearing since objectui#7745 made `formatDate` read
 * `options.style`:
 *
 *   1. **Behaviour preservation.** `formatRelativeDate` does not read
 *      `options.style`, and #7745 does not change that. Without the strip it
 *      would start reading it THROUGH this delegation for dates outside the
 *      ±7-day window only — a face change on a live path (grid cell, gantt
 *      tooltip) that no card authorises.
 *   2. **Termination.** `formatDate` resolves `'relative'` by calling
 *      `formatRelativeDate`, which lands back here. With the style still in
 *      the bag, `formatRelativeDate(v, { style: 'relative' })` on an
 *      out-of-window date would recurse until the stack ran out.
 *
 * The bag is returned UNCHANGED when there is nothing to strip, so the common
 * path allocates nothing.
 */
function absoluteFallbackOptions(options?: DateDisplayOptions): DateDisplayOptions | undefined {
  if (options === undefined || options.style === undefined) return options;
  return { ...options, style: undefined };
}

/**
 * Format date as relative time (e.g., "3 days ago", "Today", "Overdue 3d"),
 * localized via `Intl.RelativeTimeFormat` (objectstack-ai/objectstack#3040).
 *
 * `dueLike` gates the "Overdue" wording — a past `start_date`/`created_at`
 * isn't overdue, only a past due/deadline-semantic field is. Non-due-like
 * past dates render as plain "N days ago" instead. The overdue phrase has no
 * `Intl` equivalent, so it resolves through `options.t` (key
 * `fields.relativeDate.overdue`) with an English fallback.
 *
 * Days are counted in the display zone (objectui#11693): "today" is the
 * display zone's today, and an instant falls on its day there. A date-only
 * value keeps the day it names and is counted from that same today, so an
 * instant and a date-only value on one day read one phrase.
 */
export function formatRelativeDate(value: string | Date | number, options?: DateDisplayOptions): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = toDisplayDate(value);
  if (!(date instanceof Date) || isNaN(date.getTime())) return '—';

  const diffDays = dayNumber(dayIn(date, zoneFor(date))) - dayNumber(dayIn(new Date(), displayTimeZone));

  // Beyond the ±7-day window, fall back to the absolute (already localized) form.
  if (diffDays < -7 || diffDays > 7) return formatDate(date, undefined, absoluteFallbackOptions(options));

  if (diffDays < -1 && options?.dueLike) {
    const absDays = Math.abs(diffDays);
    const key = 'fields.relativeDate.overdue';
    const translated = options.t?.(key, { count: absDays });
    return translated && translated !== key ? translated : `Overdue ${absDays}d`;
  }
  return formatRelativeDays(diffDays, options?.locale);
}

/**
 * Format date value.
 *
 * The named face comes from EITHER spelling — the positional `style`
 * parameter or `options.style` — and the precedence between them is pinned
 * (objectui#7745):
 *
 * > **The positional argument wins. `options.style` is consulted only when the
 * > positional slot is `undefined`.**
 *
 * Before #7745 only the positional spelling was read here, while
 * {@link formatDateTime} read only the `options` one — one shared bag, two
 * spellings for one concept, and on THIS function the options spelling did
 * nothing at all: `formatDate(v, undefined, { style: 'short' })` silently
 * rendered the default face with no diagnostic. Reading the key is the
 * additive half of the maintainer's long-run ruling on objectui#7443.
 *
 * Why the positional wins, and not the newer key:
 *
 *   - It is the ONLY direction that is purely additive. It fires exactly on
 *     the input that is a silent no-op today (positional absent, key present);
 *     every call that renders a face today renders the same face after.
 *   - The bag is SHARED across three functions, so it can legitimately carry a
 *     key meant for a sibling — that is this module's convention (`dueLike`
 *     and `t` are read by `formatRelativeDate` alone). A caller that built
 *     `{ style: 'compact', locale }` for `formatDateTime` and reused the bag
 *     for `formatDate(v, 'short', bag)` must keep its short face. A key aimed
 *     at a sibling function must not outrank an argument written for THIS
 *     call — that is objectui#7694's shape (an alias overwriting the canonical
 *     key), and the silent-override half of objectui#4272.
 *
 * `??`, not `||`, is what "absent" means here: `formatDate(v, '', bag)`
 * renders the default face today and must keep doing so, so an empty string
 * counts as GIVEN and does not fall through to the key.
 */
export function formatDate(value: string | Date | number, style?: string, options?: DateDisplayOptions): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = toDisplayDate(value);
  if (!(date instanceof Date) || isNaN(date.getTime())) return '—';

  const effectiveStyle = style ?? options?.style;
  // An instant names its day in the display zone; a calendar day is its own
  // day in every zone (objectui#11693).
  const zone = zoneFor(date);

  if (effectiveStyle === 'short') {
    // Compact format for mobile: "Jan 15, '24" / "1月 15, '24".
    // Only the MONTH token is localized: the surrounding compact shape (day,
    // apostrophe + 2-digit year) is a deliberate fixed layout for narrow
    // cards, not a locale-derived one. The tag comes from `options.locale`
    // like the default branch below — hardcoding `'en-US'` here made this the
    // one branch that ignored a locale its caller had threaded (objectui#4272).
    const month = date.toLocaleDateString(options?.locale, { month: 'short', ...inZone(zone) });
    const { day, year } = dayIn(date, zone);
    return `${month} ${day}, '${String(year).slice(-2)}`;
  }

  if (effectiveStyle === 'relative') {
    return formatRelativeDate(date, options);
  }
  
  // Default format: locale-aware human-readable. Drop the year when it
  // matches the current year — Salesforce / HubSpot / Linear all do this
  // because the year is rarely useful for in-progress records and the
  // verbose "2026年7月21日" form crowds cards and table cells. Past- /
  // future-year dates keep the year so users can disambiguate. A caller
  // whose dates are read side by side opts out with `alwaysShowYear`
  // (objectui#13331).
  const isCurrentYear = dayIn(date, zone).year === dayIn(new Date(), displayTimeZone).year;
  return date.toLocaleDateString(options?.locale, {
    year: isCurrentYear && options?.alwaysShowYear !== true ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    ...inZone(zone),
  });
}

/**
 * The `'compact'` datetime face as the two halves a grid cell paints
 * separately — `7/4/2024` and `7:00 am` for `2024-07-04T07:00:00Z` in `en-US`.
 *
 * `formatDateTime(value, { style: 'compact', ...options })` is exactly
 * `date + ' ' + time` of what this returns, so a caller that wants the face
 * as ONE string and a caller that wants to style the halves differently
 * cannot drift apart. That drift is what objectui#7443 recorded:
 * `DateTimeCellRenderer` inlined these two option bags and never called this
 * module, so `datetime` had two display conventions while `date` had one —
 * the same shape as objectui#4576, which this repo has already paid for once.
 *
 * `null` for a value this module renders as `'—'`; the cell renders its own
 * empty state for those, so it never sees the dash.
 */
export function formatDateTimeCompactParts(
  value: string | Date | number,
  options?: DateDisplayOptions,
): { date: string; time: string } | null {
  if (value === null || value === undefined || value === '') return null;
  const date = toDisplayDate(value);
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  // Both halves in the display zone, so the day and the time of one instant
  // never come from two zones (objectui#11693).
  const zone = zoneFor(date);

  return {
    date: date.toLocaleDateString(options?.locale, {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      ...inZone(zone),
    }),
    // `hour12` stays declared: this is the compact Airtable-style cell, and
    // the 12-hour face is its design, not a locale artefact. Locales that
    // write no am/pm marker simply ignore it.
    time: date.toLocaleTimeString(options?.locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...inZone(zone),
    }).toLowerCase(),
  };
}

/**
 * Format datetime value.
 *
 * `options.style` selects a named face:
 *
 *   - `'compact'` — the dense grid face, `7/4/2024 7:00 am` in `en-US`. It is
 *     what every `datetime` CELL renders, and what `DateTimeCellRenderer`
 *     used to build from its own inlined `Intl` bags (objectui#7443).
 *   - anything else, including absent — the verbose default,
 *     `Jul 4, 2024, 07:00 AM` in `en-US`. Unchanged, and still what a
 *     non-cell caller (dataset measure, gantt tooltip, data-table) gets.
 *
 * The signature is `(value, options?)`, unchanged: `style` is a key of
 * `options`, not a positional parameter, so every existing call —
 * `formatDateTime(v, { locale })` included — keeps meaning exactly what it
 * meant (see the note on `DateDisplayOptions.style` for why the positional
 * shape `formatDate` uses was refused here).
 *
 * `options` is optional, so a caller that passes nothing keeps the exact
 * runtime-default behavior it had. Before objectui#4272 the parameter did not
 * exist at all, which meant no caller could localize this function however
 * hard it tried — it always handed `Intl` an `undefined` tag, i.e. the
 * MACHINE's locale, which is neither of the repo's two locale channels.
 * Callers should pass the tag from `useDisplayLocale()`.
 *
 * The zone is NOT an option: an instant renders in the display zone the host
 * declared with {@link setDisplayTimeZone}, else the viewer's, on every face
 * this module produces (objectui#11693).
 */
export function formatDateTime(value: string | Date | number, options?: DateDisplayOptions): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = toDisplayDate(value);
  if (!(date instanceof Date) || isNaN(date.getTime())) return '—';

  if (options?.style === 'compact') {
    const parts = formatDateTimeCompactParts(date, options);
    return parts ? `${parts.date} ${parts.time}` : '—';
  }

  return date.toLocaleDateString(options?.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...inZone(zoneFor(date)),
  });
}
