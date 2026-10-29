// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27785 — which reports the Interfaces pillar's leaf autosave HOLDS
 * for an unfinished item of one of its list properties, or an unfinished chart.
 *
 * The card: on a report's properties, Order → "Add item" autosaved
 * `order: [{}]` and the draft door answered 422 on `order.0.by`; a joined
 * report's Blocks → "Add item" did the same on `blocks: [{}]`; and picking a
 * chart type before its axes sent `chart: { type }`, refused on `chart.xAxis`
 * and `chart.yAxis`. Every later save carried the same body and was refused too.
 *
 * Every "held" case is paired with the spec's own `ReportSchema` verdict on the
 * same report (it refuses it, at exactly the unset inputs), and every "not
 * held" control with a report that judge accepts, or refuses for a value the
 * author wrote: the hold is never stricter than the contract, and never hides
 * finished but wrong work. The pillar that acts on it is pinned in
 * `InterfacesPillar.reportHeld-27785.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { ReportSchema } from '@objectstack/spec/ui';
import { objectHeldInput, reportHeldEdit } from './metadataError';
import { t, tFormat } from '../metadata-admin/i18n';

/** The issue paths the spec's report parse refuses `report` at, as the door reports them. */
function reportRefusals(report: Record<string, unknown>): string[] {
  const result = ReportSchema.safeParse(report);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

const summary = (extra: Record<string, unknown>) => ({
  name: 'pipeline_report',
  label: 'Pipeline',
  type: 'summary',
  dataset: 'sales_ds',
  rows: ['stage'],
  values: ['revenue'],
  ...extra,
});
const joined = (extra: Record<string, unknown>) => ({ name: 'pipeline_joined', label: 'Pipeline', type: 'joined', ...extra });

/** An item as the properties panel's repeater "Add item" builds it: every row input present and unset. */
function blank(...inputs: string[]): Record<string, unknown> {
  return Object.fromEntries(inputs.map((input) => [input, undefined]));
}
const ORDER_INPUTS = ['by', 'direction'];
const BLOCK_INPUTS = ['name', 'label', 'description', 'type', 'dataset', 'rows', 'columns', 'values', 'runtimeFilter', 'order'];

const listClause = (input: string, n: number, list: string, locale = 'en') =>
  tFormat('engine.studio.held.listItemNeedsInput', locale, { input, n, list });
const chartClause = (input: string, locale = 'en') =>
  tFormat('engine.studio.held.reportChartNeedsInput', locale, { input });

describe('the Interfaces pillar holds a report list item the spec refuses only for unset inputs (objectstack#27785)', () => {
  it('Order → Add item: held for its Order By, as the door refuses it, placed on the report properties', () => {
    const body = summary({ order: [blank(...ORDER_INPUTS)] });
    expect(reportRefusals(body)).toEqual(['order.0.by']);
    expect(reportHeldEdit(body, 'en')).toEqual({
      clause: listClause('Order By', 1, 'Order'),
      target: null,
      input: 'Order',
    });
  });

  it('the stored `{}` the card saw is held the same way', () => {
    const body = summary({ order: [{ by: 'stage' }, {}] });
    expect(reportRefusals(body)).toEqual(['order.1.by']);
    expect(reportHeldEdit(body, 'en')?.clause).toBe(listClause('Order By', 2, 'Order'));
  });

  it('joined Blocks → Add item: held for the first input it needs, then for its Dataset once named', () => {
    const body = joined({ blocks: [blank(...BLOCK_INPUTS)] });
    expect(reportRefusals(body)).toEqual(['blocks.0.name']);
    expect(reportHeldEdit(body, 'en')).toEqual({
      clause: listClause('Name', 1, 'Blocks'),
      target: null,
      input: 'Blocks',
    });
    const named = joined({ blocks: [{ ...blank(...BLOCK_INPUTS), name: 'won' }] });
    expect(reportRefusals(named)).toEqual(['blocks.0.dataset']);
    expect(reportHeldEdit(named, 'en')?.clause).toBe(listClause('Dataset', 1, 'Blocks'));
  });

  // CONTROL: the hold is never stricter than the contract.
  it('an Order By filled, or a block named and bound: not held, and the spec accepts it', () => {
    const ordered = summary({ order: [{ ...blank(...ORDER_INPUTS), by: 'stage' }] });
    expect(reportRefusals(ordered)).toEqual([]);
    expect(reportHeldEdit(ordered, 'en')).toBeNull();
    const bound = joined({ blocks: [{ ...blank(...BLOCK_INPUTS), name: 'won', dataset: 'sales_ds' }] });
    expect(reportRefusals(bound)).toEqual([]);
    expect(reportHeldEdit(bound, 'en')).toBeNull();
  });

  // CONTROL: errors stay for finished work.
  it('an Order By naming something the report does not select is finished but wrong: not held', () => {
    const body = summary({ order: [{ by: 'region' }] });
    expect(reportRefusals(body)).toEqual(['order']);
    expect(reportHeldEdit(body, 'en')).toBeNull();
  });

  it('a block with an unset input and a wrong value the spec names both of is not held', () => {
    const body = joined({ blocks: [{ name: 'Won Deals' }] });
    expect(reportRefusals(body)).toEqual(['blocks.0.name', 'blocks.0.dataset']);
    expect(reportHeldEdit(body, 'en')).toBeNull();
  });

  it('names the list and the item in the designer locale', () => {
    const body = summary({ order: [{}] });
    const held = reportHeldEdit(body, 'zh-CN');
    expect(held?.clause).toBe(listClause('Order By', 1, held?.input ?? '', 'zh-CN'));
    expect(held?.target).toBeNull();
  });
});

describe('the Interfaces pillar holds a report chart the spec refuses only for unset axes (objectstack#27785)', () => {
  const x = t('engine.inspector.report.chartX', 'en');
  const y = t('engine.inspector.report.chartY', 'en');

  it('a chart type picked before its axes: held for the X axis, named by the chart panel’s own label', () => {
    const body = summary({ chart: { type: 'bar' } });
    expect(reportRefusals(body)).toEqual(['chart.xAxis', 'chart.yAxis']);
    expect(reportHeldEdit(body, 'en')).toEqual({ clause: chartClause(x), target: null, input: x });
  });

  it('the X axis picked: held for the Y axis', () => {
    const body = summary({ chart: { type: 'bar', xAxis: 'stage' } });
    expect(reportRefusals(body)).toEqual(['chart.yAxis']);
    expect(reportHeldEdit(body, 'en')).toEqual({ clause: chartClause(y), target: null, input: y });
  });

  it('names the axis in the designer locale', () => {
    const body = summary({ chart: { type: 'bar' } });
    const zx = t('engine.inspector.report.chartX', 'zh-CN');
    expect(reportHeldEdit(body, 'zh-CN')).toEqual({ clause: chartClause(zx, 'zh-CN'), target: null, input: zx });
  });

  // CONTROL: the hold is never stricter than the contract.
  it('both axes picked: not held, and the spec accepts it', () => {
    const body = summary({ chart: { type: 'bar', xAxis: 'stage', yAxis: 'revenue' } });
    expect(reportRefusals(body)).toEqual([]);
    expect(reportHeldEdit(body, 'en')).toBeNull();
  });

  // CONTROL: errors stay for finished work.
  it('a chart refused for a value it holds is finished but wrong: not held', () => {
    const body = summary({ chart: { type: 'nope' } });
    expect(reportRefusals(body)).toEqual(['chart.type', 'chart.xAxis', 'chart.yAxis']);
    expect(reportHeldEdit(body, 'en')).toBeNull();
  });

  it('an unfinished list item is named before the chart', () => {
    const body = summary({ order: [{}], chart: { type: 'bar' } });
    expect(reportHeldEdit(body, 'en')?.clause).toBe(listClause('Order By', 1, 'Order'));
  });

  it('a report with no chart, or one the spec accepts, holds nothing', () => {
    expect(objectHeldInput(summary({}), ReportSchema, 'chart')).toBeNull();
    expect(reportRefusals(summary({}))).toEqual([]);
    expect(reportHeldEdit(summary({}), 'en')).toBeNull();
  });

  it('`objectHeldInput` asks only the issues under its key: a refusal elsewhere is not the chart’s', () => {
    const body = { ...summary({ chart: { type: 'bar', xAxis: 'stage' } }), name: '' };
    expect(reportRefusals(body)).toEqual(['name', 'name', 'chart.yAxis']);
    expect(objectHeldInput(body, ReportSchema, 'chart')).toBe('yAxis');
  });
});

// Keeps `t` honest: the clause key exists in both catalogs.
it('the held chart clause key is catalogued in en and zh', () => {
  expect(t('engine.studio.held.reportChartNeedsInput', 'en')).not.toBe('engine.studio.held.reportChartNeedsInput');
  expect(t('engine.studio.held.reportChartNeedsInput', 'zh-CN')).not.toBe('engine.studio.held.reportChartNeedsInput');
});
