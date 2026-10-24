/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4553 phase 2 — the dashboard's percent-formatted cells.
 *
 * `renderFieldValue` in `recordFields.tsx` formats a `%`-format column through
 * `formatPercent` and threaded no locale, because there was none to thread.
 * Unlike the other consumers on this card it is a PLAIN FUNCTION, not a
 * component, so it cannot read `useDisplayLocale()` itself — the locale has to
 * arrive as an argument. It is given an optional fourth parameter beside the
 * `tenantCurrency` that was already threaded exactly this way.
 *
 * ⚠️ Both of its callers format INSIDE a `useMemo`, so the locale was added to
 * their dependency arrays as well — objectui#4542's lesson (PR #4554) applied
 * in a second place. See the honest-scope note on the last case: that
 * dependency turned out NOT to be assertable from here, and the note says so
 * rather than letting the case read as a pin it is not.
 *
 * Note the DASHBOARD MEASURE formatter is a different thing that this card
 * does NOT touch: `formatMeasure` in `@object-ui/core` has its own percent
 * path (`toLocaleString(undefined, ...)`) and never calls `formatPercent`, so
 * `DatasetWidget` / `ObjectMetric` are out of this change's blast radius.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────
 * Runner machine locale en-US.
 *   de   `1235%` → `1.235 %`   RED
 *   en   `1235%` → `1,235%`    RED (the deliberate grouping move)
 *   small-value en output                     PIN, green both sides
 *   re-render on a late locale                RED pre-fix (formatting), but it
 *                                             does NOT isolate the memo dep —
 *                                             see its own note
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider, type LocalizationValue } from '@object-ui/i18n';

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    SchemaRenderer: ({ schema }: any) => {
      const cols = schema.columns || [];
      const rows = schema.data || [];
      return (
        <table>
          <tbody>
            {rows.map((row: any, i: number) => (
              <tr key={i}>
                {cols.map((c: any) => (
                  <td key={c.accessorKey} data-testid={`cell-${c.accessorKey}`}>
                    {typeof c.cell === 'function'
                      ? c.cell(row[c.accessorKey], row)
                      : String(row[c.accessorKey] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    },
    useDataScope: () => undefined,
    SchemaRendererContext:
      actual.SchemaRendererContext ||
      (await vi.importActual<typeof import('react')>('react')).createContext({}),
  };
});

import { ObjectDataTable } from '../ObjectDataTable';

/** German writes a NO-BREAK SPACE (U+00A0) before the percent sign. */
const NBSP = '\u00a0';

/** Four digits, so the GROUPING separator is exercised in both locales. */
const ROWS = [{ id: '1', name: 'Northwind', win_rate: 1234.5, small_rate: 33.33 }];

const OBJECT_SCHEMA = {
  fields: {
    name: { type: 'text', label: 'Name' },
    // `format` carrying a '%' is what routes a column through the percent
    // branch of `renderFieldValue`.
    // objectui#11475 — both values are percentage POINTS, so both fields
    // declare whole-point storage (a `max` above 1, the spec's
    // `percentScaleOf`). The cell reads the declaration now; it used to guess
    // points from the value's size. The locale this file measures is unmoved.
    win_rate: { type: 'percent', label: 'Win Rate', format: '0%', max: 10000 },
    small_rate: { type: 'percent', label: 'Small Rate', format: '0.00%', max: 100 },
  },
};

/**
 * MODULE-CONSTANT, and that is load-bearing for the dependency case at the
 * bottom of this file — objectui#4542 / PR #4554's masking-path lesson, met
 * again here.
 *
 * Building a fresh data source per render (the `dataSource={makeDataSource()}`
 * this file started with) gives it a new identity on the re-render, which
 * refetches, which gives
 * `finalData` a new identity, which re-runs the column memo ALL BY ITSELF. The
 * dependency case then passes whether or not `displayLocale` is in the memo's
 * dependency array — i.e. it looks like coverage and is not. Measured: with the
 * dep deliberately removed and a per-render source, all five cases still passed.
 * A stable identity is what makes the locale the only thing that can invalidate
 * that memo.
 */
const DATA_SOURCE: any = {
  find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
  getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
};

const SCHEMA: any = {
  type: 'object-data-table',
  objectName: 'accounts',
  columns: [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'win_rate', header: 'Win Rate' },
    { accessorKey: 'small_rate', header: 'Small Rate' },
  ],
};

function renderSession(language: string, value: LocalizationValue = {}) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <LocalizationProvider value={value}>
        <ObjectDataTable schema={SCHEMA} dataSource={DATA_SOURCE} />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('ObjectDataTable percent cells follow the display locale (objectui#4553)', () => {
  it('de session renders the German percent form', async () => {
    renderSession('de');
    await waitFor(() => expect(screen.getByTestId('cell-win_rate')).toBeInTheDocument());
    expect(screen.getByTestId('cell-win_rate').textContent).toBe(`1.235${NBSP}%`);
  });

  it('en session groups the percent — the deliberate output move', async () => {
    renderSession('en');
    await waitFor(() => expect(screen.getByTestId('cell-win_rate')).toBeInTheDocument());
    expect(screen.getByTestId('cell-win_rate').textContent).toBe('1,235%');
  });

  /** PIN, green both sides: below the grouping threshold en is unchanged. */
  it('en small-value output is byte-identical (must-not-change)', async () => {
    renderSession('en');
    await waitFor(() => expect(screen.getByTestId('cell-small_rate')).toBeInTheDocument());
    expect(screen.getByTestId('cell-small_rate').textContent).toBe('33.33%');
  });

  it('an explicit tenant locale outranks the active UI language', async () => {
    renderSession('en', { locale: 'de' });
    await waitFor(() => expect(screen.getByTestId('cell-win_rate')).toBeInTheDocument());
    expect(screen.getByTestId('cell-win_rate').textContent).toBe(`1.235${NBSP}%`);
  });

  /**
   * The user-visible guarantee: a locale arriving after first paint re-formats
   * the cells rather than leaving them on the old convention.
   *
   * ⚠️ HONEST SCOPE — this case asserts the BEHAVIOR, and it does NOT isolate
   * the memo dependency, though it was written intending to. Measured both
   * ways: with `displayLocale` deliberately removed from the column memo's
   * dependency array (and the argument still threaded), all five cases in this
   * file still passed. The provider change makes this component refetch, which
   * gives `finalData` a fresh identity and re-runs the memo on its own — so no
   * assertion here can distinguish a declared dependency from an undeclared
   * one. Making the data source module-constant (above) removes one masking
   * path but not that one.
   *
   * The dependency is declared in `ObjectDataTable` anyway, and should stay:
   * it is what `react-hooks/exhaustive-deps` requires, and it is what keeps the
   * cells correct if the refetch ever stops coinciding with the locale change.
   * But it is currently guarded by reasoning, not by this test — recorded here
   * so a later reader does not mistake this case for the pin it is not.
   */
  it('re-formats when the tenant locale changes after first paint', async () => {
    const { rerender } = render(
      <I18nProvider
        config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
        persistLanguage={false}
      >
        <LocalizationProvider value={{}}>
          <ObjectDataTable schema={SCHEMA} dataSource={DATA_SOURCE} />
        </LocalizationProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('cell-win_rate')).toBeInTheDocument());
    expect(screen.getByTestId('cell-win_rate').textContent).toBe('1,235%');

    rerender(
      <I18nProvider
        config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}
        persistLanguage={false}
      >
        <LocalizationProvider value={{ locale: 'de' }}>
          <ObjectDataTable schema={SCHEMA} dataSource={DATA_SOURCE} />
        </LocalizationProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('cell-win_rate').textContent).toBe(`1.235${NBSP}%`),
    );
  });
});
