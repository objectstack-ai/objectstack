// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16760 — `auth.me` and `auth.refreshToken` declare `SessionResponse` (the
// REST `{ success, data }` envelope) for `GET /api/v1/auth/get-session`, a
// route that answers bare; and `refreshToken` captured no credential at all.
//
// ## Why the server here is the real one
//
// Every claim in this file is a claim about BYTES BETTER-AUTH WRITES — which
// keys `/get-session` puts at the top level, where in them the session
// credential sits, and what the anonymous answer is. A hand-written double
// would let this suite certify the SDK against a body this file invented, and
// the card it closes exists precisely because the declared shape and the real
// one had drifted apart with nobody measuring. So the arrangement is a real
// `AuthManager` (better-auth 1.7.2, organization plugin on by its own default)
// over a real `ObjectQL` on a real `SqliteWasmDriver`, with an
// `ObjectStackClient` whose `fetch` hands the `Request` straight to
// `AuthManager.handleRequest`: everything above that call is the SDK's real
// request path, everything below it is better-auth's real pipeline.
//
// ## What each block is for
//
// - `① me() delivers the envelope it declares` — the card's first consequence.
//   The decisive assertion is a PARSE against the declared schema, not a key
//   spot-check: the defect is "the declared type is not delivered", so the
//   declaration itself has to be the judge. Its second case pins the ONE gap
//   the lift cannot close (`user.image`, declared string-or-absent, served
//   `null`) as an exhaustive issue list, so the residue cannot quietly grow.
// - `② the raw keys survive` — `.user` is what the field reads today, while
//   the declared `.data.user` was `undefined`. The fix must not buy the
//   declared shape by breaking the workaround callers were pushed onto.
// - `③ anonymous is REFUSED` — REVERSED by #17238. This block used to pin the
//   route serving the literal `null` at 200, as the known residue #16760 could
//   not close. The residue is now closed at the producer: `/get-session`
//   answers an anonymous caller the declared ADR-0112 envelope at 401, so
//   `me()` REJECTS and every value it resolves with is inside
//   `SessionResponse`. The case is kept, not deleted, because a reversed pin is
//   the record that the gap was closed deliberately rather than drifting shut.
// - `④ refreshToken captures a credential that actually works` — the card's
//   second consequence, and the one that was NOT a consequence of the envelope
//   at all. The firing control is the credential's SPELLING: the client starts
//   on the signed `token.signature` form `bearer()` hands out, and a working
//   capture moves it to the unsigned one the session body carries.
// - `⑤ the field the old read named does not exist` — the negative control.
//   `data.token` is absent from the normalized body too, so a regression back
//   to `data.data?.token` cannot pass by accident, and the "enveloping it
//   would have fixed refreshToken" reading stays refuted in code.

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuthManager } from '@objectstack/plugin-auth';
import * as identityObjects from '@objectstack/platform-objects/identity';
import { BaseResponseSchema, SessionResponseSchema, SessionSchema } from '@objectstack/spec/api';
import { ObjectStackClient } from './index';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'S3cure!Passw0rd-16760';

/**
 * The identity objects better-auth's ObjectQL adapter reads and writes on the
 * routes under test, plus every sibling the boot path touches. Read out of
 * `@objectstack/platform-objects/identity` BY SHAPE rather than transcribed:
 * plugin-auth's own `authIdentityObjects` is package-private, and a hand-copied
 * list would be a second declaration of the same set, drifting silently the day
 * the plugin registers one more.
 */
const IDENTITY_OBJECTS = Object.values(
  identityObjects as unknown as Record<string, unknown>,
).filter(
  (o): o is Record<string, unknown> =>
    !!o &&
    typeof o === 'object' &&
    typeof (o as { name?: unknown }).name === 'string' &&
    typeof (o as { fields?: unknown }).fields === 'object',
);

const engines: ObjectQL[] = [];

const makeEngine = async (): Promise<ObjectQL> => {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);
  await engine.init();
  for (const object of IDENTITY_OBJECTS) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  return engine;
};

const newClient = (manager: AuthManager, token?: string): ObjectStackClient =>
  new ObjectStackClient({
    baseUrl: ORIGIN,
    ...(token ? { token } : {}),
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      manager.handleRequest(new Request(String(input), init)),
  });

/** The credential the client is holding right now. */
const storedToken = (client: ObjectStackClient): string | undefined =>
  (client as unknown as { token?: string }).token;

let emailSeq = 0;

/**
 * A real manager and a signed-in client, plus BOTH spellings of the session
 * credential the sign-up handed back.
 *
 * The sign-up runs through `manager.handleRequest` rather than through
 * `client.auth.register` for one reason: the SDK's `register` keeps only the
 * body, and the two spellings are what case ④ needs. Measured, they differ:
 *
 * ```
 * response header `set-auth-token` -> "<token>.<signature>"   (SIGNED)
 * response body    .token          -> "<token>"               (UNSIGNED)
 * ```
 *
 * `bearer()` accepts both, and `session.token` inside `/get-session` stores the
 * unsigned one.
 */
const signedIn = async () => {
  const engine = await makeEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
  } as never);
  const email = `envelope-${++emailSeq}-${Date.now()}@example.com`;
  const res = await manager.handleRequest(
    new Request(`${ORIGIN}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Envelope User' }),
    }),
  );
  const body = (await res.json()) as { token?: string };
  const signed = res.headers.get('set-auth-token') ?? '';
  const unsigned = body.token ?? '';
  expect(signed, 'sign-up emitted no set-auth-token — the premise of ④ is gone').toBeTruthy();
  expect(unsigned, 'sign-up returned no body token').toBeTruthy();
  // The client is handed the SIGNED spelling, which is what `bearer()`
  // advertises to a cross-origin caller through `Access-Control-Expose-Headers`.
  return { manager, client: newClient(manager, signed), signed, unsigned, email };
};

/** Anonymous: a real manager, and a client that has never signed in. */
const anonymous = async () => {
  const engine = await makeEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
  } as never);
  return { manager, client: newClient(manager) };
};

/** WHO a credential resolves to, asked through better-auth's own API. */
const principalFor = async (manager: AuthManager, token: string | undefined) => {
  const auth = (await manager.getAuthInstance()) as unknown as {
    api: { getSession(a: { headers: Headers }): Promise<unknown> };
  };
  const session = (await auth.api
    .getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })
    .catch(() => null)) as { user?: { id?: string } } | null;
  return session?.user?.id ?? null;
};

afterEach(async () => {
  while (engines.length) {
    const engine = engines.pop();
    await (engine as unknown as { close?: () => Promise<void> })?.close?.().catch(() => {});
  }
});

describe('[#16760] /get-session is lifted into the SessionResponse envelope it declares', () => {
  describe('① me() delivers the envelope it declares', () => {
    it('parses as the declared envelope, with the payload under `data`', async () => {
      const { client } = await signedIn();
      const res = await client.auth.me();

      // The decisive assertion: the DECLARATION judges the body. On the defect
      // the method returned better-auth's bare `{ user, session }`, which
      // carries no `success` at all, so this parse is red before the fix.
      const envelope = BaseResponseSchema.safeParse(res);
      expect(
        envelope.success,
        `me() did not parse as the declared envelope: ${JSON.stringify(envelope.error?.issues)}`,
      ).toBe(true);
      expect(res.success).toBe(true);

      // …and the payload really is under the declared keys, not merely a
      // `data` that exists. `.data.user` was `undefined` on the defect while
      // `.user` — which did not type-check — held the real payload.
      expect(res.data).toBeTruthy();
      expect(typeof res.data.user?.id).toBe('string');
      expect(res.data.user?.id).toBeTruthy();
      expect(res.data.user?.email).toContain('@');

      // `data.session` is judged by its own declared schema for the same
      // reason: a `session` key that is present but not a session would pass a
      // truthiness check and fail every caller.
      const session = SessionSchema.safeParse(res.data.session);
      expect(
        session.success,
        `data.session did not parse as SessionSchema: ${JSON.stringify(session.error?.issues)}`,
      ).toBe(true);
      expect(res.data.session?.userId).toBe(res.data.user?.id);
    });

    it('leaves exactly one declared-type gap, and it is not the envelope', async () => {
      const { client } = await signedIn();
      const res = await client.auth.me();

      // The FULL declared type still does not parse — for a reason that has
      // nothing to do with this card and that the lift cannot reach:
      // `SessionUserSchema.image` is declared `z.string().optional()`, which
      // does not admit `null`, and better-auth serves `"image": null` for a
      // user who never set one. Filed as #17235 — delete this case with it.
      //
      // Pinned as the exhaustive issue list rather than as "it fails": if the
      // envelope ever regresses, the missing `success` and `data` show up here
      // as extra issues and this case reddens. It is the residue's tripwire,
      // not an acceptance of it.
      const issues = SessionResponseSchema.safeParse(res).error?.issues ?? [];
      expect(issues.map((i) => i.path.join('.'))).toEqual(['data.user.image']);
    });
  });

  describe('② the raw keys survive the lift', () => {
    it('keeps `.user` / `.session` alongside `data`', async () => {
      const { client } = await signedIn();
      const res = (await client.auth.me()) as unknown as {
        user?: { id?: string };
        session?: { id?: string };
        data: { user?: { id?: string }; session?: { id?: string } };
      };
      // Callers were pushed onto `.user` by the very misdeclaration this card
      // fixes. Buying the declared shape by breaking them would trade one
      // silent breakage for another.
      expect(res.user?.id).toBe(res.data.user?.id);
      expect(res.session?.id).toBe(res.data.session?.id);
    });
  });

  describe('③ anonymous is REFUSED — the residue #16760 measured, now closed', () => {
    // ⚠️ THE REVERSAL, named. Until #17238 this block asserted `res` was the
    // literal `null` — and its own comment said it pinned the RESIDUE, not a
    // fix: it was green with the lift and without it, so it could never redden
    // on the lift's ablation.
    //
    // What changed is the PRODUCER, not the lift. There is still no
    // `SessionResponse` value meaning "nobody is signed in"; the server stopped
    // needing one by refusing instead of answering. Ruled by the director seat
    // (batch #117 item 4) under 「spec 与代码不一致默认改代码」.
    //
    // ⛔ What the SDK must still never do is manufacture `{ success: true,
    // data: {} }` here — an empty session that reads as a real one. A rejection
    // is the opposite of that, and this case is what says so.
    it('rejects with the declared refusal instead of resolving outside its type', async () => {
      const { client } = await anonymous();

      // BOTH halves: the status is what stops a caller reading the answer as a
      // session, the code is what it may branch on.
      await expect(client.auth.me()).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        httpStatus: 401,
      });
    });

    it('and the refusal is the only way out — nothing resolves to a falsy session', async () => {
      // The control for the reversal: a `me()` that silently started resolving
      // `null`/`undefined` again would satisfy no assertion above, and this is
      // what turns that into a failure rather than a gap.
      const { client } = await anonymous();

      const settled = await client.auth
        .me()
        .then((value) => ({ outcome: 'resolved' as const, value }))
        .catch((error) => ({ outcome: 'rejected' as const, value: error }));

      expect(settled.outcome).toBe('rejected');
    });
  });

  describe('④ refreshToken captures a credential that actually works', () => {
    it('stores session.token, and that token authenticates', async () => {
      const { manager, client, signed, unsigned } = await signedIn();

      // The firing control is the SPELLING, and it is a measured one: the
      // client starts on the SIGNED credential `bearer()` hands out, while the
      // token inside the session body is the UNSIGNED one. So a `refreshToken`
      // that really captures from the body moves the stored string, and one
      // that captures nothing leaves it exactly where it started.
      //
      // ⛔ Not "seed a deliberately wrong token": that unauthenticates the
      // client, `/get-session` then REFUSES for the anonymous reason (401 since
      // #17238), and the case would fail against a CORRECT implementation.
      expect(signed, 'the two spellings coincide — this control cannot fire').not.toBe(unsigned);
      const before = storedToken(client);
      expect(before).toBe(signed);

      const res = await client.auth.refreshToken('ignored-by-better-auth');

      const stored = storedToken(client);
      expect(
        stored,
        'refreshToken captured nothing — it is still a silent no-op',
      ).not.toBe(before);
      expect(stored).toBeTruthy();

      // It is the credential the route actually serves, not one invented here.
      expect(stored).toBe(res.data.session?.token);
      // …and the two are the measured pair, not two unrelated strings.
      expect(String(before).startsWith(String(stored))).toBe(true);

      // And it is a WORKING credential, not merely a non-empty string: the
      // whole point of the method is that the caller stays signed in. This is
      // what makes swapping the stored spelling safe rather than merely
      // observed — `bearer()` accepts both, and the server strips the
      // signature before it looks the session up.
      expect(await principalFor(manager, stored)).toBe(res.data.user?.id);
      expect(await principalFor(manager, before)).toBe(res.data.user?.id);
      // The control that must NOT resolve, so "resolves to the user" is a real
      // reading and not something this arrangement answers for any input.
      expect(await principalFor(manager, 'not-the-session-token-16760')).toBeNull();
    });
  });

  describe('⑤ the field the old read named does not exist', () => {
    it('has no top-level token and no data.token, before or after the lift', async () => {
      const { client } = await signedIn();
      const res = (await client.auth.me()) as unknown as {
        token?: unknown;
        data: { token?: unknown; session?: { token?: unknown } };
      };
      // The card called `refreshToken`'s failure a CONSEQUENCE of the envelope
      // being misdeclared. It is not: enveloping the body puts nothing at
      // `data.token` either, because the route serves no top-level `token` to
      // lift. The only credential in the body is `data.session.token`.
      expect(res.token).toBeUndefined();
      expect(res.data.token).toBeUndefined();
      expect(typeof res.data.session?.token).toBe('string');
    });
  });
});
