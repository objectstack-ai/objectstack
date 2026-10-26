/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25333 — `MetadataClient.list(type, { include })` asks the server
 * for what a list serves only on request: `include=grants` on the position
 * list adds each position's `_holderCount` and `_grantedPermissionSets`. The
 * client passes the items through untouched, and a read without `include` is
 * the plain list's URL, so it shares nothing with the decorated read.
 *
 * The served rows are fixture rows in the shape objectstack#25333 serves.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

function clientAnswering(body: unknown) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { c: new MetadataClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl }), urls };
}

const ROWS = [
  {
    name: 'sales_manager',
    label: 'Sales Manager',
    _holderCount: 1,
    _grantedPermissionSets: [
      { name: 'crm_sales_user', via: 'definition' },
      { name: 'sales_manager', via: 'name' },
    ],
  },
];

describe('MetadataClient.list — `include` (objectstack#25333)', () => {
  it('asks with include=grants and hands back the served keys untouched', async () => {
    const { c, urls } = clientAnswering({ type: 'position', items: ROWS });
    expect(await c.list('position', { include: 'grants' })).toEqual(ROWS);
    expect(urls).toEqual(['http://localhost:3000/api/v1/meta/position?include=grants']);
  });

  it('keeps the package filter beside it', async () => {
    const { c, urls } = clientAnswering({ type: 'position', items: ROWS });
    await c.list('position', { packageId: 'com.acme.app', include: 'grants' });
    expect(urls).toEqual(['http://localhost:3000/api/v1/meta/position?package=com.acme.app&include=grants']);
  });

  it('control: without `include` the URL is the plain list, and the two reads are two requests', async () => {
    const { c, urls } = clientAnswering({ type: 'position', items: ROWS });
    await Promise.all([c.list('position'), c.list('position', { include: 'grants' })]);
    expect(urls.sort()).toEqual([
      'http://localhost:3000/api/v1/meta/position',
      'http://localhost:3000/api/v1/meta/position?include=grants',
    ]);
  });
});
