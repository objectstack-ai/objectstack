// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10009] The DIRECT `POST /sso/register` surface admits PLATFORM ADMINS ONLY.
 *
 * ## What this file pins, and why it exists at all
 *
 * `@better-auth/sso`'s own endpoint is served by the catch-all, and the ADR-0024
 * before-hook in `auth-manager.ts` is the only thing deciding authorization on
 * it. Until this card that hook admitted *platform admin OR org owner/admin*,
 * while the `/admin/sso/*` bridges (#9653) admitted platform admins only — two
 * doors onto one operation with two different answers, which made the bridge
 * tightening honest labelling rather than a boundary. The 2026-08-20 maintainer
 * ruling closed the wider door (ADR-0068 D4: registering an identity provider is
 * a platform-operator action).
 *
 * The hook had **no test pins at all** before this file: `SSO_REGISTER_FORBIDDEN`
 * appeared nowhere outside its own `throw`. So the pins below are deliberately
 * TWO-DIRECTIONAL — a hook that refused *everyone* would satisfy a refusal-only
 * suite perfectly, and that failure mode is invisible from the refusal side.
 *
 *   ① an org OWNER who is not a platform admin is REFUSED (403 +
 *      `SSO_REGISTER_FORBIDDEN` — ADR-0112 asserts code AND status, never one
 *      alone);
 *   ② a platform admin is ADMITTED — proven by the request reaching the
 *      VENDOR's own business validation.
 *
 * ## How admission is proven without a network
 *
 * `providerId: 'credential'` is permanently in `@better-auth/sso`'s reserved
 * set, and the reserved-id refusal sits AFTER the vendor's whole authorization
 * prologue and BEFORE any endpoint-URL validation or discovery fetch. So a
 * `422 /reserved/` means the caller cleared BOTH the ObjectStack hook and the
 * vendor's own gates — admission, measured offline. (The same discipline
 * `admin-sso-bridge-gate.test.ts` uses for the vendor-posture measurement.)
 *
 * ## The grant is the ADR-0068 one, deliberately
 *
 * The platform admin is made one the way a real deployment does it — a
 * `sys_user_permission_set` row pointing at the `admin_full_access`
 * `sys_permission_set`, with `organization_id = null` — and the case ASSERTS
 * that the legacy `sys_user.role` scalar is NOT `'admin'`. Without that second
 * assertion the suite could pass while riding the retired D2 channel, which is
 * precisely the channel this family is closing; the pin would then survive the
 * removal of the thing it exists to protect.
 *
 * ## Fixture note
 *
 * The RBAC objects (`sys_permission_set`, `sys_user_permission_set`) live in
 * `@objectstack/plugin-security`. They are declared locally here — the
 * `last-admin-guard.test.ts` precedent — with only the columns the judge reads,
 * so a fixture does not add a dependency edge to plugin-auth. Everything else is
 * real: a real ObjectQL engine over real better-sqlite3, the real `AuthManager`
 * with the real `sso()` plugin, real sign-up and real session cookies.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager.js';
import { AuthPlugin } from './auth-plugin.js';
import { createTenancyService } from './tenancy-service.js';
import type { PluginContext } from '@objectstack/core';
import {
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysOrganization,
  SysMember,
  SysInvitation,
  SysTeam,
  SysTeamMember,
  SysSsoProvider,
} from '@objectstack/platform-objects';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-10009';
const SYSTEM = { context: { isSystem: true } } as const;

const sysPermissionSet = {
  name: 'sys_permission_set',
  label: 'Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
  },
};

const sysUserPermissionSet = {
  name: 'sys_user_permission_set',
  label: 'User Permission Set',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    user_id: { name: 'user_id', type: 'text' as const },
    permission_set_id: { name: 'permission_set_id', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

async function bootEngine(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }),
    true,
  );
  await engine.init();
  const objects = [
    SysUser, SysSession, SysAccount, SysVerification, SysOrganization,
    SysMember, SysInvitation, SysTeam, SysTeamMember, SysSsoProvider,
  ];
  for (const object of objects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  engine.registry.registerObject(sysPermissionSet as never, '@objectstack/plugin-auth');
  engine.registry.registerObject(sysUserPermissionSet as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  return engine;
}

function makeManager(engine: ObjectQL): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE,
    dataEngine: engine as never,
    // ADR-0093 D5 — `organization/create` is gated by the EFFECTIVE tenancy
    // posture, so an org-owner principal needs a deployment that permits orgs.
    getTenancy: () => createTenancyService({ requested: 'isolated', probeIsolation: () => true }),
    plugins: { organization: true, sso: true },
  } as never);
}

const cookiesFrom = (res: Response): string =>
  (res.headers.get('set-cookie') ?? '')
    .split(',')
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');

async function signUp(
  send: (r: Request) => Promise<Response>,
  email: string,
): Promise<string> {
  const res = await send(
    new Request(`${AUTH}/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email, password: 'S3cure!Passw0rd-10009', name: 'Probe' }),
    }),
  );
  expect(res.status, `sign-up failed: ${await res.clone().text()}`).toBeLessThan(400);
  return cookiesFrom(res);
}

async function createOrg(
  send: (r: Request) => Promise<Response>,
  cookie: string,
  slug: string,
): Promise<string> {
  const res = await send(
    new Request(`${AUTH}/organization/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie },
      body: JSON.stringify({ name: 'Probe Org', slug }),
    }),
  );
  expect(res.status, `organization/create failed: ${await res.clone().text()}`).toBeLessThan(400);
  const body = (await res.json()) as Record<string, any>;
  const id = (body?.id ?? body?.organization?.id) as string;
  expect(id, 'organization/create must return an organization id').toBeTruthy();
  return id;
}

/** Grant platform admin the ADR-0068 D2 way: an ORG-LESS `admin_full_access` link. */
async function grantPlatformAdmin(engine: ObjectQL, userId: string): Promise<void> {
  await engine.insert(
    'sys_permission_set',
    { id: 'ps_admin_full_access', name: ADMIN_FULL_ACCESS },
    SYSTEM as never,
  );
  await engine.insert(
    'sys_user_permission_set',
    {
      id: 'ups_platform_admin',
      user_id: userId,
      permission_set_id: 'ps_admin_full_access',
      organization_id: null,
    },
    SYSTEM as never,
  );
}

async function userIdOf(engine: ObjectQL, email: string): Promise<string> {
  const row = await engine.findOne('sys_user', { where: { email } }, SYSTEM as never);
  expect(row, `no sys_user row for ${email}`).toBeTruthy();
  return String((row as Record<string, unknown>).id);
}

/**
 * ⚠️ The retired channel must NOT be what admits the caller. ADR-0068 D2 stopped
 * writing `sys_user.role = 'admin'` for a platform admin; a fixture that carried
 * it could pass this whole file while the permission-set read was broken.
 */
async function expectLegacyRoleScalarIsNotAdmin(engine: ObjectQL, email: string): Promise<void> {
  const row = (await engine.findOne('sys_user', { where: { email } }, SYSTEM as never)) as
    | Record<string, unknown>
    | null;
  expect(row?.role, 'fixture must not ride the retired `role` scalar').not.toBe('admin');
}

/**
 * `credential` is permanently reserved by `@better-auth/sso`; the reserved-id
 * refusal sits after the vendor's authorization prologue, so reaching it proves
 * admission without any network.
 */
const REGISTER_BODY = {
  providerId: 'credential',
  issuer: 'https://idp.example.com',
  domain: 'example.com',
  oidcConfig: {
    clientId: 'cid',
    clientSecret: 'csecret',
    scopes: ['openid', 'email', 'profile'],
    mapping: { email: 'email', name: 'name' },
  },
};

const postRegister = (send: (r: Request) => Promise<Response>, cookie?: string) =>
  send(
    new Request(`${AUTH}/sso/register`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(REGISTER_BODY),
    }),
  );

describe('[#10009] direct /sso/register — the ADR-0024 before-hook admits platform admins only', () => {
  it('① an org OWNER who is not a platform admin is REFUSED 403 SSO_REGISTER_FORBIDDEN', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (r: Request) => manager.handleRequest(r);

    const email = 'orgowner@example.com';
    const cookie = await signUp(send, email);
    const orgId = await createOrg(send, cookie, 'probe-org-10009');

    // The principal really is an org OWNER — the fixture's claim, verified.
    const member = (await engine.findOne(
      'sys_member',
      { where: { organization_id: orgId } },
      SYSTEM as never,
    )) as Record<string, unknown>;
    expect(member?.role, 'the org creator must be an owner').toBe('owner');

    // …and really is NOT a platform admin, by either channel.
    await expectLegacyRoleScalarIsNotAdmin(engine, email);
    const grants = await engine.find(
      'sys_user_permission_set',
      { where: { user_id: await userIdOf(engine, email) } },
      SYSTEM as never,
    );
    expect(grants, 'org owner must hold no platform grant').toHaveLength(0);

    const res = await postRegister(send, cookie);
    const body = (await res.clone().json()) as Record<string, any>;

    // ADR-0112: code AND status. A sibling card measured a real ablation where
    // the status was unchanged and only the code moved, so neither alone is a
    // sufficient assertion.
    expect(res.status, await res.clone().text()).toBe(403);
    expect(body?.code ?? body?.error?.code).toBe('SSO_REGISTER_FORBIDDEN');
  });

  it('② a platform admin (ADR-0068 grant, legacy role scalar NOT admin) is ADMITTED', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (r: Request) => manager.handleRequest(r);

    const email = 'platformadmin@example.com';
    const cookie = await signUp(send, email);
    await grantPlatformAdmin(engine, await userIdOf(engine, email));
    await expectLegacyRoleScalarIsNotAdmin(engine, email);

    const res = await postRegister(send, cookie);
    const text = await res.clone().text();

    // Cleared the ObjectStack hook AND the vendor's authorization prologue:
    // the answer is the vendor's own business validation, not a refusal.
    expect(res.status, text).toBe(422);
    expect(text).toMatch(/reserved/i);
    expect(text).not.toMatch(/SSO_REGISTER_FORBIDDEN/);
  });

  it('③ an anonymous caller still falls through to the vendor session gate (401)', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (r: Request) => manager.handleRequest(r);

    const res = await postRegister(send);
    // The hook deliberately does not answer for the unauthenticated case —
    // `sessionMiddleware` does, so the 401 stays the vendor's.
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// The alignment this card is FOR: one principal, both doors, one answer.
// ---------------------------------------------------------------------------

const mockCtx = (): PluginContext =>
  ({
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  }) as any;

/** Mount the REAL `/admin/sso/*` bridges over the REAL auth manager. */
async function mountBridges(manager: AuthManager): Promise<Hono> {
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return app;
}

describe('[#10009] the two doors onto SSO registration now answer the same org owner alike', () => {
  it('org owner: refused at the /admin/sso/register bridge AND at the direct /sso/register', async () => {
    const engine = await bootEngine();
    const manager = makeManager(engine);
    const send = (r: Request) => manager.handleRequest(r);

    const cookie = await signUp(send, 'orgowner@example.com');
    await createOrg(send, cookie, 'probe-org-10009-both');

    // Door 1 — the #9653 bridge (unchanged by this card).
    const app = await mountBridges(manager);
    const bridge = await app.request(`${AUTH}/admin/sso/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, cookie },
      body: JSON.stringify({
        providerId: 'acme',
        issuer: 'https://idp.acme.example',
        domain: 'acme.example',
        clientId: 'cid',
        clientSecret: 'csecret',
      }),
    });
    const bridgeBody = (await bridge.clone().json()) as Record<string, any>;
    expect(bridge.status).toBe(403);
    expect(bridgeBody?.error?.code).toBe('PERMISSION_DENIED');

    // Door 2 — the direct endpoint. Before this card it answered 422 (admitted);
    // the divergence is what #10009 recorded.
    const direct = await postRegister(send, cookie);
    const directBody = (await direct.clone().json()) as Record<string, any>;
    expect(direct.status, await direct.clone().text()).toBe(403);
    expect(directBody?.code ?? directBody?.error?.code).toBe('SSO_REGISTER_FORBIDDEN');
  });
});
