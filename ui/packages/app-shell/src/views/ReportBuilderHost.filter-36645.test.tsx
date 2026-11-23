// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36645 (item 1) — 「+ Filter」 under the report builder's data
 * source: the console host draws the report's `runtimeFilter` with the shared
 * `FilterConditionField` over the dataset OBJECT's fields, writes each edit
 * into the report it hands to Save, and drops the key when the last condition
 * goes.
 *
 * Real subjects: `ReportBuilderHost`, the real `ReportBuilder`, the real
 * `FilterConditionField` and `FilterBuilder`, and `reportFilterFields`. Fakes:
 * the metadata client (the dataset catalog) and the data source (the object
 * definition and the preview's query).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';

const DATASET_DOC = vi.hoisted(() => ({
  name: 'pipeline',
  label: 'Pipeline',
  object: 'opportunity',
  dimensions: [{ name: 'stage', label: 'Stage', type: 'select', field: 'stage' }],
  measures: [{ name: 'deal_count', label: 'Deals', aggregate: 'count' }],
}));

const client = vi.hoisted(() => {
  const c: Record<string, any> = {
    list: vi.fn(async () => [DATASET_DOC]),
    get: vi.fn(async () => DATASET_DOC),
  };
  c.withPreviewDrafts = () => c;
  return c;
});
vi.mock('./metadata-admin/useMetadata.js', () => ({ useMetadataClient: () => client }));

import { ReportBuilderHost } from './ReportBuilderHost';
import { reportFilterFields } from './reportFilterFields';

const OBJECT_DEF = {
  name: 'opportunity',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: { type: 'select', label: 'Stage', options: [{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }] },
    amount: { type: 'currency', label: 'Amount', currencyConfig: { mode: 'record', currencyField: 'currency' } },
    organization_id: { type: 'lookup', label: 'Organization', reference: 'sys_organization', hidden: true },
    account: { type: 'lookup', label: 'Account', reference: 'account' },
  },
};

const REPORT = {
  name: 'deals',
  label: 'Deals',
  type: 'summary',
  dataset: 'pipeline',
  values: ['deal_count'],
  chart: { type: 'metric', xAxis: '', yAxis: 'deal_count' },
};

function mount(initial: Record<string, unknown>) {
  ComponentRegistry.register('chart', () => <div data-testid="chart-stub" />);
  const onSave = vi.fn(async (_report: Record<string, unknown>) => true);
  const dataSource = {
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
    queryDataset: vi.fn(async (_dataset: string, _selection: Record<string, unknown>) => ({ rows: [{ deal_count: 3 }], fields: [] })),
  };
  render(<ReportBuilderHost initial={initial} onSave={onSave} onClose={() => {}} dataSource={dataSource as never} />);
  return { onSave, dataSource };
}

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('report-builder-save'));
  });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the report filter fields (objectstack#36645)', () => {
  it('are the object\'s own fields, minus the hidden ones, with no currency pairing', () => {
    const fields = reportFilterFields(OBJECT_DEF, (_f, fallback) => fallback, (_f, raw) => (Array.isArray(raw) ? raw : undefined));
    expect(fields.map((f) => f.value)).toEqual(['name', 'stage', 'amount', 'account']);
    // Business fields first, system fields after, as the list's Filter panel orders them.
    const withSystem = reportFilterFields(
      { fields: { created_by: { type: 'lookup', label: 'Created by', system: true }, ...OBJECT_DEF.fields } },
      (_f, fallback) => fallback,
      () => undefined,
    );
    expect(withSystem.map((f) => f.value)).toEqual(['name', 'stage', 'amount', 'account', 'created_by']);
    expect(fields.find((f) => f.value === 'stage')?.options).toEqual([{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]);
    expect(fields.find((f) => f.value === 'account')?.referenceTo).toBe('account');
    expect(fields.find((f) => f.value === 'amount')).not.toHaveProperty('currencyField');
    expect(reportFilterFields(null, (_f, d) => d, () => undefined)).toEqual([]);
  });
});

describe('「+ Filter」 under the report builder\'s data source (objectstack#36645)', () => {
  it('reads the dataset object\'s definition, and offers 「+ Filter」 while the report has none', async () => {
    const { dataSource } = mount(REPORT);
    const add = await screen.findByTestId('report-builder-filter-field-add');
    expect(add).toHaveTextContent('Filter');
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalledWith('opportunity'));
  });

  it('a condition added is saved as the report\'s runtimeFilter, and the preview redraws with it', async () => {
    const { onSave, dataSource } = mount(REPORT);
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('report-builder-filter-field-add'));
    // The popover's builder: one row, seeded on the first field (`name`, text).
    fireEvent.click(await screen.findByText('Add filter'));
    const value = await screen.findByPlaceholderText('Value');
    fireEvent.change(value, { target: { value: 'Acme' } });
    // The trigger now counts the condition.
    await waitFor(() => expect(screen.getByTestId('report-builder-filter-field-trigger')).toHaveTextContent('1 condition'));
    await waitFor(() =>
      expect(dataSource.queryDataset.mock.calls.at(-1)?.[1]).toHaveProperty('runtimeFilter', { name: { $eq: 'Acme' } }),
    );
    await save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].runtimeFilter).toEqual({ name: { $eq: 'Acme' } });
  });

  it('an existing filter opens counted; editing it saves the edit, and clearing it saves no runtimeFilter at all', async () => {
    const { onSave } = mount({ ...REPORT, runtimeFilter: { name: { $eq: 'Acme' } } });
    const trigger = await screen.findByTestId('report-builder-filter-field-trigger');
    expect(trigger).toHaveTextContent('1 condition');
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByDisplayValue('Acme'), { target: { value: 'Contoso' } });
    await save();
    expect(onSave.mock.calls.at(-1)?.[0].runtimeFilter).toEqual({ name: { $eq: 'Contoso' } });

    fireEvent.click(screen.getByText('Clear all'));
    await waitFor(() => expect(screen.getByTestId('report-builder-filter-field-add')).toBeInTheDocument());
    await save();
    expect(onSave.mock.calls.at(-1)?.[0]).not.toHaveProperty('runtimeFilter');
  });

  it('a filter the builder cannot hold is kept as saved and says so', async () => {
    const odd = { name: { $gt: 1, $lt: 9 } };
    const { onSave } = mount({ ...REPORT, runtimeFilter: odd });
    expect(await screen.findByText('This filter cannot be changed here. It is kept as saved.')).toBeInTheDocument();
    await save();
    expect(onSave.mock.calls.at(-1)?.[0].runtimeFilter).toEqual(odd);
  });
});
