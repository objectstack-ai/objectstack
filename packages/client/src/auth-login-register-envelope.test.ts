// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17234 — `auth.login` and `auth.register` annotate their return as
// `SessionResponse` (`BaseResponseSchema.extend(…)`, so `success` is a REQUIRED
// boolean, and `data.session` a required `Session`) and delivered a body that
// carried neither. Two departures were measured on the card; this suite now
// closes BOTH: `success` (the previous round) and `data.session` (this one —
// `/sign-in/email` and `/sign-up/email` now attach the session the request
// itself already committed, read back through `internalAdapter.findSession`;
// see `session-envelope-completion.ts` in `plugin-auth`).
//
// ## Why the server here is the real one
//
// Every claim below is a claim about BYTES BETTER-AUTH WRITES — whether
// `/sign-in/email` and `/sign-up/email` carry a session anywhere, and which
// spelling of the session credential reaches `data.token`. A hand-written
// double would let this suite certify the SDK against a body this file
// invented, which is exactly how the declared shape and the real one drifted
// apart in the first place. So the arrangement is a real `AuthManager`
// (better-auth 1.7.3, organization plugin on by its own default) over a real
// `ObjectQL` on a real `SqliteWasmDriver`, with an `ObjectStackClient` whose
// `fetch` hands the `Request` straight to `AuthManager.handleRequest`:
// everything above that call is the SDK's real request path, everything below
// it is better-auth's real pipeline. The client's `fetch` also keeps a CLONE of
// each `Response`, so the wire bytes and the SDK's return value come from ONE
// call rather than from two that could disagree.
//
// ## What each block is for
//
// - `① the declared envelope is delivered` — the defect proper. The judge is a
//   PARSE against the declaration, not a key spot-check.
// - `② the residue is exhaustive` — `SessionResponseSchema` still does not
//   parse, for one reason that is NOT this card's: `data.user.image` (#17235).
//   Pinned as the complete issue list so a regression on `success` OR
//   `data.session` shows up here as an extra issue instead of hiding inside
//   "it already failed".
// - `③ the instrument can still fail` — the negative control. The same parse,
//   on the same returned value with `success` taken back out, must report
//   `success` again (and still report the `data.user.image` residue).
//   Without it, a green ① could equally mean the assertion broke.
// - `④ the credential survives byte-identical` — the regression this fix could
//   most easily have caused. `data.token` is the body's own token, and
//   `client.token` is still armed from it.
// - `⑤ data.session is now obtainable on these routes` — the card's second
//   departure, closed. The session attached is the SAME row a following
//   `/get-session` would read — not a second one, not an invented one — and a
//   fabricated body without a `session` member still fails the parse (the
//   instrument's negative control, criterion 3(a)).
// - `⑥ the raw keys survive the lift` — callers were pushed onto `.user` /
//   `.token` by the very misdeclaration this card fixes.

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuthManager } from '@objectstack/plugin-auth';
import * as identityObjects from '@objectstack/platform-objects/identity';
import { BaseResponseSchema, SessionResponseSchema, SessionSchema } from '@objectstack/spec/api';
import { ObjectStackClient } from './index';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'S3cure!Passw0rd-17234';

/**
 * The identity objects better-auth's ObjectQL adapter reads and writes on the
 * routes under test. Read out of `@objectstack/platform-objects/identity` BY
 * SHAPE rather than transcribed, for the reason
 * `auth-get-session-envelope.test.ts` states: a hand-copied list is a second
 * declaration of the same set, drifting silently the day the plugin registers
 * one more.
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

let emailSeq = 0;

/**
 * A real manager plus a client factory that records the wire `Response` of
 * every call it makes.
 *
 * ⚠️ One manager per scenario, deliberately: the FIRST sign-up on a fresh
 * environment provisions the owner and the audience posture then closes
 * self-registration (`SELF_REGISTRATION_CLOSED`), so a second `register()` on
 * the same manager is refused before it ever reaches the code under test.
 */
const scenario = async () => {
  const engine = await makeEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
  } as never);
  const wire: Response[] = [];
  const mkClient = (): ObjectStackClient =>
    new ObjectStackClient({
      baseUrl: ORIGIN,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await manager.handleRequest(new Request(String(input), init));
        // Clone BEFORE the SDK reads it, so both halves of every assertion
        // below come from the same single call.
        wire.push(res.clone());
        return res;
      },
    });
  return {
    manager,
    mkClient,
    email: `envelope-17234-${++emailSeq}-${Date.now()}@example.com`,
    /** The `Response` of the most recent call this scenario's clients made. */
    lastWire: () => wire[wire.length - 1],
  };
};

/** The credential the client is holding right now. */
const storedToken = (client: ObjectStackClient): string | undefined =>
  (client as unknown as { token?: string }).token;

/** The raw wire keys the lift keeps alongside `data`. */
type RawKeys = {
  success?: unknown;
  redirect?: unknown;
  token?: unknown;
  user?: { id?: string };
  data?: { token?: unknown; session?: unknown; user?: { id?: string } };
};

/** A registered first user, and both halves of that one call. */
const registered = async () => {
  const s = await scenario();
  const client = s.mkClient();
  const res = await client.auth.register({
    email: s.email,
    password: PASSWORD,
    name: 'Envelope 17234',
  });
  const wire = s.lastWire();
  return { ...s, client, res, wireRes: wire, wireBody: (await wire.json()) as RawKeys };
};

/** …and a SECOND client that signed that user back in. */
const signedIn = async () => {
  const base = await registered();
  const client = base.mkClient();
  const res = await client.auth.login({ email: base.email, password: PASSWORD });
  const wire = base.lastWire();
  return { ...base, client, res, wireRes: wire, wireBody: (await wire.json()) as RawKeys };
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

describe('[#17234] auth.login / auth.register deliver the SessionResponse envelope they declare', () => {
  describe('① the declared envelope is delivered', () => {
    it('register() parses as the declared envelope, with the payload under `data`', async () => {
      const { res } = await registered();

      // The decisive assertion: the DECLARATION judges the body. On the defect
      // the method returned `{ …raw, data }` with no `success` at all, so this
      // parse was red.
      const envelope = BaseResponseSchema.safeParse(res);
      expect(
        envelope.success,
        `register() did not parse as the declared envelope: ${JSON.stringify(envelope.error?.issues)}`,
      ).toBe(true);
      expect(res.success).toBe(true);

      expect(res.data).toBeTruthy();
      expect(typeof res.data.user?.id).toBe('string');
      expect(res.data.user?.email).toContain('@');
    });

    it('login() parses as the declared envelope, with the payload under `data`', async () => {
      const { res } = await signedIn();

      const envelope = BaseResponseSchema.safeParse(res);
      expect(
        envelope.success,
        `login() did not parse as the declared envelope: ${JSON.stringify(envelope.error?.issues)}`,
      ).toBe(true);
      expect(res.success).toBe(true);

      expect(res.data).toBeTruthy();
      expect(typeof res.data.user?.id).toBe('string');
      expect(res.data.user?.email).toContain('@');
    });
  });

  describe('② the residue is exhaustive, and neither `success` nor `data.session` is in it', () => {
    // ONE issue remains on the FULL declared type, and it is not this card's:
    //
    //   data.user.image — `SessionUserSchema.image` is `z.string().optional()`,
    //                     which does not admit `null`, and better-auth serves
    //                     `"image": null` for a user who never set one. Filed
    //                     as #17235, and NOT specific to these two methods.
    //
    // Pinned as the EXHAUSTIVE list rather than as "it still fails": if
    // `success` OR `data.session` ever regress they reappear here as extra
    // issues and these cases redden. It is the residue's tripwire, not an
    // acceptance of it.
    const RESIDUE = ['data.user.image'];

    it('register() reports exactly the one issue that is not this card\'s', async () => {
      const { res } = await registered();
      const issues = SessionResponseSchema.safeParse(res).error?.issues ?? [];
      expect(issues.map((i) => i.path.join('.'))).toEqual(RESIDUE);
    });

    it('login() reports exactly the one issue that is not this card\'s', async () => {
      const { res } = await signedIn();
      const issues = SessionResponseSchema.safeParse(res).error?.issues ?? [];
      expect(issues.map((i) => i.path.join('.'))).toEqual(RESIDUE);
    });
  });

  describe('③ the instrument can still fail — negative control', () => {
    it('the same parse reports `success` again once it is taken back out', async () => {
      const { res } = await signedIn();

      // Not a fabricated body: the value the method REALLY returned, with the
      // one member this card added removed again. So a green ① cannot be a
      // broken assertion or a schema that stopped checking — this is the same
      // schema, the same call, the same instrument, reporting the defect.
      const { success: _dropped, ...withoutSuccess } = res as unknown as Record<string, unknown> & {
        success?: unknown;
      };
      const issues = SessionResponseSchema.safeParse(withoutSuccess).error?.issues ?? [];
      expect(issues.map((i) => i.path.join('.'))).toEqual(['success', 'data.user.image']);
    });

    it('and reports `data.session` again once the fix is taken back out — a fabricated body without a session still fails', async () => {
      const { res } = await signedIn();

      // The other half of criterion 3(a): the SAME instrument, on a body this
      // test fabricates rather than one the server returned, with `session`
      // removed. This is what makes ① and ⑤'s green readings a real assertion
      // rather than a schema that stopped checking `data.session` at all.
      const { data, ...rest } = res as unknown as Record<string, unknown> & {
        data: Record<string, unknown>;
      };
      const { session: _droppedSession, ...dataWithoutSession } = data;
      const issues =
        SessionResponseSchema.safeParse({ ...rest, data: dataWithoutSession }).error?.issues ?? [];
      expect(issues.map((i) => i.path.join('.'))).toEqual(['data.session', 'data.user.image']);
    });
  });

  describe('④ the credential survives the lift byte-identical', () => {
    it('login() keeps the body token at `data.token` and still arms `client.token`', async () => {
      const { manager, client, res, wireBody } = await signedIn();

      // Byte-identity against the WIRE, on the same call — not against a
      // remembered constant. Routing these methods through the shared lift is
      // exactly the change that could have dropped this member (the lift used
      // to build `data: { user, session }` and nothing else), and dropping it
      // would silently stop the auto-set below on the SDK's most-used path.
      expect(typeof wireBody.token).toBe('string');
      expect(res.data.token).toBe(wireBody.token);

      // The auto-set still happens, and it is the same string.
      expect(storedToken(client)).toBe(wireBody.token);
      expect(storedToken(client)).toBe(res.data.token);

      // …and it is a WORKING credential, not merely a non-empty string.
      expect(await principalFor(manager, storedToken(client))).toBe(res.data.user?.id);
      // The control that must NOT resolve, so "resolves to the user" is a real
      // reading and not something this arrangement answers for any input.
      expect(await principalFor(manager, 'not-the-session-token-17234')).toBeNull();
    });

    it('register() keeps the body token at `data.token` and still arms `client.token`', async () => {
      const { client, res, wireBody } = await registered();
      expect(typeof wireBody.token).toBe('string');
      expect(res.data.token).toBe(wireBody.token);
      expect(storedToken(client)).toBe(wireBody.token);
    });

    it('the token at `data.token` is the UNSIGNED spelling the body carries', async () => {
      const { res, wireRes, wireBody } = await signedIn();

      // The two spellings of one session credential, measured on ONE response:
      // the body's `token` is UNSIGNED, and `bearer()` publishes the SIGNED
      // `token.signature` form in the `set-auth-token` HEADER. The split is by
      // CARRIER, not by method — which is what makes "never synthesize
      // `data.token` from `session.token`" a rule about inventing a member on a
      // route that served none, rather than about two different credentials.
      const signed = wireRes.headers.get('set-auth-token') ?? '';
      expect(signed, 'sign-in emitted no set-auth-token — this control cannot fire').toBeTruthy();
      expect(signed).not.toBe(wireBody.token);
      expect(signed.startsWith(`${String(wireBody.token)}.`)).toBe(true);
      // `data.token` is the body half, untouched.
      expect(res.data.token).toBe(wireBody.token);
    });
  });

  describe('⑤ `data.session` is now obtainable on these routes — #17234 closes', () => {
    it('both routes now carry a session in the body, alongside the pre-existing keys', async () => {
      const reg = await registered();
      expect(Object.keys(reg.wireBody as object)).toEqual(['token', 'user', 'session']);
      expect(reg.res.data.session).toBeTruthy();

      const log = await signedIn();
      expect(Object.keys(log.wireBody as object)).toEqual(['redirect', 'token', 'user', 'session']);
      expect(log.res.data.session).toBeTruthy();
    });

    it('the session parses as the declared SessionSchema and names the right user', async () => {
      const reg = await registered();
      const regSession = SessionSchema.safeParse(reg.res.data.session);
      expect(
        regSession.success,
        `register()'s data.session did not parse: ${JSON.stringify(regSession.error?.issues)}`,
      ).toBe(true);
      expect(reg.res.data.session?.userId).toBe(reg.res.data.user?.id);

      const log = await signedIn();
      const logSession = SessionSchema.safeParse(log.res.data.session);
      expect(
        logSession.success,
        `login()'s data.session did not parse: ${JSON.stringify(logSession.error?.issues)}`,
      ).toBe(true);
      expect(log.res.data.session?.userId).toBe(log.res.data.user?.id);
    });

    it('is the SAME row a following /get-session reads — a lookup, not an invention', async () => {
      const { client, res } = await signedIn();

      // The decisive proof that this is a READ: a second, independent call
      // through better-auth's own `/get-session` route names the identical
      // session id and expiry as the one attached to the sign-in response —
      // one row, read twice, not two arrangements that happen to agree.
      const me = await client.auth.me();
      expect(me.data.session?.id).toBe(res.data.session?.id);
      expect(me.data.session?.expiresAt).toBe(res.data.session?.expiresAt);
      expect(me.data.session?.userId).toBe(res.data.session?.userId);
    });

    it('the session token is the SAME unsigned credential the body already carried at `data.token`', async () => {
      const { res } = await signedIn();
      // `session.token` is the row's own token column — the same unsigned
      // string `data.token` already held before this card, not a second
      // credential this fix introduced.
      expect(res.data.session?.token).toBe(res.data.token);
    });

    it('criterion 3(a): a fabricated body with no session still fails SessionSchema', async () => {
      // The negative control on this instrument specifically: SessionSchema
      // itself must still be capable of failing, so a green reading above
      // cannot equally mean the schema stopped checking `id` / `expiresAt` /
      // `userId` at all.
      expect(SessionSchema.safeParse(undefined).success).toBe(false);
      expect(SessionSchema.safeParse({}).success).toBe(false);
      expect(SessionSchema.safeParse({ id: 'x' }).success).toBe(false); // missing expiresAt, userId
    });
  });

  describe('⑥ the raw keys survive the lift', () => {
    it('keeps `.user` / `.token` — and login keeps `.redirect` — alongside `data`', async () => {
      const { res } = await signedIn();
      const raw = res as unknown as RawKeys;
      // Callers were pushed onto the raw keys by the very misdeclaration this
      // card fixes. Buying the declared shape by breaking them would trade one
      // silent breakage for another.
      expect(raw.user?.id).toBe(res.data.user?.id);
      expect(raw.token).toBe(res.data.token);
      expect(raw.redirect).toBe(false);
    });
  });
});
