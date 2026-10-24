/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11683 — two cells whose TEXT was wrong while their pixels looked
 * nearly right.
 *
 * The 2026-10-06 showcase dogfood (objectui#11672, items 10 and 16) read:
 *
 *   - Projects' Budget Remaining, a `formula` with no `returnType`, rendered
 *     `200000`, raw and in monospace, beside a formatted currency column.
 *   - A `datetime` cell rendered `2026/10/6上午1:42`: the gap between the date
 *     and the time was an `ml-2` margin, not text, so a copy, a screen reader
 *     and `textContent` got the two halves run together.
 *
 * Every case renders through a real `I18nProvider` and sets the tag on the
 * TENANT locale channel, the first one `useDisplayLocale()` reads, so the
 * locale under test is the exact tag named here.
 *
 * `textContent` is the measured property throughout: it is the text a copy
 * takes and a screen reader reads, which is what the card is about.
 *
 * en-US and zh-CN group thousands the same way, so a formatter that ignored
 * the locale would pass both. de-DE rides beside them for that reason only.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import {
  DateTimeCellRenderer,
  NumberCellRenderer,
  formatDateTime,
  formatDateTimeCompactParts,
  getCellRenderer,
} from '../index';

afterEach(() => cleanup());

const LOCALES = ['en-US', 'zh-CN'] as const;

function renderSession(locale: string, node: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

function textOf(locale: string, node: React.ReactElement): string {
  const { container } = renderSession(locale, node);
  const text = container.textContent ?? '';
  cleanup();
  return text;
}

// ── the datetime cell ──────────────────────────────────────────────────────

/** The card's instant: `2026/10/6上午1:42` in zh-CN (the suite runs in UTC). */
const INSTANT = '2026-10-06T01:42:00.000Z';

const dateTimeCell = (format?: string) => (
  <DateTimeCellRenderer
    value={INSTANT}
    field={{ type: 'datetime', name: 'created_at', ...(format === undefined ? {} : { format }) } as never}
  />
);

describe('the datetime cell carries a real separator in its text (objectui#11683)', () => {
  const LITERAL: Record<(typeof LOCALES)[number], string> = {
    'en-US': '10/6/2026 1:42 am',
    'zh-CN': '2026/10/6 上午1:42',
  };

  it.each(LOCALES)('%s — the copied text is the shared compact face, separator included', (locale) => {
    const text = textOf(locale, dateTimeCell());
    // By construction: the string every non-cell caller of the compact face gets.
    expect(text).toBe(formatDateTime(INSTANT, { style: 'compact', locale }));
    // And by literal, so a change that moved both sides together cannot pass.
    expect(text).toBe(LITERAL[locale]);
  });

  it.each(LOCALES)('%s — the run-together text the card read is gone', (locale) => {
    const parts = formatDateTimeCompactParts(INSTANT, { locale })!;
    expect(textOf(locale, dateTimeCell())).not.toBe(`${parts.date}${parts.time}`);
  });

  it.each(LOCALES)('%s — `format: short` reaches the same face, separator included', (locale) => {
    expect(textOf(locale, dateTimeCell('short'))).toBe(LITERAL[locale]);
  });

  it.each(LOCALES)('%s — the time half keeps its muted colour', (locale) => {
    const { container } = renderSession(locale, dateTimeCell());
    const halves = container.querySelectorAll('span > span');
    expect(halves).toHaveLength(2);
    const parts = formatDateTimeCompactParts(INSTANT, { locale })!;
    expect(halves[0].textContent).toBe(parts.date);
    expect(halves[1].textContent).toBe(parts.time);
    expect(halves[1].className).toMatch(/text-muted-foreground/);
  });
});

// ── the formula cell ───────────────────────────────────────────────────────

const Formula = getCellRenderer('formula');
const Summary = getCellRenderer('summary');

const formulaCell = (value: unknown, extra: Record<string, unknown> = {}) => (
  <Formula value={value} field={{ type: 'formula', name: 'budget_remaining', ...extra } as never} />
);

/** What the `number` cell draws for the same value, in the same session. */
const numberFace = (locale: string, value: number, extra: Record<string, unknown> = {}) =>
  textOf(locale, <NumberCellRenderer value={value} field={{ type: 'number', name: 'n', ...extra } as never} />);

describe('a formula with no returnType formats a numeric result as a number (objectui#11683)', () => {
  const LITERAL: Record<(typeof LOCALES)[number], string> = {
    'en-US': '200,000',
    'zh-CN': '200,000',
  };

  it.each(LOCALES)('%s — Budget Remaining reads 200,000, the number face', (locale) => {
    const text = textOf(locale, formulaCell(200000));
    expect(text).toBe(LITERAL[locale]);
    expect(text).toBe(numberFace(locale, 200000));
    expect(text).not.toBe('200000');
  });

  it.each(LOCALES)('%s — the number is not drawn in monospace', (locale) => {
    const { container } = renderSession(locale, formulaCell(200000));
    expect(container.querySelector('.font-mono')).toBeNull();
    expect(container.querySelector('.tabular-nums')).not.toBeNull();
  });

  it('the locale reaches the formatter: de-DE groups with a dot', () => {
    expect(textOf('de-DE', formulaCell(200000))).toBe('200.000');
  });

  it.each(LOCALES)('%s — a fraction keeps its natural precision, as on a number field', (locale) => {
    expect(textOf(locale, formulaCell(1234.5))).toBe(numberFace(locale, 1234.5));
    expect(textOf('en-US', formulaCell(1234.5))).toBe('1,234.5');
  });

  it.each(LOCALES)('%s — a summary roll-up, registered to the same renderer, is a number too', (locale) => {
    const text = textOf(locale, <Summary value={8900} field={{ type: 'summary', name: 'total' } as never} />);
    expect(text).toBe(numberFace(locale, 8900));
    expect(text).toBe('8,900');
  });

  it.each(LOCALES)('%s — a string of digits stays text: only a JS number is read as a number', (locale) => {
    const { container } = renderSession(locale, formulaCell('200000'));
    expect(container.textContent).toBe('200000');
    // Drawn by the text face, not the number face; the text face is the text
    // cell's own, no longer monospace (objectui#12357).
    expect(container.querySelector('.tabular-nums')).toBeNull();
    expect(container.querySelector('.font-mono')).toBeNull();
  });
});

describe('a declared returnType is read as declared (objectui#11683)', () => {
  it.each(LOCALES)("%s — returnType 'number' is the number face", (locale) => {
    expect(textOf(locale, formulaCell(200000, { returnType: 'number' }))).toBe('200,000');
  });

  it.each(LOCALES)("%s — returnType 'number' reads a numeric string as a number", (locale) => {
    expect(textOf(locale, formulaCell('200000', { returnType: 'number' }))).toBe('200,000');
  });

  it.each(LOCALES)('%s — a declared scale is the width (the spec applies scale to a formula)', (locale) => {
    expect(textOf(locale, formulaCell(200000, { scale: 2 }))).toBe(numberFace(locale, 200000, { scale: 2 }));
    expect(textOf(locale, formulaCell(200000, { scale: 2 }))).toBe('200,000.00');
  });

  it.each(LOCALES)("%s — returnType 'text' over a number stays text: the declaration wins", (locale) => {
    const { container } = renderSession(locale, formulaCell(200000, { returnType: 'text' }));
    expect(container.textContent).toBe('200000');
    // Drawn by the text face, not the number face; the text face is the text
    // cell's own, no longer monospace (objectui#12357).
    expect(container.querySelector('.tabular-nums')).toBeNull();
    expect(container.querySelector('.font-mono')).toBeNull();
  });
});
