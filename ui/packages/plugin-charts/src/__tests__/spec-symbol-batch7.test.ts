/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/plugin-charts` ↔ `@objectstack/spec` symbol-collision guard
 * (objectui#3161, objectstack#4115 ledger batch 7).
 *
 * `ChartConfig` → `ChartContainerConfig`. Of the fourteen symbols in this
 * batch, this is the one whose collision had already produced a live
 * ambiguity in READ code rather than a latent one: `AdvancedChartImpl.tsx`
 * declared `config?: ChartConfig` meaning the per-series style map, a few lines
 * from doc comments reading "Spec `ChartConfig.yAxis`" and "Spec
 * `ChartConfig.showLegend`" meaning the authored chart document. Both are
 * still there — the comments are correct now that only one of the two wears
 * the name.
 *
 * `normalizeChartSchema` is the seam between the two layers, so the pins below
 * assert they stay two layers.
 */

import { describe, it, expect } from 'vitest';
import { ChartConfigSchema, type ChartConfig as SpecChartConfig } from '@objectstack/spec/ui';

import type { ChartContainerConfig } from '../ChartContainerImpl';

describe('the spec still owns ChartConfig for the authored chart', () => {
  it('the schema is there and describes a chart document, not a style map', () => {
    const parsed = ChartConfigSchema.safeParse({ type: 'bar' });
    expect(parsed.success, 'the spec ChartConfig no longer accepts a minimal bar chart').toBe(true);

    // A style map is not a chart document — the authored schema rejects it.
    // (`type` is required there and is a chart FAMILY, not a series key.)
    const asStyleMap = ChartConfigSchema.safeParse({ revenue: { label: 'Revenue', color: '#f00' } });
    expect(asStyleMap.success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Compile-time pins — this package's tsconfig.json includes its tests, so     */
/* `type-check` compiles them.                                                */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe('the style map and the authored chart are different types', () => {
  it('is pinned at compile time', () => {
    type _SpecIsReal = Assert<Equal<IsAny<SpecChartConfig>, false>>;

    // Neither can stand in for the other. If either of these ever becomes
    // `true`, the two concepts have merged and this rename needs re-reading.
    type _StyleMapIsNotAChart = Assert<Equal<Extends<ChartContainerConfig, SpecChartConfig>, false>>;
    type _ChartIsNotAStyleMap = Assert<Equal<Extends<SpecChartConfig, ChartContainerConfig>, false>>;

    // What each one is: a chart family vs an open map keyed by series dataKey.
    type _AuthoredHasAFamily = Assert<HasKey<SpecChartConfig, 'type'>>;
    type _StyleMapIsKeyedBySeries = Assert<Extends<string, keyof ChartContainerConfig>>;

    expect(true).toBe(true);
  });
});
