// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16534 — a bearer-mode `ObjectStackClient` was signed out by the three
// better-auth routes that ROTATE the caller's session.
//
// ## Why the server here is the real one
//
// The claim under test is "the SDK keeps the session the REAL server just
// handed it". Nothing short of the real `AuthManager` supports it: the
// rotation, the `set-auth-token` response header, and plugin-auth's own
// `two-factor-rotated-token-echo` repair — which is what makes `verify-totp`'s
// echoed token the LIVE one rather than the vendor's stale pre-rotation
// snapshot — are all server-side facts. A hand-written stand-in for the server
// would let this suite certify the SDK against a rotation this file invented.
//
// So the arrangement is the card's own probe with only the socket stood in
// for: a real `AuthManager` (better-auth 1.7.2, `bearer()` + `twoFactor`) over
// a real `ObjectQL` on a real `SqliteWasmDriver`, and an `ObjectStackClient`
// whose `fetch` hands the `Request` straight to `AuthManager.handleRequest`.
// Everything the client sends is what it would put on a socket, and everything
// it reads is what better-auth wrote.
//
// Deliberately NO cookie jar. The defect is bearer-only — a browser is carried
// across every rotation by its own cookie — so a jar would hide exactly the
// failure this suite exists to measure.
//
// ## What each block is for
//
// - `① the card's probe` — the end-to-end sequence from the card body with the
//   line `(the probe re-set client.token by hand here to continue)` DELETED.
//   Its absence is the acceptance criterion; there is no manual credential
//   repair anywhere in this file.
// - `② one assertion per route` — the three rotating routes measured
//   separately, because they are three different jobs. Two echo the new token
//   in the body; `twoFactor.disable` echoes only `{ status: true }` and is the
//   only one whose credential arrives in a response HEADER.
// - `③ the negative control` — the routes that DO NOT rotate must leave the
//   stored credential byte-identical. `updateUser` is the decisive leg: it
//   stages a session cookie to carry the updated user WITHOUT rotating, so
//   `bearer()` emits a `set-auth-token` for it too. An implementation that read
//   that header in the shared `fetch` wrapper instead of on the rotating routes
//   would rewrite the stored credential on an ordinary write — and every
//   assertion in ① and ② would stay green.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuthManager } from '@objectstack/plugin-auth';
import * as identityObjects from '@objectstack/platform-objects/identity';
import { ObjectStackClient } from './index';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-16534';
const NEW_PASSWORD = 'S3cure!Passw0rd-16534-rotated';
const ORIGIN = 'http://localhost:3000';

/**
 * The identity objects this arrangement stands up — the user, credential,
 * session, verification and two-factor rows better-auth's ObjectQL adapter
 * reads and writes on the routes under test, plus every sibling the boot path
 * touches (`AuthManager` resolves an OIDC resource row on startup, so a
 * hand-picked subset fails at `sys_oauth_resource` before the first request).
 *
 * Read out of `@objectstack/platform-objects/identity` by shape rather than
 * transcribed as a list: plugin-auth's own `authIdentityObjects` is
 * package-private, and a hand-copied list here would be a second declaration
 * of the same set, drifting silently the day the plugin registers one more.
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

// ── RFC 6238 TOTP ──────────────────────────────────────────────────────────
// Hand-rolled for the reason `two-factor-rotated-token-echo.test.ts` gives:
// `@better-auth/utils/otp` is a transitive dependency, and taking a direct
// dependency on it to generate six digits would tie this suite to an internal
// package's resolution. better-auth's defaults are the RFC's (SHA-1, 6 digits,
// 30s), which the `otpauth://` URI `enable` answers with states itself.

function base32Decode(input: string): Buffer {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit TOTP for `secret` at the current 30-second step. */
function totp(secret: Buffer): string {
  const counter = Math.floor(Date.now() / 30_000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

// ── the arrangement ────────────────────────────────────────────────────────

/**
 * The credential the client is currently presenting.
 *
 * `token` is private and it STAYS private: reading it through a cast is the
 * test's business, and publishing an accessor would be a new export on a card
 * whose whole point is that no public surface changes.
 */
const storedToken = (client: ObjectStackClient): string | undefined =>
  (client as unknown as { token?: string }).token;

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

/**
 * A client whose only stand-in is the transport: everything above this call is
 * the SDK's real request-building path and everything below it is better-auth's
 * real pipeline.
 */
const newClient = (manager: AuthManager, token?: string): ObjectStackClient =>
  new ObjectStackClient({
    baseUrl: ORIGIN,
    ...(token ? { token } : {}),
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      manager.handleRequest(new Request(String(input), init)),
  });

/** A real `AuthManager` plus a client whose socket IS that manager. */
const arrange = async () => {
  const engine = await makeEngine();
  const manager = new AuthManager({
    secret: SECRET,
    baseUrl: ORIGIN,
    dataEngine: engine,
    plugins: { twoFactor: true },
  } as never);

  return { engine, manager, client: newClient(manager) };
};

let emailSeq = 0;
const nextEmail = () => `rotation-${++emailSeq}-${Date.now()}@example.com`;

/** A signed-in bearer client, and the address it signed up with. */
const signedIn = async () => {
  const { engine, manager, client } = await arrange();
  const email = nextEmail();
  await client.auth.register({ email, password: PASSWORD, name: 'Rotating User' });
  const token = storedToken(client);
  expect(token, 'register stored no bearer token — the premise of this suite is gone').toBeTruthy();
  return { engine, manager, client, email, token: String(token) };
};

/**
 * Enrol the signed-in client in TOTP, stopping just BEFORE the rotating
 * `verifyTotp` call. Returns the TOTP secret and the backup codes `enable`
 * minted (the negative control needs one).
 */
const enrolTotp = async (client: ObjectStackClient) => {
  const { totpURI, backupCodes } = await client.auth.twoFactor.enable({ password: PASSWORD });
  expect(totpURI, 'two-factor/enable answered no otpauth URI').toBeTruthy();
  const uriSecret = new URL(String(totpURI).replace('otpauth://', 'https://')).searchParams.get(
    'secret',
  );
  expect(uriSecret, 'no secret in the otpauth URI').toBeTruthy();
  return { secret: base32Decode(String(uriSecret)), backupCodes: backupCodes ?? [] };
};

/**
 * WHO does a bearer credential resolve to, asked through the exact seam the
 * framework's data routes use — `runtime/src/security/resolve-session-principal.ts`
 * calls literally this.
 *
 * `null` for anonymous, never a status code: better-auth answers a dead session
 * with a 200 and a JSON `null`, so a status assertion is blind here, which is
 * exactly how the defect read in the field.
 */
const principalFor = async (
  manager: AuthManager,
  token: string | undefined,
): Promise<string | null> => {
  const auth = (await manager.getAuthInstance()) as unknown as {
    api: { getSession(a: { headers: Headers }): Promise<unknown> };
  };
  const session = (await auth.api
    .getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })
    .catch(() => null)) as { user?: { id?: string }; session?: { userId?: string } } | null;
  const id = session?.user?.id ?? session?.session?.userId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

const principalForStoredToken = (manager: AuthManager, client: ObjectStackClient) =>
  principalFor(manager, storedToken(client));

/** The `sys_user` id for an address, read at driver level below the adapter. */
const userIdFor = async (engine: ObjectQL, email: string): Promise<string> => {
  const driver = (
    engine as unknown as { getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> } }
  ).getDriver('sys_user');
  const found = await driver.find('sys_user', { where: {} });
  const rows = (Array.isArray(found) ? found : [found]).filter(Boolean) as Record<string, unknown>[];
  const row = rows.find((r) => r.email === email);
  if (!row) throw new Error(`no sys_user row for ${email}`);
  return String(row.id);
};

/**
 * The SIGNED `<token>.<sig>` spelling of an unsigned session token — what
 * `bearer()` puts in `set-auth-token`, obtained the way `bearer()` produces it:
 * from a response that stages a session cookie. `/update-user` stages one
 * WITHOUT rotating, which is exactly the property this helper needs.
 */
const signedCredentialFor = async (
  manager: AuthManager,
  unsignedToken: string,
): Promise<string> => {
  const res = await manager.handleRequest(
    new Request(`${ORIGIN}/api/v1/auth/update-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${unsignedToken}` },
      body: JSON.stringify({ name: 'Signed-Credential Probe' }),
    }),
  );
  const signed = res.headers.get('set-auth-token');
  expect(
    signed,
    'update-user emitted no set-auth-token to read the signed spelling from',
  ).toBeTruthy();
  return String(signed);
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    const e = engines.pop();
    try {
      await (e as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────
describe("#16534 ① the card's own probe, with the manual re-set deleted", () => {
  it('login → enable → verifyTotp → disable → deleteUser, no hand-repaired credential', async () => {
    const { engine, manager, client, email } = await signedIn();
    const userId = await userIdFor(engine, email);

    // ── the probe's FIRST step, spelled the way the card spells it. The card's
    //    sequence opens on `login`, not on the registration that had to precede
    //    it, so this opens on `login` too — a real second sign-in whose token
    //    the SDK stores, which is the line the card measured verbatim:
    //    `client.auth.login({ email, password }) -> RESOLVED { token, user }`.
    const session = await client.auth.login({ email, password: PASSWORD });
    expect(session?.data?.token, 'login echoed no token').toBeTruthy();
    const afterLogin = String(storedToken(client));
    expect(afterLogin, 'login did not store the token it was handed').toBe(session.data?.token);

    // The premise. Without it a green run could not tell "the rotation is
    // followed now" from "the bearer seam never worked here".
    expect(await principalForStoredToken(manager, client)).toBe(userId);

    const { secret } = await enrolTotp(client);

    // ── rotation #1 — the enrolment lane echoes the live token in the body.
    const verified = await client.auth.twoFactor.verifyTotp({ code: totp(secret) });
    expect(verified.token, 'verify-totp echoed no token').toBeTruthy();
    const afterVerify = String(storedToken(client));
    expect(afterVerify).not.toBe(afterLogin);
    //
    // ⭐ THE ACCEPTANCE CRITERION. The card's probe carried a line right here
    //    reading `(the probe re-set client.token by hand here to continue)`.
    //    There is no such line, and the sequence continues.
    //
    // ── rotation #2 — `disable` echoes `{ status: true }` and NOTHING else;
    //    its credential is in the `set-auth-token` response header.
    const receipt = await client.auth.twoFactor.disable({ password: PASSWORD });
    expect(receipt).toEqual({ status: true });
    const afterDisable = String(storedToken(client));
    expect(afterDisable).not.toBe(afterVerify);

    // The very next call — the one the card measured as `401 UNAUTHORIZED`.
    // `delete-user` is booked `disabled` in `auth-route-ledger.ts`, so it
    // refuses either way; WHICH refusal it is, is the whole finding. Against
    // the unfixed SDK it was 401, a dead credential; the route's own refusal
    // is not 401.
    const rejection = await client.auth
      .deleteUser({ password: PASSWORD })
      .then(() => null)
      .catch((e: { httpStatus?: number; code?: string }) => e);
    expect(rejection, 'delete-user resolved; this probe assumes the route refuses').not.toBeNull();
    expect(
      rejection?.httpStatus,
      `delete-user refused with ${rejection?.httpStatus} ${rejection?.code ?? ''} — a 401 means the stored credential is dead`,
    ).not.toBe(401);

    // And the positive half, stated directly rather than inferred from a
    // status code: after the whole sequence the client is still holding a
    // credential that resolves to the same principal.
    expect(await principalForStoredToken(manager, client)).toBe(userId);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('#16534 ② one assertion per rotating route — all three', () => {
  it('changePassword({ revokeOtherSessions: true }) — the body echoes the new token', async () => {
    const { engine, manager, client, email } = await signedIn();
    const userId = await userIdFor(engine, email);
    const before = String(storedToken(client));

    const result = await client.auth.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    });

    expect(result.token, 'change-password echoed no rotated token').toBeTruthy();
    expect(storedToken(client)).toBe(result.token);
    expect(storedToken(client)).not.toBe(before);
    // The stored value is a live credential, not merely a different string.
    expect(await principalForStoredToken(manager, client)).toBe(userId);
    // …and the one it replaced is genuinely gone.
    expect(await principalFor(manager, before)).toBeNull();
  }, 60_000);

  it('changePassword WITHOUT revokeOtherSessions rotates nothing and stores nothing', async () => {
    // The other half of the same route: `token` is `null` there, and a client
    // that adopted `null` would sign itself out on an ordinary password change.
    const { manager, client } = await signedIn();
    const before = String(storedToken(client));

    const result = await client.auth.changePassword({
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(result.token).toBeNull();
    expect(storedToken(client)).toBe(before);
    expect(await principalForStoredToken(manager, client)).not.toBeNull();
  }, 60_000);

  it('twoFactor.verifyTotp on the enrolment lane — the body echoes the LIVE token', async () => {
    const { engine, manager, client, email } = await signedIn();
    const userId = await userIdFor(engine, email);
    const before = String(storedToken(client));
    const { secret } = await enrolTotp(client);

    const result = await client.auth.twoFactor.verifyTotp({ code: totp(secret) });

    expect(storedToken(client)).toBe(result.token);
    expect(storedToken(client)).not.toBe(before);
    expect(await principalForStoredToken(manager, client)).toBe(userId);
    // The row behind the replaced value was deleted, so asserting only "the
    // stored token changed" would not have been enough.
    expect(await principalFor(manager, before)).toBeNull();
  }, 60_000);

  it('twoFactor.disable — the credential arrives ONLY in the `set-auth-token` header', async () => {
    // The route triage singled out: it answers `{ status: true }`, so an
    // implementation reading only response BODIES drops it — and this is the
    // assertion that says so.
    const { engine, manager, client, email } = await signedIn();
    const userId = await userIdFor(engine, email);
    const { secret } = await enrolTotp(client);
    await client.auth.twoFactor.verifyTotp({ code: totp(secret) });
    const before = String(storedToken(client));

    const receipt = await client.auth.twoFactor.disable({ password: PASSWORD });

    // The body really does carry nothing else — pinned, because it is the
    // premise of the whole header read.
    expect(receipt).toEqual({ status: true });
    expect(storedToken(client)).not.toBe(before);
    expect(await principalForStoredToken(manager, client)).toBe(userId);
    expect(await principalFor(manager, before)).toBeNull();
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('#16534 ③ the negative control — a NON-rotating route changes nothing', () => {
  it('ordinary reads and writes leave the stored credential byte-identical', async () => {
    // ⭐ `updateUser` is the decisive leg. It stages a session cookie to carry
    //    the updated user WITHOUT rotating the session, so `bearer()`'s
    //    after-hook emits a `set-auth-token` for it — carrying the SIGNED
    //    `<token>.<sig>` spelling of the session the client already holds. An
    //    implementation that read that header in the shared `fetch` wrapper
    //    rather than on the rotating routes rewrites the stored credential
    //    here, on an ordinary write, with every assertion in ① and ② still
    //    green.
    const { manager, client } = await signedIn();
    const before = String(storedToken(client));

    await client.auth.me();
    expect(storedToken(client), 'auth.me() moved the stored credential').toBe(before);

    await client.auth.sessions.list();
    expect(storedToken(client), 'sessions.list() moved the stored credential').toBe(before);

    await client.auth.updateUser({ name: 'Renamed User' });
    expect(storedToken(client), 'updateUser() moved the stored credential').toBe(before);

    // Still the same live session at the end of it — the invariant is "did not
    // move", not "was emptied".
    expect(await principalForStoredToken(manager, client)).not.toBeNull();
  }, 60_000);

  it("verifyBackupCode's already-logged-in lane leaves the stored credential byte-identical", async () => {
    // `/two-factor/verify-backup-code` shares `AuthTwoFactorVerificationResult`
    // with `verifyTotp` — the same declared `token` member — and does NOT
    // rotate: the vendor's `verifyTwoFactor` echoes the session it resolved at
    // entry. "Store the token from every result of this type" is therefore the
    // most available wrong move, and this is the assertion that refuses it.
    //
    // The client here deliberately holds the SIGNED credential better-auth
    // handed out in `set-auth-token` — the spelling the bearer plugin tells
    // clients to store, and the one this SDK itself ends up on after
    // `twoFactor.disable`. Against the UNSIGNED echo this route answers, the
    // two are different bytes, so a store here is visible rather than a
    // coincidental no-op.
    const { engine, manager, client, email } = await signedIn();
    const userId = await userIdFor(engine, email);
    const { secret, backupCodes } = await enrolTotp(client);
    await client.auth.twoFactor.verifyTotp({ code: totp(secret) });
    expect(backupCodes.length, 'enable minted no backup codes').toBeGreaterThan(0);

    const signed = await signedCredentialFor(manager, String(storedToken(client)));
    const bearerClient = newClient(manager, signed);
    expect(await principalForStoredToken(manager, bearerClient)).toBe(userId);

    const result = await bearerClient.auth.twoFactor.verifyBackupCode({ code: backupCodes[0] });

    // The premise of this leg: the echo really is a different string from what
    // the client is holding. Without it the equality below could pass for the
    // wrong reason.
    expect(result.token).not.toBe(signed);
    expect(storedToken(bearerClient), 'verifyBackupCode moved the stored credential').toBe(signed);
    expect(await principalForStoredToken(manager, bearerClient)).toBe(userId);
  }, 60_000);
});
