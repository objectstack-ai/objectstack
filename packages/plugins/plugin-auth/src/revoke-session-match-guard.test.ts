// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9714 — `POST /revoke-session` must not answer success over a skipped
// delete. better-auth 1.7.1's handler skips the delete when the supplied
// token matches zero rows (or another user's row) and still answers
// `200 { status: true }` — measured on this exact pipeline before the guard
// existed (both branches answered `200 {"status":true}` with the target row
// untouched). The guard in `revoke-session-match-guard.ts` refuses those
// requests with 404 `RESOURCE_NOT_FOUND` (ADR-0112: code AND status, never
// one alone).
//
// Real better-auth pipeline throughout, following `session-tombstone.test.ts`:
// requests go in as `Request` objects through `AuthManager.handleRequest`, the
// cookie is the one better-auth minted, and the revoke path is better-auth's
// own. A stub of our adapter would prove nothing — the whole question is what
// answer leaves the library.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import {
  REVOKE_SESSION_NOT_FOUND_CODE,
  REVOKE_SESSION_NOT_FOUND_MESSAGE,
  revokeTargetsCallerSession,
} from './revoke-session-match-guard';

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
const PASSWORD = 'S3cure!Passw0rd-9714';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
  } as any);

const post = (manager: AuthManager, path: string, cookie?: string, body?: unknown) =>
  manager.handleRequest(
    new Request(`http://localhost:3000/api/v1/auth/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body ?? {}),
    }),
  );

const signUp = (manager: AuthManager, email: string) =>
  post(manager, 'sign-up/email', undefined, { email, password: PASSWORD, name: 'RevokeGuard' });

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

const sessionRows = (engine: any) => (engine.tables.get('sys_session') ?? []) as any[];

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('#9714 — /revoke-session refuses when the token identifies no record', () => {
  it('a token matching ZERO rows answers 404 with code AND status — never { status: true }', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const cookie = cookieFrom(await signUp(manager, 'zero-match@example.com'));

    const res = await post(manager, 'revoke-session', cookie, {
      token: 'no-such-token-anywhere',
    });
    const body: any = await res.json();

    // ADR-0112: code AND status, never one alone.
    expect(res.status).toBe(404);
    expect(body?.code).toBe(REVOKE_SESSION_NOT_FOUND_CODE);
    // The defect's exact shape must be gone, not merely accompanied.
    expect(body?.status).not.toBe(true);
    // The caller's own session is untouched by its failed revoke.
    expect(await isAuthenticated(manager, cookie)).toBe(true);
  });

  it("another user's live token answers BYTE-IDENTICALLY to a nonexistent one, and the row survives", async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    cookieFrom(await signUp(manager, 'alice-target@example.com'));
    const aliceRow = sessionRows(engine)[0]!;
    const mallory = cookieFrom(await signUp(manager, 'mallory-caller@example.com'));

    const foreign = await post(manager, 'revoke-session', mallory, { token: aliceRow.token });
    const foreignBody = await foreign.text();
    const missing = await post(manager, 'revoke-session', mallory, { token: 'no-such-token' });
    const missingBody = await missing.text();

    // No existence oracle: same status, same bytes.
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreignBody).toBe(missingBody);
    expect(JSON.parse(foreignBody)?.code).toBe(REVOKE_SESSION_NOT_FOUND_CODE);
    expect(JSON.parse(foreignBody)?.message).toBe(REVOKE_SESSION_NOT_FOUND_MESSAGE);

    // Alice's session row is untouched: not deleted, not tombstoned.
    const survivor = sessionRows(engine).find((r) => r.token === aliceRow.token);
    expect(survivor).toBeDefined();
    expect(survivor.revoked_at).toBeUndefined();
  });

  it('a MATCHING revoke still succeeds end to end — the guard admits what the vendor deletes', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const first = cookieFrom(await signUp(manager, 'real-revoke@example.com'));
    const firstRow = sessionRows(engine)[0]!;
    // Second session for the same user, revoked from the first.
    const second = cookieFrom(
      await post(manager, 'sign-in/email', undefined, {
        email: 'real-revoke@example.com',
        password: PASSWORD,
      }),
    );
    const secondRow = sessionRows(engine).find((r) => r.id !== firstRow.id)!;

    const res = await post(manager, 'revoke-session', first, { token: secondRow.token });
    const body: any = await res.json();

    // The vendor's success answer, now true when given.
    expect(res.status).toBe(200);
    expect(body).toHaveProperty('status', true);
    // The revoke really happened (#7732 tombstone) and the cookie is dead.
    const row = sessionRows(engine).find((r) => r.id === secondRow.id);
    expect(row?.revoke_reason).toBe('user_revoked');
    expect(await isAuthenticated(manager, second)).toBe(false);
    expect(await isAuthenticated(manager, first)).toBe(true);
  });

  it('revoking an ALREADY-REVOKED token answers 404 — a revoked session is not a session', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const first = cookieFrom(await signUp(manager, 'double-revoke@example.com'));
    const firstRow = sessionRows(engine)[0]!;
    const secondCookie = cookieFrom(
      await post(manager, 'sign-in/email', undefined, {
        email: 'double-revoke@example.com',
        password: PASSWORD,
      }),
    );
    void secondCookie;
    const secondRow = sessionRows(engine).find((r) => r.id !== firstRow.id)!;

    expect((await post(manager, 'revoke-session', first, { token: secondRow.token })).status).toBe(200);

    const again = await post(manager, 'revoke-session', first, { token: secondRow.token });
    const body: any = await again.json();
    expect(again.status).toBe(404);
    expect(body?.code).toBe(REVOKE_SESSION_NOT_FOUND_CODE);
  });

  it('an UNAUTHENTICATED caller still gets the vendor 401, never this 404', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    cookieFrom(await signUp(manager, 'anon-probe@example.com'));
    const row = sessionRows(engine)[0]!;

    // A real token, no credentials: the guard must stay silent and let the
    // vendor's session middleware answer the authentication question — a 404
    // here would grade an anonymous probe's existence question.
    const res = await post(manager, 'revoke-session', undefined, { token: row.token });
    expect(res.status).toBe(401);
    const body: any = await res.json().catch(() => null);
    expect(body?.code).not.toBe(REVOKE_SESSION_NOT_FOUND_CODE);
  });

  it('an EMPTY-string token answers 404 — previously the quietest false success of all', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const cookie = cookieFrom(await signUp(manager, 'empty-token@example.com'));

    const res = await post(manager, 'revoke-session', cookie, { token: '' });
    // better-auth's zod body schema accepts an empty string (`z.string()`), so
    // this reaches the guard, matches zero rows, and must refuse.
    const body: any = await res.json();
    expect(res.status).toBe(404);
    expect(body?.code).toBe(REVOKE_SESSION_NOT_FOUND_CODE);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('revokeTargetsCallerSession — the vendor predicate, reproduced', () => {
  const found = { session: { userId: 'u_1' }, user: { id: 'u_1' } };

  it('admits the owner', () => {
    expect(revokeTargetsCallerSession(found, 'u_1')).toBe(true);
  });

  it('refuses null / undefined / foreign / shapeless results and empty callers', () => {
    expect(revokeTargetsCallerSession(null, 'u_1')).toBe(false);
    expect(revokeTargetsCallerSession(undefined, 'u_1')).toBe(false);
    expect(revokeTargetsCallerSession(found, 'u_2')).toBe(false);
    expect(revokeTargetsCallerSession({}, 'u_1')).toBe(false);
    expect(revokeTargetsCallerSession({ session: {} }, 'u_1')).toBe(false);
    expect(revokeTargetsCallerSession(found, '')).toBe(false);
  });
});
