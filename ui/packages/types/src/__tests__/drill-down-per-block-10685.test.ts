/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Each drill block refuses, by name, the `DrillDownConfig` members it can
 * never honour (objectui#10685, applying objectui#9002's ruling B, a per-block
 * refusal, to the sibling blocks of `object-metric`, whose pin is
 * `object-metric-drill-down-config-9002.test.ts`).
 *
 * One `describe` per block. Each refuses its members one per line, so each
 * `@ts-expect-error` owns exactly one error, and each carries a control that
 * compiles: the members the block DOES read.
 *
 *  - `object-pivot`: `mode`. Every pivot click point is an aggregated bucket,
 *    so the pivot always drills through; there is no row to open as a record.
 *  - `object-chart`: `mode` and `report`. Its drill shape is the spec's
 *    `ChartDrillDown`, the chart subset that declares neither (bound by
 *    objectui#8885, whose pin holds that binding with `Equal`). A chart segment
 *    is an aggregated bucket too, and the chart's own drawer renders a record
 *    list, never a report. This half was already refused before this card, by
 *    omission from the spec type; it is pinned here so each block's refused
 *    set sits in one place.
 *  - `object-data-table`: `filter`, `maxRows`, `report`, and `target:
 *    'navigate'`. A row drills to the one record it already is, so a drilled
 *    list's filter, row cap and report have nothing to act on, and
 *    `'navigate'` (the object's list page) is the wrong destination. This is
 *    the one block with a zod door that reads its drill members
 *    (`safeValidateSchema`, the tolerant face), so it is pinned on
 *    both doors.
 *
 * ## Two instruments
 *
 * The `@ts-expect-error` lines are judged by `tsc -p tsconfig.test.json`, the
 * third leg of this package's `type-check` script. Vitest strips types, so for
 * those blocks the `expect` only keeps the block a collected suite. A
 * `@ts-expect-error` line whose error disappears is itself an error (TS2578),
 * which is what lets each refusal fail. The zod `describe` at the bottom is a
 * RUNTIME pin, judged by vitest.
 */

import { describe, it, expect } from 'vitest';
// The per-block shapes through the module the published
// `@object-ui/types/data-display` subpath serves; the chart through the barrel.
import type { DrillDownConfig, ObjectDataTableDrillDownConfig, ObjectPivotDrillDownConfig } from '../data-display';
import type { ObjectChartSchema, ObjectDataTableSchema } from '../index';
import { safeValidateSchema } from '../zod/index.zod';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('object-pivot refuses drillDown.mode (objectui#10685)', () => {
  it('is pinned at compile time', () => {
    // Keeps the refusals below from passing vacuously: an `any` shape would
    // accept `mode` and leave each `@ts-expect-error` unused for the wrong reason.
    type _PivotShapeIsReal = Assert<Equal<IsAny<ObjectPivotDrillDownConfig>, false>>;

    // @ts-expect-error `mode` is refused on `object-pivot` (objectui#10685).
    const withMode: ObjectPivotDrillDownConfig = { enabled: true, mode: 'filter' };
    const shared: DrillDownConfig = { enabled: true, mode: 'record' };
    // @ts-expect-error a shared config that may carry `mode` is not a pivot drill config.
    const handedAcross: ObjectPivotDrillDownConfig = shared;

    // Control: every member the pivot reads still compiles, `report` included, as
    // the dataset-bound report it declares (its `{ name }` arm is retired, objectui#11517).
    const live: ObjectPivotDrillDownConfig = {
      enabled: true,
      filter: { stage: '${event.rowKey}' },
      title: '${event.rowLabel} × ${event.colLabel}',
      target: 'navigate',
      columns: ['name', 'amount'],
      maxRows: 25,
      report: { name: 'won_deals_by_owner', label: 'Won Deals by Owner', type: 'summary', dataset: 'deals_ds', rows: ['owner'], values: ['amount_sum'] },
    };
    // Still a `DrillDownConfig`, so `computeDrillFilter` and friends take it.
    const liveAsShared: DrillDownConfig = live;

    // Control: the shared type keeps `mode` for `object-data-table`.
    const table: DrillDownConfig = { enabled: true, mode: 'record' };

    expect([withMode, handedAcross, liveAsShared, table]).toHaveLength(4);
  });
});

describe('object-chart refuses drillDown.mode and drillDown.report (objectui#10685)', () => {
  it('is pinned at compile time', () => {
    type _ChartDrillIsReal = Assert<Equal<IsAny<NonNullable<ObjectChartSchema['drillDown']>>, false>>;

    const base = { type: 'object-chart', chartType: 'bar', objectName: 'opportunity' } as const;

    // @ts-expect-error `mode` is not a chart drill member: a segment always drills through.
    const withMode: ObjectChartSchema = { ...base, drillDown: { enabled: true, mode: 'record' } };
    // A valid report, so the one error is the member, not its value.
    // @ts-expect-error `report` is not a chart drill member: the chart's drawer lists records.
    const withReport: ObjectChartSchema = { ...base, drillDown: { enabled: true, report: { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] } } };

    // Control: every member the chart reads still compiles.
    const live: ObjectChartSchema = {
      ...base,
      drillDown: {
        enabled: true,
        filter: { stage: '${event.category}' },
        title: '${event.category}',
        target: 'navigate',
        columns: ['name', 'amount'],
        maxRows: 50,
      },
    };

    expect([withMode, withReport, live]).toHaveLength(3);
  });
});

describe('object-data-table refuses drillDown.filter, .maxRows, .report and target navigate (objectui#10685)', () => {
  it('is pinned at compile time, on the per-block shape and on the schema the prop is anchored to', () => {
    type _TableShapeIsReal = Assert<Equal<IsAny<ObjectDataTableDrillDownConfig>, false>>;
    // The anchored schema takes the per-block shape, not the shared one.
    type _SchemaTakesTheTableShape = Assert<
      Equal<ObjectDataTableSchema['drillDown'], ObjectDataTableDrillDownConfig | undefined>
    >;

    // One refused member per line, so each directive owns exactly one error.
    // @ts-expect-error `filter` is refused on `object-data-table` (objectui#10685).
    const withFilter: ObjectDataTableDrillDownConfig = { enabled: true, filter: { stage: 'won' } };
    // @ts-expect-error `maxRows` is refused on `object-data-table` (objectui#10685).
    const withMaxRows: ObjectDataTableDrillDownConfig = { enabled: true, maxRows: 25 };
    // @ts-expect-error `report` is refused on `object-data-table` (objectui#10685).
    const withReport: ObjectDataTableDrillDownConfig = { enabled: true, report: { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] } };
    // @ts-expect-error `target: 'navigate'` is refused on `object-data-table` (objectui#10685).
    const withNavigate: ObjectDataTableDrillDownConfig = { enabled: true, target: 'navigate' };
    const shared: DrillDownConfig = { enabled: true, mode: 'record' };
    // @ts-expect-error a shared config that may carry any of them is not a table drill config.
    const handedAcross: ObjectDataTableDrillDownConfig = shared;

    const base = { type: 'object-data-table', objectName: 'opportunity' } as const;
    // @ts-expect-error the same refusal through the node an author writes.
    const nodeWithFilter: ObjectDataTableSchema = { ...base, drillDown: { enabled: true, filter: { stage: 'won' } } };
    // @ts-expect-error the same refusal through the node an author writes.
    const nodeWithNavigate: ObjectDataTableSchema = { ...base, drillDown: { enabled: true, target: 'navigate' } };

    // Control: every member the block reads still compiles, `enabled` and `mode` first.
    const live: ObjectDataTableDrillDownConfig = {
      enabled: true,
      mode: 'record',
      title: 'Opportunity',
      columns: ['name', 'amount'],
      target: 'dialog',
    };
    const liveNode: ObjectDataTableSchema = { ...base, drillDown: { enabled: false, mode: 'filter', target: 'drawer' } };
    // Still a `DrillDownConfig`, so `isDrillEnabled` takes it.
    const liveAsShared: DrillDownConfig = live;

    expect([
      withFilter, withMaxRows, withReport, withNavigate, handedAcross,
      nodeWithFilter, nodeWithNavigate, liveNode, liveAsShared,
    ]).toHaveLength(9);
  });
});

describe('object-data-table: the zod door refuses the same members by name (objectui#10685)', () => {
  const table = (drillDown: unknown) => ({ type: 'object-data-table', objectName: 'opportunity', drillDown });

  it('accepts a config carrying every member the block reads', () => {
    for (const drillDown of [
      {},
      { enabled: true, mode: 'record', title: 'Opportunity', columns: ['name', 'amount'], target: 'dialog' },
      { enabled: false, mode: 'filter', target: 'drawer' },
    ]) {
      const r = safeValidateSchema(table(drillDown));
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    }
  });

  it.each([
    ['filter', { filter: { stage: 'won' } }, 'invalid_type'],
    ['maxRows', { maxRows: 25 }, 'invalid_type'],
    ['report', { report: { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] } }, 'invalid_type'],
    ['target', { target: 'navigate' }, 'invalid_value'],
  ] as const)('refuses drillDown.%s, and the issue names the key', (key, member, code) => {
    const r = safeValidateSchema(table({ enabled: true, ...member }));
    expect(r.success).toBe(false);
    const issues = r.success ? [] : r.error.issues;
    const mine = issues.filter((i) => i.path.join('.') === `drillDown.${key}`);
    expect(mine, JSON.stringify(issues)).toHaveLength(1);
    expect(mine[0].code).toBe(code);
    // The named subject, not the wording: the message spells out the key it refuses.
    expect(mine[0].message).toContain(`drillDown.${key}`);
  });
});
