/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6002 — `DashboardWidgetSchema` is `.strict()`: undeclared widget
 * keys are REFUSED BY NAME, never silently stripped.
 *
 * The failure mode being closed is the one the schema's own docstring records
 * from the previous incident (the hand copy dropping 12 spec keys "without a
 * word"): a plain `z.object()` deletes whatever it does not declare and then
 * reports success. Measured on the #4600 branch and re-measured here as the
 * red control: a widget carrying `zzcanary` / `categoryField` / `aggregate`
 * parsed five-keys-in, three-keys-out, verdict ACCEPT.
 *
 * Maintainer ruling 2026-08-25 (objectui#6002, Route 1 two-step): #6150
 * declares the genuinely consumed keys FIRST, then this schema flips strict.
 * Both faces of the flip are pinned here:
 *
 *   1. undeclared keys refuse loudly (`unrecognized_keys`, every key named);
 *   2. the legal surface is untouched — every declared key still parses AND
 *      survives (strict must not turn into a narrowing of the accepted set
 *      beyond key membership);
 *   3. the widget-slot COMPONENT route (2026-08-14 ruling, objectstack#8593)
 *      is unhurt: a `metric-card` node's props are component inputs, not
 *      widget keys, and the slot routes it to passthrough `BaseSchema`
 *      before the strict schema is consulted;
 *   4. the routing arm is NOT a hatch: a spec-family widget with stray keys
 *      is refused even at the document level, where the union could
 *      otherwise have offered the passthrough arm as an escape.
 *
 * Tombstone precedence (`actionUrl` et al. keep their own removal messages
 * under strict) is pinned next door in `report-chart-query-spec-parity.test.ts`
 * — the drift guard this schema names; the catalog-side routing gate is
 * `examples/schema-catalog/test/plugin-dashboard-component-schema.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { BaseSchema } from '../zod/base.zod.js';
import {
  DashboardComponentSchema,
  DashboardWidgetSchema,
} from '../zod/complex.zod.js';
import { DASHBOARD_COMPONENT_WIDGET_TYPES } from '../complex.js';

describe('DashboardWidgetSchema.strict() — undeclared keys refuse by name (objectui#6002)', () => {
  it('the measured five-in/three-out ACCEPT is now a refusal naming all three keys', () => {
    // The exact probe from the card body. Before #6002: ACCEPT with
    // `zzcanary`/`categoryField`/`aggregate` deleted in silence.
    const result = DashboardWidgetSchema.safeParse({
      type: 'metric',
      title: 'x',
      zzcanary: 1,
      categoryField: 'stage',
      aggregate: 'sum',
    });
    expect(result.success, 'undeclared keys must refuse, not strip').toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue, 'the refusal must be zod `unrecognized_keys`').toBeDefined();
    // Every offending key is named — the author is told exactly what the
    // contract does not know, not just that "something" is wrong.
    expect((issue as { keys?: string[] }).keys).toEqual(
      expect.arrayContaining(['zzcanary', 'categoryField', 'aggregate']),
    );
  });

  it('the retired pre-ADR-0021 inline analytics shape refuses as a set', () => {
    // `object`/`categoryField`/`valueField`/`aggregate` — the very keys #4600
    // was opened about. Under the strip regime a widget carrying all four
    // validated clean; the renderer's LEGACY_RETIRED_WIDGET_SCHEMA placeholder
    // was the only surface that ever mentioned them, and only at render time.
    const result = DashboardWidgetSchema.safeParse({
      id: 'w1',
      type: 'bar',
      object: 'opportunity',
      categoryField: 'stage',
      valueField: 'amount',
      aggregate: 'sum',
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys?: string[] })?.keys).toEqual(
      expect.arrayContaining(['object', 'categoryField', 'valueField', 'aggregate']),
    );
  });

  it('POSITIVE — a widget authoring the declared surface parses green and loses nothing', () => {
    // Same fixture family as the parity suite's "stops stripping" case, plus
    // `options` (the single-value form the README documents). Key-for-key
    // survival is the other half of strict: refusal of the undeclared set must
    // not come with any change to what the declared set keeps.
    const widget = {
      id: 'w1',
      type: 'bar',
      title: 'Pipeline',
      description: 'Pipeline by stage',
      colorVariant: 'blue',
      requiresObject: 'opportunity',
      requiresService: 'analytics',
      suppressWarnings: ['no-data'],
      dataset: 'pipeline',
      dimensions: ['stage'],
      values: ['amount'],
      layout: { x: 0, y: 0, w: 6, h: 4 },
      filterBindings: { dateRange: 'closed_at' },
      options: { value: '1,234' },
    };
    const result = DashboardWidgetSchema.safeParse(widget);
    expect(result.success, 'the declared surface must stay green').toBe(true);
    if (!result.success) return;
    for (const key of Object.keys(widget)) {
      expect(result.data, `declared key \`${key}\` must survive the parse`).toHaveProperty(key);
    }
  });

  it('the legacy `component` envelope (no `type`) still parses', () => {
    const result = DashboardWidgetSchema.safeParse({
      id: 'w_legacy',
      component: { type: 'metric-card', title: 'Revenue', value: '$1' },
      layout: { x: 0, y: 0, w: 3, h: 2 },
    });
    expect(result.success).toBe(true);
  });
});

describe('the widget-slot component route is unhurt (objectstack#8593 ruling)', () => {
  // A real component node as the catalog authors it: registry `inputs`
  // (`value`/`icon`/`trend`/`trendValue`) that are NOT widget keys and MUST
  // NOT be refused by the strict widget schema.
  const metricCard = {
    type: 'metric-card',
    title: 'Total Sales',
    value: '$123,456',
    icon: 'users',
    trend: 'up',
    trendValue: '+12%',
    description: 'vs last month',
  };

  it('DASHBOARD_COMPONENT_WIDGET_TYPES is the closed set the route keys on', () => {
    // Non-vacuity: an emptied component enum would make every case below
    // unreachable while staying green.
    expect(DASHBOARD_COMPONENT_WIDGET_TYPES.length).toBeGreaterThan(0);
  });

  it('a dashboard document holding a component node parses whole, props kept', () => {
    const result = DashboardComponentSchema.safeParse({
      type: 'dashboard',
      widgets: [metricCard],
    });
    expect(result.success, 'the ruled-legal component node must not refuse').toBe(true);
    if (!result.success) return;
    const kept = result.data.widgets[0] as Record<string, unknown>;
    for (const key of Object.keys(metricCard)) {
      expect(kept, `component prop \`${key}\` must survive — it is a component input, not a widget key`).toHaveProperty(key);
    }
  });

  it('the component arm agrees with BaseSchema — the ruling\'s named owner', () => {
    // The slot's passthrough behaviour is BaseSchema's, not a private third
    // schema: whatever BaseSchema keeps, the slot keeps.
    const viaBase = BaseSchema.parse(metricCard) as Record<string, unknown>;
    for (const key of Object.keys(metricCard)) expect(viaBase).toHaveProperty(key);
  });

  it('NOT A HATCH — a spec-family widget with stray keys refuses at document level too', () => {
    // The union offers the passthrough arm ONLY to component-enum types; a
    // `metric` widget with an undeclared key must not slip through it.
    const result = DashboardComponentSchema.safeParse({
      type: 'dashboard',
      widgets: [{ type: 'metric', title: 'x', zzcanary: 1 }],
    });
    expect(result.success, 'the passthrough arm must not admit spec-family widgets').toBe(false);
    if (result.success) return;
    // The union nests each arm's issues; the strict arm's refusal must be in
    // there, naming the key.
    const flat = JSON.stringify(result.error.issues);
    expect(flat).toContain('unrecognized_keys');
    expect(flat).toContain('zzcanary');
  });

  it('NOT A HATCH — undeclared keys refuse even when the widget also carries component-ish props', () => {
    // A widget that fails the component arm (type outside the component enum)
    // and carries keys the strict arm refuses: both arms red, document red.
    const result = DashboardComponentSchema.safeParse({
      type: 'dashboard',
      widgets: [{ type: 'bar', value: '$1', trend: 'up' }],
    });
    expect(result.success).toBe(false);
  });
});
