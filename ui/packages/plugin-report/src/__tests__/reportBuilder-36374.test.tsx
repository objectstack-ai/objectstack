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
  setShowEmptyGroups,
  setShowValues,
  setTargetLine,
  showsEmptyGroups,
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
  const parsed = ReportSchema.safeParse({ label: 'R', name: 'new_report', ...report });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
}

describe('report builder model (objectstack#36374)', () => {
  it('picking a data source starts on its count measure, no grouping, a single number', () => {
    const next = pickDataset({ name: 'new_report', label: 'R', type: 'summary' }, 'pipeline', MEMBERS);
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
    const number = pickDataset({ name: 'new_report', label: 'R' }, 'pipeline', MEMBERS);
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

  it('an authored chart keeps the measure and axis it draws until the person picks another', () => {
    // The shapes that reach the builder: one value that is not the charted
    // measure, and an xAxis that is not rows[0].
    const authored: ReportDraft = {
      ...EXISTING,
      rows: ['owner', 'stage'],
      values: ['total_amount'],
      chart: { type: 'bar', xAxis: 'stage', yAxis: 'deal_count' },
    };
    const line = pickChartType(authored, 'line', MEMBERS);
    expect(line.chart).toMatchObject({ type: 'line', xAxis: 'stage', yAxis: 'deal_count', seriesBy: 'owner' });
    expectSpecValid(line);
    const regrouped = pickGrouping(authored, 'owner', 'stage', MEMBERS);
    expect(regrouped.chart).toMatchObject({ xAxis: 'owner', seriesBy: 'stage', yAxis: 'deal_count' });
    expectSpecValid(regrouped);

    // Picking a measure charts it.
    const remeasured = pickMeasure(authored, 'total_amount', MEMBERS);
    expect((remeasured.chart as any).yAxis).toBe('total_amount');
    expect((remeasured.chart as any).xAxis).toBe('stage');
  });

  it('a report with a chart and no values opens on the measure its chart draws, unchanged', () => {
    const noValues: ReportDraft = { ...EXISTING, values: undefined, chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount' } };
    delete (noValues as Record<string, unknown>).values;
    const opened = fillDefaults(noValues, MEMBERS);
    expect(opened.values).toEqual(['total_amount']);
    expect((opened.chart as any).yAxis).toBe('total_amount');
    expectSpecValid(opened);
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

  it('picking the data source leaves the measure picker closed: its count measure is already there', async () => {
    render(<Harness initial={{ name: '', label: '' }} members={MEMBERS} />);
    fireEvent.click(await screen.findByTestId('report-builder-source-option-pipeline'));
    await waitFor(() => expect(current().values).toEqual(['deal_count']));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('report-builder-measure-option-deal_count')).toBeNull();
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

describe('the report filter under the data source (objectstack#36645)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const box = (value = '') => ({ value, onChange: () => {} });

  /**
   * The builder with a host filter control: a button that sets the report's
   * `runtimeFilter` and one that clears it, standing in for the console's
   * filter editor (the real one is `ReportBuilderHost.filter-36645`'s subject).
   */
  function FilterHarness({ initial, dataSource }: { initial: ReportDraft; dataSource?: unknown }) {
    const [report, setReport] = React.useState<ReportDraft>(initial);
    const setFilter = (fc: Record<string, unknown> | undefined) =>
      setReport((r) => {
        const next = { ...r };
        if (fc) next.runtimeFilter = fc;
        else delete next.runtimeFilter;
        return next;
      });
    return (
      <>
        <ReportBuilder
          report={report}
          onChange={setReport}
          name={box(String(report.label ?? ''))}
          description={box()}
          datasets={[{ name: 'pipeline', label: 'Pipeline' }, { name: 'other', label: 'Other' }]}
          members={report.dataset ? MEMBERS : undefined}
          onSave={() => {}}
          onDiscard={() => setReport(initial)}
          onClose={() => {}}
          dataSource={dataSource}
          filter={
            <>
              <button type="button" data-testid="host-filter-won" onClick={() => setFilter({ stage: { $eq: 'won' } })}>won</button>
              <button type="button" data-testid="host-filter-clear" onClick={() => setFilter(undefined)}>clear</button>
            </>
          }
        />
        <pre data-testid="report-json">{JSON.stringify(report)}</pre>
      </>
    );
  }

  const current = () => JSON.parse(screen.getByTestId('report-json').textContent ?? '{}');

  it('draws the host filter under the data source, and only once a data source is bound', () => {
    const { unmount } = render(<FilterHarness initial={{ name: '', label: '' }} />);
    expect(screen.queryByTestId('report-builder-filter')).toBeNull();
    unmount();
    render(<FilterHarness initial={EXISTING} />);
    const slot = screen.getByTestId('report-builder-filter');
    // Under the data source: inside that section, after its picker.
    const source = screen.getByTestId('report-builder-source');
    expect(source).toContainElement(slot);
    expect(screen.getByTestId('report-builder-source-trigger').compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a filter added redraws the preview at once with it; removing it redraws without', async () => {
    ComponentRegistry.register('chart', () => <div data-testid="chart-stub" />);
    const queryDataset = vi.fn(async (_dataset: string, _selection: Record<string, unknown>) => ({ rows: [{ stage: 'Won', total_amount: 10 }], fields: [] }));
    render(<FilterHarness initial={EXISTING} dataSource={{ queryDataset }} />);
    await waitFor(() => expect(queryDataset).toHaveBeenCalled());
    expect(queryDataset.mock.calls.at(-1)?.[1]).not.toHaveProperty('runtimeFilter');

    fireEvent.click(screen.getByTestId('host-filter-won'));
    expect(current().runtimeFilter).toEqual({ stage: { $eq: 'won' } });
    await waitFor(() => expect(queryDataset.mock.calls.at(-1)?.[1]).toHaveProperty('runtimeFilter', { stage: { $eq: 'won' } }));
    expectSpecValid(current());

    fireEvent.click(screen.getByTestId('host-filter-clear'));
    expect(current()).not.toHaveProperty('runtimeFilter');
    await waitFor(() => expect(queryDataset.mock.calls.at(-1)?.[1]).not.toHaveProperty('runtimeFilter'));
  });

  it('switching the data source drops the filter: its fields are the old dataset object\'s', () => {
    const next = pickDataset({ ...EXISTING, runtimeFilter: { stage: { $eq: 'won' } } }, 'other', MEMBERS);
    expect(next).not.toHaveProperty('runtimeFilter');
    // Picking the data source already bound is no switch: the filter stays.
    const same = pickDataset({ ...EXISTING, runtimeFilter: { stage: { $eq: 'won' } } }, 'pipeline', MEMBERS);
    expect(same.runtimeFilter).toEqual({ stage: { $eq: 'won' } });
  });
});

/**
 * objectstack#36722 — "Show groups with no records" (`chart.showEmptyGroups`): a switch
 * in the chart settings, offered on the chart types that draw a category per
 * group, written into the report the host saves and read back when it opens.
 */
describe('the show-groups-with-no-records switch (objectstack#36722)', () => {
  beforeEach(() => {
    ComponentRegistry.register('chart', () => <div data-testid="chart-stub" />);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const box = (value = '') => ({ value, onChange: () => {} });
  const dataSource = { queryDataset: vi.fn(async () => ({ rows: [{ stage: 'Won', total_amount: 10 }], fields: [] })) };

  /** The console host's shape: it saves the draft it holds when Save is pressed. */
  function SaveHarness({ initial, saved }: { initial: ReportDraft; saved: ReportDraft[] }) {
    const [report, setReport] = React.useState<ReportDraft>(initial);
    return (
      <ReportBuilder
        report={report}
        onChange={setReport}
        name={box(String(report.label ?? ''))}
        description={box()}
        datasets={[{ name: 'pipeline', label: 'Pipeline' }]}
        members={MEMBERS}
        onSave={() => { saved.push(report); }}
        onDiscard={() => setReport(initial)}
        onClose={() => {}}
        dirty={report !== initial}
        dataSource={dataSource}
      />
    );
  }

  it('turned on, it is in the report Save hands over; reopened, the switch reads on; off removes the key', () => {
    const saved: ReportDraft[] = [];
    const { unmount } = render(<SaveHarness initial={EXISTING} saved={saved} />);
    const toggle = screen.getByTestId('report-builder-show-empty-groups');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId('report-builder-save'));
    expect(saved).toHaveLength(1);
    expect(saved[0].chart).toEqual({ ...(EXISTING.chart as object), showEmptyGroups: true });
    expectSpecValid(saved[0]);
    unmount();

    render(<SaveHarness initial={saved[0]} saved={saved} />);
    const reopened = screen.getByTestId('report-builder-show-empty-groups');
    expect(reopened).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(reopened);
    fireEvent.click(screen.getByTestId('report-builder-save'));
    expect(saved[1].chart).toEqual(EXISTING.chart);
    expect(saved[1].chart).not.toHaveProperty('showEmptyGroups');
  });

  it('offered on bar, line and donut only; a number or a table drops the key', () => {
    render(<SaveHarness initial={setShowEmptyGroups(EXISTING, true)} saved={[]} />);
    for (const type of ['line', 'donut', 'bar']) {
      fireEvent.click(screen.getByTestId(`report-builder-chart-${type}`));
      expect(screen.getByTestId('report-builder-show-empty-groups')).toHaveAttribute('aria-checked', 'true');
    }
    fireEvent.click(screen.getByTestId('report-builder-chart-metric'));
    expect(screen.queryByTestId('report-builder-show-empty-groups')).toBeNull();
  });

  it('the model: every chart edit keeps it where it draws, and drops it where it cannot', () => {
    const on = setShowEmptyGroups(EXISTING, true);
    expect(showsEmptyGroups(on)).toBe(true);
    expect(showsEmptyGroups(pickGrouping(on, 'owner', '', MEMBERS))).toBe(true);
    expect(showsEmptyGroups(pickMeasure(on, 'deal_count', MEMBERS))).toBe(true);
    expect(showsEmptyGroups(pickChartType(on, 'line', MEMBERS))).toBe(true);
    expect(pickChartType(on, 'metric', MEMBERS).chart).not.toHaveProperty('showEmptyGroups');
    expect(pickChartType(on, 'table', MEMBERS)).not.toHaveProperty('chart');
    expect(setShowEmptyGroups(on, false).chart).toEqual(EXISTING.chart);
    // No chart to set it on: the report is returned as it is.
    const noChart = { ...EXISTING, chart: undefined };
    expect(setShowEmptyGroups(noChart, true)).toBe(noChart);
  });
});
