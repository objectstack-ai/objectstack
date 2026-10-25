/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Tests for DashboardConfig types and Zod validation schemas.
 */
import { describe, it, expect } from 'vitest';
import type {
  DashboardConfig,
  DashboardWidgetConfig,
  DashboardColorVariant,
  DashboardWidgetType,
} from '../designer';
import {
  DashboardConfigSchema,
  DashboardWidgetConfigSchema,
} from '../zod/index.zod';

describe('DashboardConfig TypeScript Types', () => {
  it('should accept a minimal DashboardConfig', () => {
    const config: DashboardConfig = {};
    expect(config).toBeDefined();
  });

  it('should accept a full DashboardConfig', () => {
    const config: DashboardConfig = {
      id: 'dash-1',
      title: 'Sales Dashboard',
      description: 'Overview of sales pipeline',
      columns: 12,
      gap: 16,
      refreshIntervalSeconds: 30,
      widgets: [
        {
          id: 'w1',
          title: 'Total Revenue',
          type: 'metric',
          object: 'deals',
          valueField: 'amount',
          aggregate: 'sum',
          colorVariant: 'success',
          layout: { x: 0, y: 0, w: 3, h: 2 },
        },
      ],
      globalFilters: [['status', '=', 'active']],
      dateRange: {
        enabled: true,
        field: 'created_at',
        presets: ['today', 'this_week', 'this_month'],
      },
      userFilters: [
        { field: 'region', label: 'Region', type: 'select' },
      ],
      showHeader: true,
      showFilters: true,
      showDateRange: true,
      headerActions: [
        { label: 'Export', action: 'export', icon: 'Download', variant: 'outline' },
      ],
      // `aria: { label, description }` REMOVED (objectui#5852): the member is
      // gone from the `DashboardConfig` declaration. Kept here it would have
      // gone on compiling through the interface's `[key: string]: any`
      // catch-all while asserting the opposite of the contract — the
      // green-wash objectui#5830 called out on the sibling member.
    };
    expect(config.widgets).toHaveLength(1);
    expect(config.widgets![0].type).toBe('metric');
  });

  it('should allow DashboardWidgetType values', () => {
    const types: DashboardWidgetType[] = [
      'metric', 'bar', 'line', 'pie', 'donut', 'area', 'scatter', 'table', 'list', 'custom',
    ];
    expect(types).toHaveLength(10);
  });

  it('should allow DashboardColorVariant values', () => {
    const colors: DashboardColorVariant[] = [
      'default', 'blue', 'teal', 'orange', 'purple', 'success', 'warning', 'danger',
    ];
    expect(colors).toHaveLength(8);
  });

  it('should allow DashboardWidgetConfig with all properties', () => {
    const widget: DashboardWidgetConfig = {
      id: 'w1',
      title: 'Revenue Chart',
      description: 'Monthly revenue',
      type: 'bar',
      object: 'deals',
      filter: [['status', '=', 'closed']],
      categoryField: 'month',
      valueField: 'amount',
      aggregate: 'sum',
      chartConfig: { stacked: true },
      colorVariant: 'blue',
      layout: { x: 0, y: 0, w: 6, h: 4 },
      actionUrl: '/deals',
    };
    expect(widget.id).toBe('w1');
  });
});

describe('DashboardConfig Zod Validation', () => {
  it('should validate a minimal DashboardConfig', () => {
    const result = DashboardConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should validate a complete DashboardConfig', () => {
    const result = DashboardConfigSchema.safeParse({
      id: 'dash-1',
      title: 'Sales Dashboard',
      description: 'Overview of sales pipeline',
      columns: 12,
      gap: 16,
      refreshIntervalSeconds: 30,
      widgets: [
        {
          id: 'w1',
          title: 'Total Revenue',
          type: 'metric',
          colorVariant: 'success',
          layout: { x: 0, y: 0, w: 3, h: 2 },
        },
      ],
      showHeader: true,
      showFilters: true,
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid column count', () => {
    const result = DashboardConfigSchema.safeParse({ columns: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject negative gap', () => {
    const result = DashboardConfigSchema.safeParse({ gap: -1 });
    expect(result.success).toBe(false);
  });

  it('should validate DashboardWidgetConfigSchema', () => {
    const result = DashboardWidgetConfigSchema.safeParse({
      id: 'w1',
      title: 'Revenue',
      type: 'bar',
      object: 'deals',
      colorVariant: 'blue',
      layout: { x: 0, y: 0, w: 6, h: 4 },
    });
    expect(result.success).toBe(true);
  });

  it('should reject DashboardWidgetConfigSchema without id', () => {
    const result = DashboardWidgetConfigSchema.safeParse({
      title: 'Revenue',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid colorVariant', () => {
    const result = DashboardWidgetConfigSchema.safeParse({
      id: 'w1',
      colorVariant: 'invalid-color',
    });
    expect(result.success).toBe(false);
  });

  it('should validate dateRange configuration', () => {
    const result = DashboardConfigSchema.safeParse({
      dateRange: {
        enabled: true,
        field: 'created_at',
        presets: ['today', 'this_week'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('should validate userFilters configuration', () => {
    const result = DashboardConfigSchema.safeParse({
      userFilters: [
        { field: 'region', label: 'Region', type: 'select' },
        { field: 'status' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should validate headerActions configuration', () => {
    const result = DashboardConfigSchema.safeParse({
      headerActions: [
        { label: 'Export', action: 'export', icon: 'Download', variant: 'outline' },
        { label: 'Refresh' },
      ],
    });
    expect(result.success).toBe(true);
  });

  // `should validate aria accessibility attributes` was FLIPPED, not deleted
  // (objectui#5852). It asserted `success === true` for an authored `aria`.
  // After the retirement a PLAIN DELETION would have kept it green — this
  // schema is a bare `z.object` with no `.strict()`, so an undeclared key is
  // accepted and silently stripped (measured; the same behaviour objectui#6068
  // recorded). That green would have meant "nothing looked", which is why the
  // mirror carries a `z.never()` tombstone instead and this pin now asserts the
  // refusal by name.
  it('refuses the retired `aria` key by name, with the removal message', () => {
    const result = DashboardConfigSchema.safeParse({
      aria: { label: 'Sales dashboard', description: 'Interactive overview' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'aria');
    expect(issue, 'no issue at path `aria`').toBeTruthy();
    // The message is asserted, not just its existence: a `z.never()` with no
    // `error` would refuse with zod's generic "expected never, received
    // object", which names the key only via the path and tells the author
    // nothing about what to do. The tombstone carries a real message.
    expect(issue!.message).toMatch(/^RETIRED \(ADR-0049\) — /);
    expect(issue!.message).toMatch(/delete the key/);
  });

  it('CONTROL: an arbitrary undeclared key is NOT refused — the red above is the tombstone, not strictness', () => {
    // Without this control, the refusal above is equally consistent with the
    // schema having become `.strict()`, which would refuse every unknown key.
    const result = DashboardConfigSchema.safeParse({ objectui5852NotAKey: 'x' });
    expect(result.success).toBe(true);
    // ...and it is dropped from the output, which is exactly what a plain
    // deletion of `aria` would have silently done to an authored value.
    expect(result.success && 'objectui5852NotAKey' in result.data).toBe(false);
  });

  it('CONTROL: a legal config still parses green — the tombstone narrowed nothing else', () => {
    const result = DashboardConfigSchema.safeParse({
      title: 'Sales', columns: 12, showHeader: true,
    });
    expect(result.success).toBe(true);
  });
});
