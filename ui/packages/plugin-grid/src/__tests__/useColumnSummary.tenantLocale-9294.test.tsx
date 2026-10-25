/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9294 — every arm of the grid column-summary footer formats in the
 * TENANT's locale, not the MACHINE's.
 *
 * `formatSummaryLabel` handed `Intl` an `undefined` locale at seven call
 * sites. `undefined` does not mean "no opinion" — it means the locale of the
 * machine the code happens to be running on, which is neither of this
 * renderer's two locale channels. `useDisplayLocale`'s own doc comment names
 * this as the one thing a caller must not do, and every date, number and
 * currency renderer goes through that hook for exactly that reason.
 *
 * The harm is sharper than the percent-sign move its parent card repaired.
 * A sign changing sides is visible; a decimal separator changing is not:
 *
 *                     currency      plain
 *   de-DE (correct)   1.235 EUR     1.234,5
 *   machine(en-US)    EUR1,235      1,234.5
 *
 * A `de-DE` tenant reads `1,234.5` and parses it by German convention as
 * 1.2345 — three orders of magnitude out, on a CURRENCY TOTAL, and legible as
 * a perfectly ordinary German number the whole way.
 *
 * ── What this file measures: READ THE ROWS, NOT THE CELLS ────────────────
 * The defect is not "this cell renders the wrong bytes" — it is "this cell
 * does not move at all when the tenant locale moves". So the headline table
 * below asserts MOVEMENT: for every arm, the `de-DE` and `tr-TR` readings must
 * differ from the `en` one. Under the defect all three are the machine's
 * `en-US` and the row is flat; a per-cell snapshot suite would pass happily
 * while measuring nothing at all about the locale channel.
 *
 * ⭐ Movement alone is blind to a repair that threaded SOME varying locale
 * rather than the tenant's. That is what the agreement table is for: its
 * right-hand side is computed from the tenant tag under test in the same run,
 * so it can only pass while the tenant channel is the live one. The two tables
 * are a pair — neither is sufficient alone.
 *
 * ── The lit control ─────────────────────────────────────────────────────
 * ⭐ The `colType === 'percent'` arm is ALREADY fixed (objectui#9269, landed
 * as PR objectui#9293) and is deliberately untouched by this card. It is
 * therefore the control that proves the fixture really moves the locale: it
 * moves on the unmodified base tree. **If the control row is flat, the wrapper
 * is inert and every other row in this file is NOT MEASURED — not a negative
 * answer.** Its case runs first and says so in its own name.
 *
 * ── Which rows can actually fire ────────────────────────────────────────
 * ⛔ The `en` rows are NOT controls. This measuring container's machine locale
 * is `en-US`, and `en` and `en-US` were measured to render every fixture in
 * this file identically, so an `en` row reads the same whether the tenant tag
 * arrived or not. They are overshoot detectors. The rows that MOVE — and
 * therefore the ones that measure the repair — are `de-DE` and `tr-TR`, which
 * both swap the grouping and decimal marks against `en`, and which disagree
 * with each other on where a currency symbol sits.
 *
 * ── Directions, predicted in writing BEFORE the first run ───────────────
 *   the lit control (percent column)   GREEN on the base tree — it is already fixed
 *   movement, all seven other sites    RED   on the base tree — flat rows
 *   agreement @ en, every site         GREEN on the base tree — machine is en-US
 *   agreement @ de-DE / tr-TR          RED   on the base tree
 *   tr-TR currency, absolute bytes     RED   on the base tree
 *   the prefix probes                  GREEN on the base tree
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderHook } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { formatPercent } from '@object-ui/fields';
import { useColumnSummary } from '../useColumnSummary';

/**
 * The UI language is held at `en` while the TENANT locale moves — the real
 * precedence `useDisplayLocale` implements (tenant locale outranks UI
 * language). Holding the language still keeps the footer's PREFIX in English,
 * so a failure in the number cannot be confused with a bundle move.
 *
 * ⚠️ No `currency` is supplied to `LocalizationProvider`, deliberately: the
 * no-currency currency branch below needs `resolveFieldCurrency` to come back
 * empty, and a tenant default would backstop it.
 */
function wrapper(locale: string) {
  return ({ children }: { children: React.ReactNode }) => (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocalizationProvider value={{ locale }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/**
 * The footer label the hook itself produces, for one column of one fixture.
 * `fieldDef` is the column's FIELD definition, handed over as `fieldMetadata`:
 * objectui#11588 retired the column-level read of `currency` and `scale`.
 */
function summaryLabel(
  locale: string,
  column: Record<string, unknown>,
  rows: unknown[],
  fieldDef?: Record<string, unknown>,
): string {
  const cols: any[] = [column];
  const meta = fieldDef ? { [column.field as string]: fieldDef } : undefined;
  const { result } = renderHook(() => useColumnSummary(cols, rows as any[], meta as never), {
    wrapper: wrapper(locale),
  });
  return result.current.summaries.get(column.field as string)?.label ?? '';
}

/** Amount chosen so that BOTH the grouping mark and the decimal mark are exercised. */
const AMOUNT = 1234.5;

/**
 * A cardinality has to cross the thousands boundary before any locale can
 * disagree about it, so the count arm needs four digits of rows. Built once.
 */
const MANY_ROWS = Array.from({ length: 1234 }, () => ({ v: 'x' }));

/** Three rows, two filled — `percent_filled` lands on a repeating fraction. */
const TWO_OF_THREE = [{ v: 'x' }, { v: 'y' }, { v: null }];
const PERCENT_OF_ROWS = (2 / 3) * 100;

/**
 * The arms, one entry per locale-less call site the card names.
 *
 * `declared` is the right-hand side of the agreement table: the rendering the
 * tenant tag itself produces, computed in the same run. It restates the
 * formatting OPTIONS each site passes (which stay exactly where they were —
 * this card is about which locale, not about which widths or which formatter),
 * and nothing else.
 */
interface Arm {
  site: string;
  prefix: string;
  column: Record<string, unknown>;
  /** The field's own hints (`currency`, `scale`), read off the field only. */
  fieldDef?: Record<string, unknown>;
  rows: unknown[];
  declared: (locale: string) => string;
}

const ARMS: Arm[] = [
  {
    site: 'currency, explicit code',
    prefix: 'Sum: ',
    column: { field: 'amount', summary: 'sum', type: 'currency' },
    fieldDef: { type: 'currency', currency: 'EUR', scale: 2 },
    rows: [{ amount: AMOUNT }],
    declared: (locale) =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(AMOUNT),
  },
  {
    site: 'currency, no code resolved',
    prefix: 'Sum: ',
    column: { field: 'amount', summary: 'sum', type: 'currency' },
    fieldDef: { type: 'currency', scale: 2 },
    rows: [{ amount: AMOUNT }],
    declared: (locale) =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(AMOUNT),
  },
  {
    // `EU` is not a well-formed ISO 4217 code, so the `Intl.NumberFormat`
    // constructor throws and the arm falls through to its own catch.
    site: 'currency, constructor threw',
    prefix: 'Sum: ',
    column: { field: 'amount', summary: 'sum', type: 'currency' },
    fieldDef: { type: 'currency', currency: 'EU', scale: 2 },
    rows: [{ amount: AMOUNT }],
    declared: (locale) => AMOUNT.toLocaleString(locale),
  },
  {
    site: 'avg',
    prefix: 'Avg: ',
    column: { field: 'n', summary: 'avg' },
    rows: [{ n: 1234 }, { n: 1235 }],
    declared: (locale) => AMOUNT.toLocaleString(locale, { maximumFractionDigits: 2 }),
  },
  {
    site: 'numeric default',
    prefix: 'Sum: ',
    column: { field: 'n', summary: 'sum' },
    rows: [{ n: AMOUNT }],
    declared: (locale) => AMOUNT.toLocaleString(locale),
  },
  {
    site: 'percent of rows',
    prefix: 'Filled: ',
    column: { field: 'v', summary: 'percent_filled' },
    rows: TWO_OF_THREE,
    // The literal sign is #4589's surface, not this card's — only the NUMBER
    // in front of it is claimed here.
    declared: (locale) =>
      `${PERCENT_OF_ROWS.toLocaleString(locale, { maximumFractionDigits: 1 })}%`,
  },
  {
    site: 'non-numeric cardinality',
    prefix: 'Count: ',
    column: { field: 'v', summary: 'count' },
    rows: MANY_ROWS,
    declared: (locale) => MANY_ROWS.length.toLocaleString(locale),
  },
];

/**
 * ⭐ The lit control — the one arm this card must NOT touch.
 *
 * It moves on the base tree because objectui#9269 already repaired it, which
 * is precisely what qualifies it: a control that cannot fire proves nothing.
 */
const CONTROL: Arm = {
  site: 'percent COLUMN (objectui#9269, the lit control)',
  prefix: 'Sum: ',
  column: { field: 'rate', summary: 'sum', type: 'percent' },
  rows: [{ rate: 0.25 }],
  declared: (locale) => formatPercent(0.25, 'fraction', 0, locale),
};

describe('the grid summary footer formats in the tenant locale, not the machine (objectui#9294)', () => {
  describe('the control, which has to fire before anything else here is a reading', () => {
    it.each(['de-DE', 'tr-TR'])(
      'the already-repaired percent column moves under %s — if it does not, the fixture is inert and every other case in this file is NOT MEASURED',
      (locale) => {
        expect(summaryLabel(locale, CONTROL.column, CONTROL.rows)).not.toBe(
          summaryLabel('en', CONTROL.column, CONTROL.rows),
        );
      },
    );

    it.each(['en', 'de-DE', 'tr-TR'])(
      'and it agrees with the declared percent source at %s',
      (locale) => {
        expect(summaryLabel(locale, CONTROL.column, CONTROL.rows)).toBe(
          `${CONTROL.prefix}${CONTROL.declared(locale)}`,
        );
      },
    );
  });

  /**
   * ⭐⭐ The headline instrument: rows, not cells.
   *
   * Nothing here names a byte. Each case asks only whether the footer output
   * CHANGED when the tenant locale changed — which is the defect stated as a
   * measurement, and the one property a snapshot cannot accidentally satisfy.
   */
  describe('every arm tracks the tenant locale', () => {
    const moves = ARMS.flatMap((arm) =>
      (['de-DE', 'tr-TR'] as const).map((locale) => [arm.site, locale, arm] as const),
    );

    it.each(moves)('the %s arm moves when the tenant locale moves to %s', (_site, locale, arm) => {
      const baseline = summaryLabel('en', arm.column, arm.rows, arm.fieldDef);
      expect(baseline).not.toBe('');
      expect(summaryLabel(locale, arm.column, arm.rows, arm.fieldDef)).not.toBe(baseline);
    });
  });

  /**
   * Which locale it moved TO. The right-hand side is computed from the tag
   * under test, so a repair that threaded some other varying locale — the one
   * thing the movement table above cannot see — fails here.
   */
  describe('and it is the TENANT locale it moved to', () => {
    const pairs = ARMS.flatMap((arm) =>
      (['en', 'de-DE', 'tr-TR'] as const).map((locale) => [arm.site, locale, arm] as const),
    );

    it.each(pairs)('the %s arm reads as %s renders it', (_site, locale, arm) => {
      expect(summaryLabel(locale, arm.column, arm.rows, arm.fieldDef)).toBe(
        `${arm.prefix}${arm.declared(locale)}`,
      );
    });
  });

  /**
   * `tr-TR` on the currency arm, as absolute bytes.
   *
   * The one place a literal is the right instrument: the agreement table would
   * survive a joint move of both sides, and this row cannot pass by accident —
   * `tr-TR` keeps the symbol in FRONT while writing German-shaped separators,
   * a combination neither `en` nor the machine locale produces.
   *
   * ⛔ Deliberately not the `de-DE` row: its rendering carries a no-break space
   * before the symbol, and a literal holding an invisible byte is a worse pin
   * than no literal at all.
   */
  it('tr-TR renders the currency total with the symbol in front and swapped marks', () => {
    expect(summaryLabel('tr-TR', ARMS[0].column, ARMS[0].rows, ARMS[0].fieldDef)).toBe('Sum: €1.234,50');
  });

  /**
   * The prefixes this file builds its agreement table on are MEASURED, not
   * assumed — a bundle change to `grid.summary.*` would otherwise arrive here
   * disguised as a locale failure.
   */
  it.each([...ARMS, CONTROL].map((arm) => [arm.site, arm] as const))(
    'the %s arm carries the label prefix the bundle produces',
    (_site, arm) => {
      expect(summaryLabel('en', arm.column, arm.rows, arm.fieldDef).startsWith(arm.prefix)).toBe(true);
    },
  );
});
