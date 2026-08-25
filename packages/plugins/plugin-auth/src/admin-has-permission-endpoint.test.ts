// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #11900 — `/admin/has-permission` answers a PLATFORM ADMIN from the ADR-0068
// predicate, and changes NOTHING else.
//
// ── The defect this pins ────────────────────────────────────────────────────
//
// The vendor evaluates this permission QUERY on the legacy
// `user.role === 'admin'` scalar ADR-0068 D2 stopped synthesizing, so a
// genuine ObjectStack platform admin was answered `200 {"success":false}` —
// byte-identical to a plain member. A wrong ANSWER, not a refusal: no error to
// notice, and any caller trusting it as "this admin may not do X" is silently
// wrong. Maintainer ruling 2026-08-25 (option B per the card body's
// lettering): shade the route (#9652 pattern), answer from the predicate.
//
// ── Why every leg drives the REAL mount chain ───────────────────────────────
//
// Raw-mount-vs-catch-all ordering does not exist inside `AuthManager` — a test
// driving `handleRequest` directly would bypass the mount under test entirely
// (the `admin-remove-user-gate-ordering.test.ts` reading). So the fixture
// mounts `AuthPlugin.registerAuthRoutes` on a real Hono app in front of a real
// `AuthManager` on the installed better-auth, and every assertion reads a
// status and a body off a real `Response`.
//
// ── Why the admin is granted, never scalared ────────────────────────────────
//
// ⛔ The subject is made a platform admin the ADR-0068 D2 way — an unscoped
// `admin_full_access` grant — and the fixture ASSERTS the legacy scalar is
// absent. A `role = 'admin'` fixture would be answered `true` by the UNSHADED
// vendor too: it passes with or without this card's change and measures
// nothing (the `admin-impersonate-endpoint.test.ts` discipline).
//
// ── The contrast is the load-bearing half ───────────────────────────────────
//
// The failure was a wrong ANSWER, so the answer is asserted in BOTH
// directions, twice over:
//
//  • caller contrast — the admin's `true` means nothing unless the plain
//    member's own `{"error":null,"success":false}` stays exactly as it is
//    (a build that answers `true` for everyone satisfies the admin leg alone;
//    the member's `true` would be the LEAK the non-admin dogfood sweep pins);
//  • query contrast — the admin's `true` for a granted statement means
//    nothing unless an UNGRANTED one still answers `false` (a build that
//    echoes the predicate unconditionally satisfies the granted leg alone,
//    and is just a new wrong-200 pointing the other way).
//
// Plus the delegated remainder, unchanged: anonymous 401 (enveloped), and the
// vendor's own 400 for every body shape it refuses to evaluate — asserted for
// the ADMIN caller, because the shading must not put an answer where the
// vendor's validation order puts a refusal.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { readEvaluatedPermissionQuery } from './admin-has-permission-endpoint';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-11900';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';
const ROUTE = '/admin/has-permission';
const PS_ADMIN = 'ps_admin_full_access';

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

/** Status, parsed JSON (when any), and the raw text for failure messages. */
async function answerOf(res: Response): Promise<{ status: number; json: any; text: string }> {
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

/**
 * One deployment, served through the REAL mount chain: `admin` holds the
 * ADR-0068 grant (and provably NOT the scalar), `member` is a plain
 * authenticated user.
 */
async function stage() {
  const engine = createMemoryEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { admin: true },
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
    ['admin.11900@example.com', 'Granted Platform Admin'],
    ['member.11900@example.com', 'Plain Member'],
  ]) {
    // [#11767] default audience posture is invite_only: fixture users beyond
    // the first enter through the invitation carve-out.
    await inviteForAudienceGate(manager, email);
    const res = await direct('/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  }

  const users = (engine.tables.get('sys_user') ?? []) as any[];
  const adminId = String(users.find((r) => r.email === 'admin.11900@example.com')!.id);

  // The ADR-0068 D2 grant — an ORG-LESS `admin_full_access` link. ⛔ NOT the
  // legacy scalar (see header).
  await engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
  await engine.insert('sys_user_permission_set', {
    user_id: adminId,
    permission_set_id: PS_ADMIN,
    organization_id: null,
  });

  const bearerFor = async (email: string) => {
    const res = await direct('/sign-in/email', { email, password: PASSWORD });
    const token = res.headers.get('set-auth-token');
    expect(token, `sign-in ${email} must mint a bearer or the legs below prove nothing`).toBeTruthy();
    return token!;
  };
  const adminBearer = await bearerFor('admin.11900@example.com');
  const memberBearer = await bearerFor('member.11900@example.com');

  // The REAL route registration — raw mounts ahead of the catch-all.
  const app = new Hono();
  const ctx = mockCtx();
  const plugin = new AuthPlugin({ secret: SECRET });
  await plugin.init(ctx);
  (plugin as any).authManager = manager;
  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);

  const fire = (body: unknown, bearer?: string) =>
    app.request(`${ORIGIN}${BASE}${ROUTE}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

  return { engine, fire, adminId, adminBearer, memberBearer };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
// THE FIX, WITH BOTH CONTRASTS — one staging, every caller
// ───────────────────────────────────────────────────────────────────────────

describe('#11900 — /admin/has-permission answers the ADR-0068 platform admin', () => {
  it('admin true / same-query member false / ungranted-query admin false — both contrasts on one staging', async () => {
    const { engine, fire, adminId, adminBearer, memberBearer } = await stage();

    // Control: the subject's standing is the GRANT, not the scalar. Without
    // this the true-leg below could be riding the vendor's own gate.
    const adminRow = (engine.tables.get('sys_user') ?? []).find(
      (r: any) => String(r.id) === adminId,
    );
    expect(
      adminRow?.role,
      'fixture control: the admin must NOT carry the legacy scalar — a scalared fixture is answered ' +
        'true by the UNSHADED vendor and measures nothing',
    ).not.toBe('admin');

    const granted = { permissions: { user: ['list'] } };

    // ⭐ THE FIX. Before the mount this answered {"error":null,"success":false}
    // — the wrong-200 the card measured.
    const admin = await answerOf(await fire(granted, adminBearer));
    expect(admin.status, `admin granted-query: ${admin.text}`).toBe(200);
    expect(admin.json, 'the platform admin must get the answer real execution gives').toEqual({
      error: null,
      success: true,
    });

    // ⛔ CALLER CONTRAST — the load-bearing negative. The member's own
    // negative ANSWER must stay exactly as it is: same envelope, same keys,
    // same verdict. A `true` here is the leak; a refusal here is a different
    // regression (the gate swallowing a self-scoped query).
    const member = await answerOf(await fire(granted, memberBearer));
    expect(member.status, `member granted-query: ${member.text}`).toBe(200);
    expect(member.json, 'the plain member’s negative answer must not move').toEqual({
      error: null,
      success: false,
    });

    // ⛔ QUERY CONTRAST — the predicate decides WHO, the vendor's statements
    // still decide WHAT. `user: ['impersonate-admins']` is in the vendor's
    // statement vocabulary but NOT granted to its admin role; an unknown
    // resource is outside the vocabulary entirely. Both must stay `false` for
    // the admin, exactly as they would for a legacy-scalar admin — a mount
    // that echoes the predicate unconditionally fails here.
    for (const ungranted of [
      { permissions: { user: ['impersonate-admins'] } },
      { permissions: { 'not-a-vendor-resource': ['read'] } },
      { permissions: {} }, // the vendor's empty query is a `false`, both roles
    ]) {
      const a = await answerOf(await fire(ungranted, adminBearer));
      expect(a.status, `admin ungranted-query ${JSON.stringify(ungranted)}: ${a.text}`).toBe(200);
      expect(
        a.json,
        `an ungranted permission must still answer false to the admin — ${JSON.stringify(ungranted)}`,
      ).toEqual({ error: null, success: false });
    }
  }, 120_000);

  it('the delegated remainder is untouched: anonymous 401, vendor 400s in vendor order', async () => {
    const { fire, adminBearer } = await stage();

    // Anonymous with an evaluable body → the vendor lane's enveloped 401
    // (#10349), delegated. The mount must never mint an answer for a caller
    // it did not resolve.
    const anon = await answerOf(await fire({ permissions: { user: ['list'] } }));
    expect(anon.status, `anonymous: ${anon.text}`).toBe(401);
    expect(anon.json?.error?.code, `anonymous code: ${anon.text}`).toBe('UNAUTHENTICATED');

    // Bodies the vendor refuses to EVALUATE must keep the vendor's own 400 —
    // for the ADMIN caller. The shading must not put a confident answer where
    // the vendor's validation order puts a refusal (that would be a new
    // wrong-200), so every one of these delegates:
    const refused: Array<[string, unknown]> = [
      ['no permission key at all', {}],
      ['singular `permission` only (zod-valid, handler-refused)', { permission: { user: ['list'] } }],
      ['both keys (the schema xor)', { permission: { user: ['list'] }, permissions: { user: ['list'] } }],
      ['non-string action element', { permissions: { user: [1] } }],
      ['permissions not a record', { permissions: 'user' }],
      ['non-string role alongside a valid query', { role: 5, permissions: { user: ['list'] } }],
    ];
    for (const [label, body] of refused) {
      const a = await answerOf(await fire(body, adminBearer));
      expect(a.status, `${label}: expected the vendor's own 400, got ${a.status} ${a.text}`).toBe(400);
      expect(a.json?.success, `${label}: a refused body must never read as an answer`).not.toBe(true);
    }
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The acceptance mirror, both directions (see the module header for why a
// looser OR stricter set than the vendor's is each its own wrong-200)
// ───────────────────────────────────────────────────────────────────────────

describe('#11900 — readEvaluatedPermissionQuery mirrors the vendor-evaluated set', () => {
  it('accepts exactly the bodies the installed vendor handler evaluates', () => {
    // Evaluated by the vendor → returned for answering.
    expect(readEvaluatedPermissionQuery({ permissions: { user: ['list'] } })).toEqual({
      user: ['list'],
    });
    expect(
      readEvaluatedPermissionQuery({ userId: 42, role: 'user', permissions: { a: [] } }),
      'userId is dead on the wire and any JSON value coerces; a string role passes zod',
    ).toEqual({ a: [] });
    expect(readEvaluatedPermissionQuery({ permissions: {} }), 'the empty query IS evaluated (to false)').toEqual({});

    // Refused (or never evaluated) by the vendor → undefined → delegate.
    expect(readEvaluatedPermissionQuery(undefined)).toBeUndefined();
    expect(readEvaluatedPermissionQuery('permissions')).toBeUndefined();
    expect(readEvaluatedPermissionQuery({})).toBeUndefined();
    expect(readEvaluatedPermissionQuery({ permission: { user: ['list'] } }), 'singular-only dies in the handler').toBeUndefined();
    expect(
      readEvaluatedPermissionQuery({ permission: { user: ['list'] }, permissions: { user: ['list'] } }),
      'both keys fail the schema xor',
    ).toBeUndefined();
    expect(readEvaluatedPermissionQuery({ permissions: { user: 'list' } })).toBeUndefined();
    expect(readEvaluatedPermissionQuery({ permissions: { user: [1] } })).toBeUndefined();
    expect(readEvaluatedPermissionQuery({ permissions: ['user'] })).toBeUndefined();
    expect(readEvaluatedPermissionQuery({ role: 5, permissions: { user: ['list'] } })).toBeUndefined();
  });
});
