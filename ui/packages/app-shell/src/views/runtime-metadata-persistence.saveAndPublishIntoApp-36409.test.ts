// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36409 — a view created Shared from the view dropdown is saved
 * and published in one act (`saveAndPublishRuntimeMetadata`), and its first
 * write lands in the app it was made in, exactly as `createRuntimeMetadata`
 * saves a new view (objectstack#35624, ruling C): the app's own package when
 * the server lists it writable, else the pair the ensure door names, else no
 * package at all. Only the SAVE names a package: the publish, and the discard
 * a refused publish runs, address the name's one holder (ADR-0146 D8). A type
 * other than `view` ignores the app.
 *
 * A REAL `MetadataClient` writes, so each pin reads the request the server
 * would receive; the two package doors answer through the page's `fetch`,
 * with the bodies `createIntoApp-35624` measured on examples/app-crm.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetadataClient } from '@object-ui/data-objectstack';
import { saveAndPublishRuntimeMetadata, viewEnvelope } from './runtime-metadata-persistence';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
let writes: Array<{ method: string; url: URL }> = [];

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

/** A real client; `refusePublish` answers the publish door `400 VALIDATION_ERROR`. */
function realClient(refusePublish = false): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      writes.push({ method: (init?.method ?? 'GET').toUpperCase(), url });
      if (refusePublish && url.pathname.endsWith('/publish')) {
        return json(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'refused', httpStatus: 400 } });
      }
      return json(200, { success: true, state: 'draft' });
    }) as unknown as typeof fetch,
  });
}

const env = viewEnvelope('crm_account', { type: 'grid', columns: ['name'] }, { name: 'key_accounts', label: 'Key accounts' });
const VIEW_PATH = '/api/v1/meta/view/crm_account.key_accounts';

/** Every write after the save: none of them may name a package. */
const packagesNamedAfterSave = () => writes.slice(1).map((w) => w.url.searchParams.get('package'));

beforeEach(() => {
  pageCalls = [];
  writes = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('saveAndPublishRuntimeMetadata saves a new shared view into the app it was made in (objectstack#36409)', () => {
  it('a writable app package: the save names it; the publish names none, and no pair is asked for', async () => {
    stubPageFetch([{ id: 'com.acme.helpdesk', writable: true }]);

    await expect(
      saveAndPublishRuntimeMetadata('view', env.name, env, {
        metadataClient: realClient(),
        objectName: 'crm_account',
        app: { packageId: 'com.acme.helpdesk' },
      }),
    ).resolves.toBe('published');

    expect(pageCalls).toEqual(['GET /api/v1/packages']);
    expect(writes).toHaveLength(2);
    expect(writes[0]!.url.pathname).toBe(VIEW_PATH);
    expect(writes[0]!.url.searchParams.get('mode')).toBe('draft');
    expect(writes[0]!.url.searchParams.get('package')).toBe('com.acme.helpdesk');
    expect(writes[1]!.url.pathname).toBe(`${VIEW_PATH}/publish`);
    expect(packagesNamedAfterSave()).toEqual([null]);
  });

  it('an installed (read-only) app package: the save names the pair the ensure door returns; the publish names none', async () => {
    stubPageFetch([{ id: 'com.example.crm', writable: false }]);

    await saveAndPublishRuntimeMetadata('view', env.name, env, {
      metadataClient: realClient(),
      objectName: 'crm_account',
      app: { packageId: 'com.example.crm' },
    });

    expect(pageCalls).toEqual([
      'GET /api/v1/packages',
      'POST /api/v1/packages/com.example.crm/ensure-customization',
    ]);
    expect(writes[0]!.url.searchParams.get('package')).toBe('com.example.crm.custom');
    expect(writes[1]!.url.pathname).toBe(`${VIEW_PATH}/publish`);
    expect(packagesNamedAfterSave()).toEqual([null]);
  });

  it('an app whose package cannot be resolved (not listed), or no app: the save names none', async () => {
    stubPageFetch([{ id: 'com.other.app', writable: true }]);

    await saveAndPublishRuntimeMetadata('view', env.name, env, { metadataClient: realClient(), app: { packageId: 'com.example.crm' } });
    await saveAndPublishRuntimeMetadata('view', env.name, env, { metadataClient: realClient(), app: { packageId: null } });
    await saveAndPublishRuntimeMetadata('view', env.name, env, { metadataClient: realClient() });

    expect(pageCalls).toEqual(['GET /api/v1/packages']);
    expect(writes.map((w) => w.url.searchParams.get('package'))).toEqual([null, null, null, null, null, null]);
  });

  it('a refused publish: the discard of the draft this call wrote names no package either', async () => {
    stubPageFetch([{ id: 'com.example.crm', writable: false }]);

    await expect(
      saveAndPublishRuntimeMetadata('view', env.name, env, {
        metadataClient: realClient(true),
        app: { packageId: 'com.example.crm' },
      }),
    ).rejects.toBeTruthy();

    expect(writes[0]!.url.searchParams.get('package')).toBe('com.example.crm.custom');
    expect(writes[1]!.url.pathname).toBe(`${VIEW_PATH}/publish`);
    expect(writes.length).toBeGreaterThanOrEqual(3); // the discard
    expect(packagesNamedAfterSave().every((p) => p === null)).toBe(true);
  });

  it('a type other than view ignores the app: no package door is asked and the save names none', async () => {
    stubPageFetch([{ id: 'com.acme.helpdesk', writable: true }]);

    await saveAndPublishRuntimeMetadata('dashboard', 'ops_board', { name: 'ops_board' }, {
      metadataClient: realClient(),
      app: { packageId: 'com.acme.helpdesk' },
    });

    expect(pageCalls).toEqual([]);
    expect(writes.map((w) => w.url.searchParams.get('package'))).toEqual([null, null]);
  });
});
