// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25063 · ADR-0090 D10] A delegated operation runs only in an organization
 * the delegator's own membership backs.
 *
 * ## The rule
 *
 * An on-behalf-of context runs in the LIVE principal's active organization,
 * and `resolveDelegatorContext` hands the delegator that same organization,
 * on the stated assumption that the agent and its delegator are in the same
 * organization. A delegated operation is bounded by the delegator's scope
 * (ADR-0090 D10), and that bound holds only while the assumption does. So on
 * a walled posture the delegated-principal prologue
 * (`resolveOperationPrincipals`) refuses `403 PERMISSION_DENIED`, for every
 * verb, when the live organization is one the delegator is not a member of.
 * The test is `vetOrganizationClaim` (`@objectstack/core`), the one spelling
 * of "a membership backs this organization".
 *
 * The one producer of an on-behalf-of context in this tree (the `/mcp` OAuth
 * door) vets the organization against the same membership, so it never builds
 * the refused shape. An in-process caller that builds one by hand is the
 * population this pins.
 *
 * ## What this file pins
 *
 * Real `ObjectQL` (source), real `SqlDriver`, real `SecurityPlugin`; the
 * delegator is rebuilt from stored `sys_user` / `sys_member` /
 * `sys_user_permission_set` rows. It is a member of `org_a` and `org_c`, and
 * holds the private object's grant in `org_a`, `org_c` AND `org_d`, so the
 * D10 grant intersection never answers for it: every refusal below is this
 * rule's, and with the rule removed each cell is admitted (ablation-verified).
 *
 * - REFUSED, under `group` and `isolated`: an insert (single and array, on a
 *   public and on a private object), a read, an update and a delete by a
 *   delegated context whose active organization is `org_d`. Nothing is stored
 *   or changed.
 * - UNCHANGED: a delegated context in `org_a`; the same caller in `org_d`
 *   without the delegation link; a delegated context with no active
 *   organization (it keeps ADR-0123 D2's refusal); a system context; and the
 *   `single` posture, which has no wall.
 *
 * ## The raw-SQL read scope answers the same rule [#25106 · ADR-0021 D-C]
 *
 * `getReadFilter` is the read scope a door that bypasses the engine ANDs into
 * its query, and its contract is agreement with the find path. So where the
 * prologue refuses a delegated context, the provider answers the deny
 * sentinel (`RLS_DENY_FILTER` itself, by reference), on a public, a private
 * and an organization-less object alike: the rule is about the context, not
 * the object. Every context the prologue admits keeps the scope it had, and
 * one parity cell reads the provider beside the engine's own find over the
 * same contexts.
 *
 * ## The probes and the diagnostics answer the same rule [#25107]
 *
 * Every other reader in this plugin that resolves a delegator on its own asks
 * the prologue's check too (`delegatedOrganizationRefusal`, the one ask of
 * `vetOrganizationClaim` they share with the prologue), so none of them
 * answers an admission for a context the operation refuses: the admission
 * probes `canReadObject`, `canWriteObject` and `canExport` answer `false`; the
 * four field projections answer no field; the explanation denies on the
 * principal layer; the narrowing diagnostic reports nothing; and the
 * explanation's per-record write gate asks the sharing service nothing. Every
 * context the prologue admits keeps its answer, and a parity cell reads each
 * probe beside the engine operation it describes.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { RLS_DENY_FILTER } from '@objectstack/spec/data';
import { SecurityPlugin } from './security-plugin.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const ORG_A = 'org_a';
const ORG_C = 'org_c';
const ORG_D = 'org_d';
const DELEGATOR = 'usr_delegator';

const FIELDS = {
  id: { name: 'id', type: 'text', primaryKey: true },
  name: { name: 'name', type: 'text' },
};

const OBJECTS = [
  { name: 'qa_account', label: 'Account', fields: FIELDS },
  { name: 'qa_vault', label: 'Vault', access: { default: 'private' }, fields: FIELDS },
  // [#25106] An organization-less object: no wall applies to it, so only the
  // context rule can answer the deny sentinel for it.
  { name: 'qa_catalog', label: 'Catalog', tenancy: { enabled: false }, fields: FIELDS },
  // [#25107] Read only by the narrowing diagnostic's cells: the delegator reads
  // it org-wide, and the agent's ceiling declares owner-only.
  { name: 'qa_ledger', label: 'Ledger', fields: FIELDS },
];

// [#25107] `allowExport` on every grant, so the export probe's admitted
// cells are admitted by a grant and only this rule can refuse one.
const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowExport: true } },
} as unknown as PermissionSet;

const PLATFORM_ADMIN: PermissionSet = {
  name: 'admin_full_access',
  label: 'Platform Administrator',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowExport: true, viewAllRecords: true, modifyAllRecords: true },
  },
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
} as unknown as PermissionSet;

/** A private object is outside the `'*'` grant, so the delegator holds it by name. */
const VAULT_WRITER: PermissionSet = {
  name: 'qa_vault_writer',
  label: 'Vault writer',
  objects: { qa_vault: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowExport: true } },
} as unknown as PermissionSet;

/** [#25107] The delegator reads the ledger org-wide... */
const LEDGER_READER: PermissionSet = {
  name: 'qa_ledger_reader',
  label: 'Ledger reader',
  objects: { qa_ledger: { allowRead: true, viewAllRecords: true } },
} as unknown as PermissionSet;

/** ...and an agent's ceiling declares it owner-only, so the narrowing diagnostic has something to say. */
const QA_CEILING: PermissionSet = {
  name: 'qa_ceiling',
  label: 'Agent ceiling',
  objects: { qa_ledger: { allowRead: true, readScope: 'own' } },
} as unknown as PermissionSet;

const SETS = [MEMBER, PLATFORM_ADMIN, VAULT_WRITER, LEDGER_READER, QA_CEILING];

const SYS_CTX = { isSystem: true, userId: 'usr_system', tenantId: ORG_A };

/** The caller: a platform operator, walled on the public object and crossing on the private one. */
function operator(activeOrganization: string | undefined, delegated = true) {
  return {
    userId: 'usr_operator',
    ...(activeOrganization ? { tenantId: activeOrganization } : {}),
    accessible_org_ids: activeOrganization ? [activeOrganization] : [],
    positions: [],
    permissions: ['admin_full_access'],
    posture: 'PLATFORM_ADMIN',
    ...(delegated ? { onBehalfOf: { userId: DELEGATOR } } : {}),
  };
}

/** [#25107] An agent acting for the delegator under the ceiling above. */
function agent(activeOrganization: string) {
  return {
    userId: 'usr_agent',
    principalKind: 'agent',
    tenantId: activeOrganization,
    accessible_org_ids: [activeOrganization],
    positions: [],
    permissions: ['qa_ceiling'],
    onBehalfOf: { userId: DELEGATOR },
  };
}

type Posture = 'group' | 'isolated' | 'single';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: Posture, options: { sharing?: Record<string, unknown> } = {}) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.delegated-organization-membership',
    name: 'A delegated operation runs in an organization the delegator belongs to',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      SysPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPosition, SysUserPermissionSet,
      SysOrganization, SysUser, SysMember,
      ...OBJECTS,
    ],
  } as never);
  await engine.syncSchemas();
  // The organization-less permission-set catalogue row below exists only on a
  // store built before 18.x (ADR-0131 D1 makes a fresh tenant column NOT
  // NULL): that table is this store's.
  await relaxTenantColumns(engine as never, ['sys_permission_set']);
  engines.push(engine);

  for (const id of [ORG_A, ORG_C, ORG_D]) {
    await engine.insert('sys_organization', { id, name: id, slug: id }, { context: SYS_CTX } as never);
  }
  await engine.insert('sys_user', { id: DELEGATOR, name: DELEGATOR, email: 'delegator@example.test' }, { context: SYS_CTX } as never);
  for (const org of [ORG_A, ORG_C]) {
    await engine.insert('sys_member', { id: `mem_${org}`, user_id: DELEGATOR, organization_id: org, role: 'member' }, { context: SYS_CTX } as never);
  }
  const driverOf = (o: string) => (engine as unknown as { getDriver(x: string): { create(x: string, r: Record<string, unknown>): Promise<unknown> } }).getDriver(o);
  for (const [id, name, label] of [['ps_qa_vault_writer', 'qa_vault_writer', 'Vault writer'], ['ps_qa_ledger_reader', 'qa_ledger_reader', 'Ledger reader']]) {
    await driverOf('sys_permission_set').create('sys_permission_set', {
      id, name, label, organization_id: null, managed_by: 'admin', active: true,
      object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
    });
  }
  // The grant in `org_d` too: the D10 grant intersection must not be what
  // refuses a cell below, or removing the rule would leave the cell green.
  for (const org of [ORG_A, ORG_C, ORG_D]) {
    await engine.insert('sys_user_permission_set', { id: `ups_${org}`, user_id: DELEGATOR, permission_set: 'qa_vault_writer', organization_id: org }, { context: SYS_CTX } as never);
    await engine.insert('sys_user_permission_set', { id: `ups_ledger_${org}`, user_id: DELEGATOR, permission_set: 'qa_ledger_reader', organization_id: org }, { context: SYS_CTX } as never);
  }
  // One stored row per object in `org_d`, for the read, update and delete cells.
  for (const object of ['qa_account', 'qa_vault']) {
    await engine.insert(object, { id: `${object}_in_d`, name: 'seeded', organization_id: ORG_D }, { context: { ...SYS_CTX, tenantId: ORG_D } } as never);
  }

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission'
          ? SETS.find((set) => (set as { name?: string }).name === name) ?? null
          : engine.getSchema(name) ?? null,
      list: async () => SETS,
    },
  };
  if (posture !== 'single') {
    services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
    services.tenancy = { posture };
  }
  if (options.sharing) services.sharing = options.sharing;
  const registered = new Map<string, unknown>();
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    // `kernel:ready` never fires here: without a `hook` the plugin starts its
    // platform bootstrap un-awaited, and a short case then destroys the engine
    // under that bootstrap's reads. Nothing this file pins reads what it sets.
    hook: () => undefined,
    registerService: (name: string, service: unknown) => { registered.set(name, service); },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  const stored = async (object: string) => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(object);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(object).select('id', 'name', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  const security = () => registered.get('security') as {
    describeDelegationNarrowing(object: string, context: unknown): Promise<{ narrowed: boolean; effectiveScope?: string }>;
  };
  return { engine, plugin, stored, security };
}

interface Outcome { ok: boolean; value?: unknown; code?: string; status?: number; message?: string; developerMessage?: string }
const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string; developerMessage?: string };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status, message: String(err.message ?? e), developerMessage: err.developerMessage };
  }
};

/** This rule's refusal: the envelope, and the subjects it names (the live organization and the delegator). */
const expectMembershipRefusal = (outcome: Outcome) => {
  expect(outcome.ok, 'expected the delegated operation to be refused').toBe(false);
  expect(outcome.code).toBe('PERMISSION_DENIED');
  expect(outcome.status).toBe(403);
  expect(outcome.developerMessage?.startsWith('[ADR-0090 D10]'), outcome.message).toBe(true);
  expect(outcome.message).toContain(`'${ORG_D}'`);
  expect(outcome.message).toContain(`'${DELEGATOR}'`);
};

const SEEDED = (object: string) => [{ id: `${object}_in_d`, name: 'seeded', organization_id: ORG_D }];

describe('[#25063 · ADR-0090 D10] a delegated operation in an organization the delegator is not a member of is refused', () => {
  for (const posture of ['group', 'isolated'] as const) {
    describe(`\`${posture}\``, () => {
      for (const object of ['qa_account', 'qa_vault']) {
        it(`${object}: a single insert is refused, and nothing is stored`, async () => {
          const b = await boot(posture);
          expectMembershipRefusal(await attempt(() => b.engine.insert(object, { id: 'r1', name: 'one' }, { context: operator(ORG_D) } as never)));
          expect(await b.stored(object)).toEqual(SEEDED(object));
        });

        it(`${object}: an array insert is refused whole, and nothing is stored`, async () => {
          const b = await boot(posture);
          const rows = [{ id: 'r1', name: 'one' }, { id: 'r2', name: 'two' }];
          expectMembershipRefusal(await attempt(() => b.engine.insert(object, rows, { context: operator(ORG_D) } as never)));
          expect(await b.stored(object)).toEqual(SEEDED(object));
        });

        it(`${object}: a read is refused`, async () => {
          const b = await boot(posture);
          expectMembershipRefusal(await attempt(() => b.engine.find(object, { context: operator(ORG_D) } as never)));
        });

        it(`${object}: an update and a delete are refused, and the stored row is unchanged`, async () => {
          const b = await boot(posture);
          expectMembershipRefusal(await attempt(() => b.engine.update(object, { id: `${object}_in_d`, name: 'renamed' }, { context: operator(ORG_D) } as never)));
          expectMembershipRefusal(await attempt(() => b.engine.delete(object, { where: { id: `${object}_in_d` }, context: operator(ORG_D) } as never)));
          expect(await b.stored(object)).toEqual(SEEDED(object));
        });
      }
    });
  }
});

describe('[#25063] what the rule leaves alone', () => {
  for (const posture of ['group', 'isolated'] as const) {
    it(`\`${posture}\`: a delegated insert in an organization the delegator belongs to is stored there, and read back`, async () => {
      const b = await boot(posture);
      for (const object of ['qa_account', 'qa_vault']) {
        const outcome = await attempt(() => b.engine.insert(object, { id: 'r1', name: 'one' }, { context: operator(ORG_A) } as never));
        expect(outcome.ok, outcome.message).toBe(true);
        expect((await b.stored(object)).find((r) => r.id === 'r1')).toEqual({ id: 'r1', name: 'one', organization_id: ORG_A });
        const read = await attempt(() => b.engine.find(object, { where: { id: 'r1' }, context: operator(ORG_A) } as never));
        expect(read.ok, read.message).toBe(true);
        expect((read.value as Array<{ id: string }>).map((r) => r.id)).toEqual(['r1']);
      }
    });

    it(`\`${posture}\`: the same caller in \`org_d\` WITHOUT the delegation link is not this rule's — its insert is stored in \`org_d\``, async () => {
      const b = await boot(posture);
      const outcome = await attempt(() => b.engine.insert('qa_account', { id: 'r1', name: 'one' }, { context: operator(ORG_D, false) } as never));
      expect(outcome.ok, outcome.message).toBe(true);
      expect((await b.stored('qa_account')).find((r) => r.id === 'r1')).toEqual({ id: 'r1', name: 'one', organization_id: ORG_D });
    });

    it(`\`${posture}\`: a delegated context with NO active organization keeps ADR-0123 D2's refusal`, async () => {
      const b = await boot(posture);
      const outcome = await attempt(() => b.engine.insert('qa_account', { id: 'r1', name: 'one' }, { context: operator(undefined) } as never));
      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(outcome.developerMessage?.startsWith('[ADR-0123 D2]'), outcome.message).toBe(true);
      expect(await b.stored('qa_account')).toEqual(SEEDED('qa_account'));
    });

    it(`\`${posture}\`: a system context is untouched — its explicit organization is stored as sent`, async () => {
      const b = await boot(posture);
      const outcome = await attempt(() => b.engine.insert('qa_account', { id: 'r1', name: 'one', organization_id: ORG_C }, { context: SYS_CTX } as never));
      expect(outcome.ok, outcome.message).toBe(true);
      expect((await b.stored('qa_account')).find((r) => r.id === 'r1')).toEqual({ id: 'r1', name: 'one', organization_id: ORG_C });
    });
  }

  it('`single`: there is no wall, so a delegated insert in `org_d` is stored as before', async () => {
    const b = await boot('single');
    const outcome = await attempt(() => b.engine.insert('qa_account', { id: 'r1', name: 'one' }, { context: operator(ORG_D) } as never));
    expect(outcome.ok, outcome.message).toBe(true);
    expect((await b.stored('qa_account')).find((r) => r.id === 'r1')).toEqual({ id: 'r1', name: 'one', organization_id: ORG_D });
  });
});

// ---------------------------------------------------------------------------
// [#25106 · ADR-0021 D-C] The raw-SQL read scope (`getReadFilter`) answers the
// same rule. Its contract is agreement with the find path: where the prologue
// refuses a delegated context, the provider answers the deny sentinel.
// ---------------------------------------------------------------------------

const PROVIDER_OBJECTS = ['qa_account', 'qa_vault', 'qa_catalog'] as const;

/** One row per tenant object in `org_a` and `org_c` (`org_d`'s is `boot`'s), and two catalog rows, which carry no organization. */
async function seedForReads(engine: ObjectQL) {
  for (const object of ['qa_account', 'qa_vault']) {
    for (const [org, suffix] of [[ORG_A, 'a'], [ORG_C, 'c']] as const) {
      await engine.insert(object, { id: `${object}_in_${suffix}`, name: 'seeded', organization_id: org }, { context: { ...SYS_CTX, tenantId: org } } as never);
    }
  }
  for (const id of ['qa_catalog_1', 'qa_catalog_2']) {
    await engine.insert('qa_catalog', { id, name: 'seeded' }, { context: SYS_CTX } as never);
  }
}

const sortedIds = (rows: unknown) => (rows as Array<{ id: string }>).map((r) => r.id).sort();

/** The ids a read scope admits, applied as the only predicate under a system context — as a door that bypasses the engine applies it. */
const idsAdmittedBy = async (engine: ObjectQL, object: string, scope: Record<string, unknown> | undefined) =>
  sortedIds(await engine.find(object, { where: scope ?? {}, context: { isSystem: true } } as never));

describe('[#25106 · ADR-0021 D-C] getReadFilter answers the deny sentinel where the prologue refuses', () => {
  for (const posture of ['group', 'isolated'] as const) {
    for (const object of PROVIDER_OBJECTS) {
      it(`\`${posture}\` · ${object}: a delegated context in an organization the delegator is not a member of answers RLS_DENY_FILTER itself`, async () => {
        const b = await boot(posture);
        await seedForReads(b.engine);
        expect(await b.plugin.getReadFilter(object, operator(ORG_D))).toBe(RLS_DENY_FILTER);
      });
    }
  }
});

describe('[#25106] what the rule leaves alone in the read scope', () => {
  // Each answer below was read on the provider before this rule and after it,
  // and is the same: the rule moves only the contexts the prologue refuses.
  // A scope is pinned by the rows it admits (`idsAdmittedBy`).
  const scopeRows = async (b: Awaited<ReturnType<typeof boot>>, object: string, context: Record<string, unknown>) => {
    const scope = await b.plugin.getReadFilter(object, { ...context });
    expect(scope, `${object}: a scope, not the deny sentinel`).not.toBe(RLS_DENY_FILTER);
    return idsAdmittedBy(b.engine, object, scope);
  };

  const IN_SET: Record<'group' | 'isolated', Record<string, string[]>> = {
    // `group` walls the delegator's leg by its own memberships (`org_a`, `org_c`);
    // the operator crosses on the private object, so its rows come from both.
    group: { qa_account: ['qa_account_in_a'], qa_vault: ['qa_vault_in_a', 'qa_vault_in_c'], qa_catalog: ['qa_catalog_1', 'qa_catalog_2'] },
    isolated: { qa_account: ['qa_account_in_a'], qa_vault: ['qa_vault_in_a'], qa_catalog: ['qa_catalog_1', 'qa_catalog_2'] },
  };

  for (const posture of ['group', 'isolated'] as const) {
    it(`\`${posture}\`: a delegated context in an organization the delegator belongs to keeps its scope`, async () => {
      const b = await boot(posture);
      await seedForReads(b.engine);
      for (const object of PROVIDER_OBJECTS) {
        expect(await scopeRows(b, object, operator(ORG_A)), object).toEqual(IN_SET[posture][object]);
      }
    });

    it(`\`${posture}\`: the same caller in \`org_d\` WITHOUT the delegation link keeps its scope`, async () => {
      const b = await boot(posture);
      await seedForReads(b.engine);
      expect(await scopeRows(b, 'qa_account', operator(ORG_D, false))).toEqual(['qa_account_in_d']);
      expect(await scopeRows(b, 'qa_vault', operator(ORG_D, false))).toEqual(['qa_vault_in_a', 'qa_vault_in_c', 'qa_vault_in_d']);
      expect(await scopeRows(b, 'qa_catalog', operator(ORG_D, false))).toEqual(['qa_catalog_1', 'qa_catalog_2']);
    });

    it(`\`${posture}\`: a delegated context with NO active organization is not this rule's — its scope is unchanged`, async () => {
      // The wall decides the tenant object (no organization: no row), and the
      // organization-less object keeps its rows. The private object is left
      // out: the delegator holds its grant only inside an organization, so
      // object admission refuses it (`canReadObject`'s half), not this rule.
      const b = await boot(posture);
      await seedForReads(b.engine);
      expect(await scopeRows(b, 'qa_account', operator(undefined))).toEqual([]);
      expect(await scopeRows(b, 'qa_catalog', operator(undefined))).toEqual(['qa_catalog_1', 'qa_catalog_2']);
    });

    it(`\`${posture}\`: a system context is unscoped`, async () => {
      const b = await boot(posture);
      for (const object of PROVIDER_OBJECTS) {
        expect(await b.plugin.getReadFilter(object, { ...SYS_CTX, onBehalfOf: { userId: DELEGATOR } }), object).toBeUndefined();
      }
    });
  }

  it('`single`: there is no wall, so a delegated context in `org_d` keeps its scope', async () => {
    const b = await boot('single');
    await seedForReads(b.engine);
    expect(await scopeRows(b, 'qa_account', operator(ORG_D))).toEqual(['qa_account_in_a', 'qa_account_in_c', 'qa_account_in_d']);
    expect(await scopeRows(b, 'qa_vault', operator(ORG_D))).toEqual(['qa_vault_in_a', 'qa_vault_in_c', 'qa_vault_in_d']);
    expect(await scopeRows(b, 'qa_catalog', operator(ORG_D))).toEqual(['qa_catalog_1', 'qa_catalog_2']);
  });
});

describe('[#25106 · ADR-0021 D-C] parity: the read scope agrees with the engine find on the same contexts', () => {
  for (const posture of ['group', 'isolated'] as const) {
    it(`\`${posture}\`: refused by find ⇔ the deny sentinel; admitted ⇒ the scope admits exactly the rows find returns`, async () => {
      const b = await boot(posture);
      await seedForReads(b.engine);
      const contexts: Record<string, Record<string, unknown>> = {
        'delegated in org_d': operator(ORG_D),
        'delegated in org_a': operator(ORG_A),
        'undelegated in org_d': operator(ORG_D, false),
      };
      const refused: string[] = [];
      for (const [label, context] of Object.entries(contexts)) {
        for (const object of PROVIDER_OBJECTS) {
          const cell = `${label} · ${object}`;
          const scope = await b.plugin.getReadFilter(object, { ...context });
          const found = await attempt(() => b.engine.find(object, { context: { ...context } } as never));
          if (!found.ok) {
            refused.push(cell);
            expect(found.code, cell).toBe('PERMISSION_DENIED');
            expect(found.status, cell).toBe(403);
            expect(scope, cell).toBe(RLS_DENY_FILTER);
          } else {
            expect(scope, cell).not.toBe(RLS_DENY_FILTER);
            expect(await idsAdmittedBy(b.engine, object, scope), cell).toEqual(sortedIds(found.value));
          }
        }
      }
      // The table is not vacuous on either side: find refuses exactly the
      // delegated context the delegator's membership does not back.
      expect(refused).toEqual(PROVIDER_OBJECTS.map((object) => `delegated in org_d · ${object}`));
    });
  }
});

// ---------------------------------------------------------------------------
// [#25107 · ADR-0090 D10] The admission probes, the field projections, the
// explanation and the narrowing diagnostic answer the same rule: where the
// prologue refuses a delegated context, none of them answers an admission.
// ---------------------------------------------------------------------------

type Booted = Awaited<ReturnType<typeof boot>>;

const FIELD_PROJECTIONS = ['getReadableFields', 'getMetadataReadableFields', 'getWritableFields', 'getQueryableFields'] as const;

/** Every probe this card covers, for one context on one object: what each answers. */
async function probeAnswers(b: Booted, object: string, context: Record<string, unknown>) {
  const explained = await b.plugin.explainAccessForCaller({ object, operation: 'read' }, { ...context });
  const fields: Record<string, string[] | undefined> = {};
  for (const projection of FIELD_PROJECTIONS) fields[projection] = await b.plugin[projection](object, { ...context });
  return {
    canReadObject: await b.plugin.canReadObject(object, { ...context }),
    canWriteInsert: await b.plugin.canWriteObject(object, 'insert', { ...context }, { id: 'probe', name: 'probe' }),
    canWriteUpdate: await b.plugin.canWriteObject(object, 'update', { ...context }, { name: 'probe' }),
    canExport: await b.plugin.canExport(object, { ...context }),
    fields,
    explained,
  };
}

const MEMBERSHIP_DETAIL = (organization: string) => `not a member of organization '${organization}'`;

describe('[#25107 · ADR-0090 D10] the probes answer the refusal where the prologue refuses', () => {
  for (const posture of ['group', 'isolated'] as const) {
    for (const object of PROVIDER_OBJECTS) {
      it(`\`${posture}\` · ${object}: every admission probe is false, every field projection is empty, and the explanation denies`, async () => {
        const b = await boot(posture);
        const answers = await probeAnswers(b, object, operator(ORG_D));
        expect(answers.canReadObject, 'canReadObject').toBe(false);
        expect(answers.canWriteInsert, 'canWriteObject insert').toBe(false);
        expect(answers.canWriteUpdate, 'canWriteObject update').toBe(false);
        expect(answers.canExport, 'canExport').toBe(false);
        for (const projection of FIELD_PROJECTIONS) expect(answers.fields[projection], projection).toEqual([]);

        const { explained } = answers;
        expect(explained.allowed).toBe(false);
        const layer = (name: string) => explained.layers.find((l) => l.layer === name);
        expect(layer('principal')?.verdict).toBe('denies');
        expect(layer('principal')?.detail).toContain(MEMBERSHIP_DETAIL(ORG_D));
        expect(layer('object_crud')?.verdict).toBe('denies');
        expect(layer('object_crud')?.detail).toContain(MEMBERSHIP_DETAIL(ORG_D));
      });
    }

    it(`\`${posture}\`: the narrowing diagnostic reports nothing for a delegated read the prologue refuses`, async () => {
      const b = await boot(posture);
      expect(await b.security().describeDelegationNarrowing('qa_ledger', agent(ORG_D))).toEqual({ narrowed: false });
    });

    it(`\`${posture}\`: the explanation's per-record write gate asks the sharing service nothing for such a context`, async () => {
      const canEdit = vi.fn(async () => true);
      const b = await boot(posture, { sharing: { canEdit } });
      const explained = await b.plugin.explainAccessForCaller(
        { object: 'qa_account', operation: 'update', recordId: 'qa_account_in_d' },
        operator(ORG_D),
      );
      expect(explained.allowed).toBe(false);
      expect(canEdit).not.toHaveBeenCalled();
    });
  }
});

describe('[#25107] what the rule leaves alone in the probes', () => {
  const ALL_FIELDS = ['id', 'name'];
  const expectAdmitted = (answers: Awaited<ReturnType<typeof probeAnswers>>, cell: string) => {
    expect(answers.canReadObject, `${cell}: canReadObject`).toBe(true);
    expect(answers.canWriteInsert, `${cell}: canWriteObject insert`).toBe(true);
    expect(answers.canWriteUpdate, `${cell}: canWriteObject update`).toBe(true);
    expect(answers.canExport, `${cell}: canExport`).toBe(true);
    for (const projection of FIELD_PROJECTIONS) {
      expect(answers.fields[projection], `${cell}: ${projection}`).toEqual(expect.arrayContaining(ALL_FIELDS));
    }
    expect(answers.explained.allowed, `${cell}: explain`).toBe(true);
    expect(answers.explained.layers.find((l) => l.layer === 'principal')?.verdict, `${cell}: principal layer`).toBe('neutral');
  };

  for (const posture of ['group', 'isolated'] as const) {
    it(`\`${posture}\`: a delegated context in an organization the delegator belongs to is admitted by every probe`, async () => {
      const b = await boot(posture);
      for (const object of PROVIDER_OBJECTS) expectAdmitted(await probeAnswers(b, object, operator(ORG_A)), object);
    });

    it(`\`${posture}\`: the same caller in \`org_d\` WITHOUT the delegation link is admitted by every probe`, async () => {
      const b = await boot(posture);
      for (const object of PROVIDER_OBJECTS) expectAdmitted(await probeAnswers(b, object, operator(ORG_D, false)), object);
    });

    it(`\`${posture}\`: a delegated context with NO active organization is not this rule's — the read probes keep their answer`, async () => {
      // Its writes are ADR-0123 D2's, and the private object's grant lives
      // only inside an organization, so the public objects' reads are the
      // cells this rule could have moved and did not.
      const b = await boot(posture);
      for (const object of ['qa_account', 'qa_catalog']) {
        expect(await b.plugin.canReadObject(object, operator(undefined)), object).toBe(true);
        expect(await b.plugin.getReadableFields(object, operator(undefined)), object).toEqual(expect.arrayContaining(ALL_FIELDS));
      }
    });

    it(`\`${posture}\`: the narrowing diagnostic still reports a narrowed delegated read in an organization the delegator belongs to`, async () => {
      const b = await boot(posture);
      const verdict = await b.security().describeDelegationNarrowing('qa_ledger', agent(ORG_A));
      expect(verdict.narrowed).toBe(true);
      expect(verdict.effectiveScope).toBe('own');
    });

    it(`\`${posture}\`: the explanation's per-record write gate still asks the sharing service as the agent, then as the delegator`, async () => {
      const canEdit = vi.fn(async (_object: string, _recordId: string, _context: { userId?: string; onBehalfOf?: unknown }) => true);
      const b = await boot(posture, { sharing: { canEdit } });
      await seedForReads(b.engine);
      await b.plugin.explainAccessForCaller(
        { object: 'qa_account', operation: 'update', recordId: 'qa_account_in_a' },
        operator(ORG_A),
      );
      expect(canEdit.mock.calls.map(([, , c]) => [c.userId, c.onBehalfOf ? 'on behalf' : 'own'])).toEqual([
        ['usr_operator', 'on behalf'],
        [DELEGATOR, 'own'],
      ]);
    });
  }

  it('`single`: there is no wall, so a delegated context in `org_d` is admitted by every probe and its narrowing is reported', async () => {
    const b = await boot('single');
    for (const object of PROVIDER_OBJECTS) expectAdmitted(await probeAnswers(b, object, operator(ORG_D)), object);
    expect((await b.security().describeDelegationNarrowing('qa_ledger', agent(ORG_D))).narrowed).toBe(true);
  });
});

describe('[#25107 · ADR-0090 D10] parity: each probe agrees with the engine operation it describes', () => {
  for (const posture of ['group', 'isolated'] as const) {
    it(`\`${posture}\`: refused by the engine ⇔ the probe refuses, for a read, an insert and an export`, async () => {
      const b = await boot(posture);
      await seedForReads(b.engine);
      const contexts: Record<string, Record<string, unknown>> = {
        'delegated in org_d': operator(ORG_D),
        'delegated in org_a': operator(ORG_A),
        'undelegated in org_d': operator(ORG_D, false),
      };
      const refused: string[] = [];
      let n = 0;
      for (const [label, context] of Object.entries(contexts)) {
        for (const object of PROVIDER_OBJECTS) {
          const cell = `${label} · ${object}`;
          const found = await attempt(() => b.engine.find(object, { context: { ...context } } as never));
          const row = { id: `parity_${++n}`, name: 'parity' };
          const inserted = await attempt(() => b.engine.insert(object, { ...row }, { context: { ...context } } as never));
          const answers = await probeAnswers(b, object, context);
          if (!found.ok) refused.push(cell);
          expect(answers.canReadObject, `${cell}: canReadObject ⇔ find`).toBe(found.ok);
          expect(answers.canExport, `${cell}: canExport ⇔ find (an export reads as a find)`).toBe(found.ok);
          expect(answers.explained.allowed, `${cell}: explain read ⇔ find`).toBe(found.ok);
          expect(answers.canWriteInsert, `${cell}: canWriteObject insert ⇔ insert`).toBe(inserted.ok);
        }
      }
      // Not vacuous on either side: the engine refuses exactly the delegated
      // context the delegator's membership does not back.
      expect(refused).toEqual(PROVIDER_OBJECTS.map((object) => `delegated in org_d · ${object}`));
    });
  }
});

describe('[#25107] every reader in this package that resolves a delegator asks the organization refusal', () => {
  // An enumeration pin over this package's own source: a reader that resolves
  // a delegator and does not ask the prologue's check is the defect this card
  // closed, at a site nobody has written yet. Each source file must ask the
  // check as often as it resolves a delegator (the definitions excluded).
  const SRC = dirname(fileURLToPath(import.meta.url));
  const calls = (text: string, name: string) =>
    (text.match(new RegExp(`\\b${name}\\(`, 'g')) ?? []).length - (text.match(new RegExp(`function ${name}\\(`, 'g')) ?? []).length;

  it('per source file, the asks equal the resolutions — and the three files that resolve one are all counted', () => {
    const counted: Record<string, [number, number]> = {};
    for (const file of readdirSync(SRC, { recursive: true }) as string[]) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.includes('.testkit.')) continue;
      const text = readFileSync(join(SRC, file), 'utf8');
      const resolutions = calls(text, 'resolveDelegatorContext');
      if (resolutions === 0) continue;
      counted[file] = [resolutions, calls(text, 'delegatedOrganizationRefusal')];
    }
    expect(Object.keys(counted).sort()).toEqual(['explain-engine.ts', 'security-plugin-operation-principals.ts', 'security-plugin.ts']);
    for (const [file, [resolutions, asks]] of Object.entries(counted)) expect(asks, file).toBe(resolutions);
  });
});
