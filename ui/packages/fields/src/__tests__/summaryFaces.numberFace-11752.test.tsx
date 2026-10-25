/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11752 — a summary (roll-up) field draws one stored value one way,
 * in the read-only form face (`SummaryField`) and in the table cell
 * (`getCellRenderer('summary')`, which is `FormulaCellRenderer`).
 *
 * Before this card the form face formatted the value by itself, by the
 * roll-up's aggregation `function`: `count` with `String(value)`, the other
 * four with `toFixed(2)`. So a `sum` over `15750.5` read `15750.50`, ungrouped
 * and in every locale, while the cell drew the same JS number through the
 * number cell (objectui#11683) and read `15,750.5`.
 *
 * The rule both faces now read, whatever the function:
 *
 *   - the shared emptiness floor (`isEmptyValue`) on the coerced value;
 *   - a JS number through `formatNumberFieldValue`, the call every number face
 *     makes: the display locale's grouping, the width a declared `scale`
 *     gives, the value's natural precision when none is declared. A `count`
 *     is a whole number, so it reads whole;
 *   - anything else as the text the cell prints.
 *
 * The pins run per aggregation function x face x locale, then compare each
 * face with the `number` field's own face for the same value, and end with an
 * equality leg that compares the two summary faces with each other rather than
 * with a literal, so a change that moves one face alone goes red.
 *
 * Every case renders through a real `I18nProvider` and `LocalizationProvider`,
 * so `zh-CN` is a Chinese session on both channels. `textContent` is the
 * measured property: it is what a copy takes and a screen reader reads.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { NumberCellRenderer, NumberField, getCellRenderer } from '../index';
import { SummaryField } from '../widgets/SummaryField';

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

const FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;
type Fn = (typeof FUNCTIONS)[number];
type Extra = Record<string, unknown>;

/** A roll-up shaped like the showcase's `expense_report.total_amount`. */
const summaryField = (fn: Fn, extra: Extra = {}) =>
  ({
    type: 'summary',
    name: 'total_amount',
    summaryOperations: { object: 'showcase_expense_line', field: 'amount', function: fn },
    ...extra,
  }) as never;

const Cell = getCellRenderer('summary');

/** The read-only form face, as a record form renders a summary widget. */
const formFace = (fn: Fn, value: unknown, extra: Extra = {}) => (
  <SummaryField value={value} onChange={noop} field={summaryField(fn, extra)} readonly />
);

/** The table cell face, resolved the way every list surface resolves it. */
const cellFace = (fn: Fn, value: unknown, extra: Extra = {}) => (
  <Cell value={value} field={summaryField(fn, extra)} />
);

const FACES = [
  ['form', formFace],
  ['cell', cellFace],
] as const;

/** The shared "No value" affordance. */
const affordance = (root: HTMLElement) => root.querySelector('[data-slot="empty-value"]');

/** What a `number` field draws for the same value, per face. */
const numberCell = (locale: Locale, value: number, extra: Extra = {}) =>
  textOf(locale, <NumberCellRenderer value={value} field={{ type: 'number', name: 'n', ...extra } as never} />);
const numberForm = (locale: Locale, value: number, extra: Extra = {}) =>
  textOf(locale, <NumberField value={value} onChange={noop} field={{ type: 'number', name: 'n', ...extra } as never} readonly />);

// ── per function x face x locale ──────────────────────────────────────────

/** The grouped reading of `15750.5`; both sessions group with a comma. */
const SUM_TEXT: Record<Locale, string> = { 'en-US': '15,750.5', 'zh-CN': '15,750.5' };
/** The grouped reading of a count of `12000`. */
const COUNT_TEXT: Record<Locale, string> = { 'en-US': '12,000', 'zh-CN': '12,000' };

describe('every aggregation function reads the number face, in both faces (objectui#11752)', () => {
  describe.each(LOCALES)('%s', (locale) => {
    describe.each(['sum', 'avg', 'min', 'max'] as const)('%s', (fn) => {
      it.each(FACES)("%s — 15750.5 reads grouped at its own precision, not toFixed's 15750.50", (_face, draw) => {
        const text = textOf(locale, draw(fn, 15750.5));
        expect(text).toBe(SUM_TEXT[locale]);
        expect(text).not.toBe('15750.50');
      });

      it.each(FACES)('%s — a declared scale is the width', (_face, draw) => {
        expect(textOf(locale, draw(fn, 15750.5, { scale: 2 }))).toBe(`${SUM_TEXT[locale]}0`);
      });
    });

    describe('count', () => {
      it.each(FACES)('%s — a count stays whole, and groups like any number', (_face, draw) => {
        const text = textOf(locale, draw('count', 12000));
        expect(text).toBe(COUNT_TEXT[locale]);
        expect(text).not.toMatch(/[.]\d/);
      });

      it.each(FACES)('%s — a small count reads as it is', (_face, draw) => {
        expect(textOf(locale, draw('count', 42))).toBe('42');
      });
    });

    describe.each(FUNCTIONS)('%s', (fn) => {
      // `count` and `sum` take `0` over an empty child set (objectstack's
      // `summaryEmptySetValue`): a stored zero is a value, not an empty one.
      it.each(FACES)('%s — 0 reads 0, not 0.00 and not the empty affordance', (_face, draw) => {
        const { container } = renderSession(locale, draw(fn, 0));
        expect(container.textContent).toBe('0');
        expect(affordance(container)).toBeNull();
      });

      it.each(FACES)('%s — the number is not drawn in monospace', (_face, draw) => {
        const { container } = renderSession(locale, draw(fn, 15750.5));
        expect(container.querySelector('.font-mono')).toBeNull();
      });
    });
  });

  it.each(FACES)('%s — the display locale reaches the formatter: de-DE groups with a dot', (_face, draw) => {
    const { container } = render(
      <LocalizationProvider value={{ locale: 'de-DE' }}>{draw('sum', 15750.5)}</LocalizationProvider>,
    );
    expect(container.textContent).toBe('15.750,5');
  });
});

// ── the number field's own faces ──────────────────────────────────────────

describe("each summary face is the `number` field's face for the same value (objectui#11752)", () => {
  const VALUES: Array<[string, number, Extra]> = [
    ['a fraction', 15750.5, {}],
    ['a whole count', 12000, {}],
    ['an average with no declared width', 10 / 3, {}],
    ['a declared scale', 15750.5, { scale: 2 }],
    ['a negative minimum', -42.25, {}],
  ];

  describe.each(LOCALES)('%s', (locale) => {
    it.each(VALUES)('%s', (_label, value, extra) => {
      for (const fn of FUNCTIONS) {
        expect(textOf(locale, formFace(fn, value, extra)), `form, ${fn}`).toBe(numberForm(locale, value, extra));
        expect(textOf(locale, cellFace(fn, value, extra)), `cell, ${fn}`).toBe(numberCell(locale, value, extra));
      }
    });
  });
});

// ── empty and non-number values ───────────────────────────────────────────

describe('empty and non-number values read the cell text (objectui#11752)', () => {
  // `min` / `max` / `avg` stay `null` over an empty child set. The form face
  // read `value == null`, so `''` and `[]` drew a blank span with no
  // accessible name here and the shared affordance in the table.
  it.each(FACES)("%s — null, undefined, '' and [] draw the shared empty affordance", (_face, draw) => {
    for (const fn of FUNCTIONS) {
      for (const value of [null, undefined, '', []]) {
        const { container } = renderSession('en-US', draw(fn, value));
        expect(affordance(container), `${fn} holding ${JSON.stringify(value)}`).not.toBeNull();
        cleanup();
      }
    }
  });

  // A summary declares no `returnType`, so only a JS number is a number: a
  // string of digits stays the text the cell prints.
  it.each(FACES)('%s — a string of digits stays text', (_face, draw) => {
    expect(textOf('en-US', draw('sum', '15750.5'))).toBe('15750.5');
  });
});

// ── the equality leg ──────────────────────────────────────────────────────

/**
 * One stored value reads the same in the form and in the cell: every row is
 * an (aggregation function, value, declaration) triple, drawn in both faces
 * in both sessions, and the two texts are compared with each other.
 */
describe('one stored value, one reading: the form face equals the cell (objectui#11752)', () => {
  const ROWS: Array<[string, Fn, unknown, Extra]> = [
    ['count, small', 'count', 42, {}],
    ['count, large', 'count', 12000, {}],
    ['count, empty child set', 'count', 0, {}],
    ['sum, the card value', 'sum', 15750.5, {}],
    ['sum, empty child set', 'sum', 0, {}],
    ['sum, declared scale', 'sum', 15750.5, { scale: 2 }],
    ['sum, declared ungrouped', 'sum', 15750.5, { useGrouping: false }],
    ['avg, a repeating fraction', 'avg', 10 / 3, {}],
    ['avg, declared scale', 'avg', 10 / 3, { scale: 2 }],
    ['min, negative', 'min', -42.25, {}],
    ['max, large', 'max', 1234567.891, {}],
    ['max, numeric string', 'max', '15750.5', {}],
  ];

  describe.each(LOCALES)('%s', (locale) => {
    it.each(ROWS)('%s', (_label, fn, value, extra) => {
      const form = textOf(locale, formFace(fn, value, extra));
      const cell = textOf(locale, cellFace(fn, value, extra));
      expect(form).not.toBe('');
      expect(form).toBe(cell);
    });
  });
});
