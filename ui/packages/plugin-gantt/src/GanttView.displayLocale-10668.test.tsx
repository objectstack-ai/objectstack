/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `GanttView`'s timeline, toolbar period and task-list dates read the DISPLAY
 * locale, never the UI language (objectui#10668).
 *
 * The component took `const dateLocale = language || undefined` from
 * `useGanttTranslation()`: the UI language, and the MACHINE's locale whenever
 * that language was empty. So a regional display locale (`de-CH` under an
 * English UI) never reached the timeline, while `ObjectGantt`'s tooltips and
 * `ResourceWorkload` in the same package already read `useDisplayLocale()`
 * (objectui#10442). `dateLocale` is now `useDisplayLocale()`.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';
import { GanttView, type GanttTask } from './GanttView';

/**
 * Mon 2 Mar to Fri 13 Mar 2020, local midnight (the suite pins `TZ=UTC`). The
 * end is the EXCLUSIVE instant a bar is drawn to, the 14th's midnight, and the
 * End cell names the day the bar runs through, the 13th (objectui#11141).
 */
const TASKS: GanttTask[] = [
  { id: 'a', title: 'Task a', start: new Date(2020, 2, 2), end: new Date(2020, 2, 14), progress: 0 },
];

beforeEach(() => {
  // >= 1280 shows the task list's Start / End columns (objectui#7204), and the
  // sibling suites read the container width off `innerWidth` the same way.
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  window.localStorage.clear();
});

afterEach(cleanup);

function ganttUnder(locale: string) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <GanttView
          tasks={TASKS}
          viewMode="week"
          startDate={new Date(2020, 2, 2)}
          endDate={new Date(2020, 3, 30)}
        />
      </LocalizationProvider>
    </I18nProvider>
  );
}

interface GanttFaces {
  /** The week columns' labels. */
  units: string[];
  /** The month band over them. */
  groups: string[];
  /** The toolbar's period label. */
  period: string;
  /** The task list's Start and End cells for task `a`. */
  start: string;
  end: string;
}

const textsOf = (container: HTMLElement, selector: string) =>
  [...container.querySelectorAll(selector)].map((el) => (el.textContent ?? '').trim());

/** The RAW readings off the DOM: expectations are built by the cases, never in here. */
function facesUnder(locale: string): GanttFaces {
  const { container } = render(ganttUnder(locale));
  const one = (testId: string) =>
    (container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').trim();
  const faces = {
    units: textsOf(container, '[data-testid="gantt-header-units"] > div'),
    groups: textsOf(container, '[data-testid="gantt-header-groups"] > div'),
    period: one('gantt-toolbar-period'),
    start: one('gantt-row-start-a'),
    end: one('gantt-row-end-a'),
  };
  cleanup();
  return faces;
}

describe('GanttView — the timeline follows the display locale (objectui#10668)', () => {
  it('renders the timeline, the period and the task list as de-CH under an English UI with a de-CH display locale', () => {
    const faces = facesUnder('de-CH');
    expect(faces.units, `got: ${JSON.stringify(faces.units.slice(0, 3))}`).toContain('2.3.');
    expect(faces.units).toContain('9.3.');
    expect(faces.groups, `got: ${JSON.stringify(faces.groups)}`).toContain('März 2020');
    expect(faces.period).toBe('März 2020');
    // 2020 is not the current year, so the task list names it (objectui#12110 item 5).
    expect(faces.start).toBe('2.3.20');
    expect(faces.end).toBe('13.3.20');
  });

  it('control: renders them as en-US under an en-US display locale', () => {
    const faces = facesUnder('en-US');
    expect(faces.units, `got: ${JSON.stringify(faces.units.slice(0, 3))}`).toContain('3/2');
    expect(faces.units).toContain('3/9');
    expect(faces.groups, `got: ${JSON.stringify(faces.groups)}`).toContain('Mar 2020');
    expect(faces.period).toBe('March 2020');
    expect(faces.start).toBe('3/2/20');
    expect(faces.end).toBe('3/13/20');
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', () => {
    const de = facesUnder('de-CH');
    const en = facesUnder('en-US');
    expect(de.units).not.toEqual(en.units);
    expect(de.groups).not.toEqual(en.groups);
    expect(de.period).not.toBe(en.period);
    expect(de.start).not.toBe(en.start);
  });

  it('every locale-taking call receives the declared tag', () => {
    const tree = ganttUnder('de-CH');
    const calls = recordLocaleArguments(() => {
      render(tree);
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(calls.slice(0, 5))}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
    expect(calls.filter((c) => c.locale === 'en'), 'these call sites formatted in the UI language').toEqual([]);
  });
});
