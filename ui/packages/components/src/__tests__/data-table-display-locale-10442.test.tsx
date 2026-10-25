/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `data-table`'s ISO date and datetime cells read the DISPLAY locale, never the
 * UI language (objectui#10442).
 *
 * `formatCellValue` used to hand `formatDate` / `formatDateTime` the
 * `language` that `useTableTranslation()` reports, which is the UI language, so
 * a regional display locale (`de-CH` under an English UI) never reached the
 * cell. The table now reads `useDisplayLocale()` and passes that.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control. A table that still passed `language` renders the English
 * face under `de-CH` and goes red.
 *
 * The values are in a PAST year on purpose: `formatDate`'s default face drops
 * the year inside the current one, and a fixed year keeps the literals stable.
 */

import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ComponentRegistry, formatDate, formatDateTime } from '@object-ui/core';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/** A date-only value, and a datetime at noon UTC (the suite pins `TZ=UTC`). */
const DATE_ONLY = '2020-03-04';
const DATE_TIME = '2020-03-04T12:00:00Z';

afterEach(() => cleanup());

function tableUnder(locale: string) {
  const Component = ComponentRegistry.get('data-table')!;
  const schema = {
    type: 'data-table',
    columns: [
      { header: 'Due', accessorKey: 'due' },
      { header: 'At', accessorKey: 'at' },
    ],
    data: [{ id: 'r1', due: DATE_ONLY, at: DATE_TIME }],
  } as any;
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <Component schema={schema} />
      </LocalizationProvider>
    </I18nProvider>
  );
}

/** The two cells of the only row, under an ENGLISH UI with `locale` as the display locale. */
function cellsUnder(locale: string): { due: string; at: string } {
  const { container } = render(tableUnder(locale));
  const cells = [...container.querySelectorAll('tbody tr td')].map((td) => td.textContent ?? '');
  cleanup();
  const due = cells.find((c) => c.includes('2020') && !/\d:\d\d/.test(c)) ?? '';
  const at = cells.find((c) => /\d:\d\d/.test(c)) ?? '';
  return { due, at };
}

describe('data-table — the date cells follow the display locale (objectui#10442)', () => {
  it('formats both cells as de-CH under an English UI with a de-CH display locale', () => {
    const { due, at } = cellsUnder('de-CH');
    expect(due, `got: ${due}`).toBe(formatDate(DATE_ONLY, undefined, { locale: 'de-CH' }));
    expect(at, `got: ${at}`).toBe(formatDateTime(DATE_TIME, { locale: 'de-CH' }));
    expect(due).toMatch(/^4\. /);
  });

  it('control: formats both cells as en-US under an en-US display locale', () => {
    const { due, at } = cellsUnder('en-US');
    expect(due, `got: ${due}`).toBe(formatDate(DATE_ONLY, undefined, { locale: 'en-US' }));
    expect(at, `got: ${at}`).toBe(formatDateTime(DATE_TIME, { locale: 'en-US' }));
    expect(due).toBe('Mar 4, 2020');
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', () => {
    const de = cellsUnder('de-CH');
    const en = cellsUnder('en-US');
    expect(de.due).not.toBe(en.due);
    expect(de.at).not.toBe(en.at);
  });

  it('every locale-taking call receives the declared tag', () => {
    const tree = tableUnder('de-CH');
    const calls = recordLocaleArguments(() => {
      render(tree);
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
    expect(calls.filter((c) => c.locale === 'en'), 'these call sites formatted in the UI language').toEqual([]);
  });
});
