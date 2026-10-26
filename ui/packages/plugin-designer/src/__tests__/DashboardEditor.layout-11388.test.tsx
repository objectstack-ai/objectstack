/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11388 — `DashboardEditor`'s width / height inputs write a whole
 * four-number `layout`.
 *
 * A widget can reach this editor with no `layout` (an imported or
 * Studio-authored dashboard; the grid auto-places it). The inputs edit one
 * dimension each, and used to spread that one number onto the absent box,
 * storing `{ w }` or `{ h }`, which `@objectstack/spec`'s
 * `DashboardWidgetSchema` refuses. Each case parses the widget from the
 * schema `onChange` receives with the spec's own schema.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';
import type { DashboardComponentSchema, DashboardWidgetSchema } from '@object-ui/types';
import { DashboardEditor } from '../DashboardEditor';

// Spec-valid apart from `layout`, so a refusal below is the layout's.
function bound(id: string, extra: Partial<DashboardWidgetSchema> = {}): DashboardWidgetSchema {
  return {
    id,
    type: 'bar',
    title: id,
    dataset: 'sales_pipeline',
    dimensions: ['stage'],
    values: ['revenue'],
    ...extra,
  };
}

function openPanelFor(widgets: DashboardWidgetSchema[], id: string) {
  const onChange = vi.fn();
  const schema: DashboardComponentSchema = { type: 'dashboard', name: 'sales', widgets };
  render(<DashboardEditor schema={schema} onChange={onChange} />);
  fireEvent.click(screen.getByTestId(`dashboard-widget-${id}`));
  return onChange;
}

/** One widget from the schema of the most recent `onChange` call, read by the slot's element type (objectui#11514). */
function changedWidget(onChange: ReturnType<typeof vi.fn>, id: string): DashboardComponentSchema['widgets'][number] {
  const calls = onChange.mock.calls;
  const schema = calls[calls.length - 1][0] as DashboardComponentSchema;
  const widgets: DashboardComponentSchema['widgets'] = schema.widgets ?? [];
  return widgets.find((w) => w.id === id)!;
}

describe('DashboardEditor — width / height write a whole layout (objectui#11388)', () => {
  it('editing the width of a widget with no layout stores four numbers the spec parses', () => {
    const onChange = openPanelFor([bound('w1')], 'w1');
    fireEvent.change(screen.getByTestId('widget-prop-width'), { target: { value: '6' } });

    const widget = changedWidget(onChange, 'w1');
    expect(widget.layout).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    const parsed = SpecDashboardWidgetSchema.safeParse(widget);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('editing the height seeds x, y and the width from the grid auto-placement of its index', () => {
    const onChange = openPanelFor([bound('a'), bound('w2')], 'w2');
    fireEvent.change(screen.getByTestId('widget-prop-height'), { target: { value: '2' } });

    const widget = changedWidget(onChange, 'w2');
    expect(widget.layout).toEqual({ x: 3, y: 0, w: 3, h: 2 });
    expect(SpecDashboardWidgetSchema.safeParse(widget).success).toBe(true);
  });

  it('control: a widget that has a layout keeps its x, y and the other dimension', () => {
    const onChange = openPanelFor([bound('w1', { layout: { x: 6, y: 2, w: 3, h: 5 } })], 'w1');
    fireEvent.change(screen.getByTestId('widget-prop-width'), { target: { value: '4' } });
    expect(changedWidget(onChange, 'w1').layout).toEqual({ x: 6, y: 2, w: 4, h: 5 });
  });

  it('the inputs show the box an edit completes, so the dimension left alone is the one on screen', () => {
    openPanelFor([bound('w1')], 'w1');
    expect((screen.getByTestId('widget-prop-width') as HTMLInputElement).value).toBe('3');
    expect((screen.getByTestId('widget-prop-height') as HTMLInputElement).value).toBe('4');
  });
});
