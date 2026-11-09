/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30850 — the list's page in the address, `uf__page`.
 *
 * The param belongs to the list-state family this module owns. It is read
 * strictly (a whole number from 1 up, else page 1), page 1 is no param, it
 * never reads as a quick-filter chip, it never makes an address count as a
 * link that carries list state, and it leaves with the rest of that state.
 * Its name collides with no console-reserved param (`urlParams.ts`).
 */
import { describe, it, expect } from 'vitest';
import {
  LIST_PAGE_PARAM,
  LIST_SORT_PARAM,
  applyListStateParams,
  parseListPageParam,
  parseUserFilterParams,
  userFilterParamsKey,
  withoutListStateParams,
} from './userFilterUrlState';
import { withoutListStateParams as withoutReaderListState } from './objectViewListUrlState';
import { RESERVED_URL_PARAMS } from '../urlParams';

const params = (query: string) => new URLSearchParams(query);

describe('the list page in the address (objectstack#30850)', () => {
  it('is spelled `uf__page`, and no console-reserved param has that name', () => {
    expect(LIST_PAGE_PARAM).toBe('uf__page');
    expect(RESERVED_URL_PARAMS).not.toContain(LIST_PAGE_PARAM);
  });

  it('reads a whole number from 1 up', () => {
    expect(parseListPageParam(params(`${LIST_PAGE_PARAM}=2`))).toBe(2);
    expect(parseListPageParam(params(`${LIST_PAGE_PARAM}=1`))).toBe(1);
    expect(parseListPageParam(params(`${LIST_PAGE_PARAM}=140`))).toBe(140);
  });

  it('reads page 1 for an absent param and for every value that is not a whole number from 1 up', () => {
    for (const raw of ['', '0', '-2', '2.5', '1e3', ' 2', '02', 'two', '9'.repeat(30)]) {
      expect(parseListPageParam(params(`${LIST_PAGE_PARAM}=${encodeURIComponent(raw)}`)), raw).toBe(1);
    }
    expect(parseListPageParam(params('uf__sort=[]'))).toBe(1);
  });

  it('writes a page past 1 and deletes the param for page 1 or null — replacing it, never appending', () => {
    const on2 = applyListStateParams(params('recordId=7'), { page: 2 });
    expect(on2.toString()).toBe(`recordId=7&${LIST_PAGE_PARAM}=2`);
    const on3 = applyListStateParams(on2, { page: 3 });
    expect(on3.getAll(LIST_PAGE_PARAM)).toEqual(['3']);
    expect(applyListStateParams(on3, { page: 1 }).has(LIST_PAGE_PARAM)).toBe(false);
    expect(applyListStateParams(on3, { page: null }).has(LIST_PAGE_PARAM)).toBe(false);
    // A patch without `page` leaves it alone.
    expect(applyListStateParams(on3, { search: 'acme' }).get(LIST_PAGE_PARAM)).toBe('3');
  });

  it('is not a quick-filter chip', () => {
    expect(parseUserFilterParams(params(`${LIST_PAGE_PARAM}=2`))).toBeUndefined();
    expect(parseUserFilterParams(params(`${LIST_PAGE_PARAM}=2&uf_status=open`))).toEqual({ status: ['open'] });
  });

  it('never makes an address read as list state: the page alone keys as nothing', () => {
    expect(userFilterParamsKey(params(`${LIST_PAGE_PARAM}=2`))).toBe('');
    const sort = `${LIST_SORT_PARAM}=${encodeURIComponent('[{"field":"name","order":"asc"}]')}`;
    expect(userFilterParamsKey(params(`${sort}&${LIST_PAGE_PARAM}=2`))).toBe(userFilterParamsKey(params(sort)));
  });

  it('leaves with the rest of the list state: the signed-out return link and "Reset to view"', () => {
    const address = params(`recordId=7&${LIST_PAGE_PARAM}=4&uf_status=open`);
    expect(withoutListStateParams(address).toString()).toBe('recordId=7');
    expect(withoutReaderListState(address).toString()).toBe('recordId=7');
  });
});
