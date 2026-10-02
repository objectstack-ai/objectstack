// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21276 — `SchemaRegistry.assertPackageUninstallable` asks the uninstall's
 * ADR-0029 refusal without performing the uninstall.
 *
 * `deletePackage` (`@objectstack/metadata-protocol`) must decide this refusal
 * before it deletes the stored `sys_packages` row, and the only place the
 * registry used to decide it was inside `unregisterObjectsByPackage`, which
 * mutates when it does not refuse. The refusal pass (#7970) is now this one
 * method, and `unregisterObjectsByPackage` calls it: ONE predicate.
 *
 * Pinned here:
 *  1. it refuses with the uninstall's exact sentence, and mutates nothing;
 *  2. it answers normally for an uninstallable package, and mutates nothing;
 *  3. `unregisterObjectsByPackage` still refuses with that same sentence, by
 *     calling this method (not a copy of its predicate), and `force` still
 *     means "do not ask".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchemaRegistry } from './registry';

const REFUSAL =
  'Cannot uninstall package "com.owner": object "alpha" is extended by com.ext1, com.ext2. Uninstall extenders first.';

/** Every contributor of every object the fixture registers, as plain data. */
function contributorsOf(registry: SchemaRegistry) {
  return ['free', 'alpha', 'beta'].map((name) => ({
    name,
    resolves: registry.getObject(name) !== undefined,
    contributors: registry.getObjectContributors(name).map((c) => `${c.packageId}:${c.ownership}`),
  }));
}

describe('#21276 SchemaRegistry.assertPackageUninstallable', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    // `free` is walked FIRST and is not extended; `alpha` is the first
    // refusable object, with two extenders; `beta` is refusable too.
    registry.registerObject({ name: 'free', fields: {} } as any, 'com.owner', 'base', 'own');
    registry.registerObject({ name: 'alpha', fields: {} } as any, 'com.owner', 'base', 'own');
    registry.registerObject({ name: 'beta', fields: {} } as any, 'com.owner', 'base', 'own');
    registry.registerObject({ name: 'alpha', fields: {} } as any, 'com.ext1', undefined, 'extend');
    registry.registerObject({ name: 'alpha', fields: {} } as any, 'com.ext2', undefined, 'extend');
    registry.registerObject({ name: 'beta', fields: {} } as any, 'com.ext3', undefined, 'extend');
  });

  it('refuses with the uninstall\'s exact sentence, and mutates nothing', () => {
    const before = contributorsOf(registry);

    expect(() => registry.assertPackageUninstallable('com.owner')).toThrow(REFUSAL);

    expect(contributorsOf(registry)).toEqual(before);
    expect(before.every((o) => o.resolves)).toBe(true);
  });

  it('answers normally for a package nothing extends, and mutates nothing', () => {
    registry.registerObject({ name: 'free', fields: {} } as any, 'com.ext1', undefined, 'extend');
    const before = contributorsOf(registry);

    expect(() => registry.assertPackageUninstallable('com.ext1')).not.toThrow();
    expect(() => registry.assertPackageUninstallable('com.unknown')).not.toThrow();

    expect(contributorsOf(registry)).toEqual(before);
  });

  it('unregisterObjectsByPackage refuses with the same sentence BY calling it; force does not ask', () => {
    const ask = vi.spyOn(registry, 'assertPackageUninstallable');

    expect(() => registry.unregisterObjectsByPackage('com.owner')).toThrow(REFUSAL);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('com.owner');
    expect(registry.getObject('free')).toBeDefined();

    ask.mockClear();
    registry.unregisterObjectsByPackage('com.owner', true);
    expect(ask).not.toHaveBeenCalled();
  });
});
