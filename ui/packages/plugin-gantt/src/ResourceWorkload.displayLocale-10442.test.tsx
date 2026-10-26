/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ResourceWorkload`'s column labels and cell titles read the DISPLAY locale,
 * never the UI language (objectui#10442).
 *
 * The component took `const locale = language || undefined` from
 * `useGanttTranslation()`: the UI language, and the MACHINE's locale whenever
 * that language was empty. So a regional display locale (`de-CH` under an
 * English UI) never reached the histogram's dates. The component now reads
 * `useDisplayLocale()`.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control.
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';
import { ResourceWorkload } from './ResourceWorkload';
import type { GanttTask } from './GanttView';

/** Two ISO weeks, Mon 2 Mar and Mon 9 Mar 2020 (the suite pins `TZ=UTC`). */
const TASKS: GanttTask[] = [
  { id: 'a', title: 'Task a', start: new Date(2020, 2, 2), end: new Date(2020, 2, 13), progress: 0, data: { owner: 'Priya' } },
];

const byOwner = (t: GanttTask) => {
  const owner = (t.data ?? {}).owner;
  return owner ? { key: String(owner), label: String(owner) } : null;
};

afterEach(cleanup);

function workloadUnder(locale: string) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <ResourceWorkload tasks={TASKS} assignee={byOwner} viewMode="week" />
      </LocalizationProvider>
    </I18nProvider>
  );
}

/** The first week's column label and cell title, under an ENGLISH UI with `locale` as the display locale. */
function facesUnder(locale: string): { text: string; title: string } {
  const { container, getByTestId } = render(workloadUnder(locale));
  const title = getByTestId('resource-cell-Priya-0').getAttribute('title') ?? '';
  const text = container.textContent ?? '';
  cleanup();
  return { text, title };
}

describe('ResourceWorkload — the dates follow the display locale (objectui#10442)', () => {
  it('labels the week columns and cells as de-CH under an English UI with a de-CH display locale', () => {
    const { text, title } = facesUnder('de-CH');
    expect(title, `got: ${title}`).toMatch(/^2\.3\.2020 — /);
    expect(text, `got: ${text}`).toContain('2.3.');
    expect(text).toContain('9.3.');
  });

  it('control: labels them as en-US under an en-US display locale', () => {
    const { text, title } = facesUnder('en-US');
    expect(title, `got: ${title}`).toMatch(/^3\/2\/2020 — /);
    expect(text, `got: ${text}`).toContain('3/2');
    expect(text).toContain('3/9');
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', () => {
    expect(facesUnder('de-CH').title).not.toBe(facesUnder('en-US').title);
  });

  it('every locale-taking call receives the declared tag', () => {
    const tree = workloadUnder('de-CH');
    const calls = recordLocaleArguments(() => {
      render(tree);
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
    expect(calls.filter((c) => c.locale === 'en'), 'these call sites formatted in the UI language').toEqual([]);
  });
});
