/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An empty operator map BESIDE a key that lowers is refused on BOTH `find()`
 * routes — objectui#10788.
 *
 * ## What was wrong
 *
 * `{ status: 'a', created: {} }` reached the adapter's HTTP boundary as a
 * request byte-identical to the control `{ status: 'a' }`, measured on the
 * base with this same harness:
 *
 * ```
 * plain  GET /data/account?filter=["status","=","a"]
 * expand GET /data/account?populate=owner&filter=["status","=","a"]
 * ```
 *
 * The `created` constraint vanished in `convertFiltersToAST` (the key produced
 * no condition, and objectui#9164's refusal sat in a tail this input never
 * reaches), so the answer was WIDER than the author wrote, on both routes.
 * `@objectstack/spec` records `{ field: {} }` as REJECTED by objectstack#5240.
 *
 * ## What the assertions are
 *
 * Each route is driven with a mocked `fetch` and read at the wire. The refused
 * filter must reject with the `INVALID_FILTER` / 400 envelope naming `created`,
 * and send NO data request. The control must send its AST on both routes, so a
 * green refusal row cannot come from a harness that never reaches the wire.
 * `$expand` is the discriminator `find()` branches on, so these two calls are
 * the two routes, not two spellings of one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FilterOperatorError } from '@object-ui/core';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

function makeAdapter() {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: unknown) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/v1/discovery')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
      } as never;
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, data: { object: 'account', records: [], total: 0 } }),
    } as never;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as never,
  });
  return { adapter, calls };
}

type Route = 'plain' | 'expand';

async function drive($filter: unknown, route: Route) {
  const { adapter, calls } = makeAdapter();
  let thrown: unknown;
  try {
    await adapter.find('account', {
      $filter,
      ...(route === 'expand' ? { $expand: ['owner'] } : {}),
    } as never);
  } catch (error) {
    thrown = error;
  }
  const dataCalls = calls.filter((u) => u.includes('/data/account'));
  const last = dataCalls[dataCalls.length - 1];
  const filterParam = last ? new URL(last).searchParams.get('filter') : null;
  return { thrown, dataCalls, filterParam };
}

const ROUTES: Route[] = ['plain', 'expand'];

describe('objectui#10788 — an empty operator map beside a key is refused on both routes', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it.each(ROUTES)("{ status: 'a', created: {} } on the %s route rejects naming 'created' and sends nothing", async (route) => {
    const { thrown, dataCalls } = await drive({ status: 'a', created: {} }, route);
    expect(thrown).toBeInstanceOf(FilterOperatorError);
    const error = thrown as FilterOperatorError;
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.httpStatus).toBe(400);
    expect(error.field).toBe('created');
    expect(error.operator).toBeUndefined();
    expect(dataCalls).toHaveLength(0);
  });

  it.each(ROUTES)("CONTROL { status: 'a' } on the %s route sends its AST", async (route) => {
    const { thrown, dataCalls, filterParam } = await drive({ status: 'a' }, route);
    expect(thrown).toBeUndefined();
    expect(dataCalls).toHaveLength(1);
    expect(filterParam === null ? undefined : JSON.parse(filterParam)).toEqual(['status', '=', 'a']);
  });
});
