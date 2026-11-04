// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `dashboard-widget-chart-config-structure-removed`
// conversion (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `dashboardWidgetChartConfigStructureRemoved` and lists it where it
// stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `dashboard.widgets[].chartConfig` loses its four STRUCTURE keys (ADR-0021;
 * maintainer ruling 2026-09-12, decision batch #121 item 1, verbatim 「同意」).
 *
 * The mechanical half only. On a dataset-bound widget the dataset decides which
 * series exist and which column each reads, so the stored `type`/`xAxis`/
 * `yAxis`/`series` cannot be carried forward into the selection by a walker —
 * `xAxis.field` names a dataset dimension the widget may not have selected, and
 * a `series[]` entry may name a measure outside `values` entirely. So this
 * strips them and the paired D3 semantic entry
 * `dashboard-widget-chart-config-structure-refused` carries the judgement.
 *
 * ⚠️ Scoped to DASHBOARD widgets. `report.chart` / `report.blocks[].chart` keep
 * their own `xAxis`/`yAxis` (narrowed to dataset dimension/measure NAMES by
 * `ReportChartSchema`), and the react `<ObjectChart>` tier keeps all four — the
 * ruling leaves the inline-data face alone. A conversion that walked `reports`
 * as well would strip keys that are still authorable there.
 */
const dashboardWidgetChartConfigStructureRemoved: MetadataConversion = {
  id: 'dashboard-widget-chart-config-structure-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface:
    'dashboard.widgets[].chartConfig.type / dashboard.widgets[].chartConfig.xAxis / '
    + 'dashboard.widgets[].chartConfig.yAxis / dashboard.widgets[].chartConfig.series',
  summary:
    "dataset-bound dashboard widget chart-config keys 'type'/'xAxis'/'yAxis'/'series' removed "
    + '(ADR-0021 — the dataset decides which series exist and which column each one reads; the '
    + "widget's own 'type' is the chart family, and 'dimensions'/'values' are the selection, so "
    + 'an authored axis could only agree with the dataset or silently re-point a series at '
    + 'another column)',
  apply(stack, emit) {
    return mapCollection(stack, 'dashboards', (d, path) => {
      const widgets = d.widgets;
      if (!Array.isArray(widgets)) return d;
      let touched = false;
      const rebuilt = widgets.map((w, i) => {
        if (!w || typeof w !== 'object' || Array.isArray(w)) return w;
        const config = (w as Record<string, unknown>).chartConfig;
        if (!config || typeof config !== 'object' || Array.isArray(config)) return w;
        const cleaned = stripKeys(
          config as Record<string, unknown>,
          ['type', 'xAxis', 'yAxis', 'series'],
          emit,
          `${path}.widgets[${i}].chartConfig`,
        );
        if (cleaned === config) return w;
        touched = true;
        return { ...(w as Record<string, unknown>), chartConfig: cleaned };
      });
      if (!touched) return d;
      return { ...d, widgets: rebuilt };
    });
  },
  fixture: {
    before: {
      dashboards: [{
        name: 'pipeline',
        widgets: [{
          id: 'rev_by_stage',
          type: 'bar',
          dataset: 'opportunity_metrics',
          dimensions: ['stage'],
          values: ['amount'],
          chartConfig: {
            type: 'bar',
            xAxis: { field: 'stage' },
            yAxis: [{ field: 'amount' }],
            series: [{ name: 'amount' }],
            title: 'Revenue by stage',
          },
        }],
      }],
    },
    after: {
      dashboards: [{
        name: 'pipeline',
        widgets: [{
          id: 'rev_by_stage',
          type: 'bar',
          dataset: 'opportunity_metrics',
          dimensions: ['stage'],
          values: ['amount'],
          chartConfig: { title: 'Revenue by stage' },
        }],
      }],
    },
    // `stripKeys` emits one notice per KEY it removed, and all four sit on one
    // chart config — so four, not one per site.
    expectedNotices: 4,
  },
};

export { dashboardWidgetChartConfigStructureRemoved };
