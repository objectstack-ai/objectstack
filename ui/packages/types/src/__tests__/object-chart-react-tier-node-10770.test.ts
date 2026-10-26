/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10770 — the react tier's `<ObjectChart>` node, on the
 * `ObjectChartSchema` face.
 *
 * The objectstack showcase `renewals-pipeline` page authors
 * `<ObjectChart objectName="showcase_invoice" type="bar" … series={[{ name:
 * 'total', label: 'Invoice value' }]} />`. The react-page wrapper
 * (`components/src/renderers/layout/react-page.tsx`) spreads those props into
 * an `object-chart` node, and parks the author's `type` as `specType` because
 * `type` is the node's discriminator. Both faces of `ObjectChartSchema`
 * refused that node: `chartType` was required, and every series entry needed
 * `dataKey`.
 *
 * Ruling `5617465269` principle 1 (objectui#7759): the spec's shape is the
 * authority. So the face now takes the spec's own `ChartSeries` /
 * `ChartSeriesSchema` as the AUTHOR arm of `series`, by reference, beside the
 * unchanged internal `{ dataKey }` arm, and the spec's `ChartType` as
 * `specType`. `chartType` is optional, and the mirror requires one of the two.
 *
 * What this file pins:
 *   (a) the spec side: the react block publishes `type` and `series` over
 *       `ChartConfigSchema`, whose series arm is `{ name }`;
 *   (b) the showcase node parses, on the mirror and through
 *       `safeValidateSchema` (the tolerant door) — at the door in
 *       the authored spelling, its props in the `properties` bag, since
 *       objectui#11276 armed the authored node with `ObjectChartBlockSchema`;
 *       the wrapper's flat node is the mirror's (post-hoist) reading;
 *   (c) the controls: a series entry with neither `name` nor `dataKey`, and a
 *       node that names no chart family, are refused;
 *   (d) both new crossings are the spec's by reference, not look-alikes;
 *   (e) the TS twin carries the same contract.
 */

import { describe, it, expect } from 'vitest';
import {
  ChartConfigSchema as SpecChartConfigSchema,
  ChartTypeSchema as SpecChartTypeSchema,
  REACT_BLOCKS,
  type ChartSeries as SpecChartSeries,
  type ChartType as SpecChartType,
} from '@objectstack/spec/ui';
import type { ObjectChartSchema } from '../objectql';
import { ObjectChartSchema as ObjectChartMirror } from '../zod/objectql.zod';
import { safeValidateSchema } from '../zod/index.zod';

/**
 * The node the react-page wrapper builds from the showcase `renewals-pipeline`
 * page's `<ObjectChart>`: `{ ...props, specType, type: tag }`. The wrapper no
 * longer writes the host adapter (or `null`) under `dataSource`: the adapter
 * reaches the block through the page's `SchemaRendererProvider` alone
 * (objectui#11070, round 2), and `dataSource` on this node is the spec's
 * per-element BINDING, declared since round 7 — so a `null` there is refused
 * (pinned in (c) below).
 */
const SHOWCASE_NODE = {
  objectName: 'showcase_invoice',
  aggregate: { field: 'total', function: 'sum', groupBy: 'status' },
  xAxis: { field: 'status' },
  yAxis: [{ field: 'total', format: '$0,0' }],
  series: [{ name: 'total', label: 'Invoice value' }],
  title: 'Invoice value by status',
  showLegend: true,
  specType: 'bar',
  type: 'object-chart',
} as const;

/**
 * The same props as an AUTHORED node writes them (objectui#11276): in the
 * `properties` bag. A binding, when the author writes one, sits beside the bag
 * at node level (see (b)). The door judges this spelling; the wrapper's flat
 * node above is what the mirror judges.
 */
const SHOWCASE_AUTHORED = (() => {
  const { type, ...props } = SHOWCASE_NODE;
  return { type, properties: props };
})();

const issuesOf = (doc: unknown) => {
  const r = ObjectChartMirror.safeParse(doc);
  if (r.success) throw new Error('expected REFUSE, got ACCEPT');
  return r.error.issues;
};

/* ── Type-level pins (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type SeriesEntry = NonNullable<ObjectChartSchema['series']>[number];

/** The author arm IS the spec's `ChartSeries`, read off the union by its binding key. */
export type assertionAuthorArmIsTheSpecSeries = Expect<Equal<Extract<SeriesEntry, { name: string }>, SpecChartSeries>>;
/** The internal arm is still there, and still binds through a required `dataKey`. */
export type assertionInternalArmKeepsDataKey = Expect<Equal<Extract<SeriesEntry, { dataKey: string }>['dataKey'], string>>;
/** `specType` is the spec's `ChartType`, by reference. */
export type assertionSpecTypeIsTheSpecChartType = Expect<Equal<ObjectChartSchema['specType'], SpecChartType | undefined>>;
/** `chartType` is optional on this face; the mirror carries the one-of floor. */
export type assertionChartTypeIsOptional = Expect<Equal<undefined extends ObjectChartSchema['chartType'] ? true : false, true>>;
/** The helper can FAIL — synthetic control (an undeclared key reads `any`). */
export type assertionEqualCanFail = Expect<Equal<Equal<any, SpecChartType | undefined>, false>>;

/* ── (a) the spec side ──────────────────────────────────────────────────── */

describe('objectui#10770 (a) — the spec publishes `type` and `series: [{ name }]` on the react block', () => {
  it('the `object-chart` react block lists both keys over `ChartConfigSchema`', () => {
    const block = REACT_BLOCKS.find((b) => b.schemaType === 'object-chart');
    expect(block, 'no REACT_BLOCKS entry for object-chart in the installed spec').toBeDefined();
    expect(block!.schema).toBe(SpecChartConfigSchema);
    expect(block!.dataProps).toEqual(expect.arrayContaining(['type', 'series']));
  });

  it('`ChartConfigSchema` takes the `{ name }` arm and refuses `dataKey` there', () => {
    expect(SpecChartConfigSchema.safeParse({ type: 'bar', series: [{ name: 'total', label: 'Invoice value' }] }).success).toBe(true);
    const internal = SpecChartConfigSchema.safeParse({ type: 'bar', series: [{ dataKey: 'total' }] });
    expect(internal.success).toBe(false);
  });
});

/* ── (b) the showcase node parses ─────────────────────────────────────────── */

describe('objectui#10770 (b) — the react tier\'s showcase node parses', () => {
  it('on the mirror, with zero issues', () => {
    const r = ObjectChartMirror.safeParse(SHOWCASE_NODE);
    expect(r.error?.issues ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('through `safeValidateSchema`, the tolerant parse', () => {
    const r = safeValidateSchema(SHOWCASE_AUTHORED);
    expect(r.error?.issues ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('with a per-element binding at node level, beside the bag (objectui#11070)', () => {
    const r = safeValidateSchema({ ...SHOWCASE_AUTHORED, dataSource: { object: 'showcase_invoice' } });
    expect(r.error?.issues ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('keeps the authored series as written: the spec\'s defaults are not injected', () => {
    const r = ObjectChartMirror.safeParse(SHOWCASE_NODE);
    expect(r.data?.series).toEqual(SHOWCASE_NODE.series);
  });
});

/* ── (c) the controls ────────────────────────────────────────────────────── */

describe('objectui#10770 (c) — what stays refused', () => {
  it('a series entry that names no column, neither `name` nor `dataKey`', () => {
    const issues = issuesOf({ ...SHOWCASE_NODE, series: [{ label: 'Invoice value' }] });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_union', ['series', 0]]]);
  });

  it('a node that names no chart family, neither `chartType` nor `specType`', () => {
    const { specType: _family, ...noFamily } = SHOWCASE_NODE;
    const issues = issuesOf(noFamily);
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['chartType']]]);
  });

  it('either family key alone is enough (the control for the control above)', () => {
    const { specType: _family, ...noFamily } = SHOWCASE_NODE;
    expect(ObjectChartMirror.safeParse({ ...noFamily, chartType: 'bar' }).success).toBe(true);
    expect(ObjectChartMirror.safeParse({ type: 'object-chart', specType: 'line' }).success).toBe(true);
  });

  it('a `null` `dataSource`, the adapter placeholder the wrapper no longer writes (objectui#11070)', () => {
    const issues = issuesOf({ ...SHOWCASE_NODE, dataSource: null });
    expect(issues.map((i) => [i.code, i.path])).toEqual([['invalid_type', ['dataSource']]]);
  });

  it('the internal `{ dataKey }` arm is unchanged', () => {
    const r = ObjectChartMirror.safeParse({ type: 'object-chart', chartType: 'bar', series: [{ dataKey: 'amount', chartType: 'line' }] });
    expect(r.error?.issues ?? []).toEqual([]);
  });
});

/* ── (d) both new crossings are the spec's, not look-alikes ────────────────── */

describe('objectui#10770 (d) — the author arm and `specType` are the spec\'s, by reference', () => {
  it('the author arm is STRICT: an unknown key is refused by name, not stripped', () => {
    // `field` is the AXIS spelling of a series' `name`. A strip-postured local
    // copy of the arm would drop it and parse; the spec's closed shape refuses
    // it by name. The internal arm refuses the entry too (no `dataKey`), so the
    // union issue carries each arm's own verdict.
    const [issue, ...rest] = issuesOf({ ...SHOWCASE_NODE, series: [{ name: 'total', field: 'total' }] });
    expect(rest).toEqual([]);
    expect(issue!.code).toBe('invalid_union');
    const [authorArm] = (issue as unknown as { errors: Array<Array<{ code: string; keys?: string[] }>> }).errors;
    expect(authorArm).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unrecognized_keys', keys: ['field'] })]));
  });

  it('`specType` takes every value of the spec\'s `ChartTypeSchema`, and nothing else', () => {
    for (const family of SpecChartTypeSchema.options) {
      expect(ObjectChartMirror.safeParse({ type: 'object-chart', specType: family }).success, family).toBe(true);
    }
    const bogus = issuesOf({ type: 'object-chart', specType: 'bar-chart' });
    expect(bogus.map((i) => [i.code, i.path])).toEqual([['invalid_value', ['specType']]]);
  });
});

/* ── (e) the TS twin ─────────────────────────────────────────────────────── */

describe('objectui#10770 (e) — the TS twin types the react tier\'s node', () => {
  it('accepts the showcase node at the authoring site', () => {
    const node: ObjectChartSchema = {
      type: 'object-chart',
      objectName: 'showcase_invoice',
      specType: 'bar',
      aggregate: { field: 'total', function: 'sum', groupBy: 'status' },
      xAxis: { field: 'status' },
      yAxis: [{ field: 'total', format: '$0,0' }],
      series: [{ name: 'total', label: 'Invoice value' }],
      title: 'Invoice value by status',
    };
    expect(node.series).toHaveLength(1);
  });

  it('refuses what the mirror refuses, checked by `tsc -p tsconfig.test.json`', () => {
    // Not `as const`: a readonly literal would fail every line below for a
    // reason of its own, and each `@ts-expect-error` would pass without testing.
    const base = { type: 'object-chart' as const, specType: 'bar' as const };
    const refused: ObjectChartSchema[] = [
      // @ts-expect-error — a series entry names its column with `name` or `dataKey`
      { ...base, series: [{ label: 'Invoice value' }] },
      // @ts-expect-error — `specType` is the spec's `ChartType`
      { ...base, specType: 'bar-chart' },
    ];
    expect(refused).toHaveLength(2);
  });
});
