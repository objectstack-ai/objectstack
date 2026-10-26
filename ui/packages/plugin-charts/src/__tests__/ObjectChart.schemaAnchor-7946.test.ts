/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7946 — `ObjectChartProps.schema` is anchored to the exported
 * `ObjectChartSchema` (`extends BaseSchema`), not `any`.
 *
 * Maintainer ruling 2026-09-09, option A (director seat, summon #20, decision
 * batch #108 item 3): as objectui#6576 did for the gallery, `ObjectChart`'s
 * props are typed by `ObjectChartSchema`, the four keys its producers write and
 * its renderer reads are declared on both published copies, and the `colors`
 * drift between them converges. B (keep `any`) and C (declare without
 * anchoring) were refused.
 *
 * ## Why this pin is compile-time
 *
 * The change is a TYPE declaration; the widget renders identically before and
 * after it, so a rendering test is blind to the whole change. What moves is the
 * ACCEPT SET of a published prop type, and `tsconfig.test.json` compiles this
 * file, so each statement below is real enforcement. Every `@ts-expect-error`
 * fails the build (TS2578) the moment the refusal it names stops happening.
 *
 * ## The before-state, and why "it still compiles" was never evidence
 *
 * objectui#7946 measured that removing both `as any` casts from `ObjectView`'s
 * two object-chart literals left `tsc --noEmit` GREEN over a program
 * `--listFiles` confirmed contained the file. That green said nothing: the
 * consumer was `(props: any)`, so every `schema={{ … }}` literal was checked
 * against nothing at all, cast or no cast. The probe had to MOVE, and the
 * `@ts-expect-error` blocks below are where it moves — each one was accepted
 * silently before this card.
 *
 * ## The ceiling, stated rather than assumed (objectui#5155)
 *
 * Anchoring buys DECLARED members their declared types. It did NOT buy
 * rejection of a MISSPELLING while `BaseSchema` carried `[key: string]: any`,
 * which `ObjectChartSchema` inherited, so `xAxisKy` compiled. objectui#6576
 * accepted that cost knowingly for the gallery; the counter-probe at the bottom
 * kept it visible so nobody read this anchor as more than it was. Closing it was
 * objectui#5155's, not this card's: objectui#8347 closed it, and the
 * counter-probe is flipped.
 *
 * The schema type's own members, the read census and the source-level pins are
 * in `packages/types/src/__tests__/widget-schema-anchors-7946.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { ObjectChartProps } from '../ObjectChart';
import type { BaseSchema, ObjectChartSchema } from '@object-ui/types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The anchor itself — invariant equality, so `any` or a second literal cannot creep back. */
export type assertionSchemaIsAnchored = Expect<Equal<ObjectChartProps['schema'], ObjectChartSchema>>;
export type assertionSchemaExtendsBase = Expect<[ObjectChartProps['schema']] extends [BaseSchema] ? true : false>;
/**
 * ⭐ The pin that fails for the RIGHT reason. `Equal<any, X>` is `false` for
 * every `X`, so the two assertions above already refuse a regression to
 * `props: any` — but only this one says so by name, and only this one keeps
 * working if `Equal` is ever replaced by a one-way `extends` check (which
 * `any` satisfies in both directions — the objectui#7087 lesson).
 */
export type assertionAnchorIsNotAny = Expect<Equal<0 extends 1 & ObjectChartProps['schema'] ? true : false, false>>;
/** The helpers can FAIL — synthetic controls, so a vacuous `Equal` cannot pass this file. */
export type assertionEqualCanFail = Expect<Equal<Equal<{ objectName?: string }, ObjectChartSchema>, false>>;
export type assertionAnyProbeCanFire = Expect<Equal<0 extends 1 & any ? true : false, true>>;

describe('ObjectChartProps.schema — anchored to ObjectChartSchema (objectui#7946)', () => {
  it('accepts the node the relays actually compose — the dataset shape, verbatim', () => {
    // `ObjectView`'s dataset branch, with the same value TYPES its locals have
    // (`dims`/`vals` are `string[]`). This is the half that must not break:
    // an anchor that refused a working producer would be a worse contract than
    // `any`.
    const dims = ['stage'];
    const vals = ['amount'];
    const node: ObjectChartProps['schema'] = {
      type: 'object-chart',
      dataset: 'deals',
      dimensions: dims,
      values: vals,
      chartType: 'bar',
      xAxisKey: dims[0],
      series: vals.map((v) => ({ dataKey: v, label: v })),
      className: 'h-[400px] w-full',
    };
    const first = node.series?.[0];
    expect(first && 'dataKey' in first ? first.dataKey : undefined).toBe('amount');
  });

  it('accepts the legacy inline-aggregate shape, both filter arms', () => {
    const arrayFilter: ObjectChartProps['schema'] = {
      type: 'object-chart',
      objectName: 'crm_opportunity',
      chartType: 'bar',
      aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' },
      xAxisKey: 'stage',
      series: [{ dataKey: 'amount', label: 'Amount' }],
      filter: [['stage', '=', 'won']],
    };
    // The ObjectQL `$filter` object the in-repo corpus authors, and the shape
    // the drill-down spread requires. Both arms are declared because both are
    // read; see the `filter` docblock on `ObjectChartSchema`.
    const objectFilter: ObjectChartProps['schema'] = {
      type: 'object-chart',
      objectName: 'deal',
      chartType: 'bar',
      aggregate: { function: 'count', groupBy: { field: 'close_date', dateGranularity: 'month', alias: 'month' } },
      filter: { close_date: { $gte: '{current_quarter_start}' } },
    };
    expect([Array.isArray(arrayFilter.filter), Array.isArray(objectFilter.filter)]).toEqual([true, false]);
  });

  it('REFUSES a wrong value type on each of the four keys the ruling declared', () => {
    // Every one of these compiled silently before this card, because the
    // consuming component was `(props: any)`.

    // @ts-expect-error — `xAxisKey` is `string`; a column index is not a column NAME.
    const badX: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', xAxisKey: 0 };
    // @ts-expect-error — `series` is an array of `{ dataKey }` entries, not a bare column name.
    const badSeries: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', series: 'amount' };
    // @ts-expect-error — a series entry names its column: `dataKey` (the renderer's internal arm) or, since objectui#10770, the spec's author-facing `name` arm. An entry with neither matches no arm.
    const badSeriesEntry: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', series: [{ label: 'amount' }] };
    // @ts-expect-error — `aggregate.function` is the declared vocabulary; `avg` is spelled `avg`.
    const badFn: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', aggregate: { function: 'average', groupBy: 'stage' } };
    // @ts-expect-error — `dateGranularity` lives INSIDE the structured `groupBy` node, not beside it (the spec's own guidance for this shape).
    const badGranularity: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', aggregate: { function: 'count', groupBy: 'stage', dateGranularity: 'month' } };
    // @ts-expect-error — `filter` is a FilterArray or an ObjectQL `$filter` object; a query STRING is neither.
    const badFilter: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', filter: 'stage=won' };

    expect([badX.xAxisKey, badSeries.series, badSeriesEntry.series, badFn.aggregate, badGranularity.aggregate, badFilter.filter]).toHaveLength(6);
  });

  /**
   * ⭐ What binding `aggregate` to `@objectstack/spec`'s `ChartAggregate`
   * bought, on the face an author writes against.
   *
   * The first cut of this card declared `aggregate` as a local near-copy with
   * all three members optional, reasoning from the RENDERER's accept set (every
   * read here is guarded). What that published was an authoring door wider than
   * the spec's — `{}` and `{ field: 'amount' }` were legal — on a shape whose
   * publish gate parses `ChartAggregateSchema`. Every literal below compiled
   * under that declaration and is refused now, and nothing in the workspace
   * needed the relaxation: every live producer forwards this key as `any`.
   *
   * ⚠️ The renderer still ACCEPTS these documents at runtime, by design — see
   * `ObjectChart.absentCategoryAxisRefusal-8168.test.tsx`, which asserts the
   * named refusal screen each of them draws. The two facts are not in tension:
   * one is what an author may write, the other is what a renderer owes a
   * document an untyped producer handed it.
   */
  it('REFUSES the aggregates the SPEC refuses — the by-reference narrowing', () => {
    // @ts-expect-error — `function` and `groupBy` are REQUIRED; an empty bag names neither a measure nor a category.
    const empty: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', aggregate: {} };
    // @ts-expect-error — a measure with no category axis: `groupBy` is required.
    const noCategory: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', aggregate: { field: 'amount', function: 'sum' } };
    // @ts-expect-error — `function` is required even when the category is declared.
    const noFunction: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', aggregate: { groupBy: 'stage' } };
    // @ts-expect-error — the structured `groupBy` node must NAME its field; `runAggregate` sends the node to the server verbatim, so a node without one can resolve no category column at all.
    const nodeWithoutField: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', aggregate: { function: 'count', groupBy: { dateGranularity: 'day' } } };
    // @ts-expect-error — the spec's object is STRICT: a mis-cased member is refused by name, where a local `z.object` copy would have dropped it silently.
    const misCased: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', aggregate: { function: 'count', groupby: 'stage' } };

    // …and the control: `field` stays OPTIONAL, because `count` counts rows
    // rather than a column. Without this the block above would be equally green
    // for a declaration that simply required all three.
    const counting: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', aggregate: { function: 'count', groupBy: 'stage' } };

    expect([empty, noCategory, noFunction, nodeWithoutField, misCased]).toHaveLength(5);
    expect(counting.aggregate?.field).toBeUndefined();
  });

  it('REFUSES the `colors` drift the two copies used to disagree about', () => {
    // The zod mirror has declared `colors` since objectui#3913; the TS
    // interface did not, so on THIS face a number palette was `any`.
    // @ts-expect-error — `colors` is a `string[]` palette or a value→color map.
    const node: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', colors: 42 };
    expect(node.colors).toBe(42);
  });

  it('NARROWS: `type` is required and is the registry key; `chartType` is the declared family list', () => {
    // @ts-expect-error — `type` is required; the minimal `{ objectName }` literal no longer compiles.
    const missing: ObjectChartProps['schema'] = { objectName: 'account', chartType: 'bar' };
    // @ts-expect-error — the only spelling is the key `ObjectChart.tsx` registers.
    const wrong: ObjectChartProps['schema'] = { type: 'chart', objectName: 'account', chartType: 'bar' };
    // @ts-expect-error — `gauge` is a spec chart family this block draws no chart of (one row's number), so it is not on THIS node's declared union (objectui#11513); widening it is a contract change, not a cast.
    const family: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'gauge' };
    expect([missing.objectName, wrong.objectName, family.chartType]).toEqual(['account', 'account', 'gauge']);
  });

  it('refuses a wrong-typed inherited base member for the DECLARED reason', () => {
    // @ts-expect-error — `visible` is `boolean | ExpressionWire` through `BaseSchema`.
    const node: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', visible: 42 };
    expect(node.visible).toBe(42);
  });

  it('WIDENS: every real `BaseSchema` member is writable, `visibleWhen` included', () => {
    const node: ObjectChartProps['schema'] = {
      type: 'object-chart',
      chartType: 'bar',
      objectName: 'account',
      visibleWhen: '${data.ready}',
      bind: 'rows',
    };
    expect(node.visibleWhen).toBe('${data.ready}');
  });

  it('an UNKNOWN key is refused — the ceiling this row stated is gone (objectui#8347)', () => {
    // This row was the counter-probe against reading the anchor as more than it
    // was: the inherited index signature let a misspelled KEY compile. objectui#8347
    // removed it, so the misspelling is refused like a wrong value type.
    // @ts-expect-error — `xAxisKy` is no member; the key is `xAxisKey`
    const node: ObjectChartProps['schema'] = { type: 'object-chart', chartType: 'bar', xAxisKy: 'stage' };
    expect(node.type).toBe('object-chart');
  });
});
