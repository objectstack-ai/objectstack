/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12081 item 2 — `ObjectCalendar` reports the days it draws.
 *
 * A host that fetches the calendar's records (`ListView`) windows its fetch on
 * the calendar's visible days. Only the calendar knows them: the month grid is
 * six weeks that open on the locale's first day of the week, so its first and
 * last days fall outside the month, and the view (month, week, day) and the
 * date move with navigation inside the component. So the calendar reports them
 * through `onVisibleRangeChange`: on mount, which `onNavigate` and
 * `onViewChange` never cover, and whenever navigation moves them.
 *
 * Each range below is the six-week grid worked out by hand for October and
 * November 2026, under a Sunday-first locale (`en-US`) and a Monday-first one
 * (`en-GB`): 1 October 2026 is a Thursday, 1 November a Sunday.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ObjectCalendar } from '../ObjectCalendar';

const NOW = new Date(2026, 9, 14, 10, 0, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Range = { start: Date; end: Date };

const SCHEMA = {
  type: 'object-calendar',
  objectName: 'clm_contract',
  calendar: { startDateField: 'end_date', titleField: 'name' },
} as const;

/** Local midnight of a 2026-based calendar day (`month` 1-based). */
const day = (year: number, month: number, date: number) => new Date(year, month - 1, date);

/** A range as two local-midnight instants, for `toEqual`. */
const spell = (r: Range) => ({ start: r.start.getTime(), end: r.end.getTime() });

function mount(props: { locale?: string; defaultView?: 'month' | 'week' | 'day' } = {}) {
  const reports: Range[] = [];
  const onVisibleRangeChange = (range: Range) => reports.push(range);
  const ui = (handler: (range: Range) => void) => (
    <ObjectCalendar
      schema={{ ...SCHEMA, ...(props.defaultView ? { defaultView: props.defaultView } : {}) } as any}
      data={[]}
      locale={props.locale}
      onVisibleRangeChange={handler}
    />
  );
  const view = render(ui(onVisibleRangeChange));
  return { reports, rerenderWithFreshHandler: () => view.rerender(ui((range) => reports.push(range))) };
}

describe('ObjectCalendar reports the days it draws (objectui#12081)', () => {
  it('on mount: the month grid, opening on the locale\'s first day of the week (Sunday)', () => {
    const { reports } = mount({ locale: 'en-US' });
    expect(reports).toHaveLength(1);
    // Sun 27 Sep … Sat 7 Nov: 4 leading days, 31, then 7 trailing.
    expect(spell(reports[0])).toEqual(spell({ start: day(2026, 9, 27), end: day(2026, 11, 8) }));
  });

  it('on mount: the month grid under a Monday-first locale', () => {
    const { reports } = mount({ locale: 'en-GB' });
    // Mon 28 Sep … Sun 8 Nov: 3 leading days, 31, then 8 trailing.
    expect(spell(reports[reports.length - 1])).toEqual(spell({ start: day(2026, 9, 28), end: day(2026, 11, 9) }));
  });

  it('on navigation: the next month\'s grid', () => {
    const { reports } = mount({ locale: 'en-US' });
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    // 1 Nov 2026 is a Sunday: no leading days, 30, then 12 trailing.
    expect(spell(reports[reports.length - 1])).toEqual(spell({ start: day(2026, 11, 1), end: day(2026, 12, 13) }));
  });

  it('in the week view: the week that holds the date', () => {
    const { reports } = mount({ locale: 'en-US', defaultView: 'week' });
    // Wed 14 Oct sits in Sun 11 … Sat 17 Oct.
    expect(spell(reports[reports.length - 1])).toEqual(spell({ start: day(2026, 10, 11), end: day(2026, 10, 18) }));
  });

  it('in the day view: the day', () => {
    const { reports } = mount({ locale: 'en-US', defaultView: 'day' });
    expect(spell(reports[reports.length - 1])).toEqual(spell({ start: day(2026, 10, 14), end: day(2026, 10, 15) }));
  });

  it('an unchanged range is not reported again, whatever the handler\'s identity', () => {
    const { reports, rerenderWithFreshHandler } = mount({ locale: 'en-US' });
    const before = reports.length;
    act(() => rerenderWithFreshHandler());
    act(() => rerenderWithFreshHandler());
    expect(reports).toHaveLength(before);
  });
});
