/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10026 — a date field face refuses a nonexistent calendar day with
 * the SAME marker it renders for an unparsable value.
 *
 * ── Why this file exists beside the core pins ────────────────────────────
 * The maintainer's ruling on objectui#10026 made the shared date path refuse
 * `2026-02-30` (the engine rolls it into March 2nd), and `formatDate` now
 * answers it with its unparsable dash. But four field faces do not show
 * `formatDate`'s dash for an unparsable value: they intercept it first and
 * draw the shared `EmptyValue` affordance, because a dash in a plain span is
 * naked punctuation to a screen reader (objectui#8581 for the two cells,
 * objectui#8809 for the two readonly widgets). Each interception claimed to
 * be co-extensive with `formatDate`'s dash by re-spelling its parse as
 * `new Date(value)` — and the engine's parse ACCEPTS a nonexistent day. So
 * the refusal would have reached those faces as the very bare dash those
 * cards removed: a third marker shape, which the ruling forbids.
 *
 * The guards now read `toDisplayDate`, the parse step `formatDate` itself
 * reads, so "co-extensive" holds by construction. These cases MEASURE the
 * ruling's "same visible marker" at each face: the DOM a nonexistent day
 * renders is compared with the DOM `not-a-date` renders, byte for byte.
 *
 * ── Directions, MEASURED on three ablated trees ───────────────────────────
 * Predicted first, then run; the rows are the observed runs.
 *   pre-card sources (every refusal case)      RED — a formatted March date;
 *                                              the due-like cell painted red
 *   refusal deleted from `toDisplayDate`       RED — same as pre-card
 *   refusal kept, guards back to `new Date`    RED — the three faces that
 *                                              format a string show a bare
 *                                              dash in a plain span
 *   leap-day controls                          green in all three
 * ⚠️ Two cells of the third row were not predicted. The `datetime` cell reds
 * with a ROLLED compact face, not a bare dash: its old guard handed the
 * formatters an already-parsed `Date`, which no parse step can refuse. And
 * the due-like case reds on its affordance assertion while its colour
 * assertion stays green — the overdue predicate already read the parse step.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { getCellRenderer, resolveCellRendererType } from '../index';
import { DateField } from '../widgets/DateField';
import { FormulaField } from '../widgets/FormulaField';

afterEach(() => cleanup());

/** The days the card and the ruling name; none of them exists. */
const IMPOSSIBLE_DAYS = ['2026-02-30', '2024-02-31', '2025-02-29'] as const;

/** A real leap day, past-year so its face is stable. */
const REAL_LEAP_DAY = '2024-02-29';

function session(node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: undefined }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

function renderCell(type: string, value: unknown, field: Record<string, unknown> = {}): HTMLElement {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return session(<Renderer value={value as any} field={{ type, name: type, ...field } as any} />).container;
}

/** The four faces that intercept an unparsable value with `EmptyValue`. */
const FACES: ReadonlyArray<readonly [string, (value: unknown) => HTMLElement]> = [
  ['DateCellRenderer (`date` cell)', (value) => renderCell('date', value)],
  ['DateTimeCellRenderer (`datetime` cell)', (value) => renderCell('datetime', value)],
  [
    'DateField (readonly `date` widget)',
    (value) =>
      session(
        <DateField value={value as string} onChange={() => {}} field={{ type: 'date', name: 'when' } as any} readonly />,
      ).container,
  ],
  [
    'FormulaField (`returnType: date`)',
    (value) =>
      session(
        <FormulaField value={value as any} onChange={() => {}} field={{ type: 'formula', name: 'c', returnType: 'date' }} />,
      ).container,
  ],
];

const affordanceIn = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-slot="empty-value"]');

/** Every em-dash outside the affordance — the one a screen reader cannot name. */
function bareDashes(root: HTMLElement): HTMLElement[] {
  return within(root)
    .queryAllByText('—')
    .filter((el) => el.getAttribute('data-slot') !== 'empty-value');
}

describe.each(FACES)('objectui#10026 — %s', (_name, renderFace) => {
  it.each(IMPOSSIBLE_DAYS)('%s draws the shared affordance, not a bare dash', (value) => {
    const root = renderFace(value);
    expect(bareDashes(root), `${value}: no dash outside the affordance`).toHaveLength(0);
    expect(affordanceIn(root), `${value}: the affordance must be present`).not.toBeNull();
  });

  it.each(IMPOSSIBLE_DAYS)('%s renders exactly what an unparsable value renders', (value) => {
    const refused = renderFace(value).innerHTML;
    cleanup();
    expect(refused).toBe(renderFace('not-a-date').innerHTML);
  });

  it('control: a real leap day still renders its formatted face', () => {
    const root = renderFace(REAL_LEAP_DAY);
    expect(affordanceIn(root)).toBeNull();
    expect(root.textContent).not.toBe('');
  });
});

describe('objectui#10026 — the `date` cell states no deadline for a day that does not exist', () => {
  it('a due-like impossible day is not painted red', () => {
    // The day `2026-02-30` rolled into lies in the past, so an overdue
    // predicate fed the engine's parse would colour the cell.
    const root = renderCell('date', '2026-02-30', { name: 'due_date' });
    expect(root.querySelector('.text-red-600')).toBeNull();
    expect(affordanceIn(root)).not.toBeNull();
  });
});
