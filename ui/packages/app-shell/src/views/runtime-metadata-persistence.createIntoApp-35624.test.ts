// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35624, design step 1 — a view created in an app's console is
 * saved INTO the app (ruling C, 「C 存进应用定制包」).
 *
 * Measured on examples/app-crm before this card: Add new view sent
 * `PUT /meta/view/NAME?mode=draft` naming no package, so the draft preview bar
 * of the app (which counts the app's package and its pair only) said "no
 * unpublished changes" over a pending draft, every time. Now the create asks
 * the package doors which writable package the app has: its own when the
 * server lists it writable, else its customization package, which the ensure
 * door answers (and creates on first use).
 *
 * A REAL `MetadataClient` writes, so the pin reads the request the server
 * would receive; the two package doors answer through the page's `fetch` with
 * the bodies `examples/app-crm` served when measured.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetadataClient } from '@object-ui/data-objectstack';
import { createRuntimeMetadata, viewEnvelope } from './runtime-metadata-persistence';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** `GET /api/v1/packages` as examples/app-crm answers it, cut to the rows read here. */
function packageList(rows: Array<{ id: string; writable: boolean }>) {
  return {
    success: true,
    data: {
      packages: rows.map(({ id, writable }) => ({
        manifest: { id, name: id, version: '4.0.0', type: 'app', scope: 'project' },
        writable,
      })),
      total: rows.length,
      hasMore: false,
    },
  };
}

const ENSURED = {
  success: true,
  data: {
    basePackageId: 'com.example.crm',
    packageId: 'com.example.crm.custom',
    namespace: 'crm_custom',
    dependencyRange: '^4',
    created: true,
    writable: true,
  },
};

let pageCalls: string[] = [];
let writes: URL[] = [];

function stubPageFetch(rows: Array<{ id: string; writable: boolean }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      pageCalls.push(`${(init?.method ?? 'GET').toUpperCase()} ${url}`);
      if (url === '/api/v1/packages') return json(200, packageList(rows));
      if (url.endsWith('/ensure-customization')) return json(201, ENSURED);
      return json(404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: url, httpStatus: 404 } });
    }),
  );
}

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL) => {
      writes.push(new URL(String(input)));
      return json(200, { success: true, state: 'draft' });
    }) as unknown as typeof fetch,
  });
}

const env = viewEnvelope('crm_account', { type: 'grid', columns: ['name'] }, { name: 'verified_domestic', label: 'Verified domestic' });

beforeEach(() => {
  pageCalls = [];
  writes = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createRuntimeMetadata saves a new view into the app it was made in (objectstack#35624)', () => {
  it('a read-only base: the pair the ensure door names, sent as ?package=', async () => {
    stubPageFetch([{ id: 'com.example.crm', writable: false }]);
    const onSavedOutsideApp = vi.fn();

    await createRuntimeMetadata('view', env.name, env, {
      metadataClient: realClient(),
      objectName: 'crm_account',
      app: { packageId: 'com.example.crm', onSavedOutsideApp },
    });

    expect(pageCalls).toEqual([
      'GET /api/v1/packages',
      'POST /api/v1/packages/com.example.crm/ensure-customization',
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.pathname).toBe('/api/v1/meta/view/crm_account.verified_domestic');
    expect(writes[0]!.searchParams.get('mode')).toBe('draft');
    expect(writes[0]!.searchParams.get('package')).toBe('com.example.crm.custom');
    expect(onSavedOutsideApp).not.toHaveBeenCalled();
  });

  it('a writable app package: the app itself, and no pair is asked for', async () => {
    stubPageFetch([{ id: 'com.acme.helpdesk', writable: true }]);

    await createRuntimeMetadata('view', env.name, env, {
      metadataClient: realClient(),
      app: { packageId: 'com.acme.helpdesk' },
    });

    expect(pageCalls).toEqual(['GET /api/v1/packages']);
    expect(writes[0]!.searchParams.get('package')).toBe('com.acme.helpdesk');
  });

  it('outside any app: saved as before, naming no package, and no package door is asked', async () => {
    stubPageFetch([{ id: 'com.example.crm', writable: false }]);

    await createRuntimeMetadata('view', env.name, env, { metadataClient: realClient(), app: { packageId: null } });
    await createRuntimeMetadata('view', env.name, env, { metadataClient: realClient() });

    expect(pageCalls).toEqual([]);
    expect(writes.map((u) => u.searchParams.has('package'))).toEqual([false, false]);
  });
});
