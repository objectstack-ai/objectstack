/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10104 — every user-visible string `CalendarView` authors itself must
 * come from a locale pack, including the ones only a screen reader ever hears.
 *
 * `role="region"`'s and `role="grid"`'s `aria-label`s are the ONLY names those
 * two landmarks have. Before this card they were English literals in the
 * component, so a screen-reader user on a `zh` console was told "Calendar" and
 * "Calendar grid" while every sighted string around them was translated.
 *
 * ## Why this mounts a NON-ENGLISH locale
 *
 * An `en` assertion cannot tell the two worlds apart: a hard-coded `"Calendar"`
 * and a correctly resolved `en.calendar.a11y.region` render the same bytes, so
 * such a test passes identically on the defect and on the fix. Under `zh` the
 * two differ, so the assertion has the power to fail for the reason it exists.
 *
 * ## The lit control
 *
 * A zero — "no English literal found" — is only a reading if something in the
 * same render proves the probe could have seen one. Two controls carry that
 * here, and both are asserted rather than assumed:
 *
 *   - LOCALE PROBE: `calendar.today` was routed through this same `t` BEFORE
 *     this card. It therefore renders `zh` on the defect tree too, which is
 *     what makes it a control: if it reads `zh`, the provider really is mounted
 *     in `zh`, so an English `aria-label` beside it is the component's own doing
 *     and not a provider that failed to boot.
 *   - PACK DIVERGENCE: every key asserted below is checked live to be a
 *     non-empty string in `en` AND to differ between `en` and `zh`. Without it
 *     a pack that lost the key, or two packs that happened to agree, would make
 *     every "not the English literal" assertion pass while asserting nothing.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import * as React from 'react'
import { I18nProvider } from '@object-ui/i18n'
import { builtInLocales } from '@object-ui/i18n/locales'
import { CalendarView, type CalendarViewEvent } from './CalendarView'

const h = React.createElement

const DAY = new Date(2026, 0, 15) // Thu Jan 15, 2026

const EVENTS: CalendarViewEvent[] = [
  {
    id: 'evt-10104',
    title: 'Quarterly review',
    start: new Date(2026, 0, 15, 9, 0, 0),
    end: new Date(2026, 0, 15, 10, 0, 0),
    data: { id: 'evt-10104' },
  },
]

function renderAt(language: string, view: 'month' | 'week' = 'month') {
  return render(
    h(I18nProvider, {
      config: { defaultLanguage: language, detectBrowserLanguage: false },
      children: h(CalendarView, {
        events: EVENTS,
        currentDate: DAY,
        view,
        // `onEventDrop` is what mounts the resize handles; without it three of
        // the swept labels never render and this file would silently cover five.
        onEventDrop: () => {},
      }),
    }),
  )
}

/** Read a pack value by dotted path, so a missing key surfaces as `undefined`. */
function packValue(lang: 'en' | 'zh', dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], builtInLocales[lang])
}

/**
 * The sweep's own inventory of whole-literal labels, as keys. The English text
 * is NEVER spelled here — it is read from the `en` pack, so this file cannot
 * drift into being a second copy of the catalogue, and a pack edit reaches
 * these cases for free.
 */
const MONTH_VIEW_LABELS = [
  'calendar.a11y.region',
  'calendar.a11y.grid',
  'calendar.a11y.goToToday',
  'calendar.a11y.previousPeriod',
  'calendar.a11y.nextPeriod',
  'calendar.a11y.resizeEventEnd',
  'calendar.a11y.resizeEventEndHint',
] as const

/** `TimeGridView`'s own two grips — a different component in the same file,
 *  reached only by the week/day views, so the month render never mounts them. */
const TIME_GRID_LABELS = ['calendar.a11y.resizeStart', 'calendar.a11y.resizeEnd'] as const

const WHOLE_LITERAL_LABELS = [...MONTH_VIEW_LABELS, ...TIME_GRID_LABELS] as const

/** Every `aria-label` and `title` value present in the rendered tree. */
function renderedLabelValues(): string[] {
  return [...document.querySelectorAll('[aria-label],[title]')].flatMap((el) =>
    ['aria-label', 'title'].map((a) => el.getAttribute(a)).filter((v): v is string => !!v),
  )
}

afterEach(cleanup)

describe('objectui#10104 — CalendarView a11y labels come from the pack', () => {
  it('LIT CONTROL: the packs carry every swept key, and zh differs from en for each', () => {
    const notAString = WHOLE_LITERAL_LABELS.filter((k) => typeof packValue('en', k) !== 'string' || !packValue('en', k))
    expect(notAString, `en lacks ${notAString.length} swept key(s)`).toEqual([])

    const agreeing = WHOLE_LITERAL_LABELS.filter((k) => packValue('zh', k) === packValue('en', k))
    expect(agreeing, `zh and en agree on ${agreeing.length} key(s), so those assertions would be vacuous`).toEqual([])
  })

  it('LOCALE PROBE (lit control): an ALREADY-routed label renders zh, so the provider is really mounted', () => {
    // `calendar.today` predates this card. Its zh render is what makes the
    // English findings below attributable to the component rather than to a
    // provider that never switched language.
    const { container } = renderAt('zh')
    const todayButton = container.querySelector('[aria-label]')
    expect(todayButton, 'nothing rendered at all').toBeTruthy()
    expect(container.textContent).toContain(builtInLocales.zh.calendar.today)
    expect(container.textContent).not.toContain(builtInLocales.en.calendar.today)
  })

  it('no swept label renders its ENGLISH literal under zh', () => {
    renderAt('zh')
    const values = renderedLabelValues()
    expect(values.length, 'no labelled element rendered — the sweep would be vacuous').toBeGreaterThan(0)

    const leaked = WHOLE_LITERAL_LABELS.map((k) => packValue('en', k) as string).filter((english) =>
      values.some((v) => v === english),
    )
    expect(leaked, `${leaked.length} English literal(s) still reach the DOM under zh`).toEqual([])
  })

  it('every month-view label renders its zh pack value', () => {
    renderAt('zh')
    const values = renderedLabelValues()
    const missing = MONTH_VIEW_LABELS.map((k) => packValue('zh', k) as string).filter(
      (chinese) => !values.some((v) => v === chinese),
    )
    expect(missing, `${missing.length} month-view label(s) never reached the DOM in zh`).toEqual([])
  })

  it('the week view\'s own two resize labels come from the pack too', () => {
    renderAt('zh', 'week')
    const values = renderedLabelValues()
    for (const key of TIME_GRID_LABELS) {
      expect(values, `${key} is absent from the week view`).toContain(packValue('zh', key) as string)
      expect(values).not.toContain(packValue('en', key) as string)
    }
  })

  it('the interpolated labels carry their data, not an English frame', () => {
    renderAt('zh')
    const values = renderedLabelValues()
    // `Current date: X` and `<date>, N event(s)` were English frames wrapped
    // around localized data. The frames are what a pack must own.
    expect(values.some((v) => v.startsWith('Current date:'))).toBe(false)
    expect(values.some((v) => /\d+ events?$/.test(v))).toBe(false)
  })

  it('CONTROL: under en every swept label renders its en pack value', () => {
    // Without this the zh cases could pass on a component that renders empty
    // labels, or none at all. Both views are rendered so the control covers the
    // same population the zh cases do, split the same way.
    renderAt('en')
    let values = renderedLabelValues()
    const missingMonth = MONTH_VIEW_LABELS.map((k) => packValue('en', k) as string).filter(
      (english) => !values.some((v) => v === english),
    )
    expect(missingMonth, `${missingMonth.length} month-view label(s) never reached the DOM in en`).toEqual([])

    cleanup()
    renderAt('en', 'week')
    values = renderedLabelValues()
    const missingGrid = TIME_GRID_LABELS.map((k) => packValue('en', k) as string).filter(
      (english) => !values.some((v) => v === english),
    )
    expect(missingGrid, `${missingGrid.length} time-grid label(s) never reached the DOM in en`).toEqual([])
  })
})
