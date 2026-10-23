// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#25083] A cloud-managed environment narrows plugin-auth's local identity
// doors (ruling 6341690661 on the card, Q1 B / Q2 D / Q4 A).
//
// The organisation that hosts the environment invites its people in the cloud,
// so on a managed environment: the audience posture is `invite_only` only,
// local sign-up is forced off, invitation creation and the admin create and
// import doors answer 409 RESOURCE_CONFLICT, and the two password doors split
// by population — `set-user-password` refuses an `idp_provisioned` target and
// still answers on an `env_native` one, `set-initial-password` admits only a
// caller with platform-admin standing. The break-glass administrator therefore
// stays reachable (ADR-0135 D5.2: narrowed by population, never wholesale).
//
// Every door is driven through the REAL seam: a real `AuthManager` on the
// installed better-auth, behind `AuthPlugin.registerAuthRoutes` mounted on a
// real Hono app. Each refusal asserts the ADR-0112 code AND status, and that
// nothing was written; each has a contrast leg that the same staging answers
// as before on an unmanaged deployment (self-hosted is unaffected), with
// SSO-only switched on there, so the narrowing is the managed mode's and not
// SSO-only's.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { resetCloudManagedForTesting } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { assertAudienceConfig, decideAudienceAdmission, resolveAudience } from './audience-posture';
import { CLOUD_MANAGED_REFUSAL_MESSAGES } from './cloud-managed';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-25083';
const NEW_PASSWORD = 'An0ther!Passw0rd-25083';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const DEFAULT_ORG = 'org_default';

const MANAGED_ENV = 'OS_CLOUD_MANAGED';
const SSO_ONLY_ENV = 'OS_AUTH_SSO_ONLY';
const savedEnv: Record<string, string | undefined> = {};

/** The managed switch, as the cloud's containers set it; off = unset, as on a self-hosted image. */
function setManaged(on: boolean): void {
  if (on) process.env[MANAGED_ENV] = '1';
  else delete process.env[MANAGED_ENV];
  // `isCloudManaged()` memoizes its first read (#25306), so every switch
  // re-reads it; without this the first case's answer would stick.
  resetCloudManagedForTesting();
}

beforeEach(() => {
  for (const key of [MANAGED_ENV, SSO_ONLY_ENV]) savedEnv[key] = process.env[key];
  setManaged(false);
  delete process.env[SSO_ONLY_ENV];
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetCloudManagedForTesting();
  vi.restoreAllMocks();
});

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

/** Status + the error code the body carries, in either envelope shape. */
async function verdict(res: Response): Promise<{ status: number; code?: string; message?: string; text: string }> {
  const text = await res.text();
  let code: string | undefined;
  let message: string | undefined;
  try {
    const parsed = JSON.parse(text);
    code = parsed?.error?.code ?? parsed?.code;
    message = parsed?.error?.message ?? parsed?.message;
  } catch {
    /* non-JSON body → no code */
  }
  return { status: res.status, code, message, text };
}

const singleOrgTenancy = () =>
  ({
    posture: 'single',
    requestedPosture: 'single',
    isolationActive: false,
    requested: false,
    degraded: false,
    defaultOrgId: async () => DEFAULT_ORG,
  }) as any;

const makeManager = (engine: ReturnType<typeof createMemoryEngine>, extra: Record<string, unknown> = {}) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { admin: true },
    membershipPolicy: 'auto',
    getTenancy: () => singleOrgTenancy(),
    ...extra,
  } as any);

/**
 * One deployment, staged UNMANAGED (so its fixture users can sign up through
 * the invitation lane), then served through the real mount chain. The tests
 * switch the mode on afterwards: every door under test reads the accessor per
 * request.
 *
 *  - `admin`: a platform admin (the legacy `role` scalar, which
 *    `isPlatformAdminUser` accepts) and the owner of the default organization,
 *    so it can reach invite-member, create-user, import-users and the
 *    password doors.
 *  - `member`: an ordinary `env_native` user holding a local password.
 *  - `idp`: an `idp_provisioned` user with no local credential, the
 *    population the cloud's identity provider owns.
 */
async function stage() {
  const engine = createMemoryEngine();
  engine.tables.set('sys_organization', [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }]);
  const manager = makeManager(engine);

  const direct = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const emails = {
    admin: 'admin.25083@example.com',
    member: 'member.25083@example.com',
    idp: 'idp.25083@example.com',
  } as const;
  for (const email of Object.values(emails)) {
    await inviteForAudienceGate(manager, email);
    const res = await direct('/sign-up/email', { email, password: PASSWORD, name: email });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  }

  const users = () => (engine.tables.get('sys_user') ?? []) as any[];
  const accounts = () => (engine.tables.get('sys_account') ?? []) as any[];
  const idFor = (email: string) => String(users().find((r) => r.email === email)!.id);
  const ids = { admin: idFor(emails.admin), member: idFor(emails.member), idp: idFor(emails.idp) };

  users().find((r) => String(r.id) === ids.admin)!.role = 'admin';
  const adminMembership = ((engine.tables.get('sys_member') ?? []) as any[]).find(
    (m) => m.organization_id === DEFAULT_ORG && String(m.user_id) === ids.admin,
  );
  expect(adminMembership, 'fixture invariant: the admin must hold a default-org membership').toBeDefined();
  adminMembership.role = 'owner';

  const bearerFor = async (email: string) => {
    const res = await direct('/sign-in/email', { email, password: PASSWORD });
    const token = res.headers.get('set-auth-token');
    expect(token, `sign-in ${email} must mint a bearer or the authenticated legs prove nothing`).toBeTruthy();
    return token!;
  };
  const bearers = {
    admin: await bearerFor(emails.admin),
    member: await bearerFor(emails.member),
    idp: await bearerFor(emails.idp),
  };

  // The idp user, as the cloud's identity provider leaves one: no local
  // credential, `source` stamped `idp_provisioned`.
  engine.tables.set(
    'sys_account',
    accounts().filter((r) => !(r.provider_id === 'credential' && String(r.user_id) === ids.idp)),
  );
  users().find((r) => String(r.id) === ids.idp)!.source = 'idp_provisioned';
  users().find((r) => String(r.id) === ids.member)!.source = 'env_native';

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const fire = (path: string, body: unknown, bearer?: string) =>
    app.request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

  const credentialOf = (userId: string) =>
    accounts().find((r) => r.provider_id === 'credential' && String(r.user_id) === userId);
  const invitationsOf = (email: string) =>
    ((engine.tables.get('sys_invitation') ?? []) as any[]).filter(
      (r) => r.email === email && r.organization_id === DEFAULT_ORG,
    );

  return { engine, manager, fire, ids, bearers, users, credentialOf, invitationsOf };
}

/** Assert a cloud-managed refusal: 409, RESOURCE_CONFLICT, and the door's own sentence. */
function expectManagedRefusal(
  v: Awaited<ReturnType<typeof verdict>>,
  door: keyof typeof CLOUD_MANAGED_REFUSAL_MESSAGES,
): void {
  expect(v.status, v.text).toBe(409);
  expect(v.code, v.text).toBe('RESOURCE_CONFLICT');
  expect(v.message, v.text).toBe(CLOUD_MANAGED_REFUSAL_MESSAGES[door]);
}

// ─────────────────────────────────────────────────────────────────────────────
// The audience posture
// ─────────────────────────────────────────────────────────────────────────────

describe('[#25083] the audience posture on a cloud-managed environment', () => {
  const open = { posture: 'open', selfRegistrationPermissionSet: 'member_default' } as const;
  const emailDomain = {
    posture: 'email_domain',
    allowedEmailDomains: ['acme.com'],
    selfRegistrationPermissionSet: 'member_default',
  } as const;

  it('refuses every posture but invite_only at the entry validation', () => {
    setManaged(true);
    for (const raw of [open, emailDomain]) {
      expect(() => assertAudienceConfig(raw as any, undefined)).toThrow(
        new RegExp(`posture '${raw.posture}' opens self-registration, which a cloud-managed environment`),
      );
    }
    expect(() => assertAudienceConfig({ posture: 'invite_only' } as any, undefined)).not.toThrow();
    expect(() => assertAudienceConfig(undefined, undefined)).not.toThrow();
  });

  it('refuses the boot that declares open, and a patch that would open it keeps the standing posture', () => {
    setManaged(true);
    const engine = createMemoryEngine();
    expect(() => makeManager(engine, { audience: open })).toThrow(/cloud-managed environment/);

    const manager = makeManager(engine);
    expect(() => manager.applyConfigPatch({ audience: open } as any)).toThrow(/cloud-managed environment/);
    expect(manager.getAudience().posture).toBe('invite_only');
  });

  it('unmanaged, the same declarations are accepted as before', () => {
    for (const raw of [open, emailDomain]) {
      expect(() => assertAudienceConfig(raw as any, undefined)).not.toThrow();
    }
    expect(makeManager(createMemoryEngine(), { audience: open }).getAudience().posture).toBe('open');
  });

  it('a provider-class (IdP just-in-time) creation is admitted with no grant, managed or not', () => {
    // Ruling Q1 B: no just-in-time key, so the JIT user holds the baseline and
    // nothing is written per user. The posture matrix is pinned in
    // audience-posture.test.ts; this leg pins that the managed mode adds nothing.
    setManaged(true);
    const v = decideAudienceAdmission({
      email: 'jit@acme.com',
      hasPendingInvitation: false,
      isBootstrap: false,
      audience: resolveAudience(undefined),
      creationClass: 'provider',
    });
    expect(v).toEqual({ admit: true, grantPermissionSet: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Local sign-up
// ─────────────────────────────────────────────────────────────────────────────

describe('[#25083] local sign-up on a cloud-managed environment', () => {
  it('is forced off whatever disableSignUp says, and advertised so; SSO-only is not claimed', () => {
    setManaged(true);
    const manager = makeManager(createMemoryEngine(), { emailAndPassword: { disableSignUp: false } });
    const config = manager.getPublicConfig() as any;
    expect(config.emailPassword.disableSignUp).toBe(true);
    expect(config.emailPassword.enabled).toBe(true);
    expect(config.features.ssoEnforced).toBe(false);
  });

  it('unmanaged, the declared value stands', () => {
    const manager = makeManager(createMemoryEngine(), { emailAndPassword: { disableSignUp: false } });
    expect((manager.getPublicConfig() as any).emailPassword.disableSignUp).toBe(false);
  });

  it('refuses an invited self-serve sign-up on the wire; the first-run owner still enters', async () => {
    setManaged(true);
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const signUp = (email: string) =>
      manager.handleRequest(
        new Request(`${ORIGIN}${BASE}/sign-up/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: PASSWORD, name: email }),
        }),
      );

    const owner = await signUp('owner.25083@example.com');
    expect(owner.status, await owner.clone().text()).toBe(200);

    await inviteForAudienceGate(manager, 'invitee.25083@example.com');
    const invitee = await verdict(await signUp('invitee.25083@example.com'));
    expect(invitee.status, invitee.text).toBe(400);
    expect(invitee.code, invitee.text).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');
    expect(((engine.tables.get('sys_user') ?? []) as any[]).map((u) => u.email)).toEqual([
      'owner.25083@example.com',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invitations, create-user, import-users
// ─────────────────────────────────────────────────────────────────────────────

describe('[#25083] invitations and the admin user doors on a cloud-managed environment', () => {
  it('invite-member answers 409 RESOURCE_CONFLICT and writes no invitation', async () => {
    const s = await stage();
    setManaged(true);
    const v = await verdict(
      await s.fire('/organization/invite-member', {
        email: 'newcomer.25083@example.com',
        role: 'member',
        organizationId: DEFAULT_ORG,
      }, s.bearers.admin),
    );
    expectManagedRefusal(v, 'invitation');
    expect(s.invitationsOf('newcomer.25083@example.com')).toHaveLength(0);
  }, 120_000);

  it('a resend of an invitation still pending from before answers 409 too, and its expiry does not move', async () => {
    // better-auth answers `resend: true` BEFORE `beforeCreateInvitation`
    // runs: it extends the pending row and sends the e-mail again. The row
    // here was issued while the environment was still unmanaged, which is
    // what every hosted environment holds until this lands.
    const s = await stage();
    const email = 'pending.25083@example.com';
    const issued = await verdict(
      await s.fire('/organization/invite-member', { email, role: 'member', organizationId: DEFAULT_ORG }, s.bearers.admin),
    );
    expect(issued.status, issued.text).toBe(200);
    expect(s.invitationsOf(email)).toHaveLength(1);
    // Still pending (an hour out), and earlier than the 48 hours a resend sets.
    const fixedExpiry = new Date(Date.now() + 60 * 60_000);
    s.invitationsOf(email)[0].expires_at = fixedExpiry;

    setManaged(true);
    const v = await verdict(
      await s.fire(
        '/organization/invite-member',
        { email, role: 'member', organizationId: DEFAULT_ORG, resend: true },
        s.bearers.admin,
      ),
    );
    expectManagedRefusal(v, 'invitation');
    expect(s.invitationsOf(email)).toHaveLength(1);
    expect(s.invitationsOf(email)[0].expires_at).toEqual(fixedExpiry);
  }, 120_000);

  it('CONTROL: unmanaged, the same resend is answered and extends the expiry', async () => {
    // Without this leg the case above would pass on a resend that never
    // moved the expiry in this fixture at all.
    const s = await stage();
    const email = 'pending.25083@example.com';
    await s.fire('/organization/invite-member', { email, role: 'member', organizationId: DEFAULT_ORG }, s.bearers.admin);
    // Still pending (an hour out), and earlier than the 48 hours a resend sets.
    const fixedExpiry = new Date(Date.now() + 60 * 60_000);
    s.invitationsOf(email)[0].expires_at = fixedExpiry;

    const v = await verdict(
      await s.fire(
        '/organization/invite-member',
        { email, role: 'member', organizationId: DEFAULT_ORG, resend: true },
        s.bearers.admin,
      ),
    );
    expect(v.status, v.text).toBe(200);
    expect(new Date(s.invitationsOf(email)[0].expires_at).getTime()).toBeGreaterThan(fixedExpiry.getTime());
  }, 120_000);

  it('create-user answers 409 RESOURCE_CONFLICT to a platform admin and creates no user', async () => {
    const s = await stage();
    setManaged(true);
    const before = s.users().length;
    const v = await verdict(
      await s.fire('/admin/create-user', { email: 'created.25083@example.com', name: 'Created', generatePassword: true }, s.bearers.admin),
    );
    expectManagedRefusal(v, 'createUser');
    expect(s.users()).toHaveLength(before);
  }, 120_000);

  it('import-users answers 409 RESOURCE_CONFLICT to a platform admin and imports nothing', async () => {
    const s = await stage();
    setManaged(true);
    const before = s.users().length;
    const v = await verdict(
      await s.fire('/admin/import-users', {
        rows: [{ email: 'imported.25083@example.com', name: 'Imported' }],
        passwordPolicy: 'temporary',
      }, s.bearers.admin),
    );
    expectManagedRefusal(v, 'importUsers');
    expect(s.users()).toHaveLength(before);
  }, 120_000);

  it('the admin check still answers first: a non-admin hears 403 PERMISSION_DENIED, not the managed refusal', async () => {
    const s = await stage();
    setManaged(true);
    for (const path of ['/admin/create-user', '/admin/import-users']) {
      const v = await verdict(await s.fire(path, { email: 'x.25083@example.com' }, s.bearers.member));
      expect(v.status, `${path}: ${v.text}`).toBe(403);
      expect(v.code, `${path}: ${v.text}`).toBe('PERMISSION_DENIED');
    }
  }, 120_000);

  it('unmanaged with SSO-only on, invite-member and create-user answer as before', async () => {
    const s = await stage();
    process.env[SSO_ONLY_ENV] = 'true';
    const invite = await verdict(
      await s.fire('/organization/invite-member', {
        email: 'newcomer.25083@example.com',
        role: 'member',
        organizationId: DEFAULT_ORG,
      }, s.bearers.admin),
    );
    expect(invite.status, invite.text).toBe(200);
    expect(s.invitationsOf('newcomer.25083@example.com')).toHaveLength(1);

    const created = await verdict(
      await s.fire('/admin/create-user', { email: 'created.25083@example.com', name: 'Created', generatePassword: true }, s.bearers.admin),
    );
    expect(created.status, created.text).toBe(200);
    expect(s.users().some((u) => u.email === 'created.25083@example.com')).toBe(true);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// The two password doors — split by population
// ─────────────────────────────────────────────────────────────────────────────

describe('[#25083] the password doors on a cloud-managed environment', () => {
  it('admin set-user-password refuses an idp_provisioned target with 409 and writes no credential', async () => {
    const s = await stage();
    setManaged(true);
    const v = await verdict(
      await s.fire('/admin/set-user-password', { userId: s.ids.idp, newPassword: NEW_PASSWORD }, s.bearers.admin),
    );
    expectManagedRefusal(v, 'setUserPassword');
    expect(s.credentialOf(s.ids.idp)).toBeUndefined();
  }, 120_000);

  it('admin set-user-password still answers 200 on an env_native target (break-glass stays editable)', async () => {
    const s = await stage();
    setManaged(true);
    const before = s.credentialOf(s.ids.member)?.password;
    const v = await verdict(
      await s.fire('/admin/set-user-password', { userId: s.ids.member, newPassword: NEW_PASSWORD }, s.bearers.admin),
    );
    expect(v.status, v.text).toBe(200);
    expect(s.credentialOf(s.ids.member)?.password).not.toBe(before);
  }, 120_000);

  it('set-initial-password refuses a caller without platform-admin standing with 409 and writes no credential', async () => {
    const s = await stage();
    setManaged(true);
    const v = await verdict(await s.fire('/set-initial-password', { newPassword: NEW_PASSWORD }, s.bearers.idp));
    expectManagedRefusal(v, 'setInitialPassword');
    expect(s.credentialOf(s.ids.idp)).toBeUndefined();
  }, 120_000);

  it('set-initial-password still admits a platform admin, who can give themselves the break-glass password', async () => {
    const s = await stage();
    // The admin as a cloud-onboarded administrator first arrives: no local credential yet.
    s.engine.tables.set(
      'sys_account',
      ((s.engine.tables.get('sys_account') ?? []) as any[]).filter(
        (r) => !(r.provider_id === 'credential' && String(r.user_id) === s.ids.admin),
      ),
    );
    setManaged(true);
    const v = await verdict(await s.fire('/set-initial-password', { newPassword: NEW_PASSWORD }, s.bearers.admin));
    expect(v.status, v.text).toBe(200);
    expect(s.credentialOf(s.ids.admin)).toBeDefined();
  }, 120_000);

  it('an anonymous set-initial-password caller is answered as before, not with the managed refusal', async () => {
    const s = await stage();
    setManaged(true);
    const v = await verdict(await s.fire('/set-initial-password', { newPassword: NEW_PASSWORD }));
    expect(v.status, v.text).toBe(401);
    expect(v.code, v.text).not.toBe('RESOURCE_CONFLICT');
  }, 120_000);

  it('unmanaged with SSO-only on, both doors answer the idp user as before', async () => {
    const s = await stage();
    process.env[SSO_ONLY_ENV] = 'true';
    const setByAdmin = await verdict(
      await s.fire('/admin/set-user-password', { userId: s.ids.idp, newPassword: NEW_PASSWORD }, s.bearers.admin),
    );
    expect(setByAdmin.status, setByAdmin.text).toBe(200);
    expect(s.credentialOf(s.ids.idp)).toBeDefined();
  }, 120_000);

  it('unmanaged, an idp user sets their own initial password as before', async () => {
    const s = await stage();
    const v = await verdict(await s.fire('/set-initial-password', { newPassword: NEW_PASSWORD }, s.bearers.idp));
    expect(v.status, v.text).toBe(200);
    expect(s.credentialOf(s.ids.idp)).toBeDefined();
  }, 120_000);
});

describe('[#25083] what a host that mounts its own twin of a door imports', () => {
  // The cloud mounts a per-environment twin of `set-initial-password`
  // (objectstack-ai/cloud#3169). It takes the same arm from the package entry,
  // so its refusal and its standing check cannot drift from this door's.
  it('the package entry exports the managed refusal and the platform-admin predicate', async () => {
    const entry = await import('./index');
    expect(entry.cloudManagedRefusal('setInitialPassword')).toEqual({
      status: 409,
      body: {
        success: false,
        error: { code: 'RESOURCE_CONFLICT', message: CLOUD_MANAGED_REFUSAL_MESSAGES.setInitialPassword },
      },
    });
    expect(entry.isPlatformAdminUser({ isPlatformAdmin: true })).toBe(true);
    expect(entry.isPlatformAdminUser({ role: 'user' })).toBe(false);
  });
});
