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
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject,
} from '@objectstack/metadata-core';
import { resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysOrganization } from '@objectstack/platform-objects/identity';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { ACCESS_UPGRADE_TOPIC } from './access-upgrade-report.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const OPERATOR = 'operator@u1.example';
const VENDOR = 'com.acme.u1';
const DEFAULT_ORG = 'org_u1_default';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env[POSTURE_ENV];
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: 'single' | 'isolated' | 'group', renamed: boolean) {
  const walled = posture !== 'single';
  if (walled) process.env[POSTURE_ENV] = posture;
  process.env[OWNER_ENV] = OPERATOR;
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
      SysOrganization, SysUserPermissionSet, SysMetadataActivation,
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

  for (const posture of ['single', 'isolated'] as const) {
    it(`${posture} CONTROL: the switched-off name still ships — nobody is told`, async () => {
      const { emit, logger } = await boot(posture, false);
      expect(emit).not.toHaveBeenCalled();
      expect(logger.info.mock.calls.some(([m]: any[]) => String(m).includes('access upgrade report: every activation ledger row'))).toBe(true);
    });
  }
});
