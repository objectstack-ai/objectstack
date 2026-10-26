/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7454 — the all-day lane header must read the SAME string whether or
 * not an `I18nProvider` is mounted.
 *
 * It did not. `CalendarView`'s `DEFAULT_TRANSLATIONS` table (the `defaults`
 * argument of its `createSafeTranslation` factory) carried `'all-day'` while
 * every one of the ten packs carries the `calendar.allDay` key and `en` spells
 * it `All Day` — so a standalone embed rendered `all-day` and a provider-mounted
 * host rendered `All Day` from the same lane header.
 *
 * The table entry is a promise — "this is what the pack says" — written one
 * indirection away from the `t(key, { defaultValue })` form that
 * `scripts/check-i18n-call-site-keys.mjs` DOES value-compare, which is why no
 * gate saw the drift. Extending that gate to factory tables is objectui#7567
 * and deliberately not this file's job; this file pins the one instance.
 *
 * WHAT MAKES IT DISCRIMINATE: the expected value is read from the `en` pack
 * itself, never spelled as a literal here. Put `'all-day'` back into
 * `CalendarView.tsx`'s table and the provider-less case goes red while the
 * provider case stays green — which is exactly the split the card recorded.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { getI18n } from 'react-i18next'
import { I18nProvider, en } from '@object-ui/i18n'
import { CalendarView, type CalendarViewEvent } from './CalendarView'

/**
 * The contract, read from the pack rather than restated. `en` is the source the
 * nine translations follow and the value a provider-mounted host renders, so a
 * literal here would just be a fourth spelling of the same string.
 */
const PACK_ALL_DAY = en.calendar.allDay

const EVENT_TITLE = 'Company holiday'
const DAY = new Date(2026, 0, 15) // Thu Jan 15, 2026

const ALL_DAY_EVENT: CalendarViewEvent = {
  id: 'evt-allday-7454',
  title: EVENT_TITLE,
  start: new Date(2026, 0, 15, 0, 0, 0),
  end: new Date(2026, 0, 16, 0, 0, 0), // exclusive midnight end — one whole day
  allDay: true,
  data: { id: 'evt-allday-7454' },
}

/**
 * Read the all-day row's label gutter by STRUCTURE, not by its text — a query
 * that searched for the expected string would pass by construction and could
 * never observe the wrong spelling.
 *
 * The row is `[gutter, ...one cell per visible day]`, so the gutter is the
 * first child of the event bar's grandparent. Both structural assumptions are
 * asserted rather than trusted: if the markup is reshaped this throws instead
 * of silently reading some other element's text.
 */
function allDayLaneLabel(container: HTMLElement): string {
  const bar = container.querySelector(`[title="${EVENT_TITLE}"]`)
  if (!bar) {
    throw new Error('all-day row not rendered — the event bar is absent, so there is no lane to read')
  }
  const dayCell = bar.parentElement
  const allDayRow = dayCell?.parentElement
  const gutter = allDayRow?.firstElementChild
  if (!gutter || gutter === dayCell) {
    throw new Error('all-day row shape changed — its first child is no longer the label gutter')
  }
  return (gutter.textContent ?? '').trim()
}

/**
 * Captured across the three cases below so the last one can compare the two
 * renders directly. They are filled in declaration order, and the comparison
 * asserts it got both rather than comparing two `undefined`s.
 */
let labelWithoutProvider: string | undefined
let labelWithProvider: string | undefined

describe('objectui#7454 — calendar.allDay renders one spelling on both paths', () => {
  /**
   * ORDER IS LOAD-BEARING, and this case guards its own precondition rather
   * than relying on the order alone. `createI18n` calls `instance.use(
   * initReactI18next)`, which installs a MODULE-LEVEL global instance; once the
   * provider case below has mounted, a later provider-less render would find
   * that global, take `useObjectTranslation`'s instance path and serve the pack
   * value — passing without ever reading the defaults table. `getI18n()` is
   * how that contamination is caught: undefined means no instance exists yet,
   * so this render genuinely exercises `createSafeTranslation`'s fallback arm.
   */
  it('provider-less: the defaults table serves the pack spelling', () => {
    expect(getI18n()).toBeUndefined()

    const { container } = render(
      <CalendarView events={[ALL_DAY_EVENT]} view="day" currentDate={DAY} />,
    )
    labelWithoutProvider = allDayLaneLabel(container)
    expect(labelWithoutProvider).toBe(PACK_ALL_DAY)
  })

  it('with an I18nProvider: the en pack value renders', () => {
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, warnMissingKeys: false }}>
        <CalendarView events={[ALL_DAY_EVENT]} view="day" currentDate={DAY} />
      </I18nProvider>,
    )
    labelWithProvider = allDayLaneLabel(container)
    expect(labelWithProvider).toBe(PACK_ALL_DAY)
  })

  it('the two paths agree — that they disagreed is the whole of this card', () => {
    expect(labelWithoutProvider).toBeTypeOf('string')
    expect(labelWithProvider).toBeTypeOf('string')
    expect(labelWithoutProvider).toBe(labelWithProvider)
  })
})
