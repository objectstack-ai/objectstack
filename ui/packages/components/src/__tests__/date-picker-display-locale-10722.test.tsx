/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The date-fns and react-day-picker date faces read the DISPLAY locale
 * (objectui#10722).
 *
 * `useDisplayLocale.ts` says every date renderer goes through it. The `Intl`
 * faces have done so since objectui#10442 and objectui#10668. These faces are
 * the ones outside `Intl`: the two date pickers format their label with date-fns
 * `format`, and every `Calendar` renders its caption and weekday heads through
 * react-day-picker. Both take a date-fns `Locale` OBJECT rather than a tag, and
 * with none supplied both answered in `enUS` under every display locale and
 * every UI language.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` rows and the
 * `en-US` control.
 *
 * The date is in a PAST year and the calendar is opened on it (`defaultMonth`),
 * so no row depends on the day the suite runs.
 */

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { CalendarSchema, DatePickerSchema } from '@object-ui/types';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { format } from 'date-fns';
// Module scope, not a hook: the faces load these through a dynamic `import()`
// of the SAME specifiers, so warming the module cache here keeps the load out
// of every `waitFor` window (AGENTS.md, flaky tests: a module load billed to a
// bounded window).
import { de } from 'date-fns/locale/de';
import { frCH } from 'date-fns/locale/fr-CH';
import { it as itLocale } from 'date-fns/locale/it';
// Registers the renderers at module scope, NOT inside a `beforeAll`: there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';
import { Calendar } from '../ui/calendar';
import { DatePicker } from '../custom/date-picker';

/** Wednesday 4 March 2020, at local midnight (the suite pins `TZ=UTC`). */
const DAY = new Date(2020, 2, 4);

afterEach(() => cleanup());

/** An ENGLISH UI with `locale` as the declared display locale. */
function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

/** The form date picker (`type: 'date-picker'`), the face the card measured first. */
function formDatePicker(locale: string, schemaExtra: Pick<DatePickerSchema, 'format'> = {}): React.ReactElement {
  const Component = ComponentRegistry.get('date-picker')!;
  const schema: DatePickerSchema = { type: 'date-picker', id: 'due', ...schemaExtra };
  return session(locale, <Component schema={schema} value={DAY} />);
}

/** The trigger's text: the picker's label. */
function triggerText(container: HTMLElement): string {
  return (container.querySelector('button')?.textContent ?? '').trim();
}

/** A `Calendar` mounted with no `locale`, as `CalendarView` and `DashboardFilterBar` mount it. */
function bareCalendar(locale: string, extra: Record<string, unknown> = {}): React.ReactElement {
  return session(locale, <Calendar mode="single" defaultMonth={DAY} {...extra} />);
}

function captionOf(container: HTMLElement): string {
  return (container.querySelector('.rdp-caption_label')?.textContent ?? '').trim();
}

function weekdayHeadsOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.rdp-weekday')].map((th) => (th.textContent ?? '').trim());
}

describe('the form date picker label follows the display locale (objectui#10722)', () => {
  it('reads German under an English UI with a de-CH display locale', async () => {
    const { container } = render(formDatePicker('de-CH'));
    const expected = format(DAY, 'PPP', { locale: de });
    expect(expected).toBe('4. März 2020');
    await waitFor(() => expect(triggerText(container)).toBe(expected));
  });

  it('control: reads exactly as before under an en-US display locale', async () => {
    const { container } = render(formDatePicker('en-US'));
    // `format` with no `locale` is date-fns `enUS`: the face as it read before.
    expect(triggerText(container)).toBe(format(DAY, 'PPP'));
    expect(triggerText(container)).toBe('March 4th, 2020');
  });

  it('honours an authored `format`, which stays a date-fns pattern', async () => {
    // A numeric pattern has no locale-dependent token: it reads the same everywhere.
    const numeric = render(formDatePicker('de-CH', { format: 'yyyy-MM-dd' }));
    expect(triggerText(numeric.container)).toBe('2020-03-04');
    cleanup();

    // A pattern with textual tokens is honoured AND spelled in the display locale.
    const pattern = 'EEEE, d. MMMM yyyy';
    const textual = render(formDatePicker('de-CH', { format: pattern }));
    const expected = format(DAY, pattern, { locale: de });
    expect(expected).toBe('Mittwoch, 4. März 2020');
    await waitFor(() => expect(triggerText(textual.container)).toBe(expected));
  });

  it('falls back to enUS, without throwing, while a locale is not loaded yet', async () => {
    // `fr-CH` is read nowhere else in this file, so its locale is not loaded
    // when the picker first renders. The first paint reads enUS, and the
    // picker re-renders once the locale arrives.
    const { container } = render(formDatePicker('fr-CH'));
    expect(triggerText(container)).toBe('March 4th, 2020');
    const expected = format(DAY, 'PPP', { locale: frCH });
    expect(expected).toBe('4 mars 2020');
    await waitFor(() => expect(triggerText(container)).toBe(expected));
  });

  it('stays enUS, without throwing, for a tag date-fns has no locale for, and for a malformed one', async () => {
    for (const tag of ['sw-KE', 'not a tag']) {
      const { container } = render(formDatePicker(tag));
      expect(triggerText(container)).toBe('March 4th, 2020');
      // Give a load, if one were started, the chance to land: nothing changes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(triggerText(container)).toBe('March 4th, 2020');
      cleanup();
    }
  });
});

describe('the DatePicker component label follows the display locale (objectui#10722)', () => {
  it('reads German under a de-CH display locale, and enUS under en-US', async () => {
    const german = render(session('de-CH', <DatePicker date={DAY} />));
    await waitFor(() => expect(triggerText(german.container)).toBe('4. März 2020'));
    cleanup();

    const english = render(session('en-US', <DatePicker date={DAY} />));
    expect(triggerText(english.container)).toBe('March 4th, 2020');
  });
});

describe('a Calendar with no `locale` follows the display locale (objectui#10722)', () => {
  it('spells its month caption and weekday heads in German under de-CH, and starts the week on Monday', async () => {
    const { container } = render(bareCalendar('de-CH'));
    await waitFor(() => expect(captionOf(container)).toBe('März 2020'));
    // The week start is the display locale's reading: date-fns `de` starts on Monday.
    expect(weekdayHeadsOf(container)).toEqual(['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']);
  });

  it('control: reads exactly as before under an en-US display locale', () => {
    const { container } = render(bareCalendar('en-US'));
    expect(captionOf(container)).toBe('March 2020');
    expect(weekdayHeadsOf(container)).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  });

  it('keeps a `locale` its caller passes', async () => {
    const { container } = render(bareCalendar('de-CH', { locale: itLocale }));
    expect(captionOf(container)).toBe('marzo 2020');
    // Still Italian once anything the display locale started has landed.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(captionOf(container)).toBe('marzo 2020');
  });

  it('reaches the `ui:calendar` renderer', async () => {
    const Component = ComponentRegistry.get('ui:calendar')!;
    const schema: CalendarSchema = { type: 'calendar', mode: 'single' };
    const { container } = render(session('de-CH', <Component schema={schema} defaultMonth={DAY} />));
    await waitFor(() => expect(captionOf(container)).toBe('März 2020'));
  });
});
