/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29174 — `withoutListStateParams`: the URL a list leaves behind
 * when its session ends, with every piece of list state taken out.
 *
 * Pinned here, without mounting anything: the whole `uf_` family goes (the four
 * toolbar keys this module writes, a quick-filter selection and the tab preset),
 * every other param stays in its order, and the input is not touched. The
 * Console's signed-out guard that composes the sign-in page's return link with
 * it is pinned by `ProtectedRoute.signOutListState-29174.test.tsx`, and what the
 * next user's list opens with at that link by `ObjectView.listUrlState-11860`.
 */

import { describe, it, expect } from 'vitest';
import {
  LIST_FILTER_PARAM,
  LIST_GROUP_PARAM,
  LIST_SEARCH_PARAM,
  LIST_SORT_PARAM,
  applyListStateParams,
  applyUserFilterParams,
  userFilterParamsKey,
  withoutListStateParams,
} from './userFilterUrlState';

/** A list URL as the list itself writes it: toolbar state, a chip, a tab, and a record open beside it. */
function listUrl(): URLSearchParams {
  let params = new URLSearchParams('recordId=r1&filter%5Bowner%5D=u7');
  params = applyListStateParams(params, {
    filters: {
      id: 'root',
      logic: 'and',
      conditions: [{ id: 'c1', field: 'amount', operator: 'between', value: [10, 20] }],
    },
    search: 'pipeline',
    sort: [{ field: 'due_date', order: 'desc' }],
    grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] },
  });
  params = applyUserFilterParams(params, { priority: ['urgent'], _tab: ['mine'] });
  return params;
}

describe('withoutListStateParams drops the list state and keeps the rest (objectstack#29174)', () => {
  it('the URL a list writes carries every kind of list state (the control)', () => {
    const params = listUrl();
    for (const key of [LIST_FILTER_PARAM, LIST_SEARCH_PARAM, LIST_SORT_PARAM, LIST_GROUP_PARAM, 'uf_priority', 'uf__tab']) {
      expect(params.has(key), key).toBe(true);
    }
  });

  it('takes out the whole `uf_` family: the toolbar keys, a quick filter and the tab preset', () => {
    const kept = withoutListStateParams(listUrl());
    expect(userFilterParamsKey(kept)).toBe('');
    expect([...kept.keys()].filter(key => key.startsWith('uf_'))).toEqual([]);
  });

  it('keeps every other param, in its order and with its value', () => {
    const kept = withoutListStateParams(listUrl());
    expect([...kept.entries()]).toEqual([
      ['recordId', 'r1'],
      ['filter[owner]', 'u7'],
    ]);
  });

  it('an empty-valued `uf_` param goes too: it is list state whatever it holds', () => {
    const kept = withoutListStateParams(new URLSearchParams('uf__search=&tab=details'));
    expect(kept.toString()).toBe('tab=details');
  });

  it('returns a copy and leaves the params it was given alone', () => {
    const params = listUrl();
    const before = params.toString();
    const kept = withoutListStateParams(params);
    expect(kept).not.toBe(params);
    expect(params.toString()).toBe(before);
  });

  it('params with no list state come back equal', () => {
    const params = new URLSearchParams('recordId=r1&tab=details');
    expect(withoutListStateParams(params).toString()).toBe(params.toString());
  });
});
