/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11675 — the timeline's "This week" starts on the locale's first day.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 * With no `groupByField`, `ObjectTimeline` buckets entries by date, and its
 * "This week" / "Next week" bounds were computed from a hard-coded Monday
 * (`(now.getDay() + 6) % 7`), whatever the locale. The calendar beside it
 * started every week on Sunday, so under `en-US` a Sunday entry sat in "This
 * week" on the timeline and opened next week's row on the calendar.
 *
 * ── What the repair reads ───────────────────────────────────────────────────
 * Ruling B: the first day of the week follows the user's locale. The bounds
 * now start on `firstDayOfWeek(displayLocale)` (`@object-ui/i18n`), the tag
 * this feed's dates format with, the same answer the calendar's grids read.
 * The card's pins: `en-US` starts the week on Sunday, `zh-CN` and `en-GB` on
 * Monday. `ar-EG` (Saturday) shows the answer is the locale's and not a
 * Sunday/Monday switch.
 *
 * The clock is frozen on Tuesday 6 October 2026, and every value is a
 * date-only string, which the shared `toDisplayDate` step reads as local
 * midnight of the day it names (objectui#10866), so the buckets do not move
 * with the runner's zone. The expected buckets are written out per locale,
 * ⛔ not derived from the function under test. Every case mounts an
 * `I18nProvider` with an English UI, so only the display locale differs.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ObjectTimeline } from '../ObjectTimeline';

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
  };
});

/** Noon on Tuesday 6 October 2026, local time. */
const CLOCK = new Date(2026, 9, 6, 12, 0, 0);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Row = { id: string; title: string; when: string };

/** Friday 9 October to Monday 19 October 2026, across the end of this week in every locale below. */
const ROWS: Row[] = [
  { id: '1', title: 'Fri 9', when: '2026-10-09' },
  { id: '2', title: 'Sat 10', when: '2026-10-10' },
  { id: '3', title: 'Sun 11', when: '2026-10-11' },
  { id: '4', title: 'Mon 12', when: '2026-10-12' },
  { id: '5', title: 'Fri 16', when: '2026-10-16' },
  { id: '6', title: 'Sat 17', when: '2026-10-17' },
  { id: '7', title: 'Sun 18', when: '2026-10-18' },
  { id: '8', title: 'Mon 19', when: '2026-10-19' },
];

/** Mount the timeline over `ROWS` under a `displayLocale` session, and read each bucket as `Bucket: title, title`. */
function buckets(displayLocale: string): string[] {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(CLOCK);
  // `data` is an undeclared passthrough prop on ObjectTimelineProps (the
  // component reads it off the rest args, which is how ListView feeds it).
  const props = {
    schema: {
      type: 'object-timeline',
      objectName: 'showcase_task',
      timeline: { startDateField: 'when', titleField: 'title' },
    },
    data: ROWS,
  } as unknown as React.ComponentProps<typeof ObjectTimeline>;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: displayLocale }}>
        <ObjectTimeline {...props} />
      </LocalizationProvider>
    </I18nProvider>,
  );
  screen.getByText(ROWS[0].title);
  const out = Array.from(document.querySelectorAll('section')).map((section) => {
    const bucket = section.querySelector('header > span:first-child')?.textContent ?? '';
    const titles = Array.from(section.querySelectorAll('h3')).map((h3) => h3.textContent);
    return `${bucket}: ${titles.join(', ')}`;
  });
  cleanup();
  vi.useRealTimers();
  return out;
}

describe("ObjectTimeline week buckets start on the locale's first day (objectui#11675)", () => {
  it('en-US: this week is Sunday 4 to Saturday 10 October, so Sunday the 11th opens next week', () => {
    expect(buckets('en-US')).toEqual([
      'This week: Fri 9, Sat 10',
      'Next week: Sun 11, Mon 12, Fri 16, Sat 17',
      'Later: Sun 18, Mon 19',
    ]);
  });

  it('en-GB: this week is Monday 5 to Sunday 11 October, so Sunday the 11th is still this week', () => {
    expect(buckets('en-GB')).toEqual([
      'This week: Fri 9, Sat 10, Sun 11',
      'Next week: Mon 12, Fri 16, Sat 17, Sun 18',
      'Later: Mon 19',
    ]);
  });

  it('zh-CN: the week starts on Monday, as under en-GB', () => {
    expect(buckets('zh-CN')).toEqual([
      'This week: Fri 9, Sat 10, Sun 11',
      'Next week: Mon 12, Fri 16, Sat 17, Sun 18',
      'Later: Mon 19',
    ]);
  });

  it('ar-EG: this week is Saturday 3 to Friday 9 October, so Saturday the 10th opens next week', () => {
    expect(buckets('ar-EG')).toEqual([
      'This week: Fri 9',
      'Next week: Sat 10, Sun 11, Mon 12, Fri 16',
      'Later: Sat 17, Sun 18, Mon 19',
    ]);
  });
});
