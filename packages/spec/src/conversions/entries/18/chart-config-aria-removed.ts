// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `chart-config-aria-removed` conversion (`toMajor: 18`),
// moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `chartConfigAriaRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `chartConfig.aria` (protocol 18, ADR-0049 enforce-or-remove; maintainer
 * decision batch #118 item 2, 2026-09-12 — recommendation C, judge the protocol
 * wrong for this one key).
 *
 * The third and last member of the `aria` family retired for the same measured
 * reason: a declared ARIA block nothing lowers to the DOM. `dashboard.aria`
 * went at the #3896 close-out, `dashboard.widgets[].aria` at #5010
 * (`dashboard-widget-action-aria-removed` above), and this key sat one level
 * further in, inside the widget's `chartConfig` bag, where no drill had ever
 * reached it. The per-key drill that reached it is recorded in
 * `liveness/dashboard.json` at the `.objectui-sha` pin `53ded82bf7a4`: of
 * `ChartConfigSchema`'s keys, `aria` is the only one with no reader on EITHER
 * face — `AdvancedChartImpl` declares no `aria` prop, `chartConfigPresentation`
 * names it nowhere, and `ui/react-blocks.ts` omits it from `<ObjectChart>`'s
 * `dataProps`, the one `ChartConfigSchema` key missing from that list.
 *
 * Why remove rather than enforce, on a shape where ADR-0049 usually prefers
 * enforcement: this chart config already carries a WORKING accessible-name
 * channel in the sibling `description`, lowered onto the chart graphic as
 * `role="img"` + `aria-label`. Wiring `aria` as well would put two sources of
 * accessible name on one element and require a precedence rule nobody has
 * written — so the platform keeps ONE accessibility vocabulary per node, and
 * this block-local second spelling leaves.
 *
 * ⚠️ Coverage boundary — THREE authored sites, not one, because
 * `ReportChartSchema` is a `ChartConfigSchema.extend(...)` and a report carries
 * a chart at two depths:
 *
 *   - `dashboards[].widgets[].chartConfig`
 *   - `reports[].chart`
 *   - `reports[].blocks[].chart`
 *
 * Both `dashboards` and `reports` are stack collections whose members are
 * registered metadata kinds stored as `sys_metadata` rows, so the chain has a
 * seam that sees them — which is why this is a D2 conversion and not the
 * semantic-entry-only disposition its `RestServerConfig` neighbours took.
 *
 * A SEPARATE entry rather than more keys on `dashboard-widget-action-aria-removed`,
 * for the reason that entry itself gives: its identity is the #5010 widget
 * drill, and folding a differently-evidenced removal into it would misattribute
 * this one in `spec-changes.json` and the upgrade guide — the two places an
 * upgrading author actually reads. It is also a different major.
 */
const chartConfigAriaRemoved: MetadataConversion = {
  id: 'chart-config-aria-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface:
    'dashboard.widgets[].chartConfig.aria / report.chart.aria / report.blocks[].chart.aria',
  summary:
    "chart config key 'aria' removed (ADR-0049 enforce-or-remove — no chart renderer ever "
    + 'applied it on either face, so declared ARIA attributes silently did not reach the DOM; '
    + "the accessible name that IS applied is the sibling 'description')",
  apply(stack, emit) {
    const stripChart = (owner: Record<string, unknown>, path: string): Record<string, unknown> => {
      const chart = owner.chart;
      if (!chart || typeof chart !== 'object' || Array.isArray(chart)) return owner;
      const cleaned = stripKeys(chart as Record<string, unknown>, ['aria'], emit, `${path}.chart`);
      if (cleaned === chart) return owner;
      return { ...owner, chart: cleaned };
    };

    const withDashboards = mapCollection(stack, 'dashboards', (d, path) => {
      const widgets = d.widgets;
      if (!Array.isArray(widgets)) return d;
      let touched = false;
      const rebuilt = widgets.map((w, i) => {
        if (!w || typeof w !== 'object' || Array.isArray(w)) return w;
        const config = (w as Record<string, unknown>).chartConfig;
        if (!config || typeof config !== 'object' || Array.isArray(config)) return w;
        const cleaned = stripKeys(
          config as Record<string, unknown>,
          ['aria'],
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

    return mapCollection(withDashboards, 'reports', (r, path) => {
      // The container's own chart, then each block's — a `joined` report carries
      // both, and an author upgrading a joined report carries them together.
      const afterOwn = stripChart(r, path);
      const blocks = afterOwn.blocks;
      if (!Array.isArray(blocks)) return afterOwn;
      let touched = false;
      const rebuilt = blocks.map((b, i) => {
        if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
        const next = stripChart(b as Record<string, unknown>, `${path}.blocks[${i}]`);
        if (next !== b) touched = true;
        return next;
      });
      if (!touched) return afterOwn;
      return { ...afterOwn, blocks: rebuilt };
    });
  },
  fixture: {
    before: {
      dashboards: [{
        name: 'ops_overview',
        widgets: [{
          id: 'w1',
          type: 'chart',
          dataset: 'orders',
          values: ['total'],
          // ⚠️ No `type` here: it was tombstoned on this carrier by
          // `dashboard-widget-chart-config-structure-removed`, and a fixture that
          // still wrote it would be stripped by THAT entry too — the fixture
          // disjointness contract. The report charts below keep theirs.
          chartConfig: { description: 'Orders by month', aria: { ariaLabel: 'Orders by month' } },
        }],
      }],
      // ⚠️ No `blocks[].chart` here since #20161: `report-joined-chart-removed`
      // strips a block's WHOLE `chart`, so a fixture carrying one could no
      // longer equal its own `after` under the full-table replay (the fixture
      // disjointness contract). The block leg of `apply` above still runs on a
      // stored row, ahead of that entry, and the compound result is the same.
      reports: [{
        name: 'revenue_by_region',
        chart: { type: 'bar', aria: { ariaLabel: 'Revenue by region' } },
      }],
    },
    after: {
      dashboards: [{
        name: 'ops_overview',
        widgets: [{
          id: 'w1',
          type: 'chart',
          dataset: 'orders',
          values: ['total'],
          chartConfig: { description: 'Orders by month' },
        }],
      }],
      reports: [{
        name: 'revenue_by_region',
        chart: { type: 'bar' },
      }],
    },
    // One notice per stripped SITE — the widget's chart config and the report's
    // own chart — not one per key name.
    expectedNotices: 2,
  },
};

export { chartConfigAriaRemoved };
