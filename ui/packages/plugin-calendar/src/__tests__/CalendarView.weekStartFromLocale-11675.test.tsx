/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11675 — the calendar's week starts on the locale's first day.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * Every week the calendar drew started on Sunday, whatever the locale: the
 * month grid opened each row on `getDay() === 0`, its weekday heads ran from a
 * reference Sunday, and the week view's columns and the header's week range
 * came from a Sunday `getWeekStart`. So a `zh-CN` or `en-GB` user, whose week
 * starts on Monday, read every week shifted by a day, and the timeline beside
 * it started its "This week" on Monday.
 *
 * ── What the repair reads ───────────────────────────────────────────────────
 * Ruling B: the first day of the week follows the user's locale. `CalendarView`
 * reads it once, `firstDayOfWeek(effectiveLocale)` (`@object-ui/i18n`), from
 * the tag every date it draws formats with, and hands that one answer to each
 * site below. The card's pins: under `en-US` the week starts on Sunday, under
 * `zh-CN` and `en-GB` on Monday. `ar-EG` (Saturday) shows the answer is the
 * locale's and not a Sunday/Monday switch.
 *
 * Every expected first day is a literal date stated here, ⛔ not a call to the
 * function under test. The suite runs in UTC (`vitest.config.mts`), and every
 * date is a local calendar date, so the zone does not enter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n'
import { CalendarView, type CalendarViewEvent } from '../CalendarView'

/** Thursday 15 October 2026. October 2026 opens on a Thursday. */
const OCT_15 = new Date(2026, 9, 15)
/** Wednesday 14 October 2026, the week view's date. */
const OCT_14 = new Date(2026, 9, 14)

const DAY_LABEL: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }

/** The first day of October 2026's first grid row, and of 14 October's week, per locale. */
const CASES = [
  { locale: 'en-US', first: 'Sunday', gridStart: new Date(2026, 8, 27), weekStart: new Date(2026, 9, 11) },
  { locale: 'en-GB', first: 'Monday', gridStart: new Date(2026, 8, 28), weekStart: new Date(2026, 9, 12) },
  { locale: 'zh-CN', first: 'Monday', gridStart: new Date(2026, 8, 28), weekStart: new Date(2026, 9, 12) },
  { locale: 'ar-EG', first: 'Saturday', gridStart: new Date(2026, 8, 26), weekStart: new Date(2026, 9, 10) },
] as const

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(OCT_15)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** An ENGLISH UI with `displayLocale` as the declared display locale. */
function session(displayLocale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: displayLocale }}>{node}</LocalizationProvider>
    </I18nProvider>
  )
}

const columnHeads = () =>
  [...document.querySelectorAll('[role="columnheader"]')].map((el) => (el.textContent ?? '').trim())
const gridcellLabels = () =>
  [...document.querySelectorAll('[role="gridcell"]')].map((el) => el.getAttribute('aria-label') ?? '')
const headerLabel = () => document.body.querySelector('[aria-label^="Current date:"]')?.getAttribute('aria-label') ?? ''

/** `start` plus `days` calendar days. */
function plusDays(start: Date, days: number): Date {
  const d = new Date(start)
  d.setDate(d.getDate() + days)
  return d
}

describe('CalendarView month grid — each row and the weekday heads open on the locale\'s first day (objectui#11675)', () => {
  for (const c of CASES) {
    it(`${c.locale}: the grid and its heads start on ${c.first}`, () => {
      render(session(c.locale, <CalendarView events={[]} currentDate={OCT_15} view="month" />))

      const cells = gridcellLabels()
      expect(cells, 'the month grid is six rows of seven').toHaveLength(42)
      expect(cells[0]).toBe(c.gridStart.toLocaleDateString(c.locale, DAY_LABEL))
      // Each later row opens on the same weekday, seven days on.
      expect(cells[7]).toBe(plusDays(c.gridStart, 7).toLocaleDateString(c.locale, DAY_LABEL))

      const heads = columnHeads()
      expect(heads).toEqual(
        Array.from({ length: 7 }, (_, i) => plusDays(c.gridStart, i).toLocaleDateString(c.locale, { weekday: 'short' })),
      )
    })
  }

  it('an authored `locale` wins for the week start too: en-GB under an en-US display locale starts on Monday', () => {
    render(session('en-US', <CalendarView events={[]} currentDate={OCT_15} view="month" locale="en-GB" />))
    expect(gridcellLabels()[0]).toBe(new Date(2026, 8, 28).toLocaleDateString('en-GB', DAY_LABEL))
  })
})

describe('CalendarView week view — the columns and the header range start on the locale\'s first day (objectui#11675)', () => {
  for (const c of CASES.filter((x) => x.locale === 'en-US' || x.locale === 'en-GB')) {
    it(`${c.locale}: the week of 14 October runs from ${c.first} ${c.weekStart.getDate()} October`, () => {
      render(session(c.locale, <CalendarView events={[]} currentDate={OCT_14} view="week" />))

      const heads = columnHeads()
      expect(heads).toHaveLength(7)
      expect(heads).toEqual(
        Array.from({ length: 7 }, (_, i) => {
          const d = plusDays(c.weekStart, i)
          return `${d.toLocaleDateString(c.locale, { weekday: 'short' })}${d.getDate()}`
        }),
      )
      const rangeStart = c.weekStart.toLocaleDateString(c.locale, { month: 'short', day: 'numeric' })
      const rangeEnd = plusDays(c.weekStart, 6).toLocaleDateString(c.locale, { month: 'short', day: 'numeric', year: 'numeric' })
      expect(headerLabel()).toBe(`Current date: ${rangeStart} - ${rangeEnd}`)
    })
  }
})

describe('CalendarView month grid — a span that wraps into a new row is titled on the row\'s first day (objectui#11675)', () => {
  const SPAN: CalendarViewEvent[] = [
    { id: 'span', title: 'Offsite', start: new Date(2026, 9, 7), end: new Date(2026, 9, 14), allDay: true },
  ]

  /** The days of the month whose cell shows the span's title, not a bare continuation bar. */
  function titledDays(locale: string): number[] {
    render(session(locale, <CalendarView events={SPAN} currentDate={OCT_15} view="month" />))
    const days = [...document.querySelectorAll('[role="gridcell"]')]
      .filter((cell) =>
        [...cell.querySelectorAll('[role="button"][aria-label="Offsite"]')].some((chip) => chip.textContent === 'Offsite'),
      )
      .map((cell) => Number(cell.firstElementChild?.textContent))
    cleanup()
    return days
  }

  it('en-US titles Sunday the 11th, en-GB Monday the 12th, both beside the start and end days', () => {
    expect(titledDays('en-US')).toEqual([7, 11, 14])
    expect(titledDays('en-GB')).toEqual([7, 12, 14])
  })
})

describe('CalendarView date popover — its weeks start where the grid\'s do (objectui#11675)', () => {
  /**
   * The popover's weekday heads, by their full names, once its date-fns locale
   * has loaded, which is when its caption reads `caption`. The caption is
   * date-fns's own format, not the header's `Intl` one, so it is matched as
   * written for that locale.
   */
  async function popoverWeekdays(locale: string, caption: string): Promise<string[]> {
    render(session(locale, <CalendarView events={[]} currentDate={OCT_15} view="month" />))
    const trigger = document.body.querySelector<HTMLElement>('[aria-label^="Current date:"]')
    if (!trigger) throw new Error('no header date trigger rendered')
    fireEvent.click(trigger)
    await waitFor(() => expect(document.body.querySelector('.rdp-caption_label')).not.toBeNull())
    await vi.dynamicImportSettled()
    await waitFor(() => expect((document.body.querySelector('.rdp-caption_label')?.textContent ?? '').trim()).toBe(caption))
    return [...document.body.querySelectorAll('.rdp-weekday')].map((th) => th.getAttribute('aria-label') ?? '')
  }

  it('en-GB: the popover starts on Monday, as the grid does', async () => {
    const weekdays = await popoverWeekdays('en-GB', 'October 2026')
    expect(weekdays[0]).toBe('Monday')
  })

  it('es-MX: the popover starts on Sunday with the grid, though date-fns reads the tag as `es`, a Monday start', async () => {
    // The date-fns locale `es-MX` resolves to has its own week start, Monday;
    // CLDR starts Mexico's week on Sunday. The grid follows CLDR, so the popover
    // must take the grid's day rather than date-fns's.
    const weekdays = await popoverWeekdays('es-MX', 'octubre 2026')
    expect(weekdays[0]).toBe('domingo')
    expect(gridcellLabels()[0]).toBe(new Date(2026, 8, 27).toLocaleDateString('es-MX', DAY_LABEL))
  })
})
