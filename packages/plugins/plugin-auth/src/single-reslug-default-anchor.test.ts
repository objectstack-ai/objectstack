// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D5] Under `single` no slug change makes a non-Default organization
 * the Default Organization.
 *
 * The Default Organization is the organization slugged `default`, else the
 * only one, and its `admin_full_access` grant confers platform administrator
 * standing (`grantAnchorsPlatformStanding`). On a store holding several
 * organizations, none slugged `default`, an organization owner could re-slug
 * their own organization to `default` through better-auth's
 * `organization/update`: measured on `main` at 8dfd1265f0, the request
 * answered 200, and a platform-granted `admin_full_access` grant that
 * organization owned turned its holder from no platform administrator into one
 * through the real `resolveAuthzContext`. A system-context engine update (a
 * seed, a plugin) did the same. The data API's PATCH and update-mode import
 * were already closed by the ADR-0092 identity write guard, which strips
 * `slug` from a user-context write.
 *
 * The refusal is the last-administrator guard's `sys_organization`
 * `beforeUpdate` hook, so it holds on every one of those doors: better-auth's
 * adapter writes through the engine, and its refusal reaches the HTTP caller
 * as 403 `PERMISSION_DENIED`.
 *
 * Pinned here on the real stack (`ObjectQL` over `@objectstack/driver-sql` +
 * better-sqlite3, this plugin's identity objects, the real last-administrator
 * guard and a real `AuthManager` with the organization plugin), each refusal
 * with its CONTROL:
 *
 *  - the HTTP door: 403 `PERMISSION_DENIED`, the slug unchanged, no standing
 *    gained; the sole organization (already the Default Organization) and a
 *    slug other than `default` are admitted; a walled posture admits it, since
 *    a slug anchors nothing there; a read that fails refuses;
 *  - the engine door, by id and by predicate: the same refusal, for a
 *    system-context write; walled, admitted.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resetPlatformAdminEmailMemo, resolveAuthzContext } from '@objectstack/core';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { registerLastAdminGuard, type LastAdminGuardEngine } from './last-admin-guard.js';
import { bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-25271';
const PASSWORD = 'S3cure!Passw0rd-25271';
const SYSTEM = { context: { isSystem: true } } as never;
const ENV = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_PLATFORM_OWNER_EMAIL'] as const;

const text = (name: string) => ({ name, type: 'text' as const });
/** The grant table the resolver and the guard read; declared locally, with the columns they read. */
const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { ...text('id'), primaryKey: true },
    user_id: text('user_id'),
    permission_set: text('permission_set'),
    organization_id: text('organization_id'),
    valid_from: { name: 'valid_from', type: 'datetime' as const },
    valid_until: { name: 'valid_until', type: 'datetime' as const },
  },
};
/** Read by the resolver beside the grants; no case seeds it. */
const sysUserPosition = {
  name: 'sys_user_position',
  label: 'User Position',
  fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), position: text('position'), organization_id: text('organization_id') },
};

const engines: ObjectQL[] = [];
let ambient: Record<string, string | undefined> = {};
beforeEach(() => {
  ambient = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  resetPlatformAdminEmailMemo();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(ambient)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPlatformAdminEmailMemo();
  while (engines.length) {
    try { await engines.pop()!.destroy(); } catch { /* noop */ }
  }
});

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

/** Does the resolver grade `userId` a platform administrator? */
async function platformAdmin(engine: ObjectQL, userId: string): Promise<boolean> {
  const ctx = await resolveAuthzContext({
    ql: engine,
    headers: {},
    getSession: () => ({ user: { id: userId }, session: { userId } }),
  } as never);
  return ctx.positions.includes('platform_admin');
}

async function slugOf(engine: ObjectQL, id: string): Promise<unknown> {
  const row = await engine.findOne('sys_organization', { where: { id }, context: { isSystem: true } } as never);
  return (row as { slug?: unknown } | null)?.slug;
}

/** The refusal envelope, or `undefined` when the write landed. */
async function refusalOf(write: Promise<unknown>): Promise<{ code?: unknown; status?: unknown } | undefined> {
  try {
    await write;
    return undefined;
  } catch (err) {
    const e = err as { code?: unknown; status?: unknown };
    return { code: e.code, status: e.status };
  }
}

const answer = async (response: Response) => {
  const body = (await response.clone().json().catch(() => null)) as { code?: unknown } | null;
  return { status: response.status, code: body?.code ?? null };
};

/**
 * An owner of `org_b`, signed in with it active, holding an `admin_full_access`
 * grant `org_b` owns. `organizations` are the store's organizations, `org_b`
 * among them.
 */
async function ownerOfB(organizations: Array<{ id: string; slug: string }>) {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  for (const object of authIdentityObjects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  engine.registry.registerObject(sysUserPermissionSet as never, '@objectstack/plugin-security');
  engine.registry.registerObject(sysUserPosition as never, '@objectstack/plugin-security');
  await engine.syncSchemas();
  bindTestSecurityCatalog(engine, { permissions: [{ name: ADMIN_FULL_ACCESS }] });
  registerLastAdminGuard(engine as unknown as LastAdminGuardEngine, { packageId: 'test.25271.last-admin-guard' });
  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never, plugins: { organization: true } } as never);

  const signedUp = await manager.handleRequest(new Request(`${AUTH}/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: 'owner-b@example.com', password: PASSWORD, name: 'Owner B' }),
  }));
  expect(signedUp.status, await signedUp.clone().text()).toBe(200);
  const cookie = cookieFrom(signedUp);
  const user = (await engine.findOne('sys_user', { where: { email: 'owner-b@example.com' }, context: { isSystem: true } } as never)) as { id: string };

  for (const o of organizations) await engine.insert('sys_organization', { id: o.id, name: o.id, slug: o.slug }, SYSTEM);
  await engine.insert('sys_member', { id: 'mem_b', user_id: user.id, organization_id: 'org_b', role: 'owner' }, SYSTEM);
  await engine.insert('sys_user_permission_set', { id: 'ups_b', user_id: user.id, permission_set: ADMIN_FULL_ACCESS, organization_id: 'org_b' }, SYSTEM);
  const active = await post(manager, '/organization/set-active', { organizationId: 'org_b' }, cookie);
  expect(active.status, await active.clone().text()).toBe(200);
  return { engine, manager, cookie, userId: user.id };
}

const TWO_NONE_DEFAULT = [{ id: 'org_a', slug: 'acme' }, { id: 'org_b', slug: 'beta' }];
const reslug = (manager: AuthManager, cookie: string, slug: string) =>
  post(manager, '/organization/update', { organizationId: 'org_b', data: { slug } }, cookie);

describe('[ADR-0131 D5] better-auth organization/update: no re-slug makes another organization the Default Organization', () => {
  it('several organizations, none `default`: the owner re-slugging theirs to `default` is refused 403 PERMISSION_DENIED, and gains nothing', async () => {
    const { engine, manager, cookie, userId } = await ownerOfB(TWO_NONE_DEFAULT);
    expect(await platformAdmin(engine, userId)).toBe(false);

    const res = await reslug(manager, cookie, 'default');

    expect(await answer(res)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    expect(await slugOf(engine, 'org_b')).toBe('beta');
    expect(await platformAdmin(engine, userId)).toBe(false);
  });

  it('CONTROL: the sole organization is already the Default Organization, so it may take the slug `default`', async () => {
    const { engine, manager, cookie, userId } = await ownerOfB([{ id: 'org_b', slug: 'beta' }]);
    expect(await platformAdmin(engine, userId)).toBe(true);

    const res = await reslug(manager, cookie, 'default');

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await slugOf(engine, 'org_b')).toBe('default');
    expect(await platformAdmin(engine, userId)).toBe(true);
  });

  it('CONTROL: a slug other than `default` is not this rule’s', async () => {
    const { engine, manager, cookie } = await ownerOfB(TWO_NONE_DEFAULT);

    const res = await reslug(manager, cookie, 'gamma');

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await slugOf(engine, 'org_b')).toBe('gamma');
  });

  it('CONTROL: under a wall a slug anchors nothing, so the same re-slug is admitted', async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const { engine, manager, cookie } = await ownerOfB(TWO_NONE_DEFAULT);

    const res = await reslug(manager, cookie, 'default');

    expect(res.status, await res.clone().text()).toBe(200);
    expect(await slugOf(engine, 'org_b')).toBe('default');
  });

  it('a read of the Default Organization that fails refuses (the guard fails closed), and the slug is not changed', async () => {
    const { engine, manager, cookie } = await ownerOfB(TWO_NONE_DEFAULT);
    // Only this rule's read (`{ slug: 'default' }`, limit 1) fails: the
    // break-glass half reads the same slug through a wider page, and must not
    // be what refuses here.
    const real = engine.find.bind(engine);
    vi.spyOn(engine, 'find').mockImplementation(async (object: string, query?: any, ...rest: any[]) => {
      if (object === 'sys_organization' && query?.where?.slug === 'default' && query?.limit === 1) throw new Error('sys_organization store unavailable (injected)');
      return (real as any)(object, query, ...rest);
    });

    expect(await answer(await reslug(manager, cookie, 'default'))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    expect(await slugOf(engine, 'org_b')).toBe('beta');
  });
});

describe('[ADR-0131 D5] the engine door (a seed, a plugin, a script): the same refusal for a system-context write', () => {
  it('by id: refused 403 PERMISSION_DENIED, the slug unchanged, no standing gained', async () => {
    const { engine, userId } = await ownerOfB(TWO_NONE_DEFAULT);

    expect(await refusalOf(engine.update('sys_organization', { id: 'org_b', slug: 'default' }, SYSTEM))).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await slugOf(engine, 'org_b')).toBe('beta');
    expect(await platformAdmin(engine, userId)).toBe(false);
  });

  it('a `default`-slugged Default Organization beside it: re-slugging another to `default` is refused by this rule, before any unique index', async () => {
    // better-auth's own slug-taken check answers this shape 400 at the HTTP
    // door before any hook runs; below HTTP nothing but this rule stands first.
    const { engine } = await ownerOfB([{ id: 'org_default', slug: 'default' }, { id: 'org_b', slug: 'beta' }]);

    expect(await refusalOf(engine.update('sys_organization', { id: 'org_b', slug: 'default' }, SYSTEM))).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await slugOf(engine, 'org_b')).toBe('beta');
  });

  it('by predicate: refused the same way', async () => {
    const { engine } = await ownerOfB(TWO_NONE_DEFAULT);

    const write = engine.update('sys_organization', { slug: 'default' }, { multi: true, where: { id: 'org_b' }, ...(SYSTEM as object) } as never);

    expect(await refusalOf(write)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await slugOf(engine, 'org_b')).toBe('beta');
  });

  it('a read that fails refuses: the guard fails closed', async () => {
    const { engine } = await ownerOfB(TWO_NONE_DEFAULT);
    const real = engine.find.bind(engine);
    vi.spyOn(engine, 'find').mockImplementation(async (object: string, query?: any, ...rest: any[]) => {
      if (object === 'sys_organization' && query?.where?.slug === 'default' && query?.limit === 1) throw new Error('sys_organization store unavailable (injected)');
      return (real as any)(object, query, ...rest);
    });

    expect(await refusalOf(engine.update('sys_organization', { id: 'org_b', slug: 'default' }, SYSTEM))).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    vi.restoreAllMocks();
    expect(await slugOf(engine, 'org_b')).toBe('beta');
  });

  it('CONTROL: under a wall the same write is admitted', async () => {
    process.env.OS_TENANCY_POSTURE = 'group';
    const { engine } = await ownerOfB(TWO_NONE_DEFAULT);

    expect(await refusalOf(engine.update('sys_organization', { id: 'org_b', slug: 'default' }, SYSTEM))).toBeUndefined();
    expect(await slugOf(engine, 'org_b')).toBe('default');
  });
});
