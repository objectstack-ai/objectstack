// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #11477 — ORDERING PIN: on `/admin/remove-user` the break-glass guard must run
// AFTER authorization, and the whole `/admin/*` family must agree on that order.
//
// ── The defect this pins, and why a pin is half the fix ─────────────────────
//
// The break-glass last-local-credential guard is a global `hooks.before` keyed
// on `ctx.path` (auth-manager.ts). A better-auth `before` hook runs ahead of the
// endpoint's own `use: [adminMiddleware]`, and on this route that middleware
// only establishes a SESSION — the role decision happens later still, inside
// the vendor's handler. So the guard's lookup, and its distinctive refusal,
// were reachable by any AUTHENTICATED caller before either authorization layer
// had run.
//
// The same guard on `/admin/ban-user` ran AFTER authorization, because #9652
// shades that path with a raw mount whose `gateAdmin` fires first. One guard,
// two routes, OPPOSITE orders, and nothing asserting either. That is why the
// maintainer's 2026-08-25 ruling (option A, verbatim 「全部同意」) shipped an
// ordering pin alongside the shading: the defect exists precisely because two
// routes drifted apart with no test able to notice.
//
// ── Why the assertion is INDISTINGUISHABILITY, not "it is refused" ──────────
//
// ⛔ Asserting merely that a non-admin is refused would be satisfied by the
// DEFECTIVE build: the defective build refuses too — it just refuses the
// break-glass holder with a different status and a different code than it
// refuses everyone else, and that difference IS the leak. The finding is about
// what a non-admin can TELL APART, so the load-bearing assertion is that one
// authenticated non-admin, naming two different targets, gets responses that
// are byte-identical.
//
// ── Why this file drives the REAL seam ──────────────────────────────────────
//
// Raw-mount-vs-vendor-router ordering does not exist inside `AuthManager`: the
// mounts live on the plugin's Hono app, and `AuthManager.handleRequest` is what
// they delegate INTO. A test that drove `handleRequest` directly (as
// `break-glass-guard-authentication-order.test.ts` correctly does for the hook's
// own predicate) would bypass every mount and be structurally blind to this
// defect. So the fixture here mounts `AuthPlugin.registerAuthRoutes` on a real
// Hono app in front of a real `AuthManager` on the installed better-auth, and
// every assertion reads a status and a body off a real `Response`.
//
// ── The load-bearing half ───────────────────────────────────────────────────
//
// ⛔ An implementation that "fixed" the ordering by DELETING the guard would
// satisfy every indistinguishability assertion here. Two further describe
// blocks make that impossible: the guard must still refuse an admitted platform
// admin who really is removing the last local credential (409), and the same
// admin must still succeed on an ordinary user (200) — so the still-refused leg
// cannot be satisfied by refusing everyone.
//
// ADR-0112 is `code` AND `status`; every refusal assertion carries both.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { AuthManager } from './auth-manager';
import { AuthPlugin } from './auth-plugin';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { inviteForAudienceGate } from './audience-gate-test-support';
import { LAST_LOCAL_CREDENTIAL_CODE } from './last-local-credential';
import type { PluginContext } from '@objectstack/core';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-11477';
const ORIGIN = 'http://localhost:3000';
const BASE = '/api/v1/auth';

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

/** Status + whatever error code the body carries, in either envelope shape. */
async function verdict(res: Response): Promise<{ status: number; code?: string; text: string }> {
  const text = await res.text();
  let code: string | undefined;
  try {
    const parsed = JSON.parse(text);
    // ObjectStack's ADR-0112 envelope nests it; better-auth's flat shape does not.
    code = parsed?.error?.code ?? parsed?.code;
  } catch {
    /* non-JSON body → no code */
  }
  return { status: res.status, code, text };
}

/**
 * One deployment, staged to the exact posture the guard exists to protect, and
 * served through the REAL mount chain.
 *
 *  - `owner` holds the ONLY local-password (`credential`) account — the
 *    break-glass escape hatch itself, and the per-record fact the defect leaked.
 *  - `admin` is a platform admin. The legacy `role` scalar is set because the
 *    VENDOR's own `adminMiddleware` still authorizes on it (#9969 keeps this
 *    route on the vendor gate); `isPlatformAdminUser` accepts it as its
 *    documented back-compat signal, so one fixture drives both layers.
 *  - `member` is an ordinary authenticated user holding no credential — the
 *    caller the finding is about.
 *  - `ordinary` is a second credential-less user: the CONTRAST target, so
 *    "same caller, two targets" is a real comparison.
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
    ['owner.11477@example.com', 'Break Glass Owner'],
    ['admin.11477@example.com', 'Managed Admin'],
    ['member.11477@example.com', 'Plain Member'],
    ['ordinary.11477@example.com', 'Ordinary User'],
  ]) {
    // [#11767] the default audience posture is now invite_only, so fixture
    // users beyond the first enter through the invitation carve-out — the
    // house lane (see audience-gate-test-support; `open` would force email
    // verification on and stop sign-up from minting the bearers below).
    await inviteForAudienceGate(manager, email);
    const res = await direct('/sign-up/email', { email, password: PASSWORD, name });
    expect(res.status, `sign-up ${email}: ${await res.clone().text()}`).toBe(200);
  }

  const users = (engine.tables.get('sys_user') ?? []) as any[];
  const idFor = (email: string) => String(users.find((r) => r.email === email)!.id);
  const ownerId = idFor('owner.11477@example.com');
  const adminId = idFor('admin.11477@example.com');
  const ordinaryId = idFor('ordinary.11477@example.com');

  users.find((r) => String(r.id) === adminId)!.role = 'admin';

  const bearerFor = async (email: string) => {
    const res = await direct('/sign-in/email', { email, password: PASSWORD });
    const token = res.headers.get('set-auth-token');
    expect(token, `sign-in ${email} must mint a bearer or the authenticated legs prove nothing`).toBeTruthy();
    return token!;
  };
  const adminBearer = await bearerFor('admin.11477@example.com');
  const memberBearer = await bearerFor('member.11477@example.com');

  // Leave exactly ONE local-credential holder: `owner`. This is the state the
  // guard guards, and the state whose disclosure the ordering controlled.
  const accounts = (engine.tables.get('sys_account') ?? []) as any[];
  engine.tables.set(
    'sys_account',
    accounts.filter((r) => !(r.provider_id === 'credential' && String(r.user_id ?? '') !== ownerId)),
  );
  expect(
    ((engine.tables.get('sys_account') ?? []) as any[])
      .filter((r) => r.provider_id === 'credential')
      .map((r) => String(r.user_id)),
    'fixture invariant: `owner` must be the SOLE local-credential holder',
  ).toEqual([ownerId]);

  // The REAL route registration — raw mounts ahead of the catch-all — on a real
  // Hono app in front of the real AuthManager. Without this the mounts under
  // test are not in the request path at all.
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

  return { engine, fire, ownerId, ordinaryId, adminBearer, memberBearer };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
// THE ORDERING PIN
// ───────────────────────────────────────────────────────────────────────────

describe('#11477 — /admin/remove-user: the guard runs AFTER authorization', () => {
  it('an authenticated NON-ADMIN cannot tell the break-glass holder from anyone else', async () => {
    // ⛔ THE assertion of this file. On the defective (unshaded) build this
    // fails: naming the holder answered 409 LAST_LOCAL_CREDENTIAL while naming
    // an ordinary user answered 403 YOU_ARE_NOT_ALLOWED_TO_DELETE_USERS —
    // measured, both on the same caller.
    const { fire, ownerId, ordinaryId, memberBearer } = await stage();

    const holder = await verdict(await fire('/admin/remove-user', { userId: ownerId }, memberBearer));
    const other = await verdict(await fire('/admin/remove-user', { userId: ordinaryId }, memberBearer));

    expect(holder.status, `holder: ${holder.text} | other: ${other.text}`).toBe(other.status);
    expect(holder.text, 'the two answers must be byte-identical').toBe(other.text);
  }, 120_000);

  it('...and what it hears is the AUTHORIZATION verdict, never the guard‘s', async () => {
    // Indistinguishability alone would also be satisfied by a build that
    // answered the guard's 409 for BOTH targets — indistinguishable, and
    // strictly worse. This names which of the two layers spoke.
    const { fire, ownerId, ordinaryId, memberBearer } = await stage();

    for (const [label, userId] of [
      ['break-glass holder', ownerId],
      ['ordinary user', ordinaryId],
    ] as const) {
      const v = await verdict(await fire('/admin/remove-user', { userId }, memberBearer));
      expect(v.status, `${label}: ${v.text}`).toBe(403);
      expect(v.code, `${label}: ${v.text}`).toBe('PERMISSION_DENIED');
      expect(v.code, `${label}: the guard‘s code must not reach a non-admin`).not.toBe(
        LAST_LOCAL_CREDENTIAL_CODE,
      );
      expect(v.status, `${label}: the guard‘s status must not reach a non-admin`).not.toBe(409);
    }
  }, 120_000);

  it('an ANONYMOUS caller is unchanged: 401 UNAUTHENTICATED, and equally indistinguishable', async () => {
    // #10776 already closed the anonymous half. Pinned here so this card's
    // shading cannot regress it — a mount is a new first responder for the
    // path, and the anonymous answer is the one it is easiest to change by
    // accident.
    const { fire, ownerId, ordinaryId } = await stage();

    const holder = await verdict(await fire('/admin/remove-user', { userId: ownerId }));
    const other = await verdict(await fire('/admin/remove-user', { userId: ordinaryId }));

    expect(holder.status, holder.text).toBe(401);
    expect(holder.code, holder.text).toBe('UNAUTHENTICATED');
    expect(holder.status).toBe(other.status);
    expect(holder.text).toBe(other.text);
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// THE LOAD-BEARING HALF — the guard still exists, and still decides
// ───────────────────────────────────────────────────────────────────────────

describe('#11477 — the break-glass invariant survives the reordering', () => {
  it('still-refused: an ADMITTED platform admin removing the last local credential is still 409', async () => {
    // ⛔ The leg that fails on an implementation that "fixed" the disclosure by
    // deleting the guard, or by shadowing the path with a mount that forgot to
    // re-enter better-auth's router (which would DETACH the path-keyed hook —
    // the trap recorded in last-local-credential.ts). Everything in the block
    // above stays green there.
    //
    // It is also the positive statement of the ordering itself: the guard's
    // answer is reachable ONLY past authorization, and past authorization it is
    // unchanged.
    const { fire, ownerId, adminBearer } = await stage();

    const v = await verdict(await fire('/admin/remove-user', { userId: ownerId }, adminBearer));

    expect(v.status, v.text).toBe(409);
    expect(v.code, v.text).toBe(LAST_LOCAL_CREDENTIAL_CODE);
  }, 120_000);

  it('admission: the same admin removing an ordinary user still succeeds', async () => {
    // Without this, the still-refused leg is satisfiable by refusing every
    // caller — the failure mode this lane has already paid for twice.
    const { fire, ordinaryId, adminBearer } = await stage();

    const v = await verdict(await fire('/admin/remove-user', { userId: ordinaryId }, adminBearer));

    expect(v.status, v.text).toBe(200);
    expect(v.code, v.text).not.toBe(LAST_LOCAL_CREDENTIAL_CODE);
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// THE COUPLING CONTROL — #9652's mounts must not move
// ───────────────────────────────────────────────────────────────────────────

describe('#11477 — /admin/ban-user‘s sequence is UNCHANGED (the #9652 coupling)', () => {
  // The card and the ruling both record that this card and #9652's raw mounts
  // change each other's ordering BIDIRECTIONALLY. `/admin/ban-user` is the
  // route that already had the order this card is converging on, so it is the
  // control: if shading `remove-user` moved `ban-user`, the convergence would
  // have been bought by breaking the reference implementation.
  it('a non-admin still gets the same authorization verdict for both targets', async () => {
    const { fire, ownerId, ordinaryId, memberBearer } = await stage();

    const holder = await verdict(await fire('/admin/ban-user', { userId: ownerId }, memberBearer));
    const other = await verdict(await fire('/admin/ban-user', { userId: ordinaryId }, memberBearer));

    expect(holder.status, holder.text).toBe(403);
    expect(holder.code, holder.text).toBe('PERMISSION_DENIED');
    expect(holder.status).toBe(other.status);
    expect(holder.text).toBe(other.text);
  }, 120_000);

  it('and the guard still refuses an admin banning the last local credential', async () => {
    // `ban-user` re-runs the guard by hand from the shared module (its mount
    // does NOT delegate). This pins that the hand-rolled call site is still
    // wired, which is the half of #9652 most easily lost.
    const { fire, ownerId, adminBearer } = await stage();

    const v = await verdict(await fire('/admin/ban-user', { userId: ownerId }, adminBearer));

    expect(v.status, v.text).toBe(409);
    expect(v.code, v.text).toBe(LAST_LOCAL_CREDENTIAL_CODE);
  }, 120_000);
});
