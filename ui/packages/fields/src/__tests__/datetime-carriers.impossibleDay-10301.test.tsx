/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10301 — a date-time written on a calendar day that does not exist
 * reaches the field faces as the refusal, not as a rolled March date.
 *
 * ── Why the `datetime` cell needs no code of its own ──────────────────────
 * `DateTimeCellRenderer` hands its formatters the engine's `new Date(value)`,
 * a `Date` no parse step can refuse, so on its own it would paint
 * `2026-02-30T10:00:00Z` as `3/2/2026 10:00 am`. What stops that is its
 * validity guard, which reads the shared parse step `toDisplayDate` (since
 * objectui#10026) and so returns `EmptyValue` before any formatter runs. This
 * card adds the date-time arm to that step; the cases below measure that it
 * reaches the cell through the guard, with no second realness check in the
 * renderer.
 *
 * ── Directions, predicted before the run ───────────────────────────────────
 *   pre-card sources                   RED — a rolled compact face (`3/2/2026`)
 *   the new arm deleted from the step  RED — same as pre-card
 *   the cell's guard back to `new Date(safe)`
 *                                      RED — the rolled face again, although
 *                                      the step refuses
 *   controls                           green in all three
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { formatDateTimeCompactParts } from '@object-ui/core';
import { getCellRenderer, resolveCellRendererType } from '../index';
import { DateField } from '../widgets/DateField';
import { DateTimeField } from '../widgets/DateTimeField';
import { FormulaField } from '../widgets/FormulaField';

afterEach(() => cleanup());

const IMPOSSIBLE_DATETIMES = ['2026-02-30T10:00:00Z', '2024-02-31T08:15:00.000Z', '2025-02-29T10:00'] as const;

/** A real day written with an offset: 2026-03-01T04:30Z, in UTC. */
const REAL_DAY_WITH_OFFSET = '2026-02-28T23:30:00-05:00';

/** The card's positive control. */
const REAL_DATETIME = '2026-02-28T10:00:00Z';

function session(node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: undefined }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

function renderCell(type: string, value: unknown): HTMLElement {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return session(<Renderer value={value as any} field={{ type, name: type } as any} />).container;
}

const affordanceIn = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-slot="empty-value"]');

/** Faces a date-time value reaches, each compared with its own unparsable face. */
const FACES: ReadonlyArray<readonly [string, (value: unknown) => HTMLElement]> = [
  ['DateTimeCellRenderer (`datetime` cell)', (value) => renderCell('datetime', value)],
  ['DateCellRenderer (`date` cell holding a date-time)', (value) => renderCell('date', value)],
  [
    'DateTimeField (readonly `datetime` widget)',
    (value) =>
      session(
        <DateTimeField value={value as string} onChange={() => {}} field={{ type: 'datetime', name: 'at' } as any} readonly />,
      ).container,
  ],
  [
    'DateField (readonly `date` widget holding a date-time)',
    (value) =>
      session(
        <DateField value={value as string} onChange={() => {}} field={{ type: 'date', name: 'when' } as any} readonly />,
      ).container,
  ],
  [
    'FormulaField (`returnType: date`, a date-time result)',
    (value) =>
      session(
        <FormulaField value={value as any} onChange={() => {}} field={{ type: 'formula', name: 'c', returnType: 'date' }} />,
      ).container,
  ],
];

describe.each(FACES)('objectui#10301 — %s', (_name, renderFace) => {
  it.each(IMPOSSIBLE_DATETIMES)('%s renders exactly what an unparsable value renders', (value) => {
    const refused = renderFace(value).innerHTML;
    cleanup();
    expect(refused).toBe(renderFace('not-a-date').innerHTML);
  });

  it('control: a real date-time still renders a formatted face', () => {
    const root = renderFace(REAL_DATETIME);
    cleanup();
    expect(root.innerHTML).not.toBe(renderFace('not-a-date').innerHTML);
  });
});

describe('objectui#10301 — the `datetime` cell', () => {
  it.each(IMPOSSIBLE_DATETIMES)('%s draws the shared affordance, not a rolled date', (value) => {
    const root = renderCell('datetime', value);
    expect(affordanceIn(root)).not.toBeNull();
    // The day the engine rolls `2026-02-30` into, on the compact face.
    expect(root.textContent).not.toContain('3/2/2026');
  });

  it('control: a real date-time displays as before', () => {
    // This suite runs in UTC (`vitest.config.mts` pins it).
    const root = renderCell('datetime', REAL_DATETIME);
    expect(affordanceIn(root)).toBeNull();
    // The halves are joined by a space, the compact face's own joiner (objectui#11683).
    expect(root.textContent).toBe('2/28/2026 10:00 am');
  });

  it('control: a real day written with an offset renders its instant, not the affordance', () => {
    const root = renderCell('datetime', REAL_DAY_WITH_OFFSET);
    expect(affordanceIn(root)).toBeNull();
    const parts = formatDateTimeCompactParts(new Date(REAL_DAY_WITH_OFFSET), { locale: 'en' });
    expect(root.textContent).toBe(`${parts!.date} ${parts!.time}`);
  });
});
