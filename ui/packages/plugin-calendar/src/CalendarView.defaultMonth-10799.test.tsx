/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `CalendarView`'s header date popover opens on the month the header names
 * (objectui#10799).
 *
 * react-day-picker opens on `month`, else `defaultMonth`, else today, and
 * `selected` does not move it. The header popover passed `selected` only, so
 * with the calendar on 4 March 2020 and the clock on 27 September 2026 the
 * header read `March 2020` while the popover under it opened on
 * `September 2026`, with no selected day in view. It now passes the date as
 * `defaultMonth` too.
 *
 * Every case drives the real header button. The clock is faked for `Date`
 * alone (timers stay real, so `waitFor` works) wherever the case authors a
 * date; the control authors none and keeps the real clock, because
 * `CalendarView`'s default date is read once at module load.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n'
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react'
import { CalendarView } from './CalendarView'
// Module scope: registers `plugin-calendar:calendar-view` for the node case
// (AGENTS.md, flaky tests: never inside a hook).
import './index'

/** The selected day: Wed 4 Mar 2020, local midnight (the suite pins `TZ=UTC`). */
const DAY = new Date(2020, 2, 4)
/** Today, in another year than {@link DAY}. */
const TODAY = new Date(2026, 8, 27, 12)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function pinClock(): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
}

/** An ENGLISH UI with an `en-US` display locale. */
function session(node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US' }}>{node}</LocalizationProvider>
    </I18nProvider>
  )
}

function headerTrigger(): HTMLElement {
  const trigger = document.body.querySelector<HTMLElement>('[aria-label^="Current date:"]')
  if (!trigger) throw new Error('no header date trigger rendered')
  return trigger
}

function headerMonth(): string {
  // The full label; the trigger also holds the short form shown at phone widths.
  return (headerTrigger().querySelector('[data-date-label="full"]')?.textContent ?? '').trim()
}

function popoverCaption(): string {
  return (document.body.querySelector('.rdp-caption_label')?.textContent ?? '').trim()
}

/** The `data-day` of every selected cell the popover paints. */
function selectedDays(): string[] {
  return [...document.body.querySelectorAll('td[data-selected="true"]')].map((td) => td.getAttribute('data-day') ?? '')
}

/** Open the header popover through its real button and read its caption. */
async function openPopover(): Promise<string> {
  fireEvent.click(headerTrigger())
  await waitFor(() => expect(document.body.querySelector('.rdp-caption_label')).not.toBeNull())
  await vi.dynamicImportSettled()
  return popoverCaption()
}

async function closePopover(): Promise<void> {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  await waitFor(() => expect(document.body.querySelector('.rdp-caption_label')).toBeNull())
}

describe('CalendarView — the header popover opens on the selected month (objectui#10799)', () => {
  it('a date in another year opens the popover on that month, with the day selected', async () => {
    pinClock()
    render(session(<CalendarView events={[]} currentDate={DAY} view="month" />))
    expect(headerMonth()).toBe('March 2020')

    expect(await openPopover()).toBe('March 2020')
    expect(selectedDays()).toEqual(['2020-03-04'])
  })

  it('every open reads the current date: after Previous, the popover opens on the new month', async () => {
    pinClock()
    render(session(<CalendarView events={[]} currentDate={DAY} view="month" />))
    expect(await openPopover()).toBe('March 2020')
    await closePopover()

    fireEvent.click(document.body.querySelector<HTMLElement>('[aria-label="Previous period"]')!)
    expect(headerMonth()).toBe('February 2020')
    expect(await openPopover()).toBe('February 2020')
  })

  it('the authored `currentDate` of a `calendar-view` node reaches the popover', async () => {
    pinClock()
    render(
      session(
        <SchemaRendererProvider dataSource={null}>
          <SchemaRenderer
            schema={{ type: 'plugin-calendar:calendar-view', id: 'n', data: [], currentDate: '2020-03-04T12:00:00.000Z' } as never}
          />
        </SchemaRendererProvider>,
      ),
    )
    await waitFor(() => expect(headerMonth()).toBe('March 2020'))

    expect(await openPopover()).toBe('March 2020')
  })

  it('an invalid `Date` from a host opens the popover on today, and the click does not throw', async () => {
    // The view renderer passes a host's `Date` instance through untouched,
    // invalid ones included; the header prints it as it always has. The
    // popover must not hand react-day-picker that value as `defaultMonth`,
    // on which it throws `RangeError: Invalid time value`.
    pinClock()
    render(session(<CalendarView events={[]} currentDate={new Date(NaN)} view="month" />))
    expect(headerMonth()).toBe('Invalid Date')
    expect(headerTrigger().getAttribute('aria-label')).toBe('Current date: Invalid Date')

    expect(await openPopover()).toBe('September 2026')
    expect(selectedDays()).toEqual([])
  })

  it('control: no date opens the popover on today, the month the header names', async () => {
    render(session(<CalendarView events={[]} view="month" />))
    const today = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    expect(headerMonth()).toBe(today)

    expect(await openPopover()).toBe(today)
  })
})
