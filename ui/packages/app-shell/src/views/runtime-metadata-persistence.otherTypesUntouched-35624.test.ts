// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35624, design step 4 — only a new VIEW is saved into the app.
 *
 * `RuntimeArtifactType` also names report, dashboard and page, and nothing
 * creates those through `createRuntimeMetadata` today; where one would be
 * saved is not what the ruling decided. So a create of any of the three keeps
 * its save exactly as before this card, even when a caller hands it an app:
 * no package door is asked, no package is named, and no notice runs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRuntimeMetadata, type RuntimeArtifactType } from './runtime-metadata-persistence';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('report, dashboard and page creates are untouched by the app destination (objectstack#35624)', () => {
  it.each<RuntimeArtifactType>(['report', 'dashboard', 'page'])('%s: saved { mode: "draft" } and nothing else', async (type) => {
    const pageFetch = vi.fn();
    vi.stubGlobal('fetch', pageFetch);
    const metadataClient = { save: vi.fn().mockResolvedValue(undefined) };
    const onSavedOutsideApp = vi.fn();

    await createRuntimeMetadata(type, `crm_${type}`, { label: type }, {
      metadataClient,
      app: { packageId: 'com.example.crm', onSavedOutsideApp },
    });

    expect(metadataClient.save).toHaveBeenCalledTimes(1);
    expect(metadataClient.save).toHaveBeenCalledWith(type, `crm_${type}`, { label: type }, { mode: 'draft', ifNoneMatch: '*' });
    expect(pageFetch).not.toHaveBeenCalled();
    expect(onSavedOutsideApp).not.toHaveBeenCalled();
  });
});
