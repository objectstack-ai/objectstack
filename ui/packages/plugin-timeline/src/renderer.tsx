/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { ComponentRegistry, isRealCalendarDate, toDateInputValue, toDisplayDate, toDisplayEndDate, toDomProps } from '@object-ui/core';
import type { TimelineRenderSchema } from './renderHandoff';
import {
  Timeline,
  TimelineItem,
  TimelineMarker,
  TimelineContent,
  TimelineTitle,
  TimelineTime,
  TimelineDescription,
  TimelineHorizontal,
  TimelineHorizontalItem,
  TimelineGantt,
  TimelineGanttHeader,
  TimelineGanttRowLabels,
  TimelineGanttGrid,
  TimelineGanttRow,
  TimelineGanttLabel,
  TimelineGanttBar,
  TimelineGanttBarContent,
} from './index';
import { renderChildren, cn } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import {
  useTimelineTranslation,
  translateTimelineDefault,
  type TimelineTranslate,
} from './useTimelineTranslation';

// Constants
/**
 * The spec's timeline scale vocabulary (`ui/view.zod.ts`
 * `TimelineConfigSchema.scale`). Exported for the spec-parity test.
 */
export const TIMELINE_SCALES: ReadonlySet<string> = new Set([
  'hour', 'day', 'week', 'month', 'quarter', 'year',
]);

/**
 * Resolve the axis scale for the gantt variant. `scale` is the ONLY axis key —
 * it is `@objectstack/spec` `ui/TimelineConfig.json`'s spelling.
 *
 * The `timeScale` alias this used to fall back to (`scale ?? timeScale`) is
 * RETIRED (objectui#6355, maintainer ruling 2026-08-27: immediate retirement,
 * no phased window, while the project is at startup stage). It was this
 * renderer's pre-spec dialect: before #2942 ONLY `timeScale` was read, so every
 * spec-authored `scale` was silently ignored — this function was the fix, and
 * dropping the alias half completes it.
 *
 * A document that still spells `timeScale` no longer reaches this function with
 * an axis, and would fall to the `month` default below. That reversion is NOT
 * left silent: `@object-ui/types` tombstones the key on both halves
 * (`TimelineSchema.timeScale?: never` and the Zod twin's `z.never()`), so the
 * retired spelling is refused at the authoring boundary rather than quietly
 * re-bucketing the chart. The tombstone is why this deletion is safe; the two
 * ship together.
 *
 * An absent/unknown value keeps the renderer's historical `month` default. The
 * `vertical` / `horizontal` variants are sequential event feeds with no time
 * axis, so `scale` has nothing to bucket there by construction.
 */
export function resolveTimelineScale(schema: { scale?: unknown }): string {
  const raw = schema.scale;
  return typeof raw === 'string' && TIMELINE_SCALES.has(raw) ? raw : 'month';
}

/**
 * THE ONE READ of a gantt date: every stop on the gantt branch takes it — the
 * validity gate, the computed extent, the min-over-max guard, the axis headers
 * and the bar geometry (objectui#10866, slice 3).
 *
 * A string goes through the shared step, `toDisplayDate` (`@object-ui/core`,
 * the objectui#10183 convention), which the bar tooltip's `formatDate` already
 * takes: a date-only `2026-10-05` is local midnight of the day it names, and a
 * value with a time part keeps its instant. The engine's own parse read the
 * date-only value as UTC midnight, and the headers walk and print with LOCAL
 * setters and getters, so west of UTC the axis read the day before while the
 * tooltip under it named the stored day. A day its month does not have
 * (`2026-02-30`) is refused here as the shared step refuses it (objectui#10026),
 * where the engine rolled it into March.
 *
 * A number (epoch milliseconds) or a `Date` is an instant and is read by
 * `new Date(value)` exactly as before. For a `Date` that is a fresh copy built
 * from its own time slot, so no method the authored object carries is called
 * afterwards; `toDisplayDate` would hand the object itself back, and the
 * gate's `getTime()` would then be the object's own (objectui#7027, `isDate`
 * below).
 *
 * ⛔ The stops must all read through here. They are one invariant read from
 * several ends: a date the gate lets through must be one the extent can
 * reduce, and a range the guard calls ordered must be one the headers can
 * walk. A stop that kept the engine parse would disagree with the others by
 * the viewer's UTC offset.
 *
 * A bar's END takes one more step after this read, `readGanttBarEnd`
 * (objectui#11112): a date-only end is drawn through the end of its day.
 */
function readGanttDate(value: string | number | Date): Date {
  return typeof value === 'string' ? toDisplayDate(value) : new Date(value);
}

/**
 * One unit of a gantt axis: the half-open span `[start, end)` in epoch
 * milliseconds, and the header label that names it.
 */
interface TimelineAxisUnit {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

/**
 * THE ONE AXIS of a gantt (objectui#11079): the span
 * `[start of the first unit, end of the last unit)`, and the units that tile
 * it, in order and with no gap.
 *
 * The header row and the bars are both drawn from this one value, through
 * `placeOnAxis`: a header is as wide as its unit's real length inside the
 * span, and a bar's `left` / `width` are measured on the same span. So a day
 * or an hour column is as wide as every other, a month is as wide as its days,
 * and a bar that starts at a unit's start begins exactly where that unit's
 * header begins.
 *
 * It replaced two constructions that did not agree. The headers were one
 * equal-width bucket per unit from the minimum date to the maximum date
 * inclusive, and the bars were a percentage of the minimum-to-maximum span,
 * which ends at the START of the last bucket. On a day axis over October 5th
 * to 7th the headers were three equal columns and the bars were measured on
 * two days, so the bar starting on the 6th sat at `left: 50%` under a column
 * starting at one third. ⛔ Do not add a second construction beside this one,
 * such as a bucket index for the headers next to a span for the bars.
 */
interface TimelineAxis {
  readonly start: number;
  readonly end: number;
  readonly units: readonly TimelineAxisUnit[];
}

/** How one scale snaps to, steps over and names its units. */
interface TimelineAxisScale {
  /** The start of the unit that contains `date`, as a new `Date`. */
  readonly floor: (date: Date) => Date;
  /** Move `cursor`, a unit start, to the next unit's start, in place. */
  readonly step: (cursor: Date) => void;
  /** The header label of the unit starting at `start`, the `index`-th unit of the axis. */
  readonly label: (start: Date, index: number, locale: string, t: TimelineTranslate) => string;
}

/** A copy of `date` at local midnight of its day. */
function localDayStart(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

const HOUR_MS = 60 * 60 * 1000;

const HOUR_AXIS: TimelineAxisScale = {
  floor: (date) => {
    const start = new Date(date);
    start.setMinutes(0, 0, 0);
    return start;
  },
  step: (cursor) => {
    cursor.setTime(cursor.getTime() + HOUR_MS);
  },
  label: (start, _index, locale) =>
    start.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric' }),
};

const DAY_AXIS: TimelineAxisScale = {
  floor: localDayStart,
  step: (cursor) => {
    cursor.setDate(cursor.getDate() + 1);
  },
  label: (start, _index, locale) => start.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
};

const WEEK_AXIS: TimelineAxisScale = {
  floor: localDayStart,
  step: (cursor) => {
    cursor.setDate(cursor.getDate() + 7);
  },
  label: (_start, index, _locale, t) => t('timeline.scale.week', { n: index + 1 }),
};

const MONTH_AXIS: TimelineAxisScale = {
  floor: (date) => {
    const start = localDayStart(date);
    start.setDate(1);
    return start;
  },
  step: (cursor) => {
    cursor.setMonth(cursor.getMonth() + 1);
  },
  label: (start, _index, locale) => start.toLocaleDateString(locale, { month: 'short', year: 'numeric' }),
};

const QUARTER_AXIS: TimelineAxisScale = {
  floor: (date) => {
    const start = localDayStart(date);
    start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
    return start;
  },
  step: (cursor) => {
    cursor.setMonth(cursor.getMonth() + 3);
  },
  label: (start, _index, _locale, t) =>
    t('timeline.scale.quarter', {
      quarter: Math.floor(start.getMonth() / 3) + 1,
      year: start.getFullYear(),
    }),
};

const YEAR_AXIS: TimelineAxisScale = {
  floor: (date) => {
    const start = localDayStart(date);
    start.setMonth(0, 1);
    return start;
  },
  step: (cursor) => {
    cursor.setFullYear(cursor.getFullYear() + 1);
  },
  label: (start) => String(start.getFullYear()),
};

/**
 * The unit of one of the six spec scales. `hour` steps by a fixed hour, so
 * every hour column is one hour wide across a DST change too. Every other
 * scale steps with LOCAL setters from a local midnight, so a day across a DST
 * change is 23 or 25 hours long and its column is that much narrower or
 * wider, which keeps it over the bars.
 *
 * `week` counts weeks from the axis's first day, as its `Week N` labels
 * always did. It does not snap to a calendar week start, which no spec key
 * names.
 *
 * An unknown `scale` gets the `month` unit, the renderer's historical default
 * (`resolveTimelineScale` makes the same call for the gantt branch).
 */
function axisScaleOf(scale: string): TimelineAxisScale {
  switch (scale) {
    case 'hour':
      return HOUR_AXIS;
    case 'day':
      return DAY_AXIS;
    case 'week':
      return WEEK_AXIS;
    case 'quarter':
      return QUARTER_AXIS;
    case 'year':
      return YEAR_AXIS;
    case 'month':
    default:
      return MONTH_AXIS;
  }
}

/**
 * THE ONE READ of a bar's END (objectui#11112): where a bar is drawn to.
 *
 * A date-only end is INCLUSIVE: the bar runs through the end of the day it
 * names, which is the next day's local midnight, the step the day column
 * takes too (a calendar day, never 24 hours). So a bar authored `2024-01-01`
 * to `2024-01-31` fills January and ends exactly where the February column
 * begins, and a bar whose date-only start and end name the same day is one day
 * wide, across a DST change too (that day's column is 23 or 25 hours wide, and
 * so is the bar). That is how the catalog producer and a project plan author
 * an end: "January 1st to January 31st" runs through January 31st.
 *
 * The rule itself lives in `@object-ui/core`, `toDisplayEndDate`
 * (objectui#11141), which `plugin-gantt` reads its ends through too, so the
 * two gantt surfaces draw one authored end on one day. ⛔ Do not step a day
 * here again. A string is handed to it: it reads the value as
 * `toDisplayDate` does, which is `readGanttDate`'s read of a string, and then
 * steps a date-only value (`isRealCalendarDate`) to its day's end.
 *
 * A value with a time part is an instant and the bar ends at it, as does a
 * number (epoch milliseconds) or a `Date` (objectui#10866), which keep
 * `readGanttDate`'s own read.
 *
 * The tooltip still prints the authored end: `formatDate` reads the day the
 * value names, not the edge the bar is drawn to.
 */
function readGanttBarEnd(value: string | number | Date): Date {
  return typeof value === 'string' ? toDisplayEndDate(value) : readGanttDate(value);
}

/**
 * Build the one axis for `scale` across `[minDate, maxDate]`, or `undefined`
 * when the range is unparseable or inverted.
 *
 * The first unit is the one that contains `minDate` and the last is the one
 * that contains `maxDate`, so every unit the range touches has a whole
 * column, and a degenerate `minDate === maxDate` range is exactly one unit. The span
 * is therefore never empty: `placeOnAxis` never divides by zero.
 *
 * Both ends are read by `readGanttDate` (objectui#10866, slice 3), so a
 * date-only end is local midnight of the day it names, and a value with a time
 * part keeps its instant and snaps to the start of its local unit.
 *
 * `through`, when given, is the last instant the rows' bars cover
 * (`calculateDateRange`, objectui#11112), and the axis runs on to the unit
 * that contains it. The computed `maxDate` is a DAY, which an `hour` axis
 * reads as that day's first hour, while a bar ending on that day is drawn
 * through its end (a date-only end) or to its hour (an instant). On every
 * other scale a unit that contains the day already contains every instant of
 * it, so `through` adds no unit there. It is not given for an author-pinned
 * `maxDate`, which stays exactly the author's range, nor for the empty plan.
 */
function timelineAxis(
  scale: string,
  minDate: string,
  maxDate: string,
  locale: string,
  t: TimelineTranslate,
  through?: number,
): TimelineAxis | undefined {
  const min = readGanttDate(minDate).getTime();
  const max = readGanttDate(maxDate).getTime();
  if (Number.isNaN(min) || Number.isNaN(max) || min > max) return undefined;
  const last = through === undefined ? max : Math.max(max, through);
  const unitScale = axisScaleOf(scale);
  const units: TimelineAxisUnit[] = [];
  const cursor = unitScale.floor(new Date(min));
  while (cursor.getTime() <= last) {
    const start = cursor.getTime();
    const label = unitScale.label(new Date(start), units.length, locale, t);
    unitScale.step(cursor);
    units.push({ start, end: cursor.getTime(), label });
  }
  return { start: units[0].start, end: units[units.length - 1].end, units };
}

/**
 * Where `[start, end)` sits on `axis`, as percentages of the axis's span:
 * `start` is the left edge and `width` the length. The header row and the
 * bars both call this, which is what keeps a bar under its column.
 */
function placeOnAxis(axis: TimelineAxis, start: number, end: number): { start: number; width: number } {
  const span = axis.end - axis.start;
  return {
    start: ((start - axis.start) / span) * 100,
    width: ((end - start) / span) * 100,
  };
}

/**
 * Gantt header labels for one scale across [minDate, maxDate]: the labels of
 * the one axis, `timelineAxis`, in order. Every spec scale produces a
 * non-empty header row — `hour` / `quarter` / `year` used to fall through the
 * month/week/day chain and return `[]`, blanking the axis (#2942). Exported
 * for the spec-parity test.
 *
 * `locale` is threaded in rather than read here: this is a pure function, and
 * the session's locale lives behind a hook (#4513). The three `Intl` branches
 * used to pass a literal `'en-US'`, so a fully Chinese timeline rendered an
 * English axis. The default is `'en'` — the same concrete last resort
 * `useDisplayLocale()` falls back to, and byte-identical to the retired
 * `'en-US'` at all three sites — so the existing 3-argument call sites keep
 * producing exactly what they produced before.
 *
 * `t` is threaded on the same seam and for the same reason (#4520). The two are
 * different kinds of dependency and each covers what the other cannot: a locale
 * TAG formats a date, a TRANSLATION spells a word. The `week` and `quarter`
 * units never touched `Intl`, so #4513 left them reading `Week 1` / `Q3
 * 2026` on an axis that had just become Chinese. Its default is the package's
 * own defaults table, which is what the channel serves with no `I18nProvider`
 * mounted, so 3- and 4-argument call sites keep producing byte-identical
 * English.
 *
 * ## Each unit starts on its unit boundary (objectui#11079)
 *
 * The first header is the unit that CONTAINS `minDate`, snapped to its start,
 * and the walk ends on the unit that contains `maxDate`. The walk used to step
 * from `minDate` itself, so a `month` axis from January 15th to April 10th
 * stopped at March (April 15th is past the end), and one from January 31st
 * skipped February (January 31st plus a month rolls into March). The labels
 * of a range that starts on a unit boundary are unchanged.
 *
 * ## The empty/degenerate range — the second of #6750's three sites
 *
 * objectui#6750 asked the same empty-list question at all three stops on the
 * gantt branch, so that fixing the one `throw` did not just move the crash two
 * stations down. A DEGENERATE range (`minDate === maxDate`, which is what
 * `emptyGanttDateRange` hands it) is not inverted — `min > max` is false when
 * they are equal — so the axis is the one unit that contains that date, and
 * every scale emits exactly one bucket. Measured on b76ca6764, min = max =
 * '2026-03-15': hour `["Mar 15, 12 AM"]`, day `["Mar 15"]`, week
 * `["Week 1"]`, month `["Mar 2026"]`, quarter `["Q1 2026"]`, year `["2026"]`.
 *
 * So the empty gantt gets a real one-column axis, not a header row with zero
 * cells. That composition is what
 * `./__tests__/timeline-gantt-empty-items.test.tsx` pins — separately from the
 * other two sites, so a later change that fixes one and not the others goes
 * red.
 *
 * ## The refusal is NOT dead code (objectui#6759)
 *
 * An unparseable or inverted range has no axis, so this returns NO headers.
 * The gantt branch refuses such a range before it draws: the unparseable one
 * by name in `findUnusableGanttDate`, and the inverted one when
 * `timelineAxis` answers `undefined`, which is the same read this function
 * makes. A `zero-column axis` is exactly what #6759's case 2 rendered its
 * negative-width bar under, and the fix was to refuse above rather than to
 * relax the refusal here.
 *
 * It stays because it is EXPORTED and called directly, including by
 * `timeline-gantt-empty-items.test.tsx`'s pin 5a, which holds these exact
 * inputs (`'2030-01-01'` / `'2026-03-15'`, and `''` / `''`) returning `[]`.
 *
 * ## The two ends are read as days (objectui#10866, slice 3)
 *
 * Both ends are read by `readGanttDate` inside `timelineAxis`, so a date-only
 * end is local midnight of the day it names and the walk, which moves and
 * prints with LOCAL setters and getters, starts on that day in every zone. A
 * value with a time part keeps its instant, and the walk starts at the local
 * start of the unit that contains it.
 */
export function generateTimeScaleHeaders(
  scale: string,
  minDate: string,
  maxDate: string,
  locale: string = 'en',
  t: TimelineTranslate = translateTimelineDefault,
): string[] {
  const axis = timelineAxis(scale, minDate, maxDate, locale, t);
  return axis ? axis.units.map((unit) => unit.label) : [];
}

/**
 * The date range a gantt falls back to when the rows carry NO dates at all —
 * an authored `items: []`, or rows whose `items` are all empty.
 *
 * ## Why a sentinel and not a throw (objectui#6750)
 *
 * `calculateDateRange` used to reduce the empty list directly: `Math.min()`
 * over no arguments is `Infinity`, and `new Date(Infinity).toISOString()`
 * throws `RangeError: Invalid time value` during render. An empty gantt is not
 * a malformed document — it is the ORDINARY empty state of a valid schema. Any
 * author or generator that builds `items` from a collection produces `items:
 * []` the moment the collection is empty: a filtered project list with no
 * matches, a fresh workspace, a plan whose rows are yet to be added. Crashing
 * the render on that is a correctness defect, not a strict-input policy.
 *
 * ## Why TODAY, and why a single day
 *
 * An empty plan carries no dates of its own, so the axis has to be anchored on
 * something outside the data, and "now" is the only anchor that is not
 * arbitrary. The span is ONE day — the smallest coherent range — because how
 * much time an empty gantt should show is a question about what an empty gantt
 * should LOOK like, and the 2026-08-29 triage on #6750 deliberately left that
 * open (「不要崩」 is the correctness floor it ruled on; 「崩改成空态面板还是零行
 * 图表」 is the product option it did not). A one-day window makes the smallest
 * possible claim: `timelineAxis` turns it into exactly one unit on every
 * scale, so the axis is valid and non-empty, and the grid below it has zero
 * rows.
 *
 * "Today" is the VIEWER's calendar day, printed from local getters, because
 * the axis reads this `YYYY-MM-DD` as local midnight of that day
 * (`readGanttDate`). It used to be the UTC day, `toISOString()`'s date part,
 * which is tomorrow for a viewer west of UTC in the evening and yesterday for
 * one east of UTC after midnight (objectui#10866, slice 3). The object
 * timeline's "Today" bucket is the same local day.
 *
 * ## What this deliberately does NOT do
 *
 * It does not reach the caller when the author pinned a range. The gantt branch
 * resolves `schema.minDate || dateRange.minDate`, so an author who pinned an
 * explicit `minDate` / `maxDate` gets EXACTLY that range with no rows in it —
 * most likely what they wanted, and free. Pinned by
 * `./__tests__/timeline-gantt-empty-items.test.tsx`.
 */
function emptyGanttDateRange(): { minDate: string; maxDate: string } {
  const today = toDateInputValue(new Date());
  return { minDate: today, maxDate: today };
}

/**
 * One gantt ROW after `classifyGanttRows` has judged its shape — the ONLY form
 * the three readers below it (`findUnusableGanttDate`, `calculateDateRange`,
 * the render loop) accept, so that no reader re-reads the raw shape.
 */
interface GanttRow {
  /** The row exactly as authored — handed to `onItemClick` untouched. */
  readonly authored: any;
  /** `row.label` as authored, read once here and never off `authored` again. */
  readonly label: any;
  /**
   * `row.items` as authored when it is an array; `[]` when it is absent or
   * falsy (a row with no bars yet is the same ordinary empty state
   * objectui#6750 ruled for `items: []`, and a CONTROL on objectui#7164). A
   * TRUTHY non-array never reaches this type — `classifyGanttRows` refuses it.
   */
  readonly items: readonly any[];
}

/** What `classifyGanttRows` hands back: rows to draw, or the first malformed shape. */
type GanttRowsVerdict =
  | { readonly ok: true; readonly rows: readonly GanttRow[] }
  | { readonly ok: false; readonly path: string; readonly value: unknown };

/**
 * THE ROW WALK, READ ONCE — objectui#7164 (maintainer ruling 2026-09-02, A+).
 *
 * ## What was wrong
 *
 * The gantt branch used to read the authored rows twice and read them
 * differently: `findUnusableGanttDate` walked them with `?.` and `|| []` and
 * SKIPPED whatever it could not index, while `calculateDateRange` re-walked the
 * same rows BARE. Every input in the gap crashed the render with a `TypeError`,
 * and all of it is ordinary JSON that the declared zod mirror accepted:
 *
 *     items: [null]                              at `row.items`
 *     items: [{ items: 5 }]  (or true, {}, or    at `(row.items || []).flatMap`
 *            an array-LIKE { length: 1, 0: … })
 *     items: {} / 'x' / 5                        at `items.flatMap`
 *
 * Measured in render on `a67abdc88`, beside five live drawing controls.
 *
 * ⛔ And a guard in any ONE reader does not close the class — it MOVES it.
 * Measured by ablation on `51449a043` (the card) and re-measured here: a
 * tolerant `calculateDateRange` relocated all three crashes into the render
 * loop's `items.map`, `row.label` and `(row.items || []).map`, with the
 * ordinary-row control drawing on both sides of the mutation. That is the
 * relocation this path had performed four times, which is why this function
 * is the ONLY place the raw shape is read and why the three readers below
 * consume its `GanttRow[]` rather than `schema.items`.
 *
 * ## The three refusals, in walk order
 *
 *   1. `items` is not an array         -> path `items`
 *   2. a row is not an object           -> path `items[i]`
 *      (`null`, `undefined`, a number, a string, a boolean, an array, or
 *      any other non-object — objectui#7364 widened this line from `null`)
 *   3. `row.items` is a TRUTHY non-array -> path `items[i].items`
 *
 * Each names the authored location and the value — spelled by
 * `spellGanttDateValue`, so no author code runs to describe it — through
 * `timeline.gantt.unusableRange.malformedRow`, a key of its own. It is never
 * the `malformedDate` copy: "items[0] is null, which is not a valid date"
 * names the wrong fault for a row that is not a row, and objectui#6781's ruled
 * date accept set does not answer a question about rows. The first malformed
 * shape wins — rows are judged as rows before their dates are judged as dates.
 *
 * ## The accept set is the ruling's, not a wider one
 *
 * REFUSE, not skip: drawing the well-formed rows and dropping the malformed
 * one silently is the consumer-side tolerance objectui#6750 and objectui#6759
 * both refused, and the ruling declined it (option B). Nor is the set widened
 * past the three lines above. The shapes NEXT to them keep drawing, pinned as
 * CONTROLS: `items: []`, a row with no `items` key, and a row whose `items`
 * is `null` (all the empty row). The renderer is only ever as lenient as
 * `validate` or more, never the reverse, and never crashes on what `validate`
 * admits.
 *
 * ## A row that is not an object (objectui#7364, ruling 5809218505, A)
 *
 * objectui#7164's ruling kept `items: [0]` and `items: [[]]` DRAWING, as
 * CONTROLS: a non-null primitive or an array has no `.items` and no `.label`,
 * so it drew an EMPTY, UNLABELLED row and nothing told the author. The zod
 * mirror (`@object-ui/types`, `TimelineSchema.items`) already refused both at
 * AUTHORING time, so the declared and the rendered accept sets disagreed in
 * that corner. The objectui#7364 ruling (letter A, maintainer 2026-09-24)
 * DELIBERATELY SUPERSEDES that clause: line 2 now refuses every row that is
 * not an object, through the SAME `malformedRow` key — the existing copy
 * already reads `items[0] is 0, which is not a row shape` — so no key and no
 * pack string was added.
 *
 * "Not an object" is `typeof row !== 'object' || row === null ||
 * Array.isArray(row)`. That is the set JSON can spell and the mirror refuses
 * (`z.object` refuses `null`, numbers, strings, booleans and arrays). No
 * prototype test is made: a `Date`, a class instance or a `Proxy` row cannot
 * be written in JSON, a prototype read would be one more non-total site for a
 * revoked proxy, and the live-`Proxy` row control must keep drawing.
 *
 * ## What this does to the exotic exclusion (objectui#7153, pin 5)
 *
 * The three reads objectui#7153 measured as U1–U3 (`items.length`,
 * `items[rowIndex]`, `row.items`) now happen HERE, once, and they are still
 * not total for a throwing trap — the pinned messages are unchanged because the
 * trap writes them. `Array.isArray` is a NEW non-total site for a revoked
 * `Proxy` (it throws `Cannot perform 'IsArray' …`, the same class
 * `spellGanttDateValue` already declares), so a revoked proxy handed as `items`
 * or as a row's `items` now dies here rather than at U1 / U4 — and, since
 * objectui#7364 asks `Array.isArray(row)` before U3 reads `row.items`, a
 * revoked proxy handed as a ROW dies at `IsArray` too rather than at U3. All
 * three moves are stated and exercised in
 * `timeline-gantt-date-brand-7027.test.tsx`, and the reachability argument is
 * unchanged: JSON cannot spell a proxy.
 *
 * Pinned by `./__tests__/timeline-gantt-malformed-row-7164.test.tsx`, which
 * re-runs the card's THREW table (now REFUSED, each naming its path) with the
 * drawing controls unchanged, and — objectui#7364 — the non-object rows that
 * table used to keep as controls, now REFUSED.
 */
function classifyGanttRows(items: unknown): GanttRowsVerdict {
  if (!Array.isArray(items)) return { ok: false, path: 'items', value: items };

  const rows: GanttRow[] = [];
  for (let rowIndex = 0; rowIndex < items.length; rowIndex++) {
    const row = items[rowIndex];
    // objectui#7364 — any non-object row, not only `null` (see above).
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      return { ok: false, path: `items[${rowIndex}]`, value: row };
    }

    const rowItems = row.items;
    if (rowItems && !Array.isArray(rowItems)) {
      return { ok: false, path: `items[${rowIndex}].items`, value: rowItems };
    }
    rows.push({ authored: row, label: row.label, items: rowItems || [] });
  }
  return { ok: true, rows };
}

/**
 * The date range computed from the rows — read off `classifyGanttRows`'s
 * verdict, never off `schema.items`.
 *
 * Before objectui#7164 this function re-walked the authored rows BARE
 * (`items.flatMap`, `row.items` with no `?.`) one line after
 * `findUnusableGanttDate` had walked them defensively, and every shape in the
 * gap between the two readings crashed here — see `classifyGanttRows` above
 * for the table, and for why the repair was not a guard on this line. Every
 * `row.items` reaching this reduce is an array by construction; every date in
 * it parses, because the caller refuses an unparseable one first.
 *
 * `through` is the last instant any bar covers, with each end read as the bar
 * geometry reads it (`readGanttBarEnd`, objectui#11112): the instant before a
 * bar's drawn end, or its start when it has no length. The axis runs on to the
 * unit that contains it (`timelineAxis`), which on an `hour` axis is the last
 * hour of a date-only end's day, where the printed `maxDate` alone stops at
 * that day's first hour. The empty plan has no bars, so it has no `through`.
 */
function calculateDateRange(rows: readonly GanttRow[]): {
  minDate: string;
  maxDate: string;
  through?: number;
} {
  const allDates = rows.flatMap((row) =>
    row.items.flatMap((item: any) => [item.startDate, item.endDate])
  );

  // objectui#6750 — the empty list is an ordinary state, not an error. Guarding
  // it HERE rather than at the call site is what keeps the whole gantt branch
  // coherent: the caller's `schema.minDate || dateRange.minDate` still resolves,
  // `timelineAxis` still gets a parseable min <= max and so still builds an
  // axis, and `calculateBarDimensions` is simply never reached because there
  // are no rows to draw bars for. See `emptyGanttDateRange` above.
  if (allDates.length === 0) return emptyGanttDateRange();

  // objectui#6759 — a list whose dates do not PARSE is a different input class
  // and is refused by the caller, above this function, naming the offending
  // value. So by the time control reaches the reduce below, every entry parses
  // and `Math.min` / `Math.max` are finite. objectui#6770 added `null` to that
  // same refusal, which is what keeps the EPOCH out of this reduce: `null`
  // parses to `0`, so it would have arrived here as a perfectly finite 1970
  // bound and anchored the axis fifty-four years early. Do NOT add a second guard here: a
  // sentinel substituted for a value the author got wrong is the consumer-side
  // tolerance both #6750 and #6759 rejected — see `findUnusableGanttDate`.

  // objectui#10866, slice 3 — each date is read by `readGanttDate`, the read
  // the gate above already made, and each end is printed as the VIEWER's
  // calendar day, from local getters (`toDateInputValue` of a `Date`), because
  // the headers and the bar geometry read it back as local midnight of that
  // day. `toISOString()`'s date part named the UTC day: of a date-only value
  // read as local midnight, that is the day before east of UTC, and of an
  // instant it can be a day the viewer's axis does not start on.
  const minTimestamp = Math.min(...allDates.map((d) => readGanttDate(d).getTime()));
  const maxTimestamp = Math.max(...allDates.map((d) => readGanttDate(d).getTime()));

  // objectui#11112 — a bar is drawn to `readGanttBarEnd`, so the extent reads
  // each end the same way. `end - 1` is the last millisecond of `[start, end)`.
  const through = Math.max(
    ...rows.flatMap((row) =>
      row.items.map((item) => {
        const start = readGanttDate(item.startDate).getTime();
        const end = readGanttBarEnd(item.endDate).getTime();
        return end > start ? end - 1 : start;
      }),
    ),
  );

  return {
    minDate: toDateInputValue(new Date(minTimestamp)),
    maxDate: toDateInputValue(new Date(maxTimestamp)),
    through,
  };
}

/**
 * "Is this value a `Date`?" — asked so that NOTHING the authored document
 * controls can answer it, and so that asking cannot throw (objectui#7027).
 *
 * ## What was wrong with `instanceof Date`
 *
 * It is this repo's idiom for the question (see `toDay` in
 * `components/src/renderers/form/calendar.tsx`), and it answers a
 * DIFFERENT question: "does this inherit from `Date.prototype`?". A `Date` is
 * a Date because it owns a `[[DateValue]]` internal slot; the prototype chain
 * is decoration, and the two come apart in both directions. Measured on this
 * card's base 7fc5c3c12 with a node probe:
 *
 *     Object.create(Date.prototype) instanceof Date        -> true
 *     new Date(Object.create(Date.prototype))              -> THREW TypeError:
 *         Method Date.prototype.toString called on incompatible receiver
 *         [object Object]
 *
 * `new Date(x)` uses the slot directly when `x` owns one and runs ToPrimitive
 * when it does not — so an impostor that passed the gate reached `new Date`,
 * reached `Date.prototype[Symbol.toPrimitive]`, reached
 * `Date.prototype.toString` on a receiver with no slot, and took the render
 * down with it. That is a blank screen where a named diagnostic belongs, which
 * is the exact failure mode #6781 put the type gate here to remove and `7fc5c3c12`
 * removed one function downstream.
 *
 * `instanceof` is not even total on its own terms: it walks
 * `[[GetPrototypeOf]]`, so a `Proxy` with a throwing `getPrototypeOf` trap
 * crashes inside the operator (measured, same probe).
 *
 * ## Why NOT the two brand tests the card suggested — both measured, both out
 *
 * - `Object.prototype.toString.call(value) === '[object Date]'` performs
 *   `Get(O, @@toStringTag)` UNCONDITIONALLY (ES2015 19.1.3.6 step 16), even
 *   once the builtin tag is decided. A `@@toStringTag` getter that throws is
 *   an authored value, and `7fc5c3c12` measured that exact input crashing the
 *   speller. It trades an impostor crash for a getter crash.
 * - `Number.isFinite(value.getTime())` calls the AUTHOR'S `getTime`. A
 *   `class X extends Date` that overrides it is a REAL Date — `super()` gave
 *   it the slot, so #6781's accept set contains it and the chart must draw —
 *   and this spelling would refuse it by dying. It trades an impostor crash
 *   for a subclass crash, on a value that is not even wrong.
 *
 * Both are pinned as red rows in `timeline-gantt-date-brand-7027.test.tsx`,
 * so a later "simplification" into either one fails there rather than in a
 * fifth card.
 *
 * ## What this does instead
 *
 * Invokes the BUILTIN `Date.prototype.getTime` with `.call`. It reads the
 * receiver's `[[DateValue]]` slot and nothing else: no property is fetched off
 * `value`, so no author getter runs, no `@@toStringTag` is consulted, no proxy
 * trap fires, and a subclass cannot hijack it. The slot is not observable any
 * other way — the language exposes that bit only by throwing when it is
 * absent — so the `catch` is the READ, not error handling draped over a
 * fallible operation.
 *
 * `new Date(NaN)` owns its slot, so it is a `Date` here and is refused one
 * step later by the parse check, keeping its `Invalid Date` spelling. That is
 * the half of #6781's ruling this must not move.
 */
const isDate = (value: unknown): value is Date => {
  try {
    Date.prototype.getTime.call(value as Date);
    return true;
  } catch {
    return false;
  }
};

/**
 * How a gantt date value is SPELLED inside a diagnostic (objectui#6759,
 * ruled into a rule by `7fc5c3c12`).
 *
 * ## THE RULE
 *
 *     Spell the value when the LANGUAGE owns its spelling.
 *     Name its TYPE when producing text would run AUTHOR code.
 *
 * That single line decides every branch below, and it is a rule rather than a
 * list of values someone tripped over — the same treatment #6781 gave the
 * accept set. Every primitive has a spelling fixed by the grammar, so a
 * primitive is spelled: it is literally the text the author typed, and it
 * cannot be confused with the spelling of a different value. A non-primitive
 * has no such spelling. The only way to get text out of one is to call
 * `toString` / `Symbol.toPrimitive` / `Symbol.toStringTag`, all of which are
 * whatever the authored document happens to carry — so the diagnostic would be
 * quoting the very data it is refusing, as if it were trustworthy.
 *
 * ## Why the old `String` fallback had to go — three faults, all measured
 *
 * The fallback was written by #6759 when nothing but `[object Object]`-shaped
 * values could reach it. `85f6a6097` (the #6781 type rule) routes the whole
 * non-date type space through it. Measured on this card's base b458300ca, one
 * row item and a throwaway probe (`startDate: '2024-01-01'`, `endDate` varied):
 *
 *     endDate: []                 -> "endDate is , which is not a valid date"
 *     endDate: ['2024-01-01']     -> "endDate is 2024-01-01, ..."
 *     endDate: [0]                -> "endDate is 0, ..."
 *     endDate: 0n                 -> "endDate is 0, ..."
 *     endDate: {toString: () => '2024-01-01'}
 *                                 -> "endDate is 2024-01-01, ..."
 *     endDate: new Map()          -> "endDate is [object Map], ..."
 *     endDate: function myFn() {} -> the function's SOURCE TEXT, newlines and all
 *     endDate: {toString() { throw }}      -> THREW, uncaught, mid-render
 *     endDate: {get [Symbol.toStringTag]() { throw }}
 *                                          -> THREW, uncaught, mid-render
 *     endDate: Object.create(null)         -> THREW TypeError: Cannot convert
 *                                             object to primitive value
 *
 * 1. It VANISHES. `String([])` is the empty string, so the value disappears
 *    from its own sentence — the exact blur this helper quotes strings to
 *    avoid, reached through a different branch.
 * 2. It LIES. `['2024-01-01']` is spelled as a text that IS a valid date, and
 *    `[0]` / `0n` as a number that IS an accepted one (`0` is a kept gantt
 *    date, #6781). The author is told a correct-looking value is invalid with
 *    no hint that the wrapper is the fault.
 * 3. It THROWS. The last three rows are live crashes on `main`, and they are
 *    the reason this is not a cosmetic card. #6759 declared this helper "total
 *    by construction" and `85f6a6097` made that property load-bearing by putting the
 *    type gate BEFORE `new Date`. But the gate only stopped `new Date` from
 *    throwing; `String(value)` still handed control to author code one line
 *    later, so the crash class did not go away — it moved from
 *    `findUnusableGanttDate` into this function. A helper that dies while
 *    reporting an author error replaces a named diagnostic with a blank screen,
 *    which is the failure mode both cards exist to remove.
 *
 * ## Why NOT `JSON.stringify`, the obvious repair
 *
 * `JSON.stringify(0n)` THROWS (`TypeError: Do not know how to serialize a
 * BigInt`), and it throws again on a cycle, and it drops `undefined` members.
 * It would reintroduce fault 3 — the crash class — into the one helper that
 * must not have it. Measured, not assumed. It stays only where it is already
 * total: on a `string`, where it is #6759's quoting and nothing else.
 *
 * ## Why NOT "type plus a bounded rendering"
 *
 * The rule refuses it, on the same ground as the rest: any rendering of a
 * non-primitive reads something off it. Even the most bounded version — an
 * element count — is not total, because `Array.isArray` is true for a Proxy
 * whose `length` trap throws (measured). A hybrid would buy a few characters of
 * detail by giving back the crash-freedom the whole card is about.
 *
 * ## Why naming the TYPE does not abandon this helper's purpose
 *
 * The purpose is to let an author find and fix the value. The PATH half does
 * the finding and is always exact (`items[0].items[0].endDate`); the value half
 * exists to disambiguate what sits there when the author cannot see it — `''`
 * from `'  '` from a key never written. For a non-primitive, the author can
 * read their own document at that path; what they cannot read is WHY it was
 * refused. "is an array" says exactly that, and says it about the wrapper,
 * which is the repair. Naming a WRONG value, as the fallback did, is strictly
 * worse than naming a category: it costs the author a search for a fault that
 * is not there.
 *
 * ## The branches, and how far each one's totality reaches
 *
 * - `string` -> quoted (#6759's pin; empty and space-padded stay visible).
 * - `undefined` / `null` -> themselves (#6759 / #6770's pins; how an author
 *   reads a key they forgot to write versus one they wrote as empty).
 * - `symbol` -> `Symbol(desc)` via `Symbol.prototype.toString`, which no
 *   instance can override. `String(aSymbol)` THROWS; `85f6a6097`'s type-first
 *   ordering is what finally made this branch reachable.
 * - `bigint` -> the LITERAL, with its `n`. `String(0n)` is `"0"`, which is
 *   fault 2; `${value}n` is what the author typed and is unmistakable.
 * - `number` / `boolean` -> `String`, which for a primitive IS the source
 *   syntax (`0`, `NaN`, `false`).
 * - `Date` -> `Date.prototype.toString.call`, NOT `String`. Byte-identical for
 *   every Date that owns a `[[DateValue]]` slot (measured, both the valid and
 *   the `Invalid Date` reading), so the inverted-range diagnostic this helper
 *   is shared with does not move. It is used in place of `String` because a
 *   `class X extends Date` that overrides `toString` can hijack `String` and
 *   throw (measured) — the builtin cannot be. This is the one non-primitive
 *   with a spelling the LANGUAGE owns, and it is also the only non-primitive
 *   the accept set contains. The branch is SELECTED by `isDate` and not by
 *   `instanceof Date` (objectui#7027): the builtin `toString` throws on a
 *   receiver that inherits `Date.prototype` without owning the slot, so
 *   choosing this branch on the prototype chain is what let an impostor crash
 *   the very sentence that was supposed to name it.
 * - everything else -> `an array` / `a function` / `an object`, chosen with
 *   `Array.isArray` and `typeof`, which read no author-controlled property.
 *   Deliberately NOT `Object.prototype.toString.call`: that consults
 *   `Symbol.toStringTag`, which can be a throwing getter (measured), so the
 *   more informative spelling is the non-total one. `Array.isArray` reads no
 *   property and is STILL not total — on a revoked `Proxy` it throws. That is
 *   the one exclusion this docblock claims, and it is stated and exercised
 *   rather than repaired: see the `869b876c8` note below.
 *
 * All eight `typeof` results are covered and no branch falls through to author
 * code. The single reflective operation it performs is the Date test, which is
 * the one `isGanttDateType` already performed on the same value to refuse it —
 * so this function adds no throw site the accept gate does not already have.
 *
 * ⚠️ objectui#7027 — that sentence was true and the helper was still not
 * total, because the shared test was `instanceof Date` and `instanceof` is not
 * total. `Object.create(Date.prototype)` took this function's `Date` branch
 * and threw inside `Date.prototype.toString.call`; a `Proxy` with a throwing
 * `getPrototypeOf` trap threw inside the operator itself (both measured on
 * 7fc5c3c12). Both sites now ask `isDate`, which is total, so the shared
 * operation adds no throw site because it HAS none — not because the gate
 * absorbed it first.
 *
 * ⚠️ `869b876c8` — READ THE TWO PARAGRAPHS ABOVE AS A SEQUENCE, NOT AS A
 * CONCLUSION. Each was written as the settled answer and the next card's
 * measurement moved it (#6759 -> `85f6a6097` -> `7fc5c3c12` -> #7027). This is the fifth
 * entry and it is deliberately NOT a fifth claim of totality. The sentence it
 * falsifies is the one directly above the #7027 note: this function DOES add
 * a throw site the accept gate does not have, and it is `Array.isArray`.
 *
 * THE EXCLUSION, measured in-render on dd35800af through `TimelineRenderer`
 * itself — not a replica of these branch bodies:
 *
 *     endDate: <a revoked Proxy, over any target>
 *         -> THREW TypeError: Cannot perform 'IsArray' on a proxy that has
 *            been revoked                     (here, at `Array.isArray`)
 *
 * `IsArray` recurses into `[[ProxyTarget]]`, which a revoked proxy does not
 * have, so this throws on an INTERNAL condition while still reading no
 * author-controlled property. All four target shapes throw (`{}`, `[]`, a
 * function, a real `Date`), and so does a revoked proxy pinned as
 * `schema.minDate` / `maxDate`. `typeof` does not separate it out — it
 * answers `'object'` (or `'function'`) without throwing.
 *
 * WHY IT IS LEFT, and none of the three reasons is cost:
 *
 * 1. It is not reachable from an authored document — ObjectUI metadata is
 *    JSON and JSON cannot spell a proxy. Re-swept on dd35800af: zero
 *    `Proxy.revocable` in the repo, zero `Object.setPrototypeOf` calls in
 *    any package `src/`, each read beside a live control on the same
 *    instrument
 *    (52 `Proxy` mentions, 19 `Object.assign` calls) so the zeros are
 *    readings and not a broken query. The `__proto__` hits are denylists.
 * 2. A `catch` here would be SUBSTITUTION, not a read — the opposite of
 *    `isDate`'s. `isDate` catches because the language exposes the
 *    `[[DateValue]]` bit ONLY by throwing, so its catch IS the read. A
 *    revoked proxy has no array-ness to read, so catching would discard a
 *    failure and substitute `an object`: consumer-side tolerance, which is
 *    what #6750 and #6759 both refused. A second `catch` beside `isDate`'s
 *    would erase the distinction this file is built on.
 * 3. It would buy no invariant, because of the paragraph below.
 *
 * ⛔ `Array.isArray` IS NOT THE LAST NON-TOTAL OPERATION ON THE GANTT DATE
 * PATH, and this function cannot make the path total. The true and much
 * narrower sentence is that `Array.isArray` is the last non-total operation
 * INSIDE THIS FUNCTION. Everything upstream of it — the property reads that
 * FETCH the date out of the authored document — is enumerated on
 * `findUnusableGanttDate` and on `calculateDateRange`, which is where a reader
 * asking "how far does this go?" should go next.
 *
 * ⚠️ objectui#7153 — TWO CORRECTIONS to the paragraph that used to stand here,
 * both of them measurements, and the second one matters much more than the
 * first.
 *
 * It said FIVE upstream crash sites. Driven in render on `51449a043` the count
 * is NINE: six in `findUnusableGanttDate` (its `items.length`, `items[i]`,
 * `items[i]?.items`, `rowItems.length`, `rowItems[j]` and `rowItems[j]?.[key]`)
 * and three in `calculateDateRange`. A tenth is identified by reading and
 * recorded as NOT MEASURED. Five was written after a real measurement, and it
 * was short — which is the fifth time prose on this path has been.
 *
 * It also said the upstream sites "are the same reachability class (JSON
 * spells neither a getter nor a proxy)". That is TRUE of the six and FALSE of
 * the three. `calculateDateRange` reads the same walk BARE — `items.flatMap`
 * and `row.items` with no optional chaining — so an authored `items: [null]`,
 * or a row whose `items` is a truthy non-array, crashes the render from
 * ordinary JSON that the declared zod mirror accepts. That is a live defect,
 * objectui#7164, not an excluded exotic. The exclusion argument this docblock
 * makes for its own `Array.isArray` covers the six and must not be borrowed
 * for the three.
 *
 * ⚠️ Whatever totality this docblock claims is bounded by an EXERCISED input
 * set — the rows in `__tests__/timeline-gantt-date-brand-7027.test.tsx`,
 * which now include the revoked proxy — and by nothing else. On this path
 * prose has been a hypothesis four times running.
 *
 * ## What this deliberately does NOT do
 *
 * It does not change WHICH values are refused — that is #6781's ruling and it
 * is untouched here — and it does not change the sentence. "is an array, which
 * is not a valid date" reads correctly in the existing
 * `timeline.gantt.unusableRange.malformedDate` hole, so no new i18n key is
 * added and the ten locale packs are not opened. A spelling repair that needed
 * a new key would be a different file surface and a separate decision.
 *
 * (objectui#7164 later took that decision for a DIFFERENT fault — a malformed
 * ROW, not a date spelling — and opened the packs for `malformedRow`. This
 * function's spelling fills that key's `{{value}}` hole as well, for the same
 * reason it fills `malformedDate`'s: a value is named, never rendered, and no
 * author code runs. See `classifyGanttRows`.)
 */
function spellGanttDateValue(value: unknown): string {
  // Primitives — the language fixes the spelling, so it is the author's own.
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  // The one non-primitive whose spelling the LANGUAGE owns, and the only one
  // the accept set contains. `.call` so a subclass cannot hijack it, and
  // `isDate` rather than `instanceof` so a slot-less impostor never reaches
  // that builtin — it throws on a receiver without `[[DateValue]]` (#7027).
  if (isDate(value)) return Date.prototype.toString.call(value);

  // Every other non-primitive — named, never rendered. No author code runs.
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'function') return 'a function';
  return 'an object';
}

/** A gantt date that does not parse, with the authored path that names it. */
type UnusableGanttDate = { path: string; value: unknown };

/**
 * The first gantt date that does not parse — objectui#6759 case 1.
 *
 * ## What was wrong
 *
 * objectui#6750 taught `calculateDateRange` about the EMPTY list and nothing
 * else. A list whose dates do not PARSE reduced exactly as before:
 * `new Date('not-a-date').getTime()` is `NaN`, `Math.min(NaN)` is `NaN`, and
 * `new Date(NaN).toISOString()` throws `RangeError: Invalid time value`
 * mid-render — the same crash site and the same signature as #6750, on a
 * different input class. Measured on this card's base b98352a15, with a
 * throwaway probe before any change:
 *
 *     CASE-1  malformed startDate + endDate -> RangeError: Invalid time value
 *     CASE-1b one date parses, one does not -> RangeError: Invalid time value
 *     CASE-1c endDate absent entirely       -> RangeError: Invalid time value
 *
 * 1c is the one worth reading twice. `new Date(undefined)` is also an invalid
 * date, so a row item that simply OMITS `endDate` crashed the render too — it
 * arrives at the same reduce through the same `[item.startDate, item.endDate]`
 * flatMap. It is not a separate defect and it is not a widening: any guard
 * phrased as "every date in the list must parse" necessarily covers it, and
 * deliberately excluding it would mean writing extra code to keep one input
 * class crashing.
 *
 * ## Why the PINS are scanned here too
 *
 * `schema.minDate` / `schema.maxDate` never reach `calculateDateRange` — the
 * caller resolves `schema.minDate || dateRange.minDate` afterwards — so an
 * author who pins an unparseable value does not crash. They fail the OTHER
 * way, which is worse and is case 2's disease: measured on the same base,
 * `minDate: 'whenever'` rendered an axis with zero columns and a bar carrying
 * NO `style` attribute at all (`CASE-2b ... bars: [null]`), because
 * `calculateBarDimensions` divided by `NaN` and the CSSOM rejects
 * `left: NaN%`. One scan covers both origins because they are one question:
 * does every date this chart is about to be drawn from parse?
 *
 * Only a TRUTHY pin is judged. `schema.minDate: ''` is falsy, so the caller's
 * `||` discards it and the computed range is used instead; judging a value the
 * render will never read would refuse a chart that draws correctly. `null` is
 * falsy as well, so a PINNED `null` stays unjudged for that same reason even
 * though a ROW `null` is refused below (objectui#6770) — measured: `minDate:
 * null, maxDate: null` draws the rows' own range, `['Jan 2024','Feb 2024','Mar
 * 2024']`. The asymmetry is the caller's `||`, which row dates have nothing
 * equivalent to.
 *
 * Rows before pins, which is the order the caller resolves them in — compute
 * from the rows, then let a pin override. When both are wrong the diagnostic
 * names the one a reader tracing the render reaches first.
 *
 * ## `null` is a fault too — the one that PARSES (objectui#6770)
 *
 * `new Date(null).getTime()` is `0`, not `NaN` — the epoch, not an invalid
 * date — so a `null` date passes every parse check there is and flows into the
 * arithmetic as `1970-01-01`. #6759 left it alone as an input class it had not
 * measured; #6770 measured it, on c6732825d, i.e. WITH the guard above already
 * in the tree, one row item and a throwaway probe:
 *
 *     CASE-NULL-END   endDate: null   -> alert: null, axis 649 columns
 *                     (Jan 1970 … Jan 2024), bars ["left: 100%; width: -100%;"]
 *     CASE-NULL-START startDate: null -> alert: null, axis 651 columns,
 *                     bars ["left: 0%; width: 100%;"]
 *     CASE-NULL-BOTH  both null       -> alert: null, axis ["Jan 1970"],
 *                     bars ["left: 0%; width: 100%;"]
 *
 * The last two are the reason this is refused rather than drawn: they do not
 * even look broken. A full-width bar under a one-bucket `Jan 1970` axis is a
 * chart a reader believes.
 *
 * ## Why refused, rather than read as "open-ended" or as "absent"
 *
 * Not a new adjudication: #6759 already refuses an ABSENT date — `new
 * Date(undefined)` is `NaN` — and pins it ("an ABSENT date is the same input
 * class and is named as `undefined`"). `null` is that same absence with a
 * different spelling: a record mapping that omits the key and one that emits
 * `null` report the same unset field upstream. Treating them differently would
 * make the chart depend on how a mapping layer spells "no value" — something
 * no author writes and none can predict. The two other readings both fail the
 * same test: "runs to the end of the axis" is a new rendering behaviour that
 * would need a spec key of its own rather than a meaning smuggled into `null`,
 * and "fall back to `startDate`" substitutes a plausible value for one the
 * document does not carry — the consumer-side tolerance #6750 and #6759 both
 * rejected. `spellGanttDateValue` was already written to spell `null` as
 * itself, for "one they wrote as empty"; until this card that branch could not
 * be reached.
 *
 * ## Where the line is: the RULED TYPE RULE (objectui#6781)
 *
 * #6770 drew this line at `value === null` and deliberately nothing wider,
 * because it had measured only that one spelling. objectui#6781 measured the
 * rest of the type space and the maintainer ruled the line to be a TYPE rule
 * instead — see `isGanttDateType` below, which is now the whole of "is this a
 * date at all". `null` is no longer named on its own; it is refused by that
 * rule, through this same function, with the same path and the same spelling
 * (measured — see the table on `isGanttDateType`).
 *
 * `0` stays ACCEPTED under that rule, which is the part worth reading twice.
 * `0` coerces to the epoch just like `null` did (measured: the same 649-column
 * axis) — but `0` is a legitimate epoch timestamp, indistinguishable from an
 * author who means 1970-01-01, and `startDate: 1704067200000` renders 2024
 * correctly today. `null` is not a timestamp at all; it is what a data source
 * hands you for a field that is unset. The type rule keeps exactly that
 * distinction and widens nothing around it.
 */
/**
 * THE RULED TYPE RULE for a gantt date — objectui#6781, maintainer ruling
 * 2026-08-30 (option A of that card's three).
 *
 * ## The accept set, stated as an accept set
 *
 *     string  |  FINITE number  |  Date
 *
 * and nothing else. This is a RULE, not a list of values someone tripped over:
 * every input class is judged by the same question — "is this the kind of thing
 * a date can be written as?" — and the answer does not depend on which
 * coercion `new Date` happens to perform on it. The three cards before this one
 * each added one more refused VALUE (`undefined` #6759, `null` #6770); this one
 * replaces that accretion with the rule they were each approximating, so the
 * next exotic value does not need a fourth card.
 *
 * ## Why a type rule rather than more values
 *
 * `new Date(x)` accepts far more than dates. It runs ToPrimitive on anything,
 * so a boolean, an array, or any object with a plausible `toString` becomes an
 * instant, silently. Measured on this card's base fab4802e3, one row item and a
 * throwaway probe (`endDate` set, `startDate: '2024-01-01'`):
 *
 *     endDate: false            -> NO diagnostic, axis 649 columns
 *                                  (Jan 1970 … Jan 2024), bars ["left: 100%;
 *                                  width: -100%;"]
 *     endDate: true             -> NO diagnostic, axis 649 columns, bars
 *                                  ["left: 100%; width: -99.99999999994131%;"]
 *     endDate: ['2024-01-01']   -> NO diagnostic, axis ["Jan 2024"], bars
 *                                  ["left: 0%; width: 100%;"]
 *     endDate: [0]              -> NO diagnostic (ToPrimitive gives "0", which
 *                                  parses as the year 2000)
 *     endDate: {toString: () => '2024-01-01'}
 *                               -> NO diagnostic, axis ["Jan 2024"]
 *
 * The first is the filed shape of this defect and is byte-identical to the
 * `endDate: 0` reading the card was filed on: a fifty-four-year axis and a
 * NEGATIVE-width bar, with no diagnostic. `false` is where a wrong value hides:
 * a boolean reaching a date field means a mapping layer emitted the wrong
 * column, and drawing a 1970 axis from it is the silent-wrong-render this
 * chart's three previous cards each closed one spelling of.
 *
 * ## Why `0` is KEPT (the ruling is explicit, and it is the load-bearing half)
 *
 * `0` is a finite number, so it is ACCEPTED and still draws 1970-01-01. That is
 * ruled, not incidental: `0` is a legitimate epoch timestamp, and under a
 * `startDate: 1704067200000` encoding an author who writes `0` means the epoch.
 * Refusing it would take away a real capability to catch a hypothetical input.
 * Measured for this card: the repo has ZERO sites feeding an integer `0` into a
 * gantt date (control: 222 gantt-date assignment sites repo-wide), so the
 * capability is preserved on the encoding's terms rather than on a consumer's —
 * which is why the pin for it is a TEST and not a call site.
 *
 * ## Why FINITE, when `new Date` already refuses `NaN` and `Infinity`
 *
 * It moves nothing measured: `new Date(NaN)` and `new Date(Infinity)` are both
 * invalid dates, so the parse check below already refused them and still would.
 * The clause is here so the accept set can be READ as the rule it is — "a
 * number that is an instant" — instead of leaving the exclusion to a coercion
 * detail that a later reader would have to rediscover. Same verdict, stated
 * rather than inherited.
 *
 * ## `null` and `undefined` are SUBSUMED, and their diagnostics do not move
 *
 * Neither is a string, a finite number, or a `Date`, so both are refused here
 * — #6759's `undefined` and #6770's `null` alike — and neither is named
 * separately any more. This is strictly wider than `value === null` and it
 * changes nothing an author sees: the path is the same, and
 * `spellGanttDateValue` still spells them as themselves. The reasoning that put
 * them here is preserved in this function's header, which is where a reader
 * asking "why is an absent date refused?" goes.
 *
 * ## The order is load-bearing: this gate runs BEFORE `new Date`
 *
 * `new Date(x)` does not merely refuse a `bigint` or a `symbol` — it THROWS
 * `TypeError: Cannot convert a BigInt value to a number`. Measured on the same
 * base, both crashed the render from inside the guard itself:
 *
 *     endDate: 0n         -> THREW TypeError (uncaught, mid-render)
 *     endDate: Symbol('s') -> THREW TypeError (uncaught, mid-render)
 *
 * A guard that crashes while reporting an author error replaces a named
 * diagnostic with a blank screen — the exact failure mode `spellGanttDateValue`
 * calls out one docblock up, and the reason its `symbol` branch was written
 * "total by construction". Refusing by TYPE first makes this predicate total:
 * `new Date` is only ever reached with a string, a finite number, or a `Date`,
 * none of which throw. Those two classes now take the ordinary refusal path,
 * and that `symbol` branch is reachable at last.
 *
 * ⚠️ ...with ONE gap, closed by objectui#7027 and worth reading as the reason
 * this docblock now points at `isDate`. The paragraph above is a claim about
 * `new Date`'s ARGUMENT, and it was only as good as the predicate that
 * produced it. `instanceof Date` answers "does this inherit from
 * `Date.prototype`?", not "is this a `Date`?", so it admitted
 * `Object.create(Date.prototype)` — which is not a `Date`, reached `new Date`,
 * and threw. Measured on 7fc5c3c12; the reading and the two other impostor
 * spellings are on `isDate` above and pinned in
 * `timeline-gantt-date-brand-7027.test.tsx`.
 *
 * ⛔ That is the fourth totality claim in this code path and the third to be
 * falsified by the next card's measurement (#6759 -> `85f6a6097` -> `7fc5c3c12` -> this).
 * The pattern is the lesson: totality asserted in prose is a hypothesis, and
 * the only thing that has ever settled it here is an exercised input set. Do
 * not answer a future gap with a fifth sentence — add the row to that file.
 *
 * The ACCEPT SET is untouched by #7027. `isDate` is strictly narrower than
 * `instanceof Date` over values that reach it, and everything it newly refuses
 * is a value no authored document can carry (ObjectUI metadata is JSON; JSON
 * has no way to spell a prototype). An invalid `Date` object owns its slot, so
 * it still passes this gate and is still refused by the parse check below,
 * where it belongs, with its `Invalid Date` spelling intact.
 */
const isGanttDateType = (value: unknown): value is string | number | Date =>
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  isDate(value);

/**
 * WHAT THE ROW WALK BELOW READS, AND WHERE THAT READING IS NOT TOTAL —
 * objectui#7153, the enumeration `869b876c8`'s docblock pointed at.
 *
 * ## Read this as a BOUNDED READING, not as a totality claim
 *
 * Five cards before this one made a totality claim about this code path
 * (#6759 -> `85f6a6097` -> `7fc5c3c12` -> #7027 -> `869b876c8`) and FOUR were falsified by the
 * next card's measurement. #7153 is the fourth falsification: it measured that
 * `spellGanttDateValue`'s `Array.isArray` is not "the last non-total operation
 * on the gantt date path", only the last one inside that function.
 *
 * So this block does not say the walk is total, and it does not say the list
 * below is complete. It says: these are the operations that were DRIVEN, in
 * render, through `TimelineRenderer` on `51449a043`, and this is what each one
 * did. Everything outside that input set is unmeasured, which is a third thing
 * and not a quiet green.
 *
 * ## THE SITES, each with the input that drove it and the frame it threw from
 *
 * `?.` guards `null` and `undefined`. It does not guard a getter that throws
 * or a revoked `Proxy`: those crash INSIDE the read, before any value exists
 * to judge, so the type gate above never sees them.
 *
 *     U1  items.length                 818  items is a revoked Proxy;
 *                                           items has a throwing length trap
 *     U2  items[rowIndex]              819  items has a throwing index trap
 *     U3  items[rowIndex]?.items       819  the ROW is a revoked Proxy;
 *                                           the row has a throwing items getter
 *     U4  rowItems.length              820  row.items is a revoked Proxy;
 *                                           row.items has a throwing length trap
 *     U5  rowItems[itemIndex]          822  row.items has a throwing index trap
 *     U6  rowItems[itemIndex]?.[key]   822  the ITEM is a revoked Proxy;
 *                                           the item has a throwing date getter
 *
 * SIX here, and THREE more in `calculateDateRange` (see that function). NINE
 * measured, where #7153's card said five and `869b876c8`'s docblock repeated it. The
 * count was never the point, but it is the evidence that prose counting on
 * this path is a hypothesis: both numbers were written after a real
 * measurement, and both were short.
 *
 * ⚠️ objectui#7164 MOVED U1–U3 out of this function: `items.length`,
 * `items[rowIndex]` and `row.items` are now read ONCE, in `classifyGanttRows`,
 * and this walk iterates the `GanttRow[]` that function built. The trap
 * messages pinned for U1–U3 are unchanged (the trap writes them), U4–U6 still
 * fire here on the authored `row.items` array, and `Array.isArray` in
 * `classifyGanttRows` is a NEW site where a revoked proxy dies (`IsArray`
 * rather than `get`) — see that function, and the re-attributed rows in pin 5.
 * The three in `calculateDateRange` are REPAIRED, not moved: see class 2 below.
 *
 * A tenth read — `item.startDate` / `item.endDate` inside
 * `calculateDateRange`'s inner `flatMap` — is bare and would throw on a `null`
 * item, but it is SHADOWED here: U6's `?.` turns a `null` item into
 * `undefined`, which the type gate refuses, so the render never reaches it.
 * That shadow is an accident of two functions written apart, not a guard, and
 * it is recorded as NOT MEASURED: no input was found that reaches it.
 *
 * ## TWO REACHABILITY CLASSES, and they must not be merged
 *
 * 1. THE SIX ABOVE — unreachable from an authored document. ObjectUI metadata
 *    is JSON and JSON spells neither a getter nor a proxy. Re-swept on
 *    `51449a043` with the comment-stripped instrument, each zero beside a live
 *    control on that same instrument: across every package `src/` excluding
 *    tests, `Proxy.revocable` 0, `new Proxy` 0, the bare word `Proxy` 0, and
 *    `Object.setPrototypeOf` 0 — against `Object.assign` 19 and `JSON.parse`
 *    105. Widened to the whole repo the SAME query returns `Proxy.revocable`
 *    1, `new Proxy` 21 and `Proxy` 105 (all in tests, one of them this file's
 *    own factory), which is what makes the narrow zeros readings rather than a
 *    broken query.
 *
 * 2. `calculateDateRange`'s THREE — ordinary JSON, and a live defect until
 *    objectui#7164 REPAIRED it: `classifyGanttRows` now refuses `items` that is
 *    not an array, a non-object row and a truthy non-array `row.items` through
 *    `timeline.gantt.unusableRange.malformedRow`, and every reader below it
 *    consumes that verdict. They were never this class and never p3, and the
 *    repair does not change that: the sentence "JSON cannot spell this" is
 *    true of the six and was false of the three, and collapsing the two is how
 *    this docblock would start overclaiming again.
 *
 * ## WHY A `catch` IS NOT PUT HERE — re-tested, not inherited from `869b876c8`
 *
 * `869b876c8` refused a `catch` at the speller because it would SUBSTITUTE `an
 * object` for a failure rather than read anything, the opposite of `isDate`'s
 * `catch` (which IS the read, because the language exposes `[[DateValue]]`
 * only by throwing). #7153's dispatch required that argument to be re-tested
 * upstream rather than assumed, because upstream is not the same shape. It was
 * tested, by ablation, and it comes out DIFFERENTLY — in half:
 *
 * A `try` around U6 alone, reporting the path built from the loop counters,
 * was measured in-render. The PATH half is a genuine READ: the throwing-getter
 * input came back NAMED as `items[0].items[0].endDate`, exact, including the
 * key whose getter threw — because the path is built from `rowIndex`,
 * `itemIndex` and `key` and never touches the value. The speller's `catch` has
 * no such thing; it holds only the value it cannot read.
 *
 * The VALUE half is still substitution. The measured diagnostic read `...
 * endDate is "UNREADABLE", which is not a valid date` — a placeholder standing
 * in the `{value}` hole of `timeline.gantt.unusableRange.malformedDate`. There
 * is no true spelling for a value that cannot be touched, so a real repair
 * needs a value-less diagnostic, which is a new i18n key across ten locale
 * packs: the file surface the card behind `869b876c8` deferred as a separate decision.
 *
 * And the coverage is the same shape of error the triage of the card behind `869b876c8` caught. That
 * `catch` converted THREE of the nine measured sites (U5, U6, and the
 * throwing-getter item) and left the other six throwing — U1 through U4 are
 * upstream of it, and `calculateDateRange`'s three are downstream. The PASSING
 * control held either way: an ordinary row drew 1 bar over a 3-cell axis
 * before and after. One `catch` here would buy 3 of 9 while a docblock went on
 * implying the walk was safe, which is exactly the "1 of 6" trade the card behind
 * `869b876c8` was stopped from making.
 *
 * ## So this is STATED AND EXERCISED, on `869b876c8`'s terms
 *
 * The rows are in `./__tests__/timeline-gantt-date-brand-7027.test.tsx`, pin
 * 5, asserting each throw's own MESSAGE so the pin fails if a site MOVES as
 * well as if it is repaired — a bare `toThrow()` would stay green through
 * exactly the relocation this path has performed four times.
 */
function findUnusableGanttDate(
  rows: readonly GanttRow[],
  pinnedMinDate: unknown,
  pinnedMaxDate: unknown,
): UnusableGanttDate | undefined {
  /**
   * Two ways a gantt date is unusable, in this order and only this order.
   *
   * 1. It is not one of the three things a date can be written as — the ruled
   *    TYPE rule, objectui#6781, spelled out on `isGanttDateType` above. This
   *    subsumes #6770's `null` and #6759's `undefined`, and it is what refuses
   *    `false` / `true` / an array / an object with a `toString`, all of which
   *    `new Date` would otherwise coerce into a silent 1970 axis.
   * 2. It is the right TYPE but does not parse — #6759's original question,
   *    still asked, and still the only thing that separates `'2024-01-01'` from
   *    `'not-a-date'` or a valid `Date` from `new Date(NaN)`. It is asked of
   *    `readGanttDate`, the read every later stop makes, so a day its month
   *    does not have (`'2026-02-30'`) is refused here too (objectui#10866,
   *    slice 3): the shared step refuses it, where the engine rolled it into
   *    March and drew the bar there.
   *
   * The type gate must come first: `new Date` THROWS on a `bigint` or a
   * `symbol`, so asking "does it parse?" of an unjudged value crashes the guard
   * (measured — see `isGanttDateType`).
   */
  const isUnusable = (value: unknown) =>
    !isGanttDateType(value) || Number.isNaN(readGanttDate(value).getTime());

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    // `rows` is the normalized array `classifyGanttRows` built, so this loop
    // condition and index no longer touch the authored `items` (U1 / U2 moved
    // there). `rowItems` IS the authored `row.items` array, by reference —
    // U4 through U6 below still read it, exactly as objectui#7153 measured.
    const rowItems = rows[rowIndex].items;
    for (let itemIndex = 0; itemIndex < rowItems.length; itemIndex++) {
      for (const key of ['startDate', 'endDate'] as const) {
        const value = rowItems[itemIndex]?.[key];
        if (isUnusable(value)) {
          return { path: `items[${rowIndex}].items[${itemIndex}].${key}`, value };
        }
      }
    }
  }

  for (const [path, value] of [
    ['minDate', pinnedMinDate],
    ['maxDate', pinnedMaxDate],
  ] as const) {
    if (value && isUnusable(value)) return { path, value };
  }

  return undefined;
}

/**
 * A bar's position and width, as percentages of the gantt's one axis
 * (`timelineAxis`), placed by `placeOnAxis`, the call that sizes the header
 * columns above it (objectui#11079).
 *
 * Both ends are read by `readGanttDate` (objectui#10866, slice 3), the read
 * the axis makes: a date-only day is local midnight of that day, so a bar
 * starting on October 6th begins where the "Oct 6" header begins in every
 * zone, and an instant keeps its instant, so it sits at its local hour in the
 * viewer's day. Across a DST change the day's column is 23 or 25 hours wide,
 * as the day is, so a bar's edge stays on its column's edge.
 *
 * The end then takes `readGanttBarEnd` (objectui#11112): a date-only end is
 * drawn through the end of its day, so a bar ending on January 31st ends where
 * the February header begins. An instant end is where the bar ends.
 *
 * ## objectui#6750's degenerate axis is gone, not guarded
 *
 * This used to measure bars on the span from the minimum date to the maximum
 * date, which is zero wide whenever every task starts and ends on the same
 * day, or an author pins `minDate === maxDate`. Both divisions were then
 * `0 / 0`, the CSSOM rejected `left: NaN%; width: NaN%`, and the bar rendered
 * with no `style` attribute at all (measured on b76ca6764), so a
 * `totalDuration === 0` guard drew such a bar as `{ start: 0, width: 100 }`.
 * The axis now always spans at least the one unit that contains its dates, so
 * the span is never zero and that guard had nothing left to catch. A
 * same-day task is measured like every other bar: its date-only end runs
 * through that day, so it is one day wide (objectui#11112). A zero-length
 * task, an instant end equal to its start, is a zero-width bar at its start.
 */
function calculateBarDimensions(
  startDate: string,
  endDate: string,
  axis: TimelineAxis,
): { start: number; width: number } {
  return placeOnAxis(axis, readGanttDate(startDate).getTime(), readGanttBarEnd(endDate).getTime());
}

/**
 * Format one item date for display.
 *
 * `locale` is a REQUIRED parameter, not an optional one (#4513): this helper is
 * module-private, every call site sits inside `TimelineRenderer`, and the two
 * ways it used to get a locale were both wrong in the same session. `'short'`
 * passed nothing at all — and no tag means the MACHINE's locale, which has
 * nothing to do with the user — while `'long'` passed a literal `'en-US'`. A
 * required parameter is what keeps a future branch from quietly reintroducing
 * either. `'iso'` is a machine format by definition and stays locale-free.
 *
 * The value is read through the shared step, `toDisplayDate`
 * (`@object-ui/core`, objectui#10866), as `ObjectTimeline`'s bucket and sort
 * read it. The engine's own parse read a date-only `2026-10-06` as UTC
 * midnight, so the `short` and `long` faces printed October 5th west of UTC.
 * The shared step tells the two shapes apart by the value: a date-only string
 * is local midnight of the day it names, and a value with a time part keeps
 * its instant. So the ISO face prints a date-only value from LOCAL getters
 * (its `toISOString()` would name the day before east of UTC), and keeps an
 * instant's UTC day. A value the shared step refuses (unparsable, or a day
 * its month does not have, objectui#10026) prints as written on the ISO face,
 * where `toISOString()` would throw.
 */
function formatDate(dateString: string, format: string | undefined, locale: string): string {
  const date = toDisplayDate(dateString);
  if (format === 'short') {
    return date.toLocaleDateString(locale);
  }
  if (format === 'long') {
    return date.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  if (Number.isNaN(date.getTime())) return String(dateString);
  if (isRealCalendarDate(dateString)) return toDateInputValue(date);
  return date.toISOString().split('T')[0];
}

/**
 * Render an inline option chip for the per-item metadata strip
 * (status, priority, …). Uses the option color when supplied so the
 * chip visually echoes the marker, falling back to a neutral pill
 * when the option has no color metadata.
 */
function MetaChip({ label, color }: { label: string; color?: string }) {
  const style = color
    ? { backgroundColor: `${color}22`, color, borderColor: `${color}55` }
    : undefined;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        !color && 'bg-muted text-muted-foreground border-transparent'
      )}
      style={style}
    >
      {label}
    </span>
  );
}

/**
 * Bucket items by their `group` key into one section per key, so the renderer
 * can drop a sticky header above each bucket (objectui#12104).
 *
 * Sections come in the order of each key's FIRST item, and items keep their
 * input order inside a section. `ObjectTimeline` hands items over sorted by
 * start date, so a group sits where its earliest entry falls and its entries
 * stay in date order.
 *
 * This used to merge only ADJACENT items with equal keys. That is the same
 * answer for the date buckets, which are contiguous in date order by
 * construction, and the wrong one for an explicit `groupByField` whose values
 * interleave in date order: every change of key opened a new section, so one
 * key drew many headers. Bucketing lives here and not in the composer because
 * the horizontal branch below draws the same item array, draws no groups, and
 * keeps its date order.
 */
function bucketByGroup<T extends { group?: string | null }>(items: T[]): Array<{ key: string; items: T[] }> {
  const out: Array<{ key: string; items: T[] }> = [];
  const byKey = new Map<string, { key: string; items: T[] }>();
  for (const it of items) {
    const key = it.group == null ? '' : String(it.group);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.items.push(it);
    } else {
      const fresh = { key, items: [it] };
      byKey.set(key, fresh);
      out.push(fresh);
    }
  }
  return out;
}

/**
 * `schema` is the renderer-internal handoff shape (`./renderHandoff`), not the
 * authored `TimelineSchema`: every authored timeline is one, and so is the
 * composed schema `ObjectTimeline` hands down, whose feed items carry the keys
 * objectui#6356 ruled renderer-internal (`color`, `group`, `meta`,
 * `startDate`, `endDate`, `_data`).
 *
 * ## The root's DOM channels (objectui#10841)
 *
 * Registered as `plugin-timeline:timeline`, this renderer is created by
 * `SchemaRenderer`, which hands it, as React props, every node key its
 * metadata strip leaves (`items`, `variant`, `dateFormat`, `scale`,
 * `rowLabel`, `minDate`, `maxDate`, and so on) beside the attributes it mints
 * for the DOM. The renderer reads the authored keys off `schema`, never off its
 * props. Spread onto the root of every variant, that props copy serialized the
 * schema into the DOM (`items="[object Object]"`, `variant="vertical"`,
 * `dateformat="long"`) and set off React's unknown-prop warnings.
 *
 * The root now takes the converged route, the `container.tsx` /
 * `header-bar.tsx` shape: `toDomProps(hostProps)` plus `style` by name.
 * `toDomProps` executes the SDUI widget contract's DOM pass-through from
 * `@object-ui/core` (`utils/dom-props.ts`, objectui#4425 phase 2), and that file
 * owns the set and the reason for each member. It is what carries the
 * `data-obj-id` / `data-obj-type` locator, the `data-testid` an authored
 * `testId` promises (objectui#8268) and the resolved `aria-*` / `role`.
 * `style` is the `BaseSchema` member an author writes for the DOM, forwarded
 * by name as the converged renderers do. ⛔ No local list: a renderer-private
 * allowlist is a second judge of the same contract, and it drifts from it.
 *
 * What the contract drops that used to land here:
 *
 * - every authored schema key;
 * - `disabled`, the verdict `SchemaRenderer` forwards on a disabled node (the
 *   rail has no disabled state to apply it to);
 * - `name` / `label`, declared `BaseSchema` members with no effect on an
 *   `ol` / `div`;
 * - an authored `title`, which neither `BaseSchema` nor `TimelineSchema`
 *   declares. It is a global HTML attribute, so it used to give the root a
 *   native tooltip.
 *
 * `ObjectTimeline`, the other caller, passes `schema` alone.
 */
export const TimelineRenderer = ({ schema, className, style, ...hostProps }: { schema: TimelineRenderSchema; className?: string; [key: string]: any }) => {
    const {
      variant = 'vertical',
      items = [],
      dateFormat = 'short',
      onItemClick,
    } = schema;

    // The one locale channel every renderer in this repo resolves through:
    // tenant regional default → active UI language → 'en' (#4513, the channel
    // #4468 / PR #4512 converged `@object-ui/fields` onto). Read once here,
    // above every variant's early return so the hook count can never depend on
    // `variant`, and threaded down — `formatDate` and `timelineAxis` are
    // module-level functions and cannot host a hook themselves.
    const displayLocale = useDisplayLocale();

    // The package's translate channel, read on the same terms and for the same
    // structural reason as the locale above: one read, above every variant's
    // early return, threaded down into the module-level helpers that cannot
    // host a hook (#4520).
    //
    // It is a SECOND channel, not a duplicate of the first, and the two are
    // allowed to disagree: `useDisplayLocale()` puts the tenant's regional
    // default first (how this org writes dates), while `t` follows the UI
    // language (what this user reads). A tenant configured `en` with a user
    // reading Chinese chrome therefore renders `Aug 2026` beside `第 1 周` —
    // the same split `timeline.bucket.*` has always had in `ObjectTimeline`.
    const { t } = useTimelineTranslation();

    // Vertical Timeline
    if (variant === 'vertical') {
      // Detect whether the data was annotated with a `group` key
      // (ObjectTimeline does this for both explicit groupBy and the
      // automatic date bucketing fallback). When present we render
      // sticky bucket headers; when absent we keep the historical flat
      // list so JSON-defined timelines aren't visually disturbed.
      const groups = bucketByGroup(items as Array<any>);
      const hasGroups = groups.some((g) => g.key !== '');

      const renderItem = (item: any, key: React.Key) => {
        // Custom CSS color from objectDef option metadata overrides the
        // CVA variant — that lets the marker reflect the live status
        // colour (e.g. amber for "in progress") without us hard-coding
        // every status into the variants enum.
        const markerStyle = item.color
          ? { backgroundColor: `${item.color}33`, borderColor: item.color }
          : undefined;
        const dateLabel = item.time
          ? formatDate(item.time, dateFormat, displayLocale)
          : (item.startDate ? formatDate(item.startDate, dateFormat, displayLocale) : '');
        const endLabel = item.endDate && item.endDate !== item.startDate
          ? formatDate(item.endDate, dateFormat, displayLocale)
          : '';
        const meta = Array.isArray(item.meta) ? item.meta : [];
        return (
          <TimelineItem
            key={key}
            density="compact"
            className={cn(item.className, onItemClick && 'cursor-pointer')}
            onClick={() => onItemClick?.(item)}
          >
            <TimelineMarker
              variant={item.color ? 'default' : (item.variant || 'default')}
              style={markerStyle}
            >
              {item.icon && <span className="text-xs">{item.icon}</span>}
            </TimelineMarker>
            <TimelineContent>
              {(dateLabel || endLabel) && (
                <TimelineTime
                  dateTime={item.time || item.startDate}
                  className="!mb-1 text-xs"
                >
                  {dateLabel}
                  {endLabel && <span className="text-muted-foreground/70"> → {endLabel}</span>}
                </TimelineTime>
              )}
              {item.title && <TimelineTitle className="text-sm sm:text-base mb-1">{item.title}</TimelineTitle>}
              {meta.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1 mb-1">
                  {meta.map((m: any) => (
                    <MetaChip key={m.key} label={m.label} color={m.color} />
                  ))}
                </div>
              )}
              {item.description && (
                <TimelineDescription className="text-sm text-muted-foreground line-clamp-2 sm:line-clamp-none">
                  {item.description}
                </TimelineDescription>
              )}
              {/* ⛔ No `&&` guard on a node slot (objectui#9162): `&&`
                  evaluates to the slot, so a legal authored `content: 0`
                  painted the character and `renderChildren`'s own falsy leg
                  never ran. `renderChildren` IS the guard. */}
              {renderChildren(item.content)}
            </TimelineContent>
          </TimelineItem>
        );
      };

      if (!hasGroups) {
        return (
          <Timeline {...toDomProps(hostProps)} className={className} style={style}>
            {(items as Array<any>).map((item, index) => renderItem(item, index))}
          </Timeline>
        );
      }

      return (
        <div {...toDomProps(hostProps)} className={cn('px-4 sm:px-6 py-2', className)} style={style}>
          {groups.map((g, gi) => (
            <section key={`${g.key}-${gi}`} className="mb-4">
              <header className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 py-1.5 backdrop-blur bg-background/90 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b">
                <span>{g.key}</span>
                <span className="ml-2 text-muted-foreground/60 font-normal normal-case">
                  {g.items.length}
                </span>
              </header>
              <Timeline className="mt-3">
                {g.items.map((item, index) => renderItem(item, `${gi}-${index}`))}
              </Timeline>
            </section>
          ))}
        </div>
      );
    }

    // Horizontal Timeline
    if (variant === 'horizontal') {
      return (
        <TimelineHorizontal {...toDomProps(hostProps)} className={cn("overflow-x-auto [-webkit-overflow-scrolling:touch]", className)} style={style}>
          {items.map((item: any, index: number) => (
            <TimelineHorizontalItem key={index} className={cn(item.className, onItemClick && 'cursor-pointer')} onClick={() => onItemClick?.(item)}>
              <div className="flex flex-col items-center">
                <TimelineMarker variant={item.variant || 'default'}>
                  {item.icon && <span className="text-xs">{item.icon}</span>}
                </TimelineMarker>
                <div className="mt-4 text-center">
                  {item.time && (
                    <TimelineTime dateTime={item.time}>
                      {formatDate(item.time, dateFormat, displayLocale)}
                    </TimelineTime>
                  )}
                  {item.title && <TimelineTitle>{item.title}</TimelineTitle>}
                  {item.description && (
                    <TimelineDescription className="text-center line-clamp-2 sm:line-clamp-none">
                      {item.description}
                    </TimelineDescription>
                  )}
                  {/* ⛔ No `&&` guard on a node slot — see the vertical
                      variant above (objectui#9162). */}
                  {renderChildren(item.content)}
                </div>
              </div>
              {index < items.length - 1 && (
                <div className="absolute left-full w-16 border-t-2 border-gray-200 top-3" />
              )}
            </TimelineHorizontalItem>
          ))}
        </TimelineHorizontal>
      );
    }

    // Gantt/Airtable-style Timeline
    if (variant === 'gantt') {
      /**
       * objectui#7164 — the rows are judged as ROWS, once, before anything
       * reads them. `items` not an array, a non-object row (objectui#7364), or
       * a row whose `items` is a truthy non-array refuses the chart through its
       * own key, naming the authored path and the value; see
       * `classifyGanttRows` for the table, the accept set and why a guard in
       * one reader only relocated the crash.
       * The refusal surface is the one #6759 established below (same element,
       * same channel) — one `role="alert"` for every way a gantt cannot draw.
       */
      const verdict = classifyGanttRows(items);
      if (!verdict.ok) {
        return (
          <div className="p-4 text-destructive" data-testid="timeline-unusable-date-range" role="alert">
            {t('timeline.gantt.unusableRange.malformedRow', {
              path: verdict.path,
              value: spellGanttDateValue(verdict.value),
            })}
          </div>
        );
      }
      const rows = verdict.rows;

      /**
       * objectui#6759 — an UNUSABLE date range refuses loudly, naming the value
       * that made it unusable.
       *
       * ## The policy, and why it is not a new adjudication
       *
       * Two defects arrived together because a fixer has to decide ONE policy
       * for both, and they failed in OPPOSITE directions, which is itself the
       * evidence that no policy existed yet: a malformed date crashed the
       * render (`RangeError: Invalid time value`), while an inverted
       * author-pinned range drew a bar at `left: 157.9%; width: -4.3%` under a
       * header row with zero cells and said nothing. The 2026-08-29 triage
       * ruled both are ordinary defects rather than policy questions, and that
       * the WORDING — the only genuinely open question — already has a
       * precedent one file away: objectui#6655 refuses the object-bound gantt
       * with a `role="alert"` diagnostic. So this is that neighbour's shape,
       * copied rather than invented.
       *
       * ## Why HERE — above everything except the row verdict
       *
       * Placed after `classifyGanttRows` (objectui#7164: a row has to BE a row
       * before its dates can be asked to parse, and `rows` is the only shape
       * this scan reads), before `calculateDateRange` and before the axis
       * (`timelineAxis`), and it establishes an invariant for both: every date
       * reaching them parses. The axis refuses an unparseable or inverted range
       * by building NO axis — the zero-column axis case 2 rendered under — and
       * that refusal is pinned by objectui#6750 as "a different input class,
       * left exactly as it was". After this scan only an inverted range can
       * reach it, and the branch refuses that one by name below. Downstream,
       * `calculateBarDimensions` therefore only ever measures on a real axis,
       * which spans at least one whole unit (objectui#11079).
       *
       * ## What this deliberately does NOT do
       *
       * It does not widen #6750's `emptyGanttDateRange` sentinel to absorb
       * these. The card and its triage both rejected that path for the same
       * reason: substituting a plausible range for a value the author got wrong
       * is consumer-side tolerance, and hiding an author error behind a
       * believable render is precisely case 2's disease. An EMPTY list stays an
       * ordinary state with a sentinel; an UNPARSEABLE value is refused.
       */
      const unusableDate = findUnusableGanttDate(rows, schema.minDate, schema.maxDate);
      if (unusableDate) {
        return (
          <div className="p-4 text-destructive" data-testid="timeline-unusable-date-range" role="alert">
            {t('timeline.gantt.unusableRange.malformedDate', {
              path: unusableDate.path,
              value: spellGanttDateValue(unusableDate.value),
            })}
          </div>
        );
      }

      // Calculate date range from all items
      const dateRange = calculateDateRange(rows);
      const minDate = schema.minDate || dateRange.minDate;
      const maxDate = schema.maxDate || dateRange.maxDate;

      // The one axis the header row and the bars are both drawn on
      // (objectui#11079). The spec `scale` key is the only axis spelling (the
      // `timeScale` alias is retired, objectui#6355); every spec scale
      // produces a header row (#2942). A computed end runs on to the last
      // instant the bars cover; a pinned `maxDate` is the author's range
      // exactly (objectui#11112, `timelineAxis`).
      const axis = timelineAxis(
        resolveTimelineScale(schema as { scale?: unknown }),
        minDate,
        maxDate,
        displayLocale,
        t,
        schema.maxDate ? undefined : dateRange.through,
      );

      /**
       * objectui#6759 case 2 — the INVERTED range, refused on the same policy.
       *
       * Only a pin can invert it: `calculateDateRange` builds its pair with
       * `Math.min` / `Math.max`, so the computed range is ordered by
       * construction, and the sentinel is a single day. It is the caller's
       * `schema.minDate || dateRange.minDate` resolution — one pinned end, or
       * both — that can put the start after the end.
       *
       * The test is the axis's own: `timelineAxis` builds no axis when the
       * start is after the end, compared as timestamps. It used to be a second
       * `>` here that deliberately made the same comparison; now it is the same
       * read, so the guard and the axis cannot disagree (objectui#11079). Equal
       * is NOT inverted: a degenerate `minDate === maxDate` range is
       * objectui#6750's one-bucket axis and must keep rendering. An unparseable
       * end also builds no axis, but `findUnusableGanttDate` above has already
       * refused every one by name, so what reaches this refusal is inverted.
       * Measured on this card's base b98352a15:
       *
       *     CASE-2 minDate 2030-01-01 / maxDate 2026-03-15
       *            -> axis: [] bars: ["left: 157.9250720461095%; width: -4.322766570605188%;"]
       *
       * Both ends are read by `readGanttDate` (objectui#10866, slice 3): a
       * pinned date-only start and a pinned instant end can be in order east
       * of UTC and inverted west of it, and the one read decides which.
       */
      if (!axis) {
        return (
          <div className="p-4 text-destructive" data-testid="timeline-unusable-date-range" role="alert">
            {t('timeline.gantt.unusableRange.inverted', {
              minDate: spellGanttDateValue(minDate),
              maxDate: spellGanttDateValue(maxDate),
            })}
          </div>
        );
      }

      return (
        <TimelineGantt {...toDomProps(hostProps)} className={cn("overflow-x-auto [-webkit-overflow-scrolling:touch]", className)} style={style}>
          {/* Header */}
          <TimelineGanttHeader>
            <TimelineGanttRowLabels className="flex items-center px-2 sm:px-4 py-2 sm:py-3">
              <span className="font-semibold text-xs sm:text-sm">
                {schema.rowLabel || t('timeline.gantt.rowLabel')}
              </span>
            </TimelineGanttRowLabels>
            <TimelineGanttGrid>
              <div className="flex h-full">
                {/* Each column is as wide as its unit's real length on the
                    axis, placed by the call that places the bars
                    (objectui#11079). A computed width cannot be a static
                    utility, so it is inline, as `TimelineGanttBar`'s
                    `left` / `width` are; `shrink-0 min-w-0 overflow-hidden`
                    keep a long label from widening its column off the bars. */}
                {axis.units.map((unit, index) => (
                  <div
                    key={index}
                    className="shrink-0 min-w-0 overflow-hidden px-1 sm:px-2 py-2 sm:py-3 border-r text-xs font-medium text-center"
                    style={{ width: `${placeOnAxis(axis, unit.start, unit.end).width}%` }}
                  >
                    {unit.label}
                  </div>
                ))}
              </div>
            </TimelineGanttGrid>
          </TimelineGanttHeader>

          {/* Rows */}
          <div>
            <div className="flex">
              <TimelineGanttRowLabels>
                {rows.map((row, rowIndex) => (
                  <TimelineGanttRow key={rowIndex}>
                    <TimelineGanttLabel title={row.label} className="truncate">
                      {row.label}
                    </TimelineGanttLabel>
                  </TimelineGanttRow>
                ))}
              </TimelineGanttRowLabels>
              <TimelineGanttGrid className="relative">
                {rows.map((row, rowIndex) => (
                  <TimelineGanttRow key={rowIndex} className="relative">
                    {row.items.map((item: any, itemIndex: number) => {
                      const dimensions = calculateBarDimensions(item.startDate, item.endDate, axis);

                      return (
                        <TimelineGanttBar
                          key={itemIndex}
                          start={dimensions.start}
                          width={dimensions.width}
                          variant={item.variant || 'default'}
                          onClick={() => onItemClick?.(item, row.authored, rowIndex, itemIndex)}
                          title={`${item.title || ''}\n${formatDate(item.startDate, dateFormat, displayLocale)} - ${formatDate(item.endDate, dateFormat, displayLocale)}`}
                        >
                          <TimelineGanttBarContent>
                            {item.title}
                          </TimelineGanttBarContent>
                        </TimelineGanttBar>
                      );
                    })}
                  </TimelineGanttRow>
                ))}
              </TimelineGanttGrid>
            </div>
          </div>
        </TimelineGantt>
      );
    }

    return null;
  };

// `skipFallback` — the bare `timeline` key belongs to the OBJECT-BOUND renderer
// (`view:timeline`, registered in `./index`), not to this presentational one
// (objectui#6353).
//
// Both registrations name the same short key. Until this flag existed, both also
// claimed the bare fallback (`Registry.register`, the `meta?.namespace &&
// !meta?.skipFallback` branch), so which renderer answered `type: 'timeline'` was
// decided by which module evaluated LAST — `./index` re-exports this module at its
// line 300, before its own `import` at 307, so this file registered first and was
// then overwritten. The outcome was right and the mechanism was not: swapping those
// two lines would have silently handed `type: 'timeline'` to this renderer, which
// reads none of the object-bound keys, so an authored timeline would stop fetching
// with no error. The registry's own collision guard names this remedy in its warning.
//
// Now the answer is DECLARED: only `view:timeline` claims the bare key, in any
// evaluation order. `plugin-timeline:timeline` stays reachable by its explicit
// namespaced key, which is the lookup a presentational host uses.
// Pinned by `./__tests__/timeline-bare-key-ownership.test.ts`.
ComponentRegistry.register(
  'timeline',
  TimelineRenderer,
  {
    namespace: 'plugin-timeline',
    skipFallback: true,
    label: 'Timeline',
    category: 'data-display',
    inputs: [
      {
        name: 'variant',
        type: 'enum',
        enum: ['vertical', 'horizontal', 'gantt'],
      },
      {
        name: 'items',
        type: 'array',
        description:
          'For vertical/horizontal: Array of { time, title, description, variant, icon, content }. For gantt: Array of { label, items: [{ title, startDate, endDate, variant }] }',
      },
      {
        name: 'dateFormat',
        type: 'enum',
        enum: ['short', 'long', 'iso'],
      },
      // The designer's axis key is `scale` — the spec's spelling
      // (`ui/TimelineConfig.json`) and, since objectui#6355 retired the
      // `timeScale` alias, the only one `resolveTimelineScale` reads.
      // It offers all six buckets: `hour` / `quarter` / `year` have rendered
      // correctly since #2942 but were offered by neither the designer nor the
      // exported type, so they were authorable and undiscoverable (objectui#6170).
      {
        name: 'scale',
        type: 'enum',
        enum: [...TIMELINE_SCALES],
      },
      {
        name: 'rowLabel',
        type: 'string',
      },
      {
        name: 'minDate',
        type: 'string',
        description: 'Override auto-calculated min date (YYYY-MM-DD)',
      },
      {
        name: 'maxDate',
        type: 'string',
        description: 'Override auto-calculated max date (YYYY-MM-DD)',
      },
      { name: 'className', type: 'string' },
    ],
    defaultProps: {
      variant: 'vertical',
      dateFormat: 'short',
      items: [
        {
          time: '2024-01-15',
          title: 'Project Started',
          description: 'Kickoff meeting and initial planning',
          variant: 'success',
          icon: '🚀',
        },
        {
          time: '2024-02-01',
          title: 'First Milestone',
          description: 'Completed initial design phase',
          variant: 'info',
          icon: '🎨',
        },
        {
          time: '2024-03-15',
          title: 'Beta Release',
          description: 'Released beta version to testers',
          variant: 'warning',
          icon: '⚡',
        },
        {
          time: '2024-04-01',
          title: 'Launch',
          description: 'Official product launch',
          variant: 'success',
          icon: '🎉',
        },
      ],
    },
    examples: {
      vertical: {
        variant: 'vertical',
        dateFormat: 'long',
        items: [
          {
            time: '2024-01-15',
            title: 'Project Started',
            description: 'Kickoff meeting and initial planning',
            variant: 'success',
          },
          {
            time: '2024-02-01',
            title: 'First Milestone',
            description: 'Completed initial design phase',
            variant: 'info',
          },
        ],
      },
      horizontal: {
        variant: 'horizontal',
        dateFormat: 'short',
        items: [
          {
            time: '2024-01-01',
            title: 'Q1',
            description: 'First quarter',
            variant: 'default',
          },
          {
            time: '2024-04-01',
            title: 'Q2',
            description: 'Second quarter',
            variant: 'info',
          },
          {
            time: '2024-07-01',
            title: 'Q3',
            description: 'Third quarter',
            variant: 'warning',
          },
          {
            time: '2024-10-01',
            title: 'Q4',
            description: 'Fourth quarter',
            variant: 'success',
          },
        ],
      },
      gantt: {
        variant: 'gantt',
        dateFormat: 'short',
        scale: 'month',
        rowLabel: 'Projects',
        items: [
          {
            label: 'Backend Development',
            items: [
              {
                title: 'API Design',
                startDate: '2024-01-01',
                endDate: '2024-01-31',
                variant: 'success',
              },
              {
                title: 'Implementation',
                startDate: '2024-02-01',
                endDate: '2024-03-31',
                variant: 'info',
              },
            ],
          },
          {
            label: 'Frontend Development',
            items: [
              {
                title: 'UI Design',
                startDate: '2024-01-15',
                endDate: '2024-02-15',
                variant: 'warning',
              },
              {
                title: 'Component Dev',
                startDate: '2024-02-15',
                endDate: '2024-04-15',
                variant: 'default',
              },
            ],
          },
          {
            label: 'Testing',
            items: [
              {
                title: 'QA Phase',
                startDate: '2024-03-01',
                endDate: '2024-04-30',
                variant: 'danger',
              },
            ],
          },
        ],
      },
    },
  }
);
