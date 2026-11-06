// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30918] The two authorized-clients reads, on the real plugin: a real
 * `AuthManager` (real better-auth, real `customSession`, real sign-ups and
 * sessions), the real `AuthPlugin` route registration on a Hono app, and the
 * consents written through better-auth's own storage adapter, so the read
 * decodes exactly what the OAuth provider stores. The engine is the shared
 * in-memory one `sys-session-revoke.test.ts` runs on (`createMemoryEngine`).
 *
 * What is pinned, by the access rules on the card:
 *
 *  - the own read answers the session subject's grants and nobody else's, and
 *    a parameter that names another person is REFUSED, not ignored;
 *  - the admin read admits a platform administrator, per organization, and
 *    refuses everyone else (a member, an organization owner, an organization
 *    admin) with one byte-identical answer whether or not the named person
 *    exists; anonymous is `401` on both doors;
 *  - the answer carries exactly the declared members and no token, code,
 *    secret or session value of any row;
 *  - a person with more grants than the cap is answered `truncated: true`.
 *
 * The coarse last-use stamp is pinned on a real SQL engine in
 * `mcp-client-last-use.real-engine.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import {
  ADMIN_AUTHORIZED_CLIENTS_PATH,
  ADMIN_AUTHORIZED_CLIENTS_USER_NOT_FOUND_MESSAGE,
  AUTHORIZED_CLIENTS_PATH,
  AUTHORIZED_CLIENTS_READ_CAP,
} from './authorized-clients-read';

const SECRET = 'test-secret-at-least-32-chars-long-30918';
const PASSWORD = 'S3cure!Passw0rd-authorized-clients';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const PS_ADMIN = 'ps_admin_full_access';

const ADMIN_EMAIL = 'padmin@authorized-clients.example.com';
const ALICE_EMAIL = 'alice@authorized-clients.example.com';
const BOB_EMAIL = 'bob@authorized-clients.example.com';
const OWNER_EMAIL = 'olivia.owner@authorized-clients.example.com';
const ORG_ADMIN_EMAIL = 'oscar.orgadmin@authorized-clients.example.com';

const ORG_ACME = 'org_acme_30918';
const ORG_BETA = 'org_beta_30918';

/** Values that must never appear in any answer: one per secret-bearing column the fixture writes. */
const CLIENT_SECRET = 'client-secret-MUST-NOT-LEAK-30918';
const ACCESS_TOKEN = 'access-token-MUST-NOT-LEAK-30918';
const REFRESH_TOKEN = 'refresh-token-MUST-NOT-LEAK-30918';

/** The exact members of one answered row, and of the answer itself. */
const ROW_KEYS = ['authorizedAt', 'clientId', 'id', 'lastUsedAt', 'name', 'organizationId', 'scopes'];
const DATA_KEYS = ['clients', 'truncated'];

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};

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

const makeManager = (engine: any) => new AuthManager({ secret: SECRET, baseUrl: ORIGIN, dataEngine: engine } as any);

const direct = (manager: AuthManager, path: string, body: unknown) =>
  manager.handleRequest(
    new Request(`${ORIGIN}${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const userRows = (engine: any) => (engine.tables.get('sys_user') ?? []) as any[];

const userIdFor = (engine: any, email: string): string => {
  const row = userRows(engine).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/** The Default Organization, staged when the engine holds none. */
const defaultOrganizationIdOf = async (engine: any): Promise<string> => {
  const existing = (engine.tables.get('sys_organization') ?? []).find((r: any) => r.slug === 'default');
  if (existing) return String(existing.id);
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' });
  return 'org_default';
};

/** ADR-0068 D2 standing, granted the way the platform grants it: the admin_full_access set. */
const grantPlatformAdmin = async (engine: any, userId: string) => {
  if (!(engine.tables.get('sys_permission_set') ?? []).some((r: any) => r.id === PS_ADMIN)) {
    await engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
  }
  await engine.insert('sys_user_permission_set', {
    user_id: userId,
    permission_set_id: PS_ADMIN,
    permission_set: 'admin_full_access',
    organization_id: await defaultOrganizationIdOf(engine),
  });
};

/** The five sign-ups every case starts from, made once per file. */
let signedUpTables: Promise<Map<string, any[]>> | undefined;
const signedUpOnce = (): Promise<Map<string, any[]>> =>
  (signedUpTables ??= (async () => {
    const template = createMemoryEngine();
    const manager = makeManager(template);
    for (const [email, name] of [
      [ADMIN_EMAIL, 'Platform Admin'],
      [ALICE_EMAIL, 'Alice'],
      [BOB_EMAIL, 'Bob'],
      [OWNER_EMAIL, 'Olivia Owner'],
      [ORG_ADMIN_EMAIL, 'Oscar OrgAdmin'],
    ]) {
      await inviteForAudienceGate(manager, email);
      const res = await direct(manager, '/sign-up/email', { email, password: PASSWORD, name });
      expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
    }
    return template.tables as Map<string, any[]>;
  })());

const arrange = async () => {
  const engine = createMemoryEngine();
  for (const [name, rows] of await signedUpOnce()) engine.tables.set(name, structuredClone(rows));
  const manager = makeManager(engine);
  const ids = {
    admin: userIdFor(engine, ADMIN_EMAIL),
    alice: userIdFor(engine, ALICE_EMAIL),
    bob: userIdFor(engine, BOB_EMAIL),
    owner: userIdFor(engine, OWNER_EMAIL),
    orgAdmin: userIdFor(engine, ORG_ADMIN_EMAIL),
  };
  await grantPlatformAdmin(engine, ids.admin);

  // Bob is a member of two organizations; Olivia owns the first and Oscar
  // administers it. Neither holds platform standing.
  for (const [id, slug] of [
    [ORG_ACME, 'acme-30918'],
    [ORG_BETA, 'beta-30918'],
  ]) {
    await engine.insert('sys_organization', { id, name: slug, slug });
  }
  for (const [userId, organizationId, role] of [
    [ids.bob, ORG_ACME, 'member'],
    [ids.bob, ORG_BETA, 'member'],
    [ids.owner, ORG_ACME, 'owner'],
    [ids.orgAdmin, ORG_ACME, 'admin'],
  ]) {
    await engine.insert('sys_member', {
      organization_id: organizationId,
      user_id: userId,
      role,
      created_at: new Date(),
    });
  }

  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const signIn = async (email: string): Promise<string> => {
    const res = await direct(manager, '/sign-in/email', { email, password: PASSWORD });
    expect(res.status, `sign-in ${email}: ${await res.clone().text()}`).toBe(200);
    return cookieFrom(res);
  };

  const sessionUser = async (cookie: string): Promise<any> => {
    const res = await manager.handleRequest(new Request(`${ORIGIN}${BASE}/get-session`, { headers: { cookie } }));
    return ((await res.json().catch(() => null)) as any)?.user ?? null;
  };

  /** One OAuth client, with a secret the answers must never carry. */
  const registerClient = async (clientId: string, name: string | null) => {
    await engine.insert('sys_oauth_application', {
      id: `app_${clientId}`,
      client_id: clientId,
      name,
      client_secret: CLIENT_SECRET,
      redirect_uris: JSON.stringify(['http://localhost:56789/callback']),
    });
  };

  /**
   * A consent, written by better-auth's own storage adapter (the write the
   * provider's consent door makes), plus the token rows a real grant carries,
   * so an answer that leaked one would be caught.
   */
  const grant = async (
    userId: string,
    clientId: string,
    opts: { referenceId?: string; scopes?: string[]; createdAt: Date },
  ): Promise<string> => {
    const authCtx = await manager.getAuthContext();
    const row = await authCtx.adapter.create({
      model: 'oauthConsent',
      data: {
        clientId,
        userId,
        scopes: opts.scopes ?? ['openid', 'data:read'],
        ...(opts.referenceId ? { referenceId: opts.referenceId } : {}),
        createdAt: opts.createdAt,
        updatedAt: opts.createdAt,
      },
    });
    await engine.insert('sys_oauth_access_token', {
      token: `${ACCESS_TOKEN}-${row.id}`,
      client_id: clientId,
      user_id: userId,
      scopes: JSON.stringify(opts.scopes ?? ['openid', 'data:read']),
    });
    await engine.insert('sys_oauth_refresh_token', {
      token: `${REFRESH_TOKEN}-${row.id}`,
      client_id: clientId,
      user_id: userId,
      scopes: JSON.stringify(opts.scopes ?? ['openid', 'data:read']),
    });
    return String(row.id);
  };

  const get = (path: string, cookie?: string) =>
    app.request(`${ORIGIN}${BASE}${path}`, {
      method: 'GET',
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    });

  /** No token, secret or session value of any row appears in `text`. */
  const expectNoSecretMaterial = (text: string) => {
    expect(text).not.toContain(CLIENT_SECRET);
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain(REFRESH_TOKEN);
    for (const session of (engine.tables.get('sys_session') ?? []) as any[]) {
      expect(text.includes(String(session.token)), 'a session token appeared in an answer').toBe(false);
    }
  };

  return { engine, manager, ids, signIn, sessionUser, registerClient, grant, get, expectNoSecretMaterial };
};

type Rig = Awaited<ReturnType<typeof arrange>>;

/** Bob's three grants: one per organization he granted in, and one with none active. */
const grantBob = async (rig: Rig) => {
  await rig.registerClient('client_desk', 'Desk Assistant');
  await rig.registerClient('client_ide', 'IDE Agent');
  await rig.registerClient('client_unnamed', null);
  const acme = await rig.grant(rig.ids.bob, 'client_desk', {
    referenceId: ORG_ACME,
    scopes: ['openid', 'data:read'],
    createdAt: new Date('2026-11-01T09:00:00.000Z'),
  });
  const beta = await rig.grant(rig.ids.bob, 'client_ide', {
    referenceId: ORG_BETA,
    scopes: ['openid', 'data:write'],
    createdAt: new Date('2026-11-03T09:00:00.000Z'),
  });
  const none = await rig.grant(rig.ids.bob, 'client_unnamed', {
    scopes: ['openid'],
    createdAt: new Date('2026-11-02T09:00:00.000Z'),
  });
  return { acme, beta, none };
};

const BOB_EXPECTED = (ids: { acme: string; beta: string; none: string }) => [
  {
    id: ids.beta,
    clientId: 'client_ide',
    name: 'IDE Agent',
    scopes: ['openid', 'data:write'],
    organizationId: ORG_BETA,
    authorizedAt: '2026-11-03T09:00:00.000Z',
    lastUsedAt: null,
  },
  {
    id: ids.none,
    clientId: 'client_unnamed',
    name: null,
    scopes: ['openid'],
    organizationId: null,
    authorizedAt: '2026-11-02T09:00:00.000Z',
    lastUsedAt: null,
  },
  {
    id: ids.acme,
    clientId: 'client_desk',
    name: 'Desk Assistant',
    scopes: ['openid', 'data:read'],
    organizationId: ORG_ACME,
    authorizedAt: '2026-11-01T09:00:00.000Z',
    lastUsedAt: null,
  },
];

const readJson = async (res: Response) => {
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any, cacheControl: res.headers.get('cache-control') };
};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  // The provider's own models (`oauthConsent`) are what the fixture writes through.
  process.env.OS_MCP_SERVER_ENABLED = 'true';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

describe('#30918 GET /authorized-clients — the caller\'s own grants', () => {
  it('a member reads exactly their own grants, newest first, with the declared members and no secret material', async () => {
    const rig = await arrange();
    const bobGrants = await grantBob(rig);
    await rig.registerClient('client_alice', 'Alice Helper');
    const aliceGrant = await rig.grant(rig.ids.alice, 'client_alice', {
      createdAt: new Date('2026-11-04T09:00:00.000Z'),
    });

    const bob = await rig.signIn(BOB_EMAIL);
    const bobAnswer = await readJson(await rig.get(AUTHORIZED_CLIENTS_PATH, bob));
    expect(bobAnswer.status, bobAnswer.text).toBe(200);
    expect(bobAnswer.cacheControl).toBe('no-store');
    expect(Object.keys(bobAnswer.body.data).sort()).toEqual(DATA_KEYS);
    expect(bobAnswer.body).toEqual({ success: true, data: { clients: BOB_EXPECTED(bobGrants), truncated: false } });
    for (const row of bobAnswer.body.data.clients) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    rig.expectNoSecretMaterial(bobAnswer.text);

    const alice = await rig.signIn(ALICE_EMAIL);
    const aliceAnswer = await readJson(await rig.get(AUTHORIZED_CLIENTS_PATH, alice));
    expect(aliceAnswer.status, aliceAnswer.text).toBe(200);
    expect(aliceAnswer.body.data.clients.map((row: any) => row.id)).toEqual([aliceGrant]);
    rig.expectNoSecretMaterial(aliceAnswer.text);
  });

  it('a member who names another person with ?userId= is REFUSED 400, never answered as if it were not sent', async () => {
    const rig = await arrange();
    await grantBob(rig);
    const alice = await rig.signIn(ALICE_EMAIL);

    const answer = await readJson(await rig.get(`${AUTHORIZED_CLIENTS_PATH}?userId=${rig.ids.bob}`, alice));
    expect(answer.status, answer.text).toBe(400);
    expect(answer.body.success).toBe(false);
    expect(answer.body.error.code).toBe('VALIDATION_ERROR');
    expect(answer.body.error.message).toContain('userId');
    expect(answer.text).not.toContain('client_desk');
    expect(answer.text).not.toContain(rig.ids.bob);
  });

  it('any other parameter is refused the same way — the query set is closed and empty', async () => {
    const rig = await arrange();
    const bob = await rig.signIn(BOB_EMAIL);
    for (const query of ['?user_id=x', '?limit=500', '?organizationId=org_acme_30918', '?subject=me']) {
      const answer = await readJson(await rig.get(`${AUTHORIZED_CLIENTS_PATH}${query}`, bob));
      expect(answer.status, `${query}: ${answer.text}`).toBe(400);
      expect(answer.body.error.code, query).toBe('VALIDATION_ERROR');
    }
  });

  it('anonymous is 401 UNAUTHENTICATED on both doors', async () => {
    const rig = await arrange();
    await grantBob(rig);
    for (const path of [AUTHORIZED_CLIENTS_PATH, `${ADMIN_AUTHORIZED_CLIENTS_PATH}?userId=${rig.ids.bob}`]) {
      const answer = await readJson(await rig.get(path));
      expect(answer.status, `${path}: ${answer.text}`).toBe(401);
      expect(answer.body.error.code, path).toBe('UNAUTHENTICATED');
      expect(answer.text).not.toContain('client_desk');
    }
  });

  it(`a person holding more than ${AUTHORIZED_CLIENTS_READ_CAP} grants is answered truncated, never a list that silently stops`, async () => {
    const rig = await arrange();
    await rig.registerClient('client_many', 'Many');
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    for (let i = 0; i <= AUTHORIZED_CLIENTS_READ_CAP; i++) {
      await rig.grant(rig.ids.bob, 'client_many', {
        referenceId: `org_${i}`,
        createdAt: new Date(start + i * 60_000),
      });
    }
    const bob = await rig.signIn(BOB_EMAIL);
    const answer = await readJson(await rig.get(AUTHORIZED_CLIENTS_PATH, bob));
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body.data.truncated).toBe(true);
    expect(answer.body.data.clients).toHaveLength(AUTHORIZED_CLIENTS_READ_CAP);
    // Newest first: the oldest grant is the one past the cap.
    expect(answer.body.data.clients.map((row: any) => row.organizationId)).not.toContain('org_0');

    const exact = await arrange();
    await exact.registerClient('client_few', 'Few');
    await exact.grant(exact.ids.bob, 'client_few', { createdAt: new Date(start) });
    const bobAgain = await exact.signIn(BOB_EMAIL);
    const few = await readJson(await exact.get(AUTHORIZED_CLIENTS_PATH, bobAgain));
    expect(few.body.data).toMatchObject({ truncated: false });
    expect(few.body.data.clients).toHaveLength(1);
  });
});

describe('#30918 GET /admin/authorized-clients — another person\'s grants', () => {
  it('a platform administrator reads the person\'s grants in every organization, each row naming its organization', async () => {
    const rig = await arrange();
    const bobGrants = await grantBob(rig);
    const admin = await rig.signIn(ADMIN_EMAIL);
    expect((await rig.sessionUser(admin))?.isPlatformAdmin, 'precondition: platform-admin standing').toBe(true);

    const answer = await readJson(await rig.get(`${ADMIN_AUTHORIZED_CLIENTS_PATH}?userId=${rig.ids.bob}`, admin));
    expect(answer.status, answer.text).toBe(200);
    expect(answer.cacheControl).toBe('no-store');
    expect(answer.body).toEqual({ success: true, data: { clients: BOB_EXPECTED(bobGrants), truncated: false } });
    expect(new Set(answer.body.data.clients.map((row: any) => row.organizationId))).toEqual(
      new Set([ORG_ACME, ORG_BETA, null]),
    );
    for (const row of answer.body.data.clients) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    rig.expectNoSecretMaterial(answer.text);
  });

  it('rule 7: a member, an organization OWNER and an organization ADMIN are refused with ONE answer, whether or not the person exists', async () => {
    const rig = await arrange();
    await grantBob(rig);
    const callers = {
      member: await rig.signIn(ALICE_EMAIL),
      orgOwner: await rig.signIn(OWNER_EMAIL),
      orgAdmin: await rig.signIn(ORG_ADMIN_EMAIL),
      // The person themself: their own door is the other one.
      self: await rig.signIn(BOB_EMAIL),
    };
    for (const [who, cookie] of Object.entries(callers)) {
      expect((await rig.sessionUser(cookie))?.isPlatformAdmin, `precondition: ${who} holds no platform standing`).toBe(false);
      const existing = await readJson(await rig.get(`${ADMIN_AUTHORIZED_CLIENTS_PATH}?userId=${rig.ids.bob}`, cookie));
      const missing = await readJson(await rig.get(`${ADMIN_AUTHORIZED_CLIENTS_PATH}?userId=usr_nobody_30918`, cookie));
      const unnamed = await readJson(await rig.get(ADMIN_AUTHORIZED_CLIENTS_PATH, cookie));
      expect(existing.status, `${who}: ${existing.text}`).toBe(403);
      expect(existing.body.error.code, who).toBe('PERMISSION_DENIED');
      // Byte-identical: the refusal says nothing about whether the person exists.
      expect(missing.status, who).toBe(existing.status);
      expect(missing.text, who).toBe(existing.text);
      expect(unnamed.text, who).toBe(existing.text);
      expect(existing.text).not.toContain('client_desk');
      expect(existing.text).not.toContain(rig.ids.bob);
    }
  });

  it('a platform administrator naming nobody, a repeated or unknown parameter is 400; an id naming no user is 404', async () => {
    const rig = await arrange();
    await grantBob(rig);
    const admin = await rig.signIn(ADMIN_EMAIL);

    for (const query of ['', '?userId=', '?userId=%20', `?userId=${rig.ids.bob}&userId=${rig.ids.alice}`, `?userId=${rig.ids.bob}&limit=5`, '?user_id=x']) {
      const answer = await readJson(await rig.get(`${ADMIN_AUTHORIZED_CLIENTS_PATH}${query}`, admin));
      expect(answer.status, `${query || '(none)'}: ${answer.text}`).toBe(400);
      expect(answer.body.error.code, query).toBe('VALIDATION_ERROR');
      expect(answer.text).not.toContain('client_desk');
    }

    const missing = await readJson(await rig.get(`${ADMIN_AUTHORIZED_CLIENTS_PATH}?userId=usr_nobody_30918`, admin));
    expect(missing.status, missing.text).toBe(404);
    expect(missing.body).toEqual({
      success: false,
      error: { code: 'RESOURCE_NOT_FOUND', message: ADMIN_AUTHORIZED_CLIENTS_USER_NOT_FOUND_MESSAGE },
    });
  });

  it('a person with no grants is answered an empty list, not a refusal', async () => {
    const rig = await arrange();
    const admin = await rig.signIn(ADMIN_EMAIL);
    const answer = await readJson(await rig.get(`${ADMIN_AUTHORIZED_CLIENTS_PATH}?userId=${rig.ids.alice}`, admin));
    expect(answer.status, answer.text).toBe(200);
    expect(answer.body).toEqual({ success: true, data: { clients: [], truncated: false } });
  });
});
