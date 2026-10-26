// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Stub the catalog hooks so the inspector renders without a MetadataClient /
// network. The pickers fall back to showing the raw committed value, which is
// all these structural assertions need.
vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({ relationships: [], fieldOptions: [], loading: false }),
  useDatasetUsage: () => ({ reports: 0, dashboards: 0, loading: false }),
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));

import { DatasetDefaultInspector, objectChangePatch } from './DatasetDefaultInspector';

afterEach(cleanup);

const baseProps = { type: 'dataset', name: 'sales', locale: 'en-US' as const };

const draft = {
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

describe('DatasetDefaultInspector', () => {
  it('renders the structured designer (object / dimension / measure rows)', () => {
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={vi.fn()} readOnly={false} />);
    // Base object + included relationship now render as combo triggers showing
    // the committed value (catalog is empty in this test); the value also
    // surfaces in the join-path hint, so assert presence rather than uniqueness.
    expect(screen.getAllByText('opportunity').length).toBeGreaterThan(0);
    expect(screen.getAllByText('account').length).toBeGreaterThan(0);
    expect(screen.getByText('Base object')).toBeInTheDocument();
    expect(screen.getByText('Dimension 1')).toBeInTheDocument();
    expect(screen.getByText('Measure 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('region')).toBeInTheDocument(); // dimension name input
    expect(screen.getByDisplayValue('revenue')).toBeInTheDocument(); // measure name input
  });

  it('adds a measure via onPatch', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
    fireEvent.click(screen.getByText('Add measure'));
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0];
    expect(patch.measures).toHaveLength(2);
    expect(patch.measures[1]).toMatchObject({ aggregate: 'sum' });
  });

  it('adds a dimension via onPatch', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
    fireEvent.click(screen.getByText('Add dimension'));
    expect(onPatch.mock.calls[0][0].dimensions).toHaveLength(2);
  });

  it('edits a measure name through onPatch', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
    fireEvent.change(screen.getByDisplayValue('revenue'), { target: { value: 'total_revenue' } });
    expect(onPatch).toHaveBeenCalledWith({ measures: [expect.objectContaining({ name: 'total_revenue' })] });
  });

  it('removes the measure row', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove measure' }));
    expect(onPatch).toHaveBeenCalledWith({ measures: [] });
  });

  it('toggles a derived measure on via the advanced disclosure', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={onPatch} readOnly={false} />);
    fireEvent.click(screen.getByText('Derived — computed from other measures'));
    expect(onPatch).toHaveBeenCalledWith({
      measures: [expect.objectContaining({ name: 'revenue', derived: { op: 'ratio', of: [] } })],
    });
  });

  it('hides add/remove affordances when readOnly', () => {
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={vi.fn()} readOnly={true} />);
    expect(screen.queryByText('Add measure')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('warns at author time when a dimension uses a relationship.field whose join is not included', () => {
    const onPatch = vi.fn();
    const d2 = { ...draft, include: [], dimensions: [{ name: 'region', field: 'account.region', type: 'string' }] };
    render(<DatasetDefaultInspector {...baseProps} draft={d2} onPatch={onPatch} readOnly={false} />);
    expect(screen.getByText(/isn't in Included relationships/)).toBeInTheDocument();
    // The one-click "Add it" affordance declares the missing join.
    fireEvent.click(screen.getByText('Add it'));
    expect(onPatch).toHaveBeenCalledWith({ include: ['account'] });
  });

  it('offers a structured format picker instead of a raw numeral-string field', () => {
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={vi.fn()} readOnly={false} />);
    // Measure Advanced now renders the kind/decimals picker…
    expect(screen.getByText('Display format')).toBeInTheDocument();
    // …and no longer the free-text "$0,0.00" numeral field.
    expect(screen.queryByPlaceholderText('$0,0.00')).not.toBeInTheDocument();
  });

  it('shows an editable Name field in create mode (empty name) that slugs from the label', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector {...baseProps} name="" draft={{ object: 'opportunity', dimensions: [], measures: [] }} onPatch={onPatch} readOnly={false} />);
    expect(screen.getByPlaceholderText('snake_case identifier')).toBeInTheDocument();
    // Typing the Name commits a snake_case identifier.
    fireEvent.change(screen.getByPlaceholderText('snake_case identifier'), { target: { value: 'Win Rate' } });
    expect(onPatch).toHaveBeenCalledWith({ name: 'win_rate' });
  });

  it('hides the create-mode Name field once the dataset has a name (edit mode)', () => {
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={vi.fn()} readOnly={false} />);
    expect(screen.queryByPlaceholderText('snake_case identifier')).not.toBeInTheDocument();
  });

  it('does not surface a Certified toggle (governance flag is unwired/dead — no fake stamp)', () => {
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={vi.fn()} readOnly={false} />);
    expect(screen.queryByText('Certified')).not.toBeInTheDocument();
  });

  it('exposes a dataset Scope filter and a per-measure filter editor', () => {
    render(<DatasetDefaultInspector {...baseProps} draft={draft} onPatch={vi.fn()} readOnly={false} />);
    expect(screen.getByText('Scope filter')).toBeInTheDocument();
    expect(screen.getByText('Filter (measure-scoped)')).toBeInTheDocument();
  });
});

describe('objectChangePatch (re-base on base-object change)', () => {
  it('clears object-dependent config (include/dimensions/measures/filter) when the object changes', () => {
    expect(objectChangePatch('showcase_account', 'showcase_project')).toEqual({
      object: 'showcase_account', include: [], dimensions: [], measures: [], filter: undefined,
    });
  });
  it('is a no-op (only sets object) when the object is unchanged', () => {
    expect(objectChangePatch('showcase_project', 'showcase_project')).toEqual({ object: 'showcase_project' });
  });
});
