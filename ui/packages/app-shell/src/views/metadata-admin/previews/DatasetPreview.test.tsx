// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
// DatasetPreview renders its chart behind
// `React.lazy(() => import('@object-ui/plugin-charts'))`, and the "use the right
// axis" caption asserted on below lives *inside* that Suspense boundary — so it
// only exists once the (recharts-backed) chunk resolves. Loading it is unbounded
// work: under full-suite parallelism Vite's transform pipeline is saturated and
// the first import of the package graph can outlast RTL's 1000ms
// `waitFor`/`findBy` window. The earlier tests in this file assert on the table,
// which renders *outside* the boundary, so they start the import but never wait
// for it — leaving the ratio-measure test to race a load already in flight.
//
// Importing it here moves that cost into the file's import phase, which no test
// or hook timeout applies to, instead of widening any assertion window. Keep the
// specifier identical to DatasetPreview.tsx's — ESM caches by resolved specifier,
// so this makes the component's own `React.lazy` factory resolve immediately.
import '@object-ui/plugin-charts';
import { DatasetPreview } from './DatasetPreview';

// Mock the data adapter the preview pulls from AdapterProvider.
const { queryDataset } = vi.hoisted(() => ({ queryDataset: vi.fn() }));
vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ queryDataset }),
}));

/**
 * objectui#8187 — the preview now resolves its dimensions' option labels
 * through the shared label net, which issues `GET /api/v1/meta/object/<name>`.
 * happy-dom resolves that relative URL against `localhost:3000`, so without a
 * double every test here reaches a real socket and the network-escape guard
 * (objectui#6640) fails the file.
 *
 * The double serves the base object with NO select options, which is what these
 * cases have always assumed: nothing resolves, `relabelDimensions` returns the
 * server's rows by identity, and every assertion below is byte-identical to
 * what it pinned before that card. Label resolution itself is pinned in
 * `__tests__/DatasetPreview.dimensionLabels-8187.test.tsx`, not here.
 */
const realFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ item: { name: 'opportunity', fields: {} } }),
  })) as any;
});

afterEach(() => {
  cleanup();
  queryDataset.mockReset();
  global.fetch = realFetch;
});

const baseProps = { type: 'dataset', name: 'sales', locale: 'en-US' as const };

const draft = {
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

describe('DatasetPreview', () => {
  it('auto-runs the draft and renders the result table', async () => {
    queryDataset.mockResolvedValue({ rows: [{ region: 'NA', revenue: 100 }, { region: 'EU', revenue: 50 }], fields: [] });
    render(<DatasetPreview {...baseProps} draft={draft} />);

    // Posted the inline draft + derived selection.
    await waitFor(() => expect(queryDataset).toHaveBeenCalledWith(draft, { dimensions: ['region'], measures: ['revenue'] }));
    // Rows render.
    expect(await screen.findByText('NA')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('EU')).toBeInTheDocument();
  });

  it('renders display labels for headers and currency-formatted measures', async () => {
    queryDataset.mockResolvedValue({
      rows: [{ region: 'NA', revenue: 1000 }],
      object: 'opportunity',
      fields: [
        { name: 'region', type: 'string', label: 'Region' },
        { name: 'revenue', type: 'number', label: 'Revenue', format: '0,0', currency: 'USD' },
      ],
    });
    render(<DatasetPreview {...baseProps} draft={draft} />);
    // Headers use the server field label, not the raw dimension/measure name.
    expect(await screen.findByRole('columnheader', { name: 'Region' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Revenue' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'revenue' })).not.toBeInTheDocument();
    // Amount carries the declared currency symbol (never a bare number).
    expect(screen.getByText('$1,000')).toBeInTheDocument();
  });

  it('formats an amount with no declared currency as a plain number (no $)', async () => {
    queryDataset.mockResolvedValue({
      rows: [{ region: 'NA', revenue: 1234 }],
      object: 'opportunity',
      fields: [
        { name: 'region', type: 'string', label: 'Region' },
        { name: 'revenue', type: 'number', label: 'Revenue', format: '0,0' },
      ],
    });
    render(<DatasetPreview {...baseProps} draft={draft} />);
    expect(await screen.findByText('1,234')).toBeInTheDocument();
    expect(screen.queryByText('$1,234')).not.toBeInTheDocument();
  });

  it('surfaces a server/compile error as an alert (no silent fallback)', async () => {
    queryDataset.mockRejectedValue(new Error('relationship "account" is not declared in the dataset\'s `include`'));
    render(<DatasetPreview {...baseProps} draft={draft} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not declared/);
  });

  // objectstack#3891 retired the framework's degraded analytics fallback, so a
  // deployment without @objectstack/service-analytics can't run dataset
  // previews at all. That is a missing capability, not a mistake in the dataset
  // the author is editing — so it must NOT read as a red "your draft is broken"
  // alert.
  it('shows a "capability not installed" empty state, not an error alert', async () => {
    const err = Object.assign(
      new Error('Analytics capability is not installed on this deployment — POST /analytics/dataset/query is unavailable.'),
      { code: 'ANALYTICS_NOT_INSTALLED' },
    );
    queryDataset.mockRejectedValue(err);
    render(<DatasetPreview {...baseProps} draft={draft} />);

    expect(await screen.findByText(/Analytics capability not installed/i)).toBeInTheDocument();
    // Names the fix, and does not blame the draft.
    expect(screen.getByText(/@objectstack\/service-analytics/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('prompts to add a measure when none are defined', () => {
    render(<DatasetPreview {...baseProps} draft={{ ...draft, measures: [] }} />);
    expect(screen.getByText(/Add a measure/i)).toBeInTheDocument();
    expect(queryDataset).not.toHaveBeenCalled();
  });

  it('prompts to pick a base object when object is missing', () => {
    render(<DatasetPreview {...baseProps} draft={{ ...draft, object: undefined }} />);
    expect(screen.getByText(/Pick a base object/i)).toBeInTheDocument();
    expect(queryDataset).not.toHaveBeenCalled();
  });
  it('plots a ratio measure on a secondary (right) axis when scales are mixed', async () => {
    queryDataset.mockResolvedValue({
      rows: [{ region: 'NA', revenue: 600000, rate: 0.7 }],
      object: 'opportunity',
      fields: [
        { name: 'region', type: 'string' },
        { name: 'revenue', type: 'number', format: '0,0', currency: 'USD' },
        { name: 'rate', type: 'number', format: '0.0%' },
      ],
    });
    const mixedDraft = {
      ...draft,
      measures: [
        { name: 'revenue', aggregate: 'sum', field: 'amount' },
        { name: 'rate', derived: { op: 'ratio', of: ['revenue', 'revenue'] } },
      ],
    };
    render(<DatasetPreview {...baseProps} draft={mixedDraft} />);
    // The ratio measure (percent-formatted) is moved to the right axis — surfaced
    // by the caption (combo chart). A same-scale selection shows no such note.
    expect(await screen.findByText(/use the right axis/)).toBeInTheDocument();
  });

});
