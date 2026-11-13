// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
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

/**
 * A member's business vocabulary (ADR-0149 D1) is authorable in the designer:
 * this inspector replaces the spec's `datasetForm`, so it draws the form's
 * `synonyms` and `description` row properties itself, with the form's own
 * label and help text. The harness holds the draft the way the host does
 * (each patch merged onto it), so every pin reads the edit back from the draft
 * the save would send.
 */
describe('DatasetDefaultInspector member vocabulary (synonyms + description)', () => {
  type Draft = Record<string, unknown>;
  type Member = Record<string, unknown>;

  function renderHeld(initial: Draft, locale: 'en-US' | 'zh-CN' = 'en-US') {
    const held = { current: initial };
    const onPatch = vi.fn();
    function Host() {
      const [d, setD] = React.useState<Draft>(initial);
      return (
        <DatasetDefaultInspector
          {...baseProps}
          locale={locale}
          draft={d}
          readOnly={false}
          onPatch={(patch: Draft) => {
            onPatch(patch);
            setD((prev) => {
              held.current = { ...prev, ...patch };
              return held.current;
            });
          }}
        />
      );
    }
    render(<Host />);
    return { held, onPatch };
  }
  const measure0 = (d: Draft) => (d.measures as Member[])[0];
  const dimension0 = (d: Draft) => (d.dimensions as Member[])[0];

  const vocabDraft: Draft = {
    ...draft,
    dimensions: [{ name: 'region', field: 'account.region', type: 'string', synonyms: ['area', '区域'], description: 'Sales territory of the account.' }],
    measures: [{ name: 'invoice_count', aggregate: 'count', synonyms: ['bill count', '账单数'], description: 'Number of invoices issued.' }],
  };

  it('a measure row shows Synonyms and Description prefilled from the stored dataset, with the limit help text', () => {
    renderHeld(vocabDraft);
    expect(screen.getByTestId('dataset-measures-synonyms')).toHaveValue('bill count, 账单数');
    expect(screen.getByTestId('dataset-measures-description')).toHaveValue('Number of invoices issued.');
    expect(screen.getAllByText('Synonyms')).toHaveLength(2);
    expect(screen.getAllByText('Description').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/this measure in a question .*At most 20, each at most 60 characters/)).toBeInTheDocument();
    expect(screen.getByText(/what this measure is and when to use it.*At most 500 characters/)).toBeInTheDocument();
  });

  it('a dimension row shows Synonyms and Description prefilled from the stored dataset, with the limit help text', () => {
    renderHeld(vocabDraft);
    expect(screen.getByTestId('dataset-dimensions-synonyms')).toHaveValue('area, 区域');
    expect(screen.getByTestId('dataset-dimensions-description')).toHaveValue('Sales territory of the account.');
    expect(screen.getByText(/this dimension in a question .*At most 20, each at most 60 characters/)).toBeInTheDocument();
    expect(screen.getByText(/what this dimension is and when to use it.*At most 500 characters/)).toBeInTheDocument();
  });

  it('an edit to a measure saves both keys on the member (read back from the draft)', () => {
    const { held } = renderHeld(vocabDraft);
    fireEvent.change(screen.getByTestId('dataset-measures-synonyms'), { target: { value: 'bill count, 账单数， invoices' } });
    fireEvent.change(screen.getByTestId('dataset-measures-description'), { target: { value: 'Invoices issued in the period.' } });
    expect(measure0(held.current)).toEqual({
      name: 'invoice_count',
      aggregate: 'count',
      synonyms: ['bill count', '账单数', 'invoices'],
      description: 'Invoices issued in the period.',
    });
    // The dimension was not touched.
    expect(dimension0(held.current)).toEqual((vocabDraft.dimensions as Member[])[0]);
  });

  it('an edit to a dimension saves both keys on the member (read back from the draft)', () => {
    const { held } = renderHeld({ ...draft });
    fireEvent.change(screen.getByTestId('dataset-dimensions-synonyms'), { target: { value: 'territory, 区域' } });
    fireEvent.change(screen.getByTestId('dataset-dimensions-description'), { target: { value: 'Where the account sits.' } });
    expect(dimension0(held.current)).toEqual({
      name: 'region',
      field: 'account.region',
      type: 'string',
      synonyms: ['territory', '区域'],
      description: 'Where the account sits.',
    });
  });

  it('keeps a trailing separator on screen without writing until the list changes', () => {
    const { held, onPatch } = renderHeld(vocabDraft);
    const box = screen.getByTestId('dataset-measures-synonyms');
    fireEvent.change(box, { target: { value: 'bill count, 账单数, ' } });
    expect(box).toHaveValue('bill count, 账单数, ');
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: 'bill count, 账单数, inv' } });
    expect(box).toHaveValue('bill count, 账单数, inv');
    expect(measure0(held.current).synonyms).toEqual(['bill count', '账单数', 'inv']);
  });

  it('CONTROL: a member without vocabulary saves unchanged when another of its fields is edited', () => {
    const { held } = renderHeld({ ...draft });
    fireEvent.change(screen.getByDisplayValue('revenue'), { target: { value: 'total_revenue' } });
    expect(measure0(held.current)).toEqual({ name: 'total_revenue', aggregate: 'sum', field: 'amount' });
    expect(dimension0(held.current)).toEqual({ name: 'region', field: 'account.region', type: 'string' });
  });

  it('clearing both boxes removes the keys rather than storing [] or an empty string', () => {
    const { held } = renderHeld(vocabDraft);
    fireEvent.change(screen.getByTestId('dataset-measures-synonyms'), { target: { value: ' , ' } });
    fireEvent.change(screen.getByTestId('dataset-measures-description'), { target: { value: '' } });
    expect(measure0(held.current)).toEqual({ name: 'invoice_count', aggregate: 'count' });
    expect('synonyms' in measure0(held.current)).toBe(false);
    expect('description' in measure0(held.current)).toBe(false);
  });

  it('writes a duplicate or over-limit list as typed, leaving the verdict to the save', () => {
    const { held } = renderHeld(vocabDraft);
    const long = 'x'.repeat(61);
    fireEvent.change(screen.getByTestId('dataset-measures-synonyms'), { target: { value: `region, region, ${long}` } });
    expect(measure0(held.current).synonyms).toEqual(['region', 'region', long]);
  });

  it('edits only the active locale entry of an inline description map, in the zh designer with the spec copy localized', () => {
    const mapped: Draft = {
      ...draft,
      measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', description: { en: 'Closed-won amount.', 'zh-CN': '赢单金额。' } }],
    };
    const { held } = renderHeld(mapped, 'zh-CN');
    expect(screen.getAllByText('同义词')).toHaveLength(2);
    expect(screen.getByText(/这个度量的叫法.*最多 20 个，每个最多 60 个字符/)).toBeInTheDocument();
    const box = screen.getByTestId('dataset-measures-description');
    expect(box).toHaveValue('赢单金额。');
    fireEvent.change(box, { target: { value: '已赢单金额合计。' } });
    expect(measure0(held.current).description).toEqual({ en: 'Closed-won amount.', 'zh-CN': '已赢单金额合计。' });
    fireEvent.change(box, { target: { value: '' } });
    expect(measure0(held.current).description).toEqual({ en: 'Closed-won amount.' });
  });
});
