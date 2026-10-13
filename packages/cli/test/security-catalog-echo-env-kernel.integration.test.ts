// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A permission set or a position written through the metadata door is in the
 * security catalog of an ENVIRONMENT kernel: it resolves, it grants, and an
 * `isDefault: true` set in a runtime package records its `everyone`
 * suggestion. Booted through the production wiring, across a restart.
 *
 * ## Why this boots kernels
 *
 * On an environment kernel the metadata door registers no stored row in the
 * engine registry (`applyRegistryWriteThrough` returns before the hydrator
 * when the kernel has an `environmentId`), so the security catalog
 * (ADR-0131 D3) finds such a set or position only in the kernel's metadata
 * service. One thing put it there: the permission-set projector's registry
 * echo. C3 stage 8 unwired the projector, and the echo went with it. Every
 * metadata-door permission set on an environment kernel then resolved to
 * nothing, granted nothing and suggested nothing — and the unit suite that
 * pinned the echo stayed green, because it wired the projector itself.
 * Positions had the same gap before stage 8: nothing ever echoed them.
 *
 * So this file wires NOTHING itself. Each case boots the composition a hosted
 * tenant runs (cloud's per-project shape, as quoted in
 * `src/utils/platform-migrations-arming.integration.test.ts`: an
 * environment-scoped `ObjectQLPlugin` with the protocol delegated to
 * `createMetadataProtocolPlugin`), plus the real metadata service, auth and
 * `SecurityPlugin`, and asserts on what a request sees. The host kernel (the
 * `os serve` shape: built-in protocol, no environment) runs the same scenario
 * as a control; its stored rows reach the engine registry, so it never needed
 * the echo.
 *
 * The restart leg boots a second kernel over the same database file: the
 * overlays are stored rows by then, and only `SecurityPlugin`'s
 * `kernel:ready` pass puts them back in the metadata service.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectKernel, AppPlugin, DefaultDatasourcePlugin } from '@objectstack/runtime';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { createMetadataProtocolPlugin } from '@objectstack/metadata-protocol';
import { MetadataPlugin } from '@objectstack/metadata';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { securityCatalogReaderOf, resolveAuthzContext, assembleExecutionContext } from '@objectstack/core';

const ENV = 'env_catalog_echo';
const SYS = { context: { isSystem: true } } as any;

/** A writable runtime package, never installed as code. */
const RUNTIME_PKG = 'app.catalog_echo';
/** Its default set: `isDefault: true`, no `packageId` in the body. */
const PKG_SET = 'echo_pkg_default';
/** A set saved into no package. */
const LOOSE_SET = 'echo_loose_reader';
/** A position saved into no package, naming the set the stack declares. */
const POSITION = 'echo_position';
const DECLARED_SET = 'echo_declared_reader';

const stack: any = {
  manifest: { id: 'com.example.catalog_echo', name: 'catalog_echo', version: '0.0.1', type: 'app' },
  objects: [{ name: 'echo_doc', label: 'Echo Doc', fields: { title: { type: 'text', label: 'Title' } } }],
  permissions: [{ name: DECLARED_SET, label: 'Declared reader', objects: { echo_doc: { allowRead: true } } }],
};

type Kind = 'environment' | 'host';

async function boot(kind: Kind, dbFile: string, rootDir: string): Promise<any> {
  const kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin(kind === 'environment' ? { environmentId: ENV, registerProtocol: false } : {}) as any);
  await kernel.use(new (DefaultDatasourcePlugin as any)({ driver: 'sqlite', config: { filename: dbFile } }, { dev: false }));
  if (kind === 'environment') await kernel.use(createMetadataProtocolPlugin({ environmentId: ENV }) as any);
  await kernel.use(new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' }, rootDir }) as any);
  await kernel.use(new AppPlugin(stack) as any);
  await kernel.use(new PlatformObjectsPlugin() as any);
  await kernel.use(new AuthPlugin({ secret: 'catalog-echo-secret-catalog-echo-secret' }) as any);
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(stack)) as any);
  await kernel.bootstrap();
  return kernel;
}

/** Read `echo_doc` as `userId`, with the context the request path builds. */
async function readAs(ql: any, userId: string, org: string): Promise<'granted' | 'refused'> {
  const authz = await resolveAuthzContext({
    ql,
    headers: {},
    getSession: () => ({ user: { id: userId }, session: { userId, activeOrganizationId: org } }),
  } as any);
  const context = assembleExecutionContext({ authz, oauth: undefined, localization: undefined, requestLocale: undefined } as any);
  try {
    const rows = await ql.find('echo_doc', { where: {} }, { context });
    return Array.isArray(rows) && rows.length === 1 ? 'granted' : 'refused';
  } catch {
    return 'refused';
  }
}

const USERS = { pkg: 'usr_echo_pkg', loose: 'usr_echo_loose', position: 'usr_echo_position' } as const;

/**
 * One kind's scenario: author the two sets and the position through the
 * metadata door on the first boot, and grant each to its own user. Boot `n`
 * reopens the same file; nothing is authored again.
 */
function scenario(kind: Kind) {
  const dir = mkdtempSync(join(tmpdir(), `catalog-echo-${kind}-`));
  const dbFile = join(dir, 'echo.db');
  const state: { kernel?: any; ql?: any; protocol?: any; org?: string; beforeGrant?: string } = {};

  const open = async () => {
    state.kernel = await boot(kind, dbFile, dir);
    state.ql = await state.kernel.getServiceAsync('objectql');
    state.protocol = await state.kernel.getServiceAsync('protocol');
    const orgs = (await state.ql.find('sys_organization', { where: {} }, SYS)) as any[];
    state.org = orgs[0]?.id;
  };
  const close = async () => {
    try { await state.kernel?.shutdown(); } catch { /* the next boot reports */ }
    state.kernel = undefined;
  };

  const author = async () => {
    const { ql, protocol, org } = state as Required<typeof state>;
    expect(protocol.environmentId ?? null, 'topology').toBe(kind === 'environment' ? ENV : null);
    const set = (name: string) => ({ name, label: name, isDefault: true, objects: { echo_doc: { allowRead: true } } });
    await protocol.saveMetaItem({ type: 'permission', name: PKG_SET, item: set(PKG_SET), packageId: RUNTIME_PKG, mode: 'draft' });
    const published = await protocol.publishPackageDrafts({ packageId: RUNTIME_PKG, actor: 'system' });
    expect(published, JSON.stringify(published)).toMatchObject({ outcome: 'published', failed: [] });
    await protocol.saveMetaItem({ type: 'permission', name: LOOSE_SET, item: { ...set(LOOSE_SET), isDefault: false } });
    await protocol.saveMetaItem({
      type: 'position', name: POSITION, item: { name: POSITION, label: 'Echo position', permissionSets: [DECLARED_SET] },
    });

    await ql.insert('echo_doc', { id: 'doc_1', title: 'only a grant reads this', organization_id: org }, SYS);
    for (const id of Object.values(USERS)) {
      await ql.insert('sys_user', { id, email: `${id}@example.test`, name: id, email_verified: true }, SYS);
      await ql.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: org, role: 'member' }, SYS);
    }
    state.beforeGrant = await readAs(ql, USERS.pkg, org);
    await ql.insert('sys_user_permission_set', { id: 'ups_pkg', user_id: USERS.pkg, permission_set: PKG_SET, organization_id: org }, SYS);
    await ql.insert('sys_user_permission_set', { id: 'ups_loose', user_id: USERS.loose, permission_set: LOOSE_SET, organization_id: org }, SYS);
    await ql.insert('sys_user_position', { id: 'upos_1', user_id: USERS.position, position: POSITION, organization_id: org }, SYS);
  };

  const resolve = (type: 'permission' | 'position', name: string) => securityCatalogReaderOf(state.ql)!.resolve(type, name);
  const pendingSuggestions = async () =>
    ((await state.ql.find('sys_audience_binding_suggestion', { where: { permission_set_name: PKG_SET } }, SYS)) as any[])
      .filter((row) => row.status === 'pending');

  return { dir, dbFile, state, open, close, author, resolve, pendingSuggestions };
}

describe('environment kernel: a metadata-door permission set or position is in the security catalog', () => {
  const s = scenario('environment');

  beforeAll(async () => {
    await s.open();
    await s.author();
  }, 180_000);
  afterAll(async () => {
    await s.close();
    rmSync(s.dir, { recursive: true, force: true });
  });

  it('the runtime-package set resolves from the metadata service, under its owning package', async () => {
    // The topology under test: no stored row reaches the engine registry.
    expect(s.state.ql.registry.getItem('permission', PKG_SET)).toBeFalsy();
    expect(await s.resolve('permission', PKG_SET)).toMatchObject({ source: 'metadata', packageId: RUNTIME_PKG });
  });

  it('the read it grants is refused before the grant and granted after it', async () => {
    expect(s.state.beforeGrant).toBe('refused');
    expect(await readAs(s.state.ql, USERS.pkg, s.state.org!)).toBe('granted');
  });

  it('records one pending everyone suggestion for it', async () => {
    await vi.waitFor(async () => expect(await s.pendingSuggestions()).toHaveLength(1), { timeout: 10_000, interval: 100 });
    expect((await s.pendingSuggestions())[0]).toMatchObject({ package_id: RUNTIME_PKG, anchor: 'everyone' });
  }, 30_000);

  it('the set saved into no package resolves, unowned, and grants', async () => {
    const entry = await s.resolve('permission', LOOSE_SET);
    expect(entry).toMatchObject({ source: 'metadata' });
    expect(entry).not.toHaveProperty('packageId');
    expect(await readAs(s.state.ql, USERS.loose, s.state.org!)).toBe('granted');
  });

  it('the position resolves, and its holder reads through the set it names', async () => {
    expect(await s.resolve('position', POSITION)).toMatchObject({ source: 'metadata' });
    expect(await readAs(s.state.ql, USERS.position, s.state.org!)).toBe('granted');
  });

  it('after a restart over the same stored overlays, all three resolve and grant again', async () => {
    await s.close();
    // The overlays are stored rows now, read through a connection of our own.
    const probe = new SqlDriver({ client: 'better-sqlite3', connection: { filename: s.dbFile }, useNullAsDefault: true });
    try {
      const rows = await (probe as any).knex('sys_metadata').select('type', 'name').where({ state: 'active' }).whereNull('organization_id');
      const stored = rows.map((r: any) => `${r.type}/${r.name}`);
      expect(stored).toEqual(expect.arrayContaining([`permission/${PKG_SET}`, `permission/${LOOSE_SET}`, `position/${POSITION}`]));
    } finally {
      await (probe as any).knex.destroy();
    }

    await s.open();
    expect(await s.resolve('permission', PKG_SET)).toMatchObject({ source: 'metadata', packageId: RUNTIME_PKG });
    expect(await s.resolve('permission', LOOSE_SET)).toMatchObject({ source: 'metadata' });
    expect(await s.resolve('position', POSITION)).toMatchObject({ source: 'metadata' });
    expect(await readAs(s.state.ql, USERS.pkg, s.state.org!)).toBe('granted');
    expect(await readAs(s.state.ql, USERS.loose, s.state.org!)).toBe('granted');
    expect(await readAs(s.state.ql, USERS.position, s.state.org!)).toBe('granted');
    expect(await s.pendingSuggestions()).toHaveLength(1);
  }, 180_000);
});

describe('control — host kernel: the same writes resolve from the engine registry', () => {
  const s = scenario('host');

  beforeAll(async () => {
    await s.open();
    await s.author();
  }, 180_000);
  afterAll(async () => {
    await s.close();
    rmSync(s.dir, { recursive: true, force: true });
  });

  it('both sets and the position resolve, and each grants', async () => {
    expect(s.state.beforeGrant).toBe('refused');
    expect(await s.resolve('permission', PKG_SET)).toMatchObject({ source: 'registry' });
    expect(await s.resolve('permission', LOOSE_SET)).toMatchObject({ source: 'registry' });
    expect(await s.resolve('position', POSITION)).toMatchObject({ source: 'registry' });
    expect(await readAs(s.state.ql, USERS.pkg, s.state.org!)).toBe('granted');
    expect(await readAs(s.state.ql, USERS.loose, s.state.org!)).toBe('granted');
    expect(await readAs(s.state.ql, USERS.position, s.state.org!)).toBe('granted');
  });
});
