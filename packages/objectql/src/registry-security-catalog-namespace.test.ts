// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One name, one holder — the security catalog's namespace rule at the engine's
 * package door and at the registry's item seam (maintainer ruling Q4 = A on
 * #15196; `security-catalog-namespace.ts` states the rule and its holders).
 *
 * The door under test is the real one: the `manifest` service ObjectQLPlugin
 * registers, which every package registration reaches — `AppPlugin.init` at
 * boot (an artifact boot included), a hot install (`install-local`), a
 * post-start `manifest.register` — through `ObjectQL.registerApp` →
 * `SchemaRegistry.installPackage`.
 *
 * Every refusal is asserted by its ADR-0112 envelope (`code` + `status`) and by
 * the two holders it names; the message's prose is not pinned.
 *
 * The controls are what keep the refusal as narrow as the ruling: a same-package
 * reload is one holder; a non-catalog type shared by two packages still
 * coexists (ADR-0048 §3.4); an environment registration over a package-held
 * name (the bare slot every `sys_metadata` hydration writes) is not judged;
 * `collisionPolicy: 'warn'` does not downgrade it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { SchemaRegistry, NAMESPACE_CONFLICT_CODE } from './registry.js';
import type { ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };
type Holder = { kind: string; packageId?: string };
type Refusal = Error & {
  code?: string;
  status?: number;
  incomingPackageId?: string;
  existingHolder?: Holder;
  conflicts?: Array<{ catalogType: string; name: string; incomingPackageId: string; existingHolder: Holder }>;
};

type CatalogType = 'position' | 'permission' | 'capability';
const TYPES: CatalogType[] = ['position', 'permission', 'capability'];
const COLLECTION: Record<CatalogType, string> = { position: 'positions', permission: 'permissions', capability: 'capabilities' };

/** A body each catalog type's schema accepts. */
const body = (type: CatalogType, name: string, label: string) =>
  type === 'permission' ? { name, label, objects: {} } : { name, label };

/** A flat package payload — the shape `AppPlugin.init` hands the manifest service. */
const pkg = (id: string, decl: Partial<Record<CatalogType, string[]>> = {}, extra: Record<string, unknown> = {}) => {
  const out: Record<string, unknown> = { id, name: id.split('.').pop(), version: '1.0.0', type: 'app', ...extra };
  for (const type of TYPES) {
    const names = decl[type];
    if (names) out[COLLECTION[type]] = names.map((n) => body(type, n, `${id} ${n}`));
  }
  return out;
};

const caught = async (fn: () => unknown): Promise<Refusal | undefined> => {
  try {
    await fn();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

const kernels: ObjectKernel[] = [];
const boot = async () => {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  kernels.push(kernel);
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const manifest = kernel.getService<ManifestService>('manifest');
  return { registry: ql.registry, register: (m: unknown) => caught(() => manifest.register(m)) };
};

afterEach(async () => {
  while (kernels.length) {
    const k = kernels.pop()!;
    if (k.getState() === 'running') await k.shutdown();
  }
});

/** The envelope, and the two holders, of one refusal. */
function expectRefusal(err: Refusal | undefined, incoming: string, holder: Holder) {
  expect(err, 'the registration was refused').toBeDefined();
  expect(err!.code).toBe(NAMESPACE_CONFLICT_CODE);
  expect(err!.status).toBe(422);
  expect(err!.incomingPackageId).toBe(incoming);
  expect(err!.existingHolder).toEqual(holder);
  expect(err!.message).toContain(incoming);
  if (holder.packageId) expect(err!.message).toContain(holder.packageId);
}

describe.each(TYPES)('%s — a second package declaring a name another package holds', (type) => {
  const name = `shared_${type}`;

  it('is refused at the package door, naming both packages, and leaves no record behind', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.first', { [type]: [name] }))).toBeUndefined();

    const err = await register(pkg('com.acme.second', { [type]: [name] }));
    expectRefusal(err, 'com.acme.second', { kind: 'package', packageId: 'com.acme.first' });
    expect(err!.conflicts).toEqual([
      { catalogType: type, name, incomingPackageId: 'com.acme.second', existingHolder: { kind: 'package', packageId: 'com.acme.first' } },
    ]);
    // Ahead of every mutation: no package record, so nothing to uninstall.
    expect(registry.getPackage('com.acme.second')).toBeUndefined();
    expect(registry.getPackage('com.acme.first')).toBeDefined();
  });

  it('same-package reload is one holder, not two', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.first', { [type]: [name] }))).toBeUndefined();
    expect(await register(pkg('com.acme.first', { [type]: [name] }))).toBeUndefined();
  });

  it('uninstalling the holder releases the name', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.first', { [type]: [name] }))).toBeUndefined();
    expect(registry.uninstallPackage('com.acme.first')).toBe(true);
    expect(await register(pkg('com.acme.second', { [type]: [name] }))).toBeUndefined();
  });

  it('a nested plugin declares under its parent package, and is held to the same rule', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.first', {}, { plugins: [{ name: 'inner', [COLLECTION[type]]: [body(type, name, 'inner')] }] }))).toBeUndefined();
    const err = await register(pkg('com.acme.second', { [type]: [name] }));
    expectRefusal(err, 'com.acme.second', { kind: 'package', packageId: 'com.acme.first' });
  });

  it('the item seam refuses a package-bound registration over another package\'s name', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.first', { [type]: [name] }))).toBeUndefined();
    const err = await caught(() => registry.registerItem(type, body(type, name, 'direct'), 'name', 'com.acme.direct'));
    expectRefusal(err, 'com.acme.direct', { kind: 'package', packageId: 'com.acme.first' });
  });
});

describe('the built-in holders', () => {
  it.each([
    ['position', 'everyone'],
    ['position', 'org_admin'],
    ['capability', 'manage_users'],
  ] as const)('%s "%s" is a built-in no package can declare', async (type, name) => {
    const { register } = await boot();
    const err = await register(pkg('com.acme.app', { [type]: [name] }));
    expectRefusal(err, 'com.acme.app', { kind: 'built-in' });
  });

  it('the platform registers its own built-in positions at the item seam, under its own package id', async () => {
    const { registry } = await boot();
    expect(await caught(() => registry.registerItem('position', body('position', 'everyone', 'Everyone'), 'name', 'com.objectstack.plugin-security'))).toBeUndefined();
  });

  // An environment item under a built-in name exists only where an environment
  // save went over the platform's name (outside the ruling), and boot hydration
  // registers it BEFORE the platform's `start()` declares the built-ins. The
  // declaration is the built-in holder's own registration, not a second holder:
  // it is admitted, and the stored definition keeps answering first.
  it('the platform\'s declaration of a built-in name is admitted over an environment item under that name, which keeps answering first', async () => {
    const { registry } = await boot();
    registry.registerItem('position', body('position', 'org_admin', 'stored at the door'), 'name');
    expect(await caught(() => registry.registerItem('position', body('position', 'org_admin', 'Organization Admin'), 'name', 'com.objectstack.plugin-security'))).toBeUndefined();
    expect(registry.getItem<{ label: string }>('position', 'org_admin')?.label).toBe('stored at the door');
  });

  it('…while a second PACKAGE registering a built-in name at the item seam is refused, in either order', async () => {
    const first = await boot();
    first.registry.registerItem('position', body('position', 'everyone', 'Everyone'), 'name', 'com.objectstack.plugin-security');
    const after = await caught(() => first.registry.registerItem('position', body('position', 'everyone', 'other'), 'name', 'com.acme.other'));
    expectRefusal(after, 'com.acme.other', { kind: 'package', packageId: 'com.objectstack.plugin-security' });

    const second = await boot();
    second.registry.registerItem('position', body('position', 'everyone', 'other'), 'name', 'com.acme.other');
    const before = await caught(() => second.registry.registerItem('position', body('position', 'everyone', 'Everyone'), 'name', 'com.objectstack.plugin-security'));
    expectRefusal(before, 'com.objectstack.plugin-security', { kind: 'package', packageId: 'com.acme.other' });
  });

  it('CONTROL — for a name that is NOT built in, an environment item still refuses a package-bound registration at the item seam', async () => {
    const { registry } = await boot();
    registry.registerItem('position', body('position', 'env_position', 'stored at the door'), 'name');
    const err = await caught(() => registry.registerItem('position', body('position', 'env_position', 'direct'), 'name', 'com.acme.direct'));
    expectRefusal(err, 'com.acme.direct', { kind: 'environment' });
  });

  // The platform's permission sets are declared by plugin-security on its own
  // manifest, so they are held as that package's; which side the refusal stops
  // depends on which registers first, and both sides are named either way.
  const platform = () => pkg('com.objectstack.plugin-security', { permission: ['admin_full_access'] });

  it('a permission set the platform declares is refused to an app registering after it', async () => {
    const { register } = await boot();
    expect(await register(platform())).toBeUndefined();
    const err = await register(pkg('com.acme.app', { permission: ['admin_full_access'] }));
    expectRefusal(err, 'com.acme.app', { kind: 'package', packageId: 'com.objectstack.plugin-security' });
  });

  it('…and an app that registered first stops the platform\'s registration, naming the app', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.app', { permission: ['admin_full_access'] }))).toBeUndefined();
    const err = await register(platform());
    expectRefusal(err, 'com.objectstack.plugin-security', { kind: 'package', packageId: 'com.acme.app' });
  });
});

describe('the environment catalog as a holder', () => {
  it('a package declaring a name an environment-authored item holds is refused', async () => {
    const { registry, register } = await boot();
    // The bare slot, with no package — what `sys_metadata` hydration registers.
    registry.registerItem('permission', body('permission', 'env_set', 'authored here'), 'name');
    const err = await register(pkg('com.acme.app', { permission: ['env_set'] }));
    expectRefusal(err, 'com.acme.app', { kind: 'environment' });
  });

  it('CONTROL — an environment registration over a package-held name is not judged (outside the ruling)', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.app', { permission: ['pkg_set'] }))).toBeUndefined();
    expect(await caught(() => registry.registerItem('permission', body('permission', 'pkg_set', 'env over package'), 'name'))).toBeUndefined();
  });

  it('a package\'s own stored override in the bare slot is that package\'s, not a second holder', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.app', { permission: ['pkg_set'] }))).toBeUndefined();
    registry.registerItem('permission', { ...body('permission', 'pkg_set', 'override'), _packageId: 'com.acme.app' }, 'name');
    expect(await register(pkg('com.acme.app', { permission: ['pkg_set'] }))).toBeUndefined();
    const err = await register(pkg('com.acme.other', { permission: ['pkg_set'] }));
    expectRefusal(err, 'com.acme.other', { kind: 'package', packageId: 'com.acme.app' });
  });
});

describe('the refusal reports, and only refuses, what the ruling covers', () => {
  it('every conflicting name is listed in one refusal, and a refused package claims none of its names', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.first', { position: ['p1'], permission: ['s1'], capability: ['c1'] }))).toBeUndefined();
    const err = await register(pkg('com.acme.second', { position: ['p1', 'free_position'], permission: ['s1'], capability: ['c1'] }));
    expect(err?.code).toBe(NAMESPACE_CONFLICT_CODE);
    expect(err!.conflicts!.map((c) => `${c.catalogType}/${c.name}`)).toEqual(['position/p1', 'permission/s1', 'capability/c1']);
    // The refused package's free name was never claimed.
    expect(await register(pkg('com.acme.third', { position: ['free_position'] }))).toBeUndefined();
  });

  it('CONTROL — a non-catalog type shared by two packages still coexists (ADR-0048 §3.4)', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.first', {}, { pages: [{ name: 'home', label: 'first home', type: 'app' }] }))).toBeUndefined();
    expect(await register(pkg('com.acme.second', {}, { pages: [{ name: 'home', label: 'second home', type: 'app' }] }))).toBeUndefined();
    expect(registry.getItem<{ label: string }>('page', 'home', 'com.acme.second')?.label).toBe('second home');
  });

  it('collisionPolicy "warn" does not downgrade it', async () => {
    const registry = new SchemaRegistry({ collisionPolicy: 'warn' });
    registry.logLevel = 'silent';
    registry.installPackage(pkg('com.acme.first', { position: ['p1'] }) as never);
    const err = await caught(() => registry.installPackage(pkg('com.acme.second', { position: ['p1'] }) as never));
    expectRefusal(err, 'com.acme.second', { kind: 'package', packageId: 'com.acme.first' });
  });

  it('a manifest-stage `permissions` grant block is not read as permission sets', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.first', { permission: ['services'] }))).toBeUndefined();
    expect(await register(pkg('com.acme.second', {}, { permissions: { services: ['data'] } }))).toBeUndefined();
  });
});
