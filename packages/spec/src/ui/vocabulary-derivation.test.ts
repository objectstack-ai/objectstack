// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Two `ui/` vocabularies are now *derived* from another rather than restated
 * (objectstack-ai/objectui#2945). These tests assert the derivation still holds,
 * because the failure mode of a restated list is silence: it keeps validating,
 * it just validates something the other list no longer says.
 *
 *   - `ListChartConfigSchema.chartType` — a five-member `.extract()` of
 *     `ChartTypeSchema`, not a second enum that happened to agree with it.
 *   - `WidgetActionTypeSchema` — `ActionType` itself. It used to omit `form`,
 *     and so rejected at validation what the `ActionRunner` a widget action
 *     dispatches through already executes.
 */
import { describe, it, expect } from 'vitest';
import { ChartTypeSchema } from './chart.zod';
import { ListChartConfigSchema } from './view.zod';
import { ActionType } from './action.zod';
import { WidgetActionTypeSchema } from './dashboard.zod';

/** `z.enum(...).options` through the lazySchema proxy. */
const optionsOf = (schema: unknown): string[] =>
  (schema as { options: string[] }).options;

describe('ListChartConfigSchema.chartType is extracted from ChartTypeSchema', () => {
  const listChartType = (ListChartConfigSchema as unknown as {
    shape: { chartType: { def: { innerType: unknown } } };
  }).shape.chartType.def.innerType;

  it('admits exactly the five list-chart visualisations', () => {
    expect(optionsOf(listChartType).slice().sort())
      .toEqual(['area', 'bar', 'line', 'pie', 'scatter']);
  });

  it('admits only members of the chart taxonomy', () => {
    const taxonomy = new Set(optionsOf(ChartTypeSchema));
    const strays = optionsOf(listChartType).filter(t => !taxonomy.has(t));
    expect(strays).toEqual([]);
  });

  /** Minimal valid config — `dataset` and `values` are both required. */
  const minimal = { dataset: 'sales_by_month', values: ['revenue'] };

  it('still rejects a taxonomy member outside the list-chart subset', () => {
    expect(() => ListChartConfigSchema.parse({ ...minimal, chartType: 'donut' })).toThrow();
    expect(() => ListChartConfigSchema.parse({ ...minimal, chartType: 'combo' })).toThrow();
  });

  it('accepts every member of the subset, and defaults to bar', () => {
    for (const chartType of optionsOf(listChartType)) {
      expect(ListChartConfigSchema.parse({ ...minimal, chartType }).chartType).toBe(chartType);
    }
    expect(ListChartConfigSchema.parse(minimal).chartType).toBe('bar');
  });
});

describe('WidgetActionTypeSchema is ActionType', () => {
  it('admits every action type, with no subset of its own', () => {
    expect(optionsOf(WidgetActionTypeSchema).slice().sort())
      .toEqual(optionsOf(ActionType).slice().sort());
  });

  it('admits form — the member the hand-kept subset had dropped', () => {
    expect(() => WidgetActionTypeSchema.parse('form')).not.toThrow();
  });

  it('still rejects an unknown action type', () => {
    expect(() => WidgetActionTypeSchema.parse('teleport')).toThrow();
  });
});
