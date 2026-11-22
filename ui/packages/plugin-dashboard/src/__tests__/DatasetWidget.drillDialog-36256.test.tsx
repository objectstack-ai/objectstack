/**
 * objectstack-ai/objectstack#36256 — DatasetWidget itself opens its drill in
 * the dialog, with the default columns it derives: the fields the bucket is
 * grouped by, then the range fields, then the fields the measure aggregates
 * (`measuredFieldsOf(scope)`). A metric tile opens the dialog on its measure's
 * fields alone.
 *
 * The relationship-path case: a slice grouped by `crm_account.industry`
 * (HotCRM's 行业收入分布) drills on the nested condition beneath the lookup
 * field, and the default columns carry that lookup field (`crm_account`, the
 * account's name), since the list draws no dotted column.
 *
 * The drawer is a stub that records the props each open render hands it.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ComponentRegistry, chartRowBucketId } from '@object-ui/core';
import { DatasetWidget } from '../DatasetWidget';

const drawerProps: Array<Record<string, unknown>> = [];
vi.mock('../DrillDownDrawer', () => ({
  DrillDownDrawer: (props: Record<string, unknown>) => {
    if (props.open) drawerProps.push(props);
    return null;
  },
}));

let chartProps: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    chartProps = props;
    return null;
  });
});

const SCHEMAS: Record<string, any> = {
  crm_opportunity: {
    name: 'crm_opportunity',
    fields: {
      crm_account: { type: 'lookup', reference: 'crm_account', label: 'Account' },
      stage: { type: 'text', label: 'Stage' },
      close_date: { type: 'date', label: 'Close date' },
      amount: { type: 'currency' },
    },
  },
  crm_account: { name: 'crm_account', fields: { industry: { type: 'select', label: 'Industry' } } },
};

// The widget's dimension-metadata read goes through `fetch`: answered by a
// double for the whole file, so no read after a test body can reach a socket.
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  const name = String(url).split('/').pop()?.split('?')[0] ?? '';
  return { ok: true, json: async () => ({ item: SCHEMAS[name] ?? { name, fields: {} } }) };
}));

afterEach(() => {
  cleanup();
  chartProps = null;
  drawerProps.length = 0;
});

const lastOpened = () => drawerProps.filter((p) => p.filter).at(-1)!;

const source = (answer: Record<string, unknown>) => ({
  queryDataset: vi.fn(async () => ({ object: 'crm_opportunity', ...answer })),
  find: vi.fn(async () => ({ data: [] })),
  getObjectSchema: vi.fn(async (object: string) => SCHEMAS[object]),
});

describe('DatasetWidget opens its drill in the dialog (#36256)', () => {
  it('a chart mark: grouped field, then range field, then measured field', async () => {
    const src = source({
      rows: [{ stage: 'Won', revenue: 300 }],
      fields: [{ name: 'stage', type: 'string', label: 'Stage' }, { name: 'revenue', type: 'number', label: 'Revenue' }],
      dimensionFields: { stage: 'stage' },
      drillScopes: { revenue: { amount: { $null: false } } },
      drillRawRows: [{ stage: 'won' }],
      drillRanges: [{ close_month: { field: 'close_date', gte: '2026-07-01', lt: '2026-10-01' } }],
    });
    render(<DatasetWidget widget={{ type: 'bar', dataset: 'opps', dimensions: ['stage'], values: ['revenue'] }} dataSource={src} />);
    await waitFor(() => expect(chartProps?.schema?.data?.length).toBe(1));
    const row = chartProps.schema.data[0];
    chartProps.onSegmentClick({ category: String(row.stage), categoryId: chartRowBucketId(row) });
    await waitFor(() => expect(drawerProps.some((p) => p.filter)).toBe(true));
    const opened = lastOpened();
    expect(opened.target).toBe('dialog');
    expect(opened.open).toBe(true);
    expect(opened.defaultColumns).toEqual(['stage', 'close_date', 'amount']);
  });

  it("a metric tile: the measure's fields", async () => {
    const src = source({
      rows: [{ total_amount: 814400 }],
      fields: [{ name: 'total_amount', type: 'number', label: 'Total Amount', aggregate: 'sum' }],
      drillScopes: { total_amount: { amount: { $null: false } } },
    });
    render(<DatasetWidget widget={{ type: 'metric', dataset: 'opportunity_metrics', values: ['total_amount'] }} dataSource={src} />);
    fireEvent.click(await screen.findByTestId('dataset-metric-drill'));
    await waitFor(() => expect(drawerProps.some((p) => p.filter)).toBe(true));
    const opened = lastOpened();
    expect(opened.target).toBe('dialog');
    expect(opened.open).toBe(true);
    expect(opened.defaultColumns).toEqual(['amount']);
  });

  it('a relationship-path slice: the nested condition, with crm_account and the measured field as columns', async () => {
    const src = source({
      rows: [{ account_industry: 'Technology', revenue: 300 }],
      fields: [{ name: 'account_industry', type: 'string', label: 'Account Industry' }, { name: 'revenue', type: 'number', label: 'Revenue' }],
      dimensionFields: { account_industry: 'crm_account.industry' },
      drillScopes: { revenue: { amount: { $null: false } } },
      drillRawRows: [{ account_industry: 'technology' }],
    });
    render(<DatasetWidget widget={{ type: 'pivot', dataset: 'opps', dimensions: ['account_industry'], values: ['revenue'] }} dataSource={src} />);
    fireEvent.click(await screen.findByTestId('dataset-drill-row'));
    await waitFor(() => expect(drawerProps.some((p) => p.filter)).toBe(true));
    const opened = lastOpened();
    expect(JSON.stringify(opened.filter)).toContain('{"crm_account":{"industry":"technology"}}');
    expect(opened.target).toBe('dialog');
    expect(opened.defaultColumns).toEqual(['crm_account', 'amount']);
  });
});
