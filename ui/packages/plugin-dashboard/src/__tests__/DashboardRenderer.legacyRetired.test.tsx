/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Graceful fallback for retired pre-ADR-0021 inline-analytics widgets
 * (framework#3320). The renderer no longer emits the object-bound
 * metric/chart/pivot/table/list branches. A widget that still carries the
 * inline shape in stored metadata — top-level `object` (+ `categoryField` /
 * `valueField` / `aggregate`), no `dataset`, no inline `options.data` — must
 * render a VISIBLE error placeholder prompting a rebind, not a blank widget.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardRenderer } from '../DashboardRenderer';

afterEach(cleanup);

describe('DashboardRenderer retired legacy widgets', () => {
  // `object` is no longer part of DashboardWidgetSchema — cast to mimic stored
  // legacy metadata that predates the ADR-0021 dataset shape.
  const legacyWidget = (extra: Record<string, unknown>) => ({ id: 'w1', ...extra } as any);

  it.each([
    ['chart', { type: 'bar', object: 'invoices', categoryField: 'month', valueField: 'amount', aggregate: 'sum' }],
    ['metric', { type: 'metric', object: 'invoices', aggregate: 'count' }],
    ['pivot', { type: 'pivot', object: 'invoices', rowField: 'region', valueField: 'amount' }],
    ['table', { type: 'table', object: 'invoices' }],
  ])('renders a visible placeholder for a legacy %s widget', (_kind, widget) => {
    const schema: DashboardComponentSchema = { type: 'dashboard', widgets: [legacyWidget(widget)] };
    render(<DashboardRenderer schema={schema} />);
    expect(screen.getByText(/retired data format/i)).toBeInTheDocument();
  });

  it('does NOT show the placeholder for a dataset-bound widget', () => {
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [{ id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] }],
    };
    render(<DashboardRenderer schema={schema} dataSource={{ queryDataset: async () => ({ rows: [] }) }} />);
    expect(screen.queryByText(/retired data format/i)).not.toBeInTheDocument();
  });

  it('does NOT show the placeholder for a static options.data widget', () => {
    const schema: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [{ id: 'w1', type: 'bar', options: { data: [{ name: 'A', value: 1 }] } }],
    };
    render(<DashboardRenderer schema={schema} />);
    expect(screen.queryByText(/retired data format/i)).not.toBeInTheDocument();
  });
});
