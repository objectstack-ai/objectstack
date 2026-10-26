/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The bound panel's "Since" date reads the DISPLAY locale, never the UI
 * language (objectui#10331).
 *
 * It was `new Date(conn.bound_at).toLocaleString(language)`, so a regional
 * display locale (`de-CH` under an English UI) never reached it. It now takes
 * its tag from `useDisplayLocale()`.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the display
 * locale is declared through `LocalizationProvider`, so the display locale is
 * the only thing that differs between the `de-CH` pin and the `en-US` control.
 * A face that still read `language` renders the English form under `de-CH` and
 * goes red.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';

import { CloudConnectionPanel } from '../CloudConnectionPanel';

/** Noon UTC, so the calendar date is the same in every zone the suite could run in (it pins `TZ=UTC`). */
const BOUND_AT = '2020-03-04T12:00:00.000Z';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/status')) {
        return reply(200, {
          success: true,
          data: {
            environmentId: 'env_1',
            bound: true,
            connection: { name: 'Acme runtime', organization_id: 'org_1', bound_at: BOUND_AT },
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The bound panel's "Since" value, under an ENGLISH UI with `locale` as the display locale. */
async function boundSince(locale: string): Promise<string> {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <CloudConnectionPanel />
      </LocalizationProvider>
    </I18nProvider>,
  );
  // The label is the English UI's; the value beside it is the date.
  const label = await screen.findByText('Since');
  const text = label.nextElementSibling?.textContent ?? '';
  cleanup();
  return text;
}

describe('CloudConnectionPanel — the bound-since date follows the display locale (objectui#10331)', () => {
  it('formats as de-CH under an English UI with a de-CH display locale', async () => {
    const text = await boundSince('de-CH');
    expect(text, `got: ${text}`).toMatch(/4\.3\.2020/);
    expect(text).toBe(new Date(BOUND_AT).toLocaleString('de-CH'));
  });

  it('control: formats as en-US under an en-US display locale', async () => {
    const text = await boundSince('en-US');
    expect(text, `got: ${text}`).toMatch(/3\/4\/2020/);
    expect(text).toBe(new Date(BOUND_AT).toLocaleString('en-US'));
  });

  it('is a reading of the session, not of the machine', async () => {
    expect(await boundSince('de-CH')).not.toBe(await boundSince('en-US'));
  });

  it('the formatter receives the declared tag, never the machine locale', async () => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await boundSince('de-CH');
    });
    const dates = calls.filter((c) => c.api === 'Date.prototype.toLocaleString');
    expect(dates.length, `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBeGreaterThan(0);
    expect(dates.every((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(dates)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
