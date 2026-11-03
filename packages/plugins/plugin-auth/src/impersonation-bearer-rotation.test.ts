// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8243 — `/admin/impersonate-user` was a 200 NO-OP for every bearer client.
//
// The shape of the defect dictates the shape of these tests. better-auth
// answered 200, set the impersonation cookie, and emitted the impersonated
// token on `set-auth-token` — all of it correct — and then its own `bearer()`
// before-hook converted the caller's unchanged `Authorization: Bearer` back
// into the ADMIN's session cookie on every following request. So a test that
// asserted "impersonation returns 200", or "a `set-auth-token` came back", or
// "an impersonation session row exists" would have been GREEN against the bug.
//
// Every assertion below therefore ends at the same question the runtime asks:
// WHICH PRINCIPAL does the next request resolve to? Both directions are pinned,
// as the ruling requires — a bearer client that impersonates resolves to the
// impersonated user and never to the admin, and `stop-impersonating` recovers
// the admin through the bearer lane.
//
// Real better-auth pipeline throughout (the precedent set by
// `session-of-record.test.ts`): requests go in as `Request` objects through
// `AuthManager.handleRequest`, the tokens are the ones better-auth minted, and
// the resolution path is the real one. Where a test wants the seam the data
// routes actually use, it asks `auth.api.getSession({ headers })` directly —
// that is literally what `runtime/src/security/resolve-session-principal.ts`
// calls.

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { inviteForAudienceGate } from './audience-gate-test-support';
import {
  ADMIN_SESSION_RECOVERY_REQUEST_HEADER,
  ADMIN_SESSION_RECOVERY_RESPONSE_HEADER,
} from './impersonation-bearer-rotation';
import { bindTestSecurityCatalog, catalogFromTables } from './__tests__/security-catalog.testkit';
import { memoizeScrypt } from './__tests__/scrypt-memo.testkit';

/**
 * In-memory IDataEngine — same fake as the #4785 session-of-record harness,
 * including its two fidelity choices: `fields` really projects, and `delete`
 * is pinned to ObjectQL's own dispatch predicate. The delete path is genuinely
 * exercised here: rotation deletes the admin's original session row.
 */
// Exported so the ADR-0068 impersonation-authorization suite
// (`admin-impersonate-endpoint.test.ts`) drives the SAME double rather than
// minting a second one: a new fake engine would be a new looseness risk and a
// new `check:engine-double-contract` ledger entry, for no added fidelity.
export const createMemoryEngine = () => {
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
      // An absent column reads as NULL, as it does in SQL (`organization_id: null`).
      if (v === null) return actual === null || actual === undefined;
      return eq(actual, v);
    });
  const project = (row: any, fields?: string[]) => {
    if (!Array.isArray(fields) || fields.length === 0) return { ...row };
    const out: any = {};
    for (const f of ['id', ...fields]) if (f in row) out[f] = row[f];
    return out;
  };
  let seq = 0;
  // [ADR-0131 D3/D4] The security catalog the resolver reads, as the rows convert to it.
  return bindTestSecurityCatalog({
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      assertEngineFindOnePredicate(name, q);
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
    // Both write verbs open with the PRODUCER's own dispatch predicate, never a
    // hand-mirrored id/multi check — a fake looser than the real engine is how
    // a suite goes green over a route that never worked.
    async update(name: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const table = rows(name);
      const targets =
        dispatch.kind === 'by-id'
          ? table.filter((r) => r.id === dispatch.id)
          : table.filter((r) => matches(r, options?.where));
      for (const row of targets) Object.assign(row, data);
      return dispatch.kind === 'by-id'
        ? targets[0]
          ? { ...targets[0] }
          : null
        : targets.length;
    },
    async delete(name: string, q: any = {}) {
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  }, () => catalogFromTables(Object.fromEntries(tables)));
};

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-8243';
const BASE = 'http://localhost:3000/api/v1/auth';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    // The impersonation endpoints live on better-auth's `admin` plugin, which
    // is opt-in in this repo.
    plugins: { admin: true },
  } as any);

const signUp = (manager: AuthManager, email: string, name: string) => {
  // [#11739] default posture invite_only: fixture users beyond the first
  // enter through the invitation carve-out (see audience-gate-test-support).
  inviteForAudienceGate(manager, email);
  return manager.handleRequest(
    new Request(`${BASE}/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name }),
    }),
  );
};

const signIn = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request(`${BASE}/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );

/** The bearer token better-auth hands a client on a successful sign-in. */
const bearerFrom = (response: Response): string => {
  const token = response.headers.get('set-auth-token');
  if (!token) throw new Error('no set-auth-token on the response');
  return token;
};

const userRows = (engine: any) => (engine.tables.get('sys_user') ?? []) as any[];
const sessionRows = (engine: any) => (engine.tables.get('sys_session') ?? []) as any[];

const userIdFor = (engine: any, email: string): string => {
  const row = userRows(engine).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/** better-auth's `admin` plugin gates impersonation on `user.role`. */
const makePlatformAdmin = (engine: any, email: string) => {
  const row = userRows(engine).find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  row.role = 'admin';
};

/**
 * WHO does a bearer token resolve to, asked through the exact seam the
 * framework's data routes use: `auth.api.getSession({ headers })`, which is
 * what `runtime/src/security/resolve-session-principal.ts` calls.
 *
 * `null` for anonymous. Never a status code — better-auth answers a dead
 * session with a 200 and a JSON `null`, so a status assertion is blind here.
 */
const principalFor = async (
  manager: AuthManager,
  bearer: string,
): Promise<string | null> => {
  const auth: any = await manager.getAuthInstance();
  const session = await auth.api
    .getSession({ headers: new Headers({ authorization: `Bearer ${bearer}` }) })
    .catch(() => null);
  const id = session?.user?.id ?? session?.session?.userId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

const impersonate = (manager: AuthManager, bearer: string, userId: string) =>
  manager.handleRequest(
    new Request(`${BASE}/admin/impersonate-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ userId }),
    }),
  );

const stopImpersonating = (
  manager: AuthManager,
  bearer: string,
  recovery?: string,
) =>
  manager.handleRequest(
    new Request(`${BASE}/admin/stop-impersonating`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${bearer}`,
        ...(recovery ? { [ADMIN_SESSION_RECOVERY_REQUEST_HEADER]: recovery } : {}),
      },
    }),
  );

/**
 * [#23184] The two sign-ups `arrangeAdminAndTarget` starts from, made ONCE per
 * file through the real `/sign-up/email` route, on an engine and manager of
 * their own.
 *
 * A sign-up is the costly step here (one production-parameter scrypt
 * derivation under a fresh salt), and no case is about it: each case is about
 * what the admin's bearer resolves to after impersonating. So every case
 * starts from a deep copy of the tables these sign-ups wrote, on the case's
 * own engine and its own manager, and every step from the promotion on runs
 * per case as before. The copy is `structuredClone`, so no case's write
 * reaches the template or another case, and the admin's sign-in verifies the
 * password against the very hash the sign-up stored (a memo hit, not a
 * derivation).
 */
let signedUpTables: Promise<Map<string, any[]>> | undefined;
const signedUpOnce = (): Promise<Map<string, any[]>> =>
  (signedUpTables ??= (async () => {
    const template = createMemoryEngine();
    const templateManager = makeManager(template);
    await signUp(templateManager, 'admin@example.com', 'Impersonating Admin');
    await signUp(templateManager, 'target@example.com', 'Impersonation Target');
    return template.tables as Map<string, any[]>;
  })());

/**
 * A signed-in platform admin plus a target to impersonate, with the admin's
 * bearer in hand — the state every test below starts from.
 */
const arrangeAdminAndTarget = async () => {
  const engine = createMemoryEngine();
  for (const [name, rows] of await signedUpOnce()) engine.tables.set(name, structuredClone(rows));
  const manager = makeManager(engine);

  makePlatformAdmin(engine, 'admin@example.com');

  const adminId = userIdFor(engine, 'admin@example.com');
  const targetId = userIdFor(engine, 'target@example.com');

  const signedIn = await signIn(manager, 'admin@example.com');
  expect(signedIn.status).toBe(200);
  const adminBearer = bearerFrom(signedIn);

  // The premise: before impersonating, the bearer IS the admin.
  expect(await principalFor(manager, adminBearer)).toBe(adminId);

  return { engine, manager, adminId, targetId, adminBearer };
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/**
 * [#23184] These ten cases used to run inside every suite that imports
 * `createMemoryEngine` from this file (the import re-registered its
 * `describe`s there), so their wall was paid once per importer; since #23181
 * slice 30 they are registered only when this file is the one run (`isEntry`
 * below). Three things keep their wall small, and none touches what a case
 * asserts:
 *
 *  - the two sign-ups `arrangeAdminAndTarget` starts from are made once per
 *    file (`signedUpOnce` above), and each case starts from its own deep copy;
 *  - a sign-in verifies the password against the hash its sign-up stored, the
 *    same password against the same salt, so the scrypt memo answers it from
 *    the bytes the sign-up's derivation produced
 *    (`__tests__/scrypt-memo.testkit.ts`); every fresh salt is still a real
 *    derivation;
 *  - every case has its own engine and manager and reads no state another
 *    case writes, so the three suites run their cases concurrently. The
 *    console stubs above are the only state the cases share. A finishing
 *    case's `restoreAllMocks` can lift them while another case still runs,
 *    which costs at most log output: no case here reads them.
 */
const scrypt = memoizeScrypt();
afterAll(scrypt.restore);

/**
 * [#23181 slice 30] The ten #8243 cases are registered only when THIS file is
 * the one vitest is running. 32 sibling suites import `createMemoryEngine`
 * from here (the double stays in a `*.test.ts` file so `check:engine-double-
 * contract` and `check:objectql-double-limit` keep it in sight), and an
 * import used to re-register these `describe`s in each of them: the same ten
 * cases ran 33 times per battery. `expect.getState().testPath` names the file
 * under collection (the precedent is `metadata-protocol/src/
 * protocol.lock-one-resolution.kit.test.ts`). The module-scope hooks above
 * (console stubs, `restoreAllMocks`, the scrypt memo) stay unguarded: the
 * importers that rely on them still get them through the same import.
 */
const isEntry = expect.getState().testPath === fileURLToPath(import.meta.url);

if (isEntry) {
  // ───────────────────────────────────────────────────────────────────────────
  describe.concurrent('#8243 pin 1 — a bearer client that impersonates STOPS resolving as the admin', () => {
    it('the token the caller was holding no longer resolves to anyone', async () => {
      const { manager, adminId, targetId, adminBearer } = await arrangeAdminAndTarget();

      const response = await impersonate(manager, adminBearer, targetId);
      expect(response.status).toBe(200);

      // THE assertion. Against the unfixed vendor this came back as `adminId`:
      // 200 from the endpoint, and every subsequent write still attributed to
      // the admin. Asserting `!== adminId` alone would be satisfied by a broken
      // pipeline that resolves nobody, so pin the exact value too.
      expect(await principalFor(manager, adminBearer)).not.toBe(adminId);
      expect(await principalFor(manager, adminBearer)).toBeNull();
      void targetId;
    });

    it('the rotated token from `set-auth-token` resolves to the IMPERSONATED user', async () => {
      // The other half: rotation that only killed the old token would leave the
      // caller unable to impersonate at all — which is the refusal-based
      // hardening the maintainer rejected.
      const { manager, adminId, targetId, adminBearer } = await arrangeAdminAndTarget();

      const response = await impersonate(manager, adminBearer, targetId);
      expect(response.status).toBe(200);

      const impersonatedBearer = bearerFrom(response);
      expect(impersonatedBearer).not.toBe(adminBearer);
      expect(await principalFor(manager, impersonatedBearer)).toBe(targetId);
      expect(await principalFor(manager, impersonatedBearer)).not.toBe(adminId);
    });

    it('the admin session row the caller was holding is really gone', async () => {
      // Corroborates the resolution assertions at the storage layer: this is an
      // invalidation, not a client-side convention the next code path could
      // quietly stop honouring.
      const { engine, manager, targetId, adminBearer } = await arrangeAdminAndTarget();

      const adminSessionToken = adminBearer.split('.')[0];
      expect(sessionRows(engine).some((r) => r.token === adminSessionToken)).toBe(true);

      expect((await impersonate(manager, adminBearer, targetId)).status).toBe(200);

      expect(sessionRows(engine).some((r) => r.token === adminSessionToken)).toBe(false);
    });

    it('the rotated admin session is a well-formed session row, not a smuggled copy', async () => {
      // The in-memory engine below accepts any payload, so "rotation worked" in a
      // test is not by itself evidence that the real ObjectQL insert would take
      // it. This converts that permissiveness into a signal: the rotated row is
      // compared, column for column, against a row a plain sign-in produced. A
      // key the producer would refuse shows up here as an extra column.
      const { engine, manager, adminId, targetId, adminBearer } = await arrangeAdminAndTarget();

      const signInShape = new Set(
        Object.keys(sessionRows(engine).find((r) => r.user_id === adminId) ?? {}),
      );
      expect(signInShape.size).toBeGreaterThan(0);

      expect((await impersonate(manager, adminBearer, targetId)).status).toBe(200);

      const rotated = sessionRows(engine).find(
        (r) => r.user_id === adminId && r.token !== adminBearer.split('.')[0],
      );
      expect(rotated).toBeTruthy();
      expect(Object.keys(rotated!).filter((key) => !signInShape.has(key))).toEqual([]);

      // …and the one field carried across on purpose really is carried across.
      const adminRow = sessionRows(engine).find((r) => r.user_id === adminId);
      expect(rotated!.active_organization_id).toBe(adminRow!.active_organization_id);
    });

    it('hands back a recovery credential, and exposes it to cross-origin readers', async () => {
      const { manager, targetId, adminBearer } = await arrangeAdminAndTarget();

      const response = await impersonate(manager, adminBearer, targetId);
      const recovery = response.headers.get(ADMIN_SESSION_RECOVERY_RESPONSE_HEADER);
      expect(recovery).toBeTruthy();

      // A console on another origin cannot read a header that is not exposed, so
      // an unexposed recovery credential is the same as none at all. `bearer()`'s
      // own after-hook runs behind ours and must not have dropped it.
      const exposed = (response.headers.get('access-control-expose-headers') || '')
        .split(',')
        .map((entry) => entry.trim());
      expect(exposed).toContain(ADMIN_SESSION_RECOVERY_RESPONSE_HEADER);
      expect(exposed).toContain('set-auth-token');

      // The recovery credential is NOT a bearer-shaped admin credential: replayed
      // as one it resolves to nobody. It only means anything to the exit route.
      expect(await principalFor(manager, recovery!)).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe.concurrent('#8243 pin 2 — `stop-impersonating` recovers the admin via bearer', () => {
    it('the caller is the admin again, and the returned token proves it', async () => {
      const { manager, adminId, targetId, adminBearer } = await arrangeAdminAndTarget();

      const entered = await impersonate(manager, adminBearer, targetId);
      const impersonatedBearer = bearerFrom(entered);
      const recovery = entered.headers.get(ADMIN_SESSION_RECOVERY_RESPONSE_HEADER)!;
      expect(await principalFor(manager, impersonatedBearer)).toBe(targetId);

      const exited = await stopImpersonating(manager, impersonatedBearer, recovery);
      expect(exited.status).toBe(200);
      const body: any = await exited.json();
      expect(body?.user?.id).toBe(adminId);

      // …and the identity the NEXT request resolves to is the admin, not merely
      // an admin-shaped response body.
      const restoredBearer = bearerFrom(exited);
      expect(await principalFor(manager, restoredBearer)).toBe(adminId);
    });

    it('the impersonation token dies on the way out', async () => {
      const { manager, targetId, adminBearer } = await arrangeAdminAndTarget();

      const entered = await impersonate(manager, adminBearer, targetId);
      const impersonatedBearer = bearerFrom(entered);
      const recovery = entered.headers.get(ADMIN_SESSION_RECOVERY_RESPONSE_HEADER)!;

      expect((await stopImpersonating(manager, impersonatedBearer, recovery)).status).toBe(200);

      expect(await principalFor(manager, impersonatedBearer)).toBeNull();
    });

    it('WITHOUT the recovery credential the exit still refuses — this adds a lane, it does not open one', async () => {
      // The negative control. If this went green on its own, the recovery header
      // would be decorative and the tests above would prove nothing about it.
      const { manager, targetId, adminBearer } = await arrangeAdminAndTarget();

      const entered = await impersonate(manager, adminBearer, targetId);
      const impersonatedBearer = bearerFrom(entered);

      const exited = await stopImpersonating(manager, impersonatedBearer);
      expect(exited.status).not.toBe(200);
    });

    it('a forged recovery credential is refused', async () => {
      const { manager, targetId, adminBearer } = await arrangeAdminAndTarget();

      const entered = await impersonate(manager, adminBearer, targetId);
      const impersonatedBearer = bearerFrom(entered);

      const exited = await stopImpersonating(
        manager,
        impersonatedBearer,
        'not-a-real-admin-session:.0000000000000000000000000000000000000000000=',
      );
      expect(exited.status).not.toBe(200);
      // And the forgery bought nothing: the caller is still the impersonated user.
      expect(await principalFor(manager, impersonatedBearer)).toBe(targetId);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe.concurrent('#8243 — the cookie lane is untouched', () => {
    it('a cookie-authenticated impersonation does not rotate anything', async () => {
      // Rotation is scoped to the caller's BEARER, because a cookie caller has no
      // stale credential in hand — the route already replaced its session cookie.
      // Widening it would change behaviour for every browser deployment for no
      // reason, so pin the narrowness.
      const engine = createMemoryEngine();
      const manager = makeManager(engine);

      await signUp(manager, 'cookie-admin@example.com', 'Cookie Admin');
      await signUp(manager, 'cookie-target@example.com', 'Cookie Target');
      makePlatformAdmin(engine, 'cookie-admin@example.com');
      const targetId = userIdFor(engine, 'cookie-target@example.com');

      const signedIn = await signIn(manager, 'cookie-admin@example.com');
      const cookie = (signedIn.headers.getSetCookie?.() ?? [])
        .map((c) => c.split(';')[0])
        .filter(Boolean)
        .join('; ');
      expect(cookie).toBeTruthy();

      const adminSessionsBefore = sessionRows(engine).map((r) => r.token);

      const response = await manager.handleRequest(
        new Request(`${BASE}/admin/impersonate-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({ userId: targetId }),
        }),
      );
      expect(response.status).toBe(200);

      // No recovery header, and the admin's original session row survives —
      // exactly the vendor's behaviour.
      expect(response.headers.get(ADMIN_SESSION_RECOVERY_RESPONSE_HEADER)).toBeNull();
      const tokensAfter = sessionRows(engine).map((r) => r.token);
      for (const token of adminSessionsBefore) expect(tokensAfter).toContain(token);
    });
  });
}
