// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One default record page per object per deployment — the registry's package
 * door and item seam (maintainer ruling A on #23015, record 6134056653;
 * `default-record-page.ts` states the rule, the holders and what is not a
 * second default).
 *
 * The door under test is the real one: the `manifest` service ObjectQLPlugin
 * registers, which every package registration reaches — `AppPlugin.init` at
 * boot (an artifact boot included), a hot install, a plugin's
 * `manifest.register` — through `ObjectQL.registerApp` →
 * `SchemaRegistry.installPackage`, then the generic collection loop's
 * `registerItem('page', …, packageId)`.
 *
 * Every refusal is asserted by its ADR-0112 envelope (`code` + `status`), by
 * the two pages it names (`incoming` / `existing`) and by the message's first
 * sentence naming both.
 *
 * The controls keep the refusal as narrow as the ruling: one default per
 * object; two objects with one default each; a non-default record page; an
 * `isDefault` page that is not a record page; the same package again; the
 * environment's overlay of the very page by name; an environment registration
 * (the bare slot every `sys_metadata` hydration writes), which is not judged.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { DEFAULT_RECORD_PAGE_CONFLICT_CODE, MISPLACED_DEFAULT_PAGE_CODE, SchemaRegistry } from './registry.js';
import { misplacedDefaultPageRefusal } from '@objectstack/spec/ui';
import type { ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };
type Holder = { kind: 'package'; packageId: string; page: string } | { kind: 'environment'; page: string };
type Refusal = Error & {
  code?: string;
  status?: number;
  object?: string;
  incoming?: Holder;
  existing?: Holder;
  conflicts?: Array<{ object: string; incoming: Holder; existing: Holder }>;
};

/** A record page; `object` and `isDefault` are what a case varies. */
const recordPage = (name: string, object: string, isDefault = true, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  type: 'record',
  object,
  isDefault,
  regions: [],
  ...extra,
});

/** A flat package payload — the shape `AppPlugin.init` hands the manifest service. */
const pkg = (id: string, pages: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  id,
  name: id.split('.').pop(),
  version: '1.0.0',
  type: 'app',
  pages,
  ...extra,
});

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

const pkgPage = (packageId: string, page: string): Holder => ({ kind: 'package', packageId, page });

/** The envelope, and the two pages, of one refusal. */
function expectRefusal(err: Refusal | undefined, object: string, incoming: Holder, existing: Holder) {
  expect(err, 'the registration was refused').toBeDefined();
  expect({ code: err!.code, status: err!.status }).toEqual({ code: DEFAULT_RECORD_PAGE_CONFLICT_CODE, status: 422 });
  expect(DEFAULT_RECORD_PAGE_CONFLICT_CODE).toBe('DEFAULT_RECORD_PAGE_CONFLICT');
  expect(err!.object).toBe(object);
  expect(err!.incoming).toEqual(incoming);
  expect(err!.existing).toEqual(existing);
  const name = (h: Holder) =>
    h.kind === 'package' ? `page "${h.page}" of package "${h.packageId}"` : `page "${h.page}", authored in this environment`;
  expect(err!.message.split('. ')[0]).toBe(
    `Default record page conflict: ${name(incoming)} cannot be the default record page of object "${object}": ${name(existing)} already is`,
  );
}

describe('a second package registering a default record page for an object another package holds', () => {
  it('is refused at the package door, naming both pages, and leaves no record behind', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();

    const err = await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.tenant', 'tenant_org_detail'), pkgPage('com.acme.auth', 'acme_org_detail'));
    expect(err!.conflicts).toHaveLength(1);
    // Ahead of every mutation: no package record, and no page registered.
    expect(registry.getPackage('com.acme.tenant')).toBeUndefined();
    expect(registry.getPackage('com.acme.auth')).toBeDefined();
    expect(registry.listItems<any>('page').map((p) => p.name)).toEqual(['acme_org_detail']);
  });

  it('names a remedy every holder can take: leave out a PAGE, never a whole package', async () => {
    // The remedy sentence is what an author (or an AI) acts on, so its text is
    // the contract here. It names the page to leave out, not the package: a
    // deployment cannot leave out a package such as the platform's auth
    // plugin, and can still leave out the one page it ships. It names no
    // option, no package and no tracker number, so it stays true whichever
    // holder is on the other side.
    const { register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();
    const err = await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: DEFAULT_RECORD_PAGE_CONFLICT_CODE, status: 422 });
    expect(err!.message.split('. ')[1]).toBe(
      'Keep one default per object: set `isDefault: false` on one of the two pages, or compose the deployment '
        + 'without the other package\'s page',
    );
    expect(err!.message).not.toMatch(/without the package/);
    expect(err!.message).not.toMatch(/#\d+|registerOrganizationRecordPage|plugin-auth/);
  });

  it('is refused in either order — whichever registers second is the second default', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]))).toBeUndefined();
    const err = await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.auth', 'acme_org_detail'), pkgPage('com.acme.tenant', 'tenant_org_detail'));
  });

  it('two packages\' pages under ONE name are two pages, and the second is refused', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('org_detail', 'acme_org')]))).toBeUndefined();
    const err = await register(pkg('com.acme.tenant', [recordPage('org_detail', 'acme_org')]));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.tenant', 'org_detail'), pkgPage('com.acme.auth', 'org_detail'));
  });

  it('a nested plugin declares under its parent package, and is held to the same rule', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.auth', [], { plugins: [{ name: 'inner', pages: [recordPage('acme_org_detail', 'acme_org')] }] }))).toBeUndefined();
    const err = await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.tenant', 'tenant_org_detail'), pkgPage('com.acme.auth', 'acme_org_detail'));
  });

  it('a package installed with no pages registered still holds what it declared (its claim)', async () => {
    const { registry, register } = await boot();
    // A bare install — `POST /api/v1/packages` stores the manifest alone.
    registry.installPackage(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]) as any, 'code');
    expect(registry.listItems('page')).toEqual([]);
    const err = await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.tenant', 'tenant_org_detail'), pkgPage('com.acme.auth', 'acme_org_detail'));
  });

  it('uninstalling the holder releases the object\'s default', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();
    expect(registry.uninstallPackage('com.acme.auth')).toBe(true);
    expect(await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]))).toBeUndefined();
  });

  it('the item seam refuses a package-bound page registration over another package\'s default', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();
    const err = await caught(() => registry.registerItem('page', recordPage('direct_org_detail', 'acme_org'), 'name', 'com.acme.direct'));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.direct', 'direct_org_detail'), pkgPage('com.acme.auth', 'acme_org_detail'));
    expect(registry.listItems<any>('page').map((p) => p.name)).toEqual(['acme_org_detail']);
  });
});

// #23610 (maintainer ruling A on Q1, record 6190536588): `isDefault: true` on a
// page that is not a record page bound to an object holds nothing and is
// refused on its own account, with the page parse's sentence.
const HOME_DEFAULT = { name: 'tenant_home', label: 'Home', type: 'home', isDefault: true, regions: [] };

/** The envelope and the one sentence of a misplaced-default refusal. */
function expectMisplaced(err: Refusal | undefined, page: string, packageId: string) {
  expect(err, 'the registration was refused').toBeDefined();
  expect({ code: err!.code, status: err!.status }).toEqual({ code: MISPLACED_DEFAULT_PAGE_CODE, status: 422 });
  expect(MISPLACED_DEFAULT_PAGE_CODE).toBe('INVALID_METADATA');
  expect((err as { name?: string }).name).toBe('MisplacedDefaultPageError');
  expect(err!.message.startsWith(`Page "${page}" of package "${packageId}": \`isDefault: true\` is refused on a \`type: 'home'\` page`)).toBe(true);
  expect(err!.message).toContain('first navigation item');
}

describe('`isDefault: true` on a page that is not a record page bound to an object', () => {
  it('is refused at the package door with the parse\'s sentence, and leaves no record behind', async () => {
    const { registry, register } = await boot();
    const err = await register(pkg('com.acme.tenant', [recordPage('tenant_task_detail', 'acme_task'), HOME_DEFAULT]));
    expectMisplaced(err, 'tenant_home', 'com.acme.tenant');
    expect(err!.message).toContain(misplacedDefaultPageRefusal(HOME_DEFAULT)!);
    expect(registry.getPackage('com.acme.tenant')).toBeUndefined();
    expect(registry.listItems<any>('page')).toEqual([]);
  });

  it('is refused on a nested plugin\'s pages too', async () => {
    const { register } = await boot();
    expectMisplaced(await register(pkg('com.acme.tenant', [], { plugins: [{ id: 'com.acme.tenant.home', pages: [HOME_DEFAULT] }] })), 'tenant_home', 'com.acme.tenant');
  });

  it('the item seam refuses a package-bound registration of one', async () => {
    const { registry } = await boot();
    expectMisplaced(await caught(() => registry.registerItem('page', HOME_DEFAULT, 'name', 'com.acme.direct')), 'tenant_home', 'com.acme.direct');
    expect(registry.listItems<any>('page')).toEqual([]);
  });

  it('control: the bare slot — a stored row hydrating — is not judged here; the save door refuses it before it is stored', async () => {
    const { registry } = await boot();
    expect(await caught(() => registry.registerItem('page', HOME_DEFAULT))).toBeUndefined();
    expect(registry.listItems<any>('page').map((p) => p.name)).toEqual(['tenant_home']);
  });
});

describe('two default record pages for one object inside one manifest', () => {
  it('is refused at the package door, naming both of the package\'s pages', async () => {
    const { registry, register } = await boot();
    const err = await register(pkg('com.acme.auth', [recordPage('org_a', 'acme_org'), recordPage('org_b', 'acme_org')]));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.auth', 'org_b'), pkgPage('com.acme.auth', 'org_a'));
    expect(registry.getPackage('com.acme.auth')).toBeUndefined();
  });
});

describe('an environment\'s page as a holder (the bare slot)', () => {
  it('a package registering a default for an object the environment holds a default of is refused, naming the environment\'s page', async () => {
    const { register, registry } = await boot();
    // The bare slot — how a stored page reaches the registry (hydration, write-through).
    registry.registerItem('page', recordPage('env_org_detail', 'acme_org'));
    const err = await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.tenant', 'tenant_org_detail'), { kind: 'environment', page: 'env_org_detail' });
  });

  it('control: the environment\'s item under the SAME name is that page\'s overlay, not a second default', async () => {
    const { register, registry } = await boot();
    registry.registerItem('page', recordPage('tenant_org_detail', 'acme_org'));
    expect(await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]))).toBeUndefined();
  });

  it('control: an environment registration over a package\'s default is not judged here (the save door refuses it before it is stored)', async () => {
    const { register, registry } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();
    expect(await caught(() => registry.registerItem('page', recordPage('env_org_detail', 'acme_org')))).toBeUndefined();
  });

  it('an environment overlay that demotes a package\'s default stands in for it: the name no longer holds', async () => {
    const { register, registry } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();
    registry.registerItem('page', { ...recordPage('acme_org_detail', 'acme_org', false), _packageId: 'com.acme.auth' });
    expect(registry.defaultRecordPageHoldersOf('acme_org')).toEqual([]);
    expect(await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]))).toBeUndefined();
  });
});

describe('controls — what is not a second default', () => {
  it('one default record page per object, across packages, registers', async () => {
    const { register, registry } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();
    expect(await register(pkg('com.acme.tenant', [recordPage('tenant_env_detail', 'acme_env')]))).toBeUndefined();
    expect(registry.defaultRecordPageHoldersOf('acme_org')).toEqual([pkgPage('com.acme.auth', 'acme_org_detail')]);
    expect(registry.defaultRecordPageHoldersOf('acme_env')).toEqual([pkgPage('com.acme.tenant', 'tenant_env_detail')]);
  });

  it('a second record page for the object that is NOT a default registers', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();
    expect(await register(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org', false)]))).toBeUndefined();
  });

  it('the same `home` page without the flag registers beside another package\'s default', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]))).toBeUndefined();
    expect(await register(pkg('com.acme.tenant', [{ name: 'tenant_home', label: 'Home', type: 'home', regions: [] }]))).toBeUndefined();
  });

  it('the same package again — a reload, and an upgrade that moves its default to another of its pages — is one holder', async () => {
    const { register, registry } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('org_a', 'acme_org')]))).toBeUndefined();
    expect(await register(pkg('com.acme.auth', [recordPage('org_a', 'acme_org')]))).toBeUndefined();
    expect(await register(pkg('com.acme.auth', [recordPage('org_a', 'acme_org', false), recordPage('org_b', 'acme_org')]))).toBeUndefined();
    expect(registry.defaultRecordPageHoldersOf('acme_org')).toEqual([pkgPage('com.acme.auth', 'org_b')]);
  });

  it('`collisionPolicy: \'warn\'` does not downgrade it', async () => {
    const registry = new SchemaRegistry({ collisionPolicy: 'warn' });
    registry.logLevel = 'silent';
    registry.installPackage(pkg('com.acme.auth', [recordPage('acme_org_detail', 'acme_org')]) as never, 'code');
    const err = await caught(() => registry.installPackage(pkg('com.acme.tenant', [recordPage('tenant_org_detail', 'acme_org')]) as never, 'code'));
    expectRefusal(err, 'acme_org', pkgPage('com.acme.tenant', 'tenant_org_detail'), pkgPage('com.acme.auth', 'acme_org_detail'));
  });
});
