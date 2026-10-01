// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unread dashboard widget `options` keys, judged at the authoring door: the
 * SAME check the SDUI save gate runs, called from one more door.
 *
 * `checkDashboardWidgetOptions` (`@objectstack/sdui-parser`) reports every
 * widget `options` key outside `CONSUMED_WIDGET_OPTION_KEYS`, the read set of
 * the dataset-bound render path that every spec-legal widget renders through
 * (`dataset` is required). Its only caller used to be the SDUI tree validator
 * (`validate.ts` in that package), which meets a `dashboard` node inside a
 * page. A dashboard declared as METADATA (`*.dashboard.ts`, `stack.dashboards`)
 * never reached it, and `DashboardWidgetOptionsSchema` ends in `.passthrough()`,
 * so `os validate`, `os build` and `os lint` accepted an unread key without a
 * word. Two shipped examples carried such keys that way (`format`, `currency`,
 * `color`, `suffix`, `showLegend`, `horizontal`, `showDataLabels`), each
 * believed to style the widget and none read by any renderer.
 *
 * ## This file adds a door, never a judgement
 *
 * - ⛔ No second key list. Which keys are read is the check's answer, from
 *   `CONSUMED_WIDGET_OPTION_KEYS`, which `check:widget-option-census` derives
 *   from the spec's declared options keys.
 * - ⛔ No second level. A finding carries the check's own `severity` and
 *   `code` unchanged. The bag is declared open, and the ruling behind the check
 *   is that open extras stay open and stop being silent: a `warning`, at this
 *   door exactly as at the SDUI one. Changing the level is a decision about
 *   both doors, never an edit here.
 * - ⛔ No second scope. Dataset-less widgets, the legacy `component` format,
 *   an expression-valued `options` and a widget carrying
 *   `suppressWarnings: ['unconsumed-widget-option']` are the check's own
 *   exemptions, honoured by calling it rather than by restating them.
 *
 * ## The adapter
 *
 * The check reads one dashboard-host node, `{ type: 'dashboard', widgets }`,
 * and its `Diagnostic` carries no position. So it is called once per widget,
 * with an array that holds only that widget, at its own index: the finding can
 * then name the dashboard and widget the author edits, and the check's `#N`
 * label for a widget with no `id` (reachable under `os lint`, which never
 * parses) still names the right widget. Each diagnostic's message names the
 * offending key itself.
 */

import { checkDashboardWidgetOptions, type Diagnostic } from '@objectstack/sdui-parser';
import { recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

export interface DashboardWidgetOptionFinding {
  /** The check's own level, unchanged (today `warning`; see the file header). */
  severity: Diagnostic['severity'];
  /** The check's own code: `unconsumed-widget-option`. */
  rule: string;
  /** Human-readable location, e.g. `dashboard "pipeline" › widget "won_revenue"`. */
  where: string;
  /** Config path of the widget's options bag, e.g. `dashboards[0].widgets[2].options`. */
  path: string;
  /** The check's message, which names the unread key and the keys that are read. */
  message: string;
  /** How to fix it. */
  hint: string;
}

const HINT =
  'Remove the key: on a dataset-bound widget it styles nothing. Presentation has declared homes instead: ' +
  "a number's face is the dataset measure's `format` and `currency`, a tile's accent is the widget's " +
  "`colorVariant`, and a chart's look is the widget's `chartConfig`. A key with a genuine consumer outside " +
  "the renderer can say so with `suppressWarnings: ['unconsumed-widget-option']` on the widget.";

const isRec = (v: unknown): v is AnyRec => typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateDashboardWidgetOptions(stack: AnyRec): DashboardWidgetOptionFinding[] {
  const findings: DashboardWidgetOptionFinding[] = [];
  const dashboards = recordsOf(stack.dashboards);
  for (let i = 0; i < dashboards.length; i++) {
    const dash = dashboards[i];
    const dashName = typeof dash.name === 'string' && dash.name !== '' ? dash.name : `(dashboard ${i})`;
    const widgets: unknown[] = Array.isArray(dash.widgets) ? dash.widgets : [];
    for (let j = 0; j < widgets.length; j++) {
      const widget = widgets[j];
      // Only this widget, at its own index: every other slot is a hole the
      // check skips, so each diagnostic below belongs to widget `j`.
      const only: unknown[] = new Array(widgets.length);
      only[j] = widget;
      const diagnostics = checkDashboardWidgetOptions({ type: 'dashboard', widgets: only });
      if (diagnostics.length === 0) continue;
      const widgetId =
        isRec(widget) && typeof widget.id === 'string' && widget.id !== '' ? widget.id : `(widget ${j})`;
      for (const d of diagnostics) {
        findings.push({
          severity: d.severity,
          rule: d.code,
          where: `dashboard "${dashName}" › widget "${widgetId}"`,
          path: `dashboards[${i}].widgets[${j}].options`,
          message: d.message,
          hint: HINT,
        });
      }
    }
  }
  return findings;
}
