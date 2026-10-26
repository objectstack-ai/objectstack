// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8894 ruling D — the metadata-admin editor's live Zod pass refuses a
 * second measure on a metric-family dashboard widget, on both of its doors.
 *
 * `validateMetadataDraft('dashboard', …)` judges a draft with the spec's own
 * `DashboardSchema`, and the spec (17.5.0, objectstack#17779) bounds `values`
 * at one measure for the metric family. This is the third objectui face that
 * judges a dashboard widget; the other two (`DashboardWidgetSchema` and
 * `safeValidateSchema` in `@object-ui/types`) are pinned in that package's
 * `dashboard-widget-metric-measure-door-8894.test.ts`, and the family is
 * derived the same way here: every spec `ChartTypeSchema` member the spec's
 * own `DashboardWidgetSchema` refuses at `values` for two measures — never a
 * list written in this file.
 *
 * Both doors are measured because `hasClientValidator` can switch a type's
 * EDIT door off (`AUTHOR_SHAPE_ONLY_TYPES`); a stored dashboard opened for
 * editing must meet the same refusal a new one does.
 */

import { describe, it, expect } from 'vitest';
import {
  ChartTypeSchema as SpecChartTypeSchema,
  DashboardWidgetSchema as SpecDashboardWidgetSchema,
} from '@objectstack/spec/ui';
import { validateMetadataDraft, hasClientValidator, type DraftMode } from './clientValidation';

const ONE = ['amount_sum'];
const TWO = ['amount_sum', 'deal_count'];

const widget = (type: string, values: string[]) => ({ id: 'sales_tile', dataset: 'sales', type, values });
const dashboard = (w: Record<string, unknown>) => ({ name: 'sales_board', label: 'Sales', widgets: [w] });

/** The spec's arity issue message for a widget, read off the spec's own parse, or `undefined`. */
const specArityMessage = (w: Record<string, unknown>): string | undefined => {
  const r = SpecDashboardWidgetSchema.safeParse(w);
  if (r.success) return undefined;
  return r.error.issues.find((i) => i.code === 'custom' && i.path.map(String).join('.') === 'values')?.message;
};

const FAMILY = (SpecChartTypeSchema.options as readonly string[]).filter((t) => specArityMessage(widget(t, TWO)) !== undefined);
const MODES: DraftMode[] = ['create', 'edit'];
const ROWS = MODES.flatMap((mode) => FAMILY.map((type) => [mode, type] as const));

describe('objectui#8894 — metadata-admin client validation refuses a second measure on the metric family', () => {
  it('the family is non-vacuous and the dashboard type is judged on both doors', () => {
    // An empty family would run zero rows below and pass; a door with no
    // validator would answer `ok: true` for everything, refusal included.
    expect(FAMILY.length).toBeGreaterThan(0);
    for (const mode of MODES) expect(hasClientValidator('dashboard', mode)).toBe(true);
  });

  it.each(ROWS)('%s door, `%s` with two measures: refused at `widgets.0.values` with the spec\'s own message', async (mode, type) => {
    const w = widget(type, TWO);
    const res = await validateMetadataDraft('dashboard', dashboard(w), undefined, { mode });
    expect(res.ok).toBe(false);
    expect(res.issues).toContainEqual({ path: 'widgets.0.values', message: specArityMessage(w)! });
  });

  it.each(ROWS)('%s door, `%s` with one measure: the whole draft passes', async (mode, type) => {
    const res = await validateMetadataDraft('dashboard', dashboard(widget(type, ONE)), undefined, { mode });
    expect(res).toEqual({ ok: true, issues: [] });
  });
});
