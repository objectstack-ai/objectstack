/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11598, N2 — `DashboardEditor` reads a widget key on the widget arm
 * alone, so a `metric-card` entry is not offered the widget-only Color Variant.
 *
 * The property panel read `colorVariant` off the selected entry whichever arm
 * it was, through `BaseSchema`'s index signature, and offered the select for a
 * `metric-card` too. The card declares no `colorVariant`: the strict face
 * refuses one on it and `MetricCard` draws nothing from it, so the select there
 * could only write a key publish refuses. The panel's other controls (title,
 * size) read keys both arms declare and stay.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardEditor } from '../DashboardEditor';

const WIDGETS: DashboardComponentSchema['widgets'] = [
  { id: 'w1', type: 'bar', title: 'Pipeline', dataset: 'sales_pipeline', dimensions: ['stage'], values: ['revenue'] },
  { id: 'c1', type: 'metric-card', title: 'Revenue', value: '$24k' },
];

function openPanelFor(id: string) {
  const onChange = vi.fn();
  render(<DashboardEditor schema={{ type: 'dashboard', name: 'sales', widgets: WIDGETS }} onChange={onChange} />);
  fireEvent.click(screen.getByTestId(`dashboard-widget-${id}`));
  return onChange;
}

describe('DashboardEditor — the widget-only Color Variant is offered on the widget arm alone (objectui#11598)', () => {
  it('a widget-arm entry is offered it, and a pick writes `colorVariant` on that widget', async () => {
    const onChange = openPanelFor('w1');
    // Picked through the shared Select's trigger (objectui#11865).
    fireEvent.keyDown(screen.getByTestId('widget-prop-color'), { key: 'ArrowDown' });
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Blue' }));
    const schema = onChange.mock.calls[onChange.mock.calls.length - 1][0] as DashboardComponentSchema;
    expect(schema.widgets.find((w) => w.id === 'w1')).toMatchObject({ colorVariant: 'blue' });
  });

  it('a `metric-card` entry is not offered it', () => {
    openPanelFor('c1');
    expect(screen.getByTestId('widget-property-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('widget-prop-color')).not.toBeInTheDocument();
  });

  it('CONTROL — the `metric-card` entry keeps the controls for keys both arms declare', () => {
    openPanelFor('c1');
    expect(screen.getByTestId('widget-prop-title')).toBeInTheDocument();
    expect(screen.getByTestId('widget-prop-width')).toBeInTheDocument();
    expect(screen.getByTestId('widget-prop-height')).toBeInTheDocument();
  });
});
