// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36374 — the report builder: its model (what each of the five
 * settings writes into the report document) and the page (a picture at once,
 * the missing piece said where the chart would be, its picker opened).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { ReportSchema } from '@objectstack/spec/ui';
import { ReportBuilder } from '../builder/ReportBuilder';
import {
  fillDefaults,
  missingPiece,
  pickChartType,
  pickDataset,
  pickGrouping,
  pickMeasure,
  setShowValues,
  setTargetLine,
  targetLine,
  type ReportBuilderMembers,
  type ReportDraft,
} from '../builder/reportBuilderModel';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

const MEMBERS: ReportBuilderMembers = {
  measures: [
    { name: 'total_amount', label: 'Amount', aggregate: 'sum' },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
  ],
  dimensions: [
    { name: 'stage', label: 'Stage', type: 'select' },
    { name: 'owner', label: 'Owner', type: 'lookup' },
    { name: 'close_month', label: 'Close date', type: 'date' },
  ],
};

const EXISTING: ReportDraft = {
  name: 'pipeline_by_stage',
  label: 'Opportunities by stage',
  type: 'summary',
  dataset: 'pipeline',
  rows: ['stage'],
  values: ['total_amount'],
  chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount', showDataLabels: true },
};

/** Every report the builder writes must be one the spec accepts. */
function expectSpecValid(report: ReportDraft) {
  const parsed = ReportSchema.safeParse({ label: 'R', name: 'r', ...report });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
}

describe('report builder model (objectstack#36374)', () => {
  it('picking a data source starts on its count measure, no grouping, a single number', () => {
    const next = pickDataset({ name: 'r', label: 'R', type: 'summary' }, 'pipeline', MEMBERS);
    expect(next.dataset).toBe('pipeline');
    expect(next.values).toEqual(['deal_count']);
    expect(next.rows).toBeUndefined();
    expect(next.chart).toEqual({ type: 'metric', xAxis: '', yAxis: 'deal_count' });
    expect(missingPiece(next, MEMBERS)).toBeNull();
    expectSpecValid(next);
  });

  it('a data source picked before its members arrive gets its default measure when they do', () => {
    const bound = pickDataset({ name: 'r', label: 'R' }, 'pipeline', undefined);
    expect(bound.values).toBeUndefined();
    const filled = fillDefaults(bound, MEMBERS);
    expect(filled.values).toEqual(['deal_count']);
    expect((filled.chart as any).yAxis).toBe('deal_count');
    // Nothing owed on a report that already selects a measure.
    expect(fillDefaults(EXISTING, MEMBERS)).toBe(EXISTING);
  });

  it('switching data source clears what the old one named', () => {
    const next = pickDataset({ ...EXISTING, order: [{ by: 'stage' }], dateRange: { dimension: 'close_month' } }, 'other', MEMBERS);
    expect(next.rows).toBeUndefined();
    expect(next.order).toBeUndefined();
    expect(next.dateRange).toBeUndefined();
  });

  it('grouping a single number turns it into bars; clearing the grouping of bars turns them back', () => {
    const number = pickDataset({ name: 'r', label: 'R' }, 'pipeline', MEMBERS);
    const grouped = pickGrouping(number, 'owner', '', MEMBERS);
    expect(grouped.rows).toEqual(['owner']);
    expect(grouped.chart).toMatchObject({ type: 'bar', xAxis: 'owner', yAxis: 'deal_count' });
    expectSpecValid(grouped);
    const cleared = pickGrouping(grouped, '', '', MEMBERS);
    expect(cleared.rows).toBeUndefined();
    expect((cleared.chart as any).type).toBe('metric');
  });

  it('changing the grouping redraws the existing chart on the new field, chrome kept', () => {
    const next = pickGrouping(EXISTING, 'owner', '', MEMBERS);
    expect(next.chart).toEqual({ type: 'bar', xAxis: 'owner', yAxis: 'total_amount', showDataLabels: true });
    expectSpecValid(next);
  });

  it('a second layer splits a bar or line chart, never a donut', () => {
    const bars = pickGrouping(EXISTING, 'stage', 'owner', MEMBERS);
    expect(bars.rows).toEqual(['stage', 'owner']);
    expect((bars.chart as any).seriesBy).toBe('owner');
    expectSpecValid(bars);
    const donut = pickChartType(bars, 'donut', MEMBERS);
    expect((donut.chart as any).seriesBy).toBeUndefined();
    expectSpecValid(donut);
  });

  it('bar → donut → table all draw; table is the report table with no chart', () => {
    const donut = pickChartType(EXISTING, 'donut', MEMBERS);
    expect((donut.chart as any).type).toBe('donut');
    expectSpecValid(donut);
    const table = pickChartType(donut, 'table', MEMBERS);
    expect(table.chart).toBeUndefined();
    expect(table.rows).toEqual(['stage']);
    expectSpecValid(table);
  });

  it('the measure is the first value, and charts on', () => {
    const next = pickMeasure({ ...EXISTING, values: ['total_amount', 'deal_count'] }, 'deal_count', MEMBERS);
    expect(next.values).toEqual(['deal_count']);
    expect((next.chart as any).yAxis).toBe('deal_count');
    expectSpecValid(next);
  });

  it('grouping by a date adds the period chip; ungrouping it removes the chip again', () => {
    const dated = pickGrouping(EXISTING, 'close_month', '', MEMBERS);
    expect(dated.dateRange).toEqual({ dimension: 'close_month', defaultRange: 'this_year' });
    expectSpecValid(dated);
    const back = pickGrouping(dated, 'stage', '', MEMBERS);
    expect(back.dateRange).toBeUndefined();
    // A period the author declared on a dimension the report never grouped by is kept.
    const authored = { ...EXISTING, dateRange: { dimension: 'close_month', defaultRange: 'last_month' } };
    expect(pickGrouping(authored, 'owner', '', MEMBERS).dateRange).toEqual(authored.dateRange);
  });

  it('show values and the target line write the chart chrome the renderer reads', () => {
    const off = setShowValues(EXISTING, false);
    expect((off.chart as any).showDataLabels).toBeUndefined();
    const target = setTargetLine(EXISTING, 500, 'Target');
    expect((target.chart as any).annotations).toEqual([{ type: 'line', axis: 'y', value: 500, label: 'Target' }]);
    expect(targetLine(target)).toBe(500);
    expectSpecValid(target);
    expect((setTargetLine(target, undefined).chart as any).annotations).toBeUndefined();
    // A number has no axis to draw a target on.
    expect((pickChartType(target, 'metric', MEMBERS).chart as any).annotations).toBeUndefined();
  });

  it('says the first missing piece, in the order the sections stand', () => {
    expect(missingPiece({}, undefined)).toEqual({ section: 'source', reason: 'source' });
    // Members not read yet: nothing claimed about them.
    expect(missingPiece({ dataset: 'pipeline' }, undefined)).toBeNull();
    expect(missingPiece({ dataset: 'pipeline' }, { measures: [], dimensions: [] })).toEqual({ section: 'source', reason: 'noMeasures' });
    expect(missingPiece({ dataset: 'pipeline' }, MEMBERS)).toEqual({ section: 'measure', reason: 'measure' });
    expect(missingPiece({ dataset: 'pipeline', values: ['deal_count'], chart: { type: 'bar', xAxis: '', yAxis: 'deal_count' } }, MEMBERS))
      .toEqual({ section: 'grouping', reason: 'grouping' });
    expect(missingPiece(EXISTING, MEMBERS)).toBeNull();
  });
});

describe('report builder page (objectstack#36374)', () => {
  let chartCalls: Array<Record<string, any>> = [];
  beforeEach(() => {
    chartCalls = [];
    ComponentRegistry.register('chart', (props: any) => {
      chartCalls.push(props.schema);
      return <div data-testid="chart-stub">{props.schema?.chartType}</div>;
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const box = (value = '') => ({ value, onChange: () => {} });

  function Harness({ initial, members, dataSource }: { initial: ReportDraft; members?: ReportBuilderMembers; dataSource?: unknown }) {
    const [report, setReport] = React.useState<ReportDraft>(initial);
    return (
      <>
        <ReportBuilder
          report={report}
          onChange={setReport}
          name={box(String(report.label ?? ''))}
          description={box()}
          datasets={[{ name: 'pipeline', label: 'Pipeline' }]}
          members={report.dataset ? members : undefined}
          onSave={() => {}}
          onDiscard={() => setReport(initial)}
          onClose={() => {}}
          dirty={report !== initial}
          dataSource={dataSource}
        />
        <pre data-testid="report-json">{JSON.stringify(report)}</pre>
      </>
    );
  }

  const current = () => JSON.parse(screen.getByTestId('report-json').textContent ?? '{}');

  it('a new report says 「choose a data source」 where the chart would be, with that picker open', async () => {
    render(<Harness initial={{ name: '', label: '' }} members={MEMBERS} />);
    expect(screen.getByTestId('report-builder-missing')).toHaveAttribute('data-missing', 'source');
    // The data source picker opened by itself: its options are on the page.
    await waitFor(() => expect(screen.getByTestId('report-builder-source-option-pipeline')).toBeInTheDocument());
    expect(screen.getByTestId('report-builder-save')).toBeDisabled();
  });

  it('picking the data source draws a number at once', async () => {
    const dataSource = { queryDataset: vi.fn(async () => ({ rows: [{ deal_count: 7 }], fields: [{ name: 'deal_count', type: 'number', label: 'Deals' }] })) };
    render(<Harness initial={{ name: '', label: '' }} members={MEMBERS} dataSource={dataSource} />);
    const option = await screen.findByTestId('report-builder-source-option-pipeline');
    fireEvent.click(option);
    await waitFor(() => expect(current().values).toEqual(['deal_count']));
    expect(current().chart).toEqual({ type: 'metric', xAxis: '', yAxis: 'deal_count' });
    expect(screen.queryByTestId('report-builder-missing')).toBeNull();
    // The one dimensionless query the single number makes.
    await waitFor(() => expect(dataSource.queryDataset).toHaveBeenCalled());
  });

  it('an existing report opens with its settings filled in and draws its chart', async () => {
    const dataSource = { queryDataset: vi.fn(async () => ({ rows: [{ stage: 'Won', total_amount: 10 }], fields: [] })) };
    render(<Harness initial={EXISTING} members={MEMBERS} dataSource={dataSource} />);
    expect(screen.queryByTestId('report-builder-missing')).toBeNull();
    expect(screen.getByTestId('report-builder-source-trigger')).toHaveTextContent('Pipeline');
    expect(screen.getByTestId('report-builder-measure-trigger')).toHaveTextContent('Amount');
    expect(screen.getByTestId('report-builder-grouping-trigger')).toHaveTextContent('Stage');
    expect(screen.getByTestId('report-builder-chart-bar')).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(chartCalls.length).toBeGreaterThan(0));
  });

  it('a chart that needs a grouping says so and opens the grouping picker', async () => {
    render(<Harness initial={{ ...EXISTING, rows: undefined, chart: { type: 'line', xAxis: '', yAxis: 'total_amount' } }} members={MEMBERS} />);
    expect(screen.getByTestId('report-builder-missing')).toHaveAttribute('data-missing', 'grouping');
    await waitFor(() => expect(screen.getByTestId('report-builder-grouping-option-stage')).toBeInTheDocument());
  });

  it('switching the chart type rewrites the report; Discard puts it back', () => {
    render(<Harness initial={EXISTING} members={MEMBERS} />);
    fireEvent.click(screen.getByTestId('report-builder-chart-donut'));
    expect(current().chart.type).toBe('donut');
    fireEvent.click(screen.getByTestId('report-builder-chart-table'));
    expect(current().chart).toBeUndefined();
    fireEvent.click(screen.getByTestId('report-builder-discard'));
    expect(current()).toEqual(EXISTING);
  });
});

describe('the computed values fold (objectstack#36374)', () => {
  afterEach(() => cleanup());

  it('folds the table under a drawn chart and opens it on click; the report page is unchanged', async () => {
    ComponentRegistry.register('chart', () => <div data-testid="chart-stub" />);
    const dataSource = { queryDataset: vi.fn(async () => ({ rows: [{ stage: 'Won', total_amount: 10 }], fields: [] })) };
    const { unmount } = render(<DatasetReportRenderer report={EXISTING as never} dataSource={dataSource as never} foldTableUnderChart />);
    const toggle = await screen.findByTestId('dataset-report-computed-values-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    unmount();

    render(<DatasetReportRenderer report={EXISTING as never} dataSource={dataSource as never} />);
    expect(screen.queryByTestId('dataset-report-computed-values-toggle')).toBeNull();
  });

  it('draws a table-only report as the table, with no fold', () => {
    const dataSource = { queryDataset: vi.fn(async () => ({ rows: [], fields: [] })) };
    render(<DatasetReportRenderer report={{ ...EXISTING, chart: undefined } as never} dataSource={dataSource as never} foldTableUnderChart />);
    expect(screen.queryByTestId('dataset-report-computed-values-toggle')).toBeNull();
  });
});
