// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — "a dashboard authored in the Studio designer round-trips
// through draft save -> publish", exercised end-to-end through the real HTTP +
// metadata stack.
//
// The Studio dashboard designer's `addWidget` creates widgets with NO `layout`
// (objectui's DashboardGridLayout auto-flows them). Before the fix that made
// `DashboardWidget.layout` optional, the draft save returned 422
// ("widgets: Invalid type: expected object, received undefined"), so EVERY
// designer-authored dashboard was unsavable and Publish stayed disabled — even
// though the widget rendered correctly in the canvas.
//
// This bug passed every static gate: code-authored example dashboards ALWAYS
// specify a layout, so nothing exercised the layout-less shape. Only driving the
// real create -> save -> publish path with a designer-shaped (layout-less)
// dashboard surfaces it. This is the test that would have caught it before merge.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

// Designer-shaped: each widget binds a dataset + dimensions/values but carries
// NO `layout` — exactly what the Studio designer writes. `columns` is set, as
// the designer's Layout panel does, which is what made the layout-less widgets
// render in a positioned grid (and previously fail validation on save).
const DASH = 'dogfood_designer_roundtrip';
const designerDashboard = {
  name: DASH,
  label: 'Dogfood Designer Roundtrip',
  description: 'Layout-less widgets, exactly as authored in the Studio designer.',
  columns: 12,
  widgets: [
    { id: 'kpi_tasks', type: 'metric', title: 'Total Tasks', dataset: 'showcase_task_metrics', values: ['task_count'] },
    { id: 'by_status', type: 'bar', title: 'Tasks by Status', dataset: 'showcase_task_metrics', dimensions: ['status'], values: ['task_count'] },
    { id: 'priority_split', type: 'donut', title: 'Priority Split', dataset: 'showcase_task_metrics', dimensions: ['priority'], values: ['task_count'] },
  ],
};

describe('dogfood: a Studio-designer-shaped (layout-less) dashboard saves + publishes', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    token = await stack.signIn();
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('saves the layout-less draft (was 422 before DashboardWidget.layout became optional)', async () => {
    const res = await stack.apiAs(token, 'PUT', `/meta/dashboard/${DASH}?mode=draft`, designerDashboard);
    // The regression: a widget with no `layout` made this 422
    // ("widgets: Invalid type: expected object, received undefined").
    expect(res.status).toBe(200);
  });

  it('publishes the saved draft to live (Publish was disabled while the draft could not save)', async () => {
    const res = await stack.apiAs(token, 'POST', `/meta/dashboard/${DASH}/publish`, {});
    expect(res.status).toBe(200);
  });

  it('reads the published dashboard back with its layout-less widgets intact', async () => {
    const res = await stack.apiAs(token, 'GET', `/meta/dashboard/${DASH}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as
      | { widgets?: Array<{ id: string; layout?: unknown }> }
      | { item?: { widgets?: Array<{ id: string; layout?: unknown }> } };
    const widgets =
      (body as { widgets?: Array<{ id: string; layout?: unknown }> }).widgets ??
      (body as { item?: { widgets?: Array<{ id: string; layout?: unknown }> } }).item?.widgets ??
      [];
    expect(widgets).toHaveLength(3);
    // The exact shape that broke save: widgets persisted WITHOUT a layout.
    expect(widgets.every((w) => w.layout === undefined)).toBe(true);
  });
});
