/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

import * as React from "react"
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  PanelLeftClose,
  PanelLeft,
  Maximize2,
  Minimize2,
  Download,
  Activity,
  Wand2,
  Undo2,
  Redo2,
  FileDown,
  Save,
  Lock,
  RefreshCw,
  ArrowRight,
} from "lucide-react"
import {
  cn,
  Button,
  useResizeObserver,
} from "@object-ui/components"
import { toast } from "sonner"
import { isRealCalendarDate, toDateInputValue, toDisplayDate, toDisplayEndDate, toInclusiveEndDay } from "@object-ui/core"
import { useDisplayLocale } from "@object-ui/i18n"
import { computeCriticalPath, computeProjectRescheduleDetailed, wouldCreateDependencyCycle, type WorkingCalendar, type RescheduleChange, type RescheduleOptions } from "./scheduling"
import { shiftDayStart, type NormShiftSegments } from "./shifts"
import { makeTzShift } from "./tzShift"
import { useGanttTranslation } from "./useGanttTranslation"

// Width, in px, of the resize "grab zone" at each end of a task bar. The visible
// grip is only a few px, but pointer synthesis in headless browsers quantizes the
// click coordinate, so a click aimed at the edge routinely lands a pixel or two
// inside the bar body — starting a MOVE instead of a resize (unstable hit
// detection). Treating a full-height band at each end as a resize edge makes
// the hit deterministic.
const RESIZE_EDGE_PX = 8;

/**
 * Decide whether a pointerdown on a task bar should move it or resize an edge,
 * from the pointer's horizontal offset within the bar's client rect.
 *
 * Kept a pure module function so it can be unit-tested without a layout engine.
 * `rect.width <= 0` means the bar isn't laid out (jsdom, off-screen) — we can't
 * tell the edges apart, so fall back to 'move'. The edge band is clamped to a
 * third of the bar so a very short bar still keeps a grabbable middle and the
 * two edges never overlap into an ambiguous center.
 */
export function resolveBarDragMode(
  clientX: number,
  rect: { left: number; width: number },
): 'move' | 'resize-left' | 'resize-right' {
  if (rect.width <= 0) return 'move';
  const edge = Math.min(RESIZE_EDGE_PX, rect.width / 3);
  const offset = clientX - rect.left;
  if (offset <= edge) return 'resize-left';
  if (offset >= rect.width - edge) return 'resize-right';
  return 'move';
}

/**
 * Timeline column width, in px: the width of ONE unit of the active
 * granularity (a day in Day view, a week in Week view…).
 *
 * A flat FLOOR, not a container-derived curve. 110 is the user-specified
 * minimum at which a day/week/month caption stays readable, so it applies at
 * every container width — narrow embeds included. It is a floor rather than
 * the final width because `columnWidth` below resolves to
 * `columnWidthOverride ?? fitColumnWidth ?? BASE_COLUMN_W`, and the fit-stretch
 * yields a value only when that value is strictly greater: a short project
 * still fills a roomy timeline, and manual zoom can override either way.
 *
 * ⚠️ This was a container-width branch table once — 35/50/60, later bumped to
 * 44/64/80 — until objectui#1870 replaced the curve with the 110 floor "so
 * day/week/month stay readable". The three-arm `if` survived that change with
 * all three arms returning 110, so it went on reading as a live responsive
 * policy next to siblings that really do vary (objectui#7228). The arms are
 * gone; the floor every one of them returned is unchanged.
 */
const BASE_COLUMN_W = 110;

/**
 * Container-aware sizing helpers — replace the legacy viewport (`window.innerWidth`)
 * checks so the Gantt adapts to whatever slot it sits in (cards, sidebars, popups…).
 */
/**
 * Task-list geometry, in px. Every term below is traced to the markup that
 * spends it, so the Start/End threshold is DERIVED rather than estimated.
 */
/** Row and header horizontal padding: `px-2 sm:px-4` — 16px a side from 640px up. */
const TASK_LIST_ROW_PADDING_W = 32;
/** The two date cells: `w-16 gantt-sm-w20` — 80px each from 640px up. */
const START_END_COLUMNS_W = 160;
/** The trailing `→` open-details slot: `w-6` (24px) plus its 4px `marginLeft`. */
const OPEN_DETAILS_SLOT_W = 28;
/**
 * Fixed furniture inside the name cell, ahead of the title: the collapse
 * spacer (`w-3` 12px, pulled back 4px), the `w-2` colour dot, and the two
 * `gap-2` gaps → 8 + 8 + 8 + 8. (A summary row's `w-4` toggle costs 4 more.)
 */
const TITLE_FURNITURE_W = 32;
/**
 * Task-list pane floor — the narrowest a drag may leave the pane, and reused
 * below as the least title width worth keeping the Start/End columns for.
 */
const TASK_LIST_MIN_W = 160;

/**
 * Task-list default width, sized from the CONTAINER instead of capped at a
 * fixed 320px. Below 1024 the two stepped defaults are unchanged; from 1024 up
 * the pane takes a share of the container, clamped:
 *
 * - floor 320 — the previous fixed default, so nothing gets narrower;
 * - share 3/8 — 3/8 of 1440 is 540, which leaves the title 287px once the
 *   row's fixed cost is paid (`START_END_COLUMNS_MIN_W` minus its title term).
 *   A 40-character title measures 262px in the row's 14px `sm:text-sm` font
 *   (measured in Chromium), so the top of the 25-to-40 character band is
 *   legible at 1440 and wider WITH the Start/End columns still painted;
 * - ceiling 560 — leaves the title 307px, still clearing 262px after one level
 *   of the row's `depth * 14` indent. Past that, more pane width buys no
 *   legibility and the timeline — the view's primary content — pays for it.
 *   The ceiling binds from a 1494px container up.
 *
 * ⚠️ `depth * 14` is unbounded, so no single default keeps a DEEPLY nested row
 * legible; that is a known limit of this sizing, not something a threshold can
 * fix.
 */
const TASK_LIST_DEFAULT_SHARE = 0.375;
const TASK_LIST_DEFAULT_MIN_W = 320;
const TASK_LIST_DEFAULT_MAX_W = 560;

function taskListWidthForContainer(width: number) {
  if (width < 640) return 140;
  if (width < 1024) return 220;
  return Math.round(
    Math.min(
      TASK_LIST_DEFAULT_MAX_W,
      Math.max(TASK_LIST_DEFAULT_MIN_W, width * TASK_LIST_DEFAULT_SHARE)
    )
  );
}

/**
 * The pane width at which the Start/End sub-columns start paying for
 * themselves: everything the row spends before the title, plus the least title
 * worth leaving. 32 + 160 + 28 + 32 + 160 = 412.
 */
const START_END_COLUMNS_MIN_W =
  TASK_LIST_ROW_PADDING_W +
  START_END_COLUMNS_W +
  OPEN_DETAILS_SLOT_W +
  TITLE_FURNITURE_W +
  TASK_LIST_MIN_W;

/**
 * The single predicate for a row's dates. It reads ONLY the container-derived
 * task-list width, and the date sublabel under the title renders on exactly
 * its complement — so a row always shows its dates one way or the other.
 *
 * Previously the columns were gated by this test AND a `sm:` viewport test
 * while the sublabel was gated by a `(min-width: 640px)` media rule alone. Two
 * gates on two different widths are not complements: between a 640px and a
 * 1023px container both were shut and the row showed no dates at all, and the
 * same hole opened at any width once the splitter was dragged under the
 * threshold.
 */
function showStartEndColumns(taskListWidth: number) {
  return taskListWidth >= START_END_COLUMNS_MIN_W;
}

function rowHeightForContainer(width: number) {
  return width < 640 ? 32 : 40;
}

/**
 * Dependency link types, MS-Project style:
 * - `fs` finish-to-start (default): predecessor must finish before this task starts
 * - `ss` start-to-start, `ff` finish-to-finish, `sf` start-to-finish
 */
export type GanttLinkType = 'fs' | 'ss' | 'ff' | 'sf';

/**
 * Why the gantt's built-in drop-target policy refuses a dependency link
 * (objectui#4158). These names are the leaves of `gantt.link.rejected.*`, so
 * the message a user reads is selected by the same branch that did the
 * refusing. Not a host-facing rejection channel — a host's own veto via
 * `onBeforeDependencyCreate` carries a reason only the host knows, and
 * surfacing that is a separate contract.
 */
export type GanttLinkRejection = 'self' | 'locked' | 'group' | 'cycle';

export interface GanttDependencyObject {
  id: string | number
  type?: GanttLinkType
}

/** A dependency is the PREDECESSOR's task id, optionally with a link type. */
export type GanttDependency = string | number | GanttDependencyObject;

/**
 * Task rendering variant. `summary` is implied for any task that has
 * children; `milestone` is implied when end <= start (zero duration).
 */
export type GanttTaskType = 'task' | 'summary' | 'milestone' | 'group';

export interface GanttTask {
  id: string | number
  title: string
  start: Date
  /**
   * The EXCLUSIVE end of the bar's half-open span `[start, end)`: the bar is
   * drawn and scheduled up to this instant, and the task list, the tooltip, a
   * drag's preview and the inline editor name the last day it runs through
   * (objectui#11141). `ObjectGantt` hands a stored date-only end over as the
   * next day's local midnight (`toDisplayEndDate`, `@object-ui/core`), so a
   * task ending `2024-01-15` is drawn, and named, through the 15th.
   */
  end: Date
  progress: number
  color?: string
  /**
   * Per-task alert stroke. When set, the bar/milestone/summary
   * is outlined in this color (border + 2px halo) without touching its fill —
   * e.g. red for overdue, amber for due-soon, unset for normal. Maps from the view's
   * `borderColorField` in ObjectGantt. The critical-path overlay, when active,
   * takes precedence on the rows it marks.
   */
  borderColor?: string
  data?: any
  dependencies?: GanttDependency[]
  /** Parent task id — builds the hierarchy. Unknown ids render as roots. */
  parent?: string | number | null
  /**
   * Node kind. Defaults to a leaf `task` (or `summary` automatically when it has
   * children). Set `'group'` to render a pure tree header — expandable/collapsible
   * like a summary but with NO timeline bar (for project / product style pure
   * grouping levels: a tree on the left, no bar on the right).
   * Its children still render their own bars normally.
   */
  type?: GanttTaskType
  /**
   * Per-node lock (view-only / click-through). When true this row is view-only: its bar can't be
   * dragged/resized, progress can't be dragged, no dependency can be drawn from
   * it, and inline-edit / context-menu edit+delete are hidden. Clicking the bar
   * (onTaskClick — open drawer / jump) still works. Independent of the global
   * `readOnly`; use to lock individual levels (e.g. work orders) while others stay
   * editable. Maps from the view's `lockField` in ObjectGantt.
   */
  locked?: boolean
  /**
   * Baseline (planned) start/end. When both are present a thin reference bar is
   * drawn beneath the live bar so planned-vs-actual drift is visible at a glance.
   */
  baselineStart?: Date
  baselineEnd?: Date
  /**
   * Extra label/value rows for the hover tooltip, in display order.
   * Populated from the view's `tooltipFields` config (resolved + formatted by
   * ObjectGantt). When present they replace the default date·duration·progress
   * line in the tooltip.
   */
  fields?: Array<{ label: string; value: string }>
  /**
   * Whether `start`/`end` came from real record data (true / undefined) or are
   * placeholders fabricated for date-less records (false). Only consulted by
   * `summaryExtent: 'self'`, which falls back to child rollup when false.
   */
  hasOwnDates?: boolean
}

/** Timeline granularity — one column per day, week, month, quarter, or year. */
export type GanttViewMode = 'day' | 'week' | 'month' | 'quarter' | 'year';

const VIEW_MODES: GanttViewMode[] = ['day', 'week', 'month', 'quarter', 'year'];

/**
 * Nominal days represented by one column at each granularity. Sets the zoom
 * scale: pxPerDay = columnWidth / NOMINAL_DAYS[mode]. Actual column widths
 * follow the calendar (a 31-day month is slightly wider than a 30-day one)
 * so grid lines, bars and the Today marker share one linear ms→px mapping.
 */
export const NOMINAL_DAYS: Record<GanttViewMode, number> = {
  day: 1,
  week: 7,
  month: 30.44,
  quarter: 91.31,
  year: 365.25,
};

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

// The business-time-zone shim lives in `./tzShift` since objectui#10866;
// re-exported so every existing import of it from here keeps working.
export { makeTzShift }

/** Floor a date to the start of its column unit (Monday for weeks). */
export function startOfUnit(date: Date, mode: GanttViewMode): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (mode === 'week') {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  } else if (mode === 'month') {
    d.setDate(1);
  } else if (mode === 'quarter') {
    d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
  } else if (mode === 'year') {
    d.setMonth(0, 1);
  }
  return d;
}

/**
 * Index range of cells visible in [from, to] px. `offsets` is a prefix-sum
 * array of length n+1 (offsets[i] = left edge of cell i, offsets[n] = total).
 */
function visibleRange(offsets: number[], from: number, to: number): { start: number; end: number } {
  const n = offsets.length - 1;
  let start = 0;
  while (start < n && offsets[start + 1] < from) start++;
  let end = start;
  while (end < n && offsets[end] < to) end++;
  return { start, end };
}

/** Add whole column units; month/quarter clamp the day (Jan 31 + 1mo = Feb 28). */
export function addUnits(date: Date, units: number, mode: GanttViewMode): Date {
  const d = new Date(date);
  if (mode === 'day') {
    d.setDate(d.getDate() + units);
  } else if (mode === 'week') {
    d.setDate(d.getDate() + units * 7);
  } else {
    const months = units * (mode === 'month' ? 1 : mode === 'quarter' ? 3 : 12);
    const dayOfMonth = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(dayOfMonth, lastDay));
  }
  return d;
}

/**
 * The calendar days from `from`'s local day to `to`'s: the difference of their
 * local year / month / day, counted on the UTC calendar, where every day is
 * exactly 24 hours, so the quotient is a whole number. ⛔ Never the elapsed
 * milliseconds between two local times over a day's length: across a DST
 * change that span is a whole number of days plus or minus an hour
 * (objectui#10866, as objectui#11005 ruled for the calendar).
 */
function calendarDaysBetween(from: Date, to: Date): number {
  return (
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
    MS_PER_DAY
  );
}

/**
 * A summary's group move: every value in its subtree moves by the move the
 * dragged summary's start made, from `originStart` to `movedStart` — the same
 * calendar days on the day-and-coarser scales, the same elapsed span on the
 * shift-band scale (`byElapsedTime`; see `computeDragChanges`). Shared by the
 * drop and the live preview, so the two cannot disagree.
 */
function groupMover(originStart: Date, movedStart: Date, byElapsedTime: boolean): (value: Date) => Date {
  if (byElapsedTime) {
    const deltaMs = movedStart.getTime() - originStart.getTime();
    return (value) => new Date(value.getTime() + deltaMs);
  }
  const days = calendarDaysBetween(originStart, movedStart);
  return (value) => addUnits(value, days, 'day');
}

/**
 * The day a bar's END is named by wherever the view prints or edits it as a
 * day: the task list's End column and date sublabel, the hover tooltip, a
 * drag's preview and the inline editor (objectui#11141).
 *
 * `end` is the EXCLUSIVE end of the half-open span `[start, end)` every bar is
 * drawn (`styleFor`) and scheduled (`scheduling.ts`) on, so the day it names
 * is the last one the bar runs through: `toInclusiveEndDay` (`@object-ui/core`),
 * the exact inverse of the end read `ObjectGantt` and the timeline's gantt
 * share (`toDisplayEndDate`). A stored date-only `2024-01-15` is handed in as
 * the 16th's local midnight, drawn through the 15th, printed as the 15th, and
 * written back as the 15th. An end inside a day names that day, as it did.
 * A zero-length span (a milestone, or an end at or before its start) runs
 * through no day, so it names its end's own day, as it did.
 */
function endDayOf(start: Date, end: Date): Date {
  return end.getTime() > start.getTime() ? toInclusiveEndDay(end) : end;
}

/**
 * The inline editor's typed END day → the end it commits: the exact inverse of
 * {@link endDayOf} for the task being edited, so Enter on an untouched row
 * commits the end it was seeded from (objectui#11141). A task that spans time
 * commits the end of the typed day (`toDisplayEndDate`), the instant a stored
 * date-only end of that day is read as; a zero-length one commits the typed
 * day's local midnight (`toDisplayDate`), as every end did before.
 */
function endOfTypedDay(typed: string, task: Pick<GanttTask, 'start' | 'end'>): Date {
  return task.end.getTime() > task.start.getTime() ? toDisplayEndDate(typed) : toDisplayDate(typed);
}

/**
 * The tier the toolbar's period label and its prev/next steppers work in.
 *
 * It is deliberately the SAME tier `headerGroups` bands the timeline by, so the
 * toolbar and the band header four pixels below it can never name different
 * periods (objectui#7203: the toolbar formatted `timelineRange.start` — the memo
 * spanning the whole dataset — and so read "January 2026" over columns the band
 * header correctly called "Aug 2026", and could not change at any scroll
 * position because it was not derived from scroll position at all).
 *
 * Every `GanttViewMode` has a natural unit here, so "step one period" is always
 * defined: day/week band by month, month/quarter by year, year by decade, and
 * shift-segmented day mode by shift-day (the tier its bands group into).
 */
type GanttPeriodTier = 'shiftDay' | 'month' | 'year' | 'decade';

/** Mirror of the `groupBy` choice inside `headerGroups` — keep the two in step. */
function periodTierFor(mode: GanttViewMode, segmenting: boolean): GanttPeriodTier {
  if (segmenting) return 'shiftDay';
  if (mode === 'year') return 'decade';
  if (mode === 'month' || mode === 'quarter') return 'year';
  return 'month';
}

/** Start of the period `date` falls in, at `tier`. */
function startOfPeriod(date: Date, tier: GanttPeriodTier, dayStartMin = 0): Date {
  if (tier === 'shiftDay') return shiftDayStart(date, dayStartMin);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (tier === 'month') {
    d.setDate(1);
  } else if (tier === 'year') {
    d.setMonth(0, 1);
  } else {
    d.setMonth(0, 1);
    d.setFullYear(Math.floor(d.getFullYear() / 10) * 10);
  }
  return d;
}

/** Step whole periods at `tier` — one unit of the toolbar's granularity. */
function addPeriods(date: Date, n: number, tier: GanttPeriodTier): Date {
  if (tier === 'shiftDay') return addUnits(date, n, 'day');
  if (tier === 'month') return addUnits(date, n, 'month');
  return addUnits(date, n * (tier === 'decade' ? 10 : 1), 'year');
}

/**
 * Toolbar wording for a period start. The year and decade tiers reuse the band
 * header's exact strings; the month tier spells the month out ("August 2026"
 * beside the header's "Aug 2026") — a fuller form of the same month, never a
 * different one.
 */
function formatPeriodLabel(date: Date, tier: GanttPeriodTier, locale?: string): string {
  if (tier === 'decade') return `${Math.floor(date.getFullYear() / 10) * 10}s`;
  if (tier === 'year') return String(date.getFullYear());
  if (tier === 'shiftDay') {
    return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** Custom vertical timeline marker (deadline, sprint boundary, release…). */
export interface GanttMarker {
  date: Date | string
  label?: string
  color?: string
}

/**
 * Per-interaction switches — the DHTMLX `drag_move` / `drag_resize` /
 * `drag_progress` / `drag_links` model. Each defaults to true; flipping one off
 * hides that affordance everywhere while the others keep working. They only
 * NARROW what the write callbacks / `readOnly` / row locks already allow —
 * never widen.
 */
export interface GanttInteractions {
  /** Bar / subtree dragging (move along the timeline). */
  move?: boolean
  /** Edge resize grips (change duration). */
  resize?: boolean
  /** The progress drag handle. */
  progress?: boolean
  /** Dependency UI: drag-to-link dots AND the create/delete menu entries. */
  link?: boolean
}

export interface GanttViewProps {
  tasks: GanttTask[]
  /** Initial timeline granularity (also switchable from the toolbar). */
  viewMode?: GanttViewMode
  startDate?: Date
  endDate?: Date
  /** Extra vertical marker lines rendered like the Today marker. */
  markers?: GanttMarker[]
  onTaskClick?: (task: GanttTask) => void
  onTaskUpdate?: (task: GanttTask, changes: Partial<Pick<GanttTask, 'title' | 'start' | 'end' | 'progress'>>) => void
  onTaskDelete?: (task: GanttTask) => void
  /** Notified when the user switches granularity from the toolbar. */
  onViewChange?: (view: GanttViewMode) => void
  /**
   * Enables drag-to-link: a connector dot on each bar can be dragged onto
   * another bar to create a dependency (target depends on source).
   */
  onDependencyCreate?: (source: GanttTask, target: GanttTask, type: GanttLinkType) => void
  /**
   * Veto hook for drag-created dependencies (the onBeforeLinkAdd pattern).
   * Runs after the built-in guards — locked/group drop targets and
   * cycle-closing links are always rejected first — so hosts only see
   * structurally valid candidates. Return false to cancel the link.
   */
  onBeforeDependencyCreate?: (source: GanttTask, target: GanttTask, type: GanttLinkType) => boolean
  /**
   * Enables dependency removal: right-clicking a dependency link opens a menu
   * with a "Remove dependency" entry (`gantt.menu.removeDependency`) and a type
   * switch. Called with the source/target tasks of the
   * removed link (target no longer depends on source).
   */
  onDependencyDelete?: (source: GanttTask, target: GanttTask) => void
  /**
   * Enables row drag-to-reorder in the task list. Called with the dragged
   * task and the sibling it was dropped on (insert before it). Only fires
   * for rows sharing the same parent.
   */
  onTaskReorder?: (task: GanttTask, before: GanttTask) => void
  className?: string
  /** Enable inline editing of task fields */
  inlineEdit?: boolean
  /**
   * Show the "auto-schedule" toolbar button. Clicking it runs a one-shot
   * dependency-driven reschedule of the whole project (forward-only): every successor is
   * pushed later until its link constraints hold, preserving durations, and the
   * resulting date changes are emitted via `onTaskUpdate`. Requires onTaskUpdate.
   */
  autoSchedule?: boolean
  /**
   * After a bar drag/resize, validate the move against dependency constraints.
   * If the new position would violate a link — the task moved
   * earlier than a predecessor allows, or its move pushes successors past their
   * constraints — a confirmation prompts to "Auto-reschedule"
   * (`gantt.conflict.confirm` — cascade-reschedule the affected tasks,
   * preserving durations) or keep the overlap. Requires
   * onTaskUpdate and only fires when links exist. Ignored in readOnly.
   */
  rescheduleOnConflict?: boolean
  /** Start with the critical-path highlight enabled (toggle stays in the toolbar). */
  criticalPathDefault?: boolean
  /**
   * Working calendar for duration math. When set, auto-schedule and critical
   * path count working days only — weekends (`skipWeekends`) and any `holidays`
   * (ISO `yyyy-mm-dd` calendar-day keys, read on the chart's own calendar: the
   * viewer's, or the business `timeZone`'s when one is set) are skipped rather
   * than consumed.
   */
  workingCalendar?: WorkingCalendar
  /**
   * Shift segmentation. When set AND the active granularity is
   * `day`, each day column is replaced by one column per band (day | night | …),
   * and the upper header tier shows the shift-day (starting at `dayStart`, e.g.
   * 08:00). Drag/resize then snaps to band boundaries instead of whole days.
   * Off by default → existing gantts are unaffected (parity with `folding`).
   * Mutually exclusive with weekend/holiday folding (segmenting wins).
   */
  shiftSegments?: NormShiftSegments | null
  /** Render planned-vs-actual baseline bars when tasks carry baseline dates. */
  showBaselines?: boolean
  /**
   * Read-only mode. When true, every write interaction is disabled regardless
   * of which callbacks are passed: no bar drag / resize / progress handle, no
   * inline editing, no delete, no dependency-link drag, no row reorder, no
   * auto-schedule, and the Undo/Redo toolbar buttons are hidden. Clicking a
   * task (`onTaskClick`) and switching granularity still work — those don't
   * mutate data. Equivalent to omitting all write callbacks, but explicit and
   * metadata-drivable.
   */
  readOnly?: boolean
  /**
   * Mobile read-only. When true, the chart auto-enters read-only
   * mode on narrow viewports (< 640px) so touch users get a clean, scrollable
   * thumbnail of the schedule instead of error-prone drag editing — equivalent
   * to `readOnly` but scoped to small screens. Wider viewports are unaffected.
   * Independent of (and OR-combined with) `readOnly`.
   */
  mobileReadOnly?: boolean
  /**
   * Dynamic grouping accessor. When provided, leaf tasks are
   * bucketed by the returned `key` and rendered beneath one synthesized summary
   * row per group — the original `parent` hierarchy is replaced by the grouping.
   * Return `null` to drop a task into the "ungrouped" bucket. Grouping is purely
   * presentational: the timeline range, critical path and auto-schedule still run
   * on the real task list, and the synthetic group rows are never draggable.
   */
  groupBy?: (task: GanttTask) => { key: string | number; label: string } | null
  /** Label for the bucket collecting tasks whose `groupBy` returns null. */
  ungroupedLabel?: string
  /**
   * Auto-collapse tree nodes at or below this depth on first render.
   * Depth is 0-indexed: roots are 0, their children 1, etc. Every node whose
   * depth is `>= defaultCollapsedDepth` AND which has children is seeded into the
   * collapsed set once, so its subtree starts hidden. The user can still expand
   * any of them — this only sets the initial state. Example: a
   * project→product→production-plan→work-order tree where the production plan
   * sits at depth 2 uses `defaultCollapsedDepth={2}` to start
   * with every production plan (and its work-order children) folded. Omit (or pass a depth past
   * the deepest node) to start fully expanded.
   */
  defaultCollapsedDepth?: number
  /**
   * How a summary bar's span is computed. `'children'` (default)
   * rolls up from the children — min start / max end / duration-weighted
   * progress — ignoring the summary task's own dates. `'self'` draws the bar
   * from the task's OWN start/end/progress; tasks flagged `hasOwnDates: false`
   * still roll up (pure grouping levels have no dates of their own). In `'self'`
   * mode ancestor bars also stop live-stretching while a child is dragged,
   * since their extent no longer depends on the children.
   */
  summaryExtent?: 'children' | 'self'
  /**
   * Persist the user's layout tweaks (granularity + column/task-list widths)
   * to `localStorage` under this key. On mount the saved layout is restored;
   * the "Save layout" toolbar button (`gantt.toolbar.saveLayout`) writes the
   * current layout. Omit to disable
   * persistence. The button still appears when `onLayoutChange` is set.
   */
  persistLayoutKey?: string
  /**
   * Notified when the user saves the current layout. Receives the
   * snapshot `{ viewMode, columnWidth, taskListCollapsed }`. Use this to persist
   * layout in your own store instead of (or alongside) `persistLayoutKey`.
   */
  onLayoutChange?: (layout: GanttLayout) => void
  /**
   * Show a manual refresh button in the toolbar (`gantt.toolbar.refresh`). The host re-reads
   * its data source so server-computed fields (rollups, alert colors) and
   * other users' edits reach the chart without a full page reload. Omit to
   * hide the button (e.g. inline `value` data has nothing to re-read).
   */
  onRefresh?: () => void | Promise<void>
  /** Disables the refresh button while a host-driven reload is in flight. */
  refreshing?: boolean
  /**
   * Whether the data source can persist dependency LINK TYPES (fs/ss/ff/sf).
   * Default true. Set false when dependencies are stored as bare predecessor
   * ids (predecessor ids only, no type slot) — the link context menu then hides the type
   * switcher (a switch would be silently reverted on refetch) and drag-created
   * links are always FS regardless of which endpoints were connected.
   */
  dependencyTypes?: boolean
  /**
   * Business time zone for rendering, an IANA name like
   * 'Asia/Shanghai'. The chart's calendar math — shift bands, day columns,
   * drag snapping, the today line, start/end labels — renders this zone's
   * wall time for EVERY viewer instead of the browser's; without it, a
   * viewer in another zone sees bands and dates misaligned. Dates handed to
   * `onTaskUpdate` are translated back out of this display space into real
   * instants. A date-only value is a day rather than an instant, so the host
   * translates both ways itself (objectui#10866): `ObjectGantt` hands a day in
   * as the instant the shim maps exactly onto its local midnight, so it is
   * drawn from that midnight here, and writes a `date` field back as the day
   * of the display date the emitted instant was translated from, recovered
   * exactly (`invertTo` / `invertFrom` in `./tzShift`, which say why the shim's
   * own round trip is not exact around a DST change). Note: dates handed to
   * `onBeforeTaskUpdate` are in this display space (durations/deltas are
   * unaffected).
   */
  timeZone?: string
  /**
   * Base name for exported files, e.g. the view or object label —
   * "Shift Plan Gantt" exports as `Shift Plan Gantt-20260719-1530.png`. Falls back
   * to "gantt". The timestamp suffix keeps repeated exports from silently
   * overwriting each other in the Downloads folder.
   */
  exportFileName?: string
  /**
   * Per-interaction switches. Omit for all-on. See
   * {@link GanttInteractions}: e.g. `{ resize: false }` keeps bars movable and
   * links drawable but pins every duration; `{ link: false }` removes the
   * dependency drag-dots and the create/delete menu entries. Subject to
   * `readOnly` and per-row locks — these switches only narrow.
   */
  interactions?: GanttInteractions
  /**
   * Veto hook for task edits (the MS-Project/Bryntum `beforeTaskDrag` /
   * `beforeTaskEdit` pattern). Runs on the central commit path — bar drag,
   * edge resize, group move, progress drag, inline edit, conflict
   * auto-reschedule — AFTER the built-in guards (locked rows never reach it).
   * Return false (sync or async) to cancel that task's update; other tasks in
   * the same batch still apply. Undo/redo bypasses it: restoring a previous
   * state must not be vetoable.
   */
  onBeforeTaskUpdate?: (
    task: GanttTask,
    changes: Partial<Pick<GanttTask, 'title' | 'start' | 'end' | 'progress'>>,
  ) => boolean | Promise<boolean>
}

/** Persisted layout snapshot written by the "Save layout" toolbar button. */
export interface GanttLayout {
  viewMode: GanttViewMode
  /** Effective day-column width in px, or null when auto-fit. */
  columnWidth: number | null
  taskListCollapsed: boolean
  /** User-dragged task-list (name column) width in px, or null when auto-sized. */
  taskListWidth?: number | null
  /**
   * Ids of rows the user had collapsed when saving. Present (even
   * empty) means the saved expand/collapse state wins over
   * `defaultCollapsedDepth`; absent (older snapshots) leaves the default.
   */
  collapsedIds?: string[]
}

// --- Export helpers (PNG / PDF) — module-level, no React deps. ---

/** Rasterize a standalone SVG string to a 2×-scaled canvas (white-backed). */
function rasterizeSvg(svg: string, W: number, H: number, scale = 2): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W * scale;
      canvas.height = H * scale;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
      }
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

/** Download a Blob under `filename` via a transient anchor. */
function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Build a minimal single-page PDF that embeds a JPEG (DCTDecode) at its native
 * pixel size — dependency-free, just enough structure for any PDF viewer. The
 * page MediaBox matches the image so it fills the page upright.
 */
function buildJpegPdf(jpeg: Uint8Array, w: number, h: number): Blob {
  const enc = (s: string) => {
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
    return a;
  };
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (u: Uint8Array) => { chunks.push(u); pos += u.length; };
  const mark = () => { offsets.push(pos); };

  push(enc('%PDF-1.3\n%\xFF\xFF\xFF\xFF\n'));
  mark(); push(enc('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  mark(); push(enc('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'));
  mark(); push(enc(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`));
  mark();
  push(enc(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`));
  push(jpeg);
  push(enc('\nendstream\nendobj\n'));
  mark(); push(enc(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`));

  const xrefPos = pos;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  push(enc(xref));

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

/** Decode a base64 data-URL payload to bytes. */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** localStorage key namespace for persisted layouts. */
const LAYOUT_STORAGE_PREFIX = 'gantt-layout:';

/** Read a persisted layout, tolerating absent storage / malformed JSON. */
function readSavedLayout(key: string | undefined): GanttLayout | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_PREFIX + key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<GanttLayout>;
    const viewMode = p.viewMode && VIEW_MODES.includes(p.viewMode) ? p.viewMode : null;
    if (!viewMode) return null;
    const columnWidth =
      typeof p.columnWidth === 'number' && isFinite(p.columnWidth) ? p.columnWidth : null;
    const taskListWidth =
      typeof p.taskListWidth === 'number' && isFinite(p.taskListWidth) ? p.taskListWidth : null;
    const collapsedIds = Array.isArray(p.collapsedIds)
      ? p.collapsedIds.filter((x): x is string => typeof x === 'string')
      : undefined;
    return { viewMode, columnWidth, taskListCollapsed: !!p.taskListCollapsed, taskListWidth, collapsedIds };
  } catch {
    return null;
  }
}

/** Persist a layout snapshot, swallowing quota/SSR errors. */
function writeSavedLayout(key: string, layout: GanttLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_PREFIX + key, JSON.stringify(layout));
  } catch {
    /* storage unavailable / full — non-fatal */
  }
}

export function GanttView({
  tasks: tasksProp,
  viewMode: viewModeProp,
  startDate: startDateProp,
  endDate: endDateProp,
  markers: markersProp,
  onTaskClick,
  onTaskUpdate: onTaskUpdateProp,
  onTaskDelete: onTaskDeleteProp,
  onViewChange,
  onDependencyCreate: onDependencyCreateProp,
  onBeforeDependencyCreate,
  onDependencyDelete: onDependencyDeleteProp,
  onTaskReorder: onTaskReorderProp,
  className,
  inlineEdit: inlineEditProp = false,
  autoSchedule: autoScheduleProp = false,
  rescheduleOnConflict: rescheduleOnConflictProp = false,
  criticalPathDefault = false,
  workingCalendar,
  shiftSegments,
  showBaselines = true,
  readOnly = false,
  mobileReadOnly = false,
  groupBy,
  ungroupedLabel = 'Ungrouped',
  defaultCollapsedDepth,
  summaryExtent = 'children',
  persistLayoutKey,
  onLayoutChange,
  onRefresh,
  refreshing = false,
  dependencyTypes = true,
  timeZone,
  exportFileName,
  interactions,
  onBeforeTaskUpdate,
}: GanttViewProps) {
  // Business-time-zone shim: translate every incoming date into
  // the display space where the browser clock reads the configured zone's
  // wall time; translate emitted date changes back to real instants. All
  // calendar logic below runs unchanged and becomes zone-correct.
  const tzShift = React.useMemo(() => makeTzShift(timeZone), [timeZone]);
  const tasks = React.useMemo(() => {
    if (tzShift.delta === 0) return tasksProp;
    return tasksProp.map((tk) => ({
      ...tk,
      start: tzShift.to(tk.start),
      end: tzShift.to(tk.end),
      baselineStart: tk.baselineStart ? tzShift.to(tk.baselineStart) : tk.baselineStart,
      baselineEnd: tk.baselineEnd ? tzShift.to(tk.baselineEnd) : tk.baselineEnd,
    }));
  }, [tasksProp, tzShift]);
  const startDate = React.useMemo(
    () => (startDateProp && tzShift.delta !== 0 ? tzShift.to(startDateProp) : startDateProp),
    [startDateProp, tzShift],
  );
  const endDate = React.useMemo(
    () => (endDateProp && tzShift.delta !== 0 ? tzShift.to(endDateProp) : endDateProp),
    [endDateProp, tzShift],
  );
  const markers = React.useMemo(() => {
    if (!markersProp || tzShift.delta === 0) return markersProp;
    // A date-only marker names a DAY of the chart's own calendar, so it stands
    // at that day's display-local midnight and is NOT re-based like an instant:
    // re-basing moved it to another hour, and for some zones another day
    // (objectui#10866). A `Date` or a date-time string is an instant and is.
    return markersProp.map((m) =>
      typeof m.date === 'string' && isRealCalendarDate(m.date)
        ? { ...m, date: toDisplayDate(m.date) }
        : { ...m, date: tzShift.to(toDisplayDate(m.date)) },
    );
  }, [markersProp, tzShift]);

  const { t } = useGanttTranslation();
  // Locale for every user-facing date label: the DISPLAY locale, never the UI
  // language, and never the machine's locale (objectui#10668). The hook owns
  // the last resort, so no fallback belongs here. `ObjectGantt`'s tooltips and
  // `ResourceWorkload` read the same hook, so one gantt shows one locale.
  const dateLocale = useDisplayLocale();
  // A task's DAY as the task list, the tooltip and the drag previews print it
  // (objectui#12110 item 5, finding B-20 of the HotCRM browser pass). These
  // faces printed `{ month, day }` only, so a plan reaching into another year
  // read `3/2` for two days a year apart. The year is added whenever the date's
  // year is not the current one — "now" in the view's zone, the same `now` the
  // today line reads — as two digits on the compact numeric faces (the Start /
  // End cells are narrow) and in full on the short-month face; a day in the
  // current year reads as it always did. The header bands keep their own
  // formats and are not this helper's readers.
  const currentYear = tzShift.now().getFullYear();
  const formatTaskDay = (date: Date, month: 'numeric' | 'short'): string =>
    date.toLocaleDateString(
      dateLocale,
      date.getFullYear() === currentYear
        ? { month, day: 'numeric' }
        : { month, day: 'numeric', year: month === 'numeric' ? '2-digit' : 'numeric' },
    );
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Observed container width — the source every auto-sized dimension below
  // derives from: row height, base column width, and the task-list pane width.
  const { width: containerWidth } = useResizeObserver(containerRef);
  const effectiveWidth = containerWidth || (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const isNarrow = effectiveWidth < 640;
  // Read-only gating, applied once at the top so every downstream usage —
  // drag/resize/progress, inline edit, delete, link-drag, reorder,
  // auto-schedule, and the Undo/Redo toolbar (which keys off onTaskUpdate) —
  // inherits it. `mobileReadOnly` folds in on narrow viewports so touch users
  // get a read-only thumbnail. `onTaskClick` / `onViewChange`
  // stay live: they don't mutate.
  const effectiveReadOnly = readOnly || (mobileReadOnly && isNarrow);
  // Interaction switches (default all on). `link` folds into the dependency
  // handlers right here so every downstream consumer — drag-dots, context-menu
  // create/delete entries, link menus — inherits it; move/resize/progress are
  // enforced at their interaction sites (they share onTaskUpdate).
  const ixMove = interactions?.move !== false;
  const ixResize = interactions?.resize !== false;
  const ixProgress = interactions?.progress !== false;
  const ixLink = interactions?.link !== false;
  // Emitted date changes are display-space — translate back to real instants
  // before they reach the host, which decides what to persist: a `datetime`
  // field the instant, a `date` field its day (see `timeZone`, objectui#10866).
  const onTaskUpdate = React.useMemo(() => {
    if (effectiveReadOnly || !onTaskUpdateProp) return undefined;
    if (tzShift.delta === 0) return onTaskUpdateProp;
    return (task: GanttTask, changes: Partial<Pick<GanttTask, 'title' | 'start' | 'end' | 'progress'>>) => {
      const out = { ...changes };
      if (out.start instanceof Date) out.start = tzShift.from(out.start);
      if (out.end instanceof Date) out.end = tzShift.from(out.end);
      onTaskUpdateProp(task, out);
    };
  }, [effectiveReadOnly, onTaskUpdateProp, tzShift]);
  const onTaskDelete = effectiveReadOnly ? undefined : onTaskDeleteProp;
  const onDependencyCreate = effectiveReadOnly || !ixLink ? undefined : onDependencyCreateProp;
  const onDependencyDelete = effectiveReadOnly || !ixLink ? undefined : onDependencyDeleteProp;
  const onTaskReorder = effectiveReadOnly ? undefined : onTaskReorderProp;
  const inlineEdit = effectiveReadOnly ? false : inlineEditProp;
  const autoSchedule = effectiveReadOnly ? false : autoScheduleProp;
  const rescheduleOnConflict = effectiveReadOnly ? false : rescheduleOnConflictProp;
  const rowHeight = rowHeightForContainer(effectiveWidth);
  // Restore a persisted layout once on first render (when persistLayoutKey set).
  // It seeds the initial granularity / zoom / list-collapse below; the prop
  // still wins for viewMode if explicitly supplied.
  const restoredLayoutRef = React.useRef<GanttLayout | null | undefined>(undefined);
  if (restoredLayoutRef.current === undefined) {
    restoredLayoutRef.current = readSavedLayout(persistLayoutKey);
  }
  const restoredLayout = restoredLayoutRef.current;
  // Mobile UX (round 3): make zoom + list-collapse stateful so the toolbar
  // buttons + pinch-to-zoom gesture actually persist.
  const [columnWidthOverride, setColumnWidthOverride] = React.useState<number | null>(
    restoredLayout ? restoredLayout.columnWidth : null
  );
  // User-dragged task-list (name column) width. null → auto-size from container.
  const [taskListWidthOverride, setTaskListWidthOverride] = React.useState<number | null>(
    restoredLayout ? restoredLayout.taskListWidth ?? null : null
  );
  // Timeline granularity. The prop seeds (and can later override) the state;
  // the toolbar segmented control switches it interactively. A persisted layout
  // seeds it when no explicit prop is given.
  const [viewMode, setViewMode] = React.useState<GanttViewMode>(
    viewModeProp && VIEW_MODES.includes(viewModeProp)
      ? viewModeProp
      : restoredLayout?.viewMode ?? 'day'
  );
  React.useEffect(() => {
    if (viewModeProp && VIEW_MODES.includes(viewModeProp)) setViewMode(viewModeProp);
  }, [viewModeProp]);
  // Date sitting at the viewport's left edge when the user switched granularity,
  // captured so the post-switch layout effect can re-pin it to the left edge
  // (see `changeViewMode` below, defined after the date↔px mappings it needs).
  const pendingViewAnchorRef = React.useRef<Date | null>(null);
  // The date the user actually wants pinned to the left edge, kept at full
  // precision and updated ONLY by genuine user scrolling — never re-derived from
  // a programmatic (and possibly clamped) scrollLeft. This is what survives a
  // multi-step granularity change: switching to a coarser scale whose *entire*
  // timeline fits the viewport clamps scrollLeft to 0, which would otherwise
  // poison the next switch by capturing "0 → timeline start" as the new anchor.
  // Holding the precise intent here means Day(Apr 9)→Week→Month→Day returns to
  // Apr 9, not the timeline's left edge.
  const viewAnchorDateRef = React.useRef<Date | null>(null);
  // Gate that blocks scroll events from updating viewAnchorDateRef until the
  // next *genuine* user-input scroll (wheel / touch / keyboard / scrollbar drag).
  // A granularity change arms this. It's needed because switching into a
  // narrower view makes the browser auto-clamp scrollLeft (e.g. 720 → 53) and
  // fire a scroll event we never initiated — a one-shot "suppress the next
  // event" flag can't catch that (the clamp may fire zero, one, or several
  // events), and it would overwrite the precise anchor with the clamped
  // position (→ Dec 17 → Day clamps to the timeline start). User-input
  // listeners on the scroll container clear this gate, so only real scrolling
  // re-captures the anchor. Starts armed so the mount scroll-to-today doesn't
  // seed a bogus anchor before the user has touched anything.
  const blockAnchorUntilUserScrollRef = React.useRef(true);
  const [taskListCollapsed, setTaskListCollapsed] = React.useState<boolean>(
    restoredLayout ? restoredLayout.taskListCollapsed : false
  );
  // Auto-collapse the list once on first narrow render — undoable by the user.
  const collapsedAutoSet = React.useRef(false);
  React.useEffect(() => {
    if (!collapsedAutoSet.current && isNarrow) {
      setTaskListCollapsed(true);
      collapsedAutoSet.current = true;
    }
  }, [isNarrow]);
  // Task-list pane width. A user drag (taskListWidthOverride) wins over the
  // auto-size, clamped so it can't collapse to nothing or swallow the timeline.
  // The floor is the module-level TASK_LIST_MIN_W, shared with the Start/End
  // threshold so the two cannot drift apart.
  const taskListMaxW = Math.max(TASK_LIST_MIN_W, effectiveWidth - 200);
  const taskListWidth = taskListCollapsed
    ? 0
    : taskListWidthOverride != null
      ? Math.max(TASK_LIST_MIN_W, Math.min(taskListWidthOverride, taskListMaxW))
      : taskListWidthForContainer(effectiveWidth);
  // Fit-to-width ("zoom to fit"): in coarse modes a short project's natural grid
  // (span × base px/day) is far narrower than the timeline area, leaving the
  // right side blank. Rather than pad the calendar with years of empty units, we
  // STRETCH the column width so the real span fills the viewport. A manual zoom
  // (columnWidthOverride) always wins; a long project whose grid already
  // overflows keeps the base width and simply scrolls.
  const fitColumnWidth = React.useMemo(() => {
    // Only stretch when the right edge is auto-derived; a caller-pinned endDate
    // means a deliberate window, so respect the fixed per-unit width and scroll.
    if (columnWidthOverride != null || endDate || tasks.length === 0) return null;
    let start = startDate ? new Date(startDate) : new Date(Math.min(...tasks.map((t) => t.start.getTime())));
    const end = new Date(Math.max(...tasks.map((t) => t.end.getTime())));
    if (!startDate) start.setDate(start.getDate() - 7);
    end.setDate(end.getDate() + 14);
    start = startOfUnit(start, viewMode);
    end.setHours(23, 59, 59, 999);
    const spanDays = Math.max(1, (end.getTime() - start.getTime()) / MS_PER_DAY);
    const avail = Math.max(0, effectiveWidth - taskListWidth);
    if (avail <= 0) return null;
    // Column width that makes the natural span exactly fill the area.
    const fit = (avail / spanDays) * NOMINAL_DAYS[viewMode];
    if (fit <= BASE_COLUMN_W) return null; // grid already overflows → scroll
    // Cap so one unit can't dominate (keep ≥ ~2 columns visible) — a sub-unit
    // project then fills most of the area with a small honest gap, not 1 slab.
    const capped = Math.min(fit, avail * 0.6);
    return capped > BASE_COLUMN_W ? capped : null;
  }, [columnWidthOverride, tasks, startDate, endDate, viewMode, effectiveWidth, taskListWidth]);
  const columnWidth = columnWidthOverride ?? fitColumnWidth ?? BASE_COLUMN_W;
  // One column = one unit of the active granularity; bars/markers map time
  // linearly at pxPerDay so they stay aligned with the calendar-width columns.
  const pxPerDay = columnWidth / NOMINAL_DAYS[viewMode];
  const showSEColumns = showStartEndColumns(taskListWidth);
  const [editingTask, setEditingTask] = React.useState<string | number | null>(null);
  const [editValues, setEditValues] = React.useState<Record<string, string>>({});
  // Hovered bar id — used to highlight its dependency links.
  const [hoveredTaskId, setHoveredTaskId] = React.useState<string | number | null>(null);

  // Dynamic Group by. When `groupBy` is set we synthesize one
  // summary row per bucket and reparent each leaf task onto it, replacing the
  // original hierarchy. The existing rollup/collapse/summary machinery then
  // renders the groups for free. This is a PRESENTATIONAL transform: the
  // timeline range, critical path and auto-schedule deliberately keep reading
  // the real `tasks` prop (see those memos), and synthetic rows carry
  // `data.__group` so drag is suppressed. With no accessor, `displayTasks === tasks`.
  const displayTasks = React.useMemo<GanttTask[]>(() => {
    if (!groupBy) return tasks;
    // Grouping operates on leaf tasks; original parent rows (summaries) are
    // dropped and their leaves regrouped under the new buckets.
    const parentIds = new Set<string>();
    for (const tk of tasks) {
      const p = tk.parent != null && tk.parent !== '' ? String(tk.parent) : null;
      if (p) parentIds.add(p);
    }
    type Bucket = { key: string; label: string; items: GanttTask[] };
    const buckets = new Map<string, Bucket>(); // insertion order = first-seen
    for (const tk of tasks) {
      if (parentIds.has(String(tk.id))) continue;
      const g = groupBy(tk);
      const key = g ? String(g.key) : '__ungrouped__';
      const label = g ? g.label : ungroupedLabel;
      let b = buckets.get(key);
      if (!b) { b = { key, label, items: [] }; buckets.set(key, b); }
      b.items.push(tk);
    }
    const out: GanttTask[] = [];
    for (const b of buckets.values()) {
      const gid = `__group__${b.key}`;
      const first = b.items[0];
      // Placeholder dates — rollup recomputes the true span from the children.
      out.push({
        id: gid,
        title: b.label,
        start: first.start,
        end: first.end,
        progress: 0,
        type: 'summary',
        parent: null,
        data: { __group: true },
      });
      for (const tk of b.items) out.push({ ...tk, parent: gid });
    }
    return out;
  }, [groupBy, tasks, ungroupedLabel]);

  // Children index for group operations: dragging a summary bar moves its
  // whole subtree by the same offset. Mirrors the orphan/self-parent rules
  // of the row tree below.
  const childrenByParent = React.useMemo(() => {
    const ids = new Set(displayTasks.map((t) => String(t.id)));
    const map = new Map<string, GanttTask[]>();
    for (const t of displayTasks) {
      const p = t.parent != null && t.parent !== '' ? String(t.parent) : null;
      if (p && p !== String(t.id) && ids.has(p)) {
        const list = map.get(p);
        if (list) list.push(t);
        else map.set(p, [t]);
      }
    }
    return map;
  }, [displayTasks]);

  const taskById = React.useMemo(() => {
    const m = new Map<string, GanttTask>();
    for (const t of displayTasks) m.set(String(t.id), t);
    return m;
  }, [displayTasks]);

  const collectDescendants = React.useCallback((id: string | number): GanttTask[] => {
    const out: GanttTask[] = [];
    const seen = new Set<string>();
    const walk = (key: string) => {
      for (const c of childrenByParent.get(key) ?? []) {
        const ck = String(c.id);
        if (seen.has(ck)) continue; // parent cycles
        seen.add(ck);
        out.push(c);
        walk(ck);
      }
    };
    walk(String(id));
    return out;
  }, [childrenByParent]);

  // Drag-and-drop state for rescheduling a bar (move + resize from either edge).
  // unitDelta is the snapped offset from the original position — in DAYS on
  // every granularity except day-with-shift-bands, where it counts bands;
  // preview is rendered by overriding left/width when dragState.taskId matches.
  type DragMode = 'move' | 'resize-left' | 'resize-right';
  const [dragState, setDragState] = React.useState<{
    taskId: string | number;
    mode: DragMode;
    /** Summary-bar drag: shift the whole subtree by the same offset. */
    group: boolean;
    originStart: Date;
    originEnd: Date;
    originClientX: number;
    unitDelta: number;
  } | null>(null);
  const dragStateRef = React.useRef<typeof dragState>(null);
  React.useEffect(() => { dragStateRef.current = dragState; }, [dragState]);
  // Suppress the click that fires immediately after a drag pointerup.
  const suppressNextClickRef = React.useRef(false);

  const computeDragChanges = React.useCallback((s: NonNullable<typeof dragState>) => {
    const segActive = viewMode === 'day' && !!shiftSegments && shiftSegments.bands.length > 0;
    // Folded/segmented axes advance by visible columns (Fri +1 → Mon, band →
    // band); both only exist in day mode. Every other granularity snaps by
    // whole DAYS — dragging in week/month view must not jump 7/30 days per
    // step (unitDelta is a day count there; the pointer handler divides the
    // pixel delta by pxPerDay to match).
    const shift = (date: Date, n: number) =>
      foldShiftRef.current ? foldShiftRef.current(date, n) : addUnits(date, n, 'day');
    let start = new Date(s.originStart);
    let end = new Date(s.originEnd);
    if (segActive && shiftSegments) {
      // Shift-band scale: a drag moves by bands, laid end to end on an
      // elapsed-time axis, so the end follows the start by the same elapsed
      // span, and a bar can be as short as the smallest band (e.g. a 12h day
      // shift). objectui#10866 left this scale as it was: the calendar-day rule
      // below was ruled for a move to a day, not to a band.
      const minDurationMs = Math.min(...shiftSegments.bands.map((b) => b.durMs));
      if (s.mode === 'move') {
        start = shift(s.originStart, s.unitDelta);
        end = new Date(s.originEnd.getTime() + (start.getTime() - s.originStart.getTime()));
      } else if (s.mode === 'resize-left') {
        start = shift(s.originStart, s.unitDelta);
        if (end.getTime() - start.getTime() < minDurationMs) {
          start = new Date(end.getTime() - minDurationMs);
        }
      } else if (s.mode === 'resize-right') {
        end = shift(s.originEnd, s.unitDelta);
        if (end.getTime() - start.getTime() < minDurationMs) {
          end = new Date(start.getTime() + minDurationMs);
        }
      }
      return { start, end };
    }
    // Day-and-coarser scales: the user moved a value to a day, so every value
    // moves by the calendar days its snapped edge moved (`setDate` on a copy,
    // hours / minutes / seconds kept) and a bar never collapses below one
    // calendar day. ⛔ Not by the elapsed milliseconds of the start's move:
    // across a DST change that span is a whole number of days plus or minus
    // an hour, which ended a day task at 23:00 of the day before
    // (objectui#10866, objectui#11005's ruling B).
    const daysMoved = (from: Date) => calendarDaysBetween(from, shift(from, s.unitDelta));
    if (s.mode === 'move') {
      const days = daysMoved(s.originStart);
      start = addUnits(s.originStart, days, 'day');
      end = addUnits(s.originEnd, days, 'day');
    } else if (s.mode === 'resize-left') {
      start = addUnits(s.originStart, daysMoved(s.originStart), 'day');
      const latest = addUnits(end, -1, 'day');
      if (start.getTime() > latest.getTime()) start = latest;
    } else if (s.mode === 'resize-right') {
      end = addUnits(s.originEnd, daysMoved(s.originEnd), 'day');
      const earliest = addUnits(start, 1, 'day');
      if (end.getTime() < earliest.getTime()) end = earliest;
    }
    return { start, end };
  }, [viewMode, shiftSegments]);

  /** The day a drag's preview names as the end it will commit (`endDayOf`, objectui#11141). */
  const dragPreviewEndDay = (s: NonNullable<typeof dragState>): Date => {
    const previewed = computeDragChanges(s);
    return endDayOf(previewed.start, previewed.end);
  };


  // --- Undo / redo (Phase 6) --------------------------------------------
  // GanttView is presentational — the parent owns task state — so we can't
  // snapshot it directly. Instead each committed mutation (drag/resize, group
  // drag, progress, inline edit, auto-schedule) is recorded as a batch of
  // {taskId, before, after} field deltas and replayed through onTaskUpdate.
  // Undo applies `before`, redo re-applies `after`; both look the task up by id
  // in the latest `tasks` so a parent re-render between commits is fine.
  type HistoryItem = { taskId: string; before: Partial<GanttTask>; after: Partial<GanttTask> };
  const tasksRef = React.useRef(tasks);
  tasksRef.current = tasks;
  const undoStackRef = React.useRef<HistoryItem[][]>([]);
  const redoStackRef = React.useRef<HistoryItem[][]>([]);
  const [historyVersion, setHistoryVersion] = React.useState(0);

  const commitTaskUpdates = React.useCallback(
    (updates: Array<{ task: GanttTask; changes: Partial<Pick<GanttTask, 'title' | 'start' | 'end' | 'progress'>> }>) => {
      if (!onTaskUpdate) return;
      // Central belt: a locked (view-only) row is never committed, whatever the
      // path — group shift, conflict reschedule, or a future caller.
      const candidates = updates.filter((u) => !u.task.locked);
      // The host veto (onBeforeTaskUpdate) may be async, so the whole commit
      // is — callers stay fire-and-forget. A veto (false return or a throw)
      // drops that task's update; the rest of the batch still applies.
      void (async () => {
        let approved = candidates;
        if (onBeforeTaskUpdate) {
          const kept: typeof candidates = [];
          for (const u of candidates) {
            // Assigned by both the try and the catch below before it's read.
            let ok: boolean;
            try {
              ok = (await onBeforeTaskUpdate(u.task, u.changes)) !== false;
            } catch {
              ok = false;
            }
            if (ok) kept.push(u);
          }
          approved = kept;
        }
        const batch: HistoryItem[] = [];
        for (const { task, changes } of approved) {
          const before: Partial<GanttTask> = {};
          const after: Partial<GanttTask> = {};
          let dirty = false;
          for (const k of Object.keys(changes) as Array<keyof GanttTask>) {
            const next = (changes as Record<string, unknown>)[k as string];
            const prev = (task as unknown as Record<string, unknown>)[k as string];
            const same =
              next instanceof Date && prev instanceof Date
                ? next.getTime() === prev.getTime()
                : next === prev;
            (before as Record<string, unknown>)[k as string] = prev;
            (after as Record<string, unknown>)[k as string] = next;
            if (!same) dirty = true;
          }
          onTaskUpdate(task, changes);
          if (dirty) batch.push({ taskId: String(task.id), before, after });
        }
        if (batch.length) {
          undoStackRef.current.push(batch);
          redoStackRef.current = [];
          setHistoryVersion((v) => v + 1);
        }
      })();
    },
    [onTaskUpdate, onBeforeTaskUpdate],
  );

  // --- Drag conflict validation + auto-reschedule confirmation (Group 2) ---
  // After a bar drag/resize commits, replay the dependency forward-pass over the
  // moved task(s). If the new position would violate a link (a predecessor ends
  // after the dragged task starts, or a successor now overlaps the dragged
  // task), computeProjectReschedule returns a non-empty change set that differs
  // from what the drag itself applied — that delta is the conflict we surface.
  const [pendingConflict, setPendingConflict] = React.useState<RescheduleChange[] | null>(null);

  // Snap a rescheduled start onto the next shift-band boundary so
  // a pushed task never starts mid-band — the reschedule twin of the drag
  // snapping. Only meaningful when shift segments are configured.
  const snapToBandStart = React.useCallback(
    (ms: number): number => {
      if (!shiftSegments) return ms;
      const base = new Date(ms);
      base.setHours(0, 0, 0, 0);
      // Walk band boundaries from the previous calendar day (a cross-midnight
      // band's shift-day starts the day before) until one lands at/after ms.
      for (let dayOff = -1; dayOff <= 1; dayOff++) {
        let t = base.getTime() + dayOff * MS_PER_DAY + shiftSegments.dayStartMin * 60000;
        for (const b of shiftSegments.bands) {
          if (t >= ms) return t;
          t += b.durMs;
        }
      }
      return ms;
    },
    [shiftSegments],
  );
  // Reschedule semantics shared by BOTH cascade paths (toolbar auto-schedule
  // and the post-drag conflict dialog): self-dated summaries participate, and
  // pushed starts snap to shift bands.
  const reschedOpts = React.useMemo<RescheduleOptions>(
    () => ({
      summaryExtent,
      snapStart: shiftSegments ? snapToBandStart : undefined,
    }),
    [summaryExtent, shiftSegments, snapToBandStart],
  );

  const maybeFlagConflict = React.useCallback(
    (applied: Array<{ task: GanttTask; changes: { start?: Date; end?: Date } }>) => {
      if (!rescheduleOnConflict) return;
      const overrides = new Map<string, { start: Date; end: Date }>();
      for (const { task, changes } of applied) {
        overrides.set(String(task.id), {
          start: changes.start ?? task.start,
          end: changes.end ?? task.end,
        });
      }
      const candidate = tasksRef.current.map((t) => {
        const o = overrides.get(String(t.id));
        return o ? { ...t, start: o.start, end: o.end } : t;
      });
      const { changes } = computeProjectRescheduleDetailed(candidate, workingCalendar, reschedOpts);
      // A change that merely restates the drag override is not a conflict.
      const conflict = changes.filter((c) => {
        const o = overrides.get(c.id);
        return !o || c.start.getTime() !== o.start.getTime() || c.end.getTime() !== o.end.getTime();
      });
      if (conflict.length) setPendingConflict(conflict);
    },
    [rescheduleOnConflict, workingCalendar, reschedOpts],
  );

  const applyReschedule = React.useCallback(() => {
    if (!pendingConflict) return;
    const updates = pendingConflict
      .map((c) => {
        const task = tasksRef.current.find((tk) => String(tk.id) === c.id);
        return task ? { task, changes: { start: c.start, end: c.end } } : null;
      })
      .filter(Boolean) as Array<{ task: GanttTask; changes: { start: Date; end: Date } }>;
    if (updates.length) commitTaskUpdates(updates);
    setPendingConflict(null);
  }, [pendingConflict, commitTaskUpdates]);

  const applyHistory = React.useCallback(
    (batch: HistoryItem[], dir: 'undo' | 'redo') => {
      if (!onTaskUpdate) return;
      for (const item of batch) {
        const task = tasksRef.current.find((tk) => String(tk.id) === item.taskId);
        if (task) {
          onTaskUpdate(task, (dir === 'undo' ? item.before : item.after) as Partial<
            Pick<GanttTask, 'title' | 'start' | 'end' | 'progress'>
          >);
        }
      }
    },
    [onTaskUpdate],
  );

  const undo = React.useCallback(() => {
    const batch = undoStackRef.current.pop();
    if (!batch) return;
    applyHistory(batch, 'undo');
    redoStackRef.current.push(batch);
    setHistoryVersion((v) => v + 1);
  }, [applyHistory]);

  const redo = React.useCallback(() => {
    const batch = redoStackRef.current.pop();
    if (!batch) return;
    applyHistory(batch, 'redo');
    undoStackRef.current.push(batch);
    setHistoryVersion((v) => v + 1);
  }, [applyHistory]);

  // historyVersion bumps on every push/pop so these re-read the live refs.
  const { canUndo, canRedo } = React.useMemo(
    () => ({ canUndo: undoStackRef.current.length > 0, canRedo: redoStackRef.current.length > 0 }),
    [historyVersion],
  );

  // Window-level pointer listeners: track horizontal motion snapped to whole
  // columns (days/weeks/months/quarters depending on the active granularity),
  // commit via onTaskUpdate on pointerup, suppress the trailing click.
  React.useEffect(() => {
    if (!dragState) return;
    // In shift mode each drag step is one band wide (smallest band, so every
    // band boundary is reachable), not a whole day — so Δx / bandWidth = bands
    // moved, matching shiftByWorkingColumns walking band columns. In every
    // other granularity a step is one DAY of pixels (pxPerDay), matching
    // computeDragChanges advancing by days — coarse views (week/month/…) snap
    // per day instead of per column. In plain day view pxPerDay === columnWidth.
    const segActive = viewMode === 'day' && !!shiftSegments && shiftSegments.bands.length > 0;
    const dragColWidth = segActive && shiftSegments
      ? (pxPerDay * Math.min(...shiftSegments.bands.map((b) => b.durMs))) / MS_PER_DAY
      : pxPerDay;
    const onMove = (e: PointerEvent) => {
      const cur = dragStateRef.current;
      if (!cur) return;
      const next = Math.round((e.clientX - cur.originClientX) / Math.max(dragColWidth, 1));
      if (next !== cur.unitDelta) {
        setDragState({ ...cur, unitDelta: next });
      }
    };
    const onUp = () => {
      const cur = dragStateRef.current;
      if (!cur) return;
      if (cur.unitDelta !== 0) {
        const task = tasks.find(t => t.id === cur.taskId);
        if (task && onTaskUpdate) {
          const { start, end } = computeDragChanges(cur);
          if (cur.group) {
            // Move the summary and every descendant by the same move (see
            // groupMover) so the subtree keeps its internal spacing — recorded as
            // a single undoable batch. Locked (view-only) descendants stay put:
            // they must never be mutated, by drag or by group shift.
            const move = groupMover(cur.originStart, start, segActive);
            const shifted = [task, ...collectDescendants(task.id).filter((t) => !t.locked)].map((t) => ({
              task: t,
              changes: {
                start: move(t.start),
                end: move(t.end),
              },
            }));
            commitTaskUpdates(shifted);
            maybeFlagConflict(shifted);
          } else {
            const applied = [{ task, changes: { start, end } }];
            commitTaskUpdates(applied);
            maybeFlagConflict(applied);
          }
        }
        suppressNextClickRef.current = true;
        // Reset suppression on next animation frame after the click fires.
        window.setTimeout(() => { suppressNextClickRef.current = false; }, 0);
      }
      setDragState(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragState, columnWidth, pxPerDay, viewMode, shiftSegments, tasks, onTaskUpdate, computeDragChanges, collectDescendants, commitTaskUpdates, maybeFlagConflict]);

  const beginDrag = React.useCallback((
    task: GanttTask,
    mode: DragMode,
    e: React.PointerEvent,
    opts?: { group?: boolean; originStart?: Date; originEnd?: Date }
  ) => {
    // Synthetic Group-by rows have no real backing task to mutate; locked
    // view-only (locked) rows can't be dragged from any handle, summary bars included.
    if (!onTaskUpdate || task.data?.__group || task.locked) return;
    e.stopPropagation();
    e.preventDefault();
    setDragState({
      taskId: task.id,
      mode,
      group: opts?.group ?? false,
      // Summary bars pass their rollup range so the drag chip and snapping
      // reflect what is actually on screen, not the task's own raw dates.
      originStart: new Date(opts?.originStart ?? task.start),
      originEnd: new Date(opts?.originEnd ?? task.end),
      originClientX: e.clientX,
      unitDelta: 0,
    });
  }, [onTaskUpdate]);

  // --- Progress drag handle ------------------------------------------------
  // A grip at the progress boundary inside the bar; horizontal motion maps
  // 1:1 to percent of the bar width, committed via onTaskUpdate({progress}).
  const [progressDrag, setProgressDrag] = React.useState<{
    taskId: string | number;
    originClientX: number;
    originProgress: number;
    barWidth: number;
    value: number;
  } | null>(null);
  const progressDragRef = React.useRef<typeof progressDrag>(null);
  React.useEffect(() => { progressDragRef.current = progressDrag; }, [progressDrag]);

  React.useEffect(() => {
    if (!progressDrag) return;
    const onMove = (e: PointerEvent) => {
      const cur = progressDragRef.current;
      if (!cur) return;
      const next = Math.min(100, Math.max(0, Math.round(
        cur.originProgress + ((e.clientX - cur.originClientX) / Math.max(cur.barWidth, 1)) * 100
      )));
      if (next !== cur.value) setProgressDrag({ ...cur, value: next });
    };
    const onUp = () => {
      const cur = progressDragRef.current;
      if (!cur) return;
      if (cur.value !== cur.originProgress) {
        const task = tasks.find((t) => t.id === cur.taskId);
        if (task && onTaskUpdate) commitTaskUpdates([{ task, changes: { progress: cur.value } }]);
        suppressNextClickRef.current = true;
        window.setTimeout(() => { suppressNextClickRef.current = false; }, 0);
      }
      setProgressDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [progressDrag, tasks, onTaskUpdate, commitTaskUpdates]);

  // --- Drag-to-create dependency -------------------------------------------
  // Dragging the connector dot on a bar draws a dashed rubber band; releasing
  // over another bar fires onDependencyCreate(source, target, 'fs'). The
  // hovered target is tracked by bar-level pointermove (no pointer capture).

  // Dependency edges over the FULL task set — the visible-rows `links` memo
  // below drops edges inside collapsed subtrees, which must still count for
  // cycle detection.
  const dependencyEdges = React.useMemo(() => {
    const out: Array<[string, string]> = [];
    for (const t of tasks) {
      for (const dep of t.dependencies ?? []) {
        const depId = typeof dep === 'object' && dep !== null ? dep.id : dep;
        if (depId == null || depId === '') continue;
        out.push([String(depId), String(t.id)]);
      }
    }
    return out;
  }, [tasks]);

  // Built-in drop-target policy, applied both when a bar registers itself as
  // the hover target (no candidate highlight) and again on release (pointer
  // ordering isn't trusted): locked (view-only) rows and group headers can't
  // receive a dependency, and a link that would close a cycle is rejected.
  // ONE classifier, two consumers. The hover affordance and the drop toast
  // both read this verdict, so the reason a user is shown cannot drift from
  // the reason the link was actually refused (objectui#4158) — the branch
  // names ARE the `gantt.link.rejected.*` key leaves, so a new branch without
  // a message shows up as a missing key rather than a wrong sentence.
  const classifyLinkTarget = React.useCallback(
    (sourceId: string | number, target: GanttTask): GanttLinkRejection | null => {
      if (String(target.id) === String(sourceId)) return 'self';
      if (target.locked) return 'locked';
      if (target.type === 'group') return 'group';
      if (wouldCreateDependencyCycle(dependencyEdges, sourceId, target.id)) return 'cycle';
      return null;
    },
    [dependencyEdges],
  );
  const canReceiveLink = React.useCallback(
    (sourceId: string | number, target: GanttTask) => classifyLinkTarget(sourceId, target) === null,
    [classifyLinkTarget],
  );
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [linkDrag, setLinkDrag] = React.useState<{
    sourceId: string | number;
    sourceEnd: 'start' | 'end';
    x: number;
    y: number;
    targetId: string | number | null;
    targetEnd: 'start' | 'end' | null;
    // The bar under the pointer that the policy REFUSED. Tracked separately
    // from `targetId` because a refused bar must never become a drop target,
    // yet the release handler still has to know which row was refused and
    // why — before objectui#4158 that information was simply dropped, which
    // is what made the rejection silent.
    rejectedId: string | number | null;
    rejectedReason: GanttLinkRejection | null;
  } | null>(null);
  const linkDragRef = React.useRef<typeof linkDrag>(null);
  React.useEffect(() => { linkDragRef.current = linkDrag; }, [linkDrag]);

  React.useEffect(() => {
    if (!linkDrag) return;
    const onMove = (e: PointerEvent) => {
      const rect = contentRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setLinkDrag((prev) => (prev ? { ...prev, x, y } : prev));
    };
    const onUp = () => {
      const cur = linkDragRef.current;
      if (cur && cur.targetId != null && onDependencyCreate) {
        const source = tasks.find((t) => String(t.id) === String(cur.sourceId));
        const target = tasks.find((t) => String(t.id) === String(cur.targetId));
        // Derive the link type from which endpoint we dragged FROM and which
        // endpoint we dropped ONTO: the source endpoint picks
        // Finish (end) vs Start (start), the target endpoint picks the second
        // letter. end→start = FS, end→end = FF, start→start = SS, start→end = SF.
        const targetEnd = cur.targetEnd ?? 'start';
        // Data sources without a type slot (dependencyTypes:false) always
        // create FS — any other type would be silently lost on persist.
        const type: GanttLinkType = dependencyTypes
          ? (`${cur.sourceEnd === 'end' ? 'f' : 's'}${targetEnd === 'end' ? 'f' : 's'}` as GanttLinkType)
          : 'fs';
        if (
          source && target &&
          canReceiveLink(cur.sourceId, target) &&
          (onBeforeDependencyCreate?.(source, target, type) ?? true)
        ) {
          onDependencyCreate(source, target, type);
        }
      } else if (cur && cur.rejectedReason && onDependencyCreate) {
        // The drop landed on a bar the policy refused. Before objectui#4158
        // this branch did not exist and the release was a no-op, so the user
        // got no dialog, no toast and no console warning. The message is
        // selected by the classifier's own verdict — not re-derived here,
        // which would be a second classifier free to disagree with the guard.
        toast.error(t(`gantt.link.rejected.${cur.rejectedReason}`));
      }
      suppressNextClickRef.current = true;
      window.setTimeout(() => { suppressNextClickRef.current = false; }, 0);
      setLinkDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [linkDrag, tasks, onDependencyCreate, onBeforeDependencyCreate, canReceiveLink, dependencyTypes, t]);

  // --- Context menu ---------------------------------------------------------
  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number; taskId: string | number } | null>(null);
  const ctxMenuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!ctxMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ctxMenuRef.current && e.target instanceof Node && ctxMenuRef.current.contains(e.target)) return;
      setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  // --- Dependency link context menu (add/remove + link type) ----------------
  // Right-clicking a dependency link opens a small menu to switch its type
  // (FS/SS/FF/SF) or remove it. Closing mirrors the task context menu.
  const [linkCtxMenu, setLinkCtxMenu] = React.useState<{
    x: number;
    y: number;
    sourceId: string | number;
    targetId: string | number;
    type: GanttLinkType;
  } | null>(null);
  const linkCtxMenuRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!linkCtxMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (linkCtxMenuRef.current && e.target instanceof Node && linkCtxMenuRef.current.contains(e.target)) return;
      setLinkCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLinkCtxMenu(null); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [linkCtxMenu]);

  // --- "Add predecessor / successor" dependency picker -----------------------
  // (`gantt.menu.addPredecessor` / `gantt.menu.addSuccessor`)
  // A secondary panel that lists candidate tasks; choosing one creates a
  // dependency. `relation: 'pred'` makes the picked task a predecessor of the
  // anchor (anchor depends on picked); `'succ'` makes it a successor.
  const [depPicker, setDepPicker] = React.useState<{
    x: number;
    y: number;
    taskId: string | number;
    relation: 'pred' | 'succ';
  } | null>(null);
  // Search text for the candidate list — cleared on every open so a stale
  // query never hides candidates from the next picker invocation.
  const [depPickerQuery, setDepPickerQuery] = React.useState('');
  const depPickerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!depPicker) return;
    const onPointerDown = (e: PointerEvent) => {
      if (depPickerRef.current && e.target instanceof Node && depPickerRef.current.contains(e.target)) return;
      setDepPicker(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDepPicker(null); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [depPicker]);

  // --- Keyboard navigation ---------------------------------------------------
  // The gantt body is focusable; arrows move the selection, Enter opens,
  // Delete deletes, Left/Right collapse/expand summary rows.
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | number | null>(null);

  // The menu only ever lists actions whose callback is live; in read-only mode
  // those are all stripped, so opening it would show an empty popover. Select
  // the row (for keyboard nav / highlight) but suppress the empty menu.
  const hasTaskMenuActions = !!(onTaskClick || onTaskUpdate || onDependencyCreate || onTaskDelete);
  const openContextMenu = React.useCallback((task: GanttTask, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedTaskId(task.id);
    if (!hasTaskMenuActions) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, taskId: task.id });
  }, [hasTaskMenuActions]);

  const openLinkContextMenu = React.useCallback(
    (sourceId: string | number, targetId: string | number, type: GanttLinkType, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // No add/remove callbacks (e.g. read-only) → nothing actionable to show.
      if (!onDependencyCreate && !onDependencyDelete) return;
      setLinkCtxMenu({ x: e.clientX, y: e.clientY, sourceId, targetId, type });
    },
    [onDependencyCreate, onDependencyDelete],
  );

  // --- Task hierarchy -----------------------------------------------------
  // `task.parent` builds a tree; rows are the depth-first flattening with
  // collapsed subtrees removed. Summary rows (any task with children, or
  // explicit type 'summary') get their dates/progress rolled up from their
  // descendants; milestones are zero-duration diamonds.
  type GanttRow = {
    task: GanttTask;
    depth: number;
    hasChildren: boolean;
    isSummary: boolean;
    isMilestone: boolean;
    /** Effective dates/progress — children rollup for summary rows. */
    start: Date;
    end: Date;
    progress: number;
  };

  const [collapsedIds, setCollapsedIds] = React.useState<Set<string>>(
    () => new Set(restoredLayout?.collapsedIds ?? [])
  );
  const toggleCollapsed = React.useCallback((id: string | number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  // Seed the collapsed set once from `defaultCollapsedDepth`. We walk
  // the parent chain to derive each node's 0-indexed depth and fold every node
  // at/below the threshold that actually has children. Runs a single time so the
  // user's later expand/collapse is never clobbered by a data refresh.
  // A saved layout that recorded collapsedIds (even an empty list = all
  // expanded) IS the user's intent — skip the defaultCollapsedDepth seed.
  const defaultCollapseSeeded = React.useRef(restoredLayout?.collapsedIds != null);
  React.useEffect(() => {
    if (defaultCollapseSeeded.current) return;
    if (defaultCollapsedDepth == null || displayTasks.length === 0) return;
    defaultCollapseSeeded.current = true;
    const byId = new Map(displayTasks.map((t) => [String(t.id), t]));
    const hasChildren = new Set<string>();
    for (const t of displayTasks) {
      const p = t.parent != null && t.parent !== '' ? String(t.parent) : null;
      if (p && p !== String(t.id) && byId.has(p)) hasChildren.add(p);
    }
    // Depth via parent walk, cycle-guarded.
    const depthOf = (t: GanttTask): number => {
      let depth = 0;
      const seen = new Set<string>([String(t.id)]);
      let cur = t.parent != null && t.parent !== '' ? byId.get(String(t.parent)) : undefined;
      while (cur && !seen.has(String(cur.id))) {
        depth += 1;
        seen.add(String(cur.id));
        cur = cur.parent != null && cur.parent !== '' ? byId.get(String(cur.parent)) : undefined;
      }
      return depth;
    };
    const seed = new Set<string>();
    for (const t of displayTasks) {
      const key = String(t.id);
      if (hasChildren.has(key) && depthOf(t) >= defaultCollapsedDepth) seed.add(key);
    }
    if (seed.size) setCollapsedIds((prev) => (prev.size ? prev : seed));
  }, [defaultCollapsedDepth, displayTasks]);

  const rows = React.useMemo<GanttRow[]>(() => {
    const ids = new Set(displayTasks.map((t) => String(t.id)));
    const byParent = new Map<string, GanttTask[]>();
    const roots: GanttTask[] = [];
    for (const t of displayTasks) {
      const p = t.parent != null && t.parent !== '' ? String(t.parent) : null;
      // Orphans (unknown parent id) and self-parents render as roots.
      if (p && p !== String(t.id) && ids.has(p)) {
        const list = byParent.get(p);
        if (list) list.push(t);
        else byParent.set(p, [t]);
      } else {
        roots.push(t);
      }
    }

    // Post-order rollup: a summary spans its children and averages their
    // progress weighted by duration. `path` guards against parent cycles.
    const rollupCache = new Map<string, { start: Date; end: Date; progress: number }>();
    const rollup = (t: GanttTask, path: Set<string>): { start: Date; end: Date; progress: number } => {
      const key = String(t.id);
      const cached = rollupCache.get(key);
      if (cached) return cached;
      const children = byParent.get(key) ?? [];
      let result: { start: Date; end: Date; progress: number };
      if (!children.length || path.has(key)) {
        result = { start: t.start, end: t.end, progress: t.progress };
      } else {
        path.add(key);
        let start: Date | null = null;
        let end: Date | null = null;
        let weighted = 0;
        let total = 0;
        for (const c of children) {
          const r = rollup(c, path);
          if (!start || r.start < start) start = r.start;
          if (!end || r.end > end) end = r.end;
          const dur = Math.max(r.end.getTime() - r.start.getTime(), MS_PER_DAY);
          weighted += dur * r.progress;
          total += dur;
        }
        path.delete(key);
        result = { start: start!, end: end!, progress: total ? weighted / total : 0 };
      }
      rollupCache.set(key, result);
      return result;
    };

    const out: GanttRow[] = [];
    const visited = new Set<string>();
    const markSubtreeVisited = (t: GanttTask) => {
      for (const c of byParent.get(String(t.id)) ?? []) {
        if (!visited.has(String(c.id))) {
          visited.add(String(c.id));
          markSubtreeVisited(c);
        }
      }
    };
    const walk = (t: GanttTask, depth: number) => {
      const key = String(t.id);
      if (visited.has(key)) return;
      visited.add(key);
      const children = byParent.get(key) ?? [];
      const hasChildren = children.length > 0;
      const isSummary = hasChildren || t.type === 'summary';
      // summaryExtent 'self': the summary's own dates are authoritative — the
      // bar renders (and survives refetch at) exactly what the record says.
      // Date-less summaries (hasOwnDates === false, e.g. pure grouping levels)
      // still roll up from their children.
      const usesSelfExtent =
        hasChildren && summaryExtent === 'self' && t.hasOwnDates !== false;
      const eff = hasChildren && !usesSelfExtent
        ? rollup(t, new Set())
        : { start: t.start, end: t.end, progress: t.progress };
      const isMilestone =
        !isSummary && (t.type === 'milestone' || t.end.getTime() <= t.start.getTime());
      out.push({ task: t, depth, hasChildren, isSummary, isMilestone, ...eff });
      if (hasChildren) {
        if (collapsedIds.has(key)) {
          markSubtreeVisited(t); // hidden, but not re-surfaced by the cycle sweep
        } else {
          for (const c of children) walk(c, depth + 1);
        }
      }
    };
    for (const r of roots) walk(r, 0);
    // Parent cycles (a↔b) are unreachable from any root — surface them flat
    // at the bottom rather than dropping rows silently.
    for (const t of displayTasks) if (!visited.has(String(t.id))) walk(t, 0);
    return out;
  }, [displayTasks, collapsedIds, summaryExtent]);

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    // Undo / redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y.
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }
    if (!rows.length) return;
    const idx = selectedTaskId == null
      ? -1
      : rows.findIndex((r) => String(r.task.id) === String(selectedTaskId));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = e.key === 'ArrowDown'
        ? Math.min(rows.length - 1, idx + 1)
        : Math.max(0, idx <= 0 ? 0 : idx - 1);
      setSelectedTaskId(rows[next].task.id);
      // Keep the selected (possibly virtualized-out) row in view.
      const el = scrollAreaRef.current;
      if (el) {
        const top = next * rowHeight;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + rowHeight > el.scrollTop + el.clientHeight) {
          el.scrollTop = top + rowHeight - el.clientHeight;
        }
      }
      return;
    }
    if (idx < 0) return;
    const row = rows[idx];
    if (e.key === 'Enter') {
      e.preventDefault();
      onTaskClick?.(row.task);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (onTaskDelete) {
        e.preventDefault();
        onTaskDelete(row.task);
      }
    } else if (e.key === 'ArrowRight' && row.hasChildren && collapsedIds.has(String(row.task.id))) {
      e.preventDefault();
      toggleCollapsed(row.task.id);
    } else if (e.key === 'ArrowLeft' && row.hasChildren && !collapsedIds.has(String(row.task.id))) {
      e.preventDefault();
      toggleCollapsed(row.task.id);
    }
  }, [rows, selectedTaskId, onTaskClick, onTaskDelete, collapsedIds, toggleCollapsed, rowHeight, undo, redo]);

  // Calculate timeline range
  const timelineRange = React.useMemo(() => {
    let start = startDate ? new Date(startDate) : tzShift.now();
    let end = endDate ? new Date(endDate) : tzShift.now();
    
    if (!startDate && tasks.length > 0) {
      // Find min start date
      start = new Date(Math.min(...tasks.map(t => t.start.getTime())));
      // Add padding
      start.setDate(start.getDate() - 7);
    }
    
    if (!endDate && tasks.length > 0) {
      // Find max end date
      end = new Date(Math.max(...tasks.map(t => t.end.getTime())));
      // Add padding
      end.setDate(end.getDate() + 14);
    }
    
    // Snap the start to a column boundary of the active granularity so
    // bars (linear ms→px from range start) line up with the grid. In shift mode
    // the boundary is the shift-day start (e.g. 08:00), not calendar midnight,
    // so a cross-midnight night shift sits wholly inside one shift-day's band columns.
    if (viewMode === 'day' && shiftSegments && shiftSegments.bands.length > 0) {
      start = shiftDayStart(start, shiftSegments.dayStartMin);
    } else {
      start = startOfUnit(start, viewMode);
    }
    end.setHours(23,59,59,999);

    // NOTE: we deliberately do NOT pad the calendar to fill the viewport.
    // Adding empty trailing units would, in coarse modes, mean years of blank
    // columns (a 2.5-month project in month mode needs ~2.5 years of empty
    // months to reach the right edge). Instead the grid keeps its natural span
    // and `fitColumnWidth` stretches the column width so a short project still
    // fills the area — the industry "zoom to fit" approach.
    return { start, end };
  }, [startDate, endDate, tasks, viewMode, shiftSegments, tzShift]);

  // Non-linear working-time axis. In day mode, when a working
  // calendar marks weekends/holidays as non-working, those columns are DROPPED
  // from the grid entirely — Friday sits directly against Monday — so the
  // timeline shows only working time. This makes the date→px mapping non-linear
  // (a weekend spans zero pixels), which is why all positioning is routed
  // through `dateToX`/`xToDate` below rather than a flat ms→px factor.
  // Shift segmentation. In day mode, when a normalized shift config is
  // supplied, each day column is subdivided into its bands (day | night | …). Like
  // `folding` this makes the axis non-linear in px (bands have different widths),
  // so all positioning routes through `dateToX`/`xToDate`. Off → zero regression.
  const segmenting =
    viewMode === 'day' && !!shiftSegments && shiftSegments.bands.length > 0;

  const folding =
    !segmenting &&
    viewMode === 'day' &&
    !!workingCalendar &&
    (!!workingCalendar.skipWeekends || !!(workingCalendar.holidays && workingCalendar.holidays.size));

  const isWorkingColumn = React.useCallback(
    (date: Date): boolean => {
      if (!workingCalendar) return true;
      if (workingCalendar.skipWeekends) {
        const wd = date.getDay();
        if (wd === 0 || wd === 6) return false;
      }
      if (workingCalendar.holidays && workingCalendar.holidays.size) {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (workingCalendar.holidays.has(key)) return false;
      }
      return true;
    },
    [workingCalendar],
  );

  // Generate timeline columns — one per unit of the active granularity.
  // Widths follow the calendar at pxPerDay, so a 31-day month column is
  // slightly wider than a 30-day one and stays aligned with the bars.
  const timeColumns = React.useMemo(() => {
    const cols: {
      date: Date;
      label: string;
      sublabel?: string;
      isWeekend: boolean;
      width: number;
      /** Real calendar ms this column spans (band duration in shift mode). */
      realMs?: number;
      /** Band accent color for the column tint (shift mode only). */
      bandColor?: string;
    }[] = [];

    // Shift mode: emit one column per band, walking shift-day by shift-day.
    // Bands sum to 24h, so advancing the cursor by each band's duration lands
    // exactly on the next shift-day start — columns stay time-contiguous.
    if (segmenting && shiftSegments) {
      let cursor = new Date(timelineRange.start);
      while (cursor <= timelineRange.end) {
        for (const band of shiftSegments.bands) {
          const width = (band.durMs / MS_PER_DAY) * pxPerDay;
          cols.push({
            date: new Date(cursor),
            label: band.label,
            isWeekend: false,
            width,
            realMs: band.durMs,
            bandColor: band.color,
          });
          cursor = new Date(cursor.getTime() + band.durMs);
        }
      }
      return cols;
    }

    let current = new Date(timelineRange.start);

    while (current <= timelineRange.end) {
      const next = addUnits(current, 1, viewMode);
      // Fold non-working columns out of the grid (day mode + working calendar).
      if (folding && !isWorkingColumn(current)) {
        current = next;
        continue;
      }
      const width = ((next.getTime() - current.getTime()) / MS_PER_DAY) * pxPerDay;
      let label: string;
      let sublabel: string | undefined;
      if (viewMode === 'day') {
        label = String(current.getDate());
        sublabel = current.toLocaleDateString(dateLocale, { weekday: 'narrow' });
      } else if (viewMode === 'week') {
        label = current.toLocaleDateString(dateLocale, { month: 'numeric', day: 'numeric' });
      } else if (viewMode === 'month') {
        label = current.toLocaleDateString(dateLocale, { month: 'short' });
      } else if (viewMode === 'quarter') {
        label = `Q${Math.floor(current.getMonth() / 3) + 1}`;
      } else {
        label = String(current.getFullYear());
      }
      cols.push({
        date: new Date(current),
        label,
        sublabel,
        isWeekend: viewMode === 'day' && (current.getDay() === 0 || current.getDay() === 6),
        width,
      });
      current = next;
    }

    return cols;
  }, [timelineRange, viewMode, pxPerDay, dateLocale, folding, isWorkingColumn, segmenting, shiftSegments]);

  // Prefix sums of column widths — left edge of column i, used both for
  // positioning the virtualized cells and for the visible-range search.
  const colOffsets = React.useMemo(() => {
    const offs = new Array<number>(timeColumns.length + 1);
    let acc = 0;
    for (let i = 0; i < timeColumns.length; i++) {
      offs[i] = acc;
      acc += timeColumns[i].width;
    }
    offs[timeColumns.length] = acc;
    return offs;
  }, [timeColumns]);

  const totalWidth = colOffsets[colOffsets.length - 1];

  // Per-column real-time anchors for the non-linear date↔px mapping. `colStartMs`
  // is each column's start timestamp; `colRealMs` its real calendar duration
  // (one day / week / month / quarter — uneven months included). When the axis
  // folds weekends out, columns are no longer time-contiguous, so positioning
  // can't use a single ms→px factor; it interpolates within the owning column.
  const colStartMs = React.useMemo(() => timeColumns.map((c) => c.date.getTime()), [timeColumns]);
  const colRealMs = React.useMemo(
    () =>
      timeColumns.map((c) =>
        c.realMs != null ? c.realMs : addUnits(c.date, 1, viewMode).getTime() - c.date.getTime(),
      ),
    [timeColumns, viewMode],
  );

  // date → x (px). Binary-search the owning column, then interpolate within it.
  // For non-folded axes every column is time-contiguous, so this is exactly the
  // old linear `(ms / MS_PER_DAY) * pxPerDay`; for folded axes a date landing on
  // a dropped weekend column snaps to that column's working boundary.
  const dateToX = React.useCallback(
    (date: Date): number => {
      const n = timeColumns.length;
      if (n === 0) return 0;
      const t = date.getTime();
      let lo = 0;
      let hi = n - 1;
      let i = 0;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (colStartMs[m] <= t) {
          i = m;
          lo = m + 1;
        } else {
          hi = m - 1;
        }
      }
      const real = colRealMs[i] || MS_PER_DAY;
      let frac = (t - colStartMs[i]) / real;
      if (folding || segmenting) frac = Math.max(0, Math.min(frac, 1));
      return colOffsets[i] + frac * timeColumns[i].width;
    },
    [timeColumns, colStartMs, colRealMs, colOffsets, folding, segmenting],
  );

  // Index of the column that OWNS pixel x — the largest i with
  // colOffsets[i] <= x. Shared by `xToDate` (which then interpolates inside the
  // column) and by the toolbar's visible-period label (which must not
  // interpolate: a week column straddling a month boundary belongs, header-group
  // and label alike, to the month its START falls in).
  const colIndexAtX = React.useCallback(
    (x: number): number => {
      const n = timeColumns.length;
      if (n === 0) return -1;
      let lo = 0;
      let hi = n - 1;
      let i = 0;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (colOffsets[m] <= x) {
          i = m;
          lo = m + 1;
        } else {
          hi = m - 1;
        }
      }
      return i;
    },
    [timeColumns, colOffsets],
  );

  // x (px) → date. Inverse of dateToX, used by drag/resize to read the date
  // under the pointer. Never returns a folded (non-working) instant.
  const xToDate = React.useCallback(
    (x: number): Date => {
      const i = colIndexAtX(x);
      if (i < 0) return new Date(timelineRange.start);
      const w = timeColumns[i].width || 1;
      const frac = (x - colOffsets[i]) / w;
      return new Date(colStartMs[i] + frac * (colRealMs[i] || MS_PER_DAY));
    },
    [colIndexAtX, timeColumns, colStartMs, colRealMs, colOffsets, timelineRange],
  );

  // Switch granularity *without* the date window jumping. The scroll container
  // keeps a raw pixel scrollLeft across a re-render, but a Day→Month switch
  // shrinks the timeline ~5×, so that same pixel offset lands on a wildly
  // different (usually clamped-to-edge) date — which is what users read as
  // "jumbled". Instead we record the date sitting at the *left edge* of the viewport
  // now (via the current xToDate) and pin that same date back to the left edge
  // once the new layout is measured — so the leftmost visible date never moves.
  const changeViewMode = React.useCallback(
    (mode: GanttViewMode) => {
      const el = scrollAreaRef.current;
      // Seed the persistent anchor from the current left edge the first time (or
      // if a programmatic scroll left it unset); afterwards user scrolls keep it
      // fresh. Crucially we re-pin THIS precise date, not a freshly-read (and
      // possibly clamped) scrollLeft — so a coarser intermediate view that can't
      // scroll to it doesn't corrupt the anchor for the next switch.
      if (viewAnchorDateRef.current == null && el && el.clientWidth > 0) {
        viewAnchorDateRef.current = xToDate(el.scrollLeft);
      }
      pendingViewAnchorRef.current = viewAnchorDateRef.current;
      // Freeze the anchor across the switch: ignore the programmatic re-pin AND
      // any browser auto-clamp scroll the narrower layout triggers, until the
      // user genuinely scrolls again.
      blockAnchorUntilUserScrollRef.current = true;
      setViewMode(mode);
      onViewChange?.(mode);
    },
    [onViewChange, xToDate],
  );
  // Re-pin the captured anchor to the left edge after the granularity change has
  // produced a new dateToX mapping and total width. useLayoutEffect runs
  // post-DOM / pre-paint, so the scroll lands before the user sees the new view
  // — no flash of the wrong window. The ref is null for any other dateToX change
  // (zoom, fold toggle, task edits), so those are untouched.
  React.useLayoutEffect(() => {
    const anchor = pendingViewAnchorRef.current;
    if (anchor == null) return;
    pendingViewAnchorRef.current = null;
    const el = scrollAreaRef.current;
    if (!el || el.clientWidth === 0) return;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    // Snap the left edge to the start of the period the anchor falls in (the
    // week/month/quarter/year that contains it), so the leftmost column is a
    // full, aligned cell instead of a partial slice with a mismatched header
    // (e.g. Apr 9 in Week view would otherwise leave a stub of the Apr 6 week
    // showing, labelled by the *next* full week). The precise anchor is still
    // held in viewAnchorDateRef, so a later switch back to a finer scale lands
    // on the exact day — snapping only affects what coarser views display.
    const target = Math.max(0, Math.min(Math.round(dateToX(startOfUnit(anchor, viewMode))), maxLeft));
    // The gate (armed in changeViewMode) already keeps this programmatic move —
    // and any browser auto-clamp it triggers — from re-capturing the anchor.
    if (el.scrollLeft !== target) {
      el.scrollLeft = target;
    }
  }, [viewMode, dateToX]);

  // Shift a date by N visible columns honouring the fold: +1 column from a
  // Friday lands on Monday, skipping the dropped weekend. Used by drag/resize
  // when the axis is folded so a one-column drag = one working day.
  const shiftByWorkingColumns = React.useCallback(
    (date: Date, n: number): Date => {
      const len = timeColumns.length;
      if (len === 0 || n === 0) return new Date(date);
      const t = date.getTime();
      let lo = 0;
      let hi = len - 1;
      let idx = 0;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (colStartMs[m] <= t) {
          idx = m;
          lo = m + 1;
        } else {
          hi = m - 1;
        }
      }
      const target = Math.min(len - 1, Math.max(0, idx + n));
      const offset = t - colStartMs[idx]; // preserve intra-day time-of-day
      return new Date(colStartMs[target] + offset);
    },
    [timeColumns, colStartMs],
  );

  // computeDragChanges (defined above) advances by whole units via addUnits in
  // the common case; when the axis folds, it routes through working columns so
  // a drag tracks the compressed grid. The ref keeps that callback stable.
  const foldShiftRef = React.useRef<((date: Date, n: number) => Date) | null>(null);
  // Both folding (skip non-working columns) and segmenting (snap to band
  // boundaries) advance a drag by visible columns; shiftByWorkingColumns walks
  // colStartMs, which is band starts in shift mode → a one-column drag = one band.
  foldShiftRef.current = folding || segmenting ? shiftByWorkingColumns : null;

  // Upper scale row: month groups under day/week, year groups under
  // month/quarter, decade groups under year.
  const headerGroups = React.useMemo(() => {
    const groups: { key: string; label: string; width: number; offset: number }[] = [];
    // Shift mode: the upper tier is the shift-day. All bands of one
    // shift-day share its `shiftDayStart`, so grouping by it yields one cell per
    // day spanning its day|night band columns, labelled by the day's date.
    if (segmenting && shiftSegments) {
      let acc = 0;
      for (const col of timeColumns) {
        const key = String(shiftDayStart(col.date, shiftSegments.dayStartMin).getTime());
        const last = groups[groups.length - 1];
        if (last && last.key === key) {
          last.width += col.width;
        } else {
          groups.push({
            key,
            label: col.date.toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' }),
            width: col.width,
            offset: acc,
          });
        }
        acc += col.width;
      }
      return groups;
    }
    const groupBy: 'decade' | 'year' | 'month' =
      viewMode === 'year' ? 'decade' : viewMode === 'month' || viewMode === 'quarter' ? 'year' : 'month';
    let acc = 0;
    for (const col of timeColumns) {
      const year = col.date.getFullYear();
      const decade = Math.floor(year / 10) * 10;
      const key =
        groupBy === 'decade' ? String(decade) : groupBy === 'year' ? String(year) : `${year}-${col.date.getMonth()}`;
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.width += col.width;
      } else {
        groups.push({
          key,
          label:
            groupBy === 'decade'
              ? `${decade}s`
              : groupBy === 'year'
                ? String(year)
                : col.date.toLocaleDateString(dateLocale, { month: 'short', year: 'numeric' }),
          width: col.width,
          offset: acc,
        });
      }
      acc += col.width;
    }
    return groups;
  }, [timeColumns, viewMode, dateLocale, segmenting, shiftSegments]);

  // Normalized custom markers (invalid/out-of-range dates dropped), positioned
  // through the same date→px mapping the bars and the Today line use so they
  // stay aligned when the axis folds non-working time.
  const resolvedMarkers = React.useMemo(() => {
    return (markers ?? [])
      .map((m, i) => {
        // `toDisplayDate` reads a date-only string at LOCAL midnight of its
        // day; the engine's own parse read UTC midnight, which stood the line
        // on the previous day west of UTC (objectui#10866). A `Date` passes.
        const date = toDisplayDate(m.date);
        return {
          index: i,
          label: m.label,
          color: m.color || 'hsl(var(--primary))',
          left: Math.round(dateToX(date)),
          valid: !isNaN(date.getTime()) && date >= timelineRange.start && date <= timelineRange.end,
        };
      })
      .filter((m) => m.valid);
  }, [markers, timelineRange, dateToX]);

  const headerRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const timelineRef = React.useRef<HTMLDivElement>(null);
  // Wrapper around the scroll-syncing timeline body, so the pinch handler
  // and the "Today" button can target a stable node.
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);

  // Clear the anchor gate on genuine user-input scrolling. A scroll *event*
  // alone can't tell a user wheel from a browser auto-clamp, so we key off the
  // input events that precede a real scroll: wheel, touch, scrollbar drag
  // (pointerdown), and keyboard (arrows/page/space/home/end). Once cleared,
  // handleScroll resumes tracking the left-edge date as the anchor — until the
  // next granularity switch re-arms the gate.
  React.useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const unblock = () => {
      blockAnchorUntilUserScrollRef.current = false;
    };
    const SCROLL_KEYS = new Set([
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
    ]);
    const onKey = (ev: KeyboardEvent) => {
      if (SCROLL_KEYS.has(ev.key)) unblock();
    };
    el.addEventListener('wheel', unblock, { passive: true });
    el.addEventListener('touchstart', unblock, { passive: true });
    el.addEventListener('pointerdown', unblock, { passive: true });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', unblock);
      el.removeEventListener('touchstart', unblock);
      el.removeEventListener('pointerdown', unblock);
      el.removeEventListener('keydown', onKey);
    };
  }, []);

  // Locate flash: id of the bar currently pulsing after a "locate" click, plus the
  // pending timers that toggle it on/off (cleared on re-trigger and unmount).
  const [flashTaskId, setFlashTaskId] = React.useState<string | number | null>(null);
  const flashTimerRef = React.useRef<number[]>([]);
  // Tears down an in-flight "scroll then flash" wait (scrollend listener + rAF)
  // when a new locate fires or the view unmounts.
  const flashCleanupRef = React.useRef<(() => void) | null>(null);

  // --- Virtualization ------------------------------------------------------
  // Rows and timeline columns render only what's in (or near) the viewport,
  // so the chart stays responsive with thousands of tasks / multi-year day
  // scales. Fallbacks cover jsdom (client sizes report 0 there).
  const [scrollPos, setScrollPos] = React.useState({ top: 0, left: 0 });
  const [viewport, setViewport] = React.useState({ width: 4000, height: 600 });
  const measureViewport = React.useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const width = el.clientWidth || 4000;
    const height = el.clientHeight || 600;
    setViewport((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);
  React.useLayoutEffect(() => {
    measureViewport();
    const el = scrollAreaRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureViewport);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measureViewport]);

  // Visible windows. Overscan keeps scrolling seamless; the column margin is
  // in px (columns have calendar-variable widths), the row margin in rows.
  const COL_OVERSCAN_PX = 240;
  const ROW_OVERSCAN = 6;
  const colWindow = React.useMemo(
    () => visibleRange(colOffsets, scrollPos.left - COL_OVERSCAN_PX, scrollPos.left + viewport.width + COL_OVERSCAN_PX),
    [colOffsets, scrollPos.left, viewport.width]
  );
  const groupOffsets = React.useMemo(() => {
    const offs = headerGroups.map((g) => g.offset);
    offs.push(totalWidth);
    return offs;
  }, [headerGroups, totalWidth]);
  const groupWindow = React.useMemo(
    () => visibleRange(groupOffsets, scrollPos.left - COL_OVERSCAN_PX, scrollPos.left + viewport.width + COL_OVERSCAN_PX),
    [groupOffsets, scrollPos.left, viewport.width]
  );
  const rowWindow = React.useMemo(() => {
    const startIdx = Math.max(0, Math.floor(scrollPos.top / rowHeight) - ROW_OVERSCAN);
    const endIdx = Math.min(rows.length, Math.ceil((scrollPos.top + viewport.height) / rowHeight) + ROW_OVERSCAN);
    return { startIdx, endIdx };
  }, [scrollPos.top, viewport.height, rowHeight, rows.length]);
  const totalRowsHeight = rows.length * rowHeight;

  // --- Toolbar period: label + prev/next steppers ---------------------------
  // Both are derived from the VISIBLE WINDOW, never from `timelineRange` — the
  // whole-dataset memo, whose start is the first unit of the entire result set
  // and does not move when the chart is scrolled, because it is not a function
  // of scroll position at all (objectui#7203). The left edge of the viewport
  // picks the owning column; that column's own start date, snapped to the tier
  // `headerGroups` bands by, is the period on screen — so the toolbar label and
  // the band header four pixels below it agree by construction rather than by
  // two parallel derivations that can drift apart.
  const periodTier = periodTierFor(viewMode, segmenting);
  const visiblePeriodStart = React.useMemo(() => {
    const i = colIndexAtX(scrollPos.left);
    // Snap the COLUMN's start, not the interpolated instant under the pixel: a
    // week column straddling a month boundary belongs to the month its start
    // falls in, which is exactly how `headerGroups` keys it.
    const anchor = i >= 0 ? timeColumns[i].date : timelineRange.start;
    return startOfPeriod(anchor, periodTier, shiftSegments?.dayStartMin ?? 0);
  }, [colIndexAtX, scrollPos.left, timeColumns, timelineRange, periodTier, shiftSegments]);

  const periodLabel = React.useMemo(
    () => formatPeriodLabel(visiblePeriodStart, periodTier, dateLocale),
    [visiblePeriodStart, periodTier, dateLocale],
  );

  // Scroll the visible window one period backwards/forwards — what the toolbar's
  // ChevronLeft/ChevronRight drive. Clamped against the same totalWidth/viewport
  // pair the virtualization windows use, so the two never disagree about where
  // the content ends. `scrollPos` is pushed here as well as from the scroll
  // event because that event is queued (async) and a clamped assignment at
  // either end of the range fires none at all — the label has to follow the
  // move either way. Same "drive virtualization directly" reason as
  // `handleListScroll` below.
  const stepPeriod = React.useCallback(
    (delta: number) => {
      const el = scrollAreaRef.current;
      if (!el) return;
      const target = addPeriods(visiblePeriodStart, delta, periodTier);
      const maxLeft = Math.max(0, totalWidth - viewport.width);
      const left = Math.max(0, Math.min(Math.round(dateToX(target)), maxLeft));
      el.scrollLeft = left;
      setScrollPos((prev) => (prev.left === left ? prev : { ...prev, left }));
    },
    [visiblePeriodStart, periodTier, totalWidth, viewport.width, dateToX],
  );

  // --- Fullscreen -----------------------------------------------------------
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  React.useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void el.requestFullscreen?.();
    }
  }, []);

  // Pinch-to-zoom state. Track distance between two touch points; deltas
  // adjust the column width within [15, 120].
  const pinchState = React.useRef<{ baseDistance: number; baseColumn: number } | null>(null);
  const onTouchStart = React.useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchState.current = {
        baseDistance: Math.max(1, Math.sqrt(dx * dx + dy * dy)),
        baseColumn: columnWidth,
      };
    }
  }, [columnWidth]);
  const onTouchMove = React.useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2 || !pinchState.current) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const ratio = distance / pinchState.current.baseDistance;
    const next = Math.max(15, Math.min(120, Math.round(pinchState.current.baseColumn * ratio)));
    setColumnWidthOverride(next);
  }, []);
  const onTouchEnd = React.useCallback(() => { pinchState.current = null; }, []);

  // Compute the index (and pixel offset) of "today" within the timeline so
  // we can render a sticky marker AND scroll to it on demand.
  const todayLeftPx = React.useMemo(() => {
    const now = tzShift.now();
    if (now < timelineRange.start || now > timelineRange.end) return null;
    return Math.round(dateToX(now));
  }, [timelineRange, dateToX, tzShift]);
  const jumpToToday = React.useCallback(() => {
    if (todayLeftPx == null || !scrollAreaRef.current) return;
    const target = Math.max(0, todayLeftPx - scrollAreaRef.current.clientWidth / 2);
    scrollAreaRef.current.scrollTo({ left: target, behavior: 'smooth' });
  }, [todayLeftPx]);

  // One-shot initial scroll: open the timeline where the work is, not at the
  // padded left edge. Prefer today (when in range); otherwise the earliest
  // task's start. Runs once after layout is measurable — without this, a board
  // whose tasks sit weeks into the range opens on empty columns (issue: Gantt
  // landed on a blank window).
  const didInitialScrollRef = React.useRef(false);
  React.useEffect(() => {
    if (didInitialScrollRef.current || tasks.length === 0) return;
    const raf = window.requestAnimationFrame(() => {
      const el = scrollAreaRef.current;
      if (!el || el.clientWidth === 0) return; // layout not ready yet — retry next render
      let targetX = todayLeftPx;
      if (targetX == null) {
        const earliest = new Date(Math.min(...tasks.map((t) => t.start.getTime())));
        targetX = Math.round(dateToX(earliest));
      }
      el.scrollLeft = Math.max(0, targetX - el.clientWidth / 2);
      didInitialScrollRef.current = true;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [tasks, todayLeftPx, dateToX]);

  // Navigation: scroll the timeline so a given date sits near the left edge. Returns
  // false (no-op) when the date is outside the rendered range.
  const scrollToDate = React.useCallback(
    (date: Date, align: 'left' | 'center' = 'left') => {
      const el = scrollAreaRef.current;
      if (!el || date < timelineRange.start || date > timelineRange.end) return false;
      const x = Math.round(dateToX(date));
      const target = align === 'center' ? x - el.clientWidth / 2 : x - 24;
      el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      return true;
    },
    [timelineRange, dateToX],
  );
  // Locate a record: scroll the timeline so a row's bar is centered horizontally,
  // triggered by the locate icon in the task list's End column. Centers on the
  // bar's midpoint and clamps so an out-of-range edge still lands on-screen.
  const scrollToTask = React.useCallback(
    (start: Date, end: Date, taskId?: string | number) => {
      const el = scrollAreaRef.current;
      if (!el) return;
      // Align to the bar's *start* (not its midpoint): a long bar centered on
      // its middle pushes its beginning off the left edge, so the start — the
      // part the user is looking for — is what we bring into view, with a small
      // margin so it isn't jammed against the panel divider. When the whole bar
      // fits this also shows it in full.
      const startX = dateToX(start);
      const endX = dateToX(end);
      const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const leftMargin = Math.min(96, el.clientWidth * 0.15);
      // For a bar that already fits, prefer centering it; otherwise pin the
      // start near the left so its beginning is always visible.
      const fits = endX - startX <= el.clientWidth - leftMargin;
      const desired = fits
        ? (startX + endX) / 2 - el.clientWidth / 2
        : startX - leftMargin;
      const target = Math.max(0, Math.min(desired, maxLeft));

      // Tear down any pending flash from a previous click before starting over.
      flashTimerRef.current.forEach((id) => window.clearTimeout(id));
      flashTimerRef.current = [];
      flashCleanupRef.current?.();
      flashCleanupRef.current = null;
      setFlashTaskId(null);

      // Flash highlight: pulse the bar *after* the scroll lands so the eye catches it
      // where it settles, not mid-flight. rAF restarts the CSS animation cleanly
      // even when the same row is located twice; auto-clears when it finishes.
      const startFlash = () => {
        if (taskId == null) return;
        const raf = window.requestAnimationFrame(() => {
          setFlashTaskId(taskId);
          flashTimerRef.current.push(
            window.setTimeout(
              () => setFlashTaskId((cur) => (cur === taskId ? null : cur)),
              1500, // matches the gantt-flash animation duration
            ),
          );
        });
        flashCleanupRef.current = () => window.cancelAnimationFrame(raf);
      };

      const needsScroll = Math.abs(el.scrollLeft - target) > 2;
      el.scrollTo({ left: target, behavior: 'smooth' });
      if (!needsScroll) {
        startFlash();
        return;
      }

      // `scrollend` is the precise "smooth scroll finished" signal and drives
      // the flash where supported; the timeout only backstops it. When the
      // browser fires `scrollend` we give it a long leash (a wide chart can
      // take ~1s to traverse) so the event — not the clock — wins; without it
      // (older Safari) we fall back to a short, fixed delay.
      const hasScrollEnd = 'onscrollend' in el;
      let fired = false;
      const onEnd = () => {
        if (fired) return;
        fired = true;
        el.removeEventListener('scrollend', onEnd);
        startFlash();
      };
      el.addEventListener('scrollend', onEnd);
      flashTimerRef.current.push(window.setTimeout(onEnd, hasScrollEnd ? 1500 : 500));
      flashCleanupRef.current = () => el.removeEventListener('scrollend', onEnd);
    },
    [dateToX],
  );
  React.useEffect(
    () => () => {
      flashTimerRef.current.forEach((id) => window.clearTimeout(id));
      flashCleanupRef.current?.();
    },
    [],
  );
  const jumpToWeek = React.useCallback(
    () => scrollToDate(startOfUnit(tzShift.now(), 'week')),
    [scrollToDate, tzShift],
  );
  const jumpToMonth = React.useCallback(
    () => scrollToDate(startOfUnit(tzShift.now(), 'month')),
    [scrollToDate, tzShift],
  );

  // --- Always-visible horizontal scrollbar (self-drawn) -------------------
  // The native bar can't be relied on here: overlay-scrollbar engines (macOS
  // "show while scrolling", embedded Chromium) silently ignore the
  // ::-webkit-scrollbar styling injected above, and in tall host layouts the
  // pane's bottom edge sits below the viewport so even a rendered bar is out
  // of sight. So we draw our own track + thumb, stickied to the visible
  // bottom, synced 1:1 with the timeline's scrollLeft. Everything is
  // DOM-ref-driven — no per-frame React state.
  const hBarRef = React.useRef<HTMLDivElement>(null);
  const hTrackRef = React.useRef<HTMLDivElement>(null);
  const hThumbRef = React.useRef<HTMLDivElement>(null);
  const hDragRef = React.useRef<{ startX: number; startLeft: number } | null>(null);
  const vBarRef = React.useRef<HTMLDivElement>(null);
  const vTrackRef = React.useRef<HTMLDivElement>(null);
  const vThumbRef = React.useRef<HTMLDivElement>(null);
  const vDragRef = React.useRef<{ startY: number; startTop: number } | null>(null);
  const syncHScrollbar = React.useCallback(() => {
    const tl = timelineRef.current;
    const bar = hBarRef.current;
    const track = hTrackRef.current;
    const thumb = hThumbRef.current;
    if (tl && bar && track && thumb) {
      const needed = tl.scrollWidth > tl.clientWidth + 1;
      bar.style.display = needed ? 'block' : 'none';
      if (needed) {
        const trackW = track.clientWidth;
        if (trackW > 0) {
          const thumbW = Math.min(trackW, Math.max(40, (tl.clientWidth / tl.scrollWidth) * trackW));
          const maxScroll = tl.scrollWidth - tl.clientWidth;
          const left = maxScroll > 0 ? (tl.scrollLeft / maxScroll) * (trackW - thumbW) : 0;
          thumb.style.width = `${thumbW}px`;
          thumb.style.transform = `translateX(${left}px)`;
        }
      }
    }
    // Vertical twin — same math on the other axis.
    const vBar = vBarRef.current;
    const vTrack = vTrackRef.current;
    const vThumb = vThumbRef.current;
    if (tl && vBar && vTrack && vThumb) {
      const needed = tl.scrollHeight > tl.clientHeight + 1;
      vBar.style.display = needed ? 'block' : 'none';
      if (needed) {
        const trackH = vTrack.clientHeight;
        if (trackH > 0) {
          const thumbH = Math.min(trackH, Math.max(40, (tl.clientHeight / tl.scrollHeight) * trackH));
          const maxScroll = tl.scrollHeight - tl.clientHeight;
          const top = maxScroll > 0 ? (tl.scrollTop / maxScroll) * (trackH - thumbH) : 0;
          vThumb.style.height = `${thumbH}px`;
          vThumb.style.transform = `translateY(${top}px)`;
        }
      }
    }
  }, []);
  // Re-measure after every render: cheap (a couple of style writes) and it
  // tracks every input that moves the geometry — zoom, view mode, container
  // resize, task-list drag — without enumerating them as deps.
  React.useEffect(() => { syncHScrollbar(); });
  const onHThumbPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tl = timelineRef.current;
    const track = hTrackRef.current;
    const thumb = hThumbRef.current;
    if (!tl || !track || !thumb) return;
    hDragRef.current = { startX: e.clientX, startLeft: tl.scrollLeft };
    const trackW = track.clientWidth;
    const thumbW = thumb.getBoundingClientRect().width;
    const maxScroll = tl.scrollWidth - tl.clientWidth;
    const pxRatio = trackW - thumbW > 0 ? maxScroll / (trackW - thumbW) : 0;
    const onMove = (ev: PointerEvent) => {
      const cur = hDragRef.current;
      if (!cur) return;
      tl.scrollLeft = cur.startLeft + (ev.clientX - cur.startX) * pxRatio;
    };
    const onUp = () => {
      hDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const onHTrackPointerDown = (e: React.PointerEvent) => {
    // Clicking the empty track jumps the view; hits on the thumb itself are
    // handled (and stopped) by the thumb's own pointerdown.
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const tl = timelineRef.current;
    const track = hTrackRef.current;
    const thumb = hThumbRef.current;
    if (!tl || !track || !thumb) return;
    const r = track.getBoundingClientRect();
    const thumbW = thumb.getBoundingClientRect().width;
    const maxScroll = tl.scrollWidth - tl.clientWidth;
    const usable = r.width - thumbW;
    if (usable <= 0) return;
    const targetLeft = Math.min(Math.max(e.clientX - r.x - thumbW / 2, 0), usable);
    tl.scrollLeft = (targetLeft / usable) * maxScroll;
  };
  const onVThumbPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const tl = timelineRef.current;
    const track = vTrackRef.current;
    const thumb = vThumbRef.current;
    if (!tl || !track || !thumb) return;
    vDragRef.current = { startY: e.clientY, startTop: tl.scrollTop };
    const trackH = track.clientHeight;
    const thumbH = thumb.getBoundingClientRect().height;
    const maxScroll = tl.scrollHeight - tl.clientHeight;
    const pxRatio = trackH - thumbH > 0 ? maxScroll / (trackH - thumbH) : 0;
    const onMove = (ev: PointerEvent) => {
      const cur = vDragRef.current;
      if (!cur) return;
      tl.scrollTop = cur.startTop + (ev.clientY - cur.startY) * pxRatio;
    };
    const onUp = () => {
      vDragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const onVTrackPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const tl = timelineRef.current;
    const track = vTrackRef.current;
    const thumb = vThumbRef.current;
    if (!tl || !track || !thumb) return;
    const r = track.getBoundingClientRect();
    const thumbH = thumb.getBoundingClientRect().height;
    const maxScroll = tl.scrollHeight - tl.clientHeight;
    const usable = r.height - thumbH;
    if (usable <= 0) return;
    const targetTop = Math.min(Math.max(e.clientY - r.y - thumbH / 2, 0), usable);
    tl.scrollTop = (targetTop / usable) * maxScroll;
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // Track the left-edge date as the user's anchor intent — but only for
    // genuine user scrolling. The gate stays armed through a granularity switch
    // (programmatic re-pin + browser auto-clamp of the narrower layout) and is
    // cleared only by real user input, so those synthetic scrolls can't
    // overwrite the precise date we're preserving.
    if (!blockAnchorUntilUserScrollRef.current && el.clientWidth > 0) {
      viewAnchorDateRef.current = xToDate(el.scrollLeft);
    }
    // Sync horizontal scroll to header
    if (headerRef.current) {
        headerRef.current.scrollLeft = el.scrollLeft;
    }
    // Sync the self-drawn horizontal scrollbar thumb.
    syncHScrollbar();
    // Sync vertical scroll to task list. Assign only when it differs so the
    // browser fires no scroll event on the list (a no-op assignment is silent),
    // which is what keeps the two-way sync below from looping.
    if (listRef.current && listRef.current.scrollTop !== el.scrollTop) {
        listRef.current.scrollTop = el.scrollTop;
    }
    // Drive the virtualization windows.
    setScrollPos((prev) =>
      prev.top === el.scrollTop && prev.left === el.scrollLeft
        ? prev
        : { top: el.scrollTop, left: el.scrollLeft }
    );
    measureViewport();
  };

  // The task list is its own vertical scroller (so users can scroll the left
  // pane directly with a wheel/trackpad/scrollbar, not only the timeline). Push
  // its scrollTop onto the timeline — whose handleScroll then drives the shared
  // virtualization window and mirrors back. The "assign only if different" guard
  // on both sides makes this self-terminating: the mirror-back lands on an equal
  // value, so the browser emits no further scroll event.
  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const listEl = e.currentTarget;
    const timeline = scrollAreaRef.current;
    if (timeline && timeline.scrollTop !== listEl.scrollTop) {
      timeline.scrollTop = listEl.scrollTop;
    }
    // Drive virtualization directly too: the timeline's scroll event is queued
    // (async), so updating here avoids a one-frame blank in the left pane during
    // a fast drag of its scrollbar.
    setScrollPos((prev) => (prev.top === listEl.scrollTop ? prev : { ...prev, top: listEl.scrollTop }));
  };

  const styleFor = (start: Date, end: Date) => {
    // Route both edges through dateToX so bars compress with the axis when
    // non-working time folds out. For non-folded axes this is identical to the
    // old linear mapping (`(ms / MS_PER_DAY) * pxPerDay`).
    const left = dateToX(start);
    // Min one unit, and never thinner than 3px so the bar stays visible (and
    // grabbable) at coarse granularities where a day is only ~2px. In shift mode
    // the unit is the smallest band, so a single-shift bar isn't padded to a day.
    const minUnitPx =
      segmenting && shiftSegments
        ? (pxPerDay * Math.min(...shiftSegments.bands.map((b) => b.durMs))) / MS_PER_DAY
        : pxPerDay;
    const width = Math.max(dateToX(end) - left, minUnitPx, 3);

    return { left, width };
  };

  // Ids previewed by an in-flight summary drag (the summary + its subtree).
  // Depends on the dragged id only, not on every unitDelta tick.
  const dragGroupTaskId = dragState?.group ? dragState.taskId : null;
  const dragGroupIds = React.useMemo(() => {
    if (dragGroupTaskId == null) return null;
    const set = new Set<string>([String(dragGroupTaskId)]);
    // Locked descendants don't move on commit, so don't preview them moving.
    for (const d of collectDescendants(dragGroupTaskId)) if (!d.locked) set.add(String(d.id));
    return set;
  }, [dragGroupTaskId, collectDescendants]);

  // Ancestor summaries of the task being dragged on its own (not a group
  // drag). They stretch live so the parent bar grows/shrinks in real time as
  // the child crosses the parent's current extent, matching the rollup that
  // commits on drop. Null when no single-task drag is active.
  const dragStretchAncestorIds = React.useMemo(() => {
    if (!dragState || dragState.group) return null;
    const set = new Set<string>();
    const guard = new Set<string>();
    let cur = taskById.get(String(dragState.taskId));
    while (cur && cur.parent != null && cur.parent !== '') {
      const pk = String(cur.parent);
      if (guard.has(pk) || !taskById.has(pk)) break;
      guard.add(pk);
      set.add(pk);
      cur = taskById.get(pk);
    }
    return set.size ? set : null;
  }, [dragState, taskById]);

  // Row geometry (summary rollup applied) with the in-flight drag preview,
  // so dependency links follow the bar while it is being moved/resized.
  const getLiveRowStyle = (row: GanttRow) => {
    if (dragState) {
      if (dragGroupIds?.has(String(row.task.id))) {
        // Whole-group preview: every row in the subtree shifts by the same
        // move as the dragged summary bar, as the drop commits it.
        const previewed = computeDragChanges(dragState);
        const move = groupMover(dragState.originStart, previewed.start, segmenting);
        return styleFor(move(row.start), move(row.end));
      }
      // The dragged bar itself under a NON-group drag: a leaf move/resize, or a
      // self-extent summary resizing its own dates. Group moves are handled
      // above via dragGroupIds (which already includes the dragged summary).
      if (dragState.taskId === row.task.id && !dragState.group) {
        const previewed = computeDragChanges(dragState);
        return styleFor(previewed.start, previewed.end);
      }
      if (
        row.isSummary &&
        dragStretchAncestorIds?.has(String(row.task.id)) &&
        // Self-extent summaries don't stretch with their children — their bar
        // is pinned to their own dates, which a child drag doesn't change.
        !(summaryExtent === 'self' && row.task.hasOwnDates !== false)
      ) {
        // Re-roll this ancestor's span over its leaf descendants, substituting
        // the dragged leaf's previewed dates. Summary tasks' own start/end are
        // ignored (they may be placeholders); only leaves define the extent.
        const previewed = computeDragChanges(dragState);
        const draggedId = String(dragState.taskId);
        let minStart: Date | null = null;
        let maxEnd: Date | null = null;
        for (const d of collectDescendants(row.task.id)) {
          const isLeaf = (childrenByParent.get(String(d.id)) ?? []).length === 0;
          if (!isLeaf) continue;
          const s = String(d.id) === draggedId ? previewed.start : d.start;
          const e = String(d.id) === draggedId ? previewed.end : d.end;
          if (!minStart || s < minStart) minStart = s;
          if (!maxEnd || e > maxEnd) maxEnd = e;
        }
        if (minStart && maxEnd) return styleFor(minStart, maxEnd);
      }
    }
    return styleFor(row.start, row.end);
  };

  // --- Dependency links --------------------------------------------------
  // `task.dependencies` lists predecessor ids; the arrow is drawn from the
  // predecessor bar to the dependent bar. Entries referencing unknown ids
  // (filtered records, cross-object refs) are silently skipped.
  type ResolvedLink = {
    key: string;
    sourceId: string | number; // predecessor
    targetId: string | number; // dependent task
    type: GanttLinkType;
    sourceIndex: number;
    targetIndex: number;
  };

  const links = React.useMemo<ResolvedLink[]>(() => {
    // Indexes are VISIBLE row positions — links into a collapsed subtree
    // simply disappear with their rows.
    const indexById = new Map<string, number>();
    rows.forEach((row, i) => indexById.set(String(row.task.id), i));
    const out: ResolvedLink[] = [];
    rows.forEach(({ task }, targetIndex) => {
      for (const dep of task.dependencies ?? []) {
        const isObj = typeof dep === 'object' && dep !== null;
        const depId = isObj ? (dep as GanttDependencyObject).id : dep;
        if (depId == null || depId === '') continue;
        const sourceIndex = indexById.get(String(depId));
        if (sourceIndex == null || sourceIndex === targetIndex) continue;
        const rawType = isObj ? (dep as GanttDependencyObject).type : undefined;
        const type: GanttLinkType =
          rawType === 'ss' || rawType === 'ff' || rawType === 'sf' ? rawType : 'fs';
        out.push({
          key: `${String(depId)}->${String(task.id)}:${type}`,
          sourceId: depId,
          targetId: task.id,
          type,
          sourceIndex,
          targetIndex,
        });
      }
    });
    return out;
  }, [rows]);

  // Shared row geometry: bars/diamonds/brackets and link anchors must agree
  // on these or arrows visibly miss their targets.
  // Task bar geometry. Target a ~27px-tall bar so its top edge can
  // host the length (resize) grips and its bottom edge the progress grip without
  // the two hit areas overlapping. `barTop` is kept an integer and `barHeight`
  // derived as `rowHeight - 2*barTop`, so the bar stays *exactly* centered
  // (link anchors assume rowHeight/2) with no sub-pixel drift.
  const barTop = Math.max(2, Math.round(rowHeight / 2) - 14); // bar inset from the row top
  const barHeight = rowHeight - barTop * 2;
  // Split the bar vertically: top band drives length (resize), bottom band drives
  // progress — so the two grips never compete for the same pixels.
  const resizeHandleHeight = Math.round(barHeight / 2);
  const milestoneSize = Math.max(Math.round(rowHeight * 0.4), 12);
  // The diamond is a square rotated 45° around its center at the task date;
  // its horizontal tips sit half a diagonal out from that center.
  const milestoneHalfTip = (milestoneSize * Math.SQRT2) / 2;
  // Summary bars share the task bars' exact geometry, so link anchors are
  // uniform across row kinds.
  const summaryBarHeight = barHeight;
  const summaryBarTop = barTop;
  // Baseline (planned) reference strip — a thin bar hugging the row bottom,
  // beneath the live bar, so planned-vs-actual drift reads at a glance.
  const baselineHeight = Math.max(3, Math.round(rowHeight * 0.13));
  const baselineTop = rowHeight - baselineHeight - 1;
  const BASELINE_FILL = 'rgba(100, 116, 139, 0.35)';
  const BASELINE_BORDER = 'rgba(100, 116, 139, 0.6)';

  // Orthogonal elbow path from the predecessor anchor to the dependent
  // anchor. Anchors per link type: fs = source end → target start,
  // ss = start → start, ff = end → end, sf = start → end.
  const linkPath = (link: ResolvedLink): string | null => {
    const source = rows[link.sourceIndex];
    const target = rows[link.targetIndex];
    if (!source || !target) return null;
    const s = getLiveRowStyle(source);
    const tg = getLiveRowStyle(target);
    // Vertical anchor: every row kind (bar, diamond, summary bar) is centered
    // in its row; summary uses its own top/height so rounding stays exact.
    const rowAnchorY = (row: GanttRow) =>
      row.isSummary ? summaryBarTop + summaryBarHeight / 2 : rowHeight / 2;
    const sy = link.sourceIndex * rowHeight + rowAnchorY(source);
    const ty = link.targetIndex * rowHeight + rowAnchorY(target);
    const exitRight = link.type === 'fs' || link.type === 'ff';
    const enterRight = link.type === 'ff' || link.type === 'sf';
    // Milestones anchor at the diamond's visual tip (left/right corner of
    // the rotated square), not its center — the SVG draws above the bars,
    // so a center anchor would run the line through the diamond.
    const sx = source.isMilestone
      ? s.left + (exitRight ? milestoneHalfTip : -milestoneHalfTip)
      : exitRight ? s.left + s.width : s.left;
    const tx = target.isMilestone
      ? tg.left + (enterRight ? milestoneHalfTip : -milestoneHalfTip)
      : enterRight ? tg.left + tg.width : tg.left;
    const stub = 10; // horizontal clearance before turning
    const ex = sx + (exitRight ? stub : -stub);
    const ax = tx + (enterRight ? stub : -stub);
    const r = Math.round;
    const parts = [`M ${r(sx)} ${r(sy)}`, `L ${r(ex)} ${r(sy)}`];
    // Direct route: drop vertically at the exit stub, then run into the
    // target anchor. Only valid when the final horizontal segment travels
    // toward the arrow (otherwise the arrowhead would point away from the bar).
    const direct = enterRight ? ex >= ax : ex <= ax;
    if (direct) {
      parts.push(`L ${r(ex)} ${r(ty)}`, `L ${r(tx)} ${r(ty)}`);
    } else {
      // Backward link — detour along the source row's edge facing the target.
      const gapY = ty >= sy ? (link.sourceIndex + 1) * rowHeight : link.sourceIndex * rowHeight;
      parts.push(
        `L ${r(ex)} ${r(gapY)}`,
        `L ${r(ax)} ${r(gapY)}`,
        `L ${r(ax)} ${r(ty)}`,
        `L ${r(tx)} ${r(ty)}`,
      );
    }
    return parts.join(' ');
  };

  // Links attached to the dragged/hovered task get the highlight treatment.
  const activeLinkTaskId = dragState?.taskId ?? hoveredTaskId;

  // --- Critical path (Phase 6) ------------------------------------------
  // Toolbar toggle; when on, the zero-slack chain is highlighted on the bars
  // and the links joining them. Pure display — never mutates data.
  const [criticalOn, setCriticalOn] = React.useState(criticalPathDefault);
  const critical = React.useMemo(
    () => (criticalOn ? computeCriticalPath(tasks, workingCalendar) : null),
    [criticalOn, tasks, workingCalendar],
  );
  const isCriticalTask = React.useCallback(
    (id: string | number) => critical?.criticalIds.has(String(id)) ?? false,
    [critical],
  );
  const CRIT_COLOR = '#dc2626';

  // --- Auto-schedule (Phase 6) ------------------------------------------
  // One-shot dependency-driven reschedule (forward-only): push successors later until
  // their link constraints hold, preserving durations, then persist each
  // changed task through onTaskUpdate (as one undoable batch).
  // Toolbar auto-schedule is a bulk server write, so it CONFIRMS first (the
  // same contract as the post-drag conflict dialog): compute → show "shift N
  // tasks? (M locked skipped)" → apply only on confirm. A clean graph gets a
  // transient "nothing to reschedule" notice instead of a silent no-op.
  const [pendingAutoSchedule, setPendingAutoSchedule] = React.useState<{
    changes: RescheduleChange[];
    skipped: number;
  } | null>(null);
  const [autoScheduleClean, setAutoScheduleClean] = React.useState(false);
  React.useEffect(() => {
    if (!autoScheduleClean) return;
    const timer = setTimeout(() => setAutoScheduleClean(false), 2500);
    return () => clearTimeout(timer);
  }, [autoScheduleClean]);

  const runAutoSchedule = React.useCallback(() => {
    if (!onTaskUpdate) return;
    const { changes, skippedLocked } = computeProjectRescheduleDetailed(tasks, workingCalendar, reschedOpts);
    if (!changes.length) {
      setAutoScheduleClean(true);
      return;
    }
    setPendingAutoSchedule({ changes, skipped: skippedLocked.length });
  }, [tasks, onTaskUpdate, workingCalendar, reschedOpts]);

  const applyAutoSchedule = React.useCallback(() => {
    if (!pendingAutoSchedule) return;
    const updates: Array<{ task: GanttTask; changes: Partial<Pick<GanttTask, 'start' | 'end'>> }> = [];
    for (const c of pendingAutoSchedule.changes) {
      const task = tasks.find((tk) => String(tk.id) === c.id);
      if (task) updates.push({ task, changes: { start: c.start, end: c.end } });
    }
    if (updates.length) commitTaskUpdates(updates);
    setPendingAutoSchedule(null);
  }, [pendingAutoSchedule, tasks, commitTaskUpdates]);

  // --- Export PNG (Phase 6) ---------------------------------------------
  // Self-contained: re-draw the WHOLE chart (every row, unaffected by row
  // virtualization) into a standalone SVG from the geometry we already
  // compute, then rasterize to PNG via a canvas. No third-party dependency,
  // and concrete colors (the prebuilt CSS vars don't resolve in a detached
  // SVG). Captures the left name column + the timeline bars, links and today
  // line; critical highlighting is included when the toggle is on.
  const buildExportSvg = React.useCallback((): { svg: string; W: number; H: number } | null => {
    if (typeof document === 'undefined' || !tasks.length) return null;
    const esc = (s: string) =>
      String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    // Two-row header like the live chart: a month/year group band over the
    // day/week/… unit labels.
    const groupH = 18;
    const unitH = 18;
    const headerH = groupH + unitH;
    const nameW = Math.max(taskListWidth, 200);
    const W = Math.ceil(nameW + totalWidth);
    const H = Math.ceil(headerH + rows.length * rowHeight);
    const critEdges = critical?.criticalEdges ?? null;

    const parts: string[] = [];
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
    parts.push(`<rect x="0" y="0" width="${W}" height="${headerH}" fill="#f8fafc"/>`);

    // Header — top row: month/year groups; bottom row: unit labels.
    parts.push(`<g transform="translate(${nameW},0)" font-family="sans-serif" font-size="10" fill="#475569">`);
    headerGroups.forEach((group) => {
      parts.push(`<line x1="${group.offset.toFixed(1)}" y1="0" x2="${group.offset.toFixed(1)}" y2="${headerH}" stroke="#e2e8f0"/>`);
      parts.push(`<text x="${(group.offset + group.width / 2).toFixed(1)}" y="${groupH - 6}" text-anchor="middle" font-weight="600">${esc(group.label)}</text>`);
    });
    timeColumns.forEach((col, i) => {
      const x = colOffsets[i];
      parts.push(`<line x1="${x.toFixed(1)}" y1="${groupH}" x2="${x.toFixed(1)}" y2="${H}" stroke="#eef2f7"/>`);
      parts.push(`<text x="${(x + col.width / 2).toFixed(1)}" y="${headerH - 6}" text-anchor="middle" fill="#1f2937">${esc(col.label)}</text>`);
    });
    parts.push(`</g>`);
    parts.push(`<line x1="0" y1="${groupH}" x2="${W}" y2="${groupH}" stroke="#e2e8f0"/>`);
    parts.push(`<line x1="0" y1="${headerH}" x2="${W}" y2="${headerH}" stroke="#cbd5e1"/>`);
    parts.push(`<line x1="${nameW}" y1="0" x2="${nameW}" y2="${H}" stroke="#cbd5e1"/>`);

    // Left name column.
    parts.push(`<g transform="translate(0,${headerH})" font-family="sans-serif" font-size="11" fill="#1f2937">`);
    rows.forEach((row, i) => {
      const y = i * rowHeight;
      parts.push(`<line x1="0" y1="${(y + rowHeight).toFixed(1)}" x2="${nameW}" y2="${(y + rowHeight).toFixed(1)}" stroke="#f1f5f9"/>`);
      const tx = 8 + row.depth * 14;
      const max = Math.max(4, Math.floor((nameW - tx) / 6.5));
      const title = row.task.title.length > max ? row.task.title.slice(0, max - 1) + '…' : row.task.title;
      const weight = row.isSummary ? ' font-weight="600"' : '';
      parts.push(`<text x="${tx}" y="${(y + rowHeight / 2 + 4).toFixed(1)}"${weight}>${esc(title)}</text>`);
    });
    parts.push(`</g>`);

    // Fit a bar label into `w` px: per-char width estimate (CJK ≈ 9px, latin
    // ≈ 5.5px at font-size 9) with an ellipsis; empty when nothing fits.
    const fitText = (s: string, w: number): string => {
      const budget = w - 12;
      if (budget <= 9) return '';
      let used = 0;
      let out = '';
      for (const ch of s) {
        const cw = ch.charCodeAt(0) > 255 ? 9 : 5.5;
        if (used + cw > budget) return out.length < s.length ? `${out.slice(0, -1)}…` : out;
        used += cw;
        out += ch;
      }
      return out;
    };

    // Timeline: bars / milestones / links / today line.
    parts.push(`<g transform="translate(${nameW},${headerH})" font-family="sans-serif" font-size="9">`);
    rows.forEach((row, i) => {
      // Grouping level (project / product): a pure tree header — the live chart
      // draws NO bar for these rows, so the export must not invent a rollup one.
      if (row.task.type === 'group') return;
      const y = i * rowHeight;
      const { left, width } = styleFor(row.start, row.end);
      const crit = isCriticalTask(row.task.id);
      const stroke = crit ? ` stroke="${CRIT_COLOR}" stroke-width="2"` : '';
      // Planned-vs-actual baseline strip (under the live bar, row bottom).
      if (showBaselines && row.task.baselineStart && row.task.baselineEnd) {
        const bl = styleFor(row.task.baselineStart, row.task.baselineEnd);
        parts.push(`<rect x="${bl.left.toFixed(1)}" y="${(y + baselineTop).toFixed(1)}" width="${Math.max(2, bl.width).toFixed(1)}" height="${baselineHeight}" rx="1" fill="${BASELINE_FILL}" stroke="${BASELINE_BORDER}"/>`);
      }
      if (row.isMilestone) {
        const cx = left;
        const cy = y + rowHeight / 2;
        const h = milestoneSize / 2;
        const fill = crit ? CRIT_COLOR : row.task.color || '#3b82f6';
        parts.push(`<polygon points="${cx},${cy - h} ${cx + h},${cy} ${cx},${cy + h} ${cx - h},${cy}" fill="${fill}"/>`);
      } else if (row.isSummary) {
        const fill = row.task.color || '#64748b';
        parts.push(`<rect x="${left.toFixed(1)}" y="${(y + summaryBarTop).toFixed(1)}" width="${width.toFixed(1)}" height="${summaryBarHeight}" rx="3" fill="${fill}"${stroke}/>`);
        const pw = (width * Math.min(100, Math.max(0, row.progress))) / 100;
        parts.push(`<rect x="${left.toFixed(1)}" y="${(y + summaryBarTop).toFixed(1)}" width="${pw.toFixed(1)}" height="${summaryBarHeight}" rx="3" fill="rgba(0,0,0,0.2)"/>`);
        // In-bar title, matching the live summary bar.
        const label = fitText(row.task.title, width);
        if (label) {
          parts.push(`<text x="${(left + 6).toFixed(1)}" y="${(y + rowHeight / 2 + 3).toFixed(1)}" fill="#ffffff" font-weight="500">${esc(label)}</text>`);
        }
      } else {
        const fill = row.task.color || '#3b82f6';
        parts.push(`<rect x="${left.toFixed(1)}" y="${(y + barTop).toFixed(1)}" width="${width.toFixed(1)}" height="${barHeight}" rx="3" fill="${fill}"${stroke}/>`);
        const pw = (width * Math.min(100, Math.max(0, row.progress))) / 100;
        parts.push(`<rect x="${left.toFixed(1)}" y="${(y + barTop).toFixed(1)}" width="${pw.toFixed(1)}" height="${barHeight}" rx="3" fill="rgba(0,0,0,0.18)"/>`);
        // In-bar title like the live leaf bar (bar_label, e.g. the executor);
        // narrow bars fall back to the bare progress number when it fits.
        const label = fitText(row.task.title, width);
        if (label) {
          parts.push(`<text x="${(left + 6).toFixed(1)}" y="${(y + rowHeight / 2 + 3).toFixed(1)}" fill="#ffffff" font-weight="500">${esc(label)}</text>`);
        } else if (width >= 24) {
          parts.push(`<text x="${(left + width / 2).toFixed(1)}" y="${(y + rowHeight / 2 + 3).toFixed(1)}" text-anchor="middle" fill="#ffffff">${Math.round(row.progress)}%</text>`);
        }
      }
    });
    links.forEach((link) => {
      const d = linkPath(link);
      if (!d) return;
      const critEdge = critEdges?.has(`${String(link.sourceId)}->${String(link.targetId)}`) ?? false;
      const color = critEdge ? CRIT_COLOR : '#94a3b8';
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${critEdge ? 2 : 1.5}"/>`);
    });
    if (todayLeftPx != null) {
      parts.push(`<line x1="${todayLeftPx.toFixed(1)}" y1="0" x2="${todayLeftPx.toFixed(1)}" y2="${rows.length * rowHeight}" stroke="#ef4444" stroke-width="1.5"/>`);
    }
    // Custom vertical markers (sprint boundaries, deadlines…), with labels.
    // CSS vars don't resolve in a detached SVG, so the themed default
    // (hsl(var(--primary))) falls back to a concrete indigo.
    const markerH = rows.length * rowHeight;
    resolvedMarkers.forEach((m) => {
      const color = /var\(/.test(m.color) ? '#6366f1' : m.color;
      parts.push(`<line x1="${m.left.toFixed(1)}" y1="0" x2="${m.left.toFixed(1)}" y2="${markerH}" stroke="${esc(color)}" stroke-width="1.5"/>`);
      if (m.label) {
        const lw = m.label.length * 6 + 8;
        parts.push(`<rect x="${(m.left - lw / 2).toFixed(1)}" y="0" width="${lw}" height="14" rx="2" fill="${esc(color)}"/>`);
        parts.push(`<text x="${m.left.toFixed(1)}" y="10" text-anchor="middle" font-size="9" font-weight="600" fill="#ffffff">${esc(m.label)}</text>`);
      }
    });
    parts.push(`</g>`);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
    return { svg, W, H };
  }, [tasks, rows, links, linkPath, styleFor, isCriticalTask, critical, timeColumns, colOffsets, totalWidth, taskListWidth, rowHeight, barTop, barHeight, summaryBarTop, summaryBarHeight, milestoneSize, todayLeftPx, viewMode, showBaselines, baselineTop, baselineHeight, BASELINE_FILL, BASELINE_BORDER, resolvedMarkers, headerGroups]);

  // Export file name: `<view/object label>-<yyyyMMdd-HHmm>.<ext>` — carries the
  // business context instead of an opaque `gantt-week`, and the timestamp
  // keeps repeated exports from overwriting each other. Filesystem-hostile
  // characters are stripped from the label.
  const exportFileBase = React.useCallback(() => {
    const base = (exportFileName ?? '').replace(/[\\/:*?"<>|\s]+/g, ' ').trim() || 'gantt';
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    return `${base}-${ts}`;
  }, [exportFileName]);

  const exportPng = React.useCallback(async () => {
    const built = buildExportSvg();
    if (!built) return;
    const canvas = await rasterizeSvg(built.svg, built.W, built.H);
    if (!canvas) return;
    canvas.toBlob((png) => { if (png) downloadBlob(png, `${exportFileBase()}.png`); }, 'image/png');
  }, [buildExportSvg, exportFileBase]);

  const exportPdf = React.useCallback(async () => {
    const built = buildExportSvg();
    if (!built) return;
    const canvas = await rasterizeSvg(built.svg, built.W, built.H);
    if (!canvas) return;
    // JPEG keeps the embedded image small and embeds directly via DCTDecode.
    const jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92));
    const pdf = buildJpegPdf(jpeg, canvas.width, canvas.height);
    downloadBlob(pdf, `${exportFileBase()}.pdf`);
  }, [buildExportSvg, exportFileBase]);

  // Snapshot the current layout (granularity + zoom + list state), persist it
  // under persistLayoutKey, and notify onLayoutChange. The persisted columnWidth
  // is the manual override (null = auto-fit), so a saved auto-fit stays adaptive.
  const [layoutSaved, setLayoutSaved] = React.useState(false);
  const saveLayout = React.useCallback(() => {
    const layout: GanttLayout = {
      viewMode,
      columnWidth: columnWidthOverride,
      taskListCollapsed,
      taskListWidth: taskListWidthOverride,
      collapsedIds: Array.from(collapsedIds),
    };
    if (persistLayoutKey) writeSavedLayout(persistLayoutKey, layout);
    onLayoutChange?.(layout);
    setLayoutSaved(true);
  }, [viewMode, columnWidthOverride, taskListCollapsed, taskListWidthOverride, collapsedIds, persistLayoutKey, onLayoutChange]);
  // Briefly reflect a save in the button's aria-pressed for feedback/testability.
  React.useEffect(() => {
    if (!layoutSaved) return;
    const id = setTimeout(() => setLayoutSaved(false), 1500);
    return () => clearTimeout(id);
  }, [layoutSaved]);

  return (
    <div
      ref={containerRef}
      className={cn("flex flex-col h-full bg-background overflow-hidden min-w-0", className)}
      data-readonly={effectiveReadOnly ? 'true' : undefined}
      data-mobile-readonly={mobileReadOnly && isNarrow ? 'true' : undefined}
    >
      {/* Hover and responsive rules the prebuilt components CSS can't provide
          (alpha utilities like hover:bg-white/40 and several sm: variants are
          never emitted there). */}
      <style>{`
        .gantt-resize-handle:hover { background-color: rgba(255, 255, 255, 0.4); }
        .gantt-bar-hover:hover { filter: brightness(1.1); }
        .gantt-row-open-btn { opacity: 0; transition: opacity 0.15s ease; }
        /* :where keeps the row-hover reveal at zero specificity so the
           button's own :hover/:focus-visible full-opacity rule can win. */
        :where(.group\\/task-row:hover) .gantt-row-open-btn { opacity: 0.6; }
        .gantt-row-open-btn:hover, .gantt-row-open-btn:focus-visible { opacity: 1; }
        /* Locate flash: blink the located bar 3× with a thick ring + colored glow so
           it's hard to miss. The ring is an outline (not box-shadow) and the glow
           is a drop-shadow *filter* — both stay clear of the critical-path bar's
           inline box-shadow, which they'd otherwise clobber. */
        @keyframes gantt-flash {
          0%, 25%, 50%, 100% {
            outline-color: rgba(37, 99, 235, 0);
            filter: drop-shadow(0 0 0 rgba(37, 99, 235, 0));
          }
          12%, 37%, 62% {
            outline-color: rgba(37, 99, 235, 1);
            filter: drop-shadow(0 0 9px rgba(37, 99, 235, 0.9));
          }
        }
        .gantt-flash {
          outline: 3px solid transparent;
          outline-offset: 3px;
          border-radius: 2px;
          animation: gantt-flash 1.5s ease-in-out;
        }
        @media (min-width: 640px) {
          .gantt-sm-h50 { height: 50px; }
          .gantt-sm-w20 { width: 80px; }
        }
        /* The timeline's NATIVE scrollbars are fully hidden — both axes are
           replaced by the self-drawn bars (horizontal at the bottom, vertical
           on the right). Styling the native bar is a dead end: overlay-scrollbar
           engines (macOS "show while scrolling", embedded Chromium) ignore
           ::-webkit-scrollbar theming yet still flash their own auto-hiding bar
           on scroll, which doubled up with the self-drawn one (two visible
           scrollbars). scrollbar-width:none is honored by overlay engines too;
           the ::-webkit rule covers older WebKit. Wheel/trackpad/programmatic
           scrolling is unaffected. */
        [data-testid="gantt-timeline"] { scrollbar-width: none; }
        [data-testid="gantt-timeline"]::-webkit-scrollbar { display: none; width: 0; height: 0; }
        /* The task-list pane scrolls in lockstep with the timeline, so its own
           vertical scrollbar (butted against the divider) was a confusing second
           bar. Hide it — the pane stays wheel/drag-scrollable and synced. */
        .gantt-task-list::-webkit-scrollbar { width: 0; height: 0; }
        .gantt-task-list { scrollbar-width: none; }
      `}</style>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2 border-b bg-card">
        <div className="flex items-center gap-2">
          {/* "New Task" intentionally removed — the page-level header
              already exposes a fully-fielded create form for this
              object, and the toolbar's quick-create only set 3 fields
              which was confusing for required-field-heavy schemas. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t('gantt.toolbar.prevPeriod')}
            data-testid="gantt-toolbar-prev-period"
            onClick={() => stepPeriod(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={t('gantt.toolbar.nextPeriod')}
            data-testid="gantt-toolbar-next-period"
            onClick={() => stepPeriod(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {/* The period ON SCREEN, not the start of the dataset — see
              `visiblePeriodStart`. */}
          <span className="font-semibold text-xs sm:text-sm" data-testid="gantt-toolbar-period">
            {periodLabel}
          </span>
          {effectiveReadOnly && (
            <span
              className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              data-testid="gantt-readonly-badge"
              title={t('gantt.readOnlyHint')}
            >
              <Lock className="h-3 w-3" />
              {t('gantt.readOnly')}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Granularity segmented control */}
          <div className="flex bg-muted rounded-md p-1" role="group" aria-label={t('gantt.toolbar.viewMode')}>
            {VIEW_MODES.map((mode) => (
              <Button
                key={mode}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 px-1.5 sm:px-2 text-xs",
                  viewMode === mode && "bg-background shadow-sm hover:bg-background"
                )}
                onClick={() => changeViewMode(mode)}
                aria-pressed={viewMode === mode}
                data-testid={`gantt-view-mode-${mode}`}
              >
                {t(`gantt.viewMode.${mode}`)}
              </Button>
            ))}
          </div>
          {/* Zoom: adjusts column width; at the bounds it falls through to the
              next coarser/finer granularity so zooming never dead-ends. */}
          <div className="flex bg-muted rounded-md p-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                if (columnWidth > 15) {
                  setColumnWidthOverride(Math.max(15, columnWidth - 10));
                } else {
                  const i = VIEW_MODES.indexOf(viewMode);
                  if (i < VIEW_MODES.length - 1) {
                    changeViewMode(VIEW_MODES[i + 1]);
                    setColumnWidthOverride(BASE_COLUMN_W);
                  }
                }
              }}
              aria-label={t('gantt.toolbar.zoomOut')}
            >
              <ZoomOut className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                if (columnWidth < 120) {
                  setColumnWidthOverride(Math.min(120, columnWidth + 10));
                } else {
                  const i = VIEW_MODES.indexOf(viewMode);
                  if (i > 0) {
                    changeViewMode(VIEW_MODES[i - 1]);
                    setColumnWidthOverride(BASE_COLUMN_W);
                  }
                }
              }}
              aria-label={t('gantt.toolbar.zoomIn')}
            >
              <ZoomIn className="h-3 w-3" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setTaskListCollapsed((v) => !v)}
            aria-label={taskListCollapsed ? t('gantt.toolbar.showTaskList') : t('gantt.toolbar.hideTaskList')}
            aria-pressed={taskListCollapsed}
            data-testid="gantt-toggle-task-list"
          >
            {taskListCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={jumpToToday}
            disabled={todayLeftPx == null}
            aria-label={t('gantt.toolbar.jumpToToday')}
            data-testid="gantt-jump-today"
          >
            {t('gantt.toolbar.today')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={jumpToWeek}
            aria-label={t('gantt.toolbar.thisWeek')}
            data-testid="gantt-jump-week"
          >
            {t('gantt.toolbar.thisWeek')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={jumpToMonth}
            aria-label={t('gantt.toolbar.thisMonth')}
            data-testid="gantt-jump-month"
          >
            {t('gantt.toolbar.thisMonth')}
          </Button>
          {onRefresh ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              aria-label={t('gantt.toolbar.refresh')}
              aria-busy={refreshing}
              data-testid="gantt-refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          ) : null}
          {onTaskUpdate ? (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={undo}
                disabled={!canUndo}
                aria-label={t('gantt.toolbar.undo')}
                data-testid="gantt-undo"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={redo}
                disabled={!canRedo}
                aria-label={t('gantt.toolbar.redo')}
                data-testid="gantt-redo"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCriticalOn((v) => !v)}
            aria-label={t('gantt.toolbar.criticalPath')}
            aria-pressed={criticalOn}
            data-testid="gantt-critical-path"
            style={criticalOn ? { color: CRIT_COLOR } : undefined}
          >
            <Activity className="h-4 w-4" />
          </Button>
          {autoSchedule && onTaskUpdate ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={runAutoSchedule}
              aria-label={t('gantt.toolbar.autoSchedule')}
              data-testid="gantt-auto-schedule"
            >
              <Wand2 className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={exportPng}
            aria-label={t('gantt.toolbar.exportPng')}
            data-testid="gantt-export-png"
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={exportPdf}
            aria-label={t('gantt.toolbar.exportPdf')}
            data-testid="gantt-export-pdf"
          >
            <FileDown className="h-4 w-4" />
          </Button>
          {onLayoutChange || persistLayoutKey ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={saveLayout}
              aria-label={t('gantt.toolbar.saveLayout')}
              aria-pressed={layoutSaved}
              data-testid="gantt-save-layout"
              style={layoutSaved ? { color: CRIT_COLOR } : undefined}
            >
              <Save className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? t('gantt.toolbar.exitFullscreen') : t('gantt.toolbar.enterFullscreen')}
            aria-pressed={isFullscreen}
            data-testid="gantt-fullscreen"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Gantt Body — focusable for keyboard row navigation */}
      <div
        className="relative flex flex-col flex-1 overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-ring"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        data-testid="gantt-body"
      >
        {/* Task-list resize splitter — drag the divider between the name grid
            and the timeline to widen/narrow the name column. Spans both the
            header and content rows. Hidden while the list is collapsed. */}
        {!taskListCollapsed && taskListWidth > 0 && (
          <div
            className="absolute top-0 bottom-0 z-30 group/splitter"
            style={{ left: taskListWidth - 3, width: 7, cursor: 'col-resize' }}
            data-testid="gantt-list-resize"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              const startX = e.clientX;
              const startW = taskListWidth;
              const maxW = Math.max(TASK_LIST_MIN_W, effectiveWidth - 200);
              const onMove = (ev: PointerEvent) => {
                const next = Math.max(TASK_LIST_MIN_W, Math.min(startW + (ev.clientX - startX), maxW));
                setTaskListWidthOverride(next);
              };
              const onUp = () => {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                document.body.style.cursor = '';
              };
              document.body.style.cursor = 'col-resize';
              window.addEventListener('pointermove', onMove);
              window.addEventListener('pointerup', onUp);
              window.addEventListener('pointercancel', onUp);
            }}
            onDoubleClick={() => setTaskListWidthOverride(null)}
          >
            {/* Visible hairline that thickens on hover/drag for an easy grab. */}
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover/splitter:w-[3px] group-hover/splitter:bg-primary transition-all" />
          </div>
        )}
        {/* Headers Row */}
        <div className="flex border-b bg-muted/30 shrink-0 h-10 gantt-sm-h50">
          {/* List Header */}
          <div 
            className="flex items-center font-medium text-xs text-muted-foreground px-2 sm:px-4 border-r bg-card z-20 shadow-sm"
            style={{ width: taskListWidth, minWidth: taskListWidth }}
          >
            <div className="flex-1 truncate">{t('gantt.column.taskName')}</div>
            {showSEColumns && (
              <>
                <div className="w-16 gantt-sm-w20 text-right">{t('gantt.column.start')}</div>
                <div className="w-16 gantt-sm-w20 text-right">{t('gantt.column.end')}</div>
              </>
            )}
            {/* Mirror of the data rows' `→` open-details slot (w-6 + 4px gap).
                Every row reserves it whenever onTaskClick is live, so the
                header must too — otherwise the Start/End labels
                (`gantt.column.start` / `gantt.column.end`) sit 28px to the
                right of the values they caption. */}
            {onTaskClick && (
              <div
                className="w-6 shrink-0 hidden sm:block"
                style={{ marginLeft: 4 }}
                aria-hidden="true"
                data-testid="gantt-header-open-spacer"
              />
            )}
          </div>
          
          {/* Timeline Header — two scale rows: group (month/year) over units */}
          <div className="flex-1 overflow-hidden" ref={headerRef}>
            <div className="flex flex-col h-full" style={{ width: totalWidth }}>
              <div className="relative border-b" style={{ height: '45%' }} data-testid="gantt-header-groups">
                {headerGroups.slice(groupWindow.start, groupWindow.end).map((group) => (
                  <div
                    key={group.key}
                    className="absolute top-0 bottom-0 flex items-center justify-center border-r text-[10px] font-medium text-muted-foreground overflow-hidden"
                    style={{ left: group.offset, width: group.width }}
                  >
                    <span className="truncate px-1">{group.label}</span>
                  </div>
                ))}
              </div>
              <div className="relative flex-1" data-testid="gantt-header-units">
                {timeColumns.slice(colWindow.start, colWindow.end).map((col, i) => {
                  const idx = colWindow.start + i;
                  return (
                  <div
                    key={idx}
                    className={cn(
                      "absolute top-0 bottom-0 flex items-center justify-center gap-1 border-r text-xs text-muted-foreground overflow-hidden",
                      col.isWeekend && "bg-muted/50"
                    )}
                    style={{
                      left: colOffsets[idx],
                      width: col.width,
                      backgroundColor: col.bandColor
                        ? `color-mix(in srgb, ${col.bandColor} 16%, transparent)`
                        : undefined,
                    }}
                  >
                    <span className="font-medium text-foreground truncate">{col.label}</span>
                    {col.sublabel && columnWidth >= 32 && (
                      <span className="text-[10px] opacity-70">{col.sublabel}</span>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Content Row */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Side: Task List (Grid) */}
          <div
            className="gantt-task-list overflow-y-auto overflow-x-hidden border-r bg-card z-10 shadow-sm"
            ref={listRef}
            onScroll={handleListScroll}
            style={{ width: taskListWidth, minWidth: taskListWidth }}
            role="tree"
            aria-label={t('gantt.aria.taskList')}
          >
            {rowWindow.startIdx > 0 && (
              <div style={{ height: rowWindow.startIdx * rowHeight }} aria-hidden="true" />
            )}
            {rows.slice(rowWindow.startIdx, rowWindow.endIdx).map((row) => {
              const task = row.task;
              const isEditing = inlineEdit && editingTask === task.id;
              const isCollapsed = collapsedIds.has(String(task.id));
              const isSelected = selectedTaskId != null && String(selectedTaskId) === String(task.id);
              return (
              <div
                key={task.id}
                className={cn(
                  "group/task-row relative flex items-center border-b px-2 sm:px-4 hover:bg-accent/50 cursor-pointer transition-colors",
                  isSelected && "bg-accent/50"
                )}
                style={{ height: rowHeight, touchAction: 'manipulation' }}
                role="treeitem"
                data-testid={`gantt-task-row-${task.id}`}
                aria-level={row.depth + 1}
                aria-selected={isSelected}
                aria-expanded={row.hasChildren ? !isCollapsed : undefined}
                draggable={!!onTaskReorder && !isEditing && !task.locked}
                onDragStart={onTaskReorder ? (e) => {
                  e.dataTransfer.setData('text/plain', String(task.id));
                  e.dataTransfer.effectAllowed = 'move';
                } : undefined}
                onDragOver={onTaskReorder ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                } : undefined}
                onDrop={onTaskReorder ? (e) => {
                  e.preventDefault();
                  const srcId = e.dataTransfer.getData('text/plain');
                  if (!srcId || srcId === String(task.id)) return;
                  const src = taskById.get(srcId);
                  // Reorder is sibling-scoped: dropping on a row with a
                  // different parent is ignored rather than re-parenting. In
                  // grouped mode both `src` and `task` carry the synthetic group
                  // parent, so same-group drops still match.
                  if (src && String(src.parent ?? '') === String(task.parent ?? '')) {
                    onTaskReorder(src, task);
                  }
                } : undefined}
                onContextMenu={(e) => openContextMenu(task, e)}
                onClick={() => {
                  // Focus/locate: a single row click selects + locates the bar on
                  // the timeline (scroll + pulse) WITHOUT opening the detail
                  // drawer. Detail is on double-click, the row's `→` button,
                  // the context menu's "View details" (`gantt.menu.view`) and
                  // keyboard Enter.
                  setSelectedTaskId(task.id);
                  if (!isEditing) scrollToTask(row.start, row.end, task.id);
                }}
                onDoubleClick={() => {
                  if (isEditing) return;
                  if (inlineEdit && onTaskUpdate && !row.isSummary && !task.locked) {
                    setEditingTask(task.id);
                    setEditValues({
                      title: task.title,
                      start: task.start.toLocaleDateString('en-CA'),
                      // The day the bar runs through (objectui#11141).
                      end: toDateInputValue(endDayOf(task.start, task.end)),
                      progress: String(task.progress),
                    });
                  } else {
                    onTaskClick?.(task);
                  }
                }}
              >
                <div
                  className="flex-1 truncate font-medium text-xs sm:text-sm flex items-center gap-2"
                  style={row.depth > 0 ? { paddingLeft: row.depth * 14 } : undefined}
                >
                  {row.hasChildren ? (
                    <button
                      type="button"
                      className="h-4 w-4 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                      style={{ marginLeft: -4 }}
                      onClick={(e) => { e.stopPropagation(); toggleCollapsed(task.id); }}
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? t('gantt.row.expand') : t('gantt.row.collapse')}
                      data-testid={`gantt-row-toggle-${task.id}`}
                    >
                      {isCollapsed
                        ? <ChevronRight className="h-3.5 w-3.5" />
                        : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  ) : (
                    <span className="w-3 shrink-0" style={{ marginLeft: -4 }} aria-hidden="true" />
                  )}
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: task.color || '#3b82f6' }}
                  />
                  {isEditing ? (
                    <input
                      className="border rounded px-1 py-0.5 text-xs w-full bg-background"
                      value={editValues.title || ''}
                      onChange={(e) => setEditValues(prev => ({ ...prev, title: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          commitTaskUpdates([{
                            task,
                            changes: {
                              title: editValues.title,
                              // The date inputs hold the LOCAL day they were
                              // seeded with; `toDisplayDate` reads it back at
                              // local midnight, where the engine's parse read
                              // UTC midnight and moved an untouched bar to the
                              // day before west of UTC (objectui#10866). The
                              // end is the typed day's end (objectui#11141).
                              start: toDisplayDate(editValues.start),
                              end: endOfTypedDay(editValues.end, task),
                              progress: Number(editValues.progress) || 0,
                            },
                          }]);
                          setEditingTask(null);
                        } else if (e.key === 'Escape') {
                          setEditingTask(null);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span className="flex flex-col min-w-0">
                      <span
                        className={cn("truncate", row.isSummary && "font-semibold")}
                        data-testid={`gantt-row-title-${task.id}`}
                      >{task.title}</span>
                      {/* The row's dates, on exactly the complement of the
                          Start/End columns — same container-derived width, one
                          predicate, so a row is never left with neither. */}
                      {!showSEColumns && (
                        <span
                          className="text-[10px] text-muted-foreground"
                          data-testid={`gantt-row-dates-${task.id}`}
                        >
                          {formatTaskDay(row.start, 'numeric')} → {formatTaskDay(endDayOf(row.start, row.end), 'numeric')}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {/* Start/End, rendered on the same single predicate as the
                    header's captions — and never on a viewport test, which is
                    what let the columns and the date sublabel disagree about
                    how wide the task list is. */}
                {showSEColumns && (
                  <>
                <div className="w-16 gantt-sm-w20 text-right text-xs text-muted-foreground" data-testid={`gantt-row-start-${task.id}`}>
                  {isEditing ? (
                    <input
                      type="date"
                      className="border rounded px-1 py-0.5 text-xs w-full bg-background"
                      value={editValues.start || ''}
                      onChange={(e) => setEditValues(prev => ({ ...prev, start: e.target.value }))}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    formatTaskDay(row.start, 'numeric')
                  )}
                </div>
                <div className="w-16 gantt-sm-w20 text-right text-xs text-muted-foreground" data-testid={`gantt-row-end-${task.id}`}>
                  {isEditing ? (
                    <input
                      type="date"
                      className="border rounded px-1 py-0.5 text-xs w-full bg-background"
                      value={editValues.end || ''}
                      onChange={(e) => setEditValues(prev => ({ ...prev, end: e.target.value }))}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    formatTaskDay(endDayOf(row.start, row.end), 'numeric')
                  )}
                </div>
                  </>
                )}
                {/* Open details `→`: opens the detail drawer / page — the row click
                    itself is reserved for Focus-locate, so detail needs its own
                    always-reachable affordance besides double-click. A dedicated
                    flex slot (not an absolute overlay) so it never covers the
                    end-date column; the slot persists during inline edit to
                    avoid layout shift. */}
                {onTaskClick && (
                  <div className="w-6 shrink-0 hidden sm:block" style={{ marginLeft: 4 }}>
                    {!isEditing && (
                      <button
                        type="button"
                        title={t('gantt.row.open')}
                        aria-label={t('gantt.row.open')}
                        data-testid={`gantt-row-open-${task.id}`}
                        className="gantt-row-open-btn h-6 w-6 rounded-md flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTaskClick(task);
                        }}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
                {/* Row View/Edit/Delete stay reachable from the detail drawer
                    (double-click / `→` / context menu / Enter); inline edit is
                    still triggerable via row double-click when enabled. */}
              </div>
              );
            })}
            {rowWindow.endIdx < rows.length && (
              <div style={{ height: (rows.length - rowWindow.endIdx) * rowHeight }} aria-hidden="true" />
            )}
          </div>

          {/* Right Side: Timeline */}
          <div
            className="flex-1 overflow-auto bg-background/50 relative [-webkit-overflow-scrolling:touch]"
            ref={(el) => { (timelineRef as any).current = el; (scrollAreaRef as any).current = el; }}
            onScroll={handleScroll}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            data-testid="gantt-timeline"
          >
            <div className="relative" style={{ width: totalWidth }}>
              {/* Today vertical marker — sticky inside the scroll area, in front of grid + bars */}
              {todayLeftPx != null && (
                <div
                  className="absolute top-0 bottom-0 w-px z-20 pointer-events-none"
                  /* Explicit colors: the prebuilt components CSS doesn't emit
                     bg-red-500 / opacity-modified utilities. */
                  style={{ left: todayLeftPx, backgroundColor: 'rgba(239, 68, 68, 0.8)' }}
                  data-testid="gantt-today-marker"
                  aria-label={t('gantt.toolbar.today')}
                >
                  <div
                    className="absolute -translate-x-1/2 left-0 text-[10px] font-semibold text-white rounded-sm px-1 py-0.5 whitespace-nowrap z-30"
                    style={{ top: 2, backgroundColor: '#ef4444' }}
                  >
                    {t('gantt.toolbar.today')}
                  </div>
                </div>
              )}
              {/* Custom vertical markers (deadlines, sprint boundaries…) */}
              {resolvedMarkers.map((m) => (
                <div
                  key={m.index}
                  className="absolute top-0 bottom-0 w-px z-20 pointer-events-none"
                  style={{ left: m.left, backgroundColor: m.color }}
                  data-testid={`gantt-marker-${m.index}`}
                  aria-label={m.label}
                >
                  {m.label && (
                    <div
                      className="absolute -translate-x-1/2 left-0 text-[10px] font-semibold text-white rounded-sm px-1 py-0.5 whitespace-nowrap z-30"
                      style={{ top: 2, backgroundColor: m.color }}
                    >
                      {m.label}
                    </div>
                  )}
                </div>
              ))}
              {/* Timeline Task Rows */}
              <div className="relative" ref={contentRef}>
                {/* Background Grid — windowed to the visible columns */}
                <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
                   {timeColumns.slice(colWindow.start, colWindow.end).map((col, i) => {
                    const idx = colWindow.start + i;
                    return (
                    <div
                      key={idx}
                      className="absolute top-0 bottom-0 border-r"
                      style={{
                        left: colOffsets[idx],
                        width: col.width,
                        backgroundColor: col.bandColor
                          ? `color-mix(in srgb, ${col.bandColor} 8%, transparent)`
                          : col.isWeekend
                            ? 'hsl(var(--muted) / 0.4)'
                            : undefined,
                      }}
                    />
                    );
                  })}
                </div>

                {/* Calendar-midnight markers. A subtle dashed vertical
                    line where the calendar date flips INSIDE a band — e.g. a
                    night shift (20:00→08:00 next day) straddles 0:00. The
                    shift-day cell stays unbroken; the line is just a cue that
                    the day rolled over. */}
                {segmenting && shiftSegments && shiftSegments.showMidnight && (
                  <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
                    {timeColumns.slice(colWindow.start, colWindow.end).map((col, i) => {
                      const idx = colWindow.start + i;
                      const realMs = col.realMs ?? 0;
                      if (!realMs) return null;
                      const startMs = col.date.getTime();
                      // Next LOCAL midnight after the band's start instant.
                      const s = col.date;
                      const mid = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1, 0, 0, 0, 0).getTime();
                      // Only draw when midnight falls strictly inside the band
                      // (excludes bands that begin or end exactly on midnight).
                      if (mid <= startMs || mid >= startMs + realMs) return null;
                      const x = colOffsets[idx] + ((mid - startMs) / realMs) * col.width;
                      return (
                        <div
                          key={`midnight-${idx}`}
                          className="absolute top-0 bottom-0"
                          style={{ left: x, borderLeft: '1px dashed hsl(var(--muted-foreground) / 0.4)' }}
                          data-testid={`gantt-midnight-${idx}`}
                          aria-hidden="true"
                        />
                      );
                    })}
                  </div>
                )}

                {/* Task Bars — windowed to the visible rows */}
                {rowWindow.startIdx > 0 && (
                  <div style={{ height: rowWindow.startIdx * rowHeight }} aria-hidden="true" />
                )}
                {rows.slice(rowWindow.startIdx, rowWindow.endIdx).map((row, winIdx) => {
                   const task = row.task;
                   const absRowIdx = rowWindow.startIdx + winIdx;
                   const isCrit = isCriticalTask(task.id);
                   const baseStyle = styleFor(row.start, row.end);
                   // Baseline (planned) reference strip beneath the live bar.
                   const baseline = showBaselines && task.baselineStart && task.baselineEnd
                     ? styleFor(task.baselineStart, task.baselineEnd)
                     : null;
                   const baselineEl = baseline ? (
                     <div
                       className="absolute pointer-events-none rounded-[1px]"
                       style={{
                         left: baseline.left,
                         width: Math.max(2, baseline.width),
                         top: baselineTop,
                         height: baselineHeight,
                         backgroundColor: BASELINE_FILL,
                         border: `1px solid ${BASELINE_BORDER}`,
                       }}
                       data-testid={`gantt-baseline-${task.id}`}
                       aria-hidden="true"
                     />
                   ) : null;
                   const isDragging = dragState?.taskId === task.id;
                   const inDragGroup = dragGroupIds?.has(String(task.id)) ?? false;
                   const inDragStretch = dragStretchAncestorIds?.has(String(task.id)) ?? false;
                   const liveStyle = isDragging || inDragGroup || inDragStretch ? getLiveRowStyle(row) : baseStyle;
                   // Per-node lock (view-only): treat like read-only for this row —
                   // no move/resize/progress/link, but onTaskClick still fires.
                   const isLocked = !!task.locked;
                   // Per-interaction gates: the row must be editable at all
                   // (handler, not summary, not locked) AND the corresponding
                   // interaction switch must be on.
                   const editableRow = !!onTaskUpdate && !row.isSummary && !isLocked;
                   const canMove = editableRow && ixMove;
                   const canResize = editableRow && ixResize;
                   const canProgress = editableRow && ixProgress;
                   const canDrag = canMove || canResize;
                   // A bar that is explicitly non-editable — the whole view is
                   // read-only, or this row is locked (view-only) — gets a not-allowed
                   // cursor so hovering signals "can't drag/resize here". A plain
                   // display gantt (no edit handlers, not flagged read-only) keeps a
                   // normal pointer instead.
                   const barReadOnly = effectiveReadOnly || isLocked;
                   const isLinkTarget =
                     linkDrag != null &&
                     linkDrag.targetId != null &&
                     String(linkDrag.targetId) === String(task.id) &&
                     String(linkDrag.sourceId) !== String(task.id);
                   // The negative half of the same affordance (objectui#4158):
                   // this bar is under the pointer and the policy refused it.
                   // Unlike `isLinkTarget` the source bar is NOT excluded — a
                   // self-drop is one of the four refusals, and it is the one
                   // case where the bar under the pointer IS the source.
                   const isLinkRejected =
                     linkDrag != null &&
                     linkDrag.rejectedId != null &&
                     String(linkDrag.rejectedId) === String(task.id);
                   // Inline, not a utility class, for the same reason the
                   // read-only cursor below is inline: `cursor-not-allowed`
                   // and the ring alpha utilities are not emitted in the
                   // prebuilt components CSS, so a class here would look right
                   // in a DOM test and render nothing in a browser.
                   const linkRejectStyle = isLinkRejected
                     ? { cursor: 'not-allowed', boxShadow: '0 0 0 2px hsl(var(--destructive))' }
                     : undefined;
                   // While a connector drag is live, bars report themselves as
                   // the drop target on pointermove; the row clears it when the
                   // pointer is over empty row space (target === currentTarget).
                   const captureLinkTarget = linkDrag ? (e: React.PointerEvent) => {
                     // Which half of the target bar is the pointer over? The left
                     // half snaps to the Start endpoint, the right half to Finish.
                     // This is what makes the dropped-onto endpoint pick FS vs FF
                     // (or SS vs SF) — the second letter of the link type.
                     const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                     const half: 'start' | 'end' =
                       r.width > 0 && e.clientX - r.left > r.width / 2 ? 'end' : 'start';
                     setLinkDrag((prev) => {
                       if (!prev) return prev;
                       // One classification, used for both halves of the
                       // feedback: a refused bar records WHY here so the
                       // release handler can name it, and still never becomes
                       // a drop target (objectui#4158).
                       const rejection = classifyLinkTarget(prev.sourceId, task);
                       return rejection === null
                         ? { ...prev, targetId: task.id, targetEnd: half, rejectedId: null, rejectedReason: null }
                         : { ...prev, targetId: null, targetEnd: null, rejectedId: task.id, rejectedReason: rejection };
                     });
                   } : undefined;
                   const clearLinkTarget = linkDrag ? (e: React.PointerEvent) => {
                     if (e.target === e.currentTarget) {
                       setLinkDrag((prev) =>
                         prev ? { ...prev, targetId: null, targetEnd: null, rejectedId: null, rejectedReason: null } : prev,
                       );
                     }
                   } : undefined;
                   const durationDays = Math.max(1, Math.round(
                     (row.end.getTime() - row.start.getTime()) / MS_PER_DAY
                   ));
                   // Tooltip flip (bottom rows, where a hover on the last row
                   // otherwise flickers): a downward
                   // tooltip on one of the last rows overflows the rows box,
                   // growing the scroller's scrollHeight while shown. With the
                   // user scrolled to the bottom, the browser's scroll
                   // clamping/anchoring then re-adjusts scrollTop every time the
                   // tooltip mounts/unmounts — the bar slides under the
                   // stationary cursor, hover re-fires, and the tooltip
                   // flickers in a loop. Upward overflow never extends the
                   // scrollable area, so rows whose downward tooltip would
                   // poke past the content box flip it above the bar instead
                   // (only when there's room above to be useful).
                   const TOOLTIP_EST_PX = 300;
                   const tooltipFlipsUp =
                     (absRowIdx + 1) * rowHeight + TOOLTIP_EST_PX > totalRowsHeight &&
                     absRowIdx * rowHeight > TOOLTIP_EST_PX;
                   const tooltip = hoveredTaskId === task.id && !dragState && !progressDrag && !linkDrag ? (
                     <div
                       className="absolute z-30 pointer-events-none rounded-md border bg-popover text-popover-foreground px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
                       style={{
                         left: Math.max(liveStyle.left + 8, 4),
                         ...(tooltipFlipsUp
                           ? { bottom: rowHeight - 8 }
                           : { top: rowHeight - 8 }),
                       }}
                       role="tooltip"
                       data-testid={`gantt-tooltip-${task.id}`}
                     >
                       <div className="font-semibold">{task.title}</div>
                       {task.fields && task.fields.length > 0 ? (
                         <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 2, marginTop: 4 }}>
                           {task.fields.map((f, i) => (
                             <React.Fragment key={i}>
                               <span className="text-muted-foreground">{f.label}</span>
                               <span style={{ fontWeight: 500 }}>{f.value}</span>
                             </React.Fragment>
                           ))}
                         </div>
                       ) : (
                         <div className="text-muted-foreground">
                           {formatTaskDay(row.start, 'short')}
                           {' → '}
                           {formatTaskDay(endDayOf(row.start, row.end), 'short')}
                           {' · '}{durationDays}{t('gantt.tooltip.days')}
                           {' · '}{Math.round(row.progress)}%
                         </div>
                       )}
                       {task.locked || (effectiveReadOnly && !onTaskUpdate) ? (
                         <div
                           className="text-muted-foreground"
                           style={{ marginTop: 4 }}
                           data-testid={`gantt-tooltip-locked-${task.id}`}
                         >
                           {'🚫 '}{t('gantt.lockedHint')}
                         </div>
                       ) : null}
                     </div>
                   ) : null;

                   if (task.type === 'group') {
                     // Grouping level (project / product): a pure tree header — the left list still
                     // shows the caret + label, but the timeline row carries NO bar.
                     return (
                       <div
                         key={task.id}
                         className="relative border-b hover:bg-accent/50"
                         style={{ height: rowHeight }}
                         onPointerMove={clearLinkTarget}
                       >
                         {tooltip}
                       </div>
                     );
                   }

                   if (row.isSummary) {
                     // Summary bar: a solid row-centered bar (slightly slimmer
                     // than task bars) with the title and a darker progress
                     // fill, like svar/MS-Project group bars. Children drive
                     // its range; dragging its middle moves the whole subtree.
                     const summaryColor = task.color || '#0d9488';
                     // A summary whose OWN dates are authoritative (summaryExtent
                     // 'self' + it carries real dates) edits like a task bar: the
                     // end zones resize its own start/end and it grows link
                     // connectors. A rollup summary (children define the span)
                     // stays move-only — resizing derived dates has no field to
                     // persist to.
                     const summaryOwnsDates =
                       summaryExtent === 'self' && task.hasOwnDates !== false;
                     // Locked summaries were already unmovable (beginDrag rejects
                     // them) — folding the lock in here also fixes the cursor:
                     // view-only rows now show not-allowed (🚫) instead of grab.
                     const summaryMovable = !!onTaskUpdate && ixMove && !isLocked;
                     const summaryResizable = !!onTaskUpdate && ixResize && summaryOwnsDates && !isLocked;
                     return (
                      <div
                        key={task.id}
                        className="relative border-b hover:bg-accent/50"
                        style={{ height: rowHeight }}
                        onPointerMove={clearLinkTarget}
                      >
                        {baselineEl}
                        <div
                          className={cn(
                            'gantt-bar-hover absolute rounded-sm border shadow-sm flex items-center px-2 select-none group',
                            summaryMovable && 'cursor-grab active:cursor-grabbing',
                            isDragging && 'ring-2 ring-primary z-10',
                            isLinkTarget && 'ring-2 ring-primary',
                            flashTaskId === task.id && 'gantt-flash z-10'
                          )}
                          /* Explicit colors: alpha utilities aren't emitted in
                             the prebuilt components CSS. */
                          style={{
                            left: liveStyle.left,
                            width: liveStyle.width,
                            top: summaryBarTop,
                            height: summaryBarHeight,
                            // Inline not-allowed: the cursor-not-allowed utility isn't
                            // emitted in the prebuilt components CSS, so drive the
                            // read-only cursor from style rather than a class.
                            cursor: summaryMovable || summaryResizable ? undefined : barReadOnly ? 'not-allowed' : 'pointer',
                            backgroundColor: summaryColor,
                            borderColor: isCrit ? CRIT_COLOR : task.borderColor || 'hsl(var(--primary-foreground) / 0.2)',
                            boxShadow: isCrit ? `0 0 0 2px ${CRIT_COLOR}` : task.borderColor ? `0 0 0 2px ${task.borderColor}` : undefined,
                            // Last: the rejection affordance overrides both the cursor and the
                            // outline while a refused link drag hovers this bar.
                            ...linkRejectStyle,
                          }}
                          data-critical={isCrit ? 'true' : undefined}
                          data-testid={`gantt-summary-bar-${task.id}`}
                          data-progress={Math.round(row.progress)}
                          onMouseEnter={() => setHoveredTaskId(task.id)}
                          onMouseLeave={() => setHoveredTaskId((cur) => (cur === task.id ? null : cur))}
                          onPointerMove={captureLinkTarget}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            // Self-dated summary: the end zones resize its own
                            // start/end (non-group, persists to this record); the
                            // middle still group-moves the whole subtree. Corner
                            // grips below handle a direct edge hit, but a click
                            // aimed at the edge often lands just inside, so resolve
                            // from the pointer offset here too. Rollup summaries
                            // stay move-only.
                            if (summaryResizable) {
                              const mode = resolveBarDragMode(e.clientX, e.currentTarget.getBoundingClientRect());
                              if (mode !== 'move') {
                                beginDrag(task, mode, e);
                                return;
                              }
                            }
                            if (!summaryMovable) return;
                            beginDrag(task, 'move', e, { group: true, originStart: row.start, originEnd: row.end });
                          }}
                          onClick={() => {
                            if (suppressNextClickRef.current) return;
                            // Clicking the bar only selects it — opening the detail
                            // drawer is reserved for the task-name column, the
                            // context menu, and keyboard Enter, so a mis-tap while
                            // aiming to drag never pops the side panel.
                            setSelectedTaskId(task.id);
                          }}
                          onContextMenu={(e) => openContextMenu(task, e)}
                        >
                          {/* Rollup progress fill */}
                          <div
                            className="absolute left-0 top-0 bottom-0 pointer-events-none"
                            style={{ width: `${Math.round(row.progress)}%`, backgroundColor: 'rgba(0, 0, 0, 0.2)', borderTopLeftRadius: 'var(--radius-sm)', borderBottomLeftRadius: 'var(--radius-sm)' }}
                          />
                          {/* Resize grips — only for a self-dated summary wide
                              enough to host them (mirrors the leaf task bar). */}
                          {summaryResizable && liveStyle.width >= 14 && (
                            <>
                              <div
                                className="gantt-resize-handle absolute left-0 top-0"
                                style={{ width: RESIZE_EDGE_PX, height: resizeHandleHeight, cursor: 'ew-resize' }}
                                data-testid={`gantt-task-resize-left-${task.id}`}
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  beginDrag(task, 'resize-left', e);
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div
                                className="gantt-resize-handle absolute right-0 top-0"
                                style={{ width: RESIZE_EDGE_PX, height: resizeHandleHeight, cursor: 'ew-resize' }}
                                data-testid={`gantt-task-resize-right-${task.id}`}
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  beginDrag(task, 'resize-right', e);
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </>
                          )}
                          <span className="relative text-[10px] text-white font-medium truncate pointer-events-none">
                            {task.title}
                          </span>
                          {/* Connector dots — same drag-to-link affordance as leaf
                              bars, so dependencies (3.4.5) can be drawn between
                              summary plans, not only via the right-click menu. */}
                          {onDependencyCreate && !isLocked && (['start', 'end'] as const).map((end) => {
                            const isSource =
                              linkDrag != null &&
                              String(linkDrag.sourceId) === String(task.id) &&
                              linkDrag.sourceEnd === end;
                            const visible = isSource || hoveredTaskId === task.id;
                            const grabbable = visible && linkDrag == null;
                            return (
                              <div
                                key={end}
                                className="absolute top-1/2 -translate-y-1/2 z-20 flex items-center transition-opacity"
                                style={{
                                  [end === 'start' ? 'left' : 'right']: -28,
                                  height: 24,
                                  width: 30,
                                  cursor: 'crosshair',
                                  opacity: visible ? 1 : 0,
                                  pointerEvents: grabbable ? 'auto' : 'none',
                                  justifyContent: end === 'start' ? 'flex-start' : 'flex-end',
                                  paddingLeft: end === 'start' ? 4 : 0,
                                  paddingRight: end === 'end' ? 4 : 0,
                                }}
                                data-testid={`gantt-link-dot-${end}-${task.id}`}
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const rect = contentRef.current?.getBoundingClientRect();
                                  setLinkDrag({
                                    sourceId: task.id,
                                    sourceEnd: end,
                                    x: rect ? e.clientX - rect.left : 0,
                                    y: rect ? e.clientY - rect.top : 0,
                                    targetId: null,
                                    targetEnd: null,
                                    rejectedId: null,
                                    rejectedReason: null,
                                  });
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div
                                  className="rounded-full"
                                  style={{
                                    height: 12,
                                    width: 12,
                                    backgroundColor: 'hsl(var(--background))',
                                    border: '2px solid hsl(var(--primary))',
                                    boxShadow: isSource ? '0 0 0 3px hsl(var(--primary) / 0.25)' : '0 1px 2px rgba(0,0,0,0.25)',
                                  }}
                                />
                              </div>
                            );
                          })}
                        </div>
                        {isDragging && dragState && (
                          <div
                            className="absolute z-30 pointer-events-none rounded border bg-popover text-popover-foreground px-1.5 py-0.5 text-[10px] shadow whitespace-nowrap"
                            style={{ left: Math.max(liveStyle.left, 4), top: summaryBarTop + summaryBarHeight + 2 }}
                            data-testid={`gantt-summary-drag-chip-${task.id}`}
                          >
                            {formatTaskDay(computeDragChanges(dragState).start, 'numeric')}
                            {' → '}
                            {formatTaskDay(dragPreviewEndDay(dragState), 'numeric')}
                          </div>
                        )}
                        {tooltip}
                      </div>
                     );
                   }

                   if (row.isMilestone) {
                     const size = milestoneSize;
                     return (
                      <div
                        key={task.id}
                        className="relative border-b hover:bg-accent/50"
                        style={{ height: rowHeight }}
                        onPointerMove={clearLinkTarget}
                      >
                        {baselineEl}
                        <div
                          className={cn(
                            "gantt-bar-hover absolute rotate-45 rounded-[2px] border shadow-sm select-none",
                            canMove && "cursor-grab active:cursor-grabbing",
                            isDragging && "ring-2 ring-primary z-10",
                            isLinkTarget && "ring-2 ring-primary",
                            flashTaskId === task.id && "gantt-flash z-10"
                          )}
                          style={{
                            left: liveStyle.left - size / 2,
                            top: (rowHeight - size) / 2,
                            width: size,
                            height: size,
                            // Inline not-allowed: the cursor-not-allowed utility isn't
                            // emitted in the prebuilt components CSS, so drive the
                            // read-only cursor from style rather than a class.
                            cursor: canMove ? undefined : barReadOnly ? 'not-allowed' : 'pointer',
                            backgroundColor: isCrit ? CRIT_COLOR : task.color || '#3b82f6',
                            borderColor: isCrit ? CRIT_COLOR : task.borderColor || 'hsl(var(--primary-foreground) / 0.2)',
                            boxShadow: isCrit ? `0 0 0 2px ${CRIT_COLOR}` : task.borderColor ? `0 0 0 2px ${task.borderColor}` : undefined,
                            // Last: the rejection affordance overrides both the cursor and the
                            // outline while a refused link drag hovers this bar.
                            ...linkRejectStyle,
                          }}
                          data-critical={isCrit ? 'true' : undefined}
                          data-testid={`gantt-milestone-${task.id}`}
                          onMouseEnter={() => setHoveredTaskId(task.id)}
                          onMouseLeave={() => setHoveredTaskId((cur) => (cur === task.id ? null : cur))}
                          onClick={() => {
                            if (suppressNextClickRef.current) return;
                            // Clicking the bar only selects it — opening the detail
                            // drawer is reserved for the task-name column, the
                            // context menu, and keyboard Enter, so a mis-tap while
                            // aiming to drag never pops the side panel.
                            setSelectedTaskId(task.id);
                          }}
                          onContextMenu={(e) => openContextMenu(task, e)}
                          onPointerMove={captureLinkTarget}
                          onPointerDown={canMove ? (e) => {
                            if (e.button !== 0) return;
                            beginDrag(task, 'move', e);
                          } : undefined}
                        />
                        {tooltip}
                      </div>
                     );
                   }

                   const liveProgress = progressDrag && progressDrag.taskId === task.id
                     ? progressDrag.value
                     : task.progress;

                   return (
                    <div
                      key={task.id}
                      className="relative border-b hover:bg-accent/50"
                      style={{ height: rowHeight }}
                      onPointerMove={clearLinkTarget}
                      // Hover is tracked on the FULL-WIDTH row, not the narrow bar.
                      // The connector dots float just outside the bar's ends, so a
                      // bar-scoped hover would drop the moment the cursor crossed the
                      // bar edge toward a dot — the dot would vanish before it could
                      // be grabbed. The row spans the whole timeline, so moving from
                      // bar → dot never leaves the hover zone.
                      onMouseEnter={() => setHoveredTaskId(task.id)}
                      onMouseLeave={() => setHoveredTaskId((cur) => (cur === task.id ? null : cur))}
                    >
                      {/* Ghost: original position rendered faded while dragging */}
                      {isDragging && (
                        <div
                          className="absolute rounded-sm border border-dashed pointer-events-none"
                          /* Explicit top/height/border color: calc-based and
                             alpha utilities aren't emitted in the prebuilt
                             components CSS, and link anchors assume a
                             row-centered bar. */
                          style={{ left: baseStyle.left, width: baseStyle.width, top: barTop, height: barHeight, opacity: 0.35, borderColor: 'hsl(var(--primary) / 0.6)' }}
                          aria-hidden="true"
                        />
                      )}
                      {baselineEl}
                      <div
                        className={cn(
                          "gantt-bar-hover absolute rounded-sm bg-primary border shadow-sm flex items-center px-2 group select-none",
                          canDrag && "cursor-grab active:cursor-grabbing",
                          isDragging && "ring-2 ring-primary z-10",
                          isLinkTarget && "ring-2 ring-primary",
                          flashTaskId === task.id && "gantt-flash z-10"
                        )}
                        style={{
                          left: liveStyle.left,
                          width: liveStyle.width,
                          top: barTop,
                          height: barHeight,
                          // Inline not-allowed: the cursor-not-allowed utility isn't
                          // emitted in the prebuilt components CSS, so drive the
                          // read-only cursor from style rather than a class.
                          cursor: canDrag ? undefined : barReadOnly ? 'not-allowed' : 'pointer',
                          backgroundColor: task.color || '#3b82f6',
                          borderColor: isCrit ? CRIT_COLOR : task.borderColor || 'hsl(var(--primary-foreground) / 0.2)',
                          boxShadow: isCrit ? `0 0 0 2px ${CRIT_COLOR}` : task.borderColor ? `0 0 0 2px ${task.borderColor}` : undefined,
                          // Last: the rejection affordance overrides both the cursor and the
                          // outline while a refused link drag hovers this bar.
                          ...linkRejectStyle,
                        }}
                        data-critical={isCrit ? 'true' : undefined}
                        data-testid={`gantt-task-bar-${task.id}`}
                        onClick={() => {
                          if (suppressNextClickRef.current) return;
                          // Clicking the bar only selects it — opening the detail
                          // drawer is reserved for the task-name column, the
                          // context menu, and keyboard Enter, so a mis-tap while
                          // aiming to drag never pops the side panel.
                          setSelectedTaskId(task.id);
                        }}
                        onContextMenu={(e) => openContextMenu(task, e)}
                        onPointerMove={captureLinkTarget}
                        onPointerDown={canDrag ? (e) => {
                          // The corner grips get their own onPointerDown + stopPropagation
                          // so a direct hit still wins. But a click aimed at the edge often
                          // lands just inside the bar (headless coordinate quantization), so
                          // resolve the mode from the pointer's offset here too: the end
                          // bands resize, the middle moves (edge-zone drag). Each zone only
                          // engages when its interaction switch allows; a resize zone with
                          // resize off falls back to a plain move (DHTMLX parity).
                          if (e.button !== 0) return;
                          const zone = resolveBarDragMode(e.clientX, e.currentTarget.getBoundingClientRect());
                          const mode = zone !== 'move' && canResize ? zone : canMove ? 'move' : null;
                          if (mode) beginDrag(task, mode, e);
                        } : undefined}
                      >
                        {/* Resize handles — only when bar is wide enough to host them */}
                        {canResize && liveStyle.width >= 14 && (
                          <>
                            <div
                              className="gantt-resize-handle absolute left-0 top-0"
                              style={{ width: RESIZE_EDGE_PX, height: resizeHandleHeight, cursor: 'ew-resize' }}
                              data-testid={`gantt-task-resize-left-${task.id}`}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                beginDrag(task, 'resize-left', e);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div
                              className="gantt-resize-handle absolute right-0 top-0"
                              style={{ width: RESIZE_EDGE_PX, height: resizeHandleHeight, cursor: 'ew-resize' }}
                              data-testid={`gantt-task-resize-right-${task.id}`}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                beginDrag(task, 'resize-right', e);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </>
                        )}

                        {/* Progress fill — follows the handle live while dragging.
                            Explicit color: bg-black/20 isn't emitted in the
                            prebuilt components CSS. */}
                        {liveProgress > 0 && (
                          <div
                            className="absolute left-0 top-0 bottom-0 pointer-events-none"
                            style={{ width: `${liveProgress}%`, backgroundColor: 'rgba(0, 0, 0, 0.2)', borderTopLeftRadius: 'var(--radius-sm)', borderBottomLeftRadius: 'var(--radius-sm)' }}
                          />
                        )}

                        {/* Progress drag handle — a triangle hugging the bottom
                            edge at the progress boundary. It only
                            shows on hover / while dragging, and its hit area lives
                            in the bottom half so grabbing it never competes with a
                            bar move (top) or a link drag (the centred end dots). */}
                        {canProgress && liveStyle.width >= 30 && (
                          <div
                            className={cn(
                              "absolute bottom-0 h-1/2 w-4 -translate-x-1/2 cursor-col-resize flex items-end justify-center pb-px",
                              progressDrag?.taskId === task.id
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100 transition-opacity"
                            )}
                            style={{ left: `${liveProgress}%` }}
                            data-testid={`gantt-progress-handle-${task.id}`}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              e.preventDefault();
                              setProgressDrag({
                                taskId: task.id,
                                originClientX: e.clientX,
                                originProgress: task.progress,
                                barWidth: liveStyle.width,
                                value: task.progress,
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Up-pointing triangle. Built from borders (no asset);
                                white fill + drop-shadow so it reads on any bar color. */}
                            <div
                              style={{
                                width: 0,
                                height: 0,
                                borderLeft: '5px solid transparent',
                                borderRight: '5px solid transparent',
                                borderBottom: '7px solid #fff',
                                filter: 'drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35))',
                              }}
                            />
                          </div>
                        )}

                        {/* Connector dots — a circle floating just OUTSIDE each end
                            of the bar. Sitting fully outside the bar
                            body means grabbing one can never start a bar move or an
                            edge resize. They appear on row hover (or while this bar
                            is the link source) and have their own enlarged hit area
                            so they're easy to grab. Drag one onto another bar to
                            create a dependency; the endpoint you drag FROM picks the
                            first letter of the link type (Finish vs Start). */}
                        {onDependencyCreate && !isLocked && (['start', 'end'] as const).map((end) => {
                          const isSource =
                            linkDrag != null &&
                            String(linkDrag.sourceId) === String(task.id) &&
                            linkDrag.sourceEnd === end;
                          const visible = isSource || hoveredTaskId === task.id;
                          // Only grabbable when no drag is live yet — during a drag
                          // the dots are pure visual hints, so the bar underneath
                          // keeps reporting the hovered drop target.
                          const grabbable = visible && linkDrag == null;
                          return (
                            <div
                              key={end}
                              // The visible circle sits OUT from the bar end with a
                              // comfortable gap so it reads as its own
                              // affordance, not crammed against the bar. But the
                              // transparent hit area is wider and BRIDGES back to the
                              // bar edge: it overlays z-20 above the dependency line's
                              // hit-stroke (z-10) that can occupy that gap, and it
                              // keeps the pointer inside the row's subtree the whole
                              // way out — so crossing the gap never drops the hover and
                              // the dot can be grabbed anywhere along the bridge.
                              className="absolute top-1/2 -translate-y-1/2 z-20 flex items-center transition-opacity"
                              style={{
                                [end === 'start' ? 'left' : 'right']: -28,
                                height: 24,
                                width: 30,
                                cursor: 'crosshair',
                                opacity: visible ? 1 : 0,
                                pointerEvents: grabbable ? 'auto' : 'none',
                                justifyContent: end === 'start' ? 'flex-start' : 'flex-end',
                                paddingLeft: end === 'start' ? 4 : 0,
                                paddingRight: end === 'end' ? 4 : 0,
                              }}
                              data-testid={`gantt-link-dot-${end}-${task.id}`}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                e.stopPropagation();
                                e.preventDefault();
                                const rect = contentRef.current?.getBoundingClientRect();
                                setLinkDrag({
                                  sourceId: task.id,
                                  sourceEnd: end,
                                  x: rect ? e.clientX - rect.left : 0,
                                  y: rect ? e.clientY - rect.top : 0,
                                  targetId: null,
                                  targetEnd: null,
                                  rejectedId: null,
                                  rejectedReason: null,
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div
                                className="rounded-full"
                                style={{
                                  height: 12,
                                  width: 12,
                                  backgroundColor: 'hsl(var(--background))',
                                  border: '2px solid hsl(var(--primary))',
                                  boxShadow: isSource ? '0 0 0 3px hsl(var(--primary) / 0.25)' : '0 1px 2px rgba(0,0,0,0.25)',
                                }}
                              />
                            </div>
                          );
                        })}

                        {/* Bar label — the task title, shown like summary bars so
                            leaf bars aren't blank. Fades out on hover to reveal the
                            progress / drag overlay below. */}
                        <span className="relative text-[10px] text-white font-medium truncate pointer-events-none group-hover:opacity-0 transition-opacity">
                          {task.title}
                        </span>
                        {/* Hover Details / drag tooltip — overlays the title so the
                            bar's text width never shifts on hover. */}
                        <span className="absolute inset-0 flex items-center px-2 text-[10px] text-white font-medium truncate opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          {isDragging
                            ? `${formatTaskDay(computeDragChanges(dragState!).start, 'numeric')} → ${formatTaskDay(dragPreviewEndDay(dragState!), 'numeric')}`
                            : `${Math.round(liveProgress)}%`}
                        </span>
                      </div>
                      {tooltip}
                    </div>
                   )
                })}
                {rowWindow.endIdx < rows.length && (
                  <div style={{ height: (rows.length - rowWindow.endIdx) * rowHeight }} aria-hidden="true" />
                )}

                {/* Dependency Links — SVG overlay above bars, below the Today
                    marker (z-20). pointer-events-none so bar drag/click win.
                    Paths use absolute row indices (windowing-independent);
                    links fully outside the row window are skipped. */}
                {(links.length > 0 || linkDrag) && (
                  <svg
                    className="absolute top-0 left-0 pointer-events-none z-10"
                    width={totalWidth}
                    height={totalRowsHeight}
                    data-testid="gantt-links"
                    aria-hidden="true"
                  >
                    {/* Colors via raw theme vars (not Tailwind stroke/fill
                        utilities): consuming apps load the prebuilt components
                        CSS, which never emits those utility classes. */}
                    <defs>
                      <marker
                        id="gantt-link-arrow"
                        viewBox="0 0 8 8"
                        refX="7"
                        refY="4"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M 0 0 L 8 4 L 0 8 z" fill="hsl(var(--muted-foreground))" />
                      </marker>
                      <marker
                        id="gantt-link-arrow-active"
                        viewBox="0 0 8 8"
                        refX="7"
                        refY="4"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M 0 0 L 8 4 L 0 8 z" fill="hsl(var(--primary))" />
                      </marker>
                      <marker
                        id="gantt-link-arrow-critical"
                        viewBox="0 0 8 8"
                        refX="7"
                        refY="4"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M 0 0 L 8 4 L 0 8 z" fill={CRIT_COLOR} />
                      </marker>
                    </defs>
                    {links.map((link) => {
                      const lo = Math.min(link.sourceIndex, link.targetIndex);
                      const hi = Math.max(link.sourceIndex, link.targetIndex);
                      if (hi < rowWindow.startIdx - ROW_OVERSCAN || lo > rowWindow.endIdx + ROW_OVERSCAN) return null;
                      const d = linkPath(link);
                      if (!d) return null;
                      const active =
                        activeLinkTaskId != null &&
                        (String(link.sourceId) === String(activeLinkTaskId) ||
                          String(link.targetId) === String(activeLinkTaskId));
                      const critEdge =
                        critical?.criticalEdges.has(`${String(link.sourceId)}->${String(link.targetId)}`) ?? false;
                      const marker = critEdge
                        ? 'gantt-link-arrow-critical'
                        : active
                          ? 'gantt-link-arrow-active'
                          : 'gantt-link-arrow';
                      // When dependency editing is enabled, lay an invisible,
                      // wide hit-path over each link. pointer-events IS inherited
                      // in SVG, so `pointerEvents="stroke"` on the child overrides
                      // the parent svg's `pointer-events-none`, making just the
                      // link right-clickable without stealing bar drag/click.
                      const editable = !!(onDependencyDelete || onDependencyCreate);
                      return (
                        <React.Fragment key={link.key}>
                          <path
                            d={d}
                            fill="none"
                            stroke={critEdge ? CRIT_COLOR : active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
                            strokeOpacity={critEdge || active ? 1 : 0.7}
                            strokeWidth={critEdge || active ? 2 : 1.5}
                            markerEnd={`url(#${marker})`}
                            data-testid={`gantt-link-${link.sourceId}-${link.targetId}`}
                            data-link-type={link.type}
                            data-active={active ? 'true' : 'false'}
                            data-critical={critEdge ? 'true' : undefined}
                          />
                          {editable && (
                            <path
                              d={d}
                              fill="none"
                              stroke="transparent"
                              strokeWidth={10}
                              style={{ pointerEvents: 'stroke', cursor: 'context-menu' }}
                              data-testid={`gantt-link-hit-${link.sourceId}-${link.targetId}`}
                              onContextMenu={(e) => openLinkContextMenu(link.sourceId, link.targetId, link.type, e)}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                    {/* Draft rubber band while dragging a connector dot */}
                    {linkDrag && (() => {
                      const si = rows.findIndex((r) => String(r.task.id) === String(linkDrag.sourceId));
                      if (si < 0) return null;
                      const s = getLiveRowStyle(rows[si]);
                      // Anchor the rubber band at the endpoint we dragged FROM:
                      // the Start dot draws from the bar's left edge, the Finish
                      // dot from its right edge (milestones collapse to the tip).
                      const sx = rows[si].isMilestone
                        ? s.left + (linkDrag.sourceEnd === 'start' ? -milestoneHalfTip : milestoneHalfTip)
                        : linkDrag.sourceEnd === 'start' ? s.left : s.left + s.width;
                      const sy = si * rowHeight + rowHeight / 2;
                      return (
                        <path
                          d={`M ${Math.round(sx)} ${Math.round(sy)} L ${Math.round(linkDrag.x)} ${Math.round(linkDrag.y)}`}
                          fill="none"
                          stroke="hsl(var(--primary))"
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          data-testid="gantt-link-draft"
                        />
                      );
                    })()}
                  </svg>
                )}
                {/* Drag hint — names the source/target endpoints so the user can
                    see which link type (FS/FF/SS/SF) the drop will create. */}
                {linkDrag && (() => {
                  const source = tasks.find((tk) => String(tk.id) === String(linkDrag.sourceId));
                  if (!source) return null;
                  const target = linkDrag.targetId != null
                    ? tasks.find((tk) => String(tk.id) === String(linkDrag.targetId))
                    : null;
                  const endLabel = (e: 'start' | 'end') => t(`gantt.linkEnd.${e}`);
                  const label = target
                    ? `${source.title} (${endLabel(linkDrag.sourceEnd)}) → ${target.title} (${endLabel(linkDrag.targetEnd ?? 'start')})`
                    : `${source.title} (${endLabel(linkDrag.sourceEnd)})`;
                  return (
                    <div
                      className="absolute z-30 pointer-events-none rounded-md border bg-popover text-popover-foreground px-2 py-1 text-[11px] font-medium shadow-md whitespace-nowrap"
                      style={{ left: linkDrag.x + 12, top: linkDrag.y + 12 }}
                      data-testid="gantt-link-draft-hint"
                    >
                      {label}
                    </div>
                  );
                })()}

              </div>
            </div>
          </div>

          {/* Self-drawn vertical scrollbar — the native bars
              are fully hidden (see the style block), so this is the one
              vertical affordance; synced with the timeline's scrollTop. */}
          <div
            ref={vBarRef}
            className="shrink-0 border-l bg-card/95 select-none"
            style={{ width: 14, display: 'none' }}
            data-testid="gantt-vscrollbar"
          >
            <div
              ref={vTrackRef}
              className="relative h-full"
              onPointerDown={onVTrackPointerDown}
              role="scrollbar"
              aria-controls="gantt-timeline"
              aria-orientation="vertical"
            >
              <div
                ref={vThumbRef}
                className="absolute rounded-full"
                style={{
                  left: 2,
                  right: 2,
                  top: 0,
                  height: 0,
                  backgroundColor: 'rgba(130,130,130,0.55)',
                  cursor: 'grab',
                }}
                data-testid="gantt-vscrollbar-thumb"
                onPointerDown={onVThumbPointerDown}
              />
            </div>
          </div>
        </div>

        {/* Always-visible horizontal scrollbar (self-drawn): sticky to the
            visible bottom so it stays reachable even when the pane's bottom
            edge extends past the viewport. Hidden by syncHScrollbar when the
            timeline fits. */}
        <div
          ref={hBarRef}
          className="shrink-0 border-t bg-card/95 select-none"
          style={{ position: 'sticky', bottom: 0, zIndex: 30, display: 'none' }}
          data-testid="gantt-hscrollbar"
        >
          <div
            ref={hTrackRef}
            className="relative"
            style={{ marginLeft: taskListWidth, height: 14 }}
            onPointerDown={onHTrackPointerDown}
            role="scrollbar"
            aria-controls="gantt-timeline"
            aria-orientation="horizontal"
          >
            <div
              ref={hThumbRef}
              className="absolute rounded-full"
              style={{
                top: 2,
                bottom: 2,
                left: 0,
                width: 0,
                backgroundColor: 'rgba(130,130,130,0.55)',
                cursor: 'grab',
              }}
              data-testid="gantt-hscrollbar-thumb"
              onPointerDown={onHThumbPointerDown}
            />
          </div>
        </div>
      </div>

      {/* Context menu — fixed-position so it escapes the scroll clipping */}
      {ctxMenu && (() => {
        const task = tasks.find((tk) => String(tk.id) === String(ctxMenu.taskId));
        if (!task) return null;
        const row = rows.find((r) => String(r.task.id) === String(ctxMenu.taskId));
        const itemCls = "w-full text-left px-3 py-1.5 hover:bg-accent focus:bg-accent outline-none";
        return (
          <div
            ref={ctxMenuRef}
            className="fixed z-50 min-w-[160px] rounded-md border bg-popover text-popover-foreground shadow-md py-1 text-sm"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            role="menu"
            data-testid="gantt-context-menu"
          >
            {onTaskClick && (
              <button
                type="button"
                role="menuitem"
                className={itemCls}
                data-testid="gantt-context-menu-view"
                onClick={() => { setCtxMenu(null); onTaskClick(task); }}
              >
                {t('gantt.menu.view')}
              </button>
            )}
            {inlineEdit && onTaskUpdate && row && !row.isSummary && !task.locked && (
              <button
                type="button"
                role="menuitem"
                className={itemCls}
                data-testid="gantt-context-menu-edit"
                onClick={() => {
                  setCtxMenu(null);
                  setEditingTask(task.id);
                  setEditValues({
                    title: task.title,
                    start: task.start.toLocaleDateString('en-CA'),
                    // The day the bar runs through (objectui#11141).
                    end: toDateInputValue(endDayOf(task.start, task.end)),
                    progress: String(task.progress),
                  });
                }}
              >
                {t('gantt.menu.edit')}
              </button>
            )}
            {onDependencyCreate && row && !row.isMilestone && !task.locked && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={itemCls}
                  data-testid="gantt-context-menu-add-predecessor"
                  onClick={() => {
                    const at = ctxMenu;
                    setCtxMenu(null);
                    setDepPickerQuery('');
                    setDepPicker({ x: at.x, y: at.y, taskId: task.id, relation: 'pred' });
                  }}
                >
                  {t('gantt.menu.addPredecessor')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={itemCls}
                  data-testid="gantt-context-menu-add-successor"
                  onClick={() => {
                    const at = ctxMenu;
                    setCtxMenu(null);
                    setDepPickerQuery('');
                    setDepPicker({ x: at.x, y: at.y, taskId: task.id, relation: 'succ' });
                  }}
                >
                  {t('gantt.menu.addSuccessor')}
                </button>
              </>
            )}
            {onTaskDelete && !task.locked && (
              <button
                type="button"
                role="menuitem"
                className={cn(itemCls, "text-destructive")}
                data-testid="gantt-context-menu-delete"
                onClick={() => { setCtxMenu(null); onTaskDelete(task); }}
              >
                {t('gantt.menu.delete')}
              </button>
            )}
          </div>
        );
      })()}

      {/* Dependency link context menu (link type + remove) — fixed-position. */}
      {linkCtxMenu && (() => {
        const source = tasks.find((tk) => String(tk.id) === String(linkCtxMenu.sourceId));
        const target = tasks.find((tk) => String(tk.id) === String(linkCtxMenu.targetId));
        if (!source || !target) return null;
        const itemCls = "w-full text-left px-3 py-1.5 hover:bg-accent focus:bg-accent outline-none";
        const LINK_TYPES: GanttLinkType[] = ['fs', 'ss', 'ff', 'sf'];
        // The dependency list lives on the TARGET (successor) record — a locked
        // target means every menu action writes a record the user can't edit,
        // so the whole menu goes read-only with the lock hint shown inline.
        const linkLocked = !!target.locked;
        return (
          <div
            ref={linkCtxMenuRef}
            className="fixed z-50 min-w-[180px] rounded-md border bg-popover text-popover-foreground shadow-md py-1 text-sm"
            style={{ left: linkCtxMenu.x, top: linkCtxMenu.y }}
            role="menu"
            data-testid="gantt-link-context-menu"
          >
            <div className="px-3 py-1 text-xs text-muted-foreground truncate">
              {source.title} → {target.title}
            </div>
            {linkLocked && (
              <div className="px-3 py-1 text-xs text-muted-foreground" data-testid="gantt-link-menu-locked">
                🚫 {t('gantt.lockedHint')}
              </div>
            )}
            {onDependencyCreate && dependencyTypes && LINK_TYPES.map((lt) => (
              <button
                key={lt}
                type="button"
                role="menuitemradio"
                aria-checked={linkCtxMenu.type === lt}
                disabled={linkLocked}
                className={cn(itemCls, linkCtxMenu.type === lt && "font-semibold", linkLocked && "opacity-50 cursor-not-allowed hover:bg-transparent")}
                data-testid={`gantt-link-menu-type-${lt}`}
                onClick={() => {
                  if (linkLocked) return;
                  setLinkCtxMenu(null);
                  if (lt !== linkCtxMenu.type) onDependencyCreate(source, target, lt);
                }}
              >
                {linkCtxMenu.type === lt ? '✓ ' : '  '}
                {t(`gantt.linkType.${lt}`)}
              </button>
            ))}
            {onDependencyDelete && (
              <>
                <div className="my-1 border-t" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={linkLocked}
                  className={cn(itemCls, "text-destructive", linkLocked && "opacity-50 cursor-not-allowed hover:bg-transparent")}
                  data-testid="gantt-link-menu-remove"
                  onClick={() => {
                    if (linkLocked) return;
                    setLinkCtxMenu(null);
                    onDependencyDelete(source, target);
                  }}
                >
                  {t('gantt.menu.removeDependency')}
                </button>
              </>
            )}
          </div>
        );
      })()}

      {/* "Add predecessor / successor" task picker — lists candidate tasks; choosing one
          creates a dependency. Excludes self and tasks already linked in that
          direction (avoids no-op duplicates). */}
      {depPicker && onDependencyCreate && (() => {
        const anchor = tasks.find((tk) => String(tk.id) === String(depPicker.taskId));
        if (!anchor) return null;
        const itemCls = "w-full text-left px-3 py-1.5 hover:bg-accent focus:bg-accent outline-none truncate";
        // Existing links so we hide candidates already connected this way.
        const existing = new Set(
          links.map((l) => `${String(l.sourceId)}->${String(l.targetId)}`),
        );
        // Candidates = rows that can actually participate in a dependency:
        // 'group' tree headers have no bar to schedule, and locked (view-only)
        // rows must not enter new links. Summary rows stay IN — they are
        // draggable (group move) and in parent-child models (plan → locked
        // work order) the summary row is exactly the linkable record.
        const candidates = tasks.filter((c) => {
          if (String(c.id) === String(anchor.id)) return false;
          if (c.type === 'group' || c.locked) return false;
          const key = depPicker.relation === 'pred'
            ? `${String(c.id)}->${String(anchor.id)}`
            : `${String(anchor.id)}->${String(c.id)}`;
          return !existing.has(key);
        });
        const query = depPickerQuery.trim().toLowerCase();
        const visible = query
          ? candidates.filter((c) => String(c.title ?? '').toLowerCase().includes(query))
          : candidates;
        return (
          <div
            ref={depPickerRef}
            className="fixed z-50 min-w-[200px] max-h-[280px] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md py-1 text-sm"
            style={{ left: depPicker.x, top: depPicker.y }}
            role="menu"
            data-testid="gantt-dep-picker"
          >
            <div className="px-3 py-1 text-xs text-muted-foreground">
              {depPicker.relation === 'pred' ? t('gantt.menu.addPredecessor') : t('gantt.menu.addSuccessor')}
            </div>
            <div className="px-2 pb-1">
              <input
                className="border rounded px-2 py-1 text-sm w-full bg-background"
                value={depPickerQuery}
                onChange={(e) => setDepPickerQuery(e.target.value)}
                placeholder={t('gantt.menu.searchTasks')}
                data-testid="gantt-dep-picker-search"
                autoFocus
              />
            </div>
            {visible.length === 0 ? (
              <div className="px-3 py-1.5 text-muted-foreground">{t('gantt.menu.noCandidates')}</div>
            ) : (
              visible.map((c) => (
                <button
                  key={String(c.id)}
                  type="button"
                  role="menuitem"
                  className={itemCls}
                  data-testid={`gantt-dep-picker-option-${c.id}`}
                  onClick={() => {
                    setDepPicker(null);
                    if (depPicker.relation === 'pred') onDependencyCreate(c, anchor, 'fs');
                    else onDependencyCreate(anchor, c, 'fs');
                  }}
                >
                  {c.title}
                </button>
              ))
            )}
          </div>
        );
      })()}

      {/* Auto-schedule confirmation — the toolbar wand computes first, then
          asks before the bulk write; mirrors the conflict dialog's interaction
          contract. */}
      {pendingAutoSchedule && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          data-testid="gantt-autoschedule-overlay"
          onClick={() => setPendingAutoSchedule(null)}
        >
          <div
            className="min-w-[280px] max-w-[360px] rounded-lg border bg-popover text-popover-foreground shadow-lg p-4"
            role="alertdialog"
            aria-modal="true"
            data-testid="gantt-autoschedule-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold mb-1" data-testid="gantt-autoschedule-title">
              {t('gantt.autoScheduleDlg.title')}
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              {t('gantt.autoScheduleDlg.body', { count: pendingAutoSchedule.changes.length })}
              {pendingAutoSchedule.skipped > 0 && (
                <>
                  {' '}
                  <span data-testid="gantt-autoschedule-skipped">
                    {t('gantt.autoScheduleDlg.skipped', { count: pendingAutoSchedule.skipped })}
                  </span>
                </>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent outline-none"
                data-testid="gantt-autoschedule-cancel"
                onClick={() => setPendingAutoSchedule(null)}
              >
                {t('gantt.autoScheduleDlg.cancel')}
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 outline-none"
                data-testid="gantt-autoschedule-confirm"
                onClick={applyAutoSchedule}
              >
                {t('gantt.autoScheduleDlg.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Nothing to reschedule" transient notice (`gantt.autoScheduleDlg.none`)
          — every link already holds. */}
      {autoScheduleClean && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] rounded-md border bg-popover text-popover-foreground px-3 py-1.5 text-sm shadow-md"
          role="status"
          data-testid="gantt-autoschedule-clean"
        >
          {t('gantt.autoScheduleDlg.none')}
        </div>
      )}

      {/* Drag conflict → auto-reschedule confirmation (Group 2). A centered
          modal lists how many tasks would shift and offers to auto-reschedule
          (`gantt.conflict.confirm`) or keep the manual placement
          (`gantt.conflict.cancel`). */}
      {pendingConflict && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30"
          data-testid="gantt-conflict-overlay"
          onClick={() => setPendingConflict(null)}
        >
          <div
            className="min-w-[280px] max-w-[360px] rounded-lg border bg-popover text-popover-foreground shadow-lg p-4"
            role="alertdialog"
            aria-modal="true"
            data-testid="gantt-conflict-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold mb-1" data-testid="gantt-conflict-title">
              {t('gantt.conflict.title')}
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              {t('gantt.conflict.body', { count: pendingConflict.length })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent outline-none"
                data-testid="gantt-conflict-cancel"
                onClick={() => setPendingConflict(null)}
              >
                {t('gantt.conflict.cancel')}
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 outline-none"
                data-testid="gantt-conflict-confirm"
                onClick={applyReschedule}
              >
                {t('gantt.conflict.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
