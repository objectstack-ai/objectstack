// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28240 — `resolvePackageClosure`, the one dependency walk behind both the
 * server's publish gate (`resolveWritePackageScope`) and Studio's object
 * pickers. Pinned here on its own, over a plain package map, so the walk's
 * answer is fixed whichever host reads the registry.
 */
import { describe, expect, it } from 'vitest';
import { resolvePackageClosure } from './runtime-gate.js';
import * as runtimeEntry from './runtime.js';

type Pkg = { manifest?: unknown };

function registryOf(packages: Record<string, Record<string, string> | undefined>) {
  return (id: string): Pkg | undefined =>
    id in packages ? { manifest: { id, ...(packages[id] ? { dependencies: packages[id] } : {}) } } : undefined;
}

describe('resolvePackageClosure (#28240)', () => {
  it('answers undefined, narrowing nothing, for no package id, the overlay sentinel and an unknown package', () => {
    const get = registryOf({ 'com.acme.app': {} });
    expect(resolvePackageClosure(undefined, get)).toBeUndefined();
    expect(resolvePackageClosure(null, get)).toBeUndefined();
    expect(resolvePackageClosure('', get)).toBeUndefined();
    expect(resolvePackageClosure('sys_metadata', get)).toBeUndefined();
    expect(resolvePackageClosure('com.acme.missing', get)).toBeUndefined();
  });

  it('a package with no declared dependencies is its own closure', () => {
    expect(resolvePackageClosure('com.acme.app', registryOf({ 'com.acme.app': undefined }))).toEqual({
      packageId: 'com.acme.app',
      dependencies: [],
    });
  });

  it('walks declared dependencies transitively, once each, through a cycle', () => {
    const get = registryOf({
      'com.acme.custom': { 'com.acme.crm': '^1.0.0' },
      'com.acme.crm': { 'com.acme.core': '^1.0.0', 'com.acme.custom': '*' },
      'com.acme.core': { 'com.acme.crm': '*' },
      'com.acme.unrelated': {},
    });
    const scope = resolvePackageClosure('com.acme.custom', get);
    expect(scope?.packageId).toBe('com.acme.custom');
    expect([...(scope?.dependencies ?? [])].sort()).toEqual(['com.acme.core', 'com.acme.crm']);
  });

  it('keeps a declared dependency the registry cannot produce, and stops the walk there', () => {
    const get = registryOf({ 'com.acme.app': { 'com.vendor.gone': '^2.0.0' } });
    expect(resolvePackageClosure('com.acme.app', get)?.dependencies).toEqual(['com.vendor.gone']);
  });

  it('lets a throwing registry propagate: the host decides what an unreadable registry means', () => {
    expect(() =>
      resolvePackageClosure('com.acme.app', () => {
        throw new Error('registry down');
      }),
    ).toThrow('registry down');
  });

  it('is named on the narrow runtime entry the server reaches lint through', () => {
    expect(runtimeEntry.resolvePackageClosure).toBe(resolvePackageClosure);
  });
});
