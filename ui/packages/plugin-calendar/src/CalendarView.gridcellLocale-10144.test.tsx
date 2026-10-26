/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10144 — the month gridcell's accessible name must be spoken in the
 * SAME resolved locale as the weekday headers standing beside it.
 *
 * This is `Intl` ARGUMENT routing, not a locale pack: the day label is produced
 * by `Date.prototype.toLocaleDateString`, and before this card that call was
 * handed the literal `"default"` — i.e. the MACHINE's locale — while the
 * weekday column headers one row above were handed the component's resolved
 * `locale`. A screen-reader user on a German session therefore heard German
 * column headers and every date in whatever the runtime happened to be set to.
 *
 * ## Why a NON-`en` locale is mandatory here
 *
 * On a runner whose default is `en-US`, an `en` assertion renders the same
 * bytes on the defect and on the fix, so it would pass either way. The two
 * worlds only separate under a locale the runtime default is not.
 *
 * ## The lit control, in the same run as every finding
 *
 * A "the date is not the runtime default's rendering" assertion is only a
 * reading if something in the SAME render proves the locale actually reached
 * this component. The weekday column headers carry that: they were formatted
 * with the resolved `locale` BEFORE this card, so under `de` they must read
 * German on the defect tree too. If they read German and the gridcell does
 * not, the gridcell is the component's own doing — not a provider that never
 * switched language.
 *
 * ## The vacuity guard
 *
 * Every assertion below compares against `toLocaleDateString("default", …)`
 * evaluated live. On a runner whose default IS German that comparison cannot
 * discriminate, so the first case asserts the two renderings differ and fails
 * loudly rather than letting the rest of the file pass while asserting nothing.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import * as React from 'react'
import { I18nProvider } from '@object-ui/i18n'
import { builtInLocales } from '@object-ui/i18n/locales'
import { CalendarView, type CalendarViewEvent } from './CalendarView'

const h = React.createElement

/** Thu 15 Jan 2026 — an event day. Fri 16 Jan 2026 is its empty neighbour, so
 *  BOTH branches of the gridcell's `aria-label` ternary are covered. */
const EVENT_DAY = new Date(2026, 0, 15)
const EMPTY_DAY = new Date(2026, 0, 16)

/** The exact option bag the gridcell label uses. */
const DAY_LABEL_OPTS: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}

/** What the RUNTIME DEFAULT renders — the value the defect produced. */
const asRuntimeDefault = (d: Date) => d.toLocaleDateString('default', DAY_LABEL_OPTS)
/** What the RESOLVED locale renders — the value the fix must produce. */
const asLocale = (d: Date, locale: string) => d.toLocaleDateString(locale, DAY_LABEL_OPTS)

/** The weekday column headers, formatted the way `MonthView` formats them —
 *  `{ weekday: 'short' }`, from the week's first day. This is the LIT CONTROL.
 *  The first day is the locale's (objectui#11675) and is stated here, not read
 *  back from the component: `de` and `de-DE` start the week on Monday. */
const MONDAY = 1
const weekdayHeaders = (locale: string, firstDay: number) =>
  Array.from({ length: 7 }, (_, i) => {
    // 7 January 2024 is a Sunday.
    const d = new Date(2024, 0, 7)
    d.setDate(d.getDate() + firstDay + i)
    return d.toLocaleDateString(locale, { weekday: 'short' })
  })

const EVENTS: CalendarViewEvent[] = [
  {
    id: 'evt-10144',
    title: 'Quartalsreview',
    start: new Date(2026, 0, 15, 9, 0, 0),
    end: new Date(2026, 0, 15, 10, 0, 0),
    data: { id: 'evt-10144' },
  },
]

/**
 * Two routes reach `effectiveLocale`, and this card's defect sat downstream of
 * both — so both are exercised:
 *   - `language`: no `locale` prop, the provider's language answers.
 *   - `locale` prop: an explicit tag outranks the UI language.
 */
function renderMonth(opts: { language: string; locale?: string }) {
  return render(
    h(I18nProvider, {
      config: { defaultLanguage: opts.language, detectBrowserLanguage: false },
      children: h(CalendarView, {
        events: EVENTS,
        currentDate: EVENT_DAY,
        view: 'month' as const,
        ...(opts.locale ? { locale: opts.locale } : {}),
      }),
    }),
  )
}

const gridcellLabels = () =>
  [...document.querySelectorAll('[role="gridcell"]')]
    .map((el) => el.getAttribute('aria-label'))
    .filter((v): v is string => !!v)

const columnHeaderTexts = () =>
  [...document.querySelectorAll('[role="columnheader"]')].map((el) => el.textContent ?? '')

afterEach(cleanup)

describe('objectui#10144 — the month gridcell speaks the RESOLVED locale', () => {
  it('VACUITY GUARD: the runtime default renders these dates differently from `de` / `de-DE`', () => {
    // Without this, a runner whose own default is German would make every
    // "not the runtime default" assertion below pass on the defect tree too.
    for (const tag of ['de', 'de-DE']) {
      for (const day of [EVENT_DAY, EMPTY_DAY]) {
        expect(
          asLocale(day, tag),
          `the runner's default locale renders ${tag} identically — this file cannot discriminate here`,
        ).not.toBe(asRuntimeDefault(day))
      }
      // And the tag really resolves, rather than falling back to the default.
      expect(new Intl.DateTimeFormat(tag).resolvedOptions().locale).toMatch(/^de\b/)
    }
  })

  it('via the provider language: the gridcell date is `de`, with the weekday headers lit as the control', () => {
    renderMonth({ language: 'de' })

    // LIT CONTROL, same run: the headers honoured the locale BEFORE this card,
    // so their German proves the locale reached this component.
    const headers = columnHeaderTexts()
    expect(headers, 'no column headers rendered — the control would be unlit').toHaveLength(7)
    expect(headers).toEqual(weekdayHeaders('de', MONDAY))
    expect(headers).not.toEqual(weekdayHeaders('default', MONDAY))

    // THE FINDING: the day the user actually hears.
    const labels = gridcellLabels()
    expect(labels.length, 'no gridcell rendered — the sweep would be vacuous').toBeGreaterThan(0)

    const eventCell = labels.filter((v) => v.includes(asLocale(EVENT_DAY, 'de')))
    expect(eventCell, `the event day is not spoken in de (heard: ${JSON.stringify(labels.slice(0, 3))})`).toHaveLength(1)
    // The count frame comes from the pack; the DATE comes from `Intl`. Both.
    expect(eventCell[0]).toBe(
      (builtInLocales.de.calendar.a11y.dayCell_one as string)
        .replace('{{date}}', asLocale(EVENT_DAY, 'de'))
        .replace('{{count}}', '1'),
    )

    // The empty-day branch of the same ternary: the bare date, nothing around it.
    expect(labels).toContain(asLocale(EMPTY_DAY, 'de'))

    // And NOTHING in the grid is still spoken in the runtime default.
    const leaked = labels.filter((v) => v.includes(asRuntimeDefault(EVENT_DAY)) || v.includes(asRuntimeDefault(EMPTY_DAY)))
    expect(leaked, `${leaked.length} gridcell name(s) still render the runtime default`).toEqual([])
  })

  it('via an explicit `locale` prop: the date follows the tag even while the frame stays `en`', () => {
    // `locale` outranks the UI language, so this render separates the two
    // channels: an English count frame around a German date. That split is
    // exactly why this card could not be folded into a locale-pack change.
    renderMonth({ language: 'en', locale: 'de-DE' })

    const headers = columnHeaderTexts()
    expect(headers, 'no column headers rendered — the control would be unlit').toEqual(weekdayHeaders('de-DE', MONDAY))

    const labels = gridcellLabels()
    const eventCell = labels.filter((v) => v.includes(asLocale(EVENT_DAY, 'de-DE')))
    expect(eventCell, 'the event day is not spoken in de-DE').toHaveLength(1)
    expect(eventCell[0]).toBe(
      (builtInLocales.en.calendar.a11y.dayCell_one as string)
        .replace('{{date}}', asLocale(EVENT_DAY, 'de-DE'))
        .replace('{{count}}', '1'),
    )

    expect(labels).toContain(asLocale(EMPTY_DAY, 'de-DE'))

    const leaked = labels.filter((v) => v.includes(asRuntimeDefault(EVENT_DAY)) || v.includes(asRuntimeDefault(EMPTY_DAY)))
    expect(leaked, `${leaked.length} gridcell name(s) still render the runtime default`).toEqual([])
  })

  it('CONTROL: under `en` the gridcell and the headers agree with the runtime default', () => {
    // Without this, the two cases above could pass on a component that renders
    // an empty or garbled name. Here the resolved locale and the runtime
    // default coincide, so the label must READ as the default rendering —
    // the same assertion, pointing the other way.
    renderMonth({ language: 'en', locale: 'en-US' })
    const labels = gridcellLabels()
    expect(labels).toContain(asLocale(EMPTY_DAY, 'en-US'))
    expect(labels.some((v) => v.includes(asRuntimeDefault(EVENT_DAY)))).toBe(true)
  })
})
