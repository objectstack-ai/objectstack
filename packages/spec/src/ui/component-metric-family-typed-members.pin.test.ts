// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21464, stages 4 and 5] The metric tile's four `z.unknown()` members are
 * typed: `object-metric` `aggregate` and `trend` (stage 4), and `drillDown` and
 * `compareTo` (stage 5, each typed to the tile's read per the seat's ruling B):
 * the drill-down's five list members are the chart drill-down's by reference,
 * with `filter` and `mode` refused by name, and the comparison is `{ kind }`,
 * with `kind` the dashboard comparison's by reference and `dimension` refused
 * by name. The drill-down's `report` stays in the enumeration pin's ledger,
 * held until the spec declares a drill report.
 *
 * ## The defect this file closes
 *
 * Each member is read with one shape (measured at the `.objectui-sha` pin
 * `89cad75d55` for `aggregate` / `trend`, and at the `.objectui-sha` pin
 * `ab1879721595` for `drillDown` / `compareTo`; the read points are in the
 * schemas' docblocks), and the row declared them `z.unknown()`. So
 * `aggregate: 'count'`, a function the engine does not have, `groupby` for
 * `groupBy`, a bare `trend: 'up'`, a `trend` with no `value`, a drill `filter`
 * and a comparison `dimension` all passed the component-props gate, and the
 * tile asked the server for a measure it could not answer, drew one ungrouped
 * number, painted a lone `%`, or ignored the drill filter and the dimension —
 * with no report.
 *
 * ## What is pinned, and why each half
 *
 * - §1 THE DECLARED SHAPES PARSE: every shape a measured writer authors parses
 *   byte-identical — neither member carries a default, so the parsed value IS
 *   the authored one. A refusal pin with no lit control passes just as well
 *   when the door refuses everything.
 * - §2 THE REFUSALS: an off-shape value of each member is refused with the
 *   code AND the path, so a refusal for the wrong reason reds.
 * - §3 ONE VOCABULARY: `aggregate`'s `function` is the query AST's
 *   `AggregationFunction` and its `groupBy` the chart's own union, by
 *   identity; the one rule restated here (a function other than `count` needs
 *   a `field`) answers exactly as the chart aggregate's does, over the chart's
 *   vocabulary, and `count_distinct` needs a field too. `trend` declares
 *   exactly the three members the badge draws. The drill-down's five list
 *   members are the chart drill-down's defs and `compareTo.kind` the dashboard
 *   comparison's, by identity, and each shape declares exactly the members the
 *   tile reads.
 * - §4 THE REGISTRATION: the ADR-0087 D3 entries step 18 carries.
 *
 * The enumeration pin (`component-props-unknown-members.pin.test.ts`) holds the
 * other half: these four left its ledger, so a member reverted to
 * `z.unknown()` reds there, and the held `drillDown.report` is listed there.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { ComponentPropsMap, ObjectMetricPropsSchema } from './component.zod';
import { ChartAggregateSchema, ChartAggregateFunctionSchema, ChartDrillDownSchema, ChartGroupBySchema } from './chart.zod';
import { DashboardWidgetSchema } from './dashboard.zod';
import { AggregationFunction } from '../data/query.zod';
import { I18nLabelSchema } from './i18n.zod';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry';

const BASE = { objectName: 'deal' } as const;
const parse = (props: Record<string, unknown>) => ComponentPropsMap['object-metric'].safeParse({ ...BASE, ...props });

/** The issue codes and paths a refusal carries, so a refusal for the WRONG reason reds. */
function issues(result: z.ZodSafeParseResult<unknown>): { code: string; path: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({ code: i.code, path: i.path.join('.') }));
}

// ───────────────────────────────────────────────────────────────────────────
// §1 the declared shapes parse
// ───────────────────────────────────────────────────────────────────────────

describe('§1 each member accepts every shape a measured writer authors', () => {
  const MONTHLY = { field: 'closed_at', dateGranularity: 'month' } as const;
  const BYTE_IDENTICAL: ReadonlyArray<readonly [label: string, props: Record<string, unknown>]> = [
    // The showcase's KPI tiles (`examples/app-showcase/src/ui/pages/index.ts`, `my-work.page.ts`, `command-center.page.ts`).
    ['a row count over a field', { aggregate: { field: 'id', function: 'count' } }],
    ['a sum', { aggregate: { field: 'budget', function: 'sum' } }],
    ['a fieldless count', { aggregate: { function: 'count' } }],
    ['an average', { aggregate: { field: 'amount', function: 'avg' } }],
    ['a minimum', { aggregate: { field: 'amount', function: 'min' } }],
    ['a maximum', { aggregate: { field: 'amount', function: 'max' } }],
    // objectui's unit-rule pin mounts one tile per engine function, `count_distinct` among them
    // (`plugin-dashboard/src/__tests__/ObjectMetricWidget.countNotCurrency-10356.test.tsx:102-124`).
    ['a distinct count', { aggregate: { field: 'amount', function: 'count_distinct' } }],
    ['a sum grouped by a field', { aggregate: { field: 'amount', function: 'sum', groupBy: 'stage' } }],
    ['a sum bucketed by month', { aggregate: { field: 'amount', function: 'sum', groupBy: MONTHLY } }],
    ['a fieldless count bucketed by month', { aggregate: { function: 'count', groupBy: MONTHLY } }],
    ['an aliased quarter bucket', {
      aggregate: { field: 'amount', function: 'avg', groupBy: { field: 'closed_at', dateGranularity: 'quarter', alias: 'q' } },
    }],
    ['a trend with a direction', { trend: { value: 12, direction: 'up' } }],
    ['a trend with no direction (no arrow)', { trend: { value: 12 } }],
    ['a falling trend with a caption', { trend: { value: 99, direction: 'down', label: 'Authored trend caption' } }],
    ['a neutral trend', { trend: { value: 0, direction: 'neutral' } }],
    ['a fractional negative trend', { trend: { value: -3.5, direction: 'down' } }],
    ['a trend with a locale-map caption', {
      trend: { value: 12, direction: 'up', label: { en: 'Revenue records', 'zh-CN': '收入记录' } },
    }],
    // objectui's drill-down member pins (`plugin-dashboard/src/__tests__/objectMetricDrillDownMembers-8071.test.tsx`,
    // `ObjectMetricWidget.drillRoutedToSharedDrawer-8970.test.tsx`) at the `.objectui-sha` pin `ab1879721595`.
    ['an empty drill-down block (on)', { drillDown: {} }],
    ['a drill-down switched off', { drillDown: { enabled: false } }],
    ['a drill-down with every list member', {
      drillDown: { enabled: true, title: 'Won deals', target: 'dialog', columns: ['name', 'amount'], maxRows: 5 },
    }],
    ['a drill-down that navigates', { drillDown: { enabled: true, target: 'navigate' } }],
    ['a drill into a dataset-bound report (held open)', {
      drillDown: {
        enabled: true,
        report: { name: 'pipeline', label: 'Pipeline', type: 'summary', dataset: 'deals_ds', rows: ['stage'], values: ['amount_sum'] },
      },
    }],
    // objectui's comparison pins (`ObjectMetricWidget.compareTo.test.tsx`, `objectMetricTrendMembers-8071.test.tsx`).
    ['a comparison with the year before', { compareTo: { kind: 'previousYear' } }],
    ['a comparison with the period before', { compareTo: { kind: 'previousPeriod' } }],
  ];

  for (const [label, props] of BYTE_IDENTICAL) {
    it(`parses ${label}, byte-identical`, () => {
      const r = parse(props);
      expect(issues(r)).toEqual([]);
      expect(r.success && r.data).toStrictEqual({ ...BASE, ...props });
    });
  }

  it('an absent member stays absent', () => {
    const r = parse({});
    expect(issues(r)).toEqual([]);
    expect(r.success && Object.keys(r.data)).toEqual(['objectName']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §2 the refusals
// ───────────────────────────────────────────────────────────────────────────

describe('§2 each member refuses an off-shape value', () => {
  const REFUSED: ReadonlyArray<readonly [label: string, props: Record<string, unknown>, code: string, path: string]> = [
    ['a bare-string aggregate', { aggregate: 'count' }, 'invalid_type', 'aggregate'],
    ['a function the engine does not have', { aggregate: { field: 'amount', function: 'median' } }, 'invalid_value', 'aggregate.function'],
    ['a retired function', { aggregate: { field: 'name', function: 'string_agg' } }, 'invalid_value', 'aggregate.function'],
    ['a distinct count with no field', { aggregate: { function: 'count_distinct' } }, 'custom', 'aggregate.field'],
    ['a sum with no field', { aggregate: { function: 'sum' } }, 'custom', 'aggregate.field'],
    ['`groupby` for `groupBy`', { aggregate: { field: 'amount', function: 'sum', groupby: 'stage' } }, 'unrecognized_keys', 'aggregate'],
    ['`dateGranularity` beside `groupBy`', { aggregate: { field: 'closed_at', function: 'count', dateGranularity: 'month' } }, 'unrecognized_keys', 'aggregate'],
    ['an array `groupBy`', { aggregate: { field: 'amount', function: 'sum', groupBy: ['stage'] } }, 'invalid_union', 'aggregate.groupBy'],
    ['a misspelled bucket member', {
      aggregate: { field: 'amount', function: 'sum', groupBy: { field: 'closed_at', dateGranularty: 'month' } },
    }, 'invalid_union', 'aggregate.groupBy'],
    ['a bare-string trend', { trend: 'up' }, 'invalid_type', 'trend'],
    ['a trend with no value', { trend: { direction: 'up' } }, 'invalid_type', 'trend.value'],
    ['a pre-formatted trend value', { trend: { value: '12%' } }, 'invalid_type', 'trend.value'],
    ['a direction outside the three', { trend: { value: 12, direction: 'sideways' } }, 'invalid_value', 'trend.direction'],
    ['a trend member the badge does not draw', { trend: { value: 12, percent: 99, caption: 'Off-list caption' } }, 'unrecognized_keys', 'trend'],
    ['a bare-boolean drill-down', { drillDown: true }, 'invalid_type', 'drillDown'],
    ['a drill `filter`', { drillDown: { enabled: true, filter: { stage: 'won' } } }, 'unrecognized_keys', 'drillDown'],
    ['a drill `mode`', { drillDown: { enabled: true, mode: 'record' } }, 'unrecognized_keys', 'drillDown'],
    ['a drill target outside the three', { drillDown: { target: 'popover' } }, 'invalid_value', 'drillDown.target'],
    ['a fractional drill page size', { drillDown: { maxRows: 2.5 } }, 'invalid_type', 'drillDown.maxRows'],
    ['a drill column object', { drillDown: { columns: [{ field: 'name' }] } }, 'invalid_type', 'drillDown.columns.0'],
    ['a bare-string comparison', { compareTo: 'previousYear' }, 'invalid_type', 'compareTo'],
    ['a comparison kind outside the two', { compareTo: { kind: 'previousQuarter' } }, 'invalid_value', 'compareTo.kind'],
    ['a comparison with no kind', { compareTo: {} }, 'invalid_value', 'compareTo.kind'],
    ['a comparison `dimension`', { compareTo: { kind: 'previousYear', dimension: 'close_date' } }, 'unrecognized_keys', 'compareTo'],
  ];

  for (const [label, props, code, path] of REFUSED) {
    it(`refuses ${label} — ${code} at ${path}`, () => {
      const r = parse(props);
      expect(r.success).toBe(false);
      expect(issues(r)).toEqual([{ code, path }]);
    });
  }

  it('says a drill `filter` is the metric\'s own, one level up', () => {
    const r = parse({ drillDown: { enabled: true, filter: { stage: 'won' } } });
    const message = r.success ? '' : r.error.issues[0]!.message;
    expect(message).toMatch(/`filter` is not a member a metric drill-down reads/);
    expect(message).toMatch(/scope the metric with its own `filter`/);
  });

  it('says a metric has no row for a drill `mode`', () => {
    const r = parse({ drillDown: { enabled: true, mode: 'record' } });
    expect(r.success ? '' : r.error.issues[0]!.message).toMatch(/`mode` is not a member a metric drill-down reads/);
  });

  it('says the tile shifts its own filter\'s date macros, not a `dimension`', () => {
    const r = parse({ compareTo: { kind: 'previousYear', dimension: 'close_date' } });
    expect(r.success ? '' : r.error.issues[0]!.message).toMatch(/`dimension` is not read on a metric tile/);
  });

  it('says `dateGranularity` goes inside `groupBy`', () => {
    const r = parse({ aggregate: { field: 'closed_at', function: 'count', dateGranularity: 'month' } });
    expect(r.success ? '' : r.error.issues[0]!.message).toMatch(/goes INSIDE `groupBy`/);
  });

  it('LIT CONTROL — an unknown top-level key is still refused at the row itself', () => {
    expect(issues(parse({ trend: { value: 1 }, notAMetricKey: 1 }))).toEqual([{ code: 'unrecognized_keys', path: '' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §3 one vocabulary, not a copy of it
// ───────────────────────────────────────────────────────────────────────────

describe('§3 `aggregate` holds the engine\'s functions and the chart\'s `groupBy`, and `trend` the badge\'s three', () => {
  const aggregate = () => ObjectMetricPropsSchema.shape.aggregate.unwrap();
  const trend = () => ObjectMetricPropsSchema.shape.trend.unwrap();

  it('`function` is the query AST\'s own aggregation vocabulary — the same def, a superset of the chart\'s', () => {
    expect(aggregate().shape.function._zod.def).toBe(AggregationFunction._zod.def);
    expect(ChartAggregateFunctionSchema.options.filter((fn) => !AggregationFunction.options.includes(fn))).toEqual([]);
  });

  it('`groupBy` is the chart\'s own union — the same def — and the one member made optional', () => {
    expect(aggregate().shape.groupBy.unwrap()._zod.def).toBe(ChartGroupBySchema._zod.def);
    expect(ChartAggregateSchema.safeParse({ field: 'id', function: 'count' }).success).toBe(false);
    expect(aggregate().safeParse({ field: 'id', function: 'count' }).success).toBe(true);
  });

  it('declares exactly the three members the tile reads', () => {
    expect(Object.keys(aggregate().shape).sort()).toEqual(['field', 'function', 'groupBy']);
  });

  it('answers the count-needs-no-field rule exactly as the chart aggregate does, over the chart\'s vocabulary', () => {
    const fieldIssue = (r: z.ZodSafeParseResult<unknown>) =>
      issues(r).filter((i) => i.path === 'field').map((i) => i.code);
    for (const fn of ChartAggregateFunctionSchema.options) {
      for (const field of [undefined, 'amount']) {
        const agg = field === undefined ? { function: fn } : { field, function: fn };
        expect(fieldIssue(aggregate().safeParse(agg)), `${fn} field=${field}`)
          .toEqual(fieldIssue(ChartAggregateSchema.safeParse({ ...agg, groupBy: 'stage' })));
      }
    }
  });

  it('a trend badge declares exactly the three members the badge draws', () => {
    expect(Object.keys(trend().shape).sort()).toEqual(['direction', 'label', 'value']);
    expect(trend().shape.label.unwrap()._zod.def).toBe(I18nLabelSchema._zod.def);
    expect([...trend().shape.direction.unwrap().options].sort()).toEqual(['down', 'neutral', 'up']);
  });
});

describe('§3 `drillDown` holds the chart drill-down\'s list members, and `compareTo` the dashboard comparison\'s `kind`', () => {
  const drillDown = () => ObjectMetricPropsSchema.shape.drillDown.unwrap();
  const compareTo = () => ObjectMetricPropsSchema.shape.compareTo.unwrap();

  it('each drill list member is the chart drill-down\'s own — the same def', () => {
    for (const member of ['enabled', 'title', 'target', 'columns', 'maxRows'] as const) {
      expect(drillDown().shape[member]._zod.def, member).toBe(ChartDrillDownSchema.shape[member]._zod.def);
    }
  });

  it('declares exactly the six members the tile reads — the chart\'s `filter` is not one', () => {
    expect(Object.keys(drillDown().shape).sort()).toEqual(['columns', 'enabled', 'maxRows', 'report', 'target', 'title']);
    expect(Object.keys(ChartDrillDownSchema.shape)).toContain('filter');
  });

  it('`compareTo.kind` is the dashboard comparison\'s own — the same def — and `kind` is the one member', () => {
    expect(compareTo().shape.kind._zod.def).toBe(DashboardWidgetSchema.shape.compareTo.unwrap().shape.kind._zod.def);
    expect(Object.keys(compareTo().shape)).toEqual(['kind']);
    expect(Object.keys(DashboardWidgetSchema.shape.compareTo.unwrap().shape)).toContain('dimension');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// §4 the registration
// ───────────────────────────────────────────────────────────────────────────

describe('§4 the ADR-0087 entries', () => {
  it('are registered as the D3 entries step 18 carries, beside the earlier stages\' entries', () => {
    const ids = MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id);
    expect(ids).toContain('ui-object-metric-drill-down-typed');
    expect(ids).toContain('ui-object-metric-compare-to-typed');
    expect(ids).toContain('ui-object-metric-aggregate-trend-typed');
    expect(ids).toContain('ui-object-form-members-typed');
    expect(ids).toContain('ui-object-grid-kanban-calendar-list-members-typed');
    expect(ids).toContain('ui-object-map-gantt-tree-navigation-typed');
  });
});
