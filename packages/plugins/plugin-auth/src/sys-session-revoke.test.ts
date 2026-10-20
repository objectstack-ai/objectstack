// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `POST /api/v1/auth/sys-session/revoke` — the door behind the `sys_session`
// Revoke Session row action. The invariant: a session named by its row id
// ends, its next request is refused, and only a caller entitled to end it can
// end it — the session's owner, or a platform administrator. The session token
// is never part of any request to or answer from this door.
//
// Every revoke assertion pins BOTH directions, following
// `session-tombstone.test.ts`: the cookie STOPS authenticating, and the row
// SURVIVES carrying its cause (ADR-0069 D4). Every refusal pins the opposite:
// the target cookie STILL authenticates and the row is untouched. Refusals are
// asserted as `status` AND `code` (ADR-0112).
//
// Real pipeline throughout: the plugin's REAL route registration on a real
// Hono app in front of a real `AuthManager` (the
// `in-process-session-renewal.pin.test.ts` harness), cookies minted by
// better-auth's own sign-in, and "is this session alive?" asked of
// better-auth's own `/get-session`.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import type { PluginContext } from '@objectstack/core';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
// ⚠️ Imported from a sibling TEST file on purpose, as
// `admin-impersonate-endpoint.test.ts` and `in-process-session-renewal.pin.test.ts`
// do: that file's pinned engine double is reused rather than minting a second
// one with its own `check:engine-double-contract` ledger entries. The cost is
// known — its rotation cases also run inside this file.
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';
import { INTERACTIVE_REVOKE_REASON } from './session-tombstone';
import {
  ADMIN_SESSION_REVOKE_REASON,
  SYS_SESSION_REVOKE_NOT_FOUND_CODE,
  SYS_SESSION_REVOKE_NOT_FOUND_MESSAGE,
  SYS_SESSION_REVOKE_PATH,
} from './sys-session-revoke';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-revoke-by-id';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const PS_ADMIN = 'ps_admin_full_access';
const ADMIN_EMAIL = 'padmin@revoke-by-id.example.com';
const ALICE_EMAIL = 'alice@revoke-by-id.example.com';
const BOB_EMAIL = 'bob@revoke-by-id.example.com';

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

const makeManager = (engine: any) =>
  new AuthManager({ secret: SECRET, baseUrl: ORIGIN, dataEngine: engine } as any);

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

const sessionRows = (engine: any) => (engine.tables.get('sys_session') ?? []) as any[];
const userRows = (engine: any) => (engine.tables.get('sys_user') ?? []) as any[];

const userIdFor = (engine: any, email: string): string => {
  const row = userRows(engine).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/** The Default Organization (the `sys_organization` row slugged `default`), staged when the engine holds none. */
const defaultOrganizationIdOf = async (engine: any): Promise<string> => {
  const existing = (engine.tables.get('sys_organization') ?? []).find((r: any) => r.slug === 'default');
  if (existing) return String(existing.id);
  await engine.insert('sys_organization', { id: 'org_default', name: 'Default Organization', slug: 'default' });
  return 'org_default';
};

/**
 * ADR-0068 D2 standing — the Default Organization's `admin_full_access` grant
 * (ADR-0131 D5), never the legacy `role` scalar. An organization-less grant
 * anchors nothing.
 */
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

/** The three sign-ups every case starts from, made once per file (one scrypt derivation each). */
let signedUpTables: Promise<Map<string, any[]>> | undefined;
const signedUpOnce = (): Promise<Map<string, any[]>> =>
  (signedUpTables ??= (async () => {
    const template = createMemoryEngine();
    const manager = makeManager(template);
    for (const [email, name] of [
      [ADMIN_EMAIL, 'Platform Admin'],
      [ALICE_EMAIL, 'Alice'],
      [BOB_EMAIL, 'Bob'],
    ]) {
      await inviteForAudienceGate(manager, email);
      const res = await direct(manager, '/sign-up/email', { email, password: PASSWORD, name });
      expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
    }
    return template.tables as Map<string, any[]>;
  })());

interface Signed {
  cookie: string;
  row: any;
}

const arrange = async () => {
  const engine = createMemoryEngine();
  for (const [name, rows] of await signedUpOnce()) engine.tables.set(name, structuredClone(rows));
  const manager = makeManager(engine);
  await grantPlatformAdmin(engine, userIdFor(engine, ADMIN_EMAIL));

  // The REAL route registration — raw mounts ahead of the catch-all.
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const signIn = async (email: string): Promise<Signed> => {
    const res = await direct(manager, '/sign-in/email', { email, password: PASSWORD });
    expect(res.status, `sign-in ${email}: ${await res.clone().text()}`).toBe(200);
    const token = String(((await res.clone().json()) as any).token);
    const row = sessionRows(engine).find((r) => r.token === token);
    if (!row) throw new Error(`no sys_session row for ${email}'s sign-in`);
    return { cookie: cookieFrom(res), row };
  };

  /** The live session payload for a cookie, or `null`. */
  const sessionOf = async (cookie: string): Promise<any | null> => {
    const res = await manager.handleRequest(new Request(`${ORIGIN}${BASE}/get-session`, { headers: { cookie } }));
    if (res.status !== 200) return null;
    const body = (await res.json().catch(() => null)) as any;
    return body?.user?.id ? body : null;
  };
  const isAuthenticated = async (cookie: string) => (await sessionOf(cookie)) !== null;

  /** POST the door through the Hono app, as the console does: cookie, origin, JSON body. */
  const revoke = (cookie: string | undefined, body: unknown) =>
    app.request(`${ORIGIN}${BASE}${SYS_SESSION_REVOKE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });

  /** No session token, of any row, appears anywhere in `text`. */
  const expectNoToken = (text: string) => {
    for (const row of sessionRows(engine)) {
      expect(text.includes(String(row.token)), 'a session token appeared in an answer').toBe(false);
    }
  };

  return { engine, manager, signIn, sessionOf, isAuthenticated, revoke, expectNoToken };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

describe('sys-session/revoke — a session named by its id ends', () => {
  it("an administrator revoking another user's session by id ends it: that session's next request is refused", async () => {
    const { engine, signIn, sessionOf, isAuthenticated, revoke, expectNoToken } = await arrange();
    const alice = await signIn(ALICE_EMAIL);
    const admin = await signIn(ADMIN_EMAIL);
    expect(await isAuthenticated(alice.cookie), 'precondition: the target session is live').toBe(true);
    expect((await sessionOf(admin.cookie))?.user?.isPlatformAdmin, 'precondition: platform-admin standing').toBe(true);

    // The console adds the active organization to every auth-namespace body.
    const res = await revoke(admin.cookie, { sessionId: alice.row.id, organizationId: 'org_any' });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toEqual({ success: true, data: { sessionId: alice.row.id } });
    expectNoToken(text);

    expect(await isAuthenticated(alice.cookie), 'the revoked session still authenticates').toBe(false);
    const row = sessionRows(engine).find((r) => r.id === alice.row.id);
    expect(row, 'the row is kept as the record of its ending').toBeDefined();
    expect(row.revoke_reason).toBe('admin');
    expect(row.revoked_at).toBeTruthy();
    expect(await isAuthenticated(admin.cookie), "the administrator's own session is untouched").toBe(true);
  });

  it("a session's owner revoking their own other session by id ends that one and keeps the current one", async () => {
    const { engine, signIn, isAuthenticated, revoke, expectNoToken } = await arrange();
    const current = await signIn(ALICE_EMAIL);
    const other = await signIn(ALICE_EMAIL);

    const res = await revoke(current.cookie, { sessionId: other.row.id });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(JSON.parse(text)).toEqual({ success: true, data: { sessionId: other.row.id } });
    expectNoToken(text);

    expect(await isAuthenticated(other.cookie), 'the revoked session still authenticates').toBe(false);
    expect(await isAuthenticated(current.cookie), 'the current session must survive').toBe(true);
    const row = sessionRows(engine).find((r) => r.id === other.row.id);
    expect(row.revoke_reason).toBe('user_revoked');
    expect(row.revoked_at).toBeTruthy();
  });

  it('an already-ended session reads not-found, and its record keeps the first ending', async () => {
    const { engine, signIn, revoke } = await arrange();
    const alice = await signIn(ALICE_EMAIL);
    const admin = await signIn(ADMIN_EMAIL);
    expect((await revoke(admin.cookie, { sessionId: alice.row.id })).status).toBe(200);
    const first = sessionRows(engine).find((r) => r.id === alice.row.id).revoked_at;

    const again = await revoke(admin.cookie, { sessionId: alice.row.id });
    const body = (await again.json()) as any;
    expect(again.status).toBe(404);
    expect(body.error.code).toBe(SYS_SESSION_REVOKE_NOT_FOUND_CODE);
    expect(sessionRows(engine).find((r) => r.id === alice.row.id).revoked_at).toEqual(first);
  });
});

describe('sys-session/revoke — only a caller entitled to end a session can end it', () => {
  it("a signed-in caller without platform-admin standing cannot revoke another user's session", async () => {
    const { engine, signIn, sessionOf, isAuthenticated, revoke, expectNoToken } = await arrange();
    const alice = await signIn(ALICE_EMAIL);
    const bob = await signIn(BOB_EMAIL);
    expect((await sessionOf(bob.cookie))?.user?.isPlatformAdmin, 'precondition: no platform-admin standing').not.toBe(true);

    const res = await revoke(bob.cookie, { sessionId: alice.row.id });
    const text = await res.text();
    expect(res.status, text).toBe(404);
    const body = JSON.parse(text);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(SYS_SESSION_REVOKE_NOT_FOUND_CODE);
    expect(body.error.message).toBe(SYS_SESSION_REVOKE_NOT_FOUND_MESSAGE);
    expectNoToken(text);

    expect(await isAuthenticated(alice.cookie), "another user's session must survive").toBe(true);
    const row = sessionRows(engine).find((r) => r.id === alice.row.id);
    expect(row.revoked_at ?? null).toBeNull();

    // The answer is the one an id naming no session gets, byte for byte.
    const missing = await revoke(bob.cookie, { sessionId: 'ses_names_nothing' });
    expect(missing.status).toBe(res.status);
    expect(await missing.text()).toBe(text);
  });

  it('an anonymous caller is refused before anything is revoked', async () => {
    const { engine, signIn, isAuthenticated, revoke, expectNoToken } = await arrange();
    const alice = await signIn(ALICE_EMAIL);

    const res = await revoke(undefined, { sessionId: alice.row.id });
    const text = await res.text();
    expect(res.status, text).toBe(401);
    expect(JSON.parse(text).error.code).toBe('UNAUTHENTICATED');
    expectNoToken(text);

    expect(await isAuthenticated(alice.cookie)).toBe(true);
    expect(sessionRows(engine).find((r) => r.id === alice.row.id).revoked_at ?? null).toBeNull();
  });

  it('a request that names no session is refused, and nothing is revoked', async () => {
    const { engine, signIn, revoke } = await arrange();
    const admin = await signIn(ADMIN_EMAIL);
    const before = sessionRows(engine).filter((r) => r.revoked_at).length;

    const res = await revoke(admin.cookie, { organizationId: 'org_any' });
    const body = (await res.json()) as any;
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(sessionRows(engine).filter((r) => r.revoked_at).length).toBe(before);
  });
});

describe('sys-session/revoke — the administrator lane records the ledger value', () => {
  it("records the interactive-revoke ledger's own `admin` reason", () => {
    expect(ADMIN_SESSION_REVOKE_REASON).toBe(INTERACTIVE_REVOKE_REASON['/admin/revoke-user-session']);
    expect(ADMIN_SESSION_REVOKE_REASON).toBe('admin');
  });
});
