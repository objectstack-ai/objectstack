// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10069 — `POST /admin/revoke-user-session` must not answer success over a
// delete that dispatched nothing. better-auth 1.7.1's handler calls
// `deleteSession(ctx.body.sessionToken)` blindly and answers
// `200 { success: true }` unconditionally — measured on this exact pipeline
// before the guard existed: a zero-match token AND an already-revoked
// (tombstoned) token both answered `200 {"success":true}`. The guard in
// `admin-revoke-user-session-match-guard.ts` refuses those requests with 404
// `RESOURCE_NOT_FOUND` (ADR-0112: code AND status, never one alone) — but
// ONLY for callers the vendor's own permission check would admit; everyone
// else keeps the vendor's exact 401/403 and gains no existence oracle.
//
// Real better-auth pipeline throughout, following
// `revoke-session-match-guard.test.ts`: requests go in as `Request` objects
// through `AuthManager.handleRequest`, the cookie is the one better-auth
// minted, and the revoke path is better-auth's own. A stub of our adapter
// would prove nothing — the whole question is what answer leaves the library.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { defaultRoles } from 'better-auth/plugins/admin/access';
import { AuthManager } from './auth-manager';
import {
  ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE,
  ADMIN_REVOKE_USER_SESSION_NOT_FOUND_MESSAGE,
  ADMIN_REVOKE_USER_SESSION_PERMISSION,
  adminMayRevokeUserSessions,
  anySessionCarriesToken,
} from './admin-revoke-user-session-match-guard';

/**
 * In-memory IDataEngine — the `session-tombstone.test.ts` harness, unchanged,
 * because these tests assert against the same table through the same library
 * and a second, more forgiving fake would be able to disagree with it. Both
 * write paths stay pinned to ObjectQL's own dispatch predicates
 * ({@link assertEngineDeleteDispatch} / {@link assertEngineUpdateDispatch}).
 */
const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > v.$gt;
        if ('$gte' in v) return actual >= v.$gte;
        if ('$lt' in v) return actual < v.$lt;
        if ('$lte' in v) return actual <= v.$lte;
        if ('$regex' in v) return new RegExp(String(v.$regex)).test(String(actual ?? ''));
      }
      return eq(actual, v);
    });
  /** `fields` projection — `id` always survives, as it does in ObjectQL. */
  const project = (row: any, fields?: string[]) => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: any = {};
    for (const f of ['id', ...fields]) if (f in row) out[f] = row[f];
    return out;
  };
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      const row = rows(name).find((r) => matches(r, q.where));
      return row ? project(row, q.fields) : null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      const order = q.orderBy?.[0];
      if (order) {
        out = [...out].sort(
          (a, b) => (a[order.field] > b[order.field] ? 1 : -1) * (order.order === 'desc' ? -1 : 1),
        );
      }
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => project(r, q.fields));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(patch, options);
      if (dispatch.kind === 'multi') {
        const hit = rows(name).filter((r) => matches(r, options?.where));
        for (const row of hit) Object.assign(row, patch);
        return hit.length;
      }
      const row = rows(name).find((r) => r.id === dispatch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-10069';
const BASE = 'http://localhost:3000/api/v1/auth';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    // The route under test lives on better-auth's `admin` plugin (opt-in here).
    plugins: { admin: true },
  } as any);

const post = (manager: AuthManager, path: string, cookie?: string, body?: unknown) =>
  manager.handleRequest(
    new Request(`${BASE}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body ?? {}),
    }),
  );

const signUp = (manager: AuthManager, email: string) =>
  post(manager, 'sign-up/email', undefined, { email, password: PASSWORD, name: 'AdminRevoke' });

const signIn = (manager: AuthManager, email: string) =>
  post(manager, 'sign-in/email', undefined, { email, password: PASSWORD });

const getSession = (manager: AuthManager, cookie: string) =>
  manager.handleRequest(
    new Request('http://localhost:3000/api/v1/auth/get-session', { headers: { cookie } }),
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

/**
 * Is this cookie still authenticated? better-auth answers `/get-session` with
 * HTTP 200 and a JSON `null` body when the session is gone — NOT a 401 — so a
 * status-only assertion would pass against a fully revoked session.
 */
const isAuthenticated = async (manager: AuthManager, cookie: string): Promise<boolean> => {
  const res = await getSession(manager, cookie);
  if (res.status !== 200) return false;
  const body = await res.json().catch(() => null);
  return Boolean((body as any)?.user?.id);
};

const userRows = (engine: any) => (engine.tables.get('sys_user') ?? []) as any[];
const sessionRows = (engine: any) => (engine.tables.get('sys_session') ?? []) as any[];

/**
 * better-auth's admin plugin authorizes on the `user.role` scalar (vendor
 * default `adminRoles: ['admin']`). Written straight onto the seeded row, the
 * way `impersonation-bearer-rotation.test.ts` does — sign in AFTER promotion
 * so the authoritative session read sees it.
 */
const makeRoleAdmin = (engine: any, email: string) => {
  const row = userRows(engine).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  row.role = 'admin';
};

const revoke = (manager: AuthManager, cookie: string | undefined, sessionToken: unknown) =>
  post(manager, 'admin/revoke-user-session', cookie, { sessionToken });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** One env: a target user with a live session, and a role-admin caller. */
const seed = async () => {
  const engine = createMemoryEngine();
  const manager = makeManager(engine);
  const targetCookie = cookieFrom(await signUp(manager, 'target@example.com'));
  const targetRow = sessionRows(engine)[0]!;
  await signUp(manager, 'admin@example.com');
  makeRoleAdmin(engine, 'admin@example.com');
  const adminCookie = cookieFrom(await signIn(manager, 'admin@example.com'));
  return { engine, manager, targetCookie, targetRow, adminCookie };
};

// ───────────────────────────────────────────────────────────────────────────
describe('#10069 — /admin/revoke-user-session refuses when the token identifies no record', () => {
  it('a token matching ZERO rows answers 404 with code AND status — never { success: true }', async () => {
    const { engine, manager, targetRow, adminCookie } = await seed();

    const res = await revoke(manager, adminCookie, 'no-such-token-anywhere');
    const body: any = await res.json();

    // ADR-0112: code AND status, never one alone.
    expect(res.status).toBe(404);
    expect(body?.code).toBe(ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE);
    expect(body?.message).toBe(ADMIN_REVOKE_USER_SESSION_NOT_FOUND_MESSAGE);
    // The defect's exact shape must be gone, not merely accompanied.
    expect(body?.success).not.toBe(true);
    // Nobody's session was touched by the failed revoke.
    const target = sessionRows(engine).find((r) => r.id === targetRow.id);
    expect(target?.revoked_at).toBeUndefined();
    expect(await isAuthenticated(manager, adminCookie)).toBe(true);
  });

  it("an admitted revoke still succeeds end to end — an admin revoking an arbitrary user's session", async () => {
    const { engine, manager, targetCookie, targetRow, adminCookie } = await seed();

    const res = await revoke(manager, adminCookie, targetRow.token);
    const body: any = await res.json();

    // The vendor's success answer, now true when given.
    expect(res.status).toBe(200);
    expect(body).toHaveProperty('success', true);
    // The revoke really happened, as a #7732 tombstone with reason `admin`.
    const row = sessionRows(engine).find((r) => r.id === targetRow.id);
    expect(row?.revoke_reason).toBe('admin');
    expect(row?.revoked_at).toBeInstanceOf(Date);
    expect(await isAuthenticated(manager, targetCookie)).toBe(false);
    expect(await isAuthenticated(manager, adminCookie)).toBe(true);
  });

  it('revoking an ALREADY-REVOKED token answers 404 — a revoked session is not a session (#7732)', async () => {
    const { engine, manager, targetRow, adminCookie } = await seed();

    expect((await revoke(manager, adminCookie, targetRow.token)).status).toBe(200);
    const tombstonedAt = sessionRows(engine).find((r) => r.id === targetRow.id)?.revoked_at;

    const again = await revoke(manager, adminCookie, targetRow.token);
    const body: any = await again.json();
    expect(again.status).toBe(404);
    expect(body?.code).toBe(ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE);
    // The tombstone itself is untouched by the refused second revoke.
    const row = sessionRows(engine).find((r) => r.id === targetRow.id);
    expect(row?.revoke_reason).toBe('admin');
    expect(row?.revoked_at).toEqual(tombstonedAt);
  });

  it('an EMPTY-string token answers 404 — previously the quietest false success of all', async () => {
    const { manager, adminCookie } = await seed();

    const res = await revoke(manager, adminCookie, '');
    // better-auth's zod body schema accepts an empty string (`z.string()`), so
    // this reaches the guard, matches zero rows, and must refuse.
    const body: any = await res.json();
    expect(res.status).toBe(404);
    expect(body?.code).toBe(ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE);
  });

  it('a NON-ADMIN caller keeps the vendor 403 for missing and live tokens alike — no oracle below the permission line', async () => {
    const { engine, manager, targetRow } = await seed();
    const plainCookie = cookieFrom(await signUp(manager, 'plain@example.com'));

    const missing = await revoke(manager, plainCookie, 'no-such-token-anywhere');
    const missingBody = await missing.text();
    const live = await revoke(manager, plainCookie, targetRow.token);
    const liveBody = await live.text();

    // The vendor's own permission refusal, both times, byte-identically: a
    // caller below the permission line learns nothing about token existence.
    expect(missing.status).toBe(403);
    expect(live.status).toBe(403);
    expect(missingBody).toBe(liveBody);
    expect(JSON.parse(missingBody)?.code).toBe('YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS');
    expect(JSON.parse(missingBody)?.code).not.toBe(ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE);
    // And the live target row is untouched: not deleted, not tombstoned.
    const row = sessionRows(engine).find((r) => r.id === targetRow.id);
    expect(row).toBeDefined();
    expect(row?.revoked_at).toBeUndefined();
  });

  it('an UNAUTHENTICATED caller still gets the vendor 401, never this 404', async () => {
    const { manager, targetRow } = await seed();

    // A real token, no credentials: the guard must stay silent and let the
    // vendor's adminMiddleware answer the authentication question — a 404
    // here would grade an anonymous probe's existence question.
    const res = await revoke(manager, undefined, targetRow.token);
    expect(res.status).toBe(401);
    const body: any = await res.json().catch(() => null);
    expect(body?.code).not.toBe(ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE);
  });

  it('a NON-STRING token falls through to the vendor 400 — the body schema owns that refusal', async () => {
    const { manager, adminCookie } = await seed();

    const res = await revoke(manager, adminCookie, 12345);
    expect(res.status).toBe(400);
    const body: any = await res.json().catch(() => null);
    expect(body?.code).not.toBe(ADMIN_REVOKE_USER_SESSION_NOT_FOUND_CODE);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('adminMayRevokeUserSessions — the vendor permission question, vendor inputs', () => {
  const admin = { id: 'u_1', role: 'admin' };
  const user = { id: 'u_2', role: 'user' };

  it('admits the default admin role and refuses the default user role (real vendor defaultRoles)', () => {
    expect(adminMayRevokeUserSessions(admin, {}, defaultRoles as any)).toBe(true);
    expect(adminMayRevokeUserSessions(user, {}, defaultRoles as any)).toBe(false);
    // Sanity that the imported vendor role really grants the permission the
    // handler demands — the mirror and the vendor share this exact object.
    expect(
      (defaultRoles as any).admin.authorize(ADMIN_REVOKE_USER_SESSION_PERMISSION)?.success,
    ).toBe(true);
  });

  it('splits a comma-separated role list, the way the vendor does', () => {
    expect(adminMayRevokeUserSessions({ id: 'u', role: 'user,admin' }, {}, defaultRoles as any)).toBe(true);
    expect(adminMayRevokeUserSessions({ id: 'u', role: 'user,editor' }, {}, defaultRoles as any)).toBe(false);
  });

  it('admits an adminUserIds member regardless of role', () => {
    expect(
      adminMayRevokeUserSessions(user, { adminUserIds: ['u_2'] }, defaultRoles as any),
    ).toBe(true);
    expect(
      adminMayRevokeUserSessions(user, { adminUserIds: ['someone-else'] }, defaultRoles as any),
    ).toBe(false);
  });

  it('falls back to options.defaultRole when the user carries no role scalar', () => {
    expect(
      adminMayRevokeUserSessions({ id: 'u' }, { defaultRole: 'admin' }, defaultRoles as any),
    ).toBe(true);
    expect(adminMayRevokeUserSessions({ id: 'u' }, {}, defaultRoles as any)).toBe(false);
  });

  it('a custom roles map REPLACES the fallback — an admin the operator did not authorize is refused', () => {
    // Drift pin, strict direction: were the live options to carry a roles map
    // without session:revoke on `admin`, the mirror must refuse (fall through
    // to the vendor, which would refuse the same way).
    const roles = { admin: { authorize: () => ({ success: false }) } };
    expect(adminMayRevokeUserSessions(admin, { roles }, defaultRoles as any)).toBe(false);
    const granting = { admin: { authorize: () => ({ success: true }) } };
    expect(adminMayRevokeUserSessions(admin, { roles: granting }, {} as any)).toBe(true);
  });

  it('grades an unreadable input as not-permitted (fall through), never as admitted', () => {
    expect(adminMayRevokeUserSessions(null, {}, defaultRoles as any)).toBe(false);
    expect(adminMayRevokeUserSessions({}, null, defaultRoles as any)).toBe(false);
    expect(
      adminMayRevokeUserSessions(
        admin,
        { roles: { admin: { authorize: () => { throw new Error('boom'); } } } },
        defaultRoles as any,
      ),
    ).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('anySessionCarriesToken — the admission predicate, no ownership dimension', () => {
  it('admits any found session, whoever owns it', () => {
    expect(anySessionCarriesToken({ session: { userId: 'u_1', token: 't' } })).toBe(true);
    expect(anySessionCarriesToken({ session: {} })).toBe(true);
  });

  it('refuses null / undefined / shapeless results', () => {
    expect(anySessionCarriesToken(null)).toBe(false);
    expect(anySessionCarriesToken(undefined)).toBe(false);
    expect(anySessionCarriesToken({})).toBe(false);
    expect(anySessionCarriesToken({ session: null })).toBe(false);
    expect(anySessionCarriesToken({ session: 'not-an-object' })).toBe(false);
  });
});
