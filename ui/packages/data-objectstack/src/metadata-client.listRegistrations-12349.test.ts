/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12349 — `MetadataClient.listResponse` hands back what the flow
 * list serves BESIDE its items: the automation engine's `registrations`,
 * keyed by name (objectstack#23316, `GetMetaItemsResponseSchema`), each parsed
 * with the spec's `FlowRegistrationSchema`. `list` still returns the items
 * alone, and the two share one in-flight request.
 *
 * The refusal message is fixture text, ⛔ not an engine sentence.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

const MESSAGE = 'FIXTURE: what the engine threw, verbatim.';

function clientAnswering(body: unknown) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { c: new MetadataClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl }), urls };
}

const ITEMS = [{ name: 'a', status: 'active' }, { name: 'b' }, { name: 'c' }];

describe('MetadataClient.listResponse — the engine verdicts beside a flow list (objectui#12349)', () => {
  it('returns the items and every verdict state as served, the items untouched', async () => {
    const registrations = {
      a: { state: 'refused', reason: { message: MESSAGE, code: 'FIXTURE_CODE' } },
      b: { state: 'registered' },
      c: { state: 'unregistered' },
    };
    const { c, urls } = clientAnswering({ type: 'flow', items: ITEMS, registrations });
    const answer = await c.listResponse('flow', { packageId: 'com.acme.app' });
    expect(answer.items).toEqual(ITEMS);
    expect(answer.registrations).toEqual(registrations);
    expect(urls).toEqual(['http://localhost:3000/api/v1/meta/flow?package=com.acme.app']);
  });

  it('absence stays absence: no `registrations` key when the server sent none', async () => {
    const { c } = clientAnswering({ type: 'flow', items: ITEMS });
    const answer = await c.listResponse('flow');
    expect(answer).toEqual({ items: ITEMS });
    expect('registrations' in answer).toBe(false);
  });

  it('an entry that is not a verdict (a refusal without its reason, an unknown state) is left unjudged; the others stand', async () => {
    const { c } = clientAnswering({
      type: 'flow',
      items: ITEMS,
      registrations: { a: { state: 'refused' }, b: { state: 'running' }, c: { state: 'registered' } },
    });
    const answer = await c.listResponse('flow');
    expect(answer.registrations).toEqual({ c: { state: 'registered' } });
  });

  it('`list` still returns the items alone, and a `list` and a `listResponse` in flight together send one request', async () => {
    const { c, urls } = clientAnswering({ type: 'flow', items: ITEMS, registrations: { b: { state: 'registered' } } });
    const [items, answer] = await Promise.all([c.list('flow'), c.listResponse('flow')]);
    expect(items).toEqual(ITEMS);
    expect(answer.registrations).toEqual({ b: { state: 'registered' } });
    expect(urls).toHaveLength(1);
  });

  it('a bare-array answer (an older server) reads as items with no verdicts', async () => {
    const { c } = clientAnswering(ITEMS);
    expect(await c.listResponse('flow')).toEqual({ items: ITEMS });
  });
});
