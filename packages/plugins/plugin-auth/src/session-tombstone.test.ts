// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7732 — ADR-0069 D4 declares `sys_session.revoked_at`/`revoke_reason` capture
// EVERY revocation cause: idle / absolute-max / concurrent-cap / admin. Three of
// them were honoured by `auth-manager.ts`. The fourth — an interactive revoke —
// deleted the row instead, so the `admin` cause was unrecordable and the audit
// trail was inert precisely where an audit wants it.
//
// Every test here pins BOTH directions of the same claim, because either one
// alone is a defect dressed as a fix:
//
//   * the row SURVIVES with its cause on it (otherwise there is no trail), and
//   * the cookie STOPS AUTHENTICATING (a tombstone that still authenticates is
//     a security regression far worse than a missing audit row).
//
// Real better-auth pipeline throughout, following `session-of-record.test.ts`:
// requests go in as `Request` objects through `AuthManager.handleRequest`, the
// cookie is the one better-auth minted, and the revoke path is better-auth's
// own. A stub of our adapter would prove nothing — the whole question is what
// the library does around our write.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { runWithEndpointContext } from '@better-auth/core/context';
import { AuthManager } from './auth-manager';
import { BETTER_AUTH_MOUNTED_SURFACE } from './auth-route-ledger';
import {
  INTERACTIVE_REVOKE_REASON,
  SESSION_ERASURE_PATHS,
  currentAuthEndpointPath,
  filterRevokedSessionRows,
  hideRevokedSessionRow,
  isRevokedSessionRow,
  reconcileSessionDelete,
} from './session-tombstone';

/**
 * In-memory IDataEngine — the `session-of-record.test.ts` harness, unchanged
 * apart from this note, because these tests assert against the same table
 * through the same library and a second, more forgiving fake would be able to
 * disagree with it.
 *
 * `delete` AND `update` are both pinned to ObjectQL's own dispatch predicates
 * ({@link assertEngineDeleteDispatch} / {@link assertEngineUpdateDispatch})
 * rather than being free-form filters. Both fire for real here: several tests
 * turn on a delete NOT happening, and the whole fix is an `update` the real
 * engine has to accept — a fake looser than `ObjectQLEngine.update` could green
 * a tombstone write the engine would refuse. (`session-of-record.test.ts`'s
 * copy of this fake still carries the #5480 `update` DEBT entry in
 * `scripts/engine-double-contract.baseline.json`; a new double does not get to
 * inherit it.)
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
const PASSWORD = 'S3cure!Passw0rd-7732';

const makeManager = (engine: any, config: Record<string, unknown> = {}) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    ...config,
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
  post(manager, 'sign-up/email', undefined, { email, password: PASSWORD, name: 'Tombstone' });

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

const sessionRows = (engine: any) => (engine.tables.get('sys_session') ?? []) as any[];
const rowById = (engine: any, id: string) => sessionRows(engine).find((r) => r.id === id);

/** Sign up, then sign in again: two live sessions for one user. */
const twoSessions = async (manager: AuthManager, engine: any, email: string) => {
  const first = cookieFrom(await signUp(manager, email));
  const firstRow = sessionRows(engine)[0]!;
  const second = cookieFrom(await signIn(manager, email));
  const secondRow = sessionRows(engine).find((r) => r.id !== firstRow.id)!;
  return { first, firstRow, second, secondRow };
};

const MINUTE = 60_000;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('#7732 — an interactive revoke tombstones the row instead of deleting it', () => {
  it('POST /revoke-session leaves the row behind, stamped, and the cookie dead', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const { first, second, secondRow } = await twoSessions(manager, engine, 'revoke-one@example.com');

    expect(await isAuthenticated(manager, second)).toBe(true);

    const res = await post(manager, 'revoke-session', first, { token: secondRow.token });
    expect(res.status).toBe(200);

    // Direction 1 — the audit record EXISTS. Before this change the row was
    // gone, which is why the `admin` cause could never be recorded at all.
    const row = rowById(engine, secondRow.id);
    expect(row).toBeDefined();
    expect(row.revoked_at).toBeInstanceOf(Date);
    expect(row.revoke_reason).toBe('user_revoked');
    expect(new Date(row.expires_at).getTime()).toBeLessThan(Date.now());

    // Direction 2 — and it is DEAD. A retained row that still authenticates
    // would be a far worse bug than the missing audit row.
    expect(await isAuthenticated(manager, second)).toBe(false);
    // The revoking session is untouched.
    expect(await isAuthenticated(manager, first)).toBe(true);
    expect(rowById(engine, secondRow.id).revoke_reason).toBe('user_revoked');
  });

  it('POST /revoke-other-sessions tombstones the others and spares the caller', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const { first, firstRow, second, secondRow } = await twoSessions(
      manager,
      engine,
      'revoke-others@example.com',
    );

    expect(await post(manager, 'revoke-other-sessions', first)).toHaveProperty('status', 200);

    expect(rowById(engine, secondRow.id).revoke_reason).toBe('user_revoked');
    expect(rowById(engine, firstRow.id).revoke_reason).toBeUndefined();
    expect(await isAuthenticated(manager, second)).toBe(false);
    expect(await isAuthenticated(manager, first)).toBe(true);
  });

  it('POST /revoke-sessions tombstones every session the user has, caller included', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const { first, firstRow, second, secondRow } = await twoSessions(
      manager,
      engine,
      'revoke-all@example.com',
    );

    expect(await post(manager, 'revoke-sessions', first)).toHaveProperty('status', 200);

    for (const id of [firstRow.id, secondRow.id]) {
      expect(rowById(engine, id).revoke_reason).toBe('user_revoked');
      expect(rowById(engine, id).revoked_at).toBeInstanceOf(Date);
    }
    expect(await isAuthenticated(manager, first)).toBe(false);
    expect(await isAuthenticated(manager, second)).toBe(false);
  });

  it('a second sweep does not re-date a tombstone it matches again', async () => {
    // `revoke-sessions` matches by user, so it re-encounters every earlier
    // tombstone. Upstream restricts its own preserve path to LIVE rows for the
    // same reason: a later ending must not overwrite the time an earlier one
    // was recording.
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const { first, second, secondRow } = await twoSessions(manager, engine, 'twice@example.com');

    await post(manager, 'revoke-session', first, { token: secondRow.token });
    const firstStamp = rowById(engine, secondRow.id).revoked_at as Date;
    expect(firstStamp).toBeInstanceOf(Date);

    await new Promise((r) => setTimeout(r, 5));
    await post(manager, 'revoke-sessions', first);

    expect((rowById(engine, secondRow.id).revoked_at as Date).getTime()).toBe(firstStamp.getTime());
    expect(await isAuthenticated(manager, second)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#7732 — the tombstone survives the one thing that used to collect it', () => {
  it('the revoked client polling /get-session does not garbage-collect its own record', async () => {
    // The measured GC, re-read 2026-08-20 off the installed better-auth 1.7.1:
    // no sweeper at all (`setInterval` appears only in two client-side dist
    // files), and its ONE expiry-driven collection is inside `/get-session`
    // (`dist/api/routes/session.mjs:146-157`) — a row whose `expiresAt` has
    // passed is deleted "to clean up the session", and at 1.7.1 only when
    // `!deferSessionRefresh || isPostRequest`. That is why even the automatic
    // path's stamps were best-effort. It only fires on a row `findSession`
    // returned, so a hidden tombstone is never presented to it.
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const { first, second, secondRow } = await twoSessions(manager, engine, 'poll@example.com');

    await post(manager, 'revoke-session', first, { token: secondRow.token });

    // Five polls with the dead cookie — the shape a browser session actually
    // has. Every one of them is unauthenticated and none of them collects.
    for (let i = 0; i < 5; i++) expect(await isAuthenticated(manager, second)).toBe(false);

    const row = rowById(engine, secondRow.id);
    expect(row).toBeDefined();
    expect(row.revoke_reason).toBe('user_revoked');
  });

  it('an idle-timeout tombstone survives the same poll — the automatic path is retained too', async () => {
    // `auth-manager.ts` is untouched by #7732: it stamps exactly as before.
    // What changes is that its stamp is no longer eaten on the next request.
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { sessionIdleTimeoutMinutes: 30 });

    const cookie = cookieFrom(await signUp(manager, 'idle-retained@example.com'));
    const id = sessionRows(engine)[0]!.id;
    rowById(engine, id).last_activity_at = new Date(Date.now() - 90 * MINUTE);

    // The detecting request is still authenticated (`enforceSessionControls`
    // runs inside `customSession`, after validation) — the documented lag.
    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(rowById(engine, id).revoke_reason).toBe('idle_timeout');

    for (let i = 0; i < 3; i++) expect(await isAuthenticated(manager, cookie)).toBe(false);
    expect(rowById(engine, id).revoke_reason).toBe('idle_timeout');
  });

  it('a session that merely EXPIRED is still collected — retention is for records, not litter', async () => {
    // The converse. Without this, "nothing is ever deleted" would pass every
    // assertion above while quietly turning `sys_session` into an append-only
    // log of everything.
    const engine = createMemoryEngine();
    const manager = makeManager(engine);

    const cookie = cookieFrom(await signUp(manager, 'expired@example.com'));
    const id = sessionRows(engine)[0]!.id;
    rowById(engine, id).expires_at = new Date(Date.now() - MINUTE);

    expect(await isAuthenticated(manager, cookie)).toBe(false);
    expect(rowById(engine, id)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#7732 — everything that is not an interactive revoke is unchanged', () => {
  it('a normal sign-out still deletes the row and writes no revoke_reason', async () => {
    // Signing yourself out is not a revocation: it has no cause in
    // `revoke_reason`'s vocabulary, and whether `logout` earns an audit record
    // at all is #7675's question. Pinned here so this change cannot drift into
    // answering it.
    const engine = createMemoryEngine();
    const manager = makeManager(engine);

    const cookie = cookieFrom(await signUp(manager, 'signout@example.com'));
    expect(sessionRows(engine)).toHaveLength(1);

    expect(await post(manager, 'sign-out', cookie)).toHaveProperty('status', 200);

    expect(sessionRows(engine)).toHaveLength(0);
    expect(await isAuthenticated(manager, cookie)).toBe(false);
  });

  it('a sign-out on a session the idle timeout already tombstoned keeps the record', async () => {
    // The tombstone outranks the plain delete: the row is already a record of
    // WHY the session ended, and sign-out arriving afterwards does not make
    // that untrue.
    const engine = createMemoryEngine();
    const manager = makeManager(engine, { sessionIdleTimeoutMinutes: 30 });

    const cookie = cookieFrom(await signUp(manager, 'signout-after@example.com'));
    const id = sessionRows(engine)[0]!.id;
    rowById(engine, id).last_activity_at = new Date(Date.now() - 90 * MINUTE);
    await isAuthenticated(manager, cookie); // detecting request stamps it

    await post(manager, 'sign-out', cookie);

    expect(rowById(engine, id).revoke_reason).toBe('idle_timeout');
  });

  it('a live session is never hidden — signing in and reading back still works', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine);
    const cookie = cookieFrom(await signUp(manager, 'live@example.com'));
    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(await isAuthenticated(manager, cookie)).toBe(true);
    expect(sessionRows(engine)[0]!.revoked_at).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#7732 — the path ledger', () => {
  const endpointScope = <T>(path: string | undefined, fn: () => Promise<T>): Promise<T> =>
    path === undefined
      ? fn()
      : (runWithEndpointContext({ path, context: {} } as any, fn) as Promise<T>);

  const tombstoneEngine = () => {
    const updates: any[] = [];
    return {
      updates,
      update: async (name: string, patch: any) => void updates.push({ name, patch }),
    } as any;
  };

  it('maps every interactive-revoke route to the reason it should record', async () => {
    for (const [path, expected] of Object.entries(INTERACTIVE_REVOKE_REASON)) {
      const engine = tombstoneEngine();
      const proceed = await endpointScope(path, () =>
        reconcileSessionDelete(engine, 'sys_session', { id: 's1' }),
      );
      expect(proceed).toBe(false);
      expect(engine.updates).toHaveLength(1);
      expect(engine.updates[0].name).toBe('sys_session');
      expect(engine.updates[0].patch.revoke_reason).toBe(expected);
      expect(engine.updates[0].patch.revoked_at).toBeInstanceOf(Date);
      expect(engine.updates[0].patch.expires_at.getTime()).toBeLessThan(Date.now());
    }
  });

  it('splits admin-initiated from self-initiated — the field is the only record of who', async () => {
    expect(INTERACTIVE_REVOKE_REASON['/admin/revoke-user-session']).toBe('admin');
    expect(INTERACTIVE_REVOKE_REASON['/admin/revoke-user-sessions']).toBe('admin');
    expect(INTERACTIVE_REVOKE_REASON['/revoke-session']).toBe('user_revoked');
    expect(INTERACTIVE_REVOKE_REASON['/revoke-other-sessions']).toBe('user_revoked');
    expect(INTERACTIVE_REVOKE_REASON['/revoke-sessions']).toBe('user_revoked');
  });

  it('leaves every other path — and no path at all — as a plain delete', async () => {
    for (const path of ['/sign-out', '/get-session', '/admin/ban-user', '/delete-user', undefined]) {
      const engine = tombstoneEngine();
      const proceed = await endpointScope(path, () =>
        reconcileSessionDelete(engine, 'sys_session', { id: 's1' }),
      );
      expect(proceed).toBe(true);
      expect(engine.updates).toHaveLength(0);
    }
  });

  it('never touches an object that is not sys_session', async () => {
    const engine = tombstoneEngine();
    const proceed = await endpointScope('/revoke-session', () =>
      reconcileSessionDelete(engine, 'sys_verification', { id: 'v1' }),
    );
    expect(proceed).toBe(true);
    expect(engine.updates).toHaveLength(0);
  });

  it('hides a tombstone everywhere except the erasure routes', async () => {
    const tombstone = { id: 's1', revoked_at: new Date(), revoke_reason: 'admin' };
    const live = { id: 's2' };

    for (const path of ['/get-session', '/sign-out', '/revoke-sessions', undefined]) {
      expect(await endpointScope(path, () => hideRevokedSessionRow('sys_session', tombstone))).toBe(true);
      expect(await endpointScope(path, () => hideRevokedSessionRow('sys_session', live))).toBe(false);
      expect(
        await endpointScope(path, () => filterRevokedSessionRows('sys_session', [live, tombstone])),
      ).toEqual([live]);
    }

    // Erasure is not collection: a user being removed takes their audit rows
    // with them, so those routes must be able to see and delete them.
    for (const path of SESSION_ERASURE_PATHS) {
      expect(await endpointScope(path, () => hideRevokedSessionRow('sys_session', tombstone))).toBe(false);
      expect(
        await endpointScope(path, () => filterRevokedSessionRows('sys_session', [live, tombstone])),
      ).toEqual([live, tombstone]);
      const engine = tombstoneEngine();
      expect(await endpointScope(path, () => reconcileSessionDelete(engine, 'sys_session', tombstone))).toBe(
        true,
      );
    }
  });

  it('reads `revoked_at` presence, not truthiness — null and undefined are both live', () => {
    expect(isRevokedSessionRow({ revoked_at: new Date() })).toBe(true);
    expect(isRevokedSessionRow({ revoked_at: '2026-08-11T00:00:00.000Z' })).toBe(true);
    expect(isRevokedSessionRow({ revoked_at: null })).toBe(false);
    expect(isRevokedSessionRow({ revoked_at: undefined })).toBe(false);
    expect(isRevokedSessionRow({})).toBe(false);
    expect(isRevokedSessionRow(null)).toBe(false);
  });

  it('resolves to no path outside an endpoint context, so every rule degrades to today', async () => {
    await expect(currentAuthEndpointPath()).resolves.toBeUndefined();
  });

  it('every ledgered path is a route better-auth actually mounts', async () => {
    // The ledger is keyed on better-auth's own endpoint paths. An upstream
    // rename would leave every entry matching nothing — the fix would go
    // silently inert with no test failing anywhere else, which is the failure
    // `auth-route-ledger.ts` exists to make impossible for the SDK surface.
    const mounted = new Set(
      BETTER_AUTH_MOUNTED_SURFACE.map((route) => route.replace(/^[A-Z]+ \/api\/v1\/auth/, '')),
    );
    for (const path of [...Object.keys(INTERACTIVE_REVOKE_REASON), ...SESSION_ERASURE_PATHS]) {
      expect({ path, mounted: mounted.has(path) }).toEqual({ path, mounted: true });
    }
  });
});
