// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  DashboardSchema,
  DashboardWidgetSchema,
  DashboardHeaderSchema,
  DashboardHeaderActionSchema,
  Dashboard,
  WidgetColorVariantSchema,
  WidgetActionTypeSchema,
  GlobalFilterSchema,
  GlobalFilterOptionsFromSchema,
} from './dashboard.zod';

/**
 * ADR-0021 single-form: every dashboard widget binds a `dataset` and selects
 * `dimensions`/`values` BY NAME. The legacy inline `object` + `categoryField` +
 * `valueField` + `aggregate` query was removed in the cutover, so these tests
 * cover the dataset shape and the surviving presentation sub-schemas.
 */
describe('DashboardWidgetSchema (dataset-bound)', () => {
  it('accepts a KPI/metric widget (dataset + values, no dimensions)', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'total_pipeline', type: 'metric', dataset: 'sales', values: ['revenue'],
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });
    expect(w.dataset).toBe('sales');
    expect(w.values).toEqual(['revenue']);
  });

  it('accepts a chart widget with dimensions', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'by_stage', type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'],
      layout: { x: 0, y: 0, w: 6, h: 4 },
    });
    expect(w.dimensions).toEqual(['stage']);
  });

  it('keeps the presentation-scope filter (runtimeFilter) and compareTo', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'won', type: 'metric', dataset: 'sales', values: ['revenue'],
      filter: { stage: 'closed_won' }, compareTo: 'previousPeriod',
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });
    expect(w.filter).toEqual({ stage: 'closed_won' });
    expect(w.compareTo).toBe('previousPeriod');
  });

  it('rejects a widget with no dataset', () => {
    expect(() => DashboardWidgetSchema.parse({ id: 'x', type: 'metric', values: ['revenue'], layout: { x: 0, y: 0, w: 3, h: 2 } })).toThrow();
  });

  it('rejects a widget with no values', () => {
    expect(() => DashboardWidgetSchema.parse({ id: 'x', type: 'metric', dataset: 'sales', values: [], layout: { x: 0, y: 0, w: 3, h: 2 } })).toThrow();
  });

  it('a widget supplying only the removed inline fields is invalid (no dataset)', () => {
    expect(() => DashboardWidgetSchema.parse({ id: 'x', type: 'metric', object: 'opportunity', aggregate: 'count', layout: { x: 0, y: 0, w: 3, h: 2 } } as any)).toThrow();
  });

  it('keeps the runtime capability gates', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'gated', type: 'metric', dataset: 'sys', values: ['cnt'],
      requiresObject: 'sys_package_installation', requiresService: 'analytics',
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });
    expect(w.requiresObject).toBe('sys_package_installation');
    expect(w.requiresService).toBe('analytics');
  });
});

describe('DashboardSchema', () => {
  it('parses a dataset-bound dashboard', () => {
    const d = DashboardSchema.parse({
      name: 'sales_overview', label: 'Sales Overview',
      widgets: [
        { id: 'kpi', type: 'metric', dataset: 'sales', values: ['revenue'], layout: { x: 0, y: 0, w: 3, h: 2 } },
        { id: 'chart', type: 'bar', dataset: 'sales', dimensions: ['stage'], values: ['revenue'], layout: { x: 3, y: 0, w: 6, h: 4 } },
      ],
    });
    expect(d.widgets).toHaveLength(2);
  });

  it('Dashboard.create factory parses + returns a typed dashboard', () => {
    const d = Dashboard.create({
      name: 'dash_x', label: 'D',
      widgets: [{ id: 'wid_x', type: 'metric', dataset: 'sales', values: ['revenue'], layout: { x: 0, y: 0, w: 3, h: 2 } }],
    });
    expect(d.name).toBe('dash_x');
  });

  it('supports columns/gap/refresh/dateRange/globalFilters', () => {
    const d = DashboardSchema.parse({
      name: 'dash_x', label: 'D', columns: 12, gap: 4, refreshInterval: 60,
      dateRange: { field: 'close_date', defaultRange: 'this_quarter' },
      globalFilters: [{ field: 'owner', type: 'lookup' }],
      widgets: [{ id: 'wid_x', type: 'metric', dataset: 'sales', values: ['revenue'], layout: { x: 0, y: 0, w: 3, h: 2 } }],
    });
    expect(d.columns).toBe(12);
    expect(d.globalFilters).toHaveLength(1);
  });
});

describe('Dashboard presentation sub-schemas', () => {
  it('DashboardHeaderSchema + action', () => {
    const h = DashboardHeaderSchema.parse({ showTitle: true, actions: [{ label: 'New', actionUrl: '/new', actionType: 'modal' }] });
    expect(h.actions).toHaveLength(1);
    expect(DashboardHeaderActionSchema.parse({ label: 'X', actionUrl: '/x' }).label).toBe('X');
  });

  it('WidgetColorVariantSchema + WidgetActionTypeSchema enums', () => {
    expect(WidgetColorVariantSchema.parse('blue')).toBe('blue');
    expect(WidgetActionTypeSchema.parse('flow')).toBe('flow');
    expect(() => WidgetColorVariantSchema.parse('chartreuse')).toThrow();
  });

  it('GlobalFilterSchema + GlobalFilterOptionsFromSchema', () => {
    const f = GlobalFilterSchema.parse({ field: 'owner', type: 'lookup', optionsFrom: { object: 'user', valueField: 'id', labelField: 'name' }, scope: 'dashboard' });
    expect(f.scope).toBe('dashboard');
    expect(GlobalFilterOptionsFromSchema.parse({ object: 'user', valueField: 'id', labelField: 'name' }).object).toBe('user');
  });
});
