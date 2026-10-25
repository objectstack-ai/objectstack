/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `Calendar`'s `localeTag` input (objectui#10747).
 *
 * A `Calendar` with no `locale` reads the session's DISPLAY locale
 * (objectui#10722). A caller that formats its other dates with a tag of its
 * own, such as `CalendarView` with an authored `locale`, needs the calendar to
 * read that tag instead, and the only other door was a date-fns `Locale`
 * OBJECT, which a caller cannot build without date-fns and a resolver of its
 * own. `localeTag` takes the BCP-47 tag and resolves it through the same chain
 * as the display locale (`lib/date-fns-locale.ts`).
 *
 * Every case runs the real `I18nProvider` with an ENGLISH UI and declares the
 * display locale through `LocalizationProvider`. Each tag row is paired with a
 * display locale that would read differently, so a row can only pass if the
 * tag, not the session, decided it.
 *
 * The calendar is opened on a PAST month (`defaultMonth`), so no row depends
 * on the day the suite runs.
 */

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
// Module scope, not a hook: the calendar loads these through a dynamic
// `import()` of the SAME specifiers, so warming the module cache here keeps the
// load out of every `waitFor` window (AGENTS.md, flaky tests).
import { de } from 'date-fns/locale/de';
import { it as itLocale } from 'date-fns/locale/it';
import { Calendar } from '../ui/calendar';
import { loadDateLocale } from '../lib/date-fns-locale';

/** Wednesday 4 March 2020, at local midnight (the suite pins `TZ=UTC`). */
const DAY = new Date(2020, 2, 4);

const GERMAN_WEEK = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ENGLISH_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

afterEach(() => cleanup());

/** A `Calendar` under an ENGLISH UI with `displayLocale` declared. */
function calendarUnder(displayLocale: string, props: React.ComponentProps<typeof Calendar> = {}): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: displayLocale }}>
        <Calendar mode="single" defaultMonth={DAY} {...props} />
      </LocalizationProvider>
    </I18nProvider>
  );
}

function captionOf(container: HTMLElement): string {
  return (container.querySelector('.rdp-caption_label')?.textContent ?? '').trim();
}

function weekdayHeadsOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.rdp-weekday')].map((th) => (th.textContent ?? '').trim());
}

/** Let a load the calendar started land, then read it again. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The German locale, resident in the resolver BEFORE the calendar renders. A
 * row whose session is `de-CH` would then read German on its FIRST render if
 * the session decided it, so a row that reads anything else is the tag's (or
 * the caller's `locale`'s) doing, not a load still in flight.
 */
async function germanResident(): Promise<void> {
  expect(await loadDateLocale('de')).toBe(de);
}

describe('Calendar reads `localeTag` in place of the display locale (objectui#10747)', () => {
  it('reads German for `localeTag: "de-CH"` under an en-US display locale', async () => {
    // `de-CH` has no date-fns locale of its own: the chain reads `de`.
    expect(de.code).toBe('de');
    const { container } = render(calendarUnder('en-US', { localeTag: 'de-CH' }));
    await waitFor(() => expect(captionOf(container)).toBe('März 2020'));
    expect(weekdayHeadsOf(container)).toEqual(GERMAN_WEEK);
  });

  it('reads English for `localeTag: "en-US"` under a de-CH display locale', async () => {
    await germanResident();
    const { container } = render(calendarUnder('de-CH', { localeTag: 'en-US' }));
    expect(captionOf(container)).toBe('March 2020');
    expect(weekdayHeadsOf(container)).toEqual(ENGLISH_WEEK);
    // Still English once anything the display locale might have started has landed.
    await settle();
    expect(captionOf(container)).toBe('March 2020');
    expect(weekdayHeadsOf(container)).toEqual(ENGLISH_WEEK);
  });

  it('control: with no `localeTag`, the same session reads the display locale', async () => {
    await germanResident();
    const { container } = render(calendarUnder('de-CH'));
    // Resident, so German on the first render: the control the English rows need.
    expect(captionOf(container)).toBe('März 2020');
    expect(weekdayHeadsOf(container)).toEqual(GERMAN_WEEK);
  });

  it('reads enUS for a tag date-fns has no locale for, and for a malformed one, whatever the display locale', async () => {
    await germanResident();
    for (const tag of ['sw-KE', 'not a tag']) {
      const { container } = render(calendarUnder('de-CH', { localeTag: tag }));
      expect(captionOf(container)).toBe('March 2020');
      await settle();
      expect(captionOf(container), tag).toBe('March 2020');
      cleanup();
    }
  });

  it('keeps a date-fns `locale` its caller passes, over the tag', async () => {
    await germanResident();
    const { container } = render(calendarUnder('en-US', { localeTag: 'de-CH', locale: itLocale }));
    expect(captionOf(container)).toBe('marzo 2020');
    await settle();
    expect(captionOf(container)).toBe('marzo 2020');
  });

  it('does not hand `localeTag` on to the DOM', () => {
    const { container } = render(calendarUnder('en-US', { localeTag: 'de-CH' }));
    expect(container.querySelector('[localetag]')).toBeNull();
    expect(container.innerHTML).not.toContain('localeTag');
  });
});
