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
 * #23505 — the refusal carries the ADR-0112 envelope, `RESOURCE_CONFLICT` /
 * 409, so the uninstall door answers a located client refusal instead of its
 * `500 INTERNAL_ERROR` fallback; its message opens with the way out and names
 * every extended object and every extending package.
 *
 * Pinned here:
 *  1. it refuses with that envelope, the way out first, every extended object
 *     and extender named, and mutates nothing;
 *  2. one extended object with one extender reads in the singular, and past
 *     five extended objects the rest are counted, never dropped silently;
 *  3. it answers normally for an uninstallable package, and mutates nothing;
 *  4. `unregisterObjectsByPackage` and `uninstallPackage` refuse with that
 *     same refusal, by calling it (not a copy of its predicate), and `force`
 *     still means "do not ask".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SchemaRegistry } from './registry';

/** Every contributor of every object the fixture registers, as plain data. */
function contributorsOf(registry: SchemaRegistry) {
  return ['free', 'alpha', 'beta'].map((name) => ({
    name,
    resolves: registry.getObject(name) !== undefined,
    contributors: registry.getObjectContributors(name).map((c) => `${c.packageId}:${c.ownership}`),
  }));
}

/** The error `fn` throws — it must throw. */
function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
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

  it('[#23505] refuses RESOURCE_CONFLICT / 409, the way out first, every extended object and extender named, and mutates nothing', () => {
    const before = contributorsOf(registry);

    const err = thrownBy(() => registry.assertPackageUninstallable('com.owner'));

    expect({ code: err.code, status: err.status, httpStatus: err.httpStatus }).toEqual({
      code: 'RESOURCE_CONFLICT',
      status: 409,
      httpStatus: 409,
    });
    expect(err.message.startsWith(
      'Uninstall the packages that extend objects of "com.owner" first (com.ext1, com.ext2, com.ext3), '
      + 'then uninstall "com.owner" again',
    ), err.message).toBe(true);
    // The named subjects, in walk order: the first refusable object first,
    // each with its extenders in registration order.
    expect(err.packageId).toBe('com.owner');
    expect(err.extendedObjects).toEqual([
      { objectName: 'alpha', extenders: ['com.ext1', 'com.ext2'] },
      { objectName: 'beta', extenders: ['com.ext3'] },
    ]);
    expect(err.extenders).toEqual(['com.ext1', 'com.ext2', 'com.ext3']);
    expect(err.message).toContain('"alpha"');
    expect(err.message).toContain('"beta"');
    expect(err.message).not.toContain('"free"');

    expect(contributorsOf(registry)).toEqual(before);
    expect(before.every((o) => o.resolves)).toBe(true);
  });

  it('[#23505] one extended object with one extender reads in the singular', () => {
    const r = new SchemaRegistry({ multiTenant: false });
    r.registerObject({ name: 'leave_request', fields: {} } as any, 'com.leave', 'base', 'own');
    r.registerObject({ name: 'leave_request', fields: {} } as any, 'com.addon', undefined, 'extend');

    const err = thrownBy(() => r.assertPackageUninstallable('com.leave'));

    expect(err.message.startsWith(
      'Uninstall the package that extends an object of "com.leave" first (com.addon), then uninstall "com.leave" again',
    ), err.message).toBe(true);
  });

  it('[#23505] past five extended objects the rest are counted, and every extender is still named', () => {
    const r = new SchemaRegistry({ multiTenant: false });
    const names = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];
    for (const name of names) r.registerObject({ name, fields: {} } as any, 'com.big', 'base', 'own');
    names.forEach((name, i) => r.registerObject({ name, fields: {} } as any, `com.x${i}`, undefined, 'extend'));

    const err = thrownBy(() => r.assertPackageUninstallable('com.big'));

    expect(err.extendedObjects).toHaveLength(7);
    for (const name of names.slice(0, 5)) expect(err.message).toContain(`"${name}"`);
    expect(err.message).not.toContain('"o6"');
    expect(err.message).toContain('2 more');
    for (let i = 0; i < 7; i += 1) expect(err.message).toContain(`com.x${i}`);
  });

  it('answers normally for a package nothing extends, and mutates nothing', () => {
    registry.registerObject({ name: 'free', fields: {} } as any, 'com.ext1', undefined, 'extend');
    const before = contributorsOf(registry);

    expect(() => registry.assertPackageUninstallable('com.ext1')).not.toThrow();
    expect(() => registry.assertPackageUninstallable('com.unknown')).not.toThrow();

    expect(contributorsOf(registry)).toEqual(before);
  });

  it('unregisterObjectsByPackage and uninstallPackage refuse with the same refusal BY calling it; force does not ask', () => {
    const asked = thrownBy(() => registry.assertPackageUninstallable('com.owner'));
    const ask = vi.spyOn(registry, 'assertPackageUninstallable');

    const viaUnregister = thrownBy(() => registry.unregisterObjectsByPackage('com.owner'));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('com.owner');
    expect(registry.getObject('free')).toBeDefined();

    registry.installPackage({ id: 'com.owner', name: 'Owner', version: '1.0.0' } as any);
    ask.mockClear();
    const viaUninstall = thrownBy(() => registry.uninstallPackage('com.owner'));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(registry.getPackage('com.owner')).toBeDefined();

    for (const err of [viaUnregister, viaUninstall]) {
      expect({ code: err.code, status: err.status, message: err.message }).toEqual({
        code: asked.code,
        status: asked.status,
        message: asked.message,
      });
    }

    ask.mockClear();
    registry.unregisterObjectsByPackage('com.owner', true);
    expect(ask).not.toHaveBeenCalled();
  });
});
