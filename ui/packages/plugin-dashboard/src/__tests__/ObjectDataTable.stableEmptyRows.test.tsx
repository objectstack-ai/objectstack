/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4629 — "no rows yet" must be a STABLE value in `ObjectDataTable`.
 *
 * `const finalData = Array.isArray(rawData) ? rawData : []` evaluated a FRESH
 * array literal on every render, and `finalData` is a dependency of the
 * `derivedColumns` memo. So while `rawData` is a non-array the memo's key
 * changed on every render and every column was re-derived — `buildFieldMeta`,
 * a fresh `cell` closure, the `isSystemField` pass, the `fieldLabel` lookups —
 * and then discarded, because `finalData.length === 0` is exactly the case in
 * which the component returns its empty state without rendering the table.
 *
 * Nothing renders WRONG either before or after, so a "the table renders
 * correctly" assertion is green against the broken code and proves nothing.
 * The observable that separates the two is the RECOMPUTE COUNT: one
 * `buildFieldMeta` call per declared column per memo evaluation. An
 * `eslint-disable` suppression of the `react-hooks/exhaustive-deps` warning
 * would silence the warning and leave this count growing, so this test
 * discriminates the real fix from a suppression.
 *
 * WHICH rawData is a non-array, measured rather than assumed: `rawData` is
 * `boundData || schema.data || fetchedData`, and `fetchedData` is
 * `useState<any[]>([])` — an array with a STABLE identity from the first
 * render. So the plain pre-fetch window was never the churning case; the
 * churn needs a truthy non-array, i.e. a provider-config `data` (below) or a
 * `bind` path that resolves to an object.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import React from 'react';

const counters = vi.hoisted(() => ({ buildFieldMeta: 0 }));

// Count memo evaluations at the per-column work the memo does. `importActual`
// keeps the real enrichment running, so the component still behaves normally.
vi.mock('../recordFields', async () => {
  const actual: any = await vi.importActual('../recordFields');
  return {
    ...actual,
    buildFieldMeta: (...args: any[]) => {
      counters.buildFieldMeta += 1;
      return actual.buildFieldMeta(...args);
    },
  };
});

// The underlying `data-table` renderer is stubbed so the test does not depend
// on the component registry — the same shape the sibling suites in this
// directory use.
vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    SchemaRenderer: ({ schema }: any) => (
      <div data-testid="table">
        {(schema.data ?? []).map((row: any, i: number) => (
          <span key={i}>{String(row.name)}</span>
        ))}
      </div>
    ),
  };
});

import { ObjectDataTable } from '../ObjectDataTable';

afterEach(() => {
  cleanup();
  counters.buildFieldMeta = 0;
});

/**
 * A schema whose `data` is a PROVIDER CONFIG object rather than rows — the
 * same case `data-table.tsx`'s own `EMPTY_ROWS` docstring names. `columns` is
 * declared so the memo takes its full enrichment branch: this is the window
 * where the work is done and thrown away.
 */
const PROVIDER_CONFIG_SCHEMA = {
  type: 'object-table',
  data: { provider: 'object', object: 'account' },
  columns: ['name', 'amount'],
} as any;

/**
 * Declared at module scope, not inline: `I18nProvider` memoizes its i18next
 * bootstrap on the `config` IDENTITY, so an inline literal would rebuild the
 * instance every render — the very class of bug under test, one level up.
 */
const I18N_CONFIG = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

/**
 * The widget is rendered inside a real `I18nProvider`, which is load-bearing
 * rather than decoration. `derivedColumns` also depends on `fieldLabel` /
 * `fieldOptionLabel` from `useSafeFieldLabel`, which memoize on react-i18next's
 * `[t, i18n]`. With a real instance those are stable between renders, so
 * `finalData` is the only churning dependency and this test measures exactly
 * it. OUTSIDE any provider react-i18next has no instance to bind to and hands
 * back a fresh `t` every render, so the memo re-keys regardless of this fix —
 * measured on this branch (8 calls, unchanged by the fix) and filed as
 * objectui#5564; it is a defect in a different package and is not what #4629
 * is about.
 */
function renderUnderHostChurn(schema: any) {
  let bump: (() => void) | null = null;
  const Host = () => {
    const [, setTick] = React.useState(0);
    bump = () => setTick((n) => n + 1);
    return <ObjectDataTable schema={schema} />;
  };
  const utils = render(<I18nProvider config={I18N_CONFIG}><Host /></I18nProvider>);
  return {
    ...utils,
    churn: (times: number) => {
      for (let i = 0; i < times; i += 1) act(() => { bump!(); });
    },
  };
}

describe('ObjectDataTable keeps "no rows yet" stable (#4629)', () => {
  it('derives each column once, however often the host re-renders', () => {
    const tile = renderUnderHostChurn(PROVIDER_CONFIG_SCHEMA);

    // Load-bearing: proves the memo really ran its enrichment branch (two
    // declared columns → two calls). Without it the assertion below would be
    // vacuously green if `buildFieldMeta` were never reached at all.
    const afterMount = counters.buildFieldMeta;
    expect(afterMount).toBe(2);
    // And that this is the discarding window — the table is not rendered.
    expect(tile.queryByTestId('table')).toBeNull();
    expect(tile.getByTestId('table-empty-state')).toBeTruthy();

    tile.churn(3);

    // Pre-fix this was 8: a fresh `[]` re-keyed `derivedColumns` on each of
    // the three host renders, re-deriving both columns every time.
    expect(counters.buildFieldMeta).toBe(afterMount);
  });

  it('still re-derives when rows actually arrive — the memo was stabilized, not frozen', () => {
    let setData: ((d: any) => void) | null = null;
    const Host = () => {
      const [data, set] = React.useState<any>({ provider: 'object', object: 'account' });
      setData = set;
      return (
        <ObjectDataTable
          schema={{ type: 'object-table', data, columns: ['name', 'amount'] } as any}
        />
      );
    };
    const { getByTestId, queryByTestId } = render(
      <I18nProvider config={I18N_CONFIG}><Host /></I18nProvider>,
    );
    expect(queryByTestId('table')).toBeNull();
    const beforeRows = counters.buildFieldMeta;

    act(() => { setData!([{ name: 'INV-1', amount: 100 }]); });

    expect(counters.buildFieldMeta).toBeGreaterThan(beforeRows);
    expect(getByTestId('table').textContent).toContain('INV-1');
  });
});
