/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `$count: false` reaches the server, and the declined total stays absent.
 *
 * The list door runs a `count(*)` over the full predicate beside every paged
 * read unless the request says `count=false` (the declared opt-out,
 * `ODataQuerySchema.$count`). A surface that never draws a record count asks
 * for that opt-out with `$count: false`. The client SDK's `data.find()` has no
 * count option, so such a read takes the adapter's raw GET, which sends the
 * flag; and the answer carries no `total`, because the server sent none and
 * the page length is not one.
 *
 * Every positive row carries its control: an absent `$count` and a `true` one
 * send no `count` parameter and still read the server's `total`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import { clearSharedDiscoveryCache } from './sharedDiscovery';

const PAGE = [{ id: 'a1' }, { id: 'a2' }];

function makeAdapter(answer: Record<string, unknown>) {
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
      json: async () => ({ success: true, data: { object: 'account', records: PAGE, ...answer } }),
    } as any;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as any,
  });
  /** The query string of the one data read this adapter sent. */
  const dataRead = () => {
    const reads = calls.filter((u) => u.includes('/data/account'));
    expect(reads).toHaveLength(1);
    return new URL(reads[0]).searchParams;
  };
  return { adapter, dataRead };
}

describe('find() — `$count: false` declines the total end to end', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('a plain paged read sends `count=false` and answers with no `total`', async () => {
    // What the server answers to `count=false`: the page and `hasMore`, no total.
    const { adapter, dataRead } = makeAdapter({ hasMore: true });
    const result = await adapter.find('account', { $top: 2, $count: false });
    expect(dataRead().get('count')).toBe('false');
    expect(dataRead().get('top')).toBe('2');
    expect(result.data).toEqual(PAGE);
    // Absent, not the page length: `2` would read as "two records in all".
    expect('total' in result).toBe(false);
    expect(result.hasMore).toBe(true);
  });

  it('a read that also expands a lookup sends `count=false` too', async () => {
    const { adapter, dataRead } = makeAdapter({ hasMore: false });
    const result = await adapter.find('account', { $top: 2, $expand: ['owner'], $count: false });
    expect(dataRead().get('count')).toBe('false');
    expect(dataRead().get('populate')).toBe('owner');
    expect('total' in result).toBe(false);
  });

  it('CONTROL: an absent `$count` sends no `count` parameter and reads the server total', async () => {
    const { adapter, dataRead } = makeAdapter({ total: 40, hasMore: true });
    const result = await adapter.find('account', { $top: 2 });
    expect(dataRead().has('count')).toBe(false);
    expect(result.total).toBe(40);
  });

  it('CONTROL: `$count: true` sends no `count` parameter either — the total is the default', async () => {
    const { adapter, dataRead } = makeAdapter({ total: 40, hasMore: true });
    const result = await adapter.find('account', { $top: 2, $count: true });
    expect(dataRead().has('count')).toBe(false);
    expect(result.total).toBe(40);
  });
});
