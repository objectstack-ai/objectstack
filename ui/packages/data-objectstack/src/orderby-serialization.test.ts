/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every shape `QueryParams['$orderby']` declares reaches the wire as a sort.
 *
 * `find()` has TWO routes to the server — a plain read goes through
 * `convertQueryParams` and the client SDK, a read with `$expand`/`$search`
 * through `rawFindWithPopulate` — and each used to carry its own copy of the
 * "which `$orderby` shape is this?" fold. Both copies handled three of the four
 * declared shapes; both missed the bare string, and missed it the same
 * spectacular way: the string fell into the `Record<field, direction>` branch,
 * where `Object.entries('name asc')` enumerates character indices and the
 * request went out as `sort=0,1,2,3,4,5,6,7`.
 *
 * That is not a cosmetic mistranslation. Since objectstack#4226 the server
 * refuses a sort it cannot read (`400 INVALID_SORT`) rather than dropping it,
 * so the whole list fails to load — and `"${field} ${order}"` is exactly what a
 * standalone `ObjectGrid` builds from its view metadata's `sort`.
 *
 * Both routes are asserted for every shape, because "the two routes agree" is
 * the property that was actually missing; one serializer now backs both.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter, clearSharedDiscoveryCache, serializeOrderBy } from './index';

function makeAdapter() {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/v1/discovery')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
      } as any;
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, data: { object: 'account', records: [], total: 0 } }),
    } as any;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as any,
  });
  return { adapter, calls };
}

/** The `sort=` this `$orderby` produced on the wire, or `undefined` if none was sent. */
async function sortOnWire($orderby: unknown, route: 'plain' | 'expand'): Promise<string | undefined> {
  const { adapter, calls } = makeAdapter();
  await adapter.find('account', {
    $orderby,
    ...(route === 'expand' ? { $expand: ['owner'] } : {}),
  } as any);
  const dataCall = calls.filter((u) => u.includes('/data/account')).pop();
  const raw = dataCall ? new URL(dataCall).searchParams.get('sort') : null;
  return raw === null ? undefined : raw;
}

/** Run one input down both `find()` routes and assert they agree. */
function bothRoutes(name: string, $orderby: unknown, expected: string | undefined) {
  for (const route of ['plain', 'expand'] as const) {
    it(`${name} (${route} route)`, async () => {
      expect(await sortOnWire($orderby, route)).toBe(expected);
    });
  }
}

describe('$orderby reaches the wire for every declared shape', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  // The regression: ObjectGrid's own `"${field} ${order}"`.
  bothRoutes('a bare "field order" string', 'name asc', 'name asc');
  bothRoutes('a bare string with a descending key', 'created_at desc', 'created_at desc');
  bothRoutes('a bare string already in `-field` shorthand', '-created_at', '-created_at');
  bothRoutes('a bare multi-key string', 'status asc,-created_at', 'status asc,-created_at');

  bothRoutes('a SortNode[]', [{ field: 'name', order: 'asc' }], 'name');
  bothRoutes(
    'a SortNode[] with a descending key',
    [{ field: 'status', order: 'asc' }, { field: 'created_at', order: 'desc' }],
    'status,-created_at',
  );
  bothRoutes('a string[]', ['name', '-age'], 'name,-age');
  bothRoutes('a Record<field, direction>', { name: 'asc', age: 'desc' }, 'name,-age');

  bothRoutes('no sort at all', undefined, undefined);
  bothRoutes('an empty array', [], undefined);
  bothRoutes('an empty object', {}, undefined);
  bothRoutes('a whitespace-only string', '   ', undefined);
});

describe('serializeOrderBy', () => {
  it('never enumerates a string as an object — the defect this replaced', () => {
    // `Object.entries('name asc')` → [['0','n'],['1','a'],…]. The old fold
    // reached that branch for every string input.
    expect(serializeOrderBy('name asc')).toBe('name asc');
    expect(serializeOrderBy('name asc')).not.toMatch(/^0,1,2/);
  });

  it('reads `order` case-insensitively', () => {
    expect(serializeOrderBy([{ field: 'name', order: 'DESC' as any }])).toBe('-name');
  });

  it('defaults a missing direction to ascending', () => {
    expect(serializeOrderBy([{ field: 'name' }])).toBe('name');
  });
});
