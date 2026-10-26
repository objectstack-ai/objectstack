/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectCalendar`'s quick-create dialog formats its date with the SAME locale
 * the month grid beside it uses: an authored `locale` when one is set, and the
 * DISPLAY locale otherwise (objectui#10668).
 *
 * The dialog handed the component's own `locale` prop straight to
 * `toLocaleDateString` / `toLocaleTimeString`. That prop is `undefined`
 * whenever no host passes one, so the dialog read the MACHINE's locale, while
 * the `CalendarView` grid it opens from reads `useDisplayLocale()` for its
 * `"default"` branch (objectui#10442). The dialog now resolves its locale with
 * the grid's own rule, so a set `locale` still wins, as it did before, and as
 * it does in the grid.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider` in every case, so
 * no leg depends on the runner's own locale. The clock is fixed (only `Date`
 * is faked, so the waits below still run on real timers) so that the month the
 * calendar opens on, and the day clicked, are known.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
  isMachineLocale,
  recordLocaleArgumentsAsync,
} from '@object-ui/test-support';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ObjectCalendar } from './ObjectCalendar';

/** The day clicked: Wed 18 Mar 2020, an in-month day with no event (the suite pins `TZ=UTC`). */
const CLICKED = new Date(2020, 2, 18);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2020, 2, 4, 9, 0, 0));
  try {
    window.localStorage.clear();
  } catch {
    /* private mode */
  }
  // The record overlay's shared payload asks `POST /api/v1/security/explain`;
  // under happy-dom a relative fetch is a real socket (objectui#6640).
  installRecordSecurityExplainDouble(vi);
});

// ONE hook, in this order (objectui#7439): unmount first, restore last.
afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ROWS = [{ id: 'r1', name: 'Ada out', start_date: new Date(2020, 2, 10, 9).toISOString() }];

const CONFIGURED = {
  type: 'object-calendar',
  objectName: 'crm_leave_request',
  calendar: { startDateField: 'start_date' },
} as any;

const makeDataSource = () =>
  ({
    find: vi.fn().mockResolvedValue({ data: ROWS }),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'crm_leave_request',
      fields: { id: { type: 'text' }, name: { type: 'text' }, start_date: { type: 'date' } },
    }),
    create: vi.fn().mockResolvedValue({ id: 'r2' }),
  }) as any;

/** The grid cell's accessible name for `CLICKED` in `locale` (`CalendarView`'s month cell). */
const cellLabelIn = (locale: string) =>
  CLICKED.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** The dialog's date line for `CLICKED` in `locale`, under the English UI's `calendar.onDate`. */
const dialogLineIn = (locale: string) =>
  `On ${CLICKED.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })}`;

/**
 * Open the quick-create dialog on `CLICKED` and return its date line. The grid
 * cell is found by its name in `gridLocale`, the locale the grid is expected to
 * format with, so a grid that formatted otherwise would fail the lookup rather
 * than open some other day.
 */
async function dialogLineUnder(
  displayLocale: string,
  gridLocale: string,
  props: { locale?: string } = {},
): Promise<string> {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: displayLocale }}>
        <ObjectCalendar schema={CONFIGURED} dataSource={makeDataSource()} data={ROWS as any} {...props} />
      </LocalizationProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
  const name = cellLabelIn(gridLocale);
  const cell = screen
    .getAllByRole('gridcell')
    .find((el) => el.getAttribute('aria-label') === name);
  expect(cell, `no grid cell named ${name}`).toBeTruthy();
  fireEvent.click(cell!);
  const dialog = await screen.findByRole('dialog');
  // The date line is the dialog's description: the element its
  // `aria-describedby` names.
  const describedBy = dialog.getAttribute('aria-describedby');
  const description = describedBy ? document.getElementById(describedBy) : null;
  expect(description, 'the dialog names no description').toBeTruthy();
  const line = description!.textContent ?? '';
  cleanup();
  return line.trim();
}

describe('ObjectCalendar — the quick-create dialog follows the grid locale (objectui#10668)', () => {
  it('formats the date as de-CH under an English UI with a de-CH display locale', async () => {
    expect(dialogLineIn('de-CH')).toBe('On 18. März 2020');
    expect(await dialogLineUnder('de-CH', 'de-CH')).toBe(dialogLineIn('de-CH'));
  });

  it('control: formats the date as en-US under an en-US display locale', async () => {
    expect(dialogLineIn('en-US')).toBe('On March 18, 2020');
    expect(await dialogLineUnder('en-US', 'en-US')).toBe(dialogLineIn('en-US'));
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', async () => {
    const de = await dialogLineUnder('de-CH', 'de-CH');
    const en = await dialogLineUnder('en-US', 'en-US');
    expect(de).not.toBe(en);
  });

  it('an authored `locale` still wins over the display locale, in the dialog as in the grid', async () => {
    expect(dialogLineIn('fr-FR')).toBe('On 18 mars 2020');
    expect(await dialogLineUnder('de-CH', 'fr-FR', { locale: 'fr-FR' })).toBe(dialogLineIn('fr-FR'));
  });

  it('the grid\'s own `"default"` spelling reads the display locale in the dialog too', async () => {
    expect(await dialogLineUnder('de-CH', 'de-CH', { locale: 'default' })).toBe(dialogLineIn('de-CH'));
  });

  it('every locale-taking call made while the dialog opens receives a declared tag', async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <LocalizationProvider value={{ locale: 'de-CH' }}>
          <ObjectCalendar schema={CONFIGURED} dataSource={makeDataSource()} data={ROWS as any} />
        </LocalizationProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('Ada out')).toBeTruthy());
    const cell = screen
      .getAllByRole('gridcell')
      .find((el) => el.getAttribute('aria-label') === cellLabelIn('de-CH'));
    expect(cell).toBeTruthy();
    const calls = await recordLocaleArgumentsAsync(async () => {
      fireEvent.click(cell!);
      await screen.findByRole('dialog');
    });
    expect(calls.some((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(calls.slice(0, 5))}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
    expect(calls.filter((c) => c.locale === 'en'), 'these call sites formatted in the UI language').toEqual([]);
  });
});
