/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * WidgetConfigPanel authors the ADR-0021 dataset shape (framework#3251): it
 * binds a `dataset` and selects that dataset's `dimensions` / `values` by name.
 * These tests cover (a) the pure draft scrubber that guarantees no pre-ADR-0021
 * inline analytics key ever survives a save, and (b) that the panel renders the
 * dataset fields and none of the removed legacy sections.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WidgetConfigPanel, sanitizeDraftForType } from '../WidgetConfigPanel';
import type { WidgetDatasetCatalogEntry } from '../dataset-catalog';

afterEach(cleanup);

const LEGACY_KEYS = [
  'object', 'categoryField', 'categoryGranularity', 'valueField', 'aggregate',
  'aggregation', 'rowField', 'columnField', 'xAxisField', 'yAxisFields',
  'measures', 'showLegend', 'searchable', 'pagination', 'format',
];

const catalog: WidgetDatasetCatalogEntry[] = [
  {
    name: 'sales_pipeline',
    label: 'Sales Pipeline',
    dimensions: [{ name: 'stage' }, { name: 'owner' }],
    measures: [{ name: 'revenue', aggregate: 'sum' }, { name: 'deal_count', aggregate: 'count' }],
  },
];

describe('sanitizeDraftForType — scrubs the removed inline analytics shape', () => {
  it('drops every legacy key, keeping the dataset shape', () => {
    const legacy: Record<string, any> = {
      id: 'w1', type: 'bar', dataset: 'sales_pipeline', dimensions: ['stage'], values: ['revenue'],
    };
    for (const k of LEGACY_KEYS) legacy[k] = 'x';
    const out = sanitizeDraftForType(legacy);
    for (const k of LEGACY_KEYS) expect(out).not.toHaveProperty(k);
    expect(out.dataset).toBe('sales_pipeline');
    expect(out.dimensions).toEqual(['stage']);
    expect(out.values).toEqual(['revenue']);
  });

  it('drops dimensions for a metric (single-value) widget', () => {
    const out = sanitizeDraftForType({ id: 'w', type: 'metric', dataset: 'd', dimensions: ['stage'], values: ['revenue'] });
    expect(out).not.toHaveProperty('dimensions');
    expect(out.values).toEqual(['revenue']);
  });

  it('keeps dimensions for a chart widget', () => {
    const out = sanitizeDraftForType({ id: 'w', type: 'bar', dataset: 'd', dimensions: ['stage'], values: ['revenue'] });
    expect(out.dimensions).toEqual(['stage']);
  });
});

describe('WidgetConfigPanel — dataset authoring UI', () => {
  const baseConfig = { id: 'w1', type: 'bar', title: 'Revenue', dataset: 'sales_pipeline', dimensions: ['stage'], values: ['revenue'] };

  it('renders the dataset / dimensions / values fields', () => {
    render(
      <WidgetConfigPanel open onClose={vi.fn()} config={baseConfig} onSave={vi.fn()} datasets={catalog} />,
    );
    expect(screen.getByTestId('config-field-dataset')).toBeInTheDocument();
    expect(screen.getByTestId('config-field-dimensions')).toBeInTheDocument();
    expect(screen.getByTestId('config-field-values')).toBeInTheDocument();
    // The bound members render as chips.
    expect(screen.getByTestId('dataset-name-chip-stage')).toBeInTheDocument();
    expect(screen.getByTestId('dataset-name-chip-revenue')).toBeInTheDocument();
  });

  it('does not render any of the removed legacy analytics controls', () => {
    render(
      <WidgetConfigPanel open onClose={vi.fn()} config={baseConfig} onSave={vi.fn()} datasets={catalog} />,
    );
    expect(screen.queryByTestId('config-field-object')).not.toBeInTheDocument();
    expect(screen.queryByTestId('config-field-categoryField')).not.toBeInTheDocument();
    expect(screen.queryByTestId('config-field-valueField')).not.toBeInTheDocument();
    expect(screen.queryByText('Aggregation')).not.toBeInTheDocument();
  });

  it('hides the dimensions field for a metric widget', () => {
    render(
      <WidgetConfigPanel open onClose={vi.fn()} config={{ id: 'm', type: 'metric', dataset: 'sales_pipeline', values: ['revenue'] }} onSave={vi.fn()} datasets={catalog} />,
    );
    expect(screen.getByTestId('config-field-values')).toBeInTheDocument();
    expect(screen.queryByTestId('config-field-dimensions')).not.toBeInTheDocument();
  });

  it('falls back to a free-text dataset input when no catalog is supplied', () => {
    render(
      <WidgetConfigPanel open onClose={vi.fn()} config={{ id: 'w', type: 'bar', values: ['revenue'] }} onSave={vi.fn()} />,
    );
    // No catalog → the dataset field is a plain <input> (free-text) rather than
    // the catalog combobox.
    const field = screen.getByPlaceholderText('Dataset name');
    expect(field).toBeInTheDocument();
    expect(field.tagName).toBe('INPUT');
  });
});
