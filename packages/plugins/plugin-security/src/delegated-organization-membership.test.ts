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
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { SysOrganization, SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysPosition, SysPermissionSet, SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

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
];

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const PLATFORM_ADMIN: PermissionSet = {
  name: 'admin_full_access',
  label: 'Platform Administrator',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
  },
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
} as unknown as PermissionSet;

/** A private object is outside the `'*'` grant, so the delegator holds it by name. */
const VAULT_WRITER: PermissionSet = {
  name: 'qa_vault_writer',
  label: 'Vault writer',
  objects: { qa_vault: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const SETS = [MEMBER, PLATFORM_ADMIN, VAULT_WRITER];

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

type Posture = 'group' | 'isolated' | 'single';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(posture: Posture) {
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
  engines.push(engine);

  for (const id of [ORG_A, ORG_C, ORG_D]) {
    await engine.insert('sys_organization', { id, name: id, slug: id }, { context: SYS_CTX } as never);
  }
  await engine.insert('sys_user', { id: DELEGATOR, name: DELEGATOR, email: 'delegator@example.test' }, { context: SYS_CTX } as never);
  for (const org of [ORG_A, ORG_C]) {
    await engine.insert('sys_member', { id: `mem_${org}`, user_id: DELEGATOR, organization_id: org, role: 'member' }, { context: SYS_CTX } as never);
  }
  const driverOf = (o: string) => (engine as unknown as { getDriver(x: string): { create(x: string, r: Record<string, unknown>): Promise<unknown> } }).getDriver(o);
  await driverOf('sys_permission_set').create('sys_permission_set', {
    id: 'ps_qa_vault_writer', name: 'qa_vault_writer', label: 'Vault writer', organization_id: null, managed_by: 'admin', active: true,
    object_permissions: JSON.stringify({}), system_permissions: JSON.stringify([]),
  });
  // The grant in `org_d` too: the D10 grant intersection must not be what
  // refuses a cell below, or removing the rule would leave the cell green.
  for (const org of [ORG_A, ORG_C, ORG_D]) {
    await engine.insert('sys_user_permission_set', { id: `ups_${org}`, user_id: DELEGATOR, permission_set: 'qa_vault_writer', organization_id: org }, { context: SYS_CTX } as never);
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
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
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
  return { engine, stored };
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
