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
 * The second factor and the SSO protocol blobs are pinned by their own
 * real-engine suites, which run over the same manifest and therefore over the
 * same declarations: `two-factor-reenrollment-verified-reset.test.ts` /
 * `two-factor-rotated-token-echo.test.ts` (TOTP challenge on the enrolment
 * row) and `sso-client-secret-at-rest.test.ts` (② the sign-in read of the
 * provider's `oidc_config`, ⑤ the legacy-secret migration). The last case
 * below proves those suites run against the declared columns.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createPublicKey, verify as verifySignature } from 'node:crypto';
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

  it('the suites pinning the second factor and the SSO blobs run over the declared columns', () => {
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
