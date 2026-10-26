/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DashboardWidgetSchema } from '@object-ui/types/zod';

/**
 * objectui#8894 — what the widget door says about a widget's MEASURES.
 *
 * Returns the message of the `custom` issue objectui's authoring door raises at
 * `values` for this type, these measures and these dimensions, or `undefined`
 * when the door accepts them. The door is `DashboardWidgetSchema` from
 * `@object-ui/types/zod`, which re-attaches the spec's own object-level checks,
 * so its verdict and its message are the spec's (pinned by
 * `packages/types/src/__tests__/dashboard-widget-metric-measure-door-8894.test.ts`).
 *
 * The door is ASKED, never restated: no widget-type list lives here. Whichever
 * types the spec refuses a second measure on — the metric family since
 * `@objectstack/spec` 17.5.0 (`checkDashboardWidgetMetricMeasureArity`), and
 * any further shape once a spec release refuses it and the mirror re-attaches
 * that check (objectstack#20958 is the pending one) — the authoring pickers that
 * read this follow without an edit here.
 *
 * Only the keys a measure rule reads go into the probe — `id` (the message
 * names it), `type`, `values` and `dimensions` — each kept to a shape the door
 * accepts. zod skips object-level checks once a field-level issue aborts the
 * parse, and a draft in an editor is half-written by nature: measured on the
 * mirror, a numeric `id`, a non-string dimension or a malformed `title`
 * anywhere in the document each hide the measure verdict completely, which
 * would read as "accepted". The probe keeps those faults out of the question it
 * asks.
 *
 * Module-private to this package (not re-exported from its index).
 */
export function measureRefusal(widget: {
  id?: unknown;
  type?: unknown;
  values?: unknown;
  dimensions?: unknown;
}): string | undefined {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  const probe = {
    ...(typeof widget.id === 'string' ? { id: widget.id } : {}),
    // An absent or empty `type` stays absent: the door resolves it to the
    // spec's default widget type, as it does for a stored widget.
    ...(typeof widget.type === 'string' && widget.type ? { type: widget.type } : {}),
    values: strings(widget.values),
    ...(Array.isArray(widget.dimensions) ? { dimensions: strings(widget.dimensions) } : {}),
  };
  const result = DashboardWidgetSchema.safeParse(probe);
  if (result.success) return undefined;
  return result.error.issues.find(
    (issue) => issue.code === 'custom' && issue.path.length === 1 && issue.path[0] === 'values',
  )?.message;
}

/**
 * A stand-in for "one more measure", used to ask the door whether a picker may
 * offer another one before the author has chosen which. The door's measure
 * rules judge how many measures a widget declares, not their names (whether a
 * measure exists in the bound dataset is out of the widget schema's reach), so
 * any name the widget does not already carry asks the same question.
 */
export const NEXT_MEASURE_PROBE = '__next_measure__';
