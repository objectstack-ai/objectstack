// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `/admin/impersonate-user` refused EVERY ObjectStack platform admin.
//
// The vendor authorizes on the legacy `user.role === 'admin'` scalar that
// ADR-0068 D2 stopped synthesizing, so a seeded platform admin (`role: 'user'`,
// `positions: ['user','platform_admin']`) and a plain member received
// BYTE-IDENTICAL `403 YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS`. That identity
// is what makes a one-directional test useless here: "the platform admin is
// admitted" alone would also pass against a gate that admits everyone, and "the
// member is refused" alone was already green against the bug. Both directions
// are asserted, always as `status` AND `code` (ADR-0112) — a bare `.toThrow()`
// or a lone status cannot tell the ADR-0068 gate's answer from the vendor's.
//
// The third pin is the one a raw Hono mount would have silently broken: the
// #8243 rotation hook is keyed on the PATH `/admin/impersonate-user` in
// better-auth's global `hooks.after`. Re-implementing at the Hono layer
// shadows the path, detaches the hook, and re-opens #8243 — impersonation
// answers 200 while `bearer()` keeps converting the caller's token back into
// the ADMIN's session. Nothing about the endpoint's own response would change.
// So the rotation is re-asserted here THROUGH the new authorization path, with
// a caller who is a platform admin the ADR-0068 way.
//
// Real better-auth pipeline throughout: requests go in as `Request` objects
// through `AuthManager.handleRequest`, and "who is this now?" is asked at the
// seam the framework's data routes use — `auth.api.getSession({ headers })`,
// literally what `runtime/src/security/resolve-session-principal.ts` calls.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { AuthManager } from './auth-manager';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { ADMIN_SESSION_RECOVERY_RESPONSE_HEADER } from './impersonation-bearer-rotation';
import { USER_NOT_FOUND } from './admin-impersonate-endpoint';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-9968';
const BASE = 'http://localhost:3000/api/v1/auth';
const PS_ADMIN = 'ps_admin_full_access';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    plugins: { admin: true },
  } as any);

const signUp = (manager: AuthManager, email: string, name: string) =>
  manager.handleRequest(
    new Request(`${BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );

const signIn = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request(`${BASE}/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );

const bearerFrom = (response: Response): string => {
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('no set-auth-token on the response');
  return token;
};

const userRows = (engine: any) => (engine.tables.get('sys_user') ?? []) as any[];

const userIdFor = (engine: any, email: string): string => {
  const row = userRows(engine).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/**
 * Grant platform admin the ADR-0068 D2 way — a `sys_user_permission_set` row
 * pointing at `admin_full_access` with `organization_id = null`.
 *
 * ⛔ Deliberately NOT `row.role = 'admin'`. Writing that scalar is what the
 * 2026-08-18 ruling permanently vetoed, and a fixture that used it would be
 * testing the vendor's gate rather than ObjectStack's — it passes with or
 * without this card's change.
 */
const grantPlatformAdmin = async (engine: any, userId: string) => {
  if (!(engine.tables.get('sys_permission_set') ?? []).some((r: any) => r.id === PS_ADMIN)) {
    await engine.insert('sys_permission_set', { id: PS_ADMIN, name: ADMIN_FULL_ACCESS });
  }
  await engine.insert('sys_user_permission_set', {
    user_id: userId,
    permission_set_id: PS_ADMIN,
    organization_id: null,
  });
};

const impersonate = (manager: AuthManager, bearer: string | null, userId: string) =>
  manager.handleRequest(
    new Request(`${BASE}/admin/impersonate-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ userId }),
    }),
  );

/** WHO does this bearer resolve to now? `null` for anonymous. */
const principalFor = async (manager: AuthManager, bearer: string): Promise<string | null> => {
  const auth: any = await manager.getAuthInstance();
  const session = await auth.api
    .getSession({ headers: new Headers({ authorization: `Bearer ${bearer}` }) })
    .catch(() => null);
  const id = session?.user?.id ?? session?.session?.userId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

/**
 * An ObjectStack platform admin (ADR-0068 grant, legacy scalar untouched), a
 * plain member, and a target — plus a bearer for each signed-in caller.
 */
const arrange = async () => {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);

  await signUp(manager, 'padmin@example.com', 'Platform Admin');
  await signUp(manager, 'member@example.com', 'Plain Member');
  await signUp(manager, 'target@example.com', 'Impersonation Target');

  const adminId = userIdFor(engine, 'padmin@example.com');
  const memberId = userIdFor(engine, 'member@example.com');
  const targetId = userIdFor(engine, 'target@example.com');
  await grantPlatformAdmin(engine, adminId);

  // The premise this whole card rests on: the platform admin's legacy scalar is
  // NOT 'admin'. If a future seed starts writing it, every assertion below goes
  // green for the wrong reason, so it is asserted rather than assumed.
  const adminRow = userRows(engine).find((r) => String(r.id) === adminId);
  expect(adminRow.role ?? 'user').not.toBe('admin');

  const adminBearer = bearerFrom(await signIn(manager, 'padmin@example.com'));
  const memberBearer = bearerFrom(await signIn(manager, 'member@example.com'));

  return { engine, manager, adminId, memberId, targetId, adminBearer, memberBearer };
};

const jsonOf = async (res: Response) => JSON.parse(await res.text());

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('ADR-0068 D2 — /admin/impersonate-user admits the ObjectStack platform admin', () => {
  it('a platform admin granted via admin_full_access is ADMITTED (not the legacy scalar)', async () => {
    const { manager, adminBearer, targetId } = await arrange();

    const res = await impersonate(manager, adminBearer, targetId);

    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body?.user?.id).toBe(targetId);
    expect(body?.session?.userId).toBe(targetId);
  });

  it('the impersonation actually takes effect — the next request IS the target', async () => {
    const { manager, adminBearer, targetId } = await arrange();

    const res = await impersonate(manager, adminBearer, targetId);
    expect(res.status).toBe(200);

    // The impersonated token better-auth emitted, resolved through the same
    // seam the data routes use. A 200 that did not change the principal is the
    // #8243 shape and is NOT a pass.
    const impersonatedBearer = bearerFrom(res);
    expect(await principalFor(manager, impersonatedBearer)).toBe(targetId);
  });

  it('the impersonation session records who is behind it', async () => {
    const { engine, manager, adminBearer, adminId, targetId } = await arrange();

    expect((await impersonate(manager, adminBearer, targetId)).status).toBe(200);

    // Find the row by the field under test, not by `user_id`: signing UP already
    // gave the target a session, so a `user_id` lookup returns that one first and
    // reports `impersonated_by: undefined` whether or not impersonation worked.
    const rows = (engine.tables.get('sys_session') ?? []) as any[];
    const impersonations = rows.filter((r) => r.impersonated_by);
    expect(impersonations).toHaveLength(1);
    expect(impersonations[0].user_id).toBe(targetId);
    expect(impersonations[0].impersonated_by).toBe(adminId);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the other direction — a non-entitled caller is still refused', () => {
  it('a signed-in plain member is refused 403 YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS', async () => {
    const { manager, memberBearer, targetId } = await arrange();

    const res = await impersonate(manager, memberBearer, targetId);

    // status AND code (ADR-0112) — either alone cannot distinguish this gate's
    // refusal from a validation error or from the vendor's own.
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).code).toBe('YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS');
  });

  it('the refused member changes nothing — no impersonation session exists', async () => {
    const { engine, manager, memberBearer, targetId } = await arrange();

    expect((await impersonate(manager, memberBearer, targetId)).status).toBe(403);

    const rows = (engine.tables.get('sys_session') ?? []) as any[];
    expect(rows.filter((r) => r.impersonated_by)).toHaveLength(0);
  });

  it('an anonymous caller is refused 401, distinctly from the 403 — identity error before capability error', async () => {
    const { manager, targetId } = await arrange();

    const res = await impersonate(manager, null, targetId);

    // 401, NOT the member's 403: the two refusals must stay distinguishable, or
    // the dogfood sweep cannot tell "the payload never reached the gate" from
    // "the gate said no".
    expect(res.status).toBe(401);

    // ⚠️ Measured, and deliberately not dressed up: this refusal carries an
    // EMPTY body — no ADR-0112 envelope, no `code`. It comes from the vendor's
    // `adminMiddleware` (`APIError.fromStatus('UNAUTHORIZED')`), which runs
    // before this endpoint's handler and is byte-identical on stock
    // better-auth 1.7.1 for both `/admin/impersonate-user` and
    // `/admin/set-role`. This card changes the AUTHORIZATION predicate, not the
    // authentication middleware, so the shape is pinned as it is rather than
    // asserted to be something it is not.
    expect(await res.text()).toBe('');
  });

  it('an org owner/admin who is NOT a platform admin is refused', async () => {
    const { engine, manager, memberBearer, memberId, targetId } = await arrange();
    // Owning an organization is not platform admin (ADR-0068). The endpoint
    // asks the narrow question, so this must stay a 403.
    await engine.insert('sys_member', {
      user_id: memberId,
      organization_id: 'org_1',
      role: 'owner',
    });

    const res = await impersonate(manager, memberBearer, targetId);

    expect(res.status).toBe(403);
    expect((await jsonOf(res)).code).toBe('YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the target guard means something again after ADR-0068 D2', () => {
  it('a platform-admin TARGET cannot be impersonated — 403 YOU_CANNOT_IMPERSONATE_ADMINS', async () => {
    const { engine, manager, adminBearer, targetId } = await arrange();
    // The vendor guards this by reading `targetUser.role` against
    // adminRoles:['admin'] — a column nothing writes post-D2, so the vendor's
    // guard is inert. Granted the ADR-0068 way, it must bite.
    await grantPlatformAdmin(engine, targetId);

    const res = await impersonate(manager, adminBearer, targetId);

    expect(res.status).toBe(403);
    expect((await jsonOf(res)).code).toBe('YOU_CANNOT_IMPERSONATE_ADMINS');
  });

  it('a missing target is a 404, not a 403 — the two refusals stay distinguishable', async () => {
    const { manager, adminBearer } = await arrange();

    const res = await impersonate(manager, adminBearer, 'usr_does_not_exist');

    expect(res.status).toBe(404);
    expect((await jsonOf(res)).code).toBe('USER_NOT_FOUND');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#8243 — the rotation hook is STILL ATTACHED after the re-authorization', () => {
  // This is the guard against the forbidden shape creeping back. A raw Hono
  // mount shadowing `/admin/impersonate-user` detaches the path-keyed global
  // `hooks.after`, and every assertion in the two suites above would still
  // pass. These do not.

  it('the caller bearer the platform admin was holding no longer resolves to anyone', async () => {
    const { manager, adminBearer, targetId } = await arrange();

    expect((await impersonate(manager, adminBearer, targetId)).status).toBe(200);

    // Rotation invalidated it. Without the hook this would still be the admin —
    // which is exactly the silent 200 no-op #8243 exists to make impossible.
    expect(await principalFor(manager, adminBearer)).toBeNull();
  });

  it('the admin-session recovery credential comes back on the response', async () => {
    const { manager, adminBearer, targetId } = await arrange();

    const res = await impersonate(manager, adminBearer, targetId);

    expect(res.status).toBe(200);
    expect(res.headers.get(ADMIN_SESSION_RECOVERY_RESPONSE_HEADER)).toBeTruthy();
    expect(
      (res.headers.get('access-control-expose-headers') ?? '')
        .split(',')
        .map((h) => h.trim().toLowerCase()),
    ).toContain(ADMIN_SESSION_RECOVERY_RESPONSE_HEADER);
  });

  it('the admin session row the caller was holding is really gone', async () => {
    const { engine, manager, adminBearer, adminId, targetId } = await arrange();
    const originalToken = adminBearer.split('.')[0];

    expect((await impersonate(manager, adminBearer, targetId)).status).toBe(200);

    const rows = (engine.tables.get('sys_session') ?? []) as any[];
    expect(rows.some((r) => r.token === originalToken)).toBe(false);
    // …and a ROTATED admin session took its place, so the admin can come back.
    expect(rows.some((r) => r.user_id === adminId && r.token !== originalToken)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the restated vendor constant cannot drift', () => {
  it('USER_NOT_FOUND still equals better-auth\'s own BASE_ERROR_CODES entry', async () => {
    // `admin-impersonate-endpoint.ts` restates this constant instead of
    // importing the `better-auth` ROOT entry, because pulling the root in there
    // makes admin-plugin construction die under the suites that mock it. A
    // restated constant is only safe while something proves it still matches.
    const { BASE_ERROR_CODES } = await import('better-auth');
    const vendor = BASE_ERROR_CODES.USER_NOT_FOUND as { code: string; message: string };
    // Field by field: the vendor entry also carries a `toString`, so a whole-
    // object `toEqual` compares a method we neither restate nor depend on.
    expect(USER_NOT_FOUND.code).toBe(vendor.code);
    expect(USER_NOT_FOUND.message).toBe(vendor.message);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('exactly one plugin claims the path', () => {
  // The measured alternative — registering a SECOND better-auth plugin for
  // `/admin/impersonate-user` — also serves, but makes 1.7.1's
  // `checkEndpointConflicts` log `Endpoint path conflicts detected!` on every
  // boot. Replacing the endpoint in place is what keeps that quiet, and this
  // asserts the property rather than the intention.
  it('boots without a better-auth endpoint-conflict error', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });

    const { manager, adminBearer, targetId } = await arrange();
    expect((await impersonate(manager, adminBearer, targetId)).status).toBe(200);

    expect(errors.filter((e) => e.includes('Endpoint path conflicts detected'))).toHaveLength(0);
  });
});
