// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35624, design step 4 — only a new VIEW was saved into the app;
 * a report, dashboard or page create kept its package-less save.
 *
 * objectstack#38149 supersedes that: a console create never names no package
 * (ADR-0070 D3, ADR-0084's amendment of 2026-11-26), so a create of any of
 * the three that a caller hands an app to is saved into the app's package,
 * exactly as a view is. Pinned for each: the package doors are read, and the
 * save names the app's writable package.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRuntimeMetadata, type RuntimeArtifactType } from './runtime-metadata-persistence';

const APP = 'com.example.crm';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('report, dashboard and page creates are saved into the app too (objectstack#38149)', () => {
  it.each<RuntimeArtifactType>(['report', 'dashboard', 'page'])('%s: saved as a draft naming the app package', async (type) => {
    const pageFetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/v1/packages'
        ? new Response(
            JSON.stringify({ success: true, data: { packages: [{ manifest: { id: APP, scope: 'project' }, writable: true }] } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )
        : new Response('{}', { status: 404 }),
    );
    vi.stubGlobal('fetch', pageFetch);
    const metadataClient = { save: vi.fn().mockResolvedValue(undefined) };
    const askPackage = vi.fn(async () => null);

    await createRuntimeMetadata(type, `crm_${type}`, { label: type }, {
      metadataClient,
      app: { packageId: APP, askPackage },
    });

    expect(metadataClient.save).toHaveBeenCalledTimes(1);
    expect(metadataClient.save).toHaveBeenCalledWith(type, `crm_${type}`, { label: type }, {
      mode: 'draft',
      packageId: APP,
      ifNoneMatch: '*',
    });
    expect(pageFetch.mock.calls.map(([u]) => String(u))).toEqual(['/api/v1/packages']);
    expect(askPackage).not.toHaveBeenCalled();
  });
});
