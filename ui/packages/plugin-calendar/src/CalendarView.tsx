/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, CalendarIcon, PlusIcon } from "lucide-react"
import { 
  cn, 
  Button, 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue,
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@object-ui/components"
import { createSafeTranslation, firstDayOfWeek, useDisplayLocale, type WeekdayIndex } from "@object-ui/i18n"
import { getMonthDays, getWeekStart } from "./visibleDays"

const DEFAULT_EVENT_COLOR = "bg-blue-100 text-blue-900 border border-blue-200"
const STABLE_DEFAULT_DATE = new Date()

// Curated 8-stop palette for categorical event colors. Soft tinted backgrounds
// (`bg-*-100`) with darker readable text (`text-*-900`) keep the calendar
// visually quiet — matching the same tonal range used by list/grid badges
// (see `getBadgeColorClasses` in `@object-ui/fields`). Avoids the harsh,
// over-saturated solid palette that competes with the rest of the chrome.
const CATEGORICAL_PALETTE: ReadonlyArray<string> = [
  "bg-blue-100 text-blue-900 border border-blue-200",
  "bg-emerald-100 text-emerald-900 border border-emerald-200",
  "bg-amber-100 text-amber-900 border border-amber-200",
  "bg-rose-100 text-rose-900 border border-rose-200",
  "bg-violet-100 text-violet-900 border border-violet-200",
  "bg-cyan-100 text-cyan-900 border border-cyan-200",
  "bg-orange-100 text-orange-900 border border-orange-200",
  "bg-fuchsia-100 text-fuchsia-900 border border-fuchsia-200",
]

// Hex colors (#abc, #aabbcc) are treated as direct values via inline style.
const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
// Recognize tokens that already look like Tailwind color utilities so we
// don't re-hash them. Covers `bg-*-500`, `bg-blue-500`, `text-*`, etc.
const TAILWIND_TOKEN_RE = /(^|\s)(bg|text|from|to|via)-/

/**
 * Resolve a raw `event.color` value into a stable Tailwind class string.
 *
 * - `#aabbcc` and `#abc` are returned as-is (rendered via inline style).
 * - Strings that already look like Tailwind utilities (e.g. `bg-blue-500
 *   text-white`) pass through unchanged.
 * - Any other value (e.g. a category label like `"email"` or `"digital"`)
 *   is hashed deterministically onto the 8-stop palette so the same value
 *   always gets the same color — matching how Notion/Linear assign labels.
 * - `undefined` / `null` / empty → `DEFAULT_EVENT_COLOR`.
 */
function resolveEventColor(raw: string | undefined | null): { className: string; inlineColor?: string } {
  if (!raw) return { className: DEFAULT_EVENT_COLOR }
  if (HEX_COLOR_RE.test(raw)) return { className: "text-white", inlineColor: raw }
  if (TAILWIND_TOKEN_RE.test(raw)) return { className: raw }
  // Categorical fallback: deterministic hash over the string.
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0
  }
  return { className: CATEGORICAL_PALETTE[Math.abs(hash) % CATEGORICAL_PALETTE.length] }
}

// Default English translations for fallback when I18nProvider is not available
const DEFAULT_TRANSLATIONS: Record<string, string> = {
  'calendar.today': 'Today',
  'calendar.month': 'Month',
  'calendar.week': 'Week',
  'calendar.day': 'Day',
  'calendar.newEvent': 'New event',
  'calendar.moreEvents': '+{{count}} more',
  'calendar.allDay': 'All Day',
  // Accessible names. These are the ONLY names the two landmarks below have,
  // so a pack that cannot reach them leaves a screen-reader user on a
  // translated console hearing English (objectui#10104).
  'calendar.a11y.region': 'Calendar',
  'calendar.a11y.grid': 'Calendar grid',
  'calendar.a11y.goToToday': 'Go to today',
  'calendar.a11y.previousPeriod': 'Previous period',
  'calendar.a11y.nextPeriod': 'Next period',
  'calendar.a11y.currentDate': 'Current date: {{date}}',
  'calendar.a11y.dayCell': '{{date}}, {{count}} events',
  'calendar.a11y.resizeEventEnd': 'Resize event end',
  'calendar.a11y.resizeEventEndHint': 'Drag to change end date',
  'calendar.a11y.resizeStart': 'Resize start',
  'calendar.a11y.resizeEnd': 'Resize end',
}

/**
 * Safe wrapper for useObjectTranslation that falls back to English defaults
 * when I18nProvider is not available (e.g., standalone usage outside console).
 *
 * Delegates to `@object-ui/i18n`'s `createSafeTranslation`; the local copy this
 * replaced wrapped the hook in try/catch (rules-of-hooks, objectui#2879).
 */
const useCalendarTranslation = createSafeTranslation(DEFAULT_TRANSLATIONS, 'calendar.today')

/**
 * The `CalendarView` component's RUNTIME event: what the React component
 * receives on its `events` prop, already parsed — `start` / `end` are real
 * `Date` objects, and `id` may be the numeric key a data source returned.
 *
 * Renamed from `CalendarEvent` in objectui#5044, following the objectui#4650
 * precedent (`ObjectCalendarProps` -> `ObjectCalendarComponentProps`).
 * `@object-ui/types` owns `CalendarEvent`, where it is the AUTHORING event —
 * `id: string`, `start` / `end` accepting ISO strings with `end` REQUIRED, plus
 * a `description` this one does not have. The two are structurally
 * incompatible in BOTH directions (`id` and `start` each conflict), so picking
 * the wrong one out of IDE auto-import failed as a remote `TS2322` about
 * `Date`, never as "you imported from the wrong package" — measured on
 * `README.md`'s own example, which stayed uncompilable through objectui#5010's
 * import-path fix because both names were real exports.
 *
 * `index.tsx` keeps a `@deprecated` `CalendarEvent` alias for this type, so
 * existing importers keep compiling; the rename is what stops the collision,
 * not a removal.
 */
export interface CalendarViewEvent {
  id: string | number
  title: string
  start: Date
  end?: Date
  allDay?: boolean
  color?: string
  data?: any
}

export interface CalendarViewProps {
  events?: CalendarViewEvent[]
  view?: "month" | "week" | "day"
  currentDate?: Date
  locale?: string
  onEventClick?: (event: CalendarViewEvent) => void
  onDateClick?: (date: Date) => void
  onViewChange?: (view: "month" | "week" | "day") => void
  onNavigate?: (date: Date) => void
  onAddClick?: () => void
  onEventDrop?: (event: CalendarViewEvent, newStart: Date, newEnd?: Date) => void
  /**
   * Fired in WeekView/DayView when the user drags across an empty area of
   * the time grid to select a time range. The default ObjectCalendar
   * handler opens a quick-create dialog pre-filled with `start` and `end`.
   */
  onTimeRangeSelect?: (start: Date, end: Date) => void
  /** Granularity in minutes used by WeekView/DayView for snapping
   * drag-to-move, drag-to-resize, and drag-to-create. Defaults to 30. */
  slotMinutes?: number
  className?: string
}

function CalendarView({
  events = [],
  view = "month",
  currentDate = STABLE_DEFAULT_DATE,
  locale = "default",
  onEventClick,
  onDateClick,
  onViewChange,
  onNavigate,
  onAddClick,
  onEventDrop,
  onTimeRangeSelect,
  slotMinutes = 30,
  className,
}: CalendarViewProps) {
  const [selectedView, setSelectedView] = React.useState(view)
  const [selectedDate, setSelectedDate] = React.useState(currentDate)
  const { t } = useCalendarTranslation()
  // An explicit `locale` prop is the host's choice and still wins. Only the
  // `"default"` branch reads the session, and it reads the DISPLAY locale,
  // never the UI language (objectui#10442).
  const displayLocale = useDisplayLocale()
  const effectiveLocale = locale !== "default" ? locale : displayLocale
  // The first day of the week is the locale's, read from the tag every date
  // here formats with (objectui#11675): `en-US` starts on Sunday, `en-GB` and
  // `zh-CN` on Monday. The month grid and its weekday heads, the week view's
  // columns, the header's week range and the date popover all take this one
  // answer, so no two of them start the week on different days.
  const weekStart = firstDayOfWeek(effectiveLocale)

  // Sync state if props change
  React.useEffect(() => {
    setSelectedDate(currentDate)
  }, [currentDate])

  React.useEffect(() => {
    setSelectedView(view)
  }, [view])

  // Auto-switch to day view on mobile
  const onViewChangeRef = React.useRef(onViewChange)
  onViewChangeRef.current = onViewChange

  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)")
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setSelectedView("day")
        onViewChangeRef.current?.("day")
      }
    }
    handleChange(mq)
    mq.addEventListener("change", handleChange)
    return () => mq.removeEventListener("change", handleChange)
  }, [])

  const handlePrevious = () => {
    const newDate = new Date(selectedDate)
    if (selectedView === "month") {
      newDate.setMonth(newDate.getMonth() - 1)
    } else if (selectedView === "week") {
      newDate.setDate(newDate.getDate() - 7)
    } else {
      newDate.setDate(newDate.getDate() - 1)
    }
    setSelectedDate(newDate)
    onNavigate?.(newDate)
  }

  const handleNext = () => {
    const newDate = new Date(selectedDate)
    if (selectedView === "month") {
      newDate.setMonth(newDate.getMonth() + 1)
    } else if (selectedView === "week") {
      newDate.setDate(newDate.getDate() + 7)
    } else {
      newDate.setDate(newDate.getDate() + 1)
    }
    setSelectedDate(newDate)
    onNavigate?.(newDate)
  }

  const handleToday = () => {
    const today = new Date()
    setSelectedDate(today)
    onNavigate?.(today)
  }

  const handleViewChange = (newView: "month" | "week" | "day") => {
    setSelectedView(newView)
    onViewChange?.(newView)
  }

  // The header names the period twice: in full, and in a short form for
  // phone widths, where the full day label ("Tuesday, October 20, 2026")
  // does not fit beside the navigation buttons. Both come from the same
  // locale-aware formatter; the short form drops the year and spells the
  // weekday and month short ("Tue, Oct 20"), or the month short in the month
  // view ("Oct 2026"). The full form is the accessible name and the tooltip.
  const getDateLabel = (form: "full" | "short" = "full") => {
    const short = form === "short"
    if (selectedView === "month") {
      return selectedDate.toLocaleDateString(effectiveLocale, {
        month: short ? "short" : "long",
        year: "numeric",
      })
    } else if (selectedView === "week") {
      const firstDay = getWeekStart(selectedDate, weekStart)
      const weekEnd = new Date(firstDay)
      weekEnd.setDate(weekEnd.getDate() + 6)
      return `${firstDay.toLocaleDateString(effectiveLocale, {
        month: "short",
        day: "numeric",
      })} - ${weekEnd.toLocaleDateString(effectiveLocale, short ? {
        month: "short",
        day: "numeric",
      } : {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`
    } else {
      return selectedDate.toLocaleDateString(effectiveLocale, short ? {
        weekday: "short",
        month: "short",
        day: "numeric",
      } : {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    }
  }

  // Swipe navigation for mobile
  const touchStart = React.useRef<number>(0)
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = e.touches[0].clientX
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStart.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 50) {
      const newDate = new Date(selectedDate)
      if (selectedView === "day") newDate.setDate(newDate.getDate() + (diff > 0 ? 1 : -1))
      else if (selectedView === "week") newDate.setDate(newDate.getDate() + (diff > 0 ? 7 : -7))
      else newDate.setMonth(newDate.getMonth() + (diff > 0 ? 1 : -1))
      setSelectedDate(newDate)
      onNavigate?.(newDate)
    }
  }

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date)
      onNavigate?.(date)
    }
  }

  return (
    <div role="region" aria-label={t('calendar.a11y.region')} className={cn("flex flex-col h-full bg-background min-w-0 overflow-hidden", className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2 sm:p-4 border-b min-w-0">
        {/*
          The left group may shrink below its content (`min-w-0`) so the date
          title truncates with an ellipsis instead of being clipped by the
          region's `overflow-hidden` at phone widths; the button group keeps
          its size.
        */}
        <div className="flex items-center gap-4 min-w-0 max-w-full">
          <div className="flex shrink-0 items-center bg-muted/50 rounded-lg p-1 gap-1">
             <Button variant="ghost" size="sm" onClick={handleToday} className="h-8" aria-label={t('calendar.a11y.goToToday')}>
               {t('calendar.today')}
             </Button>
             <div className="h-4 w-px bg-border mx-1" />
             <Button
               variant="ghost"
               size="icon"
               aria-label={t('calendar.a11y.previousPeriod')}
               onClick={handlePrevious}
               className="h-8 w-8"
             >
               <ChevronLeftIcon className="h-4 w-4" />
             </Button>
             <Button
               variant="ghost"
               size="icon"
               aria-label={t('calendar.a11y.nextPeriod')}
               onClick={handleNext}
               className="h-8 w-8"
             >
               <ChevronRightIcon className="h-4 w-4" />
             </Button>
          </div>
          
          <Popover>
            <PopoverTrigger asChild>
              <Button 
                variant="ghost" 
                aria-label={t('calendar.a11y.currentDate', { date: getDateLabel() })}
                title={getDateLabel()}
                className={cn(
                  "text-base sm:text-xl font-semibold h-auto px-2 sm:px-3 py-1 hover:bg-muted/50 transition-colors",
                  "flex items-center gap-2 min-w-0 max-w-full"
                )}
              >
                <CalendarIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span data-date-label="full" className="hidden min-w-0 truncate sm:block">{getDateLabel()}</span>
                <span data-date-label="short" className="min-w-0 truncate sm:hidden">{getDateLabel("short")}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              {/*
                The popover reads the grids' locale, not the session's: an
                authored `locale` reaches its caption and weekday heads too
                (objectui#10747). `Calendar` resolves the tag through the one
                date-fns resolver in `@object-ui/components`.

                It opens on the month the header names (objectui#10799):
                react-day-picker opens on `month`, else `defaultMonth`, else
                today, and `selected` does not move it. The content unmounts
                when the popover closes, so every open reads the current date.
                A host may hand an invalid `Date` (the view renderer passes a
                `Date` instance through untouched): that names no month, and
                react-day-picker throws on an invalid `defaultMonth`, so it
                opens on today instead, as it always did.

                Its weeks start on the grids' first day (objectui#11675).
                react-day-picker would otherwise read the date-fns locale's
                own `weekStartsOn`, which is not CLDR's for every tag (date-fns
                has no `es-MX`, so that tag reads `es`, a Monday start, where
                CLDR starts Mexico's week on Sunday), and which reads `enUS`,
                a Sunday start, until the locale has loaded.
              */}
              <Calendar
                localeTag={effectiveLocale}
                weekStartsOn={weekStart}
                mode="single"
                defaultMonth={Number.isNaN(selectedDate.getTime()) ? undefined : selectedDate}
                selected={selectedDate}
                onSelect={handleDateSelect}
                autoFocus
                startMonth={new Date(2000, 0)}
                endMonth={new Date(2050, 11)}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-2">
          <Select value={selectedView} onValueChange={handleViewChange}>
            <SelectTrigger className="w-32 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">{t('calendar.day')}</SelectItem>
              <SelectItem value="week">{t('calendar.week')}</SelectItem>
              <SelectItem value="month">{t('calendar.month')}</SelectItem>
            </SelectContent>
          </Select>
          
          {onAddClick && (
            <Button onClick={onAddClick} size="sm" className="gap-1">
              <PlusIcon className="h-4 w-4" />
              {t('calendar.newEvent')}
            </Button>
          )}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {selectedView === "month" && (
          <MonthView
            date={selectedDate}
            events={events}
            locale={effectiveLocale}
            weekStart={weekStart}
            onEventClick={onEventClick}
            onDateClick={onDateClick}
            onEventDrop={onEventDrop}
          />
        )}
        {selectedView === "week" && (
          <TimeGridView
            mode="week"
            date={selectedDate}
            events={events}
            locale={effectiveLocale}
            weekStart={weekStart}
            slotMinutes={slotMinutes}
            onEventClick={onEventClick}
            onEventDrop={onEventDrop}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        )}
        {selectedView === "day" && (
          <TimeGridView
            mode="day"
            date={selectedDate}
            events={events}
            locale={effectiveLocale}
            weekStart={weekStart}
            slotMinutes={slotMinutes}
            onEventClick={onEventClick}
            onEventDrop={onEventDrop}
            onTimeRangeSelect={onTimeRangeSelect}
          />
        )}
      </div>
    </div>
  )
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

function getEventsForDate(date: Date, events: CalendarViewEvent[]): CalendarViewEvent[] {
  return events.filter((event) => {
    const eventStart = new Date(event.start)
    const eventEnd = event.end ? new Date(event.end) : new Date(eventStart)

    // Create new date objects for comparison to avoid mutation
    const dateStart = new Date(date)
    dateStart.setHours(0, 0, 0, 0)
    const dateEnd = new Date(date)
    dateEnd.setHours(23, 59, 59, 999)

    const eventStartTime = new Date(eventStart)
    eventStartTime.setHours(0, 0, 0, 0)
    const eventEndTime = new Date(eventEnd)
    eventEndTime.setHours(23, 59, 59, 999)

    return dateStart <= eventEndTime && dateEnd >= eventStartTime
  })
}

/**
 * The calendar days from `from`'s local day to `to`'s: the difference of their
 * local year / month / day, counted on the UTC calendar, where every day is
 * exactly 24 hours, so the quotient is a whole number. ⛔ Never the
 * milliseconds between two local midnights over a day's length: across a DST
 * change that span is 23 or 25 hours (objectui#11005).
 */
function calendarDaysBetween(from: Date, to: Date): number {
  return (
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
    86_400_000
  )
}

/**
 * `value` moved by `days` calendar days on the local calendar: a copy whose
 * date moves with `setDate`, its hours, minutes, seconds and milliseconds
 * untouched, so a 10:00 event stays at 10:00 across a DST change and a value
 * at local midnight stays at midnight of the day it lands on (objectui#11005).
 */
function moveByCalendarDays(value: Date, days: number): Date {
  const moved = new Date(value)
  moved.setDate(moved.getDate() + days)
  return moved
}

interface MonthViewProps {
  date: Date
  events: CalendarViewEvent[]
  locale?: string
  /** The first day of each row and of the weekday heads (objectui#11675). */
  weekStart: WeekdayIndex
  onEventClick?: (event: CalendarViewEvent) => void
  onDateClick?: (date: Date) => void
  onEventDrop?: (event: CalendarViewEvent, newStart: Date, newEnd?: Date) => void
}

function MonthView({ date, events, locale = "default", weekStart, onEventClick, onDateClick, onEventDrop }: MonthViewProps) {
  const days = React.useMemo(() => getMonthDays(date, weekStart), [date.getFullYear(), date.getMonth(), weekStart])
  const today = React.useMemo(() => new Date(), [])
  const { t } = useCalendarTranslation()
  const weekDays = React.useMemo(() => {
    // 7 January 2024 is a Sunday, so `weekStart` days after it is the week's
    // first day, and the heads run from there in the grid's column order.
    const refSunday = new Date(2024, 0, 7)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(refSunday)
      d.setDate(d.getDate() + weekStart + i)
      return d.toLocaleDateString(locale, { weekday: "short" })
    })
  }, [locale, weekStart])
  const [draggedEventId, setDraggedEventId] = React.useState<string | number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = React.useState<number | null>(null)

  // Pre-build event index by date key for O(1) lookup per cell instead of O(N).
  // Each entry carries `isTitleDay` so the renderer can show the event title
  // only at the start of the span (or at the start of each week for spans
  // that wrap into a new row) and a slim continuation bar on subsequent
  // days — same as Google/Outlook calendars. Without this, a multi-month
  // event would repeat its title in every single day cell.
  const eventsByDate = React.useMemo(() => {
    const map = new Map<string, Array<{ event: CalendarViewEvent; isTitleDay: boolean; isSpanStart: boolean; isSpanEnd: boolean }>>()
    for (const event of events) {
      const eventStart = new Date(event.start)
      const eventEnd = event.end ? new Date(event.end) : new Date(eventStart)
      eventStart.setHours(0, 0, 0, 0)
      eventEnd.setHours(0, 0, 0, 0)
      const cursor = new Date(eventStart)
      while (cursor <= eventEnd) {
        const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
        const isSpanStart = cursor.getTime() === eventStart.getTime()
        const isSpanEnd = cursor.getTime() === eventEnd.getTime()
        // Show the title on:
        //   - the event's start day
        //   - the first day of each new week the span enters (the
        //     locale's first day, the one each grid row opens on)
        //   - the event's end day (so the user sees where it ends, and so
        //     the right-edge resize handle gets full hit area)
        // Single-day events naturally satisfy isSpanStart && isSpanEnd.
        const isTitleDay = isSpanStart || isSpanEnd || cursor.getDay() === weekStart
        const arr = map.get(key)
        const entry = { event, isTitleDay, isSpanStart, isSpanEnd }
        if (arr) {
          arr.push(entry)
        } else {
          map.set(key, [entry])
        }
        cursor.setDate(cursor.getDate() + 1)
      }
    }
    return map
  }, [events, weekStart])

  // Drag mode: "move" shifts the entire event so the day cell the user
  // grabbed lands on the drop-target day. "resize-end" only adjusts the
  // event's end date — used by the right-edge resize handle on multi-day
  // spans. Both move a value by calendar days and keep its time of day
  // (`moveByCalendarDays`, objectui#11005). The mode and the source cell
  // are encoded in the dataTransfer
  // payload so the drop target doesn't need any DOM state to interpret the
  // gesture, and so dragging from a *continuation* day of a multi-day
  // event still results in a sensible delta.
  type DragPayload = {
    id: string | number
    mode: "move" | "resize-end"
    sourceDay?: string // ISO date (yyyy-mm-dd) of the cell drag started from
  }

  const handleDragStart = (
    e: React.DragEvent,
    event: CalendarViewEvent,
    mode: "move" | "resize-end" = "move",
    sourceDay?: Date,
  ) => {
    setDraggedEventId(event.id)
    e.dataTransfer.effectAllowed = "move"
    const payload: DragPayload = {
      id: event.id,
      mode,
      ...(sourceDay
        ? { sourceDay: `${sourceDay.getFullYear()}-${sourceDay.getMonth()}-${sourceDay.getDate()}` }
        : {}),
    }
    e.dataTransfer.setData("text/plain", JSON.stringify(payload))
    // Prevent the parent move-drag from firing when grabbing the resize
    // handle, otherwise both gestures would fight over the same event.
    if (mode === "resize-end") {
      e.stopPropagation()
    }
  }

  const handleDragEnd = () => {
    setDraggedEventId(null)
    setDropTargetIndex(null)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDropTargetIndex(index)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear when actually leaving the cell, not when moving over child elements
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTargetIndex(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetDay: Date) => {
    e.preventDefault()
    setDropTargetIndex(null)
    setDraggedEventId(null)

    if (!onEventDrop) return

    const raw = e.dataTransfer.getData("text/plain")
    let payload: DragPayload
    try {
      payload = JSON.parse(raw) as DragPayload
    } catch {
      // Backwards-compat: older payloads were just the bare id string.
      payload = { id: raw, mode: "move" }
    }
    const draggedEvent = events.find((ev) => String(ev.id) === String(payload.id))
    if (!draggedEvent) return

    const newTargetDay = new Date(targetDay)
    newTargetDay.setHours(0, 0, 0, 0)

    if (payload.mode === "resize-end") {
      // Resize: move the end to the drop-target day, keep start fixed. The
      // handle sits on the span's end cell, so the grabbed cell is the end's
      // own day, and the end moves by the calendar days from it to the drop
      // cell with its time of day untouched (objectui#11005).
      const oldEnd = draggedEvent.end ? new Date(draggedEvent.end) : new Date(draggedEvent.start)
      const days = calendarDaysBetween(oldEnd, newTargetDay)
      if (days === 0) return
      // Guard: new end can't precede start day.
      const startDay = new Date(draggedEvent.start)
      startDay.setHours(0, 0, 0, 0)
      if (newTargetDay.getTime() < startDay.getTime()) return
      onEventDrop(draggedEvent, new Date(draggedEvent.start), moveByCalendarDays(oldEnd, days))
      return
    }

    // Move: translate both start and end by the same number of calendar
    // days, each keeping its time of day (objectui#11005). When sourceDay
    // is present (drag started from a specific cell of the span), the
    // days are counted from sourceDay to targetDay so the grabbed cell
    // lands on the drop target. Without sourceDay we fall back to the
    // event's start day (legacy behavior).
    //
    // ⛔ Not the milliseconds between the two cells' local midnights added
    // to each instant: across a DST change that span is 23 or 25 hours, so a
    // 10:00 event landed at 09:00 or 11:00, and a span starting at local
    // midnight, grabbed on a later cell, started at 23:00 of the day before
    // the one it was dropped on.
    const oldStart = new Date(draggedEvent.start)
    let anchorDay: Date
    if (payload.sourceDay) {
      const [y, m, d] = payload.sourceDay.split("-").map((v) => parseInt(v, 10))
      anchorDay = new Date(y, m, d)
    } else {
      anchorDay = oldStart
    }
    const days = calendarDaysBetween(anchorDay, newTargetDay)
    if (days === 0) return
    const newStart = moveByCalendarDays(oldStart, days)
    let newEnd: Date | undefined
    if (draggedEvent.end) {
      newEnd = moveByCalendarDays(new Date(draggedEvent.end), days)
    }
    onEventDrop(draggedEvent, newStart, newEnd)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Week day headers */}
      <div role="row" className="grid grid-cols-7 border-b">
        {weekDays.map((day) => (
          <div
            key={day}
            role="columnheader"
            className="p-2 text-center text-sm font-medium text-muted-foreground border-r last:border-r-0"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar days */}
      <div role="grid" aria-label={t('calendar.a11y.grid')} className="grid grid-cols-7 flex-1 auto-rows-fr">
        {days.map((day, index) => {
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
          const dayEvents = eventsByDate.get(key) || []
          const isCurrentMonth = day.getMonth() === date.getMonth()
          const isToday = isSameDay(day, today)
          // The gridcell's accessible name is the ONLY name a screen reader has
          // for this day, so it is formatted with the SAME resolved locale the
          // weekday column headers above already use — `locale`, which
          // `CalendarView` fills from `effectiveLocale`. Handing `Intl` the
          // literal `"default"` here meant the MACHINE's locale, so a `de-DE`
          // session heard German column headers beside dates spoken in whatever
          // the runtime happened to be set to (objectui#10144).
          const dayLabel = day.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" })

          return (
            <div
              key={index}
              role="gridcell"
              aria-label={
                dayEvents.length > 0
                  ? t('calendar.a11y.dayCell', { date: dayLabel, count: dayEvents.length })
                  : dayLabel
              }
              className={cn(
                "border-b border-r last:border-r-0 p-2 min-h-[100px] cursor-pointer hover:bg-accent/50",
                !isCurrentMonth && "bg-muted/50 text-muted-foreground opacity-50",
                dropTargetIndex === index && "ring-2 ring-primary"
              )}
              onClick={() => onDateClick?.(day)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, day)}
            >
              <div
                className={cn(
                  "text-sm font-medium mb-2",
                  isToday &&
                    "inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground h-6 w-6"
                )}
                {...(isToday ? { "aria-current": "date" as const } : {})}
              >
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 4).map(({ event, isTitleDay, isSpanStart, isSpanEnd }, slotIdx) => {
                  const isContinuation = !isTitleDay
                  const { className: colorCls, inlineColor } = resolveEventColor(event.color)
                  const showResizeHandle = !!onEventDrop && isSpanEnd
                  return (
                    <div
                      key={`${event.id}-${slotIdx}`}
                      role="button"
                      title={event.title}
                      aria-label={event.title}
                      draggable={!!onEventDrop}
                      onDragStart={(e) => handleDragStart(e, event, "move", day)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        "relative text-xs hover:opacity-80 truncate",
                        onEventDrop ? "cursor-move" : "cursor-pointer",
                        isContinuation
                          ? "h-1.5"
                          : "px-2 py-0.5",
                        isSpanStart ? "rounded-l" : "rounded-l-none",
                        isSpanEnd ? "rounded-r" : "rounded-r-none",
                        !isSpanEnd && "-mr-2",
                        colorCls,
                        draggedEventId === event.id && "opacity-50"
                      )}
                      style={inlineColor ? { backgroundColor: inlineColor } : undefined}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick?.(event)
                      }}
                    >
                      {isContinuation ? "" : event.title}
                      {showResizeHandle && (
                        <span
                          role="separator"
                          aria-label={t('calendar.a11y.resizeEventEnd')}
                          title={t('calendar.a11y.resizeEventEndHint')}
                          draggable
                          onDragStart={(e) => handleDragStart(e, event, "resize-end", day)}
                          onDragEnd={handleDragEnd}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/25 hover:bg-black/50 rounded-r"
                        />
                      )}
                    </div>
                  )
                })}
                {dayEvents.length > 4 && (
                  <div className="text-xs text-muted-foreground px-2">
                    {t('calendar.moreEvents', { count: dayEvents.length - 4 })}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


/* ---------------------------------------------------------------------- */
/*  TimeGridView — Day / Week classic time grid                            */
/*                                                                        */
/*  Classic Google-Calendar / Outlook-style vertical time grid:            */
/*  - Drag an event body to move it (snaps to slotMinutes).                */
/*  - Drag the top or bottom edge to resize the start/end time.            */
/*  - Click-drag on empty grid background to create a new event in that    */
/*    time range (commits via `onTimeRangeSelect`).                        */
/*                                                                        */
/*  Implementation uses pointer events (not HTML5 drag) for a uniform      */
/*  move / resize / drag-create gesture model.                             */
/* ---------------------------------------------------------------------- */

interface TimeGridViewProps {
  mode: "week" | "day"
  date: Date
  events: CalendarViewEvent[]
  locale?: string
  /** The week view's first column (objectui#11675); the day view ignores it. */
  weekStart: WeekdayIndex
  slotMinutes?: number
  onEventClick?: (event: CalendarViewEvent) => void
  onEventDrop?: (event: CalendarViewEvent, newStart: Date, newEnd?: Date) => void
  onTimeRangeSelect?: (start: Date, end: Date) => void
}

/**
 * A move carries the EVENT, not the piece that was grabbed (objectui#11037).
 * An event that crosses midnight is drawn as one clipped piece per day, and a
 * short one as a piece at least 15 minutes tall, so a piece's length is not
 * the event's.
 *
 * `durationMs` is the event's own `end - start` and `grabOffsetMs` the grabbed
 * point's distance from the event's own start, both ELAPSED time between
 * instants, so a `datetime` event keeps its real length (objectui#10866: a
 * `datetime` keeps its instant). On the night a DST change falls in, the wall
 * clock shows that length an hour longer or shorter: a 4-hour event placed at
 * 22:00 on a fall-back night reads 22:00 to 01:00, still 4 elapsed hours.
 */
type TimeGridMoveDrag = {
  kind: "move"
  eventId: string | number
  grabOffsetMs: number
  durationMs: number
  /** The event is drawn wholly inside one day, so a move keeps it inside the drop day. */
  withinOneDay: boolean
  dayIndex: number
  minutes: number
}

/**
 * A resize moves ONE edge of the EVENT and keeps the other where the event
 * truly has it (objectui#11060), not at the grabbed piece's clipped bound. The
 * top handle sits on the event's first piece and moves only its start; the
 * bottom handle sits on its last piece and moves only its end. For an event
 * that crosses midnight, or one drawn taller than it is, the piece's other
 * bound is midnight or the drawn height, never the event's edge.
 *
 * `keptMs` is that other edge, the event's own instant (its end for the top
 * handle, its start for the bottom), handed back to `onEventDrop` unchanged.
 */
type TimeGridResizeDrag = {
  kind: "resize-top" | "resize-bottom"
  eventId: string | number
  keptMs: number
  dayIndex: number
  minutes: number
}

type TimeGridDrag =
  | TimeGridMoveDrag
  | TimeGridResizeDrag
  | { kind: "select"; dayIndex: number; anchorMinutes: number; headMinutes: number }

const PX_PER_HOUR = 48

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function minutesIntoDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** The instant the grid draws `minutes` into `day`'s column, on the grid's own clock. */
function atGridMinutes(day: Date, minutes: number): Date {
  const d = new Date(day)
  d.setHours(0, minutes, 0, 0)
  return d
}

/** A timed event's own start and end; one with no end is drawn an hour long. */
function timedEventInstants(ev: CalendarViewEvent): { start: Date; end: Date } {
  const start = new Date(ev.start)
  const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + 60 * 60 * 1000)
  return { start, end }
}

/**
 * Where a move puts the event's start, in minutes from the drop day's
 * midnight on the grid's clock: the drop row minus the grabbed point's offset
 * into the event, snapped to the slot. An event drawn inside one day stays
 * inside the drop day, as it always has. One that crosses midnight lands where
 * it is dropped, so its start may fall on the day before (below 0) or after.
 */
function movedStartMinutes(drag: TimeGridMoveDrag, slotMinutes: number): number {
  const head = drag.minutes - drag.grabOffsetMs / 60_000
  const snapped = Math.round(head / slotMinutes) * slotMinutes
  if (!drag.withinOneDay) return snapped
  return Math.max(0, Math.min(1440 - drag.durationMs / 60_000, snapped))
}

/**
 * `instant`'s row on `day`'s column, in minutes from that day's midnight on
 * the grid's clock: below 0 on the day before, past 1440 on the day after.
 */
function gridMinutesOn(day: Date, instant: Date): number {
  const dayOffset = Math.round((startOfDay(instant).getTime() - day.getTime()) / 86_400_000)
  return dayOffset * 1440 + minutesIntoDay(instant)
}

/**
 * What a resize writes (objectui#11060): the dragged edge at the pointer's row
 * on the grabbed piece's day, snapped as before and held one slot away from
 * the kept edge wherever that edge falls, and the kept edge exactly as the
 * event has it. `startMin` and `endMin` are both edges' rows on that day's
 * column, so either may fall outside it.
 */
function resizedEvent(
  drag: TimeGridResizeDrag,
  day: Date,
  slotMinutes: number
): { start: Date; end: Date; startMin: number; endMin: number } {
  const kept = new Date(drag.keptMs)
  const keptMin = gridMinutesOn(day, kept)
  if (drag.kind === "resize-top") {
    const startMin = Math.min(keptMin - slotMinutes, Math.max(0, drag.minutes))
    return { start: atGridMinutes(day, startMin), end: kept, startMin, endMin: keptMin }
  }
  const endMin = Math.max(keptMin + slotMinutes, Math.min(1440, drag.minutes))
  return { start: kept, end: atGridMinutes(day, endMin), startMin: keptMin, endMin }
}

function TimeGridView({
  mode,
  date,
  events,
  locale = "default",
  weekStart,
  slotMinutes = 30,
  onEventClick,
  onEventDrop,
  onTimeRangeSelect,
}: TimeGridViewProps) {
  const { t } = useCalendarTranslation()
  const slotPx = (PX_PER_HOUR * slotMinutes) / 60
  const totalHeight = PX_PER_HOUR * 24

  // Day columns
  const days = React.useMemo<Date[]>(() => {
    if (mode === "day") return [startOfDay(date)]
    const firstDay = getWeekStart(date, weekStart)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(firstDay)
      d.setDate(firstDay.getDate() + i)
      return startOfDay(d)
    })
  }, [mode, date.getFullYear(), date.getMonth(), date.getDate(), weekStart])

  const today = React.useMemo(() => new Date(), [])

  // Per-day event entries with absolute positioning info. Multi-day events
  // are clipped into each day they touch so they show as a bar from their
  // start time on the first day to midnight, full-day on intermediate days,
  // and midnight to end time on their last day.
  type Entry = {
    event: CalendarViewEvent
    startMin: number
    endMin: number
    isStart: boolean // is this the event's first day
    isEnd: boolean // is this the event's last day
  }

  // Classify an event as "all-day" if it explicitly says so, or if its
  // start/end land on midnight boundaries (date-only data), or if it spans
  // 24h or more. These render in the all-day row above the time grid
  // instead of filling the whole vertical column.
  const isAllDayEvent = React.useCallback((ev: CalendarViewEvent): boolean => {
    if (ev.allDay) return true
    const s = new Date(ev.start)
    const e = ev.end ? new Date(ev.end) : new Date(s)
    const startsAtMidnight = s.getHours() === 0 && s.getMinutes() === 0 && s.getSeconds() === 0
    const endsAtMidnight = e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0
    const durationMs = e.getTime() - s.getTime()
    if (startsAtMidnight && endsAtMidnight) return true
    if (durationMs >= 24 * 60 * 60 * 1000) return true
    return false
  }, [])

  const { allDayEvents, timedEvents } = React.useMemo(() => {
    const allDay: CalendarViewEvent[] = []
    const timed: CalendarViewEvent[] = []
    for (const ev of events) {
      if (isAllDayEvent(ev)) allDay.push(ev)
      else timed.push(ev)
    }
    return { allDayEvents: allDay, timedEvents: timed }
  }, [events, isAllDayEvent])

  // All-day events grouped per visible day (for the all-day row).
  const allDayByDay = React.useMemo(() => {
    const map = new Map<string, Array<{ event: CalendarViewEvent; isStart: boolean; isEnd: boolean }>>()
    for (const d of days) map.set(dayKey(d), [])
    for (const ev of allDayEvents) {
      const s = startOfDay(new Date(ev.start))
      const eRaw = ev.end ? new Date(ev.end) : new Date(ev.start)
      // For all-day, end is inclusive of the last day; if end is exactly
      // midnight of next day (typical date-range storage), step back one day.
      let eDay = startOfDay(eRaw)
      if (eRaw.getHours() === 0 && eRaw.getMinutes() === 0 && eRaw.getSeconds() === 0 && eRaw.getTime() > s.getTime()) {
        eDay = new Date(eDay)
        eDay.setDate(eDay.getDate() - 1)
      }
      for (const d of days) {
        const dayStart = startOfDay(d)
        if (dayStart < s || dayStart > eDay) continue
        map.get(dayKey(d))!.push({
          event: ev,
          isStart: dayStart.getTime() === s.getTime(),
          isEnd: dayStart.getTime() === eDay.getTime(),
        })
      }
    }
    return map
  }, [days, allDayEvents])

  const entriesByDay = React.useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const d of days) map.set(dayKey(d), [])
    for (const ev of timedEvents) {
      const { start: s, end: e } = timedEventInstants(ev)
      // Iterate per-day in this view's range
      for (const d of days) {
        const dayStart = startOfDay(d)
        const dayEnd = new Date(dayStart)
        dayEnd.setDate(dayEnd.getDate() + 1)
        if (e <= dayStart || s >= dayEnd) continue
        const clippedStart = s < dayStart ? dayStart : s
        const clippedEnd = e > dayEnd ? dayEnd : e
        const startMin = minutesIntoDay(clippedStart)
        // For end exactly at next-day-midnight, treat as 1440.
        const endMin =
          clippedEnd.getTime() === dayEnd.getTime() ? 1440 : minutesIntoDay(clippedEnd)
        map.get(dayKey(d))!.push({
          event: ev,
          startMin,
          endMin: Math.max(endMin, startMin + 15),
          isStart: clippedStart.getTime() === s.getTime(),
          isEnd: clippedEnd.getTime() === e.getTime(),
        })
      }
    }
    return map
  }, [days, timedEvents])

  // Overlap layout: for each day, sort by startMin and assign column / cols
  // so concurrent events tile side-by-side.
  type Laid = Entry & { col: number; cols: number }
  const laidByDay = React.useMemo(() => {
    const out = new Map<string, Laid[]>()
    for (const [key, list] of entriesByDay) {
      const sorted = [...list].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
      // Greedy column packing
      type ColRun = { endMin: number }
      const cols: ColRun[] = []
      const assigned: Array<{ entry: Entry; col: number }> = []
      const activeGroupStart = 0
      const flushGroup = (until: number) => {
        const groupCols = cols.length
        for (let i = activeGroupStart; i < assigned.length; i++) {
          assigned[i] = { ...assigned[i], col: assigned[i].col }
          ;(assigned[i] as any).cols = groupCols
          ;(assigned[i] as any).until = until
        }
      }
      const _ = flushGroup // silence unused
      void _
      const laid: Laid[] = []
      // Simpler 2-pass: assign column index greedily, then walk through and
      // set `cols` = max overlapping column count at that interval.
      for (const ent of sorted) {
        let col = 0
        while (cols[col] && cols[col].endMin > ent.startMin) col++
        cols[col] = { endMin: ent.endMin }
        assigned.push({ entry: ent, col })
      }
      // Compute cols (number of concurrent columns) for each event
      for (let i = 0; i < assigned.length; i++) {
        const a = assigned[i]
        let maxCol = a.col
        for (let j = 0; j < assigned.length; j++) {
          if (j === i) continue
          const b = assigned[j]
          // overlap?
          if (b.entry.startMin < a.entry.endMin && b.entry.endMin > a.entry.startMin) {
            if (b.col > maxCol) maxCol = b.col
          }
        }
        laid.push({ ...a.entry, col: a.col, cols: maxCol + 1 })
      }
      out.set(key, laid)
    }
    return out
  }, [entriesByDay])

  const gridRef = React.useRef<HTMLDivElement | null>(null)
  const columnRefs = React.useRef<Array<HTMLDivElement | null>>([])
  const [drag, setDrag] = React.useState<TimeGridDrag | null>(null)
  const dragRef = React.useRef<TimeGridDrag | null>(null)
  dragRef.current = drag
  // Suppress click immediately after a drag/select gesture
  const suppressNextClickRef = React.useRef(false)

  // Convert clientY into minutes-of-day, snapped to slotMinutes
  const yToMinutes = React.useCallback(
    (clientY: number, dayIndex: number): number => {
      const node = columnRefs.current[dayIndex]
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      const offset = clientY - rect.top + node.scrollTop
      const minutes = (offset / PX_PER_HOUR) * 60
      const snapped = Math.round(minutes / slotMinutes) * slotMinutes
      return Math.max(0, Math.min(1440, snapped))
    },
    [slotMinutes]
  )

  const xToDayIndex = React.useCallback((clientX: number): number => {
    for (let i = 0; i < columnRefs.current.length; i++) {
      const n = columnRefs.current[i]
      if (!n) continue
      const r = n.getBoundingClientRect()
      if (clientX >= r.left && clientX <= r.right) return i
    }
    return -1
  }, [])

  // Window-level pointer move/up handlers
  React.useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const dayIdx = drag.kind === "select" || drag.kind === "move"
        ? xToDayIndex(e.clientX)
        : (drag as any).dayIndex
      const idx = dayIdx < 0 ? (drag as any).dayIndex ?? 0 : dayIdx
      const minutes = yToMinutes(e.clientY, idx)
      setDrag((prev) => {
        if (!prev) return prev
        if (prev.kind === "select") {
          return { ...prev, dayIndex: idx >= 0 ? idx : prev.dayIndex, headMinutes: minutes }
        }
        if (prev.kind === "move") {
          return { ...prev, dayIndex: idx, minutes }
        }
        // resize-top / resize-bottom stay on same day
        return { ...prev, minutes }
      })
    }
    const onUp = (e: PointerEvent) => {
      const current = dragRef.current
      if (!current) {
        setDrag(null)
        return
      }
      try {
        if (current.kind === "select" && onTimeRangeSelect) {
          const a = Math.min(current.anchorMinutes, current.headMinutes)
          const b = Math.max(current.anchorMinutes, current.headMinutes)
          // Treat zero-length as a single-slot create
          const startMin = a
          const endMin = b === a ? Math.min(1440, a + slotMinutes) : b
          const d = days[current.dayIndex] ?? days[0]
          const start = new Date(d)
          start.setHours(0, Math.round(startMin), 0, 0)
          const end = new Date(d)
          end.setHours(0, Math.round(endMin), 0, 0)
          suppressNextClickRef.current = true
          onTimeRangeSelect(start, end)
        } else if (current.kind === "move" && onEventDrop) {
          const ev = events.find((x) => String(x.id) === String(current.eventId))
          if (ev) {
            const targetDayIdx = current.dayIndex < 0 ? 0 : current.dayIndex
            const dayDate = days[targetDayIdx] ?? days[0]
            const newStart = atGridMinutes(dayDate, movedStartMinutes(current, slotMinutes))
            const newEnd = new Date(newStart.getTime() + current.durationMs)
            suppressNextClickRef.current = true
            onEventDrop(ev, newStart, newEnd)
          }
        } else if ((current.kind === "resize-top" || current.kind === "resize-bottom") && onEventDrop) {
          const ev = events.find((x) => String(x.id) === String(current.eventId))
          if (ev) {
            const dayDate = days[current.dayIndex] ?? days[0]
            const { start: newStart, end: newEnd } = resizedEvent(current, dayDate, slotMinutes)
            suppressNextClickRef.current = true
            onEventDrop(ev, newStart, newEnd)
          }
        }
      } finally {
        setDrag(null)
        // Reset the click suppression on next tick
        setTimeout(() => {
          suppressNextClickRef.current = false
        }, 50)
      }
      void e
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [drag, days, events, slotMinutes, onEventDrop, onTimeRangeSelect, xToDayIndex, yToMinutes])

  const weekdayLabels = React.useMemo(() => {
    return days.map((d) => ({
      weekday: d.toLocaleDateString(locale, { weekday: "short" }),
      day: d.getDate(),
      month: d.toLocaleDateString(locale, { month: "short" }),
      isToday: isSameDay(d, today),
    }))
  }, [days, locale, today])

  // Hour labels (12 AM .. 11 PM)
  const hourLabels = React.useMemo(() => {
    return Array.from({ length: 24 }, (_, h) => {
      const d = new Date(2024, 0, 1, h, 0)
      return d.toLocaleTimeString(locale, { hour: "numeric" })
    })
  }, [locale])

  const handleEventPointerDown = (
    e: React.PointerEvent,
    entry: Laid,
    dayIndex: number,
    zone: "body" | "top" | "bottom"
  ) => {
    if (!onEventDrop) return
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const minutes = yToMinutes(e.clientY, dayIndex)
    if (zone === "body") {
      // Measured on the event, never on the grabbed piece (objectui#11037).
      const { start, end } = timedEventInstants(entry.event)
      const durationMs = end.getTime() - start.getTime()
      const grabbedAt = atGridMinutes(days[dayIndex], minutes)
      setDrag({
        kind: "move",
        eventId: entry.event.id,
        grabOffsetMs: Math.max(0, Math.min(durationMs, grabbedAt.getTime() - start.getTime())),
        durationMs,
        withinOneDay: entry.isStart && entry.isEnd,
        dayIndex,
        minutes,
      })
    } else {
      // The edge this handle does not move is the event's own, never the
      // grabbed piece's clipped bound (objectui#11060).
      const { start, end } = timedEventInstants(entry.event)
      setDrag({
        kind: zone === "top" ? "resize-top" : "resize-bottom",
        eventId: entry.event.id,
        keptMs: (zone === "top" ? end : start).getTime(),
        dayIndex,
        minutes,
      })
    }
  }

  const handleGridPointerDown = (e: React.PointerEvent, dayIndex: number) => {
    if (!onTimeRangeSelect) return
    if (e.button !== 0) return
    e.preventDefault()
    const minutes = yToMinutes(e.clientY, dayIndex)
    setDrag({
      kind: "select",
      dayIndex,
      anchorMinutes: minutes,
      headMinutes: minutes,
    })
  }

  // Helper: render the live preview overlay for the current drag.
  const renderDragGhost = (dayIndex: number): React.ReactNode => {
    if (!drag) return null
    if (drag.kind === "select" && drag.dayIndex === dayIndex) {
      const a = Math.min(drag.anchorMinutes, drag.headMinutes)
      const b = Math.max(drag.anchorMinutes, drag.headMinutes)
      const top = (a / 60) * PX_PER_HOUR
      const height = Math.max(slotPx, ((b - a) / 60) * PX_PER_HOUR)
      return (
        <div
          className="absolute left-1 right-1 rounded bg-primary/30 border border-primary pointer-events-none z-10"
          style={{ top, height }}
          aria-hidden
        >
          <div className="px-2 py-0.5 text-xs font-medium text-primary">
            {formatTimeRange(days[dayIndex], a, b, locale)}
          </div>
        </div>
      )
    }
    if (drag.kind === "move" && drag.dayIndex === dayIndex) {
      // The preview is what the drop writes: the whole event, drawn over the
      // part of it that falls on this day (at least 15 minutes tall, as a
      // piece is), labelled with its own times.
      const startMin = movedStartMinutes(drag, slotMinutes)
      const newStart = atGridMinutes(days[dayIndex], startMin)
      const newEnd = new Date(newStart.getTime() + drag.durationMs)
      const topMin = Math.max(0, startMin)
      const bottomMin = Math.min(1440, startMin + Math.max(15, drag.durationMs / 60_000))
      const top = (topMin / 60) * PX_PER_HOUR
      const height = Math.max(0, ((bottomMin - topMin) / 60) * PX_PER_HOUR)
      return (
        <div
          className="absolute left-1 right-1 rounded border-2 border-dashed border-primary bg-primary/10 pointer-events-none z-10"
          style={{ top, height }}
          aria-hidden
        >
          <div className="px-2 py-0.5 text-xs font-medium text-primary">
            {formatInstantRange(newStart, newEnd, locale)}
          </div>
        </div>
      )
    }
    if ((drag.kind === "resize-top" || drag.kind === "resize-bottom") && drag.dayIndex === dayIndex) {
      // As the move preview is: what the drop writes, drawn over the part of
      // it on this day and labelled with the whole event's times.
      const { start, end, startMin, endMin } = resizedEvent(drag, days[dayIndex], slotMinutes)
      const topMin = Math.max(0, startMin)
      const bottomMin = Math.min(1440, endMin)
      const top = (topMin / 60) * PX_PER_HOUR
      const height = Math.max(0, ((bottomMin - topMin) / 60) * PX_PER_HOUR)
      return (
        <div
          className="absolute left-1 right-1 rounded border-2 border-dashed border-primary bg-primary/10 pointer-events-none z-10"
          style={{ top, height }}
          aria-hidden
        >
          <div className="px-2 py-0.5 text-xs font-medium text-primary">
            {formatInstantRange(start, end, locale)}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col h-full" ref={gridRef}>
      {/* Day headers */}
      <div className="flex border-b sticky top-0 bg-background z-20">
        <div className="w-14 shrink-0 border-r" aria-hidden />
        {weekdayLabels.map((lbl, i) => (
          <div
            key={i}
            role="columnheader"
            className={cn(
              "flex-1 p-2 text-center text-sm border-r last:border-r-0",
              lbl.isToday && "bg-primary/5"
            )}
          >
            <div className="text-xs text-muted-foreground">{lbl.weekday}</div>
            <div
              className={cn(
                "font-medium",
                lbl.isToday && "inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground h-6 w-6 mx-auto"
              )}
            >
              {lbl.day}
            </div>
          </div>
        ))}
      </div>

      {/* All-day row: events that span entire days (or have no time
          component) render here as horizontal bars instead of filling
          the entire vertical column below. Caps at ~5 rows with internal
          scroll so a busy day doesn't push the time grid off-screen. */}
      {allDayEvents.length > 0 && (
        <div className="flex border-b bg-muted/20 max-h-[140px] overflow-y-auto">
          <div className="w-14 shrink-0 border-r flex items-start justify-end pr-1 pt-1 text-[10px] text-muted-foreground sticky left-0 bg-muted/20">
            {t('calendar.allDay')}
          </div>
          {days.map((day) => {
            const key = dayKey(day)
            const list = allDayByDay.get(key) ?? []
            return (
              <div
                key={key}
                className="flex-1 border-r last:border-r-0 min-h-[28px] p-0.5 space-y-0.5"
              >
                {list.map(({ event, isStart, isEnd }, idx) => {
                  const { className: colorCls, inlineColor } = resolveEventColor(event.color)
                  return (
                    <div
                      key={`${event.id}-${idx}`}
                      role="button"
                      title={event.title}
                      onClick={(e) => {
                        e.stopPropagation()
                        onEventClick?.(event)
                      }}
                      className={cn(
                        "text-[11px] px-2 py-0.5 truncate cursor-pointer hover:opacity-80",
                        isStart ? "rounded-l" : "rounded-l-none -ml-0.5",
                        isEnd ? "rounded-r" : "rounded-r-none -mr-0.5",
                        colorCls
                      )}
                      style={inlineColor ? { backgroundColor: inlineColor } : undefined}
                    >
                      {isStart ? event.title : "\u00A0"}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Scrollable time grid */}
      <div className="flex-1 overflow-auto">
        <div className="flex" style={{ height: totalHeight }}>
          {/* Hour rail */}
          <div className="w-14 shrink-0 border-r relative">
            {hourLabels.map((label, h) => (
              <div
                key={h}
                className="absolute right-1 text-[10px] text-muted-foreground -translate-y-1/2"
                style={{ top: h * PX_PER_HOUR }}
              >
                {h === 0 ? "" : label}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, dayIndex) => {
            const key = dayKey(day)
            const laid = laidByDay.get(key) ?? []
            return (
              <div
                key={key}
                ref={(node) => {
                  columnRefs.current[dayIndex] = node
                }}
                className="flex-1 border-r last:border-r-0 relative select-none"
                style={{ height: totalHeight }}
                onPointerDown={(e) => handleGridPointerDown(e, dayIndex)}
                aria-label={day.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              >
                {/* Hour gridlines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-muted/60 pointer-events-none"
                    style={{ top: h * PX_PER_HOUR }}
                  />
                ))}
                {/* Half-hour (or slot) lines */}
                {slotMinutes < 60 &&
                  Array.from({ length: Math.floor((24 * 60) / slotMinutes) }, (_, s) => {
                    const min = s * slotMinutes
                    if (min % 60 === 0) return null
                    return (
                      <div
                        key={s}
                        className="absolute left-0 right-0 border-t border-dashed border-muted/30 pointer-events-none"
                        style={{ top: (min / 60) * PX_PER_HOUR }}
                      />
                    )
                  })}

                {/* Events */}
                {laid.map((entry) => {
                  const top = (entry.startMin / 60) * PX_PER_HOUR
                  const height = Math.max(slotPx, ((entry.endMin - entry.startMin) / 60) * PX_PER_HOUR)
                  const widthPct = 100 / entry.cols
                  const leftPct = entry.col * widthPct
                  const { className: colorCls, inlineColor } = resolveEventColor(entry.event.color)
                  const isBeingDragged = drag && (drag as any).eventId === entry.event.id
                  return (
                    <div
                      key={`${entry.event.id}-${entry.startMin}`}
                      role="button"
                      tabIndex={0}
                      title={entry.event.title}
                      aria-label={entry.event.title}
                      onPointerDown={(e) => handleEventPointerDown(e, entry, dayIndex, "body")}
                      onClick={(e) => {
                        if (suppressNextClickRef.current) {
                          e.stopPropagation()
                          return
                        }
                        e.stopPropagation()
                        onEventClick?.(entry.event)
                      }}
                      className={cn(
                        "absolute rounded text-xs px-2 py-1 overflow-hidden shadow-sm",
                        onEventDrop ? "cursor-move" : "cursor-pointer",
                        colorCls,
                        isBeingDragged && "opacity-40"
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        ...(inlineColor ? { backgroundColor: inlineColor } : {}),
                      }}
                    >
                      <div className="font-medium truncate">{entry.event.title}</div>
                      <div className="text-[10px] opacity-80 truncate">
                        {formatTimeRange(day, entry.startMin, entry.endMin, locale)}
                      </div>
                      {/* Resize handles — only on the original days */}
                      {onEventDrop && entry.isStart && (
                        <div
                          onPointerDown={(e) => handleEventPointerDown(e, entry, dayIndex, "top")}
                          className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize"
                          aria-label={t('calendar.a11y.resizeStart')}
                        />
                      )}
                      {onEventDrop && entry.isEnd && (
                        <div
                          onPointerDown={(e) => handleEventPointerDown(e, entry, dayIndex, "bottom")}
                          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize"
                          aria-label={t('calendar.a11y.resizeEnd')}
                        />
                      )}
                    </div>
                  )
                })}

                {/* Drag preview */}
                {renderDragGhost(dayIndex)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function formatTimeRange(day: Date, startMin: number, endMin: number, locale: string): string {
  return formatInstantRange(atGridMinutes(day, Math.round(startMin)), atGridMinutes(day, Math.round(endMin)), locale)
}

function formatInstantRange(s: Date, e: Date, locale: string): string {
  const fmt = (d: Date) => d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
  return `${fmt(s)} – ${fmt(e)}`
}

export { CalendarView }
export { resolveEventColor as __resolveEventColorForTest }
