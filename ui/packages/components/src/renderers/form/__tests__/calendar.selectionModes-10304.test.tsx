/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10304 — `ui:calendar` reads the selection shape its `mode` reads.
 *
 * `DayPicker` reads one day in `single` mode, a list in `multiple` mode and
 * `{ from, to }` in `range` mode. The renderer handed every mode the one-day
 * read, so `multiple` given a lone day threw inside the picker
 * (`selected?.some is not a function`) and `range` selected nothing for any
 * value at all. The renderer now reads each mode's shape and coerces every
 * day inside it through `toDisplayDate`; the mirror half, which refuses a
 * shape its mode does not read, is `calendar-selection-mode-10304.test.ts` in
 * `packages/types`.
 *
 * Dates here are date-only strings in the suite zone; the zone behaviour of
 * the per-day coercion is pinned by `calendar.dateValueZone-10293.test.tsx`.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a hook (objectui#3010).
import '../../../renderers';

/** Frozen inside September 2026, so the calendar opens on the month under test. */
const CLOCK = '2026-09-03T10:35:00.000Z';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The `data-day` of every selected cell the calendar paints. */
function selectedDays(schema: Record<string, unknown>): string[] {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
  const Calendar = ComponentRegistry.get('ui:calendar')!;
  const { container } = render(<Calendar schema={{ type: 'ui:calendar', ...schema }} />);
  const days = Array.from(container.querySelectorAll('td[data-selected="true"]'))
    .map((td) => td.getAttribute('data-day') ?? '');
  cleanup();
  return days;
}

describe('ui:calendar selection by mode (objectui#10304)', () => {
  it('range + { from, to } selects every day of the range, through value and defaultValue', () => {
    const range = { from: '2026-09-15', to: '2026-09-17' };
    const expected = ['2026-09-15', '2026-09-16', '2026-09-17'];
    expect(selectedDays({ mode: 'range', value: range })).toEqual(expected);
    expect(selectedDays({ mode: 'range', defaultValue: range })).toEqual(expected);
  });

  it('range with `from` only selects that one day', () => {
    expect(selectedDays({ mode: 'range', value: { from: '2026-09-15' } })).toEqual(['2026-09-15']);
  });

  it('multiple + a list selects each listed day, strings and `Date`s alike', () => {
    expect(selectedDays({ mode: 'multiple', value: ['2026-09-15', new Date(2026, 8, 20)] }))
      .toEqual(['2026-09-15', '2026-09-20']);
    expect(selectedDays({ mode: 'multiple', defaultValue: ['2026-09-02'] })).toEqual(['2026-09-02']);
  });

  it('multiple + a lone day no longer crashes, and selects nothing rather than being reshaped', () => {
    expect(() => selectedDays({ mode: 'multiple', value: '2026-09-15' })).not.toThrow();
    expect(selectedDays({ mode: 'multiple', value: '2026-09-15' })).toEqual([]);
    expect(selectedDays({ mode: 'multiple', defaultValue: new Date(2026, 8, 15) })).toEqual([]);
  });

  it('range + a lone day selects nothing', () => {
    expect(selectedDays({ mode: 'range', value: '2026-09-15' })).toEqual([]);
  });

  it('single mode keeps selecting its one day', () => {
    expect(selectedDays({ mode: 'single', value: '2026-09-15' })).toEqual(['2026-09-15']);
    expect(selectedDays({ value: '2026-09-15' })).toEqual(['2026-09-15']);
  });
});
