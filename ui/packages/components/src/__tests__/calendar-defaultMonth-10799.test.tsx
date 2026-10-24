/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ui:calendar` and both date pickers open on the selected date's month
 * (objectui#10799).
 *
 * react-day-picker opens on `month`, else `defaultMonth`, else today, and
 * `selected` does not move it. None of these mounts passed a month, so a value
 * outside the current month opened a page, or a year, away from it: a form's
 * date field holding a 2020 date opened on today. Each mount now passes its
 * first selected day as `defaultMonth`; with no value it still opens on today.
 *
 * The clock is faked for `Date` alone and set in another year than every
 * selected value, so "opened on the value" and "opened on today" are different
 * captions. The pickers are opened through their real trigger button.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a hook (objectui#3010).
import '../renderers';
import { DatePicker } from '../custom/date-picker';

/** Today, in another year than every selected value below. */
const TODAY = new Date(2026, 8, 27, 12);
const TODAY_CAPTION = 'September 2026';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function captions(): string[] {
  return [...document.body.querySelectorAll('.rdp-caption_label')].map((el) => (el.textContent ?? '').trim());
}

function selectedDays(): string[] {
  return [...document.body.querySelectorAll('td[data-selected="true"]')].map((td) => td.getAttribute('data-day') ?? '');
}

/** Open a picker through its trigger button and read its caption. */
async function openPicker(container: HTMLElement): Promise<string> {
  fireEvent.click(container.querySelector('button')!);
  await waitFor(() => expect(captions()).not.toEqual([]));
  return captions()[0];
}

describe('ui:calendar opens on its first selected day (objectui#10799)', () => {
  const UiCalendar = ComponentRegistry.get('ui:calendar')!;
  const renderCalendar = (schema: Record<string, unknown>) =>
    render(<UiCalendar schema={{ type: 'ui:calendar', ...schema }} />);

  it('single: a day in another year opens on that month, through value and defaultValue', () => {
    renderCalendar({ mode: 'single', value: '2020-03-04' });
    expect(captions()).toEqual(['March 2020']);
    expect(selectedDays()).toEqual(['2020-03-04']);
    cleanup();

    renderCalendar({ mode: 'single', defaultValue: '2021-07-15' });
    expect(captions()).toEqual(['July 2021']);
  });

  it('multiple: opens on the first listed day', () => {
    renderCalendar({ mode: 'multiple', value: ['2020-03-04', '2021-07-15'] });
    expect(captions()).toEqual(['March 2020']);
  });

  it('multiple: an entry that is not a date is skipped, so it opens on the first VALID listed day', () => {
    renderCalendar({ mode: 'multiple', value: ['not-a-date', '2021-07-15'] });
    expect(captions()).toEqual(['July 2021']);
  });

  it('range: opens on `from`', () => {
    renderCalendar({ mode: 'range', value: { from: '2020-03-04', to: '2020-03-06' } });
    expect(captions()).toEqual(['March 2020']);
    expect(selectedDays()).toEqual(['2020-03-04', '2020-03-05', '2020-03-06']);
  });

  it('a day that names no instant is no first day: it opens on today and does not throw', () => {
    expect(() => renderCalendar({ mode: 'single', value: 'not-a-date' })).not.toThrow();
    expect(captions()).toEqual([TODAY_CAPTION]);
  });

  it('control: no value opens on today', () => {
    renderCalendar({ mode: 'single' });
    expect(captions()).toEqual([TODAY_CAPTION]);
  });
});

describe('the form date picker opens on its value (objectui#10799)', () => {
  const FormDatePicker = ComponentRegistry.get('date-picker')!;
  const renderPicker = (value?: Date) =>
    render(<FormDatePicker schema={{ type: 'date-picker', id: 'due' }} value={value} />);

  it('a value in another year opens the popover on that month, with the day selected', async () => {
    const { container } = renderPicker(new Date(2020, 2, 4));
    expect(await openPicker(container)).toBe('March 2020');
    expect(selectedDays()).toEqual(['2020-03-04']);
  });

  it('a `date-picker` node authored with an ISO string `value` opens on that month', async () => {
    // The shape of the docs' `with-default-value` example: the node's `value`
    // reaches the renderer's `value` prop through `SchemaRenderer`, unparsed.
    const { container } = render(
      <SchemaRenderer schema={{ type: 'date-picker', id: 'due', value: '2024-01-15' } as never} />,
    );
    expect(await openPicker(container)).toBe('January 2024');
    expect(selectedDays()).toEqual(['2024-01-15']);
  });

  it('control: no value opens on today', async () => {
    const { container } = renderPicker(undefined);
    expect(await openPicker(container)).toBe(TODAY_CAPTION);
  });
});

describe('DatePicker opens on its date (objectui#10799)', () => {
  it('a date in another year opens the popover on that month, with the day selected', async () => {
    const { container } = render(<DatePicker date={new Date(2020, 2, 4)} />);
    expect(await openPicker(container)).toBe('March 2020');
    expect(selectedDays()).toEqual(['2020-03-04']);
  });

  it('control: no date opens on today', async () => {
    const { container } = render(<DatePicker />);
    expect(await openPicker(container)).toBe(TODAY_CAPTION);
  });
});
