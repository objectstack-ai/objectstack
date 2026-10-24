/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `reset()` names the package whose row it removes — objectui#12335, the
 * consumer half of objectstack#23165 (PR objectstack#23290, `543b33dee`,
 * shipped in `@objectstack/rest` 18.0.0-next.1).
 *
 * Since that commit `DELETE /api/v1/meta/TYPE/NAME` reads `?package=`. A
 * delete that names no package addresses the one package that holds the item;
 * when two or more packages hold it the door refuses `409 RESOURCE_CONFLICT`,
 * deletes nothing, and names `?package=` as the remedy. `reset()`'s options
 * type already inherited `packageId` (`MetadataDeleteOptions extends
 * MetadataClientSaveOptions`) and dropped it, so a caller holding the binding
 * could not send the remedy.
 *
 * ## What is pinned, both directions in one run
 *
 *   - bound   -> `?package=<id>`, with `?state=draft` when discarding a draft,
 *     encoded byte for byte as `save()` and `publish()` encode it;
 *   - unbound -> the parameter is ABSENT, never sent empty;
 *   - the door's 409 is thrown as a `MetadataError` carrying its `status` and
 *     `code` (ADR-0112), so every caller's existing error path receives it.
 *
 * The bound cases are the ones a revert turns red; the absent cases are the
 * counter-probe for the other mistake, always sending the parameter.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient, type MetadataError } from './metadata-client';

function record(answer: () => Response = () => okReceipt()) {
  const seen: { url: string; method?: string; headers: Record<string, string> }[] = [];
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method, headers: { ...(init?.headers as Record<string, string>) } });
      return answer();
    }) as unknown as typeof fetch,
  });
  return { seen, client };
}

function okReceipt(): Response {
  return new Response(JSON.stringify({ success: true, reset: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** The query string of the one request the call made, parsed. */
function queryOf(url: string): URLSearchParams {
  const q = url.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
}

describe('MetadataClient.reset — the package binding on the delete door (objectui#12335)', () => {
  it('sends ?package=<id> when the caller has a binding', async () => {
    const { seen, client } = record();
    await client.reset('app', 'crm_app', { packageId: 'com.qa.lanebapp' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('DELETE');
    expect(seen[0]?.url).toBe('http://localhost:3000/api/v1/meta/app/crm_app?package=com.qa.lanebapp');
  });

  it('sends ?state=draft&package=<id> for a draft discard with a binding', async () => {
    const { seen, client } = record();
    await client.reset('view', 'crm_deal.pipeline', { state: 'draft', packageId: 'com.qa.lanebapp' });

    const q = queryOf(seen[0]!.url);
    expect(q.get('state')).toBe('draft');
    expect(q.get('package')).toBe('com.qa.lanebapp');
    expect([...q.keys()].sort()).toEqual(['package', 'state']);
  });

  it('keeps the If-Match pin beside the binding', async () => {
    const { seen, client } = record();
    await client.reset('app', 'crm_app', { packageId: 'com.qa.lanebapp', ifMatch: 'v7' });

    expect(seen[0]?.headers['If-Match']).toBe('v7');
    expect(queryOf(seen[0]!.url).get('package')).toBe('com.qa.lanebapp');
  });

  it('omits the parameter entirely when there is no binding: absent, not empty', async () => {
    const { seen, client } = record();
    await client.reset('app', 'crm_app');

    expect(seen[0]?.url).toBe('http://localhost:3000/api/v1/meta/app/crm_app');
    expect(queryOf(seen[0]!.url).has('package')).toBe(false);
  });

  it('omits it for options that carry no packageId, and for an empty id', async () => {
    for (const options of [{}, { packageId: '' }, { state: 'draft' as const }, { state: 'draft' as const, packageId: '' }]) {
      const { seen, client } = record();
      await client.reset('app', 'crm_app', options);
      expect(queryOf(seen[0]!.url).has('package')).toBe(false);
      expect(seen[0]?.url.includes('package=')).toBe(false);
    }
  });

  it('encodes the id byte for byte as the save and publish doors do', async () => {
    const id = 'com.acme/a b';
    const reset = record();
    await reset.client.reset('page', 'home', { packageId: id });
    const saved = record();
    await saved.client.save('page', 'home', {}, { mode: 'draft', packageId: id });
    const published = record();
    await published.client.publish('page', 'home', { packageId: id });

    const pkgOf = (url: string) => /[?&]package=([^&]*)/.exec(url)?.[1];
    expect(pkgOf(reset.seen[0]!.url)).toBe('com.acme%2Fa%20b');
    expect(pkgOf(reset.seen[0]!.url)).toBe(pkgOf(saved.seen[0]!.url));
    expect(pkgOf(reset.seen[0]!.url)).toBe(pkgOf(published.seen[0]!.url));
  });

  it('throws the door`s 409 RESOURCE_CONFLICT as a MetadataError with its status and code', async () => {
    // The REST door's 4xx body: the sentence as `error`, the ADR-0112 code beside it.
    const { client } = record(
      () =>
        new Response(
          JSON.stringify({
            error: "Name the package this delete is for, then send it again: on the REST door add ?package= with the package id.",
            code: 'RESOURCE_CONFLICT',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
    );

    const err = (await client.reset('app', 'crm_app').catch((e: unknown) => e)) as MetadataError;
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.code).toBe('RESOURCE_CONFLICT');
  });
});
