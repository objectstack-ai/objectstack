// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22258] This plugin's admin doors read the session in-process without
 * leaving the browser's cookie behind.
 *
 * better-auth's `getSession` renews a session older than `updateAge` — it
 * moves `sys_session.expires_at` to `now + expiresIn` — and stages the renewed
 * cookie on THAT call's response. The raw `/admin/*` mounts below read the
 * session in-process and answer with their own response, so the renewed
 * cookie was thrown away: the session lived on as a bearer while the browser's
 * cookie died at its old `Max-Age` (a SPLIT session). Each mount now hands
 * better-auth `inProcessSessionReadInput(headers)` (`@objectstack/types`): a
 * request carrying a session cookie reads without renewal; a bearer-only
 * request renews as before.
 *
 * Pinned against REAL better-auth — the installed version, its `expiresIn` /
 * `updateAge` read off the live instance — behind the plugin's REAL route
 * registration on a real Hono app (the `admin-remove-user-gate-ordering`
 * harness: a real `AuthManager` over the shared in-memory engine). The session
 * is aged to `now + expiresIn − updateAge − 60 s`, past `updateAge`, and its
 * `sys_session` row is read straight off the engine's table after each request:
 *
 *   - each door, by cookie: `expires_at` does not move and no session cookie
 *     is set — cookie and session stay aligned;
 *   - the same door, bearer only: `expires_at` renews to `now + expiresIn`,
 *     and no cookie is set on a response to a request that sent none (this
 *     half is also each door's positive control — it proves the door's reader
 *     ran);
 *   - the control, `GET /get-session`: renews AND re-issues the cookie with
 *     `Max-Age = expiresIn`.
 *
 * Doors and the reader each one reaches (`auth-plugin.ts`):
 *   `POST /admin/oauth2/toggle-disabled` → its own platform-admin gate read
 *   `POST /admin/set-user-manager`       → `gateAdmin`, the shared gate of every
 *                                          `/admin/*` mount that calls it
 *   `POST /admin/unlock-user`            → its own platform-admin gate read
 *   `POST /admin/has-permission`         → its own platform-admin branch read
 * Each body is one the door answers right after its read, so no second session
 * read follows the one under test.
 *
 * ## [#22398] The doors whose in-process read is not a `getSession` call
 *
 * The same split happened at doors that read the session through better-auth
 * by another route, so the `getSession` rule could not reach them:
 *
 *   - a RE-DISPATCH through the better-auth handler — a `/get-session` lookup
 *     whose response the door keeps only the JSON of, or a bridge's forward to a
 *     better-auth route behind `sessionMiddleware` whose status and body are all
 *     it keeps. Each now carries `disableRefresh` in its URL for a cookie
 *     request (`in-process-redispatch.ts`);
 *   - an in-process VENDOR ENDPOINT call carrying the request's headers, whose
 *     session middleware reads the session and stages the renewed cookie on a
 *     response that is dropped. Each now takes `inProcessSessionReadInput`'s
 *     input, which better-auth's `getSessionFromCtx` spreads into that read.
 *
 * Doors and the in-process reads each one makes after the mount's own gate:
 *   `POST /admin/sso/register`             → `/get-session` re-dispatch, then the
 *                                            inner `/sso/register` (its ADR-0135
 *                                            D6 before-hook reads the actor)
 *   `POST /admin/sso/register-saml`        → the same pair, SAML bridge
 *   `POST /admin/sso/request-domain-verification`,
 *   `POST /admin/sso/verify-domain`        → the inner route (`sessionMiddleware`)
 *   `POST /send-verification-email`        → `/get-session` re-dispatch (no email
 *                                            in the body), then the inner route
 *   `POST /organization/add-member`        → `authApi.addMember`
 *   `POST /set-initial-password`           → `authApi.setPassword`
 *   `POST /sys-oauth-application/register` → `authApi.createOAuthClient`
 * Each answer below is the one the door gives right after the LAST of its reads
 * ran, so it proves every read under test happened (the comment on
 * `RE_DISPATCH_AND_VENDOR_DOORS` says how).
 *
 * The fixture turns on what those reads need — SSO with domain verification,
 * the OIDC provider, email verification — and nothing reaches the network: the
 * SSO and domain-verification answers are refusals the vendor gives before any
 * discovery fetch or DNS lookup.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-22258';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const ADMIN_EMAIL = 'admin.22258@example.com';
const MEMBER_EMAIL = 'member.22258@example.com';
/** [#22398] An SSO provider the MEMBER registered — the admin may not manage it. */
const MEMBER_IDP = 'pin-22398-member-idp';
/** Clock slack between the server's `now` and this file's, in ms. */
const SLACK_MS = 5_000;

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

let engine: ReturnType<typeof createMemoryEngine>;
let manager: AuthManager;
let app: Hono;
let expiresInSec: number;
let updateAgeSec: number;
let memberId: string;
/** The admin's credentials, as a browser and as a bearer client hold them. */
let cookiePair: string;
let bearer: string;
let sessionToken: string;

/** The admin's `sys_session` row, read straight off the engine's table. */
function sessionRow(): Record<string, unknown> {
  const row = ((engine.tables.get('sys_session') ?? []) as any[]).find((r) => r.token === sessionToken);
  if (!row) throw new Error('pin: the signed-in session row is gone');
  return row;
}

const storedExpiry = (): number => new Date(sessionRow().expires_at as any).getTime();

/** Age the session to just past `updateAge` — the card's `now + expiresIn − updateAge − 60 s`. */
function ageSession(): number {
  const target = Date.now() + (expiresInSec - updateAgeSec - 60) * 1000;
  const row = sessionRow();
  row.expires_at = typeof row.expires_at === 'string' ? new Date(target).toISOString() : new Date(target);
  const stored = storedExpiry();
  expect(Math.abs(stored - target), 'the aging write did not land').toBeLessThan(1_000);
  return stored;
}

/** The session-token cookie a response stages, or `null`. */
function sessionCookieOf(res: Response): { maxAgeSec: number | null } | null {
  const staged = res.headers.getSetCookie().find((c) => /(?:^|\.)session_token=/.test(c.split(';')[0]));
  if (!staged) return null;
  const m = /;\s*max-age=(\d+)/i.exec(staged);
  return { maxAgeSec: m ? Number(m[1]) : null };
}

const asCookie = (): Record<string, string> => ({ cookie: cookiePair });
const asBearer = (): Record<string, string> => ({ authorization: `Bearer ${bearer}` });

const fire = (path: string, body: unknown, credential: Record<string, string>) =>
  app.request(`${ORIGIN}${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...credential },
    body: JSON.stringify(body),
  });

/**
 * The pin: cookie and session expiry stay ALIGNED — either the session did not
 * move and no cookie was staged, or it moved and its cookie was re-issued to
 * expire with it.
 */
function expectAligned(label: string, aged: number, after: number, res: Response) {
  const cookie = sessionCookieOf(res);
  if (after !== aged) {
    expect(cookie, `${label}: the session renewed (+${Math.round((after - aged) / 1000)} s) but its cookie was not re-issued`).not.toBeNull();
    const cookieExpiry = Date.now() + (cookie!.maxAgeSec ?? 0) * 1000;
    expect(Math.abs(cookieExpiry - after), `${label}: re-issued cookie and session expire apart`).toBeLessThan(SLACK_MS);
  } else {
    expect(cookie, `${label}: a cookie was staged for a session that did not move`).toBeNull();
  }
}

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  engine = createMemoryEngine();
  manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    // [#22398] The #22398 doors reach their in-process reads only with these on.
    plugins: { admin: true, sso: true, ssoDomainVerification: true, oidcProvider: true },
    emailVerification: {},
  } as any);

  const direct = (path: string, body: unknown) =>
    manager.handleRequest(
      new Request(`${ORIGIN}${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  for (const [email, name] of [
    [ADMIN_EMAIL, 'Platform Admin'],
    [MEMBER_EMAIL, 'Plain Member'],
  ]) {
    // The default audience posture is invite_only: fixture users beyond the
    // first enter through the invitation carve-out (audience-gate-test-support).
    await inviteForAudienceGate(manager, email);
    const res = await direct('/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  }

  const users = (engine.tables.get('sys_user') ?? []) as any[];
  memberId = String(users.find((r) => r.email === MEMBER_EMAIL)!.id);
  // The legacy scalar `isPlatformAdminUser` accepts as its documented
  // back-compat signal — every door below admits this caller.
  users.find((r) => r.email === ADMIN_EMAIL)!.role = 'admin';
  // [#22398] A verified address: `/send-verification-email` then answers 400
  // EMAIL_ALREADY_VERIFIED right after its session read, with no transport.
  users.find((r) => r.email === ADMIN_EMAIL)!.email_verified = true;
  // [#22398] Org-less and the member's: `checkProviderAccess` refuses the admin
  // 403 right after `sessionMiddleware` read the session.
  await engine.insert('sys_sso_provider', {
    id: 'ssop_pin_22398',
    provider_id: MEMBER_IDP,
    issuer: 'https://idp.pin-22398.example.com',
    domain: 'pin-22398.example.com',
    user_id: memberId,
    organization_id: null,
    domain_verified: false,
  });

  // The version this package pins, read off the running instance — never assumed.
  const authContext: any = await manager.getAuthContext();
  expiresInSec = Number(authContext.sessionConfig.expiresIn);
  updateAgeSec = Number(authContext.sessionConfig.updateAge);

  const res = await direct('/sign-in/email', { email: ADMIN_EMAIL, password: PASSWORD });
  expect(res.status, `sign-in: ${await res.clone().text()}`).toBe(200);
  const staged = res.headers.getSetCookie().find((c) => /(?:^|\.)session_token=/.test(c.split(';')[0]));
  if (!staged) throw new Error('pin sign-in staged no session cookie');
  cookiePair = staged.split(';')[0];
  bearer = String(res.headers.get('set-auth-token') ?? '');
  if (!bearer) throw new Error('pin sign-in emitted no set-auth-token');
  sessionToken = String(((await res.json()) as any).token);

  // The REAL route registration — raw mounts ahead of the catch-all — on a
  // real Hono app in front of the real AuthManager.
  app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
});

afterAll(() => vi.restoreAllMocks());

describe('[#22258] precondition — this stack renews, and the defect is better-auth\'s own behaviour', () => {
  it('reads expiresIn / updateAge off the running better-auth', () => {
    expect(expiresInSec).toBeGreaterThan(updateAgeSec);
    expect(updateAgeSec).toBeGreaterThan(60);
  });

  it('a bare in-process getSession on an aged session renews it and stages a cookie nobody sends', async () => {
    const aged = ageSession();
    const api: any = await manager.getApi();
    // No rule: the call every reader in this file used to make.
    await api.getSession({ headers: new Headers({ cookie: cookiePair }) });
    const after = storedExpiry();
    expect(after - aged, 'the fixture does not renew — every pin below would pass vacuously')
      .toBeGreaterThan((updateAgeSec - SLACK_MS / 1000) * 1000);
  });
});

const DOORS: Array<{ label: string; path: string; body: () => unknown }> = [
  {
    label: 'POST /admin/oauth2/toggle-disabled',
    path: '/admin/oauth2/toggle-disabled',
    body: () => ({ client_id: 'cl_pin_22258_absent', disabled: true }),
  },
  {
    label: 'POST /admin/set-user-manager (gateAdmin)',
    path: '/admin/set-user-manager',
    body: () => ({}),
  },
  {
    label: 'POST /admin/unlock-user',
    path: '/admin/unlock-user',
    body: () => ({ userId: memberId }),
  },
  {
    label: 'POST /admin/has-permission (platform-admin branch)',
    path: '/admin/has-permission',
    body: () => ({ permissions: { user: ['list'] } }),
  },
];

describe('[#22258] each admin door leaves cookie and session expiry aligned', () => {
  for (const door of DOORS) {
    it(`${door.label} — by cookie: no renewal, no cookie`, async () => {
      const aged = ageSession();
      const res = await fire(door.path, door.body(), asCookie());
      // Admitted: the read under test resolved the admin (a refusal would be 401/403).
      expect([401, 403], `${door.label} refused the admin: ${res.status}`).not.toContain(res.status);
      expect(res.status, `${door.label} answered ${res.status}`).toBeLessThan(500);
      const after = storedExpiry();
      expectAligned(door.label, aged, after, res);
      expect(after, `${door.label}: a cookie request renewed in-process`).toBe(aged);
    });

    it(`${door.label} — bearer only: renews as before, sets no cookie`, async () => {
      const aged = ageSession();
      const res = await fire(door.path, door.body(), asBearer());
      expect([401, 403], `${door.label} refused the admin: ${res.status}`).not.toContain(res.status);
      expect(res.status, `${door.label} answered ${res.status}`).toBeLessThan(500);
      const after = storedExpiry();
      expect(after, `${door.label}: a bearer-only read no longer renews`).toBeGreaterThan(aged);
      expect(Math.abs(after - (Date.now() + expiresInSec * 1000)), `${door.label}: the renewal is not to now + expiresIn`)
        .toBeLessThan(SLACK_MS);
      expect(sessionCookieOf(res), `${door.label}: a cookie was set on a response to a request that sent none`).toBeNull();
    });
  }
});

/** The error code a door answered with: the envelope's, or better-auth's native body's. */
const codeOf = (json: any): string | undefined => json?.error?.code ?? json?.code;

/**
 * [#22398] Each door, and the answer that proves its last in-process read ran:
 *
 *   - `/admin/sso/register(-saml)`: 403 with the bridge's own code. The inner
 *     `/sso/register` before-hook resolved the actor and refused it (the
 *     legacy `role` admits at the mount's gate, not at the ADR-0068 D4 hook) —
 *     an unresolved session would have been the vendor's 401;
 *   - the domain-verification bridges: 403 — `checkProviderAccess` refused a
 *     provider the admin does not own, after `sessionMiddleware` resolved the
 *     admin;
 *   - `/send-verification-email`: better-auth's own 400 EMAIL_ALREADY_VERIFIED,
 *     which needs the session's user (with no email in the body, that email
 *     came from the `/get-session` re-dispatch);
 *   - add-member: the vendor's 400 ORGANIZATION_NOT_FOUND, read after its
 *     session; set-initial-password: 409 PASSWORD_ALREADY_SET, read after
 *     `sensitiveSessionMiddleware`; the OAuth register: 200, the client minted
 *     for the session's user.
 */
const RE_DISPATCH_AND_VENDOR_DOORS: Array<{
  label: string;
  path: string;
  body: () => unknown;
  answers: { status: number; code?: string };
}> = [
  {
    label: 'POST /admin/sso/register (get-session re-dispatch + inner /sso/register)',
    path: '/admin/sso/register',
    body: () => ({ providerId: 'pin-22398-oidc', issuer: 'https://idp.pin-22398.example.com', domain: 'pin-22398.example.com', clientId: 'cid', clientSecret: 'csecret' }),
    answers: { status: 403, code: 'SSO_REGISTER_FAILED' },
  },
  {
    label: 'POST /admin/sso/register-saml (get-session re-dispatch + inner /sso/register)',
    path: '/admin/sso/register-saml',
    body: () => ({ providerId: 'pin-22398-saml', issuer: 'https://idp.pin-22398.example.com', domain: 'pin-22398.example.com', entryPoint: 'https://idp.pin-22398.example.com/sso', cert: 'MIIBpin22398' }),
    answers: { status: 403, code: 'SAML_REGISTER_FAILED' },
  },
  {
    label: 'POST /admin/sso/request-domain-verification (inner re-dispatch)',
    path: '/admin/sso/request-domain-verification',
    body: () => ({ providerId: MEMBER_IDP }),
    answers: { status: 403 },
  },
  {
    label: 'POST /admin/sso/verify-domain (inner re-dispatch)',
    path: '/admin/sso/verify-domain',
    body: () => ({ providerId: MEMBER_IDP }),
    answers: { status: 403 },
  },
  {
    label: 'POST /send-verification-email, no email (get-session re-dispatch + inner route)',
    path: '/send-verification-email',
    body: () => ({}),
    answers: { status: 400, code: 'EMAIL_ALREADY_VERIFIED' },
  },
  {
    label: 'POST /send-verification-email, explicit email (inner route)',
    path: '/send-verification-email',
    body: () => ({ email: ADMIN_EMAIL }),
    answers: { status: 400, code: 'EMAIL_ALREADY_VERIFIED' },
  },
  {
    label: 'POST /organization/add-member (authApi.addMember)',
    path: '/organization/add-member',
    body: () => ({ userId: memberId, role: 'member', organizationId: 'org_pin_22398_absent' }),
    answers: { status: 400, code: 'ORGANIZATION_NOT_FOUND' },
  },
  {
    label: 'POST /set-initial-password (authApi.setPassword)',
    path: '/set-initial-password',
    body: () => ({ newPassword: 'Another!Passw0rd-22398' }),
    answers: { status: 409, code: 'PASSWORD_ALREADY_SET' },
  },
  {
    label: 'POST /sys-oauth-application/register (authApi.createOAuthClient)',
    path: '/sys-oauth-application/register',
    body: () => ({ name: 'pin-22398', redirectURLs: 'https://app.pin-22398.example.com/callback' }),
    answers: { status: 200 },
  },
];

/** The door gave the answer that proves its last in-process read ran. */
async function expectAnswered(door: (typeof RE_DISPATCH_AND_VENDOR_DOORS)[number], res: Response) {
  const json: any = await res.clone().json().catch(() => null);
  expect(res.status, `${door.label} answered ${res.status}: ${JSON.stringify(json)}`).toBe(door.answers.status);
  if (door.answers.code) expect(codeOf(json), `${door.label}: ${JSON.stringify(json)}`).toBe(door.answers.code);
}

describe('[#22398] each re-dispatch and vendor-call door leaves cookie and session expiry aligned', () => {
  for (const door of RE_DISPATCH_AND_VENDOR_DOORS) {
    it(`${door.label} — by cookie: no renewal, no cookie`, async () => {
      const aged = ageSession();
      const res = await fire(door.path, door.body(), asCookie());
      await expectAnswered(door, res);
      const after = storedExpiry();
      expectAligned(door.label, aged, after, res);
      expect(after, `${door.label}: a cookie request renewed in-process`).toBe(aged);
    });

    it(`${door.label} — bearer only: renews as before, sets no cookie`, async () => {
      const aged = ageSession();
      const res = await fire(door.path, door.body(), asBearer());
      await expectAnswered(door, res);
      const after = storedExpiry();
      expect(after, `${door.label}: a bearer-only read no longer renews`).toBeGreaterThan(aged);
      expect(Math.abs(after - (Date.now() + expiresInSec * 1000)), `${door.label}: the renewal is not to now + expiresIn`)
        .toBeLessThan(SLACK_MS);
      expect(sessionCookieOf(res), `${door.label}: a cookie was set on a response to a request that sent none`).toBeNull();
    });
  }
});

describe('[#22258] control — the browser-facing get-session still renews and re-issues', () => {
  it('renews an aged session and re-issues the cookie with Max-Age = expiresIn', async () => {
    const aged = ageSession();
    const res = await app.request(`${ORIGIN}${BASE}/get-session`, { headers: { origin: ORIGIN, ...asCookie() } });
    expect(res.status).toBe(200);
    const after = storedExpiry();
    expect(Math.abs(after - (Date.now() + expiresInSec * 1000)), 'get-session did not renew').toBeLessThan(SLACK_MS);
    expect(sessionCookieOf(res)?.maxAgeSec, 'get-session did not re-issue the cookie with Max-Age = expiresIn').toBe(expiresInSec);
    expectAligned('get-session', aged, after, res);
  });
});
