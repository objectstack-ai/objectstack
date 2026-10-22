// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25059] The organization-delete admission refuses a delete it could not
 * decide because a read it decides on failed: 503 `SERVICE_UNAVAILABLE`,
 * before better-auth's first write.
 *
 * The admission (`AuthManager.assertOrganizationDeletable`, in better-auth's
 * global `hooks.before`) caught every throw in its lookup block and handed the
 * request to better-auth. Better-auth re-reads what it decides and then
 * writes: it clears the caller's active organization, then deletes the members
 * and the invitations, and only then meets the engine's refusal at the
 * organization row. On a driver without transactions those deletes stay. The
 * Default Organization decision already refused on a failed lookup (#24948),
 * but with a bare `Error`, which better-auth answers as a 500.
 *
 * Pinned here, each with its CONTROL (the same delete, the read back, goes
 * ahead):
 *
 *  - the caller's `sys_member` read fails: 503, nothing attempted;
 *  - the `sys_organization` read fails: 503, nothing attempted;
 *  - the Default Organization decision's count fails: 503, nothing attempted.
 *
 * And the case that keeps falling through: the vendor's own `hasPermission`
 * reads nothing here, so it throws only on the member row itself, and the
 * vendor's identical call throws first too, before its first write.
 *
 * Real stack: `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, the
 * objects from this plugin's manifest and a real `AuthManager` with the
 * organization plugin (the `session-read-failure-answer.test.ts` harness).
 * Each fault is scoped to the admission: the read throws once, and only when
 * the admission itself makes it, so better-auth's own reads of the same table
 * are the real ones. That is what lets a request that falls through reach
 * better-auth's writes, which the engine hooks below record whether or not the
 * request's transaction later rolls them back.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-25059';
const PASSWORD = 'S3cure!Passw0rd-25059';
const SYSTEM = { context: { isSystem: true } } as never;
const TARGET = 'org_25059';
const RECORDER = 'test.25059.attempted-writes';

/** The grant table the admission's count reads; declared locally, with the columns it reads. */
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set: { name: 'permission_set', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()!.destroy(); } catch { /* noop */ }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  engine.registry.registerObject(sysUserPermissionSet as never, '@objectstack/plugin-security');
  await engine.syncSchemas();
  return engine;
}

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const post = (manager: AuthManager, path: string, body: unknown, cookie: string) =>
  manager.handleRequest(new Request(`${AUTH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE, cookie },
    body: JSON.stringify(body),
  }));

async function rows(engine: ObjectQL, object: string, where: Record<string, unknown>): Promise<any[]> {
  const found = await engine.find(object, { where, limit: 50, context: { isSystem: true } } as never);
  return Array.isArray(found) ? found : ((found as { records?: any[] })?.records ?? []);
}

/**
 * An owner of `TARGET`, signed in with `TARGET` active, on a deployment with a
 * second organization: so the target is not the Default Organization (its
 * slug is not `default` and it is not the only one), and better-auth's first
 * write, were the request to reach it, is the session's active organization.
 */
async function ownerOfTarget(role: string | null = 'owner') {
  const engine = await bootEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    plugins: { organization: true },
  } as never);
  const signedUp = await manager.handleRequest(new Request(`${AUTH}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: 'owner@example.com', password: PASSWORD, name: 'Owner' }),
  }));
  expect(signedUp.status, await signedUp.clone().text()).toBe(200);
  const cookie = cookieFrom(signedUp);
  const [user] = await rows(engine, 'sys_user', { email: 'owner@example.com' });
  await engine.insert('sys_organization', { id: TARGET, name: 'Org 25059', slug: 'org-25059' }, SYSTEM);
  await engine.insert('sys_organization', { id: 'org_other', name: 'Other', slug: 'org-other' }, SYSTEM);
  await engine.insert('sys_member', { id: 'mem_owner', user_id: String(user.id), organization_id: TARGET, role: 'owner' }, SYSTEM);
  const active = await post(manager, '/organization/set-active', { organizationId: TARGET }, cookie);
  expect(active.status, await active.clone().text()).toBe(200);
  if (role !== 'owner') {
    // Below the engine, which would apply the field's default to a null: the
    // row as a store can hold it.
    await (engine as any).getDriver('sys_member').update('sys_member', 'mem_owner', { role });
  }
  return { engine, manager, cookie };
}

/**
 * Every write better-auth's handler makes on the way to the delete, recorded
 * at the engine when it is ATTEMPTED: the session's active organization (its
 * first write), then the member, invitation and organization deletes.
 */
function recordAttemptedWrites(engine: ObjectQL): string[] {
  const attempted: string[] = [];
  engine.registerHook('beforeUpdate', async () => { attempted.push('update sys_session'); }, { object: 'sys_session', packageId: RECORDER });
  for (const object of ['sys_member', 'sys_invitation', 'sys_organization']) {
    engine.registerHook('beforeDelete', async () => { attempted.push(`delete ${object}`); }, { object, packageId: RECORDER });
  }
  return attempted;
}

/** The current stack, deep enough to reach the request's frames (V8 keeps ten by default). */
function deepStack(): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 100;
  try {
    return new Error().stack ?? '';
  } finally {
    Error.stackTraceLimit = limit;
  }
}

/**
 * The admission's own `method` call on `object` throws, once: the call must be
 * made from inside `frame` and by the admission itself (its first
 * `AuthManager` frame is `assertOrganizationDeletable`, so a session read made
 * inside `resolveActor` does not qualify). Every other call is the real one.
 */
function failAdmissionRead(engine: ObjectQL, method: 'findOne' | 'count', object: string, frame = 'assertOrganizationDeletable') {
  let fired = 0;
  const target = engine as unknown as Record<string, (object: string, ...rest: unknown[]) => Promise<unknown>>;
  const real = target[method].bind(engine);
  const spy = vi.spyOn(target, method).mockImplementation(async (name: string, ...rest: unknown[]) => {
    const stack = deepStack();
    const caller = /AuthManager\.(\w+)/.exec(stack)?.[1];
    if (fired === 0 && name === object && stack.includes(frame) && caller === 'assertOrganizationDeletable') {
      fired += 1;
      throw new Error(`${object} store unavailable (injected)`);
    }
    return real(name, ...rest);
  });
  return { fired: () => fired, restore: () => spy.mockRestore() };
}

/** The refusal, asserted on its envelope: 503 with the standard code, naming the table it could not read. */
async function expectReadFault(res: Response, object: string) {
  const text = await res.clone().text();
  expect(res.status, text).toBe(503);
  const body = JSON.parse(text) as { code?: string; message?: string };
  expect(body.code).toBe('SERVICE_UNAVAILABLE');
  expect(body.message).toContain(`\`${object}\``);
  // The driver's own words stay on the server.
  expect(text).not.toContain('injected');
}

async function expectNothingChanged(engine: ObjectQL, attempted: string[]) {
  expect(attempted).toEqual([]);
  expect(await rows(engine, 'sys_organization', { id: TARGET })).toHaveLength(1);
  expect(await rows(engine, 'sys_member', { organization_id: TARGET })).toHaveLength(1);
}

/** CONTROL: with the read back, the same delete reaches better-auth and goes ahead. */
async function expectControlDeletes(engine: ObjectQL, manager: AuthManager, cookie: string) {
  const attempted = recordAttemptedWrites(engine);
  const ok = await post(manager, '/organization/delete', { organizationId: TARGET }, cookie);
  engine.unregisterHooksByPackage(RECORDER);
  expect(ok.status, await ok.clone().text()).toBe(200);
  expect(attempted).toEqual(expect.arrayContaining(['update sys_session', 'delete sys_member', 'delete sys_organization']));
  expect(await rows(engine, 'sys_organization', { id: TARGET })).toHaveLength(0);
  expect(await rows(engine, 'sys_member', { organization_id: TARGET })).toHaveLength(0);
}

describe('[#25059] an organization-delete read that fails refuses 503 before better-auth\'s first write', () => {
  const cases: Array<{ name: string; method: 'findOne' | 'count'; object: string; frame?: string }> = [
    { name: 'the caller\'s sys_member read', method: 'findOne', object: 'sys_member' },
    { name: 'the sys_organization read', method: 'findOne', object: 'sys_organization' },
    { name: 'the Default Organization decision\'s count', method: 'count', object: 'sys_organization', frame: 'isDefaultOrganizationTarget' },
  ];

  for (const c of cases) {
    it(`${c.name} fails: 503 SERVICE_UNAVAILABLE, nothing attempted; CONTROL: with it back, the delete goes ahead`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { engine, manager, cookie } = await ownerOfTarget();
      const fault = failAdmissionRead(engine, c.method, c.object, c.frame);
      const attempted = recordAttemptedWrites(engine);

      const res = await post(manager, '/organization/delete', { organizationId: TARGET }, cookie);
      engine.unregisterHooksByPackage(RECORDER);
      fault.restore();

      expect(fault.fired(), 'PREMISE: the admission\'s read really failed').toBe(1);
      await expectReadFault(res, c.object);
      // better-auth's handler never ran: not even its first write, the
      // session's active organization, was attempted.
      await expectNothingChanged(engine, attempted);

      await expectControlDeletes(engine, manager, cookie);
    });
  }

  it('a member row the vendor\'s own predicate throws on still falls through: the vendor answers, before its first write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, manager, cookie } = await ownerOfTarget(null);
    const [member] = await rows(engine, 'sys_member', { organization_id: TARGET });
    expect(member.role, 'PREMISE: the stored role is no string').toBeNull();
    const attempted = recordAttemptedWrites(engine);

    const res = await post(manager, '/organization/delete', { organizationId: TARGET }, cookie);
    engine.unregisterHooksByPackage(RECORDER);

    const text = await res.clone().text();
    expect(res.status, text).toBeGreaterThanOrEqual(400);
    // Not the admission's read fault: no read failed, and the vendor decided.
    expect(text).not.toContain('SERVICE_UNAVAILABLE');
    await expectNothingChanged(engine, attempted);
  });
});
