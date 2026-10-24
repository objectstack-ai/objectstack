/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dashboard widget dispatch ↔ spec vocabulary parity (#2943).
 *
 * Three dashboard surfaces restated the chart vocabulary independently and
 * disagreed: `DatasetWidget` covered all 19 `ChartTypeSchema` values,
 * `DashboardRenderer` 15, `DashboardGridLayout` 8. A type a surface didn't
 * name fell through to `{ ...widget }`, whose `type` no component registers,
 * so `SchemaRenderer` rendered a red `role="alert"` panel dumping the widget
 * JSON.
 *
 * `passthrough` is the branch that produces that red box, so the contract is:
 * **no spec chart type may classify as `passthrough`.**
 */
import { describe, it, expect } from 'vitest';
import { ChartTypeSchema } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
import {
  classifyWidgetType,
  CHART_TYPE_ALIASES,
  SERIES_CHART_TYPES,
  METRIC_LIKE_TYPES,
  TABLE_LIKE_TYPES,
} from '../widgetDispatch';

const specNames: string[] = enumOptions(ChartTypeSchema);

describe('widget dispatch covers the spec chart vocabulary', () => {
  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read ChartTypeSchema.options from the spec').not.toEqual([]);
  });

  it('no spec chart type falls through to the red error box', () => {
    const unrouted = specNames.filter((name) => classifyWidgetType(name).family === 'passthrough');
    expect(
      unrouted,
      'these render SchemaRenderer\'s red "Unknown component type" panel — route them in widgetDispatch',
    ).toEqual([]);
  });

  it('the single-value families route to the metric card, not a chart', () => {
    for (const name of ['gauge', 'solid-gauge', 'kpi', 'bullet', 'metric']) {
      expect(classifyWidgetType(name).family, `'${name}' must render as a metric`).toBe('metric');
    }
  });

  it('the tabular families route to a table', () => {
    expect(classifyWidgetType('table').family).toBe('table');
    expect(classifyWidgetType('list').family).toBe('table');
    // `pivot` is dataset-bound only — a non-dataset pivot is stale metadata.
    expect(classifyWidgetType('pivot').family).toBe('pivot');
  });

  it('every alias resolves onto a family the chart renderer draws', () => {
    for (const [alias, base] of Object.entries(CHART_TYPE_ALIASES)) {
      const dispatch = classifyWidgetType(alias);
      expect(dispatch.family, `alias '${alias}'`).toBe('series');
      expect(dispatch.chartType, `alias '${alias}' → '${base}'`).toBe(base);
      expect(SERIES_CHART_TYPES.has(base), `'${base}' must be drawable`).toBe(true);
    }
  });

  it('series and metric vocabularies do not overlap', () => {
    const overlap = [...SERIES_CHART_TYPES].filter((n) => METRIC_LIKE_TYPES.has(n) || TABLE_LIKE_TYPES.has(n));
    expect(overlap, 'a type cannot be both a series chart and a metric/table').toEqual([]);
  });

  it('a genuinely unknown type stays passthrough (the surface decides)', () => {
    expect(classifyWidgetType('totally-made-up').family).toBe('passthrough');
    expect(classifyWidgetType(undefined).family).toBe('passthrough');
  });

  it('the dropped-family safety net returns a labelled placeholder, not passthrough', () => {
    for (const name of ['heatmap', 'candlestick', 'choropleth']) {
      expect(classifyWidgetType(name).family, `'${name}'`).toBe('unsupported');
    }
  });
});
