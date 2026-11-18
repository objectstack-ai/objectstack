// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#33181] Pending, SSO-only people on a cloud-managed environment, on a
// kernel WITHOUT the better-auth admin plugin (a Free or Team hosted
// environment, where it mounts only with SCIM).
//
// `admin/add-sso-user` and `admin/import-sso-users` add a person ahead of
// their first sign-in: a `sys_user` row marked `idp_pending`, no password,
// with positions, permission sets and a manager. Every password door refuses
// that row, and so does session creation, until the first platform sign-in
// binds to it (pinned in `implicit-account-linking.test.ts`). `admin/ban-user`
// and `admin/unban-user` work without the admin plugin, and a banned row is
// refused a session. A host is told on add, deactivate and reactivate.
//
// Every door is driven through the REAL seam: a real `AuthManager` on the
// installed better-auth, behind `AuthPlugin.registerAuthRoutes` mounted on a
// real Hono app. Each refusal asserts the code AND the status, and that
// nothing was written; the CONTROL legs show `env_native` and
// `idp_provisioned` rows answered as before.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { PluginContext } from '@objectstack/core';
import { resetCloudManagedForTesting } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { CLOUD_MANAGED_REFUSAL_MESSAGES } from './cloud-managed';
import { PENDING_SSO_MESSAGES, PENDING_SSO_SOURCE } from './pending-sso-marker';
import { BANNED_USER_SESSION_REFUSAL, PENDING_SSO_SESSION_REFUSAL } from './user-session-admission';
import { EnvironmentUserHostRefusal, type EnvironmentUserEvent, type EnvironmentUserHost } from './environment-user-host';
import { runAdminUnbanUser } from './admin-ban-endpoints';
import { runAddSsoUser } from './pending-sso-users';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { SysUser } from '@objectstack/platform-objects/identity';
import { celEngine } from '@objectstack/formula';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-33181';
const NEW_PASSWORD = 'An0ther!Passw0rd-33181';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const DEFAULT_ORG = 'org_default';

const MANAGED_ENV = 'OS_CLOUD_MANAGED';
const SSO_ONLY_ENV = 'OS_AUTH_SSO_ONLY';
const OWNER_ENV = 'OS_PLATFORM_OWNER_EMAIL';
const savedEnv: Record<string, string | undefined> = {};

const EMAILS = {
  admin: 'admin.33181@example.com',
  member: 'member.33181@example.com',
  idp: 'idp.33181@example.com',
} as const;

/** The managed switch, as the cloud's containers set it; off = unset, as on a self-hosted image. */
function setManaged(on: boolean): void {
  if (on) process.env[MANAGED_ENV] = '1';
  else delete process.env[MANAGED_ENV];
  // `isCloudManaged()` memoizes its first read (#25306), so every switch
  // re-reads it; without this the first case's answer would stick.
  resetCloudManagedForTesting();
}

beforeEach(() => {
  for (const key of [MANAGED_ENV, SSO_ONLY_ENV, OWNER_ENV]) savedEnv[key] = process.env[key];
  setManaged(false);
  delete process.env[SSO_ONLY_ENV];
  // The platform-admin standing the doors' gate judges, with the admin plugin
  // off: the configured owner address on a verified row (ADR-0068).
  process.env[OWNER_ENV] = EMAILS.admin;
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

const makeManager = (
  engine: ReturnType<typeof createMemoryEngine>,
  adminPlugin: boolean,
  extra: Record<string, unknown> = {},
) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { admin: adminPlugin },
    membershipPolicy: 'auto',
    getTenancy: () => singleOrgTenancy(),
    ...extra,
  } as any);

/**
 * The staged rows every door case starts from, produced ONCE for the file
 * (#23181): staging signs three users up, and each sign-up is a fresh-salt
 * production scrypt derivation, the cost that made fourteen identical
 * stagings the bulk of this file's wall. Staged UNMANAGED (so the fixture
 * users can sign up through the invitation lane), with SSO-only off.
 *
 *  - `admin`: a platform admin (the legacy `role` scalar, which
 *    `isPlatformAdminUser` accepts) and the owner of the default organization,
 *    so it can reach invite-member, create-user, import-users and the
 *    password doors.
 *  - `member`: an ordinary `env_native` user holding a local password.
 *  - `idp`: an `idp_provisioned` user with no local credential, the
 *    population the cloud's identity provider owns.
 *
 * The bearers are the sessions better-auth minted at staging; they live as
 * `sys_session` rows, so every copy of the tables carries them.
 */
async function produceStagedRows() {
  const engine = createMemoryEngine();
  engine.tables.set('sys_organization', [{ id: DEFAULT_ORG, name: 'Default', slug: 'default' }]);
  const manager = makeManager(engine, true);

  const direct = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  const emails = EMAILS;
  for (const email of Object.values(emails)) {
    const invitationId = await inviteForAudienceGate(manager, email);
    const res = await direct('/sign-up/email', { email, password: PASSWORD, name: email, invitationId });
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
  users().find((r) => String(r.id) === ids.admin)!.email_verified = true;
  users().find((r) => String(r.id) === ids.admin)!.source = 'env_native';

  return { tables: structuredClone(new Map(engine.tables)), ids, bearers };
}

let staged: Awaited<ReturnType<typeof produceStagedRows>>;

beforeAll(async () => {
  const saved = { [MANAGED_ENV]: process.env[MANAGED_ENV], [SSO_ONLY_ENV]: process.env[SSO_ONLY_ENV] };
  setManaged(false);
  delete process.env[SSO_ONLY_ENV];
  const quiet = (['info', 'warn', 'error'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  try {
    staged = await produceStagedRows();
  } finally {
    for (const spy of quiet) spy.mockRestore();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetCloudManagedForTesting();
  }
}, 120_000);

/**
 * One deployment over its OWN copy of the staged rows: a fresh engine, a fresh
 * `AuthManager` and a fresh mount chain per case, exactly as a per-case
 * staging gave, so no case sees another's writes. The tests switch the mode
 * on afterwards: every door under test reads the accessor per request.
 */
async function stage(
  opts: { adminPlugin?: boolean; host?: EnvironmentUserHost | 'none'; tables?: Map<string, any[]>; config?: Record<string, unknown> } = {},
) {
  const engine = createMemoryEngine();
  for (const [name, rows] of structuredClone(opts.tables ?? staged.tables)) engine.tables.set(name, rows);
  const manager = makeManager(engine, opts.adminPlugin ?? false, opts.config);
  const told: Array<{ kind: string; event: EnvironmentUserEvent }> = [];
  const recordingHost: EnvironmentUserHost = {
    userAdded: (event) => void told.push({ kind: 'added', event }),
    userDeactivated: (event) => void told.push({ kind: 'deactivated', event }),
    userReactivated: (event) => void told.push({ kind: 'reactivated', event }),
  };
  const host = opts.host === 'none' ? undefined : (opts.host ?? recordingHost);
  const { ids, bearers } = staged;

  const users = () => (engine.tables.get('sys_user') ?? []) as any[];
  const accounts = () => (engine.tables.get('sys_account') ?? []) as any[];

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET, ...(host ? { environmentUserHost: () => host } : {}) });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  // The tenancy service `init` builds reads the engine from the kernel, which
  // this harness does not have; the same single-organization answer the
  // manager is given stands in for it.
  (plugin as any).tenancy = singleOrgTenancy();
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

  const signIn = (email: string, password = PASSWORD) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email, password }),
      }),
    );
  const row = (email: string) => users().find((r) => r.email === email);
  const rowsOf = (table: string, userId: string) =>
    ((engine.tables.get(table) ?? []) as any[]).filter((r) => String(r.user_id) === userId);

  return { engine, manager, fire, ids, bearers, users, credentialOf, invitationsOf, told, signIn, row, rowsOf };
}


const managedStage = async (opts: Parameters<typeof stage>[0] = {}) => {
  const s = await stage(opts);
  setManaged(true);
  return s;
};

// ─────────────────────────────────────────────────────────────────────────────
// Adding one person
// ─────────────────────────────────────────────────────────────────────────────

describe('[#33181] admin/add-sso-user on a managed environment without the admin plugin', () => {
  it('adds a pending person with positions, permission sets and a manager, and tells the host', async () => {
    const s = await managedStage();
    const email = 'new.person@example.com';

    const res = await s.fire(
      '/admin/add-sso-user',
      { email, name: 'New Person', positions: ['sales_rep'], permissionSets: ['crm_user', 'report_viewer'], manager: EMAILS.member },
      s.bearers.admin,
    );
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(201);
    const row = s.row(email)!;
    expect(row.source).toBe(PENDING_SSO_SOURCE);
    expect(row.email_verified).toBeFalsy();
    expect(String(row.manager_id)).toBe(s.ids.member);
    expect(s.rowsOf('sys_account', String(row.id))).toHaveLength(0);
    expect(s.rowsOf('sys_user_position', String(row.id)).map((r) => r.position)).toEqual(['sales_rep']);
    expect(s.rowsOf('sys_user_permission_set', String(row.id)).map((r) => r.permission_set).sort()).toEqual(['crm_user', 'report_viewer']);
    expect(s.rowsOf('sys_member', String(row.id)).map((m) => m.organization_id)).toEqual([DEFAULT_ORG]);
    expect(body.data).toMatchObject({ userId: String(row.id), alreadyPending: false, manager: 'linked', host: { notified: true } });
    expect(s.told).toEqual([
      {
        kind: 'added',
        event: expect.objectContaining({ userId: String(row.id), email, name: 'New Person', source: PENDING_SSO_SOURCE, actorId: s.ids.admin }),
      },
    ]);
  });

  it('adding a still-pending person again answers 200 alreadyPending, writes no second row, and tells the host again', async () => {
    const s = await managedStage();
    const email = 'again.person@example.com';
    expect((await s.fire('/admin/add-sso-user', { email, name: 'Again' }, s.bearers.admin)).status).toBe(201);

    const res = await s.fire('/admin/add-sso-user', { email, name: 'Again' }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.alreadyPending).toBe(true);
    expect(s.users().filter((r) => r.email === email)).toHaveLength(1);
    expect(s.told.map((t) => t.kind)).toEqual(['added', 'added']);
  });

  it('refuses an address already held by a person who is not pending, with 409, and tells no host', async () => {
    const s = await managedStage();
    for (const email of [EMAILS.member, EMAILS.idp]) {
      const v = await verdict(await s.fire('/admin/add-sso-user', { email, name: 'Taken' }, s.bearers.admin));
      expect(v.status, v.text).toBe(409);
      expect(v.code).toBe('RESOURCE_CONFLICT');
      expect(v.message).toBe(PENDING_SSO_MESSAGES.alreadyExists);
    }
    expect(s.row(EMAILS.member)!.source).toBe('env_native');
    expect(s.row(EMAILS.idp)!.source).toBe('idp_provisioned');
    expect(s.told).toEqual([]);
  });

  it('refuses a body key it does not take, such as a password, with 400 and adds no one', async () => {
    const s = await managedStage();
    const v = await verdict(
      await s.fire('/admin/add-sso-user', { email: 'pw.person@example.com', name: 'Pw', password: NEW_PASSWORD }, s.bearers.admin),
    );
    expect(v.status, v.text).toBe(400);
    expect(s.row('pw.person@example.com')).toBeUndefined();
  });

  it('a caller without platform-admin standing is refused 403 and no one is added', async () => {
    const s = await managedStage();
    const v = await verdict(await s.fire('/admin/add-sso-user', { email: 'nope@example.com', name: 'Nope' }, s.bearers.member));
    expect(v.status, v.text).toBe(403);
    expect(v.code).toBe('PERMISSION_DENIED');
    expect(s.row('nope@example.com')).toBeUndefined();
  });

  it('CONTROL: off a managed environment both doors answer 409 and add no one', async () => {
    const s = await stage();
    for (const [path, body] of [
      ['/admin/add-sso-user', { email: 'off.person@example.com', name: 'Off' }],
      ['/admin/import-sso-users', { rows: [{ email: 'off.person@example.com', name: 'Off' }] }],
    ] as const) {
      const v = await verdict(await s.fire(path, body, s.bearers.admin));
      expect(v.status, v.text).toBe(409);
      expect(v.code).toBe('RESOURCE_CONFLICT');
      expect(v.message).toBe(PENDING_SSO_MESSAGES.notManaged);
    }
    expect(s.row('off.person@example.com')).toBeUndefined();
    expect(s.told).toEqual([]);
  });

  it('a host that fails does not undo the add; the answer says host_failed', async () => {
    const s = await managedStage({
      host: {
        userAdded: () => {
          throw new Error('host down');
        },
        userDeactivated: () => {},
        userReactivated: () => {},
      },
    });
    const res = await s.fire('/admin/add-sso-user', { email: 'hostfail@example.com', name: 'Host Fail' }, s.bearers.admin);
    const body: any = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.host).toEqual({ notified: false, reason: 'host_failed' });
    expect(s.row('hostfail@example.com')!.source).toBe(PENDING_SSO_SOURCE);
  });

  it('with no host wired the add stands and the answer says no_host', async () => {
    const s = await managedStage({ host: 'none' });
    const res = await s.fire('/admin/add-sso-user', { email: 'nohost@example.com', name: 'No Host' }, s.bearers.admin);
    const body: any = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.host).toEqual({ notified: false, reason: 'no_host' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Importing
// ─────────────────────────────────────────────────────────────────────────────

describe('[#33181] admin/import-sso-users on a managed environment without the admin plugin', () => {
  it('a bad row fails alone and the good rows land, managers resolved across the file', async () => {
    const s = await managedStage();
    const csv = [
      'email,name,positions,permission_sets,manager_id',
      'lead@example.com,Team Lead,sales_manager,crm_user,',
      'rep@example.com,Sales Rep,sales_rep,crm_user;report_viewer,lead@example.com',
      'not-an-email,Broken,,,',
      'rep@example.com,Duplicate,,,',
      `${EMAILS.member},Taken,,,`,
    ].join('\n');

    const res = await s.fire('/admin/import-sso-users', { csv }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.summary).toMatchObject({ total: 5, added: 2, failed: 3 });
    const byRow = Object.fromEntries(body.data.rows.map((r: any) => [r.row, r]));
    expect(byRow[1].ok && byRow[2].ok).toBe(true);
    expect([byRow[3].ok, byRow[4].ok, byRow[5].ok]).toEqual([false, false, false]);
    expect(byRow[2].manager).toBe('linked');

    const lead = s.row('lead@example.com')!;
    const rep = s.row('rep@example.com')!;
    expect([lead.source, rep.source]).toEqual([PENDING_SSO_SOURCE, PENDING_SSO_SOURCE]);
    expect(rep.name).toBe('Sales Rep');
    expect(String(rep.manager_id)).toBe(String(lead.id));
    expect(s.rowsOf('sys_user_position', String(rep.id)).map((r) => r.position)).toEqual(['sales_rep']);
    expect(s.rowsOf('sys_user_permission_set', String(rep.id)).map((r) => r.permission_set).sort()).toEqual(['crm_user', 'report_viewer']);
    expect(s.row('not-an-email')).toBeUndefined();
    expect(s.row(EMAILS.member)!.source).toBe('env_native');
    expect(s.told.map((t) => t.event.email).sort()).toEqual(['lead@example.com', 'rep@example.com']);
  });

  it('refuses an unknown column, such as a password, with 400 and imports no one', async () => {
    const s = await managedStage();
    const v = await verdict(
      await s.fire('/admin/import-sso-users', { rows: [{ email: 'col@example.com', name: 'Col', password: NEW_PASSWORD }] }, s.bearers.admin),
    );
    expect(v.status, v.text).toBe(400);
    expect(s.row('col@example.com')).toBeUndefined();
  });

  it('a caller without platform-admin standing is refused 403 and no one is imported', async () => {
    const s = await managedStage();
    const v = await verdict(await s.fire('/admin/import-sso-users', { rows: [{ email: 'nope2@example.com', name: 'N' }] }, s.bearers.member));
    expect(v.status, v.text).toBe(403);
    expect(s.row('nope2@example.com')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The password doors and the session
// ─────────────────────────────────────────────────────────────────────────────

describe('[#33181] a pending person gets no password and no session', () => {
  const addPending = async (s: Awaited<ReturnType<typeof stage>>, email: string) => {
    const res = await s.fire('/admin/add-sso-user', { email, name: 'Pending' }, s.bearers.admin);
    expect(res.status, await res.clone().text()).toBe(201);
    return String(s.row(email)!.id);
  };

  it('admin set-user-password refuses a pending target with 409 and writes no credential', async () => {
    const s = await managedStage();
    const id = await addPending(s, 'pw.pending@example.com');
    const v = await verdict(await s.fire('/admin/set-user-password', { userId: id, newPassword: NEW_PASSWORD }, s.bearers.admin));
    expect(v.status, v.text).toBe(409);
    expect(v.code).toBe('RESOURCE_CONFLICT');
    expect(v.message).toBe(PENDING_SSO_MESSAGES.setUserPassword);
    expect(s.credentialOf(id)).toBeUndefined();
    expect(s.row('pw.pending@example.com')!.source).toBe(PENDING_SSO_SOURCE);
  });

  it('admin set-user-password refuses a pending target off a managed environment too', async () => {
    const s = await managedStage();
    const id = await addPending(s, 'pw.unmanaged@example.com');
    setManaged(false);
    const v = await verdict(await s.fire('/admin/set-user-password', { userId: id, newPassword: NEW_PASSWORD }, s.bearers.admin));
    expect(v.status, v.text).toBe(409);
    expect(v.message).toBe(PENDING_SSO_MESSAGES.setUserPassword);
    expect(s.credentialOf(id)).toBeUndefined();
  });

  it('set-initial-password refuses a pending caller with 409 and writes no credential, managed or not', async () => {
    for (const managed of [true, false]) {
      const s = await stage();
      setManaged(managed);
      // A session held from before the row was marked pending (no new one can be opened for it).
      s.users().find((r) => String(r.id) === s.ids.idp)!.source = PENDING_SSO_SOURCE;
      const v = await verdict(await s.fire('/set-initial-password', { newPassword: NEW_PASSWORD }, s.bearers.idp));
      expect(v.status, `managed=${managed}: ${v.text}`).toBe(409);
      expect(v.code).toBe('RESOURCE_CONFLICT');
      // Managed, the cloud-managed arm answers a caller without platform-admin standing first.
      expect(v.message).toBe(managed ? CLOUD_MANAGED_REFUSAL_MESSAGES.setInitialPassword : PENDING_SSO_MESSAGES.setInitialPassword);
      expect(s.credentialOf(s.ids.idp)).toBeUndefined();
    }
  });

  it('set-initial-password refuses a pending caller who holds platform-admin standing, managed or not', async () => {
    for (const managed of [true, false]) {
      const s = await stage();
      setManaged(managed);
      process.env[OWNER_ENV] = EMAILS.idp;
      s.users().find((r) => String(r.id) === s.ids.idp)!.email_verified = true;
      s.users().find((r) => String(r.id) === s.ids.idp)!.source = PENDING_SSO_SOURCE;
      const v = await verdict(await s.fire('/set-initial-password', { newPassword: NEW_PASSWORD }, s.bearers.idp));
      expect(v.status, `managed=${managed}: ${v.text}`).toBe(409);
      // Managed, the cloud-managed arm refuses every signed-in caller first, a
      // platform administrator included (#33203).
      expect(v.message).toBe(managed ? CLOUD_MANAGED_REFUSAL_MESSAGES.setInitialPassword : PENDING_SSO_MESSAGES.setInitialPassword);
      expect(s.credentialOf(s.ids.idp)).toBeUndefined();
    }
  });

  it('CONTROL: off a managed environment an idp_provisioned caller sets their initial password as before', async () => {
    const s = await stage();
    const v = await verdict(await s.fire('/set-initial-password', { newPassword: NEW_PASSWORD }, s.bearers.idp));
    expect(v.status, v.text).toBe(200);
    expect(s.credentialOf(s.ids.idp)).toBeDefined();
  });

  it('CONTROL: off a managed environment set-user-password still answers 200 on an env_native target', async () => {
    // Managed, the door refuses every target (#33203, `cloud-managed.test.ts`).
    const s = await stage();
    const v = await verdict(await s.fire('/admin/set-user-password', { userId: s.ids.member, newPassword: NEW_PASSWORD }, s.bearers.admin));
    expect(v.status, v.text).toBe(200);
  });

  it('a session minted for a pending person is refused 403, on every channel that creates one', async () => {
    const s = await managedStage();
    const id = await addPending(s, 'session.pending@example.com');
    const ctx: any = await s.manager.getAuthContext();
    await expect(ctx.internalAdapter.createSession(id)).rejects.toMatchObject({
      statusCode: 403,
      body: expect.objectContaining({ code: 'PERMISSION_DENIED', message: PENDING_SSO_SESSION_REFUSAL.message }),
    });
    expect(s.rowsOf('sys_session', id)).toHaveLength(0);
  });

  it('CONTROL: the same mint opens a session for an env_native and an idp_provisioned row', async () => {
    const s = await managedStage();
    const ctx: any = await s.manager.getAuthContext();
    for (const id of [s.ids.member, s.ids.idp]) {
      const before = s.rowsOf('sys_session', id).length;
      await ctx.internalAdapter.createSession(id);
      expect(s.rowsOf('sys_session', id)).toHaveLength(before + 1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deactivate and reactivate without the admin plugin
// ─────────────────────────────────────────────────────────────────────────────

describe('[#33181] ban works without the admin plugin', () => {
  it('admin/ban-user bans, signs the user out, refuses their next sign-in, and tells the host', async () => {
    const s = await managedStage();
    const res = await s.fire('/admin/ban-user', { userId: s.ids.member, banReason: 'left the company' }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ userId: s.ids.member, banned: true, host: { notified: true } });
    const row = s.row(EMAILS.member)!;
    expect(row.banned).toBe(true);
    expect(row.ban_reason).toBe('left the company');
    expect(s.rowsOf('sys_session', s.ids.member)).toHaveLength(0);

    const signIn = await verdict(await s.signIn(EMAILS.member));
    expect(signIn.status, signIn.text).toBe(403);
    expect(signIn.code).toBe(BANNED_USER_SESSION_REFUSAL.code);
    expect(signIn.message).toBe(BANNED_USER_SESSION_REFUSAL.message);
    expect(s.rowsOf('sys_session', s.ids.member)).toHaveLength(0);
    expect(s.told).toEqual([
      { kind: 'deactivated', event: expect.objectContaining({ userId: s.ids.member, email: EMAILS.member, source: 'env_native', actorId: s.ids.admin }) },
    ]);
  });

  it('admin/unban-user restores sign-in and tells the host', async () => {
    const s = await managedStage();
    expect((await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin)).status).toBe(200);
    expect((await s.signIn(EMAILS.member)).status).toBe(403);

    const res = await s.fire('/admin/unban-user', { userId: s.ids.member }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ banned: false, host: { notified: true } });
    const row = s.row(EMAILS.member)!;
    expect(row.banned).toBe(false);
    expect(row.ban_reason ?? null).toBeNull();
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
    expect(s.told.map((t) => t.kind)).toEqual(['deactivated', 'reactivated']);
  });

  it('a row banned while the admin plugin was on stays refused after the plugin is turned off', async () => {
    const on = await stage({ adminPlugin: true });
    expect((await on.fire('/admin/ban-user', { userId: on.ids.member }, on.bearers.admin)).status).toBe(200);
    expect((await on.signIn(EMAILS.member)).status).toBe(403);

    const off = await stage({ adminPlugin: false, tables: on.engine.tables });
    const v = await verdict(await off.signIn(EMAILS.member));
    expect(v.status, v.text).toBe(403);
    expect(v.code).toBe(BANNED_USER_SESSION_REFUSAL.code);
    expect(off.rowsOf('sys_session', off.ids.member)).toHaveLength(0);
  });

  it('a ban whose expiry has passed is lifted at the next sign-in, as the admin plugin does', async () => {
    const s = await managedStage();
    const row = s.row(EMAILS.member)!;
    Object.assign(row, { banned: true, ban_reason: 'cooling off', ban_expires: new Date(Date.now() - 60_000).toISOString() });

    expect((await s.signIn(EMAILS.member)).status).toBe(200);
    expect(s.row(EMAILS.member)!.banned).toBe(false);
  });

  it('CONTROL: with the admin plugin on, the ban is the vendor plugin\'s and its answer is unchanged', async () => {
    const s = await managedStage({ adminPlugin: true });
    const res = await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin);
    expect(res.status).toBe(200);
    const v = await verdict(await s.signIn(EMAILS.member));
    expect(v.status, v.text).toBe(403);
    expect(v.code).toBe('BANNED_USER');
    expect(v.message).toBe(BANNED_USER_SESSION_REFUSAL.message);
  });

  it('CONTROL: unbanned env_native rows sign in as before without the admin plugin', async () => {
    const s = await managedStage();
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
    expect((await s.signIn(EMAILS.admin)).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The host's typed refusals, and the administrator's cloud id
// ─────────────────────────────────────────────────────────────────────────────

const OWNER_CONFLICT = { status: 409, code: 'ORGANIZATION_OWNER_OR_ADMIN', message: 'An organization owner or admin is removed in the console.' } as const;
const MEMBER_CAP = { status: 403, code: 'DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED', message: 'The organization has reached its member limit.' } as const;

/** A host that refuses with `refusal` for the members named, and records every call. */
function refusingHost(
  refusal: { status: 403 | 409; code: string; message: string },
  refuse: { added?: (e: EnvironmentUserEvent) => boolean; deactivated?: boolean; reactivated?: boolean },
) {
  const told: Array<{ kind: string; event: EnvironmentUserEvent }> = [];
  const answer = (kind: string, event: EnvironmentUserEvent, refused: boolean) => {
    told.push({ kind, event });
    if (refused) throw new EnvironmentUserHostRefusal(refusal.status, refusal.code, refusal.message);
  };
  const host: EnvironmentUserHost = {
    userAdded: (e) => answer('added', e, refuse.added?.(e) ?? false),
    userDeactivated: (e) => answer('deactivated', e, refuse.deactivated ?? false),
    userReactivated: (e) => answer('reactivated', e, refuse.reactivated ?? false),
  };
  return { host, told };
}

describe('[#33181] a host\'s typed refusal refuses the operation', () => {
  it('an owner or admin 409 refuses the whole deactivation: nothing is written and the person stays signed in', async () => {
    const { host, told } = refusingHost(OWNER_CONFLICT, { deactivated: true });
    const s = await managedStage({ host });
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
    const sessionsBefore = s.rowsOf('sys_session', s.ids.member).length;

    const v = await verdict(await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin));

    expect(v.status, v.text).toBe(409);
    expect(v.code).toBe(OWNER_CONFLICT.code);
    expect(v.message).toBe(OWNER_CONFLICT.message);
    expect(Boolean(s.row(EMAILS.member)!.banned)).toBe(false);
    expect(s.rowsOf('sys_session', s.ids.member)).toHaveLength(sessionsBefore);
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
    expect(told.map((t) => t.kind)).toEqual(['deactivated']);
  });

  it('a member-cap 403 refuses the reactivation: the person stays deactivated', async () => {
    const { host } = refusingHost(MEMBER_CAP, { reactivated: true });
    const s = await managedStage({ host });
    expect((await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin)).status).toBe(200);

    const v = await verdict(await s.fire('/admin/unban-user', { userId: s.ids.member }, s.bearers.admin));

    expect(v.status, v.text).toBe(403);
    expect(v.code).toBe(MEMBER_CAP.code);
    expect(v.message).toBe(MEMBER_CAP.message);
    expect(s.row(EMAILS.member)!.banned).toBe(true);
    expect((await s.signIn(EMAILS.member)).status).toBe(403);
  });

  it('a member-cap 403 on an add takes the person back out: no row, grants or membership remain', async () => {
    const { host, told } = refusingHost(MEMBER_CAP, { added: () => true });
    const s = await managedStage({ host });
    const email = 'capped@example.com';

    const v = await verdict(
      await s.fire('/admin/add-sso-user', { email, name: 'Capped', positions: ['sales_rep'], permissionSets: ['crm_user'] }, s.bearers.admin),
    );

    expect(v.status, v.text).toBe(403);
    expect(v.code).toBe(MEMBER_CAP.code);
    expect(v.message).toBe(MEMBER_CAP.message);
    const id = String(told[0]!.event.userId);
    expect(s.row(email)).toBeUndefined();
    for (const table of ['sys_user_position', 'sys_user_permission_set', 'sys_member']) {
      expect(s.rowsOf(table, id), table).toHaveLength(0);
    }
  });

  it('a member-cap 403 on one import row fails that row alone; the others land', async () => {
    const { host } = refusingHost(MEMBER_CAP, { added: (e) => e.email === 'over@example.com' });
    const s = await managedStage({ host });
    const csv = ['email,name,positions,permission_sets,manager_id', 'first@example.com,First,,crm_user,', 'over@example.com,Over,,crm_user,', 'third@example.com,Third,,,'].join('\n');

    const res = await s.fire('/admin/import-sso-users', { csv }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.summary).toMatchObject({ total: 3, added: 2, failed: 1 });
    expect(body.data.rows[1]).toMatchObject({ row: 2, ok: false, error: { code: MEMBER_CAP.code, message: MEMBER_CAP.message } });
    expect(s.row('over@example.com')).toBeUndefined();
    expect([s.row('first@example.com')?.source, s.row('third@example.com')?.source]).toEqual([PENDING_SSO_SOURCE, PENDING_SSO_SOURCE]);
  });

  it('a refused re-add of a still-pending person fails the request and leaves their row as it was', async () => {
    let refuse = false;
    const { host } = refusingHost(MEMBER_CAP, { added: () => refuse });
    const s = await managedStage({ host });
    expect((await s.fire('/admin/add-sso-user', { email: 'again@example.com', name: 'Again' }, s.bearers.admin)).status).toBe(201);
    refuse = true;

    const v = await verdict(await s.fire('/admin/add-sso-user', { email: 'again@example.com', name: 'Again' }, s.bearers.admin));

    expect(v.status, v.text).toBe(403);
    expect(v.code).toBe(MEMBER_CAP.code);
    expect(s.row('again@example.com')!.source).toBe(PENDING_SSO_SOURCE);
  });

  it('a wired host that does not answer refuses the deactivation with 503, and nothing is written', async () => {
    const s = await managedStage({
      host: {
        userAdded: () => {},
        userDeactivated: () => {
          throw Object.assign(new Error('gateway timeout'), { status: 409, code: OWNER_CONFLICT.code });
        },
        userReactivated: () => {},
      },
    });
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
    const v = await verdict(await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin));
    expect(v.status, v.text).toBe(503);
    expect(v.code).toBe('SERVICE_UNAVAILABLE');
    expect(Boolean(s.row(EMAILS.member)!.banned)).toBe(false);
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
  });

  it('CONTROL: a host that does not answer never blocks a reactivation; the answer says host_failed', async () => {
    let failing = false;
    const s = await managedStage({
      host: {
        userAdded: () => {},
        userDeactivated: () => {},
        userReactivated: () => {
          if (failing) throw new Error('gateway timeout');
        },
      },
    });
    expect((await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin)).status).toBe(200);
    failing = true;
    const res = await s.fire('/admin/unban-user', { userId: s.ids.member }, s.bearers.admin);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.host).toEqual({ notified: false, reason: 'host_failed' });
    expect(s.row(EMAILS.member)!.banned).toBe(false);
  });

  it('CONTROL: a typed refusal with a status the seam does not honour is a host failure, not that status', async () => {
    const s = await managedStage({
      host: {
        userAdded: () => {},
        userDeactivated: () => {
          throw new EnvironmentUserHostRefusal(500 as never, 'UPSTREAM', 'upstream failed');
        },
        userReactivated: () => {},
      },
    });
    const v = await verdict(await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin));
    expect(v.status, v.text).toBe(503);
    expect(v.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('CONTROL: with no host wired the deactivation goes ahead', async () => {
    const s = await managedStage({ host: 'none' });
    const res = await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).not.toHaveProperty('host');
    expect(s.row(EMAILS.member)!.banned).toBe(true);
  });
});

describe('[#33181] a re-add of a still-pending person names what it did not apply', () => {
  it('add-sso-user answers notApplied for the positions, permission sets and manager it did not apply', async () => {
    const s = await managedStage();
    const email = 'readd@example.com';
    expect((await s.fire('/admin/add-sso-user', { email, name: 'Re Add' }, s.bearers.admin)).status).toBe(201);
    const id = String(s.row(email)!.id);

    const res = await s.fire(
      '/admin/add-sso-user',
      { email, name: 'Re Add', positions: ['sales_rep'], permissionSets: ['crm_user'], manager: EMAILS.member },
      s.bearers.admin,
    );
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ alreadyPending: true, notApplied: ['positions', 'permissionSets', 'manager'] });
    expect(s.rowsOf('sys_user_position', id)).toHaveLength(0);
    expect(s.row(email)!.manager_id ?? null).toBeNull();
  });

  it('import-sso-users names the columns a re-added row did not apply', async () => {
    const s = await managedStage();
    expect((await s.fire('/admin/add-sso-user', { email: 'readd.csv@example.com', name: 'Re Add' }, s.bearers.admin)).status).toBe(201);
    const csv = ['email,name,positions,permission_sets,manager_id', `readd.csv@example.com,Re Add,,crm_user,${EMAILS.member}`].join('\n');
    const body: any = await (await s.fire('/admin/import-sso-users', { csv }, s.bearers.admin)).json();
    expect(body.data.rows[0]).toMatchObject({ ok: true, alreadyPending: true, notApplied: ['permission_sets', 'manager_id'] });
  });

  it('CONTROL: a re-add that sends no grants or manager carries no notApplied', async () => {
    const s = await managedStage();
    expect((await s.fire('/admin/add-sso-user', { email: 'readd.plain@example.com', name: 'Plain' }, s.bearers.admin)).status).toBe(201);
    const body: any = await (await s.fire('/admin/add-sso-user', { email: 'readd.plain@example.com', name: 'Plain' }, s.bearers.admin)).json();
    expect(body.data.alreadyPending).toBe(true);
    expect(body.data).not.toHaveProperty('notApplied');
  });
});

describe('[#33181] an import row that faults answers the generic sentence', () => {
  it('a fault while writing one row answers INTERNAL_ERROR_MESSAGE on that row, never the fault\'s own text', async () => {
    const s = await managedStage();
    const insert = (s.engine as any).insert.bind(s.engine) as (...args: unknown[]) => Promise<unknown>;
    (s.engine as any).insert = async (object: string, doc: any, ...rest: unknown[]) => {
      if (object === 'sys_user' && doc?.email === 'faulty@example.com') throw new Error('driver detail: relation sys_user_7 is locked');
      return insert(object, doc, ...rest);
    };
    const csv = ['email,name,positions,permission_sets,manager_id', 'faulty@example.com,Faulty,,,', 'fine@example.com,Fine,,,'].join('\n');
    const body: any = await (await s.fire('/admin/import-sso-users', { csv }, s.bearers.admin)).json();
    expect(body.data.rows[0].ok).toBe(false);
    expect(body.data.rows[0].error.message).toContain(INTERNAL_ERROR_MESSAGE);
    expect(body.data.rows[0].error.message).not.toContain('driver detail');
    expect(body.data.rows[1]).toMatchObject({ ok: true });
  });

  it('CONTROL: a declared refusal on a row keeps its own sentence', async () => {
    const s = await managedStage();
    const csv = ['email,name,positions,permission_sets,manager_id', `${EMAILS.member},Taken,,,`].join('\n');
    const body: any = await (await s.fire('/admin/import-sso-users', { csv }, s.bearers.admin)).json();
    expect(body.data.rows[0].error.message).toBe(PENDING_SSO_MESSAGES.alreadyExists);
  });
});

describe('[#33181] the host event names the administrator at the keyboard on an impersonation session', () => {
  const recording = () => {
    const told: EnvironmentUserEvent[] = [];
    const host: EnvironmentUserHost = {
      userAdded: (e) => void told.push(e),
      userDeactivated: (e) => void told.push(e),
      userReactivated: (e) => void told.push(e),
    };
    return { told, host };
  };
  const unbanRequest = () =>
    new Request(`${ORIGIN}${BASE}/admin/unban-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'target-1', impersonatedBy: 'forged' }),
    });
  const banDeps = (host: EnvironmentUserHost) => ({
    getAuthContext: async () => ({
      internalAdapter: {
        findUserById: async () => ({ id: 'target-1', email: 'target@example.com', name: 'Target' }),
        updateUser: async () => ({}),
        deleteUserSessions: async () => ({}),
      },
      adapter: {} as any,
    }),
    host: () => host,
    getDataEngine: () => ({ find: async () => [], findOne: async () => null }),
  });

  it('carries impersonatedBy from the session actor, never from the body', async () => {
    const { told, host } = recording();
    const res = await runAdminUnbanUser(banDeps(host) as any, { id: 'admin-1', impersonatedBy: 'real-admin-9' } as any, unbanRequest());
    expect(res.status).toBe(200);
    expect(told[0]).toMatchObject({ actorId: 'admin-1', impersonatedBy: 'real-admin-9' });
  });

  it('CONTROL: an ordinary session carries no impersonatedBy, whatever the body says', async () => {
    const { told, host } = recording();
    const res = await runAdminUnbanUser(banDeps(host) as any, { id: 'admin-1' }, unbanRequest());
    expect(res.status).toBe(200);
    expect(told[0]).not.toHaveProperty('impersonatedBy');
  });

  it('the add door carries it too', async () => {
    const { told, host } = recording();
    const engine = createMemoryEngine();
    const res = await runAddSsoUser(
      { isCloudManaged: () => true, getDataEngine: () => engine as any, host: () => host } as any,
      { id: 'admin-1', impersonatedBy: 'real-admin-9' } as any,
      new Request(`${ORIGIN}${BASE}/admin/add-sso-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'imp.added@example.com', name: 'Imp Added' }),
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(told[0]).toMatchObject({ actorId: 'admin-1', impersonatedBy: 'real-admin-9' });
  });
});

describe('[#33181] the host event names the administrator\'s cloud id from their linked account', () => {
  const linkAdminToCloud = (s: Awaited<ReturnType<typeof stage>>, accountId: string) => {
    const accounts = (s.engine.tables.get('sys_account') ?? []) as any[];
    accounts.push({ id: `acc_cloud_${accountId}`, user_id: s.ids.admin, provider_id: 'objectstack-cloud', account_id: accountId });
    s.engine.tables.set('sys_account', accounts);
  };

  it('add, ban and unban carry actorCloudUserId read from the linked objectstack-cloud account', async () => {
    const s = await managedStage();
    linkAdminToCloud(s, 'cloud-user-7');

    expect((await s.fire('/admin/add-sso-user', { email: 'attributed@example.com', name: 'Attributed' }, s.bearers.admin)).status).toBe(201);
    expect((await s.fire('/admin/ban-user', { userId: s.ids.member }, s.bearers.admin)).status).toBe(200);
    expect((await s.fire('/admin/unban-user', { userId: s.ids.member }, s.bearers.admin)).status).toBe(200);

    expect(s.told.map((t) => [t.kind, t.event.actorCloudUserId])).toEqual([
      ['added', 'cloud-user-7'],
      ['deactivated', 'cloud-user-7'],
      ['reactivated', 'cloud-user-7'],
    ]);
  });

  it('a cloud id in the request body is ignored: the linked account wins, and with no link it is absent', async () => {
    const s = await managedStage();
    expect((await s.fire('/admin/ban-user', { userId: s.ids.member, actorCloudUserId: 'forged' }, s.bearers.admin)).status).toBe(200);
    linkAdminToCloud(s, 'cloud-user-7');
    expect((await s.fire('/admin/unban-user', { userId: s.ids.member, actorCloudUserId: 'forged' }, s.bearers.admin)).status).toBe(200);

    expect(s.told[0]!.event).not.toHaveProperty('actorCloudUserId');
    expect(s.told[1]!.event.actorCloudUserId).toBe('cloud-user-7');
  });

  it('CONTROL: an account of another provider is not a cloud id', async () => {
    const s = await managedStage();
    const accounts = (s.engine.tables.get('sys_account') ?? []) as any[];
    accounts.push({ id: 'acc_okta', user_id: s.ids.admin, provider_id: 'okta', account_id: 'okta-user-1' });
    s.engine.tables.set('sys_account', accounts);
    expect((await s.fire('/admin/add-sso-user', { email: 'okta.actor@example.com', name: 'Okta Actor' }, s.bearers.admin)).status).toBe(201);
    expect(s.told[0]!.event).not.toHaveProperty('actorCloudUserId');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup → Users: the managed add actions reach these doors (cloud#4465 child 1b)
// ─────────────────────────────────────────────────────────────────────────────
//
// `sys_user.add_sso_user` and `sys_user.import_sso_users` are these doors'
// first-party callers. Each pin reads the DECLARED action and posts what its
// dialog submits, the way the console composes a `type: 'api'` body: the
// values collected for the params it declares, then `bodyExtra` merged last.
// The door's body is a closed key set, so a param it does not take would be
// answered 400 here rather than dropped.

describe('[#33186] the Setup → Users add actions reach the pending-person doors', () => {
  function declaredAction(name: string) {
    const action = (SysUser.actions ?? []).find((a) => a.name === name);
    if (!action) throw new Error(`sys_user declares no action named "${name}"`);
    return action;
  }

  /** The action's `target` under this mount, and the body its dialog submits. */
  function dialogCall(name: string, collected: Record<string, unknown>) {
    const action = declaredAction(name);
    const target = String(action.target);
    expect(target.startsWith(BASE), `${name} targets the auth mount`).toBe(true);
    const declaredNames = (action.params ?? []).map((p) => p.name ?? p.field);
    for (const key of Object.keys(collected)) expect(declaredNames, `${name} declares the ${key} param`).toContain(key);
    return { path: target.slice(BASE.length), body: { ...collected, ...(action.bodyExtra ?? {}) } };
  }

  const ADD_DIALOG = {
    email: 'dialog.person@example.com',
    name: 'Dialog Person',
    // The pickers submit one name each; the door reads it as a list of one.
    positions: 'sales_rep',
    permissionSets: 'crm_user',
    manager: EMAILS.member,
  };

  it('add_sso_user on a managed boot: the dialog adds a pending person with the picked grants and manager', async () => {
    const s = await managedStage();
    const { path, body } = dialogCall('add_sso_user', ADD_DIALOG);

    const res = await s.fire(path, body, s.bearers.admin);
    const answer: any = await res.json();

    expect(res.status, JSON.stringify(answer)).toBe(201);
    const row = s.row(ADD_DIALOG.email)!;
    expect(row.source).toBe(PENDING_SSO_SOURCE);
    expect(s.rowsOf('sys_account', String(row.id))).toHaveLength(0);
    expect(s.rowsOf('sys_user_position', String(row.id)).map((r) => r.position)).toEqual(['sales_rep']);
    expect(s.rowsOf('sys_user_permission_set', String(row.id)).map((r) => r.permission_set)).toEqual(['crm_user']);
    expect(String(row.manager_id)).toBe(s.ids.member);
    expect(answer.data).toMatchObject({ email: ADD_DIALOG.email, source: PENDING_SSO_SOURCE, alreadyPending: false, host: { notified: true } });
  });

  it('import_sso_users on a managed boot: the dialog\'s CSV adds each row as a pending person', async () => {
    const s = await managedStage();
    const csv = 'email,name,positions\ncsv.one@example.com,CSV One,sales_rep\ncsv.two@example.com,CSV Two,\n';
    const { path, body } = dialogCall('import_sso_users', { csv });

    const res = await s.fire(path, body, s.bearers.admin);
    const answer: any = await res.json();

    expect(res.status, JSON.stringify(answer)).toBe(200);
    expect(answer.data.summary).toEqual({ total: 2, added: 2, alreadyPending: 0, failed: 0 });
    expect(answer.data.rows.map((r: any) => [r.row, r.email, r.ok])).toEqual([
      [1, 'csv.one@example.com', true],
      [2, 'csv.two@example.com', true],
    ]);
    for (const email of ['csv.one@example.com', 'csv.two@example.com']) expect(s.row(email)?.source).toBe(PENDING_SSO_SOURCE);
  });

  it('CONTROL: off a managed environment the same targets answer 409 and add no one', async () => {
    const s = await stage();
    const before = s.users().length;
    for (const [name, collected] of [
      ['add_sso_user', ADD_DIALOG],
      ['import_sso_users', { csv: 'email,name\ncontrol.person@example.com,Control\n' }],
    ] as const) {
      const { path, body } = dialogCall(name, collected);
      const v = await verdict(await s.fire(path, body, s.bearers.admin));
      expect(v.status, `${name}: ${v.text}`).toBe(409);
      expect(v.code).toBe('RESOURCE_CONFLICT');
    }
    expect(s.users()).toHaveLength(before);
    expect(s.row(ADD_DIALOG.email)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup → Users: the console's offer of a DECLARED action, and what it posts
// ─────────────────────────────────────────────────────────────────────────────
//
// Shared by the two describes below; the first one's header says how they judge.

/** The session payload's principal for the staged admin: the platform-admin rung the doors' gate judges. */
const ADMIN_PRINCIPAL = { id: 'staged-admin', email: EMAILS.admin, positions: [] as string[], isPlatformAdmin: true };

function declaredAction(name: string) {
  const action = (SysUser.actions ?? []).find((a) => a.name === name);
  if (!action) throw new Error(`sys_user declares no action named "${name}"`);
  return action;
}

/** The console's verdict on the declared action for this row, under the features this kernel serves. */
function offeredOn(s: Awaited<ReturnType<typeof stage>>, name: string, row: Record<string, unknown>): boolean | string {
  const raw = declaredAction(name).visible as unknown;
  const source = typeof raw === 'string' ? raw : (raw as { source?: unknown } | undefined)?.source;
  if (typeof source !== 'string') return `NO CEL SOURCE on ${name}`;
  const features = (s.manager.getPublicConfig() as any).features;
  const user = { ...ADMIN_PRINCIPAL, id: s.ids.admin };
  const r = celEngine.evaluate({ dialect: 'cel', source }, { record: row, extra: { current_user: user, user, ctx: { user }, features } });
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0]!.trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

/**
 * What the action posts for this row: its constant `bodyExtra`, the record id
 * under `recordIdParam`, then the collected params.
 */
function actionCall(name: string, userId: string, collected: Record<string, unknown> = {}) {
  const action = declaredAction(name);
  const target = String(action.target);
  expect(target.startsWith(BASE), `${name} targets the auth mount`).toBe(true);
  const declaredNames = (action.params ?? []).map((p) => p.name ?? p.field);
  for (const key of Object.keys(collected)) expect(declaredNames, `${name} declares the ${key} param`).toContain(key);
  const extra = ((action as { bodyExtra?: Record<string, unknown> }).bodyExtra ?? {});
  return { path: target.slice(BASE.length), body: { ...extra, [String(action.recordIdParam)]: userId, ...collected } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup → Users: Deactivate / Reactivate are offered without the admin plugin
// ─────────────────────────────────────────────────────────────────────────────
//
// `sys_user.ban_user` / `unban_user` are the deactivate / reactivate doors'
// first-party callers. On a kernel without the better-auth admin plugin the
// doors work (above), so the console must offer them there too. Each case
// judges the DECLARED action's `visible` against the features THIS kernel
// serves (`getPublicConfig().features`, what `/auth/config` hands the console)
// through the engine the console delegates to, then posts what the action
// submits — its `recordIdParam` naming the row, its params collected — to its
// `target`. CONTROL: an action whose door needs the plugin stays hidden there.

describe('[#33759] Ban / Unban are offered and work without the admin plugin', () => {
  it.each([
    ['unmanaged', false],
    ['managed', true],
  ] as const)('%s kernel: Ban is offered and refuses the next session, then Unban is offered and restores it', async (_kind, managed) => {
    const s = managed ? await managedStage() : await stage();
    expect((s.manager.getPublicConfig() as any).features.admin, 'this kernel serves features.admin off').toBe(false);

    expect(offeredOn(s, 'ban_user', s.row(EMAILS.member)!)).toBe(true);
    expect(offeredOn(s, 'unban_user', s.row(EMAILS.member)!)).toBe(false);
    const ban = actionCall('ban_user', s.ids.member, { banReason: 'left the company' });
    const banned = await s.fire(ban.path, ban.body, s.bearers.admin);
    expect(banned.status, await banned.clone().text()).toBe(200);
    expect(s.row(EMAILS.member)!.banned).toBe(true);

    const refused = await verdict(await s.signIn(EMAILS.member));
    expect(refused.status, refused.text).toBe(403);
    expect(refused.code).toBe(BANNED_USER_SESSION_REFUSAL.code);
    expect(s.rowsOf('sys_session', s.ids.member)).toHaveLength(0);

    expect(offeredOn(s, 'unban_user', s.row(EMAILS.member)!)).toBe(true);
    expect(offeredOn(s, 'ban_user', s.row(EMAILS.member)!)).toBe(false);
    const unban = actionCall('unban_user', s.ids.member);
    const unbanned = await s.fire(unban.path, unban.body, s.bearers.admin);
    expect(unbanned.status, await unbanned.clone().text()).toBe(200);
    expect(s.row(EMAILS.member)!.banned).toBe(false);
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
  });

  it('CONTROL: an admin-plugin-only action stays hidden on that kernel and is offered once the plugin is on', async () => {
    const off = await stage();
    expect(offeredOn(off, 'impersonate_user', off.row(EMAILS.member)!)).toBe(false);
    const on = await stage({ adminPlugin: true });
    expect((on.manager.getPublicConfig() as any).features.admin).toBe(true);
    expect(offeredOn(on, 'impersonate_user', on.row(EMAILS.member)!)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Removing a pending person, which cancels their invitation at the host
// ─────────────────────────────────────────────────────────────────────────────

/** A recording host with a `userRemoved` member, unless `withRemoved` is false. */
function removingHost(opts: { withRemoved?: boolean; removed?: () => void; added?: () => void } = {}) {
  const told: Array<{ kind: string; event: EnvironmentUserEvent }> = [];
  const host: EnvironmentUserHost = {
    userAdded: (event) => {
      told.push({ kind: 'added', event });
      opts.added?.();
    },
    userDeactivated: (event) => void told.push({ kind: 'deactivated', event }),
    userReactivated: (event) => void told.push({ kind: 'reactivated', event }),
    ...(opts.withRemoved === false
      ? {}
      : {
          userRemoved: (event: EnvironmentUserEvent) => {
            told.push({ kind: 'removed', event });
            opts.removed?.();
          },
        }),
  };
  return { host, told };
}

/** Add one pending person with a position, a permission set and a membership; answers their id. */
async function addPending(s: Awaited<ReturnType<typeof stage>>, email: string): Promise<string> {
  const res = await s.fire(
    '/admin/add-sso-user',
    { email, name: 'Typo', positions: ['sales_rep'], permissionSets: ['crm_user'] },
    s.bearers.admin,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return String(s.row(email)!.id);
}

/** Make the delete of `sys_user` answer a `restrict` refusal, as the engine's delete walk does (`DELETE_RESTRICTED`, 409). */
const RESTRICTED = 'This User cannot be deleted because an Approval Rule still refers to it.';
function restrictDelete(s: Awaited<ReturnType<typeof stage>>): void {
  const realDelete = s.engine.delete.bind(s.engine);
  s.engine.delete = async (name: string, q: any = {}) => {
    if (name === 'sys_user') throw Object.assign(new Error(RESTRICTED), { code: 'DELETE_RESTRICTED', status: 409 });
    return realDelete(name, q);
  };
}

describe('[#33228] admin/remove-sso-user removes a pending person and cancels their invitation', () => {
  it('removes the row, its grants and membership, and tells the host userRemoved first', async () => {
    const { host, told } = removingHost();
    const s = await managedStage({ host });
    const id = await addPending(s, 'typo@exmaple.com');

    const res = await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toEqual({ userId: id, email: 'typo@exmaple.com', removed: true, host: { notified: true } });
    expect(s.row('typo@exmaple.com')).toBeUndefined();
    for (const table of ['sys_user_position', 'sys_user_permission_set', 'sys_member']) {
      expect(s.rowsOf(table, id), table).toHaveLength(0);
    }
    expect(told.map((t) => t.kind)).toEqual(['added', 'removed']);
    expect(told[1]!.event).toMatchObject({ userId: id, email: 'typo@exmaple.com', source: PENDING_SSO_SOURCE, actorId: s.ids.admin });
  });

  it('a host without userRemoved is told userDeactivated for the pending person instead', async () => {
    const { host, told } = removingHost({ withRemoved: false });
    const s = await managedStage({ host });
    const id = await addPending(s, 'fallback@example.com');

    expect((await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin)).status).toBe(200);

    expect(told.map((t) => t.kind)).toEqual(['added', 'deactivated']);
    expect(told[1]!.event).toMatchObject({ userId: id, source: PENDING_SSO_SOURCE });
    expect(s.row('fallback@example.com')).toBeUndefined();
  });

  it('refuses a person who is not pending with 409, calls no host and removes no one', async () => {
    const { host, told } = removingHost();
    const s = await managedStage({ host });
    for (const userId of [s.ids.member, s.ids.idp]) {
      const v = await verdict(await s.fire('/admin/remove-sso-user', { userId }, s.bearers.admin));
      expect(v.status, v.text).toBe(409);
      expect(v.code).toBe('RESOURCE_CONFLICT');
      expect(v.message?.split('. ')[0]).toBe(PENDING_SSO_MESSAGES.removeNotPending.split('. ')[0]);
    }
    expect(s.row(EMAILS.member)).toBeDefined();
    expect(s.row(EMAILS.idp)).toBeDefined();
    expect(told).toEqual([]);
  });

  it('a host\'s typed refusal leaves the person as they are: nothing removed', async () => {
    const { host } = removingHost({
      removed: () => {
        throw new EnvironmentUserHostRefusal(409, OWNER_CONFLICT.code, OWNER_CONFLICT.message);
      },
    });
    const s = await managedStage({ host });
    const id = await addPending(s, 'refused.remove@example.com');

    const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin));

    expect(v.status, v.text).toBe(409);
    expect(v.code).toBe(OWNER_CONFLICT.code);
    expect(v.message).toBe(OWNER_CONFLICT.message);
    expect(s.row('refused.remove@example.com')).toMatchObject({ source: PENDING_SSO_SOURCE });
    expect(s.rowsOf('sys_member', id).length).toBeGreaterThan(0);
  });

  it('a host that cannot be reached refuses the removal: 503, the person is kept and nothing is re-sent', async () => {
    const { host, told } = removingHost({
      removed: () => {
        throw new Error('host down');
      },
    });
    const s = await managedStage({ host });
    const id = await addPending(s, 'unreached.remove@example.com');

    const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin));

    expect([v.status, v.code, v.message]).toEqual([503, 'SERVICE_UNAVAILABLE', PENDING_SSO_MESSAGES.removeHostUnreachable]);
    expect(s.row('unreached.remove@example.com')).toMatchObject({ id, source: PENDING_SSO_SOURCE });
    expect(s.rowsOf('sys_member', id).length).toBeGreaterThan(0);
    // Asked once, and no invitation is sent again.
    expect(told.map((t) => t.kind)).toEqual(['added', 'removed']);
  });

  it('with no host wired the person is removed and the answer says no_host', async () => {
    const s = await managedStage({ host: 'none' });
    const id = await addPending(s, 'nohost.remove@example.com');
    const body: any = await (await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin)).json();
    expect(body.data).toEqual({ userId: id, email: 'nohost.remove@example.com', removed: true, host: { notified: false, reason: 'no_host' } });
    expect(s.row('nohost.remove@example.com')).toBeUndefined();
  });

  it('a record that restricts the delete refuses it with the engine\'s answer; the person stays and is re-invited inline', async () => {
    const { host, told } = removingHost();
    const s = await managedStage({ host });
    const id = await addPending(s, 'held@example.com');
    restrictDelete(s);

    const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin));

    expect(v.status, v.text).toBe(409);
    expect(v.code).toBe('DELETE_RESTRICTED');
    expect(v.message).toBe(`${PENDING_SSO_MESSAGES.removeRefused} ${RESTRICTED} ${PENDING_SSO_MESSAGES.removeRefusedReinvited}`);
    expect(s.row('held@example.com')).toMatchObject({ source: PENDING_SSO_SOURCE });
    expect(told.map((t) => t.kind)).toEqual(['added', 'removed', 'added']);
    expect(told[2]!.event).toMatchObject({ userId: id, email: 'held@example.com', source: PENDING_SSO_SOURCE });
  });

  it('a re-invite the host does not take is said truthfully: the person stays pending with no invitation', async () => {
    let calls = 0;
    const { host } = removingHost({
      added: () => {
        calls += 1;
        if (calls > 1) throw new Error('host down');
      },
    });
    const s = await managedStage({ host });
    const id = await addPending(s, 'held.unsent@example.com');
    restrictDelete(s);

    const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin));

    expect(v.status, v.text).toBe(409);
    expect(v.message).toBe(`${PENDING_SSO_MESSAGES.removeRefused} ${RESTRICTED} ${PENDING_SSO_MESSAGES.removeRefusedNotReinvited}`);
    expect(s.row('held.unsent@example.com')).toMatchObject({ source: PENDING_SSO_SOURCE });
    expect(calls).toBe(2);
  });

  it('refuses an unknown id 404, a missing id or an unknown key 400, and a non-admin 403', async () => {
    const s = await managedStage();
    const unknown = await verdict(await s.fire('/admin/remove-sso-user', { userId: 'usr_nobody' }, s.bearers.admin));
    expect([unknown.status, unknown.code]).toEqual([404, 'RESOURCE_NOT_FOUND']);
    const missing = await verdict(await s.fire('/admin/remove-sso-user', {}, s.bearers.admin));
    expect([missing.status, missing.code]).toEqual([400, 'INVALID_REQUEST']);
    const extra = await verdict(await s.fire('/admin/remove-sso-user', { userId: s.ids.member, email: 'x@example.com' }, s.bearers.admin));
    expect([extra.status, extra.code]).toEqual([400, 'INVALID_REQUEST']);
    const id = await addPending(s, 'guarded@example.com');
    const member = await verdict(await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.member));
    expect([member.status, member.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect(s.row('guarded@example.com')).toBeDefined();
  });

  it('CONTROL: off a managed environment it answers 409 and removes no one', async () => {
    const s = await stage();
    const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: s.ids.member }, s.bearers.admin));
    expect([v.status, v.code, v.message]).toEqual([409, 'RESOURCE_CONFLICT', PENDING_SSO_MESSAGES.notManagedRemove]);
    expect(s.row(EMAILS.member)).toBeDefined();
  });
});

describe('[#33228] a deactivated person is never sent an invitation, and a removal is held to pending people', () => {
  it('re-adding a deactivated pending person does not invite them: host reads deactivated', async () => {
    const { host, told } = removingHost();
    const s = await managedStage({ host });
    const email = 'readd.banned@example.com';
    const id = await addPending(s, email);
    expect((await s.fire('/admin/ban-user', { userId: id }, s.bearers.admin)).status).toBe(200);

    const res = await s.fire('/admin/add-sso-user', { email, name: 'Typo' }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ userId: id, alreadyPending: true, host: { notified: false, reason: 'deactivated' } });
    expect(told.map((t) => t.kind)).toEqual(['added', 'deactivated']);
  });

  it('CONTROL: re-adding a pending person who is not deactivated invites them again', async () => {
    const { host, told } = removingHost();
    const s = await managedStage({ host });
    const email = 'readd.active@example.com';
    const id = await addPending(s, email);

    const body: any = await (await s.fire('/admin/add-sso-user', { email, name: 'Typo' }, s.bearers.admin)).json();

    expect(body.data).toMatchObject({ userId: id, alreadyPending: true, host: { notified: true } });
    expect(told.map((t) => t.kind)).toEqual(['added', 'added']);
  });

  it('a refused removal of a deactivated pending person sends no new invitation, and says the old one is cancelled', async () => {
    const { host, told } = removingHost();
    const s = await managedStage({ host });
    const id = await addPending(s, 'held.banned@example.com');
    expect((await s.fire('/admin/ban-user', { userId: id }, s.bearers.admin)).status).toBe(200);
    restrictDelete(s);

    const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin));

    expect(v.status, v.text).toBe(409);
    expect(v.message).toBe(`${PENDING_SSO_MESSAGES.removeRefused} ${RESTRICTED} ${PENDING_SSO_MESSAGES.removeHostCancelled}`);
    expect(told.map((t) => t.kind)).toEqual(['added', 'deactivated', 'removed']);
  });

  it('a deactivated pending person whose banned column reads back as a string is not invited on a re-add', async () => {
    const { host, told } = removingHost();
    const s = await managedStage({ host });
    const email = 'readd.banned.string@example.com';
    const id = await addPending(s, email);
    for (const stored of ['1', 'true']) {
      s.row(email)!.banned = stored;
      const body: any = await (await s.fire('/admin/add-sso-user', { email, name: 'Typo' }, s.bearers.admin)).json();
      expect(body.data, stored).toMatchObject({ userId: id, alreadyPending: true, host: { notified: false, reason: 'deactivated' } });
    }
    expect(told.map((t) => t.kind)).toEqual(['added']);
  });

  it('a person who signs in while the host is asked is not removed: 409, and the answer says the host was told', async () => {
    const email = 'signs.in@example.com';
    let s!: Awaited<ReturnType<typeof stage>>;
    const { host } = removingHost({
      removed: () => {
        s.row(email)!.source = 'idp_provisioned';
      },
    });
    s = await managedStage({ host });
    const id = await addPending(s, email);

    const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin));

    expect(v.status, v.text).toBe(409);
    expect(v.code).toBe('RESOURCE_CONFLICT');
    expect(v.message).toBe(`${PENDING_SSO_MESSAGES.removeNotPending} ${PENDING_SSO_MESSAGES.removeHostCancelled}`);
    expect(s.row(email)).toMatchObject({ id, source: 'idp_provisioned' });
    expect(s.rowsOf('sys_member', id).length).toBeGreaterThan(0);
  });

  it('a person whose first sign-in commits inside the unit of work, after the pending read, is not removed: 409, and the child deletes roll back', async () => {
    const email = 'signs.in.late@example.com';
    const { host } = removingHost();
    const s = await managedStage({ host });
    const id = await addPending(s, email);
    const CHILDREN = ['sys_user_position', 'sys_user_permission_set', 'sys_member'] as const;
    for (const table of CHILDREN) expect(s.rowsOf(table, id).length, table).toBeGreaterThan(0);
    // The memory engine has no transaction, so the plugin's `runAtomically`
    // would run the removal unatomically. Give it one: the seam calls
    // `engine.transaction`, and a throw out of it restores every table this
    // unit of work wrote. `sys_user` is left as it is, because its change is
    // the concurrent sign-in's commit, not this unit of work's write.
    let units = 0;
    (s.engine as any).transaction = async (work: (trx: unknown, info: unknown) => Promise<unknown>) => {
      units += 1;
      const before = new Map([...s.engine.tables].filter(([name]) => name !== 'sys_user').map(([name, rows]) => [name, structuredClone(rows)]));
      try {
        return await work({}, {});
      } catch (error) {
        for (const [name, rows] of before) s.engine.tables.set(name, rows);
        throw error;
      }
    };
    // The first sign-in lands between the in-unit pending read and the row's
    // delete: the first child delete is the moment after that read.
    const realDelete = s.engine.delete.bind(s.engine);
    s.engine.delete = async (name: string, q: any = {}) => {
      if (name === 'sys_user_position') s.row(email)!.source = 'idp_provisioned';
      return realDelete(name, q);
    };

    const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id }, s.bearers.admin));

    expect(v.status, v.text).toBe(409);
    expect(v.code).toBe('RESOURCE_CONFLICT');
    expect(v.message).toBe(`${PENDING_SSO_MESSAGES.removeNotPending} ${PENDING_SSO_MESSAGES.removeHostCancelled}`);
    expect(s.row(email)).toMatchObject({ id, source: 'idp_provisioned' });
    expect(units, 'the removal ran inside the transactional seam').toBe(1);
    for (const table of CHILDREN) expect(s.rowsOf(table, id).length, `${table} rolled back`).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup → Users: Unlock is offered and works without the admin plugin
// ─────────────────────────────────────────────────────────────────────────────
//
// `sys_user.unlock_user` posts to `admin/unlock-user`, an ObjectStack mount
// (ADR-0069 D2) whose handler clears the lockout through the data engine; the
// lockout itself (`sys_user.locked_until` / `failed_login_count`) is stamped by
// this plugin's own sign-in path, with no better-auth admin plugin involved.
// Each case locks the member the way the lockout locks anyone, by
// `lockoutThreshold` wrong passwords through the real sign-in, shows the right
// password refused while the lock holds, then judges and drives the DECLARED
// action against the door and signs in again.

describe('[#34010] Unlock is offered and works without the admin plugin', () => {
  const LOCKOUT = { lockoutThreshold: 3, lockoutDurationMinutes: 15 };
  const WRONG_PASSWORD = 'Wr0ng!Guess-34010';

  /** Lock the member through the sign-in lockout itself, and show the lock holding against the right password. */
  async function lockMember(s: Awaited<ReturnType<typeof stage>>): Promise<void> {
    for (let i = 0; i < LOCKOUT.lockoutThreshold; i++) {
      expect((await s.signIn(EMAILS.member, WRONG_PASSWORD)).status, `wrong password ${i + 1}`).toBe(401);
    }
    const lockedUntil = new Date(s.row(EMAILS.member)!.locked_until).getTime();
    expect(lockedUntil, 'the lockout stamped a lock in the future').toBeGreaterThan(Date.now());
    const sessions = s.rowsOf('sys_session', s.ids.member).length;
    const held = await verdict(await s.signIn(EMAILS.member));
    expect(held.status, held.text).toBe(401);
    expect(s.rowsOf('sys_session', s.ids.member), 'the locked account got no session').toHaveLength(sessions);
  }

  it.each([
    ['unmanaged', false],
    ['managed', true],
  ] as const)('%s kernel: a locked account is offered Unlock, the door releases it, and the next sign-in succeeds', async (_kind, managed) => {
    const s = managed ? await managedStage({ config: LOCKOUT }) : await stage({ config: LOCKOUT });
    expect((s.manager.getPublicConfig() as any).features.admin, 'this kernel serves features.admin off').toBe(false);
    await lockMember(s);

    expect(offeredOn(s, 'unlock_user', s.row(EMAILS.member)!)).toBe(true);
    const unlock = actionCall('unlock_user', s.ids.member);
    // The door's platform-admin gate holds without the plugin: a caller without
    // the standing is refused and the lock stays.
    const denied = await verdict(await s.fire(unlock.path, unlock.body, s.bearers.idp));
    expect(denied.status, denied.text).toBe(403);
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect(s.row(EMAILS.member)!.locked_until).toBeTruthy();

    const res = await s.fire(unlock.path, unlock.body, s.bearers.admin);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(s.row(EMAILS.member)!.locked_until ?? null).toBeNull();
    expect(Number(s.row(EMAILS.member)!.failed_login_count)).toBe(0);
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
  });

  it('CONTROL: with the plugin on, Unlock is offered and releases the account as before', async () => {
    const s = await stage({ adminPlugin: true, config: LOCKOUT });
    expect((s.manager.getPublicConfig() as any).features.admin).toBe(true);
    await lockMember(s);

    expect(offeredOn(s, 'unlock_user', s.row(EMAILS.member)!)).toBe(true);
    const unlock = actionCall('unlock_user', s.ids.member);
    const res = await s.fire(unlock.path, unlock.body, s.bearers.admin);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(s.row(EMAILS.member)!.locked_until ?? null).toBeNull();
    expect((await s.signIn(EMAILS.member)).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup → Users: Set Password is offered and works without the admin plugin
// ─────────────────────────────────────────────────────────────────────────────
//
// `sys_user.set_user_password` posts to `admin/set-user-password`, plugin-auth's
// wrapper registered ahead of the catch-all: it runs the platform-admin gate,
// then hashes through better-auth's core `internalAdapter`, which every kernel
// carries, with or without the vendor admin plugin. Each case judges the
// DECLARED action under the features the kernel serves, drives what it posts
// (its `bodyExtra`, `recordIdParam` and collected params), and signs in with
// the new password. The action's other rule is kept: it is hidden on a
// cloud-managed environment, whose door refuses every target.

describe('[#34130] Set Password is offered and works without the admin plugin', () => {
  const COLLECTED = { newPassword: NEW_PASSWORD, mustChangePassword: false, revokeSessionsAndKeys: false };

  it('unmanaged kernel: Set Password is offered, the door sets the password, and the member signs in with it', async () => {
    const s = await stage();
    const features = (s.manager.getPublicConfig() as any).features;
    expect(features.admin, 'this kernel serves features.admin off').toBe(false);
    expect(features.cloudManaged ?? false).toBe(false);

    expect(offeredOn(s, 'set_user_password', s.row(EMAILS.member)!)).toBe(true);
    const call = actionCall('set_user_password', s.ids.member, COLLECTED);
    // The door's platform-admin gate holds without the plugin: a caller without
    // the standing is refused and the old password still signs in.
    const denied = await verdict(await s.fire(call.path, call.body, s.bearers.idp));
    expect(denied.status, denied.text).toBe(403);
    expect(denied.code).toBe('PERMISSION_DENIED');
    expect((await s.signIn(EMAILS.member, NEW_PASSWORD)).status).toBe(401);

    const res = await s.fire(call.path, call.body, s.bearers.admin);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await s.signIn(EMAILS.member, NEW_PASSWORD)).status).toBe(200);
    expect((await s.signIn(EMAILS.member)).status).toBe(401);
  });

  it('unmanaged kernel: with the dialog defaults the door also flags the member and revokes their sessions', async () => {
    const s = await stage();
    expect((s.manager.getPublicConfig() as any).features.admin).toBe(false);
    // The values the dialog submits when the admin types only the password:
    // every other declared param at its declared default.
    const defaults = Object.fromEntries(
      (declaredAction('set_user_password').params ?? [])
        .filter((p) => p.defaultValue !== undefined)
        .map((p) => [String(p.name ?? p.field), p.defaultValue]),
    );
    expect(defaults).toEqual({ mustChangePassword: true, revokeSessionsAndKeys: true });
    expect(s.rowsOf('sys_session', s.ids.member).length, 'the member holds a session before').toBeGreaterThan(0);

    const call = actionCall('set_user_password', s.ids.member, { newPassword: NEW_PASSWORD, ...defaults });
    const v = await verdict(await s.fire(call.path, call.body, s.bearers.admin));
    expect(v.status, v.text).toBe(200);
    const data = JSON.parse(v.text).data;
    expect(data.mustChangePassword).toBe(true);
    expect(data.revokeSessionsAndKeys).toBe(true);
    expect(data.revoked?.complete).toBe(true);
    expect(s.row(EMAILS.member)!.must_change_password).toBe(true);
    // Revocation stamps each session row rather than deleting it.
    const sessions = s.rowsOf('sys_session', s.ids.member);
    expect(data.revoked.sessions).toBe(sessions.length);
    for (const row of sessions) {
      expect(row.revoke_reason).toBe('admin_password_reset');
      expect(new Date(row.expires_at).getTime()).toBeLessThanOrEqual(Date.now());
    }
    expect((await s.signIn(EMAILS.member, NEW_PASSWORD)).status).toBe(200);
  });

  it('managed kernel: Set Password stays hidden, the rule kept beside the dropped gate', async () => {
    const s = await managedStage();
    const features = (s.manager.getPublicConfig() as any).features;
    expect(features.admin).toBe(false);
    expect(features.cloudManaged).toBe(true);
    expect(offeredOn(s, 'set_user_password', s.row(EMAILS.member)!)).toBe(false);
  });

  it('CONTROL: with the plugin on, Set Password is offered and sets the password as before', async () => {
    const s = await stage({ adminPlugin: true });
    expect((s.manager.getPublicConfig() as any).features.admin).toBe(true);
    expect(offeredOn(s, 'set_user_password', s.row(EMAILS.member)!)).toBe(true);
    const call = actionCall('set_user_password', s.ids.member, COLLECTED);
    const res = await s.fire(call.path, call.body, s.bearers.admin);
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await s.signIn(EMAILS.member, NEW_PASSWORD)).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The organization an identity-route action forward stamps
// ─────────────────────────────────────────────────────────────────────────────
//
// A `type: 'api'` action forwarded to the auth mount carries the caller's
// active organization as `body.organizationId` (`buildApiActionRequest` in
// `@objectstack/runtime`; its control pin lives beside it in
// `api-action-forward.test.ts`). Each of the three doors admits that one key,
// and only when it equals the organization the caller's own session is
// working in; any other value is refused before anything is read or written,
// and the value never feeds scope. The staged admin's session holds
// DEFAULT_ORG as its active organization (the session-create hook selects the
// sole membership), and `clearActiveOrganization` takes it away.

describe('[#34912] the SSO-user doors admit the stamped organizationId only when it is the session\'s', () => {
  const OTHER_ORG = 'org_elsewhere';

  /** The admin's sessions with no active organization, as a caller working in none holds them. */
  const clearActiveOrganization = (s: Awaited<ReturnType<typeof stage>>): number => {
    const sessions = ((s.engine.tables.get('sys_session') ?? []) as any[]).filter((r) => String(r.user_id) === s.ids.admin);
    for (const session of sessions) {
      session.active_organization_id = null;
      delete session.activeOrganizationId;
    }
    return sessions.length;
  };

  /** Whether the staged admin's session holds DEFAULT_ORG, the fixture invariant every equal-key leg rests on. */
  const assertSessionHoldsDefaultOrg = (s: Awaited<ReturnType<typeof stage>>): void => {
    const sessions = ((s.engine.tables.get('sys_session') ?? []) as any[]).filter((r) => String(r.user_id) === s.ids.admin);
    expect(
      sessions.some((r) => (r.active_organization_id ?? r.activeOrganizationId) === DEFAULT_ORG),
      'fixture invariant: the admin session works in DEFAULT_ORG',
    ).toBe(true);
  };

  describe('admin/add-sso-user', () => {
    it.each([
      ['absent', {}],
      ['equal to the session organization', { organizationId: DEFAULT_ORG }],
    ])('organizationId %s: the person is added, joined to the session organization', async (_label, extra) => {
      const s = await managedStage();
      assertSessionHoldsDefaultOrg(s);
      const email = `add.${Object.keys(extra).length}@example.com`;

      const res = await s.fire('/admin/add-sso-user', { email, name: 'Stamped', ...extra }, s.bearers.admin);
      const body: any = await res.json();

      expect(res.status, JSON.stringify(body)).toBe(201);
      const row = s.row(email)!;
      expect(row.source).toBe(PENDING_SSO_SOURCE);
      expect(s.rowsOf('sys_member', String(row.id)).map((m) => m.organization_id)).toEqual([DEFAULT_ORG]);
      expect(body.data).toMatchObject({ email, alreadyPending: false, organizationId: DEFAULT_ORG });
      expect(s.told.map((t) => t.kind)).toEqual(['added']);
    });

    it('a different organization is refused 400 naming both, and no one is added or told', async () => {
      const s = await managedStage();
      const v = await verdict(
        await s.fire('/admin/add-sso-user', { email: 'foreign.add@example.com', name: 'F', organizationId: OTHER_ORG }, s.bearers.admin),
      );
      expect([v.status, v.code], v.text).toEqual([400, 'INVALID_REQUEST']);
      expect(v.message).toContain(OTHER_ORG);
      expect(v.message).toContain(DEFAULT_ORG);
      expect(s.row('foreign.add@example.com')).toBeUndefined();
      expect(s.told).toEqual([]);
    });

    it('no active organization in the session plus a body organization is refused 400 NO_ACTIVE_ORGANIZATION; CONTROL: without the key the add stands', async () => {
      const s = await managedStage();
      expect(clearActiveOrganization(s)).toBeGreaterThan(0);

      const v = await verdict(
        await s.fire('/admin/add-sso-user', { email: 'noorg.add@example.com', name: 'N', organizationId: DEFAULT_ORG }, s.bearers.admin),
      );
      expect([v.status, v.code], v.text).toEqual([400, 'NO_ACTIVE_ORGANIZATION']);
      expect(s.row('noorg.add@example.com')).toBeUndefined();
      expect(s.told).toEqual([]);

      const control = await s.fire('/admin/add-sso-user', { email: 'noorg.add@example.com', name: 'N' }, s.bearers.admin);
      expect(control.status, await control.clone().text()).toBe(201);
    });

    it('an organizationId that is not a non-empty string is refused 400 and no one is added', async () => {
      const s = await managedStage();
      for (const organizationId of [null, '', 42]) {
        const v = await verdict(
          await s.fire('/admin/add-sso-user', { email: 'typed.add@example.com', name: 'T', organizationId }, s.bearers.admin),
        );
        expect([v.status, v.code], `${JSON.stringify(organizationId)}: ${v.text}`).toEqual([400, 'INVALID_REQUEST']);
      }
      expect(s.row('typed.add@example.com')).toBeUndefined();
    });
  });

  describe('admin/import-sso-users', () => {
    const CSV = 'email,name\nstamp.one@example.com,One\nstamp.two@example.com,Two\n';

    it.each([
      ['absent', {}],
      ['equal to the session organization', { organizationId: DEFAULT_ORG }],
    ])('organizationId %s: every row is added, joined to the session organization', async (_label, extra) => {
      const s = await managedStage();
      assertSessionHoldsDefaultOrg(s);

      const res = await s.fire('/admin/import-sso-users', { csv: CSV, ...extra }, s.bearers.admin);
      const body: any = await res.json();

      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.data.summary).toEqual({ total: 2, added: 2, alreadyPending: 0, failed: 0 });
      for (const email of ['stamp.one@example.com', 'stamp.two@example.com']) {
        const row = s.row(email)!;
        expect(row.source).toBe(PENDING_SSO_SOURCE);
        expect(s.rowsOf('sys_member', String(row.id)).map((m) => m.organization_id)).toEqual([DEFAULT_ORG]);
      }
    });

    it('a different organization is refused 400 naming both, and no row is imported or told', async () => {
      const s = await managedStage();
      const before = s.users().length;
      const v = await verdict(await s.fire('/admin/import-sso-users', { csv: CSV, organizationId: OTHER_ORG }, s.bearers.admin));
      expect([v.status, v.code], v.text).toEqual([400, 'INVALID_REQUEST']);
      expect(v.message).toContain(OTHER_ORG);
      expect(v.message).toContain(DEFAULT_ORG);
      expect(s.users()).toHaveLength(before);
      expect(s.told).toEqual([]);
    });

    it('no active organization in the session plus a body organization is refused 400 NO_ACTIVE_ORGANIZATION', async () => {
      const s = await managedStage();
      expect(clearActiveOrganization(s)).toBeGreaterThan(0);
      const before = s.users().length;
      const v = await verdict(await s.fire('/admin/import-sso-users', { csv: CSV, organizationId: DEFAULT_ORG }, s.bearers.admin));
      expect([v.status, v.code], v.text).toEqual([400, 'NO_ACTIVE_ORGANIZATION']);
      expect(s.users()).toHaveLength(before);
      expect(s.told).toEqual([]);
    });
  });

  describe('admin/remove-sso-user', () => {
    it.each([
      ['absent', {}],
      ['equal to the session organization', { organizationId: DEFAULT_ORG }],
    ])('organizationId %s: the pending person is removed', async (_label, extra) => {
      const { host, told } = removingHost();
      const s = await managedStage({ host });
      assertSessionHoldsDefaultOrg(s);
      const id = await addPending(s, 'stamp.remove@example.com');

      const res = await s.fire('/admin/remove-sso-user', { userId: id, ...extra }, s.bearers.admin);
      const body: any = await res.json();

      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.data).toMatchObject({ userId: id, removed: true });
      expect(s.row('stamp.remove@example.com')).toBeUndefined();
      expect(told.map((t) => t.kind)).toEqual(['added', 'removed']);
    });

    it('a different organization is refused 400 naming both; the person is kept and the host is not asked', async () => {
      const { host, told } = removingHost();
      const s = await managedStage({ host });
      const id = await addPending(s, 'foreign.remove@example.com');

      const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id, organizationId: OTHER_ORG }, s.bearers.admin));

      expect([v.status, v.code], v.text).toEqual([400, 'INVALID_REQUEST']);
      expect(v.message).toContain(OTHER_ORG);
      expect(v.message).toContain(DEFAULT_ORG);
      expect(s.row('foreign.remove@example.com')).toMatchObject({ id, source: PENDING_SSO_SOURCE });
      expect(s.rowsOf('sys_member', id).length).toBeGreaterThan(0);
      expect(told.map((t) => t.kind)).toEqual(['added']);
    });

    it('no active organization in the session plus a body organization is refused 400 NO_ACTIVE_ORGANIZATION; the person is kept', async () => {
      const { host, told } = removingHost();
      const s = await managedStage({ host });
      const id = await addPending(s, 'noorg.remove@example.com');
      expect(clearActiveOrganization(s)).toBeGreaterThan(0);

      const v = await verdict(await s.fire('/admin/remove-sso-user', { userId: id, organizationId: DEFAULT_ORG }, s.bearers.admin));

      expect([v.status, v.code], v.text).toEqual([400, 'NO_ACTIVE_ORGANIZATION']);
      expect(s.row('noorg.remove@example.com')).toMatchObject({ id, source: PENDING_SSO_SOURCE });
      expect(told.map((t) => t.kind)).toEqual(['added']);
    });
  });

  it('the body organization never feeds scope: on a multi-organization deployment the person joins the session organization', async () => {
    // Driven over fakes so the join's target is observable: the door reads the
    // organization from the session seam, and an equal body value is admitted
    // without being the value the join is handed.
    const engine = createMemoryEngine();
    const joined: unknown[] = [];
    const sessionReads: string[] = [];
    const deps = {
      isCloudManaged: () => true,
      getDataEngine: () => engine as any,
      getTenancy: () => ({ isolationActive: true }) as any,
      getCallerActiveOrganizationId: async () => {
        sessionReads.push('read');
        return 'org_session';
      },
      getAddMember: async () => async (input: { body: { organizationId: string } }) => {
        joined.push(input.body.organizationId);
        return {};
      },
      createGrant: {
        resolveActorContext: async () => ({}),
        runAtomically: async <T,>(work: () => Promise<T>) => work(),
      },
    } as any;
    const request = (organizationId: unknown) =>
      new Request(`${ORIGIN}${BASE}/admin/add-sso-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'multi.org@example.com', name: 'Multi', organizationId }),
      });

    const refused = await runAddSsoUser(deps, { id: 'admin-1' } as any, request('org_attacker'));
    expect([refused.status, refused.body.error?.code]).toEqual([400, 'INVALID_REQUEST']);
    expect(joined).toEqual([]);
    expect(((engine.tables.get('sys_user') ?? []) as any[]).length).toBe(0);

    const admitted = await runAddSsoUser(deps, { id: 'admin-1' } as any, request('org_session'));
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(201);
    expect(joined).toEqual(['org_session']);
    // The check and the join each read the session; neither read the body's value as the scope.
    expect(sessionReads.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup → Users: what the result dialogs read is what the doors answer
// ─────────────────────────────────────────────────────────────────────────────

describe('[#34651] add-sso-user says a re-added address was already pending, and only then', () => {
  it('an email-only re-add of a still-pending person answers pendingAgain: true', async () => {
    const s = await managedStage();
    const email = 'pending.again@example.com';
    expect((await s.fire('/admin/add-sso-user', { email }, s.bearers.admin)).status).toBe(201);

    const res = await s.fire('/admin/add-sso-user', { email }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.pendingAgain).toBe(true);
    // Widening only: the key every answer carries is unchanged.
    expect(body.data.alreadyPending).toBe(true);
  });

  it('CONTROL: a fresh add carries no pendingAgain at all, so the dialog draws no row for it', async () => {
    const s = await managedStage();
    const res = await s.fire('/admin/add-sso-user', { email: 'pending.fresh@example.com' }, s.bearers.admin);
    const body: any = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.data).not.toHaveProperty('pendingAgain');
    expect(body.data.alreadyPending).toBe(false);
  });
});

describe('[#34651] the import result table reads members of a real row answer', () => {
  /** The declared `table` field of `sys_user.import_sso_users`'s result dialog. */
  function importTableColumns(): string[] {
    const fields = (declaredAction('import_sso_users').resultDialog?.fields ?? []) as Array<{
      path: string;
      format?: string;
      columns?: Array<{ path: string }>;
    }>;
    const table = fields.filter((field) => field.format === 'table');
    expect(table, 'import_sso_users declares one table field').toHaveLength(1);
    const columns = (table[0]!.columns ?? []).map((column) => column.path);
    expect(columns.length, 'the table declares its columns').toBeGreaterThan(0);
    return columns;
  }

  it('every column path\'s first segment is a member of a row the import door really answered', async () => {
    const s = await managedStage();
    // A person already pending, so one row of the file is a re-add.
    expect((await s.fire('/admin/add-sso-user', { email: 'align.readd@example.com' }, s.bearers.admin)).status).toBe(201);
    // Rows chosen so each member the door answers on some row is answered:
    // a fresh add whose manager is unknown (`alreadyPending`, `host`,
    // `managerError`), a malformed address (`error`), and a re-add that sends
    // a column (`notApplied`).
    const csv = [
      'email,name,permission_sets,manager_id',
      'align.fresh@example.com,Align Fresh,,nobody.align@example.com',
      'not-an-address,Align Bad,,',
      'align.readd@example.com,Align Readd,crm_user,',
    ].join('\n');

    const res = await s.fire('/admin/import-sso-users', { csv }, s.bearers.admin);
    const body: any = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    const rows = body.data.rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.ok)).toEqual([true, false, true]);

    const unanswered = importTableColumns()
      .map((path) => path.split('.')[0]!)
      .filter((member) => !rows.some((row) => Object.hasOwn(row, member)));
    expect(unanswered, `row answers: ${JSON.stringify(rows)}`).toEqual([]);
  });
});
