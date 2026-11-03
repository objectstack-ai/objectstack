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
 *
 * #28408 (ADR-0146 D3) — it also refuses a base while the registry holds its
 * paired customization package, `<base>.custom` (the epic's two-minute check:
 * 「卸载 HotCRM 被拒并点名 `hotcrm.custom`」). Pinned in the second block:
 *  5. the pair present: the same `RESOURCE_CONFLICT` / 409, naming the pair,
 *     the way out (delete it, exporting it first) leading, and nothing mutated;
 *  6. the pair absent — or a `.custom` package that is not this base's pair —
 *     answers as before;
 *  7. both causes: ONE refusal carrying the extenders and the pair;
 *  8. the pair itself uninstalls as before, after which the base does (the
 *     prescription is a real way out), and `force` still does not ask.
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

    registry.installPackage({ id: 'com.owner', name: 'Owner', version: '1.0.0' } as any, 'code');
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

describe('#28408 (ADR-0146 D3) a base whose paired customization package is installed', () => {
  const BASE = 'hotcrm';
  const PAIR = 'hotcrm.custom';

  /** The base with one object nothing extends, and (unless told not to) its pair. */
  function withBase(opts: { pair?: string | false } = {}) {
    const r = new SchemaRegistry({ multiTenant: false });
    (r as any).logLevel = 'silent';
    r.installPackage({ id: BASE, name: 'HotCRM', version: '3.2.1', type: 'app', namespace: 'crm' } as any, 'marketplace');
    r.registerObject({ name: 'account', fields: {} } as any, BASE, 'crm', 'own');
    const pair = opts.pair ?? PAIR;
    if (pair !== false) {
      // Declares the base, as the paired package does (`^<major>`, ADR-0146 D3).
      r.installPackage(
        {
          id: pair, name: 'HotCRM customizations', version: '1.0.0', type: 'app', namespace: 'crm_custom',
          dependencies: { [BASE]: '^3' },
        } as any,
        'authored',
      );
    }
    return r;
  }

  /** What an uninstall would change: package records and object contributors, as plain data. */
  function stateOf(r: SchemaRegistry) {
    return {
      packages: r.getAllPackages().map((p) => p.manifest.id).sort(),
      account: r.getObjectContributors('account').map((c) => `${c.packageId}:${c.ownership}`),
    };
  }

  it('the pair present: RESOURCE_CONFLICT / 409 naming it, the way out first, and nothing mutated', () => {
    const r = withBase();
    const before = stateOf(r);
    expect(before.packages, 'precondition: the base and its pair are installed').toEqual([BASE, PAIR]);

    const err = thrownBy(() => r.assertPackageUninstallable(BASE));

    expect({ code: err.code, status: err.status, httpStatus: err.httpStatus }).toEqual({
      code: 'RESOURCE_CONFLICT',
      status: 409,
      httpStatus: 409,
    });
    expect({
      packageId: err.packageId,
      customizationPackageId: err.customizationPackageId,
      extendedObjects: err.extendedObjects,
      extenders: err.extenders,
    }).toEqual({ packageId: BASE, customizationPackageId: PAIR, extendedObjects: [], extenders: [] });
    expect(err.message.startsWith(`Delete the customization package "${PAIR}" first`), err.message).toBe(true);
    expect(err.message).toContain(`GET /api/v1/packages/${PAIR}/export`);
    expect(stateOf(r)).toEqual(before);

    // `uninstallPackage` asks it, so the uninstall itself is the same refusal
    // and removes nothing: the base keeps its record and its object.
    const viaUninstall = thrownBy(() => r.uninstallPackage(BASE));
    expect({ code: viaUninstall.code, status: viaUninstall.status, message: viaUninstall.message }).toEqual({
      code: err.code,
      status: err.status,
      message: err.message,
    });
    expect(stateOf(r)).toEqual(before);
  });

  it('the pair absent: answers as before — and a .custom package that is not this base\'s pair changes nothing', () => {
    expect(() => withBase({ pair: false }).assertPackageUninstallable(BASE)).not.toThrow();
    // `hotcrmx.custom` is another base's pair, and `hotcrm.extras` is a
    // dependent that is not the pair, whose uninstall protection ADR-0141 D3
    // still defers: both declare the base, and neither is the id `hotcrm`
    // derives.
    for (const other of ['hotcrmx.custom', 'hotcrm.extras']) {
      const r = withBase({ pair: other });
      expect(() => r.assertPackageUninstallable(BASE), other).not.toThrow();
      expect(r.uninstallPackage(BASE), other).toBe(true);
    }
  });

  it('both causes: ONE refusal carrying the extenders and the pair', () => {
    const r = withBase();
    r.registerObject({ name: 'account', fields: {} } as any, 'com.addon', undefined, 'extend');
    const before = stateOf(r);

    const err = thrownBy(() => r.assertPackageUninstallable(BASE));

    expect({ code: err.code, status: err.status }).toEqual({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(err.customizationPackageId).toBe(PAIR);
    expect(err.extendedObjects).toEqual([{ objectName: 'account', extenders: ['com.addon'] }]);
    expect(err.extenders).toEqual(['com.addon']);
    expect(err.message.startsWith(
      `Uninstall the package that extends an object of "${BASE}" (com.addon) and delete the customization package "${PAIR}" first`,
    ), err.message).toBe(true);
    expect(err.message).toContain('"account"');
    expect(stateOf(r)).toEqual(before);
  });

  it('the pair itself uninstalls as before, and then the base does; force still does not ask', () => {
    const r = withBase();
    expect(() => r.assertPackageUninstallable(PAIR)).not.toThrow();
    expect(r.uninstallPackage(PAIR)).toBe(true);
    expect(r.uninstallPackage(BASE)).toBe(true);
    expect(stateOf(r).packages).toEqual([]);

    const forced = withBase();
    const ask = vi.spyOn(forced, 'assertPackageUninstallable');
    forced.unregisterObjectsByPackage(BASE, true);
    expect(ask).not.toHaveBeenCalled();
    expect(forced.getObject('account')).toBeUndefined();
  });
});
