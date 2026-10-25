/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8853 — ONE authored `field.format`, one meaning, across the two
 * neighbouring date cell renderers.
 *
 * ## What was measured, before anything was changed
 *
 * Driven end to end through a REAL `ObjectGrid` column (not inferred from a
 * source read): one object with a `date` field and a `datetime` field, BOTH
 * authored `format: 'relative'`, one row, one instant
 * (`2026-09-11T09:30:00.000Z`), clock pinned to `2026-09-09T12:00:00.000Z`,
 * `en-US`. The grid's own body cells came back as
 *
 *   ["1Open", "Row One", "In 2 days", "Sep 11, 2026, 09:30 AM"]
 *                         ^ date       ^ datetime, same key, dropped
 *
 * and after the call-site mapping, as
 *
 *   ["1Open", "Row One", "In 2 days", "In 2 days"]
 *
 * The defect's whole signature is a SILENT drop — the runtime accepts the key,
 * parses it, drops it, and renders something that still looks like a
 * legitimate date — so a green suite proves nothing by itself. Every case
 * below therefore asserts a rendered FACE, with controls that say what the
 * probe would have shown had it been fooled.
 *
 * ## The controls, and why each one is here
 *
 * - **Positive control** — the `date` cell, in the SAME run, on the SAME
 *   instant. It already honoured `'relative'`, so it is what "honoured" looks
 *   like; without it, a datetime assertion could be measuring a broken clock
 *   or a dead locale channel rather than the vocabulary.
 * - **Negative control** — an OUT-OF-WINDOW value. `formatRelativeDate` falls
 *   back to the absolute form beyond ±7 days, so out there `format:
 *   'relative'` and no format at all render IDENTICALLY on the fully working
 *   `date` cell. That is the trap objectui#8352's card recorded: a probe built
 *   on an out-of-window value reports "identical" on a working path and on a
 *   broken one alike. The pin below asserts that collapse explicitly, so the
 *   in-window choice everywhere else is a measured decision rather than luck.
 *
 * ## Directions
 *
 * Reverting the call-site mapping in `DateTimeCellRenderer` turns the repro,
 * the `'short'` face and the out-of-window datetime face RED, and leaves every
 * control and regression pin GREEN — the controls measure surfaces this change
 * does not touch, which is exactly why they can vouch for the run. Widening
 * `formatDateTime`'s published signature instead (the refused route) turns the
 * "published signature untouched" pins RED. Adding a refusal for a spelling
 * that renders today turns the regression pins RED.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DateCellRenderer, DateTimeCellRenderer, formatDateTime, formatDateTimeCompactParts } from '../index';

/** The pinned clock, and two values chosen on either side of the ±7-day window. */
const CLOCK = '2026-09-09T12:00:00.000Z';
/** +2 days: inside the window, so the relative face is a PHRASE and discriminates. */
const IN_WINDOW = '2026-09-11T09:30:00.000Z';
/** +11 days: outside it, where the relative face collapses onto the absolute one. */
const OUT_OF_WINDOW = '2026-09-20T09:30:00.000Z';

/** `en-US` plus one NON-US locale, the same pairing the #7443 pins use. */
const LOCALES = ['en-US', 'zh', 'de-DE'];

/**
 * Same session harness as `datetime-compact-style-7443.test.tsx`: the tag is
 * set as the TENANT locale because that is the channel objectui#4468 made
 * every date branch read, and `persistLanguage={false}` keeps each case on its
 * own language instead of inheriting the previous one's.
 */
function renderSession(locale: string, node: React.ReactElement) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

/** Render one cell at the pinned clock and return its text, nothing retained. */
function faceOf(node: React.ReactElement, locale = 'en-US'): string {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(CLOCK));
  try {
    const { container } = renderSession(locale, node);
    return container.textContent ?? '';
  } finally {
    cleanup();
    vi.useRealTimers();
  }
}

const dateCell = (value: string, format?: string) => (
  <DateCellRenderer
    value={value}
    field={{ type: 'date', name: 'follow_up_on', ...(format === undefined ? {} : { format }) } as any}
  />
);

const dateTimeCell = (value: string, format?: string) => (
  <DateTimeCellRenderer
    value={value}
    field={{ type: 'datetime', name: 'follow_up_at', ...(format === undefined ? {} : { format }) } as any}
  />
);

/**
 * The compact face as the cell paints it — two spans with a text space between
 * them, the compact face's own joiner (objectui#11683; before it the gap was a
 * margin alone, so the text ran the halves together).
 */
function compactCellText(value: string, locale: string): string {
  const parts = formatDateTimeCompactParts(value, { locale })!;
  return `${parts.date} ${parts.time}`;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('THE REPRO — `format: relative` means the same thing in both cells (#8853)', () => {
  it('a datetime cell honours `relative`, and renders the phrase its date sibling renders', () => {
    const dateFace = faceOf(dateCell(IN_WINDOW, 'relative'));
    const dateTimeFace = faceOf(dateTimeCell(IN_WINDOW, 'relative'));

    // The anchor, so a redesign that moved both sides together cannot pass.
    expect(dateFace).toBe('In 2 days');
    expect(dateTimeFace).toBe('In 2 days');
    // The claim itself: ONE authored key, ONE meaning, across the two cells.
    expect(dateTimeFace).toBe(dateFace);
    // And what it used to be, named — not merely "something else".
    expect(dateTimeFace).not.toBe('Sep 11, 2026, 09:30 AM');
  });

  it.each(LOCALES)('%s — the two cells agree in a non-US locale too', (locale) => {
    expect(faceOf(dateTimeCell(IN_WINDOW, 'relative'), locale)).toBe(
      faceOf(dateCell(IN_WINDOW, 'relative'), locale),
    );
  });

  it('`short` reaches the dense face of THIS type — the time of day is kept', () => {
    // objectui#8352 mapped `'short'` to the arm's own narrow face: `formatDate`'s
    // `'short'` for a date, the compact datetime face for a datetime. Here that
    // face is the one this cell already paints, so a measure tile and a grid
    // cell showing the same instant agree.
    expect(faceOf(dateTimeCell(IN_WINDOW, 'short'))).toBe(compactCellText(IN_WINDOW, 'en-US'));
    expect(faceOf(dateTimeCell(IN_WINDOW, 'short'))).toBe('9/11/2026 9:30 am');
    expect(faceOf(dateTimeCell(IN_WINDOW, 'short'))).not.toBe('Sep 11, 2026, 09:30 AM');
  });

  it('the relative face is painted in ONE span, not the compact two', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CLOCK));
    const { container } = renderSession('en-US', dateTimeCell(IN_WINDOW, 'relative'));
    expect(container.querySelectorAll('span > span')).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe('POSITIVE CONTROL — the date cell, unchanged, in the same run', () => {
  it('still honours `relative` and `short`, and still defaults to relative', () => {
    expect(faceOf(dateCell(IN_WINDOW, 'relative'))).toBe('In 2 days');
    expect(faceOf(dateCell(IN_WINDOW, 'short'))).toBe("Sep 11, '26");
    expect(faceOf(dateCell(IN_WINDOW, undefined))).toBe('In 2 days');
  });

  it("`compact` stays inert on a date cell — the vocabulary was widened on ONE side", () => {
    // The reverse asymmetry the card names. Honouring it here would be a
    // second, unruled change: `'compact'` falls to the date arm's default
    // face, exactly as objectui#8352 declared for the measure path.
    expect(faceOf(dateCell(IN_WINDOW, 'compact'))).toBe('Sep 11');
    expect(faceOf(dateCell(IN_WINDOW, 'compact'))).toBe(faceOf(dateCell(IN_WINDOW, 'no-such-face')));
  });
});

describe('NEGATIVE CONTROL — out of the ±7-day window the probe cannot discriminate', () => {
  it('on the WORKING date cell, `relative` and no format render identically out there', () => {
    // This is the trap. Had the cases above used this value, "identical"
    // would have been the answer on a working path and a broken one alike.
    const authored = faceOf(dateCell(OUT_OF_WINDOW, 'relative'));
    const absent = faceOf(dateCell(OUT_OF_WINDOW, undefined));
    expect(authored).toBe(absent);
    expect(authored).toBe('Sep 20');
  });

  it('the in-window value DOES discriminate on that same cell — the probe has teeth', () => {
    expect(faceOf(dateCell(IN_WINDOW, 'relative'))).not.toBe('Sep 11');
  });

  it('an out-of-window datetime renders the absolute DATE face — the declared cost', () => {
    // ⚠️ The time of day is gone. `formatRelativeDate`'s out-of-window branch
    // renders through `toLocaleDateString` and has no time component to add;
    // that window belongs to that function and is INHERITED here rather than
    // re-decided at this call site (objectui#4576). `'relative'` is day-granular
    // by construction, so its degraded form is a day face — and nothing was
    // taken from a working feature, since this cell ignored the word outright
    // before. Pinned so the cost cannot drift silently in either direction.
    expect(faceOf(dateTimeCell(OUT_OF_WINDOW, 'relative'))).toBe('Sep 20');
    expect(faceOf(dateTimeCell(OUT_OF_WINDOW, 'relative'))).toBe(
      faceOf(dateCell(OUT_OF_WINDOW, 'relative')),
    );
  });
});

describe('REGRESSION — every datetime cell that rendered before renders the same', () => {
  it.each(LOCALES)('%s — no format is still the compact face', (locale) => {
    expect(faceOf(dateTimeCell(IN_WINDOW, undefined), locale)).toBe(
      compactCellText(IN_WINDOW, locale),
    );
  });

  it('an explicit `compact` is still the compact face', () => {
    expect(faceOf(dateTimeCell(IN_WINDOW, 'compact'))).toBe(compactCellText(IN_WINDOW, 'en-US'));
  });

  it('an authored EMPTY string is still the compact face, not the verbose one', () => {
    // `||`, not `??` — the spelling objectui#7443 chose so an authored empty
    // string stays on the compact face. The mapping above must not disturb it.
    expect(faceOf(dateTimeCell(IN_WINDOW, ''))).toBe(compactCellText(IN_WINDOW, 'en-US'));
  });

  it('an unrecognised spelling still falls to the verbose default — no refusal was added', () => {
    // ⛔ Rejecting a currently-accepted spelling would be a breaking narrowing
    // of a published metadata surface. It renders, as it always did.
    expect(faceOf(dateTimeCell(IN_WINDOW, 'default'))).toBe('Sep 11, 2026, 09:30 AM');
    expect(faceOf(dateTimeCell(IN_WINDOW, 'YYYY-MM-DD'))).toBe('Sep 11, 2026, 09:30 AM');
  });

  it('an absent field is still tolerated, on the compact face', () => {
    expect(faceOf(<DateTimeCellRenderer value={IN_WINDOW} field={undefined as any} />)).toBe(
      compactCellText(IN_WINDOW, 'en-US'),
    );
  });
});

describe('the PUBLISHED signature was not moved — the mapping lives at the call site', () => {
  it('formatDateTime still declares exactly two parameters', () => {
    // `(value, options?)` is 2; the refused `(value, style?, options?)` is 3.
    expect(formatDateTime.length).toBe(2);
  });

  it("formatDateTime's own vocabulary is untouched: it still ignores `relative` and `short`", () => {
    // The function was NOT widened. It answers the verbose face for both
    // words, and the CELL is what maps them — which is why this file and the
    // function's own pins can disagree about `'relative'` without either being
    // wrong.
    const verbose = formatDateTime(IN_WINDOW, { locale: 'en-US' });
    expect(formatDateTime(IN_WINDOW, { locale: 'en-US', style: 'relative' })).toBe(verbose);
    expect(formatDateTime(IN_WINDOW, { locale: 'en-US', style: 'short' })).toBe(verbose);
    expect(verbose).toBe('Sep 11, 2026, 09:30 AM');
  });
});
