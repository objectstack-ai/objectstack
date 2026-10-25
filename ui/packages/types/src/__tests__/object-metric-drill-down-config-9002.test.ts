/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectMetricDrillDownConfig` refuses `filter` and `mode` by name, and the
 * shared `DrillDownConfig` keeps both (objectui#9002, ruling B: a per-block
 * refusal, not a retirement).
 *
 * A metric is one aggregated number: it has no click event for a drill
 * `filter` to interpolate `${event.*}` against, and no row for `mode` to open
 * as a record. Chart and pivot DO read `filter` (through `computeDrillFilter`)
 * and the data table DOES read `mode`, so the shared type is the control here:
 * narrowing it would take a working member away from three other blocks.
 *
 * ## These assertions are compile-time only
 *
 * Same mechanism as `drill-down-config-declared-keys.test.ts`: the
 * `@ts-expect-error` lines and the `Assert` aliases are judged by
 * `tsc -p tsconfig.test.json`, the third leg of this package's `type-check`
 * script. Vitest strips types, so the `expect` at the bottom only keeps this a
 * collected suite. A `@ts-expect-error` line whose error disappears is itself
 * an error (TS2578), which is what makes each refusal below able to fail.
 *
 * The three refusals are one fresh literal per key, and one NON-fresh value:
 * an omitted key is an excess-property error only on a fresh literal, so the
 * widened `DrillDownConfig` handed across is the leg that tells a `?: never`
 * tombstone apart from a plain `Omit`.
 */

import { describe, it, expect } from 'vitest';
// Through the module the published `@object-ui/types/data-display` subpath
// serves, which is where the per-block shape is declared.
import type { DrillDownConfig, ObjectMetricDrillDownConfig } from '../data-display';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('ObjectMetricDrillDownConfig refuses drillDown.filter and drillDown.mode (objectui#9002)', () => {
  it('is pinned at compile time', () => {
    // Keeps every pin below from passing vacuously: an `any` shape would accept
    // the refused keys and make each `@ts-expect-error` unused for the wrong reason.
    type _MetricShapeIsReal = Assert<Equal<IsAny<ObjectMetricDrillDownConfig>, false>>;

    // The refusal, one key per line so each directive owns exactly one error.
    // @ts-expect-error `filter` is refused on `object-metric` (objectui#9002).
    const withFilter: ObjectMetricDrillDownConfig = { enabled: true, filter: { stage: 'won' } };
    // @ts-expect-error `mode` is refused on `object-metric` (objectui#9002).
    const withMode: ObjectMetricDrillDownConfig = { enabled: true, mode: 'record' };
    const shared: DrillDownConfig = { enabled: true, filter: { stage: 'won' } };
    // @ts-expect-error a shared config that may carry `filter` is not a metric drill config.
    const handedAcross: ObjectMetricDrillDownConfig = shared;

    // Accept control: every member the block reads still compiles.
    const live: ObjectMetricDrillDownConfig = {
      enabled: true,
      target: 'navigate',
      columns: ['name', 'amount'],
      maxRows: 25,
      title: 'Won deals',
      // The dataset-bound report the shape declares; its `{ name }` arm is retired (objectui#11517).
      report: { name: 'won_deals_by_owner', label: 'Won Deals by Owner', type: 'summary', dataset: 'deals_ds', rows: ['owner'], values: ['amount_sum'] },
    };
    // Still a `DrillDownConfig`, so `isDrillEnabled` / `resolveDrillTitle` take it.
    const liveAsShared: DrillDownConfig = live;

    // Control: the shared type keeps both keys for the blocks that read them.
    const chartOrTable: DrillDownConfig = { filter: { stage: 'won' }, mode: 'record' };

    expect([withFilter, withMode, handedAcross, liveAsShared, chartOrTable]).toHaveLength(5);
  });
});
