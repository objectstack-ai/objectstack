/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8894 ruling D — a metric-family dashboard widget declares EXACTLY
 * ONE measure, and objectui's authoring door refuses a second one at `values`.
 *
 * The protocol was judged wrong for the metric family (a tile answers one
 * number), and the spec narrowed `DashboardWidgetSchema.values` for it in
 * objectstack#17779, which `@objectstack/spec` 17.5.0 ships. objectui's mirror
 * re-attaches the spec's exported check (objectui#11073), so the refusal is
 * already live here. This file PINS that door, on both of this package's faces
 * that judge a dashboard widget:
 *
 *   1. `DashboardWidgetSchema` — the widget mirror itself;
 *   2. `safeValidateSchema` — the published component door, reached through a
 *      `dashboard` node's `widgets` slot. It is also the verdict the CLI's
 *      `validate` command prints, which calls it on the parsed file.
 *
 * ## The family is the SPEC'S, derived at run time — never a list written here
 *
 * The spec keeps its family as a module-private constant, so this file reads
 * the rule by its effect: every member of the spec's `ChartTypeSchema` is put
 * through the spec's own `DashboardWidgetSchema` with two measures, and the
 * types refused with a `custom` issue at `values` ARE the family. A type the
 * spec adds to the family (or drops from it) moves this file's subjects with
 * it, and no row here has to be edited to keep up.
 *
 * ## What each assertion is
 *
 * - A refusal is asserted as the ISSUE ENVELOPE — `code` + `path` — plus the
 *   spec's own message read from the spec's own parse of the same document.
 *   Equal messages prove the spec's check runs here, not a restatement of it.
 * - An acceptance is a FULL `safeParse` success (the one-measure tile), never
 *   merely the absence of the arity issue: the value is what is judged, so
 *   only a whole-document green says the value is legal.
 * - Controls: the other chart families keep unbounded `values` (with a
 *   dimension, the shape the spec's refusal points authors at), and the family
 *   derivation itself is checked for being non-vacuous in both directions.
 *
 * ## The chart families: objectui#11334 and objectui#11417
 *
 * FAMILY is read by effect, so a second spec rule at `values` joins it: the
 * chart measure-arity check (`checkDashboardWidgetChartMeasureArity`, the
 * dimensionless check of objectstack `11d28c17` under the name `32d57690` gave
 * it, which `@objectstack/spec` 17.7.0 ships) refuses two measures with no
 * `dimensions` on more types than the metric family. objectui#11717 chains it
 * after the metric-family check, so every FAMILY type is refused on both faces
 * with the spec's own issue. Until then those types were booked in an
 * `OWED_TO_OBJECTUI_11334` ledger (objectui#11438 ruling A″, record 5968177777);
 * the ledger is struck, its rows now assert the refusal, and the cap rows
 * require the set objectui fails to refuse to be EMPTY.
 *
 * The same check's single-series arm (objectui#11417) refuses two measures on
 * five of those types WITH a dimension too. Both arms are read off the spec's
 * exported check itself (`chartArmIssues`), never off a list written here.
 *
 * ⛔ Not pinned here, deliberately: the TypeScript face. `values` stays
 * `string[]` on the type, as it does on the spec's own inferred type — the
 * card rules out a TypeScript narrowing.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import {
  ChartTypeSchema as SpecChartTypeSchema,
  DashboardWidgetSchema as SpecDashboardWidgetSchema,
  checkDashboardWidgetChartMeasureArity,
} from '@objectstack/spec/ui';
import { DashboardWidgetSchema } from '../zod/complex.zod';
import { safeValidateSchema } from '../zod/index.zod';

type Issue = { code: string; path: PropertyKey[]; message: string };

const ONE = ['amount_sum'];
const TWO = ['amount_sum', 'deal_count'];

/** A dataset-bound widget. `type: undefined` omits the key entirely. */
const widget = (type: string | undefined, values: string[], extra: Record<string, unknown> = {}) => ({
  id: 'sales_tile',
  dataset: 'sales',
  ...(type === undefined ? {} : { type }),
  values,
  ...extra,
});

/** The dashboard node the published door judges; the widget sits in slot 0. */
const dashboardNode = (w: Record<string, unknown>) => ({ type: 'dashboard', name: 'sales_board', widgets: [w] });

const envelope = (issues: readonly Issue[]) =>
  issues.map((i) => ({ code: i.code, path: i.path.map(String).join('.'), message: i.message }));

/** The spec's arity issue for a document, read off the spec's own parse, or `undefined`. */
const specArityIssue = (doc: Record<string, unknown>): Issue | undefined => {
  const r = SpecDashboardWidgetSchema.safeParse(doc);
  if (r.success) return undefined;
  return (r.error.issues as Issue[]).find((i) => i.code === 'custom' && i.path.map(String).join('.') === 'values');
};

const SPEC_TYPES: readonly string[] = SpecChartTypeSchema.options;
/** The metric family, as the spec's rule draws it. */
const FAMILY = SPEC_TYPES.filter((t) => specArityIssue(widget(t, TWO)) !== undefined);
/** Every other spec chart family. */
const OTHERS = SPEC_TYPES.filter((t) => !FAMILY.includes(t));

/**
 * The issues the spec's chart measure-arity check raises on a widget, read by
 * calling the exported check itself with a collecting context. The metric
 * family is the sibling check's, so this answers for the chart arms alone.
 */
const chartArmIssues = (doc: Record<string, unknown>): unknown[] => {
  const issues: unknown[] = [];
  checkDashboardWidgetChartMeasureArity(doc, { addIssue: (issue: unknown) => issues.push(issue) } as unknown as z.RefinementCtx);
  return issues;
};

/**
 * The FAMILY types the chart check refuses with no dimension — its
 * dimensionless arm (objectui#11334). These are the types the struck
 * `OWED_TO_OBJECTUI_11334` ledger held.
 */
const DIMENSIONLESS_ARM = FAMILY.filter((t) => chartArmIssues(widget(t, TWO)).length === 1);
/** The metric family proper: FAMILY minus the chart check's dimensionless arm. */
const METRIC = FAMILY.filter((t) => !DIMENSIONLESS_ARM.includes(t));
/** The types the chart check refuses two measures on WITH a dimension — its single-series arm (objectui#11417). */
const SINGLE_SERIES_ARM = SPEC_TYPES.filter((t) => chartArmIssues(widget(t, TWO, { dimensions: ['stage'] })).length === 1);
/** The dimensionless-arm types a dimension rescues: the single-series arm's complement within it. */
const RESCUED_BY_A_DIMENSION = DIMENSIONLESS_ARM.filter((t) => !SINGLE_SERIES_ARM.includes(t));

/** Does an objectui verdict carry the spec's own arity issue for `doc` at `path`? */
const refusesAsSpec = (
  r: { success: boolean; error?: { issues: readonly unknown[] } },
  doc: Record<string, unknown>,
  path: string,
): boolean => {
  const specIssue = specArityIssue(doc);
  if (r.success || specIssue === undefined) return false;
  return envelope(r.error!.issues as Issue[]).some(
    (i) => i.code === 'custom' && i.path === path && i.message === specIssue.message,
  );
};

describe('objectui#8894 — the family is read off the spec\'s own rule, and it is not vacuous', () => {
  it('the spec refuses a second measure on SOME types and not on others', () => {
    // Both halves must be populated: an empty family would make every
    // `it.each` below run zero rows and pass, and a family of every type would
    // mean the probe is catching some refusal other than arity.
    expect(FAMILY.length).toBeGreaterThan(0);
    expect(OTHERS.length).toBeGreaterThan(0);
    // The spec's default widget type is in the family: a typeless widget is
    // refused by the spec, which is the whole reason the typeless case below exists.
    expect(specArityIssue(widget(undefined, TWO))).toBeDefined();
  });

  it.each(FAMILY)('`%s`: the spec accepts ONE measure — the refusal is about the count, not the type', (type) => {
    expect(SpecDashboardWidgetSchema.safeParse(widget(type, ONE)).success).toBe(true);
  });
});

describe('objectui#8894 — face 1: `DashboardWidgetSchema` refuses a second measure on the metric family', () => {
  it.each(FAMILY)('`%s` with two measures is refused at `values`, with the spec\'s own issue', (type) => {
    const doc = widget(type, TWO);
    const specIssue = specArityIssue(doc)!;
    const r = DashboardWidgetSchema.safeParse(doc);
    expect(r.success).toBe(false);
    expect(envelope(r.error!.issues as Issue[])).toContainEqual({
      code: 'custom',
      path: 'values',
      message: specIssue.message,
    });
  });

  it.each(FAMILY)('`%s` with one measure parses', (type) => {
    expect(DashboardWidgetSchema.safeParse(widget(type, ONE)).success).toBe(true);
  });

  it('a widget that declares NO `type` is refused too, with the spec\'s own issue', () => {
    // objectui's mirror redeclares `type` without the spec's default; the
    // re-attached check resolves an absent type to that default itself, so the
    // two doors must still agree — message included.
    const doc = widget(undefined, TWO);
    const specIssue = specArityIssue(doc)!;
    const r = DashboardWidgetSchema.safeParse(doc);
    expect(r.success).toBe(false);
    expect(envelope(r.error!.issues as Issue[])).toContainEqual({
      code: 'custom',
      path: 'values',
      message: specIssue.message,
    });
  });

  it.each(OTHERS)('CONTROL: `%s` keeps unbounded `values` — two measures and a dimension parse on both doors', (type) => {
    const doc = widget(type, TWO, { dimensions: ['stage'] });
    expect(SpecDashboardWidgetSchema.safeParse(doc).success).toBe(true);
    expect(DashboardWidgetSchema.safeParse(doc).success).toBe(true);
  });
});

describe('objectui#8894 — face 2: the published door (`safeValidateSchema`) refuses it inside a dashboard', () => {
  it.each(FAMILY)('`%s` with two measures is refused at `widgets.0.values`, with the spec\'s own issue', (type) => {
    const w = widget(type, TWO);
    const specIssue = specArityIssue(w)!;
    const r = safeValidateSchema(dashboardNode(w));
    expect(r.success).toBe(false);
    expect(envelope(r.error!.issues as Issue[])).toContainEqual({
      code: 'custom',
      path: 'widgets.0.values',
      message: specIssue.message,
    });
  });

  it.each(FAMILY)('`%s` with one measure passes the published door', (type) => {
    expect(safeValidateSchema(dashboardNode(widget(type, ONE))).success).toBe(true);
  });
});

describe('objectui#11334 — the dimensionless arm: the spec refuses these widgets and objectui\'s doors refuse them with its issue', () => {
  // Formerly the OWED TO objectui#11334 rows, which asserted the difference (the
  // spec refuses, objectui accepts). The mirror attaches the check, so each row
  // now asserts the refusal itself, on both faces.
  it('the arm is read off the spec\'s check and is not vacuous: it holds `pie`, and the metric family is outside it', () => {
    expect(DIMENSIONLESS_ARM).toContain('pie');
    expect(METRIC.length).toBeGreaterThan(0);
    for (const t of METRIC) expect(chartArmIssues(widget(t, TWO)), t).toEqual([]);
  });

  it.each(DIMENSIONLESS_ARM)('`%s` with two measures and no dimension: the spec refuses at `values`, `DashboardWidgetSchema` refuses with its issue', (type) => {
    const doc = widget(type, TWO);
    const specIssue = specArityIssue(doc);
    expect(specIssue).toBeDefined();
    const r = DashboardWidgetSchema.safeParse(doc);
    expect(r.success).toBe(false);
    expect(envelope(r.error!.issues as Issue[])).toContainEqual({ code: 'custom', path: 'values', message: specIssue!.message });
  });

  it.each(DIMENSIONLESS_ARM)('`%s` with two measures and no dimension: the published door refuses it inside a dashboard with the spec\'s issue', (type) => {
    const w = widget(type, TWO);
    const specIssue = specArityIssue(w);
    expect(specIssue).toBeDefined();
    const r = safeValidateSchema(dashboardNode(w));
    expect(r.success).toBe(false);
    expect(envelope(r.error!.issues as Issue[])).toContainEqual({ code: 'custom', path: 'widgets.0.values', message: specIssue!.message });
  });

  it('SUBJECT (the card\'s pin): a dimensionless two-measure `pie` is ONE issue at `values`, the spec\'s own, on both faces', () => {
    const doc = widget('pie', TWO);
    const specIssue = specArityIssue(doc)!;
    expect(specIssue.message).toContain('with no `dimensions`');
    const mirror = DashboardWidgetSchema.safeParse(doc);
    expect(mirror.success).toBe(false);
    expect(envelope(mirror.error!.issues as Issue[]).filter((i) => i.path === 'values')).toEqual([
      { code: 'custom', path: 'values', message: specIssue.message },
    ]);
    const published = safeValidateSchema(dashboardNode(doc));
    expect(published.success).toBe(false);
    expect(envelope(published.error!.issues as Issue[])).toContainEqual({ code: 'custom', path: 'widgets.0.values', message: specIssue.message });
  });

  it('CONTROL: one dimension takes the same `pie` out of the dimensionless arm — what refuses it then is the single-series arm, and a `radar` it rescues parses', () => {
    // The card asked for the one-dimension `pie` to parse as this control. 17.7.0
    // refuses it anyway, by the single-series arm (objectui#11417, pinned below), so
    // the control is stated per arm: the dimensionless refusal is gone, and a type
    // the single-series arm does not hold parses whole with the same dimension.
    const pie = widget('pie', TWO, { dimensions: ['stage'] });
    const pieIssue = specArityIssue(pie)!;
    expect(pieIssue.message).not.toContain('with no `dimensions`');
    expect(envelope(DashboardWidgetSchema.safeParse(pie).error!.issues as Issue[]).map((i) => i.message)).not.toContain(specArityIssue(widget('pie', TWO))!.message);
    expect(RESCUED_BY_A_DIMENSION).toContain('radar');
    const radar = widget('radar', TWO, { dimensions: ['stage'] });
    expect(SpecDashboardWidgetSchema.safeParse(radar).success).toBe(true);
    expect(DashboardWidgetSchema.safeParse(radar).success).toBe(true);
    expect(safeValidateSchema(dashboardNode(radar)).success).toBe(true);
  });
});

describe('objectui#11417 — the single-series arm: a dimension does not rescue a second measure on these types', () => {
  it('the arm is read off the spec\'s check and is not vacuous: it holds `pie`, and every member is in the dimensionless arm too', () => {
    expect(SINGLE_SERIES_ARM).toContain('pie');
    expect(RESCUED_BY_A_DIMENSION.length).toBeGreaterThan(0);
    for (const t of SINGLE_SERIES_ARM) expect(DIMENSIONLESS_ARM, t).toContain(t);
  });

  it.each(SINGLE_SERIES_ARM)('`%s` with one dimension and two measures is refused at `values` on both faces, with the spec\'s own issue', (type) => {
    const doc = widget(type, TWO, { dimensions: ['stage'] });
    const specIssue = specArityIssue(doc);
    expect(specIssue).toBeDefined();
    const mirror = DashboardWidgetSchema.safeParse(doc);
    expect(mirror.success).toBe(false);
    expect(envelope(mirror.error!.issues as Issue[])).toContainEqual({ code: 'custom', path: 'values', message: specIssue!.message });
    const published = safeValidateSchema(dashboardNode(doc));
    expect(published.success).toBe(false);
    expect(envelope(published.error!.issues as Issue[])).toContainEqual({ code: 'custom', path: 'widgets.0.values', message: specIssue!.message });
  });

  it.each(SINGLE_SERIES_ARM)('CONTROL: `%s` with one dimension and ONE measure parses on both faces', (type) => {
    const doc = widget(type, ONE, { dimensions: ['stage'] });
    expect(SpecDashboardWidgetSchema.safeParse(doc).success).toBe(true);
    expect(DashboardWidgetSchema.safeParse(doc).success).toBe(true);
    expect(safeValidateSchema(dashboardNode(doc)).success).toBe(true);
  });

  it.each(RESCUED_BY_A_DIMENSION)('CONTROL: `%s` with one dimension and two measures parses on both faces — the arm names five types, not the family', (type) => {
    const doc = widget(type, TWO, { dimensions: ['stage'] });
    expect(SpecDashboardWidgetSchema.safeParse(doc).success).toBe(true);
    expect(DashboardWidgetSchema.safeParse(doc).success).toBe(true);
    expect(safeValidateSchema(dashboardNode(doc)).success).toBe(true);
  });
});

describe('objectui#11334 — the cap: objectui fails to refuse NO FAMILY type (the struck ledger stays empty)', () => {
  it('face 1: no FAMILY type goes unrefused by `DashboardWidgetSchema` with the spec\'s own issue', () => {
    const unrefused = FAMILY.filter((t) => {
      const doc = widget(t, TWO);
      return !refusesAsSpec(DashboardWidgetSchema.safeParse(doc), doc, 'values');
    });
    expect(unrefused).toEqual([]);
  });

  it('face 2: no FAMILY type goes unrefused by the published door with the spec\'s own issue', () => {
    const unrefused = FAMILY.filter((t) => {
      const w = widget(t, TWO);
      return !refusesAsSpec(safeValidateSchema(dashboardNode(w)), w, 'widgets.0.values');
    });
    expect(unrefused).toEqual([]);
  });
});
