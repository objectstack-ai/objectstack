// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4785 — "where is the session of record?", settled: it is ALWAYS `sys_session`
// (the database). The kernel `cache` service serves auth as the rate-limit
// counter store and nothing else.
//
// These are the tests whose ABSENCE let the conflict stay invisible. ADR-0069 D4
// declares three session controls — idle timeout, absolute lifetime, concurrent
// cap — and all three revoke the same way: by writing the `sys_session` row
// (`expires_at` into the past + `revoked_at`/`revoke_reason`). Nothing proved
// that write actually stopped a live session, so when better-auth's
// `secondaryStorage` was (nearly) wired to the cache, no test could tell that
// D4 had silently stopped working.
//
// So every test here asserts the END of the chain, not the middle: a request
// that carries a real session cookie stops being authenticated. Asserting only
// that the row was stamped would re-create the exact blind spot — a stamped row
// nobody reads is precisely the failure mode #4785 describes.
//
// Real better-auth pipeline throughout (the #3585 EdDSA tests set this
// precedent: patch the real thing, never stub our own code). Requests go in as
// `Request` objects through `AuthManager.handleRequest`; the session cookie is
// the one better-auth minted; the revocation path is the one `customSession`
// and the sign-in after-hook really run.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';
import { cacheSecondaryStorage } from './secondary-storage';

/**
 * In-memory IDataEngine, same shape as the #3585 harness.
 *
 * Two deliberate fidelity choices, because this file's whole value is that the
 * fake cannot be more forgiving than the real engine:
 *
 * - **`fields` really projects.** `enforceSessionControls` asks for
 *   `['id','created_at','last_activity_at','revoked_at']` and `enforceConcurrentCap`
 *   for `['id','created_at','expires_at','revoked_at']`; the ObjectQL adapter
 *   forwards better-auth's `select` as `fields` too. A fake that returned whole
 *   rows would let a control read a column it never requested and still pass.
 * - **`delete` is pinned to ObjectQL's own dispatch predicate**
 *   ({@link assertEngineDeleteDispatch}), unlike the rest of this fake. This one
 *   fires for real here: expiring a session in place makes better-auth's
 *   `getSession` clean the row up via `deleteSession(token)`, so the delete path
 *   is genuinely exercised by every revocation test below.
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
    async update(name: string, patch: any) {
      const row = rows(name).find((r) => r.id === patch.id);
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
const PASSWORD = 'S3cure!Passw0rd-4785';

const makeManager = (engine: any, config: Record<string, unknown> = {}) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    ...config,
  } as any);

const signUp = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request('http://localhost:3000/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Session Of Record' }),
    }),
  );

const signIn = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request('http://localhost:3000/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );

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
 * Is this cookie still authenticated?
 *
 * better-auth answers `/get-session` with HTTP 200 and a JSON `null` body when
 * the session is gone — NOT a 401 — so a status-only assertion would pass
 * against a fully revoked session. Read the body.
 */
const isAuthenticated = async (manager: AuthManager, cookie: string): Promise<boolean> => {
  const res = await getSession(manager, cookie);
  if (res.status !== 200) return false;
  const body = await res.json().catch(() => null);
  return Boolean((body as any)?.user?.id);
};

/** The single `sys_session` row for a cookie's session, straight from the table. */
const sessionRows = (engine: any) => (engine.tables.get('sys_session') ?? []) as any[];

/** Backdate columns on a stored session row, simulating the passage of time. */
const ageSession = (engine: any, id: string, patch: Record<string, Date>) => {
  const row = sessionRows(engine).find((r) => r.id === id);
  if (!row) throw new Error(`no sys_session row ${id}`);
  Object.assign(row, patch);
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('#4785 — the session of record is `sys_session` (the database)', () => {
  it('a sign-up writes a real sys_session row, and the cookie authenticates against it', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);

    const signed = await signUp(manager, 'record@example.com');
    expect(signed.status).toBe(200);
    const cookie = cookieFrom(signed);

    // The premise every D4 control rests on: the row EXISTS in the database.
    expect(sessionRows(engine)).toHaveLength(1);
    expect(await isAuthenticated(manager, cookie)).toBe(true);
  });

  it('deleting the row de-authenticates the cookie — the database is what is read', async () => {
    // The converse of the test above, and the one that actually proves "of
    // record": if better-auth were answering from anywhere else, dropping the
    // row would leave the cookie working.
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const cookie = cookieFrom(await signUp(manager, 'authority@example.com'));
    expect(await isAuthenticated(manager, cookie)).toBe(true);

    engine.tables.set('sys_session', []);

    expect(await isAuthenticated(manager, cookie)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('ADR-0069 D4 — idle timeout really revokes a live session', () => {
  it('an idle session stops being authenticated, and says why in the row', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { sessionIdleTimeoutMinutes: 30 });

    const cookie = cookieFrom(await signUp(manager, 'idle@example.com'));
    const id = sessionRows(engine)[0]!.id;
    expect(await isAuthenticated(manager, cookie)).toBe(true);

    // 90 minutes of inactivity against a 30-minute timeout. `created_at` stays
    // recent so ONLY the idle rule can fire — this test must not pass for the
    // absolute-lifetime reason.
    ageSession(engine, id, { last_activity_at: new Date(Date.now() - 90 * MINUTE) });

    // `enforceSessionControls` runs inside `customSession`, i.e. AFTER
    // better-auth has already validated this request's session. So the request
    // that DETECTS the timeout is still authenticated, and the next one is not.
    // That one-request lag is the documented design, and pinning it here is
    // what stops someone "fixing" the lag by moving the check somewhere the
    // revocation write no longer happens.
    expect(await isAuthenticated(manager, cookie)).toBe(true);

    const row = sessionRows(engine).find((r) => r.id === id)!;
    expect(row.revoke_reason).toBe('idle_timeout');
    expect(row.revoked_at).toBeInstanceOf(Date);
    expect(new Date(row.expires_at).getTime()).toBeLessThan(Date.now());

    // The assertion that matters: the cookie is dead.
    expect(await isAuthenticated(manager, cookie)).toBe(false);
  });

  it('an ACTIVE session is not revoked, and its last_activity_at is touched', async () => {
    // The other half of the control: a timeout that revokes everything would
    // pass every assertion above and be useless.
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { sessionIdleTimeoutMinutes: 30 });

    const cookie = cookieFrom(await signUp(manager, 'active@example.com'));
    const id = sessionRows(engine)[0]!.id;

    // 5 minutes idle against a 30-minute timeout — inside the window. Backdated
    // past the 60s touch throttle so the touch is observable.
    ageSession(engine, id, { last_activity_at: new Date(Date.now() - 5 * MINUTE) });

    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(await isAuthenticated(manager, cookie)).toBe(true);

    const row = sessionRows(engine).find((r) => r.id === id)!;
    expect(row.revoked_at).toBeUndefined();
    expect(row.revoke_reason).toBeUndefined();
    expect(Date.now() - new Date(row.last_activity_at).getTime()).toBeLessThan(MINUTE);
  });

  it('is off when the setting is 0 — an ancient session stays authenticated', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { sessionIdleTimeoutMinutes: 0 });

    const cookie = cookieFrom(await signUp(manager, 'off@example.com'));
    ageSession(engine, sessionRows(engine)[0]!.id, {
      last_activity_at: new Date(Date.now() - 400 * HOUR),
    });

    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(await isAuthenticated(manager, cookie)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('ADR-0069 D4 — absolute lifetime really revokes a live session', () => {
  it('a session past its absolute cap stops being authenticated however active it is', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { sessionAbsoluteMaxHours: 8 });

    const cookie = cookieFrom(await signUp(manager, 'absolute@example.com'));
    const id = sessionRows(engine)[0]!.id;
    expect(await isAuthenticated(manager, cookie)).toBe(true);

    // Created 12h ago (cap 8h) but active RIGHT NOW. This is the case
    // better-auth's own `updateAge` can never catch — a session that keeps
    // sliding its window forever — which is why D4 calls the absolute cap
    // custom. Idle is off, so only the absolute rule can fire.
    ageSession(engine, id, {
      created_at: new Date(Date.now() - 12 * HOUR),
      last_activity_at: new Date(),
    });

    expect(await isAuthenticated(manager, cookie)).toBe(true); // detecting request

    const row = sessionRows(engine).find((r) => r.id === id)!;
    expect(row.revoke_reason).toBe('absolute_max');
    expect(new Date(row.expires_at).getTime()).toBeLessThan(Date.now());

    expect(await isAuthenticated(manager, cookie)).toBe(false);
  });

  it('a session inside its absolute cap survives', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { sessionAbsoluteMaxHours: 8 });

    const cookie = cookieFrom(await signUp(manager, 'within@example.com'));
    ageSession(engine, sessionRows(engine)[0]!.id, {
      created_at: new Date(Date.now() - 2 * HOUR),
      last_activity_at: new Date(),
    });

    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(sessionRows(engine)[0]!.revoke_reason).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('ADR-0069 D4 — concurrent-session cap really revokes the oldest session', () => {
  it('a third sign-in under cap=2 kills the oldest cookie and spares the newer two', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { maxConcurrentSessions: 2 });

    // Three sign-ins for ONE user. `enforceConcurrentCap` runs from the
    // `/sign-in/email` after-hook, so sign-up alone never triggers it.
    const first = cookieFrom(await signUp(manager, 'cap@example.com'));
    const firstId = sessionRows(engine)[0]!.id;
    // The cap sorts by `created_at` desc. Rows minted inside the same
    // millisecond would sort unstably and make this test flaky for a reason
    // that has nothing to do with the control, so each session is given a
    // distinct, explicitly ordered birth time.
    ageSession(engine, firstId, { created_at: new Date(Date.now() - 3 * HOUR) });

    const second = cookieFrom(await signIn(manager, 'cap@example.com'));
    const secondId = sessionRows(engine).find((r) => r.id !== firstId)!.id;
    ageSession(engine, secondId, { created_at: new Date(Date.now() - 2 * HOUR) });

    // Both live so far — cap is 2.
    expect(await isAuthenticated(manager, first)).toBe(true);
    expect(await isAuthenticated(manager, second)).toBe(true);

    const third = cookieFrom(await signIn(manager, 'cap@example.com'));

    const firstRow = sessionRows(engine).find((r) => r.id === firstId)!;
    expect(firstRow.revoke_reason).toBe('concurrent_cap');
    expect(new Date(firstRow.expires_at).getTime()).toBeLessThan(Date.now());

    // Evict-oldest, not reject-newest: the oldest cookie is dead immediately
    // (no detecting-request lag — the revocation landed before this read), and
    // the two newest still work.
    expect(await isAuthenticated(manager, first)).toBe(false);
    expect(await isAuthenticated(manager, second)).toBe(true);
    expect(await isAuthenticated(manager, third)).toBe(true);
  });

  it('is off when the setting is 0 — a third session survives', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { maxConcurrentSessions: 0 });

    const first = cookieFrom(await signUp(manager, 'nocap@example.com'));
    await signIn(manager, 'nocap@example.com');
    await signIn(manager, 'nocap@example.com');

    expect(await isAuthenticated(manager, first)).toBe(true);
    expect(sessionRows(engine).some((r) => r.revoke_reason)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#4785 — why cache is NOT the session store (the rejected architecture)', () => {
  // The counter-factual, run against the REAL adapter rather than argued in a
  // comment. `auth-plugin.test.ts` pins that the kernel cache is never bound as
  // `secondaryStorage`; this pins WHAT THAT PIN IS PROTECTING, so the cost of
  // undoing it is visible in a failing test rather than in a security incident
  // six months later.
  const makeCache = () => {
    const store = new Map<string, unknown>();
    return {
      store,
      get: async (k: string) => (store.has(k) ? store.get(k) : undefined),
      set: async (k: string, v: unknown) => void store.set(k, v),
      delete: async (k: string) => store.delete(k),
      has: async (k: string) => store.has(k),
      clear: async () => store.clear(),
      stats: async () => ({ hits: 0, misses: 0, keyCount: store.size }),
    };
  };

  it('opting into cacheSecondaryStorage empties sys_session and makes idle timeout inert', async () => {
    const engine = createMemoryEngine();
    const cache = makeCache();
    const manager = makeManager(engine, {
      sessionIdleTimeoutMinutes: 30,
      secondaryStorage: cacheSecondaryStorage(cache as any),
      // The OIDC provider is on by default and refuses this configuration
      // outright — see the boot-refusal test below. Off here so the session
      // relocation itself is what's under test.
      plugins: { oidcProvider: false },
    });

    const cookie = cookieFrom(await signUp(manager, 'cached@example.com'));
    expect(await isAuthenticated(manager, cookie)).toBe(true);

    // 1. No row at all: `createSession` skips the insert when a
    //    `secondaryStorage` is present and `storeSessionInDatabase` is not set.
    //    The session lives in the cache instead.
    expect(sessionRows(engine)).toHaveLength(0);
    expect(cache.store.size).toBeGreaterThan(0);

    // 2. Therefore `enforceSessionControls` has nothing to find, nothing to
    //    stamp, and its `findOne` miss is indistinguishable from a healthy
    //    session — it returns early. The declared idle timeout is inert, and
    //    the cookie outlives it: the session survives for its full TTL.
    //
    //    Ageing happens in the cache, which IS the store of record under this
    //    configuration — exactly where it would age in production.
    for (const [k, v] of cache.store) {
      if (typeof v !== 'string' || !v.includes('"session"')) continue;
      const snap = JSON.parse(v);
      snap.session.updatedAt = new Date(Date.now() - 90 * MINUTE).toISOString();
      cache.store.set(k, JSON.stringify(snap));
    }

    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(sessionRows(engine)).toHaveLength(0);
  });

  it('option C (dual-write) is not reachable through config — asking for it changes nothing', async () => {
    // The maintainer rejected `session.storeSessionInDatabase: true` as the
    // WORST option: the row exists, so `enforceSessionControls` finds it and
    // stamps it and every database-side assertion looks healthy — while
    // `findSession` still answers from the cache snapshot, so revocation
    // appears to work and does not.
    //
    // `AuthManager` never plumbs the flag: it builds better-auth's `session`
    // block from `AUTH_SESSION_CONFIG` plus `expiresIn`/`updateAge` only, so a
    // host that passes it is silently building the cache-only shape instead.
    // Pinned behaviourally rather than by reading private options — this is the
    // property that matters, and it holds no matter how the block is assembled.
    const engine = createMemoryEngine();
    const cache = makeCache();
    const manager = makeManager(engine, {
      sessionIdleTimeoutMinutes: 30,
      secondaryStorage: cacheSecondaryStorage(cache as any),
      plugins: { oidcProvider: false },
      session: { storeSessionInDatabase: true },
    });

    const cookie = cookieFrom(await signUp(manager, 'dualwrite@example.com'));
    expect(await isAuthenticated(manager, cookie)).toBe(true);

    // Requested dual-write; got cache-only. No row was ever written, so there
    // is nothing for a D4 control to stamp.
    expect(sessionRows(engine)).toHaveLength(0);
  });

  it('the DEFAULT composition refuses to boot with a secondaryStorage rather than degrading quietly', async () => {
    // The safety net under all of the above, and the reason this hole could
    // never have opened silently in a standard `serve`: the OIDC provider
    // plugin is enabled by default, and better-auth 1.7 hard-refuses
    // `secondaryStorage` without `storeSessionInDatabase`. Since AuthManager
    // does not plumb that flag (test above), the default composition cannot
    // reach the cache-backed session store at all — it throws at boot.
    //
    // Loud absence beats a quiet downgrade (AGENTS.md "Absence must be loud"),
    // and this is what makes ADR-0069 D4's guarantee hold for real deployments
    // rather than by convention.
    const engine = createMemoryEngine();
    const cache = makeCache();
    const manager = makeManager(engine, {
      sessionIdleTimeoutMinutes: 30,
      secondaryStorage: cacheSecondaryStorage(cache as any),
    });

    await expect(signUp(manager, 'default@example.com')).rejects.toThrow(
      /storeSessionInDatabase/,
    );
  });
});
