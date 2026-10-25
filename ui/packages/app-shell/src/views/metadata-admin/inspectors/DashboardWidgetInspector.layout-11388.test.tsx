// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11388 — the Studio widget inspector's width / height inputs write a
 * whole four-number `layout`.
 *
 * Studio adds a widget with NO `layout` (the grid auto-places it). The inputs
 * edit one dimension each, and used to spread that one number onto the absent
 * box, storing `{ w }` or `{ h }`, which `@objectstack/spec`'s
 * `DashboardWidgetSchema` refuses. Each case parses the widget the inspector
 * hands `onPatch` with the spec's own schema.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';
import type { DashboardWidgetSchema } from '@object-ui/types';

// Network-free catalog, as in `DashboardWidgetInspector.test.tsx`.
vi.mock('../previews/useDatasetCatalog', () => ({
  useDatasetCatalog: () => ({
    datasets: [{ name: 'sales_pipeline', label: 'Sales Pipeline', dimensions: [], measures: [] }],
    loading: false,
    error: null,
  }),
  useDatasetSemantics: () => ({
    dimensions: [{ name: 'stage', type: 'string' }],
    measures: [{ name: 'revenue', aggregate: 'sum' }],
    loading: false,
    error: null,
  }),
}));

import { DashboardWidgetInspector } from './DashboardWidgetInspector';

afterEach(cleanup);

// Spec-valid apart from `layout`, so a refusal below is the layout's.
const bound = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'bar',
  title: id,
  dataset: 'sales_pipeline',
  dimensions: ['stage'],
  values: ['revenue'],
  ...extra,
});

function renderInspector(widgets: Record<string, unknown>[], selectedId: string) {
  const onPatch = vi.fn();
  render(
    <DashboardWidgetInspector
      type="dashboard"
      name="sales"
      locale="en-US"
      readOnly={false}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      draft={{ widgets }}
      selection={{ kind: 'widget', id: selectedId }}
      onPatch={onPatch}
    />,
  );
  return onPatch;
}

/** The selected widget from the last `onPatch({ widgets })`. */
function patchedWidget(onPatch: ReturnType<typeof vi.fn>, id: string): DashboardWidgetSchema {
  const calls = onPatch.mock.calls;
  const { widgets } = calls[calls.length - 1][0] as { widgets: DashboardWidgetSchema[] };
  return widgets.find((w) => w.id === id)!;
}

describe('DashboardWidgetInspector — width / height write a whole layout (objectui#11388)', () => {
  it('editing the width of a widget with no layout stores four numbers the spec parses', () => {
    const onPatch = renderInspector([bound('w1')], 'w1');
    fireEvent.change(document.getElementById('widget-w')!, { target: { value: '6' } });

    const widget = patchedWidget(onPatch, 'w1');
    expect(widget.layout).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    const parsed = SpecDashboardWidgetSchema.safeParse(widget);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('editing the height seeds x, y and the width from the grid auto-placement of its index', () => {
    // The fifth widget (index 4) is auto-placed at the start of the second row.
    const widgets = ['a', 'b', 'c', 'd', 'w5'].map((id) => bound(id));
    const onPatch = renderInspector(widgets, 'w5');
    fireEvent.change(document.getElementById('widget-h')!, { target: { value: '2' } });

    const widget = patchedWidget(onPatch, 'w5');
    expect(widget.layout).toEqual({ x: 0, y: 4, w: 3, h: 2 });
    expect(SpecDashboardWidgetSchema.safeParse(widget).success).toBe(true);
  });

  it('control: a widget that has a layout keeps its x, y and the other dimension', () => {
    const onPatch = renderInspector([bound('w1', { layout: { x: 6, y: 2, w: 3, h: 5 } })], 'w1');
    fireEvent.change(document.getElementById('widget-w')!, { target: { value: '4' } });
    expect(patchedWidget(onPatch, 'w1').layout).toEqual({ x: 6, y: 2, w: 4, h: 5 });
  });

  it('the inputs show the box an edit completes, so the dimension left alone is the one on screen', () => {
    renderInspector([bound('w1')], 'w1');
    expect((document.getElementById('widget-w') as HTMLInputElement).value).toBe('3');
    expect((document.getElementById('widget-h') as HTMLInputElement).value).toBe('4');
  });
});
