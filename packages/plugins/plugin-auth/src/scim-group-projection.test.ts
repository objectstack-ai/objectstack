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
import { MCP_AGENT_PERMISSION_SETS } from '@objectstack/spec/ai';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { mintScimConnectionCredential, revokeScimConnectionCredential } from './scim-connection-service.js';
import { runDeleteIdpGroupMapping, runSetIdpGroupMapping, type IdpGroupMappingAdminDeps } from './idp-group-mapping-admin.js';
import { createScimGroupProjection, scimGroupProjectionReason, type OrganizationBoundaryJudge } from './scim-group-projection.js';
import {
  IDP_GROUP_MAPPING_MATCH_PACKAGE_ID,
  refreshAllMappingMatches,
  registerIdpGroupMappingMatchTrigger,
} from './idp-group-mapping-match.js';
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
  // The match trigger auth-plugin binds at kernel:ready, so every case here runs with it.
  registerIdpGroupMappingMatchTrigger(engine as never);
  return { engine, driver };
}

/** The catalog the security service reads, rebuilt per boot; a case may redefine a set in place after its mapping is saved. */
let catalogPermissions: Array<Record<string, unknown>> = [];

/** The `security` service plugin-security registers, over a catalog bound to a stub engine (no middleware on the real one). */
async function securityService(): Promise<OrganizationBoundaryJudge> {
  catalogPermissions = [{ name: SALES }, { name: ADMIN_FULL_ACCESS }, { name: PLATFORM_OPS, systemPermissions: ['manage_platform_settings'] }];
  const ql = bindTestSecurityCatalog(
    { registerMiddleware: vi.fn(), getSchema: () => undefined },
    () => ({ permissions: catalogPermissions }),
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
  judge: OrganizationBoundaryJudge;
  credentialId: string;
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
  const { token, credentialId } = await mintScimConnectionCredential(engine as never, SECRET, { connectionId: CONNECTION, organizationId: ORG });
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
  return { engine, manager, token, credentialId, door, send, judge };
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

/** The id a successful save answered (the case fails here if the save was refused). */
function mappingIdOf(saved: Awaited<ReturnType<typeof runSetIdpGroupMapping>>): string {
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  if (!saved.body.success) throw new Error('the mapping save was refused');
  return String(saved.body.data.mappingId);
}

/** The state the vendor hands `reconcileUser` for one user whose one group maps to `mappingId`. */
function projectedState(userId: string, mappingId: string) {
  return {
    provisioningDomainId: CONNECTION,
    userId,
    active: true,
    sources: [],
    grants: [{ source: { type: 'group' as const, id: 'grp', externalId: 'okta-grp-sales', displayName: 'Sales' }, role: mappingId }],
  } as never;
}

/** `engine`, except that every row of `object` it reads back carries no `organization_id`. */
function withoutOrganization(engine: ObjectQL, object: string): never {
  const strip = (row: unknown) => (row && typeof row === 'object' ? { ...(row as Record<string, unknown>), organization_id: null } : row);
  return new Proxy(engine, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'find' || prop === 'findOne') {
        return async (name: string, ...rest: unknown[]) => {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).call(target, name, ...rest);
          if (name !== object) return result;
          return Array.isArray(result) ? result.map(strip) : strip(result);
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as never;
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
    await h.engine.insert('sys_user_permission_set', { user_id: dave.userId, permission_set: ADMIN_FULL_ACCESS, organization_id: ORG }, SYSTEM);
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

    const mappingId = mappingIdOf(saved);
    const deleted = await runDeleteIdpGroupMapping(
      h.door,
      ADMIN,
      new Request(`${AUTH}/admin/scim/delete-group-mapping`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mappingId }) }),
    );
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(await grantsOf(h, erin.userId)).toEqual([]);
  });
  it('(S1) a connection whose credentials carry no organization is refused at save, like one owned by two', async () => {
    const h = await boot();
    // This engine refuses an organization-less credential row outright, so the case is staged at the door's read:
    // a composition with no organization machinery (no sys_organization) stores the credential with none.
    const door: IdpGroupMappingAdminDeps = { ...h.door, getDataEngine: () => withoutOrganization(h.engine, 'sys_scim_connection_credential') };
    const refused = await runSetIdpGroupMapping(
      door,
      ADMIN,
      new Request(`${AUTH}/admin/scim/set-group-mapping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES }),
      }),
    );
    expect(refused.status).toBe(400);
    const error = (refused.body as { error: { code: string; fields: Array<{ field: string; code: string }> } }).error;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields.map((f) => [f.field, f.code])).toEqual([['connectionId', 'rule_violation']]);
    expect(await h.engine.find('sys_idp_group_mapping', {}, SYSTEM)).toEqual([]);
  });

  it('(S1) the projection never writes a grant without an organization, whatever a mapping row holds', async () => {
    const h = await boot();
    const saved = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    const mappingId = mappingIdOf(saved);
    const frank = await provision(h, 'frank');
    const warn = vi.fn();
    const projection = createScimGroupProjection({
      getEngine: () => withoutOrganization(h.engine, 'sys_idp_group_mapping') as never,
      boundary: async () => h.judge,
      warn,
    });

    await projection.reconcileUser(projectedState(frank.userId, mappingId), {} as never);

    expect(await grantsOf(h, frank.userId)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/no organization/);
  });

  it('(S2) reconcile judges the boundary itself: a set redefined as administrator after the save is not granted', async () => {
    const h = await boot();
    const saved = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const mappingId = mappingIdOf(saved);
    const gina = await provision(h, 'gina');
    catalogPermissions = catalogPermissions.map((p) => (p.name === SALES ? { ...p, adminScope: { businessUnits: ['*'] } } : p));
    expect(await h.judge.organizationBoundaryFailure(SALES), 'the redefined set is outside the boundary').not.toBeNull();
    const warn = vi.fn();

    // reconcileUser alone, as a vendor path that does not consult roles.exists first would call it.
    const projection = createScimGroupProjection({ getEngine: () => h.engine as never, boundary: async () => h.judge, warn });
    await projection.reconcileUser(projectedState(gina.userId, mappingId), {} as never);

    expect(await grantsOf(h, gina.userId)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/grants nothing/);

    // Through the vendor as well: the push lands, and grants nothing.
    await pushGroup(h, { displayName: 'Sales', externalId: 'okta-grp-sales' }, [gina.scimId]);
    expect(await grantsOf(h, gina.userId)).toEqual([]);
  });
  it('(S4) a revoked credential does not count: revoke in one organization, mint in another, and the save lands in the new one', async () => {
    const h = await boot();
    const ORG_B = 'org_scim_30959_b';
    expect((await revokeScimConnectionCredential(h.engine as never, h.credentialId)).outcome).toBe('revoked');
    await mintScimConnectionCredential(h.engine as never, SECRET, { connectionId: CONNECTION, organizationId: ORG_B });

    const saved = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });

    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((saved.body as unknown as { data: { organizationId: string } }).data.organizationId).toBe(ORG_B);
    const rows = (await h.engine.find('sys_idp_group_mapping', {}, SYSTEM)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.organization_id)).toEqual([ORG_B]);
  });

  it('(S5) a re-save after the connection moved organization is refused, never answered with an organization the row does not carry', async () => {
    const h = await boot();
    const first = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const mappingId = mappingIdOf(first);

    // CONTROL: a re-save in the same organization is idempotent.
    const again = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    expect(again.status).toBe(200);
    expect((again.body as unknown as { data: { mappingId: string; created: boolean; organizationId: string } }).data)
      .toMatchObject({ mappingId, created: false, organizationId: ORG });

    const ORG_B = 'org_scim_30959_b';
    await revokeScimConnectionCredential(h.engine as never, h.credentialId);
    await mintScimConnectionCredential(h.engine as never, SECRET, { connectionId: CONNECTION, organizationId: ORG_B });

    const refused = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    const error = (refused.body as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('RESOURCE_CONFLICT');
    expect(error.message).toContain(mappingId);
    expect(error.message).toContain(ORG);
    const rows = (await h.engine.find('sys_idp_group_mapping', {}, SYSTEM)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.id, r.organization_id])).toEqual([[mappingId, ORG]]);
  });

  it('(S4) a connection whose every credential is revoked is refused at save', async () => {
    const h = await boot();
    await revokeScimConnectionCredential(h.engine as never, h.credentialId);
    const refused = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES });
    expect(refused.status).toBe(400);
    const error = (refused.body as { error: { code: string; fields: Array<{ field: string; code: string }> } }).error;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields.map((f) => [f.field, f.code])).toEqual([['connectionId', 'rule_violation']]);
    expect(await h.engine.find('sys_idp_group_mapping', {}, SYSTEM)).toEqual([]);
  });
});

// [ADR-0090 D10, D12] The projection writes its grants as the system, so the
// agent ceiling refusal on the grant table stands down for it; what keeps an
// agent ceiling set off a person here is the organization boundary's by-name
// denylist, asked at the mapping's save and again before each projected grant.
describe('an identity-provider group mapping never grants an agent ceiling set', () => {
  it.each([...MCP_AGENT_PERMISSION_SETS])('the mapping save refuses %s and stores nothing', async (ceiling) => {
    const h = await boot();
    const refused = await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-agents', permissionSet: ceiling });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    const error = (refused.body as { error: { code: string; fields: Array<{ field: string; code: string }> } }).error;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fields.map((f) => [f.field, f.code])).toEqual([['permissionSet', 'rule_violation']]);
    expect(await h.engine.find('sys_idp_group_mapping', {}, SYSTEM)).toEqual([]);
  });

  it('positive control: the mapping save admits an ordinary set', async () => {
    const h = await boot();
    mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES }));
    expect(((await h.engine.find('sys_idp_group_mapping', {}, SYSTEM)) as Array<Record<string, unknown>>).map((r) => r.permission_set))
      .toEqual([SALES]);
  });

  it.each([...MCP_AGENT_PERMISSION_SETS])('a stored mapping naming %s grants nothing at the per-grant admission', async (ceiling) => {
    const h = await boot();
    const mappingId = mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES }));
    // A row that reached the table without the save's judgment.
    await h.engine.update('sys_idp_group_mapping', { id: mappingId, permission_set: ceiling }, SYSTEM);
    const hana = await provision(h, 'hana');
    const warn = vi.fn();
    const projection = createScimGroupProjection({ getEngine: () => h.engine as never, boundary: async () => h.judge, warn });

    await projection.reconcileUser(projectedState(hana.userId, mappingId), {} as never);

    expect(await grantsOf(h, hana.userId)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/grants nothing/);
  });

  it('positive control: the per-grant admission grants an ordinary set', async () => {
    const h = await boot();
    const mappingId = mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES }));
    const ivan = await provision(h, 'ivan');
    const projection = createScimGroupProjection({ getEngine: () => h.engine as never, boundary: async () => h.judge, warn: vi.fn() });

    await projection.reconcileUser(projectedState(ivan.userId, mappingId), {} as never);

    expect(await grantsOf(h, ivan.userId)).toEqual([projected(SALES)]);
  });
});

// #32121: the mapping row says whether it matches a group its connection pushes
// now, so a console can show "matches no current group". It describes the row;
// the projection still decides the grant (a mapping matching nothing grants nothing).
describe('a group mapping says whether it matches a current group of its source', () => {
  const MAPPING = 'sys_idp_group_mapping';

  async function matchOf(h: Harness, mappingId: string) {
    const row = (await h.engine.findOne(MAPPING, { where: { id: mappingId } }, SYSTEM)) as Record<string, unknown> | null;
    expect(row, `mapping ${mappingId} must exist`).toBeTruthy();
    return { status: row!.match_status ?? null, groupId: row!.matched_group_id ?? null, changedAt: row!.match_changed_at ?? null };
  }

  async function renameGroup(h: Harness, groupId: string, displayName: string): Promise<void> {
    const res = await h.send('PATCH', `/Groups/${groupId}`, {
      schemas: [PATCH_SCHEMA],
      Operations: [{ op: 'replace', path: 'displayName', value: displayName }],
    });
    expect(res.status, `SCIM PATCH /Groups rename failed: ${await res.clone().text()}`).toBeLessThan(300);
  }

  /** Every write to the mapping table, by the columns it set. */
  function observeMappingUpdates(h: Harness): Array<string[]> {
    const writes: Array<string[]> = [];
    const engine = h.engine as unknown as Record<string, (...a: unknown[]) => unknown>;
    const original = engine.update.bind(h.engine);
    vi.spyOn(engine, 'update').mockImplementation(async (object: unknown, data: unknown, ...rest: unknown[]) => {
      if (object === MAPPING) writes.push(Object.keys(data as Record<string, unknown>).filter((k) => k !== 'id').sort());
      return original(object, data, ...rest);
    });
    return writes;
  }

  it('rename the group: the mapping reads unmatched and grants nothing; rename back: matched, and the grant returns', async () => {
    const h = await boot();
    const mappingId = mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupDisplayName: 'ObjectOS SCIM Test', permissionSet: SALES }));
    const alice = await provision(h, 'alice');
    const groupId = await pushGroup(h, { displayName: 'ObjectOS SCIM Test' }, [alice.scimId]);
    expect(await matchOf(h, mappingId)).toMatchObject({ status: 'matched', groupId });
    expect(await grantsOf(h, alice.userId)).toEqual([projected(SALES)]);

    await renameGroup(h, groupId, 'ObjectOS SCIM Test (renamed)');

    const unmatched = await matchOf(h, mappingId);
    expect(unmatched).toMatchObject({ status: 'unmatched', groupId: null });
    expect(unmatched.changedAt, 'the moment it stopped matching is recorded').toBeTruthy();
    expect(await grantsOf(h, alice.userId), 'fail closed is unchanged: a mapping matching nothing grants nothing').toEqual([]);

    await renameGroup(h, groupId, 'ObjectOS SCIM Test');

    expect(await matchOf(h, mappingId)).toMatchObject({ status: 'matched', groupId });
    expect(await grantsOf(h, alice.userId)).toEqual([projected(SALES)]);
  });

  it('a group with no members still moves the answer: saved before the push, pushed, deleted', async () => {
    const h = await boot();
    const mappingId = mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-ops', permissionSet: SALES }));
    expect(await matchOf(h, mappingId), 'no group pushed yet').toMatchObject({ status: 'unmatched', groupId: null });

    const groupId = await pushGroup(h, { displayName: 'Ops', externalId: 'okta-grp-ops' }, []);
    expect(await matchOf(h, mappingId)).toMatchObject({ status: 'matched', groupId });

    const res = await h.send('DELETE', `/Groups/${groupId}`);
    expect(res.status, `SCIM DELETE /Groups failed: ${await res.clone().text()}`).toBe(204);
    expect(await matchOf(h, mappingId)).toMatchObject({ status: 'unmatched', groupId: null });
  });

  it('a mapping by external id keeps matching when only the display name changes (PUT)', async () => {
    const h = await boot();
    const mappingId = mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupExternalId: 'okta-grp-sales', permissionSet: SALES }));
    const groupId = await pushGroup(h, { displayName: 'Sales', externalId: 'okta-grp-sales' }, []);
    const before = await matchOf(h, mappingId);
    expect(before).toMatchObject({ status: 'matched', groupId });

    const res = await h.send('PUT', `/Groups/${groupId}`, { schemas: [GROUP_SCHEMA], displayName: 'Sales EMEA', externalId: 'okta-grp-sales', members: [] });
    expect(res.status, `SCIM PUT /Groups failed: ${await res.clone().text()}`).toBe(200);

    expect(await matchOf(h, mappingId)).toEqual(before);
  });

  it('a membership change writes nothing to the mapping row (its history shows only real transitions)', async () => {
    const h = await boot();
    const mappingId = mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupDisplayName: 'Sales', permissionSet: SALES }));
    const alice = await provision(h, 'alice');
    const groupId = await pushGroup(h, { displayName: 'Sales' }, [alice.scimId]);
    const before = await matchOf(h, mappingId);
    const writes = observeMappingUpdates(h);

    await removeMember(h, groupId, alice.scimId);

    expect(writes).toEqual([]);
    expect(await matchOf(h, mappingId)).toEqual(before);
  });

  it('a mapping whose source is an SSO provider reads not applicable', async () => {
    const h = await boot();
    const inserted = (await h.engine.insert(
      MAPPING,
      { source_kind: 'sso', source_id: 'okta-oidc', group_external_id: 'grp-sales', permission_set: SALES, organization_id: ORG },
      SYSTEM,
    )) as { id: string };
    expect(await matchOf(h, inserted.id)).toMatchObject({ status: 'not_applicable', groupId: null });
  });

  it('the boot sweep rights a row saved before the columns existed, and leaves a right row alone', async () => {
    const h = await boot();
    const stale = mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupDisplayName: 'Sales', permissionSet: SALES }));
    const groupId = await pushGroup(h, { displayName: 'Sales' }, []);
    // A row as an older version left it: no match columns at all.
    await h.engine.update(MAPPING, { id: stale, match_status: null, matched_group_id: null, match_changed_at: null }, SYSTEM);
    expect(await matchOf(h, stale)).toEqual({ status: null, groupId: null, changedAt: null });

    expect(await refreshAllMappingMatches(h.engine as never)).toBe(1);
    expect(await matchOf(h, stale)).toMatchObject({ status: 'matched', groupId });
    expect(await refreshAllMappingMatches(h.engine as never), 'a second sweep finds nothing to write').toBe(0);
  });

  it('a failure to re-judge never fails the SCIM write: the rename lands, the grant follows, the failure is logged at error', async () => {
    const h = await boot();
    const error = vi.fn();
    registerIdpGroupMappingMatchTrigger(h.engine as never, { packageId: IDP_GROUP_MAPPING_MATCH_PACKAGE_ID, logger: { error } });
    try {
      const mappingId = mappingIdOf(await saveMapping(h, { connectionId: CONNECTION, groupDisplayName: 'Sales', permissionSet: SALES }));
      const alice = await provision(h, 'alice');
      const groupId = await pushGroup(h, { displayName: 'Sales' }, [alice.scimId]);
      const engine = h.engine as unknown as Record<string, (...a: unknown[]) => unknown>;
      const original = engine.update.bind(h.engine);
      vi.spyOn(engine, 'update').mockImplementation(async (object: unknown, ...rest: unknown[]) => {
        if (object === MAPPING) throw new Error('mapping table unwritable');
        return original(object, ...rest);
      });

      await renameGroup(h, groupId, 'Sales (renamed)');

      const group = (await h.engine.findOne('sys_scim_group', { where: { id: groupId } }, SYSTEM)) as Record<string, unknown>;
      expect(group.display_name).toBe('Sales (renamed)');
      expect(await grantsOf(h, alice.userId)).toEqual([]);
      expect(await matchOf(h, mappingId), 'the stale answer stays until the next write or boot').toMatchObject({ status: 'matched', groupId });
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain(`SCIM connection '${CONNECTION}'`);
    } finally {
      registerIdpGroupMappingMatchTrigger(h.engine as never);
    }
  });
});
