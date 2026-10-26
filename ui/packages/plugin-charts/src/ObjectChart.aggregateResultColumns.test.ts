/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The object-bound aggregate RESULT-COLUMN convention (framework#3701).
 *
 * An object-bound chart (`objectName` + an inline `aggregate`) returns rows
 * keyed by the RAW FIELD NAMES it was given — `groupBy` for the category,
 * `field` for the value — with NO `sum_`-style decoration. That is the opposite
 * of a dataset, whose rows are keyed by the declared measure `name`, and it is
 * what `xAxisKey` / `series[].dataKey` resolve against. The framework now pins
 * the rule (`chartAggregateResultKeys` in `@objectstack/spec/ui`) and lints
 * page sources against it, so the row builders here have to honour it exactly.
 *
 * Regression: `count` is the one function that may omit `field`, and every
 * builder read `params.field` directly — so a fieldless count keyed its value
 * `undefined` and the chart plotted nothing.
 */
import { describe, it, expect } from 'vitest';
import { aggregateRecords, aggregateValueKey } from './ObjectChart';

const rows = [
  { status: 'open', total: 100 },
  { status: 'open', total: 50 },
  { status: 'paid', total: 20 },
];

describe('aggregateValueKey', () => {
  it('is the raw field — never a decorated measure name', () => {
    expect(aggregateValueKey({ field: 'total', function: 'sum' })).toBe('total');
  });

  it('is the literal "count" when a count names no field', () => {
    expect(aggregateValueKey({ function: 'count' })).toBe('count');
  });

  it('prefers an explicit field even for count', () => {
    expect(aggregateValueKey({ field: 'total', function: 'count' })).toBe('total');
  });

  /**
   * objectui#8266 routed this function through `chartMeasureKey`
   * (`@object-ui/core`), which delegates to the contract's own
   * `chartAggregateValueKey`, so the SERIES binding the dashboard relays
   * compose cannot drift from the column this projects. The delegation is
   * behaviour-preserving, and these two arms are the only shapes where that
   * claim is not already covered above: the contract answers `undefined` for
   * them (`ChartAggregateSchema` refuses a fieldless non-count outright), so
   * everything after the delegation is this renderer's own floor.
   *
   * They are unreachable from validated metadata and reachable from
   * unvalidated. The floor exists so such a row keys a COLUMN rather than the
   * literal string "undefined", which is the regression the file below pins.
   */
  it('floors a fieldless non-count on the function name, as before the delegation', () => {
    expect(aggregateValueKey({ function: 'sum' })).toBe('sum');
    expect(aggregateValueKey({ function: 'avg' })).toBe('avg');
  });

  it('floors an empty aggregate on "count", as before the delegation', () => {
    expect(aggregateValueKey({})).toBe('count');
  });
});

describe('aggregateRecords — result columns', () => {
  it('keys rows by groupBy and the raw field', () => {
    expect(aggregateRecords(rows, { field: 'total', function: 'sum', groupBy: 'status' })).toEqual([
      { status: 'open', total: 150 },
      { status: 'paid', total: 20 },
    ]);
  });

  it('keys a fieldless count under "count", not undefined', () => {
    const out = aggregateRecords(rows, { function: 'count', groupBy: 'status' });
    expect(out).toEqual([
      { status: 'open', count: 2 },
      { status: 'paid', count: 1 },
    ]);
    // The pre-fix shape: a column literally named "undefined", which no axis
    // binding could ever name.
    expect(Object.keys(out[0])).not.toContain('undefined');
  });

  it('still counts rows when a field IS named', () => {
    expect(aggregateRecords(rows, { field: 'total', function: 'count', groupBy: 'status' })).toEqual([
      { status: 'open', total: 2 },
      { status: 'paid', total: 1 },
    ]);
  });
});
