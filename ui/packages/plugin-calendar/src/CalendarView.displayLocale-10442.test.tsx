/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `CalendarView`'s default locale is the DISPLAY locale, never the UI
 * language (objectui#10442).
 *
 * With no `locale` prop the component's `"default"` branch resolved to the
 * `language` that `useCalendarTranslation()` reports, which is the UI
 * language, so a regional display locale (`de-CH` under an English UI) never
 * reached the header, the weekday columns or the day cells. That branch now
 * reads `useDisplayLocale()`. An EXPLICIT `locale` prop is a host's choice and
 * still wins, and that half is pinned here too.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import * as React from 'react'
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n'
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support'
import { CalendarView } from './CalendarView'

/** Wed 4 Mar 2020, local midnight (the suite pins `TZ=UTC`). */
const DAY = new Date(2020, 2, 4)

afterEach(cleanup)

function calendarUnder(displayLocale: string, props: { locale?: string } = {}) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: displayLocale }}>
        <CalendarView events={[]} currentDate={DAY} view="month" {...props} />
      </LocalizationProvider>
    </I18nProvider>
  )
}

interface MonthFaces {
  /** The whole rendered text, which carries the toolbar's month label. */
  text: string
  /** The seven weekday column headers. */
  weekdays: string[]
  /** The accessible names of the day cells. */
  cells: string[]
}

/** The RAW readings off the DOM: expectations are built by the cases, never in here. */
function facesUnder(displayLocale: string, props: { locale?: string } = {}): MonthFaces {
  const { container } = render(calendarUnder(displayLocale, props))
  const text = container.textContent ?? ''
  const weekdays = [...container.querySelectorAll('[role="columnheader"]')].map((el) => el.textContent ?? '')
  const cells = [...container.querySelectorAll('[role="gridcell"]')].map((el) => el.getAttribute('aria-label') ?? '')
  cleanup()
  return { text, weekdays, cells }
}

/** The 4 March cell's accessible name starts with the day label in `locale`. */
const dayLabelIn = (locale: string) =>
  DAY.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

/**
 * The weekday heads in `locale`, from the week's first day. The first day is
 * the locale's (objectui#11675) and is stated by each case, not read back from
 * the component: `en-US` starts the week on Sunday, `de-CH` and `fr-FR` on
 * Monday. 7 January 2024 is a Sunday.
 */
const SUNDAY = 0
const MONDAY = 1
const weekdaysIn = (locale: string, firstDay: number) =>
  Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + firstDay + i).toLocaleDateString(locale, { weekday: 'short' }))

describe('CalendarView — the default locale is the display locale (objectui#10442)', () => {
  it('renders the month as de-CH under an English UI with a de-CH display locale', () => {
    const faces = facesUnder('de-CH')
    expect(faces.text, `got: ${faces.text.slice(0, 200)}`).toContain('März 2020')
    expect(faces.weekdays).toEqual(weekdaysIn('de-CH', MONDAY))
    expect(dayLabelIn('de-CH')).toBe('Mittwoch, 4. März 2020')
    expect(faces.cells.some((l) => l.startsWith(dayLabelIn('de-CH'))), `saw: ${JSON.stringify(faces.cells.slice(0, 3))}`).toBe(true)
  })

  it('control: renders the month as en-US under an en-US display locale', () => {
    const faces = facesUnder('en-US')
    expect(faces.text, `got: ${faces.text.slice(0, 200)}`).toContain('March 2020')
    expect(faces.weekdays).toEqual(weekdaysIn('en-US', SUNDAY))
    expect(dayLabelIn('en-US')).toBe('Wednesday, March 4, 2020')
    expect(faces.cells.some((l) => l.startsWith(dayLabelIn('en-US'))), `saw: ${JSON.stringify(faces.cells.slice(0, 3))}`).toBe(true)
  })

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', () => {
    const de = facesUnder('de-CH')
    const en = facesUnder('en-US')
    expect(de.weekdays).not.toEqual(en.weekdays)
    expect(de.cells).not.toEqual(en.cells)
    expect(de.text).not.toBe(en.text)
  })

  it('an explicit `locale` prop still wins over the display locale', () => {
    const faces = facesUnder('de-CH', { locale: 'fr-FR' })
    expect(faces.text, `got: ${faces.text.slice(0, 200)}`).toContain('mars 2020')
    expect(faces.weekdays).toEqual(weekdaysIn('fr-FR', MONDAY))
    expect(faces.cells.some((l) => l.startsWith(dayLabelIn('fr-FR'))), `saw: ${JSON.stringify(faces.cells.slice(0, 3))}`).toBe(true)
  })

  it('every locale-taking call receives the declared tag', () => {
    const tree = calendarUnder('de-CH')
    const calls = recordLocaleArguments(() => {
      render(tree)
    })
    cleanup()
    expect(calls.some((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(calls)}`).toBe(true)
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([])
    expect(calls.filter((c) => c.locale === 'en'), 'these call sites formatted in the UI language').toEqual([])
  })
})
