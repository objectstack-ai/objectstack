/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-pivot` — `drillDown.mode` is refused on the prop type an author writes
 * against (objectui#10685, applying objectui#9002's ruling B to the sibling
 * blocks of `object-metric`).
 *
 * `ObjectPivotDrillDownConfig` in `@object-ui/types` declares the per-block
 * shape, and its own pin lives beside it
 * (`drill-down-per-block-10685.test.ts`). This file pins the other half: that
 * the component this package PUBLISHES takes that shape on `schema.drillDown`,
 * and not the shared `DrillDownConfig` that `PivotTableSchema` carries. The
 * refusal is worth nothing if the widget's prop still admits the shared type,
 * and that is a one-line regression in this package the `@object-ui/types` pin
 * cannot see.
 *
 * Read through the package entry (`../index`), so the type under test is the
 * one a consumer of `@object-ui/plugin-dashboard` reaches.
 *
 * ## These assertions are compile-time only
 *
 * Judged by `tsc -p tsconfig.test.json`, the second leg of this package's
 * `type-check` script, which resolves `@object-ui/types` through its BUILT
 * `.d.ts`. Vitest strips types; the `expect` only keeps this a collected suite.
 * Runtime behaviour did not change, so nothing here asserts any.
 */

import { describe, it, expect } from 'vitest';
import type { DrillDownConfig } from '@object-ui/types';
import { ObjectPivotTable } from '../index';

describe('object-pivot: drillDown.mode is refused on the prop type (objectui#10685)', () => {
  it('is pinned at compile time', () => {
    const base = {
      type: 'pivot' as const,
      objectName: 'deal',
      rowField: 'stage',
      columnField: 'source',
      valueField: 'amount',
      data: [] as Record<string, unknown>[],
    };

    // @ts-expect-error `drillDown.mode` is refused on `object-pivot` (objectui#10685).
    const withMode = <ObjectPivotTable schema={{ ...base, drillDown: { enabled: true, mode: 'record' } }} />;
    const shared: DrillDownConfig = { enabled: true, mode: 'record' };
    // @ts-expect-error a shared config that may carry `mode` is not the pivot's drill shape.
    const handedAcross = <ObjectPivotTable schema={{ ...base, drillDown: shared }} />;

    // Accept control: the members this block reads still compile.
    const live = (
      <ObjectPivotTable
        schema={{
          ...base,
          drillDown: {
            enabled: true,
            filter: { stage: 'won' },
            title: 'Won deals',
            target: 'dialog',
            columns: ['name'],
            maxRows: 5,
            // The dataset-bound report the shape declares; its `{ name }` arm is retired (objectui#11517).
            report: { name: 'won_deals_by_owner', label: 'Won Deals by Owner', type: 'summary', dataset: 'deals_ds', rows: ['owner'], values: ['amount_sum'] },
          },
        }}
      />
    );

    expect([withMode, handedAcross, live]).toHaveLength(3);
  });
});
