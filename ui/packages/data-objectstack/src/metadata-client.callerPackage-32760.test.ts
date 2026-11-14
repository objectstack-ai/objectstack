/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#32760 — `get()` carries the by-name read's caller
 * arm (ADR-0150 D3): `callerPackage`, the READER's package, sent as
 * `?callerPackage=`, distinct from `packageId`, the holder (`?package=`, D5).
 *
 * ## What is pinned
 *
 *   - given a caller package -> `?callerPackage=VALUE`, encoded, beside the
 *     draft-preview overlay the client adds on its own;
 *   - none, or an empty one -> the parameter is ABSENT, never sent empty (the
 *     door refuses a blank caller, and an item authored in the environment
 *     reads the name bare);
 *   - it is never spelled as `?package=`: that is the exact qualifier, which
 *     refuses a dataset only a dependency of the reader holds.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

const BASE = 'http://localhost:3000/api/v1/meta';

function record(previewDrafts = false) {
  const seen: string[] = [];
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    previewDrafts,
    fetch: vi.fn(async (url: string) => {
      seen.push(String(url));
      const body = { type: 'dataset', name: 'task_metrics', item: { name: 'task_metrics', object: 'task' }, success: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
  });
  return { seen, client };
}

describe('MetadataClient.get — the caller arm, `?callerPackage=` (objectstack#32760)', () => {
  it('sends the reader\'s package as ?callerPackage=, never as ?package=', async () => {
    const { seen, client } = record();
    const item = await client.get('dataset', 'task_metrics', { callerPackage: 'com.acme.app' });

    expect(seen).toEqual([`${BASE}/dataset/task_metrics?callerPackage=com.acme.app`]);
    expect(item).toEqual({ name: 'task_metrics', object: 'task' });
  });

  it('encodes the caller package and keeps the draft-preview overlay beside it', async () => {
    const { seen, client } = record(true);
    await client.get('dataset', 'task_metrics', { callerPackage: 'com.acme/app' });

    expect(seen).toEqual([`${BASE}/dataset/task_metrics?preview=draft&callerPackage=com.acme%2Fapp`]);
  });

  it('CONTROL: no caller package, or an empty one, reads the name bare', async () => {
    const { seen, client } = record();
    await client.get('dataset', 'task_metrics');
    await client.get('dataset', 'task_metrics', { callerPackage: '' });

    expect(seen).toEqual([`${BASE}/dataset/task_metrics`, `${BASE}/dataset/task_metrics`]);
  });
});
