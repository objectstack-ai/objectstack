/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectStackAdapter` reaches `/api/v1/discovery` from BOTH spellings of
 * `baseUrl` (objectstack-ai/objectstack#27774): the server origin the console
 * passes (`''` behind a same-origin proxy, or `http://host:3000`), and a base
 * that already ends in `/api/vN`, which the published `objectui` skill taught.
 *
 * Discovery used to join `/api/v1/discovery` onto the base as given, so
 * `baseUrl: '/api/v1'` asked for `/api/v1/api/v1/discovery`, `connect()`
 * failed, and every read and write that awaits it failed with it. The
 * adapter's own search, data, export and meta reads already dropped the
 * suffix; the client it wraps did not, so a fix that stripped discovery alone
 * would have left every client-routed read (`GET /api/v1/meta/:type`) doubled.
 * The base is therefore normalised ONCE, where the adapter and its client are
 * built, and these pins read the URL the injected fetch actually received.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** The adapter over a fake server that answers discovery and one metadata list. */
function adapterAt(baseUrl: string) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/discovery')) return json({ success: true, data: { routes: {} } });
    if (url.endsWith('/api/v1/meta/position')) {
      return json({ success: true, data: { type: 'position', items: [{ name: 'auditor' }] } });
    }
    return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND' } }), { status: 404 });
  });
  const adapter = new ObjectStackAdapter({ baseUrl, fetch: fetchImpl, autoReconnect: false });
  const urls = () => fetchImpl.mock.calls.map(([u]) => String(u));
  return { adapter, urls };
}

describe('ObjectStackAdapter baseUrl spellings reach discovery (objectstack-ai/objectstack#27774)', () => {
  beforeEach(() => {
    clearSharedDiscoveryCache();
  });

  it.each([
    ['the server origin', 'http://fake-27774.test', 'http://fake-27774.test/api/v1/discovery'],
    ['an empty base behind a same-origin proxy', '', '/api/v1/discovery'],
    ['a relative base ending in /api/v1', '/api/v1', '/api/v1/discovery'],
    ['an absolute base ending in /api/v1', 'http://fake-27774.test/api/v1', 'http://fake-27774.test/api/v1/discovery'],
    ['a base ending in /api/v1 and a trailing slash', 'http://fake-27774.test/api/v1/', 'http://fake-27774.test/api/v1/discovery'],
  ])('connects from %s', async (_label, baseUrl, discoveryUrl) => {
    const { adapter, urls } = adapterAt(baseUrl);

    await expect(adapter.connect()).resolves.toBeUndefined();

    expect(urls()).toEqual([discoveryUrl]);
    expect(adapter.isConnected()).toBe(true);
  });

  it('routes a client read through the same base once, not /api/v1/api/v1', async () => {
    // `listMetadataItems` goes through the wrapped `ObjectStackClient`, which
    // joins the conventional `/api/v1/meta` route onto ITS base — the half a
    // discovery-only strip would have left doubled.
    const { adapter, urls } = adapterAt('http://fake-27774.test/api/v1');

    await expect(adapter.listMetadataItems('position')).resolves.toEqual([{ name: 'auditor' }]);

    expect(urls()).toEqual([
      'http://fake-27774.test/api/v1/discovery',
      'http://fake-27774.test/api/v1/meta/position',
    ]);
  });

  it('keeps a path prefix that is not an API version', async () => {
    const { adapter, urls } = adapterAt('http://fake-27774.test/tenant-a');

    await adapter.connect();

    expect(urls()).toEqual(['http://fake-27774.test/tenant-a/api/v1/discovery']);
  });
});
