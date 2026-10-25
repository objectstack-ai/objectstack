// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
// ReportPreview renders the runtime report renderer behind
// `React.lazy(() => import('@object-ui/plugin-report'))`, so nothing below the
// Suspense boundary — including the `queryDataset` call the assertions wait on —
// exists until that chunk resolves. Loading it is unbounded work: under
// full-suite parallelism Vite's transform pipeline is saturated (the `dom-heavy`
// project alone spends ~60s in transform) and the first import of the package
// graph can outlast RTL's 1000ms `waitFor`/`findBy` window. Measured under a real
// full run, this import alone took 312/424/976ms across three runs — that last
// one is 97.6% of the entire assertion budget. The assertions then raced the
// module loader and failed against the "Loading report renderer…" fallback —
// only in the first tests of the file, because later ones find the module warm.
//
// Importing it here moves that cost into the file's import phase, which no test
// or hook timeout applies to, instead of widening any assertion window. Keep the
// specifier identical to ReportPreview.tsx's — ESM caches by resolved specifier,
// so this makes the component's own `React.lazy` factory resolve immediately.
import '@object-ui/plugin-report';
import { ReportPreview } from './ReportPreview';

// Mock the data adapter the preview pulls from AdapterProvider.
const { queryDataset } = vi.hoisted(() => ({ queryDataset: vi.fn() }));
vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ queryDataset }),
}));

afterEach(() => {
  cleanup();
  queryDataset.mockReset();
});

const baseProps = { type: 'report', name: 'revenue_by_region', locale: 'en-US' as const };

const datasetReport = {
  name: 'revenue_by_region',
  label: 'Revenue by Region',
  dataset: 'sales',
  rows: ['region'],
  values: ['revenue'],
};

describe('ReportPreview — dataset-bound report (ADR-0021 single-form)', () => {
  it('runs the bound dataset (rows→dimensions, values→measures) and renders a table', async () => {
    queryDataset.mockResolvedValue({ rows: [{ region: 'finance', revenue: 450000 }, { region: 'tech', revenue: 260000 }], fields: [] });
    render(<ReportPreview {...baseProps} draft={datasetReport} />);

    await waitFor(() =>
      expect(queryDataset).toHaveBeenCalledWith('sales', { dimensions: ['region'], measures: ['revenue'] }),
    );
    expect(await screen.findByText('finance')).toBeInTheDocument();
    expect(screen.getByText('450000')).toBeInTheDocument();
    expect(screen.getByText('tech')).toBeInTheDocument();
  });

  it('shows an empty state when no measures are selected', async () => {
    render(<ReportPreview {...baseProps} draft={{ ...datasetReport, values: [] }} />);
    expect(await screen.findByText(/choose at least one measure/i)).toBeInTheDocument();
    expect(queryDataset).not.toHaveBeenCalled();
  });

  it('surfaces a dataset compile/RLS error instead of wrong numbers', async () => {
    queryDataset.mockRejectedValue(new Error('relationship "account" is not declared in the dataset'));
    render(<ReportPreview {...baseProps} draft={datasetReport} />);
    expect(await screen.findByText(/not declared in the dataset/)).toBeInTheDocument();
  });

  it('renders a matrix draft as the same cross-tab the runtime shows', async () => {
    queryDataset.mockResolvedValue({
      rows: [
        { region: 'east', stage: 'won', revenue: 100 },
        { region: 'east', stage: 'lost', revenue: 40 },
        { region: 'west', stage: 'won', revenue: 70 },
      ],
      fields: [],
    });
    render(
      <ReportPreview
        {...baseProps}
        draft={{ ...datasetReport, type: 'matrix', rows: ['region'], columns: ['stage'] }}
      />,
    );
    expect(await screen.findByTestId('dataset-matrix')).toBeInTheDocument();
    expect(queryDataset).toHaveBeenCalledWith('sales', expect.objectContaining({ dimensions: ['region', 'stage'] }));
  });

  it('forwards runtimeFilter to the dataset query', async () => {
    queryDataset.mockResolvedValue({ rows: [], fields: [] });
    render(<ReportPreview {...baseProps} draft={{ ...datasetReport, runtimeFilter: { stage: 'won' } }} />);
    await waitFor(() =>
      expect(queryDataset).toHaveBeenCalledWith('sales', { dimensions: ['region'], measures: ['revenue'], runtimeFilter: { stage: 'won' } }),
    );
  });
});

describe('ReportPreview — joined report (stacked dataset-bound blocks)', () => {
  const joinedReport = {
    name: 'open_vs_done',
    label: 'Open vs Done',
    type: 'joined',
    blocks: [
      { name: 'open', type: 'summary', dataset: 'sales', rows: ['region'], values: ['revenue'] },
    ],
  };

  it('renders joined blocks through the runtime renderer (not the "bind a dataset" empty state)', async () => {
    queryDataset.mockResolvedValue({ rows: [{ region: 'finance', revenue: 450000 }], fields: [] });
    render(<ReportPreview {...baseProps} draft={joinedReport} />);
    // The block's dataset is queried (joined carries data on blocks, not a top-level dataset)...
    await waitFor(() =>
      expect(queryDataset).toHaveBeenCalledWith('sales', expect.objectContaining({ dimensions: ['region'], measures: ['revenue'] })),
    );
    // ...and its data renders, so the author no longer designs a joined report blind.
    expect(await screen.findByText('finance')).toBeInTheDocument();
    expect(screen.queryByText(/bind a dataset to preview/i)).not.toBeInTheDocument();
  });

  it('shows a joined-aware empty state when no block is dataset-bound yet', async () => {
    render(<ReportPreview {...baseProps} draft={{ name: 'j', label: 'J', type: 'joined', blocks: [] }} />);
    expect(await screen.findByText(/add a block to preview/i)).toBeInTheDocument();
    expect(queryDataset).not.toHaveBeenCalled();
  });
});
