/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Guards the drill-down widget-type registry exposed by the config panel:
 * the chart families (incl. scatter / treemap / sankey), pivot and metric
 * drill *through*; table / list drill *to record*. Radar is intentionally
 * excluded (no single clickable category point).
 */
import { describe, it, expect } from 'vitest';
import { supportsDrillDown } from '../WidgetConfigPanel';

describe('supportsDrillDown', () => {
  it.each([
    'pivot', 'metric',
    'bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'funnel',
    'scatter', 'treemap', 'sankey',
    'table', 'list',
  ])('enables drill-down for %s', (t) => {
    expect(supportsDrillDown(t)).toBe(true);
  });

  it.each(['radar', 'custom', 'gauge', undefined])(
    'does not enable drill-down for %s',
    (t) => {
      expect(supportsDrillDown(t as any)).toBe(false);
    },
  );
});
