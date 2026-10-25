/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
// Imports all renderers to register them. Module scope, NOT awaited inside a
// `beforeAll` — there the cold transform of the (recharts-backed) renderer graph
// is billed to the hook, which is why this needed a 60s `hookTimeout` to begin
// with. The import phase has no test/hook timeout, so the raised timeout goes
// away rather than getting raised again (objectui#3010).
// See AGENTS.md §9 (test discipline).
import './index';

describe('Plugin Charts', () => {
  describe('bar-chart component', () => {
    it('should be registered in ComponentRegistry', () => {
      const chartBarRenderer = ComponentRegistry.get('bar-chart');
      expect(chartBarRenderer).toBeDefined();
    });

    it('should have proper metadata', () => {
      const config = ComponentRegistry.getConfig('bar-chart');
      expect(config).toBeDefined();
      expect(config?.label).toBe('Bar Chart');
      expect(config?.category).toBe('plugin');
      expect(config?.inputs).toBeDefined();
      expect(config?.defaultProps).toBeDefined();
    });

    it('should have expected inputs', () => {
      const config = ComponentRegistry.getConfig('bar-chart');
      const inputNames = config?.inputs?.map((input: any) => input.name) || [];
      
      expect(inputNames).toContain('data');
      expect(inputNames).toContain('dataKey');
      expect(inputNames).toContain('xAxisKey');
      expect(inputNames).toContain('height');
      expect(inputNames).toContain('color');
    });

    it('should have data as required input', () => {
      const config = ComponentRegistry.getConfig('bar-chart');
      const dataInput = config?.inputs?.find((input: any) => input.name === 'data');
      
      expect(dataInput).toBeDefined();
      expect(dataInput?.required).toBe(true);
      expect(dataInput?.type).toBe('array');
    });

    it('should have sensible default props', () => {
      const config = ComponentRegistry.getConfig('bar-chart');
      const defaults = config?.defaultProps;
      
      expect(defaults).toBeDefined();
      expect(defaults?.dataKey).toBe('value');
      expect(defaults?.xAxisKey).toBe('name');
      expect(defaults?.height).toBe(400);
      expect(defaults?.color).toBe('#8884d8');
      expect(defaults?.data).toBeDefined();
      expect(Array.isArray(defaults?.data)).toBe(true);
      expect(defaults?.data.length).toBeGreaterThan(0);
    });
  });

  describe('chart (advanced) component', () => {
    it('should be registered in ComponentRegistry', () => {
      const chartRenderer = ComponentRegistry.get('chart');
      expect(chartRenderer).toBeDefined();
    });

    it('should have proper metadata', () => {
      const config = ComponentRegistry.getConfig('chart');
      expect(config).toBeDefined();
      expect(config?.label).toBe('Chart');
      expect(config?.category).toBe('plugin');
      expect(config?.inputs).toBeDefined();
      expect(config?.defaultProps).toBeDefined();
    });

    it('should have expected inputs', () => {
      const config = ComponentRegistry.getConfig('chart');
      const inputNames = config?.inputs?.map((input: any) => input.name) || [];
      
      expect(inputNames).toContain('chartType');
      expect(inputNames).toContain('data');
      expect(inputNames).toContain('config');
      expect(inputNames).toContain('xAxisKey');
      expect(inputNames).toContain('series');
      expect(inputNames).toContain('className');
    });

    it('should have chartType as enum input', () => {
      const config = ComponentRegistry.getConfig('chart');
      const chartTypeInput = config?.inputs?.find((input: any) => input.name === 'chartType');
      
      expect(chartTypeInput).toBeDefined();
      expect(chartTypeInput?.type).toBe('enum');
      expect(chartTypeInput?.enum).toBeDefined();
      expect(Array.isArray(chartTypeInput?.enum)).toBe(true);
      
      const enumValues = chartTypeInput?.enum?.map((e: any) => e.value) || [];
      expect(enumValues).toContain('bar');
      expect(enumValues).toContain('line');
      expect(enumValues).toContain('area');
    });

    it('should have data and series as required inputs', () => {
      const config = ComponentRegistry.getConfig('chart');
      const dataInput = config?.inputs?.find((input: any) => input.name === 'data');
      const seriesInput = config?.inputs?.find((input: any) => input.name === 'series');
      
      expect(dataInput?.required).toBe(true);
      expect(seriesInput?.required).toBe(true);
    });

    it('should have sensible default props', () => {
      const config = ComponentRegistry.getConfig('chart');
      const defaults = config?.defaultProps;
      
      expect(defaults).toBeDefined();
      expect(defaults?.chartType).toBe('bar');
      expect(defaults?.xAxisKey).toBe('name');
      expect(defaults?.data).toBeDefined();
      expect(Array.isArray(defaults?.data)).toBe(true);
      expect(defaults?.data.length).toBeGreaterThan(0);
      expect(defaults?.config).toBeDefined();
      expect(typeof defaults?.config).toBe('object');
      expect(defaults?.series).toBeDefined();
      expect(Array.isArray(defaults?.series)).toBe(true);
      expect(defaults?.series.length).toBeGreaterThan(0);
    });
  });
});

// framework#5022 — the segment drill is a CONTRACT prop now, on both sides.
//
// The SDUI save gate validates a page's JSX against a manifest built from these
// registry `inputs` (`manifestFromConfigs` copies them verbatim), so a prop that
// is missing here is reported as `unknown-prop` — which is what an author
// writing `drillDown` got, for a prop `ObjectChart` has read all along. The spec
// half is `ChartDrillDownSchema`; this is the half that makes the gate agree.
describe('object-chart — drillDown is a declared input (framework#5022)', () => {
  const inputs = () => ComponentRegistry.getConfig('object-chart')?.inputs ?? [];

  it('declares drillDown, so the save gate stops calling it unknown', () => {
    const drill = inputs().find((i: any) => i.name === 'drillDown');
    expect(drill, 'the registry must publish the prop the renderer reads').toBeDefined();
    expect(drill?.type).toBe('object');
  });

  it('describes the SIX keys the spec declares — not the wider renderer union', () => {
    // objectui's own `DrillDownConfig` is shared with the table/pivot/metric
    // widgets and also carries `mode` / `report`. ObjectChart reads neither, so
    // advertising them here would re-open the gap framework#5022 closed — one
    // layer down, in the designer palette.
    //
    // `navigate` stays on the withheld side — but ⚠️ NOT for the reason this
    // comment carried until objectui#7946's rework round. It said
    // `ChartDrillDownSchema` declares the chart drill target as
    // `'drawer' | 'dialog'` strictly, so advertising `'navigate'` would hand an
    // author a value `validate-react-page-props` rejects at publish. Measured
    // on `@objectstack/spec` 17.4.0, that is FALSE: `ChartDrillDownSchema.target`
    // is `['drawer','dialog','navigate']` (objectstack#5435 widened it after
    // objectui#3354 implemented the arm), and the publish gate parses that same
    // schema — so it accepts the value.
    //
    // The assertion below is UNCHANGED anyway, because what is left is an unmade
    // decision rather than a protocol gap: widening an advertised authoring
    // vocabulary is a contract decision about `drillDown`, a key objectui#7946
    // declares on neither published face and objectui#8885 does. When that card
    // takes it, `'navigate'` moves from the withheld list to the described one
    // and this rationale goes with it.
    //
    // `view` / `sort` are not listed on either side any more — objectui#3354
    // deleted them from `DrillDownConfig`, so there is no key left to advertise
    // or withhold.
    const d = String(inputs().find((i: any) => i.name === 'drillDown')?.description ?? '');
    for (const key of ['enabled', 'filter', 'title', 'target', 'columns', 'maxRows']) {
      expect(d, `the declared key ${key} must be described`).toContain(key);
    }
    for (const key of ['mode', 'report', 'navigate']) {
      expect(d, `${key} is not in the spec's chart subset — it must not be advertised here`).not.toContain(key);
    }
  });
});
