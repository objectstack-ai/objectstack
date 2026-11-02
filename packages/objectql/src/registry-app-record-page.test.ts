// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app-scoped record page at the registry's package door and item seam —
 * `PageSchema.apps` (maintainer ruling A on #28979, record 6573557633;
 * `default-record-page.ts`, "The app-scoped record page").
 *
 * At most one record page per object PER APP: a second package registering a
 * record page for an object inside an app another page already holds is
 * refused by the same holders, claims and overlay rules that refuse a second
 * default, with the same code, naming both pages and the app. The deployment's
 * default and an app's page are two slots and coexist.
 *
 * The door under test is the real one: the `manifest` service ObjectQLPlugin
 * registers (`ObjectQL.registerApp` → `SchemaRegistry.installPackage`, then
 * `registerItem('page', …, packageId)`). Every refusal is asserted by its
 * ADR-0112 envelope (`code` + `status`), the slot and both pages; every
 * refusal has a control that differs from it by one key alone.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { DEFAULT_RECORD_PAGE_CONFLICT_CODE, MISPLACED_DEFAULT_PAGE_CODE } from './registry.js';
import type { ObjectQL } from './engine.js';

type ManifestService = { register(m: unknown): void | Promise<void> };
type Holder = { kind: 'package'; packageId: string; page: string } | { kind: 'environment'; page: string };
type Conflict = { object: string; app?: string; incoming: Holder; existing: Holder };
type Refusal = Error & { code?: string; status?: number; object?: string; conflicts?: Conflict[] };

/** A record page of `object`; `apps` and `isDefault` are what a case varies. */
const recordPage = (name: string, object: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  type: 'record',
  object,
  regions: [],
  ...extra,
});

const pkg = (id: string, pages: unknown[] = []) => ({ id, name: id.split('.').pop(), version: '1.0.0', type: 'app', pages });

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

function expectAppRefusal(err: Refusal | undefined, conflict: Conflict) {
  expect(err, 'the registration was refused').toBeDefined();
  expect({ code: err!.code, status: err!.status }).toEqual({ code: DEFAULT_RECORD_PAGE_CONFLICT_CODE, status: 422 });
  expect(err!.conflicts).toEqual([conflict]);
  const name = (h: Holder) =>
    h.kind === 'package' ? `page "${h.page}" of package "${h.packageId}"` : `page "${h.page}", authored in this system`;
  expect(err!.message.split('. ')[0]).toBe(
    `Default record page conflict: ${name(conflict.incoming)} cannot be the record page of object "${conflict.object}" `
      + `in app "${conflict.app}": ${name(conflict.existing)} already is`,
  );
  expect(err!.message).toContain('Keep one page per object per app: remove the app from `apps` on one of the two pages');
  expect(err!.message).not.toContain('Keep one default per object');
}

describe('a second package registering a record page for an object inside an app another page holds', () => {
  it('is refused at the package door, naming both pages and the app, and leaves no record behind', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { apps: ['duly'] })]))).toBeUndefined();

    const err = await register(pkg('com.acme.other', [recordPage('other_member', 'sys_user', { apps: ['duly'] })]));
    expectAppRefusal(err, {
      object: 'sys_user',
      app: 'duly',
      incoming: pkgPage('com.acme.other', 'other_member'),
      existing: pkgPage('com.acme.duly', 'duly_member'),
    });
    expect(registry.getPackage('com.acme.other')).toBeUndefined();
    expect(registry.listItems<any>('page').map((p) => p.name)).toEqual(['duly_member']);
  });

  it('control: the second page scoped to another app registers', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { apps: ['duly'] })]))).toBeUndefined();
    expect(await register(pkg('com.acme.other', [recordPage('other_member', 'sys_user', { apps: ['crm'] })]))).toBeUndefined();
  });

  it('two pages of ONE manifest for one object in one app are refused, naming both', async () => {
    const { register } = await boot();
    const err = await register(pkg('com.acme.duly', [
      recordPage('member_a', 'sys_user', { apps: ['duly'] }),
      recordPage('member_b', 'sys_user', { apps: ['duly'] }),
    ]));
    expectAppRefusal(err, {
      object: 'sys_user',
      app: 'duly',
      incoming: pkgPage('com.acme.duly', 'member_b'),
      existing: pkgPage('com.acme.duly', 'member_a'),
    });
  });

  it('a page scoped to two apps holds both slots: a second page in either app is refused', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { apps: ['duly', 'crm'] })]))).toBeUndefined();
    const err = await register(pkg('com.acme.other', [recordPage('other_member', 'sys_user', { apps: ['crm'] })]));
    expect(err?.conflicts?.map((c) => [c.object, c.app])).toEqual([['sys_user', 'crm']]);
  });

  it('a package installed with no pages registered still holds its app slot (its claim), and uninstalling releases it', async () => {
    const { registry, register } = await boot();
    registry.installPackage(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { apps: ['duly'] })]) as any, 'code');
    expect(registry.listItems<any>('page')).toEqual([]);
    expect(registry.defaultRecordPageHoldersOf('sys_user', 'duly')).toEqual([pkgPage('com.acme.duly', 'duly_member')]);
    const err = await register(pkg('com.acme.other', [recordPage('other_member', 'sys_user', { apps: ['duly'] })]));
    expect(err?.code).toBe(DEFAULT_RECORD_PAGE_CONFLICT_CODE);

    expect(registry.uninstallPackage('com.acme.duly')).toBe(true);
    expect(registry.defaultRecordPageHoldersOf('sys_user', 'duly')).toEqual([]);
    expect(await register(pkg('com.acme.other', [recordPage('other_member', 'sys_user', { apps: ['duly'] })]))).toBeUndefined();
  });

  it('the item seam refuses a package-bound page registration in an app another package holds', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { apps: ['duly'] })]))).toBeUndefined();
    const err = await caught(() =>
      registry.registerItem('page', recordPage('direct_member', 'sys_user', { apps: ['duly'] }), 'name', 'com.acme.direct'),
    );
    expectAppRefusal(err, {
      object: 'sys_user',
      app: 'duly',
      incoming: pkgPage('com.acme.direct', 'direct_member'),
      existing: pkgPage('com.acme.duly', 'duly_member'),
    });
  });

  it('control: the item seam registers the same page scoped to another app', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { apps: ['duly'] })]))).toBeUndefined();
    expect(await caught(() =>
      registry.registerItem('page', recordPage('direct_member', 'sys_user', { apps: ['crm'] }), 'name', 'com.acme.direct'),
    )).toBeUndefined();
  });

  it('a package scoping a page to an app the environment\'s page holds is refused, naming the environment\'s page', async () => {
    const { registry, register } = await boot();
    registry.registerItem('page', recordPage('env_member', 'sys_user', { apps: ['duly'] }));
    const err = await register(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { apps: ['duly'] })]));
    expectAppRefusal(err, {
      object: 'sys_user',
      app: 'duly',
      incoming: pkgPage('com.acme.duly', 'duly_member'),
      existing: { kind: 'environment', page: 'env_member' },
    });
  });
});

describe('the default and an app\'s page are two slots', () => {
  it('a package\'s app-scoped page registers beside another package\'s default for the same object', async () => {
    const { registry, register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('sys_user_detail', 'sys_user', { isDefault: true })]))).toBeUndefined();
    expect(await register(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { apps: ['duly'] })]))).toBeUndefined();
    expect(registry.defaultRecordPageHoldersOf('sys_user')).toEqual([pkgPage('com.acme.auth', 'sys_user_detail')]);
    expect(registry.defaultRecordPageHoldersOf('sys_user', 'duly')).toEqual([pkgPage('com.acme.duly', 'duly_member')]);
  });

  it('a second default is still refused as a default, with the default\'s remedy', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.auth', [recordPage('sys_user_detail', 'sys_user', { isDefault: true })]))).toBeUndefined();
    const err = await register(pkg('com.acme.duly', [recordPage('duly_member', 'sys_user', { isDefault: true, apps: ['duly'] })]));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: DEFAULT_RECORD_PAGE_CONFLICT_CODE, status: 422 });
    expect(err!.conflicts!.map((c) => c.app)).toEqual([undefined]);
    expect(err!.message).toContain('Keep one default per object');
    expect(err!.message).not.toContain('Keep one page per object per app');
  });
});

describe('`apps` on a page that is not a record page bound to an object', () => {
  it('is refused at the package door with the parse\'s sentence', async () => {
    const { register } = await boot();
    const err = await register(pkg('com.acme.duly', [{ name: 'duly_home', label: 'Home', type: 'home', apps: ['duly'] }]));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: MISPLACED_DEFAULT_PAGE_CODE, status: 422 });
    expect(err!.message).toContain("`apps` is refused on a `type: 'home'` page");
  });

  it('control: the same home page without `apps` registers', async () => {
    const { register } = await boot();
    expect(await register(pkg('com.acme.duly', [{ name: 'duly_home', label: 'Home', type: 'home' }]))).toBeUndefined();
  });
});
