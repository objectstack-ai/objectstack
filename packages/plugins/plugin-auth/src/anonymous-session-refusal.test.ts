// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17238 — `GET /api/v1/auth/get-session` answered an anonymous caller with
// `200` + the literal JSON `null`, a value no `SessionResponse` can express.
// Ruled B by the director seat (batch #117 item 4, maintainer 「17238 B」): the
// server answers the platform's standard ADR-0112 failure envelope with HTTP
// 401 instead, and `SessionResponseSchema` is untouched.
//
// ## Why the server here is the real one
//
// Every claim below is a claim about BYTES BETTER-AUTH WRITES — what the
// anonymous answer is, and that the signed-in one did not move. A hand-written
// double would let this suite certify the seam against a body this file
// invented, which is exactly the drift the card records. So the arrangement is
// a real `AuthManager` over the in-memory engine this package's other
// better-auth suites use, driven through `AuthManager.handleRequest` — the one
// seam every vendor route passes through, and the seam the HTTP adapters call.
//
// ## The two halves, and why both are needed
//
// - **The refusal** asserts BOTH `status` and `error.code`. A status-only
//   assertion is not a refusal pin here: 401 is also what a dozen unrelated
//   failures answer, and the card is about which DECLARED code a caller may
//   branch on. A `toThrow`-style assertion would be worse still — this route
//   never threw; it returned a 200.
// - **The signed-in answer** is pinned BY IDENTITY (`toBe`), not by re-parsing
//   it. "Nothing moved for a signed-in caller" is the strongest form of the
//   claim, and an identity assertion states it exactly; a parse would merely
//   show the body still satisfies one schema. The end-to-end
//   `SessionResponseSchema` parse of a signed-in answer is owned by
//   `packages/client/src/auth-get-session-envelope.test.ts` block ①, where the
//   SDK's declared lift (`normalizeSessionResponse`) is in the path — this diff
//   does not touch either, and ⛔ this file deliberately does not re-derive
//   that lift, which would be a second copy free to drift from the real one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assertEngineDeleteDispatch,
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
} from '@objectstack/objectql';
import { SessionSchema, envelopeViolations } from '@objectstack/spec/api';
import { AuthManager } from './auth-manager';
import {
  GET_SESSION_PATH,
  isGetSessionPath,
  refuseAnonymousSession,
} from './anonymous-session-refusal';

/**
 * In-memory `IDataEngine`, the same shape `session-of-record.test.ts` uses —
 * `fields` really projects and `delete` is pinned to ObjectQL's own dispatch
 * predicate, so the fake cannot be more forgiving than the real engine.
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
      // ⛔ By PRESENCE, never truthiness: `limit: 0` means "no rows", and a
      // `if (q.limit)` double would hand back the whole set for it. Bound
      // applied AFTER the filter, which is where the engine applies it.
      if (typeof q.offset === 'number') out = out.slice(q.offset);
      if (typeof q.limit === 'number') out = out.slice(0, q.limit);
      return out.map((r) => project(r, q.fields));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, data: any, options?: any) {
      // Routed through ObjectQL's OWN dispatch predicate, so this fake cannot
      // be looser than the engine it stands in for. better-auth's adapter
      // calls `update(model, { ...patch, id })` with no options, which
      // dispatches `by-id` — the id is read back from the predicate rather
      // than re-derived here, so the two cannot disagree.
      const dispatch = assertEngineUpdateDispatch(data, options);
      if (dispatch.kind !== 'by-id') throw new Error(`fake driver: unsupported update ${dispatch.kind}`);
      const row = rows(name).find((r) => r.id === dispatch.id);
      if (!row) return null;
      Object.assign(row, data);
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

const ORIGIN = 'http://localhost:3000';
const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-17238';

const makeManager = (engine: any) =>
  new AuthManager({ secret: SECRET, baseUrl: ORIGIN, dataEngine: engine } as any);

const getSession = (manager: AuthManager, headers: Record<string, string> = {}) =>
  manager.handleRequest(new Request(`${ORIGIN}/api/v1/auth/get-session`, { headers }));

const signUp = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request(`${ORIGIN}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Anonymous Refusal' }),
    }),
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('[#17238] an anonymous /get-session is refused with the declared envelope', () => {
  it('⭐ answers 401 AND the registered code — both, not either', async () => {
    const manager = makeManager(createMemoryEngine());

    const res = await getSession(manager);

    // The two halves of a refusal pin. Neither alone is the contract: the
    // status is what stops a caller treating the answer as a session, and the
    // code is what it may branch on.
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success?: unknown; error?: { code?: unknown } };
    expect(body.error?.code).toBe('UNAUTHENTICATED');
    expect(body.success).toBe(false);

    // `UNAUTHENTICATED` is a STANDARD-catalog member (`StandardErrorCode`), so
    // this card mints nothing and `ERROR_CODE_LEDGER` is untouched. The seam
    // derives it from the status via ADR-0112's own map rather than spelling a
    // literal, so this assertion is what would catch that map moving.
    expect(res.headers.get('content-type')).toContain('application/json');
  }, 120_000);

  it('the refusal body is a conforming ADR-0112 envelope, exhaustively', async () => {
    const manager = makeManager(createMemoryEngine());

    const body = await (await getSession(manager)).json();

    // Exhaustive, not a key spot-check: an empty violation list is the whole
    // claim, so a stray top-level key or a missing `error.message` cannot
    // creep in behind a passing assertion.
    expect(envelopeViolations(body)).toEqual([]);
  }, 120_000);

  it('a credential that resolves to nobody is anonymous too', async () => {
    const manager = makeManager(createMemoryEngine());

    // Measured on the merge base: an unknown cookie drew the identical
    // `200 null` an absent one did. It is the same question with the same
    // answer, so it earns the same refusal — ⛔ not a second shape.
    const res = await getSession(manager, { cookie: 'better-auth.session_token=not-a-real-token' });

    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error?.code).toBe('UNAUTHENTICATED');
  }, 120_000);

  it('⭐ a SIGNED-IN answer does not move — 200, and the session still parses', async () => {
    const manager = makeManager(createMemoryEngine());
    const cookie = cookieFrom(await signUp(manager, 'signed-in@example.com'));

    const res = await getSession(manager, { cookie });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user?: unknown; session?: unknown };
    // The wire keys better-auth serves, unchanged — this is the bare body the
    // SDK's declared lift turns into `SessionResponse`, and the lift is what
    // `packages/client`'s block ① parses. What matters HERE is that the input
    // to that lift is byte-for-byte what it always was.
    expect(Object.keys(body).sort()).toEqual(['session', 'user']);
    expect(SessionSchema.safeParse((body as any).session).success).toBe(true);
  }, 120_000);

  it('better-auth`s JS API is untouched — only the wire moved', async () => {
    const manager = makeManager(createMemoryEngine());

    // The negative control that keeps the blast radius honest. Every internal
    // identity read in this repo (`resolve-execution-context`, the `/admin/`
    // gates, the SSO bridges) goes through this seam, NOT through HTTP. If the
    // refusal had been built one layer too deep, this would have moved too.
    const auth: any = await manager.getAuthInstance();
    const session = await auth.api.getSession({ headers: new Headers() }).catch(() => null);

    expect(session).toBeNull();
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('[#17238] the three narrowings — everything else is untouched BY IDENTITY', () => {
  const anonymous = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });

  it('a body that is not the literal null is returned unchanged', async () => {
    const signedIn = new Response(JSON.stringify({ user: { id: 'u1' }, session: { id: 's1' } }), {
      status: 200,
    });
    expect(await refuseAnonymousSession(GET_SESSION_PATH, signedIn)).toBe(signedIn);
  });

  it('a non-200 answer is returned unchanged — this seam never invents a route', async () => {
    // Measured: `POST /get-session` is a 404 on the default plugin set. A rule
    // keyed on the path alone would have converted it into a 401 and claimed a
    // route better-auth does not serve.
    const notFound = new Response('', { status: 404 });
    expect(await refuseAnonymousSession(GET_SESSION_PATH, notFound)).toBe(notFound);
  });

  it('another endpoint is returned unchanged, even answering the same bytes', async () => {
    const other = anonymous();
    expect(await refuseAnonymousSession('/list-sessions', other)).toBe(other);
    expect(await refuseAnonymousSession(undefined, other)).toBe(other);
  });

  it('the path is matched exactly — not as a prefix and not as a family', () => {
    expect(isGetSessionPath('/get-session')).toBe(true);
    expect(isGetSessionPath('/get-session/extra')).toBe(false);
    expect(isGetSessionPath('/get-session-something')).toBe(false);
    expect(isGetSessionPath('/admin/get-session')).toBe(false);
    expect(isGetSessionPath(undefined)).toBe(false);
  });

  it('a body that merely PARSES to something falsy is left alone', async () => {
    // `'0'`, `'""'` and `'false'` are all falsy after `JSON.parse`. Only the
    // literal `null` means "nobody is signed in", which is why the rule
    // compares TEXT and does not parse.
    for (const raw of ['0', '""', 'false', '{}', '[]']) {
      const res = new Response(raw, { status: 200 });
      expect(await refuseAnonymousSession(GET_SESSION_PATH, res), raw).toBe(res);
    }
  });

  it('carries the vendor’s headers over and drops the stale content-length', async () => {
    const withCookie = new Response('null', {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'a=b', 'content-length': '4' },
    });

    const out = await refuseAnonymousSession(GET_SESSION_PATH, withCookie);

    expect(out).not.toBe(withCookie);
    expect(out.status).toBe(401);
    expect(out.headers.get('set-cookie')).toBe('a=b');
    expect(out.headers.get('content-length')).toBeNull();
  });
});
