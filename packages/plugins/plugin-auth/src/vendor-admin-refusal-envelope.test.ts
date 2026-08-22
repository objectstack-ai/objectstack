// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10349 — the better-auth-native `/admin/` lane answers an anonymous caller
// with a bodyless 401. This file pins the fix in BOTH directions and at BOTH
// levels:
//
//   • the pure normalizer, where the three narrowings are cheap to enumerate
//     (empty body only · 401/403 only · `/admin/` only), and
//   • the real `AuthManager.handleRequest` seam on the installed better-auth
//     1.7.1, where the vendor's `adminMiddleware` actually produces the refusal.
//
// ⛔ A refusal-only suite is not enough here and the lane has paid for that
// twice: an implementation that refuses EVERYONE passes every refusal
// assertion. So the ADMISSION direction is asserted on the same route with the
// same seam — a platform admin still gets 200 out of `/admin/impersonate-user`
// — and a non-`/admin/` refusal is asserted to come back byte-identical.
//
// ADR-0112 is `code` AND `status`; every refusal assertion below carries both.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import {
  envelopeVendorAdminRefusal,
  isVendorAdminPath,
  VENDOR_ADMIN_PATH_PREFIX,
} from './vendor-admin-refusal-envelope';
import { judgePlatformAdmin } from './platform-admin-gate';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

// ───────────────────────────────────────────────────────────────────────────
// The pure normalizer
// ───────────────────────────────────────────────────────────────────────────

/** The vendor's shape: a status, `application/json`, and the EMPTY STRING. */
const vendorBodylessRefusal = (status: number): Response =>
  new Response('', { status, headers: { 'content-type': 'application/json' } });

const bodyOf = async (res: Response) => JSON.parse(await res.text());

describe('#10349 — the normalizer fills in a bodyless vendor /admin/ refusal', () => {
  it('a bodyless 401 becomes the ADR-0112 envelope, status untouched', async () => {
    const out = await envelopeVendorAdminRefusal('/admin/set-role', vendorBodylessRefusal(401));

    expect(out.status).toBe(401);
    expect(await bodyOf(out)).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Sign in first' },
    });
  });

  it('a bodyless 403 becomes the envelope too — one rule over both refusal statuses', async () => {
    const out = await envelopeVendorAdminRefusal('/admin/set-role', vendorBodylessRefusal(403));

    expect(out.status).toBe(403);
    expect(await bodyOf(out)).toEqual({
      success: false,
      error: { code: 'PERMISSION_DENIED', message: 'Admin role required' },
    });
  });

  it('the code is DERIVED from ADR-0112‘s own map, not written down here', async () => {
    // If the derived-code map is ever re-pointed, this file must not be the
    // place that keeps the old spelling alive.
    for (const status of [401, 403] as const) {
      const out = await envelopeVendorAdminRefusal('/admin/x', vendorBodylessRefusal(status));
      expect((await bodyOf(out)).error.code).toBe(standardErrorCodeForHttpStatus(status));
    }
  });

  it('the vendor lane and the ObjectStack lane now answer anonymous BYTE-IDENTICALLY', async () => {
    // The asymmetry is the substance of this card, so its disappearance is
    // asserted directly rather than inferred from two separate assertions that
    // merely happen to agree today.
    const objectStackLane = judgePlatformAdmin(null);
    expect(objectStackLane.ok).toBe(false);
    const raw = objectStackLane.ok ? undefined : objectStackLane.refusal;

    const vendorLane = await envelopeVendorAdminRefusal(
      '/admin/impersonate-user',
      vendorBodylessRefusal(401),
    );

    expect(vendorLane.status).toBe(raw!.status);
    expect(await bodyOf(vendorLane)).toEqual(raw!.body);
  });

  // ── The three narrowings, each asserted by IDENTITY ──────────────────────
  //
  // `toBe(input)` — the same object, not an equal one. An implementation that
  // rebuilt an "equivalent" response on these paths would still be changing
  // headers and streams on surfaces this card does not own.

  it('a vendor refusal that DID say something is returned unchanged', async () => {
    // The signed-in non-admin's real 403 on this stack.
    const spoken = new Response(
      JSON.stringify({ message: 'x', code: 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );

    expect(await envelopeVendorAdminRefusal('/admin/impersonate-user', spoken)).toBe(spoken);
  });

  it('a non-refusal status is returned unchanged, even bodyless under /admin/', async () => {
    // Measured: `/admin/oauth2/resources` is a bodyless 404 when oidcProvider
    // is off, and `/admin/remove-user` can answer a semantic 409. Neither is
    // this seam's to name.
    for (const status of [200, 400, 404, 409, 500]) {
      const untouched = vendorBodylessRefusal(status);
      expect(await envelopeVendorAdminRefusal('/admin/anything', untouched)).toBe(untouched);
    }
  });

  it('a non-/admin/ path is returned unchanged — this is option C, not option B', async () => {
    for (const path of ['/sign-in/email', '/get-session', '/organization/add-member', '/admin', undefined]) {
      const untouched = vendorBodylessRefusal(401);
      expect(await envelopeVendorAdminRefusal(path, untouched)).toBe(untouched);
    }
  });

  it('the namespace prefix is a namespace, not a route name', () => {
    expect(VENDOR_ADMIN_PATH_PREFIX).toBe('/admin/');
    expect(isVendorAdminPath('/admin/set-role')).toBe(true);
    expect(isVendorAdminPath('/admin/sso/register')).toBe(true);
    expect(isVendorAdminPath('/admin')).toBe(false);
    expect(isVendorAdminPath('/administrator/x')).toBe(false);
    expect(isVendorAdminPath(undefined)).toBe(false);
  });

  it('headers the vendor attached survive, and content-length does not lie', async () => {
    const withCookie = new Response('', {
      status: 401,
      headers: { 'content-type': 'application/json', 'content-length': '0', 'set-cookie': 'a=b' },
    });

    const out = await envelopeVendorAdminRefusal('/admin/set-role', withCookie);

    expect(out.headers.get('set-cookie')).toBe('a=b');
    expect(out.headers.get('content-type')).toBe('application/json');
    const text = await out.text();
    const declared = out.headers.get('content-length');
    expect(declared === null || Number(declared) === new TextEncoder().encode(text).length).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The real seam, on the installed better-auth 1.7.1
// ───────────────────────────────────────────────────────────────────────────

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-10349';
const BASE = 'http://localhost:3000/api/v1/auth';
const PS_ADMIN = 'ps_admin_full_access';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    plugins: { admin: true },
  } as any);

const post = (manager: AuthManager, path: string, body: unknown, bearer?: string) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

/**
 * Anonymous probes across the vendor `/admin/` lane. Derived by hand rather
 * than from the route table on purpose: this is a package-level test with no
 * booted stack, and the DERIVED sweep over the live route table is the dogfood
 * suite's job (`admin-route-nonadmin-refusal.dogfood.test.ts`).
 */
const VENDOR_ADMIN_PROBES: Array<[string, unknown]> = [
  ['/admin/impersonate-user', { userId: 'usr_probe' }],
  ['/admin/set-role', { userId: 'usr_probe', role: 'admin' }],
  ['/admin/revoke-user-sessions', { userId: 'usr_probe' }],
  ['/admin/list-user-sessions', { userId: 'usr_probe' }],
  ['/admin/update-user', { userId: 'usr_probe', data: { name: 'X' } }],
];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('#10349 — through AuthManager.handleRequest on the real vendor pipeline', () => {
  it('every vendor /admin/ route refuses an anonymous caller 401 UNAUTHENTICATED', async () => {
    const manager = makeManager(createMemoryEngine());

    for (const [path, body] of VENDOR_ADMIN_PROBES) {
      const res = await post(manager, path, body);
      const text = await res.text();

      // status AND code — a lone status cannot tell the vendor's authentication
      // refusal from a validation error, and was green through the defect.
      expect(res.status, `${path}: ${text}`).toBe(401);
      expect(JSON.parse(text), `${path}`).toEqual({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Sign in first' },
      });
    }
  }, 60_000);

  it('a non-/admin/ vendor refusal keeps the vendor‘s own body — option C holds at the seam', async () => {
    const manager = makeManager(createMemoryEngine());

    const res = await post(manager, '/sign-in/email', {
      email: 'nobody@example.com',
      password: 'wrong-password-entirely',
    });

    expect(res.status).toBe(401);
    // Measured before AND after the change: the vendor's flat `{message,code}`.
    // If option C ever silently became option B, this is what would move.
    expect(await bodyOf(res)).toEqual({
      message: 'Invalid email or password',
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
  }, 60_000);

  it('ADMISSION is unchanged — a platform admin still gets 200 from /admin/impersonate-user', async () => {
    // ⛔ The load-bearing half. Everything above stays green on an
    // implementation that refuses every caller; only this fails there.
    const engine = createMemoryEngine();
    const manager = makeManager(engine);

    for (const [email, name] of [
      ['padmin.10349@example.com', 'Platform Admin'],
      ['target.10349@example.com', 'Target'],
    ]) {
      await post(manager, '/sign-up/email', { email, password: PASSWORD, name });
    }
    const rows = (engine.tables.get('sys_user') ?? []) as any[];
    const idFor = (email: string) => String(rows.find((r) => r.email === email)!.id);
    const adminId = idFor('padmin.10349@example.com');
    const targetId = idFor('target.10349@example.com');

    // ADR-0068 D2 grant — deliberately NOT the legacy `role` scalar.
    await engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
    await engine.insert('sys_user_permission_set', {
      user_id: adminId,
      permission_set_id: PS_ADMIN,
      organization_id: null,
    });

    const signIn = await post(manager, '/sign-in/email', {
      email: 'padmin.10349@example.com',
      password: PASSWORD,
    });
    const bearer = signIn.headers.get('set-auth-token');
    expect(bearer, 'sign-in must mint a bearer or this test proves nothing').toBeTruthy();

    const res = await post(manager, '/admin/impersonate-user', { userId: targetId }, bearer!);

    expect(res.status, await res.clone().text()).toBe(200);
    expect((await bodyOf(res))?.user?.id).toBe(targetId);
  }, 60_000);
});
