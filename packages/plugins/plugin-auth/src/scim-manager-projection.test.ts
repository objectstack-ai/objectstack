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
 * each asserts the SCIM error AND that nothing changed. An unresolvable
 * reference is served (maintainer ruling record 6909383114): each shape
 * asserts the write landed, the column did not move, and the operator warn.
 * The two doors (this projection and the admin endpoint) read one ownership
 * predicate (seat ruling record 6907953084), pinned from both sides. The
 * ledger half of the ruling, one bounded `scim_manager_unresolved` event per
 * admitted warn, is pinned on the `audit` slot the door hands it to; the row
 * the writer builds from it is pinned in plugin-audit's `scim-refusal-audit.test.ts`.
 */

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
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
import { MAX_MANAGER_CHAIN_DEPTH, applyUserManagerLink, directoryOwnsUserManager } from './admin-set-user-manager.js';
import {
  createScimManagerProjection,
  readScimManagerReference,
  scimBodyNamesManager,
  SCIM_ENTERPRISE_USER_SCHEMA,
} from './scim-manager-projection.js';
import { scimRequestScope } from './scim-connection-service.js';
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
  /** The operator warns the projection said about an unresolvable reference. */
  unresolvedWarns: () => string[];
  /** The `scim_manager_unresolved` events handed to the `audit` slot, after the responses settle. */
  unresolvedEvents: () => Promise<Array<Record<string, unknown>>>;
}

async function boot(): Promise<Harness> {
  const engine = await enginePool.take();
  const warn = vi.fn();
  const recordScimManagerUnresolved = vi.fn(async () => undefined);
  const auditSink = { recordAuthEvent: vi.fn(async () => undefined), recordScimManagerUnresolved };
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    getAuditSink: () => auditSink,
    logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
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
  const unresolvedWarns = () => warn.mock.calls
    .map(([message]) => String(message))
    .filter((message) => message.includes('manager reference that names no User'));
  const unresolvedEvents = async () => {
    // The hand-off runs after the response (`setImmediate`); let it run.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    return recordScimManagerUnresolved.mock.calls.map((call) => (call as unknown[])[0] as Record<string, unknown>);
  };
  return { engine, token, otherToken, send: (request) => manager.handleRequest(request), unresolvedWarns, unresolvedEvents };
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

/** The admin endpoint's door, on the harness engine. */
function adminSetManager(h: Harness, userId: string, managerId: string | null) {
  return applyUserManagerLink({ getDataEngine: () => h.engine as never }, userId, managerId);
}

/** A local password: D4 keeps the user `env_native`, so no directory holds its manager. */
async function giveLocalPassword(h: Harness, userId: string): Promise<void> {
  await h.engine.insert('sys_account', {
    id: `acc_cred_${userId}`, provider_id: 'credential', account_id: userId, user_id: userId,
  }, SYSTEM);
  await h.engine.update('sys_user', { id: userId, source: 'env_native' }, SYSTEM);
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

    // A replace NAMES the manager, so it reaches the projection: the same
    // manager is not judged again, though linking it afresh would be past the cap.
    const resent = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp.scimId}`, userBody('emp', { value: boss.scimId })));
    expect(resent.status, await resent.clone().text()).toBe(200);
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

describe('SCIM manager projection: a reference that names no User is served, and the column stays', () => {
  it('an unknown manager.value: the create lands, manager_id stays empty, and the operator is told', async () => {
    const h = await boot();
    const emp = await provision(h, 'emp', { value: 'no-such-scim-id' });
    expect(await managerOf(h, emp.userId)).toBeNull();
    const warns = h.unresolvedWarns();
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(`'${CONNECTION}'`);
  });

  it('the manager\'s externalId is not a SCIM resource id: served, nothing linked', async () => {
    const h = await boot();
    await provision(h, 'boss');
    const emp = await provision(h, 'emp', { value: 'ext-boss' });
    expect(await managerOf(h, emp.userId)).toBeNull();
    expect(h.unresolvedWarns()).toHaveLength(1);
  });

  it('another connection\'s resource id means nothing to this one: served, nothing linked', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss', undefined, h.otherToken);
    const emp = await provision(h, 'emp', { value: boss.scimId });
    expect(await managerOf(h, emp.userId)).toBeNull();
    expect(h.unresolvedWarns()).toHaveLength(1);
  });

  it('a $ref with no /Users/{id} segment, or one that does not decode, is served (not a 500)', async () => {
    const h = await boot();
    const a = await provision(h, 'a', { $ref: 'https://idp.example/people/r1' });
    const b = await provision(h, 'b', { $ref: `${AUTH}/scim/v2/Users/%E0%A4%A` });
    expect(await managerOf(h, a.userId)).toBeNull();
    expect(await managerOf(h, b.userId)).toBeNull();
  });

  it('a PATCH to an unknown manager is served and keeps the manager the user had', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp', { value: boss.scimId });
    const res = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: 'no-such-scim-id' } },
      { op: 'replace', path: 'displayName', value: 'Emp Renamed' },
    ])));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);
    const rows = (await h.engine.find('sys_user', { where: { id: emp.userId }, fields: ['name'] }, SYSTEM)) as Array<{ name?: string }>;
    expect(rows[0]?.name).toBe('Emp Renamed');
  });

  it('the operator warn is bounded per connection: a second unresolvable write in the window says nothing', async () => {
    const h = await boot();
    await provision(h, 'a', { value: 'no-such-1' });
    await provision(h, 'b', { value: 'no-such-2' });
    await provision(h, 'c', { value: 'no-such-3' });
    expect(h.unresolvedWarns()).toHaveLength(1);
  });

  it('a report whose manager was deleted keeps working: a write that names no manager, and a replace re-sending the dangling one', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp', { value: boss.scimId });
    const gone = await h.send(scimRequest(h.token, 'DELETE', `/Users/${boss.scimId}`));
    expect(gone.status, await gone.clone().text()).toBe(204);
    const before = await managerOf(h, emp.userId);

    const renamed = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: 'displayName', value: 'Emp Renamed' },
    ])));
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(before);
    expect(h.unresolvedWarns()).toHaveLength(0);

    const replaced = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp.scimId}`, userBody('emp', { value: boss.scimId })));
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(before);
    expect(h.unresolvedWarns()).toHaveLength(1);
  });
});

describe('[#33918] SCIM manager projection: an unresolvable reference leaves one bounded audit row per warn', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a served write hands the slot ONE event: the connection, its organization, the user and the reference, nothing else', async () => {
    const h = await boot();
    const emp = await provision(h, 'emp', { value: 'no-such-scim-id' });
    expect(await h.unresolvedEvents()).toEqual([
      { connectionId: CONNECTION, organizationId: ORG, userId: emp.userId, referenceKind: 'id', reference: 'no-such-scim-id' },
    ]);
  });

  it('an unreadable $ref is recorded as such, with the $ref as the directory sent it', async () => {
    const h = await boot();
    const emp = await provision(h, 'emp', { $ref: 'https://idp.example/people/r1' });
    expect(await h.unresolvedEvents()).toEqual([
      { connectionId: CONNECTION, organizationId: ORG, userId: emp.userId, referenceKind: 'unreadable', reference: 'https://idp.example/people/r1' },
    ]);
  });

  it('the reference is capped, and nothing of the body rides with it', async () => {
    const h = await boot();
    // The vendor caps `manager.value` at 256 characters but a `$ref` at 2048,
    // so a long unreadable `$ref` is what reaches the door's cap.
    const long = `https://idp.example/people/${'x'.repeat(400)}`;
    await provision(h, 'emp', { $ref: long });
    const [event] = await h.unresolvedEvents();
    expect(String(event?.reference)).toBe(long.slice(0, 257));
    const carried = JSON.stringify(event);
    for (const value of ['emp@acme.com', 'ext-emp', 'emp Test', 'givenName']) {
      expect(carried.includes(value), `the event carries ${value}: ${carried}`).toBe(false);
    }
  });

  it('a manager.value past 256 characters is the vendor\'s 400: nothing written, no row', async () => {
    const h = await boot();
    const res = await h.send(scimRequest(h.token, 'POST', '/Users', userBody('emp', { value: 'v'.repeat(257) })));
    const text = await res.text();
    expect(res.status, text).toBe(400);
    expect((JSON.parse(text) as { scimType?: string }).scimType).toBe('invalidValue');
    expect(await h.engine.find('sys_user', { where: { email: 'emp@acme.com' }, fields: ['id'] }, SYSTEM)).toEqual([]);
    expect(await h.unresolvedEvents()).toEqual([]);
    expect(h.unresolvedWarns()).toHaveLength(0);
  });

  it('rows follow the warn\'s rate: one per connection per window, and the next carries the dropped count', async () => {
    const h = await boot();
    await provision(h, 'a', { value: 'no-such-1' });
    await provision(h, 'b', { value: 'no-such-2' });
    await provision(h, 'c', { value: 'no-such-3' });
    expect(await h.unresolvedEvents()).toHaveLength(1);
    expect(h.unresolvedWarns()).toHaveLength(1);

    const later = Date.now() + 11 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const d = await provision(h, 'd', { value: 'no-such-4' });
    const events = await h.unresolvedEvents();
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      connectionId: CONNECTION, organizationId: ORG, userId: d.userId, referenceKind: 'id', reference: 'no-such-4', suppressed: 2,
    });
    expect(h.unresolvedWarns()).toHaveLength(2);
  });

  it('a connection\'s own User whose platform user is gone names no User: a create and a replace are served, one warn and one row each', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const ex = await provision(h, 'ex');
    const emp2 = await provision(h, 'emp2', { value: ex.scimId });
    expect(await managerOf(h, emp2.userId)).toBe(ex.userId);
    // The vendor's scimUser row stays and its sys_user goes: removed at the
    // driver, past the engine's restrict, the way an out-of-band delete lands.
    const driver = (h.engine as unknown as { getDriver: (object: string) => { delete: (object: string, id: string) => Promise<unknown> } })
      .getDriver('sys_user');
    await driver.delete('sys_user', boss.userId);
    expect(await h.engine.find('sys_user', { where: { id: boss.userId }, fields: ['id'] }, SYSTEM), 'the boss row is gone').toEqual([]);

    const res = await h.send(scimRequest(h.token, 'POST', '/Users', userBody('emp1', { value: boss.scimId })));
    expect(res.status, await res.clone().text()).toBe(201);
    const emp1 = await userIdOf(h, 'emp1@acme.com');
    expect(await managerOf(h, emp1)).toBeNull();
    expect(h.unresolvedWarns()).toHaveLength(1);
    expect(await h.unresolvedEvents()).toEqual([
      { connectionId: CONNECTION, organizationId: ORG, userId: emp1, referenceKind: 'id', reference: boss.scimId },
    ]);

    // A fresh window, so the replace's warn and row are its own.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    const replaced = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp2.scimId}`, userBody('emp2', { value: boss.scimId })));
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    expect(await managerOf(h, emp2.userId)).toBe(ex.userId);
    expect(h.unresolvedWarns()).toHaveLength(2);
    const events = await h.unresolvedEvents();
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      connectionId: CONNECTION, organizationId: ORG, userId: emp2.userId, referenceKind: 'id', reference: boss.scimId,
    });
  });

  it('no row on the served-unchanged paths: a resolved manager re-sent, a write that names none, a dangling one left alone', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp', { value: boss.scimId });
    const resent = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp.scimId}`, userBody('emp', { value: boss.scimId })));
    expect(resent.status, await resent.clone().text()).toBe(200);
    const gone = await h.send(scimRequest(h.token, 'DELETE', `/Users/${boss.scimId}`));
    expect(gone.status, await gone.clone().text()).toBe(204);
    const renamed = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: 'displayName', value: 'Emp Renamed' },
    ])));
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);
    expect(await h.unresolvedEvents()).toEqual([]);
  });

  it('no row on the structural refusals: the write was refused and rolled back', async () => {
    const h = await boot();
    const a = await provision(h, 'a');
    const b = await provision(h, 'b', { value: a.scimId });
    const self = await h.send(scimRequest(h.token, 'PATCH', `/Users/${a.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: a.scimId } },
    ])));
    await expectInvalidValue(self, 'INVALID_FIELD', /cannot be their own manager/);
    const cycle = await h.send(scimRequest(h.token, 'PATCH', `/Users/${a.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: b.scimId } },
    ])));
    await expectInvalidValue(cycle, 'RESOURCE_CONFLICT', /close a loop/);
    expect(await h.unresolvedEvents()).toEqual([]);
  });

  it('a request refused after the warn admitted its reference records nothing', async () => {
    const recordScimManagerUnresolved = vi.fn(async () => undefined);
    const { observeScimManagerUnresolved } = await import('./scim-manager-projection.js');
    const note = { userId: 'usr_emp', referenceKind: 'id' as const, reference: 'no-such', suppressed: 0 };
    observeScimManagerUnresolved({ recordScimManagerUnresolved } as never, 409, { connectionId: CONNECTION, userManagerUnresolved: note });
    observeScimManagerUnresolved({ recordScimManagerUnresolved } as never, 500, { connectionId: CONNECTION, userManagerUnresolved: note });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recordScimManagerUnresolved).not.toHaveBeenCalled();

    // Control: the same note on a served answer is handed over.
    observeScimManagerUnresolved({ recordScimManagerUnresolved } as never, 200, { connectionId: CONNECTION, userManagerUnresolved: note });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recordScimManagerUnresolved).toHaveBeenCalledTimes(1);
  });
});

describe('SCIM manager projection: silence is not a clear, and one predicate decides which door owns the column', () => {
  it('a write that does not name manager keeps a value the admin route set; a replace without it clears it', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp');
    // Set through the admin route while the user held a local password …
    await giveLocalPassword(h, emp.userId);
    expect(await adminSetManager(h, emp.userId, boss.userId)).toBeNull();
    // … then the password went and the directory holds the identity again.
    await h.engine.delete('sys_account', { where: { id: `acc_cred_${emp.userId}` }, ...SYSTEM });
    await h.engine.update('sys_user', { id: emp.userId, source: 'idp_provisioned' }, SYSTEM);
    expect(await directoryOwnsUserManager(h.engine as never, emp.userId)).toBe(true);

    const renamed = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: 'displayName', value: 'Emp Renamed' },
    ])));
    expect(renamed.status, await renamed.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);

    // The explicit PATCH remove is pinned above, on a manager the directory
    // set: a remove of an attribute the directory's resource never carried
    // changes nothing the vendor stores, and it answers without calling back.
    const cleared = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp.scimId}`, userBody('emp')));
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBeNull();
  });

  it('on an identity the directory does not hold, the projection writes nothing and the admin route owns the column', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const other = await provision(h, 'other');
    const emp = await provision(h, 'emp');
    await giveLocalPassword(h, emp.userId);
    expect(await directoryOwnsUserManager(h.engine as never, emp.userId)).toBe(false);

    const named = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: boss.scimId } },
    ])));
    expect(named.status, await named.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBeNull();

    expect(await adminSetManager(h, emp.userId, other.userId)).toBeNull();
    const replaced = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp.scimId}`, userBody('emp')));
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(other.userId);
  });

  it('on an identity the directory holds, the admin route refuses and the projection writes', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp');
    expect(await directoryOwnsUserManager(h.engine as never, emp.userId)).toBe(true);

    const refused = await adminSetManager(h, emp.userId, boss.userId);
    expect(refused?.status).toBe(403);
    expect(refused?.code).toBe('PERMISSION_DENIED');
    expect(refused?.reason).toBe('idp_provisioned');
    expect(await managerOf(h, emp.userId)).toBeNull();

    const named = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: boss.scimId } },
    ])));
    expect(named.status, await named.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);
  });
});

describe('SCIM manager projection: the cases it does not project', () => {
  it('an inactive user: a manager named while inactive is not written, re-activation alone does not apply it, the next replace does', async () => {
    const h = await boot();
    const boss = await provision(h, 'boss');
    const emp = await provision(h, 'emp');
    const deactivated = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: 'active', value: false },
      { op: 'replace', path: `${SCIM_ENTERPRISE_USER_SCHEMA}:manager`, value: { value: boss.scimId } },
    ])));
    expect(deactivated.status, await deactivated.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBeNull();

    const reactivated = await h.send(scimRequest(h.token, 'PATCH', `/Users/${emp.scimId}`, patch([
      { op: 'replace', path: 'active', value: true },
    ])));
    expect(reactivated.status, await reactivated.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBeNull();

    // A PATCH re-sending the same value changes nothing the vendor stores, so
    // it answers without calling back; a replace always calls back.
    const replaced = await h.send(scimRequest(h.token, 'PUT', `/Users/${emp.scimId}`, userBody('emp', { value: boss.scimId })));
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    expect(await managerOf(h, emp.userId)).toBe(boss.userId);
  });

  // The two branches below have no public door that reaches them in one
  // request (a connection decommission, a provisioning-domain replay, a user
  // two connections share), so they drive the callback itself; each carries
  // its control leg, where the same call goes on to read the engine.
  const state = { userId: 'usr_emp', active: true, profileSourceId: 'src_emp', sources: [] } as never;
  const contextFor = (connectionId: string) => {
    const findOne = vi.fn(async () => ({ id: 'src_emp', userId: 'usr_emp', connectionId, serializedAttributes: '' }));
    return { findOne, context: { database: { findOne } } as never };
  };
  const noEngine = () => {
    const getDataEngine = vi.fn(() => undefined);
    return { getDataEngine, project: createScimManagerProjection({ getDataEngine }) };
  };

  it('outside a SCIM request (a decommission or a domain replay): nothing is read or written', async () => {
    const { getDataEngine, project } = noEngine();
    const { findOne, context } = contextFor(CONNECTION);
    await expect(project(state, context)).resolves.toBeUndefined();
    expect(findOne).not.toHaveBeenCalled();
    expect(getDataEngine).not.toHaveBeenCalled();

    // Control: the same call inside a SCIM request that names the manager reaches the engine.
    await expect(scimRequestScope.run(
      { scim: true, connectionId: CONNECTION, userManagerIntent: 'named' },
      () => project(state, context),
    )).rejects.toThrow(/no data engine/);
    expect(getDataEngine).toHaveBeenCalledTimes(1);
  });

  it('a profile source another connection owns: that connection authors this user\'s profile, so nothing is written', async () => {
    const { getDataEngine, project } = noEngine();
    const { findOne, context } = contextFor(OTHER_CONNECTION);
    await expect(scimRequestScope.run(
      { scim: true, connectionId: CONNECTION, userManagerIntent: 'named' },
      () => project(state, context),
    )).resolves.toBeUndefined();
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(getDataEngine).not.toHaveBeenCalled();

    // Control: the profile source's own connection reaches the engine.
    await expect(scimRequestScope.run(
      { scim: true, connectionId: OTHER_CONNECTION, userManagerIntent: 'named' },
      () => project(state, context),
    )).rejects.toThrow(/no data engine/);
    expect(getDataEngine).toHaveBeenCalledTimes(1);
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
  it('reads value first, then the $ref segment; a $ref with no segment, or one that does not decode, is unreadable', () => {
    const attrs = (manager: unknown) => JSON.stringify({ enterprise: { manager } });
    expect(readScimManagerReference(undefined)).toEqual({ kind: 'none' });
    expect(readScimManagerReference(JSON.stringify({ schemas: [USER_SCHEMA] }))).toEqual({ kind: 'none' });
    expect(readScimManagerReference(attrs({ value: 'v1', $ref: 'https://x/Users/r1' }))).toEqual({ kind: 'id', id: 'v1' });
    expect(readScimManagerReference(attrs({ $ref: 'https://x/scim/v2/Users/r%201' }))).toEqual({ kind: 'id', id: 'r 1' });
    expect(readScimManagerReference(attrs({ $ref: 'https://x/people/r1' })))
      .toEqual({ kind: 'unreadable', ref: 'https://x/people/r1' });
    expect(readScimManagerReference(attrs({ $ref: 'https://x/scim/v2/Users/%E0%A4%A' })))
      .toEqual({ kind: 'unreadable', ref: 'https://x/scim/v2/Users/%E0%A4%A' });
  });
});

describe('scimBodyNamesManager', () => {
  const ENT = SCIM_ENTERPRISE_USER_SCHEMA;
  const ops = (...operations: unknown[]) => ({ schemas: [PATCH_SCHEMA], Operations: operations });

  it('a replace always names it, since a replace without the attribute is a clear', () => {
    expect(scimBodyNamesManager('replace', {})).toBe(true);
  });

  it('a create names it only when it carries it', () => {
    expect(scimBodyNamesManager('create', userBody('emp'))).toBe(false);
    expect(scimBodyNamesManager('create', userBody('emp', { value: 'm1' }))).toBe(true);
  });

  it('a PATCH names it when an operation addresses or carries it, matched case-insensitively', () => {
    expect(scimBodyNamesManager('patch', ops({ op: 'replace', path: 'displayName', value: 'x' }))).toBe(false);
    expect(scimBodyNamesManager('patch', ops({ op: 'replace', path: 'active', value: false }))).toBe(false);
    expect(scimBodyNamesManager('patch', ops({ op: 'remove', path: `${ENT}:manager` }))).toBe(true);
    expect(scimBodyNamesManager('patch', ops({ op: 'Replace', path: `${ENT.toUpperCase()}:Manager.value`, value: 'm1' }))).toBe(true);
    expect(scimBodyNamesManager('patch', ops({ op: 'replace', path: 'manager', value: { value: 'm1' } }))).toBe(true);
    expect(scimBodyNamesManager('patch', ops({ op: 'remove', path: ENT }))).toBe(true);
    expect(scimBodyNamesManager('patch', ops({ op: 'replace', path: ENT, value: { department: 'x' } }))).toBe(false);
    expect(scimBodyNamesManager('patch', ops({ op: 'replace', value: { [ENT]: { manager: { value: 'm1' } } } }))).toBe(true);
    expect(scimBodyNamesManager('patch', ops({ op: 'replace', value: { displayName: 'x' } }))).toBe(false);
  });
});
