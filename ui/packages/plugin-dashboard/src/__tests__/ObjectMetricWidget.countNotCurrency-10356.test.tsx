// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10356 — the metric tile dresses its number in the aggregated
 * field's unit only when the aggregate ANSWERS in that unit.
 *
 * The tile decided "format as money" from the value field's TYPE alone, so
 * `{ field: 'amount', function: 'count' }` over a `currency` field — a number
 * of rows, not an amount — rendered `$3`, while the grid footer reads the same
 * count on a currency column as a plain `3` ("Count aggregations are plain
 * cardinalities … neither may inherit the column's currency or percent
 * formatting", `formatSummaryLabel` in `plugin-grid`'s `useColumnSummary`).
 *
 * ── Which functions carry the unit — read off the installed spec ─────────
 * The classification below is one row per member of the engine's
 * `AggregationFunction` (`@objectstack/spec/data`), and the first case
 * requires the row set to EQUAL that enum's members, so a member the spec
 * adds fails here until someone classifies it:
 *   - `sum`, `avg`: an amount of the field's currency.
 *   - `min`, `max`: "both return a value of the field's OWN type" (the spec's
 *     `AGGREGATE_FIELD_TYPE_COMPATIBILITY` table notes).
 *   - `count`, `count_distinct`: "counting rows or distinct values reads no
 *     arithmetic off the value" (same table) — a cardinality, no unit.
 * `percent_filled` / `percent_empty` are `ColumnSummary` members, not
 * `AggregationFunction` members: no aggregate a tile can ask the engine for
 * yields them.
 *
 * ── Directions on the base tree (predicted before the first run) ─────────
 *   count / count_distinct over a USD field ⇒ plain            RED (`$3`)
 *   count with an authored plain `format` ⇒ plain              RED (`$3`: the
 *     inferred code still reached `MetricWidget`'s `currency` prop)
 *   count over a percent field ⇒ plain                         RED (`3%`)
 *   sum / avg / min / max over a USD field ⇒ money             GREEN (unchanged)
 *   avg over a percent field ⇒ percent (control)               GREEN
 *   sum over a number field (control)                          GREEN
 *   the classification covers the installed vocabulary         GREEN
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { AggregationFunction } from '@objectstack/spec/data';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { ObjectMetricWidget, type ObjectMetricWidgetProps } from '../ObjectMetricWidget';

afterEach(cleanup);

function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <LocalizationProvider value={{ locale: 'en' }}>{children}</LocalizationProvider>
    </I18nProvider>
  );
}

/**
 * Mount the tile over a one-field object whose aggregate answers `value` under
 * the `<field>_<function>` key, and wait until BOTH the schema lookup and the
 * aggregate have landed — the tile is read in its settled state, never in the
 * pre-schema frame where it formats a bare number whatever the fix does.
 */
async function mountTile(
  field: Record<string, unknown>,
  fn: string,
  value: number,
  extra: Partial<ObjectMetricWidgetProps> = {},
) {
  const source = {
    getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { amount: field } })),
    aggregate: vi.fn(async (_object: string, query: { function: string }) => [
      { [`amount_${query.function}`]: value },
    ]),
  };
  render(
    <Providers>
      <ObjectMetricWidget
        objectName="deal"
        label="Deals"
        aggregate={{ field: 'amount', function: fn }}
        dataSource={source}
        {...extra}
      />
    </Providers>,
  );
  await waitFor(() => {
    expect(source.getObjectSchema).toHaveBeenCalled();
    expect(source.aggregate).toHaveBeenCalled();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(screen.queryByTestId('metric-loading')).toBeNull());
}

/** The tile shows exactly `text` — an identity normalizer, so no-break spaces count. */
function tileShows(text: string): HTMLElement {
  return screen.getByText(text, { normalizer: (s) => s });
}

const USD = { type: 'currency', currency: 'USD' };

/** One row per `AggregationFunction` member: does the answer carry the field's unit? */
const CARRIES_FIELD_UNIT: Record<string, boolean> = {
  sum: true,
  avg: true,
  min: true,
  max: true,
  count: false,
  count_distinct: false,
};

describe('which aggregates carry the field unit — read against the installed spec', () => {
  it('the classification has exactly one row per `AggregationFunction` member', () => {
    expect(Object.keys(CARRIES_FIELD_UNIT).sort()).toEqual([...AggregationFunction.options].sort());
  });

  const plain = Object.keys(CARRIES_FIELD_UNIT).filter((fn) => !CARRIES_FIELD_UNIT[fn]);
  const unit = Object.keys(CARRIES_FIELD_UNIT).filter((fn) => CARRIES_FIELD_UNIT[fn]);

  it.each(plain)('`%s` over a USD field shows a plain number `3`, never money', async (fn) => {
    await mountTile(USD, fn, 3);
    expect(tileShows('3')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it.each(plain)('`%s` over a USD field is still locale-formatted: `1,234`', async (fn) => {
    await mountTile(USD, fn, 1234);
    expect(tileShows('1,234')).toBeInTheDocument();
  });

  it.each(unit)('`%s` over a USD field shows the amount in its currency (USD 1,234.50)', async (fn) => {
    await mountTile(USD, fn, 1234.5);
    expect(tileShows('$1,234.50')).toBeInTheDocument();
  });
});

describe('the unit is withheld on every channel the tile formats through', () => {
  it('a `count` with an authored plain `format` shows `3` — the inferred code no longer reaches `MetricWidget`', async () => {
    await mountTile(USD, 'count', 3, { format: '0,0' });
    expect(tileShows('3')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('a `count` over a percent field shows `3`, not `3%` — the footer rule withholds both units', async () => {
    await mountTile({ type: 'percent' }, 'count', 3);
    expect(tileShows('3')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

/**
 * ⭐ Controls — a field whose unit the aggregate DOES carry keeps its face. If
 * one of these moved, the repair reached past the count family it was ruled for.
 */
describe('controls — unchanged faces', () => {
  it('`avg` over a percent field still reads as a percent', async () => {
    await mountTile({ type: 'percent' }, 'avg', 0.25);
    expect(tileShows('25%')).toBeInTheDocument();
  });

  it('`sum` over a plain number field still reads `1,234`', async () => {
    await mountTile({ type: 'number' }, 'sum', 1234);
    expect(tileShows('1,234')).toBeInTheDocument();
  });
});
