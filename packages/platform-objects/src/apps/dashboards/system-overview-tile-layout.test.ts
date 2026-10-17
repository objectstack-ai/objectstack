// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// System Overview metric tile height (the maintainer's ruling B on
// objectstack-ai/objectui#12704).
//
// The console draws a dashboard's positioned grid with `gridRow: span h` over
// rows that floor at 5rem and grow to their content, and a metric card fills
// its box. A KPI tile that declares `h: 2` therefore draws a box about twice the
// height of its content: the title and the number sit in the top half and the
// lower half is empty. The ruling is that the platform draws what the metadata
// declares (ADR-0078 forbids an `h` that is read and not honoured), so the
// AUTHORED size is what gets corrected, not the renderer: every metric tile on
// the shipped board is ONE row tall.
//
// What is pinned is the property "a KPI tile is one row", read off `type`
// rather than off a list of ids, so a metric tile added to the board later is
// held to it as well. Only `h` is pinned. `x`, `y` and `w` place the tile and
// are a separate decision this file has no opinion on.
//
// The pin carries its OPPOSITE DIRECTION, because "every metric tile is one row"
// has two ways to pass vacuously:
//
//   - it also holds if the read finds no metric tile at all (a renamed key, a
//     board that moved elsewhere) ⇒ the six tiles are named and the read must
//     return exactly them;
//   - it also holds if the fix were a blanket flattening of the whole board ⇒
//     the chart and table widgets must stay taller than a tile, because they
//     are the widgets that genuinely need the rows.

import { describe, it, expect } from 'vitest';
import { SystemOverviewDashboard } from './system_overview.dashboard.js';

interface Widget {
  id?: string;
  type?: string;
  layout?: { x: number; y: number; w: number; h: number };
}
const widgets: Widget[] = (SystemOverviewDashboard as unknown as { widgets?: Widget[] }).widgets ?? [];

const metricTiles = widgets.filter((w) => w.type === 'metric');
const otherWidgets = widgets.filter((w) => w.type !== 'metric');

describe('System Overview metric tiles are one row tall', () => {
  // Control for the assertion below: if this read ever returns nothing, the
  // `h` check is a loop over an empty array and passes whatever the board says.
  it('the read finds the six KPI tiles', () => {
    expect(metricTiles.map((w) => w.id)).toEqual([
      'widget_total_users',
      'widget_organizations',
      'widget_active_sessions',
      'widget_packages_installed',
      'widget_login_events',
      'widget_config_changes',
    ]);
  });

  it('every metric tile declares layout.h of 1', () => {
    const offenders = metricTiles
      .filter((w) => w.layout?.h !== 1)
      .map((w) => `${w.id} → layout.h=${String(w.layout?.h)}`);
    expect(offenders, 'metric tiles taller than one row').toEqual([]);
  });

  // Opposite direction: the correction is for the KPI tiles, not the board.
  it('opposite direction: the chart and table widgets stay taller than a tile', () => {
    expect(otherWidgets.length, 'the board still carries non-metric widgets').toBeGreaterThan(0);
    const flattened = otherWidgets
      .filter((w) => !(typeof w.layout?.h === 'number' && w.layout.h > 1))
      .map((w) => `${w.id} → layout.h=${String(w.layout?.h)}`);
    expect(flattened, 'non-metric widgets that lost their height').toEqual([]);
  });
});
