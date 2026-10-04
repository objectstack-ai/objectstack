// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The TOTP enrollment names the DEPLOYMENT, not the auth library.
//
// `/two-factor/enable` used to answer
// `otpauth://totp/Better%20Auth:<email>?…&issuer=Better+Auth`: the twoFactor
// plugin was built with no `issuer` and the better-auth config with no
// `appName`, so better-auth fell back to its own name, and every user's
// authenticator app listed the account under "Better Auth".
//
// What better-auth 1.7.3 does with the name, read off its dist rather than its
// docs, decides what these pins have to cover:
//   - the config's `appName` is read ONCE, into the context's `appName`
//     (`context/create-context.mjs`, unset ⇒ "Better Auth");
//   - that context value is read in exactly TWO places, both otpauth URIs:
//     `/two-factor/enable` (`plugins/two-factor/index.mjs`) and
//     `/two-factor/get-totp-uri` (`plugins/two-factor/totp/index.mjs`);
//   - `twoFactor({ issuer })` reaches only the first: the second reads
//     `totpOptions.issuer`, which the plugin's options type omits. So the
//     config's `appName` is the one typed key that names BOTH, and both are
//     pinned below — a fix that set only the plugin's `issuer` would leave the
//     second route answering "Better Auth".
//
// The issuer is a display label. Nothing stores it (the enrollment row holds
// the encrypted secret, the backup codes and `verified`) and the codes depend
// on the secret, digits and period alone, so an authenticator enrolled under
// the old label keeps working. The last block pins that end to end: an
// enrollment made under the "Better Auth" label, confirmed, then served by a
// process configured with the deployment's name, still completes a sign-in
// challenge with the codes the OLD URI's secret produces.
//
// Real better-auth pipeline throughout, on the in-memory engine and the
// request shapes of `two-factor-reenrollment-verified-reset.test.ts`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { AuthManager } from './auth-manager';
// The SAME in-memory engine the sibling two-factor suites drive: a new fake
// would be a new `check:engine-double-contract` ledger entry for no fidelity.
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const PASSWORD = 'S3cure!Passw0rd-issuer';
const EMAIL = 'enroller@example.com';
const BASE = 'http://localhost:3000/api/v1/auth';

// ── RFC 6238 TOTP, hand-rolled for the reason the sibling suites give ───────

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

// ── harness ────────────────────────────────────────────────────────────────

const cookieHeader = (res: Response): string =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

const makeManager = (engine: unknown, appName?: string) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    plugins: { twoFactor: true },
    ...(appName === undefined ? {} : { appName }),
  } as any);

const post = (
  manager: AuthManager,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  manager.handleRequest(
    new Request(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    }),
  );

/**
 * An otpauth URI read the way an authenticator app reads it: the label's
 * issuer prefix, the account, the `issuer` parameter and the secret.
 */
const readOtpauth = (uri: string) => {
  expect(uri.startsWith('otpauth://totp/'), `not a TOTP otpauth URI: ${uri}`).toBe(true);
  const url = new URL(uri.replace('otpauth://', 'https://'));
  const label = decodeURIComponent(url.pathname.slice(1));
  const colon = label.indexOf(':');
  expect(colon, `the label carries no issuer prefix: ${label}`).toBeGreaterThan(0);
  return {
    labelIssuer: label.slice(0, colon),
    account: label.slice(colon + 1),
    issuer: url.searchParams.get('issuer'),
    secret: url.searchParams.get('secret'),
  };
};

const signUp = async (manager: AuthManager): Promise<string> => {
  const res = await post(manager, '/sign-up/email', {
    email: EMAIL,
    password: PASSWORD,
    name: 'Enrolling User',
  });
  expect(res.status, `sign-up: ${await res.clone().text()}`).toBe(200);
  return cookieHeader(res);
};

/** `/two-factor/enable`'s otpauth URI, read. */
const enable = async (manager: AuthManager, cookie: string) => {
  const res = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie });
  expect(res.status, `two-factor/enable: ${await res.clone().text()}`).toBe(200);
  const { totpURI } = (await res.clone().json()) as { totpURI: string };
  return readOtpauth(totpURI);
};

/** `/two-factor/get-totp-uri`'s otpauth URI, read: the second surface. */
const getTotpUri = async (manager: AuthManager, cookie: string) => {
  const res = await post(manager, '/two-factor/get-totp-uri', { password: PASSWORD }, { cookie });
  expect(res.status, `two-factor/get-totp-uri: ${await res.clone().text()}`).toBe(200);
  const { totpURI } = (await res.clone().json()) as { totpURI: string };
  return readOtpauth(totpURI);
};

const principalFor = async (manager: AuthManager, cookie: string): Promise<string | null> => {
  const auth: any = await manager.getAuthInstance();
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) }).catch(() => null);
  const id = session?.user?.id ?? session?.session?.userId;
  return typeof id === 'string' && id.length > 0 ? id : null;
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ───────────────────────────────────────────────────────────────────────────
describe('TOTP enrollment names the deployment as its issuer', () => {
  it('the configured appName is the issuer AND the label prefix on /two-factor/enable', async () => {
    const manager = makeManager(createMemoryEngine(), 'Acme Ops');
    const uri = await enable(manager, await signUp(manager));

    expect(uri).toMatchObject({ labelIssuer: 'Acme Ops', issuer: 'Acme Ops', account: EMAIL });
  });

  it("'ObjectStack' when no appName is configured", async () => {
    const manager = makeManager(createMemoryEngine());
    const uri = await enable(manager, await signUp(manager));

    expect(uri).toMatchObject({ labelIssuer: 'ObjectStack', issuer: 'ObjectStack', account: EMAIL });
  });

  it('/two-factor/get-totp-uri names the same issuer for the same secret', async () => {
    const manager = makeManager(createMemoryEngine(), 'Acme Ops');
    const cookie = await signUp(manager);
    const enrolled = await enable(manager, cookie);
    const fetched = await getTotpUri(manager, cookie);

    expect(fetched).toMatchObject({ labelIssuer: 'Acme Ops', issuer: 'Acme Ops', account: EMAIL });
    expect(fetched.secret, 'get-totp-uri must describe the enrolled secret').toBe(enrolled.secret);
  });

  it('a branding override set before the instance is built outranks the configured appName', async () => {
    // `getAppName()` is the one authority: override, then configured, then
    // 'ObjectStack'. Read when the better-auth instance is built, so this
    // pins the value an instance built after `kernel:ready` names.
    const manager = makeManager(createMemoryEngine(), 'Acme Ops');
    manager.setAppName('Acme Workspace');
    const uri = await enable(manager, await signUp(manager));

    expect(uri).toMatchObject({ labelIssuer: 'Acme Workspace', issuer: 'Acme Workspace' });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('an enrollment made under the old "Better Auth" label keeps working', () => {
  it('its codes still complete a sign-in challenge served under the deployment name', async () => {
    const engine = createMemoryEngine();

    // Before: the label better-auth defaulted to. `appName: 'Better Auth'` is
    // what the unconfigured library answered, byte for byte.
    const before = makeManager(engine, 'Better Auth');
    const cookie = await signUp(before);
    const old = await enable(before, cookie);
    expect(old).toMatchObject({ labelIssuer: 'Better Auth', issuer: 'Better Auth' });
    const oldSecret = base32Decode(String(old.secret));

    const confirmed = await post(before, '/two-factor/verify-totp', { code: totp(oldSecret) }, { cookie });
    expect(confirmed.status, `verify-totp (confirm): ${await confirmed.clone().text()}`).toBe(200);

    // Nothing the enrollment stored carries the label.
    const rows = (engine as any).tables.get('sys_two_factor') as unknown[];
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows[0])).not.toContain('Better Auth');

    // After: a process serving the deployment's name over the same store.
    const after = makeManager(engine, 'Acme Ops');
    const signIn = await post(after, '/sign-in/email', { email: EMAIL, password: PASSWORD });
    expect(signIn.status, `sign-in: ${await signIn.clone().text()}`).toBe(200);
    expect(
      ((await signIn.clone().json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect,
      'sign-in must stop at the 2FA challenge, or nothing below measures the old enrollment',
    ).toBe(true);

    const completed = await post(
      after,
      '/two-factor/verify-totp',
      { code: totp(oldSecret) },
      { cookie: cookieHeader(signIn) },
    );
    expect(completed.status, `verify-totp (challenge): ${await completed.clone().text()}`).toBe(200);
    const sessionCookie = cookieHeader(completed);
    expect(await principalFor(after, sessionCookie), 'the old enrollment signs the user in').toBeTruthy();

    // The same secret, now described under the deployment's name.
    const relabelled = await getTotpUri(after, sessionCookie);
    expect(relabelled).toMatchObject({ labelIssuer: 'Acme Ops', issuer: 'Acme Ops', secret: old.secret });
  });
});
