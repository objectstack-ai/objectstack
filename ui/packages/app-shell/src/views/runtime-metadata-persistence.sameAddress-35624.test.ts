// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35624, design step 2 — after a create into the app's
 * customization package, the view's edit, read, discard and publish reach that
 * same draft, and a view saved package-less before this card keeps its
 * package-less address.
 *
 * How, measured on examples/app-crm against a draft saved into
 * `com.example.crm.custom`: the `/meta` doors address a name's ONE holding
 * package when the request names none (ADR-0146 D8). A package-less
 * `PUT ?mode=draft` answered "Saved view ... (package=com.example.crm.custom,
 * state=draft)" and `_drafts` kept one row; the package-less draft read served
 * it with `_packageId: com.example.crm.custom`; the package-less discard
 * answered "Draft discarded (package=com.example.crm.custom)"; the
 * package-less publish promoted it, and the published read was the pair's. A
 * view saved naming no package was edited and published the same way at its
 * own, package-less address.
 *
 * So these four calls keep naming no package (the rule objectui#12335 set for
 * a caller that does not know the binding): naming the app's pair here would
 * fork a package-less view of the same app into a second draft in the pair.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetadataClient } from '@object-ui/data-objectstack';
import {
  persistRuntimeMetadata,
  readRuntimeDraft,
  discardRuntimeDraft,
  publishRuntimeMetadata,
} from './runtime-metadata-persistence';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let requests: Array<{ method: string; url: URL }> = [];

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET').toUpperCase();
      requests.push({ method, url });
      if (method === 'GET') {
        return json(200, {
          type: 'view',
          name: 'crm_account.verified_domestic',
          item: { name: 'crm_account.verified_domestic', label: 'Verified domestic', _packageId: 'com.example.crm.custom' },
        });
      }
      return json(200, { success: true, reset: true, state: 'draft' });
    }) as unknown as typeof fetch,
  });
}

beforeEach(() => {
  requests = [];
  // A package door asked here would be a regression: none of the four resolves a destination.
  vi.stubGlobal('fetch', vi.fn(async () => json(500, {})));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the edit, read, discard and publish of a view address its holder by name (objectstack#35624)', () => {
  it('each sends no ?package=, whatever app the console is in', async () => {
    const metadataClient = realClient();
    const ctx = {
      metadataClient,
      objectName: 'crm_account',
      app: { packageId: 'com.example.crm', onSavedOutsideApp: vi.fn() },
    };

    await persistRuntimeMetadata('view', 'crm_account.verified_domestic', { label: 'Edited' }, ctx);
    const draft = await readRuntimeDraft('view', 'crm_account.verified_domestic', ctx);
    await discardRuntimeDraft('view', 'crm_account.verified_domestic', ctx);
    await publishRuntimeMetadata('view', 'crm_account.verified_domestic', ctx);

    expect(requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      'PUT /api/v1/meta/view/crm_account.verified_domestic',
      'GET /api/v1/meta/view/crm_account.verified_domestic',
      'DELETE /api/v1/meta/view/crm_account.verified_domestic',
      'POST /api/v1/meta/view/crm_account.verified_domestic/publish',
    ]);
    expect(requests.map((r) => r.url.searchParams.has('package'))).toEqual([false, false, false, false]);
    expect(draft).toMatchObject({ label: 'Verified domestic' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(ctx.app.onSavedOutsideApp).not.toHaveBeenCalled();
  });
});
