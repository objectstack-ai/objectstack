// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D2, C2 stages S2 and S2b] The six built-in positions as declared
 * metadata, and the declared-positions seeder reading through the security
 * catalog read, read off a REAL boot of this plugin: what the catalog read
 * lists, what the boot writes into `sys_position`, what every principal is
 * granted, and which position writes are still refused.
 *
 * The stage moves where the six come from — one declaration list, registered
 * with the engine registry and read by the built-in seeder — and keeps the
 * declared-positions seeder off them. No resolver reads a definition yet, so
 * the only ways a grant could move are a catalog row that is no longer seeded,
 * seeded differently, or seeded twice: above all `everyone`, which carries
 * every authenticated principal's baseline through its binding. So this boot
 * is the plugin's own — `init`, `start`, then its `kernel:ready` handlers in
 * registration order (catalog seeding and the baseline binding to `everyone`
 * included) — over a real `ObjectQL` engine on SQLite, with a stack-declared
 * position in the metadata service beside the six.
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
 * each booted three ways:
 *
 *  - as it is;
 *  - with `a door-authored position in the registry` — one position registered
 *    the way a metadata author's saved definition is hydrated (no package);
 *  - with `a stored definition under a built-in name` — `org_admin` and
 *    `everyone` saved the same way before the six were declared, so each
 *    shadows its declaration at read (the registry's bare slot answers first).
 *
 * ## The goldens
 *
 * The row census, the `sys_position` write ledger and the grant envelopes of
 * the three postures as they are were recorded from the tree BEFORE the
 * declarations existed (objectstack `51290bca2c`, this file run against that
 * tree's sources; S2's PR record carries the run) and are unchanged since.
 *
 * S2b changes the census and the ledger in one place, the door-authored
 * scenarios: the declared-positions seeder took the registry ALONE whenever it
 * held a position besides the six, so the door-authored position silenced the
 * stack's `field_rep` in every pass — and in every organization created later.
 * It now reads both sources, so `field_rep` is seeded beside it. The
 * door-authored position's own rows are what the registry-only read wrote
 * (a separate pin, green on both sides of S2b), the stored definitions under
 * a built-in name change no row and no write, and no principal's grants move
 * in any scenario: none of them holds a position S2b newly seeds.
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
type ScenarioName = PostureName | `${PostureName}, ${typeof DOOR}` | `${PostureName}, ${typeof SHADOW}`;
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
}
const POSTURES: Record<PostureName, Omit<Scenario, 'authoredPosition' | 'shadowedBuiltins'>> = {
  single: { posture: 'single', organizationAtBoot: false, lateOrganization: false },
  'single + organization': { posture: 'single', organizationAtBoot: true, lateOrganization: false },
  walled: { posture: 'isolated', organizationAtBoot: true, lateOrganization: true },
};
const SCENARIOS = Object.fromEntries(
  (Object.keys(POSTURES) as PostureName[]).flatMap((name) => [
    [name, { ...POSTURES[name], authoredPosition: false, shadowedBuiltins: false }],
    [`${name}, ${DOOR}`, { ...POSTURES[name], authoredPosition: true, shadowedBuiltins: false }],
    [`${name}, ${SHADOW}`, { ...POSTURES[name], authoredPosition: false, shadowedBuiltins: true }],
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
    get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
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

  // The plugin's own boot: seeders, the baseline binding to `everyone`, the
  // organization-admin backfill — in registration order, as the kernel fires them.
  for (const handler of hooks.get('kernel:ready') ?? []) await handler();
  if (scenario.lateOrganization) {
    await engine.insert('sys_organization', { id: LATE_ORG, name: 'Late Org', slug: 'late' }, { context: SYS } as any);
  }
  recording = false;

  const rows = (await engine.find('sys_position', { where: {}, limit: 5000, context: SYS })) as any[];
  const census = rows
    .map((r) => [r.name, r.organization_id ?? '-', r.managed_by, r.active, r.is_default, r.label, r.description ?? '-'].join(' | '))
    .sort();
  return { engine, metadata, ledger, census };
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
async function tenantPositionWrites(engine: ObjectQL): Promise<Record<string, WriteOutcome>> {
  const tenant = { userId: 'usr_orgadmin', positions: [], permissions: ['qa_admin'], tenantId: ORG };
  const own = async (name: string) => {
    const rows = (await engine.find('sys_position', { where: { name }, limit: 5, context: { isSystem: true, tenantId: ORG } })) as any[];
    // The organization's own row when it has one (walled), else the organization-less one (`single`).
    return rows.find((r) => r.organization_id === ORG) ?? rows.find((r) => r.organization_id == null);
  };
  const everyone = await own('everyone');
  const platformAdmin = await own('platform_admin');
  return {
    'assign a position no catalog row carries': await outcome(engine.insert(
      'sys_user_position', { user_id: 'usr_member', position: 'zz_dangling' }, { context: tenant } as any,
    )),
    'control: create a position': await outcome(engine.insert(
      'sys_position', { name: 'zz_tenant_post', label: 'Tenant Post' }, { context: tenant } as any,
    )),
    'control: assign it': await outcome(engine.insert(
      'sys_user_position', { user_id: 'usr_member', position: 'zz_tenant_post' }, { context: tenant } as any,
    )),
    'delete the everyone row': await outcome(engine.delete('sys_position', { where: { id: everyone?.id }, context: tenant } as any)),
    'relabel the platform_admin row': await outcome(engine.update(
      'sys_position', { id: platformAdmin?.id, label: 'Repurposed' }, { context: tenant } as any,
    )),
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

    // P2.2 — the rows, and who wrote them: the built-ins, every stack-declared
    // position and every door-authored one, in every organization (S2b).
    it('seeds the built-ins, the stack-declared positions and the door-authored ones', () => {
      const { census, ledger } = booted.get(name)!;
      expect({ census, ledger }).toEqual(CATALOG_GOLDEN[name]);
    });

    if (scenario.authoredPosition) {
      // S2b moves which positions seed beside the door-authored one, never
      // that one's own rows: the same row, written once per pass, with what the
      // registry-only read wrote.
      it('writes the door-authored position’s rows as the registry-only read wrote them', () => {
        const { census, ledger } = booted.get(name)!;
        expect({
          census: census.filter((line) => line.startsWith('door_authored ')),
          ledger: ledger.filter((line) => line.includes(' door_authored@')),
        }).toEqual(DOOR_AUTHORED_ROWS[scenario.lateOrganization ? 'walled' : 'single']);
      });
    }

    if (scenario.organizationAtBoot) {
      it('grants every principal what it was granted before the declarations', async () => {
        const { engine } = booted.get(name)!;
        expect(await grantsByPrincipal(engine, scenario.posture)).toEqual(GRANT_GOLDEN[scenario.posture]);
      });

      it('still refuses a tenant a dangling position name, and deleting or relabelling a built-in row', async () => {
        const { engine } = booted.get(name)!;
        expect(await tenantPositionWrites(engine)).toEqual(REFUSAL_GOLDEN);
      });
    }
  });
}

/**
 * The tenant position writes — the same in both postures. The dangling name is
 * the position catalog refusal's envelope (`reference_not_found` at
 * `position`); the two built-in rows are refused on their `platform`
 * provenance.
 */
const REFUSAL_GOLDEN: Record<string, WriteOutcome> = {
  'assign a position no catalog row carries': {
    ok: false,
    code: 'VALIDATION_FAILED',
    fields: ['position:reference_not_found'],
  },
  'control: create a position': {
    ok: true,
  },
  'control: assign it': {
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

/**
 * Each recorded row's `label | description`, as the census spells it — one
 * entry per name, the same in every organization.
 */
const TEXT: Record<string, string> = {
  everyone:
    'Everyone | Built-in audience anchor: every authenticated member holds this position implicitly. Permission sets bound to it are the default grants for the tenant (ADR-0090 D5). High-privilege sets cannot be bound here.',
  field_rep:
    'Field Rep | Works the territory',
  guest:
    'Guest | Built-in audience anchor: unauthenticated principals hold this position implicitly and exclusively. Bindings face the strictest checks — named objects only, read-mostly, never a wildcard (ADR-0090 D9).',
  org_admin:
    'Organization Admin | Organization administrator within a tenant.',
  org_member:
    'Organization Member | Organization member within a tenant.',
  org_owner:
    'Organization Owner | Organization owner within a tenant.',
  platform_admin:
    'Platform Admin | Platform operator (SaaS admin). NOT a tenant user role.',
  door_authored:
    'Door Authored | -',
};

/** The three postures as they are: recorded before the declarations (module doc), unchanged by S2b. */
const PLAIN_GOLDEN: Record<PostureName, { census: string[]; ledger: string[] }> = {
  single: {
    census: [
      `everyone | - | platform | true | false | ${TEXT.everyone}`,
      `field_rep | - | admin | true | false | ${TEXT.field_rep}`,
      `guest | - | platform | true | false | ${TEXT.guest}`,
      `org_admin | - | platform | true | false | ${TEXT.org_admin}`,
      `org_member | - | platform | true | false | ${TEXT.org_member}`,
      `org_owner | - | platform | true | false | ${TEXT.org_owner}`,
      `platform_admin | - | platform | true | false | ${TEXT.platform_admin}`,
    ],
    ledger: [
      'insert field_rep@-',
      'insert platform_admin@- managed_by=platform',
      'insert org_owner@- managed_by=platform',
      'insert org_admin@- managed_by=platform',
      'insert org_member@- managed_by=platform',
      'insert everyone@- managed_by=platform',
      'insert guest@- managed_by=platform',
    ],
  },
  'single + organization': {
    census: [
      `everyone | - | platform | true | false | ${TEXT.everyone}`,
      `field_rep | - | admin | true | false | ${TEXT.field_rep}`,
      `guest | - | platform | true | false | ${TEXT.guest}`,
      `org_admin | - | platform | true | false | ${TEXT.org_admin}`,
      `org_member | - | platform | true | false | ${TEXT.org_member}`,
      `org_owner | - | platform | true | false | ${TEXT.org_owner}`,
      `platform_admin | - | platform | true | false | ${TEXT.platform_admin}`,
    ],
    ledger: [
      'insert field_rep@-',
      'insert platform_admin@- managed_by=platform',
      'insert org_owner@- managed_by=platform',
      'insert org_admin@- managed_by=platform',
      'insert org_member@- managed_by=platform',
      'insert everyone@- managed_by=platform',
      'insert guest@- managed_by=platform',
    ],
  },
  walled: {
    census: [
      `everyone | org_eq | platform | true | false | ${TEXT.everyone}`,
      `everyone | org_late | platform | true | false | ${TEXT.everyone}`,
      `field_rep | org_eq | admin | true | false | ${TEXT.field_rep}`,
      `field_rep | org_late | admin | true | false | ${TEXT.field_rep}`,
      `guest | org_eq | platform | true | false | ${TEXT.guest}`,
      `guest | org_late | platform | true | false | ${TEXT.guest}`,
      `org_admin | org_eq | platform | true | false | ${TEXT.org_admin}`,
      `org_admin | org_late | platform | true | false | ${TEXT.org_admin}`,
      `org_member | org_eq | platform | true | false | ${TEXT.org_member}`,
      `org_member | org_late | platform | true | false | ${TEXT.org_member}`,
      `org_owner | org_eq | platform | true | false | ${TEXT.org_owner}`,
      `org_owner | org_late | platform | true | false | ${TEXT.org_owner}`,
      `platform_admin | org_eq | platform | true | false | ${TEXT.platform_admin}`,
      `platform_admin | org_late | platform | true | false | ${TEXT.platform_admin}`,
    ],
    ledger: [
      'insert field_rep@org_eq',
      'insert platform_admin@org_eq managed_by=platform',
      'insert org_owner@org_eq managed_by=platform',
      'insert org_admin@org_eq managed_by=platform',
      'insert org_member@org_eq managed_by=platform',
      'insert everyone@org_eq managed_by=platform',
      'insert guest@org_eq managed_by=platform',
      'insert field_rep@org_late',
      'insert platform_admin@org_late managed_by=platform',
      'insert org_owner@org_late managed_by=platform',
      'insert org_admin@org_late managed_by=platform',
      'insert org_member@org_late managed_by=platform',
      'insert everyone@org_late managed_by=platform',
      'insert guest@org_late managed_by=platform',
    ],
  },
};

/**
 * The door-authored scenarios after S2b: the posture's own rows plus the
 * door-authored position's, `field_rep` included in every pass — before S2b it
 * was missing from all of them (module doc).
 */
const DOOR_GOLDEN: Record<PostureName, { census: string[]; ledger: string[] }> = {
  single: {
    census: [
      `door_authored | - | admin | true | false | ${TEXT.door_authored}`,
      ...PLAIN_GOLDEN.single.census,
    ],
    ledger: [
      'insert door_authored@-',
      ...PLAIN_GOLDEN.single.ledger,
    ],
  },
  'single + organization': {
    census: [
      `door_authored | - | admin | true | false | ${TEXT.door_authored}`,
      ...PLAIN_GOLDEN['single + organization'].census,
    ],
    ledger: [
      'insert door_authored@-',
      ...PLAIN_GOLDEN['single + organization'].ledger,
    ],
  },
  walled: {
    census: [
      `door_authored | org_eq | admin | true | false | ${TEXT.door_authored}`,
      `door_authored | org_late | admin | true | false | ${TEXT.door_authored}`,
      ...PLAIN_GOLDEN.walled.census,
    ],
    ledger: [
      'insert door_authored@org_eq',
      'insert field_rep@org_eq',
      'insert platform_admin@org_eq managed_by=platform',
      'insert org_owner@org_eq managed_by=platform',
      'insert org_admin@org_eq managed_by=platform',
      'insert org_member@org_eq managed_by=platform',
      'insert everyone@org_eq managed_by=platform',
      'insert guest@org_eq managed_by=platform',
      'insert door_authored@org_late',
      'insert field_rep@org_late',
      'insert platform_admin@org_late managed_by=platform',
      'insert org_owner@org_late managed_by=platform',
      'insert org_admin@org_late managed_by=platform',
      'insert org_member@org_late managed_by=platform',
      'insert everyone@org_late managed_by=platform',
      'insert guest@org_late managed_by=platform',
    ],
  },
};

/**
 * The census and the ledger, per scenario. A stored definition under a
 * built-in name changes neither: the declared seeder writes no row for the
 * name and restamps none, and the built-in rows are exactly what
 * `bootstrapBuiltinRoles` writes from the declarations.
 */
const CATALOG_GOLDEN = Object.fromEntries(
  (Object.keys(POSTURES) as PostureName[]).flatMap((name) => [
    [name, PLAIN_GOLDEN[name]],
    [`${name}, ${DOOR}`, DOOR_GOLDEN[name]],
    [`${name}, ${SHADOW}`, PLAIN_GOLDEN[name]],
  ]),
) as Record<ScenarioName, { census: string[]; ledger: string[] }>;

/**
 * The door-authored position's own rows and writes — the same before S2b
 * (the registry-only read) and after it.
 */
const DOOR_AUTHORED_ROWS: Record<'single' | 'walled', { census: string[]; ledger: string[] }> = {
  single: {
    census: [`door_authored | - | admin | true | false | ${TEXT.door_authored}`],
    ledger: ['insert door_authored@-'],
  },
  walled: {
    census: [
      `door_authored | org_eq | admin | true | false | ${TEXT.door_authored}`,
      `door_authored | org_late | admin | true | false | ${TEXT.door_authored}`,
    ],
    ledger: ['insert door_authored@org_eq', 'insert door_authored@org_late'],
  },
};

/**
 * Recorded before the declarations (module doc). `field_default` on every
 * human principal is the `everyone` binding; `single` also binds the
 * platform's `member_default` (its organization-less catalog holds that set),
 * while the walled organization's catalog holds only its own copy of the app's
 * set. The organization administrator's set is the walled `organization_admin`
 * against the wall-less `organization_admin_no_bypass` (ADR-0105 D4).
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
      permissions: ['field_default', 'viewer_readonly'],
      positions: ['everyone', 'org_member'],
      posture: 'MEMBER',
      systemPermissions: [],
    },
    organizationAdmin: {
      accessible_org_ids: ['org_eq'],
      email: 'orgadmin@eq.example',
      org_user_ids: ['usr_member', 'usr_orgadmin'],
      permissions: ['field_default', 'organization_admin'],
      positions: ['everyone', 'org_owner'],
      posture: 'TENANT_ADMIN',
      systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
    },
    platformAdmin: {
      accessible_org_ids: [],
      email: 'admin@eq.example',
      org_user_ids: ['usr_admin', 'usr_member', 'usr_orgadmin'],
      permissions: ['admin_full_access', 'field_default'],
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
