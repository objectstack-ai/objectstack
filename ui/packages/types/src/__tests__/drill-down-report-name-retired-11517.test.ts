/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11517 — `DrillDownConfig.report`'s `{ name }` reference arm is
 * retired on all three faces, refused by name, with no alias window.
 *
 * The arm promised a named report reference. Nothing resolved it:
 * `DrillDownDrawer` draws a report only for a dataset-bound inline report, so a
 * `{ name }` drill listed the records and drew no report (measured through the
 * real drawer by objectui#11506's dev), and nothing produced it. So the arm
 * leaves the TypeScript face, the tolerant zod face (`DrillDownConfigSchema`,
 * and `safeValidateSchema`) and the strict authoring face
 * (`StrictAnyComponentSchema`, which `objectui validate` runs), and both zod faces refuse a bare
 * `{ name }` with an issue that names the retirement and the remedy.
 *
 * The same change names the pre-9.0 `objectName` form's retirement
 * (objectui#11506) on the tolerant face, where the reference arm used to read
 * such a value as `{ name }` and report it valid.
 *
 * The dataset-bound inline report still validates on every face (below); that
 * it still draws through the real drawer is pinned in
 * `apps/console/src/__tests__/drillDownReport.nameRetired-11517.test.tsx`.
 *
 * The `@ts-expect-error` lines are judged by `tsc -p tsconfig.test.json`, the
 * third leg of this package's `type-check`; vitest strips types.
 */
import { describe, expect, it } from 'vitest';
import type { DrillDownConfig, ObjectMetricDrillDownConfig, ObjectPivotDrillDownConfig } from '../data-display';
import { DrillDownConfigSchema, StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

type Issue = { code: string; path: PropertyKey[]; message: string; params?: { code?: string }; errors?: Issue[][] };
type Result = { success: boolean; data?: unknown; error?: { issues: unknown[] } };

/** Every issue, union branches unfolded and paths made absolute. */
const allIssues = (issues: Issue[] | undefined, prefix: PropertyKey[] = []): Issue[] =>
  (issues ?? []).flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return [{ ...issue, path }, ...(issue.errors ?? []).flatMap((branch) => allIssues(branch, path))];
  });
const issuesAt = (result: Result, path: string): Issue[] =>
  allIssues(result.error?.issues as Issue[] | undefined).filter((issue) => issue.path.join('.') === path);

/** The retired reference arm's whole shape. */
const NAME_ONLY = { name: 'deals_by_stage' };

/** The retired pre-9.0 object-bound drill report: `objectName` plus column objects. */
const PRE_9_REPORT = { name: 'pipeline', objectName: 'deal', type: 'summary', columns: [{ field: 'amount' }] };

/** A dataset-bound summary report, the one form `report` declares. */
const DATASET_REPORT = {
  name: 'deals_by_stage',
  label: 'Deals by Stage',
  type: 'summary',
  dataset: 'deals_ds',
  rows: ['stage'],
  values: ['amount_sum'],
  runtimeFilter: { region: 'emea' },
};

const PIVOT_BAG = { objectName: 'deal', rowField: 'stage', columnField: 'owner', valueField: 'amount', aggregation: 'sum' };
const pivotDrill = (report: unknown) => ({ type: 'object-pivot', properties: { ...PIVOT_BAG, drillDown: { enabled: true, report } } });
const chartDrill = (report: unknown) => ({ type: 'chart', chartType: 'bar', series: [{ name: 'revenue' }], drillDown: { report } });

/** Each zod door, the path its drill report sits at, and where its parsed report is. */
const FACES: ReadonlyArray<readonly [string, (report: unknown) => Result, string, (data: unknown) => unknown]> = [
  ['the mirror, DrillDownConfigSchema', (r) => DrillDownConfigSchema.safeParse({ report: r }), 'report',
    (d) => (d as { report?: unknown }).report],
  ['the tolerant face on an object-pivot', (r) => safeValidateSchema(pivotDrill(r)), 'properties.drillDown.report',
    (d) => (d as { properties: { drillDown: { report?: unknown } } }).properties.drillDown.report],
  ['the tolerant face on a chart', (r) => safeValidateSchema(chartDrill(r)), 'drillDown.report',
    (d) => (d as { drillDown: { report?: unknown } }).drillDown.report],
  ['the strict face on an object-pivot', (r) => StrictAnyComponentSchema.safeParse(pivotDrill(r)), 'properties.drillDown.report',
    (d) => (d as { properties: { drillDown: { report?: unknown } } }).properties.drillDown.report],
  ['the strict face on a chart', (r) => StrictAnyComponentSchema.safeParse(chartDrill(r)), 'drillDown.report',
    (d) => (d as { drillDown: { report?: unknown } }).drillDown.report],
];

describe('the TypeScript face refuses `report: { name }` (objectui#11517)', () => {
  it('is pinned at compile time, on the shared shape and on each block shape that reads `report`', () => {
    type Report = NonNullable<DrillDownConfig['report']>;
    // Keeps the refusals below from passing vacuously.
    type _ReportIsReal = Assert<Equal<IsAny<Report>, false>>;
    // The arm itself is gone: a `{ name: string }` is no member of the declaration.
    type _NoReferenceArm = Assert<Equal<{ name: string } extends Report ? true : false, false>>;

    // @ts-expect-error a name alone is no report: the `{ name }` arm is retired (objectui#11517).
    const shared: DrillDownConfig = { report: { name: 'deals_by_stage' } };
    // @ts-expect-error the same on `object-pivot`'s drill shape.
    const pivot: ObjectPivotDrillDownConfig = { report: { name: 'deals_by_stage' } };
    // @ts-expect-error the same on `object-metric`'s drill shape.
    const metric: ObjectMetricDrillDownConfig = { report: { name: 'deals_by_stage' } };
    const named: { name: string } = NAME_ONLY;
    // @ts-expect-error not only a fresh literal: a value typed as the retired arm is no report either.
    const handedAcross: DrillDownConfig = { report: named };

    // Control: the dataset-bound report compiles on all three.
    const report: Report = {
      name: 'deals_by_stage', label: 'Deals by Stage', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'],
    };
    const datasetBound: DrillDownConfig = { report };
    const onPivot: ObjectPivotDrillDownConfig = { report };
    const onMetric: ObjectMetricDrillDownConfig = { report };

    expect([shared, pivot, metric, handedAcross, datasetBound, onPivot, onMetric]).toHaveLength(7);
  });
});

describe('both zod faces refuse a bare `{ name }` by name (objectui#11517)', () => {
  it.each(FACES)('on %s', (_label, parse, at) => {
    const result = parse(NAME_ONLY);
    expect(result.success).toBe(false);
    const named = issuesAt(result, at).filter((issue) => issue.params?.code === 'DRILL_REPORT_REFERENCE_RETIRED');
    expect(named.map((issue) => issue.code), JSON.stringify(result.error?.issues)).toEqual(['custom']);
    // The named subjects the ruling asks for: the retirement, and the form to write instead.
    expect(named[0].message).toContain('objectui#11517');
    expect(named[0].message).toContain('dataset');
  });

  it('a `{ name }` with a non-string name is the same retired shape, and is named too', () => {
    const result = DrillDownConfigSchema.safeParse({ report: { name: 42 } });
    expect(result.success).toBe(false);
    expect(issuesAt(result, 'report').map((issue) => issue.params?.code)).toContain('DRILL_REPORT_REFERENCE_RETIRED');
  });

  it('boundary: an incomplete inline report is refused in the spec\'s own words, not as the retired reference', () => {
    // A matrix with no `values`: an inline report attempt, which the spec refuses for what it lacks.
    const result = DrillDownConfigSchema.safeParse({
      report: { name: 'deals_matrix', label: 'Deals', type: 'matrix', dataset: 'deals_ds', rows: ['stage'], columns: ['owner'] },
    });
    expect(result.success).toBe(false);
    const all = allIssues(result.error?.issues as Issue[] | undefined);
    expect(all.filter((issue) => issue.params?.code === 'DRILL_REPORT_REFERENCE_RETIRED')).toEqual([]);
    expect(all.map((issue) => issue.path.join('.'))).toContain('report.dataset');
  });
});

describe('both zod faces refuse the pre-9.0 `objectName` form by name (objectui#11506, named on the tolerant face by objectui#11517)', () => {
  it.each(FACES)('on %s', (_label, parse, at) => {
    const result = parse(PRE_9_REPORT);
    expect(result.success).toBe(false);
    const named = issuesAt(result, `${at}.objectName`);
    expect(named.map((issue) => issue.code), JSON.stringify(result.error?.issues)).toEqual(['invalid_type']);
    expect(named[0].message).toContain('objectui#11506');
    // Not read as the retired reference: the value carries more than a name.
    expect(allIssues(result.error?.issues as Issue[] | undefined)
      .filter((issue) => issue.params?.code === 'DRILL_REPORT_REFERENCE_RETIRED')).toEqual([]);
  });
});

describe('the dataset-bound inline report still validates on every face (objectui#11517)', () => {
  it.each(FACES)('on %s, every key kept', (_label, parse, _at, reportOf) => {
    const result = parse(DATASET_REPORT);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(reportOf(result.data)).toEqual(DATASET_REPORT);
  });
});
