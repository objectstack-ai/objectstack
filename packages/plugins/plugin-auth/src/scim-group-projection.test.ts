// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An identity provider's group push grants the permission set its
 * `sys_idp_group_mapping` row names, and only an ordinary one (ADR-0134 D4's
 * group seam, filled for permission sets).
 *
 * Every case drives the real producer: `AuthManager.handleRequest()` with a
 * real SCIM bearer over `@better-auth/scim`, whose `projection` is wired by
 * `buildPluginList` (nothing here names it), on a real ObjectQL engine over
 * better-sqlite3. The mapping is saved through the platform-admin door's own
 * function (`runSetIdpGroupMapping`), judged by the REAL `security` service of
 * `@objectstack/plugin-security` — its `organizationBoundaryFailure` member,
 * the delegated-administration gate's own predicate — over a test catalog.
 *
 * Faces: (1) a mapped group push grants the set, written by the SCIM
 * connection's actor; (2) removing the member revokes it; (3) a mapping naming
 * an administrator set and (4) one naming a set outside the organization
 * boundary are refused at save, code + status, and store nothing; (5) user
 * provisioning with no mapping still works. Controls: an unmapped group grants
 * nothing; a grant made by hand is never touched by reconcile.
 */

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { mintScimConnectionCredential } from './scim-connection-service.js';
import { runDeleteIdpGroupMapping, runSetIdpGroupMapping, type IdpGroupMappingAdminDeps } from './idp-group-mapping-admin.js';
import { scimGroupProjectionReason, type OrganizationBoundaryJudge } from './scim-group-projection.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { sqliteEnginePool, type BootedSqliteEngine } from './__tests__/sqlite-engine-pool.testkit.js';
import 'better-auth';
import 'better-auth/api';
import 'better-auth/plugins';
import 'better-auth/plugins/admin';
import 'better-auth/plugins/organization';
import '@better-auth/scim';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-30959';
const CONNECTION = 'okta-30959';
const ORG = 'org_scim_30959';
const SCIM_ACTOR = `svc:scim:${CONNECTION}`;
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SYSTEM = { context: { isSystem: true } } as const;

/** An ordinary set, inside the organization boundary. */
const SALES = 'sales_reader';
/** Outside the boundary by condition (c): a capability no catalog entry declares `scope: 'org'`. */
const PLATFORM_OPS = 'platform_ops';

/** The grant table, down to the columns the projection reads and writes. */
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    reason: { name: 'reason', type: 'text' as const },
  },
};

const enginePool = sqliteEnginePool(bootEngine, { keepBootOrganizations: true });
afterEach(enginePool.release);
afterEach(() => vi.restoreAllMocks());
afterAll(enginePool.destroy);

async function bootEngine(): Promise<BootedSqliteEngine> {
  const engine = new ObjectQL();
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of [...authIdentityObjects, sysUserPermissionSet]) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return { engine, driver };
}

/** The `security` service plugin-security registers, over a catalog bound to a stub engine (no middleware on the real one). */
async function securityService(): Promise<OrganizationBoundaryJudge> {
  const ql = bindTestSecurityCatalog(
    { registerMiddleware: vi.fn(), getSchema: () => undefined },
    { permissions: [{ name: SALES }, { name: ADMIN_FULL_ACCESS }, { name: PLATFORM_OPS, systemPermissions: ['manage_platform_settings'] }] },
  );
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => undefined, list: async () => [] },
  };
  const registerService = vi.fn();
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin();
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  const svc = registerService.mock.calls.find((c: unknown[]) => c[0] === 'security')?.[1] as Partial<OrganizationBoundaryJudge>;
  expect(typeof svc?.organizationBoundaryFailure, 'the security service serves organizationBoundaryFailure').toBe('function');
  return svc as OrganizationBoundaryJudge;
}

interface Harness {
  engine: ObjectQL;
  manager: AuthManager;
  token: string;
  door: IdpGroupMappingAdminDeps;
  send: (method: string, path: string, body?: unknown) => Promise<Response>;
}

async function boot(): Promise<Harness> {
  const engine = await enginePool.take();
  const judge = await securityService();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { scim: true, organization: true },
    organizationBoundary: async () => judge,
  } as never);
  const { token } = await mintScimConnectionCredential(engine as never, SECRET, { connectionId: CONNECTION, organizationId: ORG });
  const door: IdpGroupMappingAdminDeps = {
    getDataEngine: () => manager.getDataEngine() as never,
    isScimEnabled: () => manager.isScimWired(),
    boundary: () => manager.organizationBoundaryJudge(),
    reconcile: (domain) => manager.reconcileScimProjectionDomain(domain),
    attributed: (fn) => fn(),
  };
  const send = (method: string, path: string, body?: unknown) =>
    manager.handleRequest(
      new Request(`${AUTH}/scim/v2${path}`, {
        method,
        headers: {
          origin: BASE,
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
    );
  return { engine, manager, token, door, send };
}

const ADMIN = { id: 'usr_platform_admin' };

function saveMapping(h: Harness, body: Record<string, unknown>) {
  return runSetIdpGroupMapping(
    h.door,
    ADMIN,
    new Request(`${AUTH}/admin/scim/set-group-mapping`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
}

async function provision(h: Harness, localPart: string): Promise<{ scimId: string; userId: string }> {
  const email = `${localPart}@example.com`;
  const res = await h.send('POST', '/Users', {
    schemas: [USER_SCHEMA],
    userName: email,
    name: { givenName: localPart, familyName: 'Example' },
    emails: [{ value: email, primary: true, type: 'work' }],
    active: true,
  });
  expect(res.status, `SCIM POST /Users failed: ${await res.clone().text()}`).toBe(201);
  const scimId = ((await res.json()) as { id: string }).id;
  const row = (await h.engine.findOne('sys_user', { where: { email }, fields: ['id'] }, SYSTEM)) as { id: string } | null;
  expect(row, 'the SCIM create must have landed a sys_user row').toBeTruthy();
  return { scimId, userId: String(row!.id) };
}

async function pushGroup(h: Harness, group: { displayName: string; externalId?: string }, memberScimIds: string[]): Promise<string> {
  const res = await h.send('POST', '/Groups', {
    schemas: [GROUP_SCHEMA],
    displayName: group.displayName,
    ...(group.externalId ? { externalId: group.externalId } : {}),
    members: memberScimIds.map((value) => ({ value })),
  });
  expect(res.status, `SCIM POST /Groups failed: ${await res.clone().text()}`).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function removeMember(h: Harness, groupId: string, scimId: string): Promise<void> {
  const res = await h.send('PATCH', `/Groups/${groupId}`, {
    schemas: [PATCH_SCHEMA],
    Operations: [{ op: 'remove', path: `members[value eq "${scimId}"]` }],
  });
  expect(res.status, `SCIM PATCH /Groups remove failed: ${await res.clone().text()}`).toBeLessThan(300);
}

async function grantsOf(h: Harness, userId: string): Promise<Array<{ permission_set: string; organization_id: string | null; reason: string | null }>> {
  const rows = await h.engine.find('sys_user_permission_set', { where: { user_id: userId } }, SYSTEM);
  return (rows as Array<Record<string, unknown>>)
    .map((r) => ({ permission_set: String(r.permission_set), organization_id: (r.organization_id as string) ?? null, reason: (r.reason as string) ?? null }))
    .sort((a, b) => a.permission_set.localeCompare(b.permission_set));
}

/** Every grant-table write, with the actor its context carried (what the audit mirror records as `sys_audit_log.actor`). */
function observeGrantWrites(h: Harness): Array<{ op: string; actor: unknown }> {
  const writes: Array<{ op: string; actor: unknown }> = [];
  const engine = h.engine as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const op of ['insert', 'delete'] as const) {
    const original = engine[op].bind(h.engine);
    vi.spyOn(engine, op).mockImplementation(async (object: unknown, ...rest: unknown[]) => {
      if (object === 'sys_user_permission_set') {
        const options = (op === 'delete' ? rest[0] : rest[1]) as { context?: { actor?: unknown } } | undefined;
        writes.push({ op, actor: options?.context?.actor });
      }
      return original(object, ...rest);
    });
  }
  return writes;
}

const projected = (set: string) => ({ permission_set: set, organization_id: ORG, reason: scimGroupProjectionReason(CONNECTION) });

describe('SCIM group push → mapped permission set', () => {
  it('(1) a mapped group push grants the set in the connection\'s organization, written by the SCIM connection', async () => {
    const h = await boot();
    const saved = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const alice = await provision(h, 'alice');
    const writes = observeGrantWrites(h);

    await pushGroup(h, { displayName: 'Sales', externalId: 'okta-grp-sales' }, [alice.scimId]);

    expect(await grantsOf(h, alice.userId)).toEqual([projected(SALES)]);
    expect(writes).toEqual([{ op: 'insert', actor: SCIM_ACTOR }]);
  });

  it('(2) removing the member from the group revokes the projected grant', async () => {
    const h = await boot();
    await saveMapping(h, { connectionId: CONNECTION, groupDisplayName: 'Sales', permissionSet: SALES });
    const alice = await provision(h, 'alice');
    const groupId = await pushGroup(h, { displayName: 'Sales' }, [alice.scimId]);
    expect(await grantsOf(h, alice.userId)).toEqual([projected(SALES)]);
    const writes = observeGrantWrites(h);

    await removeMember(h, groupId, alice.scimId);

    expect(await grantsOf(h, alice.userId)).toEqual([]);
    expect(writes).toEqual([{ op: 'delete', actor: SCIM_ACTOR }]);
  });

  it('(3) a mapping naming an administrator set is refused at save and stores nothing', async () => {
    const h = await boot();
    const refused = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-admins', permissionSet: ADMIN_FULL_ACCESS });
    expect(refused.status).toBe(400);
    const error = (refused.body as { error: { code: string; fields: Array<{ field: string; code: string }> } }).error;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields.map((f) => [f.field, f.code])).toEqual([['permissionSet', 'rule_violation']]);
    expect(await h.engine.find('sys_idp_group_mapping', {}, SYSTEM)).toEqual([]);
  });

  it('(4) a mapping naming a set outside the organization boundary is refused at save and stores nothing', async () => {
    const h = await boot();
    const refused = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-ops', permissionSet: PLATFORM_OPS });
    expect(refused.status).toBe(400);
    const error = (refused.body as { error: { code: string; fields: Array<{ field: string; code: string }> } }).error;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields.map((f) => [f.field, f.code])).toEqual([['permissionSet', 'rule_violation']]);
    expect(await h.engine.find('sys_idp_group_mapping', {}, SYSTEM)).toEqual([]);
  });

  it('(5) with no mapping, provisioning and updating a user still work and grant nothing', async () => {
    const h = await boot();
    const bob = await provision(h, 'bob');
    const res = await h.send('PATCH', `/Users/${bob.scimId}`, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: 'replace', path: 'displayName', value: 'Bob Renamed' }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await grantsOf(h, bob.userId)).toEqual([]);
  });

  it('CONTROL: an unmapped group push grants nothing', async () => {
    const h = await boot();
    await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    const carol = await provision(h, 'carol');
    await pushGroup(h, { displayName: 'Sales', externalId: 'okta-grp-engineering' }, [carol.scimId]);
    expect(await grantsOf(h, carol.userId)).toEqual([]);
  });

  it('CONTROL: grants made by hand are never touched by reconcile, the same set included', async () => {
    const h = await boot();
    await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    const dave = await provision(h, 'dave');
    await h.engine.insert('sys_user_permission_set', { user_id: dave.userId, permission_set: ADMIN_FULL_ACCESS }, SYSTEM);
    await h.engine.insert('sys_user_permission_set', { user_id: dave.userId, permission_set: SALES, organization_id: ORG }, SYSTEM);
    const handMade = await grantsOf(h, dave.userId);

    const groupId = await pushGroup(h, { displayName: 'Sales', externalId: 'okta-grp-sales' }, [dave.scimId]);
    expect(await grantsOf(h, dave.userId), 'the set is already held: nothing is written beside it').toEqual(handMade);
    await removeMember(h, groupId, dave.scimId);

    expect(await grantsOf(h, dave.userId)).toEqual(handMade);
  });

  it('saving and deleting a mapping applies to the group\'s current members at once', async () => {
    const h = await boot();
    const erin = await provision(h, 'erin');
    await pushGroup(h, { displayName: 'Support', externalId: 'okta-grp-support' }, [erin.scimId]);
    expect(await grantsOf(h, erin.userId)).toEqual([]);

    const saved = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-support', permissionSet: SALES });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(await grantsOf(h, erin.userId)).toEqual([projected(SALES)]);

    const mappingId = (saved.body as { data: { mappingId: string } }).data.mappingId;
    const deleted = await runDeleteIdpGroupMapping(
      h.door,
      ADMIN,
      new Request(`${AUTH}/admin/scim/delete-group-mapping`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mappingId }) }),
    );
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(await grantsOf(h, erin.userId)).toEqual([]);
  });
});
