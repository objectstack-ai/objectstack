/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `CalendarView`'s header date title does not clip without a marker at phone
 * widths (objectui#13149).
 *
 * At 390px the day view's title, "Tuesday, October 20, 2026", was cut by the
 * region's `overflow-hidden` into "Tuesday, October 20, 2" with no ellipsis:
 * neither the Popover trigger nor its span could shrink below its content.
 * The header now:
 *  - lets the title's group and trigger shrink (`min-w-0`) and truncates each
 *    label with an ellipsis (`truncate`);
 *  - carries the full date in the trigger's `title`;
 *  - shows a short form of the same locale format below the `sm` breakpoint
 *    ("Tue, Oct 20"), and the full form from `sm` up.
 *
 * jsdom applies no stylesheet, so the pins read the classes that do the work
 * and the text each breakpoint shows. The control pins the full (wide) label,
 * which is unchanged.
 */

import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'
import { cleanup, render } from '@testing-library/react'
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n'
import { CalendarView } from './CalendarView'

/** Tue 20 Oct 2026, local midnight (the suite pins `TZ=UTC`). */
const DAY = new Date(2026, 9, 20)

afterEach(cleanup)

function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  )
}

function trigger(): HTMLElement {
  const el = document.body.querySelector<HTMLElement>('[aria-label^="Current date:"]')
  if (!el) throw new Error('no header date trigger rendered')
  return el
}

function label(form: 'full' | 'short'): HTMLElement {
  const el = trigger().querySelector<HTMLElement>(`[data-date-label="${form}"]`)
  if (!el) throw new Error(`no ${form} date label rendered`)
  return el
}

const classes = (el: Element) => el.className.split(/\s+/)

describe('CalendarView header — the date title truncates and shortens at phone widths (objectui#13149)', () => {
  it('(a) the trigger and its group shrink, each label truncates, and the full date is the tooltip', () => {
    render(session('en-US', <CalendarView events={[]} currentDate={DAY} view="day" />))

    expect(classes(trigger())).toContain('min-w-0')
    expect(trigger().getAttribute('title')).toBe('Tuesday, October 20, 2026')
    expect(classes(trigger().parentElement!)).toContain('min-w-0')

    for (const form of ['full', 'short'] as const) {
      expect(classes(label(form))).toEqual(expect.arrayContaining(['truncate', 'min-w-0']))
    }
    // Short below `sm`, full from `sm` up.
    expect(classes(label('short'))).toContain('sm:hidden')
    expect(classes(label('full'))).toEqual(expect.arrayContaining(['hidden', 'sm:block']))
  })

  it('(a) the short form of each view comes from the same locale format', () => {
    render(session('en-US', <CalendarView events={[]} currentDate={DAY} view="day" />))
    expect(label('short').textContent).toBe('Tue, Oct 20')
    cleanup()

    render(session('en-US', <CalendarView events={[]} currentDate={DAY} view="week" />))
    expect(label('short').textContent).toBe('Oct 18 - Oct 24')
    cleanup()

    render(session('en-US', <CalendarView events={[]} currentDate={DAY} view="month" />))
    expect(label('short').textContent).toBe('Oct 2026')
  })

  it('(a) the short form follows the display locale, not English', () => {
    render(session('de-DE', <CalendarView events={[]} currentDate={DAY} view="day" />))
    expect(label('short').textContent).toBe(
      DAY.toLocaleDateString('de-DE', { weekday: 'short', month: 'short', day: 'numeric' }),
    )
    expect(label('short').textContent).not.toBe('Tue, Oct 20')
  })

  it('(b) control: the full (wide) label and the accessible name are unchanged', () => {
    const cases = [
      { view: 'day', full: 'Tuesday, October 20, 2026' },
      { view: 'week', full: 'Oct 18 - Oct 24, 2026' },
      { view: 'month', full: 'October 2026' },
    ] as const
    for (const c of cases) {
      render(session('en-US', <CalendarView events={[]} currentDate={DAY} view={c.view} />))
      expect(label('full').textContent).toBe(c.full)
      expect(trigger().getAttribute('aria-label')).toBe(`Current date: ${c.full}`)
      expect(trigger().getAttribute('title')).toBe(c.full)
      cleanup()
    }
  })
})
