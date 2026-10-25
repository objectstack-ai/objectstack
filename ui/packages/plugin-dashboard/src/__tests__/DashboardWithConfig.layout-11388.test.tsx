/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11388 — `DashboardWithConfig`'s width / height sliders write a
 * whole four-number `layout` into the live schema.
 *
 * The panel's sliders edit one dimension each, and the live writer used to
 * spread that one number onto the widget's possibly-absent `layout`, so a
 * widget with none got `{ w }` or `{ h }`, which `@objectstack/spec`'s
 * `DashboardWidgetSchema` refuses. That live schema is what the dashboard
 * renders and what the panel re-opens from.
 *
 * `DashboardRenderer` is replaced by a stub that records the schema it is
 * handed: it lays widgets out by span and array order and draws no `x` / `y`,
 * so the DOM cannot show the coordinates this pin is about. The panel is the
 * real `WidgetConfigPanel`, driven through its slider's keyboard steps.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';
import type { DashboardComponentSchema, DashboardWidgetSchema } from '@object-ui/types';

const rendered = vi.hoisted(() => ({ schema: undefined as unknown }));

vi.mock('../DashboardRenderer', async () => {
  const { createElement } = await import('react');
  return {
    DashboardRenderer: (props: {
      schema: { widgets?: Array<{ id?: string }> };
      onWidgetClick?: (id: string | null) => void;
    }) => {
      rendered.schema = props.schema;
      return createElement(
        'div',
        null,
        (props.schema.widgets ?? []).map((w) =>
          createElement('button', {
            key: w.id,
            type: 'button',
            'data-testid': `stub-widget-${w.id}`,
            onClick: () => props.onWidgetClick?.(w.id ?? null),
          }),
        ),
      );
    },
  };
});

import { DashboardWithConfig } from '../DashboardWithConfig';

afterEach(cleanup);

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
  const schema: DashboardComponentSchema = { type: 'dashboard', widgets };
  render(
    <DashboardWithConfig schema={schema} config={{}} onConfigSave={vi.fn()} defaultConfigOpen />,
  );
  fireEvent.click(screen.getByTestId(`stub-widget-${id}`));
}

/** Step one of the panel's sliders up by one with the keyboard. */
function stepUp(fieldKey: 'layoutW' | 'layoutH') {
  const thumb = within(screen.getByTestId(`config-field-${fieldKey}`)).getByRole('slider');
  fireEvent.keyDown(thumb, { key: 'ArrowRight' });
}

/** One widget from the schema the dashboard was last rendered with, read by the slot's element type (objectui#11514). */
function liveWidget(id: string): DashboardComponentSchema['widgets'][number] {
  const schema = rendered.schema as DashboardComponentSchema;
  const widgets: DashboardComponentSchema['widgets'] = schema.widgets ?? [];
  return widgets.find((w) => w.id === id)!;
}

describe('DashboardWithConfig — the sliders write a whole layout (objectui#11388)', () => {
  it('editing the width of a widget with no layout stores four numbers the spec parses', () => {
    openPanelFor([bound('w1')], 'w1');
    stepUp('layoutW');

    const widget = liveWidget('w1');
    // The slider starts at the auto-placed width (3) and steps to 4.
    expect(widget.layout).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    const parsed = SpecDashboardWidgetSchema.safeParse(widget);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('editing the height seeds x, y and the width from the grid auto-placement of its index', () => {
    openPanelFor([bound('a'), bound('w2')], 'w2');
    stepUp('layoutH');

    const widget = liveWidget('w2');
    expect(widget.layout).toEqual({ x: 3, y: 0, w: 3, h: 5 });
    expect(SpecDashboardWidgetSchema.safeParse(widget).success).toBe(true);
  });

  it('control: a widget that has a layout keeps its x, y and the other dimension', () => {
    openPanelFor([bound('w1', { layout: { x: 6, y: 2, w: 3, h: 5 } })], 'w1');
    stepUp('layoutW');
    expect(liveWidget('w1').layout).toEqual({ x: 6, y: 2, w: 4, h: 5 });
  });
});
