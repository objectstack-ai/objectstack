/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37506 — `uploadFile` / `uploadFiles` send through the host's
 * injected `fetch`, never the global one.
 *
 * The host's injected fetch is its authenticated fetch (the console hands
 * `createAuthenticatedFetch()`), which sends the stored bearer beside the
 * cookie. The two uploads used to call the global `fetch`, which carries the
 * cookie alone, so under a bearer-only session (the cookie replaced, blocked as
 * third-party, or cleared) an upload went out anonymous while every other
 * request of the same adapter was signed in.
 *
 * The injected fetch here stands in for the host's: it adds the bearer and
 * hands the request to a fake network. The control is the global `fetch`,
 * stubbed to record and refuse: the pre-fix transport, which sends no bearer.
 *
 * The uploads still sit outside the connection-state tracking (README,
 * "Connection state"): a refused upload moves nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectStackAdapter, type ConnectionStateEvent } from './index';
import { clearSharedDiscoveryCache } from './sharedDiscovery';

const BASE = 'http://fake-37506.test';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** What reached the network: URL, method and the Authorization header. */
type Sent = { url: string; method: string; authorization: string | null };

function hostWithBearer() {
  const sent: Sent[] = [];
  let refuseUploads = false;
  const network = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    sent.push({
      url,
      method: init?.method ?? 'GET',
      authorization: new Headers(init?.headers).get('Authorization'),
    });
    if (url.includes('/api/v1/discovery')) {
      return json({ success: true, data: { name: 'fake', routes: {} } });
    }
    if (url.endsWith('/upload')) {
      if (refuseUploads) throw new TypeError('Failed to fetch');
      return json({ id: 'file_1', url: '/files/file_1' });
    }
    return json({ success: true, data: {} });
  };
  // The host's authenticated fetch: the stored bearer beside whatever the caller set.
  const authenticatedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', 'Bearer stored-token-37506');
    return network(input, { ...init, headers });
  });
  return {
    sent,
    authenticatedFetch,
    refuse: () => {
      refuseUploads = true;
    },
  };
}

describe('data-objectstack uploads send through the injected fetch (objectstack#37506)', () => {
  let globalFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearSharedDiscoveryCache();
    // The control: the global fetch carries no bearer. Nothing may reach it.
    globalFetch = vi.fn(async () => {
      throw new Error('the global fetch was called: it sends the cookie alone');
    });
    vi.stubGlobal('fetch', globalFetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploadFile goes out through the injected fetch, carrying its bearer', async () => {
    const host = hostWithBearer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    await expect(adapter.uploadFile('task', new Blob(['a']), { recordId: 'r1' })).resolves.toMatchObject({
      id: 'file_1',
    });

    const upload = host.sent.filter((s) => s.url.endsWith('/upload'));
    expect(upload).toEqual([
      { url: `${BASE}/api/data/task/upload`, method: 'POST', authorization: 'Bearer stored-token-37506' },
    ]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('uploadFiles goes out through the injected fetch, carrying its bearer', async () => {
    const host = hostWithBearer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    await adapter.uploadFiles('task', [new Blob(['a']), new Blob(['b'])]);

    const upload = host.sent.filter((s) => s.url.endsWith('/upload'));
    expect(upload).toEqual([
      { url: `${BASE}/api/data/task/upload`, method: 'POST', authorization: 'Bearer stored-token-37506' },
    ]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('a refused upload still leaves the connection state where it was', async () => {
    const host = hostWithBearer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });
    await adapter.connect();
    expect(adapter.getConnectionState()).toBe('connected');
    const events: ConnectionStateEvent[] = [];
    adapter.onConnectionStateChange((event) => events.push(event));

    host.refuse();
    await expect(adapter.uploadFile('task', new Blob(['a']))).rejects.toBeInstanceOf(TypeError);
    await expect(adapter.uploadFiles('task', [new Blob(['a'])])).rejects.toBeInstanceOf(TypeError);

    expect(adapter.getConnectionState()).toBe('connected');
    expect(events).toEqual([]);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
