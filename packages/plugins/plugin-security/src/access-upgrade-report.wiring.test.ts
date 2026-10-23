// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §6 wall 3] The access upgrade report as `SecurityPlugin` wires it:
 * a REAL `ObjectQL` engine over the SQL driver, the real plugin started on it,
 * and the `kernel:bootstrapped` handler the plugin registered fired by the
 * test. The ledger row, the grants and the organizations are real rows; the
 * catalog is the plugin's own read over the engine registry; `messaging` and
 * `sharingRules` are the services the plugin looks up by name.
 *
 * Pins the acceptance end to end: a permission set the customer switched off,
 * renamed by the vendor with its own position binding the new name, reaches
 * the administrator under `single` (a notification) and the operator alone under
 * a wall (a log line addressed to the operator, no notification); with
 * the old name still shipped (CONTROL), nobody is told.
 *
 * [#25413] And under a wall with `OS_PLATFORM_OWNER_ORGANIZATION` naming the
 * operator's dedicated organization: one notification stamped with that
 * organization and addressed to the operator, beside the operator line, and
 * none in any other organization. The same finding set carries the same
 * `dedupKey` on the next boot, which is what the ingress deduplicates on. An
 * unknown value raises nothing in-app and says so.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject,
} from '@objectstack/metadata-core';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { ACCESS_UPGRADE_TOPIC } from './access-upgrade-report.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const OWNER_ORG_ENV = 'OS_PLATFORM_OWNER_ORGANIZATION';
const OPERATOR = 'operator@u1.example';
const VENDOR = 'com.acme.u1';
const DEFAULT_ORG = 'org_u1_default';
const OWNER_ORG = 'org_u1_platform';
const TENANT_ORG = 'org_u1_tenant';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env[POSTURE_ENV];
  delete process.env[OWNER_ENV];
  delete process.env[OWNER_ORG_ENV];
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: 'single' | 'isolated' | 'group', renamed: boolean, ownerOrganization?: string) {
  const walled = posture !== 'single';
  if (walled) process.env[POSTURE_ENV] = posture;
  process.env[OWNER_ENV] = OPERATOR;
  if (ownerOrganization !== undefined) process.env[OWNER_ORG_ENV] = ownerOrganization;
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.access-upgrade-report', name: 'Access upgrade report', version: '1.0.0',
    type: 'plugin', scope: 'system',
    objects: [
      SysOrganization, SysUser, SysMember, SysUserPermissionSet, SysMetadataActivation,
      SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject,
    ],
  } as any);
  await engine.syncSchemas();
  engines.push(engine);

  // The vendor package after (or, in the CONTROL, before) its upgrade renamed the set.
  const setName = renamed ? 'u1_sales_representative' : 'u1_sales_rep';
  const registry = (engine as any).registry;
  registry.registerItem('permission', { name: setName, label: 'Sales', objects: {} }, 'name', VENDOR);
  registry.registerItem('position', { name: 'u1_sales_lead', label: 'Lead', permissionSets: [setName] }, 'name', VENDOR);

  const metadata = { get: async () => null, list: async () => [] };
  const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map(), undefined);
  const emit = vi.fn(async () => ({ notificationId: 'n1' }));
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    protocol,
    messaging: { emit },
    sharingRules: { listDeclaredRules: async () => [] },
    ...(walled ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture } } : {}),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const hooks = new Map<string, Array<() => Promise<unknown>>>();
  const ctx: any = {
    logger,
    hook: (event: string, handler: () => Promise<unknown>) => {
      if (!hooks.has(event)) hooks.set(event, []);
      hooks.get(event)!.push(handler);
    },
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

  // The customer's choice: the vendor's set switched off, recorded with its package.
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default', slug: 'default' }, { context: SYS } as any);
  if (walled) {
    // The operator's dedicated organization, which the operator owns, and a tenant beside it.
    await engine.insert('sys_organization', { id: OWNER_ORG, name: 'Platform operations', slug: 'u1-platform-ops' }, { context: SYS } as any);
    await engine.insert('sys_organization', { id: TENANT_ORG, name: 'Tenant', slug: 'u1-tenant' }, { context: SYS } as any);
    await engine.insert('sys_user', {
      id: 'usr_u1_operator', name: 'Operator', email: OPERATOR, email_verified: true,
    }, { context: SYS } as any);
    await engine.insert('sys_member', {
      id: 'mem_u1_operator', organization_id: OWNER_ORG, user_id: 'usr_u1_operator', role: 'owner',
    }, { context: { isSystem: true, tenantId: OWNER_ORG } } as any);
  }
  await engine.insert('sys_metadata_activation', {
    id: 'act_u1', metadata_type: 'permission', name: 'u1_sales_rep', package_id: VENDOR, active: false,
  }, { context: SYS } as any);
  await engine.insert('sys_user_permission_set', {
    id: 'g_u1_admin', user_id: 'usr_u1_admin', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG,
  }, { context: { isSystem: true, tenantId: DEFAULT_ORG } } as any);

  for (const handler of hooks.get('kernel:bootstrapped') ?? []) await handler();
  return { emit, logger };
}

describe('[ADR-0126 §6 wall 3] the access upgrade report, wired at kernel:bootstrapped', () => {
  it('single: a switched-off set renamed by the vendor reaches the administrator, naming old, new and the binding position', async () => {
    const { emit, logger } = await boot('single', true);
    expect(emit).toHaveBeenCalledTimes(1);
    const input = (emit.mock.calls[0] as any[])[0];
    expect({ topic: input.topic, severity: input.severity, audience: input.audience, organizationId: input.organizationId })
      .toEqual({ topic: ACCESS_UPGRADE_TOPIC, severity: 'warning', audience: [OPERATOR, 'usr_u1_admin'], organizationId: DEFAULT_ORG });
    expect(input.payload.findings.reEnablements).toEqual([{
      type: 'permission', name: 'u1_sales_rep', packageId: VENDOR,
      candidates: [{ name: 'u1_sales_representative', positions: ['u1_sales_lead'] }],
    }]);
    expect(logger.error.mock.calls.some(([m]: any[]) => String(m).includes('no longer shipped under that name'))).toBe(true);
  });

  for (const posture of ['isolated', 'group'] as const) {
    it(`${posture}: the same finding is raised to the operator alone, in the log — no emit, no organization told`, async () => {
      const { emit, logger } = await boot(posture, true);
      expect(emit).not.toHaveBeenCalled();
      const lines = logger.error.mock.calls.map(([m, , meta]: any[]) => ({ m: String(m), meta }));
      expect(lines.some((l: any) => l.m.includes('no longer shipped under that name'))).toBe(true);
      const operator = lines.find((l: any) => l.m.startsWith('[security] platform operator:'));
      expect(operator?.meta?.operators).toEqual([OPERATOR]);
      expect(lines.some((l: any) => l.m.includes('reached no administrator'))).toBe(false);
    });
  }

  for (const posture of ['isolated', 'group'] as const) {
    it(`${posture} with OS_PLATFORM_OWNER_ORGANIZATION: one notification in the operator's organization, to the operator, beside the operator line`, async () => {
      const first = await boot(posture, true, 'u1-platform-ops');
      expect(first.emit).toHaveBeenCalledTimes(1);
      const input = (first.emit.mock.calls[0] as any[])[0];
      expect({ topic: input.topic, severity: input.severity, audience: input.audience, organizationId: input.organizationId })
        .toEqual({ topic: ACCESS_UPGRADE_TOPIC, severity: 'warning', audience: [OPERATOR], organizationId: OWNER_ORG });
      expect(input.payload.findings.reEnablements[0].name).toBe('u1_sales_rep');
      const lines = first.logger.error.mock.calls.map(([m, , meta]: any[]) => ({ m: String(m), meta }));
      const operator = lines.find((l: any) => l.m.startsWith('[security] platform operator:'));
      expect(operator?.m).toContain('A copy is raised in-app in the organization OS_PLATFORM_OWNER_ORGANIZATION names');
      expect(operator?.meta).toMatchObject({ operators: [OPERATOR], organizationId: OWNER_ORG });
      // The dedicated organization holds the operator only: no visibility warning.
      expect(first.logger.warn.mock.calls.some(([m]: any[]) => String(m).includes('OS_PLATFORM_OWNER_ORGANIZATION names'))).toBe(false);

      // The next boot, same finding set: the same dedupKey, the ingress's idempotency key.
      const second = await boot(posture, true, 'u1-platform-ops');
      expect((second.emit.mock.calls[0] as any[])[0].dedupKey).toBe(input.dedupKey);
    });
  }

  it('isolated with an unknown OS_PLATFORM_OWNER_ORGANIZATION: nothing is raised in-app, and the error names the value', async () => {
    const { emit, logger } = await boot('isolated', true, 'u1-platform-opz');
    expect(emit).not.toHaveBeenCalled();
    const lines = logger.error.mock.calls.map(([m]: any[]) => String(m));
    expect(lines.some((m: string) => m.includes('"u1-platform-opz" names no organization by id or by slug'))).toBe(true);
    expect(lines.find((m: string) => m.startsWith('[security] platform operator:'))).toContain('no organization is told');
  });

  for (const posture of ['single', 'isolated'] as const) {
    it(`${posture} CONTROL: the switched-off name still ships — nobody is told`, async () => {
      const { emit, logger } = await boot(posture, false);
      expect(emit).not.toHaveBeenCalled();
      expect(logger.info.mock.calls.some(([m]: any[]) => String(m).includes('access upgrade report: every activation ledger row'))).toBe(true);
    });
  }
});
