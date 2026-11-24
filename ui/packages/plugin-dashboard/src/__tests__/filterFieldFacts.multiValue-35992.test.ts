/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35992 — the operator answer the dashboard hands
 * `buildWidgetScopedFilter`, read off a field DEFINITION through
 * `jsonColumnFilterOperators` (the helper the list quick filter and the filter
 * builder read), and the source a widget's definition comes from.
 */

import { describe, it, expect } from 'vitest';
import { buildWidgetScopedFilter, resolveDashboardFilterDefs } from '@object-ui/core';
import { filterFieldSource, jsonColumnOperatorsFor, type FilterFieldFacts } from '../filterFieldFacts';

const facts: FilterFieldFacts = {
  status: 'ready',
  object: 'project',
  fields: {
    labels: { type: 'multiselect' },
    tags_select: { type: 'select', multiple: true },
    account_refs: { type: 'lookup', multiple: true },
    team_members: { type: 'user', multiple: true },
    status: { type: 'select' },
    owner: { type: 'lookup' },
  },
};

const defs = resolveDashboardFilterDefs({
  globalFilters: [
    { name: 'f', field: 'labels', type: 'select' },
  ],
});

/** Lower the one filter `f`, bound to `field`, with the facts above. */
const lower = (field: string, value: unknown, type: 'select' | 'lookup' = 'select') =>
  buildWidgetScopedFilter(
    { id: 'w', filterBindings: { f: field } },
    type === 'select' ? defs : resolveDashboardFilterDefs({ globalFilters: [{ name: 'f', field, type }] }),
    { f: value },
    undefined,
    jsonColumnOperatorsFor(facts),
  );

describe('jsonColumnOperatorsFor + buildWidgetScopedFilter (objectstack#35992)', () => {
  it('a multi-value select (multiselect, or select with multiple: true) takes $contains', () => {
    expect(lower('labels', 'frontend')).toEqual({ labels: { $contains: 'frontend' } });
    expect(lower('tags_select', ['a', 'b'])).toEqual({
      $or: [{ tags_select: { $contains: 'a' } }, { tags_select: { $contains: 'b' } }],
    });
  });

  it('a multi-value lookup / user field takes $contains', () => {
    expect(lower('account_refs', 'acc_1', 'lookup')).toEqual({ account_refs: { $contains: 'acc_1' } });
    expect(lower('team_members', ['usr_1', 'usr_2'], 'lookup')).toEqual({
      $or: [{ team_members: { $contains: 'usr_1' } }, { team_members: { $contains: 'usr_2' } }],
    });
  });

  it('a single-value field is unchanged: = for one value, $in for several', () => {
    expect(lower('status', 'open')).toEqual({ status: 'open' });
    expect(lower('owner', ['usr_1', 'usr_2'], 'lookup')).toEqual({ owner: { $in: ['usr_1', 'usr_2'] } });
  });

  it('a field the object does not declare keeps = / $in', () => {
    expect(lower('account.region', 'EMEA')).toEqual({ 'account.region': 'EMEA' });
  });

  it('facts that are pending or unavailable give no answer', () => {
    expect(jsonColumnOperatorsFor({ status: 'pending' })).toBeUndefined();
    expect(jsonColumnOperatorsFor({ status: 'unavailable', reason: 'x' })).toBeUndefined();
    expect(jsonColumnOperatorsFor(undefined)).toBeUndefined();
  });
});

describe('filterFieldSource (objectstack#35992)', () => {
  it('a dataset-bound widget resolves through its dataset', () => {
    expect(filterFieldSource({ type: 'bar', dataset: 'project_metrics' })).toEqual({
      key: 'dataset:project_metrics',
      kind: 'dataset',
      name: 'project_metrics',
    });
  });

  it('a provider: object widget names its object, under data or options.data', () => {
    expect(filterFieldSource({ type: 'bar', data: { provider: 'object', object: 'project' } })).toEqual({
      key: 'object:project',
      kind: 'object',
      name: 'project',
    });
    expect(filterFieldSource({ type: 'table', options: { data: { provider: 'object', object: 'task' } } })).toEqual({
      key: 'object:task',
      kind: 'object',
      name: 'task',
    });
  });

  it('a widget with inline rows has no source', () => {
    expect(filterFieldSource({ type: 'bar', options: { data: [{ name: 'a', value: 1 }] } })).toBeUndefined();
  });
});
