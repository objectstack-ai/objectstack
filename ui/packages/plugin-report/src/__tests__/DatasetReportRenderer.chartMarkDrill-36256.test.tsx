/**
 * objectstack-ai/objectstack#36256 item 2 — a report's chart mark drills, and
 * a bar opens the same records as the summary line it stands for: both go
 * through one drill builder, with the same object filter and the same default
 * fields (the grouped field and the measured one).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

let chartProps: Record<string, any> | null = null;

function makeSource() {
  return {
    queryDataset: vi.fn(async () => ({
      rows: [{ stage: 'Negotiation', total_amount: 30 }, { stage: 'Prospecting', total_amount: 10 }],
      object: 'opportunity',
      dimensionFields: { stage: 'stage' },
      drillRawRows: [{ stage: 'negotiation' }, { stage: 'prospecting' }],
      drillScopes: { total_amount: { amount: { $null: false } } },
    })),
  };
}

beforeEach(() => {
  chartProps = null;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  ComponentRegistry.register('chart', (props: any) => {
    chartProps = props;
    return null;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const report = {
  name: 'opps_by_stage',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['total_amount'],
  chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount' },
};

describe('a report chart mark drills like its table line (#36256)', () => {
  it('emits the same drill for the bar and the summary line', async () => {
    const onDrill = vi.fn();
    render(<DatasetReportRenderer report={report} dataSource={makeSource()} onDrill={onDrill} />);
    await waitFor(() => expect(chartProps?.onChartClick).toBeTypeOf('function'));
    act(() => chartProps!.onChartClick({ category: 'Negotiation', series: 'total_amount' }));

    const rows = await screen.findAllByTestId('dataset-drill-row');
    fireEvent.click(rows.find((r) => r.textContent?.includes('Negotiation'))!);

    expect(onDrill).toHaveBeenCalledTimes(2);
    const [bar, line] = onDrill.mock.calls.map((c) => c[0]);
    expect(bar.object).toBe('opportunity');
    expect(bar.objectFilter).toEqual(line.objectFilter);
    expect(JSON.stringify(bar.objectFilter)).toContain('negotiation');
    expect(bar.fields).toEqual(['stage', 'amount']);
    expect(line.fields).toEqual(bar.fields);
  });

  it("a relationship-path bucket drills on the nested condition with its lookup field as the column", async () => {
    const onDrill = vi.fn();
    const pathSource = {
      queryDataset: vi.fn(async () => ({
        rows: [{ industry: 'Technology', total_amount: 30 }],
        object: 'opportunity',
        dimensionFields: { industry: 'crm_account.industry' },
        drillRawRows: [{ industry: 'technology' }],
        drillScopes: { total_amount: { amount: { $null: false } } },
      })),
      find: vi.fn(async () => ({ data: [] })),
      getObjectSchema: vi.fn(async (object: string) => (object === 'opportunity'
        ? { fields: { crm_account: { type: 'lookup', reference: 'crm_account' }, amount: { type: 'currency' } } }
        : { fields: { industry: { type: 'select' } } })),
    };
    render(<DatasetReportRenderer report={{ ...report, rows: ['industry'], chart: { type: 'bar', xAxis: 'industry', yAxis: 'total_amount' } }} dataSource={pathSource} onDrill={onDrill} />);
    fireEvent.click(await screen.findByTestId('dataset-drill-row'));
    await waitFor(() => expect(onDrill).toHaveBeenCalled());
    const [args] = onDrill.mock.calls[0];
    expect(JSON.stringify(args.objectFilter)).toContain('{"crm_account":{"industry":"technology"}}');
    expect(args.fields).toEqual(['crm_account', 'amount']);
  });

  it('offers no click when the report turns drill off', async () => {
    render(<DatasetReportRenderer report={{ ...report, drilldown: false }} dataSource={makeSource()} onDrill={vi.fn()} />);
    await waitFor(() => expect(chartProps).not.toBeNull());
    expect(chartProps!.onChartClick).toBeUndefined();
  });
});
