/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `publish()` states the package it is promoting — objectui#5420, the consumer
 * half of objectstack#10354 (`@objectstack/rest` 17.2.0, whose CHANGELOG reads
 * "**Additive:** `POST /meta/:type/:name/publish` now accepts `?package=<id>`").
 *
 * ## What is actually pinned here
 *
 * REQUEST BYTES, both directions, in one run:
 *
 *   - bound   -> `?package=<id>`, the same wire spelling and the same
 *     `encodeURIComponent` treatment `save()` gives the value one door over;
 *   - unbound -> the parameter is **ABSENT**, not empty.
 *
 * The second is asserted as absence of the `package` key on a parsed query
 * string, NOT as `package === ''`. Those two are the same to the framework's
 * normaliser today (`all` and the empty value both mean "env-local overlay, no
 * package") and different on the wire, and the wire is what this client owns.
 *
 * ## The acceptance criterion this suite does and does not encode
 *
 * It encodes "the binding is STATED, so #9612's package-closure narrowing is
 * reachable from an HTTP-driven promotion". It deliberately encodes NO latency
 * claim: `narrowObjectsToPackageClosure` keeps any object carrying no
 * `_packageId` provenance unconditionally, so on a tenant-authored overlay
 * corpus stating the package narrows nothing at all. A test asserting a
 * speed-up would be measuring a target this change cannot hit.
 *
 * ## Which of these would still pass if the change were reverted
 *
 * Only the absent-direction cases — absence of `?package=` is exactly what the
 * pre-change door did, so no assertion about absence can distinguish the two
 * states of the world by itself. They are the counter-probe for the OTHER
 * failure mode, the one a lone "it now sends `?package=X`" test is trivially
 * satisfiable by: always sending it. The bound-direction cases are the ones
 * that fail on a revert, and they run in the same file as their counter-probe
 * so neither mistake can pass alone.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

function record() {
  const seen: { url: string; method?: string }[] = [];
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method });
      return new Response(JSON.stringify({ success: true, version: 3 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { seen, client };
}

/** The query string of the one request the call made, parsed. */
function queryOf(url: string): URLSearchParams {
  const q = url.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
}

describe('MetadataClient.publish — package binding on the promotion (#5420)', () => {
  it('states ?package=<id> when the caller has a binding', async () => {
    const { seen, client } = record();
    await client.publish('page', 'home', { packageId: 'com.example.showcase' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toBe(
      'http://localhost:3000/api/v1/meta/page/home/publish?package=com.example.showcase',
    );
    expect(queryOf(seen[0]!.url).get('package')).toBe('com.example.showcase');
  });

  it('omits the parameter entirely when there is no binding — absent, not empty', async () => {
    const { seen, client } = record();
    await client.publish('page', 'home');

    expect(seen).toHaveLength(1);
    // No query string at all: `.../publish`, never `.../publish?package=`.
    expect(seen[0]?.url).toBe('http://localhost:3000/api/v1/meta/page/home/publish');
    expect(queryOf(seen[0]!.url).has('package')).toBe(false);
  });

  it('omits it for an options object that carries no packageId, and for an empty id', async () => {
    // The call site spreads the key in conditionally, so `{}` is the shape the
    // unbound designer produces. An empty string is the accident this guards.
    for (const options of [{}, { packageId: '' }, { message: 'ship it' }] as const) {
      const { seen, client } = record();
      await client.publish('page', 'home', options);
      expect(queryOf(seen[0]!.url).has('package')).toBe(false);
      expect(seen[0]?.url.includes('package=')).toBe(false);
    }
  });

  it('percent-encodes the id the same way the save door does', async () => {
    const bound = record();
    await bound.client.publish('page', 'home', { packageId: 'com.acme/a b' });

    const saved = record();
    await saved.client.save('page', 'home', {}, { mode: 'draft', packageId: 'com.acme/a b' });

    // One value, one spelling: the encoded form on the publish door is
    // byte-identical to the encoded form the save door already emits.
    const publishPkg = /[?&]package=([^&]*)/.exec(bound.seen[0]!.url)?.[1];
    const savePkg = /[?&]package=([^&]*)/.exec(saved.seen[0]!.url)?.[1];
    expect(publishPkg).toBe('com.acme%2Fa%20b');
    expect(publishPkg).toBe(savePkg);
  });

  it('keeps the `message` body while stating the package', async () => {
    const seen: RequestInit[] = [];
    const client = new MetadataClient({
      baseUrl: 'http://localhost:3000',
      fetch: vi.fn(async (_url: string, init?: RequestInit) => {
        seen.push(init!);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch,
    });
    await client.publish('page', 'home', { message: 'ship it', packageId: 'com.example.showcase' });
    expect(JSON.parse(String(seen[0]?.body))).toEqual({ message: 'ship it' });
  });
});
