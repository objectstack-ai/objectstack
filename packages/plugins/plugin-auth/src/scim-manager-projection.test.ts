// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The SCIM Enterprise `manager` attribute lands on `sys_user.manager_id`,
 * end to end through `@better-auth/scim` (`scim-manager-projection.ts`).
 *
 * Every case drives `AuthManager.handleRequest()` with a real SCIM bearer on a
 * real `ObjectQL` over better-sqlite3, because what the projection does is
 * only half the behaviour: the vendor's transaction decides whether a refused
 * reference leaves anything behind, and its after-hook decides the error body
 * the identity provider reads. Each refusal is a single-cause fixture, and
 * each asserts the SCIM error AND that nothing changed.
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { createTenancyService } from './tenancy-service.js';
import { mintScimConnectionCredential } from './scim-connection-service.js';
import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { MAX_MANAGER_CHAIN_DEPTH } from './admin-set-user-manager.js';
import { readScimManagerReference, SCIM_ENTERPRISE_USER_SCHEMA } from './scim-manager-projection.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';
import { sqliteEnginePool, type BootedSqliteEngine } from './__tests__/sqlite-engine-pool.testkit.js';
// Clocked windows measure behaviour, never loading (AGENTS.md, Build & Test).
import 'better-auth';
import 'better-auth/api';
import 'better-auth/db';
import 'better-auth/plugins';
import 'better-auth/plugins/admin';
import 'better-auth/plugins/bearer';
import 'better-auth/plugins/organization';
import 'better-auth/plugins/organization/access';
import '@better-auth/core/context';
import '@better-auth/core/error';
import '@better-auth/oauth-provider';
import '@better-auth/scim';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-scim-mgr';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

const SYSTEM = { context: { isSystem: true } } as const;
const ORG = 'org_acme_scim_mgr';
const OTHER_ORG = 'org_other_scim_mgr';
const CONNECTION = 'entra-scim-mgr';
const OTHER_CONNECTION = 'okta-scim-mgr';
const DEFAULT_ORG = 'org_default';

// The grant tables a SCIM deployment registers beside the identity objects;
// the last-administrator guard reads them on every user update.
const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    label: { name: 'label', type: 'text' as const },
    active: { name: 'active', type: 'boolean' as const },
  },
};

const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};

async function bootEngine(): Promise<BootedSqliteEngine> {
  const engine = new ObjectQL();
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of [...authIdentityObjects, sysPermissionSet, sysUserPermissionSet]) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  await engine.insert('sys_organization', { id: DEFAULT_ORG, name: 'Default Organization', slug: 'default' }, SYSTEM);
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
  registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.last-admin-guard' });
  return { engine, driver };
}

const enginePool = sqliteEnginePool(bootEngine, { keepBootOrganizations: true });
afterEach(enginePool.release);
afterAll(enginePool.destroy);

interface Harness {
  engine: ObjectQL;
  token: string;
  otherToken: string;
  send: (request: Request) => Promise<Response>;
}

async function boot(): Promise<Harness> {
  const engine = await enginePool.take();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { scim: true, organization: true },
  } as never);
  const { token } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: CONNECTION,
    organizationId: ORG,
  });
  const { token: otherToken } = await mintScimConnectionCredential(engine as never, SECRET, {
    connectionId: OTHER_CONNECTION,
    organizationId: ORG,
  });
  return { engine, token, otherToken, send: (request) => manager.handleRequest(request) };
}

function scimRequest(token: string, method: string, path: string, body?: unknown): Request {
  return new Request(`${AUTH}/scim/v2${path}`, {
    method,
    headers: {
      origin: BASE,
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/scim+json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

type Manager = { value?: string; $ref?: string };

/** A create in Entra ID's shape, with the Enterprise extension when a manager is given. */
function userBody(local: string, manager?: Manager) {
  const email = `${local}@acme.com`;
  return {
    schemas: manager ? [USER_SCHEMA, SCIM_ENTERPRISE_USER_SCHEMA] : [USER_SCHEMA],
    userName: email,
    externalId: `ext-${local}`,
    name: { givenName: local, familyName: 'Test' },
    displayName: `${local} Test`,
    emails: [{ value: email, type: 'work', primary: true }],
    active: true,
    ...(manager ? { [SCIM_ENTERPRISE_USER_SCHEMA]: { manager } } : {}),
  };
}

interface Provisioned {
  scimId: string;
  userId: string;
}

async function provision(h: Harness, local: string, manager?: Manager, token = h.token): Promise<Provisioned> {
  const res = await h.send(scimRequest(token, 'POST', '/Users', userBody(local, manager)));
  expect(res.status, `create ${local} failed: ${await res.clone().text()}`).toBe(201);
  const { id } = (await res.json()) as { id: string };
  return { scimId: id, userId: await userIdOf(h, `${local}@acme.com`) };
}

async function userIdOf(h: Harness, email: string): Promise<string> {
  const rows = (await h.engine.find('sys_user', { where: { email }, fields: ['id'] }, SYSTEM)) as Array<{ id: string }>;
  expect(rows).toHaveLength(1);
  return rows[0].id;
}

async function managerOf(h: Harness, userId: string): Promise<string | null> {
  const row = (await h.engine.findOne('sys_user', { where: { id: userId }, fields: ['manager_id'] }, SYSTEM)) as {
    manager_id?: string | null;
  };
  return row?.manager_id ?? null;
}

function patch(operations: unknown[]) {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
}

/** RFC 7644 §3.12: the error the identity provider reads, 400 `invalidValue`. */
async function expectInvalidValue(res: Response, code: string, detail: RegExp): Promise<void> {
  const text = await res.text();
  expect(res.status, `expected 400 invalidValue, got ${res.status} ${text}`).toBe(400);
  const body = JSON.parse(text) as { schemas?: string[]; status?: string; scimType?: string; code?: string; detail?: string };
  expect(body.schemas).toEqual([ERROR_SCHEMA]);
  expect(body.status).toBe('400');
  expect(body.scimType).toBe('invalidValue');
  expect(body.code).toBe(code);
  expect(body.detail).toMatch(detail);
}

describe('SCIM manager projection: the directory sets, changes and clears sys_user.manager_id', () => {
  it('a create carrying manager.value (the manager\'s SCIM id) links the user to that manager', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp', { value: boss.scimId });
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);
  });

  it('a $ref alone is read by its /Users/{id} segment', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp', { $ref: `${AUTH}/scim/v2/Users/${boss.scimId}` });
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);
  });

  it('a replace changes the manager, and a replace without the attribute clears it', async () => {
    const h = await boot();
    const first = await provision(h, 'first');
    const second = await provision(h, 'second');
    const emp = await provision(h, 'emp', { value: first.scimId });

    const changed = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp.scimId}`, userBody('emp', { value: second.scimId })));
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(second.userId);

    const cleared = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp.scimId}`, userBody('emp')));
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBeNull();
  });

  it('a PATCH replace sets it, and a PATCH remove clears it', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp');
    expect(await managerOf(h, emp.userId)).toBeNull();

    const set = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: boss.scimId } },
    ])));
    expect(set.status, await set.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);

    const removed = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'remove', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager` },
    ])));
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBeNull();
  });

  it('an unchanged manager is not judged again: a PATCH elsewhere is served though the chain above grew past the cap', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp', { value: boss.scimId });
    let below = boss.userId;
    for (let i = 0; i < MAX_MANAGER_CHAIN_DEPTH; i += 1) {
      const id = `usr_above_${i}`;
      await h.engine.insert('sys_user', { id, email: `above${i}@acme.com`, name: `Above ${i}`, email_verified: true }, SYSTEM);
      await h.engine.update('sys_user', { id: below, manager_id: id }, SYSTEM);
      below = id;
    }
    const renamed = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: 'displayName', value: 'Emp Renamed' },
    ])));
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);
  });

  it('a deprovision is never refused over a manager reference that no longer resolves', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp', { value: boss.scimId });
    const gone = await h.send(scimRequest(h.token, 'DELETE', `/Users/${boss.scimId}`));
    expect(gone.status, await gone.clone().text()).toBe(204);

    const deactivated = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: 'active', value: false },
    ])));
    expect(deactivated.status, await deactivated.clone().text()).toBe(200);
  });
});

describe('SCIM manager projection: a reference that names no known User is refused, never dropped', () => {
  it('an unknown manager.value refuses the create, and nothing of it is written', async () => {
    const h = await boot();
    const res = await h.send(scimRequest(h.token, 'POST', '/Users', userBody('emp', { value: 'no-such-scim-id' })));
    await expectInvalidValue(res, 'INVALID_REFERENCE', /names no User this connection provisioned/);
    expect(await h.engine.find('sys_user', { where: { email: 'emp@acme.com' }, fields: ['id'] }, SYSTEM)).toEqual([]);
    expect(await h.engine.find('sys_scim_user', { where: { user_name: 'emp@acme.com' }, fields: ['id'] }, SYSTEM)).toEqual([]);
  });

  it('the manager\'s externalId is not a SCIM resource id, so it is refused too', async () => {
    const h = await boot();
    await provision(h, 'boss');
    const res = await h.send(scimRequest(h.token, 'POST', '/Users', userBody('emp', { value: 'ext-boss' })));
    await expectInvalidValue(res, 'INVALID_REFERENCE', /names no User this connection provisioned/);
  });

  it('another connection\'s resource id is refused: an id means something only to the connection that issued it', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss', undefined, h.otherToken);
    const res = await h.send(scimRequest(h.token, 'POST', '/Users', userBody('emp', { value: boss.scimId })));
    await expectInvalidValue(res, 'INVALID_REFERENCE', /names no User this connection provisioned/);
  });

  it('a PATCH to an unknown manager keeps the manager the user had', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp', { value: boss.scimId });
    const res = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: 'no-such-scim-id' } },
    ])));
    await expectInvalidValue(res, 'INVALID_REFERENCE', /names no User this connection provisioned/);
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);
  });
});

describe('SCIM manager projection: the admin endpoint\'s four refusals, answered as SCIM errors', () => {
  it('self-assignment', async () => {
    const h = await boot();
    const emp = await provision(h, 'emp');
    const res = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: emp.scimId } },
    ])));
    await expectInvalidValue(res, 'INVALID_FIELD', /cannot be their own manager/);
    expect(await managerOf(h, emp.userId)).toBeNull();
  });

  it('a cycle', async () => {
    const h = await boot();
    const a = await provision(h, 'a');
    const b = await provision(h, 'b', { value: a.scimId });
    const res = await h.send(scimRequest(h.token, 'PATCH', `/Users/${a.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: b.scimId } },
    ])));
    await expectInvalidValue(res, 'RESOURCE_CONFLICT', /close a loop/);
    expect(await managerOf(h, a.userId)).toBeNull();
    expect(await managerOf(h, b.userId)).toBe(a.userId);
  });

  it('the depth cap', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    // MAX_MANAGER_CHAIN_DEPTH links already run above the boss, so one more edge is past the cap.
    let below = boss.userId;
    for (let i = 0; i < MAX_MANAGER_CHAIN_DEPTH; i += 1) {
      const id = `usr_chain_${i}`;
      await h.engine.insert('sys_user', { id, email: `chain${i}@acme.com`, name: `Chain ${i}`, email_verified: true }, SYSTEM);
      await h.engine.update('sys_user', { id: below, manager_id: id }, SYSTEM);
      below = id;
    }
    const res = await h.send(scimRequest(h.token, 'POST', '/Users', userBody('emp', { value: boss.scimId })));
    await expectInvalidValue(res, 'VALUE_OUT_OF_RANGE', new RegExp(`maximum of ${MAX_MANAGER_CHAIN_DEPTH} links`));
    expect(await h.engine.find('sys_user', { where: { email: 'emp@acme.com' }, fields: ['id'] }, SYSTEM)).toEqual([]);
  });

  it('a manager provably outside the user\'s organizations', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp');
    await h.engine.insert('sys_member', { id: 'mem_emp', user_id: emp.userId, organization_id: ORG, role: 'member' }, SYSTEM);
    await h.engine.insert('sys_member', { id: 'mem_boss', user_id: boss.userId, organization_id: OTHER_ORG, role: 'member' }, SYSTEM);
    const res = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: boss.scimId } },
    ])));
    await expectInvalidValue(res, 'INVALID_REFERENCE', /none of them an organization this user belongs to/);
    expect(await managerOf(h, emp.userId)).toBeNull();
  });
});

describe('readScimManagerReference', () => {
  it('reads value first, then the $ref segment, and names an unreadable $ref', () => {
    const attrs = (manager: unknown) => JSON.stringify({ enterprise: { manager } });
    expect(readScimManagerReference(undefined)).toEqual({ kind: 'none' });
    expect(readScimManagerReference(JSON.stringify({ schemas: [USER_SCHEMA] }))).toEqual({ kind: 'none' });
    expect(readScimManagerReference(attrs({ value: 'v1', $ref: 'https://x/Users/r1' }))).toEqual({ kind: 'id', id: 'v1' });
    expect(readScimManagerReference(attrs({ $ref: 'https://x/scim/v2/Users/r%201' }))).toEqual({ kind: 'id', id: 'r 1' });
    expect(readScimManagerReference(attrs({ $ref: 'https://x/people/r1' }))).toEqual({ kind: 'unreadable', ref: 'https://x/people/r1' });
  });
});
