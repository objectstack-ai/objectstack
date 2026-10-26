/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12110 item 5 (finding B-20 of the HotCRM browser pass) — a task's
 * dates name their year when it is not the current one.
 *
 * The task list's Start / End cells, the row's date sublabel, the bar tooltip
 * and the two drag previews formatted `{ month, day }` only, so a plan reaching
 * into last or next year read `3/2` for two different days a year apart. They
 * now add the year whenever the date's year is not the current one — the
 * compact numeric faces as two digits (the Start / End cells are narrow), the
 * tooltip's short-month face in full — and a date in the current year reads as
 * it did.
 *
 * The clock is pinned (Date only), because "the current year" is the test's
 * subject: an unpinned run would change meaning every New Year's Day. The suite
 * runs in UTC (`vitest.config.mts` pins `TZ`).
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { GanttView, type GanttTask } from '../GanttView';

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 5, 15, 12));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function at(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

function task(id: string, start: Date, end: Date): GanttTask {
  return { id, title: `Task ${id}`, start, end, progress: 0 };
}

/** March 2nd to 6th of LAST year (end exclusive: the 7th's midnight). */
const LAST_YEAR = task('a', new Date(2025, 2, 2), new Date(2025, 2, 7));
/** The same days THIS year. */
const THIS_YEAR = task('b', new Date(2026, 2, 2), new Date(2026, 2, 7));

function renderView(width = 1280) {
  at(width);
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: 'en-US' }}>
        <div style={{ width, height: 600 }}>
          <GanttView
            tasks={[LAST_YEAR, THIS_YEAR]}
            startDate={new Date(2025, 1, 20)}
            endDate={new Date(2026, 3, 1)}
            viewMode="month"
          />
        </div>
      </LocalizationProvider>
    </I18nProvider>,
  );
}

const text = (container: HTMLElement, testId: string) =>
  (container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').trim();

function hoverTooltip(container: HTMLElement, id: string): string {
  const bar = container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;
  expect(bar, `no bar ${id}`).toBeTruthy();
  act(() => {
    fireEvent.mouseEnter(bar);
  });
  return text(container, `gantt-tooltip-${id}`);
}

describe('GanttView names the year of a date outside the current one (objectui#12110 item 5)', () => {
  it('THE DEFECT — the Start / End cells of a last-year task carry its year', () => {
    const { container } = renderView();
    expect(text(container, 'gantt-row-start-a')).toBe('3/2/25');
    expect(text(container, 'gantt-row-end-a')).toBe('3/6/25');
  });

  it('the row sublabel does too, below the Start / End threshold', () => {
    const { container } = renderView(800);
    expect(text(container, 'gantt-row-dates-a')).toBe('3/2/25 → 3/6/25');
  });

  it('the tooltip names the year in full', () => {
    const { container } = renderView();
    expect(hoverTooltip(container, 'a')).toContain('Mar 2, 2025 → Mar 6, 2025');
  });

  it('CONTROL: the same days this year read as they did, with no year', () => {
    const { container } = renderView();
    expect(text(container, 'gantt-row-start-b')).toBe('3/2');
    expect(text(container, 'gantt-row-end-b')).toBe('3/6');
    expect(hoverTooltip(container, 'b')).toContain('Mar 2 → Mar 6');
  });
});
