// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog';

afterEach(cleanup);

// One fetch double at MODULE scope, never torn down (objectui#7439 / #6640).
// `useDatasetSemantics` hydrates a bound dataset the catalog does not carry
// with `client.get('dataset', name)`, and happy-dom resolves that relative URL
// to a live socket on localhost:3000. The read is fire-and-forget — no barrier
// in the test body awaits it — so an `afterEach` teardown would restore the
// real fetch while the tree is still mounted. Installing it here means no test
// in this file can ever end with the real fetch back in place.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

// ADR-0021 single-form: the catalog override short-circuits the dataset
// fetches so the inspector renders with zero context / transport dependency.
const catalog: DatasetCatalogEntry[] = [
  {
    name: 'sales_metrics',
    label: 'Sales metrics',
    dimensions: [
      { name: 'stage', type: 'text' },
      { name: 'close_quarter', type: 'date' },
    ],
    measures: [
      { name: 'total_amount', aggregate: 'sum' },
      { name: 'deal_count', aggregate: 'count' },
    ],
  },
];

const baseProps = {
  type: 'report',
  name: 'pipeline',
  locale: 'en-US' as const,
  onSelectionChange: vi.fn(),
  datasetCatalogOverride: catalog,
};

function labelledInput(label: string): HTMLInputElement {
  const lab = screen.getByText(label);
  const input = lab.parentElement!.querySelector('input, textarea');
  return input as HTMLInputElement;
}

const datasetDraft = {
  name: 'pipeline',
  label: 'Pipeline',
  type: 'summary',
  dataset: 'sales_metrics',
  rows: ['stage'],
  values: ['total_amount'],
};

describe('ReportDefaultInspector — dataset binding (9.0 single form)', () => {
  it('renders the curated report home (label / type / dataset / values / rows)', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(labelledInput('Label').value).toBe('Pipeline');
    expect(screen.getByText('Dataset')).toBeInTheDocument();
    // The bound measure and dimension rows show.
    expect(screen.getByText('Values (measures)')).toBeInTheDocument();
    expect(screen.getByText('total_amount')).toBeInTheDocument();
    expect(screen.getByText('Rows (dimensions)')).toBeInTheDocument();
    expect(screen.getByText('stage')).toBeInTheDocument();
  });

  it('commits label edits via onPatch', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.change(labelledInput('Label'), { target: { value: 'Pipeline 2' } });
    expect(onPatch).toHaveBeenCalledWith({ label: 'Pipeline 2' });
  });

  it('adds a measure from the dataset catalog via the values picker', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    // Two add-popovers (values + rows) — open the first (values).
    const addButtons = screen.getAllByText(/add field/i);
    fireEvent.click(addButtons[0]);
    // The popover item shows the measure's label ('deal_count · count').
    fireEvent.click(screen.getByText('deal_count · count'));
    expect(onPatch).toHaveBeenCalledWith({ values: ['total_amount', 'deal_count'] });
  });

  it('removes a dimension via its row remove button', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove stage' }));
    expect(onPatch).toHaveBeenCalledWith({ rows: [] });
  });

  it('matrix reports get a Columns (across) editor fed by dataset dimensions', () => {
    const onPatch = vi.fn();
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft, type: 'matrix', columns: ['close_quarter'] }}
        onPatch={onPatch}
        readOnly={false}
      />,
    );
    expect(screen.getByText('Columns (across dimensions)')).toBeInTheDocument();
    expect(screen.getByText('close_quarter')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove close_quarter' }));
    expect(onPatch).toHaveBeenCalledWith({ columns: [] });
  });

  it('non-matrix reports hide the Columns (across) editor', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(screen.queryByText('Columns (across dimensions)')).not.toBeInTheDocument();
  });

  it('falls back to a manual dataset input when the catalog is empty', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        datasetCatalogOverride={[]}
        draft={{ name: 'pipeline', label: 'Pipeline', type: 'summary' }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    const input = labelledInput('Dataset');
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
  });

  it('hides the dataset binding for joined reports (blocks carry the data)', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ name: 'multi', label: 'Multi', type: 'joined', blocks: [] }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(screen.queryByText('Dataset')).not.toBeInTheDocument();
    expect(screen.queryByText('Values (measures)')).not.toBeInTheDocument();
  });

  it('renders Chinese labels under zh-CN', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        locale={'zh-CN'}
        draft={{ ...datasetDraft, label: '管道' }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(screen.getByText('报表类型')).toBeInTheDocument();
    expect(screen.getByText('数据集')).toBeInTheDocument();
  });

  it('disables inputs when readOnly', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft }}
        onPatch={vi.fn()}
        readOnly
      />,
    );
    expect(labelledInput('Label')).toBeDisabled();
  });
});

/**
 * objectui#8488 — one of the 42 call sites that never hand-rolled the rule.
 *
 * `datasetName` is offered against `datasetOptions`, so a dataset dropped from
 * the catalog used to leave the binding BLANK — a report that reads as "no
 * dataset bound" while `dataset: 'retired_dataset'` sits in the draft. This
 * inspector wrote no repair of its own; it inherits `InspectorSelectField`'s.
 *
 * The pin reads the trigger's text, not `datasetOptions`: the bug's whole shape
 * was a correct `value` prop that reached no pixels.
 */
describe('ReportDefaultInspector — a dataset the catalog no longer lists (objectui#8488)', () => {
  const datasetTrigger = () => screen.getByRole('combobox', { name: 'Dataset' });

  it('shows the stored dataset name, flagged, instead of a blank binding', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft, dataset: 'retired_dataset' }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(
      datasetTrigger().textContent,
      'the binding names what it is bound to, even though the catalog dropped it',
    ).toBe('retired_dataset (not found)');
  });

  it('still shows a catalogued dataset by its own label — the flag is not unconditional', () => {
    render(
      <ReportDefaultInspector
        {...baseProps}
        draft={{ ...datasetDraft }}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    // `datasetOptions` labels a catalogued dataset `LABEL (NAME)`; the point of
    // the case is the absence of the flag, not the label's own spelling.
    expect(datasetTrigger().textContent).toBe('Sales metrics (sales_metrics)');
    expect(screen.queryByText(/not found/), 'nothing is flagged').toBeNull();
  });
});
