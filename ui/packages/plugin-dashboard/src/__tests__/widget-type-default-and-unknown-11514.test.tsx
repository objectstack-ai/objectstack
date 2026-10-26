/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11514, Q2 A — what a dashboard draws for a widget whose `type` is
 * absent, and for one whose `type` names nothing.
 *
 * ## The ruling
 *
 * 「协议为基准」: `@objectstack/spec`'s `DashboardWidget.type` defaults to
 * `metric`, so an absent `type` IS a `metric` widget, on both dashboard
 * surfaces. A runtime `type` that names no family and no component type is
 * stale metadata both validator faces refuse at `type`; it draws the labelled
 * placeholder an unsupported family draws. The slot-component passthrough
 * then serves the component arm alone.
 *
 * Before this change, both widgets fell through to the passthrough and drew
 * the registry's red "Unknown component type" (OBJUI-001) panel; a typeless
 * dataset-bound widget with a dimension drew a bar chart.
 *
 * ## What is pinned, on both surfaces
 *
 *   1. a typeless widget draws byte-for-byte what the same widget with
 *      `type: 'metric'` draws (the control), inline and dataset-bound, and on
 *      `DashboardRenderer`'s mobile layout, which groups metric widgets;
 *   2. an unknown `type` draws the labelled placeholder, worded as the
 *      control, a known unsupported family (`heatmap`), words it;
 *   3. CONTROL for the passthrough: a `metric-card` in the slot still draws
 *      the card, through the component arm.
 *
 * Neither case draws the OBJUI-001 panel.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@object-ui/components';
import '@object-ui/plugin-charts';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';
import { specDefaultWidgetType } from '../widgetDispatch';
import type { DashboardComponentSchema } from '@object-ui/types';

afterEach(cleanup);

/** Stored metadata, as a renderer receives it: no validator ran on it. */
const dash = (widgets: Record<string, unknown>[]): DashboardComponentSchema =>
  ({ type: 'dashboard', widgets }) as unknown as DashboardComponentSchema;

const SURFACES = ['grid', 'renderer'] as const;
type Surface = (typeof SURFACES)[number];

const mount = (surface: Surface, widgets: Record<string, unknown>[], dataSource?: unknown) =>
  render(
    surface === 'grid'
      ? <DashboardGridLayout schema={dash(widgets)} dataSource={dataSource} />
      : <DashboardRenderer schema={dash(widgets)} dataSource={dataSource} />,
  ).container;

/** The markup a surface draws once it has settled, unmounted afterwards. */
const drawn = async (surface: Surface, widgets: Record<string, unknown>[], ready: RegExp, dataSource?: unknown) => {
  const container = mount(surface, widgets, dataSource);
  await waitFor(() => expect(container.textContent).toMatch(ready));
  const html = container.innerHTML;
  cleanup();
  return html;
};

const UNKNOWN_TYPE_PANEL = /Unknown component type/;

describe('the spec\'s default widget type is read from the spec', () => {
  it('is `metric` at the installed spec', () => {
    expect(specDefaultWidgetType()).toBe('metric');
  });
});

describe.each(SURFACES)('%s surface — an absent `type` is `metric` (objectui#11514, Q2 A)', (surface) => {
  const inline = { id: 'w1', title: 'Revenue', options: { value: 7 } };

  it('an inline typeless widget draws what `type: \'metric\'` draws', async () => {
    const typeless = await drawn(surface, [inline], /7/);
    const control = await drawn(surface, [{ ...inline, type: 'metric' }], /7/);
    expect(typeless).toBe(control);
    expect(typeless).not.toMatch(UNKNOWN_TYPE_PANEL);
  });

  it('a dataset-bound typeless widget with a dimension draws the metric tile, as `type: \'metric\'` does', async () => {
    const source = () => ({
      queryDataset: vi.fn(async () => ({
        rows: [{ status: 'Open', invoice_count: 42 }],
        fields: [
          { name: 'status', type: 'string', label: 'Status' },
          { name: 'invoice_count', type: 'number', label: 'Invoices' },
        ],
      })),
    });
    const bound = { id: 'w1', title: 'Invoices', dataset: 'invoices', dimensions: ['status'], values: ['invoice_count'] };
    const typeless = await drawn(surface, [bound], /42/, source());
    const control = await drawn(surface, [{ ...bound, type: 'metric' }], /42/, source());
    expect(typeless).toBe(control);
  });
});

describe('renderer surface, mobile layout — a typeless widget sits in the metric row', () => {
  it('draws what `type: \'metric\'` draws', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 500 });
    try {
      const widgets = (type?: string) => [
        { id: 'w1', title: 'Revenue', options: { value: 7 }, ...(type ? { type } : {}) },
        { id: 'w2', type: 'table', title: 'Rows', options: { data: [{ name: 'A' }] } },
      ];
      const typeless = await drawn('renderer', widgets(), /7/);
      const control = await drawn('renderer', widgets('metric'), /7/);
      expect(typeless).toBe(control);
      // Non-vacuity: the mobile layout is the one drawn (its metric row is a 2-column grid).
      expect(typeless).toContain('grid-cols-2');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    }
  });
});

describe.each(SURFACES)('%s surface — an unknown `type` draws the labelled placeholder (objectui#11514, Q2 A)', (surface) => {
  it('draws the placeholder, not the unknown-type panel', async () => {
    const container = mount(surface, [{ id: 'w2', type: 'gauge2', title: 'Mystery', options: { value: 1 } }]);
    await waitFor(() => expect(container.textContent).toContain('「gauge2」chart type is not supported yet'));
    expect(container.textContent).not.toMatch(UNKNOWN_TYPE_PANEL);
  });

  it('CONTROL: a known unsupported family draws the same placeholder', async () => {
    const container = mount(surface, [{ id: 'w2', type: 'heatmap', title: 'Heat', options: { value: 1 } }]);
    await waitFor(() => expect(container.textContent).toContain('「heatmap」chart type is not supported yet'));
  });

  it('CONTROL: a `metric-card` in the slot still draws the card through the component arm', async () => {
    const container = mount(surface, [{ id: 'w3', type: 'metric-card', title: 'Card', value: '$5' }]);
    await waitFor(() => expect(container.textContent).toContain('$5'));
    expect(container.textContent).not.toMatch(/not supported yet/);
    expect(container.textContent).not.toMatch(UNKNOWN_TYPE_PANEL);
  });
});
