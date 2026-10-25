/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8269 — the ONE answer to "which result column carries the category?".
 *
 * The regression arm is the FIRST one: a `groupBy` with no `options.xField`
 * beside it, which is the whole authoring shape the card is about. The relays
 * answered `'name'` there and the rows carry the raw groupBy field, so
 * `hasNoCategoryKey` refused the widget by the name of a key nobody wrote.
 *
 * The fallback arms are the other half: a floor that fired too eagerly would
 * take the caller's `xField` back over a `groupBy` the contract CAN answer for,
 * or invent a category column for an UNGROUPED aggregate that returns exactly
 * one row and has none.
 */
import { describe, it, expect } from 'vitest';
import { chartCategoryKey } from './chart-category-key';

describe('chartCategoryKey — the contract answers', () => {
  it('is the raw groupBy field, never the caller floor', () => {
    // THE REGRESSION. `options.xField || 'name'` answered 'name' here, and the
    // rows carry 'status', so the chart refused, naming 'name'.
    expect(chartCategoryKey({ function: 'count', groupBy: 'status' }, 'name')).toBe('status');
  });

  it('ignores a caller floor the author chose, when the groupBy answers', () => {
    // An authored `xField` names a column of the RECORDS, and a grouped
    // aggregate does not return records. Honouring it refuses the chart for
    // exactly the same reason 'name' did.
    expect(chartCategoryKey({ function: 'count', groupBy: 'status' }, 'stage')).toBe('status');
  });

  it('answers for a field-bearing aggregate the same way', () => {
    expect(chartCategoryKey({ field: 'amount', function: 'sum', groupBy: 'stage' }, 'name')).toBe('stage');
  });

  it('reads a structured groupBy node by its FIELD', () => {
    expect(
      chartCategoryKey({ function: 'count', groupBy: { field: 'closed_at', dateGranularity: 'month' } }, 'name'),
    ).toBe('closed_at');
  });

  it('prefers a structured groupBy ALIAS, because the alias renames the projected column', () => {
    // The one place this seam and `plugin-charts`' `resolveChartCategoryField`
    // deliberately disagree: that resolver answers "which FIELD?" (and returns
    // `closed_at`, which is what a field-metadata probe needs), this one
    // answers "which COLUMN do the rows carry?" — and `ObjectChart`'s own fetch
    // path keys those rows `alias || field`.
    expect(
      chartCategoryKey({ function: 'count', groupBy: { field: 'closed_at', alias: 'month' } }, 'name'),
    ).toBe('month');
  });
});

describe('chartCategoryKey — the caller floor, only where the contract is silent', () => {
  it('falls back when there is no aggregate at all', () => {
    // A provider whose rows are raw records: the author's xField IS the key.
    expect(chartCategoryKey(undefined, 'name')).toBe('name');
    expect(chartCategoryKey(undefined, 'stage')).toBe('stage');
  });

  it('falls back for an UNGROUPED aggregate, which returns no category column', () => {
    // One row, one number. There is no category to name, so the caller's floor
    // is the only answer available — and refusing to invent one here is what
    // keeps a single-value aggregate from being bound to a column that would
    // never exist.
    expect(chartCategoryKey({ field: 'amount', function: 'sum' }, 'name')).toBe('name');
  });

  it('falls back for a groupBy shape ChartGroupBySchema rejects', () => {
    expect(chartCategoryKey({ function: 'count', groupBy: '' }, 'name')).toBe('name');
    expect(chartCategoryKey({ function: 'count', groupBy: {} }, 'name')).toBe('name');
    expect(chartCategoryKey({ function: 'count', groupBy: ['status'] }, 'name')).toBe('name');
    expect(chartCategoryKey({}, 'name')).toBe('name');
  });
});
