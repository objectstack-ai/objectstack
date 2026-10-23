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
 *  - the caller's session read fails: 503, nothing attempted. `resolveActor`
 *    answers a failed session read with `null` by default, the value no
 *    session gives; the admission asks it with `failedReadThrows`;
 *  - the caller's `sys_member` read fails: 503, nothing attempted;
 *  - the `sys_organization` read fails: 503, nothing attempted;
 *  - the Default Organization decision's count fails: 503, nothing attempted.
 *
 * And the cases that keep falling through: no session at all, and a
 * credential carrying a control character even when its read fails (both the
 * vendor's 401); and the vendor's own `hasPermission`, which reads nothing
 * here, so it throws only on the member row itself, and the vendor's identical
 * call throws first too, before its first write.
 *
 * Real stack: `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, the
 * objects from this plugin's manifest and a real `AuthManager` with the
 * organization plugin (the `session-read-failure-answer.test.ts` harness).
 * Each fault is scoped to the admission: the read throws only when the
 * admission itself makes it (the session read: only inside the admission's
 * `resolveActor` call), so better-auth's own reads of the same table are the
 * real ones. That is what lets a request that falls through reach
 * better-auth's writes, which the engine hooks below record whether or not the
 * request's transaction later rolls them back.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';

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
    // Written beneath the engine, so the row is exactly what a store can hold
    // (`role` is not a required column), whatever the engine's write path does
    // with a null.
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

/**
 * The first `AuthManager` method on `stack`: an `AuthManager.<method>` frame,
 * or [#25224] a frame of a method's body moved whole into
 * `auth-manager-actor-guards.ts`, which runs under the method's own name (a
 * helper of that module that is no method of the class does not count).
 */
function firstAuthManagerMethod(stack: string): string | undefined {
  const methods = new Set(Object.getOwnPropertyNames(AuthManager.prototype));
  for (const match of stack.matchAll(/AuthManager\.(\w+)|at (?:async )?(?:Object\.)?(\w+) \([^)\n]*auth-manager-actor-guards\.ts:/g)) {
    if (match[1] !== undefined) return match[1];
    if (methods.has(match[2])) return match[2];
  }
  return undefined;
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

interface AdmissionRead {
  /** The engine methods the read goes through. */
  methods: ReadonlyArray<'find' | 'findOne' | 'count'>;
  object: string;
  /** A frame the call must be made inside of. */
  frame?: string;
  /** The first `AuthManager` method on the stack: the one that made the call. */
  caller?: string;
  /** How many of those calls throw; the session read makes two (both of `resolveActor`'s paths). */
  times?: number;
}

/**
 * The admission's own read of `object` throws: the call must be made from
 * inside `assertOrganizationDeletable` (and `frame`), and by `caller` (by
 * default the admission itself, so a session read made inside `resolveActor`
 * does not qualify unless asked for). Every other call is the real one.
 */
function failAdmissionRead(engine: ObjectQL, read: AdmissionRead) {
  const { methods, object, frame = 'assertOrganizationDeletable', caller = 'assertOrganizationDeletable', times = 1 } = read;
  let fired = 0;
  const target = engine as unknown as Record<string, (object: string, ...rest: unknown[]) => Promise<unknown>>;
  const spies = methods.map((method) => {
    const real = target[method].bind(engine);
    return vi.spyOn(target, method).mockImplementation(async (name: string, ...rest: unknown[]) => {
      const stack = deepStack();
      const first = firstAuthManagerMethod(stack);
      if (fired < times && name === object && stack.includes('assertOrganizationDeletable') && stack.includes(frame) && first === caller) {
        fired += 1;
        throw new Error(`${object} store unavailable (injected)`);
      }
      return real(name, ...rest);
    });
  });
  return { fired: () => fired, restore: () => spies.forEach((spy) => spy.mockRestore()) };
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
  const cases: Array<{ name: string; read: AdmissionRead; fires: number }> = [
    {
      name: 'the caller\'s session read',
      read: { methods: ['find', 'findOne'], object: 'sys_session', caller: 'resolveActor', times: Number.POSITIVE_INFINITY },
      fires: 2,
    },
    { name: 'the caller\'s sys_member read', read: { methods: ['findOne'], object: 'sys_member' }, fires: 1 },
    { name: 'the sys_organization read', read: { methods: ['findOne'], object: 'sys_organization' }, fires: 1 },
    {
      name: 'the Default Organization decision\'s count',
      read: { methods: ['count'], object: 'sys_organization', frame: 'isDefaultOrganizationTarget' },
      fires: 1,
    },
  ];

  for (const c of cases) {
    it(`${c.name} fails: 503 SERVICE_UNAVAILABLE, nothing attempted; CONTROL: with it back, the delete goes ahead`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { engine, manager, cookie } = await ownerOfTarget();
      const fault = failAdmissionRead(engine, c.read);
      const attempted = recordAttemptedWrites(engine);

      const res = await post(manager, '/organization/delete', { organizationId: TARGET }, cookie);
      engine.unregisterHooksByPackage(RECORDER);
      fault.restore();

      expect(fault.fired(), 'PREMISE: the admission\'s read really failed').toBe(c.fires);
      await expectReadFault(res, c.read.object);
      // better-auth's handler never ran: not even its first write, the
      // session's active organization, was attempted.
      await expectNothingChanged(engine, attempted);

      await expectControlDeletes(engine, manager, cookie);
    });
  }

  it('no session at all still falls through: the vendor\'s 401, nothing attempted', async () => {
    const { engine, manager } = await ownerOfTarget();
    const attempted = recordAttemptedWrites(engine);

    const res = await post(manager, '/organization/delete', { organizationId: TARGET }, '');
    engine.unregisterHooksByPackage(RECORDER);

    expect(res.status, await res.clone().text()).toBe(401);
    await expectNothingChanged(engine, attempted);
  });

  it('a credential carrying a control character is no session, even when its read fails: the vendor\'s 401, nothing attempted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, manager } = await ownerOfTarget();
    const fault = failAdmissionRead(engine, {
      methods: ['find', 'findOne'], object: 'sys_session', caller: 'resolveActor', times: Number.POSITIVE_INFINITY,
    });
    const attempted = recordAttemptedWrites(engine);

    // `%00` decodes to U+0000, a token no store holds and one PostgreSQL refuses to bind.
    const res = await post(manager, '/organization/delete', { organizationId: TARGET }, 'better-auth.session_token=%00forged.sig');
    engine.unregisterHooksByPackage(RECORDER);
    fault.restore();

    expect(fault.fired(), 'PREMISE: the admission read the session for that token, and the read failed').toBeGreaterThan(0);
    expect(res.status, await res.clone().text()).toBe(401);
    await expectNothingChanged(engine, attempted);
  });

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

describe('[#25364] the last-administrator guard\'s question about the Default Organization fails on a read: the same 503, not the verdict\'s 403', () => {
  /**
   * `TARGET` made the Default Organization (the only one), with the real
   * last-administrator guard asked first, as `AuthPlugin` wires it.
   */
  async function ownerOfDefaultOrganization() {
    const setup = await ownerOfTarget();
    await setup.engine.delete('sys_organization', { where: { id: 'org_other' }, ...(SYSTEM as object) } as never);
    const guard = registerLastAdminGuard(setup.engine as unknown as LastAdminGuardEngine, { packageId: 'test.25364.last-admin-guard' });
    setup.manager.setOrganizationDeleteStandingJudge(guard.judgeOrganizationDelete);
    return setup;
  }

  it('the guard\'s membership read fails: 503 SERVICE_UNAVAILABLE, the driver\'s words withheld, nothing attempted; CONTROL: with it back, the guard reaches its verdict, 403 PERMISSION_DENIED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine, manager, cookie } = await ownerOfDefaultOrganization();
    // The guard reads `sys_member` through `find`; the admission's own read of
    // it is a `findOne`, so only the guard's read fails.
    const fault = failAdmissionRead(engine, { methods: ['find'], object: 'sys_member', times: Number.POSITIVE_INFINITY });
    const attempted = recordAttemptedWrites(engine);

    const res = await post(manager, '/organization/delete', { organizationId: TARGET }, cookie);
    engine.unregisterHooksByPackage(RECORDER);
    fault.restore();

    expect(fault.fired(), 'PREMISE: the guard\'s read really failed').toBeGreaterThan(0);
    const text = await res.clone().text();
    expect(res.status, text).toBe(503);
    expect((JSON.parse(text) as { code?: string }).code).toBe('SERVICE_UNAVAILABLE');
    expect(text).not.toContain('injected');
    await expectNothingChanged(engine, attempted);

    // CONTROL: the read back, the same door answers the verdict: this owner is
    // the last administrator, a refusal on the merits, unchanged.
    const again = recordAttemptedWrites(engine);
    const verdict = await post(manager, '/organization/delete', { organizationId: TARGET }, cookie);
    engine.unregisterHooksByPackage(RECORDER);
    const verdictText = await verdict.clone().text();
    expect(verdict.status, verdictText).toBe(403);
    expect((JSON.parse(verdictText) as { code?: string }).code).toBe('PERMISSION_DENIED');
    await expectNothingChanged(engine, again);
  });
});
