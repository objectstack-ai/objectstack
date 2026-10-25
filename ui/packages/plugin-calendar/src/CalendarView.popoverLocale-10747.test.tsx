/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `CalendarView`'s header date popover reads the same locale as its grids
 * (objectui#10747).
 *
 * `CalendarView` resolves one `effectiveLocale`: an explicit `locale` prop
 * wins, and `"default"` reads the display locale (objectui#10442). The month,
 * week and day grids and the header label all format with it. The header's
 * date popover mounts `Calendar` from `@object-ui/components`, and that
 * `Calendar` got no locale at all, so it read the session's DISPLAY locale
 * (objectui#10722) even when the host or the author had set another one. Under
 * an `en-US` display locale with an authored `locale: 'de-CH'`, the header read
 * `März 2020` and the popover under it read `March 2020`.
 *
 * The popover now hands `Calendar` the same tag through `Calendar`'s
 * `localeTag` input, which resolves it through the one date-fns resolver in
 * `@object-ui/components`. `plugin-calendar` holds no resolver and no date-fns
 * dependency of its own.
 *
 * Every case runs the real `I18nProvider` with an ENGLISH UI, and declares the
 * display locale through `LocalizationProvider`.
 *
 * The clock is pinned to the calendar's day with `Date` faked alone (timers
 * stay real, so `waitFor` works): react-day-picker opens the popover on TODAY's
 * month, not on the selected day's, so only with today equal to `DAY` does the
 * popover show the month the header names.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n'
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react'
import { CalendarView } from './CalendarView'
// Module scope: registers `plugin-calendar:object-calendar` for the node case
// (AGENTS.md, flaky tests: never inside a hook).
import './index'

/** Wed 4 Mar 2020, local midnight (the suite pins `TZ=UTC`). */
const DAY = new Date(2020, 2, 4)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DAY)
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

/** The header trigger: the button whose label is the grid's month name. */
function headerTrigger(): HTMLElement {
  const trigger = document.body.querySelector<HTMLElement>('[aria-label^="Current date:"]')
  if (!trigger) throw new Error('no header date trigger rendered')
  return trigger
}

/** The month the header names, which is the month view's own label. */
function headerMonth(): string {
  // The full label; the trigger also holds the short form shown at phone widths.
  return (headerTrigger().querySelector('[data-date-label="full"]')?.textContent ?? '').trim()
}

function popoverCaption(): string {
  return (document.body.querySelector('.rdp-caption_label')?.textContent ?? '').trim()
}

function popoverWeekdayHeads(): string[] {
  return [...document.body.querySelectorAll('.rdp-weekday')].map((th) => (th.textContent ?? '').trim())
}

/**
 * Open the header popover and read it once its locale has landed.
 *
 * The popover's date-fns locale arrives through a lazy `import()` inside
 * `@object-ui/components`, and `plugin-calendar` cannot warm that specifier at
 * module scope (it has no date-fns dependency, by the card's ruling). So the
 * load is settled with `vi.dynamicImportSettled()` BEFORE any `waitFor`, which
 * keeps an unbounded module load out of the bounded assertion window.
 */
async function openPopover(expectedCaption: string): Promise<{ caption: string; weekdays: string[] }> {
  fireEvent.click(headerTrigger())
  await waitFor(() => expect(document.body.querySelector('.rdp-caption_label')).not.toBeNull())
  await vi.dynamicImportSettled()
  await waitFor(() => expect(popoverCaption()).toBe(expectedCaption))
  return { caption: popoverCaption(), weekdays: popoverWeekdayHeads() }
}

const GERMAN_WEEK = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const ENGLISH_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

describe('CalendarView — the header popover reads the grid locale (objectui#10747)', () => {
  it('an explicit `locale` reaches the popover: de-CH under an en-US display locale', async () => {
    render(session('en-US', <CalendarView events={[]} currentDate={DAY} view="month" locale="de-CH" />))
    // The grid's month name, as the header prints it.
    expect(headerMonth()).toBe('März 2020')

    const popover = await openPopover(headerMonth())
    expect(popover.caption).toBe('März 2020')
    // `de-CH` reads date-fns `de`, whose week starts on Monday.
    expect(popover.weekdays).toEqual(GERMAN_WEEK)
  })

  it('control: `locale: "default"` under an en-US display locale reads en-US in both faces', async () => {
    render(session('en-US', <CalendarView events={[]} currentDate={DAY} view="month" />))
    expect(headerMonth()).toBe('March 2020')

    const popover = await openPopover(headerMonth())
    expect(popover.caption).toBe('March 2020')
    expect(popover.weekdays).toEqual(ENGLISH_WEEK)
  })

  it('control: `locale: "default"` still reads the display locale in both faces', async () => {
    render(session('de-CH', <CalendarView events={[]} currentDate={DAY} view="month" />))
    expect(headerMonth()).toBe('März 2020')

    const popover = await openPopover(headerMonth())
    expect(popover.caption).toBe('März 2020')
    expect(popover.weekdays).toEqual(GERMAN_WEEK)
  })
})

describe('object-calendar — an AUTHORED `locale` reaches the header popover (objectui#10747)', () => {
  /** The flat config `ObjectView` / `ListView` emit, plus the declared pre-fetch array. */
  function node(extra: Record<string, unknown>) {
    return {
      type: 'plugin-calendar:object-calendar',
      id: 'n',
      objectName: 'accounts',
      startDateField: 'start_at',
      titleField: 'name',
      data: [{ id: 'r1', name: 'Standup', start_at: new Date(2020, 2, 10, 10).toISOString() }],
      ...extra,
    } as never
  }

  it('ObjectCalendar forwards `locale: "de-CH"` under an en-US display locale, and the popover reads it', async () => {
    render(
      session(
        'en-US',
        <SchemaRendererProvider dataSource={null}>
          <SchemaRenderer schema={node({ locale: 'de-CH' })} />
        </SchemaRendererProvider>,
      ),
    )
    await waitFor(() => expect(headerMonth()).toBe('März 2020'))

    const popover = await openPopover(headerMonth())
    expect(popover.caption).toBe('März 2020')
    expect(popover.weekdays).toEqual(GERMAN_WEEK)
  })
})
