/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12300 — the adapter's save-advisory wrapper forwards EVERY argument
 * of `meta.saveItem`, the SDK's write-options bag included.
 *
 * `@objectstack/client` declares `meta.saveItem(type, name, item, options?)`,
 * and its `SaveMetaItemOptions` bag carries the write's scope onto the wire:
 * `packageId` as `?package=`, `force` as `?force=true`, `mode: 'draft'` as
 * `?mode=draft`, and `ifMatch` as the `If-Match` header. The wrapper
 * `installSaveAdvisoryInterceptor` puts around that method named three
 * parameters and called the original with three, so the fourth was dropped
 * before the SDK ever saw it. Every caller that reaches the SDK through
 * `ObjectStackAdapter.getClient()` (the console's Setup › Apps page among
 * them) got a bare `PUT /meta/:type/:name` whatever it passed, and the type
 * checker had no way to say so, because the declared signature still took
 * the bag.
 *
 * The consequence the card measured: a Disable on an app in a writable
 * package sent no `?package=`, the door wrote a package-less row the reader
 * never serves, and the app stayed active under a "disabled" toast.
 *
 * These pins drive a REAL SDK client through a fake `fetch`, as the sibling
 * `onSaveAdvisory.test.ts` does and for its reason: what is under test is what
 * reaches the wire, so stubbing `meta` would assume the thing being measured.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

const CLEAN_BODY = { success: true, version: 'v2', seq: 4, state: 'active' as const };

function makeAdapter() {
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(CLEAN_BODY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: fetchImpl as unknown as typeof fetch,
  });
  // Forced rather than discovered, as the sibling suites do: the save door
  // needs no discovery, and skipping it keeps the module-level discovery cache
  // out of these tests.
  ds.connected = true;
  ds.connectionState = 'connected';
  return { ds, fetchImpl };
}

/** The one metadata PUT the call issued: its URL and its request headers. */
function thePut(fetchImpl: ReturnType<typeof makeAdapter>['fetchImpl']) {
  const puts = fetchImpl.mock.calls.filter(([, init]) => init?.method === 'PUT');
  expect(puts).toHaveLength(1);
  const [input, init] = puts[0]!;
  return { url: new URL(String(input)), headers: new Headers(init?.headers) };
}

describe('ObjectStackAdapter getClient().meta.saveItem forwards the write options (objectui#12300)', () => {
  it('sends the package scope as `?package=` when the caller names one', async () => {
    const { ds, fetchImpl } = makeAdapter();

    await ds.getClient().meta.saveItem(
      'app',
      'lanebapp_app',
      { name: 'lanebapp_app', active: false },
      { packageId: 'com.qa.lanebapp' },
    );

    const { url } = thePut(fetchImpl);
    expect(url.pathname).toBe('/api/v1/meta/app/lanebapp_app');
    expect(url.searchParams.get('package')).toBe('com.qa.lanebapp');
  });

  it('carries every member of the bag, the header member included', async () => {
    const { ds, fetchImpl } = makeAdapter();

    await ds.getClient().meta.saveItem(
      'app',
      'crm_app',
      { name: 'crm_app' },
      { packageId: 'com.acme.crm', force: true, mode: 'draft', ifMatch: 'sha256:abc' },
    );

    const { url, headers } = thePut(fetchImpl);
    expect(url.searchParams.get('package')).toBe('com.acme.crm');
    expect(url.searchParams.get('force')).toBe('true');
    expect(url.searchParams.get('mode')).toBe('draft');
    expect(headers.get('If-Match')).toBe('sha256:abc');
  });

  it('leaves a three-argument save exactly as it was: no query string at all', async () => {
    const { ds, fetchImpl } = makeAdapter();

    await ds.getClient().meta.saveItem('app', 'ops_app', { name: 'ops_app' });

    const { url, headers } = thePut(fetchImpl);
    expect(url.pathname).toBe('/api/v1/meta/app/ops_app');
    expect(url.search).toBe('');
    expect(headers.get('If-Match')).toBeNull();
  });
});
