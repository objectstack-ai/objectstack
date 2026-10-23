// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24447] The upgrade impact report as `SecurityPlugin` wires it: a REAL
 * `ObjectQL` engine over the SQL driver, two code packages registered through
 * the engine's own manifest path (so every artifact carries the stamps a boot
 * gives it), the real plugin started on it, and the `kernel:bootstrapped`
 * handler the plugin registered fired by the test. The ledger rows, the stored
 * metadata rows, the webhook row and the setting row are real rows; the
 * registry is the engine's; `messaging` and `settings` are the services the
 * plugin looks up by name.
 *
 * Pins the acceptance end to end, every class at once: the vendor package
 * after its upgrade (a flow renamed, a dashboard renamed, an action added to a
 * second object, a webhook and an object declared under names the customer
 * holds, a field an extension already declares, a navigation group dropped, a
 * settings key renamed) reaches the administrator under `single` and the
 * operator alone under a wall; the same customer state before the upgrade
 * (CONTROL) raises nothing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject,
} from '@objectstack/metadata-core';
import { createLogger, resetPlatformAdminEmailMemo } from '@objectstack/core';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { SysMetadataActivation, SysPlatformSetting, SysSetting } from '@objectstack/platform-objects/system';

import { SecurityPlugin } from './security-plugin.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { UPGRADE_IMPACT_TOPIC } from './upgrade-impact-report.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const OPERATOR = 'operator@u3.example';
const VENDOR = 'com.acme.u3';
const ADDON = 'com.acme.u3addon';
const CUSTOMER = 'app.u3_customer';
const DEFAULT_ORG = 'org_u3_default';

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

/** A minimal `sys_webhook`: plugin-webhooks is not a dependency of this package, and the report reads two columns. */
const SysWebhookStub = { name: 'sys_webhook', label: 'Webhook', fields: { name: { type: 'text', label: 'Name' } } };

const text = (label: string) => ({ type: 'text', label });
const action = (name: string) => ({ name, label: name, type: 'script', target: 'noop' });

/** The vendor package, before or after its upgrade. */
function vendorManifest(upgraded: boolean) {
  return {
    id: VENDOR, name: 'u3_vendor', version: upgraded ? '2.0.0' : '1.0.0', type: 'app', scope: 'system',
    objects: [
      { name: 'u3_account', label: 'Account', fields: { title: text('Title'), ...(upgraded ? { rating: text('Rating') } : {}) } },
      { name: 'u3_lead', label: 'Lead', fields: { title: text('Title') }, actions: [action('u3_convert')] },
      { name: 'u3_contact', label: 'Contact', fields: { title: text('Title') }, actions: upgraded ? [action('u3_convert')] : [] },
      ...(upgraded ? [{ name: 'u3_invoice', label: 'Invoice', fields: { title: text('Title') } }] : []),
    ],
    flows: [
      { name: upgraded ? 'u3_lead_routing' : 'u3_lead_router', label: 'Route', type: 'autolaunched', nodes: [], edges: [] },
      { name: 'u3_nightly', label: 'Nightly', type: 'autolaunched', nodes: [], edges: [] },
    ],
    dashboards: [{ name: upgraded ? 'u3_pipeline_v2' : 'u3_pipeline', label: 'Pipeline', widgets: [] }],
    webhooks: upgraded ? [{ name: 'u3_deal_won', object: 'u3_lead', url: 'https://hooks.u3.example/won', triggers: ['create'] }] : [],
    apps: [{
      name: 'u3_crm', label: 'CRM',
      navigation: upgraded ? [] : [{ id: 'u3_tools', type: 'group', label: 'Tools', children: [] }],
    }],
  };
}

/** The add-on: an extension of the vendor's account, and a navigation contribution into its app. */
const ADDON_MANIFEST = {
  id: ADDON, name: 'u3_addon', version: '1.0.0', type: 'app', scope: 'system',
  objectExtensions: [{ extend: 'u3_account', fields: { rating: text('Addon rating') } }],
  navigationContributions: [{ app: 'u3_crm', group: 'u3_tools', items: [{ id: 'u3_addon_quotes', type: 'url', label: 'Quotes', url: '/quotes' }] }],
};

async function boot(posture: 'single' | 'isolated', upgraded: boolean) {
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
    id: 'com.objectstack.qa.upgrade-impact-report', name: 'Upgrade impact report', version: '1.0.0',
    type: 'plugin', scope: 'system',
    objects: [
      SysOrganization, SysUser, SysMember, SysUserPermissionSet, SysMetadataActivation, SysSetting, SysPlatformSetting,
      SysMetadataObject, SysMetadataHistoryObject, SysMetadataCommitObject, SysMetadataAuditObject, SysWebhookStub,
    ],
  } as any);
  engine.registerApp(vendorManifest(upgraded) as any);
  engine.registerApp(ADDON_MANIFEST as any);
  await engine.syncSchemas();
  engines.push(engine);

  const metadata = { get: async () => null, list: async () => [] };
  const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map(), undefined);
  const emit = vi.fn(async () => ({ notificationId: 'n1' }));
  // The settings registry after (or before) the upgrade renamed `sender_address`.
  const settings = {
    listManifests: () => [{ namespace: 'mail', specifiers: [{ key: upgraded ? 'from_address' : 'sender_address', type: 'text' }] }],
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    protocol,
    messaging: { emit },
    settings,
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

  // The customer's state, written before the upgrade and the same in both runs.
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default', slug: 'default' }, { context: SYS } as any);
  await engine.insert('sys_user_permission_set', {
    id: 'g_u3_admin', user_id: 'usr_u3_admin', permission_set: 'admin_full_access', organization_id: DEFAULT_ORG,
  }, { context: { isSystem: true, tenantId: DEFAULT_ORG } } as any);
  for (const row of [
    { id: 'act_u3_flow', metadata_type: 'flow', name: 'u3_lead_router', package_id: VENDOR, active: false },
    { id: 'act_u3_action', metadata_type: 'action', name: 'u3_convert', package_id: VENDOR, active: false },
  ]) await engine.insert('sys_metadata_activation', row, { context: SYS } as any);
  for (const row of [
    { id: 'md_u3_dashboard', type: 'dashboard', name: 'u3_pipeline', package_id: VENDOR, metadata: '{}' },
    { id: 'md_u3_flow', type: 'flow', name: 'u3_lead_routing', package_id: null, metadata: '{}' },
    { id: 'md_u3_object', type: 'object', name: 'u3_invoice', package_id: CUSTOMER, metadata: '{}' },
  ]) await engine.insert('sys_metadata', { ...row, state: 'active', scope: 'platform' }, { context: SYS } as any);
  await engine.insert('sys_webhook', { id: 'wh_u3', name: 'u3_deal_won' }, { context: { isSystem: true, tenantId: DEFAULT_ORG } } as any);
  await engine.insert('sys_setting', {
    id: 'set_u3', namespace: 'mail', key: 'sender_address', scope: 'tenant', organization_id: DEFAULT_ORG, value: '"ops@u3.example"',
  }, { context: { isSystem: true, tenantId: DEFAULT_ORG } } as any);

  for (const handler of hooks.get('kernel:bootstrapped') ?? []) await handler();
  const upgradeInput = (emit.mock.calls as any[]).map(([input]) => input).find((input) => input.topic === UPGRADE_IMPACT_TOPIC);
  return { emit, logger, upgradeInput };
}

const lines = (logger: { error: { mock: { calls: any[] } } }) => logger.error.mock.calls.map(([m]: any[]) => String(m));

/** The error lines replayed through the core logger, as a deployment writes them — redaction included. */
function written(logger: { error: { mock: { calls: any[] } } }): string[] {
  const out: string[] = [];
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => (out.push(String(chunk)), true));
  try {
    const core = createLogger({ format: 'json' });
    for (const [message, error, meta] of logger.error.mock.calls) core.error(message, error, meta);
  } finally {
    stderr.mockRestore();
  }
  return out;
}

describe('[#24447] the upgrade impact report, wired at kernel:bootstrapped', () => {
  it('single: the upgrade\'s every non-access impact reaches the administrator, under its own topic', async () => {
    const { upgradeInput, logger } = await boot('single', true);
    expect(upgradeInput).toBeDefined();
    expect({ severity: upgradeInput.severity, audience: upgradeInput.audience, organizationId: upgradeInput.organizationId })
      .toEqual({ severity: 'warning', audience: [OPERATOR, 'usr_u3_admin'], organizationId: DEFAULT_ORG });
    const findings = upgradeInput.payload.findings;
    expect(findings.reEnablements).toEqual([
      { type: 'flow', name: 'u3_lead_router', packageId: VENDOR, candidates: ['u3_lead_routing', 'u3_nightly'] },
    ]);
    expect(findings.sharedActionSwitches).toEqual([{ name: 'u3_convert', packageId: VENDOR, objects: ['u3_contact', 'u3_lead'] }]);
    expect(findings.shadowedFlows).toEqual([{ name: 'u3_lead_routing', rowId: 'md_u3_flow', rowPackageId: null, packageId: VENDOR }]);
    expect(findings.withheldWebhooks).toEqual([{ name: 'u3_deal_won', packageId: VENDOR, rowId: 'wh_u3', organizationId: DEFAULT_ORG }]);
    expect(findings.overlayOrphans).toEqual([{ type: 'dashboard', name: 'u3_pipeline', rowId: 'md_u3_dashboard', packageId: VENDOR }]);
    expect(findings.fieldCollisions).toEqual([{
      object: 'u3_account', field: 'rating', declaredBy: [{ packageId: VENDOR, layer: 'own' }, { packageId: ADDON, layer: 'extend' }],
    }]);
    expect(findings.refusedObjectRows).toEqual([{ name: 'u3_invoice', rowId: 'md_u3_object', packageId: CUSTOMER, ownerPackageId: VENDOR }]);
    expect(findings.relocatedNavContributions).toEqual([{ app: 'u3_crm', group: 'u3_tools', packageId: ADDON, relocated: ['u3_addon_quotes'] }]);
    expect(findings.settingOrphans).toEqual([{ store: 'sys_setting', namespace: 'mail', name: 'sender_address', rows: 1, organizations: [DEFAULT_ORG] }]);
    expect(JSON.stringify(upgradeInput)).not.toContain('ops@u3.example');
    expect(lines(logger).filter((m) => m.startsWith('[security] upgrade impact:'))).toHaveLength(9);
  });

  it('the logged findings keep every value through the core logger\'s redaction — a setting key is named, not hidden', async () => {
    const { logger } = await boot('single', true);
    const out = written(logger).filter((l) => l.includes('[security] upgrade impact:'));
    expect(out).toHaveLength(9);
    expect(out.filter((l) => l.includes('***REDACTED***'))).toEqual([]);
    expect(out.find((l) => l.includes('stored setting key(s)'))).toContain('"name":"sender_address"');
  });

  it('isolated: the same findings are raised to the operator alone, in the log — no upgrade impact notification', async () => {
    const { upgradeInput, logger } = await boot('isolated', true);
    expect(upgradeInput).toBeUndefined();
    const operator = logger.error.mock.calls.find(([m]: any[]) => String(m).includes('the upgrade impact findings above are deployment-level'));
    expect(operator?.[2]?.operators).toEqual([OPERATOR]);
    expect(lines(logger).filter((m) => m.startsWith('[security] upgrade impact:'))).toHaveLength(9);
  });

  for (const posture of ['single', 'isolated'] as const) {
    it(`${posture} CONTROL: the same customer state before the upgrade — nothing raised, one clean line`, async () => {
      const { upgradeInput, logger } = await boot(posture, false);
      expect(upgradeInput).toBeUndefined();
      expect(lines(logger).filter((m) => m.includes('upgrade impact'))).toEqual([]);
      expect(logger.info.mock.calls.some(([m]: any[]) => String(m).includes('[security] upgrade impact report: every flow'))).toBe(true);
    });
  }
});
