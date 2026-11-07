// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29594, ADR-0146 D3 as amended] `@objectstack/metadata-core`'s `appOf`
 * keeps its own copy of the kernel scopes — that package sits below this one
 * and cannot import {@link READ_ONLY_PACKAGE_SCOPES}. This pin holds the two
 * equal from the side that can see both: a package of every read-only scope
 * is its own App reading (the kernel is not customizable this version, ruling
 * record 6691217245), even when it declares an App; a package of any other
 * scope declaring one App reads that App.
 */
import { describe, expect, it } from 'vitest';
import { appOf, type InstalledManifestLookup } from '@objectstack/metadata-core';
import { READ_ONLY_PACKAGE_SCOPES } from './package-writability.js';

const APP = 'com.acme.app';

function installedWith(id: string, scope: string): InstalledManifestLookup {
  const manifests: Record<string, Record<string, unknown>> = {
    [APP]: { id: APP, type: 'app', namespace: 'acme' },
    [id]: { id, type: 'module', namespace: 'acme', scope, dependencies: { [APP]: '^1' } },
  };
  return (packageId) => manifests[packageId] as never;
}

describe('[#29594] appOf\'s kernel scopes are READ_ONLY_PACKAGE_SCOPES', () => {
  it('a package of every read-only scope is its own unit, even when it declares an App', () => {
    expect(READ_ONLY_PACKAGE_SCOPES.length).toBeGreaterThan(0);
    for (const scope of READ_ONLY_PACKAGE_SCOPES) {
      expect(appOf('com.acme.kernelish', installedWith('com.acme.kernelish', scope)), scope).toBe('com.acme.kernelish');
    }
  });

  it('a package of a writable scope declaring one App reads that App', () => {
    for (const scope of ['project', 'environment', 'platform']) {
      if (READ_ONLY_PACKAGE_SCOPES.includes(scope)) continue;
      expect(appOf('com.acme.member', installedWith('com.acme.member', scope)), scope).toBe(APP);
    }
  });
});
