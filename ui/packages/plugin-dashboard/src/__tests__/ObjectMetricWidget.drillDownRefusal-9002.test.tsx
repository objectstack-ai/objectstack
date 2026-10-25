/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-metric` — `drillDown.filter` and `drillDown.mode` are refused on the
 * prop type an author writes against (objectui#9002, ruling B).
 *
 * `ObjectMetricDrillDownConfig` in `@object-ui/types` declares the per-block
 * shape, and its own pin lives beside it. This file pins the other half: that
 * the component this package PUBLISHES takes that shape and not the shared
 * `DrillDownConfig`. The narrowing is worth nothing if the widget's prop still
 * says `DrillDownConfig`, and that is a one-word regression in this package that
 * the `@object-ui/types` pin cannot see.
 *
 * Read through the package entry (`../index`), so the type under test is the
 * one a consumer of `@object-ui/plugin-dashboard` reaches.
 *
 * ## These assertions are compile-time only
 *
 * Judged by `tsc -p tsconfig.test.json`, the second leg of this package's
 * `type-check` script, which resolves `@object-ui/types` through its BUILT
 * `.d.ts` (the config's empty `paths`). Vitest strips types; the `expect` only
 * keeps this a collected suite. What is deliberately NOT here: any runtime
 * assertion that the two keys are dead. The behaviour pins for this block
 * (`objectMetricDrillDownMembers-8071.test.tsx`) keep that restraint, and
 * nothing at runtime changed.
 */

import { describe, it, expect } from 'vitest';
import type React from 'react';
import type { DrillDownConfig } from '@object-ui/types';
import type { ObjectMetricDrillDownConfig } from '@object-ui/types/data-display';
import { ObjectMetricWidget } from '../index';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

type MetricDrillProp = NonNullable<React.ComponentProps<typeof ObjectMetricWidget>['drillDown']>;

describe('object-metric: drillDown.filter and drillDown.mode are refused on the prop type (objectui#9002)', () => {
  it('is pinned at compile time', () => {
    type _PropIsReal = Assert<Equal<IsAny<MetricDrillProp>, false>>;
    // The published component takes the per-block shape, not the shared one.
    type _PropIsTheMetricShape = Assert<Equal<MetricDrillProp, ObjectMetricDrillDownConfig>>;

    const base = { objectName: 'deal', label: 'Revenue' } as const;

    // The refusal, one key per line so each directive owns exactly one error.
    // @ts-expect-error `drillDown.filter` is refused on `object-metric` (objectui#9002).
    const withFilter = <ObjectMetricWidget {...base} drillDown={{ enabled: true, filter: { stage: 'won' } }} />;
    // @ts-expect-error `drillDown.mode` is refused on `object-metric` (objectui#9002).
    const withMode = <ObjectMetricWidget {...base} drillDown={{ enabled: true, mode: 'record' }} />;

    // Accept control: the members this block reads still compile.
    const live = (
      <ObjectMetricWidget
        {...base}
        drillDown={{ enabled: true, target: 'dialog', columns: ['name'], maxRows: 5, title: 'Won deals' }}
      />
    );

    // Control: the shared type keeps both keys for chart / pivot / data table.
    const shared: DrillDownConfig = { filter: { stage: 'won' }, mode: 'record' };

    expect([withFilter, withMode, live, shared]).toHaveLength(4);
  });
});
