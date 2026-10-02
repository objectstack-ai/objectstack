// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { DashboardSchema } from '@objectstack/spec/ui';
import {
  checkDashboardWidgetOptions,
  CONSUMED_WIDGET_OPTION_KEYS,
  UNCONSUMED_WIDGET_OPTION,
} from '@objectstack/sdui-parser';
import { validateDashboardWidgetOptions } from './validate-dashboard-widget-options.js';
import { AUTHORING_COMMANDS, authoringRulesFor, runAuthoringRules } from './authoring-rules.js';

type AnyRec = Record<string, unknown>;

/** A dataset-bound widget: the only spec-legal shape, and the one the check censuses. */
function widget(id: string, options?: AnyRec, extra: AnyRec = {}): AnyRec {
  return {
    id,
    type: 'metric',
    title: id,
    dataset: 'opportunity_metrics',
    values: ['total_amount'],
    layout: { x: 0, y: 0, w: 4, h: 2 },
    ...(options === undefined ? {} : { options }),
    ...extra,
  };
}

/** The dashboard as the parsed tier hands it over: through the real schema. */
function parsedDashboard(widgets: AnyRec[]): AnyRec {
  return DashboardSchema.parse({ name: 'pipeline', label: 'Pipeline', widgets }) as AnyRec;
}

describe('validateDashboardWidgetOptions — the SDUI widget-option check at the metadata door', () => {
  it('flags an unread options key by name, at the check\'s own code and level', () => {
    const stack = { dashboards: [parsedDashboard([widget('won_revenue', { format: 'currency' })])] };
    const findings = validateDashboardWidgetOptions(stack);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: UNCONSUMED_WIDGET_OPTION,
      severity: 'warning',
      where: 'dashboard "pipeline" › widget "won_revenue"',
      path: 'dashboards[0].widgets[0].options',
    });
    // The named subject: the finding says WHICH key.
    expect(findings[0].message).toContain('options.format');
  });

  it('passes every consumed key (the control) on the same widget shape', () => {
    // Every key the read set names, with a value the schema accepts, survives
    // the parse and is not flagged. `stageOrder` is the funnel's own key: the
    // schema refuses it on any other type, so the control widget is a funnel.
    const values: AnyRec = {
      dateGranularity: 'month',
      limit: 10,
      sortBy: 'total_amount',
      sortOrder: 'desc',
      stageOrder: ['prospecting', 'closed_won'],
    };
    expect(Object.keys(values).sort()).toEqual([...CONSUMED_WIDGET_OPTION_KEYS].sort());
    const control = widget('stages', values, { type: 'funnel', dimensions: ['stage'] });
    const stack = { dashboards: [parsedDashboard([control])] };

    expect(validateDashboardWidgetOptions(stack)).toEqual([]);
  });

  it('flags exactly what the check flags — one finding per diagnostic, message unchanged', () => {
    // The adapter decides nothing: over the same widgets, the lint findings'
    // codes, levels and messages ARE the check's diagnostics on the SDUI node.
    const widgets = [
      widget('tile_a', { color: 'green', sortBy: 'total_amount' }),
      widget('tile_b'),
      widget('tile_c', { showLegend: true, horizontal: true, limit: 5 }),
    ];
    const dash = parsedDashboard(widgets);
    const findings = validateDashboardWidgetOptions({ dashboards: [dash] });
    const diagnostics = checkDashboardWidgetOptions({ type: 'dashboard', widgets: dash.widgets });

    expect(diagnostics).toHaveLength(3);
    expect(findings.map((f) => [f.rule, f.severity, f.message])).toEqual(
      diagnostics.map((d) => [d.code, d.severity, d.message]),
    );
    expect(findings.map((f) => f.path)).toEqual([
      'dashboards[0].widgets[0].options',
      'dashboards[0].widgets[2].options',
      'dashboards[0].widgets[2].options',
    ]);
  });

  it('honours the check\'s own exemptions rather than restating them', () => {
    const suppressed = widget('quiet', { format: 'currency' }, {
      suppressWarnings: [UNCONSUMED_WIDGET_OPTION],
    });
    const stack = { dashboards: [parsedDashboard([suppressed])] };
    expect(validateDashboardWidgetOptions(stack)).toEqual([]);

    // A widget with no `dataset` is outside the check's census (unparsed input:
    // the schema requires `dataset`, which is the point of the exemption).
    const inline = { dashboards: [{ name: 'legacy', widgets: [{ id: 'x', type: 'metric', options: { icon: 'x' } }] }] };
    expect(validateDashboardWidgetOptions(inline)).toEqual([]);
  });

  it('keeps each widget at its own index, so an id-less widget is still named correctly', () => {
    // `os lint` never parses, so a widget can arrive with no `id`.
    const stack = {
      dashboards: {
        ops: { widgets: [widget('first'), { type: 'metric', dataset: 'd', options: { suffix: '%' } }] },
      },
    };
    const findings = validateDashboardWidgetOptions(stack);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: UNCONSUMED_WIDGET_OPTION,
      severity: 'warning',
      where: 'dashboard "ops" › widget "(widget 1)"',
      path: 'dashboards[0].widgets[1].options',
    });
    expect(findings[0].message).toContain('"#1"');
  });
});

describe('the registry runs it on all three authoring commands', () => {
  const stack = { dashboards: [parsedDashboard([widget('won_revenue', { currency: 'USD' })])] };

  it.each(AUTHORING_COMMANDS)('os %s reports the unread key as an advisory', (command) => {
    expect(authoringRulesFor(command).map((r) => r.name)).toContain('validateDashboardWidgetOptions');
    const hits = runAuthoringRules(command, { normalized: stack, parsed: stack }).filter(
      (f) => f.rule === UNCONSUMED_WIDGET_OPTION,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ severity: 'warning', path: 'dashboards[0].widgets[0].options' });
  });
});
