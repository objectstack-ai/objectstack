// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7] The compliance ledger's organization read scope — measured
 * through a real `ObjectQL` over a real SQL driver, with the real
 * `SecurityPlugin` middleware and the real shipped permission sets in front.
 *
 * `sys_audit_log` carries no organization column (`systemFields: { tenant:
 * false }`), so the tenant wall (Layer 0) is inert on it. The organization a
 * row is about is the attribution field `tenant_id`; the shipped sets scope an
 * organization reader on it with the platform row policy `sys_audit_log_org`,
 * and `organization_admin` names the ledger without the superuser bits.
 *
 * ## The ledger stand-in
 *
 * This package does not depend on `@objectstack/plugin-audit`, so the object
 * here is a stand-in carrying the three declarations that decide the read
 * scope: the name, `systemFields: { tenant: false }`, and `tenant_id` as a
 * lookup to the organization object. The shipped declaration is pinned to
 * those three in plugin-audit's `sys-audit-log-attribution.test.ts`.
 *
 * Rows: one about each of two organizations, and one about a deployment-level
 * action (no `tenant_id`), all written as the platform writes them: as the
 * system.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { isPlatformTenantPolicy } from './platform-tenant-policies.js';

const LEDGER = 'sys_audit_log';
const POLICY = 'sys_audit_log_org';
const SYS = { context: { isSystem: true } } as never;

const ORG_ADMIN_A = {
  userId: 'usr_oadmin_a', tenantId: 'org_a', positions: ['org_admin'],
  permissions: ['organization_admin'], posture: 'TENANT_ADMIN',
};
/** The wall-less variant `auto-org-admin-grant` hands an organization's admin under `single`. */
const ORG_ADMIN_A_NO_BYPASS = { ...ORG_ADMIN_A, permissions: ['organization_admin_no_bypass'] };
const PLATFORM_ADMIN = {
  userId: 'usr_padmin', tenantId: 'org_a', positions: ['platform_admin'],
  permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN',
};
const VIEWER_A = {
  userId: 'usr_viewer_a', tenantId: 'org_a', positions: ['org_member'],
  permissions: ['viewer_readonly'], posture: 'MEMBER',
};

/** The ledger as the registry registers it after this change: no organization column. */
const LEDGER_NOW = {
  name: LEDGER,
  label: 'Audit Log',
  managedBy: 'append-only',
  systemFields: { tenant: false },
  fields: {
    action: { name: 'action', type: 'text' },
    object_name: { name: 'object_name', type: 'text' },
    tenant_id: { name: 'tenant_id', type: 'lookup', reference: 'sys_organization' },
  },
};
/** CONTROL: the ledger as it was registered before — the injected organization column, walled. */
const LEDGER_BEFORE = { ...LEDGER_NOW, systemFields: undefined };

/** Every shipped set with the ledger policy removed — the read scope without it. */
const withoutPolicy = (): PermissionSet[] =>
  defaultPermissionSets.map((ps) => ({
    ...ps,
    rowLevelSecurity: (ps.rowLevelSecurity ?? []).filter((p) => p.name !== POLICY),
  }));
/** Every shipped set with `organization_admin`'s explicit ledger entry removed — its wildcard resolves. */
const withoutExplicitEntry = (): PermissionSet[] =>
  defaultPermissionSets.map((ps) => {
    if (!ps.objects?.[LEDGER]) return ps;
    const { [LEDGER]: _entry, ...objects } = ps.objects;
    return { ...ps, objects };
  });
/** The sets as they shipped before: neither the policy nor the explicit entry. */
const asBefore = (): PermissionSet[] => {
  const entryless = new Map(withoutExplicitEntry().map((ps) => [ps.name, ps]));
  return withoutPolicy().map((ps) => ({ ...ps, objects: entryless.get(ps.name)?.objects ?? ps.objects }));
};

type Posture = 'isolated' | 'single';
const engines: ObjectQL[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) {
    try { await engine.destroy(); } catch { /* noop */ }
  }
});

async function boot(opts: { posture: Posture; sets?: PermissionSet[]; ledger?: Record<string, unknown> }) {
  // `single` is the one-organization topology (a second organization is the
  // ambiguous shape the boot refuses), so its fixture holds one.
  const single = opts.posture === 'single';
  const sets = opts.sets ?? defaultPermissionSets;
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.sys-audit-log-row-scope',
    name: 'Compliance ledger row scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      { name: 'sys_organization', label: 'Organization', fields: { name: { name: 'name', type: 'text' } } },
      opts.ledger ?? LEDGER_NOW,
    ],
  } as never);
  await engine.syncSchemas();
  await engine.insert('sys_organization', [{ id: 'org_a', name: 'A' }, ...(single ? [] : [{ id: 'org_b', name: 'B' }])], SYS);
  const before = opts.ledger === LEDGER_BEFORE;
  await engine.insert(LEDGER, [
    { id: 'a1', action: 'update', tenant_id: 'org_a', ...(before ? { organization_id: 'org_a' } : {}) },
    ...(single ? [] : [{ id: 'b1', action: 'update', tenant_id: 'org_b', ...(before ? { organization_id: 'org_b' } : {}) }]),
    { id: 'd1', action: 'platform_admin_standing_change', tenant_id: null },
  ], SYS);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    tenancy: { posture: opts.posture },
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => sets,
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default', defaultPermissionSets: sets });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);

  return {
    engine,
    /** The ledger row ids `caller` is served, sorted. */
    read: async (caller: Record<string, unknown>): Promise<string[]> => {
      const rows = (await engine.find(LEDGER, { context: { ...caller } } as never)) as Array<{ id: string }>;
      return rows.map((r) => r.id).sort();
    },
  };
}

describe('[ADR-0131 D7] sys_audit_log: the organization scope rides tenant_id, under an organization wall', () => {
  it('premise: the registered ledger has no organization column, and tenant_id is a plain field', async () => {
    const { engine } = await boot({ posture: 'isolated' });
    const fields = Object.keys((engine.getSchema(LEDGER) as { fields?: object })?.fields ?? {});
    expect(fields).toContain('tenant_id');
    expect(fields).not.toContain('organization_id');
  });

  it('an organization admin reads the rows about its own organization, and not the other organization\'s or the deployment-level row', async () => {
    const r = await boot({ posture: 'isolated' });
    expect(await r.read(ORG_ADMIN_A)).toEqual(['a1']);
  });

  it('CONTROL: the same read with the policy removed from every set serves every row', async () => {
    const r = await boot({ posture: 'isolated', sets: withoutPolicy() });
    expect(await r.read(ORG_ADMIN_A)).toEqual(['a1', 'b1', 'd1']);
  });

  it('the explicit organization_admin entry is load-bearing: without it the wildcard superuser bypass skips the policy', async () => {
    const r = await boot({ posture: 'isolated', sets: withoutExplicitEntry() });
    expect(await r.read(ORG_ADMIN_A)).toEqual(['a1', 'b1', 'd1']);
  });

  it('a viewer, whose wildcard read reaches the ledger, is scoped the same way', async () => {
    const r = await boot({ posture: 'isolated' });
    expect(await r.read(VIEWER_A)).toEqual(['a1']);
  });

  it('a global settings change is not served to an organization admin; a tenant-scope change is', async () => {
    // The two `config_change` shapes the settings writer produces since
    // ADR-0131 D7: a GLOBAL-scope change is about no organization, so it
    // carries no `tenant_id` whatever organization the writer had active; a
    // tenant-scope change carries the writer's organization.
    const r = await boot({ posture: 'isolated' });
    await r.engine.insert(LEDGER, [
      { id: 'g1', action: 'config_change', object_name: 'sys_platform_setting', tenant_id: null },
      { id: 't1', action: 'config_change', object_name: 'sys_setting', tenant_id: 'org_a' },
    ], SYS);
    const settingsRows = (ids: string[]) => ids.filter((id) => id === 'g1' || id === 't1');
    expect(settingsRows(await r.read(ORG_ADMIN_A))).toEqual(['t1']);
    expect(settingsRows(await r.read(PLATFORM_ADMIN))).toEqual(['g1', 't1']);
  });

  it('a platform admin reads every row, the deployment-level row included', async () => {
    const r = await boot({ posture: 'isolated' });
    expect(await r.read(PLATFORM_ADMIN)).toEqual(['a1', 'b1', 'd1']);
  });

  it('CONTROL: before the change the wall hid the deployment-level row from the platform admin too', async () => {
    const r = await boot({ posture: 'isolated', sets: asBefore(), ledger: LEDGER_BEFORE });
    expect(await r.read(PLATFORM_ADMIN)).toEqual(['a1']);
    expect(await r.read(ORG_ADMIN_A)).toEqual(['a1']);
  });
});

describe('[ADR-0131 D7 / ADR-0105 D3] under `single` the policy is stripped and the admin reads as before', () => {
  it('the policy is a platform tenant policy by provenance, so collection strips it when no wall is enforced', () => {
    const shipped = defaultPermissionSets.flatMap((ps) => ps.rowLevelSecurity ?? []).filter((p) => p.name === POLICY);
    expect(shipped.length).toBeGreaterThan(0);
    for (const policy of shipped) expect(isPlatformTenantPolicy(policy)).toBe(true);
  });

  it('both organization-admin variants read every row, exactly what the same read served before the change', async () => {
    const now = await boot({ posture: 'single' });
    const before = await boot({ posture: 'single', sets: asBefore(), ledger: LEDGER_BEFORE });
    const expected = await before.read(ORG_ADMIN_A_NO_BYPASS);
    expect(expected).toEqual(['a1', 'd1']);
    expect(await now.read(ORG_ADMIN_A_NO_BYPASS)).toEqual(expected);
    expect(await now.read(ORG_ADMIN_A)).toEqual(expected);
  });
});
