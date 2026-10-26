/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8266 — the ONE answer to "which result column carries the measure?".
 *
 * The regression this exists for is the FIELDLESS COUNT arm: it is the only
 * shape where the contract's answer and a `aggregate?.field || yField` read
 * disagree, and it is the normal way to author "how many records per status".
 * Every other arm agrees under both readings, which is precisely why the
 * disagreement survived in the tree — see the two dashboard relays, pinned in
 * `plugin-dashboard/src/__tests__/DashboardChart.countSeriesKey-8266.test.tsx`.
 *
 * The fallback arms are the other half: a floor that fires too eagerly would
 * take the caller's `yField` back over an aggregate the contract CAN answer for,
 * re-creating the bug through the fix.
 */
import { describe, it, expect } from 'vitest';
import { chartMeasureKey } from './chart-measure-key';

describe('chartMeasureKey — the contract answers', () => {
  it('is the raw field for a field-bearing aggregate, never the caller floor', () => {
    expect(chartMeasureKey({ field: 'amount', function: 'sum' }, 'value')).toBe('amount');
  });

  it('is the literal "count" for a fieldless count — NOT the caller floor', () => {
    // THE REGRESSION. `aggregate?.field || yField` answered 'value' here, and
    // the rows carry 'count', so the chart plotted nothing and said nothing.
    expect(chartMeasureKey({ function: 'count', groupBy: 'status' }, 'value')).toBe('count');
  });

  it('still prefers an explicit field even for count', () => {
    expect(chartMeasureKey({ field: 'amount', function: 'count' }, 'value')).toBe('amount');
  });

  it('ignores a caller floor the author chose, when the aggregate answers', () => {
    // An authored `yField` names a column an object-bound aggregate does not
    // project. Honouring it would plot nothing, exactly as 'value' did.
    expect(chartMeasureKey({ function: 'count', groupBy: 'status' }, 'total')).toBe('count');
  });
});

describe('chartMeasureKey — the caller floor, only where the contract is silent', () => {
  it('falls back when there is no aggregate at all', () => {
    // A provider whose rows are raw records: the author's yField IS the key.
    expect(chartMeasureKey(undefined, 'value')).toBe('value');
    expect(chartMeasureKey(undefined, 'amount')).toBe('amount');
  });

  it('falls back for an aggregate shape ChartAggregateSchema rejects', () => {
    // "only 'count' may omit field" — a fieldless sum is not a declaration the
    // spec admits, so the contract has no column to name.
    expect(chartMeasureKey({ function: 'sum' }, 'value')).toBe('value');
    expect(chartMeasureKey({}, 'value')).toBe('value');
  });
});
