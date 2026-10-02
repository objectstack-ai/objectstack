// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21197] Credential-class columns declared `internal: true` (ruling record
 * 5942811916, C2) keep their better-auth consumers working — through the
 * readback seam, never through the generic read path.
 *
 * Real `ObjectQL` over `@objectstack/driver-sql` + better-sqlite3, the objects
 * from this plugin's own manifest, and a real `AuthManager`: the engine's strip
 * is live, so every read better-auth makes through the adapter is exactly the
 * one a deployment makes.
 *
 * Pinned here:
 *  - **The signing-key object.** JWT signing works on the first request, a
 *    later request, and a request served by a FRESH manager — and the key row
 *    it signs with was written while the key-material column was still
 *    undeclared (an engine registered with the pre-change declaration, over
 *    the same database file), i.e. a key that predates the upgrade. Every
 *    token verifies against the served JWKS. The generic read omits the column;
 *    storage still holds it.
 *  - **The one-time credential class.** Password reset end to end: request,
 *    redeem the emailed token, sign in with the new password, the old one
 *    refused, the token refused on replay. The generic read omits both
 *    credential columns of the stored row.
 *
 *  - **The OAuth client secret.** A dynamically registered confidential
 *    client authenticates to introspection with its secret; a wrong secret is
 *    refused. The generic read omits the stored digest.
 *  - **The second factor.** TOTP enrolment verifies against the stored
 *    secret, and a later sign-in challenge is redeemed with a backup code —
 *    single-use. The generic read omits both credential columns.
 *
 * The SSO protocol blobs are pinned by `sso-client-secret-at-rest.test.ts`,
 * a real-engine suite over the platform definition (② the sign-in read of the
 * provider's `oidc_config`, ⑤ the legacy-secret migration); the last case
 * below proves the declarations those suites run against.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHmac, createPublicKey, verify as verifySignature } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';

const BASE = 'http://localhost:3000';
const AUTH = `${BASE}/api/v1/auth`;
const SECRET = 'test-secret-at-least-32-chars-long-21197';
const SYS = { context: { isSystem: true } } as const;

type Row = Record<string, unknown>;

const engines: ObjectQL[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** The manifest's objects with one column's `internal` flag removed — the pre-change declaration. */
function withoutInternal(object: string, field: string): unknown[] {
  return authIdentityObjects.map((o: any) => {
    if (o?.name !== object) return o;
    const { internal: _dropped, ...column } = o.fields[field];
    return { ...o, fields: { ...o.fields, [field]: column } };
  });
}

async function bootEngine(filename: string, objects: unknown[] = authIdentityObjects): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const object of objects) engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  await engine.syncSchemas();
  return engine;
}

/** Rows at DRIVER level — below the engine's strip. */
async function rowsAtRest(engine: ObjectQL, object: string): Promise<Row[]> {
  const driver = (engine as unknown as { getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> } })
    .getDriver(object);
  const found = await driver.find(object, { where: {} });
  return (Array.isArray(found) ? found : [found]).filter(Boolean) as Row[];
}

function makeManager(engine: ObjectQL, plugins: Record<string, unknown> = {}): AuthManager {
  return new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never, plugins } as never);
}

const post = (manager: AuthManager, path: string, body: unknown, headers: Record<string, string> = {}) =>
  manager.handleRequest(
    new Request(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: BASE, ...headers },
      body: JSON.stringify(body),
    }),
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

const getSession = (manager: AuthManager, cookie: string) =>
  manager.handleRequest(new Request(`${AUTH}/get-session`, { headers: { cookie } }));

/** Verify a compact JWS against the served JWKS; answers the key id it was signed with. */
async function verifyAgainstJwks(manager: AuthManager, token: string): Promise<string> {
  const [h, p, s] = token.split('.');
  const header = JSON.parse(Buffer.from(h!, 'base64url').toString('utf8')) as { alg: string; kid: string };
  const jwks = (await (await manager.handleRequest(new Request(`${AUTH}/jwks`))).json()) as { keys: Array<Record<string, unknown>> };
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  expect(jwk, `the JWKS serves the signing key ${header.kid}`).toBeTruthy();
  const key = createPublicKey({ key: jwk as never, format: 'jwk' });
  const ok = verifySignature(
    header.alg === 'EdDSA' ? null : 'sha256',
    Buffer.from(`${h}.${p}`),
    { key, dsaEncoding: 'ieee-p1363' },
    Buffer.from(s!, 'base64url'),
  );
  expect(ok, 'the token verifies against the served JWKS').toBe(true);
  return header.kid;
}

const PASSWORD = 'S3cure!Passw0rd-21197';

function base32Decode(input: string): Buffer {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
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

/** The 6-digit TOTP for `secret` at the current 30-second step (RFC 6238). */
function totp(secret: Buffer): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

describe('[#21197] internal credential columns keep their better-auth consumers working', () => {
  it('the signing-key object: a key minted before the declaration signs on the first, a later and a fresh-manager request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'os-21197-'));
    dirs.push(dir);
    const file = join(dir, 'auth.sqlite');

    // Before the upgrade: the key-material column undeclared. Sign up and let
    // the jwt plugin mint and store its key.
    const before = await bootEngine(file, withoutInternal('sys_jwks', 'private_key'));
    const beforeManager = makeManager(before, { oidcProvider: true });
    const signedUp = await post(beforeManager, '/sign-up/email', { email: 'jwks@example.com', password: PASSWORD, name: 'Signer' });
    expect(signedUp.status, await signedUp.clone().text()).toBe(200);
    const cookie = cookieFrom(signedUp);
    const minted = await getSession(beforeManager, cookie);
    expect(minted.headers.get('set-auth-jwt'), 'the pre-upgrade manager signs').toBeTruthy();
    const [keyRow] = await rowsAtRest(before, 'sys_jwks');
    expect(keyRow?.id, 'the key row was stored before the upgrade').toBeTruthy();

    // After the upgrade: the shipped declaration, the same database file.
    const after = await bootEngine(file);
    const generic = (await (after as any).find('sys_jwks', { ...SYS })) as Row[];
    expect(generic).toHaveLength(1);
    expect(generic[0], 'the generic read omits the key material').not.toHaveProperty('private_key');
    expect((await rowsAtRest(after, 'sys_jwks'))[0]?.private_key, 'storage is untouched').toBeTruthy();

    const manager = makeManager(after, { oidcProvider: true });
    for (const [label, m] of [['first request', manager], ['later request', manager], ['fresh manager', makeManager(after, { oidcProvider: true })]] as const) {
      const res = await getSession(m, cookie);
      expect(res.status, `${label}: get-session`).toBe(200);
      const token = res.headers.get('set-auth-jwt');
      expect(token, `${label}: signed`).toBeTruthy();
      expect(await verifyAgainstJwks(m, token!), `${label}: signed with the pre-upgrade key`).toBe(keyRow!.id);
      expect(m.getDegradedAuthFeatures().map((f: any) => f.feature ?? f), `${label}: signing not degraded`).not.toContain('jwtSigning');
    }
    expect(await rowsAtRest(after, 'sys_jwks'), 'no second key was minted').toHaveLength(1);
  }, 120_000);

  it('the one-time credential class: password reset redeems end to end, and the token is single-use', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = await bootEngine(':memory:');
    const manager = makeManager(engine);
    const sent: Array<{ template: string; data: Record<string, unknown> }> = [];
    manager.setEmailService({
      sendTemplate: async (input: any) => {
        sent.push(input);
        return { status: 'sent' };
      },
    } as never);

    const email = 'reset@example.com';
    const signedUp = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: 'Resetter' });
    expect(signedUp.status, await signedUp.clone().text()).toBe(200);

    const requested = await post(manager, '/request-password-reset', { email, redirectTo: `${BASE}/reset` });
    expect(requested.status, await requested.clone().text()).toBe(200);
    await vi.waitFor(() => expect(sent.some((m) => m.template === 'auth.password_reset')).toBe(true));
    const token = String(sent.find((m) => m.template === 'auth.password_reset')!.data.token);

    // The stored credential row: both columns stored, neither served.
    const atRest = await rowsAtRest(engine, 'sys_verification');
    expect(atRest.length, 'the reset stored its row').toBeGreaterThan(0);
    for (const row of (await (engine as any).find('sys_verification', { ...SYS })) as Row[]) {
      expect(row).not.toHaveProperty('identifier');
      expect(row).not.toHaveProperty('value');
    }

    const NEW_PASSWORD = 'N3w!Passw0rd-21197-reset';
    const reset = await post(manager, '/reset-password', { token, newPassword: NEW_PASSWORD });
    expect(reset.status, `reset-password: ${await reset.clone().text()}`).toBe(200);

    expect((await post(manager, '/sign-in/email', { email, password: NEW_PASSWORD })).status, 'the new password signs in').toBe(200);
    expect((await post(manager, '/sign-in/email', { email, password: PASSWORD })).status, 'the old password is refused').toBe(401);

    const replay = await post(manager, '/reset-password', { token, newPassword: 'An0ther!Passw0rd-21197' });
    expect(replay.status, 'the consumed token is refused').toBe(400);
  }, 120_000);

  it('the second factor: TOTP enrolment verifies, and a sign-in challenge is redeemed with a single-use backup code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = await bootEngine(':memory:');
    const manager = makeManager(engine, { twoFactor: true });
    const email = 'second-factor@example.com';

    const signedUp = await post(manager, '/sign-up/email', { email, password: PASSWORD, name: 'Second Factor' });
    expect(signedUp.status, await signedUp.clone().text()).toBe(200);
    const cookie = cookieFrom(signedUp);

    const enabled = await post(manager, '/two-factor/enable', { password: PASSWORD }, { cookie });
    expect(enabled.status, `two-factor/enable: ${await enabled.clone().text()}`).toBe(200);
    const { totpURI, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    const secret = base32Decode(String(new URL(totpURI.replace('otpauth://', 'https://')).searchParams.get('secret')));
    expect(backupCodes.length).toBeGreaterThan(0);

    for (const row of (await (engine as any).find('sys_two_factor', { ...SYS })) as Row[]) {
      expect(row).not.toHaveProperty('secret');
      expect(row).not.toHaveProperty('backup_codes');
    }

    const enrolled = await post(manager, '/two-factor/verify-totp', { code: totp(secret) }, { cookie });
    expect(enrolled.status, `verify-totp (enrolment): ${await enrolled.clone().text()}`).toBe(200);

    // A fresh sign-in now stops at the second factor.
    const challenged = await post(manager, '/sign-in/email', { email, password: PASSWORD });
    expect(challenged.status, await challenged.clone().text()).toBe(200);
    expect(((await challenged.clone().json()) as any).twoFactorRedirect, 'the challenge is required').toBe(true);
    const challengeCookie = cookieFrom(challenged);

    const redeemed = await post(manager, '/two-factor/verify-backup-code', { code: backupCodes[0] }, { cookie: challengeCookie });
    expect(redeemed.status, `verify-backup-code: ${await redeemed.clone().text()}`).toBe(200);

    const again = await post(manager, '/sign-in/email', { email, password: PASSWORD });
    const replay = await post(manager, '/two-factor/verify-backup-code', { code: backupCodes[0] }, { cookie: cookieFrom(again) });
    expect(replay.status, 'a used backup code is refused').not.toBe(200);
  }, 120_000);

  it('the OAuth client secret: a confidential client authenticates with its secret, and a wrong one is refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = await bootEngine(':memory:');
    const manager = makeManager(engine, { oidcProvider: true, dynamicClientRegistration: true });

    const registered = await manager.handleRequest(new Request(`${AUTH}/oauth2/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ client_name: 'internal-21197', redirect_uris: ['https://example.com/cb'] }),
    }));
    expect(registered.status, `oauth2/register: ${await registered.clone().text()}`).toBeLessThan(400);
    const { client_id: clientId, client_secret: clientSecret } = (await registered.json()) as { client_id: string; client_secret: string };
    expect(clientSecret, 'registration returns the secret once').toBeTruthy();

    for (const row of (await (engine as any).find('sys_oauth_application', { ...SYS })) as Row[]) {
      expect(row).not.toHaveProperty('client_secret');
    }

    // Introspection authenticates the CLIENT by its secret before it answers
    // anything about the token, so its status is a verdict on the secret.
    const introspect = (secret: string) => manager.handleRequest(new Request(`${AUTH}/oauth2/introspect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
        origin: BASE,
      },
      body: new URLSearchParams({ token: 'not-a-token' }).toString(),
    }));
    const ok = await introspect(clientSecret);
    expect(ok.status, `introspect, right secret: ${await ok.clone().text()}`).toBe(200);
    expect(((await ok.json()) as { active?: boolean }).active).toBe(false);
    const wrong = await introspect(`${clientSecret}-wrong`);
    expect(wrong.status, 'introspect, wrong secret').toBe(401);
  }, 120_000);

  it('the suites pinning the SSO blobs run over the declared columns', () => {
    const declared = (object: string) =>
      Object.entries((authIdentityObjects.find((o: any) => o?.name === object) as any)?.fields ?? {})
        .filter(([, def]) => (def as { internal?: unknown }).internal === true)
        .map(([name]) => name)
        .sort();
    expect(declared('sys_two_factor')).toEqual(['backup_codes', 'secret']);
    expect(declared('sys_sso_provider')).toEqual(['oidc_config', 'saml_config']);
    expect(declared('sys_jwks')).toEqual(['private_key']);
    expect(declared('sys_verification')).toEqual(['identifier', 'value']);
    expect(declared('sys_oauth_application')).toEqual(['client_secret']);
  });
});
