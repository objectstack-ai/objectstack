// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3] "Tenants are refused creation and may only assign" — the
 * walled catalog refusal at the data door (`walled-catalog-data-door.ts`).
 *
 * Measured before it on this same harness shape (a real `ObjectQL` over a real
 * SQL driver, the real `SecurityPlugin`, the `isolated` posture with the
 * organization-scoping service): an organization-bound administrator holding
 * the superuser wildcard created a position at the data door, and it landed
 * as a row of that organization. Nothing judged a catalog create by posture.
 *
 * Pinned here, per posture:
 *  - `isolated` and `group`: the tenant's create, update and delete of a
 *    position, a permission set and a capability are refused with the ADR-0112
 *    envelope `403 PERMISSION_DENIED`, and nothing is stored;
 *  - the CONTROL: the same tenant still assigns a catalog position to a member
 *    of its organization;
 *  - the platform operator rung and a system write are admitted;
 *  - `single`: the same tenant's create is accepted, unchanged.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { PermissionSet } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysCapability } from './objects/sys-capability.object.js';
import { WALLED_CATALOG_OBJECT_TYPES } from './walled-catalog-data-door.js';

const ORG = 'org_a';

/** The fallback every authenticated caller resolves: it grants nothing here. */
const MEMBER_DEFAULT = { name: 'member_default', label: 'Member', objects: {} } as unknown as PermissionSet;

/** An organization-bound administrator: the superuser wildcard, so CRUD admits every catalog table. */
const QA_ADMIN = {
  name: 'qa_admin',
  label: 'QA Admin',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
} as unknown as PermissionSet;

type Posture = 'single' | 'isolated' | 'group';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: Posture) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.walled-catalog-data-door',
    name: 'Walled catalog data door',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet,
      SysCapability, SysMember, SysMetadataActivation,
    ],
  } as any);
  await engine.syncSchemas();
  for (const o of [SysUser, SysMember, SysPosition, SysUserPosition, SysPermissionSet, SysUserPermissionSet, SysPositionPermissionSet]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as never, 'qa.authz-read-set');
  }
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission'
          ? ([MEMBER_DEFAULT, QA_ADMIN] as Array<{ name?: string }>).find((s) => s?.name === name) ?? null
          : engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, QA_ADMIN],
    },
    ...(posture === 'single'
      ? {}
      : { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture } }),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  const walled = posture !== 'single';
  const system = walled ? { isSystem: true, tenantId: ORG } : { isSystem: true };
  // The catalog the tenant may assign: one position, declared in the registry.
  engine.registry.registerItem('position', { name: 'qa_auditor', label: 'Auditor', permissionSets: [] } as any,
    'name' as any, 'com.objectstack.qa.walled-catalog-data-door');
  // Rows the tenant will try to change: one per catalog object.
  await engine.insert('sys_position', { id: 'pos_existing', name: 'qa_existing', label: 'Existing' }, { context: system } as any);
  await engine.insert('sys_permission_set', {
    id: 'ps_existing', name: 'qa_existing_set', label: 'Existing set',
    object_permissions: '{}', field_permissions: '{}', system_permissions: '[]', active: true,
  }, { context: system } as any);
  await engine.insert('sys_capability', { id: 'cap_existing', name: 'qa.existing', label: 'Existing capability' }, { context: system } as any);
  // The member an assignment names: a member of the organization it is scoped to.
  await engine.insert('sys_member', { user_id: 'u_member', organization_id: ORG, role: 'member' },
    { context: { isSystem: true, tenantId: ORG } } as any);

  const tenant = walled
    ? { userId: 'u_admin', positions: [], permissions: ['qa_admin'], tenantId: ORG, accessible_org_ids: [ORG] }
    : { userId: 'u_admin', positions: [], permissions: ['qa_admin'] };
  return { engine, tenant, system };
}

async function outcomeOf(run: Promise<unknown>): Promise<{ ok: true } | { ok: false; code: string; status: number }> {
  try {
    await run;
    return { ok: true };
  } catch (e) {
    const r = resolveThrownHttpError(e);
    return { ok: false, code: r.code, status: r.status };
  }
}

const REFUSED = { ok: false, code: 'PERMISSION_DENIED', status: 403 } as const;

async function storedNames(engine: ObjectQL, object: string, name: string): Promise<number> {
  const rows = await engine.find(object, { where: { name }, context: { isSystem: true } } as any);
  return Array.isArray(rows) ? rows.length : 0;
}

for (const posture of ['isolated', 'group'] as const) {
  describe(`[ADR-0131 D3] ${posture}: tenants are refused catalog writes and may only assign`, () => {
    it('a create of a position, a permission set or a capability is refused 403 PERMISSION_DENIED, and nothing is stored', async () => {
      const { engine, tenant } = await boot(posture);
      expect(await outcomeOf(engine.insert('sys_position', { name: 'plant_lead', label: 'Plant lead' }, { context: tenant } as any)))
        .toEqual(REFUSED);
      expect(await outcomeOf(engine.insert('sys_permission_set', { name: 'plant_set', label: 'Plant set' }, { context: tenant } as any)))
        .toEqual(REFUSED);
      expect(await outcomeOf(engine.insert('sys_capability', { name: 'plant.cap', label: 'Plant cap' }, { context: tenant } as any)))
        .toEqual(REFUSED);
      expect(await storedNames(engine, 'sys_position', 'plant_lead')).toBe(0);
      expect(await storedNames(engine, 'sys_permission_set', 'plant_set')).toBe(0);
      expect(await storedNames(engine, 'sys_capability', 'plant.cap')).toBe(0);
    });

    it('an update and a delete of a catalog row are refused, and the row is untouched', async () => {
      const { engine, tenant } = await boot(posture);
      expect(await outcomeOf(engine.update('sys_position', { id: 'pos_existing', label: 'Renamed' }, { context: tenant } as any)))
        .toEqual(REFUSED);
      expect(await outcomeOf(engine.delete('sys_permission_set', { where: { id: 'ps_existing' }, context: tenant } as any)))
        .toEqual(REFUSED);
      const [row] = await engine.find('sys_position', { where: { id: 'pos_existing' }, context: { isSystem: true } } as any) as any[];
      expect(row?.label).toBe('Existing');
      expect(await storedNames(engine, 'sys_permission_set', 'qa_existing_set')).toBe(1);
    });

    it('CONTROL: the same tenant still assigns a catalog position to a member of its organization', async () => {
      const { engine, tenant } = await boot(posture);
      expect(await outcomeOf(engine.insert('sys_user_position', { user_id: 'u_member', position: 'qa_auditor' }, { context: tenant } as any)))
        .toEqual({ ok: true });
    });

    it('the platform operator rung and a system write are admitted', async () => {
      const { engine, tenant, system } = await boot(posture);
      const operator = { ...tenant, userId: 'u_operator', posture: 'PLATFORM_ADMIN' };
      expect(await outcomeOf(engine.insert('sys_position', { name: 'op_lead', label: 'Operator lead' }, { context: operator } as any)))
        .toEqual({ ok: true });
      expect(await outcomeOf(engine.insert('sys_position', { name: 'sys_lead', label: 'System lead' }, { context: system } as any)))
        .toEqual({ ok: true });
    });

    it('a tenant rung below the operator is refused like a context that carries none', async () => {
      const { engine, tenant } = await boot(posture);
      const tenantAdmin = { ...tenant, posture: 'TENANT_ADMIN' };
      expect(await outcomeOf(engine.insert('sys_position', { name: 'ta_lead', label: 'Tenant admin lead' }, { context: tenantAdmin } as any)))
        .toEqual(REFUSED);
    });
  });
}

describe('[ADR-0131 D3] single: the data door is unchanged (control)', () => {
  it('the same administrator creates a position and a permission set', async () => {
    const { engine, tenant } = await boot('single');
    expect(await outcomeOf(engine.insert('sys_position', { name: 'plant_lead', label: 'Plant lead' }, { context: tenant } as any)))
      .toEqual({ ok: true });
    expect(await outcomeOf(engine.insert('sys_permission_set', { name: 'plant_set', label: 'Plant set' }, { context: tenant } as any)))
      .toEqual({ ok: true });
    expect(await storedNames(engine, 'sys_position', 'plant_lead')).toBe(1);
  });
});

describe('the judged objects', () => {
  it('are exactly the three security catalog objects — assignment objects are never judged', () => {
    expect(WALLED_CATALOG_OBJECT_TYPES).toEqual({
      sys_position: 'position',
      sys_permission_set: 'permission',
      sys_capability: 'capability',
    });
  });
});
