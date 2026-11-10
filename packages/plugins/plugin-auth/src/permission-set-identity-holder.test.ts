// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D2/D3] plugin-auth's readers of an administrator identity read the
 * PLATFORM's `admin_full_access` — the holder whose package declares the
 * kernel namespace `sys` — never another package's set that shares the name.
 *
 * Two holders of `admin_full_access` coexist here the way #31698's narrowing
 * will let packages of different namespaces hold one name: the registry is a
 * package-scoped stand-in with no install-time namesake backstop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bindSecurityCatalogReader, createSecurityCatalogReader, resetPlatformAdminEmailMemo } from '@objectstack/core';
import { ensureDefaultOrganization } from './ensure-default-organization.js';
import { permissionSetInEffect } from './catalog-set-in-effect.js';
import { roleChangeGrantDepsFor } from './role-change-granted-set.js';

const DEFAULT_ORG = 'org_default';
const SYS = 'com.objectstack.plugin-security';
const ACME = 'com.acme.tools';
const NAMESPACES: Record<string, string> = { [SYS]: 'sys', [ACME]: 'acme' };

type Row = Record<string, any>;
type Holders = Record<string, Array<{ packageId: string; item: Row }>>;

const holders: Holders = {
  admin_full_access: [
    { packageId: SYS, item: { name: 'admin_full_access', _packageId: SYS, label: 'Platform administrator' } },
    { packageId: ACME, item: { name: 'admin_full_access', _packageId: ACME, label: 'Acme admin' } },
  ],
  organization_admin: [
    { packageId: SYS, item: { name: 'organization_admin', _packageId: SYS, label: 'Organization administrator' } },
    { packageId: ACME, item: { name: 'organization_admin', _packageId: ACME, label: 'Acme organization admin' } },
  ],
};

const registry = {
  getItem: (type: string, name: string) => (type === 'permission' ? holders[name]?.[0]?.item : undefined),
  listItems: (type: string) => (type === 'permission' ? Object.values(holders).flatMap((h) => h.map((x) => x.item)) : []),
  isPackageDisabled: () => false,
  packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' ? (holders[name] ?? []).map((h) => h.packageId) : []),
  getPackageScopedItem: (type: string, name: string, packageId: string) =>
    (type === 'permission' ? holders[name]?.find((h) => h.packageId === packageId)?.item : undefined),
  getEnvironmentScopedItem: () => undefined,
  getArtifactItem: () => undefined,
  getPackage: (id: string) => (NAMESPACES[id] ? { manifest: { id, namespace: NAMESPACES[id] } } : undefined),
  getAllPackages: () => Object.entries(NAMESPACES).map(([id, namespace]) => ({ manifest: { id, namespace } })),
};

function makeQl(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {
    sys_member: [],
    sys_organization: [{ id: DEFAULT_ORG, slug: 'default', name: 'Default Organization' }],
    sys_user: [{ id: 'u1' }],
    sys_metadata_activation: [],
    ...seed,
  };
  const matches = (row: Row, where: Row) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
      return v === null ? row[k] == null : row[k] === v;
    });
  const ql = {
    registry,
    tables,
    find: vi.fn(async (object: string, q: any) => (tables[object] ?? []).filter((r) => matches(r, q?.where)).slice(0, q?.limit ?? 100)),
    insert: vi.fn(async (object: string, data: Row) => {
      (tables[object] ??= []).push(data);
      return data;
    }),
  };
  bindSecurityCatalogReader(ql, createSecurityCatalogReader({ registry, metadata: { get: async () => undefined, list: async () => [] } } as any));
  return ql;
}

const adminGrant = (permissionSetPackage: string) => ({
  id: `ups_${permissionSetPackage}`, user_id: 'u1', organization_id: DEFAULT_ORG,
  permission_set: 'admin_full_access', permission_set_package: permissionSetPackage,
});

let ambientPosture: string | undefined;
beforeEach(() => {
  ambientPosture = process.env.OS_TENANCY_POSTURE;
  process.env.OS_TENANCY_POSTURE = 'single';
  delete process.env.OS_PLATFORM_OWNER_EMAIL;
  resetPlatformAdminEmailMemo();
});
afterEach(() => {
  if (ambientPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = ambientPosture;
  resetPlatformAdminEmailMemo();
});

describe('[ADR-0150 D2/D3] the Default Organization\'s owner is bound from the platform\'s `admin_full_access` only', () => {
  it('CONTROL: a grant of the sys holder\'s set binds its holder as owner', async () => {
    const ql = makeQl({ sys_user_permission_set: [adminGrant(SYS)] });
    expect(await ensureDefaultOrganization(ql)).toMatchObject({ memberCreated: true });
    expect(ql.tables.sys_member[0]).toMatchObject({ user_id: 'u1', role: 'owner' });
  });

  it('⛔ a grant of another package\'s set of that name binds no one', async () => {
    const ql = makeQl({ sys_user_permission_set: [adminGrant(ACME)] });
    expect(await ensureDefaultOrganization(ql)).toMatchObject({ memberCreated: false, reason: 'no_admin' });
    expect(ql.tables.sys_member).toEqual([]);
  });
});

describe('[ADR-0150 D3, D4] permissionSetInEffect asks for the platform\'s holder', () => {
  const read = (ql: ReturnType<typeof makeQl>) => (object: string, query: any) => ql.find(object, query);

  it('the platform\'s set is in effect beside another package\'s set of the name — which the caller-less read refuses', async () => {
    const ql = makeQl({});
    expect(await permissionSetInEffect(ql, read(ql), 'admin_full_access', { platform: true })).toBe(true);
    expect(await permissionSetInEffect(ql, read(ql), 'admin_full_access')).toBe(false);
  });

  it('⛔ a ledger row switching off another package\'s set leaves the platform\'s in effect; one naming the platform\'s switches it off', async () => {
    const off = (packageId: string) => ({ id: `act_${packageId}`, metadata_type: 'permission', package_id: packageId, name: 'admin_full_access', active: false });
    const acmeOff = makeQl({ sys_metadata_activation: [off(ACME)] });
    expect(await permissionSetInEffect(acmeOff, read(acmeOff), 'admin_full_access', { platform: true })).toBe(true);
    const sysOff = makeQl({ sys_metadata_activation: [off(SYS)] });
    expect(await permissionSetInEffect(sysOff, read(sysOff), 'admin_full_access', { platform: true })).toBe(false);
  });
});

describe('[ADR-0150 D3] the role-change answer names the platform\'s organization-admin set only', () => {
  it('⛔ a grant of another package\'s `organization_admin` is not read as the set the role change granted', async () => {
    const grantOf = (packageId: string) => ({
      id: `ups_${packageId}`, user_id: 'u1', organization_id: DEFAULT_ORG,
      permission_set: 'organization_admin', permission_set_package: packageId,
    });
    const sys = (ql: ReturnType<typeof makeQl>) => roleChangeGrantDepsFor(ql, { find: (object, query) => ql.find(object, query) });
    const acmeQl = makeQl({ sys_user_permission_set: [grantOf(ACME)] });
    expect(await sys(acmeQl).readGrantedSetNames('u1', DEFAULT_ORG)).toEqual([]);
    const sysQl = makeQl({ sys_user_permission_set: [grantOf(SYS)] });
    expect(await sys(sysQl).readGrantedSetNames('u1', DEFAULT_ORG)).toEqual(['organization_admin']);
    expect(await sys(sysQl).readSetLabel('organization_admin')).toBe('Organization administrator');
  });
});
