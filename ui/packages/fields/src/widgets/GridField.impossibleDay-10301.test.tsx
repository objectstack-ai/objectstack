/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10301 — the sub-grid's temporal cells refuse a calendar day that
 * does not exist, and show the stored string instead.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 * `temporalText` built its own `Date` for both columns, so the shared parse
 * step's refusal (objectui#10026) never reached them:
 *   - `date` took the stored `YYYY-MM-DD` and built `new Date(y, m - 1, d)`,
 *     which rolls `2026-02-30` into March 2nd;
 *   - `datetime` handed `formatDateTime` the engine's `new Date(raw)`, a
 *     `Date` no parse step can refuse.
 * Both now ask `toDisplayDate`. When it cannot give a date, the cell shows
 * the raw stored string, which is this surface's existing face for a value
 * it cannot parse (objectui#3569).
 *
 * Building its own `Date` also rolled an out-of-range month
 * (`new Date(2026, 12, 45)` is `Feb 14, 2027`) and read a year below 100 as
 * 1900+y; the shared step answers both, so two cases pin them as well.
 *
 * ── Directions, predicted before the run ───────────────────────────────────
 *   pre-card sources                  RED — `Mar 2` / `3/2/2026` on screen
 *   the date-time arm deleted from    RED on the `datetime` cases only; the
 *   the shared step                   `date` cases stay green (the date-only
 *                                     refusal of objectui#10026 still holds)
 *   `temporalText`'s `date` branch    RED on the `date` cases only
 *   back to `new Date(y, m - 1, d)`
 *   controls                          green throughout
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { formatDate, formatDateTime } from '@object-ui/core';
import { GridField } from './GridField';

afterEach(() => cleanup());

const temporalField = {
  columns: [
    { name: 'merchant', label: 'Merchant', type: 'text' as const },
    { name: 'incurred_on', label: 'Incurred On', type: 'date' as const },
    { name: 'incurred_at', label: 'Incurred At', type: 'datetime' as const },
  ],
} as any;

/** The read-only table's text for one row, from the two faces this surface draws. */
function readonlyText(row: Record<string, unknown>): string {
  render(<GridField value={[row]} onChange={() => {}} field={temporalField} readonly />);
  return screen.getByTestId('line-items-readonly').textContent ?? '';
}

function listText(row: Record<string, unknown>): string {
  const { container } = render(
    <GridField value={[row]} onChange={() => {}} field={temporalField} displayMode="list" onRowExpand={() => {}} />,
  );
  return container.textContent ?? '';
}

const FACES = [
  ['read-only table', readonlyText],
  ['list display mode', listText],
] as const;

describe.each(FACES)('objectui#10301 — sub-grid %s', (_name, textOf) => {
  it.each(['2026-02-30', '2024-02-31', '2025-02-29'])('a `date` column shows %s as stored, not rolled', (value) => {
    const text = textOf({ merchant: 'X', incurred_on: value });
    expect(text).toContain(value);
    expect(text).not.toContain('Mar');
  });

  it('a `date` column shows the date-time spelling the API hands back as stored', () => {
    const text = textOf({ merchant: 'X', incurred_on: '2026-02-30T00:00:00.000Z' });
    expect(text).toContain('2026-02-30T00:00:00.000Z');
    expect(text).not.toContain('Mar');
  });

  it.each(['2026-02-30T10:00:00Z', '2024-02-31T08:15:00.000Z'])(
    'a `datetime` column shows %s as stored, not rolled',
    (value) => {
      const text = textOf({ merchant: 'X', incurred_at: value });
      expect(text).toContain(value);
      expect(text).not.toContain('3/2/2026');
      expect(text).not.toContain('3/2/2024');
    },
  );

  it('a `date` column shows an out-of-range month as stored, not rolled into the next year', () => {
    // The hand-built `new Date(2026, 12, 45)` rendered `Feb 14, 2027`; the
    // shared step's own parse has always refused this value.
    const text = textOf({ merchant: 'X', incurred_on: '2026-13-45' });
    expect(text).toContain('2026-13-45');
    expect(text).not.toContain('2027');
  });

  it('a `date` column renders a year below 100 as the `date` cell does, not in the 1900s', () => {
    // The hand-built `new Date(26, 7, 1)` is 1926; the shared step undoes
    // that legacy mapping (objectui#10110).
    const text = textOf({ merchant: 'X', incurred_on: '0026-08-01' });
    expect(text).toContain(formatDate('0026-08-01', undefined, { locale: 'en' }));
    expect(text).not.toContain('1926');
  });

  it('control: a real day and a real date-time display as before', () => {
    // `'en'` is what `useDisplayLocale()` resolves to with no provider. The
    // suite runs in UTC (`vitest.config.mts` pins it).
    const text = textOf({ merchant: 'X', incurred_on: '2026-02-28', incurred_at: '2026-02-28T10:00:00Z' });
    expect(text).toContain(formatDate(new Date(2026, 1, 28), undefined, { locale: 'en' }));
    expect(text).toContain('2/28/2026 10:00 am');
    expect(text).not.toContain('2026-02-28');
  });

  it('control: a real day written with an offset renders its instant, not the stored string', () => {
    const stored = '2026-02-28T23:30:00-05:00';
    const text = textOf({ merchant: 'X', incurred_at: stored });
    expect(text).not.toContain(stored);
    expect(text).toContain(formatDateTime(new Date(stored), { style: 'compact', locale: 'en' }));
  });
});
