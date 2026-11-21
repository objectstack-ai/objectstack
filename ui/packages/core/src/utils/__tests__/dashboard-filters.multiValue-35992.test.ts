/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35992 — a `select` / `lookup` dashboard filter bound to a field
 * holding several values is lowered to `$contains`, one member per condition
 * and `$or` for any of several, never `=` / `$in` (refused by the server on
 * such a field).
 *
 * This file pins the pure lowering in `buildWidgetScopedFilter` with an
 * operator answer handed in, as the renderer hands it in. The answer's own
 * source, `jsonColumnFilterOperators` over a real field definition, and the
 * rendered dashboard are pinned in `@object-ui/plugin-dashboard`
 * (`filterFieldFacts.multiValue-35992.test.ts`,
 * `DashboardRenderer.multiValueFilter-35992.test.tsx`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  boundMemberFilterNames,
  buildWidgetScopedFilter,
  resolveDashboardFilterDefs,
  type DashboardFilterJsonColumnOperators,
} from '../dashboard-filters';

afterEach(() => vi.restoreAllMocks());

/** The answer for a field holding several values, as the shared helper gives it. */
const MULTI = ['contains', 'not_contains', 'is_empty', 'is_not_empty'] as const;
/** The answer for a structured JSON field: empty checks only. */
const STRUCTURED = ['is_empty', 'is_not_empty'] as const;

const operators: DashboardFilterJsonColumnOperators = (field) =>
  field === 'labels' || field === 'team_members' ? MULTI : field === 'address' ? STRUCTURED : undefined;

const defs = resolveDashboardFilterDefs({
  globalFilters: [
    { name: 'label', field: 'labels', type: 'select', options: [{ value: 'frontend', label: 'Frontend' }] },
    { name: 'member', field: 'team_members', type: 'lookup' },
    { name: 'status', field: 'status', type: 'select' },
    { name: 'search', field: 'name', type: 'text' },
  ],
});

const widget = { id: 'w1' };

describe('buildWidgetScopedFilter: member filter on a field holding several values (objectstack#35992)', () => {
  it('lowers one selected member to a single $contains', () => {
    expect(buildWidgetScopedFilter(widget, defs, { label: 'frontend' }, undefined, operators)).toEqual({
      labels: { $contains: 'frontend' },
    });
  });

  it('lowers several members (any of them) to $or over one $contains each', () => {
    expect(buildWidgetScopedFilter(widget, defs, { label: ['frontend', 'qa'] }, undefined, operators)).toEqual({
      $or: [{ labels: { $contains: 'frontend' } }, { labels: { $contains: 'qa' } }],
    });
  });

  it('lowers a one-member list to a single $contains, not a one-arm $or', () => {
    expect(buildWidgetScopedFilter(widget, defs, { label: ['frontend'] }, undefined, operators)).toEqual({
      labels: { $contains: 'frontend' },
    });
  });

  it('lowers a lookup filter on a multi-value lookup / user field the same way', () => {
    expect(buildWidgetScopedFilter(widget, defs, { member: 'usr_1' }, undefined, operators)).toEqual({
      team_members: { $contains: 'usr_1' },
    });
    expect(buildWidgetScopedFilter(widget, defs, { member: ['usr_1', 'usr_2'] }, undefined, operators)).toEqual({
      $or: [{ team_members: { $contains: 'usr_1' } }, { team_members: { $contains: 'usr_2' } }],
    });
  });

  it('follows an explicit filterBindings target to the field it names', () => {
    const bound = { id: 'w2', filterBindings: { status: 'labels' } };
    expect(buildWidgetScopedFilter(bound, defs, { status: 'frontend' }, undefined, operators)).toEqual({
      labels: { $contains: 'frontend' },
    });
  });

  it('leaves a single-value field on = / $in', () => {
    expect(buildWidgetScopedFilter(widget, defs, { status: 'open' }, undefined, operators)).toEqual({ status: 'open' });
    expect(buildWidgetScopedFilter(widget, defs, { status: ['open', 'won'] }, undefined, operators)).toEqual({
      status: { $in: ['open', 'won'] },
    });
  });

  it('leaves a text filter on its $contains, whatever the field', () => {
    expect(buildWidgetScopedFilter(widget, defs, { search: 'acme' }, undefined, operators)).toEqual({
      name: { $contains: 'acme' },
    });
  });

  it('ANDs a multi-value clause with the other active filters', () => {
    expect(
      buildWidgetScopedFilter(widget, defs, { label: ['frontend', 'qa'], status: 'open' }, undefined, operators),
    ).toEqual({
      $and: [{ $or: [{ labels: { $contains: 'frontend' } }, { labels: { $contains: 'qa' } }] }, { status: 'open' }],
    });
  });

  it('keeps = / $in when no operator answer is given (field definitions not known)', () => {
    expect(buildWidgetScopedFilter(widget, defs, { label: 'frontend' })).toEqual({ labels: 'frontend' });
    expect(buildWidgetScopedFilter(widget, defs, { label: ['frontend', 'qa'] })).toEqual({
      labels: { $in: ['frontend', 'qa'] },
    });
  });

  it('skips, with a warning naming the filter, a member filter on a structured JSON field', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const structured = resolveDashboardFilterDefs({
      globalFilters: [{ name: 'where', field: 'address', type: 'select' }],
    });
    expect(buildWidgetScopedFilter(widget, structured, { where: 'x' }, undefined, operators)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"where"');
  });
});

describe('boundMemberFilterNames (objectstack#35992)', () => {
  it('names the active select / lookup filters that bind the widget', () => {
    expect(boundMemberFilterNames(widget, defs, { label: 'frontend', member: 'usr_1', search: 'acme' })).toEqual([
      'label',
      'member',
    ]);
  });

  it('leaves out empty values and widgets that opt out', () => {
    expect(boundMemberFilterNames(widget, defs, { label: '', member: [] })).toEqual([]);
    expect(boundMemberFilterNames({ id: 'w3', filterBindings: { label: false } }, defs, { label: 'frontend' })).toEqual(
      [],
    );
  });
});
