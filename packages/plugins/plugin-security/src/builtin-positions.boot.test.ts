// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D2, C2 stages S2 and S2b, C3 stage 6a] The six built-in positions
 * as declared metadata, read off a REAL boot of this plugin: what the catalog
 * read lists, what the boot writes into `sys_position`, what every principal
 * is granted, and which position writes are still refused.
 *
 * The six are one declaration list, registered with the engine registry, and
 * `everyone`'s baseline is that anchor's declared `permissionSets`. Since
 * stage 6a no boot step writes a `sys_position` row: the built-in seeder, the
 * declared-positions seeder and the baseline junction writer are retired. So
 * this boot is the plugin's own — `init`, `start`, then its `kernel:ready`
 * handlers in registration order — over a real `ObjectQL` engine on SQLite,
 * with a stack-declared position in the metadata service beside the six.
 *
 * ## The scenarios
 *
 * Three postures:
 *
 *  - `single` — the organization-less pass, no organization at boot;
 *  - `single + organization` — the same pass with an organization and its
 *    memberships present (the shape a `single` deployment with the Default
 *    Organization has);
 *  - `walled` — one pass per organization at boot, then one more organization
 *    created after it (the organization-creation path);
 *
 * each booted four ways:
 *
 *  - as it is (a fresh database);
 *  - with `a door-authored position in the registry` — one position registered
 *    the way a metadata author's saved definition is hydrated (no package);
 *  - with `a stored definition under a built-in name` — `org_admin` and
 *    `everyone` saved the same way before the six were declared, so each
 *    shadows its declaration at read (the registry's bare slot answers first);
 *  - as `an existing database` — holding the rows the retired seeders wrote on
 *    an earlier boot ({@link LEGACY_ROWS}).
 *
 * ## The goldens
 *
 * The census and the write ledger: no boot writes a `sys_position` row in any
 * scenario, and an existing database keeps exactly the rows it had. The census
 * instrument is proven able to see a row by a positive control (one
 * organization-authored create, read back as exactly one row).
 *
 * The grant envelopes were recorded from the tree BEFORE the declarations
 * existed (objectstack `51290bca2c`; S2's PR record carries the run), with the
 * one recorded move stage 1 made ({@link GRANT_GOLDEN}). Stage 6a moves none:
 * a fresh database and an existing one grant every principal the same.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  assembleExecutionContext,
  createSecurityCatalogReader,
  resetPlatformAdminEmailMemo,
  resolveUserAuthzGrants,
} from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import { SysUser, SysAccount, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';

import { SecurityPlugin } from './security-plugin.js';
import { reconcileOrgAdminGrant } from './auto-org-admin-grant.js';
import { securityObjects, SECURITY_PLUGIN_ID } from './manifest.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { isSystem: true } as const;
const POSTURE_ENV = 'OS_TENANCY_POSTURE';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const ORG = 'org_eq';
const LATE_ORG = 'org_late';
const BUILTIN_NAMES = ['everyone', 'guest', 'org_admin', 'org_member', 'org_owner', 'platform_admin'];

/** The non-system administrator whose writes are the data door's (superuser wildcard). */
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

/** A stack-declared position, as an app registers it with the metadata service. */
const DECLARED_POSITIONS = [{ name: 'field_rep', label: 'Field Rep', description: 'Works the territory' }];

/**
 * The app's own default set — the deployment's declared baseline, bound to
 * `everyone` by the boot. Owned by a package, so the walled boot materializes
 * the organization's copy of it and binds THAT, the way an installed app's
 * default set reaches every organization's `everyone`.
 */
const APP_DEFAULT = {
  name: 'field_default',
  label: 'Field Default',
  isDefault: true,
  objects: { sys_user: { allowRead: true } },
  _packageId: 'com.example.field',
} as unknown as PermissionSet;

type PostureName = 'single' | 'single + organization' | 'walled';
const DOOR = 'a door-authored position in the registry';
const SHADOW = 'a stored definition under a built-in name';
const EXISTING = 'an existing database';
type ScenarioName =
  | PostureName
  | `${PostureName}, ${typeof DOOR}`
  | `${PostureName}, ${typeof SHADOW}`
  | `${PostureName}, ${typeof EXISTING}`;
interface Scenario {
  readonly posture: 'single' | 'isolated';
  /** Organizations (with the memberships) present before `kernel:ready`. */
  readonly organizationAtBoot: boolean;
  /** One more organization, created after the boot. */
  readonly lateOrganization: boolean;
  /** A package-less position in the registry before the boot (a hydrated door-authored definition). */
  readonly authoredPosition: boolean;
  /** Package-less definitions under built-in names in the registry before the boot ({@link SHADOWING_DEFINITIONS}). */
  readonly shadowedBuiltins: boolean;
  /** The rows the retired seeders wrote on an earlier boot, present before this one ({@link LEGACY_ROWS}). */
  readonly existingRows: boolean;
}
type Variant = 'authoredPosition' | 'shadowedBuiltins' | 'existingRows';
const POSTURES: Record<PostureName, Omit<Scenario, Variant>> = {
  single: { posture: 'single', organizationAtBoot: false, lateOrganization: false },
  'single + organization': { posture: 'single', organizationAtBoot: true, lateOrganization: false },
  walled: { posture: 'isolated', organizationAtBoot: true, lateOrganization: true },
};
const SCENARIOS = Object.fromEntries(
  (Object.keys(POSTURES) as PostureName[]).flatMap((name) => [
    [name, { ...POSTURES[name], authoredPosition: false, shadowedBuiltins: false, existingRows: false }],
    [`${name}, ${DOOR}`, { ...POSTURES[name], authoredPosition: true, shadowedBuiltins: false, existingRows: false }],
    [`${name}, ${SHADOW}`, { ...POSTURES[name], authoredPosition: false, shadowedBuiltins: true, existingRows: false }],
    [`${name}, ${EXISTING}`, { ...POSTURES[name], authoredPosition: false, shadowedBuiltins: false, existingRows: true }],
  ]),
) as Record<ScenarioName, Scenario>;

/**
 * Environment-wide definitions a metadata author saved under two built-in
 * names before the six were declared — one identity name, one audience
 * anchor — stated tenant-authored, as the door's hydration states every stored
 * body. In the registry's bare slot they shadow the declarations at read.
 */
const SHADOWING_DEFINITIONS = [
  { name: 'org_admin', label: 'Repurposed Org Admin', description: 'Saved at the door', _provenance: 'org' },
  { name: 'everyone', label: 'Repurposed Everyone', description: 'Saved at the door', _provenance: 'org' },
];

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortDeep((value as any)[k])]));
  }
  return value;
};

/** One refused or admitted write, read off its ADR-0112 envelope. */
interface WriteOutcome {
  ok: boolean;
  code?: string;
  status?: number;
  fields?: string[];
}
const outcome = async (write: Promise<unknown>): Promise<WriteOutcome> => {
  try {
    await write;
    return { ok: true };
  } catch (e: any) {
    const fields = Array.isArray(e?.fields) ? e.fields.map((f: any) => `${f?.field}:${f?.code}`) : undefined;
    const status = e?.status ?? e?.statusCode;
    return { ok: false, code: e?.code, ...(typeof status === 'number' ? { status } : {}), ...(fields ? { fields } : {}) };
  }
};

interface Booted {
  engine: ObjectQL;
  metadata: { get(type: string, name: string): unknown; list(type: string): unknown };
  /** Every `sys_position` write the boot made, in order: op, name, organization, provenance written. */
  ledger: string[];
  /** The rows the boot left, one string per row. */
  census: string[];
}

/** Every `sys_position` row, one string per row, past every scope. */
async function positionCensus(engine: ObjectQL): Promise<string[]> {
  const rows = (await engine.find('sys_position', { where: {}, limit: 5000, context: SYS })) as any[];
  return rows
    .map((r) => [r.name, r.organization_id ?? '-', r.managed_by, r.active, r.is_default, r.label, r.description ?? '-'].join(' | '))
    .sort();
}

async function boot(scenario: Scenario): Promise<Booted> {
  delete process.env[POSTURE_ENV];
  delete process.env[OWNER_ENV];
  if (scenario.posture === 'isolated') {
    process.env[POSTURE_ENV] = 'isolated';
    process.env[OWNER_ENV] = 'admin@eq.example';
  }
  resetPlatformAdminEmailMemo();

  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.builtin-position-boot',
    name: 'Built-in position boot',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUser, SysAccount, SysMember, SysOrganization, ...securityObjects],
  } as any);
  await engine.syncSchemas();
  if (scenario.authoredPosition) {
    // How a metadata author's saved definition is hydrated: no package.
    (engine as any).registry.registerItem('position', { name: 'door_authored', label: 'Door Authored' }, 'name');
  }
  if (scenario.shadowedBuiltins) {
    for (const definition of SHADOWING_DEFINITIONS) {
      (engine as any).registry.registerItem('position', { ...definition }, 'name');
    }
  }

  // The write ledger: every `sys_position` insert and update, refused ones
  // included, named by the row they write.
  const ledger: string[] = [];
  const idToName = new Map<string, string>();
  let recording = true;
  const org = (opts: any) => opts?.context?.tenantId ?? '-';
  const provenance = (row: any) => (row && 'managed_by' in row ? ` managed_by=${row.managed_by}` : '');
  const insert = engine.insert.bind(engine);
  const update = engine.update.bind(engine);
  (engine as any).insert = async (object: string, data: any, opts?: any) => {
    if (!recording || object !== 'sys_position') return insert(object, data, opts);
    const rows = (Array.isArray(data) ? data : [data]) as any[];
    const note = (op: string) => {
      for (const row of rows) {
        if (row?.id) idToName.set(String(row.id), String(row.name));
        ledger.push(`${op} ${row?.name}@${org(opts)}${provenance(row)}`);
      }
    };
    try {
      const result = await insert(object, data, opts);
      note('insert');
      return result;
    } catch (e) {
      note('insert REFUSED');
      throw e;
    }
  };
  (engine as any).update = async (object: string, data: any, opts?: any) => {
    if (!recording || object !== 'sys_position') return update(object, data, opts);
    const name = idToName.get(String(data?.id)) ?? `id:${String(data?.id)}`;
    ledger.push(`update ${name}@${org(opts)} ${Object.keys(data ?? {}).filter((k) => k !== 'id').sort().join(',')}${provenance(data)}`);
    return update(object, data, opts);
  };

  const metadata = {
    get: async (type: string, name: string) =>
      type === 'position' || type === 'permission'
        ? ((await metadata.list(type)) as Array<{ name?: string }>).find((d) => d.name === name) ?? null
        : engine.getSchema(name) ?? null,
    list: async (type: string) => {
      if (type === 'position') return DECLARED_POSITIONS.map((p) => ({ ...p }));
      if (type === 'permission') return [...defaultPermissionSets, QA_ADMIN, APP_DEFAULT];
      return [];
    },
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    ...(scenario.posture === 'isolated'
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture: 'isolated' } }
      : {}),
  };
  const hooks = new Map<string, Array<(...args: unknown[]) => unknown>>();
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: (name: string, handler: (...args: unknown[]) => unknown) => {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'field_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  // Everything the boot sweep reads exists BEFORE `kernel:ready`: the
  // organization (the walled sweep seeds one catalog per organization) and
  // the users (the `single` sweep promotes the first authenticable one).
  const user = async (id: string, email: string, createdAt: string) => {
    await engine.insert('sys_user', { id, email, name: id, created_at: createdAt, email_verified: true }, { context: SYS } as any);
    await engine.insert(
      'sys_account', { id: `acc_${id}`, user_id: id, account_id: email, provider_id: 'credential' }, { context: SYS } as any,
    );
  };
  if (scenario.organizationAtBoot) {
    await engine.insert('sys_organization', { id: ORG, name: 'Eq Org', slug: 'eq' }, { context: SYS } as any);
  }
  await user('usr_admin', 'admin@eq.example', '2025-01-01T00:00:00.000Z');
  await user('usr_orgadmin', 'orgadmin@eq.example', '2025-02-01T00:00:00.000Z');
  await user('usr_member', 'member@eq.example', '2025-03-01T00:00:00.000Z');
  if (scenario.organizationAtBoot) {
    await engine.insert('sys_member', [
      { id: 'm_owner', user_id: 'usr_orgadmin', organization_id: ORG, role: 'owner', created_at: '2025-02-01T00:00:00.000Z' },
      { id: 'm_member', user_id: 'usr_member', organization_id: ORG, role: 'member', created_at: '2025-03-01T00:00:00.000Z' },
    ], { context: { isSystem: true, tenantId: ORG } } as any);
  }

  if (scenario.existingRows) {
    // What an earlier boot's retired seeders left: written through the
    // unwrapped engine, so the ledger records only what THIS boot writes.
    const organizationId = scenario.posture === 'isolated' ? ORG : undefined;
    const context = organizationId ? { isSystem: true, tenantId: organizationId } : SYS;
    for (const row of LEGACY_ROWS) {
      await insert('sys_position', { id: `pos_${row.name}`, ...row, active: true, is_default: false }, { context } as any);
    }
  }

  // The plugin's own boot: the bootstrap, the `everyone` baseline declaration,
  // the organization-admin backfill — in registration order, as the kernel fires them.
  for (const handler of hooks.get('kernel:ready') ?? []) await handler();
  if (scenario.lateOrganization) {
    await engine.insert('sys_organization', { id: LATE_ORG, name: 'Late Org', slug: 'late' }, { context: SYS } as any);
  }
  recording = false;

  return { engine, metadata, ledger, census: await positionCensus(engine) };
}

/** The four principals' resolved grants — needs the organization and its memberships. */
async function grantsByPrincipal(engine: ObjectQL, posture: 'single' | 'isolated'): Promise<Record<string, unknown>> {
  const orgCtx = { isSystem: true, tenantId: ORG };
  // Walled: the organization's own copies of the sets its grants point at
  // (the per-organization catalog), cloned from the platform bucket the boot
  // just wrote — as the name-column equivalence suite does.
  if (posture === 'isolated') {
    for (const name of ['organization_admin', 'organization_admin_no_bypass', 'viewer_readonly']) {
      const [bucket] = await engine.find('sys_permission_set', { where: { name }, context: SYS });
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = bucket as any;
      await engine.insert('sys_permission_set', { ...rest, id: `ps_${name}_${ORG}`, organization_id: ORG }, { context: orgCtx } as any);
    }
  }
  // `single`: the boot's organization-admin backfill already granted it, so
  // the reconcile finds nothing to do; walled: the organization's copy exists
  // only now, so the reconcile grants.
  const reconciled = await reconcileOrgAdminGrant(engine, 'usr_orgadmin', ORG, { posture });
  expect(reconciled.action).toBe(posture === 'single' ? 'noop' : 'granted');

  // The member's set, granted through the data door by an administrator.
  const [viewer] = await engine.find('sys_permission_set', {
    where: { name: 'viewer_readonly', ...(posture === 'isolated' ? { organization_id: ORG } : {}) },
    context: SYS,
  });
  await engine.insert(
    'sys_user_permission_set',
    { user_id: 'usr_member', permission_set_id: (viewer as any).id },
    { context: { userId: 'usr_orgadmin', positions: [], permissions: ['qa_admin'], tenantId: ORG } } as any,
  );

  const resolve = (userId: string) => resolveUserAuthzGrants(engine, userId, { tenantId: ORG });
  const admin = await resolve('usr_admin');
  const orgAdmin = await resolve('usr_orgadmin');
  const member = await resolve('usr_member');
  const agentCtx = assembleExecutionContext({
    authz: { ...orgAdmin, userId: 'usr_orgadmin', tenantId: ORG } as any,
    oauth: {
      userId: 'usr_orgadmin',
      scopes: ['data:read', 'actions:execute'],
      clientId: 'agent_client_eq',
      scopePermissions: ['mcp_agent_data_read'],
      delegatesActions: true,
    } as any,
    localization: undefined,
    requestLocale: undefined,
    accessToken: undefined,
    authGate: undefined,
  });
  const agent = {
    principalKind: (agentCtx as any)?.principalKind,
    positions: (agentCtx as any)?.positions,
    permissions: (agentCtx as any)?.permissions,
    systemPermissions: (agentCtx as any)?.systemPermissions,
    onBehalfOf: (agentCtx as any)?.onBehalfOf,
  };
  return sortDeep({ platformAdmin: admin, organizationAdmin: orgAdmin, member, agent }) as Record<string, unknown>;
}

/**
 * The position writes a tenant's administrator is refused, plus the controls
 * that show the refusals are not blanket: a write through the data door by the
 * organization administrator (superuser wildcard, not a system context).
 */
async function tenantPositionWrites(engine: ObjectQL, existingRows: boolean): Promise<Record<string, WriteOutcome>> {
  const tenant = { userId: 'usr_orgadmin', positions: [], permissions: ['qa_admin'], tenantId: ORG };
  const own = async (name: string) => {
    const rows = (await engine.find('sys_position', { where: { name }, limit: 5, context: { isSystem: true, tenantId: ORG } })) as any[];
    // The organization's own row when it has one (walled), else the organization-less one (`single`).
    return rows.find((r) => r.organization_id === ORG) ?? rows.find((r) => r.organization_id == null);
  };
  const everyone = await own('everyone');
  const platformAdmin = await own('platform_admin');
  return {
    'assign a position the security catalog does not hold': await outcome(engine.insert(
      'sys_user_position', { user_id: 'usr_member', position: 'zz_dangling' }, { context: tenant } as any,
    )),
    'control: create a position row': await outcome(engine.insert(
      'sys_position', { name: 'zz_tenant_post', label: 'Tenant Post' }, { context: tenant } as any,
    )),
    // [ADR-0131 D3/D4] This harness mounts no metadata door, so the row gets
    // no definition: a position only a row carries grants nothing, and an
    // assignment naming it is refused like a dangling name.
    'assign the row-only position': await outcome(engine.insert(
      'sys_user_position', { user_id: 'usr_member', position: 'zz_tenant_post' }, { context: tenant } as any,
    )),
    'control: assign a stack-declared position (no row needed)': await outcome(engine.insert(
      'sys_user_position', { user_id: 'usr_member', position: DECLARED_POSITIONS[0].name }, { context: tenant } as any,
    )),
    // Only an existing database holds a built-in row to refuse (stage 6a).
    ...(existingRows
      ? {
        'delete the everyone row': await outcome(engine.delete('sys_position', { where: { id: everyone?.id }, context: tenant } as any)),
        'relabel the platform_admin row': await outcome(engine.update(
          'sys_position', { id: platformAdmin?.id, label: 'Repurposed' }, { context: tenant } as any,
        )),
      }
      : {}),
  };
}

const booted = new Map<ScenarioName, Booted>();
afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env[POSTURE_ENV];
  delete process.env[OWNER_ENV];
  resetPlatformAdminEmailMemo();
  for (const b of booted.values()) {
    try { await b.engine.destroy(); } catch { /* noop */ }
  }
});

for (const name of Object.keys(SCENARIOS) as ScenarioName[]) {
  const scenario = SCENARIOS[name];
  describe(`[ADR-0131 D2] the built-in positions as declared metadata — ${name}`, () => {
    beforeAll(async () => {
      booted.set(name, await boot(scenario));
    }, 60_000);

    // P2.1 — the catalog read lists the six, from the registry, owned by this
    // plugin, beside the stack's own position.
    it('the security catalog read lists the six built-in positions beside the declared one', async () => {
      const { engine, metadata } = booted.get(name)!;
      const reader = createSecurityCatalogReader({ registry: engine.registry as any, metadata: metadata as any });
      const listed = (await reader.list('position')).map((e) => `${e.name}@${e.source}${e.packageId ? `:${e.packageId}` : ''}`).sort();
      const shadowed = new Set(scenario.shadowedBuiltins ? SHADOWING_DEFINITIONS.map((d) => d.name) : []);
      expect(listed).toEqual([
        ...(scenario.authoredPosition ? ['door_authored@registry'] : []),
        ...BUILTIN_NAMES.map((n) => (shadowed.has(n) ? `${n}@registry` : `${n}@registry:${SECURITY_PLUGIN_ID}`)),
        'field_rep@metadata',
      ].sort());
      // The shadowing state is real: the catalog read answers the stored body
      // for the two names, not the declaration.
      if (scenario.shadowedBuiltins) {
        for (const definition of SHADOWING_DEFINITIONS) {
          expect((await reader.resolve('position', definition.name))?.definition.label).toBe(definition.label);
        }
      }
    });

    // P2.2 — the rows, and who wrote them: none, in any pass (stage 6a). An
    // existing database keeps exactly the rows it had.
    it('writes no sys_position row, and leaves an existing database\u2019s rows as they were', async () => {
      const { engine, census, ledger } = booted.get(name)!;
      expect({ census, ledger }).toEqual({ census: scenario.existingRows ? legacyCensus(scenario) : [], ledger: [] });

      // Positive control: the census sees a row — one organization-authored
      // create reads back as exactly one more. Removed again, so the cases
      // below read the boot's state.
      const context = { isSystem: true, tenantId: ORG };
      await engine.insert('sys_position', { id: 'pos_census_control', name: 'zz_census_control', label: 'Control' }, { context } as any);
      const after = await positionCensus(engine);
      expect(after.filter((line) => !census.includes(line))).toEqual([
        `zz_census_control | ${ORG} | admin | true | false | Control | -`,
      ]);
      await engine.delete('sys_position', { where: { id: 'pos_census_control' }, context } as any);
      expect(await positionCensus(engine)).toEqual(census);
    });

    if (scenario.organizationAtBoot) {
      it('grants every principal what it was granted before the declarations', async () => {
        const { engine } = booted.get(name)!;
        expect(await grantsByPrincipal(engine, scenario.posture)).toEqual(grantGoldenFor(scenario));
      });

      it('still refuses a tenant a dangling position name, and deleting or relabelling a built-in row', async () => {
        // A fresh database holds no built-in row to delete or relabel; the two
        // refusals are read where the rows are, on an existing database.
        const { engine } = booted.get(name)!;
        expect(await tenantPositionWrites(engine, scenario.existingRows)).toEqual(refusalGoldenFor(scenario));
      });
    }
  });
}

/**
 * The tenant position writes — the same in both postures. A name the security
 * catalog does not hold, a dangling one or a row with no definition alike, is
 * the position catalog refusal's envelope (`reference_not_found` at
 * `position`); a stack-declared position is assigned with no row; the two
 * built-in rows an existing database holds are refused on their `platform`
 * provenance.
 */
const REFUSAL_GOLDEN: Record<string, WriteOutcome> = {
  'assign a position the security catalog does not hold': {
    ok: false,
    code: 'VALIDATION_FAILED',
    fields: ['position:reference_not_found'],
  },
  'control: create a position row': {
    ok: true,
  },
  'assign the row-only position': {
    ok: false,
    code: 'VALIDATION_FAILED',
    fields: ['position:reference_not_found'],
  },
  'control: assign a stack-declared position (no row needed)': {
    ok: true,
  },
  'delete the everyone row': {
    ok: false,
    code: 'PERMISSION_DENIED',
    status: 403,
  },
  'relabel the platform_admin row': {
    ok: false,
    code: 'PERMISSION_DENIED',
    status: 403,
  },
};

/** {@link REFUSAL_GOLDEN} for a scenario: the built-in row cases need an existing database's rows. */
function refusalGoldenFor(scenario: Scenario): Record<string, WriteOutcome> {
  if (scenario.existingRows) return REFUSAL_GOLDEN;
  const { 'delete the everyone row': _d, 'relabel the platform_admin row': _r, ...fresh } = REFUSAL_GOLDEN;
  return fresh;
}

/**
 * The rows the retired seeders wrote — the six built-ins (`platform`) and the
 * stack's declared `field_rep` — as an existing database holds them: one
 * organization-less set under `single`, the organization's own set under a
 * wall. The text is what those seeders stamped from the same declarations.
 */
const LEGACY_ROWS: ReadonlyArray<{ name: string; label: string; description: string; managed_by?: string }> = [
  { name: 'field_rep', label: 'Field Rep', description: 'Works the territory' },
  { name: 'platform_admin', label: 'Platform Admin', description: 'Platform operator (SaaS admin). NOT a tenant user role.', managed_by: 'platform' },
  { name: 'org_owner', label: 'Organization Owner', description: 'Organization owner within a tenant.', managed_by: 'platform' },
  { name: 'org_admin', label: 'Organization Admin', description: 'Organization administrator within a tenant.', managed_by: 'platform' },
  { name: 'org_member', label: 'Organization Member', description: 'Organization member within a tenant.', managed_by: 'platform' },
  {
    name: 'everyone',
    label: 'Everyone',
    description:
      'Built-in audience anchor: every authenticated member holds this position implicitly. Permission sets bound to it are the default grants for the tenant (ADR-0090 D5). High-privilege sets cannot be bound here.',
    managed_by: 'platform',
  },
  {
    name: 'guest',
    label: 'Guest',
    description:
      'Built-in audience anchor: unauthenticated principals hold this position implicitly and exclusively. Bindings face the strictest checks — named objects only, read-mostly, never a wildcard (ADR-0090 D9).',
    managed_by: 'platform',
  },
];

/** {@link LEGACY_ROWS} as the census spells them, for a scenario's posture. */
function legacyCensus(scenario: Scenario): string[] {
  const organization = scenario.posture === 'isolated' ? ORG : '-';
  return LEGACY_ROWS
    .map((r) => [r.name, organization, r.managed_by ?? 'admin', true, false, r.label, r.description].join(' | '))
    .sort();
}

/**
 * Recorded before the declarations (module doc). `field_default` and
 * `member_default` on every human principal are the `everyone` anchor's sets.
 * The organization administrator's set is the walled `organization_admin`
 * against the wall-less `organization_admin_no_bypass` (ADR-0105 D4).
 *
 * ⚠️ One recorded move ([ADR-0131] D3/D4, C3 stage 1): `everyone`'s sets are
 * the baseline its definition names — the same in every posture. Before, they
 * were junction rows the boot wrote per organization, and the walled
 * organization's catalog held only its own copy of the app's set, so walled
 * `everyone` never bound the organization-less `member_default`. It now
 * names it under a wall too. `member_default` carries no system or tab
 * permission, and enforcement applied it to every human as the additive
 * baseline already (ADR-0090 D5), so the walled envelope gains its name and
 * nothing it grants.
 */
const GRANT_GOLDEN: Record<'single' | 'isolated', unknown> = {
  single: {
    agent: {
      onBehalfOf: {
        principalKind: 'human',
        userId: 'usr_orgadmin',
      },
      permissions: ['mcp_agent_data_read'],
      positions: [],
      principalKind: 'agent',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    member: {
      accessible_org_ids: ['org_eq'],
      email: 'member@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'member_default', 'viewer_readonly'],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
    },
    organizationAdmin: {
      accessible_org_ids: ['org_eq'],
      email: 'orgadmin@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'member_default', 'organization_admin_no_bypass'],
      positions: ['everyone', 'org_owner'],
      posture: 'TENANT_ADMIN',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    platformAdmin: {
      accessible_org_ids: [],
      email: 'admin@eq.example',
      org_user_ids: ['usr_admin', 'usr_member', 'usr_orgadmin'],
      permissions: ['admin_full_access', 'field_default', 'member_default'],
      positions: ['everyone', 'platform_admin'],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata',
        'manage_platform_settings',
        'manage_sharing',
        'manage_users',
        'setup.access',
        'setup.write',
        'studio.access',
        'view_all_audit_log',
      ],
    },
  },
  isolated: {
    agent: {
      onBehalfOf: {
        principalKind: 'human',
        userId: 'usr_orgadmin',
      },
      permissions: ['mcp_agent_data_read'],
      positions: [],
      principalKind: 'agent',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    member: {
      accessible_org_ids: ['org_eq'],
      email: 'member@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'member_default', 'viewer_readonly'],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
    },
    organizationAdmin: {
      accessible_org_ids: ['org_eq'],
      email: 'orgadmin@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'member_default', 'organization_admin'],
      positions: ['everyone', 'org_owner'],
      posture: 'TENANT_ADMIN',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    platformAdmin: {
      accessible_org_ids: [],
      email: 'admin@eq.example',
      org_user_ids: ['usr_admin', 'usr_member', 'usr_orgadmin'],
      permissions: ['admin_full_access', 'field_default', 'member_default'],
      positions: ['everyone', 'platform_admin'],
      posture: 'PLATFORM_ADMIN',
      systemPermissions: [
        'manage_metadata',
        'manage_platform_settings',
        'manage_sharing',
        'manage_users',
        'setup.access',
        'setup.write',
        'studio.access',
        'view_all_audit_log',
      ],
    },
  },
};

/** The `everyone` anchor's sets in {@link GRANT_GOLDEN} — the deployment's baseline. */
const BASELINE_SETS = ['field_default', 'member_default'];

/**
 * {@link GRANT_GOLDEN} for a scenario. Under {@link SHADOWING_DEFINITIONS} a
 * stored package-less `everyone` definition answers the catalog read ahead of
 * the built-in (the registry's bare-slot precedence, ADR-0005) and names no
 * set, so the envelope carries no baseline name — enforcement still applies the
 * baseline additively (ADR-0090 D5). A v18 boot refuses such a stored
 * definition under a packaged name (`os migrate security-catalog-overlays`).
 */
function grantGoldenFor(scenario: Scenario): unknown {
  const golden = GRANT_GOLDEN[scenario.posture] as Record<string, { permissions: string[] }>;
  if (!scenario.shadowedBuiltins) return golden;
  return Object.fromEntries(
    Object.entries(golden).map(([who, grants]) => [
      who,
      who === 'agent' ? grants : { ...grants, permissions: grants.permissions.filter((p) => !BASELINE_SETS.includes(p)) },
    ]),
  );
}

