/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Chart type ↔ spec vocabulary parity + behavior (#2942).
 *
 * 7 of the 19 `ChartTypeSchema` values (the single-value and tabular
 * families) used to fall through the cartesian component map's `|| BarChart`
 * into a bar shell whose series marks all returned null — grid, axes,
 * tooltip and legend rendered with NO data marks, indistinguishable from an
 * empty dataset. Reachable because `ChartRenderer` reads
 * `schema.chartType ?? spec.chartType`, bypassing `normalizeChartSchema`'s
 * `RENDERABLE` gate.
 *
 * Contract under test:
 * - parity: RENDERABLE ∪ SINGLE_VALUE ∪ TABULAR covers every spec value, and
 *   the only renderer-local dialect is the documented `combo`;
 * - behavior: a single-value type renders the number, a tabular type renders
 *   the ownership notice, an out-of-spec type is named — never a silent
 *   empty plot.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ChartTypeSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import AdvancedChartImpl from '../AdvancedChartImpl';
import { RENDERABLE, SINGLE_VALUE_CHART_TYPES, TABULAR_CHART_TYPES } from '../normalizeChartSchema';

const specNames: string[] = enumOptions(ChartTypeSchema);

describe('plugin-charts covers the spec chart-type vocabulary', () => {
  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read ChartTypeSchema.options from the spec').not.toEqual([]);
  });

  it('every spec chart type lands on a real branch (series, single-value, or tabular)', () => {
    const uncovered = specNames.filter(
      (name) => !RENDERABLE.has(name) && !SINGLE_VALUE_CHART_TYPES.has(name) && !TABULAR_CHART_TYPES.has(name),
    );
    expect(
      uncovered,
      'these validate against ChartTypeSchema and would draw a silent empty plot',
    ).toEqual([]);
  });

  it('carries no renderer-local dialect beyond the tracked exceptions', () => {
    /**
     * Dialect this renderer is knowingly ahead of the resolved spec on. Each
     * entry needs a promote-or-delete decision (objectui#2945) — the set is an
     * upper bound, not an expectation, so it shrinks silently as the spec
     * adopts a name and only GROWING it fails.
     *
     * `combo`: promoted into `ChartTypeSchema` by framework#4070, which is not
     * in a published spec version yet. When objectui bumps to a spec that
     * includes it, this entry becomes dead weight — drop it then; nothing
     * fails in the meantime.
     */
    const TRACKED_DIALECT = new Set(['combo']);
    const implemented = [...RENDERABLE, ...SINGLE_VALUE_CHART_TYPES, ...TABULAR_CHART_TYPES];
    const untracked = implemented.filter(
      (name) => !specNames.includes(name) && !TRACKED_DIALECT.has(name),
    );
    expect(
      untracked,
      'new renderer-local chart dialect — promote it into @objectstack/spec or delete it (objectui#2945)',
    ).toEqual([]);

    // Report entries the spec has since adopted, so the list gets pruned
    // instead of quietly accumulating stale exceptions.
    const adopted = [...TRACKED_DIALECT].filter((name) => specNames.includes(name));
    if (adopted.length > 0) {
      console.info(
        `[chart-type parity] the spec now defines ${adopted.join(', ')} — remove them from TRACKED_DIALECT.`,
      );
    }
  });
});

describe('non-series chart families render honestly', () => {
  const data = [{ label: 'Total', value: 1234 }];
  const series = [{ dataKey: 'value', label: 'Total revenue' }];

  it('a single-value type (kpi) renders the number, not an empty bar shell', () => {
    render(<AdvancedChartImpl chartType={'kpi' as never} data={data} xAxisKey="label" series={series} />);
    const card = screen.getByTestId('advanced-chart-single-value');
    expect(card.textContent).toContain('1,234');
    expect(card.textContent).toContain('Total revenue');
  });

  it('every single-value family renders the same card', () => {
    for (const t of SINGLE_VALUE_CHART_TYPES) {
      const { unmount, getByTestId } = render(
        <AdvancedChartImpl chartType={t as never} data={data} xAxisKey="label" series={series} />,
      );
      expect(getByTestId('advanced-chart-single-value'), `type '${t}'`).toBeInTheDocument();
      unmount();
    }
  });

  it("a tabular type ('table') names the owning component instead of an empty plot", () => {
    render(<AdvancedChartImpl chartType={'table' as never} data={data} xAxisKey="label" series={series} />);
    expect(screen.getByTestId('advanced-chart-tabular-notice').textContent).toContain('table');
  });

  it('an out-of-spec type is named rather than guessed at', () => {
    render(<AdvancedChartImpl chartType={'sunburst' as never} data={data} xAxisKey="label" series={series} />);
    expect(screen.getByTestId('advanced-chart-unknown-type').textContent).toContain('sunburst');
  });
});
