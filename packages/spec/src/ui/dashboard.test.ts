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

  // Regression (Studio dashboard designer): the designer adds widgets WITHOUT a
  // `layout`; the renderer auto-flows them. `layout` must be OPTIONAL — when it
  // was required, every designer-authored dashboard failed validation (422 on
  // draft save) and Publish stayed disabled even though the widget rendered.
  it('accepts a widget with NO layout (auto-flowed; Studio designer omits it)', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'widget_1', type: 'metric', dataset: 'showcase_task_metrics', values: ['task_count'],
    });
    expect(w.layout).toBeUndefined();
    expect(w.values).toEqual(['task_count']);
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

  it('a widget supplying only the removed inline fields is invalid (missing dataset AND unknown keys)', () => {
    // Fails twice over now: no `dataset`/`values`, and under `.strict()` the
    // legacy `object`/`aggregate` keys are unrecognized.
    expect(() => DashboardWidgetSchema.parse({ id: 'x', type: 'metric', object: 'opportunity', aggregate: 'count', layout: { x: 0, y: 0, w: 3, h: 2 } } as any)).toThrow();
  });

  // ── .strict() endpoint (framework#3251, protocol 16 step16) ──────────────
  it('rejects an otherwise-valid widget carrying a legacy analytics key, and points at the dataset shape', () => {
    const legacy = { id: 'w_legacy', type: 'bar', dataset: 'sales', values: ['revenue'], categoryField: 'stage' } as any;
    const res = DashboardWidgetSchema.safeParse(legacy);
    expect(res.success).toBe(false);
    if (!res.success) {
      const unknown = res.error.issues.find((i) => i.code === 'unrecognized_keys');
      expect(unknown).toBeDefined();
      const msg = unknown!.message;
      expect(msg).toContain('categoryField');
      expect(msg).toContain('dataset');
    }
  });

  it('rejects the objectui-internal `component` / inline `data` keys', () => {
    expect(() => DashboardWidgetSchema.parse({ id: 'w_comp', type: 'metric', dataset: 'sales', values: ['revenue'], component: {} } as any)).toThrow();
    const res = DashboardWidgetSchema.safeParse({ id: 'w_data', type: 'metric', dataset: 'sales', values: ['revenue'], data: [] } as any);
    expect(res.success).toBe(false);
    if (!res.success) {
      const unknown = res.error.issues.find((i) => i.code === 'unrecognized_keys');
      expect(unknown!.message).toContain('objectui-internal');
    }
  });

  it('rejects an unknown/typo top-level key and names it in the error', () => {
    const res = DashboardWidgetSchema.safeParse({ id: 'w_typo', type: 'metric', dataset: 'sales', values: ['revenue'], colourVariant: 'blue' } as any);
    expect(res.success).toBe(false);
    if (!res.success) expect(JSON.stringify(res.error.issues)).toContain('colourVariant');
  });

  it('keeps `options` as the free-form renderer-extras escape hatch', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'w_opts', type: 'bar', dataset: 'sales', values: ['revenue'],
      options: { stacked: true, palette: ['#111', '#222'], drillDown: { enabled: true } },
    });
    expect((w.options as any).stacked).toBe(true);
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

  it('parses a designer-authored dashboard whose widgets omit layout', () => {
    const d = DashboardSchema.parse({
      name: 'delivery_exec_overview', label: 'Delivery Executive Overview',
      widgets: [
        { id: 'widget_1', type: 'metric', dataset: 'showcase_task_metrics', values: ['task_count'] },
        { id: 'widget_2', type: 'donut', dataset: 'showcase_task_metrics', dimensions: ['status'], values: ['task_count'] },
      ],
    });
    expect(d.widgets.every((w) => w.layout === undefined)).toBe(true);
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

  it('GlobalFilterSchema.name — optional stable variable key (framework#2501)', () => {
    const named = GlobalFilterSchema.parse({ name: 'region', field: 'sales_region', type: 'select' });
    expect(named.name).toBe('region');
    // name stays optional — runtime defaults it to `field`.
    expect(GlobalFilterSchema.parse({ field: 'region' }).name).toBeUndefined();
  });

  it('DashboardWidgetSchema.filterBindings — field override / opt-out (framework#2501)', () => {
    const w = DashboardWidgetSchema.parse({
      id: 'accounts_signed', type: 'line', dataset: 'accounts', values: ['count'],
      filterBindings: { dateRange: 'signed_at', region: 'sales_region', status: false },
    });
    expect(w.filterBindings).toEqual({ dateRange: 'signed_at', region: 'sales_region', status: false });
    // Only string (field name) or literal false are valid binding values.
    expect(() => DashboardWidgetSchema.parse({
      id: 'w_bad', type: 'metric', dataset: 'sales', values: ['revenue'],
      filterBindings: { region: true },
    })).toThrow();
  });
});
