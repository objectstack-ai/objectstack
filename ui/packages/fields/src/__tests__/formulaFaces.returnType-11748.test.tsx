/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11748 — a formula draws one stored value one way, in the read-only
 * form face (`FormulaField`) and in the table cell (`FormulaCellRenderer`).
 *
 * Before this card the two faces formatted the value each by itself:
 *
 *   - the form face printed a number raw (`200000`, no `returnType`) or with
 *     `toFixed(2)` (`200000.00`, `returnType: 'number'`), in monospace, while
 *     the cell read `200,000` (objectui#11683);
 *   - the cell printed a declared boolean or date raw (`true`, `2026-07-04`),
 *     in monospace, while the form face read `Yes` and `Jul 4`.
 *
 * The rule both faces now read: the declared `returnType`; with none, a JS
 * number is a number and anything else is text. Nothing is inferred from the
 * expression. Each type is then drawn the way the matching field type draws
 * it:
 *
 *   - number: `formatNumberFieldValue`, the call the number cell and
 *     `NumberField`'s read-only branch make (the locale's grouping, the
 *     declared `scale`);
 *   - boolean: the locale's Yes / No word (`common.yes` / `common.no`), the
 *     word `BooleanField`'s read-only branch draws; a value that is not a JS
 *     boolean draws the shared empty affordance, as it does there;
 *   - date: `formatDate`'s DEFAULT face, the face `DateField`'s read-only
 *     branch draws. The cell does NOT take the date cell's relative default
 *     (`Today`, `2 days ago`): that face exists in the cell only, so a formula
 *     drawn with it would read one way in the form and another in the table.
 *
 * Every case renders through a real `I18nProvider` (the UI language, which
 * picks the boolean word) and a `LocalizationProvider` (the display locale,
 * which picks the number and date face), so `zh-CN` is a Chinese session on
 * both channels. `textContent` is the measured property: it is what a copy
 * takes and a screen reader reads.
 */
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { formatDate } from '@object-ui/core';
import {
  BooleanField,
  DateCellRenderer,
  DateField,
  NumberCellRenderer,
  NumberField,
  getCellRenderer,
} from '../index';
import { FormulaField } from '../widgets/FormulaField';

afterEach(() => cleanup());

const noop = () => {};

/** A session per locale: the UI language and the display locale agree. */
const SESSIONS = {
  'en-US': 'en',
  'zh-CN': 'zh',
} as const;
type Locale = keyof typeof SESSIONS;
const LOCALES = Object.keys(SESSIONS) as Locale[];

function renderSession(locale: Locale, node: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: SESSIONS[locale], detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

function textOf(locale: Locale, node: React.ReactElement): string {
  const { container } = renderSession(locale, node);
  const text = container.textContent ?? '';
  cleanup();
  return text;
}

type FormulaExtra = Record<string, unknown>;
const formulaField = (extra: FormulaExtra) => ({ type: 'formula', name: 'computed', ...extra }) as never;

const Cell = getCellRenderer('formula');

/** The read-only form face, as the form renders a formula widget. */
const formFace = (value: unknown, extra: FormulaExtra = {}) => (
  <FormulaField value={value} onChange={noop} field={formulaField(extra)} readonly />
);

/** The table cell face, resolved the way every list surface resolves it. */
const cellFace = (value: unknown, extra: FormulaExtra = {}) => <Cell value={value} field={formulaField(extra)} />;

const FACES = [
  ['form', formFace],
  ['cell', cellFace],
] as const;

/** The shared "No value" affordance. */
const affordance = (root: HTMLElement) => root.querySelector('[data-slot="empty-value"]');

// ── number ─────────────────────────────────────────────────────────────────

describe('number: both faces draw the number face (objectui#11748)', () => {
  /** What a `number` field draws for the same value, per face. */
  const numberCell = (locale: Locale, value: number, extra: FormulaExtra = {}) =>
    textOf(locale, <NumberCellRenderer value={value} field={{ type: 'number', name: 'n', ...extra } as never} />);
  const numberForm = (locale: Locale, value: number, extra: FormulaExtra = {}) =>
    textOf(
      locale,
      <NumberField value={value} onChange={noop} field={{ type: 'number', name: 'n', ...extra } as never} readonly />,
    );

  describe.each(LOCALES)('%s', (locale) => {
    it.each(FACES)("%s — returnType 'number' reads 200,000, not toFixed's 200000.00", (_face, draw) => {
      const text = textOf(locale, draw(200000, { returnType: 'number' }));
      expect(text).toBe('200,000');
      expect(text).not.toBe('200000.00');
    });

    it.each(FACES)('%s — no returnType: a JS number is a number (Budget Remaining)', (_face, draw) => {
      const text = textOf(locale, draw(200000));
      expect(text).toBe('200,000');
      expect(text).not.toBe('200000');
    });

    it.each(FACES)('%s — a declared scale is the width', (_face, draw) => {
      expect(textOf(locale, draw(200000, { returnType: 'number', scale: 2 }))).toBe('200,000.00');
    });

    it.each(FACES)('%s — a fraction keeps its natural precision', (_face, draw) => {
      expect(textOf(locale, draw(1234.5, { returnType: 'number' }))).toBe('1,234.5');
    });

    it("both faces equal the number field's own faces for the same value", () => {
      expect(textOf(locale, formFace(1234.5, { returnType: 'number' }))).toBe(numberForm(locale, 1234.5));
      expect(textOf(locale, cellFace(1234.5, { returnType: 'number' }))).toBe(numberCell(locale, 1234.5));
      expect(textOf(locale, formFace(200000, { scale: 2 }))).toBe(numberForm(locale, 200000, { scale: 2 }));
    });

    it.each(FACES)('%s — the number is not drawn in monospace', (_face, draw) => {
      const { container } = renderSession(locale, draw(200000, { returnType: 'number' }));
      expect(container.querySelector('.font-mono')).toBeNull();
    });
  });

  it.each(FACES)('%s — the display locale reaches the formatter: de-DE groups with a dot', (_face, draw) => {
    const { container } = render(
      <LocalizationProvider value={{ locale: 'de-DE' }}>{draw(200000, { returnType: 'number' })}</LocalizationProvider>,
    );
    expect(container.textContent).toBe('200.000');
  });

  it.each(FACES)("%s — returnType 'number' over a numeric string is read as declared", (_face, draw) => {
    expect(textOf('en-US', draw('200000', { returnType: 'number' }))).toBe('200,000');
  });

  it.each(FACES)("%s — returnType 'number' over whitespace is empty, not a fabricated 0", (_face, draw) => {
    const { container } = renderSession('en-US', draw('   ', { returnType: 'number' }));
    expect(affordance(container)).not.toBeNull();
    expect(container.textContent).not.toContain('0');
  });

  it.each(FACES)('%s — no returnType: a string of digits stays text (nothing says it is a quantity)', (_face, draw) => {
    const { container } = renderSession('en-US', draw('200000'));
    expect(container.textContent).toBe('200000');
    // Text, in the text face's font (objectui#12357), not monospace.
    expect(container.querySelector('.font-mono')).toBeNull();
  });
});

// ── boolean ────────────────────────────────────────────────────────────────

describe("boolean: both faces draw the locale's Yes / No word (objectui#11748)", () => {
  const WORDS: Record<Locale, [string, string]> = {
    'en-US': ['Yes', 'No'],
    'zh-CN': ['是', '否'],
  };

  /** What `BooleanField`'s read-only branch draws for the same value. */
  const booleanForm = (locale: Locale, value: boolean) =>
    textOf(
      locale,
      <BooleanField value={value} onChange={noop} field={{ type: 'boolean', name: 'b' } as never} readonly />,
    );

  describe.each(LOCALES)('%s', (locale) => {
    it.each(FACES)("%s — true and false read the pack's words, not `true` / `false`", (_face, draw) => {
      const [yes, no] = WORDS[locale];
      expect(textOf(locale, draw(true, { returnType: 'boolean' }))).toBe(yes);
      expect(textOf(locale, draw(false, { returnType: 'boolean' }))).toBe(no);
      expect(textOf(locale, draw(true, { returnType: 'boolean' }))).not.toBe('true');
    });

    it.each(FACES)("%s — the word is the boolean field's read-only word", (_face, draw) => {
      expect(textOf(locale, draw(true, { returnType: 'boolean' }))).toBe(booleanForm(locale, true));
      expect(textOf(locale, draw(false, { returnType: 'boolean' }))).toBe(booleanForm(locale, false));
    });

    it.each(FACES)('%s — the word is not drawn in monospace', (_face, draw) => {
      const { container } = renderSession(locale, draw(true, { returnType: 'boolean' }));
      expect(container.querySelector('.font-mono')).toBeNull();
    });
  });

  // Only a JS boolean is a boolean, as on a boolean field (objectui#8593): a
  // truthiness read would print `Yes` for the string `'false'`.
  it.each(FACES)("%s — a value that is not a JS boolean draws the empty affordance", (_face, draw) => {
    for (const value of ['false', 'true', 0, 1]) {
      const { container } = renderSession('en-US', draw(value, { returnType: 'boolean' }));
      expect(affordance(container), `returnType boolean holding ${JSON.stringify(value)}`).not.toBeNull();
      expect(container.textContent).not.toMatch(/Yes|No/);
      cleanup();
    }
  });

  it.each(FACES)("%s — returnType 'text' over a boolean stays text: the declaration wins", (_face, draw) => {
    expect(textOf('en-US', draw(true, { returnType: 'text' }))).toBe('true');
  });
});

// ── date ───────────────────────────────────────────────────────────────────

describe("date: both faces draw the date field's read-only face, formatDate's default (objectui#11748)", () => {
  /** A past year, so the face keeps its year whatever the clock says. */
  const PAST = '2020-07-04';
  const LITERAL: Record<Locale, string> = {
    'en-US': 'Jul 4, 2020',
    'zh-CN': '2020年7月4日',
  };

  /** What `DateField`'s read-only branch draws for the same value. */
  const dateForm = (locale: Locale, value: string) =>
    textOf(locale, <DateField value={value} onChange={noop} field={{ type: 'date', name: 'd' } as never} readonly />);

  describe.each(LOCALES)('%s', (locale) => {
    it.each(FACES)('%s — reads the date face, not the stored ISO text', (_face, draw) => {
      const text = textOf(locale, draw(PAST, { returnType: 'date' }));
      expect(text).toBe(LITERAL[locale]);
      expect(text).toBe(formatDate(PAST, undefined, { locale }));
      expect(text).not.toBe(PAST);
    });

    it.each(FACES)("%s — the face is the date field's read-only face", (_face, draw) => {
      expect(textOf(locale, draw(PAST, { returnType: 'date' }))).toBe(dateForm(locale, PAST));
    });

    it.each(FACES)('%s — the date is not drawn in monospace', (_face, draw) => {
      const { container } = renderSession(locale, draw(PAST, { returnType: 'date' }));
      expect(container.querySelector('.font-mono')).toBeNull();
    });

    it.each(FACES)('%s — an unparsable value draws the empty affordance', (_face, draw) => {
      const { container } = renderSession(locale, draw('not-a-date', { returnType: 'date' }));
      expect(affordance(container)).not.toBeNull();
    });
  });

  /**
   * The choice the card left to this PR, pinned: inside the relative window
   * the date CELL of a `date` field reads `2 days ago`, and a formula's cell
   * does not follow it, because the form face has no relative face to match.
   */
  describe('inside the relative window, the cell keeps the default face', () => {
    const CLOCK = '2026-07-06T12:00:00.000Z';
    const RECENT = '2026-07-04';
    const CURRENT_YEAR: Record<Locale, string> = {
      'en-US': 'Jul 4',
      'zh-CN': '7月4日',
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(CLOCK));
    });
    afterEach(() => vi.useRealTimers());

    it.each(LOCALES)('%s — the formula cell reads the default face, the date cell the relative one', (locale) => {
      const formula = textOf(locale, cellFace(RECENT, { returnType: 'date' }));
      expect(formula).toBe(CURRENT_YEAR[locale]);
      const dateCell = textOf(locale, <DateCellRenderer value={RECENT} field={{ type: 'date', name: 'd' } as never} />);
      // The premise: the date cell's own face differs here.
      expect(dateCell).not.toBe(CURRENT_YEAR[locale]);
      expect(formula).not.toBe(dateCell);
    });
  });
});

// ── text ───────────────────────────────────────────────────────────────────

describe('text: the value as the cell prints it (objectui#11748)', () => {
  it.each(FACES)("%s — returnType 'text' over a number stays text: the declaration wins", (_face, draw) => {
    const { container } = renderSession('en-US', draw(200000, { returnType: 'text' }));
    expect(container.textContent).toBe('200000');
    // Text, in the text face's font (objectui#12357), not monospace.
    expect(container.querySelector('.font-mono')).toBeNull();
  });

  // The form face read `value == null` and printed `String(value)`, so these
  // read a blank span with no accessible name, and `[object Object]`, in the
  // form, beside the cell's affordance and the record's name.
  it.each(FACES)("%s — '' and [] draw the shared empty affordance", (_face, draw) => {
    for (const value of ['', []]) {
      const { container } = renderSession('en-US', draw(value));
      expect(affordance(container), `holding ${JSON.stringify(value)}`).not.toBeNull();
      cleanup();
    }
  });

  it.each(FACES)('%s — an expanded record reads its name, not [object Object]', (_face, draw) => {
    expect(textOf('en-US', draw({ name: 'Ada' }))).toBe('Ada');
  });
});

// ── the equality leg ───────────────────────────────────────────────────────

/**
 * One stored value reads the same in the form and in the cell: every row is a
 * (returnType, value) pair, drawn in both faces in both sessions, and the two
 * texts are compared with each other rather than with a literal, so a change
 * that moves one face alone goes red here.
 */
describe('one stored value, one reading: the form face equals the cell (objectui#11748)', () => {
  const ROWS: Array<[string, unknown, FormulaExtra]> = [
    ['number, no returnType', 200000, {}],
    ['number, declared', 1234.5, { returnType: 'number' }],
    ['number, declared scale', 16, { returnType: 'number', scale: 2 }],
    ['number, declared, numeric string', '42000', { returnType: 'number' }],
    ['boolean true', true, { returnType: 'boolean' }],
    ['boolean false', false, { returnType: 'boolean' }],
    ['date, date-only', '2020-07-04', { returnType: 'date' }],
    ['date, instant', '2020-07-04T09:30:00.000Z', { returnType: 'date' }],
    ['text, declared', 'Adult', { returnType: 'text' }],
    ['text, no returnType', 'Adult', {}],
    ['text, an expanded record', { name: 'Ada' }, {}],
    ['empty string', '', {}],
    ['empty array', [], {}],
  ];

  describe.each(LOCALES)('%s', (locale) => {
    it.each(ROWS)('%s', (_label, value, extra) => {
      const form = textOf(locale, formFace(value, extra));
      const cell = textOf(locale, cellFace(value, extra));
      expect(form).not.toBe('');
      expect(form).toBe(cell);
    });
  });
});
