/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A drill whose filter this layer refuses is reported, not thrown — and never
 * emitted without the report's scope — objectui#10789.
 *
 * Both drill handlers (the grouped row and the matrix cell) compose the
 * report's `runtimeFilter` with the clicked bucket through
 * `buildDatasetDrillFilter` → `composeDrillFilter`, which lowers through the
 * THROWING converter form. A spec `$not` — which `@objectstack/spec` declares
 * and the dataset query carries to the server — is refused by this layer's
 * converter, so the click threw out of its handler uncaught.
 *
 * ⛔ The repair may not emit the drill with `objectFilter: undefined`: the host
 * reads that as an older server and rebuilds the filter from the clicked group
 * ALONE (`ReportView`'s fallback), dropping `runtimeFilter` — a drill into
 * records the report is scoped to exclude. So the pins assert that NO drill is
 * emitted and that the refusal is logged naming the operator.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

/**
 * Two refusals, one per refusing step of the drill seam: `$not` is declared by
 * the spec and refused by this layer's CONVERTER; a scalar on `$in` passes the
 * converter and is refused by the spec's own `parseFilterAST`.
 */
const REFUSALS = [
  ['converter refusal', { $not: { owner: 'them' } }, '$not'],
  ['spec refusal', { owner: { $in: 'me' } }, '$in'],
] as const;

function makeSource(rows: Array<Record<string, unknown>>, rawRows: Array<Record<string, unknown>>) {
  return {
    queryDataset: vi.fn(async () => ({
      rows,
      object: 'task',
      dimensionFields: { status: 'status', priority: 'priority' },
      drillRawRows: rawRows,
    })),
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The renderer's dimension-label probe reads object metadata over `fetch`.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const refusalWarnings = () =>
  warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes('drill-down refused'));

describe('DatasetReportRenderer — a refused runtimeFilter drills nothing (objectui#10789)', () => {
  it.each(REFUSALS)('%s — the grouped-row drill logs the refusal and emits no drill', async (_label, scope, operator) => {
    const onDrill = vi.fn();
    render(
      <DatasetReportRenderer
        report={{ name: 'r', type: 'summary', dataset: 'task_metrics', rows: ['status'], values: ['est_hours'] }}
        dataSource={makeSource([{ status: 'Open', est_hours: 3 }], [{ status: 'open' }])}
        runtimeFilter={scope}
        onDrill={onDrill}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('dataset-drill-row')).toBeTruthy());
    fireEvent.click(screen.getByTestId('dataset-drill-row'));

    expect(onDrill).not.toHaveBeenCalled();
    expect(refusalWarnings()).toHaveLength(1);
    expect(refusalWarnings()[0]).toContain(operator);
  });

  it.each(REFUSALS)('%s — the matrix-cell drill logs the refusal and emits no drill', async (_label, scope, operator) => {
    const onDrill = vi.fn();
    render(
      <DatasetReportRenderer
        report={{ name: 'm', type: 'matrix', dataset: 'task_metrics', rows: ['status'], columns: ['priority'], values: ['est_hours'] }}
        dataSource={makeSource([{ status: 'Open', priority: 'High', est_hours: 3 }], [{ status: 'open', priority: 'high' }])}
        runtimeFilter={scope}
        onDrill={onDrill}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('dataset-drill-cell').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByTestId('dataset-drill-cell')[0]);

    expect(onDrill).not.toHaveBeenCalled();
    expect(refusalWarnings()).toHaveLength(1);
    expect(refusalWarnings()[0]).toContain(operator);
  });

  it('CONTROL — a well-formed runtimeFilter still drills with the scope conjoined', async () => {
    const onDrill = vi.fn();
    render(
      <DatasetReportRenderer
        report={{ name: 'r', type: 'summary', dataset: 'task_metrics', rows: ['status'], values: ['est_hours'] }}
        dataSource={makeSource([{ status: 'Open', est_hours: 3 }], [{ status: 'open' }])}
        runtimeFilter={{ owner: 'me' }}
        onDrill={onDrill}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('dataset-drill-row')).toBeTruthy());
    fireEvent.click(screen.getByTestId('dataset-drill-row'));
    expect(onDrill).toHaveBeenCalledWith(expect.objectContaining({
      objectFilter: { $and: [{ owner: 'me' }, { status: 'open' }] },
    }));
    expect(refusalWarnings()).toHaveLength(0);
  });
});
