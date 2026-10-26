/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11388 — the one helper the widget width / height editors write a
 * dashboard widget's `layout` through.
 *
 * The spec's widget `layout` is four required numbers once the box is present.
 * The three editors each edit one dimension; on a widget with no `layout` they
 * used to store `{ w }` or `{ h }`, which `@objectstack/spec`'s
 * `DashboardWidgetSchema` refuses at `layout.x`, `layout.y` and the other
 * dimension. Each editor's own pin lives beside it (app-shell, plugin-dashboard,
 * plugin-designer); this file pins the helper they share, judged by the spec's
 * own schema rather than by a restated shape.
 */

import { describe, it, expect } from 'vitest';
import { DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';
import { completeWidgetLayout, defaultWidgetPlacement } from '../index';
import type { DashboardWidgetLayout } from '../index';

// A widget the spec accepts with no `layout`, so a refusal below is the layout's.
const SPEC_VALID_WIDGET = {
  id: 'w1',
  type: 'bar',
  title: 'Revenue',
  dataset: 'sales_pipeline',
  dimensions: ['stage'],
  values: ['revenue'],
} as const;

function parseWith(layout: unknown) {
  return SpecDashboardWidgetSchema.safeParse({ ...SPEC_VALID_WIDGET, layout });
}

describe('the spec refuses a one-dimension layout (premise)', () => {
  it('refuses `{ w }` and `{ h }`, accepts four numbers and accepts no box', () => {
    const widthOnly = parseWith({ w: 6 });
    expect(widthOnly.success).toBe(false);
    expect(widthOnly.error?.issues.map((i) => i.path.join('.')).sort()).toEqual([
      'layout.h',
      'layout.x',
      'layout.y',
    ]);
    expect(parseWith({ h: 3 }).success).toBe(false);
    // Falsifiers: the schema is not refusing every layout, and the box is optional.
    expect(parseWith({ x: 0, y: 0, w: 6, h: 4 }).success).toBe(true);
    expect(SpecDashboardWidgetSchema.safeParse(SPEC_VALID_WIDGET).success).toBe(true);
  });
});

describe('completeWidgetLayout (objectui#11388)', () => {
  it('a width edit on a widget with no layout stores four numbers the spec parses', () => {
    const layout = completeWidgetLayout(undefined, { w: 6 }, defaultWidgetPlacement(0));
    expect(layout).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(parseWith(layout).success).toBe(true);
  });

  it('a height edit on a widget with no layout stores four numbers the spec parses', () => {
    const layout = completeWidgetLayout(undefined, { h: 2 }, defaultWidgetPlacement(5));
    expect(layout).toEqual({ x: 3, y: 4, w: 3, h: 2 });
    expect(parseWith(layout).success).toBe(true);
  });

  it('control: a widget that has a layout keeps its x, y and the other dimension', () => {
    const stored: DashboardWidgetLayout = { x: 6, y: 2, w: 3, h: 5 };
    // The placement is deliberately far from the stored box, so a helper that
    // seeded from it instead of the stored layout would show up here.
    expect(completeWidgetLayout(stored, { w: 4 }, defaultWidgetPlacement(0))).toEqual({
      x: 6,
      y: 2,
      w: 4,
      h: 5,
    });
    expect(completeWidgetLayout(stored, { h: 1 }, defaultWidgetPlacement(0))).toEqual({
      x: 6,
      y: 2,
      w: 3,
      h: 1,
    });
  });

  it('a box already missing a coordinate is completed, not spread back as it was', () => {
    const layout = completeWidgetLayout({ w: 6 }, { h: 2 }, defaultWidgetPlacement(1));
    expect(layout).toEqual({ x: 3, y: 0, w: 6, h: 2 });
    expect(parseWith(layout).success).toBe(true);
  });

  it('seeds from whatever placement the caller passes, not only the default', () => {
    const seen: DashboardWidgetLayout = { x: 9, y: 7, w: 2, h: 3 };
    expect(completeWidgetLayout(undefined, { w: 5 }, seen)).toEqual({ x: 9, y: 7, w: 5, h: 3 });
  });
});

describe('defaultWidgetPlacement — the grid auto-placement the spec states', () => {
  it('lays four quarter-width boxes per row of the 12-column grid, four rows tall', () => {
    expect([0, 1, 2, 3, 4, 7].map(defaultWidgetPlacement)).toEqual([
      { x: 0, y: 0, w: 3, h: 4 },
      { x: 3, y: 0, w: 3, h: 4 },
      { x: 6, y: 0, w: 3, h: 4 },
      { x: 9, y: 0, w: 3, h: 4 },
      { x: 0, y: 4, w: 3, h: 4 },
      { x: 9, y: 4, w: 3, h: 4 },
    ]);
  });
});
